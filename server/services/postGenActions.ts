/**
 * postGenActions.ts — 統一處理「生成完成後」的後置寫入動作
 *
 * 為什麼要拉成共用模組：
 *   原本 doPostGenComplete 寫死在 routers.ts，僅在 checkStudioJob /
 *   recordGenResult / 同步生成路徑被呼叫。但 fal.ai webhook 通常比 5s
 *   polling 早抵達 → webhookFal.ts 把 backgroundJob 標完成 → 隨後的
 *   checkStudioJob 看到 status !== "processing" 直接 short-circuit，
 *   doPostGenComplete 永遠不跑。結果：使用者用 ImageStudio / VideoStudio /
 *   ProStudio 生成的圖/影/音，只有 backgroundJobs 有紀錄，
 *   digital_asset_library / generation_history / prompt_library / AI 監控
 *   通通沒進 →「資產庫永遠是空的」。
 *
 * 此模組提供：
 *   - doPostGenComplete(): 真正執行四件事（提示詞庫、資產庫、歷史、監控室）
 *   - runPostGenForJob(): 從 backgroundJob.resultJson 讀回識別資訊並執行
 *     doPostGenComplete，且設 postGenComplete=true 旗標，所以 webhook 與
 *     polling 同時抵達也只會跑一次。
 */

import * as db from "../db";
import { getDb } from "../db";
import { promptLibrary } from "../../drizzle/schema";
import { addGenerationLog } from "./brainAutoRepair";
import { updateLatestPickAcceptance } from "./agentModelPicks";
import { isInternalUrl } from "./internalMedia";
import { enqueueMediaArchivalTask } from "./mediaArchivalService";

export const MIN_PROMPT_LENGTH_FOR_LIBRARY = 4;
export const MAX_PROMPT_TITLE_LENGTH = 80;
export const MAX_MODEL_HINT_LENGTH = 128;
export const MAX_ASSET_DESCRIPTION_LENGTH = 500;
export const MAX_LOG_FIELD_LENGTH = 200;

/**
 * prompt ↔ asset 關聯（prompt_assets junction, migration 0075）寫入開關。
 * 預設 OFF — 與 env.validated.ts 的 ENABLE_PROMPT_ASSET_LINKS 同名同預設；
 * 這裡直接讀 process.env（lazy，與 perplexityThrottle 同模式）讓測試可在
 * runtime 重設 env 立即生效，也避免在本模組引入 env.validated 的載入副作用。
 */
export function isPromptAssetLinksEnabled(): boolean {
  const value = process.env.ENABLE_PROMPT_ASSET_LINKS;
  if (value === undefined || value === null || value.trim() === "") return false;
  return !["0", "false", "off", "no", "disabled"].includes(
    value.trim().toLowerCase()
  );
}

export type PostGenModality = "image" | "video" | "audio" | "voice";

/**
 * AIDV-10 — prompt_library 依 content 合併去重（upsert-by-content）的純查詢工具。
 *
 * 為什麼存在：生成鏈原本「每次生成都無條件新插一列 prompt_library」，
 * 同一段提示詞生成 N 次就多出 N 列。本函式把寫入改成 upsert-by-content：
 * 先以 (userId, category, content) 查既有列 → 命中重用其 id、不再 insert；
 * 未命中才照舊 insert。回傳的 id 一律給下游（#864 prompt↔asset junction、
 * useCount 累計）使用，確保同 content 的多個 asset 都連到同一 prompt 列。
 *
 * 去重 scope = (userId, category, content)（研究判定）：
 *   - userId   ：per-user 隱私/所有權邊界，必含。
 *   - category ：存的是 modality（image/video/audio/voice）。同一句話拿去生圖
 *                vs 生影是不同用途、modelHint/下游語意不同 → 納入鍵分開。
 *   - content  ：完整提示詞全文比對（不截斷、不做大小寫/unicode 正規化；
 *                呼叫端已 trim 過頭尾空白）。content 欄位的 TEXT 預設 collation
 *                是 utf8mb4_unicode_ci（大小寫/重音/尾空白皆 INsensitive），會把
 *                'A cute cat'/'a cute cat'、'café'/'cafe'、'foo'/'foo   ' 誤併成
 *                同一列。為符合「完整全文、原樣比對」語意，content 的等值比對改用
 *                BINARY（位元組級、case/accent/trailing-space 全 sensitive），讓
 *                只差大小寫/重音/尾空白的提示詞保持為不同列、不被誤併。
 *
 * HARD SAFETY：
 *   - 非破壞性：只讀既有列＋新插，不 UPDATE/DELETE 任何既有列、不做資料遷移。
 *   - 不動 migration：純 app 層 query-before-insert，不依賴任何 DB 唯一鍵。
 *   - 永不弄壞生成鏈：SELECT 一旦出錯，安全 fallback 成原本的 insert；
 *     insert 也出錯時回傳 null（呼叫端視為「沒有 promptId」照常往下走）。
 *
 * 並發 race（無 DB 唯一鍵）已知缺口：兩條並發鏈同 content 同時查不到 → 都 insert
 * → 偶發多一列。相對「現狀完全不去重」仍是淨改善；命中時 orderBy id asc 取最早
 * 一列，讓後續讀路徑對既有重複列仍穩定收斂到固定 id。
 *
 * 抽成獨立函式（而非內嵌在 doPostGenComplete）以便單測 upsert 矩陣。
 *
 * @returns 既有/新插列的 id；任何情況下都拿不到有效 id 時回 null。
 */
export interface FindOrCreatePromptParams {
  /** 已 getDb() 拿到的連線（呼叫端負責 null 檢查；此處假設非 null）。 */
  dbConn: {
    select: (...args: any[]) => any;
    insert: (...args: any[]) => any;
    update: (...args: any[]) => any;
  };
  userId: number;
  /** 提示詞全文（呼叫端已 trim）。 */
  content: string;
  category: PostGenModality;
  /** prompt_library.title（截斷後）。僅在「未命中、需新插」時使用。 */
  title: string;
  /** prompt_library.modelHint（截斷後）。僅在新插時寫入；命中時不覆寫既有值。 */
  modelHint: string;
}

export async function findOrCreatePromptByContent(
  params: FindOrCreatePromptParams
): Promise<number | null> {
  const { dbConn, userId, content, category, title, modelHint } = params;

  // (1) 先以 (userId, category, content) 查既有列 — 命中則重用，永不重插。
  // content 用 BINARY 等值比對（避開 utf8mb4_unicode_ci 的 case/accent/trailing-
  // space 折疊，符合「完整全文原樣比對」語意，不誤併僅大小寫/重音/尾空白不同的列）。
  // SELECT 失敗時整段吞錯往下走 fallback insert（best-effort，不阻斷生成鏈）。
  try {
    const { and, eq, asc, sql } = await import("drizzle-orm");
    const existing = await dbConn
      .select({ id: promptLibrary.id })
      .from(promptLibrary)
      .where(
        and(
          eq(promptLibrary.userId, userId),
          eq(promptLibrary.category, category),
          // BINARY 位元組級比對 — case/accent/trailing-space 全 sensitive。
          sql`BINARY ${promptLibrary.content} = ${content}`
        )
      )
      // 歷史上（去重上線前）同 content 可能已有多列 → 取最小 id 穩定收斂。
      .orderBy(asc(promptLibrary.id))
      .limit(1);
    const hitRaw = Number(existing?.[0]?.id);
    if (Number.isFinite(hitRaw) && hitRaw > 0) {
      // 命中既有列 → 重用 id，不 insert。同時 useCount += 1 讓「重用」真正累計，
      // 使 search_prompts / promptLibrary.list 的 useCount desc 熱門排序反映實際
      // 生成重用次數（與 promptLibrary.incrementUseCount 同 SQL）。
      // 累計失敗吞錯：絕不能讓 useCount 寫入弄壞生成鏈或丟掉已命中的 id。
      try {
        await dbConn
          .update(promptLibrary)
          .set({ useCount: sql`${promptLibrary.useCount} + 1` })
          .where(eq(promptLibrary.id, hitRaw));
      } catch {
        // useCount 累計失敗不影響重用 — 仍回傳命中的 id。
      }
      return hitRaw;
    }
  } catch {
    // SELECT 失敗：安全 fallback 成原本的 insert（下方），絕不讓去重弄壞生成鏈。
  }

  // (2) 未命中（或查詢失敗 fallback）→ 照舊 insert 新列，回傳 insertId。
  // insert 失敗時回傳 null（呼叫端視為無 promptId 照常往下走）。
  try {
    const insertResult = await dbConn.insert(promptLibrary).values({
      userId,
      title,
      content,
      category,
      tags: [],
      isPublic: false,
      modelHint,
      language: "zh",
    });
    // mysql2 driver 回 [ResultSetHeader]；防禦式取值（測試 mock 可能回 undefined）。
    const rawId = Number(insertResult?.[0]?.insertId);
    return Number.isFinite(rawId) && rawId > 0 ? rawId : null;
  } catch {
    // insert 失敗（並發撞列、DB 暫時不可用等）→ null，不拋。
    return null;
  }
}

/**
 * 統一 AI 生成資產的 S3/儲存路徑前綴。
 *
 * 過去各工作室自行組路徑（generated/director/<model>、
 * generated/image-studio/<model>、generated/pro-studio/<model>、
 * generated/webhook/<jobId>…）導致同一個使用者的資產散落在不同 prefix，
 * 也讓「我的資產」反向掃描變得不可能。
 *
 * 一律走 `generated/studio/<userId>/<source>[/<subfolder>][/<sanitized-model>]`，
 * 來源欄位包含：creative / director / image / video / pro / background /
 * webhook / suno / replicate。
 */
export type AssetStorageSource =
  | "creative"
  | "director"
  | "image"
  | "video"
  | "pro"
  | "background"
  | "webhook"
  | "suno"
  | "replicate";

export function unifiedAssetPrefix(params: {
  userId: number;
  source: AssetStorageSource;
  modelId?: string;
  subfolder?: string;
}): string {
  const sanitizedModel = params.modelId
    ? params.modelId.replace(/[^\w/-]+/g, "_")
    : null;
  const parts = [
    `generated/studio/${params.userId}/${params.source}`,
    ...(params.subfolder ? [params.subfolder] : []),
    ...(sanitizedModel ? [sanitizedModel] : []),
  ];
  return parts.join("/");
}

export interface PostGenParams {
  userId: number;
  modality: PostGenModality;
  modelId: string;
  prompt?: string;
  resultUrl?: string;
  label?: string;
  sourceStudio?: string;
  /**
   * 自訂歷史紀錄 compiledPrompt，用來支援呼叫端自己的 dedupe（例如
   * imageStudio.checkImageStatus 一份請求會被輪詢多次，靠
   * compiledPrompt === `[imageStudio:<model>:<request>]` 作唯一鍵）。
   * 若不提供，會 fallback 到 promptText 作 compiledPrompt（既有行為）。
   */
  dedupeMarker?: string;
  /**
   * 直接指定 generation_history.compiledPrompt — 創意工作室會在這帶
   * vibe-card / 安全審核後完整組合過的提示詞，與 dedupeMarker 互斥。
   */
  compiledPrompt?: string;
  /** 額外塞進 generationHistory.parameterSnapshot 的欄位 */
  parameterSnapshot?: Record<string, unknown>;
  /** 縮圖 URL — 影片 / 圖片預覽 */
  thumbnailUrl?: string;
  /**
   * 實際扣款點數（由 submitMultimodalAsync 的 estimatePoints().totalPoints 算出，
   * 經 backgroundJob.resultJson.costPoints 透過 runPostGenForJob 帶入）。
   * 缺值時退回 1 以保留原行為 — 寫入 generation_history.costCredits 用以做帳。
   */
  costCredits?: number;
  /**
   * 對應的 backgroundJobs.id（若有）。寫入 digital_asset_library 與
   * generation_history.parameterSnapshot 讓「我的資產」反向查得到原始
   * 任務記錄（fal request_id、降級紀錄等）。Schema 欄位於 migration 0047
   * 新增；舊 schema 下會被 ORM 忽略。
   */
  backgroundJobId?: number;
  /**
   * prompt↔asset 關聯類型（prompt_assets.relation enum：derived/variant/rewrite/extended）。
   * 座艙重骰=variant、改寫=rewrite、延長=extended；預設 derived（生成完成的衍生關聯）。
   * 僅在 ENABLE_PROMPT_ASSET_LINKS=ON 且 promptId+assetId 都有時實際寫入；
   * 寫入仍走 (promptId, assetId, relation) 唯一鍵＝冪等。
   */
  relation?: "derived" | "variant" | "rewrite" | "extended";
}

/**
 * 同步寫入提示詞庫 + 資產庫 + 歷史 + 監控。
 * 各子任務皆吞錯，不影響主流程。
 */
export async function doPostGenComplete(params: PostGenParams): Promise<void> {
  const {
    userId,
    modality,
    modelId,
    prompt,
    resultUrl,
    label,
    sourceStudio,
    dedupeMarker,
    compiledPrompt: callerCompiledPrompt,
    parameterSnapshot,
    thumbnailUrl,
    costCredits,
    backgroundJobId,
    relation,
  } = params;
  const promptText = (prompt ?? "").trim();
  const historyCostCredits =
    typeof costCredits === "number" && Number.isFinite(costCredits) && costCredits > 0
      ? Math.round(costCredits)
      : 1;

  // 1-0. dedupe 前檢 — checkImageStatus / checkVideoStatus / checkAudioStatus
  // 都是輪詢端點，每 3 秒會打一次；命中 COMPLETED 就會呼叫到此處。沒有
  // 前檢就會在 generation_history / digital_asset_library / promptLibrary /
  // monitoring log 每輪都新增一筆。
  // 所有 polling caller 都會帶 dedupeMarker（格式 [<source>:<modelId>:<requestId>]）—
  // 在此用它做 generation_history.compiledPrompt 的存在檢查即可短路後續所有寫入。
  if (dedupeMarker) {
    try {
      const dbConn = await getDb();
      if (dbConn) {
        const { generationHistory } = await import("../../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        const existing = await dbConn
          .select({ id: generationHistory.id })
          .from(generationHistory)
          .where(
            and(
              eq(generationHistory.userId, userId),
              eq(generationHistory.compiledPrompt, dedupeMarker)
            )
          )
          .limit(1);
        if (existing.length > 0) {
          // 同一個 fal request 已經寫過一次了 — 整個 post-gen 流程都跳過，
          // 避免重複資產 / 歷史 / 監控紀錄。
          return;
        }
      }
    } catch {
      // dedupe 查詢失敗時繼續執行（best-effort），可接受偶發重複。
    }
  }

  // 1-2. 提示詞庫（AIDV-10：upsert-by-content 去重）
  // 記下重用/新寫入列的 id — 1-3a 寫完資產後（旗標 ON 時）用它建 prompt ↔ asset 邊。
  // 改為 findOrCreatePromptByContent：先以 (userId, category, content) 查既有列 →
  // 命中重用其 id、不再 insert；未命中才照舊 insert。確保同一段提示詞生成 N 次
  // 只會有「一列 prompt、N 個 asset 都連到它」，而非每次都新插一列。
  // 整段 try/catch 吞錯：去重出錯絕不能讓生成鏈失敗。
  let savedPromptId: number | null = null;
  if (promptText.length >= MIN_PROMPT_LENGTH_FOR_LIBRARY) {
    try {
      const dbConn = await getDb();
      if (dbConn) {
        savedPromptId = await findOrCreatePromptByContent({
          dbConn,
          userId,
          content: promptText,
          category: modality,
          title:
            promptText.slice(0, MAX_PROMPT_TITLE_LENGTH) ||
            `${label ?? modality}提示詞`,
          modelHint: modelId.slice(0, MAX_MODEL_HINT_LENGTH),
        });
      }
    } catch {
      // 靜默忽略 — 去重/寫入失敗不能擋資產/歷史/監控寫入。
    }
  }

  // 1-3a. 數位資產庫 — 補上 0047 migration 新增的來源追蹤欄位
  // （sourceStudio / modelId / backgroundJobId），讓「我的資產」可依
  // 工作室與 AI 模型分類，並反向連回 backgroundJobs。
  if (resultUrl) {
    try {
      const newAssetId = await db.createDigitalAsset({
        userId,
        title: label ?? `AI 生成 ${modality}`,
        description: promptText
          ? promptText.slice(0, MAX_ASSET_DESCRIPTION_LENGTH)
          : undefined,
        assetType: modality,
        fileUrl: resultUrl,
        fileKey: resultUrl,
        promptUsed: promptText || undefined,
        thumbnailUrl: thumbnailUrl ?? undefined,
        sourceStudio: sourceStudio ?? null,
        modelId: modelId ? modelId.slice(0, MAX_MODEL_HINT_LENGTH) : null,
        backgroundJobId:
          typeof backgroundJobId === "number" ? backgroundJobId : null,
      });

      // 1-3a-2. prompt ↔ asset 關聯（prompt_assets junction, migration 0075）。
      // 旗標 ENABLE_PROMPT_ASSET_LINKS 預設 OFF；ON 時把 1-2 剛寫的提示詞列
      // 與本資產列連起來。relation 由呼叫端帶入（座艙重骰/改寫/延長＝
      // variant/rewrite/extended），預設 derived。(promptId, assetId, relation)
      // 唯一鍵保證 webhook+polling 雙路徑重跑冪等；失敗吞錯不影響主流程。
      const linkAssetId = Number(newAssetId);
      if (
        isPromptAssetLinksEnabled() &&
        savedPromptId !== null &&
        Number.isFinite(linkAssetId) &&
        linkAssetId > 0
      ) {
        try {
          await db.createPromptAssetLink({
            promptId: savedPromptId,
            assetId: linkAssetId,
            relation: relation ?? "derived",
          });
        } catch {
          // 靜默忽略 — 關聯失敗不能擋資產/歷史寫入
        }
      }
    } catch {
      // 靜默忽略
    }
  }

  // 1-3b. 生成歷史
  if (resultUrl) {
    try {
      // compiledPrompt 優先序：呼叫端傳入 → dedupeMarker → 原始 prompt。
      // dedupeMarker 是 imageStudio / videoStudio / proStudio 等用來防
      // 同一個 fal request 重複寫入的唯一鍵；creative sync 路徑則會直
      // 接帶 compiledPrompt（含 vibe card 組合後的最終提示詞）。
      const compiledPromptValue =
        callerCompiledPrompt ?? dedupeMarker ?? (promptText || undefined);
      await db.createHistoryEntry({
        userId,
        modality,
        prompt: promptText || undefined,
        compiledPrompt: compiledPromptValue,
        // 記下 modelId / sourceStudio / backgroundJobId 讓 ImageStudio 等
        // 頁面能反向 map 回模型名稱、決定點選歷史項目要切到哪個 tab，並
        // 串連回原始任務記錄。
        parameterSnapshot: {
          modelId,
          sourceStudio: sourceStudio ?? "unknown",
          ...(typeof backgroundJobId === "number" ? { backgroundJobId } : {}),
          ...(label ? { label } : {}),
          ...(parameterSnapshot ?? {}),
        },
        resultUrl,
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        costCredits: historyCostCredits,
      });
    } catch {
      // 靜默忽略
    }
  }

  // 1-4. AI 監控室
  try {
    addGenerationLog({
      userId,
      modality,
      modelId: modelId.slice(0, MAX_LOG_FIELD_LENGTH),
      promptSnippet: promptText.slice(0, MAX_LOG_FIELD_LENGTH),
      resultUrl,
      success: !!resultUrl,
      sourceStudio: sourceStudio ?? "unknown",
    });
  } catch {
    // 靜默忽略
  }

  // 1-5. agent_model_picks 接受度回填
  // 一個生成有 resultUrl 視為被工作室採用 → mark the user's most recent
  // pick of (modality, modelId) as accepted=true. The orb's preference
  // distiller weights `acceptedCount * 2` over `pickCount`, so this is
  // what makes a model the user actually keeps using rise to the top of
  // recommendations vs. one they picked once and abandoned.
  if (resultUrl && modelId) {
    try {
      await updateLatestPickAcceptance({
        userId,
        modality,
        modelId,
        accepted: true,
      });
    } catch {
      // updateLatestPickAcceptance is itself best-effort, but be doubly
      // defensive so a slow / failed write never breaks the success path.
    }
  }

  // 1-6. 保底入庫 — AI 提供商回傳的 URL 多半是 24h~7d 就過期的 presigned link,
  // 資產庫直接存它過了保存期就壞圖。這裡 fire-and-forget enqueue 一個歸檔任務,
  // 把檔案搬到自家儲存並回填 sourceUrl / archivedAt（idempotent，重複呼叫不會
  // 重複下載）。失敗只記 log，不能讓歸檔錯誤倒灌回主流程。
  if (resultUrl && !isInternalUrl(resultUrl)) {
    enqueueMediaArchivalTask({
      userId,
      backgroundJobId,
      resultUrl,
      modality,
    }).catch(err => {
      console.warn(
        `[postGenActions] enqueueMediaArchivalTask failed user=${userId} job=${backgroundJobId ?? "-"}:`,
        err
      );
    });
  }
}

/**
 * 從 backgroundJob 讀回識別資訊並執行 doPostGenComplete，
 * 完成後在 resultJson 設 postGenComplete=true 旗標防止重複寫入。
 *
 * 同時被 webhookFal、checkStudioJob 呼叫（兩條路徑可能同時抵達）；
 * 第二次呼叫會看到旗標而 short-circuit。
 *
 * 回傳：true=有執行；false=已執行過 / 找不到 job / 必要欄位缺失。
 */
export async function runPostGenForJob(jobId: number): Promise<boolean> {
  const job = await db.getBackgroundJob(jobId);
  if (!job) return false;

  const meta = (job.resultJson ?? {}) as Record<string, unknown>;
  if (meta.postGenComplete === true) return false;

  const studioType =
    (meta.studioType as string | undefined) ?? (job.jobType as string);
  if (
    studioType !== "image" &&
    studioType !== "video" &&
    studioType !== "audio" &&
    studioType !== "voice"
  ) {
    return false;
  }

  const modelId = (meta.modelId as string | undefined) ?? "unknown";
  const prompt = meta.prompt as string | undefined;
  // 同時相容 checkStudioJob 寫的 resultUrl，與 webhookFal 寫的 imageUrl/videoUrl/audioUrl
  const resultUrl =
    (meta.resultUrl as string | undefined) ??
    (meta.imageUrl as string | undefined) ??
    (meta.videoUrl as string | undefined) ??
    (meta.audioUrl as string | undefined);
  const label = meta.label as string | undefined;
  const sourceStudio =
    (meta.sourceStudio as string | undefined) ?? studioType;
  // submitMultimodalAsync 在預扣款後把實際扣的點數寫入 resultJson.costPoints,
  // 讓 history 端能記下真實費用而非寫死 1。
  const costPointsRaw = meta.costPoints;
  const costCredits =
    typeof costPointsRaw === "number" ? costPointsRaw : undefined;

  const VALID_RELATIONS = ["derived", "variant", "rewrite", "extended"] as const;
  type Relation = typeof VALID_RELATIONS[number];
  const relationRaw = meta.relation as string | undefined;
  const relation: Relation | undefined =
    relationRaw && (VALID_RELATIONS as readonly string[]).includes(relationRaw)
      ? (relationRaw as Relation)
      : undefined;

  await doPostGenComplete({
    userId: job.userId,
    modality: studioType as PostGenModality,
    modelId,
    prompt,
    resultUrl,
    label,
    sourceStudio,
    costCredits,
    backgroundJobId: jobId,
    relation,
  });

  // 寫旗標。失敗時不重試 — 若 doPostGenComplete 已成功插入，重複呼叫的
  // 風險就是少數情境下出現重複資產，比起完全沒存還是好得多。
  try {
    await db.updateBackgroundJob(jobId, {
      resultJson: { ...meta, postGenComplete: true } as any,
    });
  } catch {
    // 靜默忽略
  }

  return true;
}

/**
 * 任務失敗時退回 submitMultimodalAsync 預扣的點數。
 *
 * submitMultimodalAsync / chargeForFalTask 在送出 fal queue 前先扣點，但失敗
 * 路徑只在「queue submit 拋例外」時退款。fal queue 成功送出後若任務本身失敗
 * （webhook ERROR、checkStudioJob 偵測 FAILED、30 分鐘 stale 超時、completed
 * 但 URL 抽不到等），原本沒人退款 → 使用者扣了錢卻拿不到成品。
 *
 * 此函式以 backgroundJob.resultJson.costPoints 為退款金額來源、refunded 旗標
 * 做冪等（同一 job 多條失敗路徑被同時打到只會退一次）。
 *
 * 回傳：true=有退款；false=已退過 / 無金額紀錄 / job 不存在。
 */
export async function refundJobIfBilled(jobId: number): Promise<boolean> {
  const job = await db.getBackgroundJob(jobId);
  if (!job) return false;

  const meta = (job.resultJson ?? {}) as Record<string, unknown>;
  if (meta.refunded === true) return false;

  const costPointsRaw = meta.costPoints;
  const points =
    typeof costPointsRaw === "number" &&
    Number.isFinite(costPointsRaw) &&
    costPointsRaw > 0
      ? Math.round(costPointsRaw)
      : 0;
  if (points <= 0) return false;

  try {
    await db.refundUserPoints(job.userId, points);
  } catch (err) {
    // refund 失敗不要拋 — 若整個 DB layer 都掛掉，failure path 也救不回來。
    // 記日誌讓後續審計可以對帳。
    console.error(
      `[refundJobIfBilled] Refund failed for job=${jobId} user=${job.userId} points=${points}:`,
      err
    );
    return false;
  }

  try {
    await db.updateBackgroundJob(jobId, {
      resultJson: { ...meta, refunded: true, refundedPoints: points } as any,
    });
  } catch {
    // 旗標寫失敗時下一次呼叫會再退一次 — 比起完全不退,寧可有少數重複退款,
    // 至少使用者不會虧錢。
  }

  return true;
}

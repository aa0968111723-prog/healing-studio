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

export const MIN_PROMPT_LENGTH_FOR_LIBRARY = 4;
export const MAX_PROMPT_TITLE_LENGTH = 80;
export const MAX_MODEL_HINT_LENGTH = 128;
export const MAX_ASSET_DESCRIPTION_LENGTH = 500;
export const MAX_LOG_FIELD_LENGTH = 200;

export type PostGenModality = "image" | "video" | "audio" | "voice";

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
  /** 此次生成扣除的點數，預設 1 */
  costCredits?: number;
  /**
   * 對應的 backgroundJobs.id（若有）。寫入 digital_asset_library 與
   * generation_history.parameterSnapshot 讓「我的資產」反向查得到原始
   * 任務記錄（fal request_id、降級紀錄等）。Schema 欄位於 migration 0047
   * 新增；舊 schema 下會被 ORM 忽略。
   */
  backgroundJobId?: number;
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
  } = params;
  const promptText = (prompt ?? "").trim();

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

  // 1-2. 提示詞庫
  if (promptText.length >= MIN_PROMPT_LENGTH_FOR_LIBRARY) {
    try {
      const dbConn = await getDb();
      if (dbConn) {
        await dbConn.insert(promptLibrary).values({
          userId,
          title:
            promptText.slice(0, MAX_PROMPT_TITLE_LENGTH) ||
            `${label ?? modality}提示詞`,
          content: promptText,
          category: modality,
          tags: [],
          isPublic: false,
          modelHint: modelId.slice(0, MAX_MODEL_HINT_LENGTH),
          language: "zh",
        });
      }
    } catch {
      // 靜默忽略（重複等）
    }
  }

  // 1-3a. 數位資產庫 — 補上 0047 migration 新增的來源追蹤欄位
  // （sourceStudio / modelId / backgroundJobId），讓「我的資產」可依
  // 工作室與 AI 模型分類，並反向連回 backgroundJobs。
  if (resultUrl) {
    try {
      await db.createDigitalAsset({
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
        costCredits: costCredits ?? 1,
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

  await doPostGenComplete({
    userId: job.userId,
    modality: studioType as PostGenModality,
    modelId,
    prompt,
    resultUrl,
    label,
    sourceStudio,
    backgroundJobId: jobId,
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

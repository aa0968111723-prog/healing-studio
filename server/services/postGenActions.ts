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

export const MIN_PROMPT_LENGTH_FOR_LIBRARY = 4;
export const MAX_PROMPT_TITLE_LENGTH = 80;
export const MAX_MODEL_HINT_LENGTH = 128;
export const MAX_ASSET_DESCRIPTION_LENGTH = 500;
export const MAX_LOG_FIELD_LENGTH = 200;

export type PostGenModality = "image" | "video" | "audio" | "voice";

export interface PostGenParams {
  userId: number;
  modality: PostGenModality;
  modelId: string;
  prompt?: string;
  resultUrl?: string;
  label?: string;
  sourceStudio?: string;
}

/**
 * 同步寫入提示詞庫 + 資產庫 + 歷史 + 監控。
 * 各子任務皆吞錯，不影響主流程。
 */
export async function doPostGenComplete(params: PostGenParams): Promise<void> {
  const { userId, modality, modelId, prompt, resultUrl, label, sourceStudio } =
    params;
  const promptText = (prompt ?? "").trim();

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

  // 1-3a. 數位資產庫
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
      });
    } catch {
      // 靜默忽略
    }
  }

  // 1-3b. 生成歷史
  if (resultUrl) {
    try {
      await db.createHistoryEntry({
        userId,
        modality,
        prompt: promptText || undefined,
        compiledPrompt: promptText || undefined,
        // 記下 modelId / sourceStudio 讓 ImageStudio 等頁面能反向 map 回模型
        // 名稱、決定點選歷史項目要切到哪個 tab。
        parameterSnapshot: {
          modelId,
          sourceStudio: sourceStudio ?? "unknown",
          ...(label ? { label } : {}),
        },
        resultUrl,
        costCredits: 1,
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

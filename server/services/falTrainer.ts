/**
 * Fal.ai Training Service Module
 *
 * Orchestrates LoRA fine-tuning via Fal.ai API:
 *   1. Download training data → pack into ZIP
 *   2. Upload ZIP to S3
 *   3. Submit training job to Fal.ai queue（queue.submit → 真實 request_id）
 *   4. Poll until completion → write results back to DB
 *
 * AIDV-45：request_id 提交後立即回寫 fine_tuned_models（replicatePredictionId +
 * configJson.falRequestId），伺服器重啟後可由 checkAndSyncFalTraining（輪詢回寫）
 * 接手同步完成狀態，不再永遠卡在 training。
 *
 * Supports multiple training types:
 *   - image_subject / portrait_lora / style_lora / scene_lora → image-based
 *   - video_lora → video/image-based (Hunyuan, CogVideoX)
 */

import JSZip from "jszip";
import { assertSafeUrl } from "../lib/urlValidator";
import { createFalClient } from "@fal-ai/client";
import { storagePut } from "../storage.js";
import {
  updateFineTunedModel,
  updateBackgroundJob,
  findActiveModelTrainingJobByModelId,
} from "../db.js";
import { awaitFalQueueResult } from "./falQueueAwaiter.js";
import { FAL_QUEUE_BASE } from "../_core/providerFacade";
import type { TrainingModelType } from "../../shared/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FalTrainingJobInput {
  userId: number;
  modelId: number;
  jobId: number;
  modelName: string;
  modelType: TrainingModelType;
  triggerWord: string;
  steps: number;
  learningRate: number;
  isStyle?: boolean;
  imageUrls: string[];
  videoUrls?: string[];
  falModelId: string; // e.g. "fal-ai/flux-lora-fast-training"
}

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string): void {
  const prefix = "[FalTrainer]";
  const ts = new Date().toISOString();
  if (level === "info") console.info(`${prefix} ${ts} ✅ ${message}`);
  if (level === "warn") console.warn(`${prefix} ${ts} ⚠️ ${message}`);
  if (level === "error") console.error(`${prefix} ${ts} ❌ ${message}`);
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** In-process 輪詢上限（60 分鐘）；超過改由 checkAndSyncFalTraining 輪詢回寫。 */
const FAL_TRAINING_TIMEOUT_MS = 3_600_000;

/**
 * 舊版 runFalTrainingJob 寫入 configJson.falRequestId 的佔位字串。
 * 這些不是真實 fal request id，輪詢回寫必須跳過（AIDV-45 之後只會寫真實 ID）。
 */
const FAL_PLACEHOLDER_REQUEST_IDS = new Set([
  "pending",
  "completed",
  "completed-no-url",
]);

// ─── Fal.ai model routing ───────────────────────────────────────────────────

/** Resolve the best Fal.ai training model for a given training type */
export function resolveFalTrainingModel(modelType: TrainingModelType): string {
  switch (modelType) {
    case "portrait_lora":
      return "fal-ai/flux-lora-portrait-trainer";
    case "style_lora":
    case "scene_lora":
      return "fal-ai/flux-lora-fast-training";
    case "video_lora":
      return "fal-ai/hunyuan-video-lora-training";
    case "image_subject":
    default:
      return "fal-ai/flux-lora-fast-training";
  }
}

// ─── Build ZIP ──────────────────────────────────────────────────────────────

/**
 * Downloads each URL (image or video) and packs them into a ZIP buffer.
 *
 * Exported so that other training pipelines (Replicate LoRA) can reuse the
 * same ZIP packing logic without duplicating download/zip code.
 */
export async function buildZipBuffer(urls: string[]): Promise<Buffer> {
  log("info", `Building ZIP from ${urls.length} files...`);
  const zip = new JSZip();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const paddedIndex = String(i + 1).padStart(3, "0");

    let ext = ".jpg";
    try {
      const pathname = new URL(url).pathname;
      const urlExt = pathname.substring(pathname.lastIndexOf("."));
      if (
        urlExt &&
        [
          ".jpg",
          ".jpeg",
          ".png",
          ".webp",
          ".bmp",
          ".mp4",
          ".mov",
          ".avi",
          ".webm",
        ].includes(urlExt.toLowerCase())
      ) {
        ext = urlExt.toLowerCase();
      }
    } catch {
      // keep default
    }

    const fileName = `${paddedIndex}${ext}`;
    try {
      assertSafeUrl(url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const arrayBuffer = await response.arrayBuffer();
      zip.file(fileName, arrayBuffer);
      log(
        "info",
        `  ✓ ${fileName} (${Math.round(arrayBuffer.byteLength / 1024)} KB)`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", `  ✗ Failed to download ${url}: ${msg}`);
    }
  }

  const fileCount = Object.keys(zip.files).length;
  if (fileCount === 0) throw new Error("No files were successfully downloaded");

  log("info", `ZIP contains ${fileCount} files, generating buffer...`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  log("info", `ZIP buffer ready (${Math.round(buffer.length / 1024)} KB)`);
  return buffer;
}

// ─── Upload ZIP ─────────────────────────────────────────────────────────────

async function uploadZipToStorage(
  buffer: Buffer,
  userId: number,
  modelId: number
): Promise<string> {
  const key = `lora-datasets/${userId}/${modelId}-fal-${Date.now()}.zip`;
  log("info", `Uploading ZIP to S3: ${key}`);
  const { url } = await storagePut(key, buffer, "application/zip");
  log("info", `ZIP uploaded: ${url}`);
  return url;
}

/**
 * buildAndUploadZip — 與 runFalTrainingJob 共用的 ZIP 打包+上傳流程。
 * 提供給 Replicate / 其他訓練 provider 使用，避免重複程式。
 */
export async function buildAndUploadZip(
  urls: string[],
  userId: number,
  modelId: number,
  scope: "fal" | "replicate" = "fal"
): Promise<string> {
  const buffer = await buildZipBuffer(urls);
  const key = `lora-datasets/${userId}/${modelId}-${scope}-${Date.now()}.zip`;
  log("info", `Uploading ZIP to S3: ${key}`);
  const { url } = await storagePut(key, buffer, "application/zip");
  log("info", `ZIP uploaded: ${url}`);
  return url;
}

// ─── Fal.ai training input ──────────────────────────────────────────────────

/** 組出 fal LoRA 訓練模型的共用 input payload（submit / retry 共用）。 */
function buildFalTrainingInput(params: {
  falModelId: string;
  zipUrl: string;
  triggerWord: string;
  steps: number;
  learningRate: number;
  isStyle?: boolean;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    images_data_url: params.zipUrl,
    steps: params.steps,
    trigger_word: params.triggerWord || undefined,
    learning_rate: params.learningRate,
  };

  // For style training, indicate is_style
  if (params.isStyle) {
    input.is_style = true;
  }

  // For video-based models, enable auto-captioning
  if (
    params.falModelId.includes("video") ||
    params.falModelId.includes("hunyuan")
  ) {
    input.do_caption = true;
  }
  return input;
}

// ─── Submit Fal.ai Training ─────────────────────────────────────────────────

/**
 * AIDV-45：改走 queue.submit 拿「真實」request_id（舊版用 client.subscribe
 * 阻塞等完成，requestId 只寫 "pending"/"completed" 佔位字串 → 伺服器一重啟
 * 訓練就斷線、模型永遠卡 training）。呼叫端拿到 request_id 後應立即持久化，
 * 再用 awaitFalQueueResult / checkAndSyncFalTraining 輪詢回寫。
 */
async function submitFalTraining(params: {
  falModelId: string;
  zipUrl: string;
  triggerWord: string;
  steps: number;
  learningRate: number;
  isStyle?: boolean;
}): Promise<string> {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY 未設定");

  const client = createFalClient({ credentials: apiKey });

  log(
    "info",
    `Submitting Fal.ai training (queue.submit): model=${params.falModelId}, steps=${params.steps}, lr=${params.learningRate}, trigger="${params.triggerWord}"`
  );

  const input = buildFalTrainingInput(params);

  // 比照 falModels.ts dispatchFalQueueTask 的 cast 寫法：endpointId 泛型
  // 綁定 fal SDK 內建 endpoint 型別表，動態 model id 需顯式放寬。
  const queued = (await client.queue.submit(
    params.falModelId as Parameters<typeof client.queue.submit>[0],
    { input } as never
  )) as { request_id?: string; requestId?: string };

  const requestId = queued.request_id ?? queued.requestId;
  if (!requestId) {
    throw new Error(
      `fal.ai queue submit 未回傳 request_id [${params.falModelId}]`
    );
  }
  log("info", `Fal.ai training submitted: requestId=${requestId}`);
  return requestId;
}

// ─── Extract LoRA output URL ────────────────────────────────────────────────

/**
 * 從 fal LoRA 訓練結果萃取權重檔 URL。
 *
 * fal 各訓練模型輸出 shape 不同（flux-lora-fast-training 回
 * `diffusers_lora_file.url`；部分回 `lora_file` / `model_url` /
 * `lora_file_url` / `output`），且 queue result 可能包在 data/output/result
 * envelope 裡。優先序沿用原本 runFalTrainingJob 的萃取順序，
 * 抽成 pure function 供訓練協調器與輪詢回寫（checkAndSyncFalTraining）共用。
 */
export function extractFalLoraOutputUrl(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const root = result as Record<string, unknown>;
  const candidates = [root, root.data, root.output, root.result].filter(
    (v): v is Record<string, unknown> =>
      Boolean(v && typeof v === "object" && !Array.isArray(v))
  );
  for (const node of candidates) {
    const url =
      (node.diffusers_lora_file as { url?: string } | undefined)?.url ??
      (node.config_file as { url?: string } | undefined)?.url ??
      (typeof node.model_url === "string" ? node.model_url : null) ??
      (typeof node.lora_file_url === "string" ? node.lora_file_url : null) ??
      (node.lora_file as { url?: string } | undefined)?.url ??
      (typeof node.output === "string" ? node.output : null) ??
      (Array.isArray(node.output) &&
      typeof (node.output as unknown[])[0] === "string"
        ? (node.output as string[])[0]
        : null);
    if (typeof url === "string" && url.length > 0) return url;
  }
  return null;
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Main entry point — runs the full Fal.ai training pipeline in the background.
 * All errors are caught and written to DB; this function never throws.
 */
export async function runFalTrainingJob(
  input: FalTrainingJobInput
): Promise<void> {
  const {
    userId,
    modelId,
    jobId,
    modelName,
    modelType,
    triggerWord,
    steps,
    learningRate,
    isStyle,
    imageUrls,
    videoUrls,
    falModelId,
  } = input;
  log("info", `═══ Starting Fal.ai training job ═══`);
  log(
    "info",
    `  modelId=${modelId}, jobId=${jobId}, name="${modelName}", type=${modelType}, images=${imageUrls.length}, videos=${videoUrls?.length ?? 0}`
  );

  try {
    // ── Step 1: Mark as training ──
    await updateFineTunedModel(modelId, { status: "training" });
    await updateBackgroundJob(jobId, {
      status: "processing",
      progress: 5,
      progressMessage: "準備訓練資料...",
    });

    // ── Step 2: Combine all media and build ZIP ──
    const allUrls = [...imageUrls, ...(videoUrls || [])];
    log("info", "[步驟 2] Building ZIP buffer...");
    const zipBuffer = await buildZipBuffer(allUrls);
    await updateBackgroundJob(jobId, {
      progress: 15,
      progressMessage: "正在打包訓練資料...",
    });

    // ── Step 3: Upload to S3 ──
    log("info", "[步驟 3] Uploading ZIP to S3...");
    const zipUrl = await uploadZipToStorage(zipBuffer, userId, modelId);
    await updateBackgroundJob(jobId, {
      progress: 25,
      progressMessage: "資料集已上傳，正在提交 Fal.ai 訓練任務...",
    });

    // ── Step 4: Submit to Fal.ai queue（拿真實 request_id）──
    log("info", `[步驟 4] Submitting to Fal.ai queue: ${falModelId}...`);
    const requestId = await submitFalTraining({
      falModelId,
      zipUrl,
      triggerWord,
      steps,
      learningRate,
      isStyle,
    });

    // ── Step 4.5: 真實 request_id 立即回寫 fine_tuned_models（欄位對映）──
    //  - replicatePredictionId ← fal request id（schema 註解本就定義此欄
    //    「Replicate prediction ID 或 Fal.ai request ID」，fal 路徑過去從未寫入）
    //  - configJson.falRequestId ← 真實 ID（不再是 "pending" 佔位字串）
    // 沒這步，伺服器重啟後訓練協調器消失 → 模型永遠卡 training 且無從輪詢。
    await updateFineTunedModel(modelId, {
      replicatePredictionId: requestId,
      configJson: {
        falModelId,
        falRequestId: requestId,
        triggerWord,
        steps,
        learningRate,
        isStyle,
        zipUrl,
        submittedAt: Date.now(),
      },
    });
    await updateBackgroundJob(jobId, {
      progress: 30,
      progressMessage: "訓練任務已提交至 Fal.ai，訓練中...",
      resultJson: {
        modelId,
        modelName,
        engine: "fal",
        falModelId,
        falRequestId: requestId,
      },
    });

    // ── Step 5: 輪詢 fal queue 到終態（重用 awaitFalQueueResult 的
    //    指數退避 + 暫態錯誤容錯），同時每 30 秒回寫耗時進度 ──
    const trainingStartTime = Date.now();
    const progressInterval = setInterval(async () => {
      try {
        const elapsedMin = Math.round(
          (Date.now() - trainingStartTime) / 60_000
        );
        await updateBackgroundJob(jobId, {
          progress: 50,
          progressMessage: `Fal.ai 訓練進行中...（已耗時 ${elapsedMin} 分鐘）`,
        });
      } catch {
        /* ignore */
      }
    }, 30_000);

    let awaited: Awaited<ReturnType<typeof awaitFalQueueResult>>;
    try {
      awaited = await awaitFalQueueResult(requestId, falModelId, {
        timeoutMs: FAL_TRAINING_TIMEOUT_MS,
        initialIntervalMs: 10_000,
        maxIntervalMs: 30_000,
      });
    } finally {
      clearInterval(progressInterval);
    }

    if (awaited.status === "pending") {
      // 超時不再誤標 failed：request_id 已持久化，之後由
      // checkAndSyncFalTraining（trainingDetail / syncReplicateStatus 觸發）
      // 輪詢回寫完成結果。
      log(
        "warn",
        `模型 ${modelId} 訓練超過 ${Math.round(FAL_TRAINING_TIMEOUT_MS / 60_000)} 分鐘仍未完成 — 保持 training，改由輪詢回寫接手（requestId=${requestId}）`
      );
      await updateBackgroundJob(jobId, {
        progress: 60,
        progressMessage:
          "Fal.ai 訓練耗時較長，仍在進行中 — 開啟訓練詳情頁將自動同步最新狀態",
      });
      return;
    }

    if (awaited.status === "failed") {
      throw new Error(awaited.error || "Fal.ai 訓練失敗");
    }

    // ── Step 6: Extract output & write back ──
    const result = (awaited.raw ?? {}) as Record<string, unknown>;
    const outputUrl = extractFalLoraOutputUrl(result);

    if (outputUrl) {
      await updateFineTunedModel(modelId, {
        status: "ready",
        trainedLoraUrl: outputUrl,
        fileUrl: outputUrl,
        configJson: {
          falModelId,
          falRequestId: requestId,
          triggerWord,
          steps,
          learningRate,
          isStyle,
          zipUrl,
          completedAt: Date.now(),
        },
      });
      await updateBackgroundJob(jobId, {
        status: "completed",
        progress: 100,
        progressMessage: "訓練完成！模型已就緒。",
        resultJson: {
          modelId,
          modelName,
          engine: "fal",
          falModelId,
          falRequestId: requestId,
          outputUrl,
        },
      });
      log("info", `模型 ${modelId} Fal.ai 訓練完成！輸出：${outputUrl}`);
    } else {
      // COMPLETED 但萃取不到 LoRA 權重 URL — 絕不可標 ready：ready 是終態
      // （之後 checkAndSyncFalTraining / syncReplicateStatus 都不再理它），
      // trainedLoraUrl 為 null 的 ready 模型「看似就緒卻永遠不可引用、
      // 不可重訓」。改標 failed，讓 UI 的重新訓練入口（status==="failed"
      // 才顯示）可用；raw 輸出 keys 留在 configJson 供除錯。
      const noUrlMsg =
        "fal 訓練完成但無法解析 LoRA 權重輸出檔，請重新訓練";
      log(
        "error",
        `模型 ${modelId} ${noUrlMsg}。結果：${JSON.stringify(result).slice(0, 500)}`
      );
      await updateFineTunedModel(modelId, {
        status: "failed",
        configJson: {
          falModelId,
          falRequestId: requestId,
          triggerWord,
          steps,
          learningRate,
          isStyle,
          zipUrl,
          completedAt: Date.now(),
          rawOutputKeys: Object.keys(result),
        },
      });
      await updateBackgroundJob(jobId, {
        status: "failed",
        errorMessage: noUrlMsg,
        progressMessage: "訓練失敗（無輸出權重）",
        resultJson: {
          modelId,
          modelName,
          engine: "fal",
          falModelId,
          falRequestId: requestId,
          rawOutput: result,
        },
      });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log("error", `Fal.ai 訓練流程異常：${errMsg}`);

    await updateFineTunedModel(modelId, { status: "failed" }).catch(() => {});
    await updateBackgroundJob(jobId, {
      status: "failed",
      errorMessage: errMsg,
      progressMessage: "訓練失敗",
    }).catch(() => {});
  }
}

// ─── 輪詢回寫（AIDV-45）─────────────────────────────────────────────────────

/** checkAndSyncFalTraining 需要的最小模型欄位（fineTunedModels row 子集）。 */
export interface FalTrainingSyncModel {
  id: number;
  status: string;
  trainingEngine?: string | null;
  replicatePredictionId?: string | null;
  configJson?: Record<string, unknown> | null;
}

export interface FalTrainingSyncResult {
  requestId: string;
  /** fal queue 狀態（IN_QUEUE / IN_PROGRESS / COMPLETED / FAILED / HTTP_xxx / UNREACHABLE）。 */
  queueStatus: string;
  /** 本次呼叫是否已把終態回寫 fine_tuned_models。 */
  synced: boolean;
  /** synced=true 時模型被寫成的狀態。 */
  modelStatus?: "ready" | "failed";
  outputUrl?: string | null;
  error?: string;
}

// ── 節流＋並發去重（per-model）────────────────────────────────────────────
// trainingDetail 是 15 秒輪詢的 query、syncReplicateStatus 是使用者手動觸發、
// worker 每 5 分鐘掃一次 — 多分頁 / window-focus refetch / 多裝置同看同一
// 模型時，這些入口會線性放大對 fal 的出站呼叫與 DB 回寫。以 module-level
// gate 保證：同一模型 15 秒內最多打一次 fal；並發呼叫共用同一個 in-flight
// Promise（去重，也避免兩個 COMPLETED 同步重複回寫）。

const FAL_SYNC_MIN_INTERVAL_MS = 15_000;

interface FalSyncGate {
  /** 上次完成同步的時間（ms epoch）。 */
  at: number;
  /** 上次同步的結果（節流窗內直接回傳這個快取）。 */
  last: FalTrainingSyncResult | null;
  /** 進行中的同步 Promise（並發呼叫共用）。 */
  inflight?: Promise<FalTrainingSyncResult | null>;
}

const falSyncGates = new Map<number, FalSyncGate>();

/** 測試用：清空節流狀態（module-level Map 會跨測試殘留）。 */
export function __resetFalSyncGatesForTest(): void {
  falSyncGates.clear();
}

/**
 * 對「還在 training / pending」的 fal LoRA 模型做一次 fal queue 狀態查詢，
 * 若已到終態就把結果回寫 fine_tuned_models（status / trainedLoraUrl / fileUrl /
 * configJson.completedAt）並收尾對應的 model_training backgroundJob。
 *
 * 這是 AIDV-45 的核心缺口修補：runFalTrainingJob 的輪詢是 in-process 的，
 * 伺服器重啟（Railway 部署）後協調器消失；只要 request_id 已持久化，
 * 前端輪 trainingDetail 或按「同步訓練狀態」都會經過這裡把結果補回來，
 * 保證「上傳→排隊→完成→可引用」端到端閉環。
 *
 * 回傳 null＝此模型不適用（非 fal 引擎、已是終態、無真實 request_id、
 * 或 FAL_API_KEY 未設定）。絕不 throw；查詢失敗以 queueStatus 表達。
 * 同一模型 15 秒內重複呼叫會回傳快取結果、不再打 fal。
 */
export async function checkAndSyncFalTraining(
  model: FalTrainingSyncModel,
  opts: { fetchFn?: typeof fetch } = {}
): Promise<FalTrainingSyncResult | null> {
  const config = (model.configJson ?? {}) as Record<string, unknown>;
  // 引擎判定：trainingEngine="fal"，或 legacy 行（models.create 過去漏寫
  // trainingEngine，但 fal 路徑一定有 configJson.falModelId）。
  const isFal = model.trainingEngine === "fal" || !!config.falModelId;
  if (!isFal) return null;
  if (model.status !== "training" && model.status !== "pending") return null;

  const rawId =
    model.replicatePredictionId ||
    (typeof config.falRequestId === "string" ? config.falRequestId : null);
  if (!rawId || FAL_PLACEHOLDER_REQUEST_IDS.has(rawId)) return null;

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return null;

  const falModelId =
    (typeof config.falModelId === "string" && config.falModelId) ||
    "fal-ai/flux-lora-fast-training";
  const fetchFn = opts.fetchFn ?? fetch;

  // ── 節流守門 ──
  const existingGate = falSyncGates.get(model.id);
  if (existingGate?.inflight) return existingGate.inflight;
  if (
    existingGate &&
    Date.now() - existingGate.at < FAL_SYNC_MIN_INTERVAL_MS
  ) {
    return existingGate.last;
  }

  const gate: FalSyncGate = {
    at: Date.now(),
    last: existingGate?.last ?? null,
  };
  const inflight = syncFalTrainingOnce(model.id, rawId, falModelId, apiKey, fetchFn)
    .catch(
      (err): FalTrainingSyncResult => ({
        // syncFalTrainingOnce 各分支都自行 catch，這裡是防禦性兜底，
        // 維持「絕不 throw」契約。
        requestId: rawId,
        queueStatus: "UNREACHABLE",
        synced: false,
        error: err instanceof Error ? err.message : String(err),
      })
    )
    .then(result => {
      gate.at = Date.now();
      gate.last = result;
      gate.inflight = undefined;
      // 已同步到終態 → 模型之後的呼叫會在 status 守門直接回 null，
      // gate 條目不再需要，順手清掉避免 Map 無限增長。
      if (result?.synced) falSyncGates.delete(model.id);
      return result;
    });
  gate.inflight = inflight;
  falSyncGates.set(model.id, gate);
  return inflight;
}

/** 單次 fal queue 查詢＋終態回寫（不含節流；由 checkAndSyncFalTraining 包裝）。 */
async function syncFalTrainingOnce(
  modelId: number,
  rawId: string,
  falModelId: string,
  apiKey: string,
  fetchFn: typeof fetch
): Promise<FalTrainingSyncResult> {
  const headers = { Authorization: `Key ${apiKey}` };
  const statusUrl = `${FAL_QUEUE_BASE}/${falModelId}/requests/${rawId}/status`;
  const resultUrl = `${FAL_QUEUE_BASE}/${falModelId}/requests/${rawId}`;

  let queueStatus = "UNKNOWN";
  let queueError: string | undefined;
  try {
    const res = await fetchFn(statusUrl, { headers });
    if (!res.ok) {
      return {
        requestId: rawId,
        queueStatus: `HTTP_${res.status}`,
        synced: false,
      };
    }
    const payload = (await res.json()) as { status?: string; error?: string };
    queueStatus = String(payload.status ?? "UNKNOWN").toUpperCase();
    queueError = payload.error;
  } catch (err) {
    return {
      requestId: rawId,
      queueStatus: "UNREACHABLE",
      synced: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (queueStatus === "COMPLETED") {
    try {
      const res = await fetchFn(resultUrl, { headers });
      if (!res.ok) {
        return {
          requestId: rawId,
          queueStatus,
          synced: false,
          error: `fal result HTTP ${res.status}`,
        };
      }
      const raw = (await res.json()) as unknown;
      const outputUrl = extractFalLoraOutputUrl(raw);

      if (!outputUrl) {
        // COMPLETED 但萃取不到權重 URL — 與 runFalTrainingJob 同步改標
        // failed（ready 是終態且不可逆，null trainedLoraUrl 的 ready 模型
        // 永遠不可引用也不可重訓）。raw 輸出 keys 記進 configJson 供除錯。
        const noUrlMsg =
          "fal 訓練完成但無法解析 LoRA 權重輸出檔，請重新訓練";
        await updateFineTunedModel(modelId, {
          status: "failed",
          configJson: {
            falRequestId: rawId,
            completedAt: Date.now(),
            rawOutputKeys:
              raw && typeof raw === "object"
                ? Object.keys(raw as Record<string, unknown>)
                : [typeof raw],
          },
        });
        await finalizeTrainingJob(modelId, {
          status: "failed",
          progressMessage: "訓練失敗（無輸出權重）",
          errorMessage: noUrlMsg,
          extraResult: { falRequestId: rawId, rawOutput: raw },
        });
        log(
          "warn",
          `模型 ${modelId} fal COMPLETED 但無輸出 URL — 標記 failed（requestId=${rawId}）`
        );
        return {
          requestId: rawId,
          queueStatus,
          synced: true,
          modelStatus: "failed",
          outputUrl: null,
          error: noUrlMsg,
        };
      }

      await updateFineTunedModel(modelId, {
        status: "ready",
        trainedLoraUrl: outputUrl,
        fileUrl: outputUrl,
        configJson: { falRequestId: rawId, completedAt: Date.now() },
      });
      await finalizeTrainingJob(modelId, {
        status: "completed",
        progress: 100,
        progressMessage: "訓練完成！模型已就緒。",
        extraResult: { falRequestId: rawId, outputUrl },
      });
      log(
        "info",
        `模型 ${modelId} 由輪詢回寫同步完成（requestId=${rawId}, output=${outputUrl}）`
      );
      return {
        requestId: rawId,
        queueStatus,
        synced: true,
        modelStatus: "ready",
        outputUrl,
      };
    } catch (err) {
      return {
        requestId: rawId,
        queueStatus,
        synced: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (queueStatus === "FAILED" || queueStatus === "CANCELLED") {
    const errMsg = queueError || `fal job ${queueStatus}`;
    await updateFineTunedModel(modelId, { status: "failed" }).catch(() => {});
    await finalizeTrainingJob(modelId, {
      status: "failed",
      progressMessage: "訓練失敗",
      errorMessage: errMsg,
    });
    log(
      "warn",
      `模型 ${modelId} 由輪詢回寫同步為失敗（requestId=${rawId}）：${errMsg}`
    );
    return {
      requestId: rawId,
      queueStatus,
      synced: true,
      modelStatus: "failed",
      error: errMsg,
    };
  }

  // IN_QUEUE / IN_PROGRESS / 其他非終態 → 不寫庫，回報現況給 UI。
  return { requestId: rawId, queueStatus, synced: false, error: queueError };
}

/** 輪詢回寫同步終態時，順帶收尾仍掛著的 model_training backgroundJob（best-effort）。 */
async function finalizeTrainingJob(
  modelId: number,
  update: {
    status: "completed" | "failed";
    progress?: number;
    progressMessage: string;
    errorMessage?: string;
    extraResult?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const job = await findActiveModelTrainingJobByModelId(modelId);
    if (!job) return;
    const existing = (job.resultJson ?? {}) as Record<string, unknown>;
    await updateBackgroundJob(job.id, {
      status: update.status,
      ...(update.progress !== undefined ? { progress: update.progress } : {}),
      progressMessage: update.progressMessage,
      ...(update.errorMessage ? { errorMessage: update.errorMessage } : {}),
      resultJson: { ...existing, ...(update.extraResult ?? {}) } as never,
    });
  } catch (err) {
    log(
      "warn",
      `finalizeTrainingJob(model=${modelId}) 收尾 backgroundJob 失敗：${err instanceof Error ? err.message : String(err)}`
    );
  }
}

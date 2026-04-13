/**
 * Fal.ai Training Service Module
 *
 * Orchestrates LoRA fine-tuning via Fal.ai API:
 *   1. Download training data → pack into ZIP
 *   2. Upload ZIP to S3
 *   3. Submit training job to Fal.ai (via @fal-ai/client)
 *   4. Poll until completion → write results back to DB
 *
 * Supports multiple training types:
 *   - image_subject / portrait_lora / style_lora / scene_lora → image-based
 *   - video_lora → video/image-based (Hunyuan, CogVideoX)
 */

import JSZip from "jszip";
import { createFalClient } from "@fal-ai/client";
import { storagePut } from "../storage.js";
import {
  updateFineTunedModel,
  updateBackgroundJob,
} from "../db.js";
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
  falModelId: string;   // e.g. "fal-ai/flux-lora-fast-training"
}

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string): void {
  const prefix = "[FalTrainer]";
  const ts = new Date().toISOString();
  if (level === "info") console.info(`${prefix} ${ts} ✅ ${message}`);
  if (level === "warn") console.warn(`${prefix} ${ts} ⚠️ ${message}`);
  if (level === "error") console.error(`${prefix} ${ts} ❌ ${message}`);
}

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
 */
async function buildZipBuffer(urls: string[]): Promise<Buffer> {
  log("info", `Building ZIP from ${urls.length} files...`);
  const zip = new JSZip();

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const paddedIndex = String(i + 1).padStart(3, "0");

    let ext = ".jpg";
    try {
      const pathname = new URL(url).pathname;
      const urlExt = pathname.substring(pathname.lastIndexOf("."));
      if (urlExt && [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".mp4", ".mov", ".avi", ".webm"].includes(urlExt.toLowerCase())) {
        ext = urlExt.toLowerCase();
      }
    } catch {
      // keep default
    }

    const fileName = `${paddedIndex}${ext}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const arrayBuffer = await response.arrayBuffer();
      zip.file(fileName, arrayBuffer);
      log("info", `  ✓ ${fileName} (${Math.round(arrayBuffer.byteLength / 1024)} KB)`);
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

async function uploadZipToStorage(buffer: Buffer, userId: number, modelId: number): Promise<string> {
  const key = `lora-datasets/${userId}/${modelId}-fal-${Date.now()}.zip`;
  log("info", `Uploading ZIP to S3: ${key}`);
  const { url } = await storagePut(key, buffer, "application/zip");
  log("info", `ZIP uploaded: ${url}`);
  return url;
}

// ─── Submit Fal.ai Training ─────────────────────────────────────────────────

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

  log("info", `Submitting Fal.ai training: model=${params.falModelId}, steps=${params.steps}, lr=${params.learningRate}, trigger="${params.triggerWord}"`);

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
  if (params.falModelId.includes("video") || params.falModelId.includes("hunyuan")) {
    input.do_caption = true;
  }

  const result = await client.subscribe(params.falModelId, {
    input,
    logs: false,
  }) as { data?: Record<string, unknown>; requestId?: string };

  // Extract the request/prediction ID
  const requestId = result.requestId || "fal-" + Date.now();
  log("info", `Fal.ai training submitted: requestId=${requestId}`);
  return requestId;
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

/**
 * Main entry point — runs the full Fal.ai training pipeline in the background.
 * All errors are caught and written to DB; this function never throws.
 */
export async function runFalTrainingJob(input: FalTrainingJobInput): Promise<void> {
  const { userId, modelId, jobId, modelName, modelType, triggerWord, steps, learningRate, isStyle, imageUrls, videoUrls, falModelId } = input;
  log("info", `═══ Starting Fal.ai training job ═══`);
  log("info", `  modelId=${modelId}, jobId=${jobId}, name="${modelName}", type=${modelType}, images=${imageUrls.length}, videos=${videoUrls?.length ?? 0}`);

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

    // ── Step 4: Submit to Fal.ai ──
    log("info", `[步驟 4] Submitting to Fal.ai: ${falModelId}...`);

    // Fal.ai subscribe blocks until completion (long-polling style)
    // So we update progress before the call and check result after
    await updateBackgroundJob(jobId, {
      progress: 30,
      progressMessage: "訓練任務已提交至 Fal.ai，訓練中...",
      resultJson: { modelId, modelName, engine: "fal", falModelId },
    });

    await updateFineTunedModel(modelId, {
      configJson: {
        falModelId,
        falRequestId: "pending",
        triggerWord,
        steps,
        learningRate,
        isStyle,
        zipUrl,
        submittedAt: Date.now(),
      },
    });

    // Fal.ai client.subscribe waits for completion (includes internal polling)
    const apiKey = process.env.FAL_API_KEY;
    if (!apiKey) throw new Error("FAL_API_KEY 未設定");

    const client = createFalClient({ credentials: apiKey });

    const falInput: Record<string, unknown> = {
      images_data_url: zipUrl,
      steps,
      trigger_word: triggerWord || undefined,
      learning_rate: learningRate,
    };
    if (isStyle) falInput.is_style = true;
    if (falModelId.includes("video") || falModelId.includes("hunyuan")) {
      falInput.do_caption = true;
    }

    // Update progress periodically in background
    const trainingStartTime = Date.now();
    const progressInterval = setInterval(async () => {
      try {
        const elapsedMin = Math.round((Date.now() - trainingStartTime) / 60_000);
        await updateBackgroundJob(jobId, {
          progress: Math.min(85, 30 + Math.floor(Math.random() * 40)),
          progressMessage: `Fal.ai 訓練進行中...（已耗時 ${elapsedMin} 分鐘）`,
        });
      } catch { /* ignore */ }
    }, 30_000);

    let result: Record<string, unknown>;
    try {
      const response = await Promise.race([
        client.subscribe(falModelId, { input: falInput, logs: false }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Fal.ai 訓練超時（60 分鐘）")), 3_600_000)
        ),
      ]);
      result = (response as { data?: Record<string, unknown> }).data ?? (response as Record<string, unknown>) ?? {};
    } finally {
      clearInterval(progressInterval);
    }

    // ── Step 5: Extract output ──
    // Fal.ai training returns different output structures depending on the model
    const outputUrl =
      (result.diffusers_lora_file as { url?: string })?.url ??
      (result.config_file as { url?: string })?.url ??
      (typeof result.model_url === "string" ? result.model_url : null) ??
      (typeof result.lora_file_url === "string" ? result.lora_file_url : null) ??
      (typeof result.output === "string" ? result.output : null) ??
      (Array.isArray(result.output) ? (result.output as string[])[0] : null);

    if (outputUrl) {
      await updateFineTunedModel(modelId, {
        status: "ready",
        trainedLoraUrl: typeof outputUrl === "string" ? outputUrl : undefined,
        fileUrl: typeof outputUrl === "string" ? outputUrl : undefined,
        configJson: {
          falModelId,
          falRequestId: "completed",
          triggerWord,
          steps,
          learningRate,
          isStyle,
          zipUrl,
          submittedAt: Date.now(),
          completedAt: Date.now(),
        },
      });
      await updateBackgroundJob(jobId, {
        status: "completed",
        progress: 100,
        progressMessage: "訓練完成！模型已就緒。",
        resultJson: { modelId, modelName, engine: "fal", falModelId, outputUrl },
      });
      log("info", `模型 ${modelId} Fal.ai 訓練完成！輸出：${outputUrl}`);
    } else {
      // No output URL found — treat as completed but warn
      log("warn", `模型 ${modelId} Fal.ai 訓練完成但未找到輸出 URL。結果：${JSON.stringify(result).slice(0, 500)}`);
      await updateFineTunedModel(modelId, {
        status: "ready",
        configJson: {
          falModelId,
          falRequestId: "completed-no-url",
          triggerWord,
          steps,
          learningRate,
          isStyle,
          zipUrl,
          submittedAt: Date.now(),
          completedAt: Date.now(),
        },
      });
      await updateBackgroundJob(jobId, {
        status: "completed",
        progress: 100,
        progressMessage: "訓練完成（輸出待確認）",
        resultJson: { modelId, modelName, engine: "fal", falModelId, rawOutput: result },
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

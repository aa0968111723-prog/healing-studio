/**
 * LoRA Training Service Module
 *
 * Orchestrates the full LoRA fine-tuning pipeline:
 *   1. Download training images → pack into ZIP
 *   2. Upload ZIP to S3
 *   3. Submit training job to Replicate (via SDK)
 *   4. Poll until completion → write results back to DB
 */

import JSZip from "jszip";
import Replicate from "replicate";
import { storagePut } from "../storage.js";
import {
  updateFineTunedModel,
  updateBackgroundJob,
} from "../db.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LoraTrainingJobInput {
  userId: number;
  modelId: number;
  jobId: number;
  modelName: string;
  triggerWord: string;
  epochs: number;
  learningRate: number;
  imageUrls: string[];  // 已上傳至 S3 的圖片 URL 陣列
}

// ─── Logger ─────────────────────────────────────────────────────────────────

function log(level: "info" | "warn" | "error", message: string): void {
  const prefix = "[LoraTrainer]";
  const ts = new Date().toISOString();
  if (level === "info") console.info(`${prefix} ${ts} ✅ ${message}`);
  if (level === "warn") console.warn(`${prefix} ${ts} ⚠️ ${message}`);
  if (level === "error") console.error(`${prefix} ${ts} ❌ ${message}`);
}

// ─── B-3: buildZipBuffer ────────────────────────────────────────────────────

/**
 * Downloads each image URL and packs them into a ZIP buffer.
 * File names: 001.jpg, 002.jpg, ... (extension parsed from URL)
 */
async function buildZipBuffer(imageUrls: string[]): Promise<Buffer> {
  log("info", `Building ZIP from ${imageUrls.length} images...`);
  const zip = new JSZip();

  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const paddedIndex = String(i + 1).padStart(3, "0");

    // Parse extension from URL, default to .jpg
    let ext = ".jpg";
    try {
      const pathname = new URL(url).pathname;
      const urlExt = pathname.substring(pathname.lastIndexOf("."));
      if (urlExt && [".jpg", ".jpeg", ".png", ".webp", ".bmp"].includes(urlExt.toLowerCase())) {
        ext = urlExt.toLowerCase();
      }
    } catch {
      // keep default .jpg
    }

    const fileName = `${paddedIndex}${ext}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      zip.file(fileName, arrayBuffer);
      log("info", `  ✓ ${fileName} (${Math.round(arrayBuffer.byteLength / 1024)} KB)`);
    } catch (err: any) {
      log("warn", `  ✗ Failed to download ${url}: ${err.message}`);
      // Skip failed images but continue with the rest
    }
  }

  const fileCount = Object.keys(zip.files).length;
  if (fileCount === 0) {
    throw new Error("No images were successfully downloaded");
  }

  log("info", `ZIP contains ${fileCount} files, generating buffer...`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  log("info", `ZIP buffer ready (${Math.round(buffer.length / 1024)} KB)`);
  return buffer;
}

// ─── B-4: uploadZipToStorage ────────────────────────────────────────────────

/**
 * Uploads the ZIP buffer to S3 via storagePut.
 * Key format: lora-datasets/{userId}/{modelId}-{timestamp}.zip
 */
async function uploadZipToStorage(
  buffer: Buffer,
  userId: number,
  modelId: number
): Promise<string> {
  const key = `lora-datasets/${userId}/${modelId}-${Date.now()}.zip`;
  log("info", `Uploading ZIP to S3: ${key}`);
  const { url } = await storagePut(key, buffer, "application/zip");
  log("info", `ZIP uploaded: ${url}`);
  return url;
}

// ─── B-5: submitReplicateTraining ───────────────────────────────────────────

/**
 * Creates a Replicate prediction for LoRA training using the SDK.
 * Uses ostris/flux-dev-lora-trainer as the training model.
 * Returns the prediction ID for polling.
 */
async function submitReplicateTraining(params: {
  zipUrl: string;
  triggerWord: string;
  epochs: number;
  learningRate: number;
}): Promise<string> {
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });
  const steps = Math.min(Math.max(params.epochs * 30, 200), 2000);

  log("info", `Submitting Replicate training: model=ostris/flux-dev-lora-trainer, steps=${steps}, lr=${params.learningRate}, trigger="${params.triggerWord}"`);

  const prediction = await replicate.predictions.create({
    model: "ostris/flux-dev-lora-trainer",
    input: {
      input_images: params.zipUrl,
      steps: steps,
      learning_rate: params.learningRate,
      ...(params.triggerWord ? { caption_prefix: params.triggerWord } : {}),
    },
  });

  const predictionId = prediction.id;
  log("info", `Replicate prediction created: ${predictionId}`);
  return predictionId;
}

// ─── B-6: runLoraTrainingJob (main orchestrator) ────────────────────────────

/**
 * Main entry point — runs the full LoRA training pipeline in the background.
 * All errors are caught and written to DB; this function never throws.
 */
export async function runLoraTrainingJob(input: LoraTrainingJobInput): Promise<void> {
  const { userId, modelId, jobId, modelName, triggerWord, epochs, learningRate, imageUrls } = input;
  log("info", `═══ Starting LoRA training job ═══`);
  log("info", `  modelId=${modelId}, jobId=${jobId}, name="${modelName}", images=${imageUrls.length}`);

  try {
    // ── 步驟 1：啟動狀態 ──
    await updateFineTunedModel(modelId, { status: "training" });
    await updateBackgroundJob(jobId, {
      status: "processing",
      progress: 5,
      progressMessage: "準備訓練資料...",
    });

    // ── 步驟 2：ZIP 打包 ──
    log("info", "[步驟 2] Building ZIP buffer...");
    const zipBuffer = await buildZipBuffer(imageUrls);
    await updateBackgroundJob(jobId, {
      progress: 15,
      progressMessage: "正在打包訓練圖片...",
    });

    // ── 步驟 3：S3 上傳 ──
    log("info", "[步驟 3] Uploading ZIP to S3...");
    const zipUrl = await uploadZipToStorage(zipBuffer, userId, modelId);
    await updateBackgroundJob(jobId, {
      progress: 25,
      progressMessage: "圖片集已上傳，正在提交訓練任務...",
    });

    // ── 步驟 4：提交 Replicate ──
    log("info", "[步驟 4] Submitting to Replicate...");
    const predictionId = await submitReplicateTraining({
      zipUrl,
      triggerWord,
      epochs,
      learningRate,
    });

    // 儲存 predictionId 至 resultJson
    await updateBackgroundJob(jobId, {
      progress: 30,
      progressMessage: "訓練任務已提交，等待 GPU 分配...",
      resultJson: { modelId, modelName, predictionId },
    });

    // 同時存入 model 的 configJson
    await updateFineTunedModel(modelId, {
      configJson: {
        predictionId,
        triggerWord,
        epochs,
        learningRate,
        zipUrl,
        submittedAt: Date.now(),
      },
    });

    // ── 步驟 5：輪詢迴圈 ──
    const MAX_POLL_MS = 3_600_000;   // 60 minutes
    const POLL_INTERVAL_MS = 30_000; // 30 seconds
    const pollStart = Date.now();
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

    log("info", `[步驟 5] Starting polling loop (interval=${POLL_INTERVAL_MS / 1000}s, max=${MAX_POLL_MS / 1000}s)...`);

    while (Date.now() - pollStart < MAX_POLL_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      let prediction: any;
      try {
        prediction = await replicate.predictions.get(predictionId);
      } catch (pollErr: any) {
        log("warn", `Poll request failed: ${pollErr.message}, will retry...`);
        continue;
      }

      const elapsedMs = Date.now() - pollStart;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const elapsedSec = Math.floor(elapsedMs / 1000) % 60;

      if (prediction.status === "succeeded") {
        // 提取輸出 URL
        const outputUrl = typeof prediction.output === "string"
          ? prediction.output
          : Array.isArray(prediction.output)
            ? prediction.output[0]
            : null;

        await updateFineTunedModel(modelId, {
          status: "ready",
          fileUrl: outputUrl || undefined,
        });
        await updateBackgroundJob(jobId, {
          status: "completed",
          progress: 100,
          progressMessage: "訓練完成！模型已就緒。",
          resultJson: { modelId, modelName, predictionId, outputUrl },
        });
        log("info", `模型 ${modelId} 訓練完成！輸出：${outputUrl}`);
        return;
      }

      if (prediction.status === "failed" || prediction.status === "canceled") {
        const errorMsg = prediction.error || `Replicate 任務 ${prediction.status}`;
        await updateFineTunedModel(modelId, { status: "failed" });
        await updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage: typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg),
          progress: 0,
          progressMessage: "訓練失敗",
        });
        log("error", `模型 ${modelId} 訓練失敗：${errorMsg}`);
        return;
      }

      // 仍在處理中：線性估算進度（30%~90%）
      const progressEstimate = Math.min(30 + Math.floor((elapsedMs / MAX_POLL_MS) * 60), 90);
      await updateBackgroundJob(jobId, {
        progress: progressEstimate,
        progressMessage: `訓練中... (${elapsedMin}m ${elapsedSec}s)`,
      });
      log("info", `模型 ${modelId} 輪詢中 [${prediction.status}] ${elapsedMin}m ${elapsedSec}s`);
    }

    // ── 超時處理 ──
    await updateFineTunedModel(modelId, { status: "failed" });
    await updateBackgroundJob(jobId, {
      status: "failed",
      errorMessage: "訓練超時（超過 1 小時）",
      progressMessage: "訓練超時",
    });
    log("error", `模型 ${modelId} 訓練超時（超過 1 小時）`);

  } catch (err) {
    // ── Global catch: any unhandled error ──
    const errMsg = err instanceof Error ? err.message : String(err);
    log("error", `訓練流程異常：${errMsg}`);

    await updateFineTunedModel(modelId, { status: "failed" }).catch(() => {});
    await updateBackgroundJob(jobId, {
      status: "failed",
      errorMessage: errMsg,
      progressMessage: "訓練失敗（內部錯誤）",
    }).catch(() => {});
    // 不 throw，因為此函數在背景執行
  }
}

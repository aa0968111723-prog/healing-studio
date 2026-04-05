/**
 * LoRA Training Service Module
 *
 * Orchestrates the full LoRA fine-tuning pipeline:
 *   1. Download training images → pack into ZIP
 *   2. Upload ZIP to S3
 *   3. Submit training job to Replicate
 *   4. Poll until completion → write results back to DB
 */

import JSZip from "jszip";
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
  imageUrls: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LOG_PREFIX = "[LoraTrainer]";
const POLL_INTERVAL_MS = 30_000;        // 30 seconds
const MAX_POLL_DURATION_MS = 3_600_000; // 60 minutes
const REPLICATE_API_BASE = "https://api.replicate.com/v1";

// ─── Helper: get Replicate API token ────────────────────────────────────────

function getReplicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN ?? "";
  if (!token) {
    throw new Error(`${LOG_PREFIX} REPLICATE_API_TOKEN is not set`);
  }
  return token;
}

// ─── Helper: sleep ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Function 1: buildZipBuffer ─────────────────────────────────────────────

/**
 * Downloads each image URL and packs them into a ZIP buffer.
 * File names: 001.jpg, 002.jpg, ...
 */
async function buildZipBuffer(imageUrls: string[]): Promise<Buffer> {
  console.log(`${LOG_PREFIX} Building ZIP from ${imageUrls.length} images...`);
  const zip = new JSZip();

  const downloadPromises = imageUrls.map(async (url, index) => {
    const paddedIndex = String(index + 1).padStart(3, "0");
    const fileName = `${paddedIndex}.jpg`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      zip.file(fileName, arrayBuffer);
      console.log(`${LOG_PREFIX}   ✓ ${fileName} (${Math.round(arrayBuffer.byteLength / 1024)} KB)`);
    } catch (err: any) {
      console.error(`${LOG_PREFIX}   ✗ Failed to download ${url}: ${err.message}`);
      // Skip failed images but continue with the rest
    }
  });

  await Promise.all(downloadPromises);

  const fileCount = Object.keys(zip.files).length;
  if (fileCount === 0) {
    throw new Error(`${LOG_PREFIX} No images were successfully downloaded`);
  }

  console.log(`${LOG_PREFIX} ZIP contains ${fileCount} files, generating buffer...`);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  console.log(`${LOG_PREFIX} ZIP buffer ready (${Math.round(buffer.length / 1024)} KB)`);
  return buffer;
}

// ─── Function 2: uploadZipToStorage ─────────────────────────────────────────

/**
 * Uploads the ZIP buffer to S3 via storagePut.
 * Key format: lora-datasets/{userId}/{modelId}-{timestamp}.zip
 */
async function uploadZipToStorage(
  zipBuffer: Buffer,
  userId: number,
  modelId: number
): Promise<string> {
  const key = `lora-datasets/${userId}/${modelId}-${Date.now()}.zip`;
  console.log(`${LOG_PREFIX} Uploading ZIP to S3: ${key}`);
  const { url } = await storagePut(key, zipBuffer, "application/zip");
  console.log(`${LOG_PREFIX} ZIP uploaded: ${url}`);
  return url;
}

// ─── Function 3: submitReplicateLoraTraining ────────────────────────────────

/**
 * Creates a Replicate prediction for LoRA training (async, non-blocking).
 * Uses ostris/flux-dev-lora-trainer as the training model.
 * Returns the prediction ID for polling.
 */
async function submitReplicateLoraTraining(params: {
  zipUrl: string;
  epochs: number;
  learningRate: number;
  triggerWord: string;
}): Promise<string> {
  const token = getReplicateToken();
  const steps = Math.min(Math.max(params.epochs * 30, 200), 2000);

  const body: Record<string, any> = {
    // ostris/flux-dev-lora-trainer or similar LoRA training model on Replicate
    version: "a22c463f11808638ad5e2ebd582e07a469031f48dd567366fb4c6fdab91d614d",
    input: {
      input_images: params.zipUrl,
      steps: steps,
      learning_rate: params.learningRate,
      ...(params.triggerWord ? { caption_prefix: params.triggerWord } : {}),
    },
  };

  console.log(`${LOG_PREFIX} Submitting Replicate training: steps=${steps}, lr=${params.learningRate}, trigger="${params.triggerWord}"`);

  const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "respond-async",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Replicate API error (${response.status}): ${errText}`);
  }

  const result = await response.json();
  const predictionId = result.id;
  console.log(`${LOG_PREFIX} Replicate prediction created: ${predictionId}`);
  return predictionId;
}

// ─── Helper: poll Replicate prediction ──────────────────────────────────────

async function getReplicatePrediction(predictionId: string): Promise<any> {
  const token = getReplicateToken();
  const response = await fetch(`${REPLICATE_API_BASE}/predictions/${predictionId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Replicate poll error (${response.status}): ${errText}`);
  }
  return response.json();
}

// ─── Helper: format elapsed time ────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

// ─── Function 4: runLoraTrainingJob (main orchestrator) ─────────────────────

/**
 * Main entry point — runs the full LoRA training pipeline in the background.
 * All errors are caught and written to DB; this function never throws.
 */
export async function runLoraTrainingJob(input: LoraTrainingJobInput): Promise<void> {
  const { userId, modelId, jobId, modelName, triggerWord, epochs, learningRate, imageUrls } = input;
  console.log(`${LOG_PREFIX} ═══ Starting LoRA training job ═══`);
  console.log(`${LOG_PREFIX}   modelId=${modelId}, jobId=${jobId}, name="${modelName}", images=${imageUrls.length}`);

  try {
    // ── Step A: Mark as training ──
    await updateFineTunedModel(modelId, { status: "training" });
    await updateBackgroundJob(jobId, {
      status: "processing",
      progress: 5,
      progressMessage: "準備訓練資料...",
    });

    // ── Step B: Build ZIP ──
    console.log(`${LOG_PREFIX} [Step B] Building ZIP buffer...`);
    const zipBuffer = await buildZipBuffer(imageUrls);
    await updateBackgroundJob(jobId, {
      progress: 10,
      progressMessage: `已打包 ${imageUrls.length} 張圖片，正在上傳...`,
    });

    // ── Step C: Upload ZIP to S3 ──
    console.log(`${LOG_PREFIX} [Step C] Uploading ZIP to S3...`);
    const zipUrl = await uploadZipToStorage(zipBuffer, userId, modelId);

    // ── Step D: Update progress ──
    await updateBackgroundJob(jobId, {
      progress: 20,
      progressMessage: "ZIP 已上傳，正在提交訓練任務...",
    });

    // ── Step E: Submit to Replicate ──
    console.log(`${LOG_PREFIX} [Step E] Submitting to Replicate...`);
    const predictionId = await submitReplicateLoraTraining({
      zipUrl,
      epochs,
      learningRate,
      triggerWord,
    });

    // ── Step F: Update progress + store predictionId ──
    await updateBackgroundJob(jobId, {
      progress: 30,
      progressMessage: "訓練任務已提交，等待 Replicate 處理...",
    });
    // Store predictionId in model's configJson for reference
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

    // ── Step G: Poll until completion ──
    console.log(`${LOG_PREFIX} [Step G] Starting polling loop (interval=${POLL_INTERVAL_MS / 1000}s, max=${MAX_POLL_DURATION_MS / 1000}s)...`);
    const pollStartTime = Date.now();

    while (true) {
      const elapsed = Date.now() - pollStartTime;

      // Step H: Timeout check
      if (elapsed > MAX_POLL_DURATION_MS) {
        console.error(`${LOG_PREFIX} ✗ Training timed out after ${formatElapsed(elapsed)}`);
        await updateFineTunedModel(modelId, { status: "failed" });
        await updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage: `訓練超時（超過 ${MAX_POLL_DURATION_MS / 60000} 分鐘未完成）`,
          progressMessage: "訓練超時",
        });
        return;
      }

      await sleep(POLL_INTERVAL_MS);

      let prediction: any;
      try {
        prediction = await getReplicatePrediction(predictionId);
      } catch (pollErr: any) {
        console.warn(`${LOG_PREFIX} Poll request failed: ${pollErr.message}, will retry...`);
        continue;
      }

      const status = prediction.status;
      console.log(`${LOG_PREFIX}   Poll: status=${status}, elapsed=${formatElapsed(elapsed)}`);

      if (status === "starting" || status === "processing") {
        // Linear progress estimate: 30% → 90% over the max poll duration
        const progressFraction = Math.min(elapsed / MAX_POLL_DURATION_MS, 1);
        const estimatedProgress = Math.round(30 + progressFraction * 60);
        await updateBackgroundJob(jobId, {
          progress: Math.min(estimatedProgress, 90),
          progressMessage: `訓練中 (${formatElapsed(elapsed)})...`,
        });
        continue;
      }

      if (status === "succeeded") {
        // Extract output — Replicate LoRA trainers typically return a URL to the trained weights
        const output = prediction.output;
        const outputUrl = typeof output === "string"
          ? output
          : Array.isArray(output)
            ? output[0]
            : output?.weights ?? output?.url ?? JSON.stringify(output);

        console.log(`${LOG_PREFIX} ✓ Training succeeded! Output: ${outputUrl}`);

        await updateFineTunedModel(modelId, {
          status: "ready",
          fileUrl: typeof outputUrl === "string" ? outputUrl : JSON.stringify(outputUrl),
        });
        await updateBackgroundJob(jobId, {
          status: "completed",
          progress: 100,
          progressMessage: "訓練完成！模型已就緒。",
          resultJson: {
            predictionId,
            output: outputUrl,
            completedAt: Date.now(),
            elapsedMs: elapsed,
          },
        });
        return;
      }

      if (status === "failed" || status === "canceled") {
        const errorDetail = prediction.error ?? prediction.logs ?? "Unknown error";
        console.error(`${LOG_PREFIX} ✗ Training ${status}: ${errorDetail}`);

        await updateFineTunedModel(modelId, { status: "failed" });
        await updateBackgroundJob(jobId, {
          status: "failed",
          errorMessage: typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail),
          progressMessage: `訓練${status === "canceled" ? "已取消" : "失敗"}`,
        });
        return;
      }

      // Unknown status — log and continue polling
      console.warn(`${LOG_PREFIX} Unknown prediction status: ${status}, continuing...`);
    }
  } catch (err: any) {
    // ── Global catch: any unhandled error ──
    console.error(`${LOG_PREFIX} ✗ Unhandled error in training pipeline: ${err.message}`);
    console.error(err.stack);

    try {
      await updateFineTunedModel(modelId, { status: "failed" });
      await updateBackgroundJob(jobId, {
        status: "failed",
        errorMessage: err.message || "Unknown error during training",
        progressMessage: "訓練過程發生錯誤",
      });
    } catch (dbErr: any) {
      console.error(`${LOG_PREFIX} ✗ Failed to update DB after error: ${dbErr.message}`);
    }
  }
}

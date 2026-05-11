/**
 * server/services/spiritTools/trainingSpecialistTools.ts
 *
 * Tools for training-specialist (練練) spirit.
 * Handles model training, LoRA creation, and fine-tuning.
 */

import { logger } from "../../_core/logger";

/**
 * Start training a custom model (LoRA)
 */
export async function trainModel(input: {
  userId: number;
  modelName: string;
  trainingType: "lora" | "dreambooth" | "fine-tune";
  datasetImages?: string[];
  baseModel?: string;
  steps?: number;
  learningRate?: number;
}): Promise<{
  success: boolean;
  trainingId?: string;
  message: string;
}> {
  try {
    const { startTrainingJob } = await import("../modelTrainer");

    const result = await startTrainingJob({
      userId: input.userId,
      modelName: input.modelName,
      trainingType: input.trainingType,
      datasetImages: input.datasetImages || [],
      baseModel: input.baseModel || "flux-dev",
      steps: input.steps || 1000,
      learningRate: input.learningRate || 0.0001,
    });

    logger.info("model_training_started", {
      userId: input.userId,
      trainingId: result.trainingId,
      modelName: input.modelName,
    });

    return {
      success: true,
      trainingId: result.trainingId,
      message: `模型訓練已啟動，訓練 ID：${result.trainingId}`,
    };
  } catch (error) {
    logger.error("model_training_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `訓練失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get training job status
 */
export async function getTrainingStatus(input: {
  userId: number;
  trainingId: string;
}): Promise<{
  success: boolean;
  status?: string;
  progress?: number;
  message: string;
}> {
  try {
    const { getTrainingJobStatus } = await import("../modelTrainer");

    const result = await getTrainingJobStatus({
      userId: input.userId,
      trainingId: input.trainingId,
    });

    return {
      success: true,
      status: result.status,
      progress: result.progress,
      message: `訓練狀態：${result.status}`,
    };
  } catch (error) {
    logger.error("get_training_status_failed", {
      userId: input.userId,
      trainingId: input.trainingId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get training tips and best practices
 */
export function getTrainingTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "準備 15-30 張高品質訓練圖片，確保多樣化的角度和場景",
      "圖片解析度建議 512x512 或更高",
      "避免重複或相似度過高的圖片",
      "為每張圖片添加準確的描述標籤",
      "訓練人物時，包含不同表情、姿勢、服裝",
      "訓練風格時，確保風格特徵一致",
      "LoRA 訓練通常需要 30-60 分鐘",
      "訓練完成後測試不同提示詞以評估效果",
    ],
  };
}

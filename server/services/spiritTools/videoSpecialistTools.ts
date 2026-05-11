/**
 * server/services/spiritTools/videoSpecialistTools.ts
 *
 * Tools for video-specialist (影影) spirit.
 * Handles video generation, image-to-video, lip-sync, and video editing.
 */

import { logger } from "../../_core/logger";

/**
 * Generate a video from text prompt
 */
export async function generateVideo(input: {
  userId: number;
  prompt: string;
  modelId?: string;
  duration?: number;
  aspectRatio?: string;
  fps?: number;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "video",
      prompt: input.prompt,
      modelId: input.modelId || "hailu-video",
      params: {
        duration: input.duration || 5,
        aspect_ratio: input.aspectRatio || "16:9",
        fps: input.fps || 30,
      },
    });

    logger.info("video_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      modelId: input.modelId,
      duration: input.duration,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `影片生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("video_generation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `生成失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Convert image to video (image-to-video)
 */
export async function imageToVideo(input: {
  userId: number;
  imageUrl: string;
  prompt?: string;
  modelId?: string;
  duration?: number;
  motion?: "subtle" | "moderate" | "dynamic";
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "video",
      prompt: input.prompt || "animate this image",
      modelId: input.modelId || "hailu-video",
      params: {
        image_url: input.imageUrl,
        duration: input.duration || 5,
        motion_level: input.motion || "moderate",
      },
    });

    logger.info("image_to_video_started", {
      userId: input.userId,
      jobId: result.jobId,
      hasImageUrl: !!input.imageUrl,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `圖轉影片已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("image_to_video_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `轉換失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create lip-sync video (talking head)
 */
export async function createLipSync(input: {
  userId: number;
  videoUrl: string;
  audioUrl: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "video",
      prompt: "lip sync",
      modelId: "wav2lip",
      params: {
        video_url: input.videoUrl,
        audio_url: input.audioUrl,
      },
    });

    logger.info("lip_sync_started", {
      userId: input.userId,
      jobId: result.jobId,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `對嘴影片生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("lip_sync_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `對嘴失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get available video models
 */
export function getVideoModels(): {
  success: boolean;
  models: Array<{
    id: string;
    name: string;
    description: string;
    maxDuration: number;
    strengths: string[];
  }>;
} {
  return {
    success: true,
    models: [
      {
        id: "hailu-video",
        name: "HailuoAI Video",
        description: "高品質寫實影片生成",
        maxDuration: 6,
        strengths: ["寫實", "穩定", "高解析度"],
      },
      {
        id: "minimax-video",
        name: "MiniMax Video",
        description: "快速動畫風格影片",
        maxDuration: 6,
        strengths: ["速度", "動畫", "風格化"],
      },
      {
        id: "luma-dream",
        name: "Luma Dream Machine",
        description: "創意影片生成",
        maxDuration: 5,
        strengths: ["創意", "流暢", "多樣性"],
      },
      {
        id: "kling-video",
        name: "Kling AI",
        description: "中文優化影片生成",
        maxDuration: 5,
        strengths: ["中文理解", "細節", "穩定"],
      },
      {
        id: "runway-gen3",
        name: "Runway Gen-3",
        description: "專業級影片生成",
        maxDuration: 10,
        strengths: ["品質", "控制", "專業"],
      },
    ],
  };
}

/**
 * Get video generation tips
 */
export function getVideoGenerationTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "描述運鏡方式：「推軌」、「環繞」、「空拍俯視」",
      "指定動作和速度：「緩慢移動」、「快速奔跑」、「靜止特寫」",
      "加入時間和氛圍：「日落時分」、「夜間霓虹」、「清晨薄霧」",
      "避免過於複雜的場景轉換，單一鏡頭效果較好",
      "圖轉影片時選擇有明確主體和空間感的圖片",
      "較短的影片（3-5秒）通常比長影片品質更穩定",
      "描述自然物理運動，避免突兀的變形或瞬移",
    ],
  };
}

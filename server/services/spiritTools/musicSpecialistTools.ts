/**
 * server/services/spiritTools/musicSpecialistTools.ts
 *
 * Tools for music-specialist (音音) spirit.
 * Handles music generation, sound effects, and audio mixing.
 */

import { logger } from "../../_core/logger";

/**
 * Generate music from text description
 */
export async function generateMusic(input: {
  userId: number;
  prompt: string;
  duration?: number;
  genre?: string;
  mood?: string;
  instrumental?: boolean;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "audio",
      prompt: input.prompt,
      modelId: "suno-v4",
      params: {
        duration: input.duration || 30,
        genre: input.genre,
        mood: input.mood,
        instrumental: input.instrumental ?? false,
      },
    });

    logger.info("music_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      duration: input.duration,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `音樂生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("music_generation_failed", {
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
 * Generate sound effects
 */
export async function generateSoundEffect(input: {
  userId: number;
  description: string;
  duration?: number;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "audio",
      prompt: `sound effect: ${input.description}`,
      modelId: "audio-craft",
      params: {
        duration: input.duration || 5,
        type: "sfx",
      },
    });

    logger.info("sound_effect_started", {
      userId: input.userId,
      jobId: result.jobId,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `音效生成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("sound_effect_failed", {
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
 * Get music genres and moods
 */
export function getMusicOptions(): {
  success: boolean;
  genres: string[];
  moods: string[];
} {
  return {
    success: true,
    genres: [
      "pop", "rock", "jazz", "classical", "electronic",
      "hip-hop", "country", "folk", "ambient", "cinematic",
      "lo-fi", "indie", "metal", "r&b", "latin",
    ],
    moods: [
      "happy", "sad", "energetic", "calm", "mysterious",
      "epic", "romantic", "dark", "uplifting", "nostalgic",
      "tense", "playful", "melancholic", "powerful", "dreamy",
    ],
  };
}

/**
 * Get music generation tips
 */
export function getMusicGenerationTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "描述風格和節奏：「快節奏的電子舞曲」、「慢板的鋼琴抒情」",
      "加入情緒和氛圍：「振奮人心」、「憂鬱沉思」、「緊張懸疑」",
      "提及樂器：「吉他主導」、「弦樂編制」、「合成器音色」",
      "指定用途：「背景音樂」、「開場音樂」、「片尾配樂」",
      "純音樂請標記 instrumental: true，避免不必要的人聲",
      "較短的片段（30-60秒）品質和一致性較好",
    ],
  };
}

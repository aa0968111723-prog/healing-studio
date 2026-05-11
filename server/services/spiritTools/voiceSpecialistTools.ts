/**
 * server/services/spiritTools/voiceSpecialistTools.ts
 *
 * Tools for voice-specialist (聲聲) spirit.
 * Handles voice synthesis, voice cloning, and speech-to-text.
 */

import { logger } from "../../_core/logger";

/**
 * Generate speech from text (TTS)
 */
export async function generateSpeech(input: {
  userId: number;
  text: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  emotion?: string;
}): Promise<{
  success: boolean;
  jobId?: string;
  message: string;
}> {
  try {
    const { dispatchGenerationJob } = await import("../generationJobDispatcher");

    const result = await dispatchGenerationJob({
      userId: input.userId,
      modality: "voice",
      prompt: input.text,
      modelId: "qwen-tts",
      params: {
        voice_id: input.voiceId || "default",
        language: input.language || "zh-TW",
        speed: input.speed || 1.0,
        emotion: input.emotion,
      },
    });

    logger.info("speech_generation_started", {
      userId: input.userId,
      jobId: result.jobId,
      textLength: input.text.length,
    });

    return {
      success: true,
      jobId: result.jobId,
      message: `語音合成已啟動，作業 ID：${result.jobId}`,
    };
  } catch (error) {
    logger.error("speech_generation_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `合成失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Transcribe audio to text (STT)
 */
export async function transcribeAudio(input: {
  userId: number;
  audioUrl: string;
  language?: string;
}): Promise<{
  success: boolean;
  transcript?: string;
  message: string;
}> {
  try {
    const { transcribeMedia } = await import("../mediaTranscriber");

    const result = await transcribeMedia({
      userId: input.userId,
      mediaUrl: input.audioUrl,
      language: input.language,
    });

    logger.info("audio_transcription_complete", {
      userId: input.userId,
      transcriptLength: result.transcript?.length,
    });

    return {
      success: true,
      transcript: result.transcript,
      message: "轉寫完成",
    };
  } catch (error) {
    logger.error("audio_transcription_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `轉寫失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get available voices
 */
export function getAvailableVoices(): {
  success: boolean;
  voices: Array<{
    id: string;
    name: string;
    language: string;
    gender: "male" | "female" | "neutral";
    description: string;
  }>;
} {
  return {
    success: true,
    voices: [
      {
        id: "zh-tw-female-1",
        name: "小雅",
        language: "zh-TW",
        gender: "female",
        description: "溫柔親切的女聲",
      },
      {
        id: "zh-tw-male-1",
        name: "小明",
        language: "zh-TW",
        gender: "male",
        description: "穩重大氣的男聲",
      },
      {
        id: "en-us-female-1",
        name: "Emma",
        language: "en-US",
        gender: "female",
        description: "Standard American English, friendly",
      },
      {
        id: "en-us-male-1",
        name: "James",
        language: "en-US",
        gender: "male",
        description: "Professional American English",
      },
    ],
  };
}

/**
 * Get voice generation tips
 */
export function getVoiceGenerationTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "使用標點符號控制停頓和語氣：句號、逗號、問號、驚嘆號",
      "避免過長的句子，適當斷句可提升自然度",
      "數字和專有名詞用中文表達較準確",
      "可在文字中加入情緒標記：（開心）、（嚴肅）、（疑惑）",
      "語速建議範圍：0.8-1.2，1.0 為正常速度",
      "注意同音字，必要時用描述代替以避免誤讀",
    ],
  };
}

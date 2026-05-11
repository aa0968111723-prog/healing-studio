/**
 * server/services/spiritTools/settingsDetailTools.ts
 *
 * Tools for settings-detail (細細) spirit.
 * Handles user preferences, settings explanations, and fine-tuning.
 */

import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { userPreferences, agentPreferences } from "../../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Setting explanations database
 */
const SETTING_EXPLANATIONS: Record<string, {
  title: string;
  description: string;
  sideEffects: string[];
  recommendations: string;
}> = {
  "confirmationPolicy": {
    title: "確認政策",
    description: "控制光球執行動作前是否需要確認",
    sideEffects: [
      "always_approve：完全自動化，適合信任度高的場景",
      "confirm_high_risk：只確認高風險操作（推薦）",
      "confirm_all：每個動作都確認，適合謹慎使用者",
      "manual：完全手動，光球不會自動執行",
    ],
    recommendations: "建議使用 confirm_high_risk，在安全與效率間取得平衡",
  },
  "imageEngine": {
    title: "圖片生成引擎",
    description: "預設使用的圖片生成模型",
    sideEffects: [
      "不同引擎生成速度和風格不同",
      "某些引擎可能需要更多點數",
      "切換引擎可能影響風格一致性",
    ],
    recommendations: "Flux 系列速度快品質高，適合大多數場景",
  },
  "videoEngine": {
    title: "影片生成引擎",
    description: "預設使用的影片生成模型",
    sideEffects: [
      "影片生成通常需要較長時間",
      "不同引擎支援的影片長度不同",
      "某些引擎特別適合特定類型（如動畫、寫實）",
    ],
    recommendations: "根據需求選擇：動畫用 animate，寫實用 HailuoAI",
  },
  "voiceEngine": {
    title: "語音合成引擎",
    description: "預設使用的語音生成模型",
    sideEffects: [
      "不同引擎支援的語言和聲音庫不同",
      "ElevenLabs 需要 API 金鑰",
      "音質和自然度有差異",
    ],
    recommendations: "中文推薦 Qwen TTS，英文推薦 ElevenLabs",
  },
  "autoApproveTools": {
    title: "自動核准工具",
    description: "允許光球自動執行的工具清單",
    sideEffects: [
      "列在清單的工具不會再顯示確認對話框",
      "使用 * 可允許所有工具（不建議）",
      "建議只加入低風險工具",
    ],
    recommendations: "建議加入：research.deepSearch, inspiration.fetch",
  },
  "blockedTools": {
    title: "封鎖工具",
    description: "禁止光球使用的工具清單",
    sideEffects: [
      "被封鎖的工具完全無法使用",
      "可能影響某些工作流程的完整性",
      "精靈會跳過這些工具",
    ],
    recommendations: "只封鎖確實不需要或有安全疑慮的工具",
  },
};

/**
 * Get user preferences
 */
export async function getPreferences(userId: number): Promise<{
  success: boolean;
  preferences: Record<string, unknown>;
}> {
  try {
    const db = getDb();

    const [userPref] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    const [agentPref] = await db
      .select()
      .from(agentPreferences)
      .where(eq(agentPreferences.userId, userId))
      .limit(1);

    const preferences: Record<string, unknown> = {
      // User preferences
      theme: userPref?.theme || "system",
      language: userPref?.language || "zh-TW",

      // Agent preferences
      confirmationPolicy: agentPref?.confirmationPolicy || "confirm_high_risk",
      imageEngine: agentPref?.imageEngine || "flux",
      videoEngine: agentPref?.videoEngine || "hailu",
      audioEngine: agentPref?.audioEngine || "suno",
      voiceEngine: agentPref?.voiceEngine || "qwen-tts",
      autoApproveTools: agentPref?.autoApproveTools
        ? JSON.parse(agentPref.autoApproveTools as string)
        : [],
      blockedTools: agentPref?.blockedTools
        ? JSON.parse(agentPref.blockedTools as string)
        : [],
    };

    logger.debug("preferences_retrieved", { userId });

    return {
      success: true,
      preferences,
    };
  } catch (error) {
    logger.error("get_preferences_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      preferences: {},
    };
  }
}

/**
 * Update a single preference
 */
export async function updatePreference(input: {
  userId: number;
  key: string;
  value: unknown;
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const db = getDb();

    // Determine which table to update
    const agentPrefKeys = [
      "confirmationPolicy",
      "imageEngine",
      "videoEngine",
      "audioEngine",
      "voiceEngine",
      "autoApproveTools",
      "blockedTools",
    ];

    if (agentPrefKeys.includes(input.key)) {
      // Update agent preferences
      const updateData: Record<string, unknown> = {
        [input.key]: typeof input.value === "object"
          ? JSON.stringify(input.value)
          : input.value,
        updatedAt: new Date(),
      };

      await db
        .update(agentPreferences)
        .set(updateData)
        .where(eq(agentPreferences.userId, input.userId));
    } else {
      // Update user preferences
      const updateData: Record<string, unknown> = {
        [input.key]: input.value,
        updatedAt: new Date(),
      };

      await db
        .update(userPreferences)
        .set(updateData)
        .where(eq(userPreferences.userId, input.userId));
    }

    logger.info("preference_updated", {
      userId: input.userId,
      key: input.key,
      value: input.value,
    });

    return {
      success: true,
      message: `設定「${input.key}」已更新`,
    };
  } catch (error) {
    logger.error("update_preference_failed", {
      userId: input.userId,
      key: input.key,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `更新失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Explain a setting with side effects and recommendations
 */
export function explainSetting(settingKey: string): {
  found: boolean;
  explanation?: {
    title: string;
    description: string;
    sideEffects: string[];
    recommendations: string;
  };
} {
  const explanation = SETTING_EXPLANATIONS[settingKey];

  if (!explanation) {
    logger.debug("setting_explanation_not_found", { settingKey });
    return { found: false };
  }

  logger.debug("setting_explained", { settingKey });

  return {
    found: true,
    explanation,
  };
}

/**
 * Get all available settings with brief descriptions
 */
export function getAllSettings(): {
  settings: Array<{
    key: string;
    title: string;
    description: string;
  }>;
} {
  const settings = Object.entries(SETTING_EXPLANATIONS).map(([key, value]) => ({
    key,
    title: value.title,
    description: value.description,
  }));

  return { settings };
}

/**
 * Validate a preference value
 */
export function validatePreference(key: string, value: unknown): {
  valid: boolean;
  error?: string;
  suggestion?: string;
} {
  switch (key) {
    case "confirmationPolicy":
      const validPolicies = ["always_approve", "confirm_high_risk", "confirm_all", "manual"];
      if (!validPolicies.includes(value as string)) {
        return {
          valid: false,
          error: `無效的確認政策，必須是：${validPolicies.join(", ")}`,
          suggestion: "建議使用 confirm_high_risk",
        };
      }
      break;

    case "imageEngine":
      const validImageEngines = ["flux", "sd3", "ideogram", "recraft"];
      if (!validImageEngines.includes(value as string)) {
        return {
          valid: false,
          error: `無效的圖片引擎，支援：${validImageEngines.join(", ")}`,
          suggestion: "建議使用 flux",
        };
      }
      break;

    case "videoEngine":
      const validVideoEngines = ["hailu", "minimax", "luma", "kling", "runway"];
      if (!validVideoEngines.includes(value as string)) {
        return {
          valid: false,
          error: `無效的影片引擎，支援：${validVideoEngines.join(", ")}`,
          suggestion: "建議使用 hailu",
        };
      }
      break;

    case "voiceEngine":
      const validVoiceEngines = ["qwen-tts", "elevenlabs", "kokoro"];
      if (!validVoiceEngines.includes(value as string)) {
        return {
          valid: false,
          error: `無效的語音引擎，支援：${validVoiceEngines.join(", ")}`,
          suggestion: "中文建議 qwen-tts，英文建議 elevenlabs",
        };
      }
      break;

    case "autoApproveTools":
    case "blockedTools":
      if (!Array.isArray(value)) {
        return {
          valid: false,
          error: "必須是字串陣列",
          suggestion: '例如：["research.deepSearch", "inspiration.fetch"]',
        };
      }
      break;
  }

  return { valid: true };
}

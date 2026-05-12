/**
 * server/services/spiritTools/clarificationEngineTools.ts
 *
 * Tools for intent clarification and learning user patterns.
 */

import { logger } from "../../_core/logger";
import { orbClarificationEngine } from "../orbClarificationEngine";

/**
 * Identify user intent and detect if clarification is needed
 */
export async function identifyUserIntent(input: {
  userId: number;
  conversationId: string;
  userInput: string;
  context?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  intentLogId?: string;
  needsClarification: boolean;
  primaryIntent?: string;
  confidence?: number;
  message: string;
}> {
  try {
    const intentLog = await orbClarificationEngine.identifyIntent(input);

    return {
      success: true,
      intentLogId: intentLog.id,
      needsClarification: intentLog.needsClarification,
      primaryIntent: intentLog.primaryIntent,
      confidence: intentLog.intentConfidence,
      message: intentLog.needsClarification
        ? "需要進一步澄清意圖"
        : "意圖已識別",
    };
  } catch (error) {
    logger.error("identify_user_intent_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      needsClarification: false,
      message: `識別失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Record user's answer to a clarification question
 */
export async function recordClarificationAnswer(input: {
  clarificationId: string;
  userAnswer: string;
}): Promise<{
  success: boolean;
  resolvedIntent?: string;
  message: string;
}> {
  try {
    const clarification = await orbClarificationEngine.recordAnswer(
      input.clarificationId,
      input.userAnswer
    );

    return {
      success: true,
      resolvedIntent: clarification.resolvedIntent,
      message: "答案已記錄",
    };
  } catch (error) {
    logger.error("record_clarification_answer_failed", {
      clarificationId: input.clarificationId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `記錄失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get user's historical answer patterns
 */
export async function getUserAnswerPattern(input: {
  userId: number;
  questionType: string;
}): Promise<{
  success: boolean;
  pattern?: {
    defaultPreference?: string;
    confidenceScore: number;
    sampleCount: number;
  };
  message: string;
}> {
  try {
    const pattern = await orbClarificationEngine.getUserAnswerPattern(
      input.userId,
      input.questionType
    );

    if (!pattern) {
      return {
        success: true,
        message: "尚無學習到的模式",
      };
    }

    return {
      success: true,
      pattern: {
        defaultPreference: pattern.defaultPreference,
        confidenceScore: pattern.confidenceScore,
        sampleCount: pattern.sampleCount,
      },
      message: `已找到模式（信心度：${(pattern.confidenceScore * 100).toFixed(0)}%）`,
    };
  } catch (error) {
    logger.error("get_user_answer_pattern_failed", {
      userId: input.userId,
      questionType: input.questionType,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get clarification statistics for user
 */
export async function getClarificationStats(userId: number): Promise<{
  success: boolean;
  stats?: {
    totalClarifications: number;
    answerRate: number;
    learningProgress: number;
  };
  message: string;
}> {
  try {
    const stats = await orbClarificationEngine.getStats(userId);

    return {
      success: true,
      stats: {
        totalClarifications: stats.totalClarifications,
        answerRate: stats.answerRate,
        learningProgress: stats.learningProgress,
      },
      message: "統計資料已載入",
    };
  } catch (error) {
    logger.error("get_clarification_stats_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `載入失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

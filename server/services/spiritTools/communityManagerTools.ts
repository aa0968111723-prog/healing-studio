/**
 * server/services/spiritTools/communityManagerTools.ts
 *
 * Tools for community-manager (社社) spirit.
 * Handles feedback collection, community interaction, and user engagement.
 */

import { logger } from "../../_core/logger";
import { getDb } from "../../db";
import { userFeedbackReports } from "../../../drizzle/schema";
import { desc, eq } from "drizzle-orm";

/**
 * Submit user feedback
 */
export async function submitFeedback(input: {
  userId: number;
  type: "bug" | "feature" | "improvement" | "praise" | "other";
  title: string;
  description: string;
  rating?: number;
}): Promise<{
  success: boolean;
  feedbackId?: number;
  message: string;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");

    // Map the tool's coarse input type onto the schema's category enum.
    // The schema has no `rating` column, so we discard the score (the
    // /feedback page already has a richer rating widget that targets
    // a different table).
    const categoryMap: Record<typeof input.type, "bug" | "feature_request" | "quality_issue" | "general"> = {
      bug: "bug",
      feature: "feature_request",
      improvement: "feature_request",
      praise: "general",
      other: "general",
    };

    const [result] = await db.insert(userFeedbackReports).values({
      userId: input.userId,
      category: categoryMap[input.type],
      title: input.title,
      description: input.description,
      createdAt: new Date(),
    });

    logger.info("feedback_submitted", {
      userId: input.userId,
      feedbackId: result.insertId,
      type: input.type,
    });

    return {
      success: true,
      feedbackId: Number(result.insertId),
      message: "感謝你的回饋！我們會仔細閱讀並持續改進",
    };
  } catch (error) {
    logger.error("feedback_submission_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `提交失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get user's feedback history
 */
export async function getUserFeedback(input: {
  userId: number;
  limit?: number;
}): Promise<{
  success: boolean;
  feedback: Array<{
    id: number;
    type: string;
    title: string;
    description: string;
    createdAt: Date;
    status?: string;
  }>;
}> {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database is not configured");
    const feedback = await db
      .select()
      .from(userFeedbackReports)
      .where(eq(userFeedbackReports.userId, input.userId))
      .orderBy(desc(userFeedbackReports.createdAt))
      .limit(input.limit || 10);

    return {
      success: true,
      feedback: feedback as any,
    };
  } catch (error) {
    logger.error("get_feedback_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      feedback: [],
    };
  }
}

/**
 * Get community announcements
 */
export function getAnnouncements(): {
  success: boolean;
  announcements: Array<{
    id: string;
    title: string;
    content: string;
    type: "update" | "maintenance" | "feature" | "event";
    date: string;
    important: boolean;
  }>;
} {
  return {
    success: true,
    announcements: [
      {
        id: "ann-001",
        title: "新功能：影片生成 2.0",
        content: "全新的影片生成引擎，速度更快、品質更高",
        type: "feature",
        date: "2026-05-10",
        important: true,
      },
      {
        id: "ann-002",
        title: "系統維護通知",
        content: "將於 5/15 凌晨 2:00-4:00 進行系統維護",
        type: "maintenance",
        date: "2026-05-08",
        important: false,
      },
    ],
  };
}

/**
 * Get community engagement tips
 */
export function getEngagementTips(): {
  success: boolean;
  tips: string[];
} {
  return {
    success: true,
    tips: [
      "在社群分享你的創作，獲得更多靈感和回饋",
      "參與每週挑戰，贏取額外點數獎勵",
      "關注其他創作者，建立你的創作社群",
      "給喜歡的作品點讚和評論",
      "分享你的創作技巧，幫助其他人成長",
      "回報 bug 和建議新功能，一起讓平台更好",
    ],
  };
}

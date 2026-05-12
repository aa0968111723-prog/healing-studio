/**
 * server/services/spiritTools/featureDiscoveryTools.ts
 *
 * Tools for feature usage tracking and discovery analytics.
 */

import { logger } from "../../_core/logger";
import { orbFeatureDiscovery, type DiscoveryMethod } from "../orbFeatureDiscovery";

/**
 * Record feature usage
 */
export async function recordFeatureUsage(input: {
  userId: number;
  featureId: string;
  success: boolean;
  duration?: number;
  metadata?: Record<string, unknown>;
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await orbFeatureDiscovery.recordUsage(input);

    return {
      success: true,
      message: "使用記錄已更新",
    };
  } catch (error) {
    logger.error("record_feature_usage_failed", {
      userId: input.userId,
      featureId: input.featureId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `記錄失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Record feature discovery path
 */
export async function recordFeatureDiscovery(input: {
  userId: number;
  featureId: string;
  discoveryMethod: DiscoveryMethod;
  fromFeatureId?: string;
  context?: string;
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await orbFeatureDiscovery.recordDiscovery(input);

    return {
      success: true,
      message: "發現路徑已記錄",
    };
  } catch (error) {
    logger.error("record_feature_discovery_failed", {
      userId: input.userId,
      featureId: input.featureId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `記錄失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get user's feature usage statistics
 */
export async function getFeatureStats(input: {
  userId: number;
  featureId?: string;
}): Promise<{
  success: boolean;
  stats: Array<{
    featureId: string;
    usageCount: number;
    successCount: number;
    proficiencyScore?: number;
    lastUsedAt?: Date;
  }>;
  message: string;
}> {
  try {
    const stats = await orbFeatureDiscovery.getUserStats(
      input.userId,
      input.featureId
    );

    return {
      success: true,
      stats: stats.map((s) => ({
        featureId: s.featureId,
        usageCount: s.usageCount,
        successCount: s.successCount,
        proficiencyScore: s.proficiencyScore,
        lastUsedAt: s.lastUsedAt,
      })),
      message: `找到 ${stats.length} 個功能的使用記錄`,
    };
  } catch (error) {
    logger.error("get_feature_stats_failed", {
      userId: input.userId,
      featureId: input.featureId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      stats: [],
      message: `查詢失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Generate personalized feature recommendations
 */
export async function generateFeatureRecommendations(input: {
  userId: number;
  limit?: number;
}): Promise<{
  success: boolean;
  recommendations: Array<{
    featureId: string;
    reason: string;
    relevanceScore: number;
  }>;
  message: string;
}> {
  try {
    const recommendations = await orbFeatureDiscovery.generateRecommendations(
      input.userId,
      input.limit ?? 5
    );

    return {
      success: true,
      recommendations: recommendations.map((r) => ({
        featureId: r.featureId,
        reason: r.reason,
        relevanceScore: r.relevanceScore,
      })),
      message: `生成了 ${recommendations.length} 個推薦`,
    };
  } catch (error) {
    logger.error("generate_feature_recommendations_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      recommendations: [],
      message: `生成失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get feature discovery insights
 */
export async function getDiscoveryInsights(userId: number): Promise<{
  success: boolean;
  insights?: {
    totalFeaturesDiscovered: number;
    totalFeaturesUsed: number;
    discoveryRate: number;
    mostCommonMethod: string;
  };
  message: string;
}> {
  try {
    const insights = await orbFeatureDiscovery.getDiscoveryInsights(userId);

    return {
      success: true,
      insights: {
        totalFeaturesDiscovered: insights.totalFeaturesDiscovered,
        totalFeaturesUsed: insights.totalFeaturesUsed,
        discoveryRate: insights.discoveryRate,
        mostCommonMethod: insights.mostCommonMethod,
      },
      message: "洞察資料已載入",
    };
  } catch (error) {
    logger.error("get_discovery_insights_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `載入失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

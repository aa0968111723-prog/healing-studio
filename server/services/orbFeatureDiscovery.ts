/**
 * server/services/orbFeatureDiscovery.ts
 *
 * Service for feature usage analytics, discovery tracking, and personalized recommendations.
 */

import { TRPCError } from "@trpc/server";
import { logger } from "../_core/logger";
import { getDb } from "../db";
import {
  orbFeatureUsageStats,
  orbFeatureDiscoveryPaths,
  orbFeatureRecommendations,
  type OrbFeatureUsageStat,
  type InsertOrbFeatureUsageStat,
  type InsertOrbFeatureDiscoveryPath,
  type InsertOrbFeatureRecommendation,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export type DiscoveryMethod =
  | "orb_suggestion"
  | "menu_exploration"
  | "search"
  | "tutorial"
  | "friend_share"
  | "documentation"
  | "accident";

export interface FeatureUsageStats {
  id: string;
  userId: number;
  featureId: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  avgDuration?: number;
  lastUsedAt?: Date;
  firstUsedAt: Date;
  proficiencyScore?: number;
  metadata?: Record<string, unknown>;
  updatedAt: Date;
}

export interface FeatureDiscoveryPath {
  id: string;
  userId: number;
  featureId: string;
  discoveryMethod: DiscoveryMethod;
  fromFeatureId?: string;
  context?: string;
  timeToFirstUse?: number;
  discoveredAt: Date;
}

export interface FeatureRecommendation {
  id: string;
  userId: number;
  featureId: string;
  reason: string;
  relevanceScore: number;
  basedOnFeatures?: string[];
  presentedAt: Date;
  clickedAt?: Date;
  usedAt?: Date;
  dismissedAt?: Date;
  feedbackRating?: number;
  createdAt: Date;
}

export interface RecordUsageInput {
  userId: number;
  featureId: string;
  success: boolean;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordDiscoveryInput {
  userId: number;
  featureId: string;
  discoveryMethod: DiscoveryMethod;
  fromFeatureId?: string;
  context?: string;
}

// M9: 把「TODO 沒實作」訊號從 source comment 拉到 runtime telemetry。
// orbFeatureDiscovery 有 5 個 procedure 是空殼,只回 [] 不做事。原本只
// 在 source 留 TODO 註解,呼叫端 / 監控完全不知道在踩空函式。改成 module
// 載入時印一次 deprecation 警告,並在每個 procedure 首次被呼叫時 log
// 一次(per-process,不洪水),這樣 staging / prod telemetry 看得到「光
// 球在跑沒實作的功能」。
const NOT_IMPLEMENTED_WARNED = new Set<string>();
function warnNotImplemented(procedureName: string): void {
  if (NOT_IMPLEMENTED_WARNED.has(procedureName)) return;
  NOT_IMPLEMENTED_WARNED.add(procedureName);
  logger.warn("orb_feature_discovery_not_implemented", {
    procedure: procedureName,
    note: "Returns empty result until algorithm is implemented",
  });
}

export class OrbFeatureDiscovery {
  /**
   * Record feature usage
   */
  async recordUsage(input: RecordUsageInput): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Check if stats record exists
      const [existing] = await db
        .select()
        .from(orbFeatureUsageStats)
        .where(
          and(
            eq(orbFeatureUsageStats.userId, input.userId),
            eq(orbFeatureUsageStats.featureId, input.featureId)
          )
        );

      if (existing) {
        // Update existing record
        const newUsageCount = existing.usageCount + 1;
        const newSuccessCount = existing.successCount + (input.success ? 1 : 0);
        const newFailureCount = existing.failureCount + (input.success ? 0 : 1);

        // Calculate new average duration
        let newAvgDuration = existing.avgDuration
          ? parseFloat(existing.avgDuration)
          : undefined;
        if (input.duration && newAvgDuration) {
          newAvgDuration =
            (newAvgDuration * existing.usageCount + input.duration) /
            newUsageCount;
        } else if (input.duration) {
          newAvgDuration = input.duration;
        }

        // Calculate proficiency score (success rate * log(usage count))
        const successRate = newSuccessCount / newUsageCount;
        const proficiencyScore = successRate * Math.log10(newUsageCount + 1);

        await db
          .update(orbFeatureUsageStats)
          .set({
            usageCount: newUsageCount,
            successCount: newSuccessCount,
            failureCount: newFailureCount,
            avgDuration: newAvgDuration ? String(newAvgDuration) : undefined,
            lastUsedAt: new Date(),
            proficiencyScore: String(proficiencyScore),
            metadata: input.metadata ? (JSON.stringify(input.metadata) as any) : undefined,
          })
          .where(eq(orbFeatureUsageStats.id, existing.id));
      } else {
        // Create new record
        const proficiencyScore = input.success ? 0.3 : 0.0;
        const insertData: InsertOrbFeatureUsageStat = {
          userId: input.userId,
          featureId: input.featureId,
          usageCount: 1,
          successCount: input.success ? 1 : 0,
          failureCount: input.success ? 0 : 1,
          avgDuration: input.duration ? String(input.duration) : undefined,
          lastUsedAt: new Date(),
          proficiencyScore: String(proficiencyScore),
          metadata: input.metadata ? (JSON.stringify(input.metadata) as any) : undefined,
        };

        await db.insert(orbFeatureUsageStats).values(insertData);
      }

      logger.info("orb_feature_usage_recorded", {
        userId: input.userId,
        featureId: input.featureId,
        success: input.success,
      });
    } catch (error) {
      logger.error("orb_record_usage_failed", {
        userId: input.userId,
        featureId: input.featureId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - usage tracking failures shouldn't break functionality
    }
  }

  /**
   * Record feature discovery
   */
  async recordDiscovery(input: RecordDiscoveryInput): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const insertData: InsertOrbFeatureDiscoveryPath = {
        userId: input.userId,
        featureId: input.featureId,
        discoveryMethod: input.discoveryMethod,
        fromFeatureId: input.fromFeatureId,
        context: input.context,
      };

      await db.insert(orbFeatureDiscoveryPaths).values(insertData);

      logger.info("orb_feature_discovery_recorded", {
        userId: input.userId,
        featureId: input.featureId,
        method: input.discoveryMethod,
      });
    } catch (error) {
      logger.error("orb_record_discovery_failed", {
        userId: input.userId,
        featureId: input.featureId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw
    }
  }

  /**
   * Get user's feature usage statistics
   */
  async getUserStats(
    userId: number,
    featureId?: string
  ): Promise<FeatureUsageStats[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const conditions = [eq(orbFeatureUsageStats.userId, userId)];
      if (featureId) {
        conditions.push(eq(orbFeatureUsageStats.featureId, featureId));
      }

      const results = await db
        .select()
        .from(orbFeatureUsageStats)
        .where(and(...conditions))
        .orderBy(desc(orbFeatureUsageStats.lastUsedAt));

      return results.map((stat) => ({
        id: String(stat.id),
        userId: stat.userId,
        featureId: stat.featureId,
        usageCount: stat.usageCount,
        successCount: stat.successCount,
        failureCount: stat.failureCount,
        avgDuration: stat.avgDuration ? parseFloat(stat.avgDuration) : undefined,
        lastUsedAt: stat.lastUsedAt ?? undefined,
        firstUsedAt: stat.firstUsedAt,
        proficiencyScore: stat.proficiencyScore
          ? parseFloat(stat.proficiencyScore)
          : undefined,
        metadata: stat.metadata ? JSON.parse(stat.metadata as any) : undefined,
        updatedAt: stat.updatedAt,
      }));
    } catch (error) {
      logger.error("orb_get_user_stats_failed", {
        userId,
        featureId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Generate personalized feature recommendations
   *
   * @deprecated Algorithm not yet implemented; always returns []. Callers
   * should handle empty results gracefully. Once implemented, remove the
   * @deprecated tag and the warnNotImplemented call.
   */
  async generateRecommendations(
    userId: number,
    limit = 5
  ): Promise<FeatureRecommendation[]> {
    warnNotImplemented("generateRecommendations");
    try {
      // TODO: Implement recommendation algorithm:
      // 1. Analyze user's usage patterns
      // 2. Find features commonly used together (collaborative filtering)
      // 3. Identify skill progression paths
      // 4. Consider user's proficiency level
      // 5. Account for feature popularity and satisfaction
      // 6. Filter out already-used features
      // 7. Score and rank recommendations

      const recommendations: FeatureRecommendation[] = [];

      // TODO: Insert recommendations into database for tracking

      logger.info("orb_recommendations_generated", {
        userId,
        count: recommendations.length,
      });

      return recommendations;
    } catch (error) {
      logger.error("orb_generate_recommendations_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Record user interaction with recommendation
   */
  async recordRecommendationInteraction(
    recommendationId: string,
    interactionType: "clicked" | "used" | "dismissed",
    feedbackRating?: number
  ): Promise<void> {
    try {
      // TODO: Update database record with timestamp and feedback

      logger.info("orb_recommendation_interaction", {
        recommendationId,
        type: interactionType,
        rating: feedbackRating,
      });
    } catch (error) {
      logger.error("orb_record_recommendation_interaction_failed", {
        recommendationId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw
    }
  }

  /**
   * Get feature discovery insights
   */
  async getDiscoveryInsights(userId: number): Promise<{
    totalFeaturesDiscovered: number;
    totalFeaturesUsed: number;
    discoveryRate: number;
    mostCommonMethod: DiscoveryMethod;
    avgTimeToFirstUse: number;
    recentDiscoveries: FeatureDiscoveryPath[];
  }> {
    try {
      // TODO: Aggregate data from database

      const insights = {
        totalFeaturesDiscovered: 0,
        totalFeaturesUsed: 0,
        discoveryRate: 0,
        mostCommonMethod: "orb_suggestion" as DiscoveryMethod,
        avgTimeToFirstUse: 0,
        recentDiscoveries: [] as FeatureDiscoveryPath[],
      };

      return insights;
    } catch (error) {
      logger.error("orb_get_discovery_insights_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Find features similar to given feature (for "you might also like" suggestions)
   *
   * @deprecated Algorithm not yet implemented; always returns []. Same as
   * generateRecommendations — see that JSDoc for removal instructions.
   */
  async findSimilarFeatures(
    featureId: string,
    limit = 5
  ): Promise<Array<{
    featureId: string;
    similarityScore: number;
    reason: string;
  }>> {
    warnNotImplemented("findSimilarFeatures");
    try {
      // TODO: Implement similarity algorithm:
      // - Features often used in sequence
      // - Features in same category
      // - Features used by similar users

      const similar: Array<{
        featureId: string;
        similarityScore: number;
        reason: string;
      }> = [];

      return similar;
    } catch (error) {
      logger.error("orb_find_similar_features_failed", {
        featureId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Get proficiency progression for user
   *
   * @deprecated Algorithm not yet implemented; always returns empty buckets.
   */
  async getProficiencyProgression(userId: number): Promise<{
    beginner: string[];
    intermediate: string[];
    advanced: string[];
    mastered: string[];
  }> {
    warnNotImplemented("getProficiencyProgression");
    try {
      // TODO: Categorize features by proficiency score

      const progression = {
        beginner: [] as string[],
        intermediate: [] as string[],
        advanced: [] as string[],
        mastered: [] as string[],
      };

      return progression;
    } catch (error) {
      logger.error("orb_get_proficiency_progression_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Search features by name, description, or tags
   *
   * @deprecated Algorithm not yet implemented; always returns [].
   */
  async searchFeatures(
    query: string,
    userId?: number,
    limit = 20
  ): Promise<Array<{
    featureId: string;
    name: string;
    description: string;
    category: string;
    relevanceScore: number;
    userProficiency?: number;
  }>> {
    warnNotImplemented("searchFeatures");
    try {
      // TODO: Implement feature search with:
      // - Text matching
      // - Semantic similarity
      // - Personalization based on user's history

      const results: Array<{
        featureId: string;
        name: string;
        description: string;
        category: string;
        relevanceScore: number;
        userProficiency?: number;
      }> = [];

      return results;
    } catch (error) {
      logger.error("orb_search_features_failed", {
        query,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }

  /**
   * Get feature usage leaderboard (gamification)
   *
   * @deprecated Algorithm not yet implemented; always returns [].
   */
  async getLeaderboard(
    featureId?: string,
    timeframe: "day" | "week" | "month" | "all" = "week",
    limit = 10
  ): Promise<Array<{
    userId: number;
    username: string;
    usageCount: number;
    proficiencyScore: number;
    rank: number;
  }>> {
    warnNotImplemented("getLeaderboard");
    try {
      // TODO: Query aggregated usage data

      const leaderboard: Array<{
        userId: number;
        username: string;
        usageCount: number;
        proficiencyScore: number;
        rank: number;
      }> = [];

      return leaderboard;
    } catch (error) {
      logger.error("orb_get_leaderboard_failed", {
        featureId,
        timeframe,
        error: error instanceof Error ? error.message : String(error),
      });
      // L13:不再把 SQL / drizzle 原始錯誤透過 trpc 序列化丟給 client。log
      // 上一行已記完整 error,工程師查得到根因。對 client 一律回通用碼。
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "feature-discovery-failed",
      });
    }
  }
}

// Singleton instance
export const orbFeatureDiscovery = new OrbFeatureDiscovery();

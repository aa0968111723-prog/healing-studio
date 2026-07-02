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

// ─── AIDV-548 · 方案 A：頻率統計推薦引擎（純函式核心） ────────────────────────
//
// 推薦邏輯與 DB I/O 分離,核心為可單測的純函式:
//   1. 找「其他使用者常用、當前使用者還沒試過」的功能(跨用戶熱度)→ 高分推薦。
//   2. 不足額時,補上「當前使用者用得最少」的既有功能 → 鼓勵深入,低分。
// 完全加性、唯讀真實使用資料,不觸碰任何計費/扣款路徑。

export interface FeatureUsageInput {
  featureId: string;
  usageCount: number;
}

export interface FeatureGlobalPopularity {
  featureId: string;
  totalUsage: number;
  userCount: number;
}

export interface ComputedRecommendation {
  featureId: string;
  reason: string;
  relevanceScore: number;
  basedOnFeatures: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 純函式：由「當前使用者用量」＋「跨用戶功能熱度」算出前 limit 筆推薦。
 * 排序保證確定性（同分以 featureId 字典序 tiebreak），方便測試釘住。
 */
export function computeFeatureRecommendations(
  userUsage: FeatureUsageInput[],
  globalPopularity: FeatureGlobalPopularity[],
  limit: number
): ComputedRecommendation[] {
  if (limit <= 0) return [];

  const usedSet = new Set(userUsage.map((u) => u.featureId));
  const maxUserCount = Math.max(
    1,
    ...globalPopularity.map((g) => g.userCount)
  );
  const maxUserUsage = Math.max(1, ...userUsage.map((u) => u.usageCount));

  // 當前使用者最常用的功能,當作「因為你常用 X」的依據信號。
  const topUserFeatures = [...userUsage]
    .sort(
      (a, b) =>
        b.usageCount - a.usageCount || a.featureId.localeCompare(b.featureId)
    )
    .slice(0, 3)
    .map((u) => u.featureId);

  // 1) 熱門但未使用過的功能。
  const unusedPopular: ComputedRecommendation[] = globalPopularity
    .filter((g) => g.userCount > 0 && !usedSet.has(g.featureId))
    .sort(
      (a, b) =>
        b.userCount - a.userCount ||
        b.totalUsage - a.totalUsage ||
        a.featureId.localeCompare(b.featureId)
    )
    .map((g) => ({
      featureId: g.featureId,
      reason: "其他使用者常用但你還沒試過的功能",
      relevanceScore: round2(0.5 + 0.5 * (g.userCount / maxUserCount)),
      basedOnFeatures: topUserFeatures,
    }));

  // 2) 補額:當前使用者用得最少的既有功能(鼓勵再深入)。
  const recSet = new Set(unusedPopular.map((r) => r.featureId));
  const leastUsed: ComputedRecommendation[] = [...userUsage]
    .filter((u) => u.usageCount > 0 && !recSet.has(u.featureId))
    .sort(
      (a, b) =>
        a.usageCount - b.usageCount || a.featureId.localeCompare(b.featureId)
    )
    .map((u) => ({
      featureId: u.featureId,
      reason: "你較少使用,值得再深入探索的功能",
      relevanceScore: round2(0.2 + 0.3 * (1 - u.usageCount / maxUserUsage)),
      basedOnFeatures: [],
    }));

  return [...unusedPopular, ...leastUsed].slice(0, limit);
}

/**
 * 純函式：把互動型別映射成要寫回 orb_feature_recommendations 的欄位集合。
 */
export function buildInteractionUpdate(
  interactionType: "clicked" | "used" | "dismissed",
  feedbackRating: number | undefined,
  now: Date
): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (interactionType === "clicked") update.clickedAt = now;
  else if (interactionType === "used") update.usedAt = now;
  else if (interactionType === "dismissed") update.dismissedAt = now;
  if (typeof feedbackRating === "number") update.feedbackRating = feedbackRating;
  return update;
}

/**
 * 純函式：把 usage stats 列聚合成 featureId → proficiencyScore 的映射,
 * 略過 null / 無法解析的分數。供 orbConversationEnhancer.getUserStats 委派。
 */
export function toProficiencyMap(
  rows: Array<{ featureId: string; proficiencyScore: string | null }>
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of rows) {
    if (r.proficiencyScore == null) continue;
    const v = parseFloat(r.proficiencyScore);
    if (Number.isFinite(v)) map[r.featureId] = v;
  }
  return map;
}

// mysql2 driver 的 insert 結果多半是 `[{ insertId }]`,少數包裝成 `{ insertId }`。
// 兩種型態都容忍,取不到時回 0。
function readInsertId(res: unknown): number {
  const arr = res as Array<{ insertId?: number }> | { insertId?: number };
  const raw = Array.isArray(arr) ? arr[0]?.insertId : arr?.insertId;
  return Number(raw ?? 0);
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
   * Aggregate the user's per-feature proficiency scores into a
   * featureId → score map (AIDV-548). 唯讀、失敗安全（回 {}）。
   * 供 orbConversationEnhancer.getUserStats 委派,取代原本寫死的 `{}`。
   */
  async getProficiencyMap(userId: number): Promise<Record<string, number>> {
    try {
      const db = await getDb();
      if (!db) return {};
      const rows = await db
        .select({
          featureId: orbFeatureUsageStats.featureId,
          proficiencyScore: orbFeatureUsageStats.proficiencyScore,
        })
        .from(orbFeatureUsageStats)
        .where(eq(orbFeatureUsageStats.userId, userId));
      return toProficiencyMap(rows);
    } catch (error) {
      logger.error("orb_get_proficiency_map_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Generate personalized feature recommendations (AIDV-548 · 方案 A 頻率統計).
   *
   * 唯讀聚合真實使用資料（orb_feature_usage_stats）：優先推薦「跨用戶熱門
   * 但當前使用者還沒試過」的功能,不足額時補上使用者用得最少的既有功能。
   * 產出的推薦寫入 orb_feature_recommendations 以供互動追蹤,並帶回真實 DB id。
   * 純加性、失敗安全：任何錯誤（含 DB 未設定）一律降級回 []，絕不 throw。
   */
  async generateRecommendations(
    userId: number,
    limit = 5
  ): Promise<FeatureRecommendation[]> {
    try {
      const db = await getDb();
      if (!db) return [];

      // 當前使用者既有用量（唯讀）。
      const userRows = await db
        .select({
          featureId: orbFeatureUsageStats.featureId,
          usageCount: orbFeatureUsageStats.usageCount,
        })
        .from(orbFeatureUsageStats)
        .where(eq(orbFeatureUsageStats.userId, userId));

      // 跨用戶功能熱度（唯讀聚合）。sum/count 在 mysql2 可能回字串,統一數值化。
      const globalRows = await db
        .select({
          featureId: orbFeatureUsageStats.featureId,
          totalUsage: sql<number>`sum(${orbFeatureUsageStats.usageCount})`,
          userCount: sql<number>`count(distinct ${orbFeatureUsageStats.userId})`,
        })
        .from(orbFeatureUsageStats)
        .groupBy(orbFeatureUsageStats.featureId);

      const userUsage: FeatureUsageInput[] = userRows.map((r) => ({
        featureId: r.featureId,
        usageCount: Number(r.usageCount) || 0,
      }));
      const globalPopularity: FeatureGlobalPopularity[] = globalRows.map((r) => ({
        featureId: r.featureId,
        totalUsage: Number(r.totalUsage) || 0,
        userCount: Number(r.userCount) || 0,
      }));

      const computed = computeFeatureRecommendations(
        userUsage,
        globalPopularity,
        limit
      );

      // 寫入推薦以供後續互動追蹤,並回填真實自增 id。
      const now = new Date();
      const recommendations: FeatureRecommendation[] = [];
      for (const rec of computed) {
        const insertData: InsertOrbFeatureRecommendation = {
          userId,
          featureId: rec.featureId,
          reason: rec.reason,
          relevanceScore: rec.relevanceScore.toFixed(2),
          basedOnFeatures: rec.basedOnFeatures.length
            ? rec.basedOnFeatures
            : undefined,
          presentedAt: now,
        };
        const res = await db
          .insert(orbFeatureRecommendations)
          .values(insertData);
        recommendations.push({
          id: String(readInsertId(res)),
          userId,
          featureId: rec.featureId,
          reason: rec.reason,
          relevanceScore: rec.relevanceScore,
          basedOnFeatures: rec.basedOnFeatures,
          presentedAt: now,
          createdAt: now,
        });
      }

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
      // 失敗安全降級：推薦是純加性能力,失敗時回空清單,不打斷 Orb 對話。
      return [];
    }
  }

  /**
   * Record user interaction with recommendation
   */
  async recordRecommendationInteraction(
    userId: number,
    recommendationId: string,
    interactionType: "clicked" | "used" | "dismissed",
    feedbackRating?: number
  ): Promise<void> {
    try {
      const id = Number(recommendationId);
      if (!Number.isInteger(id) || id <= 0) {
        logger.warn("orb_recommendation_interaction_bad_id", {
          recommendationId,
          type: interactionType,
        });
        return;
      }

      const db = await getDb();
      if (!db) return;

      const update = buildInteractionUpdate(
        interactionType,
        feedbackRating,
        new Date()
      );

      // 所有權範圍：id 是會回傳給 client 往返的字串，UPDATE 必須以 userId 限定，
      // 防止跨用戶寫入他人的推薦互動列。
      await db
        .update(orbFeatureRecommendations)
        .set(update)
        .where(
          and(
            eq(orbFeatureRecommendations.id, id),
            eq(orbFeatureRecommendations.userId, userId)
          )
        );

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
      // Don't throw — 互動追蹤失敗不應打斷功能。
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

/**
 * server/services/orbSystemMonitor.ts
 *
 * Service for monitoring system health, spirit collaboration, and cost attribution.
 * Provides analytics and alerting for Orb system performance.
 */

import { logger } from "../_core/logger";
import { getDb } from "../db";
import {
  orbSpiritCollaborationMetrics,
  orbSystemHealthMetrics,
  orbCostAttribution,
  orbSystemAlerts,
  type InsertOrbSpiritCollaborationMetric,
  type InsertOrbSystemHealthMetric,
  type InsertOrbCostAttribution,
  type InsertOrbSystemAlert,
} from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

export type MetricType =
  | "response_time"
  | "error_rate"
  | "tool_success_rate"
  | "user_satisfaction"
  | "memory_usage"
  | "api_latency"
  | "clarification_rate";

export interface SpiritCollaborationMetric {
  id: string;
  date: Date;
  fromSpiritId: string;
  toSpiritId: string;
  handoffCount: number;
  avgHandoffTime?: number;
  successfulHandoffs: number;
  failedHandoffs: number;
  userSatisfactionScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemHealthMetric {
  id: string;
  timestamp: Date;
  metricType: MetricType;
  spiritId?: string;
  value: number;
  unit: string;
  threshold?: number;
  isHealthy: boolean;
  metadata?: Record<string, unknown>;
}

export interface CostAttribution {
  id: string;
  date: Date;
  userId: number;
  spiritId: string;
  toolName: string;
  usageCount: number;
  totalTokens?: number;
  totalApiCalls?: number;
  estimatedCostUsd?: number;
  avgDuration?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordHandoffInput {
  fromSpiritId: string;
  toSpiritId: string;
  success: boolean;
  handoffTime?: number;
  userFeedback?: number;
}

export interface RecordHealthMetricInput {
  metricType: MetricType;
  spiritId?: string;
  value: number;
  unit: string;
  threshold?: number;
  metadata?: Record<string, unknown>;
}

export interface RecordCostInput {
  userId: number;
  spiritId: string;
  toolName: string;
  tokens?: number;
  apiCalls?: number;
  estimatedCostUsd?: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export class OrbSystemMonitor {
  /**
   * Record spirit handoff for collaboration tracking
   */
  async recordHandoff(input: RecordHandoffInput): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const db = await getDb();

      if (!db) throw new Error("Database is not configured");
      // Upsert daily collaboration metric
      const existingMetric = await db
        .select()
        .from(orbSpiritCollaborationMetrics)
        .where(
          and(
            eq(orbSpiritCollaborationMetrics.date, today),
            eq(orbSpiritCollaborationMetrics.fromSpiritId, input.fromSpiritId),
            eq(orbSpiritCollaborationMetrics.toSpiritId, input.toSpiritId)
          )
        )
        .limit(1);

      if (existingMetric.length > 0) {
        const existing = existingMetric[0];
        const newHandoffCount = existing.handoffCount + 1;
        const newSuccessful = existing.successfulHandoffs + (input.success ? 1 : 0);
        const newFailed = existing.failedHandoffs + (input.success ? 0 : 1);

        // Update running average for handoff time. Decimal columns surface
        // as `string | null` from drizzle (JS can't round-trip decimals),
        // so we parseFloat to do the math then String() on the way back in.
        let newAvgHandoffTime: string | null = existing.avgHandoffTime;
        if (input.handoffTime !== undefined) {
          if (existing.avgHandoffTime === null) {
            newAvgHandoffTime = String(input.handoffTime);
          } else {
            newAvgHandoffTime = String(
              (parseFloat(existing.avgHandoffTime) * existing.handoffCount + input.handoffTime) /
                newHandoffCount
            );
          }
        }

        // Update running average for user satisfaction (same pattern).
        let newSatisfaction: string | null = existing.userSatisfactionScore;
        if (input.userFeedback !== undefined) {
          if (existing.userSatisfactionScore === null) {
            newSatisfaction = String(input.userFeedback);
          } else {
            newSatisfaction = String(
              (parseFloat(existing.userSatisfactionScore) * existing.handoffCount + input.userFeedback) /
                newHandoffCount
            );
          }
        }

        await db
          .update(orbSpiritCollaborationMetrics)
          .set({
            handoffCount: newHandoffCount,
            avgHandoffTime: newAvgHandoffTime,
            successfulHandoffs: newSuccessful,
            failedHandoffs: newFailed,
            userSatisfactionScore: newSatisfaction,
            updatedAt: new Date(),
          })
          .where(eq(orbSpiritCollaborationMetrics.id, existing.id));
      } else {
        await db.insert(orbSpiritCollaborationMetrics).values({
          date: today,
          fromSpiritId: input.fromSpiritId,
          toSpiritId: input.toSpiritId,
          handoffCount: 1,
          avgHandoffTime: input.handoffTime !== undefined ? String(input.handoffTime) : null,
          successfulHandoffs: input.success ? 1 : 0,
          failedHandoffs: input.success ? 0 : 1,
          userSatisfactionScore: input.userFeedback !== undefined ? String(input.userFeedback) : null,
        });
      }

      logger.info("orb_handoff_recorded", {
        from: input.fromSpiritId,
        to: input.toSpiritId,
        success: input.success,
      });
    } catch (error) {
      logger.error("orb_record_handoff_failed", {
        from: input.fromSpiritId,
        to: input.toSpiritId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - monitoring failures shouldn't break functionality
    }
  }

  /**
   * Record health metric
   */
  async recordHealthMetric(input: RecordHealthMetricInput): Promise<void> {
    try {
      const isHealthy = input.threshold
        ? input.value <= input.threshold
        : true;

      const db = await getDb();

      if (!db) throw new Error("Database is not configured");
      // Insert health metric (decimal columns stringified; json() column
      // is passed as object — drizzle stringifies on the way out).
      await db.insert(orbSystemHealthMetrics).values({
        timestamp: new Date(),
        metricType: input.metricType,
        spiritId: input.spiritId ?? null,
        value: String(input.value),
        unit: input.unit,
        threshold: input.threshold !== undefined ? String(input.threshold) : null,
        isHealthy,
        metadata: input.metadata ?? null,
      });

      if (!isHealthy) {
        logger.warn("orb_health_metric_unhealthy", {
          type: input.metricType,
          spiritId: input.spiritId,
          value: input.value,
          threshold: input.threshold,
        });

        // Trigger alert for unhealthy metrics
        await this.createAlert({
          alertType: input.threshold && input.value > input.threshold * 2
            ? "health_critical"
            : "health_warning",
          severity: input.threshold && input.value > input.threshold * 2
            ? "critical"
            : input.value > (input.threshold || 0) * 1.5
            ? "high"
            : "medium",
          title: `${input.metricType} threshold exceeded`,
          message: `${input.metricType} for ${input.spiritId || "system"} is ${input.value} ${input.unit}, exceeding threshold of ${input.threshold}`,
          spiritId: input.spiritId,
          metricType: input.metricType,
          metricValue: input.value,
          threshold: input.threshold,
          metadata: input.metadata,
        });
      }

      logger.debug("orb_health_metric_recorded", {
        type: input.metricType,
        value: input.value,
        healthy: isHealthy,
      });
    } catch (error) {
      logger.error("orb_record_health_metric_failed", {
        type: input.metricType,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw
    }
  }

  /**
   * Record cost attribution
   */
  async recordCost(input: RecordCostInput): Promise<void> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const db = await getDb();

      if (!db) throw new Error("Database is not configured");
      // Upsert daily cost attribution
      const existingCost = await db
        .select()
        .from(orbCostAttribution)
        .where(
          and(
            eq(orbCostAttribution.date, today),
            eq(orbCostAttribution.userId, input.userId),
            eq(orbCostAttribution.spiritId, input.spiritId),
            eq(orbCostAttribution.toolName, input.toolName)
          )
        )
        .limit(1);

      if (existingCost.length > 0) {
        const existing = existingCost[0];
        const newUsageCount = existing.usageCount + 1;
        const newTotalTokens = (existing.totalTokens ?? 0) + (input.tokens ?? 0);
        const newTotalApiCalls = (existing.totalApiCalls ?? 0) + (input.apiCalls ?? 0);
        const newEstimatedCost =
          parseFloat(existing.estimatedCostUsd ?? "0") + (input.estimatedCostUsd ?? 0);

        // Update running average for duration (decimal column → string).
        let newAvgDuration: string | null = existing.avgDuration;
        if (input.duration !== undefined) {
          if (existing.avgDuration === null) {
            newAvgDuration = String(input.duration);
          } else {
            newAvgDuration = String(
              (parseFloat(existing.avgDuration) * existing.usageCount + input.duration) /
                newUsageCount
            );
          }
        }

        await db
          .update(orbCostAttribution)
          .set({
            usageCount: newUsageCount,
            totalTokens: newTotalTokens,
            totalApiCalls: newTotalApiCalls,
            estimatedCostUsd: String(newEstimatedCost),
            avgDuration: newAvgDuration,
            metadata: input.metadata ?? existing.metadata ?? null,
            updatedAt: new Date(),
          })
          .where(eq(orbCostAttribution.id, existing.id));
      } else {
        await db.insert(orbCostAttribution).values({
          date: today,
          userId: input.userId,
          spiritId: input.spiritId,
          toolName: input.toolName,
          usageCount: 1,
          totalTokens: input.tokens ?? null,
          totalApiCalls: input.apiCalls ?? null,
          estimatedCostUsd: input.estimatedCostUsd !== undefined ? String(input.estimatedCostUsd) : null,
          avgDuration: input.duration !== undefined ? String(input.duration) : null,
          metadata: input.metadata ?? null,
        });
      }

      logger.debug("orb_cost_recorded", {
        userId: input.userId,
        spiritId: input.spiritId,
        toolName: input.toolName,
        cost: input.estimatedCostUsd,
      });
    } catch (error) {
      logger.error("orb_record_cost_failed", {
        userId: input.userId,
        spiritId: input.spiritId,
        toolName: input.toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw
    }
  }

  /**
   * Get collaboration metrics
   */
  async getCollaborationMetrics(options?: {
    spiritId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<SpiritCollaborationMetric[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query database with filters
      let query = db.select().from(orbSpiritCollaborationMetrics);

      const conditions: any[] = [];

      if (options?.spiritId) {
        conditions.push(
          sql`(${orbSpiritCollaborationMetrics.fromSpiritId} = ${options.spiritId} OR ${orbSpiritCollaborationMetrics.toSpiritId} = ${options.spiritId})`
        );
      }

      if (options?.startDate) {
        conditions.push(gte(orbSpiritCollaborationMetrics.date, options.startDate));
      }

      if (options?.endDate) {
        conditions.push(lte(orbSpiritCollaborationMetrics.date, options.endDate));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      query = query.orderBy(desc(orbSpiritCollaborationMetrics.date)) as any;

      if (options?.limit) {
        query = query.limit(options.limit) as any;
      }

      const rows = await query;

      const metrics: SpiritCollaborationMetric[] = rows.map((row: any) => ({
        id: row.id,
        date: row.date,
        fromSpiritId: row.fromSpiritId,
        toSpiritId: row.toSpiritId,
        handoffCount: row.handoffCount,
        avgHandoffTime: row.avgHandoffTime ?? undefined,
        successfulHandoffs: row.successfulHandoffs,
        failedHandoffs: row.failedHandoffs,
        userSatisfactionScore: row.userSatisfactionScore ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));

      return metrics;
    } catch (error) {
      logger.error("orb_get_collaboration_metrics_failed", {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get health metrics
   */
  async getHealthMetrics(options?: {
    metricType?: MetricType;
    spiritId?: string;
    startTime?: Date;
    endTime?: Date;
    unhealthyOnly?: boolean;
    limit?: number;
  }): Promise<SystemHealthMetric[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query database with filters
      let query = db.select().from(orbSystemHealthMetrics);

      const conditions: any[] = [];

      if (options?.metricType) {
        conditions.push(eq(orbSystemHealthMetrics.metricType, options.metricType));
      }

      if (options?.spiritId) {
        conditions.push(eq(orbSystemHealthMetrics.spiritId, options.spiritId));
      }

      if (options?.startTime) {
        conditions.push(gte(orbSystemHealthMetrics.timestamp, options.startTime));
      }

      if (options?.endTime) {
        conditions.push(lte(orbSystemHealthMetrics.timestamp, options.endTime));
      }

      if (options?.unhealthyOnly) {
        conditions.push(eq(orbSystemHealthMetrics.isHealthy, false));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      query = query.orderBy(desc(orbSystemHealthMetrics.timestamp)) as any;

      if (options?.limit) {
        query = query.limit(options.limit) as any;
      }

      const rows = await query;

      const metrics: SystemHealthMetric[] = rows.map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        metricType: row.metricType as MetricType,
        spiritId: row.spiritId ?? undefined,
        value: row.value,
        unit: row.unit,
        threshold: row.threshold ?? undefined,
        isHealthy: row.isHealthy,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }));

      return metrics;
    } catch (error) {
      logger.error("orb_get_health_metrics_failed", {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get cost breakdown
   */
  async getCostBreakdown(options: {
    userId?: number;
    spiritId?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<{
    totalCost: number;
    bySpirit: Record<string, number>;
    byTool: Record<string, number>;
    byUser?: Record<number, number>;
  }> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Query with filters
      let query = db.select().from(orbCostAttribution);

      const conditions: any[] = [];

      if (options.userId) {
        conditions.push(eq(orbCostAttribution.userId, options.userId));
      }

      if (options.spiritId) {
        conditions.push(eq(orbCostAttribution.spiritId, options.spiritId));
      }

      if (options.startDate) {
        conditions.push(gte(orbCostAttribution.date, options.startDate));
      }

      if (options.endDate) {
        conditions.push(lte(orbCostAttribution.date, options.endDate));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const rows = await query;

      // Aggregate cost data
      let totalCost = 0;
      const bySpirit: Record<string, number> = {};
      const byTool: Record<string, number> = {};
      const byUser: Record<number, number> = {};

      for (const row of rows) {
        const cost = parseFloat(row.estimatedCostUsd ?? "0");
        totalCost += cost;

        // Aggregate by spirit
        if (!bySpirit[row.spiritId]) {
          bySpirit[row.spiritId] = 0;
        }
        bySpirit[row.spiritId] += cost;

        // Aggregate by tool
        if (!byTool[row.toolName]) {
          byTool[row.toolName] = 0;
        }
        byTool[row.toolName] += cost;

        // Aggregate by user
        if (!byUser[row.userId]) {
          byUser[row.userId] = 0;
        }
        byUser[row.userId] += cost;
      }

      const breakdown = {
        totalCost,
        bySpirit,
        byTool,
        byUser: options.userId ? undefined : byUser,
      };

      return breakdown;
    } catch (error) {
      logger.error("orb_get_cost_breakdown_failed", {
        options,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get system health summary
   */
  async getHealthSummary(): Promise<{
    overallHealth: "healthy" | "warning" | "critical";
    metrics: {
      avgResponseTime: number;
      errorRate: number;
      toolSuccessRate: number;
      avgUserSatisfaction: number;
    };
    issues: Array<{
      type: MetricType;
      severity: "warning" | "critical";
      message: string;
      value: number;
      threshold: number;
    }>;
  }> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Aggregate recent health metrics (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const recentMetrics = await db
        .select()
        .from(orbSystemHealthMetrics)
        .where(gte(orbSystemHealthMetrics.timestamp, oneHourAgo));

      // Calculate aggregate metrics
      let totalResponseTime = 0;
      let responseTimeCount = 0;
      let totalErrors = 0;
      let totalAttempts = 0;
      let totalToolSuccess = 0;
      let totalToolAttempts = 0;

      for (const metric of recentMetrics) {
        const numericValue = parseFloat(metric.value);
        if (metric.metricType === "response_time") {
          totalResponseTime += numericValue;
          responseTimeCount++;
        } else if (metric.metricType === "error_rate") {
          totalErrors += numericValue;
          totalAttempts++;
        } else if (metric.metricType === "tool_success_rate") {
          totalToolSuccess += numericValue;
          totalToolAttempts++;
        }
      }

      const avgResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
      const errorRate = totalAttempts > 0 ? totalErrors / totalAttempts : 0;
      const toolSuccessRate = totalToolAttempts > 0 ? totalToolSuccess / totalToolAttempts : 1;

      // Get avg user satisfaction from collaboration metrics (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const collaborationMetrics = await db
        .select()
        .from(orbSpiritCollaborationMetrics)
        .where(gte(orbSpiritCollaborationMetrics.date, sevenDaysAgo));

      let totalSatisfaction = 0;
      let satisfactionCount = 0;
      for (const metric of collaborationMetrics) {
        if (metric.userSatisfactionScore !== null) {
          totalSatisfaction += parseFloat(metric.userSatisfactionScore);
          satisfactionCount++;
        }
      }
      const avgUserSatisfaction = satisfactionCount > 0 ? totalSatisfaction / satisfactionCount : 0;

      // Identify issues exceeding thresholds
      const issues: Array<{
        type: MetricType;
        severity: "warning" | "critical";
        message: string;
        value: number;
        threshold: number;
      }> = [];

      const unhealthyMetrics = recentMetrics.filter(m => !m.isHealthy && m.threshold !== null);
      for (const metric of unhealthyMetrics) {
        const numericValue = parseFloat(metric.value);
        const numericThreshold = parseFloat(metric.threshold!);
        const severity = numericValue > numericThreshold * 2 ? "critical" : "warning";
        issues.push({
          type: metric.metricType as MetricType,
          severity,
          message: `${metric.metricType} is ${severity}: ${metric.value} ${metric.unit} (threshold: ${metric.threshold} ${metric.unit})`,
          value: numericValue,
          threshold: numericThreshold,
        });
      }

      // Calculate overall health status
      const criticalCount = issues.filter(i => i.severity === "critical").length;
      const warningCount = issues.filter(i => i.severity === "warning").length;

      let overallHealth: "healthy" | "warning" | "critical" = "healthy";
      if (criticalCount > 0) {
        overallHealth = "critical";
      } else if (warningCount > 2) {
        overallHealth = "critical";
      } else if (warningCount > 0) {
        overallHealth = "warning";
      }

      const summary = {
        overallHealth,
        metrics: {
          avgResponseTime,
          errorRate,
          toolSuccessRate,
          avgUserSatisfaction,
        },
        issues,
      };

      return summary;
    } catch (error) {
      logger.error("orb_get_health_summary_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get most effective spirit collaborations
   */
  async getTopCollaborations(limit = 10): Promise<Array<{
    fromSpiritId: string;
    toSpiritId: string;
    totalHandoffs: number;
    successRate: number;
    avgHandoffTime: number;
    userSatisfaction: number;
  }>> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Aggregate collaboration data (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const metrics = await db
        .select()
        .from(orbSpiritCollaborationMetrics)
        .where(gte(orbSpiritCollaborationMetrics.date, thirtyDaysAgo));

      // Aggregate by spirit pair
      const collaborationMap = new Map<string, {
        fromSpiritId: string;
        toSpiritId: string;
        totalHandoffs: number;
        successfulHandoffs: number;
        failedHandoffs: number;
        totalHandoffTime: number;
        handoffTimeCount: number;
        totalSatisfaction: number;
        satisfactionCount: number;
      }>();

      for (const metric of metrics) {
        const key = `${metric.fromSpiritId}->${metric.toSpiritId}`;
        const existing = collaborationMap.get(key);

        if (existing) {
          existing.totalHandoffs += metric.handoffCount;
          existing.successfulHandoffs += metric.successfulHandoffs;
          existing.failedHandoffs += metric.failedHandoffs;
          if (metric.avgHandoffTime !== null) {
            existing.totalHandoffTime += parseFloat(metric.avgHandoffTime) * metric.handoffCount;
            existing.handoffTimeCount += metric.handoffCount;
          }
          if (metric.userSatisfactionScore !== null) {
            existing.totalSatisfaction += parseFloat(metric.userSatisfactionScore) * metric.handoffCount;
            existing.satisfactionCount += metric.handoffCount;
          }
        } else {
          collaborationMap.set(key, {
            fromSpiritId: metric.fromSpiritId,
            toSpiritId: metric.toSpiritId,
            totalHandoffs: metric.handoffCount,
            successfulHandoffs: metric.successfulHandoffs,
            failedHandoffs: metric.failedHandoffs,
            totalHandoffTime: metric.avgHandoffTime !== null ? parseFloat(metric.avgHandoffTime) * metric.handoffCount : 0,
            handoffTimeCount: metric.avgHandoffTime !== null ? metric.handoffCount : 0,
            totalSatisfaction: metric.userSatisfactionScore !== null ? parseFloat(metric.userSatisfactionScore) * metric.handoffCount : 0,
            satisfactionCount: metric.userSatisfactionScore !== null ? metric.handoffCount : 0,
          });
        }
      }

      // Convert to array and calculate averages
      const top = Array.from(collaborationMap.values())
        .map(collab => ({
          fromSpiritId: collab.fromSpiritId,
          toSpiritId: collab.toSpiritId,
          totalHandoffs: collab.totalHandoffs,
          successRate: collab.totalHandoffs > 0
            ? collab.successfulHandoffs / collab.totalHandoffs
            : 0,
          avgHandoffTime: collab.handoffTimeCount > 0
            ? collab.totalHandoffTime / collab.handoffTimeCount
            : 0,
          userSatisfaction: collab.satisfactionCount > 0
            ? collab.totalSatisfaction / collab.satisfactionCount
            : 0,
        }))
        .sort((a, b) => {
          // Sort by success rate and satisfaction
          const scoreA = a.successRate * 0.6 + a.userSatisfaction * 0.4;
          const scoreB = b.successRate * 0.6 + b.userSatisfaction * 0.4;
          return scoreB - scoreA;
        })
        .slice(0, limit);

      return top;
    } catch (error) {
      logger.error("orb_get_top_collaborations_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get cost optimization recommendations
   */
  async getCostOptimizations(): Promise<Array<{
    type: "high_cost_tool" | "inefficient_workflow" | "unused_feature";
    description: string;
    potentialSavings: number;
    recommendation: string;
  }>> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const optimizations: Array<{
        type: "high_cost_tool" | "inefficient_workflow" | "unused_feature";
        description: string;
        potentialSavings: number;
        recommendation: string;
      }> = [];

      // Get cost data for the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      // 1. Identify high-cost tools
      const costByTool = await db
        .select({
          spiritId: orbCostAttribution.spiritId,
          toolName: orbCostAttribution.toolName,
          totalCost: sql<number>`SUM(${orbCostAttribution.estimatedCostUsd})`,
          totalUsage: sql<number>`SUM(${orbCostAttribution.usageCount})`,
          avgCostPerUse: sql<number>`SUM(${orbCostAttribution.estimatedCostUsd}) / SUM(${orbCostAttribution.usageCount})`,
        })
        .from(orbCostAttribution)
        .where(gte(orbCostAttribution.date, thirtyDaysAgo))
        .groupBy(orbCostAttribution.spiritId, orbCostAttribution.toolName)
        .having(sql`SUM(${orbCostAttribution.estimatedCostUsd}) > 10`)
        .orderBy(desc(sql`SUM(${orbCostAttribution.estimatedCostUsd})`))
        .limit(10);

      for (const tool of costByTool) {
        if (tool.avgCostPerUse > 0.5) {
          // High cost per use
          optimizations.push({
            type: "high_cost_tool",
            description: `${tool.spiritId}.${tool.toolName} has high cost per use ($${tool.avgCostPerUse.toFixed(4)})`,
            potentialSavings: tool.totalCost * 0.3, // Assume 30% potential savings
            recommendation: `Review ${tool.toolName} usage patterns and consider caching, batching, or alternative implementations to reduce API calls.`,
          });
        }
      }

      // 2. Identify unused/low-usage features with cost
      const lowUsageTools = await db
        .select({
          spiritId: orbCostAttribution.spiritId,
          toolName: orbCostAttribution.toolName,
          totalCost: sql<number>`SUM(${orbCostAttribution.estimatedCostUsd})`,
          totalUsage: sql<number>`SUM(${orbCostAttribution.usageCount})`,
        })
        .from(orbCostAttribution)
        .where(gte(orbCostAttribution.date, thirtyDaysAgo))
        .groupBy(orbCostAttribution.spiritId, orbCostAttribution.toolName)
        .having(
          and(
            sql`SUM(${orbCostAttribution.estimatedCostUsd}) > 5`,
            sql`SUM(${orbCostAttribution.usageCount}) < 10`
          )
        );

      for (const tool of lowUsageTools) {
        optimizations.push({
          type: "unused_feature",
          description: `${tool.spiritId}.${tool.toolName} has low usage (${tool.totalUsage} calls) but costs $${tool.totalCost.toFixed(2)}`,
          potentialSavings: tool.totalCost,
          recommendation: `Consider disabling or optimizing ${tool.toolName} as it has minimal usage but incurs costs.`,
        });
      }

      // 3. Identify cost spikes (tools with increasing costs)
      const recentWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      recentWeek.setHours(0, 0, 0, 0);
      const previousWeek = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      previousWeek.setHours(0, 0, 0, 0);

      const recentCosts = await db
        .select({
          spiritId: orbCostAttribution.spiritId,
          toolName: orbCostAttribution.toolName,
          totalCost: sql<number>`SUM(${orbCostAttribution.estimatedCostUsd})`,
        })
        .from(orbCostAttribution)
        .where(gte(orbCostAttribution.date, recentWeek))
        .groupBy(orbCostAttribution.spiritId, orbCostAttribution.toolName);

      const previousCosts = await db
        .select({
          spiritId: orbCostAttribution.spiritId,
          toolName: orbCostAttribution.toolName,
          totalCost: sql<number>`SUM(${orbCostAttribution.estimatedCostUsd})`,
        })
        .from(orbCostAttribution)
        .where(
          and(
            gte(orbCostAttribution.date, previousWeek),
            lte(orbCostAttribution.date, recentWeek)
          )
        )
        .groupBy(orbCostAttribution.spiritId, orbCostAttribution.toolName);

      // Compare costs
      const costMap = new Map<string, { recent: number; previous: number }>();
      for (const cost of recentCosts) {
        const key = `${cost.spiritId}:${cost.toolName}`;
        costMap.set(key, { recent: cost.totalCost, previous: 0 });
      }
      for (const cost of previousCosts) {
        const key = `${cost.spiritId}:${cost.toolName}`;
        const existing = costMap.get(key);
        if (existing) {
          existing.previous = cost.totalCost;
        } else {
          costMap.set(key, { recent: 0, previous: cost.totalCost });
        }
      }

      for (const [key, costs] of costMap.entries()) {
        if (costs.previous > 0 && costs.recent > costs.previous * 1.5) {
          // Cost increased by more than 50%
          const [spiritId, toolName] = key.split(':');
          const increase = costs.recent - costs.previous;
          optimizations.push({
            type: "inefficient_workflow",
            description: `${spiritId}.${toolName} cost increased ${((costs.recent / costs.previous - 1) * 100).toFixed(0)}% (from $${costs.previous.toFixed(2)} to $${costs.recent.toFixed(2)})`,
            potentialSavings: increase * 0.5,
            recommendation: `Investigate recent changes to ${toolName} that may have increased costs. Look for inefficient retry loops or increased usage patterns.`,
          });
        }
      }

      // Sort by potential savings
      optimizations.sort((a, b) => b.potentialSavings - a.potentialSavings);

      logger.info("orb_cost_optimizations_analyzed", {
        optimizationsFound: optimizations.length,
        totalPotentialSavings: optimizations.reduce((sum, o) => sum + o.potentialSavings, 0),
      });

      return optimizations;
    } catch (error) {
      logger.error("orb_get_cost_optimizations_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get performance trends
   */
  async getPerformanceTrends(
    metricType: MetricType,
    spiritId?: string,
    days = 7
  ): Promise<Array<{
    date: Date;
    avgValue: number;
    minValue: number;
    maxValue: number;
    sampleCount: number;
  }>> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Aggregate metrics by day
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      // Build the WHERE clause once so we don't chain .where() twice on a
      // narrowed select type (drizzle's builder type changes after the
      // first .where call, which trips tsc).
      const whereClause = spiritId
        ? and(
            eq(orbSystemHealthMetrics.metricType, metricType),
            eq(orbSystemHealthMetrics.spiritId, spiritId),
            gte(orbSystemHealthMetrics.timestamp, startDate)
          )
        : and(
            eq(orbSystemHealthMetrics.metricType, metricType),
            gte(orbSystemHealthMetrics.timestamp, startDate)
          );

      const metrics = await db
        .select()
        .from(orbSystemHealthMetrics)
        .where(whereClause);

      // Group by day
      const dayMap = new Map<string, {
        date: Date;
        values: number[];
      }>();

      for (const metric of metrics) {
        const date = new Date(metric.timestamp);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().slice(0, 10);

        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, { date, values: [] });
        }
        dayMap.get(dateKey)!.values.push(parseFloat(metric.value));
      }

      // Calculate aggregates for each day
      const trends = Array.from(dayMap.values())
        .map(day => {
          const values = day.values;
          const sum = values.reduce((a, b) => a + b, 0);
          return {
            date: day.date,
            avgValue: sum / values.length,
            minValue: Math.min(...values),
            maxValue: Math.max(...values),
            sampleCount: values.length,
          };
        })
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return trends;
    } catch (error) {
      logger.error("orb_get_performance_trends_failed", {
        metricType,
        spiritId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate daily summary report
   */
  async generateDailySummary(date?: Date): Promise<{
    date: Date;
    totalHandoffs: number;
    successRate: number;
    avgResponseTime: number;
    totalCost: number;
    topIssues: string[];
    recommendations: string[];
  }> {
    try {
      const targetDate = date ?? new Date();
      targetDate.setHours(0, 0, 0, 0);

      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const db = await getDb();

      if (!db) throw new Error("Database is not configured");
      // Aggregate all metrics for the day

      // Get collaboration metrics
      const collaborationMetrics = await db
        .select()
        .from(orbSpiritCollaborationMetrics)
        .where(eq(orbSpiritCollaborationMetrics.date, targetDate));

      let totalHandoffs = 0;
      let successfulHandoffs = 0;
      let failedHandoffs = 0;

      for (const metric of collaborationMetrics) {
        totalHandoffs += metric.handoffCount;
        successfulHandoffs += metric.successfulHandoffs;
        failedHandoffs += metric.failedHandoffs;
      }

      const successRate = totalHandoffs > 0 ? successfulHandoffs / totalHandoffs : 0;

      // Get health metrics
      const healthMetrics = await db
        .select()
        .from(orbSystemHealthMetrics)
        .where(
          and(
            gte(orbSystemHealthMetrics.timestamp, targetDate),
            lte(orbSystemHealthMetrics.timestamp, nextDay)
          )
        );

      let totalResponseTime = 0;
      let responseTimeCount = 0;
      const unhealthyMetrics = [];

      for (const metric of healthMetrics) {
        if (metric.metricType === "response_time") {
          totalResponseTime += parseFloat(metric.value);
          responseTimeCount++;
        }
        if (!metric.isHealthy) {
          unhealthyMetrics.push(metric);
        }
      }

      const avgResponseTime = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;

      // Get cost data
      const costMetrics = await db
        .select()
        .from(orbCostAttribution)
        .where(eq(orbCostAttribution.date, targetDate));

      let totalCost = 0;
      for (const cost of costMetrics) {
        totalCost += parseFloat(cost.estimatedCostUsd ?? "0");
      }

      // Identify top issues
      const topIssues = unhealthyMetrics
        .slice(0, 5)
        .map(m => `${m.metricType}: ${m.value} ${m.unit}`);

      // Generate recommendations
      const recommendations: string[] = [];

      if (successRate < 0.9 && totalHandoffs > 0) {
        recommendations.push("Consider reviewing spirit handoff logic - success rate is below 90%");
      }

      if (avgResponseTime > 5000) {
        recommendations.push("Response times are elevated - consider performance optimization");
      }

      if (unhealthyMetrics.length > 10) {
        recommendations.push("Multiple health metrics are unhealthy - investigate system load");
      }

      if (totalCost > 100) {
        recommendations.push("Daily costs are high - review cost optimization opportunities");
      }

      const summary = {
        date: targetDate,
        totalHandoffs,
        successRate,
        avgResponseTime,
        totalCost,
        topIssues,
        recommendations,
      };

      logger.info("orb_daily_summary_generated", {
        date: targetDate.toISOString(),
      });

      return summary;
    } catch (error) {
      logger.error("orb_generate_daily_summary_failed", {
        date,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set up automatic monitoring (to be called on system startup)
   */
  setupAutomaticMonitoring(): void {
    // Setup periodic background monitoring tasks
    // Note: In production, these would be scheduled using cron/scheduler service
    // For now, we log the intent and document the required tasks

    logger.info("orb_automatic_monitoring_setup", {
      tasks: [
        "Record system health metrics every minute",
        "Generate daily summaries at midnight",
        "Check for critical issues every 5 minutes",
        "Clean up old metric data weekly",
      ],
      note: "Integrate with job scheduler (e.g., node-cron, Bull) in production",
    });

    // Example integration points:
    // 1. Schedule health check: Every 1 minute
    //    - Call recordHealthMetric() for each spirit
    //    - Check error rates, response times, etc.
    //
    // 2. Schedule daily summary: Every day at 00:00
    //    - Call getDailySummary() for previous day
    //    - Store or send summary report
    //
    // 3. Schedule cleanup: Every Sunday at 02:00
    //    - Delete metrics older than 90 days
    //    - Archive cost data older than 1 year
    //
    // 4. Schedule alert check: Every 5 minutes
    //    - Query unresolved alerts
    //    - Escalate critical alerts that remain unresolved
  }

  /**
   * Create a system alert
   */
  async createAlert(input: {
    alertType: "health_critical" | "health_warning" | "cost_spike" | "performance_degradation" | "error_rate_high" | "system_overload";
    severity: "low" | "medium" | "high" | "critical";
    title: string;
    message: string;
    spiritId?: string;
    metricType?: string;
    metricValue?: number;
    threshold?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      await db.insert(orbSystemAlerts).values({
        alertType: input.alertType,
        severity: input.severity,
        title: input.title,
        message: input.message,
        spiritId: input.spiritId,
        metricType: input.metricType,
        metricValue: input.metricValue?.toString() ?? null,
        threshold: input.threshold?.toString() ?? null,
        metadata: input.metadata ?? null,
        isResolved: false,
      });

      logger.warn("orb_alert_created", {
        type: input.alertType,
        severity: input.severity,
        title: input.title,
        spiritId: input.spiritId,
      });
    } catch (error) {
      logger.error("orb_create_alert_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get unresolved alerts
   */
  async getUnresolvedAlerts(
    severityFilter?: "low" | "medium" | "high" | "critical"
  ): Promise<Array<{
    id: number;
    alertType: string;
    severity: string;
    title: string;
    message: string;
    spiritId?: string;
    metricType?: string;
    createdAt: Date;
  }>> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const conditions = [eq(orbSystemAlerts.isResolved, false)];
      if (severityFilter) {
        conditions.push(eq(orbSystemAlerts.severity, severityFilter));
      }

      const alerts = await db
        .select()
        .from(orbSystemAlerts)
        .where(and(...conditions))
        .orderBy(desc(orbSystemAlerts.createdAt))
        .limit(100);

      return alerts.map(alert => ({
        id: Number(alert.id),
        alertType: alert.alertType,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        spiritId: alert.spiritId || undefined,
        metricType: alert.metricType || undefined,
        createdAt: alert.createdAt,
      }));
    } catch (error) {
      logger.error("orb_get_alerts_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(
    alertId: number,
    resolvedBy?: number,
    resolutionNotes?: string
  ): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      await db
        .update(orbSystemAlerts)
        .set({
          isResolved: true,
          resolvedAt: sql`CURRENT_TIMESTAMP`,
          resolvedBy,
          resolutionNotes,
        })
        .where(eq(orbSystemAlerts.id, alertId));

      logger.info("orb_alert_resolved", { alertId, resolvedBy });
    } catch (error) {
      logger.error("orb_resolve_alert_failed", {
        alertId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if system is healthy
   */
  async isSystemHealthy(): Promise<boolean> {
    try {
      const summary = await this.getHealthSummary();
      return summary.overallHealth === "healthy";
    } catch (error) {
      logger.error("orb_is_system_healthy_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

// Singleton instance
export const orbSystemMonitor = new OrbSystemMonitor();

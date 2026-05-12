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
  type InsertOrbSpiritCollaborationMetric,
  type InsertOrbSystemHealthMetric,
  type InsertOrbCostAttribution,
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

      const db = getDb();

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

        // Update running average for handoff time
        let newAvgHandoffTime = existing.avgHandoffTime;
        if (input.handoffTime !== undefined) {
          if (existing.avgHandoffTime === null) {
            newAvgHandoffTime = input.handoffTime;
          } else {
            newAvgHandoffTime =
              (existing.avgHandoffTime * existing.handoffCount + input.handoffTime) /
              newHandoffCount;
          }
        }

        // Update running average for user satisfaction
        let newSatisfaction = existing.userSatisfactionScore;
        if (input.userFeedback !== undefined) {
          if (existing.userSatisfactionScore === null) {
            newSatisfaction = input.userFeedback;
          } else {
            newSatisfaction =
              (existing.userSatisfactionScore * existing.handoffCount + input.userFeedback) /
              newHandoffCount;
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
          avgHandoffTime: input.handoffTime ?? null,
          successfulHandoffs: input.success ? 1 : 0,
          failedHandoffs: input.success ? 0 : 1,
          userSatisfactionScore: input.userFeedback ?? null,
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

      const db = getDb();

      // Insert health metric
      await db.insert(orbSystemHealthMetrics).values({
        timestamp: new Date(),
        metricType: input.metricType,
        spiritId: input.spiritId ?? null,
        value: input.value,
        unit: input.unit,
        threshold: input.threshold ?? null,
        isHealthy,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      });

      if (!isHealthy) {
        logger.warn("orb_health_metric_unhealthy", {
          type: input.metricType,
          spiritId: input.spiritId,
          value: input.value,
          threshold: input.threshold,
        });

        // TODO: Trigger alerts if needed
        // This would integrate with an alerting system in production
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

      const db = getDb();

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
        const newEstimatedCost = (existing.estimatedCostUsd ?? 0) + (input.estimatedCostUsd ?? 0);

        // Update running average for duration
        let newAvgDuration = existing.avgDuration;
        if (input.duration !== undefined) {
          if (existing.avgDuration === null) {
            newAvgDuration = input.duration;
          } else {
            newAvgDuration =
              (existing.avgDuration * existing.usageCount + input.duration) /
              newUsageCount;
          }
        }

        await db
          .update(orbCostAttribution)
          .set({
            usageCount: newUsageCount,
            totalTokens: newTotalTokens,
            totalApiCalls: newTotalApiCalls,
            estimatedCostUsd: newEstimatedCost,
            avgDuration: newAvgDuration,
            metadata: input.metadata ? JSON.stringify(input.metadata) : existing.metadata,
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
          estimatedCostUsd: input.estimatedCostUsd ?? null,
          avgDuration: input.duration ?? null,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
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
      const db = getDb();

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
      const db = getDb();

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
      const db = getDb();

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
        const cost = row.estimatedCostUsd ?? 0;
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
      const db = getDb();

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
        if (metric.metricType === "response_time") {
          totalResponseTime += metric.value;
          responseTimeCount++;
        } else if (metric.metricType === "error_rate") {
          totalErrors += metric.value;
          totalAttempts++;
        } else if (metric.metricType === "tool_success_rate") {
          totalToolSuccess += metric.value;
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
          totalSatisfaction += metric.userSatisfactionScore;
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
        const severity = metric.value > (metric.threshold! * 2) ? "critical" : "warning";
        issues.push({
          type: metric.metricType as MetricType,
          severity,
          message: `${metric.metricType} is ${severity}: ${metric.value} ${metric.unit} (threshold: ${metric.threshold} ${metric.unit})`,
          value: metric.value,
          threshold: metric.threshold!,
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
      const db = getDb();

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
            existing.totalHandoffTime += metric.avgHandoffTime * metric.handoffCount;
            existing.handoffTimeCount += metric.handoffCount;
          }
          if (metric.userSatisfactionScore !== null) {
            existing.totalSatisfaction += metric.userSatisfactionScore * metric.handoffCount;
            existing.satisfactionCount += metric.handoffCount;
          }
        } else {
          collaborationMap.set(key, {
            fromSpiritId: metric.fromSpiritId,
            toSpiritId: metric.toSpiritId,
            totalHandoffs: metric.handoffCount,
            successfulHandoffs: metric.successfulHandoffs,
            failedHandoffs: metric.failedHandoffs,
            totalHandoffTime: metric.avgHandoffTime !== null ? metric.avgHandoffTime * metric.handoffCount : 0,
            handoffTimeCount: metric.avgHandoffTime !== null ? metric.handoffCount : 0,
            totalSatisfaction: metric.userSatisfactionScore !== null ? metric.userSatisfactionScore * metric.handoffCount : 0,
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
      // TODO: Analyze cost data
      // TODO: Identify optimization opportunities:
      // - High-cost tools with low success rate
      // - Inefficient workflows (many retries)
      // - Features with high cost but low usage
      // - Alternative lower-cost tools

      const optimizations: Array<{
        type: "high_cost_tool" | "inefficient_workflow" | "unused_feature";
        description: string;
        potentialSavings: number;
        recommendation: string;
      }> = [];

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
      const db = getDb();

      // Aggregate metrics by day
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      startDate.setHours(0, 0, 0, 0);

      let query = db
        .select()
        .from(orbSystemHealthMetrics)
        .where(
          and(
            eq(orbSystemHealthMetrics.metricType, metricType),
            gte(orbSystemHealthMetrics.timestamp, startDate)
          )
        );

      if (spiritId) {
        query = query.where(
          and(
            eq(orbSystemHealthMetrics.metricType, metricType),
            eq(orbSystemHealthMetrics.spiritId, spiritId),
            gte(orbSystemHealthMetrics.timestamp, startDate)
          )
        ) as any;
      }

      const metrics = await query;

      // Group by day
      const dayMap = new Map<string, {
        date: Date;
        values: number[];
      }>();

      for (const metric of metrics) {
        const date = new Date(metric.timestamp);
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().split('T')[0];

        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, { date, values: [] });
        }
        dayMap.get(dateKey)!.values.push(metric.value);
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

      const db = getDb();

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
          totalResponseTime += metric.value;
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
        totalCost += cost.estimatedCostUsd ?? 0;
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
    // TODO: Set up periodic tasks:
    // - Record system health metrics every minute
    // - Generate daily summaries
    // - Send alerts for critical issues
    // - Clean up old metric data

    logger.info("orb_automatic_monitoring_setup");
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

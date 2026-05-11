/**
 * server/services/spiritTools/systemMonitorTools.ts
 *
 * Tools for system-monitor spirit to access monitoring and analytics.
 * Handles health metrics, cost analysis, and performance tracking.
 */

import { logger } from "../../_core/logger";
import { orbSystemMonitor } from "../orbSystemMonitor";

/**
 * Get system health summary
 */
export async function getHealthSummary(): Promise<{
  success: boolean;
  summary?: {
    overallHealth: "healthy" | "warning" | "critical";
    metrics: {
      avgResponseTime: number;
      errorRate: number;
      toolSuccessRate: number;
      avgUserSatisfaction: number;
    };
    issues: Array<{
      type: string;
      severity: string;
      message: string;
    }>;
  };
  message: string;
}> {
  try {
    const summary = await orbSystemMonitor.getHealthSummary();

    return {
      success: true,
      summary,
      message: "系統健康狀態已更新",
    };
  } catch (error) {
    logger.error("system_monitor_health_summary_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `取得失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get cost breakdown and optimization recommendations
 */
export async function getCostAnalysis(input: {
  userId?: number;
  startDate?: string;
  endDate?: string;
}): Promise<{
  success: boolean;
  breakdown?: {
    totalCost: number;
    bySpirit: Record<string, number>;
    byTool: Record<string, number>;
  };
  optimizations?: Array<{
    type: string;
    description: string;
    potentialSavings: number;
    recommendation: string;
  }>;
  message: string;
}> {
  try {
    const startDate = input.startDate ? new Date(input.startDate) : undefined;
    const endDate = input.endDate ? new Date(input.endDate) : undefined;

    const breakdown = await orbSystemMonitor.getCostBreakdown({
      userId: input.userId,
      startDate,
      endDate,
    });

    const optimizations = await orbSystemMonitor.getCostOptimizations();

    return {
      success: true,
      breakdown,
      optimizations,
      message: "成本分析已完成",
    };
  } catch (error) {
    logger.error("system_monitor_cost_analysis_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `分析失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get spirit collaboration effectiveness
 */
export async function getCollaborationStats(): Promise<{
  success: boolean;
  topCollaborations?: Array<{
    fromSpiritId: string;
    toSpiritId: string;
    totalHandoffs: number;
    successRate: number;
    userSatisfaction: number;
  }>;
  message: string;
}> {
  try {
    const topCollaborations = await orbSystemMonitor.getTopCollaborations(10);

    return {
      success: true,
      topCollaborations,
      message: "協作統計已更新",
    };
  } catch (error) {
    logger.error("system_monitor_collaboration_stats_failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `取得失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get performance trends
 */
export async function getPerformanceTrends(input: {
  metricType: "response_time" | "error_rate" | "tool_success_rate" | "user_satisfaction";
  spiritId?: string;
  days?: number;
}): Promise<{
  success: boolean;
  trends?: Array<{
    date: string;
    avgValue: number;
    minValue: number;
    maxValue: number;
  }>;
  message: string;
}> {
  try {
    const trends = await orbSystemMonitor.getPerformanceTrends(
      input.metricType,
      input.spiritId,
      input.days ?? 7
    );

    return {
      success: true,
      trends: trends.map(t => ({
        date: t.date.toISOString(),
        avgValue: t.avgValue,
        minValue: t.minValue,
        maxValue: t.maxValue,
      })),
      message: "效能趨勢已載入",
    };
  } catch (error) {
    logger.error("system_monitor_performance_trends_failed", {
      metricType: input.metricType,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `載入失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * server/services/orbConversationEnhancer.ts
 *
 * Enhances Orb conversations with advanced features:
 * - Long-term memory integration
 * - Intent identification and clarification
 * - Feature usage tracking
 * - Cost attribution
 * - System health monitoring
 */

import { logger } from "../_core/logger";
import { orbLongTermMemory } from "./orbLongTermMemory";
import { orbClarificationEngine } from "./orbClarificationEngine";
import { orbFeatureDiscovery } from "./orbFeatureDiscovery";
import { orbSystemMonitor } from "./orbSystemMonitor";

export interface ConversationTurn {
  conversationId: string;
  userId: number;
  userInput: string;
  orbResponse?: string;
  spiritId?: string;
  toolsUsed?: Array<{
    toolName: string;
    success: boolean;
    duration?: number;
    tokens?: number;
    cost?: number;
  }>;
  context?: Record<string, unknown>;
}

export interface EnhancedConversationResult {
  // Original response
  response: string;

  // Enhanced features
  intentLog?: {
    id: string;
    primaryIntent?: string;
    confidence?: number;
    needsClarification: boolean;
  };
  clarificationQuestion?: {
    id: string;
    question: string;
    options?: Array<{ value: string; label: string; description?: string }>;
  };
  memoriesCreated?: number;
  featureRecommendations?: Array<{
    featureId: string;
    reason: string;
    relevanceScore: number;
  }>;
  systemHealth?: {
    isHealthy: boolean;
    responseTime: number;
  };
}

export class OrbConversationEnhancer {
  /**
   * Process a conversation turn with all enhancements
   */
  async processConversationTurn(
    turn: ConversationTurn
  ): Promise<EnhancedConversationResult> {
    const startTime = Date.now();
    const result: EnhancedConversationResult = {
      response: turn.orbResponse ?? "",
    };

    try {
      // 1. Identify intent and check if clarification needed
      const intentLog = await orbClarificationEngine.identifyIntent({
        userId: turn.userId,
        conversationId: turn.conversationId,
        userInput: turn.userInput,
        context: turn.context,
      });

      result.intentLog = {
        id: intentLog.id,
        primaryIntent: intentLog.primaryIntent,
        confidence: intentLog.intentConfidence,
        needsClarification: intentLog.needsClarification,
      };

      // 2. Generate clarification question if needed
      if (intentLog.needsClarification) {
        const clarification = await orbClarificationEngine.generateClarification(
          intentLog
        );

        if (clarification) {
          result.clarificationQuestion = {
            id: clarification.id,
            question: clarification.clarificationQuestion,
            options: clarification.options,
          };
        }
      }

      // 3. Extract and store important memories from conversation
      const memoriesCreated = await this.extractAndStoreMemories(turn);
      if (memoriesCreated > 0) {
        result.memoriesCreated = memoriesCreated;
      }

      // 4. Track feature usage
      if (turn.toolsUsed && turn.toolsUsed.length > 0) {
        await this.trackFeatureUsage(turn);
      }

      // 5. M9 修復:Feature recommendations 暫停。生產的 generateRecommendations
      // 是 TODO 實作(只 return [] 不做事),原本 10% 機率呼叫只是花 CPU
      // 跑空函式 + 製造 telemetry 雜訊。等推薦演算法真的實作後,移除這
      // 個 @ts-expect 區塊把呼叫加回來。
      // 之前的 call site 保留在 git history 內(orbConversationEnhancer.ts
      // 第 116-130 行,7afaeb / fd68364 之前的 commit)方便日後對照。

      // 6. Record system health metrics
      const responseTime = Date.now() - startTime;
      await orbSystemMonitor.recordHealthMetric({
        metricType: "response_time",
        spiritId: turn.spiritId,
        value: responseTime,
        unit: "ms",
        threshold: 5000, // 5 seconds
      });

      const isHealthy = await orbSystemMonitor.isSystemHealthy();
      result.systemHealth = {
        isHealthy,
        responseTime,
      };

      logger.info("orb_conversation_enhanced", {
        conversationId: turn.conversationId,
        userId: turn.userId,
        memoriesCreated,
        hasRecommendations: !!result.featureRecommendations,
        responseTime,
      });

      return result;
    } catch (error) {
      logger.error("orb_conversation_enhance_failed", {
        conversationId: turn.conversationId,
        userId: turn.userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return partial result even on error
      return result;
    }
  }

  /**
   * Extract important information and store as long-term memories
   */
  private async extractAndStoreMemories(
    turn: ConversationTurn
  ): Promise<number> {
    try {
      let created = 0;

      // Extract user facts (simple pattern matching - could be enhanced with LLM)
      const userFactPatterns = [
        /我(?:是|叫|的名字是)\s*([^\s,，。！？]+)/,
        /我(?:住在|來自)\s*([^\s,，。！？]+)/,
        /我(?:喜歡|擅長)\s*([^\s,，。！？]+)/,
      ];

      for (const pattern of userFactPatterns) {
        const match = turn.userInput.match(pattern);
        if (match) {
          await orbLongTermMemory.create({
            userId: turn.userId,
            memoryType: "user_fact",
            content: match[0],
            importanceScore: 0.7,
            sourceType: "conversation",
            sourceId: turn.conversationId,
            spiritId: turn.spiritId,
          });
          created++;
        }
      }

      // Extract preferences
      const preferencePatterns = [
        /我(?:想要|希望|傾向)\s*([^\s,，。！？]+)/,
        /我(?:不要|不想|不喜歡)\s*([^\s,，。！？]+)/,
      ];

      for (const pattern of preferencePatterns) {
        const match = turn.userInput.match(pattern);
        if (match) {
          await orbLongTermMemory.create({
            userId: turn.userId,
            memoryType: "user_preference",
            content: match[0],
            importanceScore: 0.6,
            sourceType: "conversation",
            sourceId: turn.conversationId,
            spiritId: turn.spiritId,
          });
          created++;
        }
      }

      // Store successful workflow patterns
      if (turn.toolsUsed && turn.toolsUsed.length > 1) {
        const successfulTools = turn.toolsUsed.filter(t => t.success);
        if (successfulTools.length > 1) {
          await orbLongTermMemory.create({
            userId: turn.userId,
            memoryType: "workflow_pattern",
            content: `成功的工具序列: ${successfulTools.map(t => t.toolName).join(" → ")}`,
            importanceScore: 0.5,
            sourceType: "observation",
            sourceId: turn.conversationId,
            spiritId: turn.spiritId,
            metadata: {
              toolSequence: successfulTools.map(t => t.toolName),
            },
          });
          created++;
        }
      }

      return created;
    } catch (error) {
      logger.error("orb_extract_memories_failed", {
        conversationId: turn.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Track feature usage and costs
   */
  private async trackFeatureUsage(turn: ConversationTurn): Promise<void> {
    if (!turn.toolsUsed) return;

    try {
      for (const tool of turn.toolsUsed) {
        // Record feature usage
        await orbFeatureDiscovery.recordUsage({
          userId: turn.userId,
          featureId: tool.toolName,
          success: tool.success,
          duration: tool.duration,
        });

        // Record cost attribution
        if (tool.tokens || tool.cost) {
          await orbSystemMonitor.recordCost({
            userId: turn.userId,
            spiritId: turn.spiritId ?? "unknown",
            toolName: tool.toolName,
            tokens: tool.tokens,
            estimatedCostUsd: tool.cost,
            duration: tool.duration,
          });
        }
      }
    } catch (error) {
      logger.error("orb_track_feature_usage_failed", {
        conversationId: turn.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record spirit handoff for collaboration tracking
   */
  async recordHandoff(
    conversationId: string,
    fromSpiritId: string,
    toSpiritId: string,
    success: boolean,
    handoffTime?: number,
    userFeedback?: number
  ): Promise<void> {
    try {
      await orbSystemMonitor.recordHandoff({
        fromSpiritId,
        toSpiritId,
        success,
        handoffTime,
        userFeedback,
      });

      logger.info("orb_handoff_recorded", {
        conversationId,
        from: fromSpiritId,
        to: toSpiritId,
        success,
      });
    } catch (error) {
      logger.error("orb_record_handoff_failed", {
        conversationId,
        from: fromSpiritId,
        to: toSpiritId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record user answer to clarification question
   */
  async recordClarificationAnswer(
    clarificationId: string,
    userAnswer: string,
    userId: number
  ): Promise<void> {
    try {
      // AIDV-780：userId 下傳 engine 做擁有者圈定（IDOR 修補）
      await orbClarificationEngine.recordAnswer(
        clarificationId,
        userAnswer,
        userId
      );

      logger.info("orb_clarification_answered", {
        clarificationId,
      });
    } catch (error) {
      logger.error("orb_record_clarification_answer_failed", {
        clarificationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get relevant memories for conversation context
   */
  async getRelevantMemories(
    userId: number,
    query: string,
    limit = 5
  ): Promise<Array<{
    content: string;
    type: string;
    relevanceScore: number;
  }>> {
    try {
      const results = await orbLongTermMemory.search({
        userId,
        query,
        limit,
        minImportance: 0.3,
      });

      return results.map(r => ({
        content: r.memory.content,
        type: r.memory.memoryType,
        relevanceScore: r.relevanceScore,
      }));
    } catch (error) {
      logger.error("orb_get_relevant_memories_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get user statistics summary
   */
  async getUserStats(userId: number): Promise<{
    memories: {
      total: number;
      byType: Record<string, number>;
    };
    features: {
      discovered: number;
      used: number;
      proficiency: Record<string, number>;
    };
    clarifications: {
      total: number;
      answerRate: number;
      learningProgress: number;
    };
  }> {
    try {
      const memoryStats = await orbLongTermMemory.getStats(userId);
      const discoveryInsights = await orbFeatureDiscovery.getDiscoveryInsights(
        userId
      );
      const clarificationStats = await orbClarificationEngine.getStats(userId);

      return {
        memories: {
          total: memoryStats.totalMemories,
          byType: memoryStats.byType,
        },
        features: {
          discovered: discoveryInsights.totalFeaturesDiscovered,
          used: discoveryInsights.totalFeaturesUsed,
          proficiency: {}, // TODO: Aggregate proficiency scores
        },
        clarifications: {
          total: clarificationStats.totalClarifications,
          answerRate: clarificationStats.answerRate,
          learningProgress: clarificationStats.learningProgress,
        },
      };
    } catch (error) {
      logger.error("orb_get_user_stats_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Singleton instance
export const orbConversationEnhancer = new OrbConversationEnhancer();

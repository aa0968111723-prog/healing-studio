/**
 * server/services/spiritMemoryManager.ts
 *
 * MEMORY TIER: C — Persistent / cross-session memory (per-spirit learning).
 * Spirit memory and learning system. Enables each spirit to:
 * - Persist learned patterns, preferences, and context
 * - Retrieve relevant memories when activated
 * - Improve confidence scores based on usage success
 * - Provide personalized responses based on user history
 *
 * Memory types:
 * - preference: User preferences (e.g., "user prefers cinematic style")
 * - pattern: Learned behavioral patterns (e.g., "user often requests 9:16 format")
 * - context: Session context (e.g., "working on brand campaign X")
 * - feedback: User feedback on spirit performance (e.g., "accepted suggestion")
 *
 * 詳見 `server/services/memory/MEMORY_TIERS.md`。
 */

import type { AgentRole } from "../../shared/orb-agent-roles";
import { SpiritMemoryRepository } from "../repositories/mysql/SpiritMemoryRepository.mysql";
import { logger } from "../_core/logger";

export type SpiritMemoryType = "preference" | "pattern" | "context" | "feedback";

export interface SpiritMemory {
  id: number;
  userId: number;
  agentId: AgentRole;
  memoryType: SpiritMemoryType;
  memoryKey: string;
  memoryValue: unknown;
  confidence: number; // 0.00 - 1.00
  usageCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordMemoryInput {
  userId: number;
  agentId: AgentRole;
  memoryType: SpiritMemoryType;
  memoryKey: string;
  memoryValue: unknown;
  initialConfidence?: number;
}

export interface RetrieveMemoriesInput {
  userId: number;
  agentId: AgentRole;
  memoryType?: SpiritMemoryType;
  limit?: number;
  minConfidence?: number;
}

export interface UpdateConfidenceInput {
  userId: number;
  agentId: AgentRole;
  memoryKey: string;
  success: boolean; // If memory was successfully used
  weight?: number; // How much to adjust confidence (default: 0.1)
}

class SpiritMemoryManagerClass {
  private repository: SpiritMemoryRepository;

  constructor() {
    this.repository = new SpiritMemoryRepository();
  }

  /**
   * Record a new memory or update existing one.
   * If memory with same key exists, updates value and increments confidence.
   */
  async recordMemory(input: RecordMemoryInput): Promise<SpiritMemory> {
    try {
      const existing = await this.repository.findByKey({
        userId: input.userId,
        agentId: input.agentId,
        memoryKey: input.memoryKey,
      });

      if (existing) {
        // Update existing memory
        const updated = await this.repository.update({
          id: existing.id,
          memoryValue: input.memoryValue,
          confidence: Math.min(1.0, existing.confidence + 0.05), // Slight confidence boost
          usageCount: existing.usageCount + 1,
          lastUsedAt: new Date(),
        });

        logger.debug("spirit_memory_updated", {
          agentId: input.agentId,
          userId: input.userId,
          memoryKey: input.memoryKey,
          newConfidence: updated.confidence,
        });

        return updated;
      } else {
        // Create new memory
        const memory = await this.repository.create({
          userId: input.userId,
          agentId: input.agentId,
          memoryType: input.memoryType,
          memoryKey: input.memoryKey,
          memoryValue: input.memoryValue,
          confidence: input.initialConfidence ?? 0.5,
          usageCount: 1,
        });

        logger.debug("spirit_memory_created", {
          agentId: input.agentId,
          userId: input.userId,
          memoryKey: input.memoryKey,
          memoryType: input.memoryType,
        });

        return memory;
      }
    } catch (error) {
      logger.error("spirit_memory_record_failed", {
        agentId: input.agentId,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Retrieve memories for a spirit, ordered by confidence * usage_count.
   * Returns most relevant/trusted memories first.
   */
  async getMemories(input: RetrieveMemoriesInput): Promise<SpiritMemory[]> {
    try {
      const memories = await this.repository.findByAgent({
        userId: input.userId,
        agentId: input.agentId,
        memoryType: input.memoryType,
        limit: input.limit ?? 10,
        minConfidence: input.minConfidence ?? 0.3,
      });

      // Sort by relevance score (confidence * usage frequency)
      const scored = memories.map(m => ({
        memory: m,
        score: m.confidence * Math.log(m.usageCount + 1),
      }));

      scored.sort((a, b) => b.score - a.score);

      return scored.map(s => s.memory);
    } catch (error) {
      logger.error("spirit_memory_retrieve_failed", {
        agentId: input.agentId,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return []; // Return empty array on error to avoid breaking spirit activation
    }
  }

  /**
   * Update memory confidence based on usage feedback.
   * Increases confidence if successfully used, decreases if unsuccessful.
   */
  async updateConfidence(input: UpdateConfidenceInput): Promise<void> {
    try {
      const memory = await this.repository.findByKey({
        userId: input.userId,
        agentId: input.agentId,
        memoryKey: input.memoryKey,
      });

      if (!memory) {
        logger.warn("spirit_memory_confidence_update_not_found", {
          agentId: input.agentId,
          userId: input.userId,
          memoryKey: input.memoryKey,
        });
        return;
      }

      const weight = input.weight ?? 0.1;
      const adjustment = input.success ? weight : -weight;
      const newConfidence = Math.max(0.0, Math.min(1.0, memory.confidence + adjustment));

      await this.repository.update({
        id: memory.id,
        confidence: newConfidence,
        usageCount: memory.usageCount + 1,
        lastUsedAt: new Date(),
      });

      logger.debug("spirit_memory_confidence_updated", {
        agentId: input.agentId,
        userId: input.userId,
        memoryKey: input.memoryKey,
        oldConfidence: memory.confidence,
        newConfidence,
        success: input.success,
      });
    } catch (error) {
      logger.error("spirit_memory_confidence_update_failed", {
        agentId: input.agentId,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Format memories as a human-readable string for injection into system prompts.
   * Returns a formatted section showing top memories for the spirit.
   */
  async formatMemoriesForPrompt(userId: number, agentId: AgentRole): Promise<string> {
    const memories = await this.getMemories({
      userId,
      agentId,
      limit: 5,
      minConfidence: 0.4,
    });

    if (memories.length === 0) {
      return ""; // No memories to show
    }

    const lines: string[] = ["【你的記憶】"];

    memories.forEach(m => {
      const valueStr = typeof m.memoryValue === "string"
        ? m.memoryValue
        : JSON.stringify(m.memoryValue);

      const typeLabel = {
        preference: "偏好",
        pattern: "模式",
        context: "上下文",
        feedback: "回饋",
      }[m.memoryType];

      lines.push(
        `- ${typeLabel}：${m.memoryKey} = ${valueStr} ` +
          `(信心度：${(m.confidence * 100).toFixed(0)}%, 使用 ${m.usageCount} 次)`
      );
    });

    return lines.join("\n");
  }

  /**
   * Record user feedback on spirit performance.
   * This helps spirits learn what works and what doesn't.
   */
  async recordFeedback(input: {
    userId: number;
    agentId: AgentRole;
    action: string;
    outcome: "success" | "partial" | "failure";
    userFeedback?: string;
  }): Promise<void> {
    const feedbackKey = `action_${input.action}`;
    const feedbackValue = {
      outcome: input.outcome,
      timestamp: new Date().toISOString(),
      userFeedback: input.userFeedback,
    };

    const confidence = {
      success: 0.8,
      partial: 0.5,
      failure: 0.2,
    }[input.outcome];

    await this.recordMemory({
      userId: input.userId,
      agentId: input.agentId,
      memoryType: "feedback",
      memoryKey: feedbackKey,
      memoryValue: feedbackValue,
      initialConfidence: confidence,
    });

    logger.info("spirit_feedback_recorded", {
      agentId: input.agentId,
      userId: input.userId,
      action: input.action,
      outcome: input.outcome,
    });
  }

  /**
   * Learn a pattern from user behavior.
   * Called when spirit observes recurring user behaviors.
   */
  async learnPattern(input: {
    userId: number;
    agentId: AgentRole;
    patternKey: string;
    patternDescription: string;
    occurrences: number;
  }): Promise<void> {
    // Confidence increases with number of occurrences
    const confidence = Math.min(0.95, 0.3 + input.occurrences * 0.15);

    await this.recordMemory({
      userId: input.userId,
      agentId: input.agentId,
      memoryType: "pattern",
      memoryKey: input.patternKey,
      memoryValue: input.patternDescription,
      initialConfidence: confidence,
    });

    logger.info("spirit_pattern_learned", {
      agentId: input.agentId,
      userId: input.userId,
      patternKey: input.patternKey,
      occurrences: input.occurrences,
      confidence,
    });
  }

  /**
   * Clean up old, low-confidence memories to prevent clutter.
   * Should be run periodically (e.g., via cron job).
   */
  async cleanupOldMemories(options: {
    olderThanDays?: number;
    maxConfidence?: number;
    maxUsageCount?: number;
  }): Promise<number> {
    try {
      const deleted = await this.repository.deleteOld({
        olderThanDays: options.olderThanDays ?? 90,
        maxConfidence: options.maxConfidence ?? 0.2,
        maxUsageCount: options.maxUsageCount ?? 2,
      });

      logger.info("spirit_memories_cleaned", {
        deletedCount: deleted,
        olderThanDays: options.olderThanDays,
      });

      return deleted;
    } catch (error) {
      logger.error("spirit_memory_cleanup_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}

// Singleton instance
export const SpiritMemoryManager = new SpiritMemoryManagerClass();

// Export for testing
export { SpiritMemoryManagerClass };

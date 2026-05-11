/**
 * server/repositories/mysql/SpiritMemoryRepository.mysql.ts
 *
 * MySQL repository for spirit memory persistence.
 * Handles CRUD operations for specialized_agent_memory table.
 */

import { getDb } from "../../db";
import { specializedAgentMemory, type InsertSpecializedAgentMemory } from "../../../drizzle/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import type { AgentRole } from "../../../shared/orb-agent-roles";
import type { SpiritMemory, SpiritMemoryType } from "../../services/spiritMemoryManager";

export interface CreateMemoryInput {
  userId: number;
  agentId: AgentRole;
  memoryType: SpiritMemoryType;
  memoryKey: string;
  memoryValue: unknown;
  confidence?: number;
  usageCount?: number;
}

export interface UpdateMemoryInput {
  id: number;
  memoryValue?: unknown;
  confidence?: number;
  usageCount?: number;
  lastUsedAt?: Date;
}

export interface FindByAgentInput {
  userId: number;
  agentId: AgentRole;
  memoryType?: SpiritMemoryType;
  limit?: number;
  minConfidence?: number;
}

export interface FindByKeyInput {
  userId: number;
  agentId: AgentRole;
  memoryKey: string;
}

export interface DeleteOldInput {
  olderThanDays: number;
  maxConfidence: number;
  maxUsageCount: number;
}

export class SpiritMemoryRepository {
  /**
   * Create a new memory entry
   */
  async create(input: CreateMemoryInput): Promise<SpiritMemory> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const memoryData: InsertSpecializedAgentMemory = {
      userId: input.userId,
      agentId: input.agentId,
      memoryType: input.memoryType,
      memoryKey: input.memoryKey,
      memoryValue: input.memoryValue,
      confidence: input.confidence ?? 0.5,
      usageCount: input.usageCount ?? 1,
      lastUsedAt: new Date(),
    };

    const result = await db.insert(specializedAgentMemory).values(memoryData);

    // Fetch the created memory
    const [created] = await db
      .select()
      .from(specializedAgentMemory)
      .where(eq(specializedAgentMemory.id, result[0].insertId))
      .limit(1);

    return this.mapToSpiritMemory(created);
  }

  /**
   * Update an existing memory
   */
  async update(input: UpdateMemoryInput): Promise<SpiritMemory> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const updateData: Partial<InsertSpecializedAgentMemory> = {};

    if (input.memoryValue !== undefined) updateData.memoryValue = input.memoryValue;
    if (input.confidence !== undefined) updateData.confidence = input.confidence;
    if (input.usageCount !== undefined) updateData.usageCount = input.usageCount;
    if (input.lastUsedAt !== undefined) updateData.lastUsedAt = input.lastUsedAt;

    await db
      .update(specializedAgentMemory)
      .set(updateData)
      .where(eq(specializedAgentMemory.id, input.id));

    // Fetch updated memory
    const [updated] = await db
      .select()
      .from(specializedAgentMemory)
      .where(eq(specializedAgentMemory.id, input.id))
      .limit(1);

    return this.mapToSpiritMemory(updated);
  }

  /**
   * Find memory by unique key
   */
  async findByKey(input: FindByKeyInput): Promise<SpiritMemory | null> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [memory] = await db
      .select()
      .from(specializedAgentMemory)
      .where(
        and(
          eq(specializedAgentMemory.userId, input.userId),
          eq(specializedAgentMemory.agentId, input.agentId),
          eq(specializedAgentMemory.memoryKey, input.memoryKey)
        )
      )
      .limit(1);

    return memory ? this.mapToSpiritMemory(memory) : null;
  }

  /**
   * Find all memories for a specific agent
   */
  async findByAgent(input: FindByAgentInput): Promise<SpiritMemory[]> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    let query = db
      .select()
      .from(specializedAgentMemory)
      .where(
        and(
          eq(specializedAgentMemory.userId, input.userId),
          eq(specializedAgentMemory.agentId, input.agentId),
          input.minConfidence !== undefined
            ? gte(specializedAgentMemory.confidence, input.minConfidence)
            : undefined,
          input.memoryType !== undefined
            ? eq(specializedAgentMemory.memoryType, input.memoryType)
            : undefined
        )
      )
      .orderBy(sql`confidence * LOG(usageCount + 1) DESC`)
      .limit(input.limit ?? 10);

    const memories = await query;

    return memories.map(m => this.mapToSpiritMemory(m));
  }

  /**
   * Delete old, low-confidence memories
   */
  async deleteOld(input: DeleteOldInput): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - input.olderThanDays);

    const result = await db
      .delete(specializedAgentMemory)
      .where(
        and(
          lte(specializedAgentMemory.createdAt, cutoffDate),
          lte(specializedAgentMemory.confidence, input.maxConfidence),
          lte(specializedAgentMemory.usageCount, input.maxUsageCount)
        )
      );

    return result[0].affectedRows;
  }

  /**
   * Get memory statistics for an agent
   */
  async getStats(userId: number, agentId: AgentRole): Promise<{
    totalMemories: number;
    averageConfidence: number;
    totalUsages: number;
    memoryTypeBreakdown: Record<SpiritMemoryType, number>;
  }> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const memories = await db
      .select()
      .from(specializedAgentMemory)
      .where(
        and(
          eq(specializedAgentMemory.userId, userId),
          eq(specializedAgentMemory.agentId, agentId)
        )
      );

    const totalMemories = memories.length;
    const averageConfidence =
      memories.length > 0
        ? memories.reduce((sum, m) => sum + Number(m.confidence), 0) / memories.length
        : 0;
    const totalUsages = memories.reduce((sum, m) => sum + m.usageCount, 0);

    const memoryTypeBreakdown: Record<SpiritMemoryType, number> = {
      preference: 0,
      pattern: 0,
      context: 0,
      feedback: 0,
    };

    memories.forEach(m => {
      memoryTypeBreakdown[m.memoryType as SpiritMemoryType] += 1;
    });

    return {
      totalMemories,
      averageConfidence,
      totalUsages,
      memoryTypeBreakdown,
    };
  }

  /**
   * Map database row to SpiritMemory interface
   */
  private mapToSpiritMemory(row: typeof specializedAgentMemory.$inferSelect): SpiritMemory {
    return {
      id: row.id,
      userId: row.userId,
      agentId: row.agentId as AgentRole,
      memoryType: row.memoryType as SpiritMemoryType,
      memoryKey: row.memoryKey,
      memoryValue: row.memoryValue,
      confidence: Number(row.confidence),
      usageCount: row.usageCount,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt!,
      updatedAt: row.updatedAt!,
    };
  }
}

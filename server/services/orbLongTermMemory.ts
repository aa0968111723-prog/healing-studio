/**
 * server/services/orbLongTermMemory.ts
 *
 * MEMORY TIER: C — Persistent / cross-session memory (semantic store).
 * Service for managing Orb's long-term structured memory system.
 * Provides semantic search, memory association, and importance scoring.
 * 詳見 `server/services/memory/MEMORY_TIERS.md`。
 */

import { logger } from "../_core/logger";
import { getDb, escapeLikePattern } from "../db";
import {
  orbLongTermMemories,
  orbMemoryAssociations,
  type OrbLongTermMemory as DbLongTermMemory,
  type InsertOrbLongTermMemory,
  type OrbMemoryAssociation as DbMemoryAssociation,
  type InsertOrbMemoryAssociation,
} from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export type MemoryType =
  | "user_fact"
  | "user_preference"
  | "skill_learned"
  | "workflow_pattern"
  | "error_solution"
  | "success_recipe"
  | "context_snippet";

export type SourceType = "conversation" | "action" | "observation" | "inference";

export type AssociationType =
  | "related_to"
  | "caused_by"
  | "part_of"
  | "similar_to"
  | "contradicts"
  | "supersedes";

export interface LongTermMemory {
  id: string;
  userId: number;
  memoryType: MemoryType;
  content: string;
  importanceScore: number;
  embeddingVector?: number[];
  sourceType: SourceType;
  sourceId?: string;
  spiritId?: string;
  metadata?: Record<string, unknown>;
  accessCount: number;
  lastAccessedAt?: Date;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryAssociation {
  id: string;
  fromMemoryId: string;
  toMemoryId: string;
  associationType: AssociationType;
  strength: number;
  createdBy?: string;
  createdAt: Date;
}

export interface CreateMemoryInput {
  userId: number;
  memoryType: MemoryType;
  content: string;
  importanceScore?: number;
  sourceType?: SourceType;
  sourceId?: string;
  spiritId?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface SearchMemoryInput {
  userId: number;
  query?: string;
  memoryTypes?: MemoryType[];
  minImportance?: number;
  limit?: number;
  includeAssociations?: boolean;
}

export interface MemorySearchResult {
  memory: LongTermMemory;
  relevanceScore: number;
  associations?: LongTermMemory[];
}

function computeTextRelevance(content: string, query: string): number {
  const lowerContent = content.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return 0.5;
  const matched = terms.filter(t => lowerContent.includes(t)).length;
  return matched / terms.length;
}

export class OrbLongTermMemory {
  /**
   * Create a new long-term memory
   */
  async create(input: CreateMemoryInput): Promise<LongTermMemory> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const insertData: InsertOrbLongTermMemory = {
        userId: input.userId,
        memoryType: input.memoryType,
        content: input.content,
        importanceScore: String(input.importanceScore ?? 0.5),
        sourceType: input.sourceType ?? "conversation",
        sourceId: input.sourceId,
        spiritId: input.spiritId,
        metadata: input.metadata ?? undefined,
        expiresAt: input.expiresAt,
      };

      const [inserted] = await db.insert(orbLongTermMemories).values(insertData);
      const memoryId = inserted.insertId;

      // Fetch the created memory
      const [memory] = await db
        .select()
        .from(orbLongTermMemories)
        .where(eq(orbLongTermMemories.id, memoryId));

      const result = this.mapDbToMemory(memory);

      logger.info("orb_ltm_created", {
        memoryId: result.id,
        userId: result.userId,
        type: result.memoryType,
        importance: result.importanceScore,
      });

      return result;
    } catch (error) {
      logger.error("orb_ltm_create_failed", {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private mapDbToMemory(dbMemory: DbLongTermMemory): LongTermMemory {
    return {
      id: String(dbMemory.id),
      userId: dbMemory.userId,
      memoryType: dbMemory.memoryType,
      content: dbMemory.content,
      importanceScore: parseFloat(dbMemory.importanceScore ?? "0.5"),
      embeddingVector: dbMemory.embeddingVector
        ? (JSON.parse(dbMemory.embeddingVector as any) as number[])
        : undefined,
      sourceType: dbMemory.sourceType,
      sourceId: dbMemory.sourceId ?? undefined,
      spiritId: dbMemory.spiritId ?? undefined,
      metadata: dbMemory.metadata
        ? (JSON.parse(dbMemory.metadata as any) as Record<string, unknown>)
        : undefined,
      accessCount: dbMemory.accessCount,
      lastAccessedAt: dbMemory.lastAccessedAt ?? undefined,
      expiresAt: dbMemory.expiresAt ?? undefined,
      createdAt: dbMemory.createdAt,
      updatedAt: dbMemory.updatedAt,
    };
  }

  /**
   * Search memories using semantic similarity
   */
  async search(input: SearchMemoryInput): Promise<MemorySearchResult[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const limit = input.limit ?? 20;

      // Build query conditions
      const conditions = [eq(orbLongTermMemories.userId, input.userId)];

      if (input.memoryTypes && input.memoryTypes.length > 0) {
        conditions.push(inArray(orbLongTermMemories.memoryType, input.memoryTypes));
      }

      if (input.minImportance !== undefined) {
        conditions.push(
          sql`${orbLongTermMemories.importanceScore} >= ${String(input.minImportance)}`
        );
      }

      // TODO: Implement actual semantic search with embeddings
      // For now, do text-based search if query provided
      let query = db
        .select()
        .from(orbLongTermMemories)
        .where(and(...conditions))
        .orderBy(desc(orbLongTermMemories.importanceScore), desc(orbLongTermMemories.createdAt))
        .limit(limit);

      if (input.query) {
        query = db
          .select()
          .from(orbLongTermMemories)
          .where(
            and(
              ...conditions,
              sql`${orbLongTermMemories.content} LIKE ${`%${escapeLikePattern(input.query)}%`}`
            )
          )
          .orderBy(desc(orbLongTermMemories.importanceScore))
          .limit(limit);
      }

      const memories = await query;

      // Map to results with relevance scores — blend keyword relevance + importance
      const results: MemorySearchResult[] = memories.map((mem) => {
        const importanceScore = parseFloat(mem.importanceScore ?? "0.5");
        const relevanceScore = input.query
          ? computeTextRelevance(mem.content, input.query) * 0.6 + importanceScore * 0.4
          : importanceScore;
        return {
          memory: this.mapDbToMemory(mem),
          relevanceScore,
          associations: input.includeAssociations ? [] : undefined,
        };
      });

      // Re-sort by computed relevance when query provided (DB ordered by importanceScore)
      if (input.query) {
        results.sort((a, b) => b.relevanceScore - a.relevanceScore);
      }

      // Fetch associations if requested
      if (input.includeAssociations && results.length > 0) {
        const memoryIds = results.map((r) => Number(r.memory.id));
        const associations = await db
          .select()
          .from(orbMemoryAssociations)
          .where(inArray(orbMemoryAssociations.fromMemoryId, memoryIds));

        // Load associated memories
        const associatedIds = associations.map((a) => a.toMemoryId);
        if (associatedIds.length > 0) {
          const associatedMemories = await db
            .select()
            .from(orbLongTermMemories)
            .where(inArray(orbLongTermMemories.id, associatedIds));

          // Map associations to results
          const memoryMap = new Map(associatedMemories.map((m) => [m.id, m]));
          for (const result of results) {
            const memId = Number(result.memory.id);
            const relatedAssocs = associations.filter((a) => a.fromMemoryId === memId);
            result.associations = relatedAssocs
              .map((a) => memoryMap.get(a.toMemoryId))
              .filter((m): m is DbLongTermMemory => m !== undefined)
              .map((m) => this.mapDbToMemory(m));
          }
        }
      }

      logger.info("orb_ltm_searched", {
        userId: input.userId,
        query: input.query,
        types: input.memoryTypes,
        resultCount: results.length,
      });

      return results;
    } catch (error) {
      logger.error("orb_ltm_search_failed", {
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get memories by type
   */
  async getByType(
    userId: number,
    memoryType: MemoryType,
    limit = 50
  ): Promise<LongTermMemory[]> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const memories = await db
        .select()
        .from(orbLongTermMemories)
        .where(
          and(
            eq(orbLongTermMemories.userId, userId),
            eq(orbLongTermMemories.memoryType, memoryType)
          )
        )
        .orderBy(desc(orbLongTermMemories.importanceScore), desc(orbLongTermMemories.lastAccessedAt))
        .limit(limit);

      const results = memories.map((m) => this.mapDbToMemory(m));

      logger.info("orb_ltm_get_by_type", {
        userId,
        type: memoryType,
        count: results.length,
      });

      return results;
    } catch (error) {
      logger.error("orb_ltm_get_by_type_failed", {
        userId,
        type: memoryType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update memory importance score
   */
  async updateImportance(
    memoryId: string,
    newScore: number
  ): Promise<void> {
    try {
      const score = Math.max(0, Math.min(1, newScore));
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      await db
        .update(orbLongTermMemories)
        .set({ importanceScore: String(score) })
        .where(eq(orbLongTermMemories.id, Number(memoryId)));

      logger.info("orb_ltm_importance_updated", {
        memoryId,
        newScore: score,
      });
    } catch (error) {
      logger.error("orb_ltm_update_importance_failed", {
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Record memory access (for tracking usage patterns)
   */
  async recordAccess(memoryId: string): Promise<void> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      await db
        .update(orbLongTermMemories)
        .set({
          accessCount: sql`${orbLongTermMemories.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(eq(orbLongTermMemories.id, Number(memoryId)));

      logger.debug("orb_ltm_access_recorded", { memoryId });
    } catch (error) {
      logger.error("orb_ltm_record_access_failed", {
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - access tracking failures shouldn't break functionality
    }
  }

  /**
   * Create association between memories
   */
  async createAssociation(
    fromMemoryId: string,
    toMemoryId: string,
    associationType: AssociationType,
    strength = 0.5,
    createdBy?: string
  ): Promise<MemoryAssociation> {
    try {
      const normalizedStrength = Math.max(0, Math.min(1, strength));
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const insertData: InsertOrbMemoryAssociation = {
        fromMemoryId: Number(fromMemoryId),
        toMemoryId: Number(toMemoryId),
        associationType,
        strength: String(normalizedStrength),
        createdBy,
      };

      const [inserted] = await db.insert(orbMemoryAssociations).values(insertData);
      const assocId = inserted.insertId;

      // Fetch the created association
      const [assoc] = await db
        .select()
        .from(orbMemoryAssociations)
        .where(eq(orbMemoryAssociations.id, assocId));

      const association: MemoryAssociation = {
        id: String(assoc.id),
        fromMemoryId: String(assoc.fromMemoryId),
        toMemoryId: String(assoc.toMemoryId),
        associationType: assoc.associationType,
        strength: parseFloat(assoc.strength ?? "0.5"),
        createdBy: assoc.createdBy ?? undefined,
        createdAt: assoc.createdAt,
      };

      logger.info("orb_ltm_association_created", {
        associationId: association.id,
        type: associationType,
        strength: normalizedStrength,
      });

      return association;
    } catch (error) {
      logger.error("orb_ltm_create_association_failed", {
        fromMemoryId,
        toMemoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get associated memories
   */
  async getAssociations(
    memoryId: string,
    associationType?: AssociationType,
    minStrength = 0.3
  ): Promise<Array<{ association: MemoryAssociation; memory: LongTermMemory }>> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      const memId = Number(memoryId);

      // Build query conditions
      const conditions = [
        eq(orbMemoryAssociations.fromMemoryId, memId),
        sql`${orbMemoryAssociations.strength} >= ${String(minStrength)}`,
      ];
      if (associationType) {
        conditions.push(eq(orbMemoryAssociations.associationType, associationType));
      }

      // Get associations
      const associations = await db
        .select()
        .from(orbMemoryAssociations)
        .where(and(...conditions))
        .orderBy(desc(orbMemoryAssociations.strength));

      // Get associated memories
      if (associations.length === 0) {
        return [];
      }

      const memoryIds = associations.map((a) => a.toMemoryId);
      const memories = await db
        .select()
        .from(orbLongTermMemories)
        .where(inArray(orbLongTermMemories.id, memoryIds));

      // Map to results
      const memoryMap = new Map(memories.map((m) => [m.id, m]));
      const results: Array<{
        association: MemoryAssociation;
        memory: LongTermMemory;
      }> = [];

      for (const assoc of associations) {
        const mem = memoryMap.get(assoc.toMemoryId);
        if (mem) {
          results.push({
            association: {
              id: String(assoc.id),
              fromMemoryId: String(assoc.fromMemoryId),
              toMemoryId: String(assoc.toMemoryId),
              associationType: assoc.associationType,
              strength: parseFloat(assoc.strength ?? "0.5"),
              createdBy: assoc.createdBy ?? undefined,
              createdAt: assoc.createdAt,
            },
            memory: this.mapDbToMemory(mem),
          });
        }
      }

      logger.info("orb_ltm_associations_retrieved", {
        memoryId,
        type: associationType,
        count: results.length,
      });

      return results;
    } catch (error) {
      logger.error("orb_ltm_get_associations_failed", {
        memoryId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Consolidate and prune old/low-importance memories
   */
  async consolidate(userId: number): Promise<{
    consolidated: number;
    pruned: number;
  }> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      let consolidated = 0;
      let pruned = 0;

      // 1. Remove expired memories
      const expiredResult = await db
        .delete(orbLongTermMemories)
        .where(
          and(
            eq(orbLongTermMemories.userId, userId),
            sql`${orbLongTermMemories.expiresAt} < NOW()`
          )
        );
      pruned += expiredResult[0].affectedRows;

      // 2. Prune low-importance, rarely-accessed memories (keep at least some)
      // Find memories with importance < 0.3 and accessCount < 2 that haven't been accessed in 90 days
      const lowValueMemories = await db
        .select({ id: orbLongTermMemories.id })
        .from(orbLongTermMemories)
        .where(
          and(
            eq(orbLongTermMemories.userId, userId),
            sql`${orbLongTermMemories.importanceScore} < 0.3`,
            sql`${orbLongTermMemories.accessCount} < 2`,
            sql`(${orbLongTermMemories.lastAccessedAt} IS NULL OR ${orbLongTermMemories.lastAccessedAt} < DATE_SUB(NOW(), INTERVAL 90 DAY))`
          )
        )
        .limit(100); // Don't prune too many at once

      if (lowValueMemories.length > 0) {
        const idsToDelete = lowValueMemories.map((m) => m.id);
        const pruneResult = await db
          .delete(orbLongTermMemories)
          .where(inArray(orbLongTermMemories.id, idsToDelete));
        pruned += pruneResult[0].affectedRows;
      }

      // TODO: Implement consolidation logic for merging similar memories
      // This would require semantic similarity comparison

      logger.info("orb_ltm_consolidated", {
        userId,
        consolidated,
        pruned,
      });

      return { consolidated, pruned };
    } catch (error) {
      logger.error("orb_ltm_consolidate_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get memory statistics for a user
   */
  async getStats(userId: number): Promise<{
    totalMemories: number;
    byType: Record<MemoryType, number>;
    avgImportance: number;
    totalAssociations: number;
  }> {
    try {
      const db = await getDb();
      if (!db) throw new Error("Database is not configured");
      // Get total count and average importance
      const [generalStats] = await db
        .select({
          count: sql<number>`COUNT(*)`,
          avgImportance: sql<number>`AVG(${orbLongTermMemories.importanceScore})`,
        })
        .from(orbLongTermMemories)
        .where(eq(orbLongTermMemories.userId, userId));

      // Get counts by type
      const typeCounts = await db
        .select({
          memoryType: orbLongTermMemories.memoryType,
          count: sql<number>`COUNT(*)`,
        })
        .from(orbLongTermMemories)
        .where(eq(orbLongTermMemories.userId, userId))
        .groupBy(orbLongTermMemories.memoryType);

      const byType: Record<MemoryType, number> = {
        user_fact: 0,
        user_preference: 0,
        skill_learned: 0,
        workflow_pattern: 0,
        error_solution: 0,
        success_recipe: 0,
        context_snippet: 0,
      };

      for (const row of typeCounts) {
        byType[row.memoryType as MemoryType] = Number(row.count);
      }

      // Get association count for user's memories
      const userMemories = await db
        .select({ id: orbLongTermMemories.id })
        .from(orbLongTermMemories)
        .where(eq(orbLongTermMemories.userId, userId));

      const memoryIds = userMemories.map((m) => m.id);
      let totalAssociations = 0;
      if (memoryIds.length > 0) {
        const [assocStats] = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(orbMemoryAssociations)
          .where(inArray(orbMemoryAssociations.fromMemoryId, memoryIds));
        totalAssociations = Number(assocStats?.count ?? 0);
      }

      const stats = {
        totalMemories: Number(generalStats?.count ?? 0),
        byType,
        avgImportance: Number(generalStats?.avgImportance ?? 0),
        totalAssociations,
      };

      return stats;
    } catch (error) {
      logger.error("orb_ltm_get_stats_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// Singleton instance
export const orbLongTermMemory = new OrbLongTermMemory();

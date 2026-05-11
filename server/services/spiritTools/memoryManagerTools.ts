/**
 * server/services/spiritTools/memoryManagerTools.ts
 *
 * Tools for memory-manager spirit to access long-term memory system.
 * Handles memory CRUD, search, and consolidation operations.
 */

import { logger } from "../../_core/logger";
import {
  orbLongTermMemory,
  type CreateMemoryInput,
  type SearchMemoryInput,
} from "../orbLongTermMemory";

/**
 * Store a new long-term memory
 */
export async function storeMemory(input: CreateMemoryInput): Promise<{
  success: boolean;
  memoryId?: string;
  message: string;
}> {
  try {
    const memory = await orbLongTermMemory.create(input);

    return {
      success: true,
      memoryId: memory.id,
      message: "記憶已儲存",
    };
  } catch (error) {
    logger.error("memory_manager_store_failed", {
      userId: input.userId,
      type: input.memoryType,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `儲存失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Search memories using semantic similarity
 */
export async function searchMemories(input: SearchMemoryInput): Promise<{
  success: boolean;
  results: Array<{
    memoryId: string;
    content: string;
    type: string;
    relevanceScore: number;
    importance: number;
  }>;
  message: string;
}> {
  try {
    const searchResults = await orbLongTermMemory.search(input);

    return {
      success: true,
      results: searchResults.map(r => ({
        memoryId: r.memory.id,
        content: r.memory.content,
        type: r.memory.memoryType,
        relevanceScore: r.relevanceScore,
        importance: r.memory.importanceScore,
      })),
      message: `找到 ${searchResults.length} 條相關記憶`,
    };
  } catch (error) {
    logger.error("memory_manager_search_failed", {
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      results: [],
      message: `搜尋失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get user's memory statistics
 */
export async function getMemoryStats(userId: number): Promise<{
  success: boolean;
  stats?: {
    totalMemories: number;
    byType: Record<string, number>;
    avgImportance: number;
    totalAssociations: number;
  };
  message: string;
}> {
  try {
    const stats = await orbLongTermMemory.getStats(userId);

    return {
      success: true,
      stats,
      message: "統計資料已載入",
    };
  } catch (error) {
    logger.error("memory_manager_stats_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: `載入失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Consolidate and prune old memories
 */
export async function consolidateMemories(userId: number): Promise<{
  success: boolean;
  consolidated: number;
  pruned: number;
  message: string;
}> {
  try {
    const result = await orbLongTermMemory.consolidate(userId);

    return {
      success: true,
      consolidated: result.consolidated,
      pruned: result.pruned,
      message: `已整合 ${result.consolidated} 條記憶，清理 ${result.pruned} 條過期記憶`,
    };
  } catch (error) {
    logger.error("memory_manager_consolidate_failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      consolidated: 0,
      pruned: 0,
      message: `整合失敗：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

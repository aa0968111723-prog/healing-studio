/**
 * server/services/memory/index.ts — Memory tier façade
 *
 * 統一入口,讓新代碼用一個 import 看到完整 memory 階層。每個既有
 * memory 模組維持原檔原 API(無 breaking change),這裡只是分組
 * 命名 + 文件化。詳見同目錄 MEMORY_TIERS.md。
 *
 *   Tier A — Ephemeral task scratchpad(in-RAM,單次任務生命週期內)
 *     TaskScratch        ← server/services/orbTaskMemory
 *
 *   Tier B — Session / conversation memory(in-RAM + 使用者欄位摘要)
 *     ConversationMemory ← server/services/orbMemory
 *     UserSummary        ← server/services/orbUserMemory
 *
 *   Tier C — Persistent / cross-session memory(各自獨立 DB 儲存)
 *     LongTermMemory     ← server/services/orbLongTermMemory
 *     SpiritMemory       ← server/services/spiritMemoryManager
 *     SpecialistEvents   ← server/services/specializedAgentMemoryStore
 *
 * 每層的儲存後端不同(各自的表 / RAM / 欄位),這個 façade 不嘗試
 * 把它們塞到同一個介面 — 把抽象留給呼叫端。三層之間的轉移(短期 →
 * 長期 / 精靈摘要)目前是顯式呼叫,不是隱含 promote。
 *
 * 為什麼不直接 merge?三層各自寫到不同 DB 表(orb_long_term_memories
 * / spirit_memories / specialized_agent_interactions / users.orbMemorySummary
 * 欄位)。把它們合併會需要 DB schema 遷移,本次重整明確排除 schema
 * 變動。Phase 3 才會處理(若仍需要)。
 */

export * as TaskScratch from "../orbTaskMemory";
export * as ConversationMemory from "../orbMemory";
export * as UserSummary from "../orbUserMemory";
export * as LongTermMemory from "../orbLongTermMemory";
export * as SpiritMemory from "../spiritMemoryManager";
export * as SpecialistEvents from "../specializedAgentMemoryStore";

/**
 * Tier 階層的型別常數,讓新代碼可以用 string union 而非 magic string。
 */
export type MemoryTier = "task-scratch" | "conversation" | "long-term";

export const MEMORY_TIERS = {
  TASK_SCRATCH: "task-scratch",
  CONVERSATION: "conversation",
  LONG_TERM: "long-term",
} as const satisfies Record<string, MemoryTier>;

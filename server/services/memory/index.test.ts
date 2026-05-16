/**
 * server/services/memory/index.test.ts — Façade smoke test
 *
 * 確認 façade 正確把每個 memory 模組重新 export 出去、tier 常數齊全。
 * 行為層的測試各自留在原模組 (orbMemory.test.ts / orbLongTermMemory.test.ts 等)。
 */

import { describe, expect, it } from "vitest";
import {
  TaskScratch,
  ConversationMemory,
  UserSummary,
  LongTermMemory,
  SpiritMemory,
  SpecialistEvents,
  MEMORY_TIERS,
  type MemoryTier,
} from "./index";

describe("memory façade", () => {
  it("Tier A — TaskScratch 暴露 record / read API", () => {
    expect(typeof TaskScratch.recordOrbTaskMemory).toBe("function");
    expect(typeof TaskScratch.getRecentOrbTaskMemory).toBe("function");
    expect(typeof TaskScratch.summarizeRecentOrbTaskMemoryForPlanner).toBe(
      "function"
    );
  });

  it("Tier B — ConversationMemory 暴露 in-RAM + RAG API", () => {
    expect(typeof ConversationMemory.recordOrbMemory).toBe("function");
    expect(typeof ConversationMemory.getRecentOrbMemories).toBe("function");
    expect(typeof ConversationMemory.searchOrbMemoriesWithRag).toBe("function");
  });

  it("Tier B — UserSummary 暴露 get / upsert", () => {
    expect(typeof UserSummary.getOrbMemorySummary).toBe("function");
    expect(typeof UserSummary.upsertOrbMemory).toBe("function");
  });

  it("Tier C — LongTermMemory 暴露 singleton 與 class", () => {
    expect(LongTermMemory.orbLongTermMemory).toBeDefined();
    expect(typeof LongTermMemory.OrbLongTermMemory).toBe("function");
  });

  it("Tier C — SpiritMemory 暴露 singleton manager", () => {
    expect(SpiritMemory.SpiritMemoryManager).toBeDefined();
    expect(typeof SpiritMemory.SpiritMemoryManager.recordMemory).toBe(
      "function"
    );
  });

  it("Tier C — SpecialistEvents 暴露 record / read API", () => {
    expect(typeof SpecialistEvents.recordSpecialistInteraction).toBe(
      "function"
    );
    expect(typeof SpecialistEvents.getRecentSpecialistTools).toBe("function");
    expect(typeof SpecialistEvents.getSpecialistMemoryHints).toBe("function");
  });

  it("MEMORY_TIERS 常數覆蓋三層", () => {
    const all: MemoryTier[] = [
      MEMORY_TIERS.TASK_SCRATCH,
      MEMORY_TIERS.CONVERSATION,
      MEMORY_TIERS.LONG_TERM,
    ];
    expect(new Set(all).size).toBe(3);
  });
});

# Orb / AI 代理 Memory 階層

光球助手與 AI 代理共用一套三層記憶體系。每一層服務不同的存活週期與信賴度,
寫到不同的儲存後端,呼叫端用顯式 API 在層之間搬資料。

## Tier A — Ephemeral task scratchpad

| 項目 | 內容 |
|---|---|
| 模組 | `server/services/orbTaskMemory.ts` |
| 別名 | `memory/index.ts` 內 `TaskScratch` |
| 儲存 | 純 in-RAM 陣列 + (可選)寫一份到 `orb_task_memory_events` 表做 chain memory |
| 生命週期 | 單一 task / chain run 內 |
| 用途 | 把同一個 task 的 step 結果穿針引線:`step1 → step2` 引用前一步 toolResult |
| 寫入時機 | 每個 step 跑完都 `recordOrbTaskMemory(event)` |
| 讀取 API | `getRecentOrbTaskMemory(limit)`、`summarizeRecentOrbTaskMemoryForPlanner(limit)` |
| 重啟後遺失? | RAM 部分會,DB persist 部分不會;但 chain 結束後不再讀 RAM 副本 |

## Tier B — Session / conversation memory

兩個模組,服務「目前這場對話」的脈絡。

### B-1: ConversationMemory (`orbMemory.ts`)

| 項目 | 內容 |
|---|---|
| 模組 | `server/services/orbMemory.ts` |
| 儲存 | in-RAM 陣列 + RAG index(`ragMemory.ts` 提供向量索引) |
| 生命週期 | 程序壽命內;重啟即清空(但 RAG side 持久) |
| 用途 | 收集「光球觀察到的瑣事」— 偏好、注意事項、安全事件 |
| 內容種類 | `OrbMemoryType` enum:preference / observation / safety_event 等 |
| 寫入 API | `recordOrbMemory(input)` |
| 讀取 API | `getRecentOrbMemories(args)`、`searchOrbMemoriesWithRag(args)`、`buildOrbMemorySummaryForPlanner(args)` |
| 與規劃器整合 | `summarizeOrbMemoriesForPlanner` 把最近 N 條塞進 system prompt |

### B-2: UserSummary (`orbUserMemory.ts`)

| 項目 | 內容 |
|---|---|
| 模組 | `server/services/orbUserMemory.ts` |
| 儲存 | `users.orbMemorySummary` 欄位(text)— 每位使用者一個字串 |
| 生命週期 | 永久(隨使用者紀錄) |
| 用途 | 「這位使用者長期偏好」的人話摘要,給 LLM 啟動上下文用 |
| 寫入 API | `upsertOrbMemory(userId, summary)`(被 conversation-enhancer 定期呼叫) |
| 讀取 API | `getOrbMemorySummary(userId)` |
| 與 LongTermMemory 差異 | 這層是「精煉後的一句話」,LongTermMemory 是「結構化條目集」 |

## Tier C — Persistent / cross-session memory

三個模組,各自獨立 DB 表,服務跨會話、跨任務的長期知識。

### C-1: LongTermMemory (`orbLongTermMemory.ts`)

| 項目 | 內容 |
|---|---|
| 儲存 | `orb_long_term_memories` + `orb_memory_associations` |
| 內容種類 | `MemoryType` enum:user_fact / user_preference / skill_learned / workflow_pattern / error_solution / success_recipe / context_snippet |
| 結構 | 有 importanceScore、embeddingVector、accessCount、associations(關聯圖) |
| 主要 API | `orbLongTermMemory.create(input)`、`.search(input)`、`.associate(from, to, type)` |
| 用途 | 「這個使用者的工作模式 / 過去成功配方」— 規劃器拉相似情境的歷史經驗 |

### C-2: SpiritMemory (`spiritMemoryManager.ts`)

| 項目 | 內容 |
|---|---|
| 儲存 | `spirit_memories` 表(via `SpiritMemoryRepository`) |
| 維度 | (userId, agentId, memoryKey)— 每位使用者對每個精靈各自的學習 |
| 內容種類 | `SpiritMemoryType`:preference / pattern / context / feedback |
| 寫入 API | `SpiritMemoryManager.recordMemory(input)` |
| 讀取 API | `.retrieveMemories(input)`、`.updateConfidence(input)` |
| 用途 | 25 隻精靈各自的個性化記憶 —「圖圖記得你喜歡 9:16」之類 |

### C-3: SpecialistEvents (`specializedAgentMemoryStore.ts`)

| 項目 | 內容 |
|---|---|
| 儲存 | `specialized_agent_interactions` 表 |
| 維度 | (userId, agentId, interactionType, toolName)時序事件 |
| 用途 | 工具使用稽核 —「使用者最近用過哪些 specialist tool」,給 skill router 當 tiebreaker |
| 寫入 API | `recordSpecialistInteraction(input)`、`recordToolAuditAsSpecialistInteraction(event)` |
| 讀取 API | `getRecentSpecialistTools(userId, limit)`、`getSpecialistMemoryHints(userId)` |
| 與 SpiritMemory 差異 | 這層是「事件流」,SpiritMemory 是「累積學習」 |

## 為什麼不合併?

每層的儲存後端不同(各自的表 / RAM / 欄位)。把它們合併會需要 DB schema
遷移與資料搬遷;本次重整明確排除 schema 變動,因此本階段只做(a)分層
文件化、(b)façade 入口、(c)各模組的 doc comment 標明所屬層。

未來若要合併,候選方案:

- 把 Tier C 的三個表整成一個 `agent_memories` 表 + `tier`/`scope` 欄位
- 把 Tier B 的 `users.orbMemorySummary` 欄位收進 LongTermMemory
- 把 Tier A 的 chain memory(`orb_task_memory_events`)也移到統一表

這幾個合併都會牽動 repository、router、planner,規模較大,留到後續階段
評估。

## 在新代碼怎麼用?

```ts
import {
  TaskScratch,
  ConversationMemory,
  LongTermMemory,
  SpiritMemory,
} from "@/services/memory"; // 或 "server/services/memory"

// Tier A:這個 task 內的記事
TaskScratch.recordOrbTaskMemory({ /* ... */ });

// Tier B:這場對話的偏好/觀察
ConversationMemory.recordOrbMemory({ /* ... */ });

// Tier C:跨會話的長期記憶
await LongTermMemory.orbLongTermMemory.create({ /* ... */ });

// Tier C:某個精靈對某使用者的學習
await SpiritMemory.SpiritMemoryManager.recordMemory({ /* ... */ });
```

舊代碼仍可直接 import 原模組,façade 完全是 additive。

# Orb Agent 三階段升級計畫（A/B/C）

## PR1 — 伺服器端記憶（跨會話）

### 目標
- 新增 `users.orb_memory_summary` 欄位（TEXT / nullable）。
- 新增 `server/services/orbUserMemory.ts`：
  - `loadOrbUserMemorySummary(userId)`：讀取 users 欄位。
  - `summarizeAndPersistOrbUserMemory(...)`：在每次 `ai.chat` 結束後，使用 `gpt-4o-mini` 壓縮本回合資訊，寫回欄位。
  - `buildOrbUserMemoryPromptBlock(userId)`：下次 `ai.chat` 注入 system prompt。
- 在 `server/routers.ts` 的 `ai.chat`：
  - 進入模型前注入 `orb_memory_summary`。
  - 回覆產生後觸發 summary 壓縮與寫回（失敗降級不阻斷主流程）。

### 測試
- 新增 `server/orb-user-memory.test.ts`：
  - 能從 DB 讀寫 memory summary。
  - summary 產生失敗時不影響 chat 回覆。
  - 注入 system prompt 時內容包含欄位值。

### 風險/回滾
- 若摘要模型不可用，僅跳過更新，不影響聊天。
- 欄位可保持 nullable，回滾只需停止注入。

---

## PR2 — 任務執行器（自主多步驟）

### 目標
- 新增 `server/services/orbTaskExecutor.ts`，封裝 FAL.ai / Suno / ElevenLabs：
  - `executeOrbTaskStep(step)`：依 provider + taskType 路由。
  - 標準化回傳 `status/result/error/retryable/provider/model`。
  - 將既有「導航-only」路徑擴展為「可直接執行生成任務」。
- 與現有 orchestrator/chain runner 接合：
  - planner 的 tool call 可直接觸發 executor。
  - 執行結果回填 task trace / observation。

### 測試
- 新增 `server/orb-task-executor.test.ts`：
  - FAL / Suno / ElevenLabs 正常路由。
  - provider 錯誤回傳一致格式。
  - 多步驟任務可串接（前一步輸出餵下一步）。

### 風險/回滾
- 先以 feature flag 包起來；出問題可退回舊流程。

---

## PR3 — 自動重試（最多 3 次 + 備用模型）

### 目標
- 在 `server/services/orbReplyParser.ts` action 失敗處理鍊增加 retry 策略（最多 3 次）。
- 每次重試可切換 fallback model（例如 primary -> secondary -> tertiary）。
- 將 retry 次數與最後錯誤寫入 telemetry。

### 測試
- 擴充 `server/orb-reply-parser.test.ts`：
  - 第 1/2 次失敗，第 3 次成功。
  - 連續失敗 3 次後正確拋錯並保留 fallback 軌跡。
  - 非 retryable error 不重試。

### 風險/回滾
- retry 僅對明確可重試錯誤生效，避免重放破壞性操作。

---

## 交付順序
1. PR1（memory schema + service + ai.chat 注入）
2. PR2（executor + tool routing）
3. PR3（retry policy + fallback model）

## 驗收標準
- 每個 PR 都包含對應單元測試，風格對齊 `server/*.test.ts`。
- 不破壞既有 `ai.chat` API 回傳 shape。
- 失敗路徑全部 degradable，不中斷主要回覆。

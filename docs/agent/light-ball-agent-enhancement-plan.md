# 光球代理 (Light Ball Agent) 能力強化計畫與實作路徑

> **文件狀態**：Draft | **最後更新**：2026-05-02 | **目標對象**：Claude Code / Codex Cloud 開發代理

## 1. 現況深度盤點與問題定義

經過對 `healing-studio` repo 的深度掃描（截至 commit `081d38a`，PR #318/#319 已合併），光球代理的基礎設施（Orchestrator、Planner、State Machine、Memory、Tool Registry）已經相當完整。特別是 17 個 `studio.*` 工具（含生成、編輯、音訊、虛擬化身等）已全部註冊完畢。

**然而，在「真正的 AI 代理能力」上，仍存在 5 個致命缺口：**

### 缺口一：缺乏執行後的自我反思與驗證 (No Self-Reflection / Verification)
- **現狀**：`orbTaskOrchestrator.ts` 中的 `executeCurrentStepTools` 只負責呼叫工具並把結果塞回 state machine。
- **問題**：完全沒有 `evaluate`, `verify`, `critique` 機制。如果 `studio.generateImage` 產生了一張全黑的圖，或者 `studio.separateStems` 失敗，Orchestrator 不會察覺，只會盲目進入下一步。
- **證據**：`grep -E "verify|critique|sanityCheck" server/services/orbTaskOrchestrator.ts` 無任何匹配。

### 缺口二：多模態一致性未攔截 (Modality Coherence Disconnected)
- **現狀**：repo 中有 `shared/orb-modality-coherence.ts`，但它從未被 Orchestrator 或 AgentToolExecutor 呼叫。
- **問題**：如果使用者要求「生成一張 16:9 的圖，然後把它變成 9:16 的影片」，Orchestrator 不會在中途發現長寬比不一致的錯誤，導致下游影片模型直接 crash。
- **證據**：`grep -rEl "modalityCoherence" .` 顯示它只出現在 tests 和 routers，未深入核心執行迴圈。

### 缺口三：內容審核未整合 (Content Moderation Disconnected)
- **現狀**：repo 有 `shared/orb-content-moderation.ts`。
- **問題**：同上，未整合進 Orchestrator 的 safety gate 中。代理可能會無意間產生違反政策的 prompt 並傳給底層 FAL 模型。

### 缺口四：記憶的「提取與注入」未閉環 (Memory Retrieval Gap)
- **現狀**：`server/services/orbMemory.ts` 提供了 `recordOrbMemory` 和 `searchOrbMemoriesWithRag`。
- **問題**：雖然 `orbTaskStateMachine.ts` 會在任務成功/失敗時寫入 `successful_workflow` / `failed_workflow`，但 Planner 在拆解新任務時，並未有效利用 RAG 把過去的失敗教訓（failed_workflow）提取出來避坑。

### 缺口五：缺乏預定義工作流的直接調用 (No Workflow Template Invocation)
- **現狀**：`server/services/siteKnowledge.ts` 裡有一大包 hardcode 的 `WORKFLOW_KNOWLEDGE`。
- **問題**：Planner 只能靠讀文字知識來「重新發明」步驟，無法直接 `invokeWorkflow("ig_reels_30s")`，導致每次拆解的穩定度極差。

---

## 2. 強化實作路徑 (Action Plan)

為了讓光球從「單純的任務執行器」升級為「具備反思能力的 AI 代理」，請依序實作以下三個 Phase。

### Phase 1: 實作 Step Reflection 與 Quality Check
**目標**：讓 Orchestrator 在每一步執行完後，能「看一眼」結果，決定是繼續、重試還是報錯。

1. **擴充 `agentToolExecutor.ts`**：
   - 新增 `async function verifyToolResult(toolName, args, result): Promise<{ok: boolean, critique?: string}>`。
   - 對於圖像生成，檢查長寬比、是否全黑/全白。
   - 對於影片生成，檢查 duration 和 state。
2. **修改 `orbTaskOrchestrator.ts`**：
   - 在 `executeCurrentStepTools` 取得結果後，呼叫 `verifyToolResult`。
   - 如果 `ok === false`，觸發內建的 retry 機制（扣減 `retryBudget`），並將 `critique` 塞入下一次的 recovery prompt 中。

### Phase 2: 縫合 Modality Coherence 與 Content Moderation
**目標**：在 Planner 產生計畫後、執行前，進行兩道 Safety Gate 攔截。

1. **修改 `agentPlanner.ts`**：
   - 在 `parseAndGatePlan` 階段，引入 `shared/orb-modality-coherence.ts` 的檢查。
   - 如果發現上下游工具的模態不相容（如 16:9 圖餵給只吃 1:1 的影片模型），強制 Planner 重新產生計畫（Replan）。
2. **修改 `orbTaskOrchestrator.ts`**：
   - 在執行任何 `studio.*` 工具前，將 user prompt 經過 `orb-content-moderation.ts` 掃描。

### Phase 3: 強化 Memory RAG 注入
**目標**：讓光球代理「記取教訓」。

1. **修改 `server/routers/proStudio.ts` 或代理入口**：
   - 在呼叫 Planner 前，使用使用者的 intent 作為 query，呼叫 `searchOrbMemoriesWithRag`。
   - 特別過濾出 `type: "failed_workflow"` 和 `type: "prompt_pattern"`。
   - 將這些記憶打包成 `recentOrbMemorySummary` 傳入 `AgentPlannerInput`。
2. **更新 Planner Prompt**：
   - 明確指示 LLM：「請參考 Recent long-term memory 中的失敗經驗，避免產生相同的步驟組合」。

---

## 3. 測試驗收標準 (Acceptance Criteria)

開發完成後，必須通過以下三個 E2E 測試情境：

1. **IG Reels 30s 測試**：輸入「幫我做一支 30 秒 IG Reels 預告片」，Planner 必須自動串接 `generateImage` → `generateVideo` → `generateAudio` → `mergeAudios`，且 Modality Coherence 必須過關。
2. **Reflection 觸發測試**：Mock 一個失敗的 `studio.generateImage`（回傳錯誤長寬比），Orchestrator 必須能攔截並觸發 retry，而不是繼續執行下一步。
3. **Memory 避坑測試**：寫入一筆「使用 A 模型生成 B 風格會失敗」的記憶，再次要求相同任務時，Planner 必須選擇替代模型或路徑。

> **開發者（Claude Code / Codex）請注意**：請嚴格遵守「擴充而非重寫」原則，不要破壞現有的 `FAL_MODEL_CATALOG` 與 17 個 `studio.*` 工具註冊。

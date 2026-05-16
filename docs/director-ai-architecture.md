# Director AI Architecture

> 本文件記錄 `/director` 頁面背後的「導演 AI」系統架構，涵蓋雙引擎 RAG 流程、Personality 系統、三種操作模式、生成 pipeline、Handoff 流、Orb 工具註冊、Brain config wiring、持久化模型、與 Eval 覆蓋。
>
> **整理歷史**：2026-05 進行系統性最佳化整理，將 4 個巨型檔案（11,352 行）拆分到 7 個服務檔 + 5 個 UI 元件檔，並集中 personality prompts 到單一來源。詳見本文件末尾「整理歷程」附錄。

## 1. 系統概述

- 路由：`client/src/App.tsx`（lazy load `/director`）
- 進入點：`client/src/pages/CreationHub.tsx`
- 主頁面元件：`client/src/pages/DirectorAI.tsx`（拆分後子元件位於 `client/src/components/director/`）
- 後端 tRPC namespace：`director:`（`server/routers.ts` 註冊 `directorRouter`）

## 2. 雙引擎 RAG 流程

`runDirectorAI`（位於 `server/services/director/costarService.ts`，原 `server/routers/director.ts:1397-1651`）採雙引擎：

1. **Sonar 研究引擎**（Perplexity）— 帶 `researchStyle` personality 字串，產生研究脈絡
2. **CO-STAR 創意引擎** — 接收研究結果，依 `directorStyle` 輸出結構化腳本

`buildDirectorSystemPrompt`（`server/services/siteKnowledge.ts`）負責拼接 system prompt，引用 `GENERATION_MODALITIES_KNOWLEDGE` 與 `WORKFLOW_KNOWLEDGE`。

節流：見 `director.ts` 中的 Perplexity throttle 邏輯（節流統計透過 `perplexityThrottleStatus` 暴露）。

## 3. Personality 系統（三層）

| 層 | 位置 | 角色 |
|---|---|---|
| Server tonal prompts | `server/services/director/personality.ts` | 包含 `researchStyle` / `directorStyle` / `proactiveHint` / `systemPreamble` 四子欄；給 `runDirectorAI`、`parseScriptIntoSegments`、`discussSegmentWithAI`、`discussPlanningPhase`、`analyzeEmotionalDepth`、`generateSegmentCostar` 與 `buildDirectorSystemPrompt` 使用 |
| Client UI hint | `client/src/components/director/personalityHints.ts`（或 `DirectorAI.tsx` 內 `PERSONALITY_SYSTEM_PROMPTS`） | 僅作 chat box placeholder，不送 LLM |

三種 personality：`calm`、`creative`、`technical`。子欄位語氣刻意不同（research vs creative 階段），不可合併。

## 4. 三種操作模式

| Tab | 對應 procedures |
|---|---|
| `chat` | `director.chat`、`director.refineScript`、`director.templates`、`director.quickActions` |
| `script` (腳本分析) | `director.importScript`、`director.discussSegment`、`director.exportScript`、`director.generateSegmentCostar`、`director.batchGenerateCostar`、`director.analyzeScriptOverview`、`director.estimateSegmentCost`、`director.generationModels` |
| `planning` (長腳本規劃) | `director.planningDiscuss`、`director.planningAnalyzeDepth`、`director.planningCreateMilestones` 與其 session CRUD |

## 5. 生成 Pipeline

```
autoGenerateFromSegments
    ↓
executeGenerationTask  ← 扣點 (points)
    ↓
falDispatcher (modelPricing 計價)
    ↓
pollGenerationTask  ← 失敗時退點
    ↓
webhook 通知前端 / DB 寫回任務狀態
```

註：基於金流風險考量，`executeGenerationTask` / `pollGenerationTask` 保留於 `server/routers/director.ts` 內，未抽至 service 層。

## 6. Handoff 流

**入：Agent → Director**
- `client/src/lib/director-handoff.ts`：`buildDirectorHandoffPayload`、`writeDirectorHandoff`、`readAndClearDirectorHandoff`
- 儲存於 `sessionStorage` key `directorHandoff`（隨 tab 過期）

**入：Studio → Director（回返）**
- `sessionStorage` key `directorReturn`
- 來源：`/image-studio`、`/video-studio`、`/pro-studio`

**出：Director → Studio**
- `director.askForStudioPlan` procedure 回傳導航 action，前端跳轉至 studio

## 7. Orb 工具註冊

```
shared/global-agent-tools.ts   (註冊 director.suggestPlan)
        ↓
server/services/agentToolExecutor.ts   (dispatch)
        ↓
server/services/spiritTools/directorTools.ts   (純函式 helpers)
    - composeWorkflow
    - estimateBudget
    - suggestHandoff
    - refineWorkflow
```

此 indirection（dynamic `import()` 純函式）是刻意的 plugin 形狀，不應合併為單一 dispatcher。

相關共用 metadata：
- `shared/orb-agent-roles.ts`
- `shared/cross-modality-workflows.ts`
- `shared/orb-cost-governor.ts`
- `shared/agent-skills.ts`

## 8. Brain Config Wiring

所有 LLM 呼叫都經 `ctx.brain.getBrain("director")` 取得模型設定。回歸測試見 `server/__tests__/director/brain-config-wiring.test.ts`。

## 9. 持久化模型

| 範圍 | 儲存 | Key / 機制 |
|---|---|---|
| 規劃草稿 | localStorage | `hs.director.planningDraft.v1` |
| Session（chat） | server DB (`db.createProjectNote`) | title prefix `[導演對話]` |
| Session（腳本） | server DB | title prefix `[長腳本規劃]` |
| 規劃里程碑 | server DB | title prefix `[規劃里程碑]` |
| Handoff payload | sessionStorage | `directorHandoff`、`directorReturn` |

## 10. Eval 覆蓋

**現有**：
- `server/eval/cases/delegationFromDirector.eval.ts` — 導演 → 專家 spirit 委派

**建議補強**（未在本次整理範圍內）：
- `directorChatCostar.eval.ts` — `runDirectorAI` CO-STAR 輸出驗證
- `directorPlanningPhaseProgression.eval.ts` — `[反問]` / `[意圖卡]` 標記契約
- `directorScriptImport.eval.ts` — Fountain 樣本解析欄位齊全

## 附錄：檔案地圖

### Server
- `server/routers/director.ts` — tRPC 路由（保留所有 25+ procedures；行為層）
- `server/services/director/personality.ts` — 三種人格的 prompt 唯一來源（researchStyle / directorStyle / proactiveHint / systemPreamble）
- `server/services/director/templates.ts` — DIRECTOR_TEMPLATES、QUICK_ACTIONS、withTimeout、extractMessageJson
- `server/services/director/exportFormats.ts` — generateExport（JSON/CSV/MD/SRT/FDX/custom）+ 時間/XML 工具
- `server/services/director/costarService.ts` — `runDirectorAI` 雙引擎 RAG（Sonar 研究 + CO-STAR 創意）
- `server/services/director/scriptAnalysisService.ts` — `parseScriptIntoSegments`、`discussSegmentWithAI`
- `server/services/director/planningService.ts` — `discussPlanningPhase`、`analyzeEmotionalDepth`、`PLANNING_PHASE_PROMPTS`
- `server/services/spiritTools/directorTools.ts` — Orb 工具 helpers
- `server/services/siteKnowledge.ts` — `buildDirectorSystemPrompt` 與 modality / workflow knowledge

### Client
- `client/src/pages/DirectorAI.tsx` — 主頁面（已抽離常數、utils、leaf 元件，剩 ~5839 行 / 主要為三個 Tab 的 JSX + state hooks）
- `client/src/components/director/constants.ts` — PERSONALITIES、PLANNING_PHASES、STATUS_CONFIG、TIER_COLORS、MODALITY_BADGES、PERSONALITY_SYSTEM_PROMPTS（client UI hint only）等
- `client/src/components/director/utils.ts` — `scenesFromSegments`
- `client/src/components/director/BatchGenerationDialog.tsx` — 批次生成對話框
- `client/src/components/director/QuickActionChip.tsx` — 快速動作 chip
- `client/src/components/director/SessionItem.tsx`、`PlanningSessionItem.tsx` — Session 列表項目
- `client/src/lib/director-handoff.ts` — Handoff 工具

### Tests
- `server/__tests__/director/` — `orb-tool.test.ts`、`brain-config-wiring.test.ts`、`override-wiring.test.ts`、`auto-generation.test.ts`、`agent-tools.test.ts`
- `tests/unit/client/director-handoff.test.ts`
- `server/eval/cases/delegationFromDirector.eval.ts`

### Scripts
- `scripts/model-harness/director-smoke.mjs` — Director AI smoke harness

---

## 整理歷程（2026-05 reorganization）

本文件對應的目錄結構是於 2026-05 進行系統性整理後的狀態。整理範圍與成果：

### 已完成

| 階段 | 工作 | 影響 |
|---|---|---|
| Phase 0 | 建立架構文件骨架 | 新增本文件 |
| Phase 1 | 移除「to be merged」殭屍檔 | `pages/DirectorAI_batch_dialog.tsx` → `components/director/BatchGenerationDialog.tsx` |
| Phase 2 | 整理 5 個錯位的測試檔 | `server/director-*.test.ts` → `server/__tests__/director/*.test.ts` |
| Phase 3 | 集中 personality prompts | 三處微妙不同的定義 → 單一來源 `services/director/personality.ts`（保留 4 個語意子欄位） |
| Phase 4a | 抽純 helper 與資料 | `withTimeout`、`extractMessageJson`、`DIRECTOR_TEMPLATES`、`QUICK_ACTIONS`、`generateExport` 等 → `services/director/templates.ts`、`exportFormats.ts` |
| Phase 4b | 抽 CO-STAR 雙引擎 | `runDirectorAI` → `services/director/costarService.ts` |
| Phase 4c | 抽腳本分析 | `parseScriptIntoSegments`、`discussSegmentWithAI` → `services/director/scriptAnalysisService.ts` |
| Phase 4d | 抽規劃服務 | `discussPlanningPhase`、`analyzeEmotionalDepth`、`PLANNING_PHASE_PROMPTS` → `services/director/planningService.ts` |
| Phase 5 (部分) | 抽前端常數、utils、leaf 元件 | `constants.ts`、`utils.ts`、`QuickActionChip`、`SessionItem`、`PlanningSessionItem` |
| Phase 6 | 完成本架構文件 | 反映拆分後新結構 |

### 行數變化

| 檔案 | 整理前 | 整理後 | 變化 |
|---|---|---|---|
| `server/routers/director.ts` | 4,049 | 2,466 | −1,583（−39%） |
| `client/src/pages/DirectorAI.tsx` | 6,196 | 5,839 | −357（−5.8%） |
| `client/src/pages/DirectorAI_batch_dialog.tsx` | 268 | 0（刪除/搬移） | — |

伴隨新增 9 個服務／元件檔，總程式碼量大致相當，但每檔關注點清晰、可獨立 review。

### 明確未做的部分（風險／投報未對齊）

- **未抽 `executeGenerationTask` / `pollGenerationTask`** 出 router：涉及扣點與退點，金流風險高，本次保守保留。
- **未拆 DirectorAI.tsx 的三個 Tab 子元件**（`ChatTab`/`ScriptAnalysisTab`/`PlanningTab`）：tab 級拆分需重塑 80+ props 與 closure，風險與工作量不對等。
- **未拆 `SegmentDiscussionPanel`（638 行）、`GenerationPipelinePanel`（559 行）** 等大型 memo 元件：與 tab 拆分屬同一層次的工作，預留為下一階段。
- **未擴增 Eval 覆蓋**：目前僅有 `delegationFromDirector.eval.ts`；CO-STAR 輸出、規劃階段標記契約、腳本匯入欄位驗證等可作為下階段任務。

### Brain Config Wiring 測試擴展

`server/__tests__/director/brain-config-wiring.test.ts` 是 source-scan 型 regression 測試，原本只掃 `server/routers/director.ts`。本次整理過程中，每抽出一個含 `invokeLLM` 的服務檔，測試的 source 路徑列表都同步擴增，目前涵蓋：

- `server/routers/director.ts`
- `server/services/director/costarService.ts`
- `server/services/director/scriptAnalysisService.ts`
- `server/services/director/planningService.ts`

這保證 brain config wiring 的「每個 invokeLLM 必須帶 model/temperature/topP」契約跨檔案不漏。

# Director AI Architecture

> 本文件記錄 `/director` 頁面背後的「導演 AI」系統架構，涵蓋雙引擎 RAG 流程、Personality 系統、三種操作模式、生成 pipeline、Handoff 流、Orb 工具註冊、Brain config wiring、持久化模型、與 Eval 覆蓋。

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

註：基於金流風險考量，`executeGenerationTask` / `pollGenerationTask` 保留於 `server/routers/director/generation.ts` sub-router，不抽到 service 層。

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
- `server/routers/director/` — sub-routers（`index.ts`、`schemas.ts`、`chat.ts`、`sessions.ts`、`preferences.ts`、`scriptAnalysis.ts`、`planning.ts`、`generation.ts`、`studioPlan.ts`）
- `server/services/director/` — services（`personality.ts`、`templates.ts`、`exportFormats.ts`、`costarService.ts`、`scriptAnalysisService.ts`、`planningService.ts`）
- `server/services/spiritTools/directorTools.ts` — Orb 工具 helpers
- `server/services/siteKnowledge.ts` — `buildDirectorSystemPrompt` 與 modality / workflow knowledge

### Client
- `client/src/pages/DirectorAI.tsx` — 主頁面
- `client/src/components/director/` — 拆分後子元件（`BatchGenerationDialog`、`ScriptImportPanel`、`QuickActionChip`、`SegmentDiscussionPanel`、`GenerationPipelinePanel`、`GenerationTaskRow`、`GenerationProgressPanel`、`ExportPanel`、`ProactiveQuestionBubble`、`ScriptCard`、`SessionItem`、`PlanningSessionItem`、`constants.ts`、`utils.ts`、`personalityHints.ts`）
- `client/src/lib/director-handoff.ts` — Handoff 工具

### Tests
- `server/__tests__/director/` — `orb-tool.test.ts`、`brain-config-wiring.test.ts`、`override-wiring.test.ts`、`auto-generation.test.ts`、`agent-tools.test.ts`
- `tests/unit/client/director-handoff.test.ts`
- `server/eval/cases/delegationFromDirector.eval.ts`

### Scripts
- `scripts/model-harness/director-smoke.mjs` — Director AI smoke harness

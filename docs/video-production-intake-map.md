# 影片製作優先收編盤點（V0.5 Video Production Focused Intake）

> 對應 Notion〈完整開發細節與實作規格（2026-05-23）〉PR 0。
> 目的：在動任何 UI 大改前，先盤點「直接服務導演 AI 影片製作鏈路」的既有能力，
> 標記每個能力的去留，並指出它應落在影片工作台的哪一段。**只列影片相關能力**，
> 不做全站 route 整理、不接 Perplexity / SubQ / 外部 MCP。

## 0. 影片製作鏈路（北極星）

```
project context → 腳本/分鏡/segment → video session → queue → retry/review → output asset → project timeline
```

舒適體驗要求：使用者隨時知道自己在哪個 project／哪支影片／哪一段；生成前看得到成本；
狀態清楚（draft / ready / queued / processing / review / final / failed）；可中斷、可回來、不重複輸入。

## 1. 工作台階段 ↔ 落點（placement）

對齊規格 4.1 的 `suggestedPlacement`：

| 階段（左側流程導覽） | 落點 placement | 主要承接元件 / 來源 |
|---|---|---|
| Idea / Brief | `create_summary` | `/create` IntentComposer、director chat |
| Script | `director_workspace` | `/director` 腳本分析 tab |
| Storyboard | `director_workspace` | `/director` 分鏡、`media.storyboard` |
| Segments | `director_workspace` | `/director` segment 清單（→ M3 video session） |
| References | `asset_reference_panel` | 數位資產庫、最近素材、Context Tray |
| Queue | `video_queue_panel` | `/video-studio` job / `background_jobs` |
| Review / Retry | `review_retry_panel` | `/video-studio` 狀態輪詢、逐段重跑 |
| Final Output | `asset_reference_panel` | output asset 回寫資產庫 + project timeline |

## 2. 頁面盤點（keep / merge / hide / later）

| 路由 | 頁面 | 角色 | 處置 | 落點 / 備註 |
|---|---|---|---|---|
| `/create` | `CreationHub` | 創作意圖入口（M1-A/M1-B） | **keep** | create_summary：active project context + intent，已接 `commander.createIntent` |
| `/director` | `DirectorAI` | 對話 / 腳本 / 分鏡 / 規劃 / 世界觀 | **keep** | director_workspace 主體；本次新增頂部 ProjectContextStrip |
| `/video-studio` | `VideoStudio` | 影片模型、queue、job、狀態輪詢 | **merge** | 視覺與資料流收進影片工作台 queue/review（V1→V3），但保留模型能力 |
| `/animation`, `/animation/:storyboardId` | `AnimationStudio` | 分鏡 → 動畫 | **later** | 影片主線穩定後再收編；先不動 |
| `/image-studio` | `ImageStudio` | 圖片 / keyframe / reference | **keep** | asset_reference_panel：產 keyframe / 參考圖供影片 segment 使用 |
| `/pro-studio` | `ProStudio` | 進階多模態工作室 | **later** | 與影片直接相關的能力（i2v 前置）日後再挑進來 |
| `/light-orb-studio` | `LightOrbCreationStudio` | 光球創作工作室 | **later** | 非影片主線；保留 |
| `/projects`, `/projects/:id` | `ProjectsListPage` / `CreativeProjectPage` | 專案骨架 + timeline | **keep** | output asset / video session 最終回寫此處（V3/V4） |

> `merge` 的 `/video-studio` 並非刪除：第一階段先把它的「模型清單 + 生成 + 輪詢」
> 當成影片工作台 queue / review 的後端能力來用，UI 收斂留待 V1→V3。

## 3. 後端能力盤點

| 能力 | 檔案 | 處置 | 落點 |
|---|---|---|---|
| 雙引擎腳本生成（Sonar + CO-STAR） | `server/services/director/costarService.ts` | keep | Script |
| 腳本 → segments 拆解 | `server/services/director/scriptAnalysisService.ts` | keep | Segments |
| 長腳本規劃 | `server/services/director/planningService.ts` | keep | Brief / Script |
| 影片模型路由 + 替代規則 | `server/services/falModels.ts`、`falDispatcher.ts` | keep | Queue |
| 情緒→運鏡、frame anchoring、duration hints | `server/services/videoCompiler.ts` | keep | Segments / Queue |
| 影片模型 / queue / job procedures（30+） | `server/routers/videoStudio.ts` | merge | Queue / Review |
| 專案上下文摘要（M1-A） | `server/subsystems/projectContext/` | keep | create_summary / 全頁脈絡列 |
| 創作意圖總指揮（M1-B） | `server/subsystems/commander/` | keep | create_summary（openTasks 已接入 M1-A） |
| **缺**：video session / segment job 持久化 | （尚未建立） | **later (M3)** | `video_generation_sessions`、`video_segment_jobs` |
| **缺**：影片 output → project asset link | （尚未建立） | **later (M4)** | `project_asset_links`、`asset_generation_events` |

## 4. 光球 / PageAgent / Agent 工具盤點

| 工具 / 動作 | 來源 | 服務影片的時機 | 處置 |
|---|---|---|---|
| `director.suggestPlan` | `shared/global-agent-tools.ts` → `spiritTools/directorTools.ts` | Brief：把目標拆成步驟 | keep |
| `director.composeWorkflow` | 同上 | Brief→Segments：image→video→voice→music 串接 | keep |
| `director.estimateBudget` | 同上 | 生成前成本提示 | keep |
| `director.suggestHandoff` / `refineWorkflow` | 同上 | 在工作台間導引下一步 | keep |
| `media.storyboard` | `shared/global-agent-tools.ts` | Storyboard：產分鏡 | keep |
| `studio.generateVideo` / `studio.enhanceVideo` | `shared/global-agent-tools.ts` | Queue：實際生成 / 強化 | keep |
| 影片專家工具 | `server/services/spiritTools/videoSpecialistTools.ts` | Segments / Queue | keep |
| 圖片 / 配音 / 音樂專家工具 | `imageSpecialistTools.ts`、`voiceSpecialistTools.ts`、`musicSpecialistTools.ts` | References / Final（配音、配樂、keyframe） | keep |
| DirectorAI PageAgent 註冊 | `client/src/pages/DirectorAI.tsx`（`useRegisterPageAgent`） | 全程：光球可在導演頁直接操作 | keep |

可立即服務影片製作的光球動作（不需新後端）：

- 「把這段拆成 N 個鏡頭」→ 腳本分析 `discussSegment`。
- 「第 X 段失敗了，只重跑這段嗎？」→ 待 M3 video session / segment job 後接（目前 `/video-studio` 已可單 job 輪詢）。
- 「目前可用 N 個參考素材，套到所有段落嗎？」→ References / 資產庫。
- 「這次預估成本較高，先生成低成本 draft 嗎？」→ `director.estimateBudget` + 模型路由。

## 5. 本次（資料迴路 + 舒適細節）已落地

- M1-B `orchestration_runs` 接進 M1-A `getProjectContextSummary` 的 `openTasks`
  （非 completed / cancelled；failed 仍視為待辦）。
- `/create` `ActiveProjectContextPanel` 顯示「未完成任務」含 mode / 狀態 / 成本。
- `/director` 頂部新增 `ProjectContextStrip`：專案、世界觀、未完成意圖一行可見。

## 6. 明確延後

- video session / segment job 持久化（M3 / V2–V3）。
- 影片 output 的 project asset ledger（M4 / V4）。
- Connection Center、team data、雲端、使用者自帶 MCP / AI provider（V5+ / Later）。
- Perplexity grounding、SubQ 長上下文調度（Later）。
- `/animation`、`/pro-studio`、`/light-orb-studio` 的收編與全站導航重構。

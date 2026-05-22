# Healing Studio — 架構 Vision

> 這份文件是架構的「根」。所有「這段程式碼應該放哪裡？」的問題都先回到這裡找答案。
> 當與此文件衝突的舊 audit / status 文件出現時，以本文為準。

## Context

healing-studio 是一個 React 19 + Express + tRPC v11 + Drizzle/MySQL 的單體應用，部署在 Railway / Docker。功能涵蓋生成式 AI 創作工坊、學習中心、Agent/Orb、Studio 系列。內部已累積明顯整合債：

- `.env.example` 257 行、跨 9 個以上 AI 供應商（OpenRouter、Anthropic、Gemini、Vertex、Forge、NVIDIA NIM、Fal.ai、Replicate、Suno、ElevenLabs）。
- `server/routers/learnHub.ts` 約 1.2 萬行；`brainPipeline.ts`、`director.ts`、`proStudio.ts` 各 2–3K 行。
- Client (`shared/global-agent-orchestrator.ts`) 與 Server (`server/services/orbTaskOrchestrator.ts`) 各自有一份 Orchestrator，只共享型別。
- 過去 24 小時內出現 4 個「修側邊欄」的 PR；capability registry 仰賴 `audit_orb.py` + `deep_audit.py` 手動稽核。
- 儲存層 GCS / S3 並存、音訊有三個供應商，皆無統一介面。
- `docs/` 散落 8+ 份重疊的 audit/status markdown。
- production 路徑仍有 13+ 個 TODO（orbFeatureDiscovery、orbLongTermMemory、emailService SMTP 等）。

本文定義目標形狀（不是時程）：邊界明確的子系統、彼此之間的縫合介面、以及未來每次決策時的原則。

---

## 1. 七條架構原則

1. **每類外部能力只走一個 gateway。** 所有 LLM、媒體生成、Blob 儲存、語音合成都走唯一的 in-process gateway。供應商是可替換的實作，router 與 UI 不直接 import。
2. **Config-as-code，不要 config-as-env-JSON。** 模型目錄、fallback chain、tool registry、scheduler seed 放在 `server/config/*.ts`；`.env` 只留 secrets 與部署旗標。
3. **Capability registry 是「派生」的，不是手寫的。** 導覽、slash command、Orb tool list、feature flag 由檔案系統慣例 + decorator 在 build time 產生。完成後 `audit_orb.py`/`deep_audit.py` 退役。
4. **單一 orchestrator 模型，兩個部署目標。** 狀態機、tool schema、plan 格式放 `shared/`；client/server 各自只實作 I/O adapter。
5. **Domain router 每檔上限約 800 行。** 超過就按資料表 noun 邊界切，用 tRPC `mergeRouters` 拼回。
6. **每個子系統擁有自己的 contract。** 跨子系統呼叫只能透過 `<subsystem>/contracts.ts` 匯出的 interface。
7. **Observability 是子系統。** Logger、metrics、LangSmith、cost 一次接好，透過 ctx 注入。

---

## 2. 子系統地圖

| 子系統 | 目的 | 落地位置 |
|---|---|---|
| **影片系統（垂直切片，Step 0）** | 把 Worldview + DirectorAI + Video Models 縫成連續工作流，圍繞 `creative_projects` 與 `videoGenerationSession` | `server/subsystems/video/`（contracts + adapters） |
| Config & Provider Registry | 模型/供應商/fallback/定價的單一事實來源 | `server/subsystems/config/` |
| Generation | 文字 / 圖 / 影 / 音 / 3D / Embedding 統一 gateway | `server/subsystems/generation/` |
| Storage | GCS + S3 + local 統一在單一 StorageProvider | `server/subsystems/storage/` |
| Auth & Identity | Google OAuth、session、owner/guest、webhook token | `server/subsystems/auth/` |
| Agent / Orchestrator | 單一狀態機，client/server 都能跑 | `shared/orchestrator/` + `server/subsystems/agent/` |
| Capability Registry & Navigation | 從檔案派生的導覽、slash、tool list | `shared/registry/`（build-time generated） |
| Domain Routers | LearnHub、Studio、Creative、Worldbuilding、Director、Spirits… | `server/domains/<name>/` |
| Observability | Logger、metrics、trace、cost ledger | `server/subsystems/observability/` |
| Persistence | Drizzle schema + migrations（現況良好，沿用） | `db/`、`drizzle/` |

> 「影片系統」既是子系統也是垂直切片：它消費 Generation、Storage、Observability 的 v0.1 介面，本身也對外 export `VideoSystem` contract。它的存在迫使其他子系統長出最小可用形狀。

每個 `server/subsystems/<x>/` 對外只暴露三樣東西：`contracts.ts`（interface）、`register(app)`（wiring）、typed config schema。其餘檔案外部不可 import。

---

## 3. 範例 Contract

### 3.1 Generation

```ts
// server/subsystems/generation/contracts.ts
export type Modality = 'text' | 'image' | 'video' | 'audio' | 'embedding' | '3d';

export interface GenerationRequest<M extends Modality> {
  modality: M;
  modelHint?: string;          // "fast" / "quality" / 明確 modelId
  input: ModalityInput[M];
  budget?: { maxCostUsd?: number; maxLatencyMs?: number };
  trace: TraceContext;
  userId: string;
}

export interface GenerationResult<M extends Modality> {
  modality: M;
  output: ModalityOutput[M];
  providerUsed: string;
  modelUsed: string;
  costUsd: number;
  latencyMs: number;
  fallbacksAttempted: string[];
}

export interface GenerationGateway {
  generate<M extends Modality>(req: GenerationRequest<M>): Promise<GenerationResult<M>>;
  stream<M extends 'text' | 'audio'>(req: GenerationRequest<M>): AsyncIterable<Chunk<M>>;
  estimate(req: GenerationRequest<Modality>): Promise<{ costUsd: number; eta: number }>;
}
```

Gateway 內部：Config Registry 解析 `modality + modelHint` → 選 provider → `fallbackPolicy` → `deduplication` + `rateLimiter` → 發 trace span。Fal/Replicate/Suno/ElevenLabs/OpenRouter 全部變成 `providers/<name>.ts` 實作 `ProviderAdapter`，外部不可 import。Router 只呼叫 `ctx.gen.generate(...)`，不知道 Fal.ai 存在。

### 3.2 Storage

```ts
// server/subsystems/storage/contracts.ts
export interface BlobHandle {
  id: string;                     // "gcs:bucket/path" 前綴
  url(): Promise<string>;         // 用時才簽
  contentType: string;
  sizeBytes: number;
  metadata: Record<string, string>;
}

export interface StorageProvider {
  put(input: PutInput): Promise<BlobHandle>;
  get(id: string): Promise<BlobHandle>;
  delete(id: string): Promise<void>;
  signUrl(id: string, opts: { ttlSec: number; method: 'GET' | 'PUT' }): Promise<string>;
  list(prefix: string, opts?: ListOpts): AsyncIterable<BlobHandle>;
}
```

後端選擇藏在 handle 前綴內，呼叫者不選後端。`RoutedStorage` 依 prefix / 內容分類分派。

### 3.3 其他（速寫）

- **Agent**：`Orchestrator { propose(plan), step(state, event) → {state, effects[]}, snapshot(), restore() }`，純 function 在 `shared/orchestrator/`。
- **Capability Registry**：build-time script 走訪 `server/domains/*/capabilities.ts`，產生 `shared/registry/generated.ts`。
- **Observability**：`ctx.obs.span(name, fn)`、`ctx.obs.cost(usd, tags)`、`ctx.obs.log(...)`。

---

## 4. 推進順序

### Step 0 — 影片系統垂直切片（決定先做這個）

橫向收斂底層（Config、Storage、Generation）是「正確但不立即可見」的工作。為了讓首波整合就有可驗證的使用者價值，先做一個垂直切片：把**世界觀 + 導演AI + 影片模型**縫成一個連續工作流，順手把這條路徑上需要的底層 contract 真實長出來。

**現況斷點**（來自 2026-05-22 整合稽核）：

| 方向 | 狀態 | 缺口 |
|---|---|---|
| Worldview → Director | ✅ 半通 | `director.generateVideoScript` 接受 `worldFrameworkId`；UI 有 `WorldbuildingPanel`。**缺**：Director 沒有從 active project 自動載入 worldFramework |
| Worldview → Video | ✅ 已通 | VideoStudio 多處呼叫 `useWorldContext().injectIntoPrompt()`，T2V/I2V/V2V 全部前綴 consistency summary |
| **Director → Video** | ❌ **斷** | Director 產生的 `ScriptSegment[]` **不會**自動流到 VideoStudio queue；結果只散落在 director session notes 與個別 backgroundJobs |
| CreativeProject 綁定 | ⚠️ 半綁 | `creative_projects` 有 `directorSessionId`、`worldFrameworkId`、`worldStoryboardId`，但 `worldStoryboardId` 沒人讀；segment→video 對應沒被持久化 |
| `videoCompiler.ts` | ❌ 孤立 | 情緒→動作映射、攝影機向量、frame anchoring 都寫好了，但 Director / VideoStudio router 都沒 wire 進去 |

**這個切片要交付的單一概念**：在 `creative_projects` 之上長一個 `videoGenerationSession`，作為 segment → 影片任務 → 結果回寫的中介。它變成「影片系統」對外的整合錨點。

**核心 contract（草案）**：

```ts
// server/subsystems/video/contracts.ts
export interface VideoSegmentInput {
  segmentId: string;              // 來自 director ScriptSegment
  worldFrameworkId?: string;      // 自動套用 consistency prefix
  visualPrompt: string;
  durationSec: number;
  cameraHint?: CameraVector;      // 從 videoCompiler 解出
  refImageHandle?: BlobHandle;    // 來自 Storage 子系統
}

export interface VideoGenerationSession {
  id: string;
  projectId: string;
  directorSessionId: string;
  segments: VideoSegmentInput[];
  jobs: Array<{ segmentId: string; jobId: string; status; resultHandle?: BlobHandle; costUsd?: number }>;
  consistency: { lockedLoras: string[]; styleProfileId?: string; negativePromptGlobal: string };
}

export interface VideoSystem {
  importFromDirector(sessionId: string, opts: { worldFrameworkId?: string }): Promise<VideoGenerationSession>;
  enqueueAll(sessionId: string, opts: { modelHint?: string; budget?: Budget }): Promise<void>;
  pollSession(sessionId: string): Promise<VideoGenerationSession>;
  finalizeToProject(sessionId: string): Promise<{ assetHandles: BlobHandle[] }>;
}
```

**這個切片會「順便」逼出來的底層**（與 §2 子系統地圖對齊）：

- **Generation gateway 的最小可用實作**：只需 video modality 與 1–2 個 provider（Fal/Replicate 既有），透過 `ctx.gen.generate({ modality: 'video', ... })` 呼叫，先不抽走所有 LLM 路徑。
- **Storage 的最小可用實作**：影片輸出與 ref image 統一走 `BlobHandle`，把現有 `mediaArchivalService` 包成 GCS provider。
- **Observability 的最小注入點**：每個 segment 任務都有 trace span 與 cost 紀錄。

也就是說：影片系統垂直切片的同時，會落地三個橫向子系統的 v0.1，每個都「夠用」就好，不追求一次抽乾全站。

**驗收標準**（Step 0 完成的定義）：

1. 在一個 `creative_project` 上：建立 director session → 產生 ScriptSegments → 一鍵把 segments import 為 video generation session → 批次送進 VideoStudio queue → 完成後結果回寫到 project 的 assets。
2. 整條鏈路自動套用該 project 的 worldFramework consistency prefix 與 LoRA。
3. `server/subsystems/video/` 對外只暴露 `contracts.ts` 與 `register()`，內部 Fal/Replicate adapter 不被其他 router 直接 import。
4. 至少 1 個 contract test（`tests/subsystems/video.test.ts`），用 fake provider adapter 驗證 import → enqueue → finalize。
5. `docs/ARCHITECTURE.md` §7 進度表更新「影片系統」前後數字。

---

### 完成 Step 0 之後再做（橫向收斂）

1. **Config & Provider Registry** — Step 0 留下的 video provider 設定先搬到 `server/config/`，再擴展到全站。預期 `.env.example` 大幅縮減。
2. **Observability** — 把 Step 0 的 trace 模式推到全站。
3. **Storage** — 把 Step 0 的 `BlobHandle` 雛形擴展為完整 GCS + S3 + local。
4. **Generation** — Step 0 證實過後，再把 text / image / audio 全部收進同一 gateway。
5. **Auth** — 拓展更多 surface 前先收緊，退役 `OAUTH_SERVER_URL` / `OWNER_OPEN_ID`。
6. **Agent / Orchestrator** — 在 Generation / Storage 都成為 gateway 之後，orchestrator 萎縮為「選 tool → 呼叫 gateway」。合併 client/server 兩份 orchestrator。
7. **Capability Registry & Navigation** — 自動派生；完成後刪除 `audit_orb.py` / `deep_audit.py`。
8. **Domain Router 拆分** — 隨功能異動時 opportunistic 進行。

---

## 5. 各子系統重點現有檔案

**影片系統（Step 0 垂直切片）**
- `drizzle/schema.ts`（`worldbuildingFrameworks`、`worldStoryboards`、`creativeProjects` 三表的綁定關係，line ~3163–3330）
- `server/routers/creativeProject.ts`（spine — 要擴 `videoGenerationSession`）
- `server/routers/director.ts`（`generateVideoScript`、`parseScriptIntoSegments`、`autoGenerateFromSegments`、`executeGenerationTask`）
- `server/routers/videoStudio.ts`（`falQueueSubmit/Status`、Kling/Wan/Veo/LTX/Runway 等 procedures）
- `server/routers/worldbuilding.ts`（`consistencyCheck`、`linkableModels`、`getFrameworkReadiness`）
- `server/services/videoCompiler.ts`（孤立 — 要 wire 進影片系統）
- `server/services/director/scriptAnalysisService.ts`
- `shared/worldbuilding-types.ts`（`summarizeFrameworkForPrompt`）
- `client/src/pages/DirectorAI.tsx`（233KB — segment 編輯、session 持久化）
- `client/src/pages/VideoStudio.tsx`（195KB — 五種生成模式、queue UI）
- `client/src/contexts/WorldContextContext.tsx`（`injectIntoPrompt` 的黏著層）
- `shared/aiModelsCatalog.ts` / videoModelCatalog.ts（影片模型 SSOT）

**Config & Provider Registry**
- `server/_core/env.validated.ts`（Zod 自我修復，沿用）
- `server/_core/modelRegistry.ts`
- `server/_core/fallbackPolicy.ts`
- `shared/unifiedModelRegistry.ts`
- `server/services/modelPricing.ts`

**Generation**
- `server/_core/llm.ts`（既有 unified invocation，是 gateway 雛形）
- `server/_core/imageGeneration.ts`
- `server/services/falDispatcher.ts`
- `server/services/geminiMedia.ts`
- `server/services/generationJobDispatcher.ts`

**Storage**
- `server/services/googleDrive.ts`
- `server/services/mediaArchivalService.ts`
- `server/services/internalMedia.ts`
- `server/services/replicateClient.ts`（上傳 pattern 參考）

**Agent / Orchestrator**
- `shared/global-agent-orchestrator.ts`
- `server/services/orbTaskOrchestrator.ts`
- `shared/orb-task-state-machine.ts`
- `server/services/agentToolExecutor.ts`
- `server/services/orbTaskStateMachine.ts`

**Observability**
- `server/_core/logger.ts`
- `server/_core/metrics.ts`
- `server/services/langsmithTracer.ts`
- `server/services/costAnalytics.ts`

**Capability Registry**
- `audit_orb.py`、`deep_audit.py`（最終要刪）
- `shared/global-agent-capabilities.ts`
- `shared/slash-commands.ts`
- `client/src/components/`（側邊欄/導覽）

---

## 6. 子系統驗收標準

一個子系統的整合「完成」必須全中以下：

- **Contract 隔離**：子系統外部 `grep -r` 只能 import `contracts.ts` / `index.ts`。
- **Provider 數量可見**：contract test 列舉所有註冊 provider/backend，新增 provider 是單檔一行改動。
- **env 收斂**：記錄整合前後 env var 數量，目標淨減少。
- **稽核腳本退役**：Capability Registry 完成時，`audit_orb.py` 與 `deep_audit.py` 刪除。
- **每個子系統一個整合測試**：`tests/subsystems/<name>.test.ts`，用 fake adapter，不打網路。
- **本文對應章節已寫入**：取代 `docs/` 裡相關舊 audit/status。
- **子系統目錄 TODO grep 為空**：deferred 工作移到 GitHub issues。

最終狀態：本文是單一事實來源、`.env.example` 變短、兩個 Python 稽核腳本消失、orchestrator 只剩一份。

---

## 7. 進度與量測（持續記錄）

| 子系統 | 狀態 | env 數變化 | 最大檔案行數變化 | 整合 PR |
|---|---|---|---|---|
| **影片系統（Step 0）** | 規劃中 | — | `DirectorAI.tsx` 233KB / `VideoStudio.tsx` 195KB → — | — |
| Config & Provider Registry | 未開始 | 257 → — | — | — |
| Observability | 未開始 | — | — | — |
| Storage | 未開始 | — | — | — |
| Generation | 未開始 | — | — | — |
| Auth | 未開始 | — | — | — |
| Agent / Orchestrator | 未開始 | — | — | — |
| Capability Registry | 未開始 | — | — | — |
| Domain Router 拆分 | 未開始 | — | `learnHub.ts` ~12,800 → — | — |

每完成一個子系統，在此表更新「前 → 後」數字。

---

## 8. 驗證指令參考

```bash
npm run typecheck
npm run test
npm run lint
npm run dev      # http://localhost:3000

# 子系統 contract 隔離檢查
npx madge --circular server/subsystems
npx ts-prune

# 子系統 TODO 檢查
find server/subsystems -name "*.ts" -print0 | xargs -0 grep -l TODO
```

# AI 大腦組態(AI Brain Configuration)— 統一說明文件

> 本文件是 Healing Studio「AI 大腦組態」(`/admin` → AI 大腦組態頁)的單一真實來源(SSOT)地圖。
> 凡是新增模型、改 default、調 fallback、加 admin 分頁,請以此文件為對照基準。

---

## 1. 為什麼需要這份文件

「AI 大腦組態」橫跨 25 個可配置槽位、7 個 admin 分頁、5 個前後端模組,容易出現 catalog / defaults / fallback / DB schema 之間的 silent drift(測試仍過、線上才出錯)。本文件把所有移動部件盤點在一頁,搭配 `server/ai-brain-consistency.test.ts` 的 17 條規則,即可在每次重構前快速判斷影響面。

---

## 2. 25 個可配置槽位總覽

### 2.1 5 個推理大腦(Reasoning Brains)

| Slot | 用途 | DB 欄位 | catalog | 預設模型 | Fallback 來源 |
|---|---|---|---|---|---|
| `director` | 統籌創作流程、分鏡、敘事結構(對應 `/director`) | `directorModel` / `directorTemperature` / `directorTopP` / `directorSystemPrompt` / `directorEnabled` | `REASONING_MODEL_CATALOG.director` | `gemini-2.5-pro` @ T=0.4, P=0.9 | `PER_MODEL_FALLBACK["gemini-2.5-pro"]` |
| `analyst` | 數據分析、新聞摘要 | `analystModel` ... | `REASONING_MODEL_CATALOG.analyst` | `gemini-2.5-flash` @ T=0.3, P=0.8 | 同上 |
| `storyteller` | 提示詞編譯、文案撰寫 | `storytellerModel` ... | `REASONING_MODEL_CATALOG.storyteller` | `gemini-2.5-pro` @ T=0.9, P=0.95 | 同上 |
| `technician` | VisualSoul / OARS 語句生成(光球語調) | `technicianModel` ... | `REASONING_MODEL_CATALOG.technician` | `gemini-2.5-flash` @ T=0.2, P=0.7 | 同上 |
| `curator` | 風格推薦、靈感策展(RAG 向量) | `curatorModel` ... | `REASONING_MODEL_CATALOG.curator` | `gemini-2.5-flash` @ T=0.8, P=0.9 | 同上 |

### 2.2 4 個生成引擎(Generation Engines)

| Slot | 用途 | DB 欄位 | catalog | 預設值 | Fallback 來源 |
|---|---|---|---|---|---|
| `imageEngine` | 圖像生成(對應 `/image-studio`) | `imageEngine` / `imageEngineParams` / `imageEngineEnabled` | `GENERATION_ENGINE_CATALOG.imageEngine` | `fal-ai/flux-pro/v1.1` | `PER_CATEGORY_FALLBACK["text-to-image"]` |
| `videoEngine` | 影片生成(對應 `/video-studio`) | `videoEngine` ... | `GENERATION_ENGINE_CATALOG.videoEngine` | `fal-ai/kling-video/v2.1/standard/text-to-video` | `PER_CATEGORY_FALLBACK["text-to-video"]` |
| `audioEngine` | 音樂生成(對應 `/pro-studio`) | `audioEngine` ... | `GENERATION_ENGINE_CATALOG.audioEngine` | `fal-ai/ace-step` | `PER_CATEGORY_FALLBACK["text-to-audio"]` |
| `voiceEngine` | 語音合成(對應 `/pro-studio`) | `voiceEngine` ... | `GENERATION_ENGINE_CATALOG.voiceEngine` | `fal-ai/elevenlabs/tts/turbo-v2.5` | `PER_CATEGORY_FALLBACK["text-to-speech"]` |

### 2.3 16 個 Fal.ai 任務引擎(Fal Task Engines)

每個欄位只接受該 category 內的模型(per-category enum 驗證,`server/_core/modelRegistry.ts:FAL_FIELD_ALLOWLISTS`)。

| 欄位 | 任務分類 | 預設值 |
|---|---|---|
| `falImageTo3dEngine` | image-to-3d | `fal-ai/trellis-2` |
| `falImageToImageEngine` | image-to-image | `fal-ai/flux/dev/image-to-image` |
| `falImageToJsonEngine` | image-to-json | `fal-ai/any-llm` |
| `falImageToVideoEngine` | image-to-video | `fal-ai/kling-video/v2.1/pro/image-to-video` |
| `falJsonEngine` | json | `fal-ai/any-llm` |
| `falLlmEngine` | llm | `fal-ai/any-llm` |
| `falTextTo3dEngine` | text-to-3d | `fal-ai/hyper3d/rodin` |
| `falTextToAudioEngine` | text-to-audio | `fal-ai/stable-audio` |
| `falTextToImageEngine` | text-to-image | `fal-ai/flux-pro/v1.1` |
| `falTextToJsonEngine` | text-to-json | `fal-ai/any-llm` |
| `falTextToSpeechEngine` | text-to-speech | `fal-ai/elevenlabs/tts/turbo-v2.5` |
| `falTextToVideoEngine` | text-to-video | `fal-ai/kling-video/v2.1/pro/text-to-video` |
| `falTrainingEngine` | training | `fal-ai/flux-lora-fast-training` |
| `falVideoToAudioEngine` | video-to-audio | `fal-ai/mmaudio-v2/video-to-audio` |
| `falVideoToTextEngine` | video-to-text | `fal-ai/whisper` |
| `falVideoToVideoEngine` | video-to-video | `fal-ai/kling-video/v2.1/standard/video-to-video` |

---

## 3. 7 個 admin 分頁與資料流

UI:`client/src/pages/AiBrainSettings.tsx`(主檔)+ `client/src/pages/admin/brain/_shared.ts`(類型/常數)+ `client/src/pages/admin/brain/_components/Badges.tsx`(共用徽章)。

| 分頁 | 用途 | tRPC 端點 | 後端服務 |
|---|---|---|---|
| 組態 | 5+4+16 槽位設定、儲存 | `brain.catalog`、`brain.get`、`brain.upsert`、`brain.switchModel`、`brain.healthStatus` | `server/routers/brain.ts` |
| 自動修復 | 系統警報、自動修復開關 | `brain.alerts`、`brain.dismissAlert`、`brain.autoRepairConfig` | `server/services/brainAutoRepair.ts`、`server/jobs/apiHealthMonitor.ts` |
| 錯誤線索 | 失敗請求、診斷、解決 | `brain.errorTraces`、`brain.diagnoseError`、`brain.resolveErrorTrace` | `brainAutoRepair.ts:getErrorTraces` |
| 自我反省 | 優化提案、批准/拒絕 | `brain.proposals`、`brain.approveProposal`、`brain.rejectProposal`、`brain.retryGithubIssue` | `brainAutoRepair.ts:getProposals` |
| 爬網研究 | 網路搜尋、知識整合 | `brain.webSearch`、`brain.getResearchResults`、`brain.addResearchToLearnHub` | `brainAutoRepair.ts:webSearch`(Brave fallback) |
| 精準度測試 | 程式碼掃描、模型基準 | `brain.runAccuracyTest`、`brain.runAllAccuracyTests`、`brain.runCodeScan`、`brain.lastCodeScan` | `brainAutoRepair.ts:runFullCodeScan` |
| LangSmith 監控 | LLM trace 統計 | `langsmith.stats`、`langsmith.listRuns`、`langsmith.getRun` | `server/routers/langsmith.ts`(舊 Express `/api/langsmith/stats` 已移除) |

主檔還有 1 個側邊面板:**大腦管線可視化**(`brain.pipeline.getMyGraph`、`getSummary`、`runPatrol`)。

---

## 4. SSOT(單一真實來源)規則

```
┌────────────────────────────────────────────────────────────────────┐
│ server/_core/modelRegistry.ts        ← catalog × 3 + 衍生 allowlist │
│ ├─ REASONING_MODEL_CATALOG (5 slots)                                │
│ ├─ GENERATION_ENGINE_CATALOG (4 slots)                              │
│ ├─ FAL_TASK_ENGINE_CATALOG (auto-derived from FAL_MODEL_CATALOG)    │
│ ├─ FAL_FIELD_TO_CATEGORY    (16 entries)                            │
│ ├─ FAL_FIELD_ALLOWLISTS     (per-field, per-category)               │
│ └─ getKnownModelIds()       (catalogs ∪ legacy aliases)             │
└────────────────────────────────────────────────────────────────────┘
            ▲                                          ▲
            │ import                                   │ import
            │                                          │
┌─────────────────────────┐               ┌─────────────────────────┐
│ server/routers/brain.ts │               │ server/middleware/      │
│ catalog / upsert /      │               │ brainContext.ts         │
│ switchModel /           │               │ buildBrainContext / ... │
│ healthStatus            │               │ getHealthStatusDetailed │
└─────────────────────────┘               └─────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ server/_core/fallbackPolicy.ts       ← 統一 fallback 政策           │
│ ├─ PER_MODEL_FALLBACK     (per-model 覆寫)                          │
│ ├─ PER_CATEGORY_FALLBACK  (per-category 池;= falDispatcher.       │
│ │                          FALLBACK_CHAINS,re-export 同一參考)     │
│ └─ resolveFallbackChain(modelId, category)                         │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ shared/engineModelIds.ts             ← legacy ID alias 映射         │
│ ├─ LEGACY_FAL_ALIAS_MAP (60+ entries)                               │
│ └─ normalizeEngineModelId(id)        ← UI/DB/dispatcher 邊界都呼叫  │
└────────────────────────────────────────────────────────────────────┘
```

**鐵律**:
1. 任何新增/重命名模型 ID 都應加進 `FAL_MODEL_CATALOG`(若是 Fal)或 `REASONING_MODEL_CATALOG / GENERATION_ENGINE_CATALOG`(若是 LLM/Gemini/Imagen 等)。
2. 改 DB schema default 必須同步 `DEFAULT_REASONING_BRAINS / DEFAULT_GENERATION_ENGINES / DEFAULT_FAL_ENGINES`,並寫一條 Drizzle migration。
3. 改 fallback 必須只動 `server/_core/fallbackPolicy.ts`,不要在 brainContext.ts 或 falDispatcher.ts 內直接寫 chain。
4. 舊 ID 逐步退役時,先加進 `LEGACY_FAL_ALIAS_MAP`,讓 DB 內的舊值仍能 normalize 到 canonical。

---

## 5. 健康檢查語意(Health States)

`getHealthStatus(model)`、`getHealthStatusDetailed(model)`(`server/middleware/brainContext.ts`)

| 狀態 | UI 顯示 | 觸發條件 |
|---|---|---|
| `unverified` | 灰色 + 脈衝、`未驗證` | 模組剛啟動 / 快取 TTL(60s)過期、尚未排程完成 |
| `healthy` | 綠色 + ping 動畫、`已驗證` | 探測成功(`isCanonicalOrKnownModel(id) === true`) |
| `unhealthy` | 紅色、`Offline` | 連續失敗 ≥ 3 次(`MAX_CONSECUTIVE_FAILURES`) |
| (boolean degraded UI) | 琥珀色 + 脈衝、`Degraded` | `consecutiveFailures > 0` 但仍判定為 healthy |

`preflightHealthStatus()` 是同步版本(最多等 3 秒),用於 ultra-tier 影片模型在實際呼叫前驗證可用性,避免使用者掛 5–10 分鐘才發現模型壞掉。

---

## 6. 一致性測試(`server/ai-brain-consistency.test.ts`)

17 條規則,對應 `audits/brain-config-gap-audit-2026-04-20.md` KPI:`設定一致性測試覆蓋:新增至少 8 條規則型測試` ✅(已超標)。

| Rule | 內容 |
|---|---|
| 1 | `REASONING_MODEL_ALLOWLIST` ⊇ `DEFAULT_REASONING_BRAINS` |
| 2 | `GENERATION_ENGINE_CATALOG`(post-normalize) ⊇ `DEFAULT_GENERATION_ENGINES` |
| 3 | `DEFAULT_FAL_ENGINES` ∈ catalog ∪ fallback chain |
| 4-1 | `falDispatcher.FALLBACK_CHAINS` === `fallbackPolicy.PER_CATEGORY_FALLBACK`(同一參考) |
| 4-2 | `resolveFallbackChain("unknown", "text-to-image")` 回到 category 池 |
| 4-3 | `resolveFallbackChain("gemini-2.5-pro")` 合併 per-model + per-category |
| 5-1 | `LEGACY_FAL_ALIAS_MAP` 全部能 round-trip |
| 5-2 | canonical id 正規化具冪等性 |
| 6-1 | `FAL_FIELD_TO_CATEGORY` 涵蓋 16 個欄位 |
| 6-2 | 每個 falTask*Engine allowlist === 對應 category |
| 7-1 | `userAiBrain.voiceEngine.default` === `DEFAULT_GENERATION_ENGINES.voiceEngine` |
| 7-2 | `userAiBrain.imageEngine.default` === `DEFAULT_GENERATION_ENGINES.imageEngine` |
| 7-3 | `userAiBrain.falTextToSpeechEngine.default` === `DEFAULT_FAL_ENGINES.textToSpeech` |
| 8-1 | reasoning catalog 全部 model id 在 known set |
| 8-2 | fal task catalog 全部 model id 在 known set |
| 8-3 | `PER_MODEL_FALLBACK` 鍵都在 known set |
| Bonus | 每個推理槽至少 2 個合法選項 |

---

## 7. 已完成 KPI(對照 audits/brain-config-gap-audit-2026-04-20)

- [x] **無效 model/engine 寫入率 < 0.1%**:`brain.upsert` 對 25 個欄位都套 enum 白名單(per-category for Fal),非法值直接 422。
- [x] **首次請求 fallback 觸發率下降**:健康狀態三態化,UI 顯示「未驗證」,使用者切到新模型時不會見到假的「Online」徽章誤導。
- [x] **fallback 統一**:`fallbackPolicy.ts` 單一來源,`falDispatcher.FALLBACK_CHAINS` re-export 同一參考。
- [x] **設定一致性測試 ≥ 8 條**:已達 17 條(rule + sub-cases)。
- [x] **alias 正規化邊界化**:UI/DB/dispatcher 任一處接收 legacy id 都會經 `normalizeEngineModelId` 轉成 canonical。

---

## 8. 主要檔案索引(供新人 onboarding)

| 路徑 | 角色 |
|---|---|
| `server/_core/modelRegistry.ts` | SSOT:三大 catalog + allowlists + known-models |
| `server/_core/fallbackPolicy.ts` | 統一 fallback 政策 |
| `shared/engineModelIds.ts` | Legacy alias 映射 + normalize |
| `server/routers/brain.ts` | 主 tRPC router(catalog / get / upsert / switchModel / healthStatus / 7 分頁端點) |
| `server/middleware/brainContext.ts` | `ctx.brain` 注入、健康探測、graceful degradation |
| `server/services/brainAutoRepair.ts` | 自動修復、錯誤線索、自我反省、爬網研究、精準度測試 |
| `server/services/falDispatcher.ts` | Fal.ai 任務分派、queue submit、preflight |
| `server/services/falModels.ts` | Fal 16 類目錄 + `callFalModel` SDK wrapper |
| `server/jobs/apiHealthMonitor.ts` | 背景巡檢 cron(預設 3 分鐘) |
| `server/services/langsmithTracer.ts` | LangSmith trace 上傳 |
| `server/routers/langsmith.ts` | LangSmith 統計/runs/feedback tRPC router |
| `drizzle/schema.ts:userAiBrain` | DB schema(25 槽 + 切換 audit log) |
| `drizzle/0021_align_voice_engine_default.sql` | voiceEngine 預設值對齊 migration |
| `client/src/pages/AiBrainSettings.tsx` | 7 分頁 UI 主檔 |
| `client/src/pages/admin/brain/_shared.ts` | UI 共用類型/常數 |
| `client/src/pages/admin/brain/_components/Badges.tsx` | HealthDot / TierBadge / ProviderBadge |
| `server/ai-brain-consistency.test.ts` | 17 條一致性規則測試 |

---

## 9. 後續可做的事

- [x] `getKnownModelIds()` 改為 module-load-time 凍結 — 已於 `_core/modelRegistry.ts` 改用 `const KNOWN_MODEL_IDS = buildKnownModelIds()`,回傳 `ReadonlySet`。
- [x] LangSmith API key 格式檢查 — 已在 `_core/env.validated.ts:186-200` 實作:啟動時若 `LANGSMITH_API_KEY` 非 `lsv2_pt_` / `lsv2_sk_` 開頭,視為未設定並記入 self-repair log。
- [x] `AiBrainSettings.tsx` 7 分頁拆檔 — 6 個非 config 分頁已抽到 `client/src/pages/admin/brain/tabs/`(LangsmithTab / AlertsTab / ProposalsTab / ResearchTab / AccuracyTab / ErrorsTab),每個 130–325 行,自帶 query + mutation + 局部 state。
- [x] 把 LivePreview + 3 個 SlotCard(BrainSlotCard / EngineSlotCard / FalTaskCard)抽到 `client/src/pages/admin/brain/_components/`,共 510 行。主檔從 3329 行降到 **1377 行(-59%)**。
- [ ] `ConfigTab` JSX 抽檔(剩下 ~565 行的 Config tab 內容) — 狀態包含 53 個 useState + 5 個 query + 1 個 mutation + brainQuery → state 同步 effect。屬於完整 form 重構,留作獨立 PR。

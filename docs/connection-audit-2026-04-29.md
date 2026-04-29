# 創作工作室 ↔ 全站光球/光球助手 ↔ 生成管線 接通深度檢查報告

> 日期：2026-04-29
> 分支：`claude/check-studio-connections-7WfCl`
> 範圍：創作工作室、全站代理光球、光球助手、端到端生成管線

---

## 一、檢查結論

整體鏈路 **大部分接通良好**，但發現 5 個關鍵缺口。本次修補已全部處理。

### 接通狀態總表

| 子系統 | 檢查前 | 補完後 | 備註 |
|---|---|---|---|
| 全站光球 UI 掛載 | ✅ | ✅ | `DashboardLayout.tsx:957` |
| 光球助手（OrbGuide）整合 | ✅ | ✅ | `ProactiveOrbWidget.tsx:2051,2430` 內嵌 |
| 全站光球 ↔ 後端 chat | ✅ | ✅ | `trpc.ai.chat`（`server/routers.ts:4250`） |
| 光球助手 ↔ 後端 step | ✅ | ✅ | `trpc.orbGuide.step`（`:5712`） |
| Orb Task 生命週期 | ✅ | ✅ | `trpc.ai.orbTask.*`（`:5401`） |
| Orb Memory 同步 | ✅ | ✅ | `trpc.orbMemory.*`（`:5623`） |
| PageAgent 頁面註冊 | ✅ | ✅ | 8 個工作室 + 16+ 一般頁全部註冊 |
| tRPC root → 各 studio router | ✅ | ✅ | `server/routers.ts:535-544, :2903` |
| fal.ai webhook 回呼 | ✅ | ✅ | `server/routes/webhookFal.ts` 完整實作 |
| SSE 生成事件 | ✅ | ✅ | `generationEvents.ts` + `sseRoute.ts` |
| 上傳路由 | ✅ | ✅ | `uploadRoute.ts`（R2/S3/GCS 抽象） |
| **falDispatcher 統一派發** | ⚠️ 未被使用 | ✅ 已接通 | 新增 `dispatchFalQueueTask`，三 router retrofit |
| **生成工具註冊到光球** | ❌ 缺失 | ✅ 已新增 | `studio.generateImage/Video/Audio/Voice` 4 條 |
| **Suno 音樂生成** | ❌ 死路 | ✅ 已接通 | `proStudio.generateMusicSuno` + `checkMusicSunoStatus` |
| **Replicate LoRA 訓練** | ⚠️ 半成品 | ✅ 已接通 | `loraTrainer.trainWithReplicate` + status query |
| **同步回傳 localize** | ⚠️ 不一致 | ✅ 統一 | videoStudio / proStudio 皆呼叫 `localizeResultUrls` |

---

## 二、修補摘要

### P4 — 同步回傳統一呼叫 `localizeResultUrls`

**檔案**：
- `server/routers/videoStudio.ts:28, 1043-1088`
- `server/routers/proStudio.ts:42, 1125-1228`

把 `persistExternalMediaUrl` 改為 `localizeResultUrls`，遞迴本地化整個 result 樹（影片/音訊/ASR 多種輸出格式皆覆蓋），與 `webhookFal.ts:86` 行為一致。前綴格式 `generated/{studio}/{model}` 統一。

### P1 — `dispatchFalQueueTask` 取代三個 router 的 inline `falQueueSubmit`

**新增**：`server/services/falDispatcher.ts` 新增 `dispatchFalQueueTask()` — 與既有同步 `dispatchFalTask` 並列，提供 queue 模式的非同步派發，自帶 fallback chain。

**Retrofit**：
- `server/routers/imageStudio.ts:52-86`
- `server/routers/videoStudio.ts:46-72`
- `server/routers/proStudio.ts:73-92`

三個 router 的 inline `falQueueSubmit` 函式體換成 `dispatchFalQueueTask` 呼叫，30+ call site 不動，自然取得：
- 模型不在 catalog 時自動降級到 `FALLBACK_CHAINS[category]`
- webhook URL 透傳（`?fal_webhook=...`）
- LangSmith / errorTrace 統一格式

### P2 — Suno 音樂生成 tRPC procedures

**新增**：`server/routers/proStudio.ts` 結尾追加：
- `generateMusicSuno` — 呼叫 `getOrchestrator().suno.generateMusic`，扣點數，寫入 `backgroundJobs`
- `checkMusicSunoStatus` — 輪詢 Suno taskId，完成時 `localizeResultUrls` 並回寫 backgroundJob

`SunoClient` 在 `services/modelClients.ts:392` 既已實作完整，本次只是補上 router 暴露。

### P3 — Replicate LoRA 訓練（與 fal.ai 並存）

**擴充**：`server/services/replicateClient.ts` 新增 `startReplicateTraining` + `getReplicateTrainingStatus` + `ensureDestinationModel`，使用 `ostris/flux-dev-lora-trainer` 作為預設 trainer。

**共用 ZIP 流程**：`server/services/falTrainer.ts` 新增 `buildAndUploadZip` 並 export `buildZipBuffer`，讓 Replicate 訓練流程不重複實作。

**Router**：`server/routers/loraTrainer.ts` 新增：
- `trainWithReplicate` — 完整 ZIP 打包→S3→Replicate trainings.create 流程，寫入 `fineTunedModels`（`trainingEngine: "replicate"`）
- `replicateTrainingStatus` — 輪詢訓練狀態

### P0 — 光球生成工具註冊 + executor 橋接

**Shared registry**：`shared/global-agent-tools.ts` 末尾新增 4 條：
- `studio.generateImage`
- `studio.generateVideo`
- `studio.generateAudio`
- `studio.generateVoice`

均為 `riskLevel: "medium"`、`requiresHuman: true`、`executionTarget: "server-side"`。

**Executor 橋接**：`server/services/agentToolExecutor.ts:executeOrbToolCalls` 在 `byName.get` 之前攔截 `studio.*`，呼叫新 helper `dispatchStudioTool`：
- 風險閘門（未 approve → `confirmation-required`）
- `studio.generateAudio` 若 `modelId` 起頭為 `"suno"` 走 `SunoClient.generateMusic`，否則走 `dispatchFalQueueTask`
- 其餘三條一律走 `dispatchFalQueueTask`，享 fallback chain

光球現在可在多步驟計畫裡直接觸發生成，不再僅能「導使用者去工作室」。

---

## 三、新增測試

| 測試檔 | 涵蓋範圍 |
|---|---|
| `server/studio-tool-bridge.test.ts`（7 tests） | studio.* 工具註冊驗證、橋接路徑、confirmation 閘門、blockedTools、audit 事件 |
| `server/fal-queue-dispatcher.test.ts`（7 tests） | `dispatchFalQueueTask` queue 提交、webhook URL 透傳、fallback chain、extraHeaders、錯誤處理、缺 API key |

執行結果：**14/14 通過**。

整體 vitest：1273/1276 通過（3 個失敗為 `orb-task-orchestrator.test.ts` 中 step-approval 流程，**已驗證為主分支既存問題，與本次改動無關**）。

`tsc --noEmit`：本次改動引入 0 個新型別錯誤（既存 10 個錯誤未變）。

---

## 四、端到端驗證指引（部署前）

1. **光球生成工具**：dev server 中讓光球發 `[ACTION:studio.generateImage,prompt:"..."]`，觀察是否跳出 confirmation 並在 approve 後實際觸發 fal 任務
2. **fallback chain**：把 imageStudio 主模型 ID 故意設成不存在，驗證 dispatcher 自動降級
3. **Suno**：設 `SUNO_API_KEY`，呼叫 `proStudio.generateMusicSuno`，輪詢至完成
4. **Replicate LoRA**：設 `REPLICATE_API_TOKEN`，上傳 5+ 張圖片走 `loraTrainer.trainWithReplicate`，輪詢 `replicateTrainingStatus`
5. **localize**：確認回傳 URL 開頭為 `https://<own-cdn>/generated/...` 而非 `https://fal.media/...`

---

## 五、檔案改動清單

### 修改
- `shared/global-agent-tools.ts`
- `server/services/agentToolExecutor.ts`
- `server/services/falDispatcher.ts`
- `server/services/falTrainer.ts`
- `server/services/replicateClient.ts`
- `server/routers/imageStudio.ts`
- `server/routers/videoStudio.ts`
- `server/routers/proStudio.ts`
- `server/routers/loraTrainer.ts`

### 新增
- `server/studio-tool-bridge.test.ts`
- `server/fal-queue-dispatcher.test.ts`
- `docs/connection-audit-2026-04-29.md`（本檔）

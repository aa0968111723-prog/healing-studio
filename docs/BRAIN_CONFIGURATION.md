# Brain Configuration — 大腦組態完整資訊

> **適用範圍**：本文件記錄 healing-studio「9 大腦／引擎」中介層（`ctx.brain`）的完整組態，包括資料庫 schema、預設值、解析流程、降級鏈、健康快取、tRPC 介面、前端整合與審計日誌。
>
> **權威來源**：本文件僅引用實際程式碼。所有預設值、欄位、行數均以下列檔案為準，若程式碼與文件衝突，以程式碼為準。
>
> - `drizzle/schema.ts`（DB 結構）
> - `server/middleware/brainContext.ts`（中介層、預設、降級鏈、健康快取）
> - `server/routes/brain.ts`（tRPC 端點）
> - `server/trpc.ts`（procedure 階層 → 是否注入 `ctx.brain`）

---

## §0 導讀

本文件分四個批次撰寫，循序漸進建立「從資料庫到 UI 的單一事實源」：

| 批次 | 章節 | 主題 |
|------|------|------|
| **A**（本檔） | §0–§3 | 動機、Schema、預設值（含 DB vs 中介層差異） |
| B | §4–§6 | `buildBrainContext` 解析流程、降級鏈（`ENGINE_FALLBACK_CHAIN`）、健康快取（Health Ping） |
| C | §7–§9 | tRPC 端點清單（`server/routes/brain.ts`）、procedure 階層、`ctx.brain` 消費點 |
| D | §10–§12 | 前端整合（`AiBrainSettings.tsx` / `MyBrainPage` / `AiBrainPipelinePage`）、審計日誌、運維手冊 |

**閱讀建議**：

- **想了解「為什麼」要中介層** → §1
- **想知道資料庫存了什麼** → §2
- **想對照 DB 預設與中介層硬編碼預設** → §3（**含 4 處不一致的明確標記**）
- **想追蹤一次請求中 `ctx.brain` 怎麼被建構** → §4（Batch B）
- **想 debug 模型降級行為** → §5–§6（Batch B）

---

## §1 為什麼需要大腦中介層

### 1.1 問題陳述

healing-studio 的所有創作流程（導演、分鏡、文案、提示詞工程、策展、圖／影／音／語音生成）都依賴外部 LLM 與生成引擎。沒有中介層的話，會有三個高風險：

1. **單點故障**：若使用者選定的模型（例：`gemini-2.5-pro`）短暫不可用，整個請求直接 500，使用者看到的是「服務崩潰」而非「自動退回備用模型」。
2. **設定漂移**：每個 router 各自從 DB 拿 `userAiBrain`、各自寫降級邏輯，會出現 N 套不一致的 fallback 行為。
3. **不可觀測**：模型切換、降級、失敗率沒有結構化日誌，無法事後追蹤「為什麼這次出圖用了 fast-sdxl 而不是 flux-pro」。

### 1.2 中介層提供的三層防護

`server/middleware/brainContext.ts:1-15` 的檔頭明確宣告三層防護：

| 防護機制 | 對應實作 | 位置 |
|----------|----------|------|
| **Health Ping** — 對選定引擎執行輕量級可用性探測（快取 + TTL，零阻塞） | `getHealthStatus`、`healthCache`、`HEALTH_CACHE_TTL_MS = 60_000` | `brainContext.ts:239-310` |
| **Graceful Degradation** — 引擎斷線時優雅退回備援 | `ENGINE_FALLBACK_CHAIN`、`buildBrainContext` 中的 `findHealthyFallback` | `brainContext.ts:132-225`、`563-612` |
| **Safety Audit Log** — 所有降級／切換事件結構化輸出 | `BrainAuditLogger.degradation()` | `brainContext.ts:498-560` |

### 1.3 設計原則

`brainContext.ts:11-14` 同樣硬性聲明三條設計原則：

- **零阻塞**：Health Ping 必須使用快取 + TTL，不在請求路徑上發 HTTP（→ §6）。
- **零崩潰**：任何 DB／網路錯誤都會 fallback 到硬編碼預設值（→ §3、§4）。
- **可觀測**：所有事件透過 `BrainAuditLogger` 結構化輸出（→ §11，Batch D）。

> 這三條原則是**驗收依據**：任何修改 `brainContext.ts` 的 PR 都應對照這三條原則。

---

## §2 資料庫 Schema

中介層讀取兩張表：`user_ai_brain`（每位使用者一列、儲存當前選擇）與 `user_model_switch_logs`（append-only 切換歷史）。

### 2.1 `user_ai_brain`（`drizzle/schema.ts:845-1054`）

每位使用者**唯一**一列（`userId` 有 `.unique()` 限制，schema.ts:847），共 **58 個欄位**：

| 區塊 | 欄位數 | 內容 |
|------|--------|------|
| 主鍵與外鍵 | 2 | `id`、`userId`（UNIQUE） |
| 5 種推理大腦 × 5 欄 | 25 | 每腦：`{slot}Model`、`{slot}Temperature`（DECIMAL(3,2)）、`{slot}TopP`（DECIMAL(3,2)）、`{slot}SystemPrompt`（TEXT, nullable）、`{slot}Enabled`（BOOL） |
| 4 種主要生成引擎 × 3 欄 | 12 | 每引擎：`{slot}Engine`、`{slot}EngineParams`（JSON, nullable, `$type<>` 約束）、`{slot}EngineEnabled`（BOOL） |
| 16 種 Fal.ai 任務引擎 × 1 欄 | 16 | `falImageTo3dEngine` … `falVideoToVideoEngine`（皆為 nullable VARCHAR(128)） |
| Meta | 3 | `globalPreferences`（JSON, nullable）、`createdAt`、`updatedAt` |

**5 種推理大腦**（`schema.ts:849-923`）：

| Slot | DB 欄位前綴 | 角色（schema 註解） |
|------|------------|---------------------|
| `director` | `director*` | 統籌創作流程、分鏡、敘事結構 |
| `analyst` | `analyst*` | 數據分析、趨勢洞察、品質評估 |
| `storyteller` | `storyteller*` | 文案撰寫、故事展開、情感渲染 |
| `technician` | `technician*` | 提示詞工程、參數優化、技術翻譯 |
| `curator` | `curator*` | 風格推薦、美學判斷、靈感策展 |

**4 種主要生成引擎**（`schema.ts:925-978`）：`imageEngine` / `videoEngine` / `audioEngine` / `voiceEngine`。每個 `*EngineParams` 皆有 TypeScript `$type<>` 約束（例：`imageEngineParams` 限定 `{ steps?, cfgScale?, seed?, scheduler?, width?, height?, negativePrompt? }`，schema.ts:931-939）。

**16 種 Fal.ai 任務引擎**（`schema.ts:980-1045`）：對應 fal.ai 平台的 16 大任務類別（影像轉 3D、圖到圖、文字到語音、影片到文字…），目前**未進入 `BrainContext`**（中介層只回傳 5 推理腦 + 4 主引擎，→ §4，Batch B）。它們透過獨立路徑由各 router 直接讀取。

### 2.2 `user_model_switch_logs`（`drizzle/schema.ts:1067-1111`）

Append-only 切換歷史，**11 個欄位**：

| 欄位 | 型別 | 用途 |
|------|------|------|
| `id`、`userId` | `int` | 主鍵、外鍵 |
| `brainSlot` | `mysqlEnum` | 9 種值之一：`director` / `analyst` / `storyteller` / `technician` / `curator` / `imageEngine` / `videoEngine` / `audioEngine` / `voiceEngine` |
| `fromModel`、`toModel` | `varchar(128)` | 切換前後的模型 ID |
| `fromParams`、`toParams` | `json`（nullable） | 切換前後的參數快照 |
| `reason` | `text`（nullable） | 切換原因（使用者自述或系統推薦） |
| `switchSource` | `mysqlEnum` | 4 種值之一：`manual` / `soul_recommendation` / `auto_fallback` / `ab_test`（預設 `manual`） |
| `switchedAt` | `timestamp` | 切換時間（`defaultNow()`） |

> **重要**：`switchSource = "auto_fallback"` 是中介層降級時應寫入的值（→ §11，Batch D 將討論審計日誌應該由誰寫入）。

### 2.3 型別匯出

```ts
// drizzle/schema.ts:1056-1057
export type UserAiBrain = typeof userAiBrain.$inferSelect;
export type InsertUserAiBrain = typeof userAiBrain.$inferInsert;

// drizzle/schema.ts:1113-1114
export type UserModelSwitchLog = typeof userModelSwitchLogs.$inferSelect;
export type InsertUserModelSwitchLog = typeof userModelSwitchLogs.$inferInsert;
```

中介層 `brainContext.ts:18` 只匯入 `UserAiBrain`（讀取用），**不寫入** `userAiBrain` 或 `userModelSwitchLogs`——所有寫入透過 `server/routes/brain.ts` 的 mutation 完成（→ §7，Batch C）。

---

## §3 預設值表（含 DB vs 中介層差異）

中介層在兩種情境會用「預設值」：

1. **使用者尚未建立 `user_ai_brain` 列**（首次登入）→ 整列用預設。
2. **DB 讀取失敗、或欄位為 NULL** → 該欄位用預設。

DB 與中介層各自定義了一份預設值。**理想狀態下兩者應該一致**，但目前**有 4 處不一致**——本節逐欄列出，並在差異處明確標記，避免讀文件的人誤以為 DB 預設就是實際生效值。

### 3.1 推理大腦預設值（5 個）

| Slot | DB schema 預設（`schema.ts`） | 中介層 fallback（`brainContext.ts:107-116`） | 一致？ |
|------|-------------------------------|----------------------------------------------|--------|
| `director` | model: `"gpt-4o"`、temperature: `0.7`、topP: `0.9` | model: `"gemini-2.5-pro"`、temperature: `0.4`、topP: `0.9` | ❌ **model 與 temperature 不同** |
| `analyst` | model: `"gpt-4o"`、temperature: `0.3`、topP: `0.8` | model: `"gemini-2.5-flash"`、temperature: `0.3`、topP: `0.8` | ❌ **model 不同** |
| `storyteller` | model: `"gpt-4o"`、temperature: `0.9`、topP: `0.95` | model: `"gemini-2.5-pro"`、temperature: `0.9`、topP: `0.95` | ❌ **model 不同** |
| `technician` | model: `"gpt-4o"`、temperature: `0.2`、topP: `0.7` | model: `"gemini-2.5-flash"`、temperature: `0.2`、topP: `0.7` | ❌ **model 不同** |
| `curator` | model: `"gpt-4o"`、temperature: `0.8`、topP: `0.9` | model: `"gemini-2.5-flash"`、temperature: `0.8`、topP: `0.9` | ❌ **model 不同** |

> **解讀**：
> - DB schema 的 `default("gpt-4o")` 是早期版本遺留（系統最初目標 OpenAI），已**全面遷移到 Google Gemini**。中介層 `DEFAULT_REASONING_BRAINS` 是當前真實使用的預設。
> - `ENGINE_FALLBACK_CHAIN`（`brainContext.ts:141-146`）也已將 `gpt-4o`、`gpt-4o-mini`、`gpt-3.5-turbo`、`claude-3.5-sonnet` 等舊模型名稱**強制 fallback 到 Gemini**，正是為了承接 DB 殘留的 `"gpt-4o"` 預設。
> - 中介層的 `temperature` 是「五腦差異化分工」（`director=0.4` 求穩、`storyteller=0.9` 求創意、`technician=0.2` 求精確），DB 的 `0.7` 是早期統一值。
>
> **後續工作（不在本文件範圍）**：建議寫一筆 migration 把 DB schema 的 `default("gpt-4o")` 全部更新為對應 Gemini 模型，移除這份不一致。在那之前，**真實生效值請以 §3 右欄（中介層）為準**。

### 3.2 主要生成引擎預設值（4 個）

| Slot | DB schema 預設 | 中介層 fallback（`brainContext.ts:118-129`） | 一致？ |
|------|---------------|----------------------------------------------|--------|
| `imageEngine` | `"fal-ai/flux-pro/v1.1"`（schema.ts:929） | `"fal-ai/flux-pro/v1.1"`（params: `null`） | ✅ |
| `videoEngine` | `"fal-ai/kling-video/v2.1/pro/text-to-video"`（schema.ts:944） | `"fal-ai/kling-video/v2.1/standard/text-to-video"` | ❌ **`pro` vs `standard` 路徑不同** |
| `audioEngine` | `"fal-ai/stable-audio"`（schema.ts:957） | `"fal-ai/ace-step"` | ❌ **完全不同的引擎** |
| `voiceEngine` | `"fal-ai/metavoice-v1"`（schema.ts:969） | `"fal-ai/elevenlabs/tts/turbo-v2.5"` | ❌ **完全不同的引擎** |

> **解讀**：
> - `videoEngine`：`pro` 是進階版（更貴、更慢、更高品質），`standard` 是平民版。中介層的 `standard` 比 DB 的 `pro` 更安全（成本可預期），這個方向是對的。
> - `audioEngine`：`stable-audio` 與 `ace-step` 是不同團隊不同模型；`brainContext.ts:198` 的 fallback 鏈中 `ace-step → stable-audio → musicgen` 顯示中介層偏好 `ace-step`。
> - `voiceEngine`：`metavoice-v1` 已被 `elevenlabs/tts/turbo-v2.5`（更通用、有完整 fallback 鏈）取代。
>
> **真實生效值同樣以中介層（右欄）為準**。

### 3.3 16 種 Fal.ai 任務引擎預設值

這 16 個欄位**只存在於 DB schema**（`schema.ts:982-1045`），**中介層不處理**（`DEFAULT_GENERATION_ENGINES` 只有 4 個主要引擎）。它們的真實生效預設**就是** DB schema 的 `.default(...)`：

| 欄位 | DB 預設值 | schema.ts 行號 |
|------|-----------|---------------|
| `falImageTo3dEngine` | `"fal-ai/trellis"` | 983-985 |
| `falImageToImageEngine` | `"fal-ai/flux/dev/image-to-image"` | 987-989 |
| `falImageToJsonEngine` | `"fal-ai/any-llm"` | 991-993 |
| `falImageToVideoEngine` | `"fal-ai/kling-video/v2.1/pro/image-to-video"` | 995-997 |
| `falJsonEngine` | `"fal-ai/any-llm"` | 999-1001 |
| `falLlmEngine` | `"fal-ai/any-llm"` | 1003-1005 |
| `falTextTo3dEngine` | `"fal-ai/hyper3d/rodin"` | 1007-1009 |
| `falTextToAudioEngine` | `"fal-ai/stable-audio"` | 1011-1013 |
| `falTextToImageEngine` | `"fal-ai/flux-pro/v1.1"` | 1015-1017 |
| `falTextToJsonEngine` | `"fal-ai/any-llm"` | 1019-1021 |
| `falTextToSpeechEngine` | `"fal-ai/metavoice-v1"` | 1023-1025 |
| `falTextToVideoEngine` | `"fal-ai/kling-video/v2.1/pro/text-to-video"` | 1027-1029 |
| `falTrainingEngine` | `"fal-ai/flux-lora-fast-training"` | 1031-1033 |
| `falVideoToAudioEngine` | `"fal-ai/mmaudio-v2/video-to-audio"` | 1035-1037 |
| `falVideoToTextEngine` | `"fal-ai/whisper"` | 1039-1041 |
| `falVideoToVideoEngine` | `"fal-ai/kling-video/v2.1/standard/video-to-video"` | 1043-1045 |

> **注意**：
> - 這 16 個欄位**沒有 fallback 鏈、沒有 health ping、沒有降級**——它們由各 router／service 自行讀取（→ Batch C 將盤點哪些 router 直接讀這些欄位）。
> - 若這些任務引擎需要中介層保護，需要先擴充 `BrainContext` 與 `ENGINE_FALLBACK_CHAIN`。本文件僅記錄現況，不主張立刻擴充。

### 3.4 切換來源（`switchSource`）列舉值

由 `userModelSwitchLogs.switchSource`（`schema.ts:1100-1107`）定義，預設 `"manual"`：

| 值 | 觸發者 | 用途 |
|------|--------|------|
| `manual` | 使用者於 `AiBrainSettings.tsx` UI | 主動切換 |
| `soul_recommendation` | 全域光球（Global Orb） | 系統推薦切換 |
| `auto_fallback` | `buildBrainContext` 降級時 | 引擎不可用時自動降級 |
| `ab_test` | A/B 測試框架 | 實驗變體分流 |

---

**Batch A 結束。** 下一批（B）將涵蓋 `buildBrainContext` 的解析流程、`ENGINE_FALLBACK_CHAIN` 完整對照表、以及 Health Ping 的快取／TTL／失敗計數機制。

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

## §4 `buildBrainContext` 解析流程

每次 tRPC 請求進入「需要 brain context」的 procedure 時（→ §8，Batch C），中介層會呼叫 `buildBrainContext(userId)`（`brainContext.ts:614-803`）。本節逐步拆解這個函數，並標出三個關鍵的「靜默行為」（在不出錯的情況下會悄悄發生、但會影響運維診斷）。

### 4.1 函數簽章

```ts
// brainContext.ts:614
export async function buildBrainContext(userId: number): Promise<BrainContext>
```

回傳的 `BrainContext` 結構見 §1.2 與 `brainContext.ts:67-92`，包含：
- `hasCustomConfig: boolean` — 使用者是否有 DB 列
- `reasoning: Record<ReasoningBrainSlot, ReasoningBrainConfig>` — 5 推理腦
- `generation: Record<GenerationEngineSlot, GenerationEngineConfig>` — 4 主引擎
- `degradationSummary: DegradationEvent[]` — 本次請求的降級事件清單
- 4 個 helper：`getBrain` / `getEngine` / `getHealthyBrains` / `getHealthyEngines`

### 4.2 四個解析階段

整個函數分成 4 個明確標示的步驟（程式碼中以 `── Step N:` 註解分隔）：

#### Step 1：DB 讀取（`brainContext.ts:617-638`）

```ts
try {
  const db = await getDb();
  if (db) {
    const rows = await db.select().from(userAiBrain)
      .where(eq(userAiBrain.userId, userId)).limit(1);
    dbRow = rows[0] ?? null;
    hasCustomConfig = dbRow !== null;
  }
} catch (err) {
  BrainAuditLogger.dbFallback(userId, ...);
}
```

**靜默行為 #1**：如果 `getDb()` 回傳 `null`（DB 未連線），`dbRow` 會保持 `null`，`hasCustomConfig` 為 `false`，**且不觸發 `dbFallback` log**。只有在 `await db.select()` 拋出例外時才會記錄。要區分「DB 沒連線」與「使用者沒設定」這兩種情況，必須額外查詢健康日誌。

#### Step 2：解析推理大腦（5 個 slots，`brainContext.ts:640-707`）

對每個 slot（`director` / `analyst` / `storyteller` / `technician` / `curator`）：

1. 從 `dbRow` 讀 `{slot}Model` / `{slot}Temperature` / `{slot}TopP` / `{slot}SystemPrompt` / `{slot}Enabled`，**任一欄位為 null 時 fallback 至 `DEFAULT_REASONING_BRAINS[slot]`**（`brainContext.ts:660-670`）。
2. **DECIMAL → Number 轉型**：`temperature` 與 `topP` 在 DB 是 `DECIMAL(3,2)`，`drizzle` 預設回傳 string，`brainContext.ts:664-668` 用 `Number(...)` 強制轉型。
3. 呼叫 `getHealthStatus(model)` 取得健康狀態。
4. 若 `!healthy && enabled` → 進入降級流程（→ §5 詳解 `findFallback`）：
   - 把 `model` 換成 fallback 候選
   - 設 `degraded = true`、保留 `originalModel`
   - 推進 `degradationSummary`、呼叫 `BrainAuditLogger.degradation(event)`

**靜默行為 #2**：第 703 行重新計算 `healthy: getHealthStatus(model)` ——這時 `model` 已是降級後的新值。意思是：**`reasoning[slot].healthy` 反映的是「最終生效引擎」的健康狀態，不是原始選擇**。要查「原始選擇是否不健康」，必須讀 `degraded` 與 `originalModel` 兩個欄位。

#### Step 3：解析生成引擎（4 個 slots，`brainContext.ts:709-767`）

與 Step 2 同樣的模式，差異：
- 欄位名為 `imageEngine` / `videoEngine` / `audioEngine` / `voiceEngine`（無 `director*` 那種前綴模式）
- params 為 `JSON` 欄位（直接讀，`brainContext.ts:729-731`），非 DECIMAL，不需要轉型
- 沒有 `systemPrompt`、沒有 `temperature/topP`
- 同樣呼叫 `findFallback(engine, slot, "generation")`，同樣有 `originalEngine` 欄位

#### Step 4：組裝（`brainContext.ts:769-802`）

- 呼叫 `BrainAuditLogger.configLoaded(userId, hasCustomConfig)` 標記載入完成。
- 呼叫 `BrainAuditLogger.requestSummary(...)` 印出 `🟢 ALL_HEALTHY` 或 `🟡 DEGRADED(N)`，含 `brains=X/5 engines=Y/4` 數字（`brainContext.ts:548-553`）。
- 物件附帶 4 個 helper（`getBrain` / `getEngine` / `getHealthyBrains` / `getHealthyEngines`，`brainContext.ts:785-799`）。
- 回傳 `brainCtx`。

**靜默行為 #3**：`requestSummary` 計算的 `healthyBrains` 與 `healthyEngines` 用的條件是 `b.healthy && b.enabled`（`brainContext.ts:775-776`），其中 `b.healthy` 是降級後的最終值（見靜默行為 #2）。所以 log 上的 `brains=5/5` **不代表「沒有降級」**——只代表「最終可用」。要看「實際發生了幾次降級」，看 `degradations=N` 才準。

### 4.3 不變式（Invariants）

| # | 不變式 | 強制位置 |
|---|--------|----------|
| I1 | `reasoning` 必有 5 個 key、`generation` 必有 4 個 key | Step 2 / Step 3 的 for 迴圈強制覆蓋所有 slots |
| I2 | 每個 `*Config` 物件必有 `model`/`engine` 為非空字串 | `findFallback` 最終兜底回傳 `hardDefault \|\| currentModel`（`brainContext.ts:601`） |
| I3 | 任何 DB 失敗都不會拋例外給呼叫端 | Step 1 的 `try/catch` 包住整段 DB 讀取 |
| I4 | `hasCustomConfig === false` 時，所有欄位來自 `DEFAULT_*` 而非 DB schema 預設 | Step 2/3 的三元運算 `dbRow ? ... : defaults.*` |

> **I4 是 §3 不一致表存在的根因**：當使用者首次登入、`buildBrainContext` 在 DB 列建立前就被呼叫時，回傳值來自 `DEFAULT_REASONING_BRAINS`（Gemini），而非 DB 的 `default("gpt-4o")`。這也是為什麼系統能正常運作即便 DB 預設仍是 `gpt-4o`——使用者實際看到的永遠是中介層預設。

---

## §5 `ENGINE_FALLBACK_CHAIN` 完整對照

`brainContext.ts:132-225` 定義了一張**單向**對照表：給定當前模型，回傳依優先順序排列的備援候選清單。`findFallback`（`brainContext.ts:566-604`）會**依序**呼叫 `getHealthStatus(candidate)`，回傳第一個 healthy 的候選。

### 5.1 降級流程（`findFallback`）

```
findFallback(currentModel, slot, slotType):
  1. 若 getHealthStatus(currentModel) → null（不需降級）
  2. chain = ENGINE_FALLBACK_CHAIN[currentModel] ?? []
  3. 對 chain 每個 candidate，第一個 healthy 的就回傳
  4. 全部不健康 → 退回 DEFAULT_REASONING_BRAINS[slot] 或 DEFAULT_GENERATION_ENGINES[slot]
  5. 預設也不健康 → 仍回傳預設（"last-resort default"）
```

**重要**：當 `currentModel` 不在表中（例如完全陌生的模型 ID），`chain` 為空陣列、跳過 step 3，直接進入 step 4 的硬預設。意思是：**任何不在表中的模型，降級時一律退回該 slot 的硬編碼預設**（§3 右欄）。

### 5.2 推理大腦降級鏈

`brainContext.ts:134-149`：

| 當前模型 | 第一備援 | 第二備援 | 備註 |
|----------|----------|----------|------|
| `gemini-2.5-pro` | `gemini-2.5-flash` | `gemini-1.5-pro` | |
| `gemini-2.5-flash` | `gemini-1.5-flash` | `gemini-2.5-pro` | |
| `gemini-1.5-pro` | `gemini-2.5-pro` | `gemini-1.5-flash` | |
| `gemini-1.5-flash` | `gemini-2.5-flash` | `gemini-1.5-pro` | |
| `minimaxai/minimax-m2.7` | `gemini-2.5-flash` | `gemini-2.5-pro` | NVIDIA NIM 代理人引擎 |
| `gpt-4o` | `gemini-2.5-pro` | `gemini-2.5-flash` | **承接 DB 殘留預設**（§3.1） |
| `gpt-4o-mini` | `gemini-2.5-flash` | `gemini-1.5-flash` | 向後相容 |
| `gpt-3.5-turbo` | `gemini-2.5-flash` | `gemini-1.5-flash` | 向後相容 |
| `claude-3.5-sonnet` | `gemini-2.5-pro` | `gemini-2.5-flash` | 向後相容 |
| `claude-3-opus` | `gemini-2.5-pro` | `gemini-1.5-pro` | 向後相容 |
| `claude-3-haiku` | `gemini-2.5-flash` | `gemini-1.5-flash` | 向後相容 |
| `vertex/gemini-2.5-pro` | `gemini-2.5-pro` | `gemini-2.5-flash` | Vertex AI 路徑 |
| `vertex/gemini-2.5-flash` | `gemini-2.5-flash` | `gemini-1.5-flash` | Vertex AI 路徑 |

> **觀察**：所有非 Gemini 模型最終都會 fallback 至 Gemini，這是「OpenAI/Claude 名稱不會觸發 404」的安全網。

### 5.3 圖像引擎降級鏈

`brainContext.ts:150-166`：

| 當前引擎 | 第一備援 | 第二備援 |
|----------|----------|----------|
| `fal-ai/flux-pro/v1.1` | `fal-ai/fast-sdxl` | `fal-ai/stable-diffusion-v35-large` |
| `fal-ai/nano-banana-2` | `fal-ai/nano-banana-pro` | `fal-ai/flux-pro/v1.1` |
| `fal-ai/nano-banana-pro` | `fal-ai/nano-banana-2` | `fal-ai/flux-pro/v1.1` |
| `fal-ai/imagen4/preview` | `fal-ai/nano-banana-2` | `fal-ai/flux-pro/v1.1` |
| `fal-ai/fast-sdxl` | `fal-ai/flux-pro/v1.1` | `fal-ai/stable-diffusion-v35-large` |
| `flux-pro`（舊別名） | `fal-ai/flux-pro/v1.1` | `flux-schnell` → `dall-e-3` |
| `flux-schnell` | `flux-pro` | `dall-e-3` |
| `dall-e-3` | `flux-pro` | `flux-schnell` |
| `stable-diffusion-xl` | `flux-pro` | `dall-e-3` |

### 5.4 影片引擎降級鏈

`brainContext.ts:167-195`：

| 當前引擎 | 第一備援 | 第二備援 |
|----------|----------|----------|
| `fal-ai/kling-video/v2.1/standard/text-to-video` | `fal-ai/wan/v2.2-14b` | `fal-ai/minimax/video-01` |
| `fal-ai/kling-video/v2.1/standard/image-to-video` | `fal-ai/minimax/video-01/image-to-video` | `fal-ai/pixverse/v4.5/image-to-video` |
| `fal-ai/wan/v2.2-14b` | `fal-ai/kling-video/v2.1/standard/text-to-video` | `fal-ai/minimax/video-01` |
| `fal-ai/veo3` | `fal-ai/kling-video/v2.1/standard/text-to-video` | `fal-ai/wan/v2.2-14b` |
| `fal-ai/minimax/video-01` | `fal-ai/kling-video/v2.1/standard/text-to-video` | `fal-ai/wan/v2.2-14b` |
| `kling-v1`（舊別名） | `fal-ai/kling-video/v2.1/standard/text-to-video` | `kling-v1-5` → `minimax-video` |
| `kling-v1-5` | `kling-v1` | `minimax-video` |
| `minimax-video` | `fal-ai/minimax/video-01` | `kling-v1` → `kling-v1-5` |

> **缺口**：DB schema 預設 `videoEngine = "fal-ai/kling-video/v2.1/pro/text-to-video"`（**pro** 路徑）**不在降級表中**。如果使用者保留 DB 預設、又遇上 `pro` 路徑不健康，會走 §5.1 step 4 直接退回中介層硬預設 `standard` 路徑。

### 5.5 音訊／音樂引擎降級鏈

`brainContext.ts:196-203`：

| 當前引擎 | 第一備援 | 第二備援 |
|----------|----------|----------|
| `fal-ai/sonauto` | `fal-ai/ace-step` | `fal-ai/stable-audio` — **註解標記 `sonauto Not Found`** |
| `fal-ai/ace-step` | `fal-ai/stable-audio` | `fal-ai/musicgen` |
| `fal-ai/stable-audio` | `fal-ai/ace-step` | `fal-ai/musicgen` |
| `suno-v4`（舊別名） | `fal-ai/ace-step` | `suno-v3.5` → `udio-v1` |
| `suno-v3.5` | `suno-v4` | `udio-v1` |
| `udio-v1` | `suno-v4` | `suno-v3.5` |

### 5.6 語音引擎降級鏈

`brainContext.ts:204-224`：

| 當前引擎 | 第一備援 | 第二備援 |
|----------|----------|----------|
| `fal-ai/elevenlabs/tts/turbo-v2.5` | `fal-ai/qwen-3-tts/text-to-speech/1.7b` | `fal-ai/dia-tts/voice-clone` |
| `fal-ai/qwen-3-tts/text-to-speech/1.7b` | `fal-ai/elevenlabs/tts/turbo-v2.5` | `fal-ai/dia-tts/voice-clone` |
| `fal-ai/dia-tts/voice-clone` | `fal-ai/elevenlabs/tts/turbo-v2.5` | `fal-ai/qwen-3-tts/text-to-speech/1.7b` |
| `elevenlabs-v2`（舊別名） | `fal-ai/elevenlabs/tts/turbo-v2.5` | `elevenlabs-v1` → `azure-tts` |
| `elevenlabs-v1` | `elevenlabs-v2` | `azure-tts` |
| `azure-tts` | `elevenlabs-v2` | `elevenlabs-v1` |

> **缺口**：DB schema 預設 `voiceEngine = "fal-ai/metavoice-v1"` **不在降級表中**——同樣會走 step 4 退回中介層硬預設。

### 5.7 環形依賴

值得注意：許多項目互為對方的 fallback（例如 `gemini-2.5-pro ↔ gemini-2.5-flash`、`flux-pro ↔ flux-schnell`）。**這不會無限遞迴**，因為 `findFallback` 只跑一層 chain（不對 fallback 候選遞迴查 chain）；若所有候選都不健康，就退回硬預設（§5.1 step 4）。

---

## §6 Health Ping — 快取、TTL、失敗計數

### 6.1 資料結構

```ts
// brainContext.ts:231-236
interface HealthCacheEntry {
  healthy: boolean;
  checkedAt: number;          // Unix ms timestamp
  consecutiveFailures: number; // 累計連續失敗次數
  lastError?: string;
}

// brainContext.ts:239-241
const healthCache = new Map<string, HealthCacheEntry>();
const HEALTH_CACHE_TTL_MS = 60_000;   // 60 秒
const MAX_CONSECUTIVE_FAILURES = 3;   // 連續失敗 3 次後標記不健康
```

`healthCache` 是**模組級單例 Map**，跨請求共享。Process 重啟即清空（無持久化）。

### 6.2 `getHealthStatus(modelOrEngine: string): boolean`

`brainContext.ts:253-264`：

```
1. 查 healthCache
2. 若快取存在 且 (now - checkedAt) < 60_000ms：
     return cached.healthy
3. 否則（過期或不存在）：
     scheduleHealthCheck(modelOrEngine)  // 背景非阻塞
     return cached?.healthy ?? true       // 樂觀返回
```

**設計關鍵**：永遠不阻塞請求路徑。首次查詢未知模型時，**樂觀返回 `true`**——也就是說，**第一次請求的「健康狀態」實際上是猜的**，背景探測完成後才會修正。

### 6.3 `scheduleHealthCheck(modelOrEngine: string): void`

`brainContext.ts:275-311`：

使用 `setImmediate(async () => { ... })` 推到下一個 event loop tick。內部邏輯：

1. 讀取舊的 `consecutiveFailures`（無快取時為 0）。
2. 呼叫 `isRecognizedModel(modelOrEngine)` 判斷模型名稱**是否在 `KNOWN_MODELS` Set 中**。
3. 若已知 → 寫入 `healthy: true, consecutiveFailures: 0`
4. 若未知 → `failures++`，`healthy: failures < 3`，`lastError: "Unknown model/engine: ..."`
5. 若拋例外 → 同 step 4，但 `lastError` 來自 exception。

> **⚠️ 重要侷限（直接寫在程式碼註解中，`brainContext.ts:282-283`）：**
>
> > 「簡化的健康檢查：驗證模型名稱是否在已知清單中。在生產環境中，這裡會替換為實際的 API ping。」
>
> 換句話說：**目前的 health ping 不是真的 ping**——它只檢查名稱是否登錄在 `KNOWN_MODELS`（`brainContext.ts:314-443`，約 130 個項目）。這意味著：
>
> 1. ✅ **能擋下**：拼字錯誤、過時別名、完全不存在的模型 ID。
> 2. ❌ **擋不下**：模型存在於 `KNOWN_MODELS`，但實際 API endpoint 503／429／timeout。這類失敗只能透過 §6.5 的 `reportEngineFailure` 由外部 caller 主動回報。
>
> 因此 `ENGINE_FALLBACK_CHAIN` 的真實價值，目前主要在於**承接 DB 殘留的舊模型名稱**（如 `gpt-4o` → Gemini）以及**外部 caller 回報故障時的降級**——而不是「即時偵測 API 不可用」。

### 6.4 `KNOWN_MODELS` Set（`brainContext.ts:314-443`）

130+ 條目，分組如下：

| 分組 | 條目數（約） | 範例 |
|------|------------|------|
| LLM — Gemini 主引擎 | 5 | `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-1.5-*` |
| LLM — MiniMax M2.7 | 1 | `minimaxai/minimax-m2.7` |
| LLM — Vertex AI 路徑 | 5 | `vertex/gemini-2.5-pro` / `vertex/llama-3.2-90b` |
| LLM — OpenAI/Claude 向後相容 | 5 | `gpt-4o` / `claude-3.5-sonnet`（會觸發 fallback） |
| 多模態 — Imagen / Veo / Lyria / TTS | ~14 | `gemini/imagen-3` / `vertex/veo-3` / `gemini/lyria-2` |
| fal.ai 圖像 | ~12 | `fal-ai/flux-pro/v1.1` / `fal-ai/aura-flow` / `flux-pro`（短名稱） |
| fal.ai 圖像編輯 | ~6 | `fal-ai/controlnet-union` / `fal-ai/aura-sr` |
| fal.ai 影片 | ~22 | `fal-ai/kling-video/v2.1/pro|standard/{t2v,i2v,v2v}` 等 |
| fal.ai 音樂／音效 | ~8 | `fal-ai/stable-audio` / `fal-ai/ace-step` / `fal-ai/musicgen` |
| fal.ai 語音 / TTS / STT | ~9 | `fal-ai/metavoice-v1` / `fal-ai/whisper` / `fal-ai/sync-lipsync` |
| fal.ai 3D | ~10 | `fal-ai/trellis` / `fal-ai/hyper3d/rodin` / `fal-ai/meshy-4` |
| fal.ai LLM/JSON/Vision | ~13 | `fal-ai/any-llm` / `fal-ai/llava-next` / `fal-ai/sam2` |
| fal.ai 訓練引擎 | ~8 | `fal-ai/flux-lora-fast-training` / `fal-ai/dreambooth-flux` |

> **維護提醒**：當 `ENGINE_FALLBACK_CHAIN` 加入新引擎時，**`KNOWN_MODELS` 也必須同步加入**——否則該引擎會被視為「未知」，每次健康檢查都失敗，3 次後永久標記不健康。這是兩處**必須一致**的 source list。

### 6.5 外部回報 — `reportEngineFailure` / `reportEngineRecovery`

`brainContext.ts:453-481`：

```ts
export function reportEngineFailure(modelOrEngine: string, error: string): void
export function reportEngineRecovery(modelOrEngine: string): void
```

供下游 caller（生成請求 handler、LLM 呼叫包裝層）在收到 503/429/timeout 時主動回報。語義：

| 函數 | 副作用 |
|------|--------|
| `reportEngineFailure` | `consecutiveFailures++`、`healthy = (failures < 3)`、`lastError = error`、寫 `BrainAuditLogger.engineFailure` |
| `reportEngineRecovery` | 重設為 `healthy: true, consecutiveFailures: 0`、寫 `BrainAuditLogger.engineRecovery` |

**這是讓「實際 API 故障」進入快取的唯一管道**（在 §6.3 提到的真實 ping 尚未實作前）。Batch C 將盤點目前哪些 caller 有呼叫這兩個函數。

### 6.6 診斷介面 — `getHealthSnapshot`

`brainContext.ts:484-492`：回傳 `Record<string, HealthCacheEntry>` 深拷貝快照，**僅供診斷**（不暴露於 tRPC，需透過內部工具或 Batch C 的 `brain.health.snapshot` 端點存取——將於 §7 確認該端點是否存在）。

### 6.7 不變式

| # | 不變式 | 強制位置 |
|---|--------|----------|
| H1 | `getHealthStatus` 的時間複雜度為 O(1) | `Map.get` + 比較 timestamp |
| H2 | 永不阻塞請求 | TTL 命中直接返回；過期時 `setImmediate` 推到背景 |
| H3 | 第一次查詢未知模型樂觀返回 `true` | `cached?.healthy ?? true`（line 263） |
| H4 | 連續失敗 3 次才標記不健康 | `failures < MAX_CONSECUTIVE_FAILURES`（lines 295/304/461） |
| H5 | Process 重啟即清空 healthCache | 模組級 `new Map()`，無持久化 |

> **H5 的運維意涵**：**部署／重啟後的第一個請求會把所有引擎視為 healthy**（因 H3）。這不是 bug，但需要納入運維監控——剛重啟時若引擎實際故障，第一批請求會失敗、由 `reportEngineFailure` 把狀態寫入快取，第 4 個失敗請求才會自動降級。

---

**Batch B 結束。** 下一批（C）將盤點 `server/routes/brain.ts` 的 tRPC 端點清單、`server/trpc.ts` 的 procedure 階層（哪些 procedure 會注入 `ctx.brain`）、以及目前哪些檔案實際消費 `ctx.brain` 與呼叫 `reportEngineFailure`／`reportEngineRecovery`。

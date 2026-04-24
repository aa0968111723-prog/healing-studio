# AI 大腦路由掃描（第一輪）
日期：2026-04-21

## 本輪掃描範圍
- 光球助理 / 全站光球代理（`/agent` + 全站浮動光球聊天）
- 創作工作室（`/studio`）
- 圖片創作室（`/image-studio`，用於核對你提到的 Gemini 生圖積木）

---

## 結論（先看）

1. **全站光球代理目前沒有掛到 AI 大腦「5 推理槽」任一槽位。**
   - 後端 `ai.chat` 直接 `preferEngine: "gemini"` 呼叫，未讀取 `ctx.brain.getBrain(...)`。
   - 代表你在 AI 大腦改 `director/technician` 模型，**不會直接改到全站光球代理的聊天模型選擇策略**。

2. **創作工作室（/studio）有掛到 AI 大腦組態。**
   - 生成時會讀 `user_ai_brain` + `resolveFalEnginesFromRow(...)`，再依模態取 `textToImage / textToVideo / textToAudio / textToSpeech`。
   - 也支援臨時 `overrideModelId` 覆蓋。

3. **你提到的 Gemini 生圖積木（例如 Nano Banana）在圖片創作室有，但不在 AI 大腦「主生成引擎 imageEngine」選單。**
   - `ImageStudio` 前端確實有 `fal-ai/nano-banana-2` / `fal-ai/nano-banana-pro` / `fal-ai/imagen4/preview`。
   - 但 AI 大腦 `text-to-image` Fal 任務目錄目前只有 Flux/SD3/Aura/Ideogram，**沒有 nano-banana / imagen4**。
   - 這會造成你說的「前端可選，但 AI 大腦組態對不上」風險。

---

## 細節核對

### A) 光球助理 / 全站光球代理

- `APP_PAGE_REGISTRY` 已定義「全站光球代理」頁面（`id: agent-chat`, `path: /agent`）。
- 但後端 `ai.chat` 流程目前是：
  1) 依人格建 prompt
  2) `invokeLLM(... preferEngine: "gemini")`
  3) 解析 ACTION
- 未見使用 `ctx.brain.getBrain("technician")` 或 `ctx.brain.getBrain("director")` 來決定該次聊天模型。

**判定：**「功能存在」，但「未完全納入 AI 大腦可配置模型路由」。

#### A 線（新對話）建議任務邊界

可直接在新對話給 A 光球助理以下明確需求：

1. **只接收 B 已批准的任務/指令**，不自行擴張需求範圍。
2. **在頁內執行 action dispatch**（走 PageAgent bus），負責把核准動作落到實際頁面互動。
3. **顯示執行中 UI**（例如步驟條、成功/失敗狀態），讓使用者看見進度與結果。
4. **失敗要可回報給 B**，至少包含：
   - `error code`
   - `context`（發生頁面、步驟、輸入摘要、失敗條件）

### B) 創作工作室 `/studio`

- `submitMultimodalAsync` 會先查 `userAiBrain`，再 `resolveFalEnginesFromRow(brainRow)`。
- image/video/audio/voice 皆以大腦配置選定 engine（可被 `overrideModelId` 覆蓋）。

**判定：**有納入 AI 大腦組態，路由鏈條成立。

### C) 圖片創作室 `/image-studio`（Gemini 生圖積木）

- 前端有 Nano Banana / Imagen4 等 Gemini 相關模型卡。
- 後端 `imageStudio` router 對這些模型有獨立端點調用。
- 但 AI 大腦 `FAL_MODEL_CATALOG` 的 `text-to-image` 目前未收錄 nano-banana / imagen4，導致無法在 AI 大腦的 Fal 任務欄位直接對齊切換。

**判定：**存在「模型目錄不一致」問題（你指出的類型）。

---

## 下一步建議（第二輪可直接做）

1. 把全站光球代理改為可選腦槽（建議預設 `technician`，可 fallback `director`）。
2. 統一模型真實來源：
   - 方案 A：`ImageStudio` 改讀 `brain.catalog().falTasks["text-to-image"]`。
   - 方案 B：將 nano-banana / imagen4 補進 `FAL_MODEL_CATALOG["text-to-image"]`，讓 AI 大腦目錄和圖片工作室一致。
3. 加一致性測試：
   - `ImageStudio.MODELS.falId ⊆ brain.catalog.falTasks.text-to-image(+edit)`
   - `ai.chat` 是否可讀取對應 brain slot。

---

## 下一步（可直接下給 A 線的執行規格）

> 目標：A 僅做「執行層」，由 B 做「審批/決策層」。

### 1) 任務入口（只吃 B 已批准指令）

- A 只接受帶有 `approvedByB: true` 的任務物件。
- 未帶批准標記時，A 不執行 action，只回報 `NOT_APPROVED`。

建議 payload：

```ts
type ApprovedTask = {
  taskId: string;
  approvedByB: true;
  source: "B";
  pageId?: string;
  actions: AgentAction[];
};
```

### 2) 頁內執行（PageAgent bus）

- A 收到 `ApprovedTask` 後，逐步 `dispatch` 到 PageAgent bus。
- 每步都要產出可追蹤結果（成功/失敗/跳過）。

### 3) 執行中 UI（步驟條 + 結果狀態）

- UI 最少要有：
  - 任務標題（taskId）
  - 總步數 / 當前步
  - 每步狀態：`running | success | failed | skipped`
- 任務結束要顯示總結：`successCount / failCount / skippedCount`。

### 4) 失敗回報（回傳給 B）

- 任一 action 失敗時，A 要立即回報 B，格式至少包含：
  - `errorCode`
  - `context`

建議 error code 白名單：

- `NOT_APPROVED`：沒有 B 批准標記
- `NO_PAGE_HANDLER`：目標頁尚未註冊 handler
- `ACTION_REJECTED`：頁面 handler 回傳 `ok: false`
- `ACTION_EXCEPTION`：頁面 handler throw
- `TIMEOUT`：單步執行逾時

建議 context 欄位：

```ts
type FailureContext = {
  taskId: string;
  pageId?: string;
  actionType: string;
  actionSummary?: string;
  stepIndex: number;
  totalSteps: number;
  reason?: string;
  at: number; // timestamp ms
};
```

### 5) 驗收標準（Definition of Done）

1. 未批准任務不會觸發任何 page action。
2. 批准任務可被逐步派送，且 UI 會同步顯示進度。
3. 任一步失敗時，B 會收到 `errorCode + context`。
4. 任務完成後可看到完整結果摘要（成功/失敗/略過）。

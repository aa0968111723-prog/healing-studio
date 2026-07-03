# Y8 — ProjectsContext + 素材庫前端深挖（北極星⑦）
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 稽核檔案：client/src/contexts/ProjectsContext.tsx、client/src/components/ProjectNotesDrawer.tsx、client/src/pages/AssetsLibrary.tsx

> 校驗註記：`git diff --stat 812f6fdb..HEAD(47917e3a)` 對本文引用到的所有檔案（含
> server/routers/assets.ts、server/routers/notes.ts、drizzle/schema.ts、
> ProjectSelector.tsx、OrbFloatButton.tsx、CreationHubSections.tsx 等）皆為空
> diff——812f6fdb 與目前 HEAD 在這些檔案上內容相同，以下行號對兩者皆準確。

## 摘要

依 `creativeProjectId` 作為 client 端 SSOT 的實況追蹤，並向下查證 server
router／DB schema，得到三個定性結論：

1. **NS-02（禁猜最新一筆）尚未落地**：`ProjectsContext.tsx` 的 `pickActive()`
   在使用者未顯式釘選專案時，會靜默 fallback 成「更新時間最新的一筆專案」，
   且此行為是目前**生產環境的預設路徑**（`ENABLE_4SHELL=1` → SSOT 開）。頂部
   `ProjectSelector` 與全站光球 `OrbFloatButton` 都直接吃到這個猜測結果，且
   UI 上沒有任何「這是系統猜的／不是你選的」提示。
2. **NS-07（素材/目標綁 creativeProjectId）完全沒有落地**：`AssetsLibrary.tsx`
   全檔案零處引用 project/creativeProjectId；往下查 `server/routers/assets.ts`
   與 `server/routers/notes.ts` 的 input schema、以及 `drizzle/schema.ts` 的
   `digital_asset_library` / `project_notes_calendar` 表結構，三層都證實**完全
   沒有專案綁定欄位**——不是 UI 沒接、是資料模型本身就不存在這個維度。
3. **「目標管理」UI 不存在**：`Project` 型別、三個稽核檔案、以及全站
   `client/src` 皆搜不到任何 goal/目標 相關型別或元件。這與
   `docs/research/00-devzone.md` 卡 NS-07 描述的「目標 tracker（=防跑偏產品化）
   待建」完全吻合。

以下依嚴重度排序列出發現。

---

## 發現

### 🔴 CRITICAL-1（northstar-flow）素材庫與筆記完全未綁 creativeProjectId——全端三層皆無此欄位

**發現（附行號）**
- `client/src/pages/AssetsLibrary.tsx` 全檔案（1–1491 行）搜尋
  `projectId|creativeProjectId|useWorldContext|useProjects` 零命中；
  `myAssetsQuery`（521–532 行）與 `teamAssetsQuery`（533–540 行）的查詢參數只有
  `assetType`、`sourceStudio`、`search`、`limit`，沒有任何專案維度的過濾條件。
- `client/src/components/ProjectNotesDrawer.tsx:319`：
  `const notesQuery = trpc.notes.list.useQuery(undefined, { enabled: isOpen });`
  ——沒有帶任何專案 id。
- `server/routers/assets.ts:16-64`（`myAssets` input schema）與 `88-121`
  （`teamAssets` input schema）都只有 `assetType/sourceStudio/search/cursor/limit`，
  無 `projectId`／`creativeProjectId` 欄位；`upload`（165-198 行）建立資產時
  也不收專案 id。
- `server/routers/notes.ts:49-92`（`list` input schema）同樣沒有專案過濾欄位；
  `create`（204-240 行）建立筆記時也不寫入專案 id。
- `drizzle/schema.ts:331-379`（`digitalAssetLibrary` 表）與 `:487-530`
  （`projectNotesCalendar` 表）的欄位清單裡都沒有任何 `creativeProjectId` /
  `projectId` 欄位或索引；對照同檔 `:4609`
  （`videoProjects.creativeProjectId` 確實存在），證實這不是「全站都還沒做」，
  而是「唯獨資產庫與筆記兩張表沒接上」。
- 交叉驗證：`docs/research/00-devzone.md:60-62` 卡 NS-07 現況欄位寫明
  「digital_asset_library/consistency_vault/resource_shares/teams
  資料底已在，未綁專案、enforcement OFF、無評論表」，與本次程式碼稽核完全吻合。

**影響**
- `ProjectNotesDrawer.tsx` 掛在 App.tsx 的全站 provider 樹裡（`App.tsx:452`），
  跨頁面共用同一顆抽屜，元件名稱雖叫「專案筆記」（標題文案見
  `ProjectNotesDrawer.tsx:351`「專案筆記」），但實際上顯示的是**該使用者名下
  全部專案、全部筆記混在一起**的清單——使用者在專案 A 建立的筆記，切到專案 B
  後打開同一顆抽屜仍會看到，無法分辨屬於哪個專案。
- `AssetsLibrary.tsx`（數位資產庫）同理：使用者無法回答「這個專案目前有哪些
  素材」，只能用 `sourceStudio`（來源工作室）當替代篩選，但同一工作室常被
  多個專案共用，篩選精度不足。
- 直接牴觸北極星「單一專案上下文全程引導」與「快速素材管理」的核心承諾：
  隨專案數增加，資產庫與筆記會變成一個無法依專案檢索的大水塘。

**建議**
- 依 NS-07 規劃，為 `digital_asset_library` / `project_notes_calendar` 加
  nullable 的 `creativeProjectId` 欄位（比照 `video_projects` 既有欄位的做法），
  `myAssets`/`teamAssets`/`notes.list` 加對應的可選 `projectId` 篩選參數，UI 補
  「依目前專案篩選」預設開關。

---

### 🔴 CRITICAL-2（northstar-flow）「目標管理」UI 在全站不存在，非旗標鎖住而是從未建模

**發現（附行號）**
- `client/src/types/projects.ts:25-57`（`Project` 介面）：欄位只有
  `id/title/type/status/progress/currentStep/nextAction/createdAt/updatedAt/
  binding/isPending`，沒有任何 goal / milestone / target 欄位；`progress`
  僅是一個 0–100 的整數（`:30-31` 註解「0–100 integer」），沒有對應「目標是
  什麼」的資料結構。
- 對三個稽核檔案（`ProjectsContext.tsx`、`ProjectNotesDrawer.tsx`、
  `AssetsLibrary.tsx`）與 `types/projects.ts` 搜尋 `目標|goal|Goal` 皆零命中。
- 對整個 `client/src` 搜尋 `目標管理|goalManagement|GoalTracker|ProjectGoal`
  同樣零命中——確認不是「藏在別的頁面」，而是這個概念在 client 端從未被實作
  過（連型別骨架都沒有）。
- 交叉驗證：`docs/research/00-devzone.md:60-62` 卡 NS-07 建議事項明寫「…+ 目標
  tracker（= 防跑犭产品化）」，代表官方待辦清單也承認這塊還沒做。

**影響**
- 北極星描述的「快速素材管理＋目標管理」兩根柱子，目標管理這根目前完全是
  空白——不是功能旗標關閉、不是隱藏分頁，是資料模型與 UI 都不存在。使用者
  唯一能勉強替代的是 `ProjectNotesDrawer.tsx` 裡筆記的 `todo/in_progress/done`
  三態（`NoteCard`，47-165 行），但這是筆記狀態、不是目標，且如 CRITICAL-1
  所述筆記本身也不綁專案。

**建議**
- 若 NS-07 排入開發排程，需先定義 Goal 實體（連 `creativeProjectId`，至少
  含名稱／目標值／截止日／完成判準），再談 UI。

---

### 🟠 HIGH-1（northstar-flow / client-security 相鄰）`pickActive()` 靜默猜測「最新一筆」為 active project，且已是生產環境預設行為

**發現（附行號）**
- `client/src/contexts/ProjectsContext.tsx:168-177`：
  ```
  function pickActive(projects, activeProjectId, latest) {
    const pinned = activeProjectId ? projects.find(p => p.id === activeProjectId) ?? null : null;
    return pinned ?? latest;
  }
  ```
  `latest` 來自 `pickLatest()`（:163-166，依 `updatedAt` 字串排序取最新一筆）。
  `activeProject`（RealProjectsProvider，:316-320）直接用這個函式算出。
- 這是目前**生產環境的預設路徑**：`client/src/config/featureFlags.ts:58`
  `ENABLE_4SHELL = readFlag("VITE_ENABLE_4SHELL", true)`；`.env.production:21`
  明寫 `VITE_ENABLE_4SHELL=1`；`client/src/config/projectFlags.ts:43-44`
  `ENABLE_PROJECT_SSOT = ENABLE_4SHELL && readFlag("VITE_ENABLE_PROJECT_SSOT", true)`
  ——兩個旗標預設都是 ON，即 `RealProjectsProvider`（含上述 `pickActive`）就是
  線上正在跑的路徑，不是被鎖住的死碼。
- 消費端無任何區分「使用者主動選的」vs「系統猜的」：
  - `client/src/components/layout/ProjectSelector.tsx:65-75` 直接顯示
    `activeProject?.title ?? "選擇專案"` 與其狀態 badge，沒有任何「自動選取」
    的視覺標記。
  - `client/src/components/OrbFloatButton.tsx:51,83`：全站光球抽屜標題
    `光球正在協助：{activeProject?.title ?? "尚未綁定專案"}`，同樣直接吃
    `activeProject`，使用者從未選過專案時也會顯示「猜到的」專案名稱，讓人以為
    光球真的在「協助」該專案。
- 對照組：`client/src/components/ContinueWhereYouLeftOff.tsx` +
  `client/src/components/continueResume.ts:105-115` 也有一個「取最新一個可續編
  專案」的邏輯，但這個是首頁「接著上次繼續」引導卡的**設計意圖**（明確標題
  「接著上次繼續」，使用者可一鍵關閉），與 `pickActive()` 被當成
  **全站 SSOT** 的隱式行為性質不同——後者被 `ProjectSelector`/`OrbFloatButton`
  當成「這就是目前的專案」在呈現，沒有任何「這是猜的」措辭。
- 交叉驗證：`docs/research/00-devzone.md:39-41` 卡 NS-02「creativeProjectId
  貫穿為 SSOT、禁猜最新一筆」現況欄位寫「三套專案並存、建案沒照關係走」，
  狀態仍是「待討論」——與本次程式碼稽核結果一致，此問題尚未修復。

**影響**
- 使用者從未主動選擇任何專案時，頂部專案選擇器與全站光球都會靜默顯示/綁定
  「更新時間最新的專案」，且看起來與「使用者主動選定」毫無差異。若該
  「最新」是由背景任務、其他分頁、或未來的協作者操作意外推高
  `updatedAt`（如 webhook 回填資產、AI 背景生成），使用者會被誤導以為系統
  記得他上次在編輯的專案，實際上可能完全是另一個專案。
- 這會直接污染北極星「AI 讀單一專案上下文全程引導、不跑偏」的前提：
  `WorldContextContext.tsx` 的 `injectIntoPrompt` 依賴 `currentProjectId`
  推出世界觀一致性前綴，若使用者以為自己在專案 A 但系統背後其實在專案 B
  的上下文，生成結果的世界觀注入會是錯的且無感知。

**建議**
- 拿掉隱式 fallback，或至少讓 `ProjectSelector`/`OrbFloatButton` 在
  `activeProjectId === null` 時明確標示「自動選擇（尚未指定）」並提供一鍵
  確認/更換，而非直接呈現成「當前專案」。

---

### 🟠 HIGH-2（uiux-defect）刪除動作缺乏失敗回饋，對話框無條件關閉造成假成功訊號

**發現（附行號）**
- `client/src/components/ProjectNotesDrawer.tsx:320-325`：
  `deleteNote`/`updateNote` 的 `useMutation` 只定義 `onSuccess`，沒有
  `onError`。刪除確認對話框的 `onClick`（:454-459）：
  ```
  onClick={() => {
    if (pendingDeleteId !== null) deleteNote.mutate({ id: pendingDeleteId });
    setPendingDeleteId(null);
  }}
  ```
  不等待 mutation 結果、不檢查成功與否，直接關閉對話框；對話框文案
  （:448-450）明寫「此操作無法復原，筆記將永久刪除」。
- `client/src/pages/AssetsLibrary.tsx:550-555`：`deleteAsset` 的
  `useMutation` 同樣只有 `onSuccess`（`myAssetsQuery.refetch()` +
  `toast.success("已刪除")`），沒有 `onError`；確認對話框 `onClick`
  （:1478-1481）與上面同一種「無條件關閉」寫法。
- 對照組（同檔案內）：`client/src/pages/AssetsLibrary.tsx:317-327` 的
  `uploadMutation` 明確定義了
  `onError: e => toast.error("上傳失敗：" + shortErrorMsg(e.message), ...)`
  ——證明專案內已有「mutation 失敗要 toast」的既定慣例，刪除/更新兩個 mutation
  沒跟上，屬遺漏而非刻意設計。

**影響**
- 刪除／更新請求若因網路錯誤、伺服器 500、樂觀鎖版本衝突等原因失敗，對話框
  仍會關閉、UI 呈現「已完成」的視覺狀態（無 toast、無錯誤提示），使用者會
  誤以為「已刪除」，但實際資料還留在原地，只有下次重新整理或重新打開才會
  「意外」發現筆記/資產還在。對一個標榜「無法復原」的動作而言，這種假成功
  訊號風險偏高。

**建議**
- 補上 `onError` toast（沿用 `uploadMutation` 的既有寫法）；`AlertDialogAction`
  的 `onClick` 改為 `await mutateAsync` 成功才關閉對話框，失敗時保留對話框並
  顯示錯誤，讓使用者可重試。

---

### 🟡 MEDIUM-1（uiux-defect）`ProjectSelector` 觸發按鈕與下拉清單的「已選中」狀態互相矛盾

**發現（附行號）**
- `client/src/components/layout/ProjectSelector.tsx:27-33`：解構出
  `activeProject`（可能是 HIGH-1 所述的 fallback 猜測值）與
  `activeProjectId`（使用者顯式釘選的原始 id，未釘選時為 `null`）。
- `:65-75`：觸發按鈕顯示 `activeProject?.title ?? "選擇專案"` 與其狀態 badge
  ——若 `activeProjectId` 為 `null` 但 `projects` 非空，這裡仍會顯示
  `latestProject` 的標題與 badge。
- `:91`：下拉清單裡判斷是否打勾用
  `const selected = p.id === activeProjectId;`——直接比對原始
  `activeProjectId`（此時是 `null`），而非 `activeProject?.id`。

**影響**
- 當使用者從未顯式選過專案時：觸發按鈕明明顯示某個專案名稱（如「XX 影片
  企劃」），使用者以為那就是「目前選中的專案」；點開下拉清單卻發現清單裡
  沒有任何一列打勾——兩處呈現同一件事卻互相矛盾，使用者會懷疑 UI 壞掉，或
  誤以為要重新點一次同名專案才算「真的選中」。

**建議**
- 清單比對改用 `p.id === (activeProjectId ?? activeProject?.id)`，讓
  「顯示的」與「打勾的」保持一致；或在按鈕與清單都明確區分「自動選擇」與
  「使用者已選」兩種視覺狀態（與 HIGH-1 建議一併處理）。

---

### 🟡 MEDIUM-2（uiux-defect）`NoteCard` 型別接受 `scheduledDate`，但渲染區塊從未顯示它

**發現（附行號）**
- `client/src/components/ProjectNotesDrawer.tsx:52-61`（`NoteCard` 的 `note`
  prop 型別）包含 `scheduledDate?: Date | string | null`；`:69-74` 依
  `noteType === "calendar_event"` 給出琥珀色的「排程」徽章（:122-124：
  `note.noteType === "calendar_event" ? "排程" : ...`）。
- `:140-154`（實際渲染的 tags + 時間列）只印出
  `new Date(note.createdAt).toLocaleDateString("zh-TW")`（建立日期），全檔案
  搜尋 `note.scheduledDate` 在渲染區塊裡零命中——這個欄位被接收進型別卻從未
  被畫出來。

**影響**
- 對一則被標成「排程」的筆記（`noteType === "calendar_event"`），使用者在這
  顆快速抽屜裡完全看不到「排定在什麼時候」，只能看到「建立於什麼時候」——
  兩者語意不同且對排程類筆記而言後者幾乎無意義，必須跳去 `/notes` 完整頁
  才能看到真正的排程時間，快速瀏覽的價值被打折。

**建議**
- 在卡片時間列補一行：`noteType === "calendar_event" && note.scheduledDate`
  時優先顯示排程時間（例如「排定：MM/DD HH:mm」），而非只顯示建立日期。

---

### 🟡 MEDIUM-3（contract-mismatch）`ProjectStatus.archived` 在真實 SSOT 路徑下永遠不可達

**發現（附行號）**
- `drizzle/schema.ts:3695-3702`：`creative_projects.status` 的 DB enum 只有
  `["concept", "production", "review", "complete"]` 四種，無 `archived`。
- `client/src/contexts/ProjectsContext.tsx:84-89`
  （`SERVER_TO_CLIENT_STATUS`）把這四種 server 狀態映射成三種 client 狀態
  （`draft/active/active/completed`），沒有任何路徑會產出 `"archived"`；
  同檔 `:82-83` 註解本身也承認「"archived"無伺服器對應」。
- 但 `client/src/types/projects.ts:21`：
  `export type ProjectStatus = "draft" | "active" | "completed" | "archived";`
  ——型別上仍宣告並輸出「已封存」標籤（`PROJECT_STATUS_LABELS.archived`），
  暗示這是一個活著、可能出現的狀態。
- 全站搜尋 `status === "archived"` 或 `PROJECT_STATUS_LABELS["archived"]`
  的實際消費點，只在 `client/src/components/continueResume.test.ts:96`
  （測試用 mock 資料）出現過，生產路徑（SSOT）沒有任何分支會真的產生
  這個狀態。

**影響**
- 任何為了 `"archived"` 撰寫的 client 端邏輯（篩選 tab、狀態徽章分支）在
  正式 SSOT 環境下都是死分支，永遠不會被觸發；同時代表「封存專案」這個
  生命週期管理故事目前後端完全不支援，型別卻讓人誤以為已支援。

**建議**
- 若封存是必要功能，需先在 `creative_projects.status` enum 加 `archived`
  並補對應 mutation；否則應從 `ProjectStatus`/`PROJECT_STATUS_LABELS` 移除，
  避免向下游（如未來的封存篩選 UI）傳遞錯誤期待。

---

### 🟡 MEDIUM-4（dead-ui，鄰近檔案，因追蹤 `activeProject` 消費鏈而發現）`CreationHubSections.tsx` 整檔案（含「繼續上次專案」卡）已被取代但未清除

**發現（附行號）**
- `client/src/components/home/CreationHubSections.tsx:1-11` 註解自述
  「Home.tsx wires data + callbacks in」，`:41-50` 匯出
  `ContinueProjectSection`（吃 `activeProject: Project | null` prop，用途與
  ProjectsContext 的 `activeProject`/`latestProject` 概念直接相關）；同檔另外
  匯出 `DEFAULT_QUICK_START_ENTRIES`、`QuickStartSection`、`AskOrbSection`。
- 全站搜尋 `ContinueProjectSection|QuickStartSection|AskOrbSection|
  DEFAULT_QUICK_START_ENTRIES`，命中檔案只有
  `CreationHubSections.tsx` 自己與 `CreationHubSections.test.tsx`——沒有任何
  頁面 import 使用它們。
- 實際上線的首頁（`client/src/pages/Home.tsx:88,1599`）用的是另一個元件
  `ContinueWhereYouLeftOff`（`client/src/components/ContinueWhereYouLeftOff.tsx`），
  邏輯上是同一件事（「繼續上次專案」引導卡）的後繼版本。

**影響**
- 這是一個完整、有型別、有 24 個測試案例（`CreationHubSections.test.tsx`）
  在跑的元件模組，卻在真實頁面樹裡完全不可達——測試綠燈會讓人誤以為這條
  「繼續上次專案」UI 是活的、有被驗證覆蓋，實際上使用者永遠看不到它。
  因為它與稽核主檔案共享同一組 `Project`/`activeProject` 資料模型，若之後
  有人維護 `ProjectsContext.tsx` 的 `Project` 型別卻忘了這裡也要跟著改，
  會在無人使用的情況下產生類型不同步而不自知。

**建議**
- 確認 `CreationHubSections.tsx` 是否為 Step 3 遺留、已被
  `ContinueWhereYouLeftOff` + `continueResume.ts` 取代；若是，整檔（含測試）
  一併移除，減少維護面積。

---

### 🟢 LOW-1（dead-ui）`AssetsLibrary.tsx` openDialog handler 裡的 `legacyAssetId` 分支是不可達死碼

**發現（附行號）**
- `client/src/pages/AssetsLibrary.tsx:771-782`：
  ```
  const actionRecord = action as unknown as Record<string, unknown>;
  const legacyAssetId = actionRecord && typeof actionRecord === "object" &&
    "assetId" in actionRecord ? actionRecord.assetId : undefined;
  const assetIdFromParams = action.params && typeof action.params === "object"
    ? (action.params as { assetId?: unknown }).assetId : undefined;
  const assetId = assetIdFromParams ?? legacyAssetId;
  ```
- `shared/agent-actions.ts:99-102`（`OpenDialogAction` 型別定義）只有
  `type`/`dialogId`/`params`，沒有頂層 `assetId` 欄位。
- `shared/agent-actions.ts:572-588`（`coerceAgentAction` 對 `"openDialog"`
  的正規化邏輯）：若輸入物件帶頂層 `assetId`，會直接併入
  `mergedParams.assetId` 再回傳，回傳物件本身沒有頂層 `assetId` 欄位——即任何
  經過 `coerceAgentAction` 的 action，頂層必然沒有 `assetId`。
- 客戶端唯一會建構 `AgentAction` 送進 `page.handle()` 的兩條路徑——
  `client/src/contexts/PageAgentContext.tsx`（import 並使用
  `coerceAgentAction`）與 `client/src/agent/GlobalOrbExecutor.ts:231`（同樣
  呼叫 `coerceAgentAction`）——都會先做這層正規化；直接手動建構
  `{ type: "openDialog", ... }` 字面值的呼叫點（`ProactiveOrbWidget.tsx` 多處）
  也都只用 `params`，沒有任何呼叫點會產生頂層 `assetId`。

**影響**
- 無使用者可見影響，純粹是永遠不會被觸發的防禦分支，但會誤導後續開發者
  以為存在「舊協議相容」需求而延續維護這段死碼。

**建議**
- 移除 `legacyAssetId` 分支，只保留 `action.params?.assetId` 讀取。

---

### 🟢 LOW-2（uiux-defect，a11y）刪除按鈕 hover-only 顯示，鍵盤使用者難以發現

**發現（附行號）**
- `client/src/components/ProjectNotesDrawer.tsx:156-161`：
  ```
  <button
    onClick={() => onDelete(note.id)}
    className={`... ${isMobile ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
  >
  ```
  桌面版預設 `opacity-0`，只在 `group-hover` 時顯示，沒有
  `focus-visible:opacity-100` 之類的鍵盤可視化規則。

**影響**
- 純鍵盤操作或使用螢幕放大鏡的使用者 Tab 到這顆按鈕時，按鈕仍然視覺不可見
  （雖仍可用 Enter 觸發），屬於可發現性的 a11y 缺陷。

**建議**
- 加上 `focus-visible:opacity-100`（或等效的 focus-within 規則）。

---

## 已驗證排除的疑慮（negative results）

- **MockProjectsProvider 的「猜最新一筆」不是生產環境問題**：
  `MockProjectsProvider`（`ProjectsContext.tsx:380-474`）內部也有一份
  `pickActive`/`pickLatest` 邏輯，但這條路徑只在 `ENABLE_PROJECT_SSOT` 為
  `false` 時才會啟用；已於 HIGH-1 確認 `.env.production` 與兩個旗標的預設值
  都讓 `RealProjectsProvider`（SSOT=ON）成為線上實際路徑，故本疑慮排除，
  問題聚焦在 `RealProjectsProvider` 本身（見 HIGH-1）。
- **刪除／更新動作沒有 client-side 越權風險**：`server/routers/notes.ts:266-268,
  300-303`（`update`/`delete`）與 `server/routers/assets.ts:210-213,232-250,
  286-301`（`update`/`toggleVisibility`/`delete`）都在伺服器端明確比對
  `resource.userId !== ctx.user.id` 才允許操作，越權嘗試還會呼叫
  `recordAuditEvent` 留痕（`assets.ts:235-249,289-300`）——確認 id 雖是使用者
  可猜的遞增整數，但沒有构成可繞過的安全邊界。
- **`UploadDialog`／server `assets.upload` 契約一致**：客戶端送出的
  `title/assetType/fileUrl/fileKey/mimeType/fileSizeBytes`
  （`AssetsLibrary.tsx:351-359`）與 `server/routers/assets.ts:165-184` 的
  input schema、`db.createDigitalAsset` 呼叫欄位完全對應，無缺欄位或型別
  不符。
- **分頁契約一致**：`db.getDigitalAssetsByUserFilteredPaged`
  （`server/db.ts:1298-1355`）回傳的 `{ items, nextCursor }` 與
  `AssetsLibrary.tsx:521-532` 的 `useInfiniteQuery`／`getNextPageParam` 用法
  完全匹配，無 contract-mismatch。
- **ProjectNotesDrawer 沒有「編輯既有筆記」功能，但這是刻意分工，非缺口**：
  `client/src/pages/NotesPage.tsx:239,282,573-596` 有完整的 inline 編輯流程
  （`editingId`/`notes.update` mutation）；`ProjectNotesDrawer.tsx:429-436`
  底部明確提供「完整筆記頁」連結導去 `/notes`，快速抽屜本身只做建立/狀態切換
  /刪除，屬於刻意精簡設計。
- **`assets.teamAssets` 的 cross-tenant 已知風險屬於既有追蹤項目，非本次新
  發現**：`server/routers/assets.ts:133-140` 註解自承「旗標 OFF（預設）=
  含已知 cross-tenant 洩漏」，`server/services/authz/resourceAccess.ts:
  161-166` 確認 `ENABLE_DATA_RBAC` 預設 `false`。這會直接影響
  `AssetsLibrary.tsx` 的「團隊共享」分頁資料範圍，故一併記錄供交叉確認，但
  因程式碼註解本身已標注為已知且掛在 AIDV-121 追蹤，不重複列為新發現。
- **`notes.list`/`assets.myAssets` 的欄位型別與 client 消費端無不符**：
  `NoteCard`（`ProjectNotesDrawer.tsx:47-67`）與資產卡片
  （`AssetsLibrary.tsx:1042-1052`）用到的欄位（`title/content/noteType/status/
  tags/scheduledDate/createdAt` 與 `title/assetType/fileUrl/thumbnailUrl/
  visibility/sourceStudio/modelId/rewardCredits/mimeType/fileSizeBytes/
  createdAt`）在對應的 DB schema（`drizzle/schema.ts:331-379,487-530`）與
  router 回傳型別中都存在對應欄位，僅 nullable 寬鬆度略有落差（均為 client
  型別比 server 更寬鬆，不構成執行期錯誤）。

---

## 交叉參照

- `docs/research/00-devzone.md:39-41`（卡 NS-02）、`:60-62`（卡 NS-07）——本次
  程式碼層級稽核與這兩張待討論卡片的「現況」描述完全吻合，兩者狀態均仍為
  「待討論／方案」，尚未排入實作。
- `docs/research/00-discussion-taskcards.md:48,53`——NS-02/NS-07 全域索引，
  對應狀態欄「方案(M1)」「方案(M4)」，確認本次發現非已修復項目的重複回報。

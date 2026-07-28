# IN7 — 欄位跨層一致性(DB↔Drizzle↔zod↔client)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核接縫:drizzle/schema.ts(4758)↔ 對應 zod input schema ↔ client/src/types/*.ts,鎖定核心實體

範圍：`creative_projects`(drizzle/schema.ts:3678-3728)、`world_storyboards`(3548-3591)、
`background_jobs`(286-329)、`generation_history`(935-993)、`digital_asset_library`(331-408)、
`teaching_materials`(4013-4126)、`users`(23-76)。逐欄位追 DB→Drizzle→zod→client type，
兩端都讀過才下結論；不確定處已標「未在兩端驗證」。

---

## 發現（按嚴重度排序）

### F1（critical）— `background_jobs` image/keyframe 生成路徑是死接縫：submitStudioJob 從不觸發生成、jobStatus 是被動讀取、client 結果映射欄位在 DB 上不存在

**接縫兩端：**
- endpoint A（client 消費端，讀取假設）：`client/src/adapters/generation.trpc.ts:128-160`
  - L128-135：呼叫 `client.generate.submitStudioJob.mutate({studioType, requestId, modelId, prompt})`，只取回 `jobId`。
  - L141-150：輪詢 `client.generate.jobStatus.query({ jobId })`，把回傳存進 `last`。
  - L152-160：`GenResult` 用 `last?.seed`、`last?.model`、`last?.costUsd`、`last?.assetUrl ?? last?.url` 組裝。
- endpoint B（server 實際行為）：
  - `server/routers/generate.ts:2143-2169`（`submitStudioJob`）：只呼叫 `db.createBackgroundJob(...)` 寫一筆 `background_jobs` 記錄（status="processing"），**沒有任何呼叫 fal.ai / 任何 provider 的程式碼**——job 建立後不會有任何東西把它從 "processing" 轉出。
  - `server/routers/generate.ts:1536-1540`（`jobStatus`）：`return db.getBackgroundJob(input.jobId)`，純被動 DB 讀取，**不觸發任何外部狀態查詢**（對照 `checkStudioJob`，L2176-2365，才會呼叫 fal.ai `/status` 並在 COMPLETED 時把 `resultJson.resultUrl` 寫回）。
  - `drizzle/schema.ts:286-317`：`backgroundJobs` 表沒有 `assetUrl` / `url` / `seed` / `model` / `costUsd` 欄位——這些值若存在，只會巢狀在 `resultJson`（json 欄，L312）裡。

**影響：**
`jobStatus` 回傳的是 raw `BackgroundJob` row，其 `last.seed`、`last.model`、`last.costUsd`、`last.assetUrl`、`last.url` 全部是 `undefined`（表上根本沒有這些頂層欄位）。更嚴重的是，因為 `submitStudioJob` 從未呼叫任何生成 API，job 狀態永遠停在 `"processing"`，輪詢迴圈（`POLL_TIMEOUT_MS = 180_000`，L30/139-150）跑滿 3 分鐘後直接跳出 while，**沒有 timeout 分支拋錯**——程式碼直接往下組出 `result: GenResult = { ok: true, ..., assetUrl: undefined, ... }` 當作成功回傳（generation.trpc.ts:152-160）。

此路徑是 `/video` shell（4-shell 新介面）畫布產圖的**唯一生成入口**：`ProjectSpineProvider.tsx:189-224`（`genOne`）呼叫 `spine.adapters.generation.generate(...)`，kind 為 `"image"`/`"keyframe"` 時即走上述 `runJob` 分支；`adapters/index.ts:54` 把 `makeGenerationTrpc` 設為非 mock 情境下的**預設**實作。而 `ENABLE_4SHELL` 自 2026-06-20 起預設為 `true`（`client/src/config/featureFlags.ts:58`，註解明載「正式環境早已為新介面」）。也就是說：**使用者在 /video 畫布按下生成分鏡影像，會空轉 3 分鐘後被 UI 判定為「已完成」，但沒有任何圖片產出**（`ProjectSpineProvider.tsx:214-216` 把 `res.assetUrl`（undefined）直接寫進 shot 狀態，UI 把 `gen.status` 設成 `"done"`）。

對照組（同倉庫內「接得對」的寫法）：`client/src/contexts/BackgroundTasksContext.tsx:225,234-235,312,317` 正確地讀 `meta?.resultUrl`（巢狀在 `resultJson`）且輪詢用會主動查 fal.ai 的 `checkStudioJob`（`generate.ts:2176`），證明 codebase 內有正確模式，只是 `generation.trpc.ts` 沒有沿用。

此外，`submitStudioJob`（generate.ts:2143-2169）寫入的 `resultJson`（L2160-2166）**沒有 `costPoints` 欄位**，也沒呼叫任何 `chargeForFalTask`/`prepareJob` 之類的扣點函式——與已知 B-19（submitStudioJob 不寫 costPoints）現況一致：此路徑不僅不生成，也完全不扣點/不記成本。

**建議：**
1. `generation.trpc.ts` 的 image/keyframe 分支改輪詢 `generate.checkStudioJob`（而非 `generate.jobStatus`），並從 `last.resultJson?.resultUrl`（比照 `BackgroundTasksContext.tsx` 的讀法）取值，不要讀不存在的頂層 `assetUrl`/`url`/`seed`/`model`/`costUsd`。
2. `submitStudioJob` 需要真的觸發生成（呼叫對應 `imageStudio.<model>` 的送出邏輯或內部等價函式），或至少在文件/型別上明確標示它只是「登記」，呼叫端不能單靠它 + `jobStatus` 期待任務完成。
3. 輪詢逾時（180s）應該拋 `AdapterError`／回報失敗，不能靜默包成 `ok: true`。
4. 若要扣點，仿造 `submitMultimodalAsync` 或 `proStudio.generateMusicSuno`（L2068 `costPoints`）在建立 job 時一併寫入。

---

### F2（high）— `digital_asset_library.sourceStudio` 值 `"music-studio"` 不在 server/client 的過濾 enum 裡

**接縫兩端：**
- endpoint A（寫入端，實際落庫值）：`server/routers/proStudio.ts:2063`（`sourceStudio: "music-studio"`，寫進 `createBackgroundJob` 的 `resultJson`）；`server/routes/webhookSuno.ts:245-261` 的註解明確說明 `...existingMeta` 展開順序讓 `"music-studio"` 蓋掉預設的 `"pro"`，即**最終持久化到 `digital_asset_library.sourceStudio` 的值就是 `"music-studio"`**（經 `server/services/postGenActions.ts:521-522` `sourceStudio ?? studioType` → `digitalAssetLibrary.sourceStudio`）。
- endpoint B（讀取/過濾端 enum）：
  - server：`server/routers/assets.ts:34-48`（`myAssets.sourceStudio`）與 `:103-117`（`teamAssets.sourceStudio`）zod enum 為 `["all","creative","director","image","video","pro","background","webhook","suno","replicate","unknown"]`——**沒有 `"music-studio"`**。
  - client：`client/src/pages/AssetsLibrary.tsx:160-172`（`SOURCE_STUDIOS` 常數 + `SourceStudioFilter` 型別）同樣沒有 `"music-studio"`，`SOURCE_STUDIO_LABELS`（L175-187）亦無對應標籤。

**影響：**
Suno 音樂生成的資產會以 `sourceStudio="music-studio"` 存進 `digital_asset_library`，但使用者永遠無法用「來源工作室」篩選器精準篩出它（送 `sourceStudio: "music-studio"` 給 `myAssets`/`teamAssets` 會被 zod 拒絕成 400；UI 下拉選單裡也沒有這個選項）。在「全部」檢視下該資產仍會顯示，但 `AssetsLibrary.tsx:1247` 的標籤查找 `SOURCE_STUDIO_LABELS[...] ?? asset.sourceStudio` 會退回顯示原始字串 `"music-studio"` 而非人類可讀標籤，行為降級但不至於崩潰。

**建議：** 在 `assets.ts` 兩處 zod enum 與 `AssetsLibrary.tsx` 的 `SOURCE_STUDIOS`/`SOURCE_STUDIO_LABELS` 補上 `"music-studio"`（或反向：把 proStudio.ts:2063 改成沿用既有 `"pro"`，若「音樂」與「其他 pro studio 產物」本來就不需要分開分類）。

---

### F3（medium）— `client/src/spine/types.ts` 的 `CreativeProject.assets`（← digital_asset_library）在真實閘道路徑上永遠是空陣列

**接縫兩端：**
- endpoint A（型別宣告 / 消費端期待）：`client/src/spine/types.ts:65-76`（`AssetRow` 型別註明 `← digital_asset_library`）；`client/src/shells/video/panels/AssetsPanel.tsx:96-99`（旗標 OFF 時 `<AssetList assets={p.assets} />`）。
- endpoint B（真實聚合邏輯）：`client/src/spine/projectGateway.ts:140-176`（`loadProject`）只並行呼叫 `worldbuilding.get` / `worldStoryboard.listByWorld` / `vault.list` / `notes.list` / `contextPacket.getLatest`，**完全沒有呼叫 `assets.myAssets` 或任何資產查詢**；`:363-365`（`assembleProject` 簽名）也沒有 `assets` 來源參數；`:436`（`(base.assets ?? []).map(...)`）裡的 `base` 是 `creativeProject.get` 的回傳值（`server/routers/creativeProject.ts:110-147`，回傳物件裡沒有 `assets` 欄位）。

**影響：**
`base.assets` 恆為 `undefined` → `assets` 恆為 `[]`。`AssetsPanel.tsx` 預設（`ENABLE_SUBSYSTEM_REAL_DATA` 預設 `false`，`client/src/config/videoFlags.ts:102`）讀 spine 本地 `p.assets`；本地陣列只靠 `ProjectSpineProvider.tsx:217-224`（`genOne` 成功後樂觀 `patchProject` 插入一筆）在單次 session 內累積。使用者重新整理頁面、切換分頁再回來、或换裝置後，先前生成的資產會從「/video 畫布」的資產面板中消失（即使 `digital_asset_library` 裡實際上還在），除非手動開 `VITE_ENABLE_SUBSYSTEM_REAL_DATA=1`。程式碼裡的旗標分支（`ENABLE_SUBSYSTEM_REAL_DATA` ON 時走 `assets.myAssets`，`AssetsPanel.tsx:76-90`）本身接得對，只是不是預設路徑。

**建議：** 要嘛把 `ENABLE_SUBSYSTEM_REAL_DATA` 預設打開（讓 `assets.myAssets` 成為預設資料源），要嘛在 `projectGateway.loadProject` 裡把 `assets.myAssets`（或依 project 過濾的等價查詢）併入 `Promise.all`，讓 `assembleProject` 拿到真實 `assets` 而不是恆空陣列。

---

### F4（medium，已被程式碼自行文件化、風險較低）— `creative_projects.status` enum ↔ client `Project.status` enum 值集不同

**接縫兩端：**
- endpoint A（DB/zod）：`drizzle/schema.ts:3695-3702`（`status: mysqlEnum([...concept,production,review,complete])`）；`server/routers/creativeProject.ts:24-29`（`projectStatusSchema` 同 4 值）。
- endpoint B（client type）：`client/src/types/projects.ts:21`（`ProjectStatus = "draft"|"active"|"completed"|"archived"`）。

**影響：** 兩邊 enum 值集不同（PS-08 類）。程式碼**已經**用顯式映射表處理：`client/src/contexts/ProjectsContext.tsx:82-89`（`SERVER_TO_CLIENT_STATUS`），並在註解自陳這是有損映射：`"review"→"active"` 會遺失語意、`"archived"` 在伺服器端無對應值。實測影響：走 `RealProjectsProvider`（SSOT ON，`ProjectsContext.tsx:186-352`）時，client 端 `status` 永遠不會是 `"archived"`（伺服器沒有這個狀態可產生它），只有走 `MockProjectsProvider`（`:380-474`）的離線模擬資料才會出現 `"archived"`——若任何 UI 邏輯依賴「真實資料也可能是 archived」會落空，但目前查無此類邏輯（未在兩端驗證是否有依賴 archived 分支的 UI 判斷，僅檢查了 ProjectsContext 本身）。

**建議：** 現況可接受（已文件化、非崩潰性），但建議在 `docs/` 追蹤「後端補 archived 狀態」的待辦，避免日後有人新增依賴 `archived` 分支的 UI 邏輯時才發現伺服器端永遠產生不出這個狀態。

---

### 已驗證接得對的接縫（negative results）

| 實體 | 檢查點 | 結論 |
|---|---|---|
| `teaching_materials` | `mediaType`/`sourceType`/`visibility` 三個 enum：`drizzle/schema.ts:4028-4036,4071-4079,4096-4101` ↔ `server/routers/teachingArchive.ts:27-55`（`TEACHING_MEDIA_TYPES`/`TEACHING_SOURCE_TYPES`/`TEACHING_VISIBILITY` + zod schema） | 三層值集完全一致；無獨立 client 手寫型別，未見 UI 端另建列舉造成漂移風險。 |
| `teaching_materials` | `sourceDate`（DB `date()`，`drizzle/schema.ts:4083`）↔ zod `server/routers/teachingArchive.ts:86-89`（`YYYY-MM-DD` regex） | 型別對齊，未見不符。 |
| `generation_history` | `server/routers/history.ts:9-88`（`historyRouter`）回傳型別 vs 前端消費 | `client/src/pages/HistoryPage.tsx:168-215` 直接用 tRPC 推導型別（無獨立 client type 檔案），無手寫型別可漂移。 |
| `world_storyboards` | `productionStatus` 7 值 enum：`shared/worldbuilding-animation.ts:208-215`（TS type）↔ `:362-374`（`worldStoryboardInputSchema` zod）↔ `server/routers/worldStoryboard.ts:44-76`（`rowToStoryboard`） | 三層完全一致；`client/src/pages/AnimationStudio.tsx:5841,6559` 只是原樣顯示 `sb.productionStatus`，未重複定義列舉。 |
| `digital_asset_library` | `assetType` enum（`drizzle/schema.ts:338-345`）↔ `server/routers/assets.ts:20-30,92-101,170-177`（`upload`/`myAssets`/`teamAssets` 三處 zod enum） | 6 值（image/video/audio/voice/script/zip_bundle）三處完全一致（filter 額外的 `"all"` 是應用層萬用值，非儲存值，屬預期擴充）。 |
| `digital_asset_library` | `visibility` enum（`drizzle/schema.ts:353-355`：private/team_shared）↔ `server/routers/assets.ts:227-230`（`toggleVisibility`） | 一致。 |
| `users` | `quotaJson`/`remainingGenerations` 讀取端 | `server/routers/dashboard.ts:18,55`、`server/routers/credits.ts:71` 直接讀 `ctx.user.remainingGenerations`；未見獨立 client 手寫 `User` 型別（`client/src/types/` 下只有 `projects.ts`），無跨層列舉/欄位漂移風險（此點僅檢查伺服器讀取路徑一致性，客戶端消費是否有欄位誤讀未逐一驗證，標記為「未在兩端完整驗證」）。 |

---

## 已知接縫斷點現況確認（prior，不重複詳述）

- **B-19**（submitStudioJob 不寫 costPoints）：本次稽核確認**現況仍然成立**，且範圍比原描述更大——`submitStudioJob`（`generate.ts:2143-2169`）不只不寫 `costPoints`，而是完全不觸發生成、不扣款（見上方 F1）。
- **C-01 / C-02**：未在本次逐欄位稽核中重新深挖（不在 `creative_projects/world_storyboards/background_jobs/generation_history/digital_asset_library/teaching_materials/users` 欄位比對主線內），僅確認 `client/src/pages/VideoStudio.tsx:4985` 仍有 `resultUrl: null` 字樣、`server/routers/director.ts:1175`（`batchGenerateWithSession`）與 `client/src/pages/DirectorAI.tsx:2907` 呼叫點仍存在——**現況是否仍完全符合原描述未在兩端逐欄位重新驗證**，僅供索引。
- **SSOT-1**（appRegistry.supportedActions↔hasCapabilityForPage 脫鉤）：不在本次核心實體欄位範圍內，未查驗。

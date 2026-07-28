# IN3 — 前後端契約:learn/教材/連接器/社群域
- 產生日期:2026-07-03
- 依據 commit:7f4417daaacbf24510dc20d88dba9aae71b2883c（HEAD 實測；任務單指定的
  `812f6fdb` 在本 repo 歷史中不存在，`git cat-file -t 812f6fdb` 回
  `fatal: Not a valid object name`，故改用實際 HEAD，特此註明避免誤導）
- 稽核接縫:server/routers/{learnHub,teachingArchive,externalServices,drive,showcase}.ts
  ↔ client/src/pages/{LearnHub,TeachingArchive}.tsx + components/connectors/*

> 方法論：每個發現都先讀「兩端」實際程式碼再下結論；行號皆為本次讀取當下的實際行號。
> 找不到兩端證據的一律標「未在兩端驗證」，不臆測。

---

## 摘要

本輪聚焦教材（TeachingArchive）`isFeatured`/`vectorStatus`類欄位兩端一致性、
連接器（connectors）兩套資料模型、showcase 公開欄位契約三個子題。

結論：
- **`vectorStatus` 在兩端都不存在**——語意向量化完成度目前完全借用
  `transcriptionStatus` 表達，這正是 Y7 徽章矛盾的根因，於 HEAD 仍原樣存在。
- **`teachingArchive.isFeatured`/`sortOrder` 是單向死欄位**——DB/Drizzle/zod
  三端都支援且 server 依此排序，但 client 完全不讀不寫，於 HEAD 仍原樣存在
  （L2-fields-learn.md:361,492 先前已記錄，本次重新對照程式碼確認仍成立）。
- **`teachingArchive.update`/`linkRealEarthEntry`/`unlinkRealEarthEntry`/
  `getRealEarthLinks` 四個 mutation/query 是死接縫**——server 完整實作，
  client 零呼叫（`teachingArchive.update` 為 M3-connectors-workflows.md 已記錄的
  已知缺口，本次重新驗證仍成立；RealEarth 三端點為本次新確認的死接縫）。
- **`externalServicesRouter` 整支 router 零客戶端呼叫**——連 `updateApiKeyStatus`
  docstring 聲稱的「由健康監控 job 呼叫」在任何 job 檔案中都找不到對應呼叫，
  是文件與程式碼不符的死接縫。
- **connectors 兩套資料模型（FE-05 對照）確認仍分裂**——`ConnectorsPanel` 純
  mock、`CONNECTORS_PANEL_ENABLED` 旗標本身也從未被任何路由讀取（旗標即死碼），
  與真正接 `drive.ts` 的 `DriveLibrarySection.tsx`/`SourcePicker.tsx` 是兩棵互不
  相交的元件樹。
- **showcase LOD 契約、drive 契約、learnHub 影片/測驗 `ephemeral` 旗標** 三處
  經逐欄核對，**兩端接得對**，列入文末 negative results。

---

## 發現一覽（依嚴重度排序）

### 1. 〔dead-seam｜高〕`teachingArchive.isFeatured` / `sortOrder` 全鏈路存在但 client 完全不讀不寫

**接縫斷點兩端：**
- Server DB 投影：`server/db.ts:4044-4072`（`TEACHING_MATERIAL_SUMMARY_COLUMNS`，
  `isFeatured: teachingMaterials.isFeatured` 在第 4068 行、`realEarthRefs` 在
  4066 行）；排序邏輯 `server/db.ts:4139-4143`
  （`orderBy(desc(teachingMaterials.isFeatured), desc(teachingMaterials.sortOrder), ...)`）
- Server zod 契約：`server/routers/teachingArchive.ts:101-102`
  （`isFeatured: z.boolean().default(false)`、`sortOrder: z.number().int().default(0)`，
  `createInputSchema`/`updateInputSchema` 皆接受）
- Drizzle schema：`drizzle/schema.ts:4103`（`isFeatured: boolean(...).default(false).notNull()`）
- Client：`client/src/pages/TeachingArchive.tsx` 全檔 grep `isFeatured|sortOrder|featured`
  **零命中**——`buildSharedClassification()`（`TeachingArchive.tsx:894-907`）建立
  create payload 時不含 `isFeatured`/`sortOrder`；`MaterialCard`
  （`TeachingArchive.tsx:665-680`）渲染卡片時沒有任何「精選」徽章或排序控制項，
  對照 `LearnHub.tsx` 的 `DocCard`（`LearnHub.tsx:267-269,278-283`）明確有
  `doc.featured` 的琥珀色徽章 + `AdminDocForm` 的「設為精選文件」Switch
  （`LearnHub.tsx:668-677`）。

**影響：** 教材永遠只能靠 `isFeatured` 的資料庫預設值（false）與插入順序排序；
即使有人直接呼叫 API 把某筆教材設為精選，前端也看不到任何視覺差異，功能形同
虛設。此為 L2-fields-learn.md:361,492 已記錄的缺口，本次重新對照程式碼
（HEAD `7f4417da`）**確認仍原樣存在**。

**建議：** UploadDialog / DetailDialog 補「設為精選」開關（比照 LearnHub 的
Switch），MaterialCard 補精選徽章；或者若判定教材精選功能非當前優先級，應在
zod schema 註解明確標示「暫不支援，UI 未實裝」避免誤導未來開發者。

---

### 2. 〔contract-mismatch｜高〕`vectorStatus` 概念兩端皆不存在，語意檢索完成度被誤植進 `transcriptionStatus`（對照 NSX-1 / Y7）

**接縫斷點兩端：**
- Server 建立教材時的狀態指派：`server/routers/teachingArchive.ts:240-244,260-264`
  ```
  const needsIngestion =
    !input.textContent &&
    (input.mediaType === "pdf" || input.mediaType === "audio" || input.mediaType === "video");
  ...
  transcriptionStatus: input.textContent
    ? "completed"
    : needsIngestion ? "pending" : "not_applicable",
  ```
  → `mediaType: "text"` 且有 `textContent` 的教材，`transcriptionStatus` **立刻**
  被設為 `"completed"`，且從未進入 `needsIngestion` 分支。
- Server 向量化白名單：`server/services/teachingArchiveIngest.ts:32-34`
  ```
  function isIngestable(mediaType): mediaType is IngestableMediaType {
    return mediaType === "pdf" || mediaType === "audio" || mediaType === "video";
  }
  ```
  → `text` 型教材**永遠不在**可向量化清單中，`enqueueTeachingIngestion` 也只在
  `needsIngestion` 為真時才被呼叫（`teachingArchive.ts:281-288`），故 `text`
  教材從建立到永遠，都不會被送進 Pinecone 向量索引。
- Client 徽章渲染：`client/src/pages/TeachingArchive.tsx:731-759`
  （`TranscriptionBadge`）——`status === "completed"` 一律顯示綠色
  `<CheckCircle2>` + 文字「已抽文」，沒有任何欄位或文案區分「純文字已存檔」
  和「內容已向量化、可被語意搜尋」。
- 全庫掃描確認：`grep -rn "vectorStatus" server/ drizzle/` **零命中**——沒有任何
  獨立欄位追蹤向量化完成度，此概念完全借用 `transcriptionStatus` 語意，
  **兩端皆未實作 `vectorStatus`，此為「未在兩端驗證」的欄位，僅在文件層面被
  引用**。

**影響：** 使用者對純文字開示看到「已抽文」綠勾，直覺認為師父開示已可被光球 /
`teachingArchive.search` 完整語意引用，但實際上這些記錄只能靠
`searchTeachingArchive`（`server/services/teachingArchiveSearch.ts`）的 LIKE
fallback 命中，語意檢索精準度遠低於使用者預期。此為 NSX-1
（`00-discussion-taskcards.md:336`）與 Y7（`Y7-learnhub-teaching-frontend.md:120,133,242`）
先前已記錄的問題，本次重新對照程式碼（HEAD `7f4417da`）**確認仍原樣存在**，
且额外確認了「沒有 vectorStatus 欄位」這個根因細節。

**建議：** 至少在徽章文案或詳情頁補一個獨立的「AI 可語意搜尋」指示（不與
「已抽文」混用），或著手把 `text` mediaType 也導入 Pinecone 向量化管線。

---

### 3. 〔dead-seam｜高〕`teachingArchive.update` 與 RealEarth 三端點（link/unlink/getRealEarthLinks）server 端完整實作、client 零呼叫

**接縫斷點兩端：**
- Server：
  - `update`：`server/routers/teachingArchive.ts:307-361`（完整 partial-patch
    mutation，含 team 轉移驗證、visibility×teamId 交叉驗證、`logAccess` 稽核）
  - `linkRealEarthEntry`：`server/routers/teachingArchive.ts:462-489`
  - `unlinkRealEarthEntry`：`server/routers/teachingArchive.ts:492-514`
  - `getRealEarthLinks`：`server/routers/teachingArchive.ts:517-527`
  - 對應欄位 `realEarthRefs`：`drizzle/schema.ts:4093`
    （`json("realEarthRefs").$type<number[]>()`），也出現在
    `TEACHING_MATERIAL_SUMMARY_COLUMNS`（`server/db.ts:4066`），即每筆 list
    結果都會帶這個陣列回前端。
- Client：`grep -n "teachingArchive.update\|patch:" client/src/pages/TeachingArchive.tsx`
  **零命中**；`grep -rn "teachingArchive\.(update|linkRealEarthEntry|unlinkRealEarthEntry|getRealEarthLinks)" client/src`
  **全庫零命中**。相關的 RealEarth 前端功能
  （`client/src/shells/video/drawers/RealEarthResearch.tsx`）也完全不引用
  `teachingArchive.*`——兩者是互不相交的兩座孤島。

**影響：**
1. `update` 缺失：上傳教材後若分類/講者/lineage 打錯字，使用者**只能刪除重傳**，
   無法就地修正（此為 M3-connectors-workflows.md:32-33,124 已記錄的已知缺口，
   本次重新驗證 HEAD `7f4417da` **仍原樣存在**）。
2. RealEarth 三端點：`realEarthRefs` 欄位已在 DB schema、summary 投影中真實存在
   並隨每次 `list` 回傳給前端，但沒有任何 UI 元件讀取或寫入它——是本次新確認
   的死接縫，此欄位對前端而言目前純粹是「傳了也沒人用」的空氣運費。

**建議：** `update` 前端表單優先補齊（M3 已指出這是「補一下就有」的低成本
修復）；RealEarth 連結功能若非近期路線圖，建議在 router 註解註明「client 尚未
實作」，並評估是否該從 `TEACHING_MATERIAL_SUMMARY_COLUMNS` 移除以減少無謂的
payload。

---

### 4. 〔dead-seam｜中〕`externalServicesRouter` 整支 router 零客戶端呼叫，且 `updateApiKeyStatus` 的「健康監控 job 呼叫」文件宣稱查無此呼叫

**接縫斷點兩端：**
- Server 註冊：`server/routers.ts:72`（import）、`server/routers.ts:325`
  （`externalServices: externalServicesRouter`）——`list`/`summary`/`upsert`/
  `delete`/`updateApiKeyStatus`/`seedDefaults` 六個端點全部掛載
  （`server/routers/externalServices.ts:45-307`）。
- `updateApiKeyStatus` 的文件宣稱：`server/routers/externalServices.ts:12`
  「`updateApiKeyStatus : 更新 API key 健康狀態（由健康監控 job 呼叫）`」，端點
  本體在 `server/routers/externalServices.ts:169-186`。
- Client：`grep -rln "monthlyCostUsd\|apiKeyEnvVar\|billingCycle" client/src`
  以及 `grep -rn "trpc\.externalServices\." client/src` **全庫零命中**——沒有
  任何「服務訂閱管理」後台頁面呼叫這支 router。
- 「健康監控 job」核實：`grep -n "apiKeyStatus\|externalService" server/jobs/apiHealthMonitor.ts server/jobs/providerHealthProbeJob.ts server/jobs/goTrueHealthMonitor.ts`
  **全部零命中**——目前 repo 中沒有任何 job 呼叫 `updateApiKeyStatus`，
  docstring 描述的呼叫方在程式碼裡並不存在。

**影響：** 這支 router（含 `seedDefaults` 預埋的 fal.ai / ElevenLabs / Gemini /
Pinecone / Replicate / LangSmith / R2 / NVIDIA NIM / Brave / Perplexity /
Railway 等服務清單，`externalServices.ts:194-295`）目前是完全孤立的後台
API——沒有管理頁面能看到成本摘要、也沒有任何自動化流程回寫 API key 健康狀態，
`apiKeyStatus` 欄位一旦透過 `seedDefaults` 寫入 `"valid"` 就會**永遠停留在該值**，
不會被任何機制更新。

**建議：** 若已規劃「服務訂閱管理」後台頁面，優先補上 `list`/`summary` 的最小
唯讀檢視；`updateApiKeyStatus` 若確實要接健康監控 job，需在
`apiHealthMonitor.ts`/`providerHealthProbeJob.ts` 補上呼叫，並同步修正
docstring 的「已呼叫」措辭以免誤導。

---

### 5. 〔field-inconsistency｜中〕LearnHub `featured` vs TeachingArchive `isFeatured` 命名慣例不一致（同域兩套精選欄位）

**接縫斷點兩端：**
- `server/routers/learnHub.seed.ts:23`（`LearnDoc.featured: boolean`），
  client 端 `client/src/pages/LearnHub.tsx:267-269,2270`
  （`docs.filter(d => d.featured)`）——欄位名為 `featured`。
- `drizzle/schema.ts:4103`（`teachingMaterials.isFeatured`），
  `server/routers/teachingArchive.ts:101`——欄位名為 `isFeatured`。

**影響：** 兩者語意完全相同（「是否精選」），但命名慣例不同
（`featured` vs `isFeatured`）。目前尚**未發現**任何程式碼同時處理這兩種型別
（`server/services/siteKnowledge.ts:94` 只碰 `LearnDoc.featured`，未涉及
`teachingMaterials`），故現況**尚未造成實際執行期錯誤**，屬於潛伏風險：未來若
有人建一個橫跨「學習文件 + 教材」的統一搜尋/徽章元件，最容易在这兩個欄位名之間
犯手滑錯誤（例如寫成 `doc.isFeatured` 或 `material.featured` 而拿到
`undefined`）。

**建議：** 非緊急，但建議在下一次觸碰任一 schema 時統一成 `isFeatured`
（或都改 `featured`），並在型別定義處加註解說明另一側的命名。

---

### 6. 〔dead-seam / field-inconsistency｜低，對照 FE-05〕connectors 兩套資料模型仍分裂，`ConnectorsPanel` 旗標本身也是死碼

**接縫斷點兩端：**
- Mock 資料模型：`client/src/components/connectors/connectorsTypes.ts:33-43`
  （`Connector` interface：`id/name/category/status/health/detail/acl`）+
  `MOCK_CONNECTORS`（`connectorsTypes.ts:78-157`，純寫死陣列，`hf`/`gemini`/
  `r2`/`notion`/`mcp-local`/`vault-me` 六筆假資料）。組件本身自述
  「純前端唯讀 props（mock 離線可驗）；不接後端、零金鑰」
  （`client/src/components/connectors/ConnectorsPanel.tsx:1-11`），
  `ConnectorsPanelProps`（`ConnectorsPanel.tsx:226-237`）沒有任何 trpc 呼叫。
- 真實資料模型：`server/routers/drive.ts:17-125`（`status/disconnect/
  listLibraries/addLibrary/removeLibrary/listFolder`），client 端正確消費於
  `client/src/components/DriveLibrarySection.tsx:61-72,79-88,289-297,428-444`
  及 `client/src/components/animation/SourcePicker.tsx:390-398`——欄位
  （`driveFolderId`/`driveFolderName`/`label`/`kind`/`isFolder`/`thumbnailLink`/
  `webViewLink`/`nextPageToken`）逐一比對**完全吻合**（見文末 negative
  results）。
- 旗標本身也未被消費：`grep -rn "CONNECTORS_PANEL_ENABLED" client/src`
  **只有定義處**（`client/src/components/connectors/connectorsFlags.ts:40`）
  被命中，沒有任何路由/元件 import 並依此條件掛載 `/settings/connections`；
  `grep -rn "ConnectorsPanel" client/src` 只命中它自己的檔案 + `index.ts` +
  測試檔——**沒有任何路由檔案掛載這個元件**。

**影響：** `ConnectorsPanel` 所稱的「storage」類別（意圖代表 Cloudflare R2 /
Google Drive）目前完全是寫死的假資料，不會反映 `drive.status.connected` 的
真實狀態；即使營運人員在 Railway 設定 `VITE_CONNECTORS_PANEL=1`，也**不會有任何
變化**，因為沒有程式碼讀取這個旗標來決定是否掛載路由——這是 FE-05 已記錄的
「兩套資料模型」現況，本次重新驗證 HEAD `7f4417da` **確認仍分裂，且额外確認
旗標本身也是死碼**（不只是資料沒接，連「開關」都沒接到任何消費端）。

**建議：** 若 Wave U 的連接器治理面板要正式上線，除了把 mock 換成真實資料源
（至少 storage 類別要接 `drive.status`），也需要在某個路由檔案
（如 `App.tsx` 或 settings 路由表）依 `CONNECTORS_PANEL_ENABLED` 條件式掛載
`/settings/connections`，否則旗標形同虛設。

---

## 已驗證接得對的接縫（negative results）

### N1. `showcase.list` / `getById` LOD 契約——server↔client 欄位逐一吻合

- Server list 投影 `LIST_FIELDS`：`server/routers/showcase.ts:229-242`
  （`id/title/description/imageUrl/thumbnailUrl/modality/sortWeight/likeCount/
  forkCount/commentCount/createdAt`）
- Client `ShowcaseItem` interface：`client/src/components/ShowcaseMasonry.tsx:54-66`
  ——十個欄位**逐一比對完全吻合**，`useInfiniteQuery`
  （`ShowcaseMasonry.tsx:725-736`）與 `nextCursor` 語意（正值=featured 分頁、
  負值=history fallback 分頁）在 `showcase.ts:274-333` 與client端游標處理邏輯
  一致。
- `getById` 完整欄位（`generatedItemId`/`completelyDeconstructedBlocks`/
  `vibeParameters`/`originalPrompt`/`imageUrl`/`modality`）：
  server 端無論走 `featuredShowcase` 真實列（`showcase.ts:411-429`）或負值
  `generation_history` fallback 合成物件（`showcase.ts:385-408`），都回傳相同
  形狀；client 消費於 `ShowcaseMasonry.tsx:638-668`，欄位存取
  **完全對應、無缺欄**。

### N2. Google Drive 連接器——`drive.ts` ↔ `DriveLibrarySection.tsx`/`SourcePicker.tsx` 完全對接

- `status`/`disconnect`/`listLibraries`/`addLibrary`/`removeLibrary`/
  `listFolder`（`server/routers/drive.ts:18-124`）與
  `DriveLibrarySection.tsx:61,62,69,79,289,428` 呼叫點**一一對應**；
  `DriveFile` 型別（`DriveLibrarySection.tsx:15`，
  `inferRouterOutputs<AppRouter>["drive"]["listFolder"]["files"][number]`）
  直接推導自 server 型別，欄位 `isFolder`/`thumbnailLink`/`webViewLink`
  來源於 `server/services/googleDrive.ts:220-234`（`adaptDriveFile`），
  三端型別鏈路**零手動轉譯、零漂移風險**。

### N3. LearnHub 影片/測驗 `ephemeral` 旗標——server↔client 正確傳遞

- Server `videoList`/`quizList` 回傳 `ephemeral: true as const`
  （`server/routers/learnHub.ts:836-840,980-983`），並在註解說明「AIDV-190：
  無 DB 表，redeploy/重啟即丟失」；docs `list` **沒有**此欄位
  （`learnHub.ts:483-529`，docs 已有 DB-backed 落地，見 `initLearnHubFromDb`
  `learnHub.ts:99-138`）。
- Client 正確地只在 video/quiz 分頁顯示 ephemeral 提示：
  `client/src/pages/LearnHub.tsx:1773`（`data?.ephemeral && <EphemeralAdminNotice kind="影片" />`）、
  `LearnHub.tsx:1983`（同上，`kind="測驗"`），docs 分頁沒有對應程式碼——
  **三種內容型態的持久化狀態差異被前端誠實反映，無誤導**。

### N4. LearnHub 文件 CRUD 表單——admin 表單欄位與 zod schema 逐一吻合

- `AdminDocForm`（`LearnHub.tsx:500-729`）送出的欄位
  （title/summary/content/category/difficulty/readingMinutes/tags/featured/
  externalUrl/authorName/attachments）與
  `learnHub.ts:551-582`（`create` 的 zod schema）**逐欄比對一致**，
  含 `attachments` 的 `type: enum(image/video/pdf/audio)` 巢狀結構也吻合。

### N5. TeachingArchive `create`/`get`/`delete`/`triggerIngestion`/`logView` 正確接線

- `UploadDialog.handleSubmit`（`TeachingArchive.tsx:909-1001`）送出的欄位與
  `createInputSchema`（`teachingArchive.ts:57-103`）一致；`DetailDialog`
  （`TeachingArchive.tsx:1565-1607`）對 `canWrite` 旗標的 gating邏輯與 server
  端 `get` procedure 算出的 `canWrite`（`teachingArchive.ts:184-198`）語意
  一致，`logView` 的「只在真人開啟詳情時打一次、輪詢不重複觸發」設計
  （`TeachingArchive.tsx:1595-1601` 對照 `teachingArchive.ts:173-176` 註解）
  兩端意圖**完全吻合**。

---

## 附註：條目與已知斷點對照表

| 本文編號 | 對照已知條目 | 現況 |
|---|---|---|
| 發現 2 | NSX-1、Y7 | HEAD `7f4417da` 重新驗證，**確認仍原樣存在**，補充「無 vectorStatus 欄位」根因細節 |
| 發現 3（`update`） | M3-connectors-workflows.md:32-33,124 | HEAD `7f4417da` 重新驗證，**確認仍原樣存在** |
| 發現 1 | L2-fields-learn.md:361,492 | HEAD `7f4417da` 重新驗證，**確認仍原樣存在** |
| 發現 6 | FE-05（連接器兩套資料模型） | HEAD `7f4417da` 重新驗證，**確認仍分裂**，新增「旗標本身也是死碼」細節 |
| 發現 3（RealEarth 三端點） | （無對應已知條目） | 本次新確認 |
| 發現 4（externalServices） | （無對應已知條目） | 本次新確認 |
| 發現 5（命名不一致） | （無對應已知條目，屬潛伏風險非已知斷點） | 本次新確認 |

# PF1 — 無界查詢/缺分頁

- 產生日期:2026-07-04
- 依據 commit:812f6fdb
- 稽核範圍:server/db.ts 與各 router 的 list/getAll/history/search/admin 類查詢

方法:通篇讀 `server/db.ts`(5701 行,265 個 exported function)找出所有
`.select()` / `findMany` 之後沒有 `.limit()` 的呼叫,再逐一追到呼叫端(router /
service),判斷底層資料表是「單一使用者小資料」還是「全站/歷史/日誌類大表」,
以及呼叫路徑是否為熱路徑(如 AI chat 每次送出都會跑)。所有結論皆基於實際讀碼,
無法從靜態碼確認的效能數字一律標「需負載驗證」。

---

## 嚴重度:critical

### 1. `ai.chat` 每次送出都全量撈使用者整個數位資產庫(熱路徑 + 記憶體膨脹)

- **檔案:行號**:`server/routers/ai.ts:1064-1084`(呼叫點),底層
  `server/db.ts:1227-1236`(`getDigitalAssetsByUser` 定義)
- **問題**:`ai.chat`(Orb AI 助理的聊天 mutation,使用者每送一則訊息就會執行一次)
  在組 prompt context 時呼叫 `db.getDigitalAssetsByUser(ctx.user.id)`
  **完全沒有帶 limit 參數**。`getDigitalAssetsByUser` 簽名雖然支援
  `limit?: number`,但呼叫端未傳,函式內部邏輯是
  `typeof limit === "number" && limit > 0 ? q.limit(limit) : q`
  ——即「沒傳 limit 就整表不設限」。抓回來的整包資料只是為了算
  `byType` 計數與 `slice(0, 5)` 取最近 5 筆,結果卻要先把該使用者
  `digital_asset_library`(生成圖片/影片/音檔/語音的核心內容表)全部
  行(含 title/description/promptUsed/fileUrl 等欄位)搬進 Node 記憶體。
- **cluster**:hot-path-recompute + memory-blowup
- **規模觸發**:`digital_asset_library` 是使用者生成內容的主表,是這個
  產品的核心產出(每次生圖/生影片/生音樂都會寫一筆)。對一個使用數月
  的活躍使用者,可能累積數千筆。屆時每一次 Orb 聊天訊息送出,都會全量
  掃描該使用者的整表 → JS 端 slice(0,5)。
- **現在痛 / 規模大才痛**:規模大才痛——新使用者資產少時感覺不到;但
  這是熱路徑(每則 chat 訊息都觸發),使用者資產量一旦累積到中大型
  (數千筆),延遲會隨資產數線性成長,且無法透過索引優化,因為整表都被
  抓。**需負載驗證**確認實際延遲門檻。
- **建議**:呼叫端補上 `limit`(如 200),或直接改呼叫已存在的
  `getDigitalAssetsByUserFiltered({ userId, limit: 200 })`(AIDV-581 已把
  SQL 下推做好,見下方「已正確有界」段落),讓 COUNT + 分類統計改用
  SQL `GROUP BY assetType` 聚合,不需要整表搬進記憶體。

### 2. AI 工具「音音」取最近音檔資產,同樣呼叫無界的 `getDigitalAssetsByUser`

- **檔案:行號**:`server/services/spiritTools/musicSpecialistTools.ts:571-587`
- **問題**:`getRecentAudioAssets(userId, limit=10)` 內部呼叫
  `getDigitalAssetsByUser(userId)`(同上,無 limit),抓回使用者全部資產
  後才用 `.filter(...).slice(0, cap)` 篩出音檔類型。這是 AI 代理工具,
  使用者在對話中說「跟上次一樣風格的」就會觸發。
- **cluster**:hot-path-recompute
- **規模觸發**:同第 1 條——使用者 `digital_asset_library` 累積量。
- **現在痛 / 規模大才痛**:規模大才痛。
- **建議**:與第 1 條共用同一個修法(改呼叫 filtered 版本並帶
  `assetType` 條件下推到 SQL,不要整表撈回再篩)。

---

## 嚴重度:high

### 3. `feedback.all`(admin)回傳全站回饋表,無任何 limit

- **檔案:行號**:`server/routers/feedback.ts:88-90`(呼叫點),
  `server/db.ts:1852-1859`(`getAllFeedbacks` 定義)
- **問題**:`db.getAllFeedbacks()` 是 `db.select().from(userFeedbackReports)
  .orderBy(...)`,完全沒有 `.limit()`。`user_feedback_reports` 是全站
  所有使用者提交的回饋(bug/功能建議/品質問題),會隨站點使用時間持續
  累積,且此端點無分頁 input。
- **cluster**:unbounded-query
- **規模觸發**:回饋累積到數千筆時(真實站點使用數月至一年可達到),
  admin 後台每次打開回饋頁,DB 全表掃描 + 整包回傳到前端。
- **現在痛 / 規模大才痛**:規模大才痛,但因為是**全站表**(非單一使用者
  資料),會隨站點成長持續變大,是明確會痛的類型。
- **建議**:仿照 `getAllGenerationHistory(limit=200)` /
  `getAllUsageLogs(limit=100)` 的既有慣例補上 `limit` 參數與 offset/cursor
  分頁。

### 4. `teachingArchive.list` 未帶 `scope.limit`,底層函式無界回傳全站教材

- **檔案:行號**:`server/routers/teachingArchive.ts:159-166`(呼叫點,
  `scope` 只傳了 `teamIds` / `only`,沒有 `limit`),底層
  `server/db.ts:4074-4148`(`listTeachingMaterialsForUser` 定義,
  `if (scope.limit !== undefined) return baseQuery.limit(scope.limit); return baseQuery;`
  ——`scope.limit` 未定義時直接回傳無 LIMIT 的 query)
- **問題**:`teachingArchive.list` 是使用者看教材庫的主要列表端點,
  visibility 條件涵蓋「自己的 + 團隊共享 + 全 workspace 公開
  (`public_disciples`)」。`public_disciches` 是**全站可見**的教材池,
  只要有人把教材設為公開,所有使用者的 `list` 呼叫都會把這個公開池
  全部撈出來(即使有做欄位投影排除 `textContent`/`fileKey`,列數仍無界)。
- **附帶發現**:`server/subsystems/trainingTrack/trainingTrackService.ts:109`
  的 `collectTeamTrainingImages` 也呼叫同一函式且未傳 `limit`,抓回團隊
  全部教材後才在 JS `for` 迴圈裡 `if (images.length >= MAX_TRAINING_IMAGES) break;`
  ——一樣是「先整包撈、再 JS 截斷」的模式。
- **cluster**:unbounded-query(teachingArchive.list)/ memory-blowup
  (collectTeamTrainingImages 撈全表才在迴圈中 break)
- **規模觸發**:`public_disciples` 公開教材池筆數成長(這是「教材」類
  大表,题目明確點名的風險型別)。團隊內圖片素材數量成長時
  `collectTeamTrainingImages` 也會變慢。
- **現在痛 / 規模大才痛**:規模大才痛——教材是管理員/團隊手動上傳,
  短期成長慢,但公開池是全站累加,長期會變大;且沒有任何分頁 UI 兜底。
- **建議**:`teachingArchive.list` 呼叫時固定帶 `scope.limit`(例如 100~200)
  並改前端為 cursor 分頁;`collectTeamTrainingImages` 應把
  `mediaType=image` 之外再把某種 `limit` 下推到 SQL(或至少傳
  `MAX_TRAINING_IMAGES * 3` 之類的安全上限,而非整包撈回)。

### 5. `admin.userActivity`:全表使用者 × 4 條相關子查詢,無 limit

- **檔案:行號**:`server/routers/admin.ts:140-142`(呼叫點),
  `server/db.ts:2933-2953`(`getUserActivitySummary` 定義)
- **問題**:`SELECT ... FROM users` 完全沒有 `LIMIT`,且每一行都內嵌
  4 個相關子查詢(`SELECT COUNT(*) FROM api_usage_logs WHERE ...`、
  `SELECT SUM(...) FROM api_usage_logs`、`SELECT COUNT(*) FROM
  generation_history`、`SELECT COUNT(*) FROM digital_asset_library`),
  等於「每一位使用者都要對 3 張成長表(api_usage_logs / generation_history
  / digital_asset_library)各跑一次子查詢」。
- **cluster**:unbounded-query(users 全表)+ hot-path-recompute
  (每行都要重算 4 個聚合子查詢,DB 端類 N+1)
- **規模觸發**:使用者數量成長(全站 `users` 表)× 三張成長表(API 日誌
  /生成歷史/資產庫)的資料量成長,兩個維度疊加。使用者數破千、且
  各表資料量夠大時,這條查詢的 DB 負載會顯著上升。
- **現在痛 / 規模大才痛**:規模大才痛,但成長曲線是「使用者數 ×
  各表資料量」雙重放大,是本次稽核中複雜度成長最快的一條。
- **建議**:補分頁(admin 後台本來就有 `allUsersPaginated` 的先例可
  沿用),且 4 個子查詢改成預先 JOIN 或用背景任務算好快取到
  `users` 相關欄位,不要在每次 admin 開頁時即時對全表重算。

---

## 嚴重度:medium

### 6. `admin.allUsers` 用未分頁的 `getAllUsers()`,即使已有分頁版本存在

- **檔案:行號**:`server/routers/admin.ts:12-14`(呼叫點),
  `server/db.ts:568-572`(`getAllUsers` 定義,硬性
  `.limit(10000)`)
- **問題**:`getAllUsers()` 有寫死 `.limit(10000)` 防止真正的 OOM,但
  這條 admin 端點本身**沒有分頁 input**,回傳一次到 10000 筆的完整
  `users` row。同檔案第 575 行已經有正確做 cursor 分頁的
  `getAllUsersPaginated`(AIDV-618 專門為了「防止使用者量大時 OOM」而
  加),但 `admin.allUsers` 端點並未改用它。
- **cluster**:unbounded-query(相對於既有的分頁版本,這條是遺留的
  舊路徑)
- **規模觸發**:使用者數趨近或超過 10000 時,舊路徑會靜默截斷
  (只回前 10000 筆按 createdAt desc)且每次都是大 payload。使用者
  數在千級以下時影響有限。
- **現在痛 / 規模大才痛**:規模大才痛。
- **建議**:前端改呼叫已存在的 `allUsersPaginated`,舊 `allUsers`
  端點可標記 deprecated 或直接移除。

### 7. `admin.teamCostSummary`:GROUP BY 掃全部 `api_usage_logs` 無時間窗

- **檔案:行號**:`server/routers/admin.ts:75-91`(呼叫點),
  `server/db.ts:2115-2130`(`getTeamCostSummary` 定義)
- **問題**:`SELECT userId, SUM(...), COUNT(*) ... FROM api_usage_logs
  GROUP BY userId`,沒有任何日期範圍條件。`api_usage_logs` 是每次 AI
  API 呼叫都會寫入的日誌表,只會越來越大,此查詢每次都要全表聚合。
  結果列數受使用者數限制(不是天文數字),但**計算成本**隨日誌表
  歷史長度線性成長。
- **cluster**:unbounded-query(全表聚合,無時間邊界)
- **規模觸發**:`api_usage_logs` 累積月數/年數增加,全表 GROUP BY
  掃描成本隨之增加(即使沒有對應索引優化,也是全表掃)。
- **現在痛 / 規模大才痛**:規模大才痛——上線初期資料量小時可接受,
  跑到一年以上的 API 呼叫歷史後會明顯變慢。
- **建議**:比照同檔案 `deepCost` / `costAttribution` 端點已經做的
  「預設當月起算 + 可選 startDate/endDate」設計,幫 `teamCostSummary`
  也加上時間窗。

### 8. `apiUsage.usageByProvider`:全表撈回再用 JS slice(0,30)

- **檔案:行號**:`server/routers/apiUsage.ts:358-382`
- **問題**:`allCosts` 查詢對 `cost_aggregations` 做 `GROUP BY
  provider, date`,雖然有 `costConditions`(provider/日期/endpoint 篩選
  皆為 optional,使用者不帶條件時就是全表),查詢本身**沒有
  `.limit()`**,撈回全部分組結果後才在 JS `costMap` 裡對每個 provider
  `.slice(0, 30)`。
- **cluster**:memory-blowup(fetch-all-then-slice)+ unbounded-query
- **規模觸發**:`cost_aggregations` 是每日聚合表(provider × endpoint ×
  日期),隨站點運行時間線性增長。跑到多年歷史後,單次查詢要撈回的
  行數會明顯變多,即使最終只顯示 30 天。
- **現在痛 / 規模大才痛**:規模大才痛(以「年」為單位的時間尺度)。
- **建議**:改成 SQL 端用視窗函數(`ROW_NUMBER() OVER (PARTITION BY
  provider ORDER BY date DESC)`)取每個 provider 最近 30 筆,或至少加
  `WHERE date >= DATE_SUB(NOW(), INTERVAL 60 DAY)` 之類的預設時間窗
  （呼叫端目前確實可傳 startDate/endDate,但沒有預設值,不傳就是全表）。

### 9. `realEarth.getLinkedMaterials`:JSON_CONTAINS 全表掃 + 無 limit 撈整列

- **檔案:行號**:`server/routers/realEarth.ts:292-298`(呼叫點),
  `server/db.ts:5192-5208`(`findTeachingMaterialsByRealEarthRef` 定義)
- **問題**:`WHERE JSON_CONTAINS(teachingMaterials.realEarthRefs, ?)`
  完全沒有 `.limit()`,且 `db.select()`(非投影版本,含 textContent
  等大欄位)。`JSON_CONTAINS` 作用在 JSON 欄位上,MySQL 無法用一般
  B-tree 索引優化,等同每次呼叫都要對整個 `teaching_materials` 表做
  full scan + JSON 逐列解析。這是使用者點開「真實地球」條目詳情時
  觸發的端點。
- **附帶同類模式**:`server/routers/news.ts:237-283`(`news.byTag`)也用
  `JSON_CONTAINS(newsArticles.tags, ...)` 做過濾條件,但**有**搭配
  cursor + `.limit(limit+1)`,只是過濾本身一樣吃不到索引——影響較小
  （行數有界),列在此處作為同一 pattern 的參考,不單獨計分。
- **cluster**:missing-index(JSON_CONTAINS 無法用索引)+ unbounded-query
  （getLinkedMaterials 無 limit)
- **規模觸發**:`teaching_materials` 是全站/團隊共享教材表,筆數增加時
  這個 JSON scan 的成本線性增加;且回傳整列(含大型 textContent)可能
  同時造成 payload 變大。
- **現在痛 / 規模大才痛**:規模大才痛。
- **建議**:`findTeachingMaterialsByRealEarthRef` 補 `.limit()` 並改投影
  只取列表需要的欄位(參考 `TEACHING_MATERIAL_SUMMARY_COLUMNS` 的既有
  慣例);長期建議另開一張 `teaching_material_real_earth_refs` 關聯表
  取代 JSON_CONTAINS,才能真正吃到索引。

### 10. `history.bookmarked`:使用者書籤生成紀錄,無 limit

- **檔案:行號**:`server/routers/history.ts:21-28`(呼叫點),
  `server/db.ts:2462-2475`(`getBookmarkedHistory` 定義)
- **問題**:`WHERE userId = ? AND isBookmarked = true` 沒有 `.limit()`,
  且此 router 端點沒有任何 input(無法分頁)。雖然是 per-user 過濾,
  但 `generation_history` 是題目明確點名的「歷史類大表」,書籤功能
  的設計就是讓使用者長期累積收藏,沒有自然的上限或清理機制。
- **cluster**:unbounded-query
- **規模觸發**:單一長期活躍使用者的書籤數(數月至數年使用後可能
  累積到數百甚至上千筆)。
- **現在痛 / 規模大才痛**:規模大才痛——單一使用者資料,對照題目
  規則本屬「風險低」類,但因為 `generation_history` 屬於會持續成長的
  核心內容表,且此功能常態使用下沒有上限,值得列為中等而非略過。
- **建議**:加 `limit`(比照 `getHistoryByUser` 預設 50)+ 前端改成
  「載入更多」或 cursor 分頁。

### 11. `models.teamModels`:全站 team_shared 微調模型池,無 limit

- **檔案:行號**:`server/routers/models.ts:20-21`(呼叫點),
  `server/db.ts:1016-1024`(`getTeamSharedModels` 定義)
- **問題**:`WHERE visibility = 'team_shared'` 沒有任何 `.limit()`,
  是全站範圍(非單一 team)的查詢——只要任何團隊把模型設為
  team_shared,所有登入使用者呼叫 `teamModels` 都會撈到全站累積的
  team_shared 模型清單。
- **cluster**:unbounded-query
- **規模觸發**:全站 fine-tuned models 中 `visibility=team_shared`
  的筆數成長(訓練模型操作相對少見且成本高,成長速度慢於一般內容,
  但仍是無上限的全站表)。
- **現在痛 / 規模大才痛**:規模大才痛,且成長速度預期慢(訓練模型
  是高成本操作),優先度低於教材/資產/回饋等表。
- **建議**:補 `.limit()`(可比照 `getTeamSharedAssetsFiltered` 的
  `limit ?? 200` 慣例)。

### 12. `apiUsage.billing`(CSV 匯出)完全無 limit

- **檔案:行號**:`server/routers/apiUsage.ts:449-487`
- **問題**:`startDate`/`endDate` 皆為 optional,若 admin 不帶任何篩選,
  `whereClause` 為 `undefined` → `SELECT ... FROM cost_aggregations`
  無 WHERE 無 LIMIT,回傳全部歷史聚合列給前端組 CSV。
- **cluster**:unbounded-query
- **規模觸發**:`cost_aggregations` 累積年數增加(同第 8 條的表)。
- **現在痛 / 規模大才痛**:規模大才痛,且屬於「匯出類」功能,設計上
  本來就傾向不分頁,可接受度較高,故列為中等而非高。
- **建議**:至少加一個安全上限(如 5000~10000 列,比照
  `auditLog.export` 的 `limit: 10_000` 慣例)並在前端提示「請縮小日期
  範圍」而非無聲吃到底。

### 13. `history.list` 的 client 端 `limit` 參數沒有 `.max()` 上限

- **檔案:行號**:`server/routers/history.ts:10-19`
- **問題**:`z.object({ limit: z.number().default(50) })`——沒有
  `.int().positive().max(...)`,client 理論上可傳任意大數字,直接
  傳進 `db.getHistoryByUser(userId, limit)` 的 `.limit(limit)`。
  對照同一產品線其他端點(`promptLibrary.list` pageSize
  `.max(50)`、`modelWishes.list` limit `.max(500)`、
  `apiUsage.usageEvents` limit `.max(100)`)都有明確上限,這條是例外。
- **cluster**:unbounded-query(input 層級缺乏上限,非資料庫本身無界)
- **規模觸發**:實際影響仍受該使用者 `generation_history` 真實筆數
  限制(user-scoped),不是全站風險,但若使用者本身歷史量很大,
  單次請求可以把全部歷史一次撈回。
- **現在痛 / 規模大才痛**:現在風險低(需負載驗證使用者真實歷史量
  是否夠大到造成延遲),但屬於容易漏掉的輸入驗證缺口,建議一併補齊。
- **建議**:`limit: z.number().int().positive().max(200).default(50)`。

---

## 附帶發現:死碼(非立即風險,但是地雷)

- **檔案:行號**:`server/db.ts:1474-1482`(`getTeamSharedAssets`)
- 全站掃描 `digital_asset_library WHERE visibility='team_shared'`,無
  limit、無 SQL 過濾下推。經 grep 確認**目前沒有任何呼叫端使用**這個
  函式(已被 AIDV-601 的 `getTeamSharedAssetsFiltered` 取代)。不計入
  上方嚴重度排序,但建議之後直接刪除這個函式,避免日後有人誤用回
  這條無界查詢的舊路徑。

---

## 已正確有界 / 已分頁 / 已有索引意識(negative results)

以下是本次稽核中特別檢查、確認**沒有問題**的模式,列出來避免重工,也
作為上方建議修法時可以直接參考的既有慣例:

| 檔案:行號 | 說明 |
|---|---|
| `server/db.ts:1298-1363`(`getDigitalAssetsByUserFilteredPaged`) 與 `1244-1291`(`getDigitalAssetsByUserFiltered`) | AIDV-581 已把 assetType/sourceStudio/search 下推到 SQL WHERE,預設 `limit ?? 200`,明確在註解中寫「避免把整張表撈進記憶體再用 JS filter」——是本次多條 finding 建議修法的參考範本。 |
| `server/db.ts:1493-1541`(`getTeamSharedAssetsFiltered`) | 同上,AIDV-601 補的「孿生加固」版本,team_shared 池的 SQL 過濾 + `limit ?? 200`。 |
| `server/db.ts:575-589`(`getAllUsersPaginated`) | AIDV-618 cursor 分頁,`Math.min(limit, 100)` 有做上限 clamp,`limit+1` 判斷 `hasNext` 的標準寫法。 |
| `server/db.ts:2921-2930` / `1930` / `3092`(`getAllGenerationHistory` / `getAllUsageLogs` / `getAllBackgroundJobs`) | Admin 全站列表皆有預設 limit(200/100/100)。 |
| `server/routers/news.ts` 全檔 | `list`/`byTag` 皆 cursor-based 分頁(`limit+1` 判斷 nextCursor),`pinned` 固定 `PINNED_LIMIT=5`,列表投影排除 `bodyMarkdown`(LOD 設計)。 |
| `server/routers/showcase.ts` 全檔 | `list`/`byModality`/`search` 皆 cursor 分頁 + `MAX_PAGE_SIZE=48`;`myItems` 固定 `.limit(50)`;`promote` 有「每日最多 5 件」的 COUNT 檢查。 |
| `server/routers/promptLibrary.ts:63-159`(`list`/`listPublic`) | 標準 LIMIT+OFFSET+COUNT 分頁,`pageSize.max(50)`。（附註:OFFSET 分頁在 `listPublic` 深頁碼時理論上會隨 offset 變大而變慢,但目前有 pageSize 上限,影響有限,未單獨列為 finding。） |
| `server/routers/webhook.ts` 全檔 | `MAX_WEBHOOKS_PER_USER=5` 從源頭限制表大小;`deliveryHistory` 固定 `.limit(50)`。 |
| `server/routers/auditLog.ts` 全檔 | `events` 分頁 `limit.max(100)`;`export` 明確放寬但仍硬上限 `limit: 10_000`(註解說明是刻意的匯出上限)。 |
| `server/routers/apiUsage.ts:499-543`(`deepCost`) | 明確寫「限制掃描量級：最多 50,000 筆事件，避免 admin dashboard 拖垮 DB」並確實 `.limit(50_000)`,回傳中還帶 `truncated` 旗標讓前端知道有沒有被截斷——本次稽核中最佳實務範例。 |
| `server/routers/apiUsage.ts:646-687`(`costAttribution`) / `apiUsage.ts:499-521`(`deepCost`) | 預設「當月迄今」時間窗,可選 startDate/endDate,GROUP BY 聚合不拉整段明細——建議套用到第 7、8、12 條 finding 的修法範本。 |
| `server/db.ts:2865-2919`(`getSystemStats`) / `5126-5162`(`getRealEarthStats`) | 皆為 `COUNT(*)` / `GROUP BY` 聚合查詢,不搬資料列,結果集大小與底層表大小無關,天生有界。 |
| `server/routers/orbConversationsRouter.ts:374-394`(`getMessages`) | cursor(`beforeAt`)+ `limit ?? 200` 的標準分頁。 |
| `server/db.ts:4292-4323`(`listTeachingMaterialLineages`/`Topics`) | `selectDistinct` 無 limit,但結果集是「distinct 分類值」,基數天生很小(不隨教材筆數成長),即使全表掃也不會有 payload 膨脹問題。 |
| `server/db.ts` 多數 user-scoped 個人資料函式(`getVaultItemsByUser`、`listStudioRecipes`、`getCalendarEventsByUser`、`getDirectorSessionsByUser`、`getVideoProjectsByUser`、`getCustomBlocksByUser`、`getFineTunedModelsByUser` 等) | 皆為單一使用者的個人專案/素材資料,依題目規則「單一使用者資料量小的表風險低」,即使沒有 `.limit()` 也不列為 finding(使用者自己建立的紀錄,成長受限於個人操作量,非全站/日誌類大表)。 |

---

## 總結

本次掃描共確認 **13 條無界查詢/缺分頁 finding**(2 條 critical、3 條
high、8 條 medium)與 1 條死碼地雷,涵蓋:
- 2 條命中 AI chat 熱路徑(`ai.ts` chat mutation、`musicSpecialistTools`
  工具),每次使用者送訊息就全量撈使用者資產表;
- 3 條全站/歷史類大表無 LIMIT(`feedback.all`、`teachingArchive.list`、
  `admin.userActivity`);
- 其餘為 admin 後台統計/匯出端點缺時間窗或缺 limit,以及 2 個
  JSON_CONTAINS 缺索引的過濾模式。

同時確認了一批「已經做對」的既有慣例(cursor 分頁、SQL 下推過濾、
時間窗預設值、匯出硬上限),可直接作為修復上述 finding 時的參考範本,
不需要重新發明分頁機制。

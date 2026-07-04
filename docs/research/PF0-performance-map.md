# PF0 — 效能/資源地圖(無界查詢/N+1/記憶體/熱路徑)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb

> 稽核方法:每條發現皆已對照原始碼逐檔讀取確認(檔案:行號皆為實讀取後標註),
> 非臆測。不確定之處已標「需負載驗證」。本輪 **refutedCount = 0** —
> 所有 14 條輸入發現讀碼後皆成立,沒有查證後推翻的項目(見文末「查證後 negative」說明其邊界)。

---

## 1. 依 cluster 分節

### 1.1 cluster: unbounded-query(無 limit/缺分頁)

#### [高] ai.chat 每則訊息全量撈使用者整個 digital_asset_library
- **檔案**:`server/routers/ai.ts:1064-1084`(呼叫點)、`server/db.ts:1227-1236`(`getDigitalAssetsByUser`)
- **現況確認**:`getDigitalAssetsByUser(userId, limit?)` 已支援可選 `limit` 參數(見 db.ts 註解 AIDV-581 系列優化),但 `ai.ts:1064` 呼叫時**未傳入 limit**,故實際撈回使用者全部資產,僅在記憶體中用 `byType` 計數、`slice(0,5)` 取前 5 筆。
- **規模觸發**:`digital_asset_library` 是生成內容核心表,單一活躍使用者數月使用後可能累積數千筆;每則 AI chat 訊息都會整表撈回只為算計數與前 5 筆。
- **cluster**:hot-path-recompute(重複計算)+ unbounded-query(查詢本身無界)
- **建議**:改呼叫 `getDigitalAssetsByUser(userId, 若干上限)` 或直接用 SQL `GROUP BY assetType COUNT(*)` 取代整表撈回再 JS 計數。
- **nowOrScale**:規模大才痛(at-scale)

#### [中] getRecentAudioAssets 呼叫無 limit 的 getDigitalAssetsByUser
- **檔案**:`server/services/spiritTools/musicSpecialistTools.ts:571-587`
- **現況確認**:`getDigitalAssetsByUser(userId)` 呼叫未傳 `limit`,回傳全部資產後才在 JS 端 `.filter(...).slice(0, cap)`;`cap` 上限雖有(≤30),但過濾前已整表撈回。
- **規模觸發**:使用者素材庫規模成長後,每次 AI 工具呼叫都要撈整表再篩選 audio/voice/music 類型。
- **nowOrScale**:規模大才痛(at-scale)

#### [中] feedback.all(admin)回傳全站回饋表,無 limit
- **檔案**:`server/routers/feedback.ts:88-90`、`server/db.ts:1852-1859`(`getAllFeedbacks`)
- **現況確認**:`getAllFeedbacks()` 為 `select().from(userFeedbackReports).orderBy(desc(createdAt))`,**完全無 `.limit()`**。
- **規模觸發**:`user_feedback_reports` 為全站累積回饋表,累積到數千筆後每次開 admin 回饋頁即整表掃描+整包回傳前端。
- **nowOrScale**:規模大才痛(at-scale)

#### [高] teachingArchive.list 未帶 scope.limit,底層無界回傳全站公開教材池
- **檔案**:`server/routers/teachingArchive.ts:159-166`、`server/db.ts:4074-4148`(`listTeachingMaterialsForUser`)
- **現況確認**:router 呼叫時只傳 `{ teamIds, only: input?.scope }`,**未帶 `limit` 欄位**;db 層邏輯為 `if (scope.limit !== undefined) return baseQuery.limit(scope.limit); return baseQuery;` — 確認在無 limit 時回傳整個無上限查詢。
- **附帶發現**:`server/subsystems/trainingTrack/trainingTrackService.ts:103-120` 的 `collectTeamTrainingImages` 同樣呼叫 `listTeachingMaterialsForUser(...)` 未傳 `limit`,先撈回團隊全部教材,再於 for 迴圈中逐筆用 `resolveLevel(...)` 判斷才收進結果 — 撈取沒有先做 SQL 端過濾/上限。
- **規模觸發**:`public_disciples` 全站公開教材池筆數成長,前端無任何分頁 UI 兜底。
- **nowOrScale**:規模大才痛(at-scale)

#### [高] admin.userActivity 全表 users × 每行 4 個相關子查詢,無 limit
- **檔案**:`server/routers/admin.ts:140-142`、`server/db.ts:2933-2953`(`getUserActivitySummary`)
- **現況確認**:對 `users` 表整表 `select` 並在每個欄位用 `COALESCE((SELECT COUNT(*)/SUM(...) FROM api_usage_logs/generation_history/digital_asset_library WHERE ...userId = users.id))` 四個相關子查詢,**整條查詢無 `.limit()`**。
- **規模觸發**:使用者數量 × (api_usage_logs / generation_history / digital_asset_library)三張持續成長表的資料量,雙重放大;使用者數破千且各表夠大時單次 admin 頁面載入的 DB 負載顯著上升。
- **nowOrScale**:規模大才痛(at-scale)

---

### 1.2 cluster: n-plus-1(迴圈內查詢/序列 I/O)

#### [中] archiveBackgroundJobMedia 無界查詢 + backgroundJobId 缺索引,迴圈內序列外部 I/O + DB UPDATE
- **檔案**:`server/services/mediaArchivalService.ts:123-140`
- **現況確認**:
  - `server/services/mediaArchivalService.ts:134` — `.where(eq(digitalAssetLibrary.backgroundJobId, jobId))`,**無 `.limit()`**。
  - `drizzle/schema.ts:340-403` — `digital_asset_library` 表的索引僅有 `dal_userId_idx`、`dal_userId_assetType_idx`、`dal_userId_createdAt_idx`、`dal_userId_category_idx`、`dal_userId_sourceStudio_idx`、`dal_archivedNull_createdAt_idx`,**確認 `backgroundJobId` 欄位(schema.ts:367)完全沒有對應索引**。
  - `mediaArchivalService.ts:140` 起 `for (const asset of assets)` 逐筆做外部下載/上傳(`persistExternalMediaUrl`)+ DB UPDATE,屬序列 I/O。
- **規模觸發**:單一 `backgroundJobId` 對應資產筆數與全表列數增長時,SELECT 因無索引而全表掃描成本上升,且迴圈內序列 I/O 隨命中筆數線性增加延遲。目前是 fire-and-forget 呼叫(見 `mediaArchivalService.ts:164-177` 附近註解「不 await 也不阻塞主流程」的呼叫模式),現在延遲不明顯。
- **nowOrScale**:規模大才痛(at-scale),**需負載驗證**實際表列數與單 job 資產筆數分佈。

#### [低] assetCleanupService 迴圈內逐筆 COUNT,fileKey 欄位無索引
- **檔案**:`server/services/assetCleanupService.ts`、`server/db.ts:1567-1586`(`countOtherDigitalAssetsByFileKey`)、`server/jobs/assetCleanupJob.ts`
- **現況確認**:
  - `countOtherDigitalAssetsByFileKey` 對 `digitalAssetLibrary.fileKey`(schema 為 `text("fileKey")`,**無索引**,同上索引清單確認)做 `eq` 過濾 COUNT,等同全表掃描。
  - `server/jobs/assetCleanupJob.ts` 確認:cron 每小時跑一次,`MAX_BATCH` 界定批量,且 `ASSET_TTL_CLEANUP_DRY_RUN` **預設 ON(演練,只統計不刪)**,`dryRun=true` 時 `assetCleanupService.ts` 內 `if (opts.dryRun) continue;` 提前跳過實際刪除動作。
- **規模觸發**:現由批量與預設 dry-run 雙重界定,現在不痛;一旦正式關閉 dry-run 且 `digital_asset_library` 成長為大表,每小時該批量次數的全表掃描(因 fileKey 無索引)會拖慢。
- **nowOrScale**:規模大才痛(at-scale),**需負載驗證**。

#### [中] tagAssets 迴圈內逐筆 UPDATE,agent 工具呼叫邊界 assetIds 無長度上限
- **檔案**:`server/services/spiritTools/notesCuratorTools.ts:675-780`、`server/services/agentToolExecutor.ts:4009-4020`
- **現況確認**:
  - `notesCuratorTools.ts:708` 起 `for (const row of existing)`,逐列於 `:726` 做 `.update(digitalAssetLibrary)...`(讀取端已用 `inArray` 批次化,但寫入須逐列因為各列標籤內容不同,無法批次 UPDATE)。
  - `agentToolExecutor.ts:4011-4016`:`const assetIds = args.assetIds as number[]; ... if (!Array.isArray(assetIds) || !Array.isArray(tags)) return fail(...)` — **僅驗證是否為陣列,未對長度做任何上限檢查**。
- **規模觸發**:隨使用者素材庫(單使用者可累積數千筆)成長,若 LLM 產生大陣列(如「幫我全部素材加標籤」)會在單一請求內觸發大量序列 UPDATE。
- **nowOrScale**:規模大才痛(at-scale),**需負載驗證** agent 實際傳入陣列長度分佈(目前單次呼叫量通常小)。

---

### 1.3 cluster: memory-blowup(大 payload/緩衝/累積)

#### [嚴重] geminiMedia.ts 圖生影下載使用者可控 URL,零位元組上限
- **檔案**:`server/services/geminiMedia.ts:420-449`
- **現況確認**:
  - `server/routers/generate.ts:365,1575` — `firstFrameUrl: z.string().nullable().optional()`,**確認無 `.url()` 也無網域白名單限制**,值最終流入 `params.imageUrl`。
  - `geminiMedia.ts:433` 有 `assertSafeExternalUrl(params.imageUrl)`(SSRF 防護,擋私網/IMDS),但這不限制檔案大小。
  - `geminiMedia.ts:435-441`:`fetch(url, { signal: AbortSignal.timeout(30_000) })` → `imgRes.arrayBuffer()` → `Buffer.from(...).toString("base64")`。**全程無 Content-Length 前置檢查,也無下載後位元組數檢查**,只靠 30 秒逾時止血。
- **規模觸發**:不需規模,單一請求即可觸發 — 使用者指向自控伺服器,在 30 秒逾時視窗內以無 Content-Length(chunked)方式回傳大量位元組,Node 端嘗試整包載入記憶體再 base64 編碼(膨脹約 1.33 倍)。
- **建議**:仿照 `internalMedia.ts` 的 `PERSIST_MAX_BYTES` 模式,加入下載中/下載後的位元組上限(串流讀取時累計計數並提前中斷,而非只靠 Content-Length header)。
- **nowOrScale**:**現在就痛(now)**— 攻擊者可直接觸發,優先修。

#### [高] internalMedia.ts persistExternalMediaUrl 的 10MB 上限僅在有 Content-Length 標頭時生效
- **檔案**:`server/services/internalMedia.ts:51-88`
- **現況確認**:
  - `:69-71` — `const rawLength = Number(resp.headers.get("content-length") ?? "0"); if (rawLength > PERSIST_MAX_BYTES) throw ...` — 若來源用 chunked transfer(無 Content-Length),`rawLength` 預設為 `0`,判斷式恆為 false,**上限形同虛設**。
  - `:74-77` — `arrayBuffer()` 之後才做 `assertSafeMediaBytes(buffer)`,但該函式檢查的是內容類型偽裝(AIDV-315 防禦),**確認並無下載後的位元組數量二次檢查**。
  - 呼叫路徑確認:`generate.ts:897,997,1098,1206` 直接呼叫;`mediaArchivalService.ts:92,238` 呼叫;`localizeResultUrls`(同檔 `:98-` 起)被 `director.ts`、`proStudio.ts`、`imageStudio.ts`、`generate.ts:2261` 等多處 webhook/結果落地路徑遞迴呼叫。
- **規模觸發**:URL 來源多為第三方 AI provider(fal.ai/Suno 等)結果,一般會回 Content-Length,故不算使用者直接可控的立即攻擊面;但只要來源主機(含遭 provider 轉址或 provider 本身異常)不回該標頭,90 秒逾時視窗內完全不受任何位元組上限保護。
- **nowOrScale**:規模大才痛(at-scale)/取決於外部服務行為,**需負載驗證**實際 provider 回應是否皆帶 Content-Length。

#### [高] orbVoiceGateway.ts 單一 WS 語音連線的 audioChunks 陣列無總位元組上限
- **檔案**:`server/ws/orbVoiceGateway.ts:16,32-47,85-123`
- **現況確認**:
  - `:47` — `const audioChunks: Buffer[] = [];` 模組內連線層級陣列。
  - `:123` — `audioChunks.push(chunk)`,每次收到 binary frame 即累加,**無總位元組數上限判斷**。
  - `:85-87` 只在偵測到語音結束事件時才 `Buffer.concat(audioChunks.splice(0))` 清空。
  - `server/_core/index.ts:1071` — `new WebSocketServer({ noServer: true, maxPayload: ORB_MAX_PAYLOAD_BYTES })` 確認**單一 frame 大小已有上限**(且 `orbVoiceGateway.test.ts:112,126` 有測試驗證超過 maxPayload 會回 error 不崩潰),此發現指的是**多個 frame 累積**的總量缺口。
  - 保護僅剩:`MAX_GLOBAL_CONNECTIONS`(預設 100,`:16`)、`maxConcurrent`(預設 3,`:32`)、`maxSessionMs`(預設 600000ms,`:33`)。
- **規模觸發**:客戶端(惡意或單純未正確發送 stop 事件)持續傳送 ≤ maxPayload 的 binary frame 但永不觸發語音結束,記憶體累積量僅受 session 逾時(10 分鐘)限制,乘上全域連線與並發上限可疊加。
- **nowOrScale**:規模大才痛(at-scale)/需多個惡意或異常連線同時發生才顯著,**需負載驗證**單連線 10 分鐘內實際可塞入的累積位元組數量級。

---

### 1.4 cluster: hot-path-recompute(熱路徑重算/同步阻塞)

#### [嚴重] orbMemory.ts 對話記憶用全站共用、永不淘汰的行程內陣列,每輪對話線性全量掃描
- **檔案**:`server/services/orbMemory.ts:36,77,96,121-135,160-195,229-278,281-312`
- **現況確認**:
  - `:36` — `const store: OrbMemory[] = [];` 為**模組層級單一陣列**,無使用者分片、無容量上限。
  - 寫入僅有 `store.push(...)`(`:77`、`:96`),讀取路徑 `getRecentOrbMemories`(`:121-135`)對 `store` 做 `.filter(isOwner).filter(expiresAt).filter(types).sort().slice()`,**每次呼叫都線性掃描整個 store**,成本正比全站累積記憶總量而非單一使用者資料量。
  - 唯一的移除路徑是顯式呼叫 `deleteOrbMemory`/依 owner 或依 type 批次刪除(`:281-312`),**確認沒有 TTL 定時清掃(sweep)機制**,`expiresAt` 僅在讀取時做過濾、不會觸發真正移除,過期記憶會一直留在陣列裡佔記憶體直到有人手動刪。
  - `buildOrbMemorySummaryForPlanner`(`:229-`)在 AI 規劃路徑上被呼叫,屬熱路徑。
- **規模觸發**:store 陣列大小 = 全站累積的光球記憶筆數,隨全站使用者數 × 每人對話輪數 × 每輪多個記錄點三重疊加成長;單次查詢成本隨全站總量增加而非個人資料量。
- **nowOrScale**:規模大才痛(at-scale),但**架構本身(單行程記憶體、無 TTL 清掃)現在就是隱患**,建議及早排入 — 一旦跨多實例部署(多 Node process/水平擴展),此記憶還會出現「A 實例寫入、B 實例讀不到」的一致性問題(需另外評估,超出效能範疇但值得記錄)。

#### [高] ai.chat 每輪無條件觸發全站無索引的 api_usage_logs GROUP BY 聚合查詢
- **檔案**:`server/routers/ai.ts:1494-1497`、`server/db.ts:3051-3086`(`getSiteWideModelUsageSnapshot`)、`drizzle/schema.ts:690-708`
- **現況確認**:
  - `ai.ts:1494` — `const siteModelUsageRows = await getSiteWideModelUsageSnapshot({ days: 14, limit: 8 });`,呼叫點上方無 feature flag / 條件判斷包裹,**確認每輪 ai.chat 都會執行**。
  - `db.ts:3059-3076` — 查詢條件為 `createdAt >= DATE_SUB(NOW(), INTERVAL days DAY) AND model IS NOT NULL AND model <> ''`,`GROUP BY model ORDER BY COUNT(*) DESC`,**完全不帶 `userId`**。
  - `schema.ts:699-707` — `api_usage_logs` 表僅有 `aul_userId_createdAt_idx (userId, createdAt)` 與 `aul_userId_provider_idx (userId, apiProvider)` 兩個索引,**皆以 userId 為前導欄位**,此查詢因不帶 userId 無法有效命中任一索引,`createdAt` 範圍過濾與 `GROUP BY model` 都需要掃描相關列。
- **規模觸發**:`api_usage_logs` 全站列數與近 14 天列數隨全站日活躍量與 AI 呼叫量持續成長。
- **nowOrScale**:規模大才痛(at-scale)。

#### [中] RAG 記憶/教材檢索每次互動都重新對 Pinecone 打一次未快取的 index host 查詢
- **檔案**:`server/services/ragMemory.ts:108-118,156,214`、`server/services/teachingArchiveRag.ts:25,101,183,231`
- **現況確認**:
  - `ragMemory.ts:109-117` — `getIndexHost()` 內容為 `fetch(${PINECONE_API_BASE}/indexes/${INDEX_NAME}, ...)`,**函式內無任何快取變數(module-level cache / memoize)**,每次呼叫都是一次真實網路往返。
  - `ragMemory.ts:156,214` 及 `teachingArchiveRag.ts:101,183,231` 皆各自呼叫一次 `getIndexHost()` — 確認生成前記憶檢索與生成後記憶寫入等路徑,每次互動都多付一次 Pinecone API 網路延遲才能拿到向量資料庫實際 host。
- **規模觸發**:與資料量無關,純屬架構缺快取 — index host 幾乎不會變動,理論上可行程啟動時快取或設定短 TTL 快取。
- **nowOrScale**:**現在就痛(now)**— 從第一天就在每個 RAG 互動路徑上多付一次不必要的網路往返延遲,與資料規模無關。

#### [高] videoStudio 生成請求的全站併發任務數檢查對 background_jobs 的 jobType+status 組合無可用索引
- **檔案**:`server/_core/trpc.ts:214-224`、`drizzle/schema.ts:286-324`
- **現況確認**:
  - `trpc.ts:215-223` — 對 `backgroundJobs` 表做 `where(and(eq(jobType,"video"), inArray(status,["queued","processing"])))` 的 `count(*)`,**確認不帶 `userId`**(註解 AIDV-327:「Global cap — 防叢集 GPU 耗盡」)。
  - `schema.ts:318-322` — `background_jobs` 表僅有 `userId_status_idx (userId, status)` 與 `userId_createdAt_idx (userId, createdAt)` 兩個索引,**無 `(jobType, status)` 組合索引**,此全站併發檢查查詢無法命中既有索引。
  - 未發現任何對 `background_jobs` 的定期歸檔/清理機制(僅資產表 digital_asset_library 有 TTL cron,任務表本身無)。
- **規模觸發**:`background_jobs` 是全站所有生成任務的歷史大表且無歸檔清理,此查詢在**每次影片生成請求**(不只 ai.chat,是所有 video studio 產生請求的必經路徑)都會執行一次,掃描成本隨全表歷史列數增長。
- **nowOrScale**:規模大才痛(at-scale),但因為在每個生成請求都會執行,一旦達到規模是**高頻**觸發。

---

## 2. 現在就痛 vs 規模大才痛 分層

### 現在就痛(now)— 與資料規模無關,現在就有感或攻擊者可直接觸發
| 發現 | 嚴重度 | 為何現在就痛 |
|---|---|---|
| geminiMedia.ts 圖生影下載無位元組上限 | 嚴重 | 使用者可控 URL(無 `.url()` 校驗、無網域白名單),單一請求即可讓 server 記憶體被大檔案佔滿,不需任何資料量累積,是攻擊面而非效能優化題 |
| ragMemory / teachingArchiveRag 每次互動重打未快取的 Pinecone index host 查詢 | 中 | 純架構缺快取,從第一天就在每個 RAG 互動路徑多付一次網路往返延遲,與資料量無關 |

### 規模大才痛(at-scale)— 需要資料/使用者/時間累積到一定量級才顯現
其餘 12 條(digital_asset_library 全撈、getRecentAudioAssets、feedback.all、teachingArchive.list、admin.userActivity、archiveBackgroundJobMedia、assetCleanupService COUNT、tagAssets 迴圈 UPDATE、internalMedia 缺 Content-Length 保護、orbVoiceGateway audioChunks 累積、orbMemory 全站陣列、ai_usage_logs GROUP BY、background_jobs 併發檢查)均屬此類 — 皆已在上方逐條標註「規模觸發條件」,且多條標記「需負載驗證」以確認實際觸發門檻(現有資料量/表列數無法直接由讀碼得知,需查詢正式站 DB 統計或壓測)。

其中 **orbMemory.ts**(單行程全站陣列、無 TTL 清掃)雖分類為 at-scale,但因為架構本身沒有任何上限機制,建議視為「持續惡化中的定時炸彈」提前處理,而不要等到真的痛了才修。

---

## 3. 給 Bruce:效能面最該先修的 3 條

依「現在就痛或攻擊者可直接觸發」優先排序:

1. **`server/services/geminiMedia.ts:420-449` 圖生影下載無位元組上限**(嚴重、now)— 這是唯一一條攻擊者不需要等資料量累積、單一請求就能觸發的記憶體風險。`firstFrameUrl` 的 zod schema 也應補上網域白名單或至少 `.url()` 格式檢查。建議照抄 `internalMedia.ts` 的 `PERSIST_MAX_BYTES` 模式,但要做成**串流中累計計數、超標即中斷**(而非只看 Content-Length 標頭),因為下一條發現證明「只看標頭」本身就有漏洞。

2. **`server/services/internalMedia.ts:51-88` persistExternalMediaUrl 的 10MB 上限可被無 Content-Length 的來源繞過**(高、at-scale 但機制性缺陷現在就存在)— 這條和第 1 條是同一類漏洞(下載階段無真正的位元組硬上限),建議一次修掉,兩處共用同一個「串流讀取 + 累計計數提前中斷」的工具函式,避免以後第三處又重犯。

3. **`server/services/orbMemory.ts:36` 全站共用、永不淘汰的行程內對話記憶陣列**(嚴重、at-scale 但無上限機制)— 目前完全沒有容量上限或 TTL 定時清掃,只能等使用者手動刪除或行程重啟才會釋放記憶體;`getRecentOrbMemories` 又是每輪對話都會呼叫的熱路徑,兩個問題疊加(無界增長 + 每次全量掃描)使其成為隨全站使用量增長最快、最難後補的一條。建議儘早加上:(a) 全域筆數上限(LRU 淘汰最舊)、(b) 定期 TTL 清掃 timer,而不是等它在 production 真的吃滿記憶體才處理。

---

## 4. 查證後 negative(有界或風險被既有機制緩解)

本輪 **refutedCount = 0** — 沒有發現被完全推翻的項目。但以下幾點在讀碼後確認**風險已被部分緩解**,記錄以避免重複列為「無防護」:

- `assetCleanupService` 的 fileKey COUNT 查詢雖無索引,但受 `MAX_BATCH`(每小時批量上限)與 `ASSET_TTL_CLEANUP_DRY_RUN` **預設 ON**(演練模式,`dryRun=true` 時提前 `continue` 不執行刪除)雙重節流,现在实际执行频率与影响远低于「无防护」的字面印象。
- `orbVoiceGateway.ts` 的 `audioChunks` 累積問題,**單一 frame 大小**已有 `ws.Server({ maxPayload: ORB_MAX_PAYLOAD_BYTES })` 保护,且有对应测试(`orbVoiceGateway.test.ts:112,126`)验证超限会回 error 不崩溃;缺口仅限于「多个 frame 累積的总量」这个更窄的面向,而非完全无防护。
- `internalMedia.ts` 的 10MB 上限在**有 Content-Length 标头**的正常情况下确实有效拦截 — 缺口仅限于 chunked-transfer / 无该标头的来源,需要负载验证实际 provider(fal.ai / Suno)是否普遍带 Content-Length 才能判断此风险的实际触发概率。

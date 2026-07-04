# PF2 — N+1 查詢
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:各 router/service 中 map/forEach/for 迴圈內含 await db.* 的路徑

## 方法

腳本掃描 `server/routers/**/*.ts` 與 `server/services/**/*.ts`(排除 `*.test.ts`),抓出所有
`for(...)` / `.map(async ...)` / `.forEach(async ...)` / `for await` 迴圈,檢查迴圈體(以大括號配平粗略界定範圍)內是否含
`await db.*` / `await getDb()` / `await storage.*` / 或呼叫命名像 `getXById` 的輔助函式。共找到 56 處「迴圈+await」,
逐一人工讀碼判定:多數是外部 API 重試/退避迴圈(fal 派工、LLM 呼叫、fetch)而非 DB N+1;真正命中「迴圈內查 DB」的整理如下。

---

## 問題(依嚴重度排序)

### 1〔HIGH〕`server/services/mediaArchivalService.ts:131-150`(`archiveBackgroundJobMedia`)— 無界查詢 + 缺索引 + 迴圈內序列 I/O
```
131  const assets = await db
132    .select()
133    .from(digitalAssetLibrary)
134    .where(eq(digitalAssetLibrary.backgroundJobId, jobId));   // 無 .limit()
...
140  for (const asset of assets) {
142    const result = await archiveAsset(asset);   // 內含外部下載 + DB UPDATE
```
- **cluster**:`n-plus-1` + `missing-index`
- **規模觸發**:`digital_asset_library` 是全站共用大表(`drizzle/schema.ts:331-405` 的索引只建在
  `userId` / `userId+assetType` / `userId+createdAt` / `userId+category` / `userId+sourceStudio` / `archivedAt IS NULL + createdAt`
  這幾個複合索引上,**`backgroundJobId` 完全沒有索引**)。此 SELECT 會對全站級大表做無索引全表掃描;若某
  `backgroundJobId` 對應多筆資產(例如批次生成、zip bundle),迴圈內每筆再序列做 `persistExternalMediaUrl`(外部下載/上傳)+ DB UPDATE。
- **現在 or 規模大才痛**:規模大才痛。呼叫路徑是 `enqueueMediaArchivalTask`(fire-and-forget,由 `doPostGenComplete` 觸發,見同檔
  170-195 行),目前應是每個 job 對應少量資產,單筆延遲不明顯;但隨 `digital_asset_library` 總列數成長(全站,非單一使用者)
  掃描成本會線性 / 因缺索引而更差。**需負載驗證**(需要知道目前表列數與單一 backgroundJobId 平均對應筆數)。
- **建議**:1) 幫 `backgroundJobId` 加索引;2) 加 `.limit()` 防禦性上限(即使正常情況筆數應該很小);
  3) 若同一 job 常有多筆資產,可考慮把 I/O 改成有界並發(仿 `director.ts` 已用的 CONCURRENCY worker pool,見下方負向結果)。

### 2〔MEDIUM〕`server/services/assetCleanupService.ts:75-96` + `server/db.ts:1567-1584`(`countOtherDigitalAssetsByFileKey`)— 迴圈內逐筆 COUNT,欄位缺索引
```
75   for (const row of expired) {
76     ...
80       const others = await deps.countOthersByFileKey(row.fileKey, row.id);
```
```
// server/db.ts:1574-1582
const rows = await db.select({ count: sql`COUNT(*)` })
  .from(digitalAssetLibrary)
  .where(and(eq(digitalAssetLibrary.fileKey, fileKey), ne(digitalAssetLibrary.id, excludeId)));
```
- **cluster**:`n-plus-1` + `missing-index`
- **規模觸發**:`fileKey` 是 `text` 型別欄位(`drizzle/schema.ts:347`),且沒有任何索引 —— 每次呼叫都是全表掃描,
  跑在全站共用的 `digital_asset_library` 上。迴圈由 `server/jobs/assetCleanupJob.ts:28` 的 `MAX_BATCH = 50` 界定,
  每小時觸發一次(`SWEEP_SCHEDULE`)。
- **現在 or 規模大才痛**:現在不痛 —— 該 cron 預設整個關閉(`ENABLE_ASSET_TTL_CLEANUP` 未設定即 OFF,
  `assetCleanupJob.ts:38-41`),且即使開了預設仍是演練模式(`ASSET_TTL_CLEANUP_DRY_RUN` 預設 ON,不會真的觸發刪除路徑)。
  一旦正式開啟真刪且 `digital_asset_library` 成長到大表,每小時 50 次全表掃描 COUNT 會變成明顯負擔。**需負載驗證**。
- **建議**:1) 幫 `fileKey` 建索引(TEXT 欄位需指定 prefix length,或改存一份 hash 欄位建索引);
  2) 可將迴圈內逐筆 COUNT 改成單一 `GROUP BY fileKey HAVING COUNT(*) > 1 WHERE fileKey IN (本批次所有 fileKey)`,一次查完。

### 3〔MEDIUM〕`server/services/spiritTools/notesCuratorTools.ts:675-736`(`tagAssets`)+ `server/services/agentToolExecutor.ts:4010-4022` — 迴圈內逐筆 UPDATE,呼叫邊界無長度上限
```
694  const existing = await db.select(...).where(and(eq(userId,...), inArray(id, input.assetIds))); // 批次讀,正確
708  for (const row of existing) {
     ...
725    await db.update(digitalAssetLibrary).set({ tags: next, ... }).where(and(eq(id, row.id), eq(userId,...)));
```
```
// agentToolExecutor.ts:4011-4016 — 呼叫邊界只驗證型別,沒有長度上限
4011  const assetIds = args.assetIds as number[];
4014  if (!Array.isArray(assetIds) || !Array.isArray(tags)) { return fail(...); }
```
- **cluster**:`n-plus-1`
- **規模觸發**:讀取已正確批次(`inArray`),但寫入必須逐列(每列新標籤內容不同,無法簡單合併成一條 SQL)。
  `assetIds` 來自 AI agent 的工具呼叫參數(LLM 產生的 JSON),**在 `agentToolExecutor.ts` 進入點沒有任何長度上限**
  (對照同代碼庫其他人類直接呼叫的路由都有 `.max(...)`,如 `export.ts:42` 的 `.max(50)`、`workflow.ts:23` 的 `.max(20)`)。
  隨使用者素材庫(`digital_asset_library`,單一使用者可自然累積到數千筆)成長,若 agent 決定「幫我全部素材加標籤」,
  會觸發一次請求內數千次序列 UPDATE 往返。
- **現在 or 規模大才痛**:現在不痛(典型單次工具呼叫只會帶少量 asset id);規模大才痛,取決於單一使用者素材庫大小與
  agent 實際傳入陣列長度。**需負載驗證**(需要實測 agent 是否真的會產生大陣列,以及使用者素材庫的實際分佈)。
- **建議**:在 `agentToolExecutor.ts` 對 `assetIds` 加合理長度上限(比照其他路由的 `.max()` 慣例),超過則分批或拒絕。

### 4〔LOW〕`server/services/orbFeatureDiscovery.ts:437-507`(`generateRecommendations`)— 迴圈內逐筆 INSERT,但有硬上限
```
483  for (const rec of computed) {
     ...
494    const res = await db.insert(orbFeatureRecommendations).values(insertData);
```
- **cluster**:`n-plus-1`
- **規模觸發**:`computed` 長度受 `limit` 參數硬性裁切(`computeFeatureRecommendations` 內 `.slice(0, limit)`,
  函式簽章 `limit = 5`,程式庫內最大呼叫值為 20)。逐筆寫入是為了取回各列真實 auto-increment id(mysql2 批次 insert
  不易單次拿回多筆 insertId),屬合理設計取捨而非疏漏。
- **現在 or 規模大才痛**:現在不痛,且未來也不會痛 —— 迴圈次數恆定被 `limit` 上限鎖死,與資料表大小無關。
- **建議**:無需修改;若真的在意這 ≤20 次往返的延遲,可改用批次 insert 後以 `WHERE userId=? AND presentedAt=?` 反查 id,
  但目前非優先項。

### 5〔LOW〕`server/services/orbWorkflowEngine.ts:432-499`(工作流步驟執行迴圈)— 迴圈內每步重查狀態
```
432  for (let i = execution.currentStepIndex; i < steps.length; i++) {
436    const [currentExecution] = await db.select()...limit(1);   // 每步都重查一次執行狀態(供暫停/取消判斷)
461/487  await db.insert(orbWorkflowStepExecutions).values({...}); // 每步落一筆審計紀錄(本就該逐筆,語意正確)
```
- **cluster**:`hot-path-recompute`(重複重查同一列)多於典型 N+1 讀放大;寫入部分是每步都需要獨立審計列,語意正確非疏漏。
- **規模觸發**:`steps.length` 被 `server/routers/workflow.ts:23` 的 `z.array(workflowStepSchema).max(20)` 硬性限制在 ≤20。
  查詢皆以 PK(`executionId`)命中單列,不隨全站資料量放大。
- **現在 or 規模大才痛**:現在不痛(≤20 次額外 SELECT,單列 PK 查詢,延遲可忽略)。規模觸發僅在未來若放寬 20 步上限,
  或工作流併發執行量極高時才需要重新評估 —— **需負載驗證**。
- **建議**:非優先;若要優化,可把「暫停/取消」旗標改用記憶體事件通知取代逐步輪詢式重查。

### 6〔LOW〕`server/services/orbConversationEnhancer.ts:176-232`(`extractAndStoreMemories`)與 `:247-270`(`trackFeatureUsage`)
```
176  for (const pattern of userFactPatterns) { ... await orbLongTermMemory.create({...}); }   // 固定 3 個 pattern
198  for (const pattern of preferencePatterns) { ... await orbLongTermMemory.create({...}); }  // 固定 2 個 pattern
251  for (const tool of turn.toolsUsed) { await orbFeatureDiscovery.recordUsage(...); await orbSystemMonitor.recordCost(...); }
```
- **cluster**:`n-plus-1`(寫入),但均為背景路徑
- **規模觸發**:前兩個迴圈是固定長度(2-3 個 regex pattern),與資料量無關。第三個迴圈受 `turn.toolsUsed` 長度影響
  ——但目前唯一呼叫點(`server/routers/orbConversationsRouter.ts:504-511`)呼叫 `processConversationTurn` 時**沒有帶
  `toolsUsed` 欄位**(只傳 `userInput`/`orbResponse`),所以 `trackFeatureUsage` 迴圈實務上不會執行(死路徑)。
  且整條呼叫是 fire-and-forget(`.catch()` 不 await 阻塞使用者回應,見 orbConversationsRouter.ts:499-511 註解)。
- **現在 or 規模大才痛**:現在不痛(不阻塞使用者;實際迴圈次數 ≤3 或根本不執行)。**需負載驗證**才能確認未來若接上
  `toolsUsed` 是否會需要批次寫入。
- **建議**:非優先;若未來啟用 `toolsUsed` 傳遞,建議評估是否可批次寫入 usage/cost 記錄。

### 7〔LOW〕`server/services/cost/costAttribution.ts:236-254`(`postAttributedCost`)與 `:349-410`(`drainAttributionOutbox`)
```
249  for (const entry of entries) { const r = await postTransaction(db, entry); ... }
381  for (const r of rows) { const res = await postAttributedCost(db, r.payloadJson, rate); ... await db.update(...); }
```
- **cluster**:`n-plus-1`(背景 drain job,寫入)
- **規模觸發**:`entries`(單筆 usage 事件展開的多維歸屬,通常個位數)與 `rows`(`drainAttributionOutbox` 明確以
  `OUTBOX_DRAIN_BATCH = 100` 分頁,`costAttribution.ts:332`)皆有界。每筆需要獨立冪等鍵判定與 ledger 寫入,無法簡單合併成單一 SQL。
- **現在 or 規模大才痛**:現在不痛 —— 批量已被 `OUTBOX_DRAIN_BATCH=100` 硬性限制,drain 頻率與批量都是可控的背景任務。
- **建議**:無需修改;已是合理的有界批次設計。

### 8〔LOW / 幾乎無風險〕`server/services/skillRegistryService.ts:71-104`(`seedOfficialSkills`)
```
74  for (const [, manifest] of OFFICIAL_SKILLS) {
76    await db.insert(skillRegistry).values({...}).onDuplicateKeyUpdate({...});
```
- **cluster**:`n-plus-1`(寫入)
- **規模觸發**:`OFFICIAL_SKILLS` 是編譯期常數 Map,只在伺服器啟動 / migration 時執行一次,非使用者觸發的請求路徑。
- **現在 or 規模大才痛**:現在不痛,規模也不會變大(內建技能清單成長速度極慢,且是一次性操作)。
- **建議**:無需修改。

---

## 已正確處理的負向結果(negative results)

以下路徑原本或潛在有 N+1 風險,但目前碼是正確的批次 / 有界設計,列出以便日後 code review 對照,避免誤判或重複修:

- **`server/routers/export.ts:41-55`(`getJobUrls`)** — 明確標註 `AIDV-651`:先用 `db.getBackgroundJobsByIds(input.jobIds)`
  批次查詢一次,建 `Map` 後迴圈只做記憶體查表(`jobMap.get(jobId)`),迴圈內完全不再打 DB。輸入 `.max(50)` 有界。
- **`server/routers/assets.ts:122-161`(團隊共享素材列表)** — 明確標註 `AIDV-601` / `AIDV-651`:把 `assetType` /
  `sourceStudio` / `search` 篩選下推到 SQL(取代全量載入再 JS filter),並用 `listTeamIdsForUser`(1 次)+
  `getSharesForUserOnManyResources`(對整批 asset id 一次查完)取代逐筆查詢,迴圈內只呼叫純函式 `canAccess` 判定,無額外 DB 往返。
- **`server/routers/director.ts:1989-2014`(里程碑筆記批次寫入)** — 程式內註解明確說明「取代逐筆序列 await 的
  N+1」,改用 `CONCURRENCY = 5` 的有界並發 worker pool 寫入,兼顧吞吐量與 DB 連線池上限。
- **`server/routers/apiUsage.ts:334-394`(成本/用量儀表板)** — 單一 `GROUP BY provider, date` 查詢一次撈完,
  之後用 `Map` 在 JS 記憶體中依 provider 分組(註解明確寫「2 query...slice per provider in JS」),迴圈內不查 DB。
- **`server/routers/notes.ts:96-145`(筆記摘要)** — 單次 `getProjectNotesByUser(ctx.user.id, 500)` 撈取後,
  overdue/today/upcoming 分桶皆在記憶體中用 `for`/`.filter` 完成,迴圈內無 DB 呼叫。
- **`server/services/refundStatus.ts:148-174`(`getJobRefundStatuses`)** — 單一批次呼叫
  `db.getBackgroundJobsRefundMeta(userId, ids)`;`for` 迴圈只用來預填記憶體 `Map` 佔位值,並非查 DB。
- **`server/services/mediaArchivalService.ts:271-325`(`runMediaArchival`,對照上方問題 1 的
  `archiveBackgroundJobMedia`)** — 這支 cron 入口函式的兩個掃描查詢都正確加了 `.limit(batchSize)`(預設 20),
  是有界背景批次任務的良好示範。
- **`server/routers/agentModelPicksRouter.ts:112-134`(`getPreferredByModalities`)** — 對每個 modality 的查詢改用
  `Promise.all` 平行呼叫(非序列),且輸入 `.max(8)` 有界,程式註解說明是刻意取代 4 支獨立序列查詢的批次設計。

## 範圍外但相關的觀察

- `server/routers/models.ts:520`(`captionImages`,迴圈上限 `.max(30)`)與 `:625`(`autofillAngles`,迴圈上限
  `.max(5)`)迴圈內是序列呼叫外部 LLM / 圖像生成 API(非 DB 查詢),嚴格不算本次「迴圈內 await db.*」範圍,
  但值得留意:`captionImages` 最多 30 張圖片序列呼叫 LLM,屬 `hot-path-recompute` 型延遲風險(使用者請求路徑上
  可能累積數十秒),若需要可另立議題評估併發化。

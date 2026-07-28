# PF4 — 熱路徑重算/同步阻塞/缺索引
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核範圍:每請求都跑的中介層/上下文組裝、光球 prompt 組裝、RAG 檢索、同步 CPU 工作、常用 WHERE/ORDER 欄位

## 方法

通篇讀 `server/middleware/*`、`server/_core/trpc.ts`(procedure middleware)、光球對話主流程
`server/routers/ai.ts` 的 `chat` mutation 組 prompt context 的每一步、RAG 相關的
`server/services/ragMemory.ts` / `teachingArchiveRag.ts` / `teachingArchiveSearch.ts`、記憶相關的
`server/services/orbMemory.ts` / `orbLongTermMemory.ts` / `spiritMemoryManager.ts` / `orbContextLookup.ts` /
`orbUnifiedSearch.ts`,並對照 `drizzle/schema.ts` 逐一核對本次掃到的 WHERE / ORDER BY 欄位是否有對應索引。
所有結論皆基於實際讀碼與 schema 比對；無法從靜態碼確認的效能數字一律標「需負載驗證」。W6
（`docs/research/W6-siteknowledge-deepdive.md`）已對 `siteKnowledge.ts` 做過逐行深挖，本文對其中仍然
成立、且落在本次「熱路徑/RAG/prompt 組裝」範圍內的結論做交叉引用而非重覆分析，聚焦本次新掘出的問題。

---

## 嚴重度:critical

### 1. `orbMemory.ts` 的對話記憶是「全站永不清空的行程內陣列」，每次光球回合都對全量做線性掃描

- **檔案:行號**:宣告於 `server/services/orbMemory.ts:36`（`const store: OrbMemory[] = [];`）；
  寫入 `recordOrbMemory`（`orbMemory.ts:55-119`，`store.push(...)`）；讀取 `getRecentOrbMemories`
  （`orbMemory.ts:121-135`，`store.filter(...).filter(...).filter(...).sort(...).slice(...)`）；經由
  `searchOrbMemories`（`orbMemory.ts:137-158`）→ `searchOrbMemoriesWithRag`（`orbMemory.ts:160-195`）→
  `buildOrbMemorySummaryForPlanner`（`orbMemory.ts:229-278`）串到主熱路徑呼叫點
  `server/routers/ai.ts:1024`（`ai.chat` mutation，每次使用者送出訊息都會執行一次）。
- **問題**:`store` 是一個**跨所有使用者、跨整個行程壽命**的單一全域陣列（`server/services/memory/MEMORY_TIERS.md`
  §Tier B 明文記載「儲存：in-RAM 陣列」「生命週期：程序壽命內；重啟即清空」，但文件**沒有任何大小上限或
  淘汰策略的描述**）。程式碼中確認：
  1. 只有明確的「依 memoryId 刪」（`deleteOrbMemory`，`:280-284`）、「依 owner 清」
     （`clearOrbMemoryForUser`，`:287-293`）、「依 type 清」與「測試用全清」（`__unsafe_clearAllOrbMemoryForTests`，
     `:357-358`）四種刪除路徑，**沒有背景排程 / TTL 自動淘汰**（`getRecentOrbMemories` 的
     `!memory.expiresAt || memory.expiresAt > now` 只是「讀取時跳過已過期項」，過期的記憶本身仍然留在
     陣列裡，永久佔用記憶體，直到程序重啟）。
  2. 全站每一次 `recordOrbMemory` 呼叫（呼叫點涵蓋 `routers/ai.ts`、`orbTaskOrchestrator.ts`、
     `orbTaskStateMachine.ts`、`orbCodeTask.ts`、`orbTaskReplanIntegration.ts`、`orbProxyRouter.ts` 共 6 處，
     即光球每次任務狀態轉換、程式任務、重規劃、代理 proxy 呼叫都會各自 push 一筆）都是無條件 `store.push`，
     陣列只會單調成長。
  3. **讀取端更嚴重**：`getRecentOrbMemories` 每次呼叫都是對**全站累積的整個陣列**做
     `.filter(isOwner).filter(expiry).filter(type).sort(...).slice(...)`——即使只想找「這個使用者」的記憶，
     也要先掃過全站所有其他使用者累積的所有記憶才能篩出屬於他的那幾筆。此函式在
     `buildOrbMemorySummaryForPlanner` 內被呼叫（經 `searchOrbMemoriesWithRag` → `searchOrbMemories`），
     而 `buildOrbMemorySummaryForPlanner` 是 `ai.chat`（光球主對話 mutation）**每一輪都會執行**的呼叫。
- **cluster**:memory-blowup(`store` 陣列無上限成長)+ hot-path-recompute(`getRecentOrbMemories` 對全站
  累積量做 O(n) 線性掃描,且是每輪對話都跑)
- **規模觸發**:`store` 陣列大小 = 全站累積的「光球觀察到的瑣事」筆數（偏好/觀察/安全事件/任務狀態轉換等），
  隨**全站使用者數 × 每人對話輪數 × 每輪可能觸發的多個記錄點**三重疊加成長，是本次稽核中成長最快的
  記憶體結構。`getRecentOrbMemories` 的單次呼叫成本正比於這個累積總量,而不是單一使用者的資料量——這點與
  一般「單一使用者資料表」不同，即使某位使用者自己只送過 5 則訊息，只要**全站**其他使用者已經累積了
  數萬筆記憶，他的每一次對話請求一樣要線性掃過全部數萬筆。
- **現在痛 / 規模大才痛**:規模大才痛——開發/小流量階段陣列小、掃描幾乎無感；但這是「無上限成長 + 全站共用 +
  每輪對話都線性掃」三個條件同時成立的組合，一旦站點有實質日活躍量且程序長時間不重啟（Railway 部署下重啟
  頻率本就不固定），會同時造成（a）Node heap 隨時間單調成長（重啟前無法回收）、（b）之後每一次光球對話的
  記憶檢索延遲隨全站累積記憶數線性變慢。**需負載驗證**（需要實際量測單筆 `OrbMemory` 物件的記憶體佔用與
  全站尖峰活躍時的每日新增筆數，推算多久會觸及有感的延遲/記憶體門檻）。
- **建議**:1) 給 `store` 加行程內硬上限（例如保留最近 N 萬筆，超過時淘汰最舊的，仿 `orbContextLookup.ts`
  的 `CACHE_MAX_ENTRIES` 硬上限模式）；2) 更根本的修法是把 `getRecentOrbMemories` 改成先用 `Map<ownerKey,
  OrbMemory[]>` 依使用者/匿名 session 分桶存放，讀取時直接 `map.get(ownerKey)` 拿到那個使用者自己的子陣列，
  避免每次都要線性掃過全站；3) 加一個背景 `setInterval` 週期性清掉已過期（`expiresAt <= now`）的項目，而非
  只在讀取時跳過。

---

## 嚴重度:high

### 2. `ai.chat` 每一輪都無條件觸發一次全站無索引的 `api_usage_logs` GROUP BY 聚合查詢

- **檔案:行號**:呼叫點 `server/routers/ai.ts:1494-1497`（`getSiteWideModelUsageRows =
  await getSiteWideModelUsageSnapshot({ days: 14, limit: 8 })`，位於 `ai.chat` mutation 主流程的直線程式碼
  段落，前後沒有任何 `if` 包裹或 feature flag 判斷——只要走到這一行就一定執行），結果在
  `ai.ts:1498-1507` 組成 `siteModelUsagePromptBlock`，並在 `ai.ts:2004` 無條件併入
  `plannerContextWithResearch`（只要有任何近 14 天的 `api_usage_logs` 資料，此區塊必為真值）；底層定義
  `server/db.ts:3051-3086`（`getSiteWideModelUsageSnapshot`）。
- **問題**:此函式對 `api_usage_logs` 做
  `WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 14 DAY) AND model IS NOT NULL AND TRIM(model) <> ''
  GROUP BY model ORDER BY COUNT(*) DESC LIMIT 8`——**沒有 `userId` 篩選條件**，是全站範圍的彙總。比對
  `drizzle/schema.ts:700-708`，`api_usage_logs` 僅有兩個索引：`aul_userId_createdAt_idx (userId,
  createdAt)` 與 `aul_userId_provider_idx (userId, apiProvider)`，**兩者的 leading column 都是
  `userId`**。因為這條查詢完全不帶 `userId` 條件，MySQL 無法利用任一索引來滿足 `createdAt` 範圍過濾，也沒有
  任何索引覆蓋 `model` 欄位供 GROUP BY 使用——等同每次呼叫都要對 `api_usage_logs`
  **全表**做 full scan，再在 DB 端排序分組。而 `api_usage_logs` 正是題目定義的典型「日誌類大表」：每一次
  AI API 呼叫（生圖/生影片/生語音/光球 LLM 呼叫本身）都會寫入一筆，只會持續成長不會清理。
- **cluster**:missing-index(`createdAt`/`model` 皆無可用索引)+ hot-path-recompute(全站聚合結果沒有
  任何快取，每一輪光球對話都重新算一次一模一樣的「近 14 天熱門模型」統計，即使兩次呼叫間隔只有幾秒)
- **規模觸發**:`api_usage_logs` 總列數（全站、隨時間單調成長,無清理機制）與「近 14 天」時間窗內的列數
  （隨全站日活躍量成長）。使用者發送訊息的頻率本身就是熱路徑中最高頻的動作之一，這條查詢的呼叫頻率因此
  等同於「全站訊息量」。
- **現在痛 / 規模大才痛**:規模大才痛，但成長曲線比本次稽核中大多數 finding 更陡——它同時吃「呼叫頻率
  隨全站訊息量成長」與「單次查詢成本隨全站日誌累積量成長」兩個維度，且**沒有 userId 縮小掃描範圍**，是
  本次唯一一條完全不受「單一使用者資料量小」保護傘覆蓋的全站聚合查詢卻掛在最高頻端點上的案例。
  **需負載驗證**確認目前 `api_usage_logs` 實際列數與此查詢的真實耗時。
- **建議**:1) 幫 `api_usage_logs` 補一個不含 `userId` 的獨立索引，至少 `(createdAt, model)` 或
  `(model, createdAt)` 讓這類全站彙總可以用索引範圍掃描；2) 更根本的修法是把「近 14 天熱門模型」這種
  全站性、跟當前使用者訊息內容無關的統計改成背景排程（例如每 10-15 分鐘算一次）寫入小表或記憶體快取，
  `ai.chat` 直接讀快取而非每輪即時算 SQL；3) 重新評估這個區塊對光球回覆品質的實際貢獻——若只是「順便讓
  LLM 知道全站流行模型」的錦上添花資訊，效益可能不值得每輪一次全表掃描的代價。

### 3. RAG 記憶／教材檢索每次呼叫都重新對 Pinecone 控制平面發一次「查 index host」的網路往返，未做任何快取

- **檔案:行號**:`server/services/ragMemory.ts:109-117`（`getIndexHost()`，內部 `fetch(
  ${PINECONE_API_BASE}/indexes/${INDEX_NAME})`，每次呼叫都是一次全新的 HTTPS round-trip 到 Pinecone
  control-plane API，函式與呼叫檔內都沒有任何快取變數）；呼叫點共 5 處：`ragMemory.ts:156`
  （`upsertMemory`，每次生成完成後寫入記憶都觸發）、`ragMemory.ts:214`（`queryMemories`，每次生成前
  檢索記憶都觸發，經 `queryRagMemory`/`buildMemoryContext` 被光球 prompt 組裝與
  `searchOrbMemoriesWithRag` 使用）、`server/services/teachingArchiveRag.ts:101,183,231`（教材向量的
  upsert / query / delete，同一支未快取的 `getIndexHost`）。
- **問題**:Pinecone 的 index host 網域在同一個 index 存續期間幾乎不會變動（只有 index 被刪除重建才會變），
  但目前寫法是**每一次**要跟 Pinecone 互動（無論是寫入新記憶、查詢記憶、教材檢索、教材刪除）都先花一次
  額外的網路往返去問「這個 index 的 host 是什麼」，再用查到的 host 去打真正要做的操作——等於把原本
  「1 次 API 呼叫」變成「2 次序列 API 呼叫」，且第 1 次(`getIndexHost`)的結果**完全可快取**卻沒有快取。
  這個函式被兩個檔案共用（`ragMemory.ts` re-export 給 `teachingArchiveRag.ts`，見 `ragMemory.ts:119-120`
  的註解「省一次 round-trip」——但實際上這句註解描述的是「兩個檔案共用同一份程式碼」，並不是「有快取」，
  兩者呼叫時仍各自重新打一次網路請求）。
- **cluster**:hot-path-recompute（靜態/低變動的外部資源設定，被同步阻塞地在每個請求路徑上重新解析）
- **規模觸發**:與此無關資料量大小——即使全站只有 1 個使用者，只要他持續互動，每次生成完成
  （`upsertMemory`）與每次生成前（`queryMemories`）都各多付一次網路延遲；教材搜尋
  （`teachingArchiveSearch.ts` 的向量路徑，見 finding 之外的交叉檢查）同樣每次先查 host 再查資料。
- **現在痛 / 規模大才痛**:**現在就有感**——這不是「資料長大才痛」的類型，而是「架構設計沒做快取，從第一
  天就在每個 RAG 互動路徑上多付一次網路往返延遲」，且 `queryMemories`/`buildMemoryContext` 又是光球
  組 prompt 的一環（生成前的記憶注入），這個延遲會直接疊加進使用者可感知的「送出後多久看到回覆」時間。
  精確秒數**需負載驗證**（取決於 Pinecone control-plane API 的實際延遲，一般同區域約數十~數百 ms）。
- **建議**:在 `ragMemory.ts` 為 `getIndexHost()` 的回傳值加一個 module-level 變數快取（index host 幾乎
  不會變，甚至可以直接快取到下次程序重啟；若要保守一點可加數小時 TTL 保險），失敗時清快取重試即可，
  比照同檔案 `healthCache` / `orbContextLookup.ts` 已有的 TTL 快取模式。

### 4. `videoStudio` 生成請求的「全站併發任務數」檢查對 `background_jobs` 的 `jobType + status` 組合查無可用索引

- **檔案:行號**:`server/_core/trpc.ts:190-233`（`requireVideoStudioLimit` middleware，掛在
  `videoGenerationProcedure` 上，每一次影片生成 mutation 呼叫都會執行兩段查詢）。第一段
  （`:196-212`，`eq(userId) AND eq(jobType,'video') AND status IN (...)`）可用
  `userId_status_idx (userId, status)` 索引取 `userId` 前綴縮小範圍，屬合理設計，**不計入本 finding**；
  第二段（`:215-223`，`eq(jobType,'video') AND status IN ('queued','processing')`，**完全不帶
  `userId`**，是「全站目前排隊+執行中的影片任務數」檢查）才是問題所在。比對
  `drizzle/schema.ts:318-324`，`background_jobs` 只有 `userId_status_idx (userId, status)` 與
  `userId_createdAt_idx (userId, createdAt)` 兩個索引，**leading column 都是 `userId`**，對這條不帶
  `userId` 的全站查詢完全無法命中，MySQL 只能對整張 `background_jobs` 表（所有 `jobType` × 所有歷史
  `status`，包含早已 `completed`/`failed`/`cancelled` 的歷史列）做全表掃描才能過濾出符合
  `jobType='video' AND status IN (queued, processing)` 的列。
- **cluster**:missing-index(`jobType`/`status` 組合無 leading-column 匹配的索引)+
  hot-path-recompute(每次影片生成請求都重新全表掃一次，沒有任何快取或近似計數機制)
- **規模觸發**:`background_jobs` 是全站所有生成任務（圖片/影片/音訊/語音/zip 匯出/模型訓練/教材匯入）
  的歷史紀錄表，是題目明確點名的「歷史類大表」，只會隨站點使用時間持續累積（沒有看到歸檔/清理機制）。
  即使當下「排隊中/執行中」的列數很少，掃描成本仍然正比於**全表歷史列數**而非真正符合條件的列數。
- **現在痛 / 規模大才痛**:規模大才痛——上線初期 `background_jobs` 歷史列數少，全表掃描感覺不到；但這是
  每一次使用者按下「生成影片」都會觸發的檢查（`videoGenerationProcedure` 是 videoStudio 全部生成 mutation
  的共用 base procedure），隨全站歷史任務數（跨所有使用者、所有模態）累積到中大型規模後，此檢查會拖慢
  每一次影片生成請求的起手延遲。**需負載驗證**確認目前 `background_jobs` 實際列數與此查詢真實耗時。
- **建議**:1) 加一個不含 `userId` 的複合索引 `(jobType, status)`（或 `(status, jobType)`，視 status 基數
  分布而定）讓這條全站計數查詢可以索引範圍掃描；2) 或者更根本地，把「全站目前排隊+執行中」數量改成
  應用層維護的計數器（每次 enqueue/complete 時 `INCR`/`DECR`，仿 `checkTrpcRateLimit` 的 in-memory
  window 模式），避免每次生成請求都要重新對 DB 全表計數。

---

## 嚴重度:medium

### 5. `siteKnowledge.ts` 的光球系統提示詞每輪對話都重組約 50KB 靜態文字（交叉引用 W6，已於此波確認仍然成立）

- **檔案:行號**:`server/services/siteKnowledge.ts:1661-1744`（`buildOrbSystemPrompt`），實際拼接處在
  `siteKnowledge.ts:2057-2063` 與 `:2151-2157`（`${SITE_PAGES_KNOWLEDGE}` + `${GENERATION_MODALITIES_KNOWLEDGE}`
  + `${MODEL_RECOMMENDATION_KNOWLEDGE}` + `${WORKFLOW_KNOWLEDGE}`，四塊常數字串各自定義於
  `siteKnowledge.ts:179`/`325`/`468`/`577`）。
- **問題**:延續 `docs/research/W6-siteknowledge-deepdive.md` 的結論（本波重讀程式碼確認在目前 commit
  仍然成立）：這四塊常數合計約 50KB 純文字，內容完全靜態（不含使用者個人化資料），但 `buildOrbSystemPrompt`
  每次被呼叫（即每一輪光球對話）都會用樣板字串**逐字重新組裝**成一份新字串送進 LLM 呼叫，全站程式碼庫內
  搜尋不到任何 provider 端 `cache_control` / prompt-caching 相關設定，代表這塊高重複率的靜態內容目前
  沒有使用 Anthropic/OpenAI 等家的 prompt caching 機制。
- **cluster**:hot-path-recompute（CPU 重組字串成本很低，真正的成本在「重複的靜態 token 每輪都全額送給
  LLM 計費+佔用 context window」）
- **現在痛 / 規模大才痛**:現在就有一定成本（token 計費，非資料庫查詢延遲），但不隨資料量成長而惡化，
  屬於「架構效率」而非「規模觸發」型問題，維持 W6 的評級不重新拉高。
- **建議**:同 W6：評估導入 provider 端 prompt caching（把這 50KB 靜態區塊標記為可快取片段），可望顯著
  降低每輪對話的 token 成本，且不影響功能正確性。

### 6. `learnHubOrbIndexCache` 快取新鮮度失效問題持續影響 `orbUnifiedSearch` 的教學搜尋（交叉引用 W6）

- **檔案:行號**:`siteKnowledge.ts:81-115`（`learnHubOrbIndexCache`，一個 `Map<limit, result>` 的**永久**
  快取，沒有失效機制），呼叫端 `server/services/orbUnifiedSearch.ts:368`（`searchTutorials` 每次呼叫
  `getLearnHubOrbIndex(60)`，註解自承「每次搜尋按鍵都呼叫」）。
- **問題**:延續 W6 的結論——本波確認同一份快取仍被 `siteKnowledge.ts:123`（餵給光球系統提示詞）與
  `orbUnifiedSearch.ts:368`（統一搜尋的教學文件來源）共用，快取鍵只有 `limit`（30/60 兩種），沒有版本戳，
  一旦 `learnHub.ts` 的教材被更新/刪除，這份快取要等到程序重啟才會反映最新內容。
- **cluster**:hot-path-recompute 的相反面（該快取本意是省重算，但因為「永不失效」造成資料新鮮度問題，
  與 memory-blowup 無關——`Map` 只有 2 個 entry，體積不是重點，重點是「錯誤的結果被快取到重啟」）。
- **現在痛 / 規模大才痛**:現在就可能痛（不是規模問題，是正確性問題）——教材一旦更新，光球的搜尋結果與
  系統提示詞裡的教材索引可能長時間顯示舊資料，直到下次部署重啟。
- **建議**:同 W6：比照 `orbContextLookup.ts` 或 `orbUnifiedSearch.ts` 已有的 TTL/版本戳快取模式，改為
  「教材寫入時遞增版本戳，快取鍵帶上版本戳」，或直接評估拿掉這層快取（`GC1`~`GC4`/`W6` 已列的既有結論，
  不在本波重複展開）。

### 7. `specializedAgentInteractions` 的最近工具/精靈統計查詢 ORDER BY 欄位無對應複合索引

- **檔案:行號**:`server/services/specializedAgentMemoryStore.ts:148-176`（`getRecentSpecialistTools`，
  `WHERE userId=? AND interactionType='tool_used' ORDER BY createdAt DESC LIMIT n`）與 `:186-213`
  （`getSpecialistMemoryHints`，`WHERE userId=? GROUP BY agentId, interactionType ORDER BY COUNT(*)
  DESC LIMIT 60`），兩者都在 `ai.chat` 每輪對話組 prompt 時被 `Promise.all` 並行呼叫
  （`server/routers/ai.ts:1176-1180`）。
- **問題**:比對 `drizzle/schema.ts:840-869`，`specialized_agent_interactions` 只有
  `sai_user_agent_idx (userId, agentId)`、`sai_session_idx (sessionId)`、`sai_created_at_idx
  (createdAt)` 三個索引。`getRecentSpecialistTools` 的過濾條件是 `userId + interactionType`（不是
  `userId + agentId`），排序欄位是 `createdAt`——沒有任何索引同時涵蓋 `(userId, interactionType,
  createdAt)`，MySQL 只能用 `userId` 前綴（透過 `sai_user_agent_idx` 的 `userId` 部分或
  `sai_created_at_idx` 單欄）縮小範圍後，仍需對該使用者的候選列做記憶體排序（filesort）。
- **cluster**:missing-index（ORDER BY 欄位缺複合索引支援）
- **規模觸發**:此表過濾條件以 `userId` 為主，屬於「單一使用者資料量」型查詢——依題目規則「單一使用者
  資料量小的表風險低」，只有當**單一使用者**的互動紀錄本身長期累積到夠大（例如重度使用者累積數千筆
  工具呼叫紀錄）才會讓 filesort 成本變得有感。
  是本次稽核中優先度最低的一條 missing-index 案例。
- **現在痛 / 規模大才痛**:現在不痛（單一使用者資料量通常有限）；規模大才痛，且觸發門檻高於本文其他
  finding。**需負載驗證**確認重度使用者的實際互動紀錄量級。
- **建議**:非優先；若要優化，可補一個 `(userId, interactionType, createdAt)` 複合索引。

---

## 已正確有界 / 已快取 / 已有索引意識(negative results)

以下是本次稽核中特別檢查、確認**沒有問題**的模式，列出來避免重工：

| 檔案:行號 | 說明 |
|---|---|
| `server/middleware/brainContext.ts:607-631`（`buildBrainContext`） | 每個 `brainProcedure` 請求都會查一次 `user_ai_brain`，但 `WHERE userId=?` 命中 `drizzle/schema.ts:1339` 的 `.unique()` 隱式索引，且 `.limit(1)`；Health Ping 全部走 TTL=60s 的 in-memory `Map`（`healthCache`），不會在每次請求發 HTTP 探測——是良好的「零阻塞健康檢查」設計範本。 |
| `server/services/orbContextLookup.ts:33-76` | proper-noun 偵測的 LLM 分析結果用 `(userId, prompt hash)` 為鍵、TTL=5 分鐘、硬上限 `CACHE_MAX_ENTRIES=256` 的 in-memory 快取，同一輪對話追問不會重跑 4s 的 LLM 分析——是本次稽核中「有界快取」的最佳範本，第 1 條 finding 的修法可直接參考這個上限模式。 |
| `server/services/orbUnifiedSearch.ts:30-48,261-361` | 跨四來源（asset/note/history/tutorial）搜尋皆有 `SOURCE_FETCH_CAP=200` 讀取上限、`DEFAULT_SOURCE_BUDGET_MS=4000` 逐來源逾時保護（`withSourceTimeout`，單一來源卡住不拖垮整體）、`RESULT_CACHE_TTL_SECONDS=10` 結果快取。是本次稽核中「熱路徑但有完整防禦」的示範。 |
| `server/repositories/mysql/SpiritMemoryRepository.mysql.ts:138-163` + `drizzle/schema.ts:804-833` | `findByAgent` 的 `WHERE userId+agentId(+memoryType)` 命中 `sam_user_agent_idx`/`sam_user_agent_type_idx`；`ORDER BY confidence*LOG(usageCount+1)` 雖是運算式排序無法走索引，但因 `WHERE` 已把範圍收斂到單一使用者單一精靈，資料量小，filesort 成本可忽略。 |
| `server/_core/trpc.ts:190-212`（`requireVideoStudioLimit` 第一段查詢） | `WHERE userId+jobType+status` 能用 `userId_status_idx (userId, status)` 的 `userId` 前綴縮小範圍，屬合理設計（與同 middleware 第二段的全站查詢——finding 4——形成對照）。 |
| `server/_core/trpcRateLimit.ts:21,63-70,166-172` | in-memory 滑動窗計數 `Map`，有 `setInterval` 週期性清除過期 entry（`now >= entry.resetAt` 就 `delete`），不會無限累積——是本次稽核中「行程內 Map 有正確淘汰」的正向對照組，恰與第 1 條 finding 的 `orbMemory.ts` `store` 陣列（無淘汰）形成鮮明對比。 |
| `server/middleware/verifyToken.ts:37-80` | 每個受保護的 Express 路由請求都會重新 `getUserByOpenId` 查一次使用者列，`WHERE openId=?` 命中 `drizzle/schema.ts:27` 的 `.unique()` 索引。雖然每請求都重查 DB（未加快取），但這是刻意的「fail-closed 新鮮度檢查」（AIDV-258 註解：DB 不可用時必須拒絝而非放行，避免僅信任 JWT 繞過 soft-delete/角色變更），屬安全設計取捨而非疏漏，不計入 finding。 |
| `server/services/teachingArchiveSearch.ts:121-170`（主路徑） | 教材搜尋優先走 Pinecone 向量檢索（`queryTeachingArchiveVectors`），只有在向量搜尋關閉或無命中時才 fallback 到 `db.searchTeachingMaterialsForUser` 的 `LIKE %...%` 全文比對（`server/db.ts:4190-4195`，`LIKE` 前後皆有萬用字元，天生無法走索引，但屬 fallback 路徑且有 `limit`，不獨立列為 finding，僅在此註記與 PF1 finding #4 屬同一張表的相關觀察）。 |
| `drizzle/schema.ts:2709-2763`（`orb_conversations` / `orb_conversation_messages`） | 光球對話列表與訊息分頁的常用 WHERE/ORDER 欄位皆有對應複合索引：`orbc_user_updated_idx (userId, updatedAt)`、`orbc_user_archived_idx (userId, archivedAt)`、`orbcm_conv_at_idx (conversationId, at)`、`orbcm_user_conv_idx (userId, conversationId)`——是本次稽核中 schema 設計最完整的一組索引，`server/routers/orbConversationsRouter.ts:374-394` 的 cursor 分頁（PF1 已列為正向範例）正是建立在這組索引上。 |

---

## 總結

本次掃描共確認 **7 條熱路徑重算/同步阻塞/缺索引 finding**（1 條 critical、3 條 high、3 條 medium），
涵蓋：

- **1 條全新的高風險記憶體結構問題**：`orbMemory.ts` 的行程內對話記憶陣列全站共用、永不淘汰，且讀取端
  對全量做線性掃描，掛在光球每一輪對話的熱路徑上（finding 1，critical）。
- **2 條命中光球主對話 mutation（`ai.chat`）每輪都無條件重算的全站 DB 聚合/計數查詢**，兩者都缺乏
  支援對應 WHERE 欄位的索引（finding 2 的 `api_usage_logs` GROUP BY；finding 4 的 `background_jobs`
  全站併發計數，後者掛在 videoStudio 生成 mutation 而非 chat）。
- **1 條 RAG 檢索路徑上「本可快取卻沒快取」的額外網路往返**（finding 3，`getIndexHost` 每次互動都重查
  Pinecone control-plane，現在就有感，非規模觸發型）。
- **2 條交叉引用 W6 既有結論、本波重讀程式碼確認仍然成立**的光球 prompt 組裝效率問題（finding 5 的
  50KB 靜態提示詞未用 prompt caching；finding 6 的教材索引快取新鮮度問題）。
- **1 條低優先度的 missing-index**（finding 7，`specialized_agent_interactions` 的 ORDER BY 欄位，
  因查詢本身是 user-scoped 小資料量而列為最低優先）。

同時確認了一批「已經做對」的既有慣例（TTL 快取 + 硬上限、逐來源逾時保護、行程內 Map 有正確淘汰、
fail-closed 安全新鮮度檢查、schema 索引設計完整的對話表），可作為修復上述 finding 時的直接參考範本。

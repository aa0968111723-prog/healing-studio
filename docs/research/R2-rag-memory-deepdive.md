# R2 — RAG 與記憶分層深挖

> 日期:2026-07-03 · commit `7f4417da` · 深挖 wave R
> 範圍:`server/services/memory/`(façade + `MEMORY_TIERS.md`)、`ragMemory.ts`、
> `teachingArchiveRag.ts`、`orbLongTermMemory.ts`、`orbMemory.ts`、
> `orbUserMemory.ts`、`orbTaskMemory.ts`、`specializedAgentMemoryStore.ts`、
> `siteKnowledge.ts`、`drizzle/schema.ts` 記憶相關表。逐檔實讀,非摘要轉述。

---

## 1. 記憶分層全圖

`server/services/memory/MEMORY_TIERS.md` 定義三層(façade `index.ts` 對應
`export * as X from "../xxx"`,無 runtime 邏輯,純命名分組):

| Tier | 模組(path) | 儲存後端 | 生命週期 / TTL | 寫入者 | 讀取者(哪些 prompt 注入) |
|---|---|---|---|---|---|
| **A** Ephemeral task scratchpad | `server/services/orbTaskMemory.ts` | 純 in-RAM 陣列 `memoryEvents`(`MAX_EVENTS=300`,`unshift`+截斷);可選鏡射到既有 `orb_feedback_events` 表(`actionType` 前綴 `chain.`,無新表) | RAM:程序壽命;DB 鏡射:永久,但**預設關閉**(需 `ORB_CHAIN_MEMORY_PERSIST=1`) | 每個 chain step 呼叫 `recordOrbTaskMemory`;`persistOrbTaskMemoryEvent` 是額外的 fire-and-forget DB 鏡射 | `summarizeRecentOrbTaskMemoryForUser`(`server/routers/ai.ts:1006`)→ 併入 `buildOrbSystemPrompt`;`summarizeRecentOrbTaskMemoryForPlanner` 供 `orbTaskChainRunner.ts` replan 用 |
| **B-1** ConversationMemory | `server/services/orbMemory.ts` | 純 in-RAM 陣列 `store: OrbMemory[]`(**無容量上限**,只靠 `deleteOrbMemory`/`clearOrbMemoryForUser` 手動清,理論上可無限增長);每筆寫入同時 fire-and-forget 轉存到 Pinecone(`storeToRag`) | RAM:程序壽命,重啟即清空;Pinecone 側持久 | `recordOrbMemory`(`ai.ts` 偏好抽取路徑) | `getRecentOrbMemories`/`buildOrbMemorySummaryForPlanner`(`ai.ts:1024`、`orbTaskChainRunner.ts:204`)→ 併入系統提示;`searchOrbMemoriesWithRag` 混合 RAG+關鍵字 |
| **B-2** UserSummary | `server/services/orbUserMemory.ts` | `users.orbMemorySummary`(text 欄位,每人一條字串) | DB 欄位本身永久,但**內容每次對話都被整段覆寫**(見下方發現) | `ai.ts:753-768`:每次 `ai.chat` 回覆後,fire-and-forget 呼叫額外一次 `gpt-4o-mini` LLM,把「最近 5 則訊息+本次回覆」濃縮成 ≤50 字摘要,`upsertOrbMemory` 整段覆蓋舊摘要 | `getOrbMemorySummary`(`ai.ts:1183`)→ 標籤「使用者短期記憶摘要」注入 `mergedPromptContext` |
| **C-1** LongTermMemory | `server/services/orbLongTermMemory.ts` | `orb_long_term_memories` + `orb_memory_associations`(MySQL,`bigint` PK,`embeddingVector: json`) | 永久;`consolidate()` 有 90 天低重要性剪枝邏輯,但**無排程呼叫者**(grep 全 repo 無 cron/job 呼叫 `consolidate`) | `orbConversationEnhancer.extractAndStoreMemories`(regex pattern-match「我是/我叫/我喜歡/我想要」等 3+2 條正則),由 `orbConversationsRouter.ts:504` 在儲存對話訊息後 fire-and-forget 觸發 | **無**——見下方 §3 缺口 |
| **C-2** SpiritMemory | `server/services/spiritMemoryManager.ts`(經 `SpiritMemoryRepository.mysql.ts`) | `specialized_agent_memory` 表(注意:表名跟 Tier C-3 模組名相似但不同表) | 永久,(userId, agentId, memoryKey) 唯一 | `SpiritMemoryManager.recordMemory/learnPattern/recordFeedback`(`spiritPromptEnhancer.ts`) | `SpiritMemoryManager.formatMemoriesForPrompt`(`spiritPromptEnhancer.ts:54`)→ 精靈系統提示 |
| **C-3** SpecialistEvents | `server/services/specializedAgentMemoryStore.ts` | `specialized_agent_interactions` 表(時序事件) | 永久,無 TTL/剪枝 | `recordToolAuditAsSpecialistInteraction`(`onAuditEvent` hook) | `getRecentSpecialistTools`/`getSpecialistMemoryHints`(`ai.ts:1176-1179`)→ 併入系統提示「使用者專精助手習慣」區塊 |

補充:MEMORY_TIERS.md 文件本身在 B-2 一段寫「被 conversation-enhancer 定期呼叫」,
但實讀 `ai.ts:728-768` 後確認寫入點是 `ai.chat` mutation 內聯的 fire-and-forget
區塊,直接呼叫 `invokeLLM`(gpt-4o-mini)+ `upsertOrbMemory`,**不經過**
`orbConversationEnhancer.ts`(那是 C-1 的寫入者)。文件對「誰寫」有一處失準。

---

## 2. 「雙引擎 RAG」到底是什麼

逐檔確認結論:**「雙引擎」不是兩套檢索引擎,是 Director AI 的兩段 LLM 管線**。

`server/services/director/costarService.ts:1-11`(檔頭註解)明確自稱
`Director CO-STAR dual-engine pipeline`:

- **第一引擎(研究)**:`invokeLLM({ model: "perplexity/sonar-pro", ... })`
  (§134-210)。Perplexity Sonar Pro 帶 web grounding,抓即時趨勢/社群偏好/新模型
  發表;`PERPLEXITY_API_KEY`/`OPENROUTER_API_KEY` 缺失或被
  `perplexityThrottle.checkAndConsumePerplexity` 節流時,**降級為 `brainConfig.model`**
  (使用者設定的大腦模型,通常 Claude/Gemini)。
- **第二引擎(創作)**:同一個 `invokeLLM` 再呼叫一次,用 `brainConfig.model`
  + `response_format: json_schema` 產出結構化 CO-STAR 腳本(§215-280)。

兩段之間的「RAG」只有**一個**向量來源:`buildMemoryContext(userId, lastUserMsg)`
(`ragMemory.ts:253`,查 Pinecone `ai-director-memories` index,`user-{userId}`
namespace,top-3)在 Step 1 系統提示裡以「【用戶歷史偏好記憶】」區塊注入
(`costarService.ts:111-132`)。Step 2 不再查 RAG,只吃 Step 1 的研究結果。
**沒有第二個檢索引擎**——`teachingArchiveRag.ts` 是同一個 Pinecone index
的另一個 namespace(`teaching-{userId}`),服務教學檔案庫語意搜尋,跟 Director
的雙引擎管線完全獨立、互不呼叫。

檢索→注入的完整資料流(Director 路徑):
```
使用者訊息 → getEmbedding(gemini-embedding-001, 3072維)
           → Pinecone query(namespace=user-{userId}, topK=3)
           → buildMemoryContext() 組「【用戶歷史創作偏好】」字串
           → (AIDV-69 旗標 ON 時)guardRetrievedContext() 包裹防注入
           → 塞進 Step 1(Sonar 研究)system prompt
           → Step 1 輸出 → 塞進 Step 2(CO-STAR 創作)system prompt
           → 回傳 script
```

**文件/行銷文案落差(新發現,值得留意)**:`server/routers/learnHub.seed.ts:10974`
的測驗「正解」寫「雙引擎 RAG 結合了向量語義搜尋和傳統關鍵字搜尋」——這句話
描述的其實是 `orbMemory.searchOrbMemoriesWithRag()`(RAG+關鍵字合併,§3)或
`teachingArchiveSearch.ts`(向量優先、LIKE fallback)的行為,**不是** Director
雙引擎的定義,對外教學內容把兩個不同子系統混為一談。這呼應 E 波初判「待查證」,
本波確認:E 的結論(雙引擎=研究+創作兩段 LLM,非兩個 RAG)成立,且找到具體的
文案錯誤來源。

---

## 3. 五個記憶 store 的關係:分工,但邊界有滲漏

不是重疊,是**按讀寫頻率與訪問模式分工**,但三處滲漏值得注意:

1. **orbMemory(B-1)vs orbLongTermMemory(C-1)**:表面上 B-1 是「短期瑣事」、
   C-1 是「長期結構化記憶」,但兩者的**寫入路徑完全獨立、互不知情**——
   B-1 由 `ai.chat` 的正則抽偏好觸發,C-1 由「儲存對話訊息」端點
   (`orbConversationsRouter.appendMessages` 附近)的另一組正則觸發。同一句
   使用者輸入「我喜歡電影感」可能**同時**被兩套完全不同的正則各自判斷、
   各自入庫,無共享去重/一致性機制。
2. **orbMemory.searchOrbMemoriesWithRag 是唯一做「RAG+關鍵字混合檢索」的地方**
   ——這正是 learnHub 測驗誤植給 Director 的那個行為,實際主人是 B-1。
3. **orbLongTermMemory(C-1)是純寫入孤島**:`search()` 方法的 docstring 寫
   `Search memories using semantic similarity`,但實作是 `TODO: Implement
   actual semantic search with embeddings` + LIKE 全文比對
   (`orbLongTermMemory.ts:198-219`)。`create()` 從不寫入 `embeddingVector`
   欄位(schema 有此 json 欄位,`insertData` 從未賦值)。更關鍵:唯一的讀取
   入口 `orbConversationEnhancer.getRelevantMemories()`**在全 repo 沒有任何
   呼叫者**(grep 確認)。C-1 的資料只進不出——寫進 DB 後不會被任何系統提示
   讀回,是純粹的「稽核用歷史紀錄」,不是真正參與 AI 回應的記憶層。
4. **specializedAgentMemoryStore(C-3)vs spiritMemoryManager(C-2)**:分工清楚
   ——C-3 記「用過哪些工具/多常失敗」(事件流,給 skill router 當 tiebreaker),
   C-2 記「25 隻精靈對這位使用者各自學到的偏好」(累積學習,給精靈系統提示)。
   兩者寫進**不同**表(`specialized_agent_interactions` vs
   `specialized_agent_memory`),命名容易誤認(模組名 `specializedAgentMemoryStore`
   實際寫的是 `_interactions` 表,`specialized_agent_memory` 表反而是
   `SpiritMemoryRepository` 在寫)。
5. **orbUserMemory(B-2)不是「精煉後的長期偏好摘要」,是「上一輪對話的滾動摘要」**:
   每次 `ai.chat` 都用 `gpt-4o-mini` 把最近 5 則訊息整段濃縮覆蓋舊值
   (§1 已述),沒有跨多輪的累積邏輯,MEMORY_TIERS.md 文件標「這位使用者長期
   偏好的人話摘要」與實作(僅反映最近一輪)有落差。

**結論**:五層是刻意分工(不同粒度:單步驟 / 單輪對話 / 全程 session / 跨會話事實
/ 跨會話精靈學習 / 跨會話工具使用),但 C-1(LongTermMemory)目前是唯一「寫了
沒人讀」的死胡同,B-1/C-1 的正則抽取邏輯彼此不通氣,是實質的重工而非分工。

---

## 4. 與本質關聯:「跨 session 記得你的專案」支撐與缺口

**現有支撐**:

- `ai.ts:1188-1238` 的 `worldContextBlock` 是唯一貼近「單一專案上下文」的機制
  ——前端在 `pageSnapshot.state.currentWorldFrameworkId` 帶入時,後端拉
  `worldbuilding_frameworks` 表(角色/場景/negative prompt),組「【當前世界觀】」
  區塊注入系統提示。但這**限定在「世界觀建構」功能**(故事角色/場景設定),
  不是通用的「當前專案是什麼、做到哪一步」的全域上下文。
- B-2(`users.orbMemorySummary`)理論上能跨 session,但如 §1/§3 所述,內容
  每輪被覆寫,只保留「最近一次對話摘要」,無法回答「三天前我們討論的專案細節」。
- C-1(LongTermMemory)理論上是「這位使用者的長期事實/偏好」正確存放處,
  但如 §3 所述無人讀取,等於沒有發揮作用。

**缺口(對應題目的改進提議)**:

1. **無「專案範圍記憶」概念**:目前所有記憶層都是 `(userId, ...)` 維度,沒有
   `(userId, projectId)` 或 `(userId, worldFrameworkId)` 維度的長期記憶表。
   worldContextBlock 是唯一例外,但它讀的是 worldbuilding 表本身(結構化資料),
   不是「AI 對這個專案學到的心得」。改進方向:讓 C-1(orbLongTermMemory)
   的 `sourceId`/`metadata` 欄位真正掛上 projectId,並在讀取時依目前
   `pageSnapshot.state.currentCreativeProjectId` 過濾,才能做到「這個專案裡
   AI 記得的事」。
2. **記憶落 DB 但不落地(读取端缺失)**:C-1 的 `search()` 應該接上
   `getRelevantMemories()`→ 塞進 `ai.ts` 的 `mergedPromptContext`(目前只有
   B-2 的滾動摘要 + worldContextBlock),否則 regex 抽出來的「使用者事實」
   永遠是資料庫裡的靜態紀錄。
3. **注入品質**:B-2 每輪重新用 LLM 覆寫的設計,結構上無法累積「跨多輪」的
   長期畫像(除非剛好在最近 5 則訊息裡);而 preferenceProfile
   (`aggregatePreferenceProfile(recentOrbMemories)`,`ai.ts:1138`)雖然做了
   跨多筆 B-1 記憶的聚合,但 B-1 是 RAM,重啟即空,聚合出的「偏好證據」也
   歸零。建議把 B-1 的偏好聚合結果定期(或每次有新證據時)寫回 C-1 或
   `users` 表的結構化欄位,而非停留在 RAM。
4. **embeddingVector 欄位是死欄位**:`orb_long_term_memories.embeddingVector`
   存在但從未寫入、`search()` 從未使用向量比對,是「看起來像語意搜尋、實際
   是 LIKE」的名實不符,若要落實「真語意搜尋」需要接上 `ragMemory.ts` 的
   embedding pipeline 或改用 Pinecone。

---

## 5. 可靠性:記憶體重啟即失清單(呼應 K3 §4)

`docs/research/K3-data-integrity.md` §4 已列出 `learnHub`/`modelResearcher`/
`orbTaskStateMachine`/`orbQuota`/rate-limiter/metrics 等 in-RAM Map,但**未涵蓋
本波深挖的記憶子系統**,以下是本波補充、可與 K3 表合併的項目:

| 資料 | 位置 | 重啟後果 | 使用者可見後果 |
|---|---|---|---|
| **Tier A 任務暫存**(`orbTaskMemory.memoryEvents`) | `orbTaskMemory.ts:27` | 300 筆環形緩衝全部歸零 | Planner 失去「這個 task 前幾步做了什麼」的線索,`ORB_CHAIN_MEMORY_PERSIST` 預設關閉時**完全無 DB 備援** |
| **Tier B-1 對話記憶**(`orbMemory.store`) | `orbMemory.ts:36` | RAM 陣列清空,但**已 fire-and-forget 存進 Pinecone 的部分不受影響**(RAG 側倖存) | `getRecentOrbMemories`/關鍵字搜尋這半邊立即斷炊,只剩 RAG 半邊還查得到;使用者感受到「光球忘記剛剛講過的偏好細節,但奇怪地還記得舊的創作紀錄」這種不一致體驗 |
| **Tier B-1 無容量上限** | `orbMemory.ts:36` | 非重啟問題,是**持續增長風險**:`store` 陣列沒有 `MAX_EVENTS` 這類上限(對比 Tier A 有 300 筆上限),長時間不重啟 + 高流量下可能造成單一 Node 行程記憶體持續增長 | 潛在 OOM/效能衰退,目前只能靠部署週期重啟「順便」回收 |

**倖存(不受重啟影響)的部分**:
- Tier B-2(`users.orbMemorySummary`)—— MySQL 欄位,持久。
- Tier C-1/C-2/C-3 —— 各自獨立 MySQL 表,持久。
- Pinecone 側(ragMemory/teachingArchiveRag)—— 外部託管服務,不隨 App 重啟受影響。

**淨結論**:三層記憶中,只有 Tier A 全部、Tier B-1 的「即時 RAM 視圖」在重啟後
消失;Tier B-2/C-1/C-2/C-3 是 DB 持久層,天然倖存於重啟。但 Tier C-1 雖然倖存,
因 §3/§4 所述「無人讀取」,其持久性目前沒有實際使用者可見的價值。

---

## 未查證 / 建議後續

- `orbLongTermMemory.consolidate()`(90 天低重要性剪枝)是否有排程呼叫者——
  本波 grep 未找到 cron/job 呼叫點,但未窮舉所有 `server/jobs/*` 排程註冊表,
  不能 100% 排除存在但命名方式抓不到的呼叫路徑。
- `spiritMemoryManager.ts`/`SpiritMemoryRepository.mysql.ts` 本波僅透過
  grep 確認寫入/讀取入口(`formatMemoriesForPrompt`/`recordMemory` 等),
  未逐行實讀該檔案全文,C-2 層的 TTL/剪枝/confidence 衰減邏輯細節未驗證。
- `orbClarificationEngine.ts`/`orbFeatureDiscovery.ts`/`orbSystemMonitor.ts`
  (被 `orbConversationEnhancer.ts` 呼叫的另外三個子系統)不在本波指定讀檔
  清單內,只讀了引用點,未深入其內部實作與可靠性。
- Pinecone 側資料的實際保留期限/清理策略(是否有人工或排程刪除舊向量)
  未在程式碼中找到明確證據,`teachingArchiveRag.deleteTeachingVectorsByMaterial`
  是唯一刪除路徑,只在 material 被刪或重跑 ingestion 時觸發;`ragMemory.ts`
  的使用者記憶向量目前看不到任何刪除/過期路徑(是否會無限增長未查證)。

# U4 — 自我修復 / 自動化維運系統逐行深挖(brainAutoRepair × brainStatePersistence × orbSystemMonitor × providerHealthProbeJob)

- 產生日期:2026-07-03
- 依據 commit:`7f4417daaacbf24510dc20d88dba9aae71b2883c`
- 波次:**逐檔深挖 wave U**
- 方法:單一代理逐行實讀 `server/services/brainAutoRepair.ts`(3034 行,全文分段讀完)、`server/services/brainStatePersistence.ts`(127 行,全文讀完)、`server/services/orbSystemMonitor.ts`(1355 行,重點段落讀完:1-1355 涵蓋全部 public 方法)、`server/jobs/providerHealthProbeJob.ts`(398 行,全文讀完)、`server/jobs/apiHealthMonitor.ts`(298 行,全文讀完,找出 cron 觸發點)、`drizzle/schema.ts` 對應表定義、`node_modules/drizzle-orm` MySqlJson 原始碼、`server/routers/brain.ts` 授權層、`server/routers/orbConversationsRouter.ts` 呼叫鏈、`server/brain-auto-repair.test.ts` 測試覆蓋範圍;**禁止子代理,單人對抗式逐行核對**。
- 承接、不重複:G4(`.brain-state.json` 誤 commit)、B-infra §2.4/§5.4(雙告警表分裂、`providerHealthProbeJob` 實寫 MySQL 與註解矛盾)、R1 §3.2/§4.1(`brainContext` 假健康檢查、三套健康狀態源互不通訊、`brainAutoRepair.ts:882` 是 production 唯一呼叫 `reportEngineFailure` 之處)、K3(資料完整性)。
- 圖例:🔴 高 / 🟡 中 / 🟢 低;每條標【新發現】或【既有延伸】。

---

## 0. 一句話總結

`brainAutoRepair.ts` 本身**不會**改 env、不會改組態檔、不會 rename 任何東西——它是純 in-memory 的「探測 → 記警報 → 建提案 → (需人工核准才)開 GitHub Issue」系統,approve/reject 全部掛 `adminProcedure`(`server/routers/brain.ts:880-1251`),沒有無人監督的自動合併/自動改碼路徑。真正的自動改 env(`AUTH_SECRET→JWT_SECRET` 等)是 `server/_core/env.validated.ts` 的 `selfRepairEnv()`,與 brainAutoRepair 無關(B-infra 已記錄,不在此文重複)。

**但本波發現:brainAutoRepair 的「巡檢自動化」本身有一個未經測試覆蓋的自我放大故障路徑**——當一個承載 76 個生成引擎的 provider(fal)故障時,巡檢迴圈會對每個受影響引擎重複探測、重複寫錯誤線索、重複打外部搜尋 API、重複建提案,單次循環可能耗時遠超過 cron 間隔,形同對已故障服務二次施壓,並用雜訊淹沒真正的安全/程式碼掃描提案。另外 `orbSystemMonitor.ts` 有一條完全沒有去重機制的告警寫入路徑,掛在每一次 Orb 對話輪次的熱路徑上,會員生產環境延遲尖峰即可無限灌爆與 `providerHealthProbeJob` 共用的同一張 `orb_system_alerts` 表。

---

## 1. 🔴【新發現】fal 故障放大成自我 DoS 風暴(本波最高優先級,「自動修復可能造成的災難情境」headline)

**觸發**:`fal` 是 76 個生成引擎(圖像/影片/音樂/語音/3D,見 `ENGINE_PROVIDER_MAP`,`brainAutoRepair.ts:280-450`)共用的唯一 provider。當 fal API 整體不可達(例如 fal 那端出事,或本機 egress 被擋)時,每 3 分鐘一次的巡檢(`apiHealthMonitor.ts:76-80,197`,`monitorIntervalMinutes` 預設 3)呼叫 `runHealthPatrol()`。

**證據**:`runHealthPatrol()` 的第一個迴圈(`brainAutoRepair.ts:2707-2724`)對每個 provider 探測一次,**若不健康就完全不去重**地遍歷 `ENGINE_PROVIDER_MAP` 找出所有對應該 provider 的引擎,逐一呼叫 `attemptAutoRepair(eng)`:

```
for (const p of providers) {
  const result = await pingProvider(p);
  if (!result.ok) {
    for (const [eng, prov] of Object.entries(ENGINE_PROVIDER_MAP)) {
      if (prov === p) {
        const alert = await attemptAutoRepair(eng);   // 76 次(fal 故障時)
      }
    }
  }
}
```

`attemptAutoRepair(engine)`(:826-906)本身又會:
1. 對 `provider`(fal)再 ping 一次(:828,已知會失敗,仍重打一次,8 秒 timeout)。
2. 遍歷 `REPAIR_FALLBACK[engine]` 候選(:848-879)——fal 系引擎的備援候選**幾乎全部也是 fal 系引擎**(例如 `fal-ai/nano-banana-2` 的備援是 `fal-ai/nano-banana-pro`/`fal-ai/flux-pro/v1.1`,同樣是 fal),每個候選再各 ping 一次(又是 8 秒 timeout)。
3. 全部失敗後呼叫 `recordErrorTrace(...)`(:895-903),而 `recordErrorTrace` 內部 `void autoSearchForFix(full)`(:959)會對 **Brave Search API** 發一次真實 HTTP 請求(`webSearch`,:2114-2140,`ENV.braveSearchApiKey` 存在時)。

**後果**:fal 全故障時,單次巡檢循環會產生約 **76 次 attemptAutoRepair 呼叫**,每次內部 1(主) + 2~3(備援候選)次對 fal 的 ping(全部 8 秒 timeout 才會失敗)——理論上限達 76 × 4 × 8s ≈ 2400 秒(40 分鐘),遠超過 3 分鐘的 cron 間隔;加上 76 次 `recordErrorTrace` → 76 次真實 Brave Search API 呼叫(消耗通常配額很小的搜尋 API 額度)、以及最多 76 個新 `reflectionProposal`(見發現 #2,無去重,會把 `MAX_PROPOSALS=100` 洗滿)。這是**對一個已經掛掉的 provider 加倍發送探測請求的自我放大故障**,也是全文唯一稱得上「自動修復本身可能造成災難」的情境:provider 故障期間,巡檢不但無法即時完成(下一輪被 `isRunning` 鎖跳過,`apiHealthMonitor.ts:88-93`,延遲偵測到真正恢復的時間),還會在此期間持續且加倍地打向已受損服務。

**測試覆蓋**:`server/brain-auto-repair.test.ts:699-708` 的 `runHealthPatrol` 測試只覆蓋「全部 provider 健康」的 happy path,**沒有任何測試模擬單一 provider 故障後對應 76 個引擎的擴散行為**,此路徑目前完全沒有回歸保護。

**path:line**:`server/services/brainAutoRepair.ts:2707-2724`(未去重迴圈)、`:826-906`(attemptAutoRepair)、`:280-450`(fal 佔 76/約 90 個引擎映射)、`:2114-2140`(webSearch 真打 Brave);`server/jobs/apiHealthMonitor.ts:80,197`(3 分鐘 cron)。

---

## 2. 🟡【新發現】autoSearchForFix 產生的提案沒有 dedupKey,會被巡檢反覆灌入雜訊

**證據**:`createReflectionProposal` 支援 `dedupKey`(相同 key 且 `pending` 狀態只會就地更新,`brainAutoRepair.ts:1864-1884`),且 code_scan(`dedupKey: \`code:${f.dedupKey}\``,:2875)、accuracy_test(`dedupKey: \`accuracy:${engine}:${testType}\``,:2637)、error_trace(`dedupKey: \`errors:${grp.engine}:${grp.category}\``,:2968)三處都嚴謹使用了 dedupKey。**唯獨 `autoSearchForFix`(:965-1011)呼叫 `createReflectionProposal` 時完全沒有傳 `dedupKey`(:995-1006)**——每次巡檢對同一個 fal 引擎重複觸發都會 unshift 一筆全新提案。

**後果**:結合發現 #1,fal 故障期間每 3 分鐘一次的巡檢都會為 76 個引擎各自產生新提案(而非更新既有的一筆),`MAX_PROPOSALS=100`(:220)的上限(`reflectionProposals.length > MAX_PROPOSALS` 就砍尾端,:1905-1906)會在**幾輪巡檢內**被這類雜訊洗滿,把來自 `runFullCodeScan`(6 小時一次,含 `security_fix`)與人工建立的提案擠出佇列,admin 在 AI 研究面板看到的會全部是同一種「系統自動巡檢」訊息的變體。

**path:line**:`server/services/brainAutoRepair.ts:965-1011`(缺 dedupKey)vs `:1864-1884`(dedup 機制本身)、`:220`、`:1905-1906`(MAX_PROPOSALS 驅逐)。

---

## 3. 🟡【新發現,延伸 R1 §3.2】attemptAutoRepair 的「軟降級」分支不回報原引擎不健康,brainContext 學不到部分故障

**證據**:R1 已指出 `brainAutoRepair.ts:882` 是 production 唯一呼叫 `reportEngineFailure` 的地方,但本波逐行核對後發現:**只有「所有備援都失敗」的 critical 分支**(:881-905)才會呼叫 `reportEngineFailure(engine, ...)`。中間的「fallback 找到一個健康候選」分支(:847-878)**只呼叫 `reportEngineRecovery(candidate)`**——對候選引擎回報健康,但完全沒有對原本失敗的 `engine` 本身寫入任何 healthCache 狀態(既不是 failure 也不是 recovery)。

**後果**:只要巡檢每次都撞到「主要 provider 掛、備援還活著」這種部分降級狀態(這是最常見的故障模式,遠比「全部備援也掛」常見),`brainContext.ts` 的 `healthCache`(R1 已證實這是驅動 5 槽推理大腦 model-id 層降級的唯一機制)永遠學不到「這個 model id 其實在降級中,靠備援撐著」——下一次任何呼叫端解析大腦槽位時,`findFallback` 仍可能繼續選中同一個正在掙扎的原始模型 id,而不會主動換成已知健康的候選。這讓 R1 已經記錄的「brainContext 假健康檢查」問題在實務上更嚴重:唯一能寫入真實失敗訊號的管道(brainAutoRepair)自己在最常見的故障型態下選擇不寫。

**path:line**:`server/services/brainAutoRepair.ts:847-878`(軟降級分支,只回報 candidate)vs `:881-905`(critical 分支才回報 engine 失敗)。

---

## 4. 🟡【新發現,延伸 K3/B-infra 雙告警表】MySQL `orb_system_alerts` 沒有去重唯一索引,與 Supabase 側形成不對稱防護

**證據**:B-infra §2.2 已記錄 Supabase 側的 `system_alerts` 因為曾經出現重複告警問題,`AIDV-834` 專門補了「active alert 去重唯一索引」。本波核對 `drizzle/schema.ts:3418-3449` 的 MySQL `orb_system_alerts` 表定義,**只有 `orb_alert_type_idx`(alertType+severity+createdAt)的一般查詢索引,沒有任何針對「同一 metricType 只能有一筆未解決告警」的唯一約束**。`providerHealthProbeJob.ts:222-234` 的去重完全靠應用層「先 SELECT 再 INSERT」(:223-232 之後才 `db.insert`),中間存在 TOCTOU 競態窗口。

**後果**:MySQL 這條「歷史遺留但仍在寫入」的告警表(B-infra 已證實 `providerHealthProbeJob` 實際寫入的正是這張表,與 schema 註解自稱的「Supabase 才是活表」矛盾),在真正的 provider 故障瞬間(多個 probe 呼叫、或未來 replica 擴展、或與發現 #5 的 orbSystemMonitor 高頻寫入交錯)比 Supabase 側更容易產生重複未解決告警列,而且沒有 DB 層防線兜底——這是雙告警表分裂問題裡「連防護等級都不對稱」的具體延伸細節。

**path:line**:`drizzle/schema.ts:3418-3449`(無唯一索引)、`server/jobs/providerHealthProbeJob.ts:217-260`(select-then-insert 去重)。

---

## 5. 🔴【新發現】orbSystemMonitor.createAlert 全無去重/冷卻,對話回應變慢就會無限灌爆與供應商告警共用的同一張表

**觸發**:`server/routers/orbConversationsRouter.ts:504` 在**每一次**使用者跟光球對話並儲存訊息時,fire-and-forget 呼叫 `orbConversationEnhancer.processConversationTurn(...)`(:509-511,失敗只 `console.warn`,不影響回應)。其內部(`orbConversationEnhancer.ts:124-131`)無條件呼叫 `orbSystemMonitor.recordHealthMetric({ metricType: "response_time", threshold: 5000, ... })`。

**證據**:`recordHealthMetric`(`orbSystemMonitor.ts:202-264`)一旦 `value > threshold`(回應時間超過 5 秒)就呼叫 `this.createAlert(...)`(:233-249)。`createAlert`(:1220-1258)**沒有任何「是否已存在相同未解決告警」的檢查**,每次呼叫都直接 `db.insert(orbSystemAlerts).values(...)`(:1234-1245)。對比同一張表的另一個寫入者 `providerHealthProbeJob.ts`,後者有 `ALERT_THRESHOLD=2`(連續失敗才觸發)+ 既有未解決告警檢查(:222-234)的完整節流設計;`orbSystemMonitor.createAlert` 完全沒有等價機制。

**後果**:任何一次 LLM 延遲尖峰(R1 已詳細記錄多 provider 斷路器/延遲是常態)只要讓某次 orb 對話回應超過 5 秒,就會在 `orb_system_alerts` 新增一筆永久不會自動解決的列(沒有任何程式碼在條件恢復後呼叫 `resolveAlert` 針對這個 metricType)。在流量高峰或某個引擎降速的期間,這條路徑可以**每一次慢回應就插一列**,而 `getUnresolvedAlerts()`(:1263-1306)只回傳最新 100 筆(`.limit(100)`,:1288)——這些噪音會把 `providerHealthProbeJob` 寫入的真正供應商斷線告警擠出「最近 100 筆」視窗之外,形成監控盲區(且與發現 #4 的缺唯一索引问题疊加,兩個獨立寫入者共用同一張無去重防護的表,風險互相放大)。

**path:line**:`server/routers/orbConversationsRouter.ts:504-511`(熱路徑觸發點)、`server/services/orbConversationEnhancer.ts:124-131`(閾值 5000ms)、`server/services/orbSystemMonitor.ts:202-264`(recordHealthMetric 無節流呼叫 createAlert)、`:1220-1258`(createAlert 零去重)、`:1263-1306`(getUnresolvedAlerts 100 筆上限)。

---

## 6. 🟡【新發現】orb_system_alerts / orb_system_health_metrics 無任何清理機制,setupAutomaticMonitoring 是從未被呼叫的假函式

**證據**:`orbSystemMonitor.ts:1184-1215` 的 `setupAutomaticMonitoring()` 函式本體**只是 `logger.info` 印出「打算做的事」清單**(含明文寫著「Clean up old metric data weekly」的意圖,:1194),註解也承認「Note: In production, these would be scheduled using cron/scheduler service」——即從未真正接上排程器。全 repo grep `setupAutomaticMonitoring` **只有這一處定義,零呼叫者**。

**後果**:疊加發現 #5(每次慢回應寫一列告警)與 `recordHealthMetric` 本身可能被每輪對話呼叫寫入 `orb_system_health_metrics`(即使 healthy 也會 insert 一列,:213-222,只有 unhealthy 才額外建告警),這兩張表在生產環境下**沒有任何保留期限或清理 job**,會隨對話量無限增長。這是 B-infra D1(記憶體態資料)清單之外、**資料庫表持續增長無界**的獨立技術債項,且與 K3 §6.3(db-backups 不清舊檔是已知取捨)性質不同——這裡是核心監控表,無限增長會直接拖慢 `getHealthSummary()`/`getUnresolvedAlerts()` 等全表/範圍掃描查詢(:611-614、:1283-1288 皆無時間分區,僅靠 `gte(timestamp, oneHourAgo)` 這類條件,若表無索引優化會隨資料量惡化)。

**path:line**:`server/services/orbSystemMonitor.ts:1184-1215`(死函式)。

---

## 7. 🟢【新發現,latent bug】orbSystemMonitor.getHealthMetrics 對已經是物件的 metadata 欄位重複 JSON.parse,一旦有資料會直接拋例外

**證據**:`orbSystemMonitor.ts:483`:
```ts
metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
```
`drizzle/schema.ts` 的 `orbSystemHealthMetrics.metadata` 是 `json()` 型別。核對 `node_modules/drizzle-orm/mysql-core/columns/json.cjs`,`MySqlJson` 類別**只定義了 `mapToDriverValue`(寫入時 JSON.stringify),沒有定義任何 `mapFromDriverValue`**——讀取時完全仰賴底層 mysql2 driver 自動把 JSON 欄位反序列化為 JS 物件(這也是 K3 §5.1 提到其他 json 欄位在別處被直接當 `Record<string, unknown>` 存取、無需二次 parse 的原因)。也就是說 `row.metadata` 讀出來時已經是物件而非字串,對物件呼叫 `JSON.parse(obj)` 會先把 `obj` 轉字串(`"[object Object]"`),再嘗試解析非法 JSON,**必定拋 `SyntaxError`**。

**後果**:目前**唯一**呼叫 `recordHealthMetric` 的地方(`orbConversationEnhancer.ts:125-131`)從未傳入 `metadata`(該欄位在此呼叫點被省略,DB 存的是 `null`),所以這條路徑目前是 dormant/從未真正觸發——但 `RecordHealthMetricInput.metadata` 型別合法允許填入(:81-88),只要未來任何新呼叫端(或 `getHealthSummary`/`getTopCollaborations` 之外的新功能)真的傳了 metadata,`getHealthMetrics()` 就會在讀取階段拋例外;且此函式的 catch 區塊選擇 `throw error`(:492)重新拋出,與同檔案 `recordHandoff`/`recordHealthMetric`/`recordCost` 皆選擇吞掉例外「不讓監控失敗影響功能」的一貫設計哲學相反——一旦觸發,呼叫端會直接收到例外而非優雅降級。`orbWorkflowEngine.ts:882` 有完全相同的 pattern(`row.metadata ? JSON.parse(row.metadata) : undefined`),是同一類 bug 的第二個潛在受害者,值得一併記錄。全 repo 對 `OrbSystemMonitor`/`orbSystemMonitor.ts` **零測試檔案覆蓋**(grep `orbSystemMonitor|OrbSystemMonitor` 於全部 `*.test.ts` 無命中)。

**path:line**:`server/services/orbSystemMonitor.ts:483`;`server/services/orbWorkflowEngine.ts:882`(同類 pattern);`node_modules/drizzle-orm/mysql-core/columns/json.cjs`(佐證只寫不讀)。

---

## 8. 🟡【新發現,延伸 B-infra D1】brainStatePersistence 是全量覆寫式持久化,若指向跨副本共享路徑會靜默互相蓋掉

**證據**:`writeStateOnce`(`brainStatePersistence.ts:99-117`)每次都把呼叫端 producer 回傳的「目前這個 process 記憶體中的完整快照」整檔寫入 `.tmp` 再 `rename`——是**全量覆寫**,不是增量合併,也沒有版本號/樂觀鎖。`getStateFilePath()`(:33-37)允許用 `BRAIN_STATE_FILE` 覆寫成任意路徑。

**後果**:G4 已指出 `.brain-state.json` 目前預設寫在 `<cwd>/.brain-state.json`(單容器本地檔,已造成誤 commit 問題);但若維運人員為了解決「Railway 重啟遺失記憶體態資料」(B-infra D1 開的技術債)而把 `BRAIN_STATE_FILE` 改指向多副本共享的掛載路徑,這個全量覆寫設計會造成:每個副本各自持有自己的 `apiAlerts`/`errorTraces`/`reflectionProposals` in-memory 陣列(brainAutoRepair.ts:199-203),debounce 1.5 秒後(brainStatePersistence.ts:75-86)各自把**自己的完整快照**寫向同一個共享檔案——最後寫入的副本會**靜默覆蓋**其他副本剛寫入的告警/提案/研究結果,沒有任何合併或衝突偵測機制。這是 B-infra D1「多 replica 水平擴展被記憶體態鎖死」清單中,**唯一一個「看起來已經做了持久化」、但持久化方案本身在多副本情境下比完全不做持久化更危險(靜默資料遺失、而非單純遺失)**的案例——維運人員可能誤以為設了 `BRAIN_STATE_FILE` 就解決問題,實際上引入了新的資料遺失模式。

**path:line**:`server/services/brainStatePersistence.ts:33-37,75-86,99-117`;對照 `server/services/brainAutoRepair.ts:199-203`(各自 in-memory)。

---

## 9. 🟢【新發現】精準度測試把 GEMINI_API_KEY 夾在 URL query string,結果與此 URL 相關的例外訊息會被寫進已知會誤 commit 的狀態檔

**證據**:`runAccuracyTest`(`brainAutoRepair.ts:2509-2653`)組出的請求 URL 是:
```
https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}
```
(:2534),即金鑰以 query string 形式而非 `Authorization` header 傳遞。測試結果(含 `actualResult`,可能包含例外訊息 `err.message`,:2603)整包透過 `accuracyTests.unshift(test)`(:2648)進入 `persistState()`(:261-273)寫入的 `.brain-state.json`。

**後果**:雖然目前 Node fetch 對純網路層錯誤(逾時/DNS/連線被拒)通常回傳不含完整 URL 的訊息(直接風險偏低),但這仍是「把敏感金鑰放進 URL 而非 header」的設計異味——一旦任何中介層(代理、部分 undici 版本的 cause 鏈、未來程式碼修改把 `res.url` 或請求物件序列化進日誌)開始把完整請求 URL 納入例外訊息或除錯輸出,金鑰就會经由 `accuracyTests` 陣列 → `persistState()` → `.brain-state.json` 這條路徑外洩到磁碟,而 G4 已經證實這個檔案有被誤 commit 進 git 的先例(2026-06-19 commit)。建議至少把 accuracy test 改用 header 傳遞金鑰,消除這個攻擊面即使目前未被觸發。

**path:line**:`server/services/brainAutoRepair.ts:2534`(URL 夾帶金鑰)、`:2648`(寫入 accuracyTests)、`:261-273`(persistState);對照 G4 §3「`.brain-state.json` 已誤 commit」。

---

## 10. 🟡【新發現】rehydrateFromDisk 對磁碟內容零 schema 驗證,信任 JSON 內容直接灌回記憶體陣列

**證據**:`rehydrateFromDisk()`(`brainAutoRepair.ts:233-256`,模組載入時立即執行,:258)對 `loadStateSync()` 回傳的每個欄位只做 `Array.isArray(...)` 檢查,就直接 `as ApiAlert[]`/`as ErrorTrace[]`/`as ReflectionProposal[]` 型別斷言後 push 進真正的記憶體陣列,沒有任何逐筆欄位驗證(不是 zod,不檢查 `severity`/`category`/`status` 是否為合法 enum 值)。`brainStatePersistence.loadStateSync()`(:50-66)本身也只檢查「parse 後是物件」。

**後果**:若 `.brain-state.json` 曾被舊版程式寫出不相容形狀(例如缺少後來才加入的欄位、或 `severity`/`category` 字串因版本演進而改變合法值集合)、或被人工編輯過、或如 G4 所述被 commit 進 git 後由不同分支/環境的程式碼讀回,後續程式碼如 `getProposals()` 的 `SEVERITY_RANK[b.severity]`(:1922,若 severity 是未知字串則為 `undefined`,`undefined - undefined = NaN`,排序行為不可預期)或 `getSystemSummary()` 的 `pendingBySeverity[p.severity]++`(:2791,對未知 key 做 `undefined++` 得到 `NaN` 而非拋錯,靜默污染統計)都會在沒有任何錯誤訊息的情況下產生錯誤結果。這是把「檔案內容可能是外部或跨版本輸入」視為信任資料的通用模式性缺口,發生在 admin 大腦控制台首次載入的路徑上,不易被發現。

**path:line**:`server/services/brainAutoRepair.ts:233-256`(rehydrate 無驗證)、`:1922`(SEVERITY_RANK 索引)、`:2791`(pendingBySeverity 索引);`server/services/brainStatePersistence.ts:50-66`(loadStateSync 僅檢查物件型別)。

---

## 未查完聲明

1. `server/services/siteCodeScanner.ts`(`runFullCodeScan` 依賴,6 小時一次)本身的掃描規則/效能未逐行核對,只確認呼叫鏈與 dedupKey 設計正確。
2. `server/services/githubIssueClient.ts`(`createGithubIssue` 實作、失敗重試策略)只讀了呼叫點,未讀實作全文。
3. `orbSystemMonitor.ts` 的 `getDailySummary`/`getCostOptimizations`(:815-1180 區間)聚合邏輯讀過但未對 SQL 聚合的數值正確性做逐式驗算。
4. `providerHealthProbeJob.ts` 的 `PROBE_CONFIG` 只涵蓋 7 個 provider(fal/elevenlabs/replicate/anthropic/gemini/openrouter/supabase_auth),與 `brainAutoRepair.ts` 的 `ENGINE_PROVIDER_MAP`(~90 個引擎/5 個 provider:gemini/nvidia/fal/elevenlabs/replicate)覆蓋範圍不同源、彼此獨立巡檢同一組底層 provider 卻用不同機制——兩者是否應該收斂為一套探測邏輯,本波僅記錄現象未展開設計建議。
5. 多副本(multi-replica)是否為 Railway 目前實際部署型態未經 mcp 工具查證,發現 #8 的「跨副本共享路徑」情境為 PLAUSIBLE 推論,非已確認的生產配置。
6. `brainContext.ts` 全文(除 R1 已讀片段外)未在本波重新逐行核對,發現 #3 建立在 R1 既有讀取基礎上做行為推論,未新增讀取 brainContext 本身程式碼。

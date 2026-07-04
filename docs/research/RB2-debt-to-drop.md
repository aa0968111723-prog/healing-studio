# RB2 — 該丟棄的債(不要帶進新專案)

- 產生日期:2026-07-04
- 依據 commit:812f6fdb
- 性質:用此 repo 當基底新建網站的決策研究

---

## 0. 前提與讀法

本文件只回答一個問題:**如果 Bruce 決定「拿 healing-studio 當基底,重新起一個新網站」,新專案的第一個 commit 不該帶什麼進去?**

前提對照(不重複主稽核的結論,只取用):
- **該重用**(不在本文件討論範圍,見主稽核):`deductUserPoints`/`refundUserPoints`(FOR UPDATE)+`atomicClaimJobRefund` CAS(W5)、`secretCrypto` AES-256-GCM+scrypt(GC3)、`ProjectFlowGuide` 五步引導(M2)、`contextPackets`、`falDispatcher`/模型目錄、fal/replicate/suno 整合、RAG。
- **本文件範圍**:七類「複製了就是把債一起搬過去」的東西——每類都不是「品質差一點」的問題,而是**架構形狀錯了**,新專案重做的成本遠低於「先搬過去、以後再清」的成本。

判斷準則(逐項套用):
1. 這個模組的「知識」(業務邏輯、已驗證的邊界條件)有沒有和「這個模組的殼」(表結構、路由形狀、旗標拓樸)綁死——綁死的丟殼留知識;沒綁死的直接丟。
2. 丟掉之後,新專案要「不用它也能跑」到什麼程度——如果丟掉會讓某條已上線的使用者路徑斷掉,那不是本文件講的「債」,是遺漏的功能,不列入。
3. 只列「系統性、會復發」的債(補丁打了還會再長出來的那種),不列一次性 bug。

---

## 1. 178 條不可達精靈工具 + 8087 行 `agentToolExecutor.ts`

**現況實測**:`server/services/agentToolExecutor.ts` 實測 **8087 行**(`wc -l` 於本次驗證,commit 7f4417da),單一檔案內同時做工具註冊表、參數校驗、模型路由解析(`resolveOrbEngine`)、配額檢查、內容審查、fal 派工與等待、多達數十種 `studio.*` 工具的個別 case 分支。178 支「精靈工具」中僅一小部分被光球實際呼叫路徑觸達,其餘是註冊了但前端/對話流程從未產生對應呼叫的「掛著的」工具定義。

- **為何丟**:這不是「功能太多」的問題,是**單檔案上帝物件**——任何新工具都要在同一 8000+ 行檔案裡加 case,任何改動的 blast radius 覆蓋全部工具;178 支裡的死碼讓「這支工具到底有沒有人在用」變成要逐一追呼叫鏈才能回答的問題,新專案如果照搬,從第一天就重新背上「不知道能不能刪」的認知負擔。這類過度建置(over-engineering)在新專案沒有既有使用者依賴的情況下,沒有任何理由重建。
- **丟了損失什麼**:
  - 已驗證能跑的 fal 派工邏輯(`falDispatcher`、`falQueueAwaiter`、`falRecoveryPolicy`)——**這部分不丟**,主稽核已列為該重用的原語,要做的是把它從 8087 行裡「抽出來」,不是連檔案一起搬。
  - 部分工具背後可能有能力已經接好外部 API(例如語音複刻/換聲類 fal 模型串接)——這些若新專案還要做同類功能,保留「這支工具打哪個 fal 模型 id、參數怎麼組」的映射表當設計參考即可,不必保留執行殼。
- **正確做法**:新專案只帶「工具目錄」的資料(模型 id、參數 schema、成本),依實際會用到的 5-10 支高頻工具重新寫薄殼(每支 50-150 行、獨立檔案、獨立測試),不做「一個執行器接住所有工具」的架構。
- **對應稽核卡**:`docs/agent/specialized-agents-system.md`、`docs/15-spirits-architecture.md`/`docs/25-spirits-integration-audit.md`(178 精靈盤點)、Q4 光球工具全表(`docs/research/`,63 registry 缺口清單)。
- **工時/風險**:丟棄本身零工時(不搬即可);風險在於「有沒有漏掉某支工具背後其實有價值的 API 映射」——建議請 Bruce 或熟悉光球的人過一次 178 支清單,標出「這支工具的外部 API 串接值得抄」的子集(預估 0.5-1 天覆核),其餘直接不帶。

---

## 2. 三套並存記帳(billing 外圈失效的根因)

**現況實測**:確認至少三條平行的「錢/用量」記錄路徑同時存在、彼此不對帳:
1. `users.remainingGenerations` 單一可變整數欄位,`deductUserPoints`/`refundUserPoints` 就地 mutate(`server/db.ts`)——**這是唯一真正影響使用者餘額的路徑**,主稽核 W5 已驗證其原子性沒問題。
2. `server/services/cost/ledger.ts` 的 append-only 複式(雙分錄)`costLedger` 表(`ENABLE_COST_LEDGER` 旗標控制)——程式碼自己的註解承認「本服務並行於 cost_aggregations、不改既有餘額」,也就是說這套「更正確」的複式帳本**不是**餘額的真相來源,只是影子記錄。
3. `apiUsageLogs` / `aiUsageEvents` / `orbFeatureUsageStats`(`drizzle/schema.ts:656,2060,3032`)等多張用量統計表,各自有各自的寫入時機與粒度,和上面兩套都對不上。

- **為何丟**:三套並存的直接後果就是主稽害列出的 B-27(自給點數)/B-31(退款吞錯)/B-32(Stripe stub)/B-22(守衛出廠即關)/X3(雙重超收)——因為「餘額」和「帳」不是同一個東西算出來的,任何一條路徑的 bug 都不會被另外兩條攔下來,補丁只能在單一路徑上打地鼠,結構性問題不會消。這是「先求有、後來想做對又不敢動舊路徑」的典型產物,新專案没有歷史包袱,没有理由重演。
- **丟了損失什麼**:`costLedger` 複式記帳的**設計**(append-only、debit/credit 平衡、`idempotencyKey` 防重)是對的方向,和 IA0 業界對齊建議(冪等計費 ledger+outbox)一致——**只丟「並存不接線」這個狀態,不丟複式帳本這個模式**。新專案應該**直接把複式帳本升格為唯一真相來源**(餘額 = 由 log SUM 算出,不是額外欄位),而不是像現在這樣三選一互相打架。
- **正確做法**:新專案只留一條路徑:複式 ledger 表 + `computeBalance` 算餘額,`deductUserPoints`/`refundUserPoints` 的原子性寫法(FOR UPDATE / CAS)保留,但改寫成「寫 ledger entry」而非「mutate 欄位」;用量統計表若要留,明確定位為「唯讀分析用途,不參與計費判斷」,別再讓它被任何守衛邏輯讀取。
- **對應稽核卡**:W5(計費核心原語)、B-27/B-31/B-32/B-22/X3(計費外圈失效)、IA0(冪等計費 ledger+outbox 業界對齊)、`server/services/cost/ledger.ts` 內部註解自承。
- **工時/風險**:抽取 `ledger.ts` 的複式帳本設計並收斂成單一路徑,估 3-5 天(含把 `deductUserPoints`/`refundUserPoints` 改寫為 ledger-backed、rewrite 守衛讀取路徑);風險中——這是計費核心,收斂過程需要新舊並行跑一段時間對帳(shadow write)才能切換,不能一刀切。

---

## 3. 死表 / 死欄 / 死旗標(SD / FL)

**現況實測**:主稽核已確認 102 張表、0 個外鍵(FK),命名漂移(`userId`/`user_id`/`ownerUserId`/`createdBy` 混用),drizzle schema 快照落後實際 78 張表(DI/SD)。同時散落的 `ENABLE_*` feature flag 數量龐大(`server/agent-rate-limit.test.ts`、`ai-chat-router-gating.test.ts`、`context-packet-*.test.ts`、`orb-agent-killswitch.test.ts` 等測試各自鎖各自的旗標),`docs/research/B-infra.md` D3 條目確認「雙 SSE bus(`generationBus`/legacy `adminEvents` bus vs 統一 `/api/sse`,`UNIFIED_SSE_ROUTER` 預設雙端 OFF)」這類「兩套並存、預設都關」的旗標拓樸不只一處。

- **為何丟**:0 FK 意味著資料完整性完全靠應用層記得住,命名漂移意味著每個新查詢都要先猜一次欄位叫什麼——這兩者疊加就是 DI-01(帳號刪除 100% 失敗)的根因。死旗標(功能已經定案 ON 或 OFF、但旗標與判斷分支還留著)是「連自己都不確定現在到底是哪個狀態在跑」的認知稅,新專案不該從第一天就欠這筆稅。
- **丟了損失什麼**:表結構背後的**業務語意**(哪些欄位對應哪些功能)值得參考,但**表的物理形狀**(命名、缺 FK、缺索引)不該照搬。旗標本身若對應「這功能還沒穩定要能一鍵關」的合理需求,這個機制要留,但**旗標清單要重新起頭**,不繼承現有的「開了忘記關/關了忘記拔判斷分支」的存量。
- **正確做法**:新專案 schema 設計時,(a) 統一單一命名慣例(建議 `snake_case` 或 `camelCase` 二選一,全庫貫徹,遷移工具強制檢查);(b) 所有 `xxxId` 外鍵一律建 FK constraint,交給資料庫做完整性,不靠應用層記憶;(c) feature flag 上線即排「到期日」——超過到期日沒清的旗標算技術債,排進例行治理(可比照 `aidv-board` 的定期稽核精神,但用在旗標而非 Jira 卡)。
- **對應稽核卡**:DI-01(帳號刪除失敗)、DI/SD(schema 落後、命名漂移)、`docs/research/B-infra.md` D3(雙 SSE bus)、FL 類死旗標盤點(`docs/research/I-debt-dormant.md`「沉睡能力目錄」一節,注意:該節同時也記錄了「值得喚醒」的能力,丟旗標時不要連能力一起丟,只丟旗標拓樸)。
- **工時/風險**:新 schema 設計本身不算「丟棄」的額外工時(本來就要設計 schema);風險低,因為是新專案從零開始定規則,唯一要注意的是**不要為了省事直接 `drizzle-kit introspect` 舊庫**——那樣會把命名漂移和缺 FK 原封不動带進來。

---

## 4. Shell 路由 shadow(舊路徑相容導向層)

**現況實測**:`client/src/shells/shellRouteTable.ts` 檔頭註解自承:「這是『舊路由 → 新 shell 前綴』收編 + 相容導向的唯一資料來源」,`LEGACY_REDIRECTS`(舊路徑 → 新 canonical 路徑)在 `ENABLE_4SHELL=ON` 時生效,對舊 `Route` 做 shadow。也就是說,目前的路由表同時背著「新 4-shell 架構」和「舊路由結構的相容殼」兩層,任何一個新頁面的路由決策都要先確認會不會被 legacy 導向規則攔截。

- **為何丟**:相容導向層存在的唯一理由是「有舊使用者書籤/舊連結指到舊路徑」——這個理由在**全新網站**(新網域或至少新使用者群)不成立。繼續帶著這層等於平白多一層路由決策要維護,而且新頁面命名一不小心撞到某條 legacy regex 就會被靜默重導向,是一種隱形的除錯陷阱。
- **丟了損失什麼**:什麼都不損失——這層本質上是遷移期間的過渡設施,新專案沒有「舊路徑」需要相容。唯一要保留的是**4-shell 這個殼層設計本身**(如果新專案認同這個 IA 分法),但要保留的是「4 個 shell 各自的職責邊界」這個設計決策,不是路由表裡混雜的 redirect 規則。
- **正確做法**:新專案的路由表只寫 canonical 路徑,不寫任何 `LEGACY_REDIRECTS`;如果之後真的需要相容旧连结(例如从现有 healing-studio 导流),用一張**明確標註「臨時,预计 X 月後刪除」的獨立 redirect 清單**,不要和主路由表混在一起。
- **對應稽核卡**:`client/src/shells/shellRouteTable.ts` 檔頭註解、`docs/research/G1-video-cockpit.md`(4-shell 預設 ON 但舊頁 `DirectorAI.tsx` 不可達的具體案例,同一類「殼還在但入口已死」的問題)。
- **工時/風險**:零——不寫這層就是了。風險為零,因為新網站没有舊连结要接。

---

## 5. Client 布林當安全邊界(IDOR 反模式)

**現況實測**:`client/src/components/DashboardLayout.tsx`、`ProjectAccessRulesPanel.tsx`、`UsersCreditsTab.tsx`、`AdminPage.tsx` 等多個前端檔案存在「用前端布林變數(`isOwner`/`canEdit`/角色字串比對)決定是否顯示/允許操作」的寫法。主稽核 Y5/CC2 已確認這個反模式**不是單一頁面的疏漏,而是在新開發的程式碼裡持續被複製**——也就是說,即使是後來新寫的功能,工程師仍然習慣性地把授權判斷寫在前端。

- **為何丟**:前端布林只能控制 UI 顯示,不能阻止任何懂得直接呼叫 API 的人繞過去——這是教科書等級的 IDOR(Insecure Direct Object Reference)。「補丁只能打地鼠」是因為問題根源是**架構裡沒有一個集中的物件授權中介層**,每個新 endpoint 都要工程師自己記得在後端也判斷一次,漏一個就是一個洞。如果新專案照抄現有前端元件(連同其中的權限判斷邏輯一起複製貼上),等於把這個反模式的「肌肉記憶」也一起搬過去,新代碼還是會繼續長出同款漏洞。
- **丟了損失什麼**:UI 呈現邏輯(哪些按鈕/面板在什麼條件下顯示)本身沒問題、值得參考,可以照抄「顯示邏輯」;要丟的只是「把這個布林值當作唯一的守門機制」這個心態——新專案裡同樣的前端布林可以留著做 UX(避免顯示使用者用不到的按鈕),但**後端一定要有獨立、集中的授權檢查**,不能假設前端已經擋過。
- **正確做法**:比照 IA0 業界對齊建議,新專案第一天就建立**集中式物件授權中介(centralized authorization middleware)**——所有需要「這個資源屬不屬於這個使用者」判斷的 endpoint 都經過同一個中介函式,不允許 router 各自寫 `if (resource.userId === ctx.userId)` 的散落判斷(這種散落寫法即使在後端也會漏)。前端的 `isOwner` 類布林只保留做顯示用途,並在 code review checklist 明確寫「前端權限布林不得作為安全依據」。
- **對應稽核卡**:Y5、CC2(IDOR 反模式在新碼仍被複製)、IA0(集中式物件授權中介,業界對齊建議)。
- **工時/風險**:新專案設計授權中介層本身估 2-3 天(含測試),風險低——這是「一開始就做對」比「之後全站掃一遍改」便宜得多的典型案例,新專案沒有既有代碼要相容,沒有理由不做。

---

## 6. Over-built 多代理層(orchestrator 疊床架屋)

**現況實測**:`server/services/` 下同時存在至少 5 個獨立的「協調/編排」模組,彼此職責重疊、邊界不清:`agentCollaborationOrchestrator.ts`(888 行)、`orbTaskOrchestrator.ts`(1046 行)、`skillOrchestrator.ts`(453 行)、`multiAgentDetector.ts`(308 行)、`multiAgentIntegration.ts`(272 行),另有 `server/routers/orchestrationRunsRouter.ts`、`spiritTools/orchestratorTools.ts` 等周邊——合計近 3000 行「編排邏輯」,尚不含前面已列的 8087 行 `agentToolExecutor.ts`。這些模組的存在意味著「一次工具呼叫」可能要經過偵測(detector)→ 整合(integration)→ 任務編排(task orchestrator)→ 協作編排(collaboration orchestrator)→ 技能編排(skill orchestrator)多層,每層都有自己的狀態機和邊界條件。

- **為何丟**:這是典型的「先蓋高樓、後來才發現地基不用這麼大」的過度建置——主稽核已指出北極星(ProjectFlowGuide 五步引導)分鏡後在實際使用路徑上斷裂、且 prod 旗標 OFF,也就是說**這套多層編排架構目前並沒有被完整跑通到使用者看得到的功能上**,是「建了但沒真正撐起產品」的架構重量。新專案如果照搬這五個模組,等於把「不確定為什麼需要五層」的認知負擔和「五層之間介面契約」的維護成本都繼承過來,卻拿不到對應的產品驗證。
- **丟了損失什麼**:如果新專案确实需要多代理協作(例如「一個任務要拆給多個角色分工」这类需求),**這裡面可能有一部分狀態機設計(例如任務生命週期的狀態轉換規則)值得參考**,但不建議直接搬檔案——建議由需求出發重新設計「單一路徑」的編排(一個 orchestrator,不是五個彼此调用的),等真的出現「需要偵測」「需要跨技能整合」的具体场景再逐步加,不要一次到位建五層。
- **正確做法**:新專案先只做「一個任務執行器 + 一個狀態機」,對應到 ProjectFlowGuide 五步引導這種**已驗證有效**的單線流程;多代理協作若有明確業務需求(需 Bruce 提供:是否真的需要多角色代理協作分工,或目前只需要單一光球執行工具),再依實際場景增量設計,不要把現有五模組整包搬過去当起点。
- **對應稽核卡**:M2(ProjectFlowGuide 五步引導,= 北極星那張圖,該重用)、E-ai-agents.md(AI 代理架構稽核)、`docs/agent/COMPLETE_ORB_SYSTEM_PLAN.md`/`ORB_SYSTEM_DEPTH_COMPLETION.md`(顯示這套系統經歷多輪「完整計畫」但北極星仍斷裂的落差)、主稽核「北極星分鏡後斷裂+prod 旗標 OFF」。
- **工時/風險**:丟棄零工時;風險是「怕漏掉真正有價值的編排邏輯」——建議花 1 天請熟悉光球系統的人过一遍五個模組,標出「這段狀態機規則之後真的要重建」的子集記錄下來當設計參考,其餘不帶。

---

## 7. Legacy Manus OAuth 殘留

**現況實測**:確認以下殘留(commit 7f4417da 實讀):
- `server/_core/oauth.ts:453-456`——`/api/oauth/manus/start` 路由,檔頭註解自承「替換 Manus 專屬 OAuth 流程,改用標準 Google OAuth 2.0」,此路由現在只做 302 導向到 Google OAuth,是純相容殼。
- `client/src/components/ManusDialog.tsx`——獨立元件檔案。
- `client/public/__manus__/debug-collector.js`——「Manus Debug Collector」,會定期把資料送到 `/__manus__/logs`。
- `client/src/_core/hooks/useAuth.ts:59`——`"manus-runtime-user-info"`字串(疑似 localStorage/session key 殘留舊平台命名)。

- **為何丟**:Manus 是這個專案早期所在的開發平台/runtime,現在已經遷移到獨立 Google OAuth + 自有 runtime。這些殘留是「遷移完成但清理沒做完」的典型尾巴——不影響功能(已經是純相容殼或除錯用途),但每一個都是「新工程師第一次看到會困惑『Manus 是什麼、還要留著嗎』」的認知稅,而且 `debug-collector.js` 這類會對外送資料的殘留元件,在新專案的安全/隱私盤點裡也是不必要的攻擊面(即使目前用途良性,也是「非核心但仍在跑」的代碼,增加稽核範圍)。
- **丟了損失什麼**:零——這些是舊平台的相容殼,新專案沒有 Manus 平台的舊使用者/舊連結需要相容,`debug-collector.js` 的除錯功能如果新專案需要,应該用现代的、有明确文件記載的 observability 工具重建(而非沿用一個以已棄用平台命名、缺乏維護脈絡的舊腳本)。
- **正確做法**:新專案不帶這四處殘留;若需要除錯資料收集,在新專案的 observability 設計裡從头規劃(例如統一走一套有清楚保留期限、清楚資料範圍聲明的 log/telemetry pipeline),不沿用 `__manus__` 這個命名空間或其收集邏輯。
- **對應稽核卡**:G4-misc-audit(雜項稽核,legacy 平台殘留類);`.env.example` 中若有 Manus 相關變數(需核對,未在本次列出但建議一併檢查移除)。
- **工時/風險**:清理本身(如果是在現有 repo 上做)估 0.5 天;但在「新建」情境下工時為零——這四處文件根本不進新專案的初始 commit。風險為零。

---

## 附:七項一覽表(工時為「若要在現有 repo 清理」的估計;新建情境下「不帶」皆為零工時)

| # | 項目 | 為何丟(一句話) | 對應稽核卡 | 現有 repo 清理工時 | 新建情境風險 |
|---|---|---|---|---|---|
| 1 | 178 不可達工具 + 8087 行執行器 | 上帝物件,不知道能不能刪的認知負擔 | 15/25-spirits、Q4 registry 缺口 | 抽取重寫 3-5 天 | 低(需 0.5-1 天覆核挑值得抄的 API 映射) |
| 2 | 三套並存記帳 | 餘額真相不唯一,補丁打不完 | W5、B-27/31/32/22、X3、IA0 | 收斂單一路徑 3-5 天 | 中(需 shadow write 對帳期) |
| 3 | 死表/死欄/死旗標 | 0 FK+命名漂移+旗標拓樸不明 | DI-01、DI/SD、B-infra D3 | 新 schema 設計本就要做 | 低(勿 introspect 舊庫) |
| 4 | Shell 路由 shadow | 相容殼只為舊使用者存在,新站不需要 | shellRouteTable.ts 自承、G1 | 零(不寫即可) | 零 |
| 5 | Client 布林安全邊界 | IDOR 反模式,新碼仍複製 | Y5、CC2、IA0 | 建中介層 2-3 天 | 低(一開始做對比之後全站改便宜) |
| 6 | Over-built 多代理層 | 五層編排疊床架屋,北極星仍斷裂 | M2、E-ai-agents、北極星斷裂 | 覆核挑狀態機規則 1 天 | 低 |
| 7 | Legacy Manus OAuth 殘留 | 遷移尾巴,零功能價值 | G4-misc-audit | 0.5 天(若在現有 repo 清) | 零 |

**總結一句話**:這七類東西的共通性是——它們都是「歷史決策的殼」,不是「已驗證的業務邏輯」。新建網站最大的優勢就是不用背這些殼;真正該搬的是主稽核已標記「對且該重用」的那幾個原語(計費核心、加密、五步引導、`contextPackets`、生成派工),搬運單位是「函式/模組」,不是「整個子系統的檔案」。

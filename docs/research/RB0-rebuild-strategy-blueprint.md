# RB0 — 「用此 repo 當基底新建網站」決策藍圖
- 產生日期:2026-07-04
- 依據 commit:812f6fdb
- 緣起:Bruce 問「如果用這個 GitHub 儲存庫當基底重新新建一個網站呢」

---

## 1. 一句話建議

**推薦選項 C:乾淨地基 + Strangler 移植(port clean-slate + strangler)**——把已驗證零件(W5計費原語、GC3加密、ai-adapters、contextPackets、RAG chunk策略)搬進一個 FK 齊全、有集中式物件授權中介、冪等計費 ledger 的新地基,同時把 8087 行 agentToolExecutor 巨石、三套並存記帳、client 布林安全反模式全部丟棄不帶——**前提是**:Bruce 確認 prod 使用者/資料量不是「即刻凍結不能停機遷移」的規模,且團隊能撐 1.3x-1.6x 工時、短期雙地基並行維運。若 prod 已有大量真實付費使用者且資料遷移是硬約束,則應退回選項 B(原地修復,M0既有立場),先在現庫補授權中介與計費外圈,把 strangler 列為修復完成後的第二階段選項,而非現在就砍掉重練。

---

## 2. 三選項對照表

| 面向 | A. 從零 Greenfield | B. 原地修復(M0既有立場) | C. 乾淨地基移植 / Strangler |
|---|---|---|---|
| 相對工時 | 2.5x–3.5x | 1x(基準) | 1.3x–1.6x |
| 已驗證零件(W5/GC3/M2)命運 | 全部重新發明,重新踩並發/安全的雷 | 保留在原位,但寄生於db.ts巨石與8087行殼 | 搬出零件本體,脫離巨石殼與三套並存記帳 |
| 對北極星(ProjectFlowGuide/M2) | 從零重畫,喪失現有204行UX資產 | UI已存在但分鏡後仍斷裂+prod旗標OFF未變 | 204行UX骨架可原樣port,底層資料流/compose重建,可提前做P1垂直切片並打通端到端 |
| 系統性債(DI-01/Y5/CC2/B-27等) | 不繼承,但等於用最貴方式換取『不繼承』這一件事 | 全部繼承,需逐條打地鼠,回歸風險中高 | 主動丟棄(見第4節),新地基第一天就用FK+授權中介根治,不打地鼠 |
| 資料遷移敏感度 | 最高(一次性大搬遷,無回頭路) | 最低(不遷移,原地補洞;但補FK可能撞既有髒資料) | 中(新舊並行期可漸進遷移/雙寫對帳,回頭路存在但需紀律) |
| 新舊並行維運成本 | 無並行期,但等新站上線前舊站持續累積債 | 無並行期 | 有並行期,on-call/監控雙倍成本,是本選項唯一實質新增風險 |
| 何時選它 | prod使用者≈0 且時程極寬裕(需Bruce提供是否為此情境) | prod有真實使用者+時程緊+資料遷移不可承受任何失敗 | prod使用者存在但可承受漸進切換,團隊能撐雙地基期 |

---

## 3. 移植清單(該搬的好器官)

| 器官 | 判決 | 可移植性 | 工時 | 關鍵風險 |
|---|---|---|---|---|
| 計費核心原語 deductUserPoints/refundUserPoints/atomicClaimJobRefund (W5) | port-algorithm-not-file | 中 | 低(同MySQL,1人日)~中(換Postgres改寫SQL方言+接ledger,3-5人日) | 邏輯值錢但活在5701行db.ts裡,用MySQL專屬JSON_SET等語法,換DB不能複製貼上;整檔搬=把DI-01一起搬 |
| server/services/cost/ledger.ts(postEntry/postTransaction/computeBalance/assertGlobalBalanced) | adopt-on-port | 高(作為新增元件) | 含在上一項工時內 | 已存在但被ENABLE_COST_LEDGER關著,移植時應直接扶正為 source of truth |
| secretCrypto(GC3) | port-as-is | 高 | 極低(0.5人日) | 126行零DB耦合;若要遷移舊站既有密文需帶同一組金鑰(需 Bruce 提供是否遷移) |
| 模型目錄/定價資料層(aiModelsCatalog等) | port-as-data | 高 | 低(1-2人日) | 純資料,搬移時順手清停用模型 |
| falDispatcher.ts 派工引擎本體 | rebuild-not-port | 低 | 中高(5-10人日) | 派工/計費/推播/記憶焊在同一呼叫鏈,整檔搬=把外圈失效與178不可達工具體質一起帶走;只抽queue輪詢+fallback鏈演算法 |
| ProjectFlowGuide+spine(北極星UX,M2) | reference-design-only | 中 | 中(只搬UI範本4-6人日)~高(整套spine gateway,10+人日) | 全倉庫最完整UX,值得當範本;但分鏡後斷裂+prod旗標OFF=從未在生產驗證過,移植價值在設計圖不在「已驗證能動的碼」 |
| contextPacketService.ts | extract-then-port | 中 | 中(4-6人日) | 直接吃db.ts巨石,DataSourceAdapter[]可插拔設計值得照抄,但呼叫方式要重寫成repository介面 |
| fal/replicate/suno整合(ai-adapters/*) | port-as-is | 高 | 低(2-3人日,含補webhook HMAC) | 全倉庫耦合最乾淨的一塊,統一AIAdapter介面;移植時需檢查webhookSuno/webhookReplicate HMAC驗簽是否到位,補上而非複製這個洞 |
| RAG(chunk策略+ragInjectionGuard) | port-algorithm-rebuild-vendor-layer | 中高 | 低(chunk+guard,1-2人日)~中(換vector store,3-5人日) | chunk策略與guard可直接搬;ragMemory.ts寫死Pinecone+gemini-embedding-001,換vendor需重寫;移植前先核實是否為prod活碼(K4) |
| shared/types.ts | critical-coupling-found | 低 | N/A,需先有新schema才能重新產生型別 | 第5行原封不動re-export整份4758行drizzle schema,拿型別=拿DI-01整包債務,無法乾淨分離 |
| shared 零DB相依純工具檔(errors.ts/currency.ts/genId.ts等) | port-as-is | 高 | 低(2人日) | 與schema和orb-*系列脫鉤,可直接搬 |
| ~50個 orb-*.ts | drop-do-not-port | 低 | 中(3-4人日盤點) | 對應178不可達工具debt關聯區,需逐檔白名單挑選,不建議整包搬 |

---

## 4. 丟棄清單(不帶進新專案的債)

| 項目 | 判決 | 理由摘要 | 相關發現 |
|---|---|---|---|
| 178條不可達精靈工具+8087行agentToolExecutor.ts | drop | 實測8087行單檔案上帝物件,做工具註冊/校驗/模型路由/配額/審查/派工六件事;新專案沒有既有使用者依賴,只抽已驗證的fal派工原語,其餘依實際需求重寫5-10支獨立薄殼 | Q4/G3 |
| 三套並存記帳(remainingGenerations直改+costLedger關閉+用量表) | drop並存狀態,ledger設計本身rebuild為唯一路徑 | ledger.ts自承『並行於cost_aggregations、不改既有餘額』,三條路徑互不對帳,是B-27/B-31/B-32/B-22/X3根因;新專案直接把複式ledger扶正為唯一真相來源 | W5,B-27/B-31/B-32/B-22/X3,IA0 |
| 死表/死欄/死旗標(102表0FK+命名漂移+drizzle快照落後78表+雙SSE bus) | drop | 0FK+命名漂移是DI-01(帳號刪除100%失敗)根因;切勿用drizzle-kit introspect舊庫,否則漂移與缺FK原封不動帶進新專案 | DI-01,DI/SD,B-infra D3 |
| Shell路由shadow(LEGACY_REDIRECTS+ENABLE_4SHELL shadow層) | drop | shellRouteTable.ts自承是舊路由收編相容層;新網站沒有舊使用者書籤需相容,保留只會讓新頁面命名意外撞到legacy regex被靜默重導向 | shellRouteTable.ts檔頭,G1 |
| Client布林當安全邊界(IDOR反模式) | drop判斷邏輯,留顯示邏輯 | 多檔案(DashboardLayout/ProjectAccessRulesPanel/UsersCreditsTab/AdminPage)存在此模式且新碼仍複製;前端布林不能擋直接呼叫API的繞過,新專案第一天建中介層,前端布林只做UX顯示 | Y5,CC2,IA0 |
| Over-built多代理層(5個編排模組近3000行) | drop | 五層編排未完整撐起北極星分鏡後路徑且prod旗標OFF,即『建了但沒被驗證撐起功能』的架構重量;新專案先只做對應五步引導的單一路徑編排 | M2(對照組),E-ai-agents |
| Legacy Manus OAuth殘留 | drop | 四處殘留已遷移完成的舊平台相容殼,debug-collector.js對外送資料是不必要的額外攻擊面,零功能價值 | G4 |

---

## 5. 新地基規格摘要

1. **Schema**:統一 ownerId 命名(取代userId/user_id/ownerUserId/createdBy四種並存),所有關聯宣告CASCADE/RESTRICT真FK,scene拆為一級實體表(非JSON塞進project),餘額用插入式ledger而非單一可變欄位,CI加schema-drift-check擋merge。
2. **物件級授權中介**:單一 `authorize(resourceType, action)` 中介,強制所有物件級路由通過;CI lint擋『直接查表未經中介』的PR;agentScopeGuard.ts的設計思路可參考但實作重寫成一般HTTP中介。
3. **冪等計費**:Ledger+Outbox+Webhook HMAC三件套。計費事件一律INSERT到ledger並帶DB唯一idempotency_key(不做先查後寫);扣點與待發事件同一transaction提交,背景worker消費outbox;所有webhook第一天強制驗簽,失敗401拒收。W5的函式簽名/CAS邏輯原樣搬用,只換底層儲存。
4. **旗標紀律**:拆成「能力旗標」(依金鑰有無決定,關閉是正常行為)與「守衛旗標」(關閉即敞開攻擊面/超支風險)兩套獨立系統;守衛旗標(BUDGET/RAG_INJECTION/QUOTA/IDEMPOTENCY等)預設ON且不可用一般env var在生產關閉,CI部署前檢查必須為ON清單全綠才放行。
5. **北極星主幹**:ProjectFlowGuide五步引導UX骨架原樣port;compose(腳本→分鏡→逐幕→拼接→輸出→打包)必須第一天就打通端到端垂直切片,而非先做外圈頁面再回頭接——這正是現庫「分鏡後斷裂」的成因;compose子步驟因非同步失敗模式最容易被低估,應單獨拉一行估工,動工前重讀既有Q1/Q2/M1分析。

---

## 6. Strangler 分階段計畫

**階段一:地基 + Authz + Billing(必須先做,不可延後)**
- FK齊全schema、集中式物件授權中介、冪等ledger+outbox+webhook HMAC
- 同步搬遷 W5(計費原語,改寫為ledger-backed)、GC3(secretCrypto直接複製)
- 這是唯一根治Y5/CC2系統性復發債的節點;若跳過直接搬生成/北極星,新系統會重新繼承IDOR反模式

**階段二:移植生成管線**
- port-as-is:ai-adapters(fal/replicate/suno),補齊webhook HMAC
- extract-then-port:contextPacketService(先剝離db.ts依賴)
- port-algorithm-rebuild-vendor-layer:RAG chunk策略+guard,vector store層視Bruce是否換vendor決定重寫範圍
- rebuild-not-port:falDispatcher只抽queue輪詢+fallback鏈演算法,不整檔搬

**階段三:北極星主幹(可與階段二後段平行,因ProjectFlowGuide體積小耦合淺)**
- ProjectFlowGuide UX骨架port + compose管線端到端重建為P1垂直切片
- 不重複「先做外圈頁面、分鏡後才發現斷裂」的舊模式

**階段四:汰換舊殼(須等階段三小流量驗證後才開始)**
- 逐步關閉8087行agentToolExecutor、三套並存記帳的舊路徑、shell路由shadow層
- 新舊並行期以雙寫/影子對帳驗證後,才切斷舊地基流量

---

## 7. 決策取決於的變數(需 Bruce 提供)

- **prod 是否有真實使用者、量級多大**——若≈0,選項A的機會成本評估會反轉;若量級大,選項C的並行期風險評估需更保守。
- **現有資料量級**——決定是否需要一次性遷移或可漸進雙寫,直接影響選項A/C的可行性。
- **團隊規模能否同時維護新舊兩地基**——選項C的1.3x-1.6x工時建立在有餘裕做並行期監控/on-call的前提上,若團隊小於某規模這假設不成立。
- **時程壓力**——若時程極緊,選項B(1x基準)雖然回歸風險中高但工時最低,可能是唯一可行選項。
- **對「舊債清除」vs「北極星盡快可見」的優先序**——若Bruce要的是儘快有能展示的北極星流程,階段三可考慮提前;若要的是先止血計費/安全洞,階段一優先序不變。
- **是否需保留現有 URL 與資料**(含既有加密密文的金鑰延續)——若需要,secretCrypto搬移必須帶同一組金鑰,且shell路由shadow層不能直接全丟,需評估最小相容範圍。
- **IA0(集中式物件授權中介)設計是否已有團隊共識**——若尚無共識,階段一的中介層設計本身需要先開一輪技術決策,會拉長階段一工時。

---

## 8. 與 M0 的關係

M0既有立場「系統不需重造,需把已對零件解放/接線/補對齊門」是在**修復框架**下成立的結論——它假設的是:巨石代碼可以逐步瘦身、三套並存記帳可以逐一收斂、IDOR反模式可以逐檔補洞,而这些修補動作的**回歸風險低於重建的遷移風險**。

這個假設在以下情況仍然成立,M0立場不應被推翻:
- prod資料遷移不可承受任何失敗(高風險資料如金流記錄、使用者帳戶)
- 時程壓力極高,沒有餘裕支撐新舊並行期
- 系統性債的「復發速度」低於團隊逐條修補的速度(即打地鼠打得贏)

但本波研究指出,現況證據顯示系統性債已經超過「補丁能追上」的門檻:
- Y5/CC2(client布林IDOR)在**新開發的程式碼裡仍在被複製**——代表補丁沒有改變產生債務的路徑,只是在追趕既有洞,新洞持續產生的速度不會因為修復舊洞而減慢
- DI-01(102表0FK)不是單點bug,是**結構性缺陷**,修復需要對102張表逐一補FK,而多數FK補齊時會撞到既有髒資料,修復工作量本身已經逼近「重新設計schema」的量級
- B-27/B-31/B-32/B-22/X3是**同一個缺口**(沒有『一筆事件只記一次帳』的結構性保證)在四處長出的病灶,修復四張獨立票的總工時可能已經超過直接做冪等ledger

**轉折點判準**:當「單點修復的張數」開始逼近「新地基設計本身的工時」,且已驗證零件(W5/GC3/M2)本身**可以脫離巨石殼被搬遷**(而非必須留在原地才能運作)時,strangler比繼續打地鼠更省。本文件第3節逐一確認了這些零件的可移植性(中至高),這是本波與M0原始判斷的關鍵差異——M0成文時尚未逐檔驗證「移植是否可行」,只論證了「修復是否可行」。

兩個結論並不矛盾:M0回答的是「要不要重造」,本文件回答的是「如果選擇某種程度的重造,該怎麼做才不會把債務原封不動搬過去」。最終選A/B/C,取決於第7節列出的變數,而非架構層面已有定論。

# RB3 — 該重建的乾淨地基(新專案第一天就對)
- 產生日期:2026-07-04
- 依據 commit:812f6fdb
- 性質:用此 repo 當基底新建網站的決策研究

> 註:實際檢查時 repo HEAD 為 `7f4417d`(812f6fdb 在本地歷史中查無此 commit,可能是別的分支/尚未 push 的引用)。以下內容以 HEAD 現況為準,與 RB1/RB2 同一批查驗,結論互相銜接。

## 0. 這份文件回答什麼

RB1 回答「照搬什麼」、RB2 回答「丟什麼」。這份回答第三個問題:**新專案的 commit #1,骨架要長什麼樣才不會在第 500 個 commit 之後複製同樣的病?**

前提(不重複主稽核,只取用結論代號):W5(計費原子性)、GC3(secretCrypto)、M2(ProjectFlowGuide 五步)、DI-01(帳號刪除 100% 失敗)、DI/SD(命名漂移+快照落後)、Y5/CC2(IDOR)、B-22/B-27/B-31/B-32/X3(計費外圈失效)、IA0/IA2(業界對齊:授權中介、冪等 ledger+outbox、webhook HMAC)、Q1/Q2/M1(北極星分鏡→拼接)。

本次為落地這份規格,額外查驗了 HEAD 現況,驗證如下(供對照,非重跑稽核):
- `drizzle/schema.ts`(4758 行)命名漂移確有其事:`userId` 405 處、`user_id` 26 處、`ownerUserId` 7 處、`createdBy` 11 處同時並存;全檔 `references(`(FK)僅 **1 處**命中(且是 enum 註解帶到的文字,非真外鍵)——DI-01/SD 成立,不是誇大。
- DB 引擎是 **MySQL**(`mysqlTable`,`drizzle.config.ts`),不是 Postgres。FOR UPDATE 行鎖在 InnoDB 一樣成立(W5 的原子性原語搬過去有效),但下面的「新 schema」章節會以 MySQL 語法為準;若 Bruce 決定新專案換成 Postgres/Supabase(session 中已连了 Supabase MCP,顯示有此傾向),FK/唯一鍵設計原則不變,語法要換。**DB 引擎最終選型需 Bruce 提供**。
- `server/_core/featureFlags.ts` 現有的旗標系統是「**功能**旗標」(依 API 金鑰是否存在決定預設值),不是「**安全/計費守衛**」旗標——兩者命名相似但語意不同,新專案要分開兩個系統,不要混用同一個 `isEnabled()` 入口(見第 4 節)。
- `server/_core/env.validated.ts` 證實 B-22 的「guard 出廠即關」是真的且是**混合狀態**,不是全關:`ENABLE_ORB_BUDGET_GUARD`、`ENABLE_RAG_INJECTION_GUARD`、`ENABLE_ORB_QUOTA_GUARD`、`ENABLE_ORB_IDEMPOTENCY_GUARD` 預設 `false`;但 `ENABLE_ORB_COST_GUARD`、`ENABLE_RETRY_CHAIN_COST_GUARD`、`ENABLE_AGENT_SCOPE_GUARD` 預設 `true`。混合狀態比全關更危險——工程師會誤以為「有 guard 常數就代表有保護」,新專案必須把**預設值本身**當一等公民治理(見第 4 節)。
- IDOR 不是空話:`server/_core/videoIdorConvergence.test.ts` 這個檔名本身就是「曾經(或現在)有 video 資源的 IDOR 收斂測試」的證據,而 `unifiedSseRoute.ts`/`sseRoute.ts`/`orbMemory.ts`/`modelWishesRouter.ts` 目前仍各自手刻 ownership 檢查(`isOwner`/`checkOwnership` 字樣分散在四個不相關檔案裡)——即 Y5/CC2 講的「每個 router 自己刻一次,刻對刻錯看運氣」,沒有中介層。

---

## 1. (a) 新 Schema:FK + 一致命名 + 核心實體

### 1.1 命名規則(先立憲,再寫表)

只留一種外鍵欄位命名法,並在 CI 用 lint 規則鎖死,禁止例外:

- 統一用 `snake_case` 資料庫欄名 + `ownerId`(不要 `userId`/`user_id`/`ownerUserId`/`createdBy` 四選一,四個都砍)。誰擁有這筆資料就是 `owner_id references users(id)`;誰建立但不擁有(如代理人代建)另開 `created_by_id`,語意分離,不要用同一欄位打兩種意思。
- 所有外鍵一律 `xxx_id`,型別與被參照主鍵型別完全一致(舊庫常見「主鍵是 int autoincrement,外鍵卻宣告成 varchar」這種顯性/隱性型別不符,是 DI-01 帳號刪除失敗的根因之一——級聯找不到匹配的行,不是邏輯漏寫,是型別對不上)。
- 建表當下就宣告 `ON DELETE CASCADE`(子實體必須隨父刪除,如 scenes 隨 project 刪除)或 `ON DELETE RESTRICT`(有金流痕跡的表,如 cost ledger、payments,禁止級聯刪除,要求業務先做帳務結清或匿名化再刪)。**不要用「應用層記得手動刪」——這正是現庫 102 表 0 FK 走到 DI-01 的路。**

### 1.2 核心實體(第一天就建對,不是之後加)

```
users (id PK)
  └─ creative_projects (id PK, owner_id FK→users, status, north_star_stage, created_at, updated_at)
        │  ↑ SSOT:一個 project 的「現在在哪一步」只有這張表這一個欄位說了算,
        │    不允許前端本地 state 或另一張表存第二份「目前階段」。
        ├─ scenes (id PK, project_id FK→creative_projects CASCADE, seq_no, status, script_text, storyboard_ref)
        │    ├─ scene_assets (id PK, scene_id FK→scenes CASCADE, kind[image|video|audio], provider, provider_job_id, url, status)
        │    └─ scene_compose_edges (id PK, scene_id FK, next_scene_id FK, transition_type)
        │         ↑ 拼接順序是一級資料,不是靠陣列 index 隱含順序(陣列 index 一旦有人並發插入/刪除就對不齊——現庫已有此類 bug 模式,RB2 有記錄)。
        ├─ generation_jobs (id PK, project_id FK, scene_id FK nullable, provider, model, status, idempotency_key UNIQUE)
        └─ cost_ledger_entries (id PK, project_id FK RESTRICT, user_id FK RESTRICT, job_id FK nullable,
                                  direction[debit|credit], amount, balance_after, reason, idempotency_key UNIQUE)
             ↑ ledger 只 INSERT,不 UPDATE、不 DELETE(見第 3 節)。
```

要點:
- **`creative_projects` 是 SSOT**:任何「這個專案現在進度到哪」的判斷,全站只能查這張表這一個欄位,不能有第二個真相來源(現庫的北極星斷裂,根因之一就是前端/ContextPacket/DB 三邊對「目前階段」各自有一份認知,對不齊時各自信自己的)。
- **scene 是一級實體,不是 project 裡的一個 JSON 欄位**:現庫若把分鏡存成 `creative_projects.storyboard_json`,任何一幕的生成狀態、重試、單幕替換都要整包 JSON 讀寫再存回去,並發下必然互相覆蓋。scene 必須是獨立表、獨立行鎖,才能做到「重跑第 3 幕不影響第 5 幕」。
- **cost ledger 是插入式帳本,不是餘額欄位**:`users.points` 這種單一數字餘額欄位,任何兩個並發請求都能互相覆蓋(即使有 FOR UPDATE,也只解決單一操作的原子性,解決不了「餘額對不對得上發生過的事件」這個可稽核性問題)。新設計餘額 = SUM(ledger entries),餘額欄位只是快取,真相在 ledger。

### 1.3 遷移紀律

- drizzle(或任何 ORM)的 migration 檔與線上 schema 100% 同步是**發版闖關條件**,不是事後任務——CI 加一支「schema drift check」:每次 PR 跑 `drizzle-kit check` 或等效指令,drift 就擋 merge。現庫 DI/SD 講的「快照落後 78 表」不是一次性技術債,是沒有這道門導致的必然結果,新專案第一天就要把門立起來,不是等到落後 78 表才回頭補。

**相對工時**:中(schema 設計 + migration 骨架 + CI drift-check,約 1 個既有中型 sprint 的量級,不含資料遷移)。
**風險**:低(這是新專案自己的地基,不涉及既有生產資料遷移;若之後要把舊庫資料匯入新庫,才會是高風險的資料對帳工作,那是另一個獨立專案)。
**對應稽核卡**:DI-01、DI/SD、W5(ledger 設計沿用 W5 的原子性原語,但改成插入式帳本而非餘額欄位直改)。

---

## 2. (b) 物件級授權中介 —— 解 IDOR 整類

### 2.1 現況病灶(已用 HEAD 驗證)

`unifiedSseRoute.ts`、`sseRoute.ts`、`orbMemory.ts`、`modelWishesRouter.ts` 各自手刻 ownership 判斷,`videoIdorConvergence.test.ts` 這個檔名證實 video 資源至少出現過一次 IDOR 收斂修補。這是 Y5/CC2 講的「client 布林當安全邊界」的具體樣貌之一:每個 router 作者自己決定要不要檢查、怎麼檢查,審查靠人眼記得每一條 route,漏一條就是一個洞。

### 2.2 新專案怎麼做對

不要在每個 router handler 裡寫 `if (resource.ownerId !== ctx.user.id) throw 403`——這種寫法本身就是問題(可以忘記寫、可以寫錯欄位、可以在重構時漏掉)。改成**單一物件授權中介層**,所有需要物件級授權的 route 強制通過它:

```
authorize(resourceType: "project" | "scene" | "job" | "asset", action: "read"|"write"|"delete")
  middleware(req):
    1. 從 route param 取 resourceId
    2. 依 resourceType 查表拿 owner_id(集中在一個 ResourceLocator 映射表,不是每個 router 自己 import 自己的 db query)
    3. 比對 owner_id === ctx.user.id,或 ctx.user 有對應的 team/share 授權記錄
    4. 通過才呼叫下一步;不通過一律 404(不是 403——避免洩漏資源是否存在,這點現庫大多數地方也沒做到)
```

- **這個中介層是新專案唯一合法的授權入口**——CI 用 grep/AST lint 規則檢查「任何直接查 `creative_projects`/`scenes`/`generation_jobs` 且該 route 沒有先過 `authorize()` 中介」就擋 PR。這比事後 code review 抓得住,因為 code review 會累。
- 對照 `agentScopeGuard.ts`(現庫已有,`ENABLE_AGENT_SCOPE_GUARD` 預設 true)——這是同類思路在 agent 工具呼叫層的實踐,說明團隊本來就懂這個模式,只是沒有推廣到一般 HTTP route 層,新專案要把它變成**唯一**模式而非其中一種。
- SSE/長連線 route(現庫 `unifiedSseRoute.ts`/`sseRoute.ts` 這類)特別容易漏,因為它們常在連線建立時做一次檢查就不再複查——新專案設計時,長連線也要在中介層做，且要對「連線期間 resource 被刪除/移交」有處理(訂閱失效通知,不是靜默繼續推資料)。

**相對工時**:中(中介層本身小,但要把現有分散在 4+ 檔案的檢查邏輯收斂成一個映射表,新專案從零開始反而比在舊庫重構便宜)。
**風險**:低(這是新增的骨架約束,不影響業務邏輯;唯一風險是團隊紀律——如果之後有人為了「趕時間」繞過中介層直接查表,整個投資歸零,所以 CI lint 那道門不可省)。
**對應稽核卡**:Y5、CC2、IA0(業界對齊條目本身就是「集中式物件授權中介」)。

---

## 3. (c) 冪等計費:Ledger + Outbox + Webhook HMAC

### 3.1 三個各自獨立又必須串起來的問題

現庫的 B-27(自給點數)/B-31(退款吞錯)/B-32(Stripe stub)/X3(雙重超收)不是四個獨立 bug,是同一個缺口在四個地方長出來的四顆頭:**沒有「一筆業務事件只會被記一次帳」的結構性保證**。新專案要在地基層解決,不是在每個呼叫點補防呆。

**Ledger(插入式帳本,呼應 1.2 節)**
- 每一筆計費事件(扣點、退款、Stripe 入帳)都是 `cost_ledger_entries` 的一行 INSERT,帶 `idempotency_key`(業務語意上唯一,例如 `job_id:refund` 或 `stripe_event_id`)。
- `idempotency_key` 是 DB 唯一鍵,不是應用層先查後判斷再寫(先查後寫在並發下永遠有 race window)——直接 INSERT,吃 unique violation 當作「已處理過,正常返回」處理。這是 B-31「退款吞錯」的根治法:現在退款失敗是因為錯誤被吃掉、狀態不明;插入式 ledger + 唯一鍵讓「這筆退款到底發生過沒」變成一個可以直接查 DB 回答的問題,不用靠 catch block 猜。

**Outbox(領域事件與外部副作用解耦)**
- 任何「扣完點之後還要做别的事」(發通知、觸發下一步生成、同步到分析系統)不要在同一個 request handler 裡同步呼叫外部服務——那是 X3「雙重超收」的路徑之一:扣點成功但下游呼叫失敗又重試,重試時再扣一次。
- 改用 outbox pattern:業務事務(扣點 + 寫 ledger)與「事件待發送」記錄在同一個 DB transaction 裡一起提交;背景 worker 輪詢 outbox 表,逐一發送並標記完成。這保證「錢動了 = 事件一定會發出去恰好一次(at-least-once + 消費端冪等)」,不會出現「錢動了但事件憑空消失」或「扣款和發通知各自成功失敗、狀態不一致」。

**Webhook HMAC(第三方回呼驗證)**
- 所有 Stripe/fal/replicate/suno 等 webhook 入口,新專案第一天就要求驗簽章(HMAC 或供應商 SDK 自帶的簽章驗證),簽章失敗直接 401 拒收,不記錄、不處理。B-32「Stripe stub」講的是「串了但沒做完」,新專案要把「webhook 驗簽是進生產的必要條件」寫進上線 checklist,而不是先上線再補。
- Webhook handler 內部邏輯與 ledger 共用同一套 idempotency_key 機制(用供應商給的 event id 當 key),保證同一個 webhook 被供應商重送 N 次,只落一行帳。

### 3.2 新舊介面的落點

W5 的 `deductUserPoints`/`refundUserPoints`(FOR UPDATE)+`atomicClaimJobRefund`(CAS)是**該重用**的正確原語——新專案把它們的函式簽名原樣搬過去,但底層儲存改成寫 ledger 而不是改 `users.points` 單一欄位(見 1.2)。也就是說 API 介面不變,內部從「改餘額」變成「插 ledger + 用 SUM 算出餘額快取」,呼叫端零感知。

**相對工時**:中高(ledger 表 + outbox worker + webhook 驗簽三塊都要做,但都是成熟模式,不是研發未知數;比在舊庫上「修 B-27/B-31/B-32/X3 四張票」便宜,因為那四張票各自要繞開現有 `users.points` 欄位直改的既有呼叫點,新地基不用繞)。
**風險**:中(outbox worker 是新增的常駐程序,要考慮它自己的故障恢復——worker 掛掉時 outbox 堆積要有告警,不能靜默累積)。
**對應稽核卡**:B-27、B-31、B-32、X3、W5(沿用原語)、IA2(業界對齊條目本身就是「冪等計費 ledger+outbox、webhook HMAC」)。

---

## 4. (d) 旗標紀律:安全/計費守衛預設 ON

### 4.1 現況的真正問題不是「有旗標」,是「兩種旗標混在一起」

HEAD 驗證顯示現庫的 `featureFlags.ts` 是「有沒有金鑰決定要不要開這個功能」的**能力旗標**(沒有 Fal API Key,IMAGE_GENERATION 自然關,關了是正確行為,不是安全問題)。而 `ENABLE_ORB_BUDGET_GUARD`/`ENABLE_RAG_INJECTION_GUARD`/`ENABLE_ORB_QUOTA_GUARD`/`ENABLE_ORB_IDEMPOTENCY_GUARD` 是**守衛旗標**(不開,某個攻擊面或超支風險就是敞開的),語意完全不同,卻用同一套 `process.env.ENABLE_XXX === "true"` 手寫模式散落在 `env.validated.ts`/`orbBudgetGuard.ts`/`ragInjectionGuard.ts` 各處,沒有統一登記表,新人不會知道「有哪些守衛存在、現在誰開誰關」。

### 4.2 新專案怎麼做對

分成兩個獨立系統,不共用同一個 `isEnabled()` 入口:

1. **能力旗標(Capability Flags)**——現庫 `featureFlags.ts` 的模式基本是對的,照搬(RB1 可收錄),依賴外部金鑰決定預設值,關閉時的行為是「這個加值功能不可用,返回明確錯誤」,不涉及安全或金流。

2. **守衛旗標(Guard Flags)**——新開一個獨立 registry,規則反過來:
   - **所有安全類守衛(授權中介、IDOR 檢查、RAG 注入防護、webhook 簽章驗證)一律預設 ON,且不可透過 env var 關閉**——如果某個環境真的需要關(如本地開發沒有簽章金鑰),用明確的 `NODE_ENV === "development"` 分支,不要留一個生產也能用的 `ENABLE_XXX=false` 開關。
   - **所有計費類守衛(額度上限、冪等鎖、超支阻擋)預設 ON**,關閉需要走「有紀錄的例外簽核」——即在 registry 裡關閉某個 guard 這個動作本身要在 code review 被特別標記(例如檔名 `guards.registry.ts` 頂部放一段「任何把下面某項改成 false 的 PR,標題要含 `[GUARD-OVERRIDE]` 並需要第二人 review」的約定,並用 CI 檢查 diff)。
   - Registry 提供 `getAllGuardStatuses()` 這種可觀測介面(仿現有 `getAllStatuses()`),但新增一條規則:**啟動時若任何守衛旗標為 OFF,寫一行 ERROR 級 log(不是現有的 WARN),生產環境的告警系統對 ERROR log 才會真的通知人**——現庫是 WARN,等於沒人看。

3. **上線 checklist 掛勾**:CI/CD 在部署到 production 環境變數集合時,跑一支腳本檢查「守衛 registry 裡列為 `mustBeOnInProd: true` 的項目,是否在目前生效的 env 組合下全部為 true」,不是就擋部署。這是把 B-22「守衛出廠即關」從人治(靠人記得開)變成機器強制(不開就上不了線)。

**相對工時**:低(這是治理層,不是新演算法;主要工作是把現有守衛清單重新分類、寫 registry、接一支 CI 檢查腳本)。
**風險**:低,且是高槓桿投資——這一項做對,能讓後面所有安全/計費相關功能「預設安全」,而不是每個新功能作者自己記得要不要開 guard。
**對應稽核卡**:B-22、IA0/IA2(業界對齊思路)。

---

## 5. (e) 北極星一條龍:第一天就是主幹,不是後加的頁面

### 5.1 現況病灶

M0/主稽核已指出北極星(腳本→分鏡→逐幕生成→拼接→輸出→打包)分鏡後斷裂,且相關 prod 旗標目前是 OFF——即這條路線在現庫是「曾經想打通、目前打不通」的狀態。ProjectFlowGuide 五步引導(M2)是對的**使用者側**設計,問題出在它後面的**資料與生成管線**沒有一路做到底。Q1/Q2/M1 應是既有稽核對「拼接(compose)」這一步的具體描述(該步驟本次未重跑程式碼,沿用其結論:compose 是整條鏈裡最大、風險最集中的一塊)。

### 5.2 新專案怎麼做對:compose 是唯一大件,其餘全是它的前置條件

北極星在新地基裡不是「功能之一」,是**第一個要打通的端到端路徑**,原因:它同時吃到 schema(1.2 的 scenes/scene_compose_edges)、授權中介(2.2,使用者只能操作自己的 project/scene)、計費 ledger(3.1,每一幕生成都要走冪等扣點),三者若分開驗證,銜接處的問題永遠留到最後才會被發現。

執行順序建議(每一步都要求「端到端可跑」,不是「這個模組單元測試過了」):

1. **腳本 → 分鏡**:script 存在 `scenes.script_text`,分鏡拆解結果存 `scenes.storyboard_ref`(指向獨立的分鏡資產,不是塞進同一個文字欄位),每一幕一行,`seq_no` 決定順序但實際拼接順序來自 `scene_compose_edges`(見 1.2,避免陣列 index 對不齊)。
2. **逐幕生成**:每一幕呼叫 `generation_jobs`(帶 `idempotency_key`),生成請求先過授權中介確認呼叫者擁有這個 project,再過計費 ledger 扣點,兩者都失敗要能重試同一個 job 而不重複扣款(這就是為什麼 3.1 的 idempotency_key 設計要先於這一步存在,不能倒著來)。
3. **拼接(compose)——本條主幹裡最大的一塊,單獨拉出來當一個子專案處理**:
   - 輸入是「這個 project 底下所有 scene_assets 依 `scene_compose_edges` 排好的序列」,輸出是一個 job(`generation_jobs.kind = 'compose'`),同樣走 ledger 冪等。
   - 拼接失敗(某一幕素材遺失/格式不符/供應商超時)要能**部分重試**——只重跑失敗的那一幕,不必整條重來;這要求 scene 是一級實體(1.2)且 compose job 記錄「依賴哪些 scene_asset 的哪個版本」,不是依賴「project 現在的狀態」這種會漂移的引用。
   - 拼接是外部服務或本地 ffmpeg 一類重運算,新專案第一天就把它當「可能長時間執行、可能失敗、需要背景 worker+狀態輪詢/webhook 回報」的一等公民設計,不要假設它是一次同步 API 呼叫能搞定的東西(現庫斷裂之處很可能就在這裡——同步假設撞上非同步現實)。
4. **輸出 → 打包**:成品與其生成來源(用了哪些 scene_asset、哪個 compose job)保留可追溯關聯,方便之後retro或計費對帳。

### 5.3 為什麼「第一天就做」而不是「先做別的頁面,之後接北極星」

如果先做使用者管理、儀表板等外圍頁面,再回頭接北極星,會重複現庫的病:外圍頁面各自對 schema/授權/計費做了一套假設,北極星進來時發現假設不一致,又要重新對齊——即現庫「分鏡後斷裂」的成因之一。新專案應該反過來:**先用北極星這一條路徑把 schema(1)、授權中介(2)、ledger(3)三者一起验证过一遍,其余功能都是在这条验证过的骨架上长出来的分支**,而不是先长骨架再长北极星。

**相對工時**:高(這是整個新專案裡工時最大的一塊,尤其 compose 子步驟;建議估工時時把 compose 單獨拉一行,不要併入「北極星」籠統估)。
**風險**:中高(compose 涉及外部生成服務的非同步性與失敗模式,是全專案裡最容易被低估的一塊;M0/Q1/Q2/M1 對這塊已有既有分析,新專案動工前應先重讀那幾份,不要重新摸索)。
**對應稽核卡**:M0、M2、Q1、Q2、M1(北極星/拼接既有分析);同時吃 1(schema)、2(授權)、3(ledger)三節的產出,是驗證前三節設計是否真的可用的第一個真實案例。

---

## 6. 五項的依賴順序(給排期用)

```
1. Schema(FK+命名+核心實體)   ← 地基,其餘四項都長在它上面
2. 物件級授權中介              ← 依賴 1 的 owner_id 欄位
3. 冪等計費 ledger+outbox+HMAC ← 依賴 1 的 cost_ledger_entries + idempotency_key 唯一鍵
4. 旗標紀律                    ← 與 1/2/3 平行可做,越早定越好(否則 2、3 的守衛旗標預設值又要重定一次)
5. 北極星一條龍                ← 依賴 1、2、3 全部就緒;是驗證前三項設計對不對的第一個真實端到端案例
```

**不確定/需 Bruce 提供的項目**(不臆測,列出但不假設答案):
- 新專案 DB 引擎維持 MySQL 或換 Postgres/Supabase(影響 1 的具體 DDL 語法,不影響設計原則)。
- 新專案的 prod 使用者規模、資料量、團隊人數、時程——影響工時估算能落地到「幾週」還是「幾人月」,本文件只給相對工時。
- 現有生產資料是否需要從舊庫遷移進新庫(若需要,是本文件範圍外的獨立資料遷移專案,風險評級會高於本文件任何一項)。

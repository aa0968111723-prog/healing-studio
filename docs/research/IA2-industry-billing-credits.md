# IA2 — 計費/點數系統 業界對照
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:業界對齊研究(外部標竿)

## 範圍與方法
本篇不重查 healing-studio 程式碼(已由既有稽核——B-infra/H1-model-costs/K3-data-integrity 等——確認現況:「雙向壞(該扣未扣/失敗未退、也有超收)+ 守衛對主流量失明+三套記帳不對帳無單一真相源」)。本篇任務是對照 **業界 AI 創作 SaaS(Runway/Pika/ElevenLabs/Suno/Replicate)** 的點數計費做法,以及 **通用計費工程標準**(Stripe 冪等鍵、double-entry ledger、outbox 模式、usage-billing infra 如 Orb/Metronome/Lago),逐點給「業界標準 → 我方差距 → 建議對齊」。

每點標 confidence:
- `線上查證`:本次 WebSearch/WebFetch 查到來源
- `知識`:訓練知識,未能線上查證到一手來源,可能過時
- `待查`:不確定某產品是否有此功能,需要人工/官方文件覆核

---

## 1. 「先扣後轉」vs「先跑後扣」:計費時機點

**業界標準模式**(線上查證):
- Replicate:純用量計費,依實際運算秒數(per-second)於任務**執行完成後**依耗用資源計費;2025-07-16 起新帳戶改為「預付點數(prepaid credit,一年有效、不可退)」,餘額歸零即停止服務([Replicate Billing docs](https://replicate.com/docs/topics/billing), [Prepaid credit](https://replicate.com/docs/topics/billing/prepaid-credit))。
- Suno:訂閱點數按月核發、不可退、不可展延到下月;儲值加購點數不過期但需有效訂閱才能用([Suno help center](https://help.suno.com/en/articles/2550209))。
- ElevenLabs:「每次生成請求即扣點,不是下載才扣」(credits charged per generation request, not per download)([ElevenLabs help](https://help.elevenlabs.io/hc/en-us/articles/13313274666769-Do-I-use-quota-on-every-generation))。
- Runway:「僅在生成明確以錯誤(generation error)結束時才自動退還點數;只要生成有完成輸出(即便品質不符預期/走樣),就不退」([Runway help — Can I have credits refunded](https://help.runwayml.com/hc/en-us/articles/34266159290003-Can-I-have-credits-refunded))。

**業界共同分界線**(所有查到的產品一致):
「**系統性失敗(server error/timeout/管線崩潰)→ 自動退點或不計費**」 vs 「**輸出成功產生但使用者不滿意內容品質 → 不退**」。這條線是業界的計費契約邊界,且都以**任務完成狀態(completed/errored)**、而非「使用者是否點了送出」作為扣費觸發點。

**我方現況/差距**:
既有稽核指出「有的路徑不扣/失敗不退款、有的超收」——代表我方**沒有這條清楚的分界線**,扣款觸發點分散在多個 procedure/服務裡各自決定,而非統一在「任務終態(completed/error)」這單一時刻扣款。

**建議對齊做法**:
1. 明確定義「計費事件」只能由**任務狀態機的終態轉移**觸發(例如 `job.status: completed` 或 `job.status: failed_system`),而不是由前端呼叫時機或個別 studio 頁面各自決定。
2. 訂出我方的退費契約線(建議比照業界):系統性失敗(模型 API 500/timeout/管線異常)→ 不扣款或自動退款;成功產出但主觀不滿意 → 不退,可提供有限次數免費重跑(ElevenLabs 模式)。
3. 把這條規則收斂到單一共用服務(如 `postGenActions`/`doPostGenComplete`),四個 studio(image/video/pro/animation)與未來新 studio 一律呼叫同一收斂點,不得各自繞過——這正是既有稽核 F-1/F-2(`recordGenResult` 缺 `costCredits`、`checkImageStatus` 正確算但沒人呼叫)所指出的分裂現況要收斂的方向。

---

## 2. 冪等計費(Idempotency Key)防止重複扣款/超收

**業界標準模式**(線上查證):
- Stripe:所有計費類 API 呼叫建議帶冪等鍵(建議用內部訂單 ID 或 UUID v4),同一鍵 24 小時(v1)/30 天(v2)內視為同一請求的重放,不會重複執行;鍵不可含敏感個資([Stripe idempotency docs](https://docs.stripe.com/api/idempotent_requests), [Stripe blog](https://stripe.com/blog/idempotency))。
- Orb/Metronome/Lago(AI 用量計費基礎設施,OpenAI 等公司採用 Orb 的 credit model):三者都用「事件層的冪等鍵去重」——同一 idempotency key 重複送出的用量事件只會被記一次;此模式特別針對「應用層自行產生鍵、重試時沿用同一把鍵」設計([HackerNoon 比較](https://hackernoon.com/best-usage-based-billing-platforms-for-ai-companies-in-2026-metronome-orb-stripe-and-alternatives))。

**通用工程原理**(知識,屬業界共識非單一產品):任何「扣款/發放點數」的寫入操作,都應以「(使用者ID, 任務ID/請求ID)」組成的冪等鍵去重,讓網路重試、前端重複點擊、webhook 重送都不會造成雙重扣款或雙重退款。

**我方現況/差距**:
既有稽核明確指出「有超收」的現象——這是冪等鍵缺失/重試路徑未去重的典型症狀(例如前端逾時重送 mutation、或非同步輪詢與 webhook 回呼重複觸發 `doPostGenComplete`)。

**建議對齊做法**:
1. 在所有「扣點/退點」的寫入路徑(不論同步 mutation 或非同步 webhook/輪詢回呼)強制帶入以 `(userId, jobId, action)` 組成的冪等鍵,寫入前先查鍵是否已存在,存在則直接回傳既有結果、不重複扣款。
2. 冪等鍵本身應落地在 ledger 資料表(見下節)的唯一索引上,由資料庫層面保證,而非僅靠應用層邏輯判斷(應用層判斷在高併發下仍可能有 race condition)。

confidence: 線上查證(Stripe/Orb/Metronome 冪等機制部分)+ 知識(冪等鍵通用工程原理)。

---

## 3. 單一真相源:Append-only Double-entry Ledger

**業界標準模式**(線上查證,knowledge 補充):
- 「Ledger 是唯一權威的交易紀錄,append-only 設計,帳戶目前餘額 = 該帳戶所有分錄加總;這給了爭議稽核的證據鏈,也天然是實施冪等的地方」;「計費應能從原始用量日誌離線重算,不能有歧義,這對使用者信任與內部對帳都至關重要」(綜合自 OpenAI/計費架構相關文章的查證結果,見 [Kong metered billing guide](https://konghq.com/blog/enterprise/guide-to-metered-billing-for-apis))。
- Orb/Metronome/Lago 等 AI 用量計費基礎設施的共同模型:「事件計量層(metering)+ 錢包/預付點數(wallet/credits)+ 訂閱,統一成一個資料模型,作為 seats、用量事件、預付點數、企業合約的單一真相源」([Solvimon 比較](https://www.solvimon.com/blog/best-usage-based-billing-2026))。
- Lago 的錢包(wallet)模型:點數可設定到期、展延排程、消耗告警,並直接與權限(entitlements)掛鉤,是 ledger 之上的一層業務規則,但底層仍是同一份分錄紀錄。

**我方現況/差距**:
既有稽核明確指出「三套記帳不對帳、無單一真相源」——這正是業界標準要解決的核心問題:多個系統(例如 generation_history 的 costCredits、使用者點數餘額表、外部金流/訂閱系統)各自維護自己的計數,沒有一個 append-only 分錄表是所有餘額計算的唯一依據。

**建議對齊做法**:
1. 建一張 append-only 的 `credit_ledger`(或等義)資料表,每一筆扣點/加點/退點都是一筆不可修改的分錄(entry),含:`user_id, job_id, delta, reason, idempotency_key, created_at, balance_after`。使用者目前餘額 = 對該 user 的所有分錄加總(或快取 `balance_after` 但仍以加總可重算為準)。
2. 其餘系統(generation_history 的 costCredits 顯示、訂閱扣點、前端餘額顯示)一律「讀」這張表或其衍生視圖,不得各自維護獨立餘額計數。
3. 建立每日/每次部署後的**對帳 job**:比對「原始用量事件(每次生成任務的實際模型呼叫)」與「ledger 分錄」筆數與金額是否一致,不一致則告警——這對應業界「billing 應能從原始用量日誌離線重算」的要求,也直接解決我方「三套記帳不對帳」的問題。

confidence: 線上查證(ledger 原理、Orb/Metronome/Lago 統一資料模型)+ 知識(具體落地到我方 schema 建議屬工程常識延伸)。

---

## 4. 守衛對主流量失明 → Outbox/事件驅動,結構性保證不漏記

**業界標準工程模式**(線上查證):
Transactional Outbox Pattern——「在同一個資料庫交易內,把業務狀態變更與『要發出的事件』一起寫入,由背景程序保證事件最終會被發布;保證的不是 exactly-once,而是『不遺失意圖』——只要資料庫確實提交了狀態變更,系統最終一定會發布這個事實,或留下可稽核的失敗紀錄」([AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html), [Conduktor 說明](https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing))。消費端(即計費守衛)天生需具冪等性,因為傳遞保證是「至少一次」而非「恰好一次」。

**我方現況/差距**:
既有稽核指出「守衛對主流量失明,永不觸發」——這代表計費守衛(guard)是**掛在某條特定程式路徑上被動呼叫**,而多數生成流量(如既有稽核 F-1/F-2 指出的 ImageStudio 同步路徑、或其他繞過 `doPostGenComplete` 的路徑)根本不會走到守衛程式碼。這是典型的「事件發布不是結構性保證,而是仰賴每個呼叫端記得呼叫」的反模式。

**建議對齊做法**:
1. 把「任務完成→扣費」改造成 outbox 式:任務狀態寫入 DB 的同一交易裡,同時寫入一筆「待計費事件」;由一個獨立的背景 worker 專門消費這些事件並執行扣費/守衛檢查,**不再讓計費邏輯掛在四個 studio 各自的 procedure 尾端**。
2. 這樣「守衛失明」問題會被結構性解決:只要任務狀態表有寫入完成紀錄,計費 worker 就一定會處理到,不會因為某個 studio 的程式碼忘記呼叫收斂點而漏記。
3. 守衛(超額用量檢查、異常擋刀)應掛在這個統一 worker 的入口,而不是分散在各 procedure 裡「有沒有想到要呼叫」。

confidence: 線上查證(outbox pattern 原理與保證範圍)+ 知識(套用到我方架構的具體映射屬合理工程延伸,非既定產品實例)。

---

## 5. 成本透明化:每次生成顯示實際花費

**業界標準模式**(線上查證):
- Anthropic:Messages API 回應本身就帶 `usage` 欄位,精確回報每次請求的 input/output token 數,供開發者「即時建立成本儀表板,而非事後估算」;Console 的 Usage & Cost 頁面與 Admin API 提供依 model/日期/API key 拆分的用量與成本([Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api), [Cost and Usage Reporting in Console](https://support.anthropic.com/en/articles/9534590-cost-and-usage-reporting-in-console))。
- 第三方可觀測性生態(Helicone、Langfuse)已把「每一次生成掛上精確的 USD 成本」變成標準功能,反映業界對「per-request cost visibility」的期待已成常態([Torii 文章](https://www.toriihq.com/articles/seven-tools-to-manage-anthropic-api-spend))。
- Replicate:官方模型(official models)採「可預期指標定價」(輸出圖片張數/影片秒數/輸入輸出 token 數),讓使用者在呼叫前就能估算成本([Replicate pricing](https://replicate.com/pricing))。

**我方現況/差距**:
既有稽核(H1-model-costs 等)指出的問題脈絡顯示,我方多處生成流程「扣點寫死或缺欄位」(如 `recordGenResult` 缺 `costCredits`,固定回退成 1 點)——這代表使用者/內部都看不到「這次生成實際花了多少」,更談不上事前估算或事後歸因。

**建議對齊做法**:
1. 比照 Anthropic Messages API 的做法:生成任務的回應(不論同步 mutation 或非同步 status polling)都應攜帶該次呼叫的實際成本欄位(`costCredits`/`estimatedCost`),而不是由呼叫端各自決定要不要帶。
2. 比照 Replicate 官方模型:對可預期定價的模型(次數制、秒數制),在使用者送出前於 UI 顯示「預估花費」,送出後在生成歷史/監控室顯示「實際花費」,兩者可能因模型計費規則不同而有落差,但都應可見、可查。
3. 內部建立「每次生成的預估成本 vs 實際 ledger 扣款」比對報表,用來抓出既有稽核指出的「超收」與「該扣未扣」個案。

confidence: 線上查證(Anthropic/Replicate 具體機制)。

---

## 6. Webhook 簽章驗證(付費/金流相關 webhook)

**業界標準**(線上查證):
- 幾乎所有主流 webhook 供應商(Stripe、GitHub、Shopify、CircleCI、Zendesk、Okta)採 HMAC-SHA256 簽章:供應商用「僅雙方知道的簽章密鑰」對 payload 計算 HMAC 並附在 header,接收端用同一密鑰重算比對。
- Stripe 具體實作:簽章字串為 `timestamp.raw_payload` 串接後以 endpoint signing secret 做 HMAC-SHA256、十六進位編碼;**必須用原始 request body 位元組**(重新序列化 JSON 會因空白/欄位順序不同而讓簽章失敗,順帶避免了「憑 payload 內容重放」風險);比對必須用**常數時間比較**(constant-time compare),不可用 `==`/`===`;密鑰須放在環境變數/密鑰管理服務,絕不硬編碼；並支援兩把密鑰並存以利輪替([Hookdeck 指南](https://hookdeck.com/webhooks/guides/how-to-implement-sha256-webhook-signature-verification), [Stripe webhook 安全指南](https://www.hooklistener.com/learn/stripe-webhook-security-guide))。

**我方現況/差距**:
既有稽核(安全項目)指出「webhook 部分無簽章」——若這些 webhook 是金流/計費相關回呼(如金流供應商付款完成通知、模型供應商任務完成回呼觸發扣款),沒有簽章驗證等同任何人都能偽造「付款成功」或「任務完成」事件,直接可用來偽造加點或觸發不當扣費/退費,是本次計費對齊研究中風險最高的一項,應優先修。

**建議對齊做法**:
1. 所有會觸發帳務變動(加點、扣點、退點、訂閱升降級)的 webhook 一律加上 HMAC-SHA256 簽章驗證,採官方 SDK(若金流商為 Stripe 等有官方 SDK 者)或依上述標準自行實作,並用原始 body、常數時間比較。
2. 簽章密鑰走密鑰管理(對應既有稽核「憑證部分明文」問題,應一併修),支援雙密鑰輪替。
3. 驗簽失敗的 webhook 一律拒絕處理並記錄告警,不可「驗不過也照樣執行」。

confidence: 線上查證(HMAC 標準、Stripe 具體實作細節)。

---

## 7. 綜合對照表

| 業界標準模式 | 我方現況/差距 | 建議對齊做法 | confidence |
|---|---|---|---|
| 扣費綁定任務終態(completed/error),系統性失敗不計費,主觀不滿意不退(Replicate/Runway/ElevenLabs/Suno) | 扣費觸發點分散、有路徑不扣/失敗不退、有路徑超收 | 統一收斂到單一「任務終態→計費」服務,四個 studio 禁止繞過 | 線上查證 |
| 冪等鍵去重扣款(Stripe/Orb/Metronome/Lago) | 超收現象顯示重試/重複回呼未去重 | 扣點/退點寫入前以 `(userId, jobId, action)` 冪等鍵查重,鍵落地資料庫唯一索引 | 線上查證 |
| Append-only ledger 為單一真相源,可離線重算 | 三套記帳不對帳、無單一真相源 | 建 `credit_ledger` 分錄表,其餘系統一律讀此表;建每日對帳 job | 線上查證+知識延伸 |
| Transactional outbox:狀態變更與待處理事件同交易寫入,結構性保證不漏 | 守衛對主流量失明,永不觸發 | 任務完成寫入同交易產生計費事件,獨立 worker 消費,守衛掛在此統一入口 | 線上查證原理+知識延伸應用 |
| 每次生成回傳實際/預估成本,供即時儀表板(Anthropic usage 欄位、Replicate 可預期定價) | 多處扣點寫死(如固定 1 點),看不到實際花費 | 生成回應攜帶 costCredits;UI 顯示預估/實際花費;建對比報表 | 線上查證 |
| Webhook 一律 HMAC-SHA256 簽章、原始 body、常數時間比較(Stripe 等業界標準) | webhook 部分無簽章 | 帳務相關 webhook 全面加簽章驗證,密鑰走密鑰管理,驗簽失敗即拒絕 | 線上查證 |

---

## 待查證事項(不確定,需人工覆核)
- Replicate/Runway/ElevenLabs/Suno 是否對「模型服務商本身逾時但已產生部分輸出」有中間狀態退費規則(半額退款等)——本次查證只找到「完全錯誤退、完全成功不退」兩極,中間態的業界慣例待查證。
- 是否有 AI 生成 SaaS 公開揭露其「守衛/風控」在計費流程中的具體掛載點(如是否也用 outbox/事件驅動),本次未查到任一產品的內部架構一手文件,7 節的 outbox 建議屬於「通用計費工程標準的合理映射」,非特定產品實例,已標「知識延伸應用」。

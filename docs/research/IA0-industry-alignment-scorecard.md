# IA0 — 業界對齊計分卡(北極星流程/計費/安全/AI代理 四面)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:IA1-IA4 業界對照彙整;外部標竿

> 方法論說明:本篇不重新查證,而是把 IA1(北極星流程)/IA2(計費)/IA3(安全)/IA4(AI代理/RAG/連接器)四份業界對照研究的 22 個查證點收斂成一張「我方 vs 業界」計分卡,並串接內部稽核卡給出優先路線。原始查證來源、信心標記(`verified-online`/`from-knowledge`/`needs-check`)全部沿用四份原文,本篇不臆測、不新增未經查證的產品聲明。凡原文信心低於 `verified-online` 者,在計分卡「信心」欄位原樣保留並於第 5 節統一列出待再查證清單。

---

## 1. 對齊計分卡

圖例:🔴 落後(gap)、🟡 部分對齊(partial)、🟢 對齊(aligned,僅差覆蓋面)、🔵 領先/差異化(見第 2 節)。

### 1.1 面 A — 北極星創作流程(flow)

| # | 主題 | 業界標準模式 | 我方現況 | 差距等級 | 對齊修法 | 信心 |
|---|---|---|---|---|---|---|
| A1 | 單一專案為中心的資料模型 | Google Flow SceneBuilder / Runway 節點圖:分鏡→逐幕生成→排序→匯出收在同一專案容器 | 分鏡完成後斷裂,字卡/圖影/聲音三工具與腳本無資料層關聯 | 🔴 落後 | 新增 SceneAssembly/Timeline 一級實體,綁定 script→scene→三軌產出外鍵(呼應既有 Q1/M1 文件) | verified-online |
| A2 | 場景(scene)作為一級實體,三軌歸屬同一 scene_id | Kling storyboard 工具(第三方評測)、Descript Layers 容器把視覺/音訊堆疊在同一 project 下跨 scene 控制 | 三工具各自產出,無 scene 級歸屬,無法回溯三軌對應關係 | 🔴 落後 | 「逐幕」設一級實體,三生成請求必帶 scene_id 並回寫,禁止孤兒素材 | from-knowledge(Kling 為第三方評測,非官方一手) |
| A3 | 字卡由單一真相源驅動並自動連動 | Descript「edit video by editing text」:字卡自逐字稿產生,編輯文字即時連動時間碼 | 字卡與腳本無自動連動機制,修改需人工對齊 | 🔴 落後 | 腳本文字定為單一真相源;修改段落時系統標示哪些下游三軌產出需檢視/重生成 | verified-online(部分細節因官方頁 403 改引第三方轉述) |
| A4 | 拼接(stitch)為系統一級功能 | Runway Stitch 節點:內建把多段生成鏡頭依序合併成單一序列,非使用者手動下載兜接 | 稽核指出拼接服務不存在,是流程斷裂最嚴重一段 | 🔴 落後 | 先做最小可行「依場景序機械式依序合併」,不必一步到位做可視化節點編輯/轉場特效,可落地 Q2-compose-service-spike 雛型 | **needs-check**(Runway 原頁 403,細節僅取自 WebSearch 摘要,需再查證) |
| A5 | 轉碼/輸出/打包:委外代管 vs 自建佇列 | 兩條公開路線:(1) AWS MediaConvert / GCP Transcoder API 委外代管;(2) 自建走事件觸發+訊息佇列(SQS/Pub-Sub)+worker pool 非同步架構 | 打包是死 UI,拼接層與轉碼輸出層兩層皆缺,非選型問題而是整條鏈未落地 | 🔴 落後 | 拼接層(業務差異化)自建;轉碼/封裝層優先評估委外代管或至少改佇列+worker 非同步任務模式,先讓後端有任務狀態機可查,UI 才有東西可畫 | verified-online |
| A6 | 業界最小可行閉環綜合推論 | 貫穿式專案/場景資料模型 + 場景級重生成 + 機械式拼接 + 非阻塞可查詢狀態輸出,四項達成後才談運鏡一致性等進階功能 | 目前四項全缺或斷裂,對應稽核「分鏡後斷裂」完整描述 | 🔴 落後 | 按此四步驟排序修復優先級,不同時鋪開對嘴/角色一致性等進階功能;先接通「腳本→分鏡→逐幕→拼接→輸出」主幹 | from-knowledge(研究員綜合推論,非單一產品逐字聲明) |

### 1.2 面 B — 計費(billing)

| # | 主題 | 業界標準模式 | 我方現況 | 差距等級 | 對齊修法 | 信心 |
|---|---|---|---|---|---|---|
| B1 | 扣費時機點 | Replicate/Runway/ElevenLabs/Suno 一致以「任務終態(completed/errored)」為觸發點,系統性失敗自動退點/不計費 | 扣費觸發點分散在各 studio,有的路徑不扣、失敗不退款、有超收,無統一終態→計費收斂點 | 🔴 落後 | 計費邏輯收斂到單一服務(如 doPostGenComplete),只由任務狀態機終態轉移觸發,禁止 studio 各自繞過 | verified-online |
| B2 | 冪等計費防重複扣款/超收 | Stripe 及 Orb/Metronome/Lago 均以 (使用者/訂單/事件) 組冪等鍵,鍵落地於 DB 唯一索引而非僅應用層 | 有超收,典型症狀是重試/重複回呼(前端逾時重送、輪詢與 webhook 重疊)未去重 | 🔴 落後 | 所有扣點/退點寫入路徑強制帶 (userId, jobId, action) 冪等鍵,用 DB 唯一索引保證 | verified-online |
| B3 | 單一真相源:append-only ledger | Ledger 為唯一權威交易紀錄、append-only,餘額=分錄加總,可離線重算;Orb/Metronome/Lago 統一 metering/wallet/subscription 資料模型 | 三套記帳不對帳、無單一真相源,多系統各自維護獨立餘額計數 | 🔴 落後 | 建 credit_ledger 分錄表(user_id/job_id/delta/reason/idempotency_key/created_at/balance_after);建每日對帳 job 比對原始用量事件與 ledger | verified-online |
| B4 | 守衛結構性不漏記 | Transactional Outbox Pattern:狀態變更與待發布事件同交易寫入,獨立背景程序保證最終發布,消費端天生需冪等 | 守衛掛在特定路徑被動呼叫,多數生成流量根本不會走到守衛程式碼(對主流量失明) | 🔴 落後 | 任務完成寫入 DB 同交易產生「待計費事件」,由獨立 worker 消費執行計費/守衛,不再讓計費邏輯掛在各 studio procedure 尾端自行決定 | verified-online |
| B5 | 成本透明化 | Anthropic Messages API 回應帶 usage 欄位精確回報 token 數;Replicate 可預期指標定價,呼叫前可估算 | 多處生成流程扣點寫死或缺欄位(如 recordGenResult 缺 costCredits,固定回退 1 點),看不到實際花費 | 🔴 落後 | 生成回應一律攜帶實際 costCredits;UI 顯示送出前預估與完成後實際花費;建預估 vs 實際 ledger 扣款比對報表 | verified-online |
| B6 | 帳務 Webhook 簽章驗證 | Stripe/GitHub/Shopify 一律 HMAC-SHA256:對 timestamp+raw body 計算簽章,常數時間比較,密鑰走管理服務並支援輪替 | 部分 webhook 無簽章;涉及計費/任務完成回呼觸發扣款,可被偽造以偽造加點或觸發不當扣費/退費——本輪風險最高一項 | 🔴 落後(risk:🔴🔴) | 觸發帳務變動的 webhook 全加 HMAC-SHA256(優先官方 SDK)、用原始 body、常數時間比較,密鑰走密鑰管理服務,驗簽失敗一律拒絕並告警 | verified-online |

### 1.3 面 C — 安全(security)

| # | 主題 | 業界標準模式 | 我方現況 | 差距等級 | 對齊修法 | 信心 |
|---|---|---|---|---|---|---|
| C1 | Response DTO 白名單(BOPLA) | OWASP API3:2023 明確以「回傳 password_hash」為典型漏洞案例;標準做法是獨立 Response DTO/Schema 白名單,絕不直接序列化 ORM entity | auth.me 等端點直接回傳含 passwordHash 與 2FA 種子欄位(對應內部稽核 S-00,全案最高優先) | 🔴 落後(risk:🔴🔴🔴) | 建顯式 Response DTO 白名單;ORM 層密碼雜湊/2FA seed 預設不可查詢;CI 加 schema snapshot 測試斷言回應不含敏感欄位名稱防回歸 | verified-online |
| C2 | 物件級授權(BOLA/IDOR) | OWASP API1:2023 榜首,約 40% API 攻擊屬此類;標準防法是資料存取層做授權檢查、以當前使用者反查可存取資源集合、不可猜測 ID、記錄授權失敗日誌 | 多處端點存在 IDOR,推測為「先查資料、未反查 owner/tenant」的典型模式 | 🔴 落後 | 集中式授權中介層(guard/middleware)讓 ownership 檢查成為預設行為;高風險端點(專案/資產/帳單/憑證)query 一律改為以 currentUserId/teamId 為條件的複合查詢;補跨帳號存取測試納入 CI/QA | verified-online |
| C3 | Webhook 簽章驗證 | Stripe/GitHub 均要求 raw body + timing-safe 比較 + timestamp 防重放 + 密鑰輪替期新舊並行 | fal.ai 等 webhook 無簽章驗證,任何知道 URL 的第三方可偽造生成完成回呼,可能偽造計費/解鎖狀態 | 🔴 落後 | 所有外部 webhook 要求 HMAC 簽章驗證(raw body)、驗證失敗拒絕並記錄、timing-safe 比較、timestamp 重放窗口檢查、secret 存憑證管理服務並支援輪替;優先修計費/解鎖相關無簽章端點 | verified-online(與 B6 為同一風險的計費/安全雙重視角) |
| C4 | 憑證信封加密 | Envelope Encryption 為 AWS/GCP/Azure 一致內部使用並對外建議標準:DEK(AES-256-GCM)加密資料,KEK(KMS)加密 DEK,亦被 NIST/CSA 引用 | 第三方連接器憑證/API 金鑰部分明文儲存,未做信封加密,未見 KMS/Secrets Manager 整合 | 🔴 落後 | 每筆憑證用隨機 DEK(AES-256-GCM)加密後存 DB,DEK 再用雲端 KMS 的 KEK 加密;過渡期至少應用層 AES-256-GCM+主金鑰存 secret store;憑證僅呼叫當下記憶體解密,不落地日誌,記錄存取稽核 | verified-online |
| C5 | LLM Prompt Injection 防禦 | OWASP Top 10 for LLM 2025 LLM01 列第一;標準緩解為內容隔離標記、深度防禦(輸入驗證+輸出過濾+權限最小化+高風險人工核可)、對抗性紅隊測試;信任邊界不能依賴 LLM 自律 | 光球代理引導會跑偏、client 布林被當安全邊界、action 無白名單、單一專案 RAG 未接、教材未向量化 | 🔴 落後 | 建伺服器端 action 白名單,高風險 action 加人工核可;移除 client 布林作為授權依據,所有操作後端重新驗證;未來接 RAG 時檢索內容獨立角色訊息隔離並明示「參考資料非指令」;建 prompt injection 紅隊測試納入 QA | verified-online |

### 1.4 面 D — AI代理/RAG/連接器(agent-rag-mcp)

| # | 主題 | 業界標準模式 | 我方現況 | 差距等級 | 對齊修法 | 信心 |
|---|---|---|---|---|---|---|
| D1 | AI copilot 的 grounding 邊界 | GitHub Copilot Spaces / Cursor Project Rules / Adobe Firefly-GenStudio Projects 用顯式專案容器限定 AI 資料來源,而非任其全站/全網發散 | 光球逐步引導會跑偏;單一專案 RAG 未接,沒有「本專案容器」把腳本/分鏡/素材收攏成 grounding 來源 | 🔴 落後 | 生成建議前先讀取當前專案腳本/分鏡/素材作為優先資料來源;仿 Adobe Elements 把已確認角色/風格存成專案級可重用錨點;系統提示依階段動態窄範圍載入 | verified-online |
| D2 | 計畫先攤開核准 | Anthropic Claude Cowork/agent 設計:先攤開完整行動計畫供整體審閱核准,執行中可隨時介入;偵測潛在 injection 時自動要求確認 | 光球「逐步引導」缺乏顯式整段計畫呈現與明確暫停/中止控制點,使用者難在跑偏發生前發現 | 🔴 落後 | 多步驟工作(如整幕生成)先產出可讀計畫(含花費點數估算)供一次核准,執行中保留暫停/中止控制點 | verified-online |
| D3 | 工具使用 human-in-the-loop 核准分級 | n8n/Zapier 官方支援依風險分級核准閘:唯讀自動放行,寫入/刪除/發送/花錢類強制暫停,核准畫面顯示完整參數 | action 無白名單,連「哪些動作屬高風險需強制核准」的分類都不存在 | 🔴 落後 | 依可逆性(唯讀/可逆寫入/不可逆寫入)+是否花點數/金錢+是否對外發布,對 agentToolExecutor 全部工具分級;高風險三類插入強制核准閘,顯示完整參數 | verified-online |
| D4 | 不信任 client 端授權旗標(BOLA/confused deputy) | OWASP API Top 10 連年 BOLA 居首:物件層級授權判斷必須伺服端依 (使用者,物件ID) 核驗;MCP 情境對應 confused deputy 問題 | client 布林當安全邊界,多處 IDOR——與業界底線完全相反(與 C2 同根因) | 🔴 落後 | 全面盤點 client 送布林/角色字串後端直接採信的路徑,改為後端依 (userId, 物件ID, 動作類型) 三元組查資料庫關聯自行判斷;未來 MCP client 落實 per-client consent registry 與 token audience 驗證 | verified-online(OWASP MCP Cheat Sheet 原頁 403,僅引 WebSearch 摘要) |
| D5 | RAG 切塊帶上下文(Contextual Retrieval) | Anthropic 官方研究:傳統裸嵌入切塊常丟失上下文;Contextual Embeddings+BM25 使 top-20 檢索失敗率降 49%,疊加 reranking 降 67% | text 教材未向量化,尚未進入 RAG 設計階段——**同時也是機會**,可一開始就採帶上下文切塊而非事後補救 | 🟡 部分對齊(空白畫布優勢,見第 2 節) | TeachingArchive 教材切塊時每片段補「在整份教材中的定位說明」一併嵌入,而非只嵌裸文字;資源允許時疊加輕量 reranking | verified-online |
| D6 | RAG 引用來源可見 | Notion AI Research Mode 每份報告附超連結引用,可限定查特定資料庫/頁面並附引用與原文摘錄供查核 | RAG 未接通,AI 建議無法附「依據哪份教材/哪個分鏡卡」的引用,使用者無從判斷依據 | 🔴 落後 | RAG 接通後,光球引用教材內容一律附可點擊來源(教材名稱+章節);教學型建議優先限定查詢已向量化教材+當前專案脈絡 | verified-online |
| D7 | RAG 語料/向量庫污染防禦 | 研究顯示污染僅 0.04% 語料庫可致 98.2% 攻擊成功率;業界共識把檢索器設計本身當主要安全控制;OWASP LLM Top 10 要求 RAG 稽核涵蓋文件層級權限與向量庫租戶隔離 | 教材/RAG 尚在起步,若未來使用者專案素材進 RAG,既有 IDOR 傾向可能直接複製進向量庫層 | 🟡 部分對齊(尚未發生,趁早設計可避免) | TeachingArchive 向量庫維持僅平台官方教材封閉語料;若未來納入使用者專案素材,查詢先過濾「僅本專案+本使用者可見範圍」,設計 schema 時就做文件級/專案級隔離 | verified-online(部分為 arXiv 預印本,方法論成熟度需保留) |
| D8 | MCP 已成跨供應商產業標準 | MCP 月 SDK 下載 9700 萬次、9400+ 公開 server,Anthropic/OpenAI/Google DeepMind/Microsoft 全數原生支援;2025年12月捐贈 Linux Foundation AAIF,廠商中立治理 | MCP 零基建,package.json 零相關依賴 | 🔴 落後 | 延續 Z1 報告路線(c)自建 MCP client 消費外部 MCP(Canva 已驗證可行、Adobe 待二次確認、Notion 維持手刻 REST adapter),現在是合理接入時間點 | verified-online |
| D9 | 官方連接器 vs 通用自動化平台分工 | Zapier/Make/n8n 提供通用 trigger→action→human-in-the-loop 核准編排層,搭配官方原生整合當 action 節點;創作工具提供專屬 MCP/API 供 agent 整合創作流程 | Notion/Drive 後端有但 UI 分裂,缺把既有連接器統一到單一自動化中樞的一層 | 🔴 落後 | 收斂現有 Notion/Drive 連接器 UI 成單一連接器管理中樞;未來自動化工作流設計成 trigger→action→核准閘(依風險分級)通用骨架,新連接器只需接上 action 節點介面 | verified-online |

---

## 2. 我方領先/差異化之處

並非所有與業界不同之處都是缺陷,以下是可作為賣點、或至少「不必照抄業界」的地方:

1. **腳本卡(Script Card)資料型態可以保留,不必照抄 Descript 逐字稿中心模型**(對應 A3)。Descript 的「編輯文字即編輯影片」建立在逐字稿是天然真相源的前提(口語內容轉錄)。healing-studio 定位是療癒敘事創作,腳本本來就是結構化分鏡卡而非逐字稿——把「腳本文字為真相源」的**精神**對齊業界(單一真相源驅動下游),但保留卡片式資料型態,是比硬套逐字稿模型更貼合我方創作流程的差異化選擇。

2. **RAG 尚未啟動 = 空白畫布優勢**(對應 D5)。多數同業產品的 RAG 檢索是先上線裸嵌入、後續才痛苦 retrofit 成 Contextual Retrieval。我方教材向量化完全尚未開始,可以直接從第一天就採用「切塊帶上下文定位說明」的最佳實踐,不必背負歷史包袱重構,這是「起步晚」在此議題上罕見地轉換成「起步乾淨」的優勢。

3. **計費原子性地基本身健康,不是砍掉重練**(內部稽核 W7 發現 6:「計費 CAS 鎖與終態守門本身寫得紮實——這部分安全網對已有 job 綁定的任務是可靠的」)。B1-B6 的落後主要是**覆蓋面**與**單一入口**未做全(對主流量結構性失明、三套記帳不對帳),而不是核心寫入機制本身有原子性/CAS 缺陷。這代表對齊業界 outbox pattern 的修法是「擴大覆蓋、收斂入口」,執行風險與工作量都低於從零設計新的計費核心。

4. **北極星資料模型已有內部規格雛型,不是從零構思**(對應 A1/A4)。`docs/research/Q1-scene-assembly-editor-spec.md`、`M1-project-spine-assembly.md`、`Q2-compose-service-spike.md` 三份文件的方向已與 Google Flow SceneBuilder、Runway 節點圖的資料模型精神一致,代表規劃成熟度領先於「純落後」的表述——缺的是落地執行,不是缺乏產品判斷力。

---

## 3. 最該優先對齊的 5 條(跨四面,對北極星/信任影響最大)

按「修好後對北極星可信度與使用者資產安全的邊際影響」排序:

1. **【安全+計費雙重最高風險】帳務相關 Webhook HMAC 簽章驗證**(B6 / C3)。同一個缺口同時出現在計費面與安全面的查證結論裡,且明確是「本研究中風險最高的一項」——任何知道 URL 的第三方可偽造生成完成回呼,直接偽造加點/扣費/解鎖。修法路徑明確(對齊 Stripe/GitHub HMAC-SHA256 raw body + timing-safe + timestamp 防重放),投入產出比最高。

2. **【全案最高優先】auth.me 停止外洩 passwordHash/2FA 種子**(C1,對應內部稽核 S-00)。這是唯一被兩份文件都標為「全案最高優先」的單點缺口,任何一次 XSS 即可讀出密碼雜湊並永久繞過 2FA(密碼重設也救不回),屬於「不修就有立即可被利用的帳號接管風險」等級,且修法(Response DTO 白名單)成本低、範圍明確。

3. **計費終態收斂單一服務 + Transactional Outbox**(B1 / B4)。這是「對主流量結構性失明」的根因修法——目前守衛與扣費邏輯掛在各 studio procedure 尾端各自決定要不要呼叫,修好這一條等於同時解決 B1(扣費時機分散)、B4(守衛失明)兩個查證點,是計費面「治本」而非「治標」的槓桿點。

4. **集中式物件級授權中介層解決 IDOR/BOLA**(C2,同時對齊 D4)。這一條同時出現在安全面(OWASP API1:2023 榜首)與 AI 代理面(client 布林當安全邊界、MCP confused deputy),代表同一個根因(伺服端未反查 owner/tenant)在兩個不同查證脈絡下被獨立指出——修一次授權中介層,同時解掉傳統 API 端點的 IDOR 與未來 agent/MCP 工具呼叫的授權漏洞,槓桿最大。

5. **SceneAssembly/scene_id 一級實體**(A1 / A2)。這是北極星流程斷裂的地基性缺口——A3(字卡連動)、A4(拼接)、A6(最小可行閉環)全部建立在「先有貫穿式場景資料模型」這個前提上,不先做這條,後面的字卡自動連動、拼接服務都沒有掛載的容器,屬於「不先做,後面全部做不動」的排序最前置項。

---

## 4. 串接內部稽核卡 — 業界標準如何佐證修法方向

| 內部稽核卡 | 涵蓋範圍 | 業界標準佐證(對應本卡編號) |
|---|---|---|
| `docs/research/GC2-billing-guard-layer.md`(計費守衛層深挖) | orbCostGuard/BudgetGuard/Quota 對主流量結構性失明、`deductCredits`/`reconcileCredits` 吞掉扣款結果、`orbQuota.ts` 假配額 | 業界標準(B1/B4:終態收斂+outbox)直接佐證「守衛不該掛在被動呼叫路徑,應由狀態機終態轉移強制觸發」 |
| `docs/research/W5-billing-core-atomicity-deepdive.md`(計費核心原子性) | 「有扣未退」缺口、記帳多套並存且退款先天不寫入複式帳本、`admin.updateUserQuota` 無交易/CAS | 業界標準(B2/B3:冪等鍵+DB唯一索引、append-only ledger)直接對應修法,且證實我方 CAS 鎖本體健康(見第2節第3點) |
| `docs/research/W7-webhook-billing-safetynet-deepdive.md`(webhook 簽章與計費安全網) | 安全網結構性覆蓋不到 ~20 個端點、`JWT_SECRET` 缺失僅 console.warn、Replicate/Suno webhook 單層 token 無官方簽章 | 業界標準(B6/C3:Stripe/GitHub HMAC 基線)直接佐證第3節優先項1,且此卡本身已列出待補的 20 個具體端點清單 |
| `docs/research/K1-security-bugs.md`(對抗式安全漏洞獵人) | SSRF(generate.ts/ElevenLabs 路徑)、跨租戶 IDOR(teamAssets/teamModels)、硬編超管信箱後門、萬用尾碼白名單 | 業界標準(C2/D4:OWASP API1 BOLA 集中授權)佐證第3節優先項4;K1 的具體 IDOR 案例是 C2/D4 修法的第一批落地目標 |
| `docs/research/V3-security-middleware-deepdive.md`(安全中介層/守衛全套深挖) | `agentScopeGuard` 完全未接線到工具執行引擎、`checkAgentRateLimit` 靠 client 自報標頭繞過、`secretCrypto.ts` 靜默 fallback 共用密鑰 | 業界標準(C4/D3/D4:信封加密、human-in-the-loop 核准分級、不信任 client 旗標)佐證這批發現需要的不是補丁而是架構層授權/加密中介 |
| 00-discussion-taskcards.md 卡 **S-00**(auth.me 洩漏,全案最高優先) | passwordHash/2FA 種子直接回傳 + 前端 localStorage 明文 | 業界標準(C1:OWASP API3 BOPLA)直接佐證第3節優先項2,且業界標準明確定義此為「典型漏洞案例」而非邊緣情況,強化其優先級判斷 |
| `docs/research/Z1-mcp-architecture-strategy.md`(自建 MCP vs 採用外部 MCP) | 八個 MCP 對照表、四條路線選項矩陣、既有現況(MCP 零基建)、首選路線(c)自建 client 消費外部 MCP | 業界標準(D8:MCP 已成跨供應商產業標準、Linux Foundation AAIF 治理)佐證 Z1 的路線判斷「現在接入不算押錯供應商」,兩份文件結論互相印證 |
| `docs/research/Q1-scene-assembly-editor-spec.md` / `M1-project-spine-assembly.md` / `Q2-compose-service-spike.md`(北極星規格雛型) | SceneAssembly 編輯器規格、專案脊柱資料模型、拼接服務雛型 | 業界標準(A1/A2/A4:Google Flow SceneBuilder、Runway 節點圖與 Stitch 節點)直接佐證這三份既有規格的方向正確,修法應「落地既有規格」而非「重新設計」 |

---

## 5. 給 Bruce 的一句話

**業界的計費/安全/北極星/AI代理四條線,收斂到同一個根因:我方目前太多地方讓「前端或被動呼叫路徑」自己決定要不要做授權/計費/簽章驗證,而業界標準(無論是 Stripe 的 webhook 簽章、OWASP 的物件級授權、還是 Transactional Outbox)一致要求把這些判斷收斂到伺服端的單一強制關卡——先把這一個「單一強制關卡」的架構模式鋪好(集中授權中介層 + 計費終態收斂 + webhook 簽章基線),四面的多數落後項會一次補齊,而不是逐一補丁。**

### 需線上再查證的結論(不應直接當作已驗證事實使用)

- **A4(Runway Stitch 節點細節)**:原始說明頁對 WebFetch 回傳 403,現有結論僅取自 WebSearch 摘要,建議實作拼接服務前對 Runway 官方文件再做一次直接查證。
- **A2(Kling storyboard 工具細節)**:來源為第三方評測(melies.co),非 Kling 官方一手文件,細節(如 Voice ID 角色聲音一致性的具體實作)可能與官方描述有出入。
- **D4(OWASP MCP Cheat Sheet / modelcontextprotocol.io 原始頁)**:對 WebFetch 回傳 403,現有結論僅引用 WebSearch 摘要,MCP confused deputy 的具體防禦建議建議再查證官方原文。
- **D7(RAG 語料污染攻擊成功率數據)**:部分佐證來自 arXiv 預印本(未經同行評審),方法論成熟度需保留態度,不宜作為量化決策的唯一依據。
- **A3(Descript 字卡連動細節)**:官方 Timeline overview 頁面對 WebFetch 回傳 403,部分細節改引第三方教學(gotranscript.com)轉述,建議對關鍵行為(如時間碼連動的確切觸發條件)再做直接查證。

以上五項不影響本卡整體修法方向的判斷(方向由多點交叉印證支撐),但若要在對外簡報或合約層級引用具體產品行為描述,應先完成上述再查證。

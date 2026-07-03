# IA4 — AI 代理/RAG/連接器 業界對照
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 性質:業界對齊研究(外部標竿)

## 範圍與方法
本篇不重查 healing-studio 程式碼(已由既有稽核——E-ai-agents/M2-project-agent-guidance/GC4-rag-auth-spirit/U5-skill-system-security-deepdive/X15-automation-engine-deepdive/Z1-mcp-architecture-strategy 等——確認現況:「光球引導會跑偏 + client 布林當安全邊界 + action 無白名單 + 單一專案 RAG 未接 + text 教材未向量化 + MCP 零基建」)。本篇任務是對照**業界 AI copilot/agent 的做法**:(a) grounded/單一專案上下文的 AI copilot(Notion AI、Cursor、GitHub Copilot Workspace/Spaces、Adobe Firefly/GenStudio);(b) 工具使用安全(human-in-the-loop 核准閘、不信任 client 旗標);(c) RAG grounding 業界標準(引用來源、避免語料污染);(d) 連接器/自動化生態(Zapier/Make/n8n、Notion/Adobe/Canva 官方整合)與 MCP 採用趨勢。逐點給「業界標準 → 我方差距 → 建議對齊」。

每點標 confidence:
- `線上查證`:本次 WebSearch/WebFetch 查到來源(本次 session 中多個官方/廠商文件站 WebFetch 回傳 403,故大多數引用以 WebSearch 摘要 + 來源連結呈現,未能逐字 WebFetch 全文,已在該點註明)
- `知識`:訓練知識,未能線上查證到一手來源,可能過時
- `待查`:不確定某產品是否有此功能,需要人工/官方文件覆核

---

## (a) Grounded / 單一專案上下文的 AI Copilot

### a-1 持久化「專案容器」作為 grounding 邊界

**業界標準模式**(線上查證):
- **GitHub Copilot Spaces**:「Space 是一個協作容器——把 repo、issue、文件、自訂指令拉進來,作為 Copilot Chat 持久化的 grounding context」;「當 Space 包含 GitHub repo/檔案時,內容永遠取自預設分支當下狀態,無需另外維護副本或手動同步」([GitHub Blog — Copilot Spaces](https://github.blog/ai-and-ml/github-copilot/github-copilot-spaces-bring-the-right-context-to-every-suggestion/), [GitHub Changelog 2025-05-29](https://github.blog/changelog/2025-05-29-introducing-copilot-spaces-a-new-way-to-work-with-code-and-context/))。
- **GitHub Copilot Workspace 索引機制**:Copilot 對 workspace 建立並維護一個可語意搜尋的程式碼索引,回答問題時會「跑多個工具、檢視結果、自動做後續搜尋直到有把握」——例如收到「幫付款服務加錯誤處理」時,依序用語意搜尋找付款相關程式碼、grep 找既有錯誤處理模式、usages 追蹤呼叫關係、file search 找設定/測試檔、再讀取相關檔案([VS Code docs — How Copilot understands your workspace](https://code.visualstudio.com/docs/agents/reference/workspace-context))。
- **Cursor Project Rules**:2026 官方文件已將舊版單檔 `.cursorrules` 標為 deprecated,改推薦 `.cursor/rules/` 目錄——多檔規則各自綁定檔案 glob + metadata,Cursor 依當下上下文只載入匹配的規則,而非把所有規則塞進每次請求([DEV Community — Best Cursor Rules 2026](https://dev.to/deadbyapril/the-best-cursor-rules-for-every-framework-in-2026-20-examples-29ag), [TeachMeIDEA](https://teachmeidea.com/cursor-rules-cursorrules-project-context/))。
- **Adobe Firefly/GenStudio「Projects」**:「Projects 把素材、生成結果、創作脈絡收在同一處,方便接續先前工作」;「Elements 讓使用者儲存已生成的角色/場景/物件並在後續生成中重複使用,以維持故事/campaign/專案演進過程中的一致性」([Adobe Blog 2026-06-18](https://blog.adobe.com/en/publish/2026/06/18/adobe-firefly-introduces-new-agentic-capabilities-and-an-upgraded-creative-ai-studio-built-for-the-way-you-work));GenStudio 的 Content Production Agent「解讀行銷簡報、自動產出符合品牌準則的跨管道內容」([Adobe News 2025-10](https://news.adobe.com/news/2025/10/adobe-max-2025-genstudio))。

**業界共同模式**(綜合以上,knowledge 補充):這些產品都把「單一專案/單一 Space」當成**顯式的 grounding 容器**——AI 只在使用者明確納入該容器的素材範圍內回答/生成,且容器內容與底層真實狀態(repo HEAD、品牌 Brand Kit、已儲存 Elements)保持同步、無需手動維護副本。這與「讓 AI 自由發散去查整個網路或整個帳號」是相反的預設。

**我方現況/差距**:
既有稽核(M2/GC4/E-ai-agents)指出光球目前「單一專案上下文(RAG)未接」——即使 healing-studio 的產品心智模型本就是「單一專案」(腳本→分鏡→逐幕→拼接→輸出),AI 引導卻沒有一個對應的、範圍受限的「本專案容器」把腳本卡、分鏡、已生成素材收攏起來當 grounding 來源,導致光球引導「跑偏」——這正是業界用「顯式專案容器」解決的問題,我方尚未建立對應機制。

**建議對齊做法**:
1. 仿 Copilot Spaces/Adobe Projects 模式,把「單一專案」實作成光球的**顯式 grounding 容器**:光球每次生成建議前,必須先讀取當前專案的腳本卡、分鏡表、已產出素材列表(而非泛用的全站/全網搜尋),並將這份「專案上下文包」作為唯一或優先資料來源。
2. 仿 Adobe Elements 模式,把使用者在本專案中已確認的角色/場景/風格選擇存成可重用的「專案級素材錨點」,後續逐幕生成都以此為準,而非每幕重新自由發散。
3. 仿 Cursor Project Rules 的「按上下文選擇性載入」精神:光球引導的系統提示不該是一份塞滿全站規則的巨大 prompt,而應依「目前所在階段(腳本/分鏡/逐幕/拼接)」動態載入該階段對應的窄範圍指引,降低跑偏機率。

confidence: 線上查證(GitHub/Cursor/Adobe 官方發布)+ 知識(綜合模式歸納)。

---

### a-2 「顯示計畫、先核准再執行」取代逐步微核准

**業界標準模式**(線上查證):
Anthropic 對 Claude 系列 agent 產品(Claude Cowork 等)的設計原則:「並非每個動作都個別要求核准,而是 Claude 先把完整的行動計畫攤開給使用者看,使用者可以整體審閱、編輯、核准後才開始執行,且執行過程中隨時可以介入」;「當分類器在螢幕截圖中偵測到潛在的 prompt injection 時,會自動導向要求使用者在下一步前先確認」([Anthropic — Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents), [Anthropic — Claude Cowork](https://www.anthropic.com/product/claude-cowork))。另有研究指出:「隨著使用者對 Claude Code 越熟悉,傾向越少逐步審查、放手讓其自主執行,但介入頻率反而提升——代表信任模型是『整體計畫核准 + 隨時可中斷』,而非『每步都要點頭』」([Anthropic — Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy))。

**我方現況/差距**:
既有稽核指出光球「逐步引導但會跑偏」——意味著我方目前既沒有「顯式攤開整段計畫供使用者一次核准」的機制,也沒有清楚的「執行中可隨時介入」控制點,「逐步」本身若又缺乏明確的計畫呈現,使用者難以在跑偏發生前就發現。

**建議對齊做法**:
1. 光球在展開一段多步驟工作(例如「幫我把這幕的字卡+圖+音都生成好」)前,先產出**可讀的整段計畫**(要生成哪些字卡、用哪個分鏡素材、預估花費點數)供使用者一次核准,而非邊做邊逐句對話中隱式決定。
2. 執行中保留明確的「暫停/中止」控制點(呼應下一節 human-in-the-loop 核准閘),不是核准後就變成黑盒直到完成。

confidence: 線上查證(Anthropic 官方研究文章)。

---

## (b) 工具使用安全:Human-in-the-Loop 核准閘 + 不信任 Client 旗標

### b-1 哪些動作必須要有人核准(而非全部或全不需要)

**業界標準模式**(線上查證):
- 「人工核准應存在於:動作具高影響力、不可逆、敏感、或對外可見之處——實務上即寫入操作、資料匯出、發布、第三方授權、任何跨越信任邊界的動作」([MCP 安全相關綜述,經 WebSearch 摘要](https://codersera.com/blog/how-to-secure-mcp-servers-2026/))。
- n8n 官方文件:「工具需要人工審查時,工作流程會暫停,等待人核准(工具依 AI 指定輸入執行)或拒絕(動作取消、不執行);此功能讓開發者可以選擇性地對高風險工具(如發送訊息、修改紀錄、刪除資料)加開額外審查」([n8n Docs — Human-in-the-loop for AI tool calls](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools/))。
- Zapier:「Human in the Loop 是一個內建工具,可以在特定步驟暫停 Zap,讓人在工作流程繼續前先審查」,並可與「AI Guardrails by Zapier」(即時掃描 AI 輸出是否含 PII/prompt injection/毒性內容)搭配使用([Zapier Help — Request approval to keep your workflow running](https://help.zapier.com/hc/en-us/articles/38731463206029-Request-approval-to-keep-your-workflow-running-with-Human-in-the-Loop), [Zapier Blog — AI Guardrails](https://zapier.com/blog/ai-guardrails-guide/))。

**業界共同分界線**:核准閘不是「全部動作都要人按確認」(那樣體驗太差),而是依**動作的可逆性/影響範圍**分級——讀取/預覽類自動放行,寫入/刪除/花錢/對外發布類強制核准。

**我方現況/差距**:
既有稽核指出「action 無白名單」——代表我方目前連「哪些動作屬於高風險、需要強制核准」這個分類都不存在,而不僅是核准機制本身缺失。沒有白名單分級,就無從談「選擇性核准閘」。

**建議對齊做法**:
1. 先把 `agentToolExecutor.ts`/`GLOBAL_AGENT_TOOL_REGISTRY` 中的每個工具依「可逆性(唯讀/可復原寫入/不可逆寫入)+ 是否花費點數/金錢 + 是否對外發布」分級,產出一份顯式白名單(呼應 Z1 報告已指出的 178/38 gate 缺口,這是修復 gate 的同一份工作可以順便完成的分類)。
2. 對「花費點數的生成」「刪除/覆蓋既有素材」「跨系統對外動作(webhook/發布/分享連結)」三類,仿 n8n/Zapier 模式插入強制核准閘,核准前把工具名稱與**完整參數**攤開給使用者看(不只顯示動作摘要),核准後才真正呼叫。
3. 唯讀/預覽類動作(如「幫我看這個分鏡」)維持自動放行,避免核准閘拖累主流程體驗——分級本身就是對齊業界「不是全有全無」的關鍵。

confidence: 線上查證(n8n/Zapier 官方文件)+ 知識(分級原則)。

---

### b-2 不信任 Client 端旗標:一切授權判斷收斂到伺服端、依物件層級檢查

**業界標準模式**(線上查證):
- OWASP API Security Top 10「Broken Object Level Authorization(BOLA)」自 2019 年起連續蟬聯 API 資安風險第一名:「核心原則是永遠不信任 client,一律在伺服端、依物件層級落實授權;BOLA 發生在 API 未能在伺服端落實授權檢查、反而盲目信任 client 提供的物件識別碼(使用者 ID/訂單 ID/帳號等)」([OWASP API Security — API1:2023](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/), [StackHawk](https://www.stackhawk.com/blog/understanding-and-protecting-against-api1-broken-object-level-authorization/))。
- MCP 情境下的對應問題是「confused deputy(混淆代理人)」:「MCP server 用自己(通常較廣)的權限執行動作,而非請求者本人的權限——擁有權限的系統被誘騙,代表不該有此權限的人動用了該權限」;防禦做法包括「per-client 同意登記表(per-client consent registry):MCP proxy server 須為每個使用者維護一份已核准 client_id 名單,未知 client_id 嘗試存取時要拒絕或要求重新同意」([WebSearch 摘要,綜合 OWASP MCP Security Cheat Sheet / Tyk / Checkmarx 等,原始文件站對 WebFetch 回傳 403 故僅能引用搜尋摘要](https://cheatsheetseries.owasp.org/cheatsheets/MCP_Security_Cheat_Sheet.html))。
- 同一資料來源另指出的具體控制:「開啟 OAuth 2.1 授權且強制 PKCE、驗證 token 的 audience 使其只接受為自己簽發的 token、絕不把 client token 原封轉發給上游 API、對每個工具輸入都做白名單與驗證」「顯示完整的工具呼叫參數給使用者看,而不只是摘要名稱;絕不自動核准工具呼叫,尤其在多 server 情境下」「在核准時對工具描述做 hash,描述變更時要求重新核准,以防禦『rug pull』(工具描述事後被偷換)」。

**我方現況/差距**:
既有稽核明確指出我方「client 布林當安全邊界」——這正是 BOLA/confused deputy 的典型症狀:授權判斷（例如「這個使用者能不能動這個物件/這個動作允不允許」）被放在前端可竄改的旗標上,而非伺服端依當前登入使用者 + 目標物件重新核驗。這與業界「一切物件層級授權判斷必須在伺服端」的底線完全相反。

**建議對齊做法**:
1. 全面盤點所有「client 送一個布林/角色字串,後端直接採信」的路徑,改為「後端依 `(當前登入 userId, 目標物件 ID, 動作類型)` 三元組,查詢資料庫關聯後自行判斷是否授權」,不接受任何 client 端聲稱的授權結果。
2. 對外接的每個工具呼叫(含未來 MCP client 消費 Adobe/Canva/Notion 時),伺服端要能重新核驗「這個 token/session 對應的使用者,是否真的擁有操作這個專案/這個素材的權限」,不可因為某個中介層(如光球會話狀態)聲稱已核可就略過。
3. 若未來走 Z1 報告路線 (c) 自建 MCP client 消費外部服務,務必落實「per-client 同意登記表」與「token audience 驗證」,避免把既有 BOLA 缺口複製進新連接器。

confidence: 線上查證(OWASP API Security 官方文件 + MCP 安全綜述,惟 MCP 一手文件本次 WebFetch 遭 403,以 WebSearch 摘要引用)。

---

## (c) RAG Grounding 業界標準:引用來源、避免語料污染

### c-1 Contextual Retrieval:切塊要帶上下文,而非裸嵌入

**業界標準模式**(線上查證):
Anthropic 官方研究:「傳統 RAG 方案在切塊編碼過程中經常丟失上下文,導致系統無法從知識庫中正確檢索相關資訊」;提出「Contextual Embeddings + Contextual BM25」——為每個切塊補上其在原文件中的上下文說明再嵌入。實測數據:「Contextual Embeddings 使 top-20 切塊檢索失敗率降低 35%(5.7%→3.7%);Contextual Embeddings + Contextual BM25 合併降低 49%(5.7%→2.9%);再加上 reranking 合併降低 67%(5.7%→1.9%)」([Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval))。

**我方現況/差距**:
既有稽核指出「text 教材未向量化」——即我方連最基本的「教材進 RAG」這一步都還沒做,自然也談不上 Contextual Retrieval 這類進階優化。但這也是機會:與其重複業界「先上裸嵌入、之後才發現準確率不夠再補救」的路徑,可以一開始切塊時就採用「帶上下文」設計。

**建議對齊做法**:
1. TeachingArchive 教材向量化時,切塊(chunking)階段就為每個片段生成一句「這段在整份教材中的定位說明」(例如「這是《OO腳本課》第3講「開場鉤子」小節,講解如何在前3秒抓住觀眾注意力」)一併嵌入,而非只嵌入裸文字片段。
2. 若未來資源允許,在切塊嵌入後加一層 reranking(可先用開源/低成本 cross-encoder),對齊業界「reranking 疊加後檢索失敗率再降近一半」的做法。

confidence: 線上查證(Anthropic 官方工程部落格,含具體實測數字)。

---

### c-2 引用來源(Citations)是 grounding 的可見產出,不是內部細節

**業界標準模式**(線上查證):
- Notion AI Research Mode:「每份報告都附帶超連結引用,使用者可清楚看到洞見來源、需要時可深入查證」;可「限定 AI 只查特定資料庫或某頁面連結的頁面,並要求附上引用與原文摘錄以供查核」([Notion Help — Research Mode](https://www.notion.com/help/guides/power-your-deep-work-using-research-mode-in-notion))。
- 「Grounding 的定義是把模型輸出錨定在外部、可驗證的參考來源上,用以降低幻覺、穩定實體辨識」([WebSearch 綜合摘要](https://groundingpage.com/facts/grounding/))。

**我方現況/差距**:
我方 RAG 尚未接通(教材未向量化),也就沒有「AI 引導建議附上『這是根據哪份教材/哪個分鏡卡』的引用」這層產出。跑偏問題某種程度上正是「AI 給建議時使用者無從判斷這建議依據什麼」的體驗症狀——業界解法是把引用變成使用者看得到的產出,而不只是內部技術實作。

**建議對齊做法**:
1. RAG 接通後,光球任何引用教材內容產生的建議,UI 上都應附上可點擊的來源(教材名稱+章節),讓創作者能像 Notion Research Mode 一樣「深入查證」,而非把 AI 建議當黑盒接受。
2. 光球引導若涉及「這一步該怎麼做」的教學型建議,優先限定其只查詢已向量化的 TeachingArchive + 當前專案脈絡(呼應 a-1 的專案容器),而非放任模型自由發散生成無來源可查的內容——這也是抑制「跑偏」的直接手段。

confidence: 線上查證(Notion 官方說明)。

---

### c-3 語料/向量庫污染防禦:檢索設計本身是主要防線

**業界標準模式**(線上查證):
- 「在千萬文件規模的知識庫中注入僅 5 篇惡意文本,即可達成 90% 攻擊成功率;僅污染 0.04% 的語料庫,就能達成 98.2% 攻擊成功率、74.6% 系統失效率」——即所謂 PoisonedRAG 類攻擊([WebSearch 摘要,綜合多篇 2026 年 arXiv 論文與 Lasso Security 部落格](https://www.lasso.security/blog/rag-security))。
- 「混合檢索(hybrid retrieval)優於單純的偵測方法,應把檢索器設計本身當作主要安全控制,偵測/監控只是輔助;混合檢索可阻止梯度導引式的中毒攻擊,因為對抗性文件根本不會被檢索到」([WebSearch 摘要,綜合 arXiv 2606.11265 等論文](https://arxiv.org/abs/2606.11265))。
- OWASP LLM Top 10(2025):「Data and Model Poisoning(LLM04)——攻擊者操縱訓練資料、微調資料集或嵌入儲存庫,植入後門/偏誤/可被利用的行為」;「RAG 稽核應檢視文件層級權限、向量庫的租戶隔離、嵌入反演風險、語料污染與經檢索內容外洩的可能性;向量庫存取控制不足可能導致跨租戶的敏感資料外洩」([WebSearch 摘要,綜合 OWASP LLM Top 10 相關文章](https://www.kodemsecurity.com/resources/owasp-top-10-for-llm-applications))。

**我方現況/差距**:
我方教材/RAG 尚在起步(未向量化),目前談不上「已有語料被污染」的風險,但這正是**設計期就該內建防禦**的階段——若等到向量庫上線後才補防禦,成本會遠高於一開始就選對架構。既有稽核也指出多處 IDOR(物件級授權缺失),若未來向量庫與多使用者/多專案資料混放,「文件層級權限」與「租戶隔離」這兩項若沿用現有 IDOR 傾向,風險會直接複製進 RAG 層。

**建議對齊做法**:
1. TeachingArchive 向量庫的資料來源應維持「僅平台官方教材」的封閉語料(而非開放使用者自由上傳任意文件進全站共用向量庫),从架構上就避免第三方注入惡意文件的攻擊面。
2. 若未來允許使用者專案素材也進入 RAG(例如把腳本卡/分鏡內容向量化以強化「單一專案上下文」,見 a-1),必須在向量庫層面實作**文件級/專案級隔離**——查詢時先過濾「僅本專案 + 本使用者可見範圍」,不可讓 A 使用者的查詢檢索到 B 使用者的專案內容,這與既有稽核指出的 IDOR 缺口是同一類風險,必須在設計 RAG schema 時就避免,而非事後補丁。
3. 若之後接受外部/使用者提供的知識來源(呼應連接器生態),納入前應有基本的來源可信度分級與異常內容偵測,對齊「檢索器設計本身是主要安全控制」的業界共識,而非僅依賴事後偵測。

confidence: 線上查證(2026 年安全研究/OWASP,惟部分為 arXiv 預印本,方法論成熟度需保留)。

---

## (d) 連接器/自動化生態 與 MCP 採用趨勢

### d-1 MCP 已成跨供應商產業標準(呼應 Z1)

**業界標準模式**(線上查證):
「Model Context Protocol 已成為 AI agent 整合的事實標準,每月 SDK 下載量達 9,700 萬次、超過 9,400 個公開 server,並獲得所有主要 AI 供應商——Anthropic、OpenAI、Google DeepMind、Microsoft——原生支援」;「2025 年 12 月,Anthropic 將 MCP 捐贈給 Agentic AI Foundation(AAIF),這是 Linux Foundation 底下由 Anthropic、Block、OpenAI 共同創立的指導基金,確立 MCP 作為廠商中立開放標準、由社群治理而非單一公司決策」;「Google 已於 2025 年 12 月將 MCP 導入自家服務,為 Google Maps、BigQuery、Compute Engine、Kubernetes Engine 推出完全託管的遠端 MCP server」([Medium — MCP at 97 Million](https://medium.com/@AdithyaGiridharan/mcp-at-97-million-anthropics-protocol-bet-has-already-won-the-standard-for-agentic-ai-8601151b3f46), [Anthropic — Donating MCP / AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation), [CIO Dive](https://www.ciodive.com/news/big-tech-develop-open-standards-agentic-ai/807608/))。

**我方現況/差距**:
與 Z1 報告完全一致的結論:healing-studio「MCP 零基建」,`package.json` 無任何 `@modelcontextprotocol` 依賴。此次線上查證進一步確認——這不只是我方進度落後,而是整個產業(含 Google 這類原本觀望的巨頭)已在 2025 年底集體轉向 MCP,錯過採用窗口的機會成本正在提高(生態工具/官方連接器數量持續增長,越晚接入,補課成本越高)。

**建議對齊做法**:
維持 Z1 報告既有結論——路線 (c)「自建 MCP client 消費外部 MCP」(Canva 已驗證可行、Adobe 待二次確認、Notion 維持手刻)是成本效益最佳的切入點,本次查證進一步強化其急迫性:MCP 治理已移交中立基金會,不存在「押錯供應商」的風險,現在是接入的合理時間點。

confidence: 線上查證(Anthropic 官方公告 + 多篇產業分析)。

---

### d-2 官方連接器 vs 自動化平台(Zapier/Make/n8n)的角色分工

**業界標準模式**(線上查證+知識):
- Zapier/Make/n8n 三者均已支援「AI agent 呼叫外部工具 + human-in-the-loop 核准」的組合模式,例如「AI agent 監控 Slack 頻道的客服請求、判斷意圖、查詢 PostgreSQL 帳號資料、用 OpenAI 草擬個人化回覆、貼回頻道——中間插入人工核准步驟才真正送出」([Cybernews 綜合比較](https://cybernews.com/ai-tools/n8n-vs-zapier/))。
- 這類通用自動化平台的價值在於「trigger → action」的**通用編排層**,搭配官方原生整合(Notion/Google/Slack 等)當作 action 節點;而 Adobe/Canva 這類「創作工具」則傾向提供**自己的官方 MCP/API**,讓專門的創作流程(生成/編輯/匯出)被直接整合進 agent,而不是全部塞進通用自動化平台的 action 節點裡。

**我方現況/差距**:
既有稽核指出「Notion/Drive 後端有但 UI 分裂」——代表我方已有兩個官方連接器的技術基礎,但欠缺把它們統一到「使用者可感知的單一自動化中樞」這一層,這正是 Zapier/Make/n8n 給業界使用者的核心體驗(不管底層接了幾個服務,使用者在同一個地方設定 trigger→action→approval)。

**建議對齊做法**:
1. 不需要重造 Zapier——但應把現有 Notion/Drive 連接器 UI 收斂成單一「連接器管理中樞」頁面,呈現一致的授權狀態/範圍/最後同步時間,而非分散在各自的功能角落(呼應既有 Y6-connectors-ui-frontend 稽核)。
2. 未來若真的做「自動化工作流」(北極星支柱③),優先設計成「trigger → action → 核准閘(依 b-1 分級)→ 執行」的通用骨架,和 Notion/Drive/未來 Adobe/Canva 官方連接器解耦,新增連接器時只需接上這個骨架的 action 節點介面,而非每個連接器各自重造一套流程。

confidence: 線上查證(Zapier/n8n/Make 官方與綜合比較文章)+ 知識(架構建議部分為推論)。

---

## 總結:對北極星與既有稽核缺口的直接映射

| 既有稽核缺口 | 本篇對應業界標準 | 建議對齊做法(摘要) |
|---|---|---|
| 光球逐步引導但會跑偏 | a-1 顯式專案容器 grounding;a-2 攤開整段計畫先核准 | 建立「本專案 grounding 容器」+ 生成前攤開計畫供核准 |
| client 布林當安全邊界 | b-2 OWASP BOLA/confused deputy:一切授權判斷收斂伺服端 | 全面盤點並改為伺服端 `(userId, 物件ID, 動作)` 三元組核驗 |
| action 無白名單 | b-1 human-in-the-loop 依可逆性分級核准 | 先分級(唯讀/可逆寫入/不可逆寫入/花費點數),再對高風險類插入核准閘 |
| 單一專案上下文(RAG)未接 | a-1 專案容器;c-2 引用來源;c-3 語料隔離 | RAG 上線時內建專案級隔離 + 附引用來源 UI,勿事後補丁 |
| text 教材未向量化 | c-1 Contextual Retrieval | 切塊時即帶上下文說明,一開始就對齊業界較高準確率做法 |
| Notion/Drive UI 分裂、MCP 零基建 | d-1 MCP 已成跨供應商標準;d-2 通用自動化平台角色分工 | 收斂單一連接器中樞 UI;呼應 Z1 走路線 (c) 自建 MCP client(Canva 優先) |

---

## 查證侷限說明
本次多個官方/廠商一手文件站(`modelcontextprotocol.io`、OWASP MCP Security Cheat Sheet、Checkmarx、Semgrep、Christian Schneider 部落格等)對 WebFetch 直接請求回傳 HTTP 403,故上述引用多數以 WebSearch 回傳的摘要與連結佐證,未能逐字核對一手全文。建議團隊實際落地對齊做法前,人工二次開啟這些連結覆核細節(尤其 OWASP MCP Security Cheat Sheet 的具體控制清單),不應僅憑本篇摘要作為實作依據。

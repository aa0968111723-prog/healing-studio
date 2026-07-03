# Z1 — 自建 MCP 原生系統 vs 採用外部 MCP：架構策略研究（研究討論開發專區 wave Z）
- 產生日期：2026-07-03
- 依據 commit：812f6fdb
- 緣起：Bruce 提「也可以考慮自建一套自己的系統，並參考這些 MCP 去研究」

---

## 0. 方法論與查證狀態說明

本報告整合四份既有研究筆記（知識類 MCP、網路/資料類 MCP、執行類 MCP、既有 MCP/連接器/工具代碼盤點），並在撰寫本報告的過程中**額外執行了兩項新查證**（見下），其餘沿用四份筆記各自標註的查證狀態，逐條標明性質，不重新臆測：

- **〔程式碼實證〕**：本報告或來源筆記作者直接 Read/Grep 過 healing-studio 程式碼確認。
- **〔線上查證〕**：來源筆記或本報告用 WebSearch/WebFetch 於 2026-07-03 當日核實。
- **〔MCP 一般知識，可能過時〕**：僅憑訓練知識（截止 2026-01）作答，未重新上網核對，需視為可能過時。
- **〔未經查證 / 需團隊自行確認〕**：來源筆記或本報告明確承認未能查清。

**本報告新增的兩項線上查證**（其餘 MCP 事實沿用四份來源筆記，未重複驗證）：
1. WebSearch 確認 **Canva 官方 MCP**：`https://mcp.canva.com/mcp`，官方遠端托管、OAuth2（DCR）認證，Claude/ChatGPT/Codex/Gemini 等已原生支援——與 Q5 筆記「已確認存在」的結論一致，**再次獨立核實通過**。
2. WebSearch + **實際工具呼叫**確認 **Adobe 官方 MCP 確實存在**：`developer.adobe.com/adobe-for-creativity/`，本次 session 內已用 `mcp__Adobe_for_creativity__adobe_mandatory_init` 與 `get_account_type` 實測，回傳 `{"account_type":"auth"}`——證實這是一個真實、已認證、當下可呼叫的官方 MCP 介面，涵蓋 Photoshop/Lightroom/Illustrator/Firefly/Premiere/Express/InDesign/Stock。此舉解決了 Q5 筆記先前「Adobe Firefly 官方 MCP 端點存在性未能 100% 查證」的缺口之**一半**——**但有重要保留**：本次驗證到的是「Adobe for Creativity」這個連接器在 **Claude 生態內**（本 session 的工具清單）可用且已認證，**並未證實 healing-studio 自己的 Node 後端能否以同等方式，繞過 Claude 直接對接同一個端點**。搜尋結果中另外混雜一個完全無關的同名產品「`gofireflyio/firefly-mcp`」（雲端治理工具，非 Adobe 出品），以及一則「某 Firefly MCP 整合將於 2026-04-30 廢止」的公告，但無法確認該公告針對的是官方版本還是社群版本——**此點標記為需團隊自行向 Adobe partner engineering 二次確認，不應僅憑本次 session 內驗證就假設「healing-studio 後端可以直接掛上去」**。

其餘 MCP（Hugging Face、arXiv、Research Tracker、Exa、Tavily、Bright Data、JSON MCP、MCP Run Python、Playwright MCP）之能力/成熟度/授權/成本細節，全部沿用四份來源筆記已完成的 2026-07-03 線上查證，本報告未重複調用工具驗證，僅整合、交叉比對、映射到 healing-studio 現況與北極星支柱。

---

## 1. 八個 MCP 對照表

> 說明：四份筆記合計研究了 9 個候選 MCP。**Research Tracker MCP（`vupatel08/research-mcp-tool`）因無 LICENSE、0 星、單一貢獻者 21 commit、連 transport 機制都僅屬推測**，不符合納入正式對照表的最低成熟度門檻，故本表僅列 8 個「至少具備可查證授權與基本社群/官方背書」的 MCP；Research Tracker 的「論文↔模型↔資料集關聯推斷」概念改在第 4 節「北極星落地路徑」中作為**自建邏輯的設計參考**單獨處理，不列入本表評等。

| MCP | 能力 | 成熟度 | 授權 | 成本 | 對應北極星支柱 | 與既有零件重疊 | 採用建議 |
|---|---|---|---|---|---|---|---|
| **Hugging Face 官方 MCP**（`huggingface/hf-mcp-server`） | `hub_repo_search`/`hub_repo_details`（結構化查 model/dataset/space）、`paper_search`（語意搜尋 HF Papers）、`space_search`+`dynamic_space`（可直接呼叫 Gradio Space）、`hf_doc_search` 等 | 高——官方、830 commits、119 releases，本次 session 內已用帳號 `Bruce882` 實測呼叫成功〔線上查證+實測〕 | MIT | 免費（HF API 額度另計） | ①（自建資料庫/RAG 素材源）+ 附屬「模型探索」 | **強烈增強、非重疊**——`modelResearcher.ts:945-1034` 目前是 LLM 自由文字 web search + 關鍵字分類，HF MCP 可換成結構化、有 license/日期/下載量佐證的一手資料，但不含閉源商用模型定價 | **採用**（agent 端立即可用；接生產建議直接呼叫 HF Hub REST API 自建輕量 fetcher，仿 `modelResearcher.ts:993-1034` 現有 HN Algolia 呼叫模式） |
| **arXiv MCP**（社群慣稱，以 `blazickjp/arxiv-mcp-server` 為代表） | 依日期/分類搜尋 arXiv 論文、下載 HTML/PDF、Semantic Scholar 引用圖譜、主題訂閱提醒 | 中高但**碎片化**——2.9k★/234 fork，但至少 8 個不同作者的同名獨立實作，**無 arXiv.org 官方背書**，「arXiv MCP」非單一標準〔線上查證〕 | Apache 2.0（多數 fork 亦 MIT/Apache 2.0） | 免費（本地執行） | ①附屬「模型探索」中的論文追蹤（呼應 `modelResearcher.ts:955` 明列的 arXiv/NeurIPS/ICLR/ICML/OpenReview 需求） | 功能對伺服端批次 discovery 而言偏重（本機下載 PDF/語意搜尋用不到）；真正有用的「結構化搜尋+日期過濾」薄層，其實就是 arXiv 官方 Atom API 的封裝 | **自建替代**（production：直接呼叫 `export.arxiv.org/api/query`；agent 端可先用星數最高的 blazickjp 版做研究） |
| **Exa MCP**（`exa-labs/exa-mcp-server`） | `web_search_exa`（語意搜尋）、`web_fetch_exa`（**對已知 URL 抓取完整網頁全文**——既有三檔案沒有的能力）、`web_search_advanced_exa`（網域/日期過濾）、非預設 `agent_*` 非同步深度研究 | 高——4.7k★/354 fork/408 commits，多客戶端整合〔線上查證〕 | MIT（server）+ 專有付費 API | 免費層 1,000 次/月（帶 key）或 150 次/日（未認證）；付費 Search+contents 約 $7/千次起 | ②（BYOMCP 候選）+ ⑤（AI 需要抓取單一靈感來源完整內文佐證） | 「搜尋+摘要」與 `orbWebResearch.ts`/`perplexityDeepSearch.ts`/`brainAutoRepair.ts:webSearch()` 四層 fallback 高度重疊；`web_fetch_exa`（全文抓取）是既有程式碼完全沒有的補強能力，可解 `inspirationFetcher.ts:151-159` `isValidUrl()` 只驗證格式、不驗證真實性的缺口 | **觀望**（現有 fallback 已覆蓋搜尋+摘要，全文抓取無急迫產品需求撐住新付費依賴） |
| **Tavily MCP**（`tavily-ai/tavily-mcp`） | `search`（搜尋+AI摘要）、`extract`（URL 抽取乾淨內容）、`map`（網站結構圖）、`crawl`（**系統性爬取整個網站**） | 高——官方，2.2k★/277 fork/218 commits，OAuth 認證〔線上查證〕 | MIT（server）+ 付費 API | 免費層 1,000 credits/月；付費階梯精確費率**未完全查證**（tavily.com/pricing 回傳 403） | ②（BYOMCP 候選）+ ①（若 TeachingArchive RAG 未來要「匯入外部網站知識」） | `search` 與既有 fallback 重疊；`extract`/`crawl`/`map` 是既有程式碼完全沒有的網站級抓取能力層級 | **觀望（P1 候補）**——crawl/map 目前用不到，但①支柱若擴充「外部網站知識匯入」時是現成方案 |
| **Bright Data MCP**（`brightdata/brightdata-mcp`） | Rapid Mode：`search_engine`/`scrape_as_markdown`/`discover`；Pro Mode：60+ 工具含**真實瀏覽器自動化**（`scraping_browser_*`，可過反爬蟲/JS渲染/登入牆）與社群平台結構化擷取器（IG/TikTok/LinkedIn 等） | 高——官方，2.5k★/312 fork，最近更新 2026-06-16（v2.11.0）〔線上查證〕 | MIT（server）+ 付費 credit | 免費層 5,000 credits/月（≈$7.5 價值，每月重置不可累積）；base tools 1 credit/請求 | ②（連結自己的工具/瀏覽器自動化）+ ⑤（AI 需要即時導航動態頁面取得專案上下文佐證） | 幾乎**不重疊**——既有三檔案全仰賴 LLM 內建搜尋，無法真正導航動態網頁/繞過反爬蟲/精準抓取 IG/TikTok；`inspirationFetcher.ts:131-148` 的 system prompt 目標是查 IG/TikTok/Pinterest 熱門方向，但實作上完全靠 Sonar **自己回報**，從未真正連過去抓取 | **選擇性採用（需個案 POC）**——若「即時靈感抓取」要從「LLM 憑空生成」進化到「真的爬到社群平台真實內容」，這是目前唯一具體方案，但需留意各平台 ToS/爬蟲合規風險，建議先在 `angle:"trending"` 模式小規模驗證 |
| **JSON MCP**（無單一標準，碎片化社群小工具群） | 各專案功能不同：`split`/`merge`（VadimNastoyashchy）、`query`(JSONPath)/`filter`（GongRzhe，**已封存**）、`query_json`(jq)/`generate_json_schema`/`validate_json_schema`（berrydev-ai） | 低且碎片化——星數 0-90，最高星數版本已被作者封存，皆非官方單位背書〔線上查證〕 | 各自 MIT/ISC | 免費（本地執行） | 較弱掛①（若未來有巨量結構化資料匯入需求，目前無佐證） | 完全不重疊——既有三個研究服務量體小（3-8筆），用 TypeScript 手刻 interface + zod（healing-studio 已 93 檔案使用）已足夠 | **不採用/自建替代**——生態零碎、無官方標準、部分已封存，維運風險（斷維護/安全更新缺乏）明顯高於效益 |
| **MCP Run Python**（`pydantic/mcp-run-python`） | 讓 LLM 生成的 Python 片段在隔離環境（Pyodide/WASM + Deno）執行，回傳 stdout/stderr/return value | **已於 2026-01-30 被作者本人封存**，官方原話「there's just no safe way to run Python within pyodide safely」；繼任 `Monty`（Rust 重寫）截至 2026-06 仍缺 class/match/generator 等核心語言特性，**是否已有獨立打包的 Monty MCP server 未查到明確產品頁**〔線上查證，含不確定〕 | MIT | 免費（本地/Deno 執行） | ③（自動化工作流的通用 action 節點候選，或補 `skillSandbox.ts` 缺乏的 Python 執行能力） | 若接上會是 `dispatchExternalSkill()`〔`skillOrchestrator.ts:370-393`〕新增的第三種 kind，但**不解決 orchestrator 本身零呼叫者的骨架現況**〔程式碼實證，見第 3 節〕 | **觀望**——上游已死亡且原廠公開承認方案本質不安全，繼任 Monty 未成熟，現在採用等於把 S-04（P0 RCE 卡）風險複製到 Python 執行面 |
| **Playwright MCP**（`microsoft/playwright-mcp`） | 以 accessibility tree 產生結構化快照驅動瀏覽器（導覽/點擊/輸入/拖放/分頁/網路 mock/tracing），50+ 工具；2026 官方已改口建議 coding agent 場景改用 Playwright CLI（省 4 倍 token） | 高——官方微軟維護，34.7k★；官方 README 明文「**not a security boundary**」，已有社群回報的 indirect prompt injection 案例（issue #1479）〔線上查證〕 | Apache-2.0 | 免費（本地/Chromium 執行） | ②（Adobe/Canva 無正式 API 時的 UI 自動化替代）+ ③（自動化工作流節點）+ QA/驗收面 | 專案已有 `@playwright/test`（dev-only E2E），但那是「開發者寫死腳本」，與 Playwright MCP「LLM 動態決定點哪裡」是完全不同信任模型，不可混為一談 | **自建替代（narrow）**——不建議直接掛通用 Playwright MCP 給 LLM 自由操控；應用同一套 Playwright library 自建範圍受限的 declarative adapter（固定跑預審腳本、不開放 LLM 自由下指令、`--isolated` 無痕 profile） |

---

## 2. 四條路線選項矩陣

| 路線 | 對北極星的價值 | 實作成本 | 風險 | 與現有 tRPC/agentToolExecutor 生態的衝突或重用 |
|---|---|---|---|---|
| **(a) 採用外部 MCP 當連接器**（在 Claude Code/研究 agent 端或未來後端直接呼叫 HF/Exa/Tavily/Bright Data 等既有 MCP） | 直接強化①（HF `paper_search`/`hub_repo_search` 補 TeachingArchive RAG 素材）、②（BYOMCP 候選池）、⑤（Exa `web_fetch_exa` 補來源真實性驗證）。**不需要等任何基建就能在研究/人工核實階段立即生效**——這是本報告驗證方式本身已經證明的事 | 低-中——agent 端幾乎零成本（已可用）；若要接生產 pipeline，成本是「重寫一個對等 REST fetcher」而非「引入 MCP client」（見 §3） | 低-中——第三方托管服務可用性/費率變動（Tavily 費率未查清）；若走 OAuth 憑證，須走 `secretCrypto` 加密，不可重蹈 Google Drive 明文 token 覆轍 | 幾乎不衝突——`server/` 目前零 MCP client 依賴（`package.json` 零 `@modelcontextprotocol`），走 REST fetcher 模式完全複用現有 `webSearch()`/`callPublicDiscovery()` 的既定 fallback 鏈架構模式 |
| **(b) 自建 MCP server 對外暴露自家工具**（把 `agentToolExecutor.ts` 的 194 個 case + `GLOBAL_AGENT_TOOL_REGISTRY` 包成 MCP server，讓外部 agent 呼叫） | 間接——不直接推進任一支柱的產品功能，屬生態/平台化價值（讓 Claude Desktop/Cursor 等外部 agent 操作 healing-studio），**Q5 規格文件本身也把這個方向排除在本波範圍外** | **高**——需先修 G3 gate（178 個精靈工具中 63 個未註冊於 registry、9 個「真孤兒」連 case 都沒有）；194 個 case 需逐一包 `tools/call` handler；`requireConfirmation`/`allowedRoles` 等會話態安全機制 MCP 協定無原生對應欄位，須自行維護映射 | **高**——把「目前打不到、未經驗證是否安全」的精靈工具（含 `videoSpecialist.*`/`voiceSpecialist.*` 等無確認即可觸發真實付費生成的工具）原封不動暴露給外部呼叫者，信任邊界方向完全相反（現有 `ORB_TOOL_ALLOWED_ORIGINS`/`allowedRoles` 是為「站內光球呼叫外部 API」設計，不是為「外部呼叫站內工具」設計） | 高衝突——`executeOrbToolCalls`〔`agentToolExecutor.ts:533`〕是巨大 if-chain + switch，非動態 handler map，且會話態參數（`userId`/`approved`/`taskId`）非 MCP 協定原生攜帶欄位 |
| **(c) 自建 MCP client 消費外部 MCP**（Adobe/Canva/Notion，呼應 M3 §2.2 既定方向） | **直接**推進②，也是七支柱藍圖已經定案的路徑（`M0-solution-blueprint.md:19`：「Adobe/Canva 走產品自建 MCP client」）；若 client 能接入未來編排器 action 節點，也支撐③ | 中——需寫通用 MCP client 封裝（`@modelcontextprotocol/sdk` v1/v2 選型，Q5 自陳未查清）、OAuth2 DCR 流程（Canva 已證實走此模式）、在 `skillOrchestrator.ts:dispatchExternalSkill()` 新增 `kind:"mcp"` 分支 | 中——Canva 官方 MCP 本次獨立線上查證**已確認**生產可用（`mcp.canva.com/mcp`）；**Adobe 子項有關鍵未決缺口**：本次僅證實 Adobe 官方 MCP 在 Claude 生態內可用，未證實 healing-studio 自家後端能否繞過 Claude 直接對接；Notion 官方 hosted MCP 只到 page 層級，比現有手刻 REST adapter（block 層級）更粗，Q5 建議 Notion 維持手刻現狀不 MCP 化 | 低衝突、高重用——可直接複用 `connectionService.ts:loadOwnedConnection`〔`:68`〕的 owned-connection 模式、`secretCrypto.ts` 既有 AES-256-GCM 加密、`contracts.ts:43-60` 已預留的 `DataSourceKind`/`ConnectionKind` 之 `"mcp"` 列舉值 |
| **(d) 整體轉 MCP 原生架構**（把內部所有工具呼叫、乃至 tRPC 層都改用 MCP 協定表達） | 理論上「全部」支柱都可能受益，但**現況技術債（G3 gate 缺口、38/194 可達比、憑證加密不一致）決定這是「先還債」而非「換架構就解決」的問題** | **極高**——等同重寫 `agentToolExecutor.ts`（8087 行）調度層、194 個 case 逐一改簽章、重新設計整個信任/審批模型；tRPC（強型別 RPC，服務自家前端）與 MCP（給 LLM/agent 發現呼叫的鬆散協定）目標不同，「真的整體轉」意味著要嘛雙軌並存（=(b)+(c) 的疊加，非真轉型），要嘛取代 tRPC（影響全站，不現實） | **極高**——大爆炸式重構，同時繼承 (b) 的對外暴露風險與 (c) 的第三方依賴風險，且無漸進回退路徑 | 幾乎完全衝突——`server/routers/*.ts` 是全站主要 API 層，MCP 原生化若非疊加就是取代，工程量與現有生態（尤其 tRPC 型別安全鏈路）根本衝突，且對「單一光球服務單一網站使用者」的產品形態而言，MCP 的核心價值（外部 agent 發現/呼叫）邊際效益有限 |

---

## 3. 既有現況錨定（程式碼實證，避免空談）

- **本專案目前沒有任何 MCP client 或 server**：`package.json` dependencies/devDependencies 零 `mcp`/`modelcontextprotocol` 命中，`node_modules/@modelcontextprotocol` 不存在。`.mcp.json` 唯一項目 `gitnexus` 是本 session 的開發期輔助工具（`npx gitnexus@latest mcp`），與產品 runtime 無關。
- **產品原始碼裡所有 `mcp` 字樣命中皆為型別佔位/前端 mock/註解**：`server/subsystems/contextPackets/contracts.ts:43-60` 的 `DATA_SOURCE_KINDS`/`CONNECTION_KINDS` 留了 `"mcp"` 列舉值但無對應實作分支；`client/src/components/connectors/connectorsTypes.ts:19,52,132-142` 是純前端視覺稿，`MOCK_CONNECTORS` 裡有一筆假資料「Local MCP Server」，檔案頂部自陳「不接後端、不含任何金鑰」；`connectorsFlags.ts:40-46` 的 `CONNECTORS_BYOMCP_ENABLED` 旗標**預設 OFF**（本報告已重讀原文確認）；`server/services/skillOrchestrator.ts:390-392` 的 `declarative` 外部技能目前不真派遣，程式碼原文自陳「Full provider dispatch wired in AIDV-24（BYOMCP/Wave 4）」（本報告已重讀原文確認一致）。
- **工具生態規模與 G3 gate 現況**：`agentToolExecutor.ts` 全文 194 個 `case` 字面值（`dispatchStudioTool` 巨型 switch 內），但 gate〔`agentToolExecutor.ts:708`〕只放行 `studio.`/`director.` 前綴——本報告已重讀 708 行、726-728 行原文，確認**與 `G3-orb-tools-spirits.md`、`Q4-orb-tools-full-registry.md` 兩份診斷完全一致**：178 個精靈工具 case 永遠打不到，其中 63 個連 `GLOBAL_AGENT_TOOL_REGISTRY` 都沒註冊（雙重孤兒），9 個是「真孤兒」（registry 有、executor 無 case）。可達工具總數約 38 個（16 studio + 5 director + 14 db + 3 具名直判），**這是修 gate 前的既有狀態，尚未修復**。
- **憑證加密不一致，是任何新連接器（含 MCP）都必須先正視的既有債**：`server/_core/secretCrypto.ts` 提供 AES-256-GCM + scrypt 導鑰、支援 keyId 版本化輪替，已用於 `data_source_connections.encryptedCredentialRef`（如 Notion token）；但 `drizzle/schema.ts:554-555` 的 `userGoogleOauthTokens.accessToken`/`.refreshToken` 是明文 `text()` 欄位，未走 `secretCrypto`（本報告已重讀 schema 原文確認）。**任何新引入的 MCP OAuth 憑證（含路線 (c) 的 Canva/Adobe token）一律應走 `secretCrypto`，不得延續明文模式**。
- **既有信任模型的既知缺口**：`skillRegistryService.ts:withinTrustCeiling()`〔:38-50〕的邏輯（本報告已重讀原文確認）：第 48 行 `if (trust === "community" && extra.length > 0) return false;`——**只檢查 `community` 層級，`reviewed` 層級的 connector 檢查形同虛設**。此邏輯漏洞先於任何 MCP 決策存在，若引入 MCP 且掛進 `grantedConnectors`（無論是路線 (b) 的對外暴露，或路線 (c) 消費外部 MCP 時把 MCP 視為一種 connector），都會直接繼承此漏洞。
- **BYOMCP 現況是「已排入未來 wave，尚未開工」**：`docs/plan/AIDV-master-plan.md:113-118` 明列 Wave 4「代理建置區／BYOMCP」狀態「📋 To Do」；`docs/research/00-devzone.md:75` 的 `SYS-01` 卡已明文寫「安全上對照 U5 sandbox（引入 Run Python/Playwright 的風險）」——即本報告要回答的問題，本身就是 `SYS-01`/本檔案（`Z1-mcp-architecture-strategy.md`）此前不存在、待產出的決策文件。

**結論**：healing-studio 現在是「MCP 零基建、工具生態技術債未清（178/38 gate 缺口）、憑證加密不一致」的起點，不是「已有半成品 MCP 架構待完善」的起點。任何路線選擇都必須先承認這個起點，而非假設現有 `agentToolExecutor` 194 個 case 都已經是「可以直接包出去」的乾淨資產。

---

## 4. 對北極星的落地路徑

| 北極星支柱 | 直接推進的 MCP/路線 | 具體落地方式 |
|---|---|---|
| **① 連結/創建自己的資料庫** | Hugging Face MCP（路線 a）；Tavily crawl/map（觀望，P1 候補）；Exa `web_fetch_exa`（觀望） | 短期：agent/人工研究階段直接用 HF MCP 的 `paper_search`/`hub_repo_search` 補 TeachingArchive RAG 素材，強度優於 `modelResearcher.ts` 現行的 LLM 自由文字 web search + 關鍵字啟發式分類（`inferDiscoveryKind()`，`modelResearcher.ts:1139-1147`）。中期：若要接生產 pipeline，直接呼叫 HF Hub REST API（`huggingface.co/api/models`、`/api/daily_papers`）自建輕量 fetcher，比照現有 `callPublicDiscovery()` 打 HN Algolia API 的模式（`modelResearcher.ts:993-1034`），不必等 MCP client 基建。**Research Tracker MCP 的「論文↔repo↔模型↔資料集關聯推斷」邏輯**（利用 HF Hub 標籤裡的 `arxiv:` 反查 + GitHub topic 掃描）雖該專案本身無 License 不可直接依賴，但其**邏輯形狀**值得在 `server/services/` 下自建一個小型關聯推斷函式複製,規避第三方無授權風險。 |
| **② 連結自己的工具（Adobe/Canva/Notion）** | 路線 (c) 自建 MCP client；Bright Data（選擇性 POC） | Canva：**本次已線上查證確認**官方遠端 MCP（`mcp.canva.com/mcp`，OAuth2 DCR）生產可用，是路線 (c) 風險最低、最適合作第一個試點 provider 的候選。Adobe：**需先解決「healing-studio 自家後端是否能繞過 Claude 直接對接」的未決缺口**（本報告只證實 Claude 生態內可用），建議向 Adobe partner engineering 二次確認後再排入 BYOMCP candidate。Notion：Q5 建議維持現有手刻 REST adapter（block 層級），官方 hosted MCP 反而粒度更粗（僅 page 層級），不需要 MCP 化。若要把「即時靈感抓取」從「LLM 憑空生成 IG/TikTok 熱門方向」進化到「真的抓到內容」，Bright Data 是唯一具體方案，但需小規模 POC 驗證 ToS/合規風險。 |
| **③ 創建自己的自動化工作流** | 目前無直接可用 MCP；MCP Run Python/Playwright MCP 均**不建議**現在接入 | 現況只有出站 webhook 骨架（`server/routers/webhook.ts`），`automation_rules` 表尚在規劃（`M3-connectors-workflows.md:51-57`）。應等編排器基礎先做出來，再評估是否需要「trigger→action」裡的通用執行節點；若真的需要瀏覽器自動化節點，建議走「自建替代」——用專案已有的 `@playwright/test` 依賴自建範圍受限的 declarative adapter（固定跑預審腳本，不開放 LLM 自由操控），而非掛通用 Playwright MCP 給 LLM 自由驅動。Python 執行節點則等 pydantic Monty 成熟或有正式 MCP 封裝後再議。 |

---

## 5. 安全考量：執行類 MCP 對 U5 sandbox 風險的影響

U5 深度探討（`U5-skill-system-security-deepdive.md`）已用可執行 PoC 證實：現有 `skillSandbox.ts` 的 `node:vm` 沙箱可透過 `Date.constructor.constructor` 拿到 host `Function` → `process.getBuiltinModule('node:child_process')` → `execSync('id')`，取得 **完整 RCE（uid=0/root）**。此路徑目前不可觸發僅因 (a) `skillOrchestrator.ts` 全站零呼叫者、(b) `skill_registry` 表缺 `code`/`kind` 欄位導致提前失敗——**這是架構債，不是已修好的漏洞**。

引入本報告評估的兩個執行類 MCP，對此風險面的淨影響如下：

- **MCP Run Python**：**風險擴大，非修補**。上游專案已於 2026-01-30 被作者本人封存，官方原話公開承認「Pyodide/Deno 這套組合從未被設計成安全沙箱」；繼任 `Monty` 尚未成熟（缺 class/generator 等核心語言特性），是否已有正式 MCP 封裝亦不明確。引入此路徑等同**用一個同樣已知不安全、且已被廠商自己放棄的沙箱去疊加現有問題**，而非解決它。
- **Playwright MCP**：**攻擊面種類擴大，非單純收斂**。作為外部行程，它天然不需要塞進 `node:vm` context，不會直接觸發 U5 §2 那條具體 RCE 鏈；但官方 README 明文「**not a security boundary**」，且已有社群回報的 indirect prompt injection 真實案例（issue #1479，肉眼不可見但帶 `aria-label` 指令的元素會被收進 accessibility 快照，誘導 agent 執行非預期動作）。若搭配 `--user-data-dir` 持久 profile，風險再疊加「LLM 被注入指令後用使用者真實登入態做任意瀏覽器動作」。
- **共同結構性問題**：現有 `skillRegistryService.ts` 的三維權限模型（`connectors`/`materials`/`crossProject`，`:31-50`）**沒有任何欄位能表達「可執行任意語言程式碼」或「可操控瀏覽器/使用哪個登入 profile」**這兩種新能力維度。而且 `withinTrustCeiling()` 對 `reviewed` 層級的 connector 檢查已知形同虛設（本報告 §3 已重讀程式碼確認），若任一執行類 MCP 被包成 connector 掛進 `grantedConnectors`，會直接繼承此既有邏輯漏洞。

**安全結論**：兩個執行類 MCP 均建議**觀望/自建替代**，不建議現在引入。`S-04【P0】skill 沙箱 RCE 面`（`00-discussion-taskcards.md:142-146`）與 `skillRegistryService.ts` 的 `reviewed`-tier connector 檢查漏洞，應作為**任何執行類 MCP 決策的前置依賴**先行處理——這也是路線 (b)（自建 MCP server 對外暴露）與任何「把 MCP Run Python/Playwright MCP 接進編排器」的討論，目前都停在「研究中」而非「已決議」的合理原因。

---

## 6. 一頁建議（給 Bruce）

### 首選路線：**(c) 自建 MCP client 消費外部 MCP**（以 Canva 為第一個試點，Adobe/其他候補），輔以 **(a) agent 端立即用 HF MCP** 作影子路徑

**理由**：
1. 這不是新決策，是把 `M0-solution-blueprint.md:19`（「Adobe/Canva 走產品自建 MCP client」）與 Wave 4 BYOMCP 提前動工的技術選型問題——方向早已定案，欠的是執行。
2. 與現有生態衝突最小、重用最多：`connectionService.ts:loadOwnedConnection`、`secretCrypto.ts` 加密、`contracts.ts` 已預留的 `"mcp"` 列舉值，全部可以直接複用，不必碰 `agentToolExecutor.ts` 那盤 194-case 的技術債。
3. Canva 官方 MCP（`mcp.canva.com/mcp`）本次已**獨立線上查證**確認生產可用、OAuth2 DCR 認證，是目前八個候選裡「已 100% 確認可行、且直接對應②支柱」的唯一一個——最適合當第一個 spike 目標。
4. (a) 路線（HF MCP 等）完全零成本、agent 端立即可用，可以在 (c) 的生產化 client 還沒完成前，先用來驗證「HF 論文/模型結構化資料能否實質改善 TeachingArchive RAG/`modelResearcher.ts`」的產品假設。
5. (b) 自建 MCP server 對外暴露、(d) 整體轉 MCP 原生架構，在當前技術債水位（G3 gate 178/38 缺口、憑證加密不一致、`reviewed`-tier 信任檢查漏洞）下都**不建議現在做**——(b) 甚至連 Q5 規格文件自己都主張「不需要 server 角色，不在本波範圍」。

**第一步 spike（建議 2 週內完成，不涉及大規模開發）**：
1. **向 Adobe partner engineering 二次確認**：healing-studio 自家 Node 後端能否有一個不透過 Claude 生態、可直接呼叫的 Adobe MCP/API 端點——這是 (c) 路線 Adobe 子項唯一的關鍵決策阻塞點，本報告只驗證到「Claude 生態內可用」，尚不足以下生產決策。
2. 選定 `@modelcontextprotocol/sdk` v1（monolithic）或 v2（client/server 拆分）並寫一個最小 MCP client spike，先接 **Canva**（`mcp.canva.com/mcp`，OAuth2 DCR）——因為它是唯一已 100% 確認生產可用的候選，風險最低。
3. 在 `skillOrchestrator.ts:dispatchExternalSkill()` 新增 `kind:"mcp"` 分支（與現有 `sandboxed`/`declarative` 並列，不動既有兩條路徑）。
4. 順手把 `userGoogleOauthTokens` 明文 token 遷移到 `secretCrypto`——任何新 MCP OAuth 憑證都不該重蹈這個既有債的覆轍。
5. **獨立立項**修復 G3 gate（178/38 缺口）與 `withinTrustCeiling()` 的 `reviewed`-tier connector 檢查漏洞，兩者不依賴本次 MCP 路線決策本身，但是路線 (b) 未來若要重啟討論、以及路線 (c) 若要把 MCP 視為一種 connector 掛進既有信任模型時的**共同前置債**。

**需要團隊自行再查證、本報告未能拍板的項目**：
- Adobe for Creativity 是否有可供第三方後端直接調用的獨立端點（見上，關鍵阻塞點）。
- Tavily 付費階梯精確費率（`tavily.com/pricing` 本次查詢仍回傳 403）。
- 網路上出現的「某 Firefly MCP 整合將於 2026-04-30 廢止」公告，究竟指哪一個實作版本（官方 vs 社群 vs 無關的 `gofireflyio/firefly-mcp` 雲端治理產品）——避免团队誤把無關產品的廢止公告套用到 Adobe 官方 MCP 上。
- pydantic Monty 是否已有正式獨立打包的 MCP server（先前查證標「不確定」）。
- `@modelcontextprotocol/sdk` v1 vs v2 的選型（Q5 文件自陳未查清，建議列入第一步 spike 一併決定）。

---

**檔案：行號 索引一覽**（供追蹤）
- `docs/research/M0-solution-blueprint.md:17-23`
- `docs/plan/AIDV-master-plan.md:113-118`
- `docs/research/00-devzone.md:70-75`
- `docs/research/00-discussion-taskcards.md:142-146`
- `docs/research/U5-skill-system-security-deepdive.md:29-63`
- `docs/research/Q5-mcp-automation-spec.md`（全文）
- `docs/research/G3-orb-tools-spirits.md`、`docs/research/Q4-orb-tools-full-registry.md`
- `docs/research/M3-connectors-workflows.md:51-57,96-98`
- `server/services/modelResearcher.ts:945-1034,1139-1147`
- `server/services/orbWebResearch.ts:10-88`
- `server/services/perplexityDeepSearch.ts:144-385`
- `server/services/inspirationFetcher.ts:98-159`
- `server/services/brainAutoRepair.ts:2114-2384`
- `server/services/skillOrchestrator.ts:337-393`
- `server/services/skillSandbox.ts:45-85`
- `server/services/skillRegistryService.ts:31-50`
- `server/services/agentToolExecutor.ts:262-277,533,708,726-728,746,783-849`
- `server/config/orbToolRegistry.ts:1-56`
- `shared/global-agent-tools.ts:15`
- `server/subsystems/contextPackets/contracts.ts:40-60`
- `server/subsystems/contextPackets/connectionService.ts:68-78,179-208`
- `server/_core/secretCrypto.ts:1-30`
- `drizzle/schema.ts:548-558`
- `client/src/components/connectors/connectorsTypes.ts:19,52,132-142`
- `client/src/components/connectors/connectorsFlags.ts:40-46`

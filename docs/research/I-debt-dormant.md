# I — 技術債總帳 × 沉睡能力目錄 × 喚醒路徑(補充 wave I)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 性質:**彙整文件**——把散在 `01-features §7`、`B-infra §6`、`E-ai-agents`、`G1~G4`、`D-adoption §3` 的技術債與「已寫好但沒發揮」的能力收斂成單一總帳;證據行號回各分冊查
- 「量級」圖例:S=數小時內、M=1-3 天、L=1-2 週、XL=需專案化

---

## 1. 技術債總帳(依償還急迫性排序)

### 1.1 🔴 立即級(正在造成損害或高風險)

| # | 債項 | 影響 | 償還建議 | 量級 | 出處 |
|---|---|---|---|---|---|
| 1 | **CI runner 秒掛**(帳務/額度),合併零自動把關 | 每個 PR 都在裸奔;全 repo 自 7/2 起 | GitHub Billing 處理後 re-run;把 eval/e2e 也排進 CI | S(帳務)+M(擴 CI) | B/F |
| 2 | **178 個精靈工具 case 不可達**(executor gate 只路由 6 分支;planner 會規劃→執行必敗;測試 mock 掉看不見) | 光球核心賣點名存實亡;使用者體感=AI 說到做不到 | 修 `executeOrbToolCalls` gate 把精靈前綴納入路由;補「不 mock executor」的整合測試 | M | G3 |
| 3 | **座艙假成功三兄弟**:零上傳「參考照」、核准/場景鎖空 patch no-op、mock 發佈假 permalink(prod SHELL_SOCIAL=1 可達) | 信任損耗:成功 toast 與實際不符,重載即蒸發 | 接真上傳鏈(全站 presign 鏈現成)、vault.update 傳數值 id、worldbuilding.update 帶真 patch;social 加「示範模式」標示或關旗標 | M | G1/C |
| 4 | **npm 依賴漏洞 2C/9H**:protobufjs RCE(可 `npm audit fix` 直修)、**drizzle-orm SQL injection 需手動升 ^0.45.2** | 安全暴露 | 先 audit fix 一輪;drizzle 升版排全量測試 | S+M | G4 |
| 5 | **orbTask FSM in-memory 且雙 store 雙寫**,redeploy 即蒸發 | 光球任務不可靠的根因 | 開現成 `ORB_TASK_STORE_FILE`;中期落 DB(orb_workflow_executions 表已在) | S→M | E/B |
| 6 | **Sentry 接線完成但套件不在 package.json**=線上錯誤追蹤 no-op | 線上炸了看不見 | `npm i @sentry/node` + 設 DSN | S | B |
| 7 | `.brain-state.json`(186KB runtime 狀態)誤 commit、prod 每寫髒 worktree | 部署/審計噪音 | gitignore+移除;brainStatePersistence 改寫到資料目錄 | S | G4 |

### 1.2 🟡 結構級(不修會持續生息)

| # | 債項 | 影響 | 償還建議 | 量級 | 出處 |
|---|---|---|---|---|---|
| 8 | **雙 DB 分工無文件化契約**:Supabase 5 張核心表 DDL 不在 repo(不可重建);雙告警表實碼與註解矛盾 | schema drift、新人踩雷 | 把 Supabase 基底 DDL 收編進 `supabase/migrations/`;告警單軌化(以 Supabase system_alerts 為準) | M | B |
| 9 | **MySQL 102 表 0 外鍵** | 孤兒列靠 purge cron 兜底 | 文件化為架構決策+補孤兒掃描 job;新表起強制 FK | M | B |
| 10 | **記憶體態五處**(learnHub docs、aiModels enrichment、限流桶、orbQuota、研究排程) | 水平擴展硬鎖;重啟丟資料;cron 外呼白燒 | learn_modules 已有表→cron 產物落 DB;enrichment 靠 Redis 暖啟動(已支援,設 REDIS_URL 即可) | M | B/A |
| 11 | **ai.chat 2,500 行 17 階段巨石** | 改動風險集中、不可測 | 按階段抽 service+補 eval case(現僅 6 個) | XL | E |
| 12 | **雙軌並存×4**:導航 chrome(AidvShellChrome vs AppleDock)、toast(sonner vs design-kit)、刪除確認(window.confirm vs AlertDialog)、SSE bus(legacy vs unified 預設 OFF) | 維護雙份、行為不一致 | 各選一軌收斂,删舊軌 | M×4 | C/02 |
| 13 | **三套專案體系同場**(creative_projects/video_projects/world_storyboards 橋接鬆散;/projects 與 /creative-projects 並行過渡) | 使用者與開發者都迷路 | 依 D 長期路線收斂為單一 IP 空間動線 | XL | G1/01 |
| 14 | **env 驗證缺口**:~68 個 process.env 直讀不在 zod schema;JWT_SECRET 身兼三職 | 設錯無警告;輪替密鑰有資料風險 | 補進 env.validated;先設 CREDENTIAL_ENCRYPTION_KEY 再談輪替 | M | B |
| 15 | **內建定價表 vs 真帳單無對帳機制**(cost ledger 旗標 OFF) | 成本歸屬失真 | 開 ENABLE_COST_LEDGER(migration 先行)+定期人工對價 | M | A |
| 16 | 種子教材硬錯(tRPC v10/15 張表)且是光球 RAG 素材→**錯誤會被 AI 轉述** | 知識污染 | 修種子+建「教材 lint」(對照 00-overview 事實) | M | G4 |
| 17 | 死碼群:export router、OrbFloatButton、panels/ 整目錄、agent-events SSE×2、BackgroundTasksDrawer、App.tsx 死 lazy import、config/pricing-table.json、workflowAutomationTools 等 | 認知負擔+誤導後續開發 | 一次性清理 PR(對照 01 §7+G1/G3/G4 清單) | M | 01/G* |

### 1.3 🟢 衛生級(擇機)
命名/暱稱漂移(G3 精靈暱稱×5、llmRouter 檔頭註解過時、AGENTS.md journal 91→121)、`text-[10px]` 724 處 vs token 97 處、71 個殭屍 PR+15 個 issue 批次關(F)、todo.md/.manus/COORDINATION.md 遺物清理(G4)、docs/ 舊分析文件標註過時。

---

## 2. 沉睡能力目錄(已寫好但沒發揮)+ 喚醒路徑

### 2.1 「開旗標就有」級(程式完整,預設 OFF)

| 能力 | 現況 | 如何發揮 | 風險/先決 |
|---|---|---|---|
| **多代理協作全套**(orchestrator 落 DB/討論 runner/協作 bus/DAG planner) | `ORB_MULTI_AGENT_ENABLED` OFF | 內部灰度:先對 admin 帳號開,觀察 bus 單機上限(1000 則/24h) | bus in-memory,多 replica 前要換 Redis |
| **光球觀察者續跑循環**(ReAct 外圈) | `ORB_OBSERVATION_LOOP` OFF | 同上灰度;是「agent loop v2」的關鍵體驗 | 配合 FSM 持久化(債 #5)一起開才不白做 |
| **RAG 注入防護** | `ENABLE_RAG_INJECTION_GUARD` OFF | 直接開(fail 行為已設計為靜默) | 低 |
| **月度預算/每日配額守衛** | `ENABLE_ORB_BUDGET_GUARD`/`QUOTA_GUARD` OFF | 開啟+把 admin 告警接上;搭配導演批次放大器(A #11)是止血閥 | 需先定團隊配額政策 |
| **成本帳本** | `ENABLE_COST_LEDGER` OFF | migration 先行→開旗標→admin 成本頁改讀 ledger | 順序錯會丟數據 |
| **資料層 RBAC enforcement**(resource_shares 已在累積資料) | `ENABLE_DATA_RBAC` OFF | 先 shadow mode 記 log 不擋→再切 enforce | 需驗共享資料完整性 |
| **refresh token 輪替** | OFF(/api/auth/refresh 回 403) | 開啟(表已備) | 低 |
| **統一 SSE 路由** | 前後端雙旗標 OFF | 開啟後可刪 legacy bus(債 #12) | 中,需回歸測試 |
| **導演世界脈絡注入** | `ENABLE_DIRECTOR_WORLD_CONTEXT` OFF+前端不傳 projectId | 開旗標+chat 帶 projectId(一行)→純聊天也有世界一致性 | token 成本已設上限 |
| **Prompt Vault 自動存**、**TEAMS_COLLAB 看板**、video 旗標 7 個(WORLD_STYLE_INJECTION/PROJECT_HUB/GATE_KIT/VOICE_MUSIC_WORKFLOW…) | 各 OFF | 逐一評估:看板需先有 tasks 資料源;video 旗標多為半成品閘,開前補後端 | 中 |

### 2.2 「後端有、前端接一下就有」級

| 能力 | 缺口 | 如何發揮 | 量級 |
|---|---|---|---|
| RealEarth 真實地球系統(13 procedures+FULLTEXT) | 只有座艙 I-5 一個 search 入口 | learn shell 加入口頁(CRUD+瀏覽);teachingArchive↔realEarth 連結 procedures 接 UI | M |
| teams 治理(transferOwnership/updateMemberRole) | 前端未接 | TeamsPage 補兩個按鈕+Dialog | S |
| videoProject.requestExport 成片匯出 | 前端 0 呼叫→座艙下載橫幅不可達 | 座艙接上(G1 §4) | S |
| worldbuilding.queryEntities(光球查世界設定) | 0 消費者 | 註冊進光球工具 gate(配合債 #2 一起修) | S |
| director.planningCreateMilestones(規劃→行事曆) | mutation 宣告了沒呼叫 | DirectorAI/座艙加「排入行事曆」按鈕 | S |
| proStudio 4 個隱藏端點(voiceStyles/compiledTextToMusic 等) | 無 UI | 評估後接入或刪除 | S-M |
| feedback 擴充欄位(頁面截圖/pageContext) | FeedbackPage 不送(QuickFeedback 有送) | FeedbackPage 補欄位 | S |
| agent_ops 抽屜(元件+後端完整) | 0 開啟入口 | 座艙加入口 | S |
| AIDV-44 管線狀態機(updateJob/updateSessionStatus) | 0 呼叫者→frames 永遠 queued | 是「分鏡管線可執行化」的第一塊拼圖(見 2.4) | M |

### 2.3 「資料在燒/已存但被當沒有」級

| 能力 | 現況 | 如何發揮 |
|---|---|---|
| workflow.getDefault/save 已落 user_workflows | 抽屜 UI 謊稱「後端待補、本地示意」 | 改文案+接讀寫(已通,只是 UI 不承認)(G1 #8) |
| cron 知識產出(braveLearnFetcher/learnDocSyncer) | 只進記憶體 | 落 learn_modules(表已在)→重啟不丟、LLM 費不白燒 |
| api_usage_logs/ai_usage_events 歷史數據 | 只有 admin 圖表用 | 匯出跑一次真實用量分析→校準 A 的成本推估與 H1 定價表 |
| k6 load-tests(AIDV-711) | 無 npm script、無基線歸檔 | 加 `npm run loadtest`+把 baseline 落 docs |
| @xyflow/dagre 已在依賴(brain-pipeline 在用) | 生成管線不可視 | 複用做「批次生成 DAG 檢視」= D 中期路線的低成本版 |
| studio_recipes 配方 | 個人用 | 升級 team_shared 配方=D 的「非技術隊友按鈕跑固定管線」 |
| gitnexus MCP(碼知識圖譜) | 只有開發期用 | 維持;可作 onboarding 文件生成來源 |

### 2.4 「補一段就通」級(最高價值的三條斷鏈)

1. **分鏡管線執行化**:G2 判定「可規劃不可執行」——planPipeline 產出的工具名(`studio.generateImage` 等)在 server 不存在,而 **同名工具在光球 executor 是可達的 37 個之一**。喚醒路徑:讓 pipeline runner 走 orbTaskExecutor 的 studio.* 工具(或 generate.submitStudioJob 直呼)+接 AIDV-44 狀態機回寫 → 「世界觀→分鏡→一鍵成片草稿」整條龍就通了。量級 L,但這是差異化定位(D §4.10)的關鍵一步。
2. **座艙 kind=video**:目前只生成靜態影格(AdapterPendingError,M3 待建);videoStudio 的 i2v procedures 全部現成,adapter 補一個 case 即可。量級 M。
3. **審改迴圈**(D 中期):資產狀態機+評論+集合;resource_shares/teams/digital_asset_library 欄位基礎都在,缺的是三張小表+UI。量級 L-XL,但這是「融入日常」的臨界點。

---

## 3. 發揮優先序矩陣(收益 × 成本)

**Quick wins(S 量級,本週可清)**:Sentry 套件、audit fix、.brain-state.json、FSM 檔案持久化、teams 兩按鈕、requestExport 接線、queryEntities 註冊、planningCreateMilestones 按鈕、workflow 抽屜改文案、viewport 禁縮放(C)。

**高槓桿(M 量級)**:精靈工具 gate 修復(#2,一修解鎖 178 工具)、座艙假成功三修、大腦預設檔降級+LLM_CACHE 擴面(A 最大成本槓桿)、cron 知識落 DB、旗標灰度四件(觀察循環/多代理/預算守衛/RAG guard)、Supabase DDL 收編。

**結構投資(L-XL)**:分鏡管線執行化、審改迴圈、專案體系收斂、ai.chat 拆解+eval 擴充。

> 交叉引用:與 D §3 發展路線、00-summary §3 三波建議一致;本文件把「怎麼做」落到債項/能力粒度。

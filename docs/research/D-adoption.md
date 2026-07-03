# D — 創作系統實用性 × 發展性 × 業界對照(Phase 2-D)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 網路調研日期:2026-07-03(§4 所有外部來源於本日檢索;外部文章內容以其發佈當時為準)
- 共同依據:`00-overview.md`(詞彙)、`01-features.md`(功能現況,尤其 §7 非完整項目)、`02-fullstack.md`(接線)、`A-cost-integrations.md`(成本)、`E-ai-agents.md`(代理架構)
- 勘誤沿用:**prod `.env.production` 設 `VITE_SHELL_SOCIAL=1`,social shell 線上為 ON**(01 §5),即 mock 發佈流程實際暴露給使用者
- 讀者設定:15–20 人內部創作團隊的決策者;本文回答三個問題——「今天能拿它做什麼」「為什麼還沒融入日常、要補什麼」「業界怎麼做、我們的位置在哪」

---

## 1. 現況能力盤點:今天實際能為 15–20 人創作團隊做到什麼

### 1.1 已經完整可用(有前後端接線+資料表證據,見 01/02)

| 能力 | 具體內容 | 對創作團隊的意義 |
|---|---|---|
| **四模態生成** | Studio 統一提交(圖/影/音/語音,安全檢查→大腦選引擎→扣點→fal queue→webhook/輪詢→三表入庫);ImageStudio 23 模型、VideoStudio 13+ 模型(Kling/Wan/MiniMax/LTX/Sora/Veo3…)、ProStudio 30+(音樂/Suno/TTS/克隆/分軌/形像影片) | 單一站點覆蓋圖、影、音、語音全鏈,模型面等同業界聚合平台(§4)的主流陣容 |
| **導演批次生成鏈** | DirectorAI:CO-STAR 對話出腳本→拆分鏡→批次生成(N 段×圖/影/音/語音,扣點/退款原子化)→i2v 自動級聯→批次下載(AIDV-237) | 「一個分鏡板一鍵出全套素材」,是本站對「storyboard→gen」工作流的核心答案 |
| **世界觀+分鏡** | AnimationStudio:世界觀 CRUD(角色/場景/可連結語音與 LoRA)、AI 生成角色/場景/分鏡(純文字 LLM)、分鏡板管線規劃、鏡頭表匯出、深連結 | 對齊 LTX Studio「narrative-first」路線(§4.1),且比多數聚合平台多了「世界觀資料結構」 |
| **LoRA + Consent 閘門** | ModelsPage:雙引擎訓練(Replicate 預設/fal)、**人像/版權素材必附有效同意書**(model_training_consents)、重訓/自動標註/補角度、團隊共享模型 | 內建訓練治理,這在業界屬 enterprise 級功能(Adobe Custom Models、Krea Enterprise 才有,§4.7/§4.4) |
| **資產庫/共享** | AssetsLibrary(my/team、無限捲動、R2 級聯刪除)、SharedSpace(共享模型/資產直送工作室)、Vault 一致性錨點(角色/場景參考圖注入生成)、prompt 庫/收藏 | 團隊層級資產池已在;「一致性錨點」= 業界 Elements/Character 系統的等價物(§4.1/§4.3) |
| **資料庫 RAG(Teaching Archive)** | 上傳(文/PDF/圖/影/語音)→抽文/Scribe 轉錄→切片→gemini-embedding-001→Pinecone→檢索注入導演/光球;四視野(全部/我的/團隊/公開)+存取稽核 | 等價於業界「brand knowledge / Source of Truth」層(§4.8),而且素材可同時餵 RAG 與 LoRA 訓練——這個雙用途在對照組中沒有直接等價品 |
| **光球全域代理** | ai.chat 全管線(schema-first planner+澄清+配額感知分階段+成本分級人審)、25 精靈、記憶三層、站內導航/代填/代送(E §1) | 業界 2025-26 才開始出現的「creative agent」(Firefly Assistant、Krea Node Agent,§4.4/§4.7),本站已有相當深的自研實作 |
| **成本/後台** | 點數制(預設 50 點,1 USD≈100pts)、admin 11 分頁(用量/成本 USD→TWD/角色/配額/回饋)、API 用量告警(15 分 Slack) | 內部 credit 制+管理面直逼商用平台的 workspace admin(§4.2) |

### 1.2 缺口(以 01 §7/02/E 為準;按「對 15-20 人團隊日常」的痛感排序)

| # | 缺口 | 現況證據 | 痛感 |
|---|---|---|---|
| 1 | **無評論/審批流** | 全站沒有任何 comment/annotation/approval 資料表與 UI;資產只有 visibility(my/team)與 bookmark/rate(generation_history) | 團隊創作的核心迴圈「看→評→改→批准」整段缺席;現狀只能把產物下載後丟到外部工具討論 |
| 2 | **teams 治理半成品** | transferOwnership/updateMemberRole 後端有、前端未接;加成員僅 userId 輸入;TEAMS_COLLAB 旗標 OFF(ON 時看板恆空);DB 無 FK(01 §2.7) | 「團隊」目前 ≈ 一個共享範圍標籤,不是治理單位 |
| 3 | **資料層 RBAC OFF** | resource_shares 寫入已上線,enforcement 旗標 ENABLE_DATA_RBAC 預設 OFF(01 §3.8) | 分享粒度只有 my/team 二元;無法做「這組 LoRA 只給 A 小組」 |
| 4 | **社群發佈 mock 卻在 prod 可達** | SocialPublish posting adapter 為記憶體 mock、假 permalink;postiz stub 丟錯;而 prod SHELL_SOCIAL=1(01 §5) | 交付終點(發佈)是假的,且會誤導使用者以為已發佈——信任損耗點 |
| 5 | **光球任務 FSM 不持久** | orbTaskStateMachine in-memory Map,重啟即失(E §9.2-1) | 代理排的多步任務遇 redeploy 就蒸發,使用者感知為「AI 不可靠」 |
| 6 | **學習/知識資料揮發** | LearnHub 影片/測驗 ephemeral、cron 產文只進記憶體、AIModelsHub enrichment 記憶體(01 §2.1/2.2) | 團隊共同知識沉澱不下來,redeploy 歸零 |
| 7 | **入口/舊路由斷鏈** | AssetsLibrary ?section= 聚合 5 分支死碼——/vault、/history、/prompt-library redirect 進來落在預設頁(01 §4.1);素材庫抽屜鈕 hidden(ImageStudio/ProStudio) | 「我生成的東西去哪了」的動線斷裂(§2.1 詳述) |
| 8 | **無真金流** | Stripe webhook 骨架、plans 無購買 UI;點數=內部限流非成本回收(A §3.4) | 對內部團隊可接受,但成本治理只剩告警(預算閘旗標 OFF,A §2.6) |

**一句話總結**:生成產能(供給側)是完整且業界水準的;**協作與交付(需求側/流程側)是最大缺口**——正好是 15-20 人「團隊」與個人玩家的分界線。

---

## 2. 從「能用」到「融入日常」

### 2.1 採用障礙(以程式碼證據推論)

1. **入口分散/雙導航**:4-shell(video/learn/settings/social)+ 15 條跨 shell 頂層路由(/assets、/models、/shared、/notes、/projects、/creative-projects…)並存;chrome 雙軌(AidvShellChrome vs 舊 AppleDock 白名單 4 頁);/projects 與 /creative-projects 兩套專案視角同資料並行(App.tsx:261-263 註解自承過渡)。新成員第一週的心智地圖成本高。
2. **同名概念多入口**:生成可從 Studio/ImageStudio/VideoStudio/ProStudio/DirectorAI 批次/光球/精靈 7 條路徑發起,各自參數面板不同;「該用哪個」沒有站內引導答案(TutorialOverview 是靜態頁)。
3. **「結果去哪找」動線斷裂**:生成結果統一落三表(prompt_library/digital_asset_library/generation_history),但 ①Studio 頁內直出欄位從未寫入(01 §1.4),結果全在背景任務抽屜;②ImageStudio/ProStudio 的素材庫抽屜鈕 hidden;③/history 等舊路由 redirect 後落在預設資產頁(section 聚合死碼)。使用者要自行知道「去 /assets 或背景任務抽屜找」。
4. **點數制的心理摩擦**:預設 50 點+40 次/天+20 tasks/hr 三層限制(A §2.6),但無「點數怎麼算」的前台說明頁(報價僅在 Studio 提交前顯示 brain.pricingSummary);點數不足時的體驗依賴 admin 手動/自動發點。
5. **失敗率感知**:失敗有原子退款(好),但輪詢式進度(3-5s)+SSE 斷線不重連降級輪詢+光球「串流」實為輪詢模擬(01 §4.6),長任務體感偏「卡」;fal CDN→R2 歸檔為 5 分鐘後台搬運,期間連結是外部 CDN。
6. **預設模型檔次與成本焦慮綁定**:user_ai_brain 4/5 推理 slot 預設 Opus(A §2.3),未調整組態的使用者每次光球對話都走最貴檔——管理者看帳單的焦慮會反向抑制推廣。
7. **展示性功能損耗信任**:LightOrbCreationStudio 整頁假動畫假台詞、SocialPublish 假 permalink、精靈「協作團隊」chips 只有 lead 真跑(E §9.2-4)——內部使用者一旦踩到一次「假的」,對真功能的信任也會打折。

### 2.2 brief→生成→審→改→交付:工作流斷點定位

| 階段 | 現有支撐 | 斷點 |
|---|---|---|
| **Brief** | Commander/IntentComposer 收意圖 | **skeleton**:只寫 pending orchestration run,無分類無下游(01 §1.3);實際 brief 多半發生在站外(口頭/群組) |
| **規劃** | DirectorAI CO-STAR 對話→腳本→分鏡;世界觀框架 | 完整,但**世界脈絡注入 chat 預設 OFF**(ENABLE_DIRECTOR_WORLD_CONTEXT),世界觀與導演對話尚未真正閉環 |
| **生成** | 批次鏈+四模態+LoRA+Vault 錨點 | 完整(本站最強段) |
| **審(review)** | 無 | **全斷**:無評論、無標注、無審批狀態、無版本比對;generation_history 只有個人 bookmark/rate |
| **改(iterate)** | 單鏡重生成、i2v 級聯、studio 版本/配方快照 | 個人層完整;**團隊層斷**——改誰的、根據誰的意見改,系統無記錄 |
| **交付** | 前端 JSZip 打包下載、批次下載鏈、ICS 行事曆 | 下載=交付終點;**發佈是 mock**;無「交付單/驗收狀態」概念;proxy-download 走 Railway egress(A §2.4) |

結論:管線在「審」處徹底斷開,前後兩段(生成、下載)各自完整——這解釋了為什麼系統「能用」但不會自然「融入日常」:**日常是由審改迴圈驅動的,而審改迴圈今天必須離站發生**。

### 2.3 協作/資產共享現況與缺口

- 有:team visibility 資產/模型/prompt、SharedSpace 直送工作室、教材四視野、共享得 2 點激勵(assets.ts:261)。
- 缺:①成員角色治理前端未接;②resource_shares enforcement OFF→分享粒度粗;③無「集合/專輯/交付包」的策展單位(業界 Collections/Boards,§4.9);④無資產狀態欄位(draft/in-review/approved),Frame.io 式多階段審批無從掛起;⑤無通知系統(誰共享了什麼、誰@了誰)。

### 2.4 與團隊既有流程的接點(Jira / Drive / 社群平台)

- **Google Drive**:已有唯讀資產庫整合(drive router,檔案留 Drive 不搬,02 §5)——是三者中唯一真接線;可作為「團隊既有素材→教材庫/生成參考」的入口,但目前只有 pin folder+列目錄,無「Drive 檔案一鍵進教材庫/進生成」。
- **Jira**:產品 runtime 無任何 Jira 整合(Atlassian MCP 是開發環境層級,00 §1;E §7);團隊若用 Jira/AIDV 管創作任務,任務與產物間無連結。Commander 意圖收件匣是天然的對接點(意圖↔Jira issue 雙向)。
- **社群平台**:無真發佈管道(postiz stub 未接線);業界普遍做法是接 API 聚合器或原生 OAuth(§4.9)。短期務實解是「匯出規格包」(平台尺寸/字幕/封面)而非直發。
- **通知**:告警走 Slack/Discord webhook(A §1.5)但只服務維運;**創作事件(生成完成/共享/審批)無任何對外通知**——這是「融入日常」最便宜的槓桿之一(生成完成→Slack/LINE 通知,把人拉回站內)。

---

## 3. 發展路線(近/中/長期)

### 3.1 近期(≤1 個月量級;多為 01 §7 半成品收尾+旗標,直接提升實用性)

優先序依「投入小×對日常採用的槓桿大」:

1. **修結果動線**:AssetsLibrary section 聚合死碼修復(5 分支)+ 取消 ImageStudio/ProStudio 素材庫抽屜鈕 hidden——讓「生成→找到結果」一步到位。
2. **社群發佈止血**:prod SHELL_SOCIAL 關閉,或 SocialPublish 明確標示「示範模式」;LightOrbCreationStudio 同理(下架或標示)。消除信任損耗點。
3. **生成完成通知**:完成事件已有事件源(generationBus/SSE),加一條 Slack webhook 出口即可(基建已在,A §1.5)。
4. **teams 治理收尾**:transferOwnership/updateMemberRole 前端接上(後端已有);加成員改 email/名稱搜尋。
5. **開低風險旗標**:ENABLE_ORB_QUOTA_GUARD、ENABLE_RAG_INJECTION_GUARD(E §9.3-2 已論證低風險);orbTask FSM 最小持久化(寫穿 Redis/orb_* 表,E §9.3-1)。
6. **知識資料落 DB**:LearnHub 影片/測驗/cron 文件落 MySQL(止住「每天白燒的外呼費」,A §5.1-3 同一件事的另一面)。
7. **點數說明頁**:把 brain.pricingSummary 的報價邏輯做成一頁「點數怎麼算」,配 admin 自動發點政策說明。

### 3.2 中期(1-3 個月量級;補「審」這一段)

1. **輕量審改迴圈 v1**:資產加 status(draft/in_review/approved/rejected)+每資產評論串(表+UI)+@提及通知——不求 Frame.io 級 frame-accurate 標注,先讓迴圈在站內閉合。
2. **交付集合(Collection/交付包)**:可命名的資產集合+一鍵 ZIP/分享連結,對齊業界 Collections 做法(§4.9);把現有 JSZip 匯出升級成「集合級」。
3. **ENABLE_DATA_RBAC 開啟**+分享粒度 UI(user/team/link);與審批狀態聯動(approved 才可入共享池)。
4. **Commander 收件匣補實**:意圖→AI 分類→建議管線(directorSession/storyboard/studio)→可指派;同步做 Jira issue 連結欄位(先單向貼連結即可)。
5. **導演世界脈絡注入開啟**(ENABLE_DIRECTOR_WORLD_CONTEXT)+ 世界觀→批次生成的風格一致性驗證(ENABLE_WORLD_STYLE_INJECTION 旗標已預留)。
6. **社群發佈真接線**:接一家聚合 API(postiz 既有 stub 方向)或先做「平台規格匯出包」。

### 3.3 長期(3 個月以上;差異化縱深)

1. **「世界觀為中心」的團隊工作區**:世界觀+Vault 錨點+LoRA+教材 RAG 綁成「Brand/IP 空間」,生成時自動注入整組一致性約束——對齊並超越業界 brand kit(§4.8),因為本站同時有向量知識與視覺錨點與自訓模型三層。
2. **代理進審改迴圈**:巧巧(quality-coach)對 in_review 資產自動出 7 維診斷意見、品品(critic)預審——把 25 精靈從「生成助手」升級為「流程角色」(基建已在,E §1.2)。
3. **多代理真協作開啟**(ORB_MULTI_AGENT_ENABLED+bus 持久化,E §9.3-8)+ FSM/編排強化(v3 dependsOn DAG 真並行)。
4. **對外 API/工作流輸出**:v1 REST 已有雛形;若團隊擴編或服務外部夥伴,對齊 ComfyDeploy/Firefly Services 的「workflow as API」形態(§4.6/§4.7)。
5. **成本回收決策**:維持內部點數或啟用 Stripe——取決於是否對外;先決條件是 cost_ledger 旗標開啟+對帳(A §4-8)。

---

## 4. 業界對照(網路調研 2026-07-03;每點附來源)

> 方法聲明:以下依 WebSearch 檢索之官方頁面與第三方評測整理;第三方評測(vidmuse、eesel、flowith 等)可能有行銷偏差,凡關鍵事實盡量以官方頁佐證;未能直接開啟原頁逐字核實的項目在 §6 註明。

### 4.1 LTX Studio(narrative-first AI 影片工作室)——與本站最同構

- **工作流**:腳本/概念→結構化 storyboard→鏡頭生成→站內剪輯(排列/修剪/音效);「先鎖敘事再生成、少浪費 credits」是其明確賣點。**Elements 系統**保存可複用角色/物件/場景以維持跨鏡一致性——與本站 Vault 一致性錨點+世界觀同構。來源:[LTX Studio 官方](https://ltx.io/studio)、[官方定價](https://ltx.io/studio/pricing)、[vidmuse 評測](https://vidmuse.ai/blog/ltx-studio-review)、[comparebestai 功能拆解](https://comparebestai.com/articles/ltx-studio-features)(檢索 2026-07-03)。
- **credit 制**:free 800 一次性 credits;Standard $35/月起、Pro $125/月;「computing seconds」已改名「credits」,不同動作耗不同量。**協作分層賣**:Standard 可共享專案與回饋、Pro 3 協作者/專案、Enterprise 無限成員+SSO+自訂模型訓練+SOC 2。來源:[官方定價](https://ltx.io/studio/pricing)、[dupple](https://dupple.com/tools/ltx-studio)、[G2 pricing](https://www.g2.com/products/ltx/pricing)。
- **對本站啟示**:①「storyboard 先行省 credits」可直接抄——導演批次鏈前加「預估總點數+逐鏡確認」介面(後端 estimatePoints 已有);②協作(含回饋)被業界當付費牆功能,證明它是團隊採用的關鍵路徑;③本站世界觀資料結構比 Elements 深(角色/場景/LoRA/語音連結),是差異化資產。

### 4.2 Runway(單模型旗艦+enterprise workspace)

- **Workspace/credit 治理**:團隊建 Workspace 共享資產;Enterprise 為**年約共享 credit 池**,全 workspace 有生成角色者共用;admin 可設「個人或 workspace 超過 credit 閾值即通知」;workspace 分析、SSO、合規。來源:[Runway 官方 help:Enterprise Credits](https://help.runwayml.com/hc/en-us/articles/32117491177619-Enterprise-Credits)、[How do credits work](https://help.runwayml.com/hc/en-us/articles/15124877443219-How-do-credits-work)、[eesel 定價整理](https://www.eesel.ai/blog/runway-ai-pricing)(檢索 2026-07-03)。
- **API 收緊**:2026-01 起 API 僅限 Enterprise;web 與 API credit 不互通。來源:[stacksheriff](https://stacksheriff.com/ai-tools/runway-pricing/)、[propicked](https://propicked.com/blog/runway-ml-pricing-2026-hidden-costs)。
- **對本站啟示**:①「共享 credit 池+超額通知」比本站「每人獨立 remainingGenerations」更貼團隊實態——可考慮 team 級點數池+admin 閾值告警(alert_configs 基建已在);②credit 儀表板透明度(每模型每秒費率表)是使用者信任基礎,本站的 pricingSummary 值得升格為公開頁。

### 4.3 OpenArt(100+ 模型聚合+角色一致性最深)

- 聚合 100+ 模型(SD 系/Flux/Kling/Veo3/Seedream/Nano Banana);**workflow 自動化**把生成→放大→inpaint 串成可重複管線;團隊共享 prompts/LoRA/生成結果;enterprise 有 team accounts、**共享 LoRA 庫、brand governance、集中計費**;Character Builder+Worlds 主打角色一致性與 AI 網紅/品牌吉祥物。來源:[flowith 分析](https://flowith.io/blog/openart-redefining-creative-ai-platform-2026/)、[OpenArt 官方 blog](https://openart.ai/blog/best-ai-generators/)、[belreos 評測](https://belreos.com/tools/openart)(檢索 2026-07-03)。
- **對本站啟示**:「共享 LoRA 庫」本站已有(SharedSpace+consent 閘門更嚴謹);OpenArt 的「Worlds」證明世界觀+角色一致性是聚合平台正在收斂的方向——本站起步早,但需把它從 AnimationStudio 單頁升級為貫穿生成鏈的一級概念(§3.3-1)。

### 4.4 Krea(64+ 模型套件+enterprise admin 治理)

- Krea Enterprise:無限成員、**per-user 消費上限與模型限制(admin 控制)**、多 workspace 用量追蹤、自訂模型訓練、node 工作流、SSO、IP 賠償;2026 初推出 Realtime Edit 與 **Node Agent**(代理式節點工作流)。來源:[Krea 官方 enterprise 頁](https://www.krea.ai/enterprise)、[Krea 官方](https://www.krea.ai/)、[aiunpacking 評測](https://aiunpacking.com/review/krea-ai/)(檢索 2026-07-03)。
- **對本站啟示**:①「admin 可限制成員能用哪些模型/花多少」正是本站 user_ai_brain+配額的下一步(把 admin updateQuota 擴為模型白名單+上限);②Node Agent 與本站光球 planner 是同題不同解——Krea 讓人拉節點、本站讓代理排步驟;本站路線對非技術創作者更友善,是可宣傳的差異化。

### 4.5 Flora / Figma Weave(node canvas 的兩個標竿)

- **Flora**:50+ 模型節點畫布,輸出即節點可鏈入下一 prompt;Style DNA 捕捉品牌美學;Flows 模板;敘事/分鏡工具;2026-01 獲 Redpoint $42M Series A,定位 agencies/brand teams。來源:[Flora 官方](https://www.florafauna.ai/)、[TechCrunch 2026-01-27](https://techcrunch.com/2026/01/27/node-based-design-tool-flora-raises-42m-from-redpoint-ventures/)、[wireflow 對比](https://www.wireflow.ai/blog/weavy-vs-flora)(檢索 2026-07-03)。
- **Figma Weave(原 Weavy)**:2025-10 被 Figma 以約 $200M 收購;node canvas 上同 prompt 同時餵多模型比較結果;2026 再發佈 20+ 工作流模板。來源:[Figma 官方 blog](https://www.figma.com/blog/welcome-weavy-to-figma/)、[Figma Weave FAQ](https://help.figma.com/hc/en-us/articles/35965787376919-Figma-Weave-FAQ)、[techbuzz](https://www.techbuzz.ai/articles/figma-acquires-weavy-launches-ai-canvas-platform-figma-weave)。
- **對本站啟示**:①node canvas 的本質價值=**管線可視化+可複用模板**;本站等價物是導演批次鏈+studio_recipes 配方,但不可視——可考慮把批次鏈以 @xyflow(已在依賴中,00 §1)畫成可檢視/可重跑的流程圖,低成本蹭到同等心智模型;②「同 prompt 多模型對比」本站 ImageStudio 有 23 模型但一次只能跑一個,加「多模型並發對比」是廉價高感知功能。

### 4.6 ComfyUI 團隊化(ComfyDeploy / Comfy Cloud)

- ComfyDeploy:「ComfyUI 的 Vercel」——workflow 一鍵變 API、**workflow 版本化一級公民(tag release/回滾/staging vs production 環境)**、簡化 UI 讓非技術隊友不用碰節點、managed GPU/serverless(RunPod/Modal)。來源:[ComfyDeploy 官方](https://www.comfydeploy.com/)、[GitHub comfyui-deploy](https://github.com/BennyKok/comfyui-deploy)、[runflow 部署指南](https://www.runflow.io/blog/comfyui-deploy-self-host-serverless-managed)、[Comfy Cloud 官方](https://comfy.org/cloud/)(檢索 2026-07-03)。
- **對本站啟示**:①「工作流版本化+staging/prod」對應本站 studio_recipes/versions 的進化方向;②「非技術隊友用簡化 UI 跑固定工作流」正是 15-20 人團隊的真實形態(少數人調管線、多數人按鈕)——本站的「配方」若能一鍵發佈成「團隊模板」(填空即跑),即為同等能力。

### 4.7 Adobe Firefly Services / Custom Models(企業 creative ops 標竿)

- Firefly Services=內容生成/編輯/組裝 API,自動化量產同時保品質控管;**Custom Models 用 10-20 張圖 fine-tune 出品牌風格模型**,Custom Models API 已 GA 可嵌入量產管線;2025-03 起支援影片/3D;Forrester TEI 稱資產變體產能 +70-80%、審修時間 -75%。企業 IT 可用 Admin Console 分配誰能訓練模型。來源:[Adobe 官方新聞 2024-03](https://news.adobe.com/news/news-details/2024/adobe-introduces-firefly-services-and-custom-models-to-accelerate-enterprise-content-creation-and-production)、[Adobe 官方新聞 2025-03](https://news.adobe.com/news/2025/03/adobe-firefly-services-custom-models-unlock-on-brand-content-production)、[Custom Models 產品頁](https://business.adobe.com/products/firefly-business/custom-models.html)、[權限管理 helpx](https://helpx.adobe.com/enterprise/using/assign-users-to-firefly-custom-models.html)(檢索 2026-07-03)。
- **對本站啟示**:①「誰能訓練模型」是企業級權限的一級議題——本站 consent 閘門管素材合法性,但「訓練權」目前人人有;可加 role gate;②Adobe 的量化敘事(變體產能/審修時間)提示本站該收集的採用指標(§5 問題 9)。

### 4.8 RAG / Brand knowledge 常見做法(Jasper IQ、GenStudio 等)

- Jasper IQ=明確的 RAG 架構:吃「Source of Truth」文件(策略 PDF/風格指南)+品牌聲音樣本,產出全部 ground 在其上;2026-03 更新讓 agents 在任何介面都帶著 Brand Voice/Knowledge。GenStudio brand kit 可編碼**機器可讀的語言約束**(禁用詞/語氣限定),輸出先過規則再到人審;第三方統計稱 63% 企業行銷團隊在導入 90 天內至少踩一次品牌規範違規。來源:[Jasper Brand IQ 官方](https://www.jasper.ai/brand-iq)、[Jasper brand voice 官方](https://www.jasper.ai/brand-voice)、[Jasper 2026-03 更新](https://www.jasper.ai/blog/march-2026-product-update)、[influencers-time GenStudio 治理分析](https://www.influencers-time.com/genstudio-ai-creative-governance-brand-and-compliance-rules/)(檢索 2026-07-03;63% 數據出自第三方,未溯源原始研究)。
- **對本站對照**:本站教材 RAG(Pinecone+四視野+稽核)在「知識入庫→檢索注入」上已達 Jasper IQ 同型;缺的是 ①**「注入生效」的預設**(director world context OFF、RAG injection guard OFF)②「約束式」用法——教材目前是「參考知識」,尚無「禁則/必守規範」的 enforce 層(可在 checkSafety/planner 閘上加品牌規則檢查)。

### 4.9 資產管理/審批(Frame.io V4 為代表)+ 發佈

- Frame.io V4:frame 級評論標注、**version stacking**(版本堆疊+並排比對)、metadata 驅動的 **Collections**(自動聚合出「多階段審批」視圖)、自然語言搜尋(「approved 的日落片段」);2026 與 Workfront 打通行銷↔創意工作流。來源:[Frame.io V4 官方](https://frame.io/v4)、[Adobe blog V4 發佈 2024-10](https://blog.adobe.com/en/publish/2024/10/14/frameio-v4-the-fully-reimagined-platform-is-now-available-for-all)、[Frame.io 2025-12 產品更新](https://blog.frame.io/2025/12/09/october-november-2025-product-releases/)、[version stacking 文件](https://support.frame.io/en/articles/4431-version-stacking-and-comparison-mode-legacy)(檢索 2026-07-03)。
- **業界通則歸納**(綜合 §4.1-4.9):credit 制(池化+閾值告警)、佇列+webhook(與本站同構)、資產=狀態機(draft→review→approved)+版本堆疊+Collections、品牌知識=RAG+約束規則、團隊權限=workspace/角色/模型白名單/消費上限、工作流=模板化+版本化+非技術友善殼。
- **對本站啟示**:審批做「狀態+評論+集合」三件即可覆蓋 80% 需求(§3.2-1/2);version stacking 對生成式工作流特別合身(同 prompt 重 roll 天然成版本組——generation_history 已有 jobId 譜系可掛)。

### 4.10 差異化定位(本案 vs 業界)

| 維度 | 業界最佳實踐 | 本站現況 | 判定 |
|---|---|---|---|
| 模型聚合廣度 | OpenArt/Krea 50-100+ | 60+(四模態) | 持平 |
| storyboard→gen | LTX Studio | 導演批次鏈+世界觀 | 持平偏優(世界觀資料結構更深) |
| 一致性 | Elements/Character Builder/Style DNA | Vault 錨點+LoRA+世界觀三層 | **潛在領先,未整合成單一體驗** |
| 知識 RAG | Jasper IQ/GenStudio | 教材庫 RAG(+可轉 LoRA) | 型態領先(多模態素材),enforce 落後 |
| 創作代理 | Firefly Assistant/Krea Node Agent(新) | 光球+25 精靈(schema-first planner) | **深度領先,可靠性(FSM 持久化)落後** |
| credit/佇列 | 池化 credit+閾值告警 | 個人點數+三層限流 | 落後半步(缺池化與透明頁) |
| RBAC/團隊 | workspace+模型白名單+消費上限 | 三級角色+RBAC 旗標 OFF | 落後 |
| 審批/版本 | Frame.io 級 | 無 | **全面落後(最大缺口)** |
| 發佈 | 聚合 API/原生整合 | mock | 落後 |

**差異化機會**(業界無人同時擁有):世界觀+分鏡+一致性錨點+教材 RAG+光球代理五者已在同一資料模型內——把它們串成「IP 空間→一鍵合規生成→代理預審」的閉環,是任何聚合平台(模型層)與任何審批工具(流程層)都不在的位置。前提是先把 §1.2 的協作缺口補到「不扣分」水準。

---

## 5. 待補:團隊實際使用回饋清單(建議訪談 10 題)

1. 過去兩週你在站上完成的最後一件「真的用在工作產出」的事是什麼?從想法到拿到檔案花了多久、卡在哪一步?
2. 你通常從哪個入口開始(導演/Studio/光球/直接找某工作室)?為什麼?有沒有你到現在還「找不到在哪」的功能?
3. 生成完成後你怎麼找到結果?(背景任務抽屜/資產庫/重新生成一次)——有沒有找不到成品的經驗?
4. 你和同事怎麼互相看片/給意見?(站內共享/下載後丟群組/開會投影)如果站內有評論+審批狀態,你會用嗎?最少要有什麼才會用?
5. 點數/每日 40 次限制有沒有實際擋到你?你知道每種生成大概耗多少點嗎?
6. 光球代理:你上次請它做什麼?結果可信嗎?有沒有遇過任務中途消失(重啟蒸發)或答非所問(關鍵字路由誤接)?
7. 教材庫(資料庫)你上傳過東西嗎?上傳的動機是什麼(給 RAG?給 LoRA?純存放)?有感覺到「上傳後 AI 變得更懂我們」嗎?
8. LoRA/一致性錨點:你的角色/風格一致性目前靠什麼達成?同意書流程會不會太麻煩?
9. 如果要向主管證明這個平台值得繼續投入,你會用什麼數字?(產出件數/省下的時數/外包費)現在拿得出來嗎?
10. 你的日常工具鏈(Jira/Drive/LINE/Slack/社群後台)裡,最希望平台接上哪一個?接上後你期待發生什麼(通知/同步/直發)?

> 待補資料面(問卷外):40 次/天配額實際命中率、光球對話量、各工作室 DAU/WAU、共享資產數與被使用次數(api_usage_logs/generation_history/teaching_material_access_log 可直接查)——與 A §4-9 待補清單合併執行。

---

## 6. 缺讀/未核實聲明

- §4 之第三方評測(vidmuse/dupple/eesel/flowith/aiunpacking/stacksheriff/propicked/belreos/wireflow/runflow/influencers-time 等)僅經搜尋摘要交叉比對,**未逐頁開啟原文核實**;關鍵事實(定價、enterprise 功能)已盡量對到官方網域來源(ltx.io、krea.ai、help.runwayml.com、figma.com、adobe.com、jasper.ai、frame.io、comfydeploy.com、florafauna.ai),但官方頁本身也未逐字核實,引用時以官方現行頁面為準。
- LTX 具體價格($35/$125)與 Runway API「2026-01 起僅 Enterprise」出自第三方整理,未在官方頁直接驗證;「63% 品牌違規」數據未溯源原始研究。
- Kling/Hailuo 檢索結果偏模型能力對比,其官方「團隊/工作流」方案細節查得有限(兩者主體是 C 端訂閱+API,團隊治理面弱),故 §4 未單列小節、僅在 §4.5/4.10 以聚合平台承接視角帶過。
- 本文件對 repo 的判定全部轉引 00/01/02/A/E(各自帶行號證據),本輪未新增逐行讀碼;01 §8 缺讀範圍同樣約束本文結論。

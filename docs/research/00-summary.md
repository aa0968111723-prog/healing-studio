# 00-summary — 全站大盤點彙整(Phase 3)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(origin/main HEAD)
- 彙整來源:本系列全部文件——`00-overview`(地圖)、`01-features`(功能)、`02-fullstack`(接線)、`A-cost-integrations`(成本)、`B-infra`(基建)、`C-uiux`(UIUX)、`D-adoption`(實用性×業界)、`E-ai-agents`(AI 代理)、`F-tasks-prs`(任務卡×PR)
- 用途:NotebookLM 研究來源的「入口文件」;細節與證據(檔案:行號)一律回各分冊查

---

## 1. 一句話總診斷

**這是一套「供給側(生成產能)已達業界水準、需求側(審改協作)全斷、可靠性被記憶體態與旗標 OFF 侵蝕」的平台**:60+ 生成模型、導演批次鏈、世界觀/分鏡/一致性錨點、教材 RAG、光球代理五者整合在同一資料模型內(業界無同構者,見 D §4.10),但「brief→生成→**審**→改→交付」在「審」處零支援、大量已寫好的能力藏在預設 OFF 的旗標後、五處關鍵狀態放在記憶體重啟即失。

## 2. 跨主題關鍵發現(依決策重要性排序)

### 2.1 與既有認知不符的事實(全系列勘誤總表)

| 舊認知(背景/舊文件/AGENTS.md) | 實際(證據見分冊) |
|---|---|
| Veo 3.1、Suno V5 | 不存在:fal-ai/veo3(/pro)+Vertex veo-2.0/3.0-preview;Suno 僅 v3.5/v4 且走第三方 proxy(01 §0.1) |
| 品牌 tokens navy/coral/amber/mint、Manrope | repo 0 出現;實際為黏土/蜜金系(#C2613F/#C8922F/#3E9D94,底 #F4EEE4),Noto Sans TC/Inter(C) |
| gamification | 不存在,僅 credits 點數(00) |
| Nixpacks 部署 | 實為 Dockerfile(railway.toml builder=DOCKERFILE)(00) |
| 「雙引擎 RAG」 | 實為 Director CO-STAR 的「事實研究(sonar-pro)+創意編排(大腦 slot)」兩段 LLM;RAG 只有單一 Pinecone(E) |
| social shell 預設關閉 | `.env.production` 設 `VITE_SHELL_SOCIAL=1`,線上 ON,**mock 假發佈暴露給使用者**(B/C) |
| migration journal 到 91 | 實際到 idx 121(B) |
| Open PR 約 69 個 | 實為 89 個,其中 71 個殭屍、64 個對 HEAD 衝突、真活 9 個(F) |
| WIP=1 認領制 | 41 張「進行中」全掛同一帳號,已失語意(F) |

### 2.2 產品層(01/C/D)

1. **審改迴圈全斷**是「能用但沒融入日常」的核心:全站無評論/標注/審批的表與 UI;D 的中期路線以「狀態+評論+集合」三件覆蓋 80% 需求。
2. **結果動線斷裂是最便宜的修復標的**:Studio 頁內結果欄位是死欄位、素材庫抽屜鈕 hidden、`/assets?section=` 聚合死碼讓 /vault、/prompt-library 等 redirect 落錯頁——「生成的東西去哪了」靠口耳相傳(01 §7、C)。
3. **信任損耗點要先止血**:prod 可達的 mock 假發佈、LightOrbCreationStudio 假演示無標示、ProStudio 兩處 UI 說謊(標 AudioLDM2 實走 mmaudio、speed 滑桿不送後端)(C)。
4. UIUX 好範式已存在但分佈不均:VideoStudio(互動狀態)、ImageStudio(行動/a11y)、VideoCockpit(四態)是模範;五大創作頁 0 skeleton、Studio 0 aria/0 空狀態;A11y 最嚴重是 viewport 禁縮放(一行可修)(C)。
5. 差異化定位明確:世界觀+分鏡+錨點+教材 RAG+光球代理同一資料模型;業界(LTX/Runway/Krea/OpenArt/Flora/Weavy)各擁其一、無人全有(D §4)。

### 2.3 AI 代理層(E)

6. `ai.chat` 是 ~2,500 行 17 階段巨石 mutation;精靈實為 25 位但「協作團隊」只有 lead 真執行;agent-plan v3 的 DAG 欄位已定義而 orchestrator 仍純序列。
7. **任務 FSM 全 in-memory 且雙 store 雙寫,redeploy 即蒸發**——使用者感知為「AI 不可靠」;`ORB_TASK_STORE_FILE` 檔案持久化選項存在但未啟用(B/E)。
8. 已寫好但旗標 OFF 的整套能力:觀察者續跑循環、多代理協作、RAG 注入防護、月度 budget/quota 守衛、資料層 RBAC enforcement、refresh token 輪替——**「開旗標」本身就是一條低成本 roadmap**(E/B)。
9. eval 只有 6 個 case 且真燒 LLM;planner 上千行 prompt 鐵則幾乎無對應回歸測試(E)。

### 2.4 成本層(A)

10. **最大 LLM 成本槓桿=大腦 5 slot 有 4 個預設 claude-opus-4.7**,未自訂的使用者每次光球對話都走最貴檔;LLM_CACHE 覆蓋僅 2 處。
11. cron 白燒:braveLearnFetcher/learnDocSyncer 的 LLM 產出只進記憶體重啟即丟;apiHealthMonitor 每日 ≈120 次付費 Gemini 抽測;boot storm 每次重啟重跑(Redis 可解)。
12. 放大器風險:導演批次一鍵可觸發上百筆 fal 任務,而 budget/quota guard 預設 OFF;R2 只進不出(無 lifecycle、cleanup 空轉);前端下載走 Railway proxy(egress 計費)而非 R2 公開網域。
13. 點數制是限流工具而非成本回收(Stripe 全 TODO、無購買 UI),平台成本 100% 自吸收。

### 2.5 基建/安全層(B)

14. **MySQL 102 表 0 外鍵**(參照完整性全靠應用層);Supabase 側 5 張核心表的基底 DDL 不在 repo(schema drift、環境不可重建);雙告警表(MySQL orb_system_alerts vs Supabase system_alerts)實碼與註解矛盾。
15. 安全骨架紮實(雙層 CSRF、SSRF 含 DNS-rebinding、webhook per-job HMAC、JWT 硬化),但:admin email 硬編碼且 env 無法撤銷、JWT_SECRET 身兼三職(輪替有資料風險)、CSP 留 unsafe-inline、proxy-download 白名單過寬(任何人的 S3/R2 bucket)、contentModeration 只護兩端點而 falDispatcher 主出圖路徑無 safety checker、**Sentry 接線完成但套件不在 package.json=線上錯誤追蹤 no-op**。
16. 測試量大(~610 vitest 檔)但 e2e/eval 不在 CI,而 **CI 全部秒掛(runner/帳務問題)→ 目前合併零自動把關**——修 CI 是最高優先流程債(B/F)。

### 2.6 流程層(F)

17. 收斂順序:合 #1298(唯一零衝突列車)→ 關 4 個已被覆蓋 PR → rebase #1249 → 批次關 71 殭屍 PR + 全部 15 個 issue → 修 CI(AIDV-958)→ Jira 大掃除「進行中」41 張與過時卡重驗(AIDV-907/170/873)。
18. 系統性落差模式:列車合了但卡沒關(Wave-1 四卡)、Done≠上線(AIDV-949 部署層落差)、bot 重複開 PR(三胞胎/六組雙開)。

## 3. 給 Bruce 的整體決策建議(取捨排序)

**第 0 步(流程地基,不做後面全部低效)**
1. 修 GitHub Actions runner/帳務 → 恢復 PR Gate;照 F §4 收斂 PR/issue/Jira。

**第 1 波(信任止血+便宜大收益,≤1 個月,對應 D §3.1)**
2. 假成功 UI 止血(social 發佈標示或關閉、光球演示頁加標示、ProStudio 兩處 UI 說謊)。
3. 結果動線修復(/assets section 接線、素材庫抽屜解 hidden、Studio 頁內結果錨點)。
4. viewport 禁縮放一行修 + 五大創作頁補 skeleton(套現成 LoadingCard)。
5. orbTask FSM 開檔案持久化(現成選項)+ 學習/知識資料落 DB(停止 cron 白燒)。
6. 低風險旗標開啟評估:ragInjectionGuard、budget/quota guard、refresh rotation。
7. 大腦預設檔降級(Opus→Sonnet/Haiku 檔)+ 擴 LLM_CACHE 覆蓋——最大成本槓桿。

**第 2 波(融入日常,1-3 個月,對應 D §3.2)**
8. 補「審」:資產狀態機(draft/review/approved)+評論+集合三件;teams 治理收尾(transferOwnership/updateMemberRole 前端接線、ENABLE_DATA_RBAC 開啟計畫)。
9. Slack 生成完成通知(接點已有 webhook 基礎)+ 點數透明頁。

**第 3 波(差異化縱深,3 個月+,對應 D §3.3)**
10. IP 空間閉環(世界觀→分鏡→生成→審→交付單一動線)、批次鏈可視化(@xyflow 已在依賴)、代理進審改迴圈、多代理旗標分級開啟。

**研究面建議**:E 的 eval 擴充(把 planner 鐵則變 case)、B 的 Supabase DDL 收編進 repo、A 的實測數字補齊後把「架構推估」升級為真帳單模型。

## 4. 待補外部數據清單(總表)

### 4.1 Railway / 基礎設施(→A/B)
- RAM 常駐水位與峰值、vCPU 用量、目前月費、egress 量(尤其 proxy-download 佔比)
- 是否有分離 worker/replica(repo 只能看出單 Dockerfile 服務)
- Redis addon 是否已掛(REDIS_URL 實值)
- 線上實際 env 值:ENABLE_DATA_RBAC、ENABLE_REFRESH_TOKEN_ROTATION、SMTP_HOST、LANGSMITH_API_KEY、ENABLE_BUDGET_ALERTS、MIGRATION_FAIL_CLOSED(AGENTS.md 稱已開)、ORB_TOOL_ALLOWED_ORIGINS
- CI runner 秒掛死因(GitHub Billing/spending limit 頁面確認)

### 4.2 資料庫(→B)
- MySQL 實際供應商/規格/DB 大小/連線數
- Supabase 實際 plan、DB 大小、MAU、edge function 呼叫量;dashboard 上 agent_tasks 等表的完整 DDL(收編回 repo 用)

### 4.3 外部 API 帳單(→A)
- fal.ai 月帳單與模型分佈、Replicate、ElevenLabs(訂閱檔+Scribe 用量)、Suno proxy credit 消耗、OpenRouter/Anthropic/Gemini 各 token 帳單、Pinecone plan 與讀寫單位、Brave/NewsAPI/NewsData 檔次、R2 儲存量與 Class A/B 操作數(r2_storage_snapshots 表有歷史可先撈)
- PostHog/LangSmith 方案

### 4.4 團隊使用回饋(→C/D)
- C:實際手感/動效體感/行動裝置實測
- D §5 的 10 題訪談(採用頻率、卡點、審改怎麼發生、資產去哪找、點數感知等)
- director.today 線上版本與 main 的落差清單(F 發現 Done≠上線的部署層問題)

## 5. 文件索引

| 檔案 | 主題 | 一句話 |
|---|---|---|
| `00-overview.md` | 地圖 | 技術棧/路由/資料層/詞彙表(含勘誤) |
| `01-features.md` | 功能 | 逐頁功能+現況判定;§7 非完整項目彙總 |
| `02-fullstack.md` | 接線 | 生成統一管線+逐頁接線表+旗標全表 |
| `A-cost-integrations.md` | 成本 | 依賴地圖+成本結構(全屬架構推估)+降本 |
| `B-infra.md` | 基建 | env/雙DB/安全/測試/可觀測性+技術債 15 項 |
| `C-uiux.md` | UIUX | token 勘誤+優缺點分列+A11y+改善排序 |
| `D-adoption.md` | 實用性 | 審改迴圈斷點+業界對照(附來源)+路線 |
| `E-ai-agents.md` | AI 代理 | 光球 17 階段管線+旗標 OFF 能力清單+eval |
| `F-tasks-prs.md` | 流程 | Jira 970 卡×89 PR×程式碼三方對照+收斂 |
| `G1-video-cockpit.md` | 座艙 | VideoCockpit 逐面板;假上傳/寫路徑空心/panels 死碼 |
| `G2-worldbuilding-detail.md` | 世界觀 | v2-v4 逐欄;管線可規劃不可執行;兩套積木 |
| `G3-orb-tools-spirits.md` | 光球工具 | 178 精靈工具 case 不可達;25 精靈能力表 |
| `G4-misc-audit.md` | 雜項 | npm audit 36 漏洞;.brain-state.json 誤 commit;種子教材硬錯 |
| `H1-model-costs.md` | 模型成本 | repo 內建定價表+典型操作成本速查 |
| `H2-fields-image-video.md` | 欄位字典 | ImageStudio/VideoStudio 逐欄位 |
| `I-debt-dormant.md` | 技術債 | 17 債項三級+沉睡能力四級目錄+喚醒路徑 |
| `J-code-structure.md` | 程式碼結構 | 頂層佈局+規模量化+逐層職責+建置鏈 |
| `K1-security-bugs.md` | 資安 | SSRF/IDOR/webhook/JWT 對抗式漏洞 |
| `K2-generation-bugs.md` | 正確性 | 雙重退款可套利/竊取資產/stale 不退款 |
| `K3-data-integrity.md` | 資料完整性 | GDPR 刪帳必炸/個資永存/跨庫 IDOR |
| `K4-deadcode-contracts.md` | 死碼契約 | 整批 router 死;旗標 10/12 不接線;假測試 |
| `L1-fields-audio-studio.md` | 欄位字典 | ProStudio/Studio/Animation/座艙逐欄 |
| `L2-fields-learn.md` | 欄位字典 | learn shell 逐頁;LearnHub 完整版孤兒頁 |
| `L3-fields-settings-admin.md` | 欄位字典 | settings/admin/dashboard/auth 逐欄 |
| `L4-fields-spine-global.md` | 欄位字典 | 脊椎頁+全域元件+Home;forge 繞過同意書 |
| `PROGRESS.md` | 進度 | 全案狀態(含 G/H/I/J/K/L 波) |

---

## 6. 風險登記表(K 波對抗式 bug 獵人 + L 波地毯掃描,依處置急迫性排序)

> 全部是「靜態掃描找不到、單元測試綠燈掩蓋」的隱藏問題。嚴重度:🔴 立即/可利用 · 🟠 功能名存實亡/合規 · 🟡 品質信號污染。證據行號見各分冊。

### 6.1 🔴 立即級(可套利 / 資安 / 資料損毀)

| # | 問題 | 觸發情境 → 後果 | 出處 |
|---|---|---|---|
| R1 | **generate.multimodal 雙重退款** | 四模態同步生成失敗 → 內層退款後 throw、外層 catch 再退一次 → 可穩定重現套利點數 | K2 |
| R2 | **GDPR 刪除帳號整條路徑必炸** | 呼叫刪帳 → USER_OWNED_TABLES 含 10 張無 userId 欄的表 → SQL 錯 → 交易回滾 → 連使用者都刪不掉;錯誤還餵電路斷路器可全站 503;零測試覆蓋 | K3 |
| R3 | **10 張有 userId 的表漏在刪除清單外** | 刪帳「成功」後 → consistency_vault/orb_conversation_messages/studio_versions/timeline_frames 等個資永久留存 | K3 |
| R4 | **生成入口參考圖 SSRF** | firstFrameUrl 等填內網/metadata URL + 302 跳轉 → 無白名單、下游無 redirect:error → 打進內網/雲端 metadata | K1 |
| R5 | **ElevenLabs 三路徑 SSRF** | 資料庫音/影上傳 → 轉錄/配音/克隆缺 redirect:error → 任何登入者觸發內網探測 | K1 |
| R6 | **跨 studio 竊取生成資產** | image/proStudio 的 checkImageStatus/checkAudioStatus 無 owner 檢查(videoStudio 有)→ 傳他人 requestId 竊取資產 | K2 |
| R7 | **models.teamModels 無旗標可關洩 LoRA 權重** | 任何登入者 → 外洩全站 team_shared LoRA 模型含權重 URL(比 assets 的 RBAC 洩漏更嚴重,無修復開關) | K1 |
| R8 | **forge 分頁繞過肖像權同意書** | 光球觸發隱藏 forge 訓練分頁 → 送出不含 subjectType/consentIds → 後端判 requiresConsent=false → 真人照片訓練繞過同意閘門 | L4 |

### 6.2 🟠 功能名存實亡 / 合規

| # | 問題 | 說明 | 出處 |
|---|---|---|---|
| R9 | **FeatureFlagService 10/12 旗標不接線** | IMAGE_GENERATION/VIDEO_GENERATION/MODEL_TRAINING 宣稱「關閉回 503/拒絕」,全站無程式碼真檢查 → 想停某模態生成停不掉 | K4 |
| R10 | **178 個精靈工具 case 不可達** | executor gate 只路由 6 分支 → planner 會規劃、執行必敗;測試 mock 掉執行器測不到 | G3 |
| R11 | **整批 router 死碼** | apiKey/rbac(全 4)/webhook/externalServices/musicSpecialist/orbCapabilities 後端完整、前端零呼叫 | K4 |
| R12 | **stale 任務永不退款** | staleJobChecker 標 failed 但從不退款 → 點數永久遺失(proStudio 註解誤以為會退) | K2 |
| R13 | **告警規則 CRUD 無 UI** | apiUsage.alerts(budget/quota/anomaly)後端完整,管理員無法從 UI 設定任何告警 | L3 |
| R14 | **LearnHub 完整版/AIModelsHub 是 prod 孤兒頁** | 三旗標 ON 下 ShellRoutes 永遠 shadow 舊 Route → 站內無路徑可達完整版(admin CRUD/比較器/影片/測驗全失聯) | L2 |
| R15 | **orbTask FSM in-memory 重啟即失** | redeploy/多 replica → 任務狀態蒸發,無恢復;idempotency/quota guard 預設 OFF → 重複提交重複扣點 | K2/K3 |
| R16 | **雙 DB 分裂 + 跨庫 IDOR** | orb_system_alerts vs system_alerts 雙寫矛盾;handoffTrace 只驗登入不驗擁有權 → 跨庫 IDOR;Supabase 5 表 DDL 不在 repo 不可重建 | K3 |

### 6.3 🟡 品質信號污染 / 大量死欄位

| # | 問題 | 說明 | 出處 |
|---|---|---|---|
| R17 | **假測試** | four-area-audit.test.ts 33 斷言 11 個 expect(true);agentCapabilityRouter 零使用卻 457 行精細測試 → 覆蓋率不可信 | K4 |
| R18 | **死開關/死欄位滿佈** | Studio「閃電/深度精確」模式選了沒用(mode 零引用)、Studio 音樂歌詞/能量不送後端、ProStudio TTS speed 滑桿沒渲染、VideoStudio 無 seed UI、settings 13/22 欄死、LoRA 4/10 類別送出必 400、VideoCockpit codec/provider 裝飾欄 | L1/L3/L4/H2 |
| R19 | **npm 依賴漏洞 2C/9H** | protobufjs RCE(可 audit fix)、drizzle-orm SQLi(需手動升)、Sentry 套件未裝→線上錯誤追蹤 no-op | G4/B |

### 6.4 修復批次建議(對應 §3 三波)
- **第 0 波(緊急,合規+套利+資安)**:R1(雙重退款)、R2/R3(GDPR)、R4-R7(SSRF/IDOR/資產竊取)、R8(同意書繞過)——這 8 條都是可利用或法遵風險,應優先開卡。
- **第 1 波(功能真實化)**:R9(旗標接線)、R10(精靈工具 gate)、R12(退款)、R13(告警 UI)、R14(孤兒頁路由)、R15(FSM 持久化)。
- **衛生波**:R11(清死 router)、R17(修假測試)、R18(清死欄位)、R19(依賴升級)。

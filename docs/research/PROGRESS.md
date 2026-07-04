# healing-studio 全站大盤點 — 進度追蹤(PROGRESS)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`(branch `claude/healing-studio-audit-m2v1o4`)
- 規則:每完成一個階段/子代理立即更新本檔。中斷後從未完成處接續,不重做已完成部分。
- 狀態圖例:☐ 未開始 / ◐ 進行中 / ☑ 完成

## 階段清單

| 階段 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| Phase 0:建立地圖 | `00-overview.md` | ☑ 完成 | 技術棧(React19+wouter+tRPC+雙DB)、4-shell 路由全表、60+ tRPC 命名空間、102 MySQL 表、30+ cron、詞彙表(修正:非 Nixpacks 而是 Dockerfile;gamification 不存在;光球/精靈/4-shell 為核心詞彙) |
| Phase 1-1:功能全貌 | `01-features.md` | ☑ 完成 | 逐頁功能表+現況判定(完整/半成品/停用+證據);重大修正:無 Veo 3.1/Suno V5、DirectorAI 頁被 Cockpit 旗標接管、/assets section 聚合死碼、social 發佈 mock、LearnHub 影片/測驗 ephemeral;§7 全站非完整項目彙總 |
| Phase 1-2:全端接線 | `02-fullstack.md` | ☑ 完成 | 生成統一管線(扣點→fal/Gemini→doPostGenComplete 三表→R2 歸檔)、逐頁接線表、RAG 全鏈(Pinecone gemini-embedding-001)、光球接線(FSM in-memory)、SSE/WS 總表、featureFlags 全表、cron→表對應 |
| 子代理 A:成本 × 外部整合 | `A-cost-integrations.md` | ☑ 完成 | 依賴地圖+cron 常駐消耗+四情境成本結構(全屬架構推估);關鍵:大腦 4 slot 預設 Opus 檔=最大 LLM 成本槓桿、LLM_CACHE 覆蓋僅 2 處、cron 產出進記憶體=外呼白燒、R2 只進不出、導演批次=單擊放大器且 budget guard 預設 OFF、Suno 第三方 proxy 供應鏈風險 |
| 子代理 B:基礎設施 × DB × 安全 × 測試 | `B-infra.md` | ☑ 完成 | env 盤點(風險分級)、雙 DB 分工與 Supabase 23 migrations 實掃、安全防護層總盤、測試/CI/部署、可觀測性、技術債 15 項+近中長期優化路徑 |
| 子代理 C:UIUX 優缺點 | `C-uiux.md` | ☑ 完成 | 重大勘誤:背景品牌 tokens 不存在,實際為黏土/蜜金系(index.css AIDV-74);A11y 最嚴重=viewport 禁縮放;五大創作頁 0 skeleton vs 資產/後台 12-14 個(範式不均);prod 假成功 UI(mock 發佈/光球演示頁);優缺點分列+高中低優先改善排序 |
| 子代理 D:實用性 × 業界對照 | `D-adoption.md` | ☑ 完成 | 核心診斷:供給側達業界水準、「審改迴圈」全斷是未融入日常的主因;業界對照(LTX/Runway/Krea/OpenArt/Flora/Weavy/ComfyDeploy/Jasper,附來源);差異化=世界觀+分鏡+錨點+教材RAG+光球同一資料模型;近中長期路線+10 題團隊訪談清單 |
| 子代理 E:AI 代理架構 | `E-ai-agents.md` | ☑ 完成 | 光球後端管線(ai.ts 3366 行實讀)、精靈/具名代理/多代理協作、CO-STAR 實作、planner+eval、llmRouter 多供應商抽象、RAG「雙引擎」查證、MCP 現況、安全邊界與優化建議 |
| 子代理 F:任務卡 × PR × 程式碼三方對照 | `F-tasks-prs.md` | ☑ 完成 | Jira 970 卡(Done 873/未完 97)、Open PR 實為 89(殭屍 71、衝突 64、真活 9);#1298 唯一零衝突列車;WIP=1 失守(41 卡同帳號進行中);CI 30/30 秒掛=runner 問題;15 個 GitHub issue 全可關;收斂順序建議 |
| Phase 3:彙整 | `00-summary.md` | ☑ 完成 | 跨主題總診斷(供給側達標/審改全斷/記憶體態+旗標 OFF 侵蝕可靠性)、勘誤總表、三波決策建議、待補外部數據總表、文件索引 |

## 補洞 wave G(Bruce 2026-07-03 加開)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| G1:VideoCockpit 座艙 | `G1-video-cockpit.md` | ☑ 完成 | 預設入口逐面板盤點;假上傳成功、寫路徑空心、panels 整目錄死碼、雙光球疊 z-index |
| G2:世界觀/分鏡逐欄 | `G2-worldbuilding-detail.md` | ☑ 完成 | v2 擴充幾乎全落地(至 v3/v4);管線可規劃不可執行(工具名不存在);兩套積木系統;custom_blocks_combo 孤兒表 |
| G3:光球工具×精靈能力 | `G3-orb-tools-spirits.md` | ☑ 完成 | **bug 級發現:178 個精靈工具 case 不可達**(gate 只路由 6 分支;planner 會規劃、執行必敗、測試 mock 掉測不到);真正可達內建工具僅 37;@精靈聊天走 spirit.invoke 有替代活路;25 精靈能力表+暱稱漂移清單;OrbVoiceButton 名實不符(批次非 Live) |
| G4:依賴漏洞×雜項 | `G4-misc-audit.md` | ☑ 完成 | npm audit 36 漏洞處置表(drizzle-orm SQLi 需手動);load-tests=k6;.brain-state.json 誤 commit;Home 800 行旗標休眠碼;種子教材硬錯 |

## 補充 wave H(Bruce 2026-07-03 加開:模型成本+欄位字典+資料表字典)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| H1:模型成本全表 | `H1-model-costs.md` | ☑ 完成 | repo 內建定價表逐模型抽出(409 行)+典型操作成本速查;聲明「內建估價≠實際帳單」 |
| H2:欄位字典(圖/影) | `H2-fields-image-video.md` | ☑ 完成 | ImageStudio/VideoStudio 逐欄位;VideoStudio 無 seed UI、~35 隱藏 zod 欄、flux2 參考圖上限炸 400、Wan 可用性查表失效 |
| H3:欄位字典(音/統一/世界觀/座艙) | 併入 `L1-fields-audio-studio.md` | ☑ 完成(重寫) | 原 Fable5 中斷未寫出;已於 wave L 地毯掃描重新逐行實讀並寫出,不再另立檔案 |
| H4:資料表字典×對外 API | `H4-data-dictionary-api.md` | ☐ **待補** | Fable5 額度中斷,研讀完未寫出 |

## 補充 wave I / J(Bruce 2026-07-03 加開)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| I:技術債總帳×沉睡能力×喚醒路徑 | `I-debt-dormant.md` | ☑ 完成 | 技術債 17 項分三級(立即/結構/衛生)+沉睡能力四級目錄(開旗標/前端接一下/資料在燒/補一段就通)+發揮優先序矩陣 |
| J:完整程式碼結構總覽 | `J-code-structure.md` | ☑ 完成 | 頂層佈局、規模量化(52 頁/307 元件/76 router/184 服務/602 測試)、前後端逐層職責、行數大戶、建置部署鏈、依賴要點 |

## 深挖 wave K(Bruce 2026-07-03:對抗式 bug 獵人,找隱藏問題)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| K1:對抗式安全/認證 | `K1-security-bugs.md` | ☑ 完成 | 4 高危:生成入口參考圖 SSRF(無白名單+無 redirect:error)、ElevenLabs 三路徑 SSRF、assets.teamAssets 跨租戶 IDOR(RBAC OFF)、models.teamModels 無旗標可關洩 LoRA 權重;+proxy-download/safeMediaUrl 萬用尾碼白名單缺陷 |
| K2:生成/扣點正確性 | `K2-generation-bugs.md` | ☑ 完成 | 🔴 generate.multimodal 雙重退款可套利(內層退+外層catch再退);staleJob 永不退款點數永久遺失;image/proStudio 缺 owner 檢查可竊取他人資產;creator_job_throttle 固定窗邊界雙倍超限;seed=0 truthy 丟棄範圍擴大 |
| K3:資料完整性/雙DB | `K3-data-integrity.md` | ☑ 完成 | 🔴 GDPR 刪帳整條必炸(USER_OWNED_TABLES 含 10 張無 userId 表→SQL錯→交易回滾→刪不掉,零測試)+餵電路斷路器全站503;10 張有 userId 表漏在清單外→個資永存;resource_shares 三向不清;跨庫 IDOR(handoffTrace 只驗登入) |
| K4:死碼/契約不符/假測試 | `K4-deadcode-contracts.md` | ☑ 完成 | 整 router 死掉一批(apiKey/rbac全4/webhook/externalServices/musicSpecialist/orbCapabilities);FeatureFlagService 12 旗標 10 個不接線(IMAGE/VIDEO_GENERATION 宣稱回503但無檢查);settings.update 13/22 死欄位;假測試實錘(four-area-audit 11 個 expect(true));agentDlqPoller 輪詢永遠空表;孤兒服務/元件多個 |

## 地毯掃描 wave L(Bruce 2026-07-03:逐欄逐元件逐頁)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| L1:音訊/統一/世界觀/座艙 | `L1-fields-audio-studio.md` | ☑ 完成 | Studio 閃電/深度模式死開關;歌詞/能量不送;TTS speed 無渲染 |
| L2:learn shell | `L2-fields-learn.md` | ☑ 完成 | LearnHub 完整版/AIModelsHub prod 孤兒頁;TeachingArchive update 零呼叫 |
| L3:settings/admin/dashboard/auth | `L3-fields-settings-admin.md` | ☑ 完成 | 告警規則 CRUD 無 UI;精靈靜音/最愛無 UI;system_settings 19 欄死 |
| L4:脊椎頁+全域元件+Home | `L4-fields-spine-global.md` | ☑ 完成 | forge 分頁繞過同意書;LoRA 4/10 類別死路;Home 13/14 旗標 OFF |

## 全案狀態(2026-07-03)
- 主體 Phase 0-3 ☑ + 補洞 G1-G4 ☑ + 補充 H1/H2/I/J ☑ + 深挖 K1 ☑(K2-K4 進行中)
- **待補**:H3、H4(Fable5 額度中斷,已完成研讀待重寫)
- 完整 PDF:持續交付最新版給 Bruce

## 執行備註
- **2026-07-03 Bruce 指示:不用逐階段等確認,連續執行到全案完成**(僅每階段更新本檔+commit push 留檔)。
- Phase 2 順序:A → B → E → F →(C、D)。
- Railway 部署問題本次不處理;實際用量數字集中列「待補清單」。

## 方案設計 wave M(Bruce 2026-07-03:上傳創作系統本質,要求解決方案貼合本質)

| 項目 | 產出檔 | 狀態 | 摘要 |
|---|---|---|---|
| M0:北極星對齊藍圖(彙整) | `M0-solution-blueprint.md` | ☑ 完成 | 四軌織成單一專案一條龍;本質七支柱對照;creativeProjectId 為串接鑰匙;G3 gate 為唯一硬前置;不跑偏三層模型;統一分階段路線 |
| M1:專案主幹+逐幕拼接+輸出打包 | `M1-project-spine-assembly.md` | ☑ 完成 | creative_projects 為 SSOT;分鏡管線執行化=轉呼既有 16 studio.* 工具+AIDV-44 狀態機;kind=video 缺 adapter;compose 唯一大件新建 |
| M2:單專案 AI+逐步引導+防跑偏 | `M2-project-agent-guidance.md` | ☑ 完成 | ProjectFlowGuide 已是五步引導實體(旗標鎖住)、contextPackets 子系統已在;修 G3 gate 為條件式前置;對齊門借 aidv-longloop 鎖創作者向 |
| M3:連接器/資料庫/自動化流 | `M3-connectors-workflows.md` | ☑ 完成 | 三路徑成熟度分層;連接器後端真實非空殼但 UI 三層分裂;Adobe/Canva 走產品自建 MCP client |
| M4:素材/目標/審改協作 | `M4-assets-goals-review.md` | ☑ 完成 | 給 creative_projects 裝素材/目標/狀態三柱;重用 schema+加 2 欄 3 表;目標管理=防跑偏產品化 |

## 決策/深研/深挖各波(N–GC,2026-07-03 火力全開)

> Bruce 指示「自動長時間火力全開研究,等我說開始討論才停」+ ultracode。以下為 M 波之後全部波次,皆已 commit push 至 PR #1303。

| 波次 | 範圍 | 狀態 | 產出 |
|---|---|---|---|
| N 波 | 決策卡(實作/架構/優先序/成本維運) | ☑ | N1-N4 |
| P 波 | 深研(UIUX/創作者流/業界對照/安全/測試CI/資料RAG) | ☑ | P1-P6 |
| Q 波 | spec(場景編輯器/compose spike/對齊門/orb工具全表/MCP自動化) | ☑ | Q1-Q5 |
| R 波 | 子系統深挖(llmRouter/RAG記憶/eval規劃/cost ledger) | ☑ | R1-R4 |
| S 波 | 策略(onboarding/credits團隊池/mobile/北極星遙測) | ☑ | S1-S5 |
| T 波 | 開發 playbook(首批/安全/資料 PR) | ☑ | T1-T3 |
| U 波 | 逐檔深挖(db monolith/ai.chat/fal派工/autorepair/skill沙箱/costar) | ☑ | U1-U6 |
| V 波 | 逐檔深挖(image/video router/orb任務引擎/安全中介/世界觀生成) | ☑ | V1-V4 |
| W 波 | 逐檔深挖(director/proStudio/generate/brainPipeline/計費核心/siteKnowledge/webhook/ai.ts/cron-workers) | ☑ | W1-W9 |
| X 波 | 伺服端地毯掃描 17 檔 + 對抗式驗證(40 確認/9 推翻/1 待驗) | ☑ | X1-X17 + X0 綜合 |
| Z 波 | 自建 MCP vs 採用外部 MCP 架構策略(8 MCP + 代碼盤點) | ☑ | Z1 |
| Y 波 | 前端逐頁地毯掃描 10 頁 + 北極星流程實況(20 可證偽 0 推翻) | ☑ | Y1-Y10 + Y0 綜合(Y4 已於 CC1 重跑) |
| CC 波 | 覆蓋補完(Y4重跑/shared契約/falModels/剩餘orb/剩餘router)+ 完整性批判 | ☑ | CC1-CC5 + CC0 |
| GC 波 | 缺口補完(auth/export/plans、計費守衛層、憑證加密、RAG授權矩陣) | ⏳ 進行中 | GC1-GC4 |

## 討論用索引(2026-07-03 新增,Bruce 指示放入任務卡逐一討論 + 隔開研究討論開發專區)
- `00-discussion-taskcards.md`:**稽核問題卡**(往回修)——計費/安全IDOR/注入/持久化/衛生,~90 張卡,含 W/X/Y/Z/CC 波確認卡。
- `00-devzone.md`:**研究討論開發專區**(往前做)——北極星 NS 卡(含 Y 波三斷點 NS-08/09/10)、SYS-01 自建 MCP 策略、D 決策、DEV playbook、研究登記。

## 三大重點群(供 N0 決策議程,待 Bruce 說「開始討論」)
1. **計費雙向壞**:有的路徑不收/不退(B-01/B-03/B-07/B-16/B-19),有的超收(X3 B-10);costAnalytics 對主流量 LLM 失明(B-11)。信心高。
2. **IDOR 系統性**:同形反覆(realEarth 教材外洩、langsmith 全站對話外洩、collab 劫持、brain 跨用戶、models 團隊、orbClarification 寫入);共同根因 getBackgroundJob 無 userId + 「先寫/讀,owner 檢查下放呼叫端」。信心高。
3. **北極星流程斷點**:分鏡後斷裂(生成三工具與腳本卡失聯、拼接不存在、打包死UI);AI 讀單一專案在資料/旗標/執行三層同斷;shell 路由 shadow 掉核心頁。信心高(前端)。
- 另:MCP 路線建議 (c) 自建 client 先接 HF/Canva(Z1);SSOT-1 為 W1 navigate 白名單根因(CC2)。

## 連續缺陷獵取波(Bruce「停下來就自動找缺陷不閒著」+「可以與業界對齊」,2026-07-03/04)

| 波次 | 範圍 | 狀態 | 產出 |
|---|---|---|---|
| DV | 依賴弱點可達性(11 npm critical/high) | ☑ | DV1-4 + DV0(僅 ws reachable-prod) |
| IN | 接縫稽核(前後端契約/頁面交接/元件接線/欄位跨層/事件背景) | ☑ | IN1-8 + IN0 接縫地圖 |
| IA | 業界對齊(北極星流程/計費/安全/AI代理) | ☑ | IA1-4 + IA0 計分卡 |
| RC | 並發競態(TOCTOU/無鎖/多實例) | ☑ | RC1-4 + RC0(B-27 免費點數繞過) |
| PF | 效能/無界查詢/記憶體 | ☑ | PF1-4 + PF0(geminiMedia OOM) |
| EH | 錯誤處理/失敗模式 | ☑ | EH1-4 + EH0(B-31 退款吞錯、B-32 Stripe stub) |
| FL | 旗標矩陣(50+ ENABLE_*) | ☑ | FL1-4 + FL0(7 守衛出廠即關) |
| DI | 無FK資料完整性/孤兒/GDPR | ☑ | DI1-4 + DI0(DI-01 帳號刪除 100% 失敗) |
| AX | a11y/行動裝置 | ☑ | AX1-4 + AX0 |
| TC | 測試覆蓋缺口 | ☑ | TC1-4 + TC0(測試鎖死 bug 為規格) |
| SD | schema/migration 漂移 | ☑ | SD1-3 + SD0(快照落後 78 表、DI-01 深化) |

**缺陷面盤點已飽和**(18 維度:server/client 逐檔、shared 契約、auth/計費/憑證、MCP、完整性、接縫、依賴、業界、並發、效能、失敗模式、旗標、資料完整性、a11y、測試覆蓋、schema 漂移)。續補外部數據待 Bruce/Railway:各 ENABLE_* 與 PINECONE_API_KEY/MIGRATION_FAIL_CLOSED 生產實際值、Railway 用量、團隊回饋、第三方單價、migration 0059 是否已套用。

## N0 決策議程頭條(待 Bruce 說「開始討論」時展開)
1. 🔴 認證密鑰外洩:S-00 auth.me + S-37 admin.allUsers(passwordHash/2FA 給任何 admin)
2. 🔴 計費層形同虛設:B-27 自給免費點數 + B-31 退款吞錯帳目說謊 + B-32 Stripe webhook 全 stub + B-22 守衛出廠即關 + X3 雙重超收
3. 法遵:DI-01 帳號刪除 100% 失敗、PII/R2 全殘留(被遺忘權未履行)
4. IDOR 系統性:realEarth/langsmith/brain/models/collab 教材與對話外洩(集中式物件授權中介層一次解)
5. 北極星分鏡後斷裂 + prod 旗標 OFF(功能碼在但關著):拼接不存在、生成與腳本卡失聯、PROJECT_HUB/DIRECTOR_WORLD_CONTEXT prod OFF
6. 可用性/DoS:geminiMedia 使用者 URL 下載無上限 OOM、ws 未鑑權 frame、void 呼叫可觸發全站重啟
7. 業界對齊 top-5(webhook HMAC/BOPLA/計費 outbox/物件授權中介/scene 一級實體)、MCP 路線 c(自建 client 先接 HF/Canva)

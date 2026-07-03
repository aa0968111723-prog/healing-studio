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
| H3:欄位字典(音/統一/世界觀/座艙) | `H3-fields-pro-studio-animation.md` | ☐ **待補** | Fable5 額度中斷,研讀完未寫出 |
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

## 全案狀態(2026-07-03)
- 主體 Phase 0-3 ☑ + 補洞 G1-G4 ☑ + 補充 H1/H2/I/J ☑ + 深挖 K1 ☑(K2-K4 進行中)
- **待補**:H3、H4(Fable5 額度中斷,已完成研讀待重寫)
- 完整 PDF:持續交付最新版給 Bruce

## 執行備註
- **2026-07-03 Bruce 指示:不用逐階段等確認,連續執行到全案完成**(僅每階段更新本檔+commit push 留檔)。
- Phase 2 順序:A → B → E → F →(C、D)。
- Railway 部署問題本次不處理;實際用量數字集中列「待補清單」。

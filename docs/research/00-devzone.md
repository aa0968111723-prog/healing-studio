# 00 — 研究討論開發專區(DEVZONE・LIVING 文件)

- 產生日期:2026-07-03
- 依據 commit:`b743d2ac`(每次更新遞增)
- 性質:**「往前做」的專區**——研究 → 討論 → 決議 → 開發。與 `00-discussion-taskcards.md`(**「往回修」的稽核問題卡**:計費/安全/注入/持久化/衛生)刻意分開,兩本互不混雜。
- 卡狀態流水線:`研究中` → `待討論` → `已決議` → `開發中` → `已完成`。每張卡標目前狀態。
- 關係:本專區的功能卡多源自 `M0-solution-blueprint.md`(北極星藍圖)、`N1-N4`(決策)、`T1-T3`(開發 playbook)、`Q1-Q5`(spec)、`Z*`(策略研究)。稽核問題卡見另一本。

---

## 0. 兩本的分工(一眼看懂)

| | `00-discussion-taskcards.md` | `00-devzone.md`(本檔) |
|---|---|---|
| 性質 | 往回修:稽核揪出的缺陷 | 往前做:研究/討論/開發 |
| 內容 | 計費失效、安全/IDOR、注入、持久化、衛生 | 北極星功能、系統架構策略、決策、dev playbook、研究線 |
| 卡前綴 | B / S / I / PS / HG | NS / SYS / D / DEV / Z |
| 動作 | 修 bug、止血 | 蓋新能力、選路線、拍板 |
| 討論節奏 | 逐卡評估「要不要修、排第幾波」 | 逐卡討論「要不要做、怎麼做、先做哪步」 |

> 提醒:兩本都是討論素材,等 Bruce 說「開始討論」時一起過。研究仍在跑(W/X/Z 波),坐實新卡會續補。

---

## A. 北極星一條龍開發卡(源自 M0 藍圖)

> 核心信念:**零件八成已在,被旗標與單一殼鎖住;不是重造,是解放+接線+補對齊門。全程用 `creativeProjectId` 串成一條龍就是「不跑偏」的地基。**

### 卡 NS-00 ·【P0 硬前置】修 G3 178-tool gate — 狀態:待討論
- 為何是前置:分鏡管線執行化(NS-03)與 AI 動手引導共同依賴工具可達;不先修,體驗會蓋在「規劃會過、執行必敗」的假成功上。
- 出處:`M0 §4`、`G3-orb-tools-spirits.md`、`Q4-orb-tools-full-registry.md`(修好後 14 個生成工具免費解鎖)。
- 第一步 spike:`agentToolExecutor.ts` gate 區塊 + `global-agent-tools.ts` 補 63 筆 registry + 不 mock 執行器的可達性整合測試。
- **待討論**:是否列為 Phase 0 第一張票。

### 卡 NS-01 ·【功能】解放 ProjectFlowGuide 五步引導、接光球 — 狀態:待討論
- 現況:世界觀→劇本→分鏡→生成→成片的五步引導實體已存在(狀態純函式推導),鎖在 /video 殼、`ENABLE_PROJECT_HUB` OFF。
- 出處:`M2 §3.2`。**待討論**:抽 `deriveProjectJourney` 共用模組供光球讀 + 解 flag。

### 卡 NS-02 ·【功能】creativeProjectId 貫穿為 SSOT、禁猜最新一筆 — 狀態:待討論
- 現況:三套專案並存、建案沒照關係走;`video_projects.creativeProjectId` 欄早已存在。
- 出處:`M1 軌A`。**待討論**:定 creative_projects 為唯一主鍵,任何操作必帶專案 id。

### 卡 NS-03 ·【功能】分鏡管線執行化(planPipeline → studio.* 工具) — 狀態:待討論(依賴 NS-00)
- 現況:planPipeline 產出的工具名 server 不存在、AIDV-44 狀態機零呼叫。
- 出處:`M1 軌B`。**待討論**:`storyboardPipelineRunner.ts` + `worldStoryboard.runPipeline` + kind=video adapter。

### 卡 NS-04 ·【功能】contextPackets 接上 ai.chat/director,AI 真讀單一專案 — 狀態:待討論
- 現況:contextPackets 子系統(source-agnostic + adapter + lineage + TTL + sanitize)已在,半成品、發現性差。
- 出處:`M2 §3.1/3.3`、`R2-rag-memory-deepdive.md`。**待討論**:接 `ai.chat`/`director.chat` + 開 `ENABLE_DIRECTOR_WORLD_CONTEXT`。
- ⚠️ 注意與稽核卡 I-01(pageContext 注入)協調:接專案上下文時務必走 sanitize/標 untrusted。

### 卡 NS-05 ·【功能・唯一大件新建】compose 拼接服務 — 狀態:待討論(需先 spike)
- 現況:逐幕三軌資料模型已在(唯讀預覽),缺編輯器與拼接;compose 是全藍圖唯一大件新建。
- 出處:`M1 軌E`、`Q2-compose-service-spike.md`。**待討論**:ffmpeg vs 委外 API 技術 spike 先行;輸出借 `videoProject.requestExport` 殼 + 既有 JSZip 打包。

### 卡 NS-06 ·【功能】連接器 UI 收斂 + Adobe/Canva MCP client — 狀態:待討論(與 SYS-01 合看)
- 現況:連接器後端已有(AES-256-GCM 加密、drive/Notion adapter、user_workflows),UI 三層分裂、發現性差。
- 出處:`M3`。**待討論**:與 SYS-01(自建 MCP)一起決定 Adobe/Canva 走 MCP client 還是各自 SDK。

### 卡 NS-07 ·【功能】素材/目標/審批三柱綁 creativeProjectId — 狀態:待討論
- 現況:digital_asset_library/consistency_vault/resource_shares/teams 資料底已在,未綁專案、enforcement OFF、無評論表。
- 出處:`M4`。**待討論**:資產加 creativeProjectId + 狀態機(draft/in_review/approved)+ 評論表 + 目標 tracker(= 防跑偏產品化)。Y8 CONFIRMED:目標管理 UI 全站不存在、Project 型別只有 progress 數字,**從未建模**;素材庫與 creativeProjectId 三層(client/router/DB)皆無綁定。

### 北極星前端實況(Y 波地毯掃描確認,見 `Y0-frontend-carpet-scan-synthesis.md`)
> 一句話:北極星「腳本→分鏡→逐幕→拼接→輸出→打包」在前端**分鏡之後就斷裂**。三個關鍵斷點 + 建議優先序(Y0 §5):

### 卡 NS-08 ·【最高 ROI・先修】修 4-shell 路由 shadow(SettingsShell + LearnHub 孤兒化) — 狀態:待討論
- 現況(CONFIRMED):`/settings` 富殼把 AdminPage/AgentPreferencesPage/SettingsPage 全 shadow 成孤兒頁(含唯一重置引導入口);LearnHub 整檔正式環境 100% 不可達(北極星① 的 UI 入口)。同構問題,可能同一次修復解決。
- 為何先修:不需重新設計功能,只需把 `shellRouteTable.ts` 已登記的頁面正確接上 `App.tsx` `<Switch>` / `SettingsShell.tsx` 路由映射。投資報酬率最高,且順手驗收 LearnHub 同款 shadow。
- 出處:Y0 §5 斷點3、FE-01/FE-02。

### 卡 NS-09 ·【地基・優先於 UI 修補】creative_projects 範疇化資料遷移 — 狀態:待討論
- 現況(CONFIRMED):北極星承諾「AI 讀單一專案上下文」在**資料庫 schema 就不成立**——DirectorAI 腳本/分鏡操作(chat/saveSession/listSessions)無 projectId 範疇化,`project_notes_calendar` 無此欄位;AssetsLibrary/ProjectNotesDrawer 與 creativeProjectId 無綁定。ProjectsContext `pickActive()` 還靜默 fallback「最新更新一筆」(違反不跑偏)。
- 動作:先加 `project_notes_calendar.creativeProjectId`、`digital_asset_library.creativeProjectId` 等核心表遷移,再逐一補寫入/查詢過濾;`pickActive` 改強制釘選或明標「系統猜測」。
- 出處:Y0 §5 斷點1、NS-02、FE-04、Y8 CONFIRMED。這是 M1 SSOT 主張的資料層前置。

### 卡 NS-10 ·【最高槓桿・大件】最小可用 compose 拼接服務 — 狀態:待討論(= NS-05 深化)
- 現況(CONFIRMED):全代碼庫無真正媒體合成服務,`videoCompiler`/`audioCompiler` 只是提示詞編譯器;VideoStudio 全檔 zip/打包/匯出/拼接/compose 皆 0 命中;五步引導「成片」步驟永遠無可執行動作(死 UI)。逐幕生成三工具(圖/影/音)還互相獨立、與腳本卡失聯(`resultUrl` 恆 null)。
- 動作:落地最小可用 compose(哪怕只是依腳本順序串接生成結果的陽春版)——Y0 判定為「解鎖腳本到成片閉環最高槓桿的單一投資」。先修生成結果回填腳本卡(VideoStudio resultUrl:null,比照 ImageStudio 既有正確實作)。
- 出處:Y0 §5 斷點2、M1 NS-05/Q2、C-01。

---

## B. 系統架構策略卡

### 卡 SYS-01 ·【策略】自建 MCP 原生系統 + 參考 8 個 MCP — 狀態:✅ 研究完成,待討論
- 緣起:Bruce 提「也可以考慮自建一套自己的系統,並參考這些 MCP 去研究」。
- 研究產出:**`Z1-mcp-architecture-strategy.md`**(已完成,含 8 MCP 對照表 + 四路線矩陣 + build-vs-adopt 建議)。
- **Z1 推薦(供討論)**:
  - **首選路線 (c) 自建 MCP client 消費外部 MCP**,**Canva 為第一個試點**;輔以 **(a) agent 端即用 Hugging Face 官方 MCP** 作零成本影子路徑。與 M0 七支柱藍圖既定方向一致,與現有 `connectionService.ts`/`secretCrypto.ts`/`contracts.ts` 的 `"mcp"` 預留欄位衝突最小、重用最多。
  - **不建議**:(b) 自建 MCP server 對外暴露(Q5 自己都主張不在本波)、(d) 整體轉 MCP 原生(現有技術債水位下工程量/風險不成比例)。
  - **先採 2 個**:① Hugging Face 官方 MCP(已認證、活躍,可即強化 `modelResearcher.ts` 模型/論文探索);② Canva 官方 MCP(線上實測 `mcp.canva.com/mcp` 生產可用、OAuth2 DCR)。
  - **待外部確認**:Adobe 官方 MCP 存在且已認證,但「healing-studio 後端能否繞過 Claude 生態直接對接同一端點」需向 Adobe 二次確認。
  - **安全暫緩**:兩個執行類 MCP(Run Python 已被作者封存並自承不安全;Playwright MCP 官方自陳非安全邊界、有已知 prompt injection 案例)**現在不接**,等 S-04(P0 RCE)與信任模型缺口修復後再議。
- **硬前置(Z1 盤點揭露)**:healing-studio 目前是「MCP 零基建」起點,以下既有債必須先處理才能安全談任何對外 MCP:NS-00 G3 gate(194 case 僅約 38 可達)、S-17 Drive OAuth token 明文、S-18 withinTrustCeiling reviewed 層檢查失效。
- **待討論**:是否採路線 (c) + 先接 HF/Canva 兩個 MCP;第一步 spike = Canva MCP client PoC(接 `connectionService` 的 mcp 欄位)。

---

## C. 決策待拍板(源自 N 波)

| 卡 | 主題 | 出處 | 狀態 |
|---|---|---|---|
| D-01 | Phase 0/1 實作決策 | `N1-phase01-implementation-decisions.md` | 待討論 |
| D-02 | 架構決策(雙 DB、102 表 0 FK、Drizzle 等) | `N2-architecture-decisions.md` | 待討論 |
| D-03 | 優先序決策(先修什麼、先做什麼) | `N3-priority-decisions.md` | 待討論 |
| D-04 | 成本/維運決策 | `N4-cost-ops-decisions.md` | 待討論 |

> 這四張是「怎麼做」的選項題,討論時搭配對應 NS 功能卡與稽核卡一起看。

---

## D. 開發 Playbook(可執行的第一批 PR)

| 卡 | 主題 | 出處 | 狀態 |
|---|---|---|---|
| DEV-01 | 第一批 PR playbook(北極星功能落地順序) | `T1-first-prs-playbook.md` | 待討論 |
| DEV-02 | 安全止血 PR playbook | `T2-security-prs-playbook.md` | 待討論 |
| DEV-03 | 資料/計費 PR playbook | `T3-data-prs-playbook.md` | 待討論 |

> Playbook 是「決議後照著做」的施工圖;討論時先確認方向(NS/D 卡),再用這些落地。

---

## E. 研究進行中登記(火力全開,持續累積)

| 波次 | 範圍 | 狀態 |
|---|---|---|
| W 波 | 逐檔對抗式深挖(W1 director / W2 proStudio / W3 generate / W4 brainPipeline / W5 計費核心 / W6 siteKnowledge / W7 webhook 安全網 / W8 ai.ts / W9 cron-workers) | ✅ 已完成 9 檔 |
| X 波 | 17 檔地毯掃描 + 對抗式驗證每條 critical/high + X0 綜合 | ⏳ 進行中(workflow) |
| Z 波 | 自建 MCP 系統策略 + 8 MCP 研究 → Z1 | ✅ 已完成 |
| Y 波 | 前端逐頁地毯掃描 10 頁 + Y0 北極星流程實況 | ✅ 已完成(Y4 髒資料待重跑) |
| 後續候選 | Y4 animation 重跑、shared 契約層、剩餘 orb 服務、falModels/modelResearcher、北極星逐幕三軌編輯器 spec | 待排 |

> 研究結論坐實後:問題類 → 補進 `00-discussion-taskcards.md`;功能/策略類 → 補進本檔。

---

## F. 更新記錄

- 2026-07-03 `b743d2ac`:建立研究討論開發專區,與稽核問題卡分家;收北極星 NS 卡、SYS-01 MCP 策略、D 決策、DEV playbook、研究登記。
- 2026-07-03 `b743d2ac`(續):SYS-01 收 Z1 結論;Y 波前端實況確認,新增 NS-08(修 shell 路由,最高 ROI 先修)、NS-09(專案範疇化資料遷移地基)、NS-10(compose 拼接最高槓桿)。

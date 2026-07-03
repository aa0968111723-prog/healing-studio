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
- 出處:`M4`。**待討論**:資產加 creativeProjectId + 狀態機(draft/in_review/approved)+ 評論表 + 目標 tracker(= 防跑偏產品化)。

---

## B. 系統架構策略卡

### 卡 SYS-01 ·【策略】自建 MCP 原生系統 + 參考 8 個 MCP — 狀態:研究中(Z 波)
- 緣起:Bruce 提「也可以考慮自建一套自己的系統,並參考這些 MCP 去研究」。
- 8 個參考 MCP:Hugging Face Official / Research Tracker / arXiv / Exa / Tavily / JSON / Bright Data / MCP Run Python / Playwright(對北極星支柱的映射假設見 `00-discussion-taskcards.md §10.5` 表)。
- 研究產出:`Z1-mcp-architecture-strategy.md`(進行中)——將給出四路線矩陣[(a)採用外部 MCP 當連接器 (b)自建 MCP server 暴露自家工具 (c)自建 MCP client 消費外部 MCP (d)整體轉 MCP 原生]+ 對北極星落地路徑 + build-vs-adopt 建議。
- 關聯:NS-06(連接器)、③ 自動化工作流、① 自建資料庫;安全上對照 U5 sandbox(引入 Run Python/Playwright 的風險)。
- **待討論**:等 Z1 出爐,選定路線與第一步 spike。

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
| Z 波 | 自建 MCP 系統策略 + 8 MCP 研究 → Z1 | ⏳ 進行中(workflow) |
| 後續候選 | client 關鍵頁(Studio.tsx/LearnHub)、falModels/modelResearcher、shared 契約層、北極星逐幕三軌編輯器 spec | 待排 |

> 研究結論坐實後:問題類 → 補進 `00-discussion-taskcards.md`;功能/策略類 → 補進本檔。

---

## F. 更新記錄

- 2026-07-03 `b743d2ac`:建立研究討論開發專區,與稽核問題卡分家;收北極星 NS 卡、SYS-01 MCP 策略、D 決策、DEV playbook、研究登記。X/Z 波完成後續補。

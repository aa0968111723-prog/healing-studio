# M0 — 北極星對齊解決方案藍圖(方案設計 wave M 彙整)

- 產生日期:2026-07-03
- 依據 commit:`7d1752bd`
- 性質:把 M1-M4 四條方案軌織成「單一專案一條龍」的統一路線,對齊 Bruce 定義的創作系統本質(2026-07-03 上傳)。細節見各分冊 M1-M4;問題證據見 00-summary §6 風險登記表與 A-L 各卷。

---

## 0. 一句話結論

**這套系統不需要重造,需要的是「把已經對的零件解放、接線、補對齊門」。** 四軌研究一致收斂到同一個發現:北極星描述的能力**大多已存在於程式碼中,但被鎖在旗標後、藏在單一殼裡、或斷在一條可修的鏈上**。方案的本質是「串成一條龍 + 防跑偏」,而非從零開發。

## 1. 本質 → 方案軌 對照(七支柱)

| Bruce 定義的本質 | 對應方案軌 | 一句話解法 |
|---|---|---|
| ① 連結/創建自己的資料庫 | M3 §2.1 | TeachingArchive RAG 已是雛形,補 update UI + 結構化 |
| ② 連結自己的工具(Adobe/Canva/Notion) | M3 §2.2 | Drive/Notion 有真後端;Adobe/Canva 走「產品自建 MCP client」 |
| ③ 創建自己的自動化工作流 | M3 §2.3 | 先做 webhook 自動化面板(骨架已在),編排器後補 |
| ④ 單一專案:腳本→分鏡→逐幕(字卡+圖影+聲音)→拼接→輸出→打包 | M1 全軌 | creative_projects 為唯一 SSOT;分鏡管線接既有工具執行化;compose 是唯一大件新建 |
| ⑤ AI 讀單一專案上下文就懂你的專案 | M2 §3.1 | contextPackets 子系統(source-agnostic 專案封包)已在,接上光球主聊天 |
| ⑥ 一步步引導、不跑偏 | M2 §3.2 + §6、M4 §4.5、M1 軌防跑偏 | ProjectFlowGuide 已是五步引導實體(旗標鎖住);補「創作者向對齊門」 |
| ⑦ 素材管理 + 目標管理 + 達最終成品 | M4 全軌 | 給 creative_projects 裝素材/目標/狀態三柱 |

## 2. 一條龍藍圖(單一專案生命週期)

```
                    ┌─────────── M2:單專案上下文 AI 全程逐步引導、對齊門防跑偏 ───────────┐
                    │  (ProjectFlowGuide 解放 → 接光球 → 每步過對齊門)                      │
                    ▼                                                                        │
[建立單一專案]──腳本──▶分鏡──▶┌─ 每一幕 ─────────────┐──▶簡易拼接──▶輸出──▶打包──▶成品
 M1軌A SSOT          M1軌B     │ 字卡 + 圖/影 + 聲音   │   M1軌E compose  M1軌E  ZIP(已對)
 creative_projects   管線執行化 │ M1軌C(kind=video)   │   (唯一大件新建)
       ▲             (接既有    │ + 軌D 三軌編輯器      │
       │              studio.*  └──────────┬───────────┘
       │              工具)                 │
       │                                    ▼
[M3:連自己的工具/資料庫/自動化流] ──餵──▶ [M4:素材綁定各幕 + 目標追蹤 + 審/評/批]
 Notion/Drive/Adobe/Canva、TeachingArchive          creativeProjectId 為共同鑰匙
 → 素材與上下文進單一專案                            狀態機 draft→review→approved
```

**串接鑰匙**:全線以 `creativeProjectId` 為唯一主鍵貫穿——M1 定它為 SSOT、M2 用它 scope AI 上下文、M3 把外部素材掛到它、M4 用它綁素材/目標/審批。這就是「不跑偏」的資料層根基:**任何操作都必須帶專案 id,禁止「猜最新一筆」**。

## 3. 關鍵重用清單(方案能成立的根據)

北極星能力**已存在但未發揮**的程式碼資產(不重造,只解放/接線):

| 能力 | 已有的零件 | 現況 | 出處 |
|---|---|---|---|
| 五步引導框架 | `ProjectFlowGuide.tsx`(世界觀→劇本→分鏡→生成→成片,狀態純函式推導) | 鎖在 /video 殼、`ENABLE_PROJECT_HUB` OFF | M2 §3.2 |
| 單專案上下文封包 | `server/subsystems/contextPackets/`(source-agnostic + adapter + lineage + TTL + sanitize)、`projectContext/` | 半成品,發現性差 | M2 §3.3、M3 §3 |
| 專案主幹 | `creative_projects`(+ video_projects.creativeProjectId 欄早已存在) | 三套並存、建案沒照關係走 | M1 軌A |
| 分鏡管線 | `planPipeline` + 可達的 16 個 `studio.*` 工具 + AIDV-44 狀態機 | 管線產出的工具名 server 不存在、狀態機零呼叫 | M1 軌B |
| 逐幕三軌資料模型 | `StoryboardFrame`/`AudioClip`/`CharacterBeat`、timeline_frames、scene_compositions | 唯讀預覽,缺編輯器 | M1 軌D、G2 |
| 連接器後端 | `contextPackets/connectionService`(AES-256-GCM 加密、SSRF 意識)、drive/Notion adapter、user_workflows | UI 三層分裂、發現性差、文案謊稱待補 | M3 §3 |
| 素材/審改資料底 | digital_asset_library、consistency_vault、resource_shares、teams、`world_storyboards.scenesJson.status`(draft→in_review→approved 命名先例) | 未綁專案、enforcement OFF、無評論表 | M4 §3 |

## 4. 依賴順序與前置阻塞(關鍵)

**唯一硬前置 = 修 G3 的 178-tool gate(= 風險登記表 R10)。** 理由:
- M1 軌B(分鏡管線執行化)要把 planPipeline 步驟轉呼 `studio.*` 工具——這些工具正是被 gate 擋掉的。
- M2 Layer 2(AI 幫你核對/記錄/回報)完全依賴工具可達;Layer 1(選頁/填參數/送出導覽)不依賴,可先做。
- 若不先修,後續體驗會建立在「規劃會過、執行必敗」的斷工具上,重演假成功。

**其餘 K 波風險與本藍圖的關係**:
- R15(orbTask FSM in-memory 重啟即失)→ 開任何「AI 自主續跑」旗標前必須先做 FSM 持久化(M2 Phase 4),否則引導到一半蒸發。
- R1(雙重退款)、R2/R3(GDPR)、R4-R8(SSRF/IDOR/同意書)→ **不阻塞北極星功能**,但屬可利用/法遵風險,應與功能開發並行修(見 00-summary §6.4 第 0 波)。
- R14(LearnHub 孤兒頁)、R13(告警無 UI)→ 與北極星無關,列衛生波。

## 5. 統一分階段路線(四軌合流)

> 每階段以「創作者能多走完一步一條龍」為驗收,不以程式碼量計。

### 🟢 Phase 0(前置,1 個 PR,風險最低)
**修 G3 gate**(M2 首個 PR):`agentToolExecutor.ts` gate 區塊 + `global-agent-tools.ts` 補 63 筆 registry + `agentPlanner.ts` 一句 prompt + **不 mock 執行器的可達性整合測試**。解鎖 M1/M2 後續一切。同批可順手修 R1 雙重退款(獨立小 PR,止血套利)。

### 🟡 Phase 1(打通「單幕端到端」+「AI 讀專案」,並行)
- M1:分鏡管線執行化(`storyboardPipelineRunner.ts` + `worldStoryboard.runPipeline` + kind=video adapter)→ 規劃→執行→回填單幕通。
- M2:`projectId`/contextPacket 接上 `ai.chat`/`director.chat` + 開 `ENABLE_DIRECTOR_WORLD_CONTEXT` → AI 真的讀單一專案上下文。
- M4 階段 0:`digital_asset_library` 加 `creativeProjectId`,結果動線接回專案維度 + `vault.list`/`notes.list` 補 projectId scope。
- 里程碑:**創作者在一個專案裡,叫 AI 生成某一幕,結果自動歸到那一幕。**

### 🟠 Phase 2(引導解放 + 逐幕三軌 + 審)
- M2:從 `ProjectFlowGuide` 抽 `deriveProjectJourney` 共用模組供光球讀 + 引導狀態機解放(解 `ENABLE_PROJECT_HUB`);新增 `shared/project-alignment-gate.ts` 對齊門。
- M1:逐幕三軌(字卡+圖影+聲音)編輯器 + 專案主幹統一收尾。
- M4 階段 1:資產狀態機(draft/in_review/approved)+ 評論表 → 補上 D-adoption 診斷的「審」斷點。
- 里程碑:**AI 一步步帶著走、每步對齊創作目標不跑偏;團隊能審能評。**

### 🔵 Phase 3(拼接輸出打包 + 目標 + 連接器)
- M1:compose 服務(需先做 ffmpeg vs 委外 API 技術 spike)+ 一鍵輸出成片 → 借 `videoProject.requestExport` 輸出殼 + 既有 JSZip 打包。
- M4 階段 2/3:創作目標 tracker(防跑偏產品化)+ 集合/交付包 + studio_recipes 升團隊模板。
- M3:webhook 自動化面板 + 連接器 UI 收斂 + TeachingArchive update UI + Notion/Drive 素材進專案。
- 里程碑:**腳本→…→拼接→輸出→打包 一條龍走完,產出可交付成品;能連自己的工具與資料庫。**

### ⚪ Phase 4+(縱深)
FSM 持久化(開自主續跑前必做)、RBAC enforcement、Adobe/Canva MCP client、自動化編排器、多代理旗標分級開啟。

## 6. 「不跑偏」的三層統一模型(貫穿四軌)

北極星最強調「不跑偏」,四軌各有一塊,合成三層縱深防線:

1. **資料層(機械強制)**:全線 `creativeProjectId` 必填、禁止猜最新一筆;實體核對用 `sourceRefs`/`lineage` 做機械檢查而非靠 LLM 自律(M2 §6.3、M1 軌防跑偏)。
2. **產品層(目標對照)**:創作目標 tracker——每次生成/審批/交付被要求對照目標清單,而非事後盤點(M4 §4.5)。目標管理**就是**防跑偏的產品化。
3. **代理層(對齊門)**:`project-alignment-gate.ts` 插在 agentPlanner 既有三道閘之後,借 aidv-longloop「五問對齊門」但鎖創作者向(同專案/同或下一階段/只用專案內已知實體/仍指向終點/沒繞過核准門);fail 降級為一句澄清+兩按鈕,不執行也不報錯(M2 §6)。

## 7. 給 Bruce 的三句話

1. **好消息**:你要的一條龍,零件八成都在了(ProjectFlowGuide 就是你畫的那張圖),被旗標和單一殼鎖住而已——這是「接線題」不是「開發題」。
2. **關鍵鑰匙**:先修 G3 那條「178 工具規劃會過執行必敗」的 bug(Phase 0),它是分鏡管線執行化和 AI 動手引導的共同前置;修完才不會把體驗蓋在假成功上。
3. **一條主線**:全程用 `creativeProjectId` 串起專案主幹→AI 上下文→素材綁定→目標審批,這條鑰匙本身就是「不跑偏」的地基。

> 文件索引:M1(專案主幹+拼接輸出)、M2(單專案 AI 引導+對齊門)、M3(連接器/資料庫/自動化)、M4(素材/目標/審改)。問題側對照 00-summary §6 風險登記表。

# M2 — 單專案 AI 引導代理:方案設計(非診斷)

- 產生日期:2026-07-03
- 依據 commit:`7d1752bd4956519181c86eef51f700b46deef9dc`(HEAD)
- 性質:**方案設計 wave M**——本文件不重複診斷,只在既有盤點(00-summary/E/G3/G4/I/K3/C/02)之上設計「AI 代理讀單一專案上下文、逐步引導創作者、不跑偏、達最終成品」的解法
- 前置閱讀(不重複其內容,直接引用結論):`00-summary.md`、`E-ai-agents.md`、`G3-orb-tools-spirits.md`、`02-fullstack.md` §7、`I-debt-dormant.md` §2、`B-infra.md`(記憶體態)、`K3-data-integrity.md` §2(FSM 遺失)、`C-uiux.md`(審改斷點)、`.claude/skills/aidv-longloop/references/anti-drift.md`(開發用對齊門,類比對象)
- 方法:讀上述文件 + 實讀程式碼確認三個此前未被盤點文件記錄的重用資產——`server/subsystems/contextPackets/`、`server/subsystems/projectContext/`、`client/src/shells/video/console/ProjectFlowGuide.tsx`——三者合起來已經是「本質定義」的部分雛形,只是分散且多數在旗標 OFF 之後

---

## 0. 本質定義(必對齊,逐字錨定)

> AI 代理讀「單一專案的上下文」就清楚明白你的專案,並「一步步」指引創作者建構專案、不跑偏、達到最終成品。

拆成四個必須都成立的子能力,後面每章都會對齊回這四條:

| 子能力 | 白話 | 現況一句話 |
|---|---|---|
| A. 讀單一專案上下文 | 代理知道「這個專案」是什麼(世界觀/角色/場景/已產出素材/目前卡在哪) | 有三套零件(WorldContext 選誰、projectContext 摘要、contextPackets 封包)但光球主聊天沒接 |
| B. 一步步引導 | 代理知道「下一步該做什麼」並能真的把創作者帶過去、順手做掉 | `ProjectFlowGuide`(北極星五步脊椎)已完整實作,但僅存在 /video 一個殼、旗標 OFF |
| C. 不跑偏 | 每一步代理提的動作都對齊「這個專案」「這個階段」「北極星終點」,偏了要能被攔住並轉成一句確認,而不是悄悄執行或悄悄卡住 | 目前完全沒有這層(0 對齊門);唯一類比是開發用的 aidv-longloop 對齊門,對象是工程師不是創作者 |
| D. 達最終成品 | 代理不只是說,要真的能動手(呼叫工具、寫回資料、往下一階段推進),且中斷後不會憑空消失 | 178 個精靈工具 case 不可達(G3)+ orbTaskStateMachine in-memory 重啟即失(K3)= 「代理說要做」與「代理真的做得到」之間有兩個洞 |

**核心判斷**:本站已經把北極星寫進了程式碼(見 §3),不是要「重新發明」引導系統,而是要「把已經做對的東西,從一個孤立的殼(⁄video)解放出來,接上主聊天入口,補上對齊門,並讓代理真的能動手」。這是本方案與一般「從零設計代理框架」提案最大的不同。

---

## 1. 現況缺口對照(引用即可,證據見各分冊)

| # | 缺口 | 出處 | 對本方案的意義 |
|---|---|---|---|
| ① | 光球 178 個精靈工具 case 不可達(executor gate 只路由 6 分支;`critic.review`/`accountant.estimate`/`orchestrator.getTeamStatus`/`notesCurator.*`/`planExecutor.*` 等呼叫全部 `tool-not-found`) | G3 §0 | 「代理真的能動手」的執行層地基;沒修好,任何「AI 幫你核對這步/幫你記錄進度/幫你報告狀態」的引導體驗都是空話 |
| ② | orbTaskStateMachine FSM 純 in-memory(`taskStore: Map`,orbTaskStateMachine.ts:74),redeploy 即丟 | K3 §2、E §3.3、I #5 | 多步驟引導若跨越一次部署,任務狀態憑空消失,創作者看到卡住的進度條 |
| ③ | WorldContext/contextPacket/OrbGuide/PageAgent 都存在但零散 | 本文 §3 新查 | 不是要新建這些子系統,是要把它們接成一條線 |
| ④ | 導演世界脈絡注入旗標(`ENABLE_DIRECTOR_WORLD_CONTEXT`)預設 OFF,前端不傳 `projectId` | I §2.1、02-fullstack | 「讀單一專案上下文」這條線,程式碼寫好了但沒插電 |
| ⑤ | 無「防跑偏」對齊機制給創作者用 | 本文設計重點 | aidv-longloop 的對齊門是給開發用的(範圍鎖=工作表檔案清單);創作者版要鎖的是「專案 id / 階段 / 專案內已知實體 / 北極星終點」 |

---

## 2. 依賴順序判定:178-tool gate 修復是不是前置?

**結論:條件式前置——不是「引導能力」的硬前提,但是「可信引導」的硬前提。建議排第一個 PR,理由如下。**

引導體驗可以拆成兩層,兩層對 G3 的依賴不同:

- **Layer 1(導覽層):選頁面→填參數→送出**。走的是 `OrbGuideContext`(intent wizard)+ `PageAgentContext`(`page.*` action dispatch,client-side 直接操作頁面 state)+ 已可達的 37 個內建工具(`studio.*`/`director.*`/`db.*`)。**這一層完全不經過 178 個孤兒 case**,今天就能做「AI 幫你點好分頁、填好提示詞、按下生成」。G3 修不修,這層都能動。
- **Layer 2(核對/記錄/回報層):AI 說「我幫你看看這步好不好」「我幫你記一筆進度」「幫你問問團隊進度」**。這正好對應 `critic.review`(品品核對這步輸出)、`notesCurator.*`(記記把階段完成寫進 project_notes_calendar 而非只存 localStorage)、`orchestrator.getTeamStatus`(總總回報)、`planExecutor.*`(步步跨頁多步計畫)——**這五個角色的工具全部落在 178 個不可達 case 裡**。沒有 Layer 2,對齊門(§6)的「LLM 定性核對」子項與跨頁多步計畫都只能退化成純前端推導,能用但薄。

**為什麼還是建議排第一個 PR**:
1. G3 的修法本身與其他任何一塊都無耦合(純 executor gate + registry 補登,見 G3 §0「修法(一行級)」),先做不擋路、後做會變成技術債利息。
2. 若照「先蓋引導 UX 再修工具」的順序,Layer 2 一旦上線就會立刻重演 00-summary 點名的「假成功」模式(UI 說「幫你核對過了」,實際 `tool-not-found` 靜默失敗)——這正是本方案要避免的「跑偏」之一種(對創作者撒的謊)。
3. G3 已經有明確診斷與修法(不需要本文件重新設計),風險最低、投報最高,適合當「地基先打」。

**因此路線圖(§5)把 G3 排在 Phase 0**,與 Phase 1(專案上下文接線)可並行,不互相阻塞;Phase 2 起的「一步步引導狀態機」「對齊門」才真正需要 Layer 2 工具已可達。

---

## 3. 重用什麼(這是本方案能成立的關鍵發現)

### 3.1 讀單一專案上下文(能力 A)

| 資產 | 路徑 | 現況 |
|---|---|---|
| 專案 active id 單一來源 | `client/src/contexts/WorldContextContext.tsx`、`client/src/spine/useCreativeProject.ts` | `healing-studio.current-project-id` localStorage,全站唯一「目前是哪個專案」的來源,C-uiux/02 已記錄 |
| 專案上下文摘要 service | `server/subsystems/projectContext/projectContextService.ts` + `contracts.ts` | `ProjectContextSummary`:世界觀/風格聖經/團隊資料摘要/近期素材/未完成任務/預算,`/create` 頁在用(`ActiveProjectContextPanel.tsx`) |
| 上下文封包(source-agnostic) | `server/subsystems/contextPackets/contextPacketService.ts` + `contracts.ts` + `contextPacketRouter.ts` + `adapters/projectContextAdapters.ts` | **AIDV-303 已把 worldbuilding/character/scene/continuity 四種專案內來源接成 adapter**,產出 `ContextSourceRef[]`(含 lineage、TTL、tokenEstimate),且已內建「untrusted 來源過 `sanitizeContextPacketField`(`ragInjectionGuard.neutralizeInjectionMarkers`)」的安檢(contracts.ts 檔頭) |
| client 端封包編譯 | `client/src/spine/contextPacket.ts`(`compileContextPacket`)、`client/src/adapters/contextPacket.trpc.ts` | `/video` 座艙(`ProjectSpineProvider`)已在用同一套 adapter |
| 導演世界脈絡注入(半成品) | `server/services/director/costarService.ts`(AIDV-152) | `ENABLE_DIRECTOR_WORLD_CONTEXT` 已寫好注入邏輯,只差旗標 ON + 前端傳 `projectId` |
| 「不杜撰專案外實體」的既有範式 | `server/services/orbCreativeModelHints.ts` | 對「模型清單」已經做過「只從真實 catalog 抽 ≤3 個注入 prompt,防 LLM 幻想不存在的模型」——同一手法可原樣搬來防「杜撰專案內不存在的角色/場景」 |

**結論**:能力 A 缺的不是元件,是「光球主聊天(`ai.chat`)沒有調用 `contextPacketService`/`projectContextService`,也沒有從 `WorldContext` 拿 `projectId` 塞進請求」這一條線。

### 3.2 一步步引導(能力 B)——最重要的發現

`client/src/shells/video/console/ProjectFlowGuide.tsx`(I-6,AIDV-84)是**北極星 DoD 的程式碼實體**:

- 檔頭明寫:「把『創作專案』做成影片工作流的主入口,並讓嚮導鏡像北極星 DoD:一句話→成片。五步脊椎=世界觀→劇本→分鏡→生成→成片(對映 `creative_projects.stageIndex` 0..4)」。
- 每步 `done` 狀態**由既有專案資料即時純函式推導**(`worldLinked`/`hasScript`/`hasShots`/`allGenerated`),不需要額外狀態機、不會因重啟而消失——這對「不跑偏/可驗證」是很好的性質(§6 會直接重用)。
- **Phase 2a 已動作化**:當前步主鈕直接觸發動作(劇本/分鏡→開引導式創作、生成→`spine.scheduleGeneration` 走既有確認門+先估成本)。
- **Phase 2b 已接世界自動連結**(AIDV-100):嚮導世界步未連結時內嵌選單,一鍵 `creativeProject.link`。
- 唯一缺口:①旗標 `ENABLE_PROJECT_HUB` 預設 OFF;②只掛在 `/video` 座艙(`StorySpineColumn`),別的頁面/光球主聊天完全看不到這個狀態機;③「五步」目前寫死在 `ProjectFlowGuide.tsx` 元件內部(`useMemo` 裡的 `steps` 陣列),沒有抽成可被 Orb 讀的共用模組。

配套:`client/src/shells/video/console/workflowSteps.ts` 已把「六步」定義成**可設定範本**(`DEFAULT_WORKFLOW`,intent/entry/asset/rough/gate/done,必經步驟不可刪),證明「引導步驟」在本站的資料模型裡本來就不是寫死的黑盒。

其他可重用的引導層零件:

| 資產 | 路徑 | 角色 |
|---|---|---|
| 意圖精靈(單次任務版引導) | `client/src/contexts/OrbGuideContext.tsx` | `idle→ask_detail→confirming→arrived` 4 態 + 7 個 `INTENT_CONFIGS`;適合「新開一個小任務」,但不是「整個專案」尺度的狀態機 |
| 頁面能力註冊/動作派送橋 | `client/src/contexts/PageAgentContext.tsx` | 光球→頁面的雙向橋,`usePageAgent().dispatch(action)`,pending queue 補齊「頁面還沒載入完」的競態 |
| 深度操作面板(直接按鈕級動作) | `client/src/components/OrbGuidePanel.tsx`(4,883 行) | ImageStudio/VideoStudio/ProStudio 逐分頁直接 `dispatch pageAgent AgentAction`,**不繞 LLM**——這是「引導=真的幫你按」的核心,已完整 |
| 專案脊椎(P1) | `client/src/spine/ProjectSpineProvider.tsx` | 「包覆不取代」WorldContext,載入 active project 完整內容+提供座艙 action(生成/寫回),已重用 P0 `SpineProvider` 的五接縫 adapters |
| server 端世界模型/能力表 | `shared/global-agent-registry.ts`、`global-agent-capabilities.ts`、`global-agent-tools.ts`、`global-agent-workflows.ts` | planner 已經有「這一頁能做什麼」的登記簿,§6 對齊門要用的「這階段允許哪些工具」可以疊加在這張表上,不必新建 |
| Schema-first plan(v3) | `shared/agent-plan-schema.ts` | `routing.pageScope`、`taskPolicy`、`rollbackPolicy`、`dependsOn` 等欄位已定義,足以承載「這步屬於哪個階段」 |
| 通用閉環 | `shared/closed-loop-plan.ts`(`executeClosedLoopPlan`) | planNextStep→execute→observe 泛用迴圈,可作引導狀態機「執行一步」的底層 |

**結論**:能力 B 缺的不是「發明一個新引導框架」,是①把 `ProjectFlowGuide` 的階段推導邏輯抽出 `/video` 殼、②讓 `OrbGuideContext`/`PageAgentContext` 讀同一份專案階段狀態(而不是各自維護)、③把它接上光球主聊天入口(現在只有 /video 座艙看得到)。

### 3.3 執行層(能力 D)可重用

| 資產 | 路徑 | 現況 |
|---|---|---|
| 37 個可達內建工具 | `server/services/agentToolExecutor.ts`(`executeOrbToolCalls`:533) | `studio.*` 16 個、`director.*` 5 個、`db.*` 13 個、具名研究 3 個——Layer 1 引導可以直接站在這上面 |
| 角色 scope 授權 | `server/_core/agentScopeGuard.ts` | 15 種 scope action,FSM 每步已過 `checkStepScope`,ON,可直接重用做「這步是否越權」的一部分 |
| 5 類錯誤→6 種恢復動作 | `server/services/orbTaskRecoveryPolicy.ts` | 引導狀態機「這步失敗了怎麼辦」可以直接接這張表,不必重新設計 |
| 成本三守衛 | `orbCostGuard`(ON)/`orbQuota`(OFF)/`orbBudgetGuard`(OFF) | 對齊門的「沒踩核准門」子項直接借用 |

---

## 4. 要補什麼最小新增

依 §2 的依賴順序,由地基往上排:

### 4.1(Phase 0)修好 178-tool gate,讓代理能執行 — 對齊 G3 的修法,不重新設計

- `server/services/agentToolExecutor.ts`:`executeOrbToolCalls` 的 6 分支 gate(:545-744 區間)改為「`studio.`/`director.`/`db.` 前綴白名單 **加上** `isKnownGlobalAgentTool(call.name)` 通過即放行」,取代目前「其餘一律外部 registry」的預設路徑。
- `shared/global-agent-tools.ts`:補登 63 個目前完全未註冊的工具(`orchestrator.*`、`videoSpecialist.*`、`voiceSpecialist.*`、`learningSpecialist.*`、`legalAdvisor.*`、`securityGuard.*`、`communityManager.*`、`onboardingCoach.*`、`companion.*`、`teachingArchive.search`),否則修好 gate 也會撞 `dispatchStudioTool` 開頭的「studio-tool-not-registered」二次檢查(G3 §0 已指出「雙重孤兒」)。
- 新增一支「不 mock `executeOrbToolCalls`」的路由可達性整合測試(取代 G3 探測用的臨時 vitest probe),鎖住這條路由不再退化。
- `shared/global-agent-tools.ts` 補 `media.*`(5 個)有 registry 無 executor case 的問題——至少要明確標記為「無執行路徑」讓 planner 不要教 LLM 串它(對齊 agentPlanner.ts:529 的既有教學文字要同步修)。

### 4.2(Phase 1)專案範圍上下文封包接上光球主聊天

- `client/src/contexts/GlobalOrbChatContext.tsx`(或其送出 `ai.chat` 的呼叫點):送出訊息時附帶 `WorldContext` 目前的 `activeProjectId`(§3.1 已有單一來源,只差「傳出去」這一步)。
- `server/routers/ai.ts` 的 `ai.chat` input schema:加一個 optional `projectId` 欄位。
- `ai.chat` handler 內(記憶組裝階段,E §1.1 表格第 7 項附近):有 `projectId` 時呼叫既有 `server/subsystems/contextPackets/contextPacketService.ts` 的 compile 函式(mode 依對話性質選 `create`/`director`/`database`),把回傳的 `summaryMarkdown`(已 TTL 快取、已 sanitize)當作新的一段「本專案上下文」注入 `buildOrbSystemPrompt`,取代/疊加目前泛用的 pageSnapshot 摘要。
- `director.chat`:把 `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標預設值評估後開啟(至少先對內部/admin 帳號灰度),前端 `director.chat` 呼叫點補上 `projectId`(I §2.1 已標注「一行」規模)。
- 系統提示新增一句鐵則(仿 `orbCreativeModelHints.ts` 手法):「只能引用『本專案上下文』段落列出的世界觀/角色/場景/連戲設定,不得杜撰不在列表內的實體」——這是 §6 對齊門在「注入端」的前置防線。

### 4.3(Phase 2)逐步引導狀態機:從 /video 殼解放

- 從 `client/src/shells/video/console/ProjectFlowGuide.tsx` 抽出 `steps` 推導邏輯(`worldLinked`/`hasScript`/`hasShots`/`someGenerated`/`allGenerated` 這組純函式),搬到新的共用模組(建議 `client/src/spine/projectJourney.ts`),輸出 `deriveProjectJourney(project): { stageIndex, steps: FlowStep[], currentStep, nextAction }`。
- `ProjectFlowGuide.tsx` 改為呼叫這個共用模組(行為零變化,純重構)。
- `client/src/contexts/OrbGuideContext.tsx` 新增一個「專案模式」:當 `WorldContext` 有 active project 時,`arrived` 之後不只顯示「到站」,還顯示「目前在北極星第 N/6 步:{stepName},下一步建議:{nextAction}」,資料源直接讀 `deriveProjectJourney`——不必等旗標 `ENABLE_PROJECT_HUB` 全站開,Orb 側可以獨立讀這個模組(不經過 `/video` 座艙 UI)。
- `client/src/contexts/PageAgentContext.tsx`:`dispatch(action)` 成功後,若該 action 是階段推進類(對齊 `GLOBAL_AGENT_CAPABILITIES` 的 stage 標記,見 4.4),順手呼叫 `deriveProjectJourney` 重算,讓引導 UI 即時反映「這步做完了」。

### 4.4(Phase 3)防跑偏對齊門(新增,設計見 §6)

- 新增 `shared/project-alignment-gate.ts`:純函式 `evaluateProjectAlignmentGate(plan, journeyState, contextPacket): { pass: boolean; reasons: string[]; suggestedClarification?: string }`。
- 在 `agentPlanner.ts` 既有三道閘之後(`parseAndGatePlan` → `checkModalityCoherence` → `moderateOrbContent`,E §3.2)插入第四道閘,fail 時把 `decision.mode` 降級為 `clarification`,`clarificationQuestion` 帶入 `suggestedClarification`。
- `shared/global-agent-capabilities.ts`:每個 capability 補一個可選欄位 `journeyStage?: StepId`,作為「這個工具屬於北極星哪一階段」的對照表(沒有標記的工具視為「階段中性」,不擋)。

### 4.5(Phase 4)FSM 持久化

- 短期:把既有但未啟用的 `ORB_TASK_STORE_FILE` 檔案持久化選項開啟(I #5 已標注「S 量級」)。
- 中期:`orbTaskStateMachine.ts` 的 `taskStore: Map`(:74)改寫穿既有 `orb_workflow_executions` 表(I 文檔已指出該表存在),重啟後對「非終態」任務標記 orphan,並讓引導 UI 顯示「剛剛的操作被中斷了,要繼續嗎」而不是卡住的假進度條。

---

## 5. 分階段路線 + 首個 PR 檔案級範圍

```
Phase 0  修 178-tool gate(G3)                     ─┐
Phase 1  projectId + contextPacket 接上光球主聊天    ─┼─ 可並行,互不阻塞
                                                    ─┘
Phase 2  引導狀態機從 /video 解放,接上 Orb            ← 依賴 Phase 1(要有專案上下文才知道階段)
Phase 3  防跑偏對齊門                                ← 依賴 Phase 0(LLM 定性核對子項)+ Phase 2(階段判斷子項)
Phase 4  FSM 持久化                                  ← 與 Phase 0-3 並行皆可,建議在打開任何自主續跑旗標(ORB_OBSERVATION_LOOP)前完成
```

### 首個 PR:Phase 0(G3 gate 修復)

理由見 §2——風險最低、無耦合、是後面所有「AI 真的動手核對/記錄/回報」體驗的地基。

**檔案級範圍**:
- `server/services/agentToolExecutor.ts` — 只動 `executeOrbToolCalls` 的 gate 區塊(:545-744 附近)與 `dispatchStudioTool` 開頭的 registry 前置檢查(:991-997 附近);不動任何 `dispatch*Tool` 函式本體。
- `shared/global-agent-tools.ts` — 只新增 63 筆 registry entry(name/riskLevel/requiresHuman/allowedArgsSchema/executionTarget),不改既有 148 筆。
- `server/services/agentPlanner.ts` — 僅同步修正 :529-530 附近教 LLM 串 `media.transcribe→media.caption` 的 prompt 文字(補註記「無執行路徑,勿建議」),避免修完 gate 後才發現 media.* 這條反向缺口沒講清楚。
- 新增測試檔(建議路徑):`tests/integration/server/agentToolExecutor.reachability.test.ts` — 不 mock `executeOrbToolCalls`,逐一餵 178 個工具名(至少覆蓋每個精靈家族代表工具),斷言不再回 `tool-not-found`(下游 `dispatch*` 函式可視情況 stub,但入口路由本身必須是真的)。

**不在此 PR 範圍**(留給後續 Phase,避免第一個 PR 就跑偏):不動 `projectId` 傳遞、不動 `ProjectFlowGuide`、不動任何旗標預設值、不碰 `orbTaskStateMachine`。

---

## 6. 防跑偏機制的具體設計

### 6.1 設計原則:對照 aidv-longloop,鎖的對象不同

`.claude/skills/aidv-longloop/references/anti-drift.md` 的對齊門鎖的是「開發任務範圍」(同一張卡/範圍沒長大/檔案在清單內/仍對北極星/沒踩 Bruce 門)。創作者版對齊門要鎖的四樣東西不同,但結構同源(每步前五問全 yes 才前進):

**🧭 創作對齊門(每次代理要提出一個「會動手做事」的步驟前,五問全 yes 才可標記為 `tasked` 直接執行;任一 no → 降級為 `clarification`)**

1. **還在同一個專案?** `plan` 引用/暗示的專案與 `WorldContext.activeProjectId` 一致;LLM 若從對話內容判斷創作者好像想切到另一個專案,**不可靜默切換**,必須先問「要切到『XX 專案』嗎?」。
2. **還在同一或下一階段?** 步驟對應的 `journeyStage`(§4.4 新欄位)必須是 `deriveProjectJourney().currentStep` 或其下一步;跳兩步以上(例如世界觀都還沒連結就要生成)→ 攔下,改問「要先完成『連結世界』嗎?」。
3. **只用這個專案已知的實體?** 步驟參數中出現的角色名/場景名/世界觀名,必須能在 `contextPacket.sourceRefs`(或專案自身 characters/scenes 表)中找到對應 `lineage`;找不到 → 視為可能杜撰,攔下改問「你是說新角色,還是要用『XX』?」。
4. **仍指向北極星終點?** 步驟的 `toolName` 必須落在 `GLOBAL_AGENT_CAPABILITIES` 對「當前/下一階段」開放的工具集合內(§4.4);若是階段外的工具(例如引導才走到「劇本」卻叫 `studio.trainLora`)→ 判定為「順便」,攔下改問是否要另開新流程處理,而不是塞進當前引導。
5. **沒有繞過核准門?** `requiresApproval`/`riskLevel:high` 的步驟仍必須真的走 `askBeforeAct`(既有 `agent-plan-safety` + `orbCostGuard`);對齊門本身不新增例外。

### 6.2 落地位置(不新建管線,插進既有三道閘之後)

`agentPlanner.ts`(E §3.2)既有順序:`parseAndGatePlan` → `checkModalityCoherence` → `moderateOrbContent`。第四道閘 `evaluateProjectAlignmentGate` 接在最後——**只在有 `projectId` 的對話中生效**(沒有 active project 時,五問無從問起,直接放行,保持零回歸風險)。

### 6.3 「鎖在單一專案上下文」的技術手段

- **輸入端鎖定**:`projectId` 一旦在某次 `ai.chat` 呼叫中出現,同一個 `conversationId` 內後續回合預設沿用同一個值(伺服端存在 `orbTaskMemory`/對話記錄裡,不必每回合靠前端重傳且不會漂移)。
- **注入端鎖定**:`buildOrbSystemPrompt` 只塞「這個 `projectId` 的 `contextPacket`」,不會把其他專案的世界觀/角色混進同一個 prompt(`contextPacketService` 本身已是 per-project 查詢,不需要新的隔離機制,只是要求呼叫端一定帶 `projectId`)。
- **輸出端鎖定**:§6.1 第 3 點的實體核對,把「代理有沒有講到專案外的東西」從「靠 LLM 自律」變成「有 `sourceRefs`/`lineage` 可查的機械檢查」。
- **驗證端鎖定**:每步執行完,`deriveProjectJourney`(純函式、由資料庫真實狀態推導,§3.2 已證明可行)重算一次階段——**這一層完全不需要 LLM 或 G3 修復,現在就能做**,是最低成本的「這步真的往北極星推進了嗎」驗證;G3 修好後,`critic.review`/`orchestrator.getTeamStatus` 可以疊加「品質核對」與「跨精靈進度回報」兩層更豐富的驗證,但不是必要條件。

### 6.4 偏了之後怎麼辦(創作者版 STOP-realign)

不同於開發版的「STOP-寫下偏離點-回工作表」,創作者不該被要求「寫報告」。對齊門 fail 時的產品行為:

1. **不執行、不報錯**——把原本要 `tasked` 直接跑的計畫,降級成一句自然語言澄清(復用既有 `decision.mode = "clarification"` 結構,E §3.1 v3 schema 本來就支援)。
2. **講清楚偏在哪一條**(對照 §6.1 五問,挑最先 fail 的一條講,不要五條都倒出來嚇人):例如「這個角色『XX』我在這個專案裡還沒看過,是新角色嗎?」。
3. **給兩個按鈕而非開放式追問**:「照你剛說的做」/「先完成目前這步」——把對齊門的攔截,轉成一次低成本的確認,而不是打斷創作流程去讀規則。
4. **不新開專案、不新開分支**——創作者版不需要開發版的「新發現開新卡」機制;偏離的內容如果創作者確認要做,就直接更新 `journeyStage` 的認定(例如承認要新增角色),對齊門下一輪就會認得它。

---

## 未涵蓋部分(誠實列出,避免過度承諾)

- 未實作任何程式碼、未估工時,純方案設計。
- 未涵蓋「多個並行專案」場景下的對齊門行為(目前設計假設單一 active project;多專案並行的切換確認 UX 需另外設計)。
- 未涵蓋 `ORB_MULTI_AGENT_ENABLED`/`ORB_OBSERVATION_LOOP` 兩個多代理旗標開啟後,對齊門要不要對「每個精靈各自的計畫」分別評估——本方案只設計單代理(lead-only)路徑下的對齊門。
- 未涵蓋 Phase 4 FSM DB 持久化的實際表結構/migration 設計(只指出方向與候選表)。
- 未涵蓋語音管道(`OrbVoiceButton`,G3 §3.1 已指出「完全不接 15 精靈與工具執行」)如何納入本引導體系——需要先解決語音鏈本身的架構缺口,不在本方案範圍。
- 未涵蓋成本/配額對「一步步引導」節奏的影響(例如 `ENABLE_ORB_QUOTA_GUARD` 開啟後,引導中途撞配額上限的 UX)——僅在 §6.1 第 5 點提及沿用既有守衛,未展開設計。

# T1 — 第一批 3 個核心 PR 實作 playbook(實作 playbook wave T)

- 產生日期:2026-07-03
- 依據 commit:`7f4417da`
- 波次:**實作 playbook wave T**——不是新診斷、不是新規格,是把 N1(決策卡 1-4)、Q4(63 筆缺口+9 個新危險工具+5 個既有 registry bug)、Q3(對齊門規格+首個 PR 範圍)、Q1(逐幕組裝編輯器)、M1(六軌方案+首個 PR)、M2(引導方案+Phase 0-4)、K2(雙重退款等 11 個 bug)**收斂成 3 張可直接排進 sprint 的 PR 卡**,每張都含目標/前置依賴/逐檔改動清單/migration/測試清單/驗收標準/風險回滾/工作量。
- 方法:本文件**不重新讀程式碼推翻既有結論**,只做「彙整+排序+驗收標準具體化」,凡引用行號一律沿用 N1/Q4/Q3 的逐行核對結果(N1/Q3/Q4 產生於同一天,依據 commit `91117649`;本輪已對 PR-1 涉及的 `agentToolExecutor.ts:706-728`、`generate.ts:676/902-920/1491-1533`、`db.ts:2160-2181` 之 `atomicClaimJobRefund` 重新 `Read` 現在的 HEAD 逐段核對,行號有 1-3 行誤差但結構/邏輯完全一致,可信賴這些引用)。
- 讀者:要把這 3 張卡拆進 Jira 開工的工程師與要拍板順序的 Bruce。

---

## 0. 三張 PR 一覽 + 依賴順序

```
PR-1(修 gate + 63 工具安全化 + 雙重退款止血)
   │
   │  PR-1 是 PR-2、PR-3 共同的技術前置(見 §0.1 說明依賴的精確性質)
   ▼
PR-2(分鏡管線單幕端到端)          PR-3(對齊門純函式 + projectId 接 ai.chat)
   彼此互不依賴,可並行开工              彼此互不依賴,可並行开工
```

### 0.1 依賴關係的精確性質(避免「唯一硬前置」被誤讀成什麼都要等 PR-1)

- **PR-2 對 PR-1 的真實依賴度:低,非阻塞**。N1 決策卡 3 已訂正 M0 的說法——PR-2 第一刀只用 `studio.generateImage`,這個工具**本來就在現有 37(以 Q4 精算後是 38)個可達工具內**,不經過 63 筆缺口修復。PR-2 可以在 PR-1 合併**之前**先開工、先寫 runner 骨架與測試,只是如果 PR-2 想擴大到需要精靈家族工具(例如未來用 `videoSpecialist.*` 而非 `studio.*`),那時才需要 PR-1 落地。**建議:PR-2 與 PR-1 並行開工,PR-2 合併前只需確認 PR-1 沒有動到 `dispatchStudioTool` 內 `studio.generateImage` 這個既有 case 的行為(它不動,見 PR-1 逐檔改動清單)。**
- **PR-3 對 PR-1 的真實依賴度:零**。對齊門是純函式(`shared/project-alignment-gate.ts`),`ai.chat` 讀 `snapshotState.currentCreativeProjectId` 也不經過光球工具執行器。PR-3 可以與 PR-1 完全並行,甚至先合併。
- **PR-1 內部子項的依賴**:R1(雙重退款)與 G3 gate 修復是同一個 PR 內兩件不相關的事(N1 決策卡 1、2 各自獨立),之所以合併進同一張 PR,是因為兩者都符合「小、風險低、可獨立 review」且 K2/Q4 都指出這兩塊是**同一批「止血優先」的地基工作**,不是因為有程式碼耦合。**若 Bruce 要求拆更細,R1 退款止血可以拆成 PR-1a、gate+63 工具可以拆成 PR-1b 各自獨立提交**——本 playbook 預設合併是為了减少 PR 數量,不是技術強制。

### 0.2 為何是這 3 張(而非更多)

M1/M2/Q1/Q3/Q4/N1/K2 加總起来的候選 PR 遠不止 3 張(逐幕組裝編輯器字卡軌、前端接線、compose 服務……),本 playbook 只挑「**地基級 + 已有完整規格 + 可在 1-2 週內獨立完工**」的前 3 張:PR-1 是所有後續工具執行類工作的地基,PR-2 是「腳本→分鏡→每一幕」本質流程首次端到端打通的最小切片,PR-3 是防跑偏與專案感知能力的最小切片。其餘(逐幕三軌編輯器全量、compose 拼接、專案主幹統一 UI)留給下一批 playbook。

---

## PR-1:修 G3 gate + 14/63 生成工具安全化 + 雙重退款止血

### 目標

1. 讓 `executeOrbToolCalls` 的路由 gate 正確放行 63 個目前「有 case、未註冊」的精靈工具(N1 決策卡 1、Q4 §3),同時把其中 **9 個真正會觸發付費生成的工具**(`videoSpecialist.generate/imageToVideo/enhance/lipSync`、`voiceSpecialist.generateSpeech/cloneVoice/designVoice/changeVoice/generateSfx`)正確標記 `requiresHuman:true` 並補進 `GENERATION_SLOT_TOOLS`——**這是 Q4 的新發現,標題裡的「14 生成工具地雷」需要澄清數字**:Q4 §4.2/§4.3 合計標出的「生成類地雷」共 **14 個**(9 個新註冊 + 5 個既有 registry bug:`imageSpecialist.generate/edit/upscale` 的 `requiresHuman:false` + `musicSpecialist.generate/generateSoundEffect` 未進 `GENERATION_SLOT_TOOLS`),本 PR 標題所稱「14 生成工具安全化」即指這 14 個,務必逐一設對,否則 gate 修好之日就是「無確認、無額度即可觸發真實付費生成」漏洞首次生效之日。
2. 止住 `generate.multimodal` 的雙重退款漏洞(K2 發現 1、N1 決策卡 2 的 R1)——目前是**邏輯必然發生**(非機率性)的可套利財務漏洞。

這是所有後續 PR(尤其涉及光球工具執行、精靈人格提示詞兌現)的地基;§0.1 已說明 PR-2/PR-3 對此 PR 的依賴實際很弱,但涉及擴大到精靈家族工具的任何未來工作都必須在此 PR 之後。

### 前置依賴

無。這是本批 3 張 PR 中唯一「不依賴其他 PR」的一張,可以最先開工。

### 逐檔改動清單

#### A. Gate 路由修復(N1 決策卡 1、Q4 §3.2)

**`server/services/agentToolExecutor.ts`**
- `:708`(if 判斷式)——改為:
  ```ts
  if (
    call.name.startsWith("studio.") ||
    call.name.startsWith("director.") ||
    isKnownGlobalAgentTool(call.name)
  ) {
  ```
  需在檔案頂部 import `isKnownGlobalAgentTool`(`shared/global-agent-tools.ts:1836`,已存在,無需新增)。
- `:726-728`(三元路由選擇式)——**這是本 PR 唯一容易漏改、且漏改會產生「看起来修好但其實還是全部失敗」假修復的一行,PR review 必須逐字核對**。改為:
  ```ts
  const bridgeResult = call.name.startsWith("director.")
    ? await dispatchDirectorTool(call, opts)
    : await dispatchStudioTool(call, opts); // 含 studio.* 與 178 個精靈前綴
  ```
  即「判斷是不是 director,其餘(含 studio.\* 本身)一律進 dispatchStudioTool」——因為 178 個精靈 case 全部寫在 `dispatchStudioTool` 裡,不在 `dispatchDirectorTool`。
- 不動 `dispatchStudioTool`/`dispatchDirectorTool` 函式本體(除下方 D 段兩個既有 bug 修正外),不動任何 `dispatch<Family>Tool` 內部邏輯。

#### B. Registry 補登 63 筆(Q4 §2 逐一列名)

**`shared/global-agent-tools.ts`**——新增 63 筆 `GLOBAL_AGENT_TOOL_REGISTRY` entry,依家族分組,格式比照既有同家族筆(`name`/`riskLevel`/`requiresHuman`/`allowedArgsSchema`/`executionTarget`):

| 家族 | 個數 | riskLevel/requiresHuman | 依據 |
|---|---|---|---|
| `orchestrator.*` | 11 | low / false(純調度查詢,已 grep 確認無 DB 寫入/外部呼叫) | Q4 §2 |
| `learningSpecialist.*` | 9 | low / false | 同上 |
| `communityManager.*` | 7 | low / false | 同上 |
| `securityGuard.*` | 4 | low / false(N1 已逐一讀過四個 case,唯讀健檢/寫一筆 issue) | N1 決策卡 1 |
| `companion.*` | 4 | low / false | Q4 §2 |
| `onboardingCoach.*` | 3 | low / false | 同上 |
| `legalAdvisor.*` | 3 | low / false | 同上 |
| `teachingArchive.search` | 1 | low / false | 同上 |
| `videoSpecialist.getModels/getTips/planWorkflow/recommendModel/estimateCost` | 5 | low / false(純查詢/推薦) | Q4 §4.2「12 個 metadata 類」 |
| `voiceSpecialist.getEmotionTags/getTips/getVoices/pickVoice/planVoiceover/recommendModel` | 6 | low / false | 同上 |
| `voiceSpecialist.transcribe` | 1 | low / false(比照 `studio.transcribe` 免確認) | Q4 §4.2 |
| **`videoSpecialist.generate/imageToVideo/enhance/lipSync`** | **4** | **medium / true**(⚠️ 呼叫 `dispatchFalQueueTask`,真實生成) | Q4 §4.2,**必須同步加進 `GENERATION_SLOT_TOOLS`** |
| **`voiceSpecialist.generateSpeech/cloneVoice/designVoice/changeVoice/generateSfx`** | **5** | **medium / true**(⚠️ 呼叫真實 TTS 後端) | 同上,**必須同步加進 `GENERATION_SLOT_TOOLS`** |

合計 11+9+7+4+4+3+3+1+5+6+1+4+5 = 63。

`GENERATION_SLOT_TOOLS`(`server/services/agentToolExecutor.ts:15` 起的 `Set`)——新增以上 9 個工具名字串。

#### C. Registry 既有 bug 修正(Q4 §4.3,不在 63 筆範圍但同一 PR 必須順手修)

**`shared/global-agent-tools.ts`**
- `imageSpecialist.generate`(`:903-905` 附近)、`imageSpecialist.edit`(`:917-919`)、`imageSpecialist.upscale`(`:930-932`)——三筆的 `requiresHuman` 從 `false` 改為 `true`。原因:三者都呼叫 `dispatchGenerationJob`(真實出圖),因為 gate 一直擋著從未真正執行過此 bug,gate 修好後才首次生效,若不改會變成「無確認即可出圖」。
- `musicSpecialist.generate`、`musicSpecialist.generateSoundEffect`——`requiresHuman` 已經是 `true`(正確),但兩者**都要加進 `GENERATION_SLOT_TOOLS`**(目前不在),否則通過確認後仍不計入每日生成額度。

#### D. Planner 教學文字同步修正(N1 決策卡 1 §工作量、M2 §4.1)

**`server/services/agentPlanner.ts`**
- `:529-530` 附近——教 LLM 串 `media.transcribe → media.caption` 的 prompt 文字,補註記「這兩個工具(及 storyboard/summarizePdf/extractPrompt)無執行路徑,勿建議」(Q4 §1.1 已確認這 5 個 `media.*` 是「真孤兒」,executor 內部完全沒有 case,連 gate 修好也打不到)。

#### E. R1 雙重退款止血(N1 決策卡 2、K2 發現 1)

**`server/routers/generate.ts`**
- 在 `try` 區塊開頭(`:676` 附近,`!demoMode` 已建立 `jobId` 之後)新增一個「認領式退款」helper:
  ```ts
  let refunded = false;
  const refundOnce = async () => {
    if (refunded) return;
    if (!demoMode) {
      const claimed = await db.atomicClaimJobRefund(jobId, _genEstimate.totalPoints);
      if (claimed) {
        await db.refundUserPoints(userId, _genEstimate.totalPoints);
      }
    }
    refunded = true;
  };
  ```
- 9 處呼叫點替換(8 內層 + 1 外層 catch),全部把 `await db.refundUserPoints(userId, _genEstimate.totalPoints)` 換成 `await refundOnce()`:
  - 圖片:`:902-908`、`:914-920`
  - 影片:`:1002-1008`、`:1014-1020`
  - 音樂:`:1103-1109`、`:1115-1121`
  - 語音:`:1211-1217`、`:1223-1229`
  - 外層 catch:`:1498`
- **不改**任何生成邏輯、扣點邏輯,不改 `_genEstimate` 的計算方式。
- demoMode 分支的假 `jobId`(`Date.now() % 2147483647`)不需要特殊處理——`atomicClaimJobRefund` 對找不到的列自然回傳 `false`,且 demoMode 路徑本來所有退款呼叫都在 `!demoMode` 判斷式內,不影響 demo 行為(上面 helper 內已把 `!demoMode` 判斷收進 `refundOnce` 本體,呼叫點不再需要各自重複判斷)。

### Migration

無。全部是程式碼路由邏輯 + 純資料(registry entry)改動,不涉及 DB schema 變更。

### 測試清單

1. **新測試檔**:`server/services/__tests__/executeOrbToolCalls.reachability.test.ts`(Q4 §5 已給出完整草稿,規格如下)
   - 只 mock 最外層「真的會花錢/連外部 API」的邊界(`dispatchFalQueueTask`、`SunoClient`、`invokeLLM`、Perplexity client),**不 mock `executeOrbToolCalls` 本身、不 mock 任何 `dispatch*Tool` 中介函式**——延續 G3/N1「假測試 mock 掉執行器測不到」的反面教材。
   - 對 63 個新註冊工具,每個家族取 1-2 個代表(至少含 `orchestrator.getTeamStatus`、`videoSpecialist.getModels`、`voiceSpecialist.getVoices`、`learningSpecialist.getQuickTips`、`legalAdvisor.getGuidelines`、`securityGuard.checkHealth`、`communityManager.listPlatforms`、`onboardingCoach.getQuickStart`、`companion.detectMood`、`teachingArchive.search`),斷言回傳不再是 `tool-not-found`/`studio-tool-not-registered`/`director-tool-not-registered`。
   - **危險路徑專項**:對 9 個新標記 `requiresHuman:true` 的生成工具(至少覆蓋 `videoSpecialist.generate`、`voiceSpecialist.generateSpeech`),`approved:false` 時必須回 `confirmation-required`,且 `dispatchFalQueueTask` mock 斷言 `not.toHaveBeenCalled()`。
   - **既有 bug 修正驗證**:`imageSpecialist.generate`(`approved:false`)必須回 `confirmation-required`(修前是無條件放行)。
   - **額度閘門**:對 9+2=11 個新加進 `GENERATION_SLOT_TOOLS` 的工具,連續呼叫超過每日上限應回 `generation-quota-exceeded`(比照 `studio.generateImage` 既有測試手法)。
   - **反向確認(不應變壞)**:`github.review`/`deploy.preview`/`code.modifyWithClaudeCode` 即使 gate 誤放行,也只落到 `dispatchStudioTool` 的 default fallback,`ok:false` 但不是危險操作。
2. **R1 退款測試**:
   - 單元測試直接呼叫 `atomicClaimJobRefund(jobId, points)` 兩次,斷言第二次 `affectedRows === 0`(即回傳 `false`)。
   - 端到端測試:對 `generate.multimodal` 用確定失敗的假 `modelId`(觸發內層 fal dispatch 失敗分支)觸發一次生成請求,斷言使用者 `remainingGenerations` 只被加回一次(不是兩次)。
3. **回歸**:既有 `server/services/__tests__/agentToolExecutor.test.ts`(42 行,測 `assertAllowedEndpoint`)必須維持全綠,不刪除、不弱化既有斷言。

### 驗收標準

- [ ] gate 判斷式(`:708`)與三元路由選擇式(`:726-728`)**兩處都改**,PR description 明確附兩處 diff 供 reviewer 逐字核對(對照 N1「三元式漏改=假修復」的警告)。
- [ ] 63 筆新 registry entry 全部補齊,總筆數從 148 增至 211(148+63)。
- [ ] 9 個新發現的中風險生成工具(`videoSpecialist.*` 4 個 + `voiceSpecialist.*` 5 個)`riskLevel:"medium"` 且 `requiresHuman:true`,且全部在 `GENERATION_SLOT_TOOLS` 內。
- [ ] `imageSpecialist.generate/edit/upscale` 三筆 `requiresHuman` 改為 `true`。
- [ ] `musicSpecialist.generate/generateSoundEffect` 加進 `GENERATION_SLOT_TOOLS`。
- [ ] `agentPlanner.ts:529-530` 附近的 `media.*` 教學文字已標註「無執行路徑」。
- [ ] 新可達性測試檔全綠,且測試審查確認**沒有 mock `executeOrbToolCalls` 本身**。
- [ ] R1:對 `generate.multimodal` 用確定失敗的請求驗證退款只發生一次。
- [ ] 既有 37/38 個「可達」工具(`studio.*` 16 個、`director.*` 5 個、`db.*` 14 個、`research.*`/`inspiration.fetch` 3 個)行為零回歸。

### 風險與回滾

- **風險等級:低**。純路由層+資料層改動,不涉及金流計算邏輯本身(R1 只改「退款呼叫幾次」不改「退多少」),不涉及外部危險操作。
- **主要風險點**:三元路由選擇式若 review 時漏檢查,會產生「錯誤訊息文字改變但實際仍全部失敗」的假修復,且因為表面現象改變容易被誤判為已解決——這是本 PR 唯一真正需要人工特別留意的地方,已在驗收標準第一條明確列出。
- **次要風險**:63 筆新工具的 `riskLevel`/`requiresHuman` 若有遺漏未識別出的「真危險」工具(N1/Q4 已用 grep 交叉核對,但未逐行讀完每個 spiritTools 檔案全文,見 Q4 §6 未查證部分),可能在合併後才發現某個「低風險」工具其實有副作用。緩解:PR review 時逐一過目 §逐檔改動清單 B 段列出的 grep 依據。
- **回滾**:純 revert 這一個 PR 即可完全復原(gate 改動是 2 行、registry 是純新增資料、`refundOnce` 是新函式替換既有呼叫點,無交叉依賴)。回滾後果:63 個工具重新變回不可達(功能倒退但不會產生新 bug),雙重退款漏洞會重新出現(需注意:若回滾發生在其他 PR 已依賴此 PR 之後,需要評估連動)。

### 工作量

**S(1 個 PR,2-3 天)**——gate 兩處改動 0.5 天、registry 63+5 筆資料補登 0.5-1 天(含逐筆核對 riskLevel)、R1 退款 helper 改動 0.5 天、測試撰寫 1 天。

---

## PR-2:分鏡管線執行化「單幕端到端」(M1 軌 B,單幕、僅 t2i)

### 目標

讓 AnimationStudio 的「編排動畫管線」從「規劃會過、frame 狀態永遠卡在 queued」的估價表,首次變成可以按「開始執行」、看到至少一幕的 frame 狀態從 `queued` 真實推進到有 `imageUrl` 的可執行管線(M1 §5.1 里程碑、N1 決策卡 3 選項 A 訂正後的範圍)。

**範圍刻意縮小到單幕、僅 `studio.generateImage`(t2i)**,不含 refine(img2img)、i2v、compose——N1 決策卡 3 逐行核對後發現 M1 原文件「plan 步驟直接轉呼 executor」的描述低估了工作量:8 種 `step.tool` 值裡有 3 個要重新映射(`imageToImage`/`imageToVideo`→ 對應工具加 routing 參數,`generateMusic`→`generateAudio`),2 個(`audio.composeTrack`/`video.composeFinal`)目前全站零執行路徑;args 欄位 camelCase→snake_case 也要轉譯;跨步依賴的 `sourceFrameStepId` 與 executor 認得的 `${stepId.field}` 樣板格式不同。第一刀只做 t2i,是唯一「tool 名 + args 命名 + 無跨步依賴」都不需要轉譯的情況,可以最快驗證「runner→executor→回填→狀態機」整條線是通的。

### 前置依賴

**技術上不依賴 PR-1**(N1 決策卡 3 已訂正——`studio.generateImage` 本來就在現有可達的 37/38 個工具內,不需要 PR-1 的 63 筆 registry 補登)。**可與 PR-1 並行開工**,只需在合併前確認 PR-1 沒有改變 `studio.generateImage` 這個既有 case 的行為(PR-1 逐檔改動清單已聲明不動 `dispatchStudioTool` 函式本體的既有 case 邏輯)。

### 逐檔改動清單

1. **新增 `server/services/storyboardPipelineRunner.ts`**(M1 §5.1、N1 決策卡 3 工作量段):
   - 讀 `worldStoryboard.get` 回傳的 `pipelinePlanJson`(型別 `AnimationPipelinePlan`,`shared/worldbuilding-animation.ts:259-269`)。
   - **工具名轉譯**(第一刀只需一種對應):plan 產出的 `step.tool === "studio.generateImage"` 直接對應到 executor 的 `studio.generateImage` case,無需轉譯表(其餘 7 種 tool 值——`imageToImage`/`imageToVideo`/`generateMusic`/`generateVoice`/`generateSfx`/`audio.composeTrack`/`video.composeFinal`——第一刀遇到時一律**跳過並標記 `skipped`**,不阻塞已完成步驟的推進,對齊 N1 決策卡 3 的建議答案)。
   - **args 欄位轉譯**:plan 的 `input`(camelCase:`aspectRatio`/`negativePrompt`)轉成 executor 的 snake_case(`aspect_ratio`/`negative_prompt`,對照 `agentToolExecutor.ts:1087,1091`)。建議寫成一個獨立小函式 `mapPipelineStepToToolCall(step): ToolCall`,附單元測試鎖住兩邊格式假設(N1 決策卡 3 風險段建議)。
   - 呼叫 `executeOrbToolCalls`(`agentToolExecutor.ts:533`)取得 `imageUrl`。
   - 回填 `frame.imageUrl`,呼叫 `updateJob`(`worldStoryboard.ts:314`)/`updateSessionStatus`(`:353`)推進 `jobsJson[i].status`(`queued`→`t2i_done`/`failed`)。
   - 第一刀做**同步跑 1-2 幕**的量級(對齊 M1 §5.1「先做同步跑,批次並行留到中期」),不建立新的佇列基礎設施。
2. **`server/routers/worldStoryboard.ts`**:新增 `runPipeline` mutation
   - 輸入:`{ storyboardId: number }`。
   - 內部:load row → ownership check(`row.userId !== ctx.user.id` → `NOT_FOUND`,對齊既有 `update`/`updateJob` 寫法)→ 呼叫 runner → 回傳目前進度快照。
   - 不改動 `planPipeline`(:284)本身、不改動 `planAnimationPipeline`(`animation.ts:616-855`)純函式。
3. **`client/src/adapters/generation.trpc.ts`**:**本 PR 不做**——kind=video adapter(軌 C,`AdapterPendingError` 移除)屬於 M1 軌 C,第一刀範圍只有 t2i,i2v 留到第二刀,不在本 PR 檔案改動清單內(避免範圍蔓延)。
4. **`client/src/shells/video/canvas/AnimationStudio.tsx`**:`:5851-5860` 按鈕區加「開始執行」按鈕,呼叫 `runPipeline`;沿用既有 `PipelinePlanView`(`:6888-6946`)旁的即時進度顯示,輪詢 `jobsJson`(或既有 `generate.myJobs`)。
5. **`shared/worldbuilding-animation.ts`**:不改動型別本身(`AnimationPipelinePlan`/`AnimationPipelineStep` 已足够),僅在 runner 內部消化。

### Migration

無 DB schema 變更——`pipelinePlanJson`/`jobsJson`/`scenesJson` 全部是既有 JSON 欄位(`world_storyboards` 表),runner 只是新的讀寫消費者。

### 測試清單

1. **runner 端到端測試**(不 mock 執行器本身,對齊 G3/M1「不 mock 執行器」教訓):固定一份只含 `studio.generateImage` 步驟的 plan,mock 掉最外層 `dispatchFalQueueTask`(真的花錢的邊界),呼叫 runner,斷言:
   - `frame.imageUrl` 被正確回填。
   - `jobsJson[i].status` 從 `queued` 推進到 `t2i_done`。
   - `updateSessionStatus` 被正確呼叫。
2. **失敗路徑測試**:mock `dispatchFalQueueTask` 回傳失敗,斷言 frame 狀態變成 `failed` 且帶 `errorMessage`,不拋未捕獲例外。
3. **跳過步驟測試**:plan 含一個 `audio.composeTrack` 步驟,斷言 runner 標記該步驟 `skipped` 而非整個 pipeline 中斷,其餘 t2i 步驟仍正常執行完。
4. **`mapPipelineStepToToolCall` 單元測試**:camelCase→snake_case 轉譯的欄位對照表(至少覆蓋 `aspectRatio`/`negativePrompt`),鎖住兩邊格式假設。
5. **`worldStoryboard.runPipeline` mutation 測試**:ownership check(非本人 storyboard 應 `NOT_FOUND`)。
6. **前端**:`AnimationStudio.tsx` 新增「開始執行」按鈕的互動測試(點擊後呼叫 `runPipeline`,輪詢顯示進度)。

### 驗收標準

- [ ] 可展示的端到端 demo(對齊 M1 §6-7):創作者對一個已連結世界觀的專案建一個只有 1-2 幕的分鏡,按「編排動畫管線」→「開始執行」,能看到至少一幕的 frame 狀態從 `queued` 變成有真實 `imageUrl`。
- [ ] `planPipeline`/`planAnimationPipeline` 本體零改動(純消費既有輸出)。
- [ ] `audio.composeTrack`/`video.composeFinal` 步驟被正確跳過標記,不阻斷其餘步驟。
- [ ] runner 測試不 mock `executeOrbToolCalls`/`dispatchStudioTool`,只 mock `dispatchFalQueueTask` 這個外部花錢邊界。
- [ ] `runPipeline` mutation 有 ownership check,不接受「當前使用者最新一筆」隱式推斷(對齊 M1 §6-1 防跑偏原則,`storyboardId` 為必要輸入)。

### 風險與回滾

- **風險等級:中**。跨兩個模組(`worldbuilding-animation.ts` 的 plan 格式 + `agentToolExecutor.ts` 的 executor 格式)手動維護一份轉譯表,未來任一邊改動欄位命名,轉譯表要同步更新——已用 `mapPipelineStepToToolCall` 集中維護+單元測試鎖住降低風險。
- **次要風險**:第一刀只支援單幕/僅 t2i,若 UI 按鈕文案沒有清楚標示「僅支援首圖生成,尚未支援影片/配樂」,可能造成創作者誤以為整條管線已完工——驗收時需檢查按鈕/進度 UI 有無「誠實待後端」標示(對齊 M1 §6-4)。
- **回滾**:新增檔案(`storyboardPipelineRunner.ts`)+ 新增 mutation(`runPipeline`)+ 新增按鈕,均為純加法,不修改任何既有函式行為,revert 此 PR 即完全復原,不影響 PR-1/PR-3。

### 工作量

**M(1-2 週)**——runner 骨架+轉譯函式 3-4 天、`runPipeline` mutation+ownership check 1 天、前端按鈕+進度顯示 2 天、測試 2-3 天。

---

## PR-3:對齊門純函式 + projectId 接 ai.chat(Q3 首個 PR 收斂版 + M2 Phase 1)

### 目標

本 PR 合併兩件已有獨立規格、但都屬「小範圍、可獨立驗證」的最小切片:

1. **對齊門五問純函式**(Q3 §7 已定義的「首個 PR 範圍」):新增 `evaluateProjectAlignmentGate` 純函式 + 五問判定邏輯 + 17 案單元測試,**刻意不接前端、不接 `agentPlanner.ts` 呼叫點**——先把「防跑偏判定邏輯本身」以獨立、可測試、尚未插電的狀態進倉,對齊 Q3 明訂的「不要一次跑偏成大 PR」原則。
2. **`director.chat` 的 projectId 接線收尾**(N1 決策卡 4 選項 A):`director.chat` 的 world context 邏輯(`server/routers/director.ts:150-258`)**已完整實作**,只差①開旗標、②`/director` 獨立頁補一行傳遞——這是本批 3 張 PR 裡工作量最小、投資報酬率最高的一塊,適合與對齊門純函式合併進同一張 PR 一起收尾。

**`ai.chat` 的 projectId 完整接線(N1 決策卡 4 選項 B/C)不在本 PR 範圍**——理由見下方「不在此 PR 範圍」。

### 前置依賴

無。純函式 + 既有旗標開關 + 一行前端補值,不依賴 PR-1/PR-2 的任何改動。可與兩者完全並行,甚至最先合併。

### 逐檔改動清單

#### A. 對齊門純函式(Q3 §7 首個 PR 範圍)

1. **新增 `shared/project-alignment-gate.ts`**:Q3 §3 定義的完整型別(`ProjectJourneyStepId`/`KnownEntity`/`ProjectJourneySnapshot`/`ProjectAlignmentContext`/`AlignmentViolatedRule`/`AlignmentClarification`/`ProjectAlignmentGateResult`)+ `evaluateProjectAlignmentGate` 完整實作(Q1→Q5 依序判定,第一個 fail 即回傳,對照 Q3 §1 逐問機械判準):
   - Q1 還在同一個專案:比對 `activeProjectId` 與 plan 暗示的 `projectId`/使用者文字提及的其他專案標題。
   - Q2 還在同一或下一階段:比對 `journey.currentIndex` 與 step 對應的 `journeyStage`(容許跳過 1 個 optional stage,不容許跳兩步以上,允許回頭改已完成步驟)。
   - Q3 只用專案已知實體:比對 step 參數裡的實體名與 `knownEntities[]`(精確字串比對,不做模糊/語意比對;editDistance ≤ 2 才給「你是說 XX?」選項)。
   - Q4 仍指向北極星終點:比對 step 的 `toolName` 對應的 `journeyStage` 是否落在允許集合(`STAGE_NEUTRAL_TOOLS` 白名單永遠放行)。
   - Q5 沒有繞過核准門:唯一 fail 時 `forceBlocked:true`(降級為 `blocked` 而非 `clarification`)。
   - 資料不足(`journey: null` 等)時**一律 pass + `skippedReason`**,不誤擋創作者(對齊既有 `guardOrbMemorySummary` 一貫「安檢失敗不阻斷主流程」設計慣例)。
2. **新增 `shared/project-journey-stages.ts`**:`TOOL_JOURNEY_STAGE_HINTS: Record<string, ProjectJourneyStepId>` + `STAGE_NEUTRAL_TOOLS: Set<string>`——刻意不改 `shared/global-agent-tools.ts` 既有 148(PR-1 之後 211)筆 registry entry,用獨立小表取代 M2 §4.4 原提案的「每個 capability 補 `journeyStage` 欄位」,降低本 PR 的檔案改動面。
3. **新增 `tests/unit/shared/project-alignment-gate.test.ts`**:Q3 §6 全部 17 案(見下方測試清單)。
4. **不動**(明確排除,對齊 Q3 §7):`server/services/agentPlanner.ts` 的插入點(§2.1 的四道閘插入留到後續 PR)、`client/src/shells/video/DirectorConsoleProvider.tsx`/`AmbientOrb.tsx`(`OrbBubble.secondaryCta` 擴充留到後續 PR)、`deriveProjectJourney`/`projectJourney.ts` 的抽出重構(依賴 M2 §4.3,屬另一個獨立 PR)。

#### B. `director.chat` projectId 收尾(N1 決策卡 4 選項 A)

1. **環境旗標**:`ENABLE_DIRECTOR_WORLD_CONTEXT` 從預設 OFF 改為對內部/admin 帳號灰度開啟(依 Bruce 拍板決定實際灰度範圍與方式,規格層面只要求「至少先對內部帳號開」)。
2. **`client/src/pages/DirectorAI.tsx`**:`:3406` 附近的 `chatMutation.mutate` 呼叫補上 `projectId` 欄位——對照 `client/src/spine/ProjectSpineProvider.tsx:493` 已有的寫法(`projectId: p ? Number(p.id) || null : null`),取當前 active project id 塞入。這是 M2 §4.2 所稱「一行」規模的呼叫點,**特指這一個(/director 獨立頁),不是 /video 座艙那個(已完工)**。
3. **不動** `server/routers/director.ts:150-258` 的 world context 載入邏輯本身(已完整實作,`isDirectorWorldContextEnabled` + `loadProjectWorldContext`,best-effort 吞錯設計良好,不需要改動)。

### Migration

無。純新增純函式檔 + 一行前端呼叫點補值 + 一個既有環境旗標的灰度開關,不涉及 DB schema。

### 測試清單

1. **對齊門單元測試**(`tests/unit/shared/project-alignment-gate.test.ts`,Q3 §6 全 17 案):
   - `no_active_project_passes`、`same_project_step_passes`、`different_project_id_in_toolArgs_fails`、`user_text_mentions_other_project_title_fails`
   - `next_stage_step_passes`、`skip_two_stages_fails`、`skip_optional_world_stage_passes`、`revisit_earlier_stage_passes`
   - `known_entity_passes`、`unknown_entity_fails_with_two_options`、`unknown_entity_no_close_match_still_two_options`
   - `off_journey_tool_fails`、`stage_neutral_tool_always_passes`
   - `approval_bypass_forces_blocked_not_clarification`
   - `missing_journey_data_skips_gate`
   - `only_first_violation_reported`(同時觸發 Q2/Q3 時只回傳先判定的 Q2)
   - `converted_status_reads_plan_steps`(`gated.status="converted"` 用 `plan.steps` 而非 `task`,驗證兩型別窄化都正確)
2. **`director.chat` 灰度驗證**:旗標開啟後,對內部帳號發送帶 `projectId` 的請求,斷言回應 prompt 包含世界觀摘要;旗標關閉時行為零變化(既有 best-effort 吞錯邏輯覆蓋)。
3. **`DirectorAI.tsx` 呼叫點測試**:確認 `chatMutation.mutate` 呼叫參數中 `projectId` 正確帶入當前 active project id,無 active project 時傳 `null`。

### 驗收標準

- [ ] `evaluateProjectAlignmentGate` 17 案單元測試全綠。
- [ ] 對齊門純函式**不呼叫 LLM、不打 DB、不丟例外**——PR review 確認函式簽章與內部實作只消費呼叫端已準備好的資料。
- [ ] 本 PR **不修改** `agentPlanner.ts`/`AmbientOrb.tsx`/`DirectorConsoleProvider.tsx`(對齊 Q3 §7 明確排除範圍,防止跑偏成大 PR)。
- [ ] `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標灰度開啟後,`/director` 獨立頁與 `/video` 座艙兩條路徑都能正確帶 `projectId`。
- [ ] `director.ts:150-258` 的 world context 載入邏輯零改動(僅驗證既有邏輯在旗標打開後正確運作)。

### 不在此 PR 範圍(留給後續 PR)

- **`ai.chat` 的 projectId 完整接線**(N1 決策卡 4 選項 B/C)——雖然 client 端已經在 `pageSnapshot.state.currentCreativeProjectId` 傳送(`GlobalOrbChatContext.tsx:4979-4989`),server 端 `ai.ts:1185-1239` 尚未讀取這個值。這是**全站最大流量入口**,涉及是否要在聊天熱路徑上呼叫 `contextPacketService`(重量級,含 DB 寫入+adapter fan-out,N1 已標示延遲風險未實測),需要先做「唯讀讀取最新 packet、不在聊天路徑觸發 compile」的延遲防護設計後再排入下一批 PR,不適合與本 PR 的兩個小切片混在一起送審。
- **對齊門實際插電**(Q3 §7「第二個 PR」預告):`agentPlanner.ts` 插入點(§2.1)+ `AgentPlannerInput.projectContext` 欄位組裝 + `ai.ts` 讀 `snapshotState.currentCreativeProjectId` 組出 `ProjectAlignmentContext`。
- **對齊門前端接線**(Q3 §7「第三個 PR」預告):`OrbBubble.secondaryCta` 擴充 + `GlobalOrbChatContext.tsx` 解析 `alignmentViolation` 顯式欄位 + 泡泡渲染。

### 風險與回滾

- **風險等級:低**。純函式新增(零副作用)+ 一個既有旗標的灰度開關(旗標本身設計為 best-effort 吞錯)+ 一行前端呼叫點補值。
- **主要風險點**:`ENABLE_DIRECTOR_WORLD_CONTEXT` 開啟後,若 `loadProjectWorldContext` 內部有未被本輪核對到的邊界情況(例如世界觀資料異常大),可能拖慢 `director.chat` 回應時間——已知邏輯是 best-effort 吞錯設計,失敗不影響主流程,但延遲風險建議灰度期間觀察 P95。
- **回滾**:對齊門純函式部分,revert 即完全復原(未插電,無其他程式碼依賴它)。`director.chat` 部分,把旗標關回 OFF 即可立即復原,不需要 revert 程式碼。

### 工作量

**S(1 個 PR,2-3 天)**——對齊門純函式+五問邏輯 1.5-2 天(含 17 案測試撰寫)、`director.chat` 旗標灰度+一行呼叫點補值 0.5 天。

---

## 未涵蓋部分(誠實列出)

1. 本 playbook 不重新核對 N1/Q3/Q4/M1/K2 產生當時(commit `91117649`)到 HEAD(本文件寫作當下已推進到 wave S 的多個文件 commit)之間,`agentToolExecutor.ts`/`generate.ts`/`db.ts` 是否有進一步改動——已對 PR-1 涉及的關鍵行號(gate `:708/:726-728`、`generate.ts` 退款分支、`atomicClaimJobRefund`)重新 `Read` 現在的程式碼核對過結構一致,但 PR-2/PR-3 涉及的 `worldStoryboard.ts`/`director.ts`/`shared/worldbuilding-animation.ts` 等檔案本輪**未重新逐行核對**,實作前建議工程師自行 `Read` 一次確認行號未大幅漂移。
2. `videoSpecialistTools.ts`/`voiceSpecialistTools.ts` 每個函式內部是否有 executor 層級以外的其他保護(例如是否被某個已審過確認流程的 tRPC router 共用)——Q4 §6 已明確列為未查證,PR-1 review 時建議追加這一項檢查。
3. PR-2 的 `sourceFrameStepId`→executor `${stepId.field}` 樣板依賴解析邏輯,若第二刀要擴大到 refine/i2v,`resolveStepRefsInArgs`(`shared/orb-step-ref-resolver.ts`)是否能直接無修改重用,N1 決策卡 3 已標示需要實作時寫 spike 驗證,本 playbook 不預先解決。
4. 逐幕組裝編輯器(Q1,M1 軌 D)、compose 拼接服務(M1 軌 E)、專案主幹統一 UI 改動(M1 軌 A)、`ai.chat` 完整 projectId 接線(選項 C)、對齊門的實際插電與前端接線(Q3 第二、三個 PR)——均已有規格但不在本批 3 張 PR 範圍內,留給下一批 playbook。
5. 三張 PR 的工作量估算僅為單一 PR 的技術工作量,未估算跨團隊排程(工程師人力/衝刺排期),沿用 N1 的既有聲明。

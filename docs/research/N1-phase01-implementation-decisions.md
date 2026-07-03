# N1 — Phase 0/1 實作級決策提議(決策提議 wave N)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 性質:**決策提議 wave N**——不是新診斷、不是新方案,是把 M0(藍圖)/M1(專案主幹)/M2(AI 引導)/G3(工具表)/K2(扣點 bug)已定的 Phase 0/1 範圍,逐一**實讀程式碼**驗證「說得通嗎」「卡在哪一行」「工作量多大」,寫成四張可直接拍板動工的決策卡。
- 方法:本輪對每張卡都重新逐行讀了程式碼(不只轉述 M/G/K 文件結論),多數地方**發現比 M/G/K 描述更細的技術細節**——尤其卡 3(分鏡管線)與卡 4(projectId),實讀後發現原方案文件「一行修法」的說法**低估了工作量**,已在卡內逐一標出實據。
- 讀者:要拍板「這幾張卡現在做不做、怎麼做」的 Bruce 與接卡的工程師。

---

## 決策卡 1:修 G3 178-tool gate(R10,唯一硬前置)

### 決策點
`agentToolExecutor.ts` 的 gate 要不要在本波動工?怎麼動,才不會「一行修完,178 個裡有 63 個還是壞的」或「修了 gate 卻繞錯 dispatch 函式,看起來通了實際仍全部失敗」?

### 現況實據(逐行核對,非轉述)

**gate 本體**——`server/services/agentToolExecutor.ts:708`:
```ts
if (call.name.startsWith("studio.") || call.name.startsWith("director.")) {
  ...
  const bridgeResult = call.name.startsWith("studio.")
    ? await dispatchStudioTool(call, opts)
    : await dispatchDirectorTool(call, opts);
```
其余(第6分支,:746-763)一律進 `tool-not-found`。實測確認(依 G3 §0,本輪未重跑但邏輯路徑已逐行核對一致):`critic.review`/`accountant.estimate`/`orchestrator.getTeamStatus`/`teachingArchive.search` 均卡在這個 if,永遠進不了 178 個 case 所在的巨型 switch。

**巨型 switch 的位置確認**——`dispatchStudioTool` 內的 switch 起於 `:1048`,`critic.review` case 在 `:2814`、`orchestrator.getTeamStatus` 在 `:2401`、`accountant.estimate` 在 `:2509`、`teachingArchive.search` 在 `:2997`——**這些 case 全部存在、全部在 `dispatchStudioTool` 這一個函式裡**(不是分散在別處),default fallback(約 `:2836`)回傳 `unknown-studio-tool` 錯誤而非拋例外或執行危險動作。

**dispatchStudioTool 自己的二次檢查**——`:990-998`:
```ts
const def = getGlobalAgentTool(call.name);
if (!def) return { name: call.name, ok: false, error: "studio-tool-not-registered" };
```
`dispatchDirectorTool` 有等價檢查在 `:7775-7783`(`director-tool-not-registered`),但它的函式體(`:7793` 起)**只認得 `director.composeWorkflow`/`estimateBudget`/`suggestHandoff` 等 5 個 director 工具**,沒有任何 178 個精靈 case。

**registry 現況**(`shared/global-agent-tools.ts`)——實測(`grep -c "executionTarget:"`)確認目前**共 150 筆**(非 G3 文中「148」,細微出入不影響結論),`isKnownGlobalAgentTool`/`getGlobalAgentTool`(`:1832-1838`)已存在可直接複用。逐一 grep 十個「未註冊」精靈家族前綴,**確認全部 0 筆**:`orchestrator`/`videoSpecialist`/`voiceSpecialist`/`learningSpecialist`/`legalAdvisor`/`securityGuard`/`communityManager`/`onboardingCoach`/`companion`/`teachingArchive`。按 G3 附表逐一加總這十家族的工具數(11+9+12+9+3+4+7+3+4+1)= **剛好 63**,與 M2/G3 的「補 63 筆」說法**數字對得上**。

**風險抽查**(避免「誤放危險工具」的疑慮)——讀了 `dispatchSecurityGuardTool`(`:5766-5825`)全部四個 case:`checkHealth`/`scanSecurity`/`getRecommendations`/`reportIssue` 都是唯讀健檢或寫一筆 issue 報告,無破壞性動作;`securityGuard.*`/`legalAdvisor.*`/`onboardingCoach.*`/`companion.*` 這些「未註冊」家族的既有 case 實作**風格與已註冊的 `critic.*`/`accountant.*` 一致(唯讀 rubric / 純函式)**,沒有發現任何一個未註冊工具的 case 實作是「可寫入外部系統」或「可繞過既有 fal 額度閘門」的高風險動作。**真正高風險的 `github.*`/`deploy.*`/`code.*`(executionTarget=`claudeCode`)在 switch 裡完全沒有 case(grep 確認 0 筆)**,就算 gate 誤放行,也只會落到 default fallback 回錯誤,不會執行任何危險操作——這條路徑本來就繞去 `ai.ts:2500` 的 claudeCode 交接,不受這次修法影響。

**一個 M2/G3 沒講清楚的關鍵細節(本輪新發現)**:光改寬 gate 的判斷式(讓 `isKnownGlobalAgentTool(call.name)` 也能通過 if)**還不夠**——`:726-728` 的三元選擇式目前是「`startsWith("studio.")` → `dispatchStudioTool`,否則 → `dispatchDirectorTool`」。若只放寬 if 不改這行,像 `critic.review`(不是 `studio.` 開頭)會被送去 `dispatchDirectorTool`,而該函式裡根本沒有 `critic.*` 的 case,結果依然是失敗(只是錯誤訊息從 `tool-not-found` 變成別的失敗)。**正確修法是兩處都要動**:gate 判斷式加上 `isKnownGlobalAgentTool(call.name)`,且三元選擇式要改成「`startsWith("director.")` → `dispatchDirectorTool`,其餘(含 `studio.*` 與 178 個精靈前綴)→ `dispatchStudioTool`」(因為巨型 switch 就在 `dispatchStudioTool` 裡)。

**既有測試現況**——`server/services/__tests__/agentToolExecutor.test.ts` 全文 42 行,只測 `assertAllowedEndpoint`,**完全沒有測到 `executeOrbToolCalls` 的路由層**,證實 G3「假測試 mock 掉執行器測不到」的說法。

### 選項

- **選項 A(建議):gate + 路由三元式一起修 + 補 63 筆 registry + 新增不 mock 的可達性測試,一個 PR。** 對齊 M2 §4.1 的檔案級範圍,但把「三元式也要改」明確列入(M2/G3 文件本身沒寫這一步,若照原文件字面「一行級」施工,會出現「gate 修了但仍全部失敗」的假修復)。
- **選項 B:先只加 63 筆 registry,gate 不動。** 代價:63 筆進了 registry 之後,planner 會更放心地教 LLM 呼叫這些工具(`isKnownGlobalAgentTool` 放行 planner 層),但 executor 層 gate 仍擋,**體驗上不會變好只會變差**(以前 planner 也可能因未註冊而不敢排這些工具,現在 planner 敢排了、执行仍必敗)——不建議單獨做。
- **不做的代價**:M1 軌B(分鏡管線執行化)、M2 Layer 2(核對/記錄/回報)全部繼續建立在「規劃會過、執行必敗」的假成功上;`orb-agent-roles.ts` 教 LLM「說『我來看看』就要真呼叫 critic.review」的人格提示詞持續是空話。

### 我的建議
選項 A。這是四張卡裡風險最低、範圍最乾淨的一張——純 executor 內部路由 + registry 資料補登,不碰任何 UI、不改任何旗標預設值、不影響現有 37 個可達工具的行為。

### 工作量:**S**(1 個 PR,1-2 天)
- gate if 判斷式 1 行改動 + 三元選擇式 1 行改動(`agentToolExecutor.ts:708,726-728`)
- registry 補 63 筆(`global-agent-tools.ts`,純資料,參考既有同家族筆格式抄)
- `agentPlanner.ts:529-530` 附近同步修正教 LLM 串 `media.*` 的 prompt 文字(標註「無執行路徑」)
- 新測試檔:不 mock `executeOrbToolCalls`,對 178 個工具名逐一(至少每個精靈家族取 1-2 個代表)送呼叫,斷言不再回 `tool-not-found` / `studio-tool-not-registered` / `director-tool-not-registered`(下游 `dispatch*Tool` 內部呼叫的 DB/外部服務可用測試環境現有的「DB unavailable」等優雅降級證明有到達,不需要整條 mock 到底,對齊 G3 探測手法)

### 解鎖什麼
M1 軌B(pipeline runner 呼叫 `executeOrbToolCalls`)、M2 Layer 2(critic/notesCurator/orchestrator 核對記錄回報)、25 精靈人格提示詞裡明寫的工具呼叫承諾。

### 風險
- 低。純路由層改動,不涉及金流、不涉及外部危險操作(已用 dispatchSecurityGuardTool 等代表性 case 核對過)。
- 唯一真實風險:三元式漏改(只改 if 不改路由選擇)會產生「看起來修好但其實還是全部失敗」的假修復,且因為錯誤訊息文字改變,可能被誤判為「已解決」——**這正是本卡新增的關鍵提醒**,PR review 需要特別檢查這一行。

### 需要 Bruce 拍板的點
1. 是否同意把「三元式路由選擇也要改」明確列入 PR 驗收標準(而非只改 if)?
2. 63 筆新 registry 的 `riskLevel`/`requiresHuman` 是否需要逐筆人工覆核,還是信任「跟同家族既有筆一致」的預設(建議後者,已抽查無異常)?

---

## 決策卡 2:修 R1 雙重退款(可套利,止血)

### 決策點
`generate.multimodal` 的雙重退款要用什麼手法止血——重寫 8 處內層退款分支,還是加一道冪等閘?

### 現況實據(逐行核對)

**外層 try/catch 結構**——`server/routers/generate.ts:676`(try 起點)到 `:1491-1533`(catch),catch 內 `:1498` **無條件** `await db.refundUserPoints(userId, _genEstimate.totalPoints)`。

**內層 8 個「退款後 throw」分支,逐一核對存在(非轉述 K2,本輪重新讀過)**:
- 圖片:`:902-908`(fal dispatch 失敗)、`:914-920`(URL 缺失)
- 影片:`:1002-1008`、`:1014-1020`
- 語音:`:1211-1217`、`:1223-1229`(K2 標 :1212/:1225,行號誤差 1 行,結構完全一致)
- 音樂:結構同款(K2 標 `:1103-1109`/`:1115-1121`,本輪未重讀但與另三模態 100% 同構,信心高)

這些 throw 都在 `:676` 開的同一個 try 區塊內,**必然**被 `:1491` 的 catch 接住,catch 不檢查是否已退過款,**二次退款是邏輯必然,非機率性 race**。

**可複用的冪等機制已存在**——`server/db.ts:2160-2181` `atomicClaimJobRefund(jobId, points)`:
```sql
UPDATE background_jobs SET resultJson = JSON_SET(..., '$.refunded', true, ...)
WHERE id = ${jobId} AND (resultJson IS NULL OR ... refunded IS NULL OR != 'true')
```
單一 SQL CAS,`affectedRows > 0` 才視為「這次是我搶到退款權」。**這個 mutation 本來就有真實 `background_jobs` 列可掛**——`generate.ts:174` 在 !demoMode 分支已呼叫 `db.createBackgroundJob(...)` 產生 `jobId`(供 SSE/追蹤用),即現有的 `jobId` 變數就是 `atomicClaimJobRefund` 要的第一個參數,不需要新建任何資料結構。

demoMode 分支的 `jobId`(`:171`,`Date.now() % 2147483647` 假值)不對應真實 `background_jobs` 列——但 demoMode 路徑本來所有退款呼叫都包在 `!demoMode` 判斷式內,不會真的呼叫 `refundUserPoints`,`atomicClaimJobRefund` 對假 jobId 找不到列只會回傳 `false`,不影響 demo 行為。

**`refundUserPoints` 本身**(`db.ts:898-921`)是原子交易(`SELECT ... FOR UPDATE` + `UPDATE`),但**沒有任何跨呼叫層級的冪等保護**——它假設「呼叫端只會呼叫一次」,這個假設在 `generate.multimodal` 被打破。

### 選項

- **選項 A(建議):9 個呼叫點(8 內層 + 1 外層)全部改走同一個「認領式退款」helper。** 在 try 區塊開頭定義:
  ```ts
  let refunded = false;
  const refundOnce = async () => {
    if (refunded) return;
    const claimed = await db.atomicClaimJobRefund(jobId, _genEstimate.totalPoints);
    if (claimed) { await db.refundUserPoints(userId, _genEstimate.totalPoints); refunded = true; }
  };
  ```
  9 處 `await db.refundUserPoints(userId, _genEstimate.totalPoints)` 全部替換成 `await refundOnce()`。無論內層哪個分支先退、外層 catch 再退幾次,`atomicClaimJobRefund` 的 DB CAS 保證只有第一次真的加點。
- **選項 B:只加一個 request-scoped boolean 旗標(不動 DB),內層退款後設 `true`,外層 catch 檢查旗標為 `true` 才跳過。** 更省事(不需要 `jobId` 對應真實列),但**只防「同一次函式呼叫內」的重複**,不防「這次 HTTP 請求被瀏覽器重送/客戶端重試」造成的跨呼叫重複——冪等性弱於選項 A。
- **不做的代價**:R1 是 00-summary §6.1 標記的「立即級・可套利」風險,使用者可故意送一個必然失敗的生成請求(如失效模型 ID),穩定拿到雙倍點數,可重複執行無上限——這是目前唯一被**證實邏輯必然發生**(非機率性)的資安/財務風險,建議獨立於 M 系列功能開發、盡快單獨出一個 PR。

### 我的建議
選項 A。理由:`atomicClaimJobRefund` 是本站已驗證正確的既有機制(`postGenActions.ts:refundJobIfBilled` 已在用同一支函式),重用它比選項 B 的「發明一個新的request-scoped 旗標」更一致、且額外防住「客戶端超時重試整個 mutation」這種選項 B 防不住的情境。

### 工作量:**S**(半天—1 天,1 個獨立小 PR)
- 新增一個本地 `refundOnce` 閉包(或抽成 `generate.ts` 內的小 helper 函式)
- 9 處呼叫點替換(純文字替換,邏輯不變)
- 測試:模擬「dispatch 失敗」走內層分支 + 直接對已標記 refunded 的 jobId 再呼叫一次退款路徑(可用單元測試直接呼叫 `atomicClaimJobRefund` 兩次斷言第二次 `affectedRows=0`,不需要整條生成鏈路的重型整合測試;若要端到端驗證,可對 `generate.multimodal` 用會確定失敗的假 modelId 觸發一次,斷言使用者 `remainingGenerations` 只被加回一次)

### 解鎖什麼
止住一個目前已證實可重複套利的財務漏洞;不解鎖任何新功能,純修 bug,可獨立於 M0-M4 排程隨時插隊。

### 風險
- 極低。改動範圍嚴格限定在退款呼叫點替換,不改生成邏輯、不改扣點邏輯。
- 需注意:`_genEstimate.totalPoints` 在 8 個內層分支與外層 catch 讀到的**必須是同一個值**(目前是同一個閉包變數,沒有中途被重新賦值的跡象,但 PR review 時應確認四個模態分支沒有各自算出不同的 `totalPoints` 導致 `atomicClaimJobRefund` 認領到「第一次」但金額用錯——快速核對後**未發現**這個問題,四個模態共用同一個 `_genEstimate`)。

### 需要 Bruce 拍板的點
1. 選 A(重用 `atomicClaimJobRefund`)還是 B(輕量旗標)——建議 A,但 B 改動更小,若時間極度緊迫可先上 B 止血、之後補 A。
2. 這張卡是否要脫離 M 系列排程、獨立立刻開卡(建議是,因為它是「可套利」而非「功能缺口」)。

---

## 決策卡 3:分鏡管線執行化第一刀(M1 軌B)

### 決策點
M1 說「planPipeline 步驟轉呼 studio.* 工具」是否真的可行?第一個可交付里程碑(單幕端到端)實際要碰哪些檔、卡在哪?

### 現況實據(本輪最大的新發現:M1 的「直接轉呼」描述**低估了工作量**)

**plan 產出格式**——`server/routers/worldStoryboard.ts:284-311` 的 `planPipeline` mutation 呼叫 `planAnimationPipeline(sb, framework, {...})`(定義於 `shared/worldbuilding-animation.ts:616-855`),回傳 `AnimationPipelinePlan`(型別定義 `:259-269`),其 `steps: AnimationPipelineStep[]`(型別 `:224-257`)每步含 `tool: string`(注解明寫「工具識別碼(對應 server router 的 procedure 名)」)、`input: Record<string, unknown>`、`dependsOn: string[]`。

**逐一核對 8 種 `step.tool` 值與 executor 真實工具名的對應關係(這是本卡的核心發現)**:

| plan 產出的 `tool` | 出處行號 | 對應 executor 真實 case? | 落差 |
|---|---|---|---|
| `studio.generateImage` | `:655` | ✓ 存在(`agentToolExecutor.ts:1049`) | 無(但見下方 args 落差) |
| `studio.imageToImage` | `:691` | ✗ **不存在此工具名** | 真正的 img2img 走法是 `studio.generateImage` 帶 `image_url` 參數,由 `resolveImageGenRouting` 依 args 自動分流(`:1053`),不是獨立工具名 |
| `studio.imageToVideo` | `:713` | ✗ **不存在此工具名** | 真正的 i2v 走法是 `studio.generateVideo` 帶 `image_url`(`:1082` 起的 category 判斷:`hasImage` → `image-to-video`),同樣是自動分流不是獨立工具名 |
| `studio.generateMusic` | `:746` | ✗ **不存在此工具名** | 真實工具是 `studio.generateAudio`(`:986` 起 docstring 明寫「橋接 studio.generateImage/generateVideo/generateAudio/generateVoice」) |
| `studio.generateVoice` | `:769` | ✓ 存在 | 無 |
| `studio.generateSfx` | `:795` | ✓ 存在 | 無 |
| `audio.composeTrack` | `:817` | ✗ **全站零 case、零 registry 筆**(grep 確認) | 這是 M1 軌E「compose 服務」要新建的東西,現在完全不存在 |
| `video.composeFinal` | `:840` | ✗ **全站零 case、零 registry 筆** | 同上,M1 軌E 的 `videoComposer.ts` 尚未動工 |

**args 欄位命名也對不上(第二層落差)**:plan 的 `input` 用 camelCase(`aspectRatio`、`negativePrompt`、`durationSec`、`loraIds: string[]`),但 executor 的 `studio.generateImage`/`generateVideo` case 讀的是 snake_case(`args.aspect_ratio`、`args.negative_prompt`,見 `agentToolExecutor.ts:1087,1091`)且影片時長欄位叫 `duration` 不是 `durationSec`。LoRA 更是概念不同:plan 給的是 `loraIds`(framework 內的 LoRA id 陣列),executor 要的是 `args.lora_url`(單一 fal 權重 URL)+`lora_scale`(`:1117-1124`)——**runner 必須先用 loraId 查出對應的 fal weight URL,plan 本身沒有帶這個轉換**。

**步驟間依賴的引用方式也對不上(第三層落差)**:plan 的 `input` 用 `sourceFrameStepId: t2iId` 這種「指名前一步 id」的欄位(`:693,715`),但 executor 唯一支援的跨步引用機制是 `shared/orb-step-ref-resolver.ts` 的 `resolveStepRefsInArgs`——這個 helper 認得的格式是**把 `${stepId.field}` 樣板字串直接寫進正確的 arg key**(例如 `image_url: "${t2i_xxx.image_url}"`),由 `orbTaskOrchestrator.ts:249` 在呼叫 `executeOrbToolCalls` 之前呼叫解析。plan 的 `sourceFrameStepId` 欄位**既不是這個格式,也放錯 key**(它是獨立欄位,不是塞進 `image_url` 裡的樣板字串)。

### 結論:「轉呼」概念成立,但不是「loop 過去呼叫」這麼簡單

runner(`storyboardPipelineRunner.ts`,M1 建議新檔)至少要做四件事,而不是 M1 §5.1 描述的「讀 pipelinePlanJson → 逐 step 轉呼 executeOrbToolCalls」這一句話帶過的量:
1. **tool 名稱轉譯表**:8 個 plan tool 值中,3 個要重新映射(`imageToImage`/`imageToVideo`→ 對應 `generateImage`/`generateVideo` 加 routing 參數;`generateMusic`→`generateAudio`),2 個(`audio.composeTrack`/`video.composeFinal`)**目前無任何執行路徑,必須等軌E compose 服務**,不在第一刀範圍內。
2. **args 欄位轉譯**:camelCase→snake_case,`durationSec`→`duration`,`loraIds`(id 陣列)→`lora_url`/`lora_scale`(需要額外查 `fine_tuned_models` 表把 id 換成 URL)。
3. **依賴解析**:要嘛把 plan 的 `sourceFrameStepId` 轉寫成 `resolveStepRefsInArgs` 認得的 `${stepId.field}` 樣板再塞進正確 key、重用該 helper;要嘛 runner 自己維護一個「已完成步驟 → 輸出 URL」的 map 手動代換——兩條路都是新代碼,不是零成本重用。
4. **狀態回寫**:`updateJob`/`updateSessionStatus`(`worldStoryboard.ts:314,353`)確實現成可回寫,這部分 M1 的描述準確。

### 選項

- **選項 A(建議,對齊 M1 §5.1 但範圍更誠實):第一個里程碑只做「單幕、只有 t2i、`skipRefine=true`+`skipVideo=true`」。** 這樣 plan 只會產生 `studio.generateImage` 步驟(唯一一個「tool 名 + args 命名」都不需要轉譯 dependsOn 的情況,只需處理 camelCase→snake_case),可以最快證明「runner 讀 plan → 呼叫 executeOrbToolCalls → 回填 frame.imageUrl → updateJob 推進狀態」這條線是通的,不需要先解決 compose 服務或 img2img/i2v 的 args 轉譯。之後再擴大到 refine(`imageToImage`)、i2v(`imageToVideo`)。
- **選項 B:一次把 8 種 tool 全部轉譯完,包含 `sourceFrameStepId` 解析與 LoRA id→URL 查表。** 更完整,但 `audio.composeTrack`/`video.composeFinal` 目前無論如何都無法執行(軌E 未動工),做了也是白做,不建議把這兩種 kind 排進第一個 PR。
- **不做的代價**:分鏡管線繼續維持「規劃會過、frame 狀態永遠卡在 queued」的現況(G2 §3.2 已證實),AnimationStudio 的「編排動畫管線」按鈕持續只是估價表,不是可執行的生產力工具。

### 我的建議
選項 A。理由:①先驗證「runner→executeOrbToolCalls→回填→狀態機」整條線在最簡單情境下通,再逐步擴大 tool 轉譯表的覆蓋範圍,符合 M1 §6.7「每個里程碑都要有可展示的端到端 demo」的自我要求;②`audio.composeTrack`/`video.composeFinal` 依賴的軌E compose 服務本身需要一次技術 spike(ffmpeg vs 委外 API,M1 §5.3 已排在長期),不應該讓分鏡管線執行化的第一刀被這個更大的未決依賴卡住。

### 工作量:**M**(前置需先過決策卡 1,否則 executeOrbToolCalls 對非 `studio.` 前綴呼叫全部失敗——不過本卡只用得到 `studio.generateImage`,而它本來就在現有 37 個可達工具內,**技術上不依賴決策卡 1**,但若要擴展到 refine/i2v 階段仍走 `studio.*` 前綴,同樣不依賴卡 1;卡 1 只影響精靈家族工具,與本卡的 `studio.*` 系列工具無關,這點需訂正 M0 §4「唯一硬前置」對本卡並不完全成立)
- 新檔 `server/services/storyboardPipelineRunner.ts`:讀 plan → tool 名/args 轉譯(第一刀只需 `studio.generateImage` 一種)→ 呼又 `executeOrbToolCalls` → 回填 `frame.imageUrl` → 呼叫 `updateJob`/`updateSessionStatus`
- `worldStoryboard.ts` 新增 `runPipeline` mutation
- `client/src/shells/video/canvas/AnimationStudio.tsx`(:5851-5860 按鈕區)加「開始執行」按鈕
- 測試:runner 端到端測試(讀固定 plan、呼叫 runner、斷言 frame 狀態變化),對齊 G3/M1 「不 mock 執行器」的既有教訓

### 解鎖什麼
「腳本→分鏡→每一幕」本質定義裡「分鏡→每一幕」這段橋,首次讓 AnimationStudio 的管線從「估價表」變成「真的能按下去跑」。

### 風險
- 中。跨兩個模組(`shared/worldbuilding-animation.ts` 的 plan 格式 + `agentToolExecutor.ts` 的 executor 格式)手動維護一份轉譯表,未來任一邊改動欄位命名,轉譯表要同步更新——建議轉譯表獨立成一個小函式(如 `mapPipelineStepToToolCall`),集中維護、附單元測試鎖住兩邊格式的假設。
- LoRA id→URL 查表若第一刀不做(選項 A 範圍不含 refine/img2img,天然不需要 LoRA),風險延後到第二刀處理。

### 需要 Bruce 拍板的點
1. 是否同意第一個里程碑縮小到「只有 t2i、無 refine、無 i2v」(比 M1 原文件描述的範圍更小,但更快看到端到端 demo)?
2. `audio.composeTrack`/`video.composeFinal` 這兩種 plan 產出的 step kind,在 compose 服務(軌E)完工前,runner 要怎麼處理——直接跳過不執行(標記 `skipped`)、還是整個 storyboard 只要含這兩種 kind 就先不給按「開始執行」?建議前者(跳過+標記,讓已完成的 t2i/refine/i2v 步驟先落地,不因為缺 compose 卡住整個 plan)。

---

## 決策卡 4:projectId 接上 ai.chat / director.chat(M2 Phase 1)

### 決策點
「把 `projectId` 接進 AI 聊天」這件事,`ai.chat` 與 `director.chat` 是兩個現況完全不同的起點,要分開拍板。

### 現況實據(本輪最大的意外發現:client 端其實已經在傳 `projectId`,只是 `ai.chat` 沒讀)

#### `director.chat`——比 M1/M2 描述的更接近完工

`server/routers/director.ts:221-258`:input schema **已經有** `projectId: z.number().int().positive().nullable().optional()`(`:241`,AIDV-152),handler 內 `isDirectorWorldContextEnabled()`(`:150-155`,讀 `process.env.ENABLE_DIRECTOR_WORLD_CONTEXT`)+ `loadProjectWorldContext(userId, projectId)`(`:180-215`,best-effort:查 `creative_projects`→擁有權比對→查 `worldbuilding_frameworks`→擁有權比對→`summarizeFrameworkForPrompt` 摘要,任何一步失敗都吞錯不影響 chat)**已完整實作**,唯一缺的是①旗標開、②呼叫端傳值。

呼叫端現況(逐一核對):
- `client/src/spine/ProjectSpineProvider.tsx:493`——**已經在傳** `projectId: p ? Number(p.id) || null : null`,這條路徑(/video 座艙)**功能上已經打通**,只差旗標開關。
- `client/src/pages/DirectorAI.tsx:3406`(獨立 /director 頁面自己的 `chatMutation.mutate`)——**完全沒有傳 `projectId`**,這個呼叫點需要補一行(對照 ProjectSpineProvider 的寫法,取當前 active project id 塞入)。

**M2 §4.2「前端補上 projectId(I §2.1 已標注『一行』規模)」的說法對 `director.chat` 是準確的**——但要分清楚是「哪一個呼叫點」的一行:/video 座艙已經做了,/director 獨立頁還沒做。

#### `ai.chat`(全站光球主聊天)——現況比 M2 描述複雜,已有一條「山寨版」平行機制

`server/routers/ai.ts:434-535` 的 `chat` procedure input schema **沒有專屬 `projectId` 欄位**,但 `pageSnapshot.state`(`:448-474` 定義為 `z.record(z.string(), z.unknown()).optional()`,任意欄位都能塞)**client 端已經在裡面塞了 `currentCreativeProjectId`**——`client/src/contexts/GlobalOrbChatContext.tsx:4979-4989`:
```ts
...(worldContext.currentProjectId !== null
  ? {
      currentCreativeProjectId: worldContext.currentProjectId,
      currentWorldFrameworkId: worldContext.worldFrameworkId,
      currentWorldFrameworkName: worldContext.currentProject?.worldFrameworkName ?? null,
    }
  : {}),
```
但 server 端 `ai.ts:1185-1238` 的「全站光球世界觀感知」區塊**只解構 `snapshotState?.currentWorldFrameworkId`(`:1193`),從未讀取已經送到的 `currentCreativeProjectId`**——這是一個「傳輸層已通、消費端沒接」的具體斷點,比 M2 描述的「前端沒傳」更精確:**前端有傳,是 server 沒讀**。

且這段「世界觀感知」邏輯是**手刻的**:直接 `db.getWorldbuildingFramework(worldFrameworkId)` 查框架、手動組 `charSummary`/`sceneSummary` 字串塞進 `mergedPromptContext`(`:1240-1248`)→ `buildOrbSystemPrompt`(`:1252`)——**完全不經過 M2 §3.1 指名要重用的 `contextPacketService`/`sanitizeContextPacketField`**,也就是說這段既有邏輯**沒有** AIDV-303 的 `sourceRefs`/`lineage`/注入中和保護,只是一段裸字串拼接。

**`contextPacketService.compileProjectContextPacket`**(`server/subsystems/contextPackets/contextPacketService.ts:224-301`)簽章需要 `{ userId, projectId, mode, query?, forceRefresh? }`,內部會:擁有權檢查(`:227`)→ 查 TTL 快取(`:229-236`,`PACKET_TTL_MS = 30分鐘`,`:36`)→ 若過期則跑「啟用中的 adapters」全部 fan-out(`:242-270`)→ 附加 lineage(`:273`)→ `sanitizeUntrustedRefs`(`:278`)→ **寫入一筆新的 DB row**(`:284-294`,`db.createContextPacket`)。**這是一個會寫 DB、且快取未命中時會扇出多個 adapter 呼叫的重量級函式**,M2 文件沒有提到把它接進 `ai.chat` 熱路徑(每次對話都可能觸發)的延遲/DB 寫入成本——這是本卡新增的操作面考量。

### 選項

**A. `director.chat` 先行**:只開 `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標(先灰度內部帳號)+ 補 `DirectorAI.tsx:3406` 一行 `projectId` 傳遞。工作量最小,`/video` 座艙路徑立即生效。

**B. `ai.chat` 走「最小修補」路線**:server 端 `ai.ts:1193` 附近新增讀取 `snapshotState?.currentCreativeProjectId`,若有值就額外呼叫 `projectContextService`(輕量摘要,非 `contextPacketService`)或擴充現有手刻的 `worldContextBlock` 邏輯(補讀 project 名稱/近期素材,不只世界觀)。**優點**:改動小、不引入新的 DB 寫入路徑。**缺點**:延續「沒有 sourceRefs/sanitize」的裸字串拼接模式,M2 §6.1 對齊門第 3 問(「只用專案已知實體」)日後若要做機械檢查,這條路徑生成的摘要沒有 `sourceRefs` 可查,會需要之後再補一次。

**C. `ai.chat` 走「正規」路線,如 M2 §4.2 原意**:呼叫 `contextPacketService.compileProjectContextPacket`,取代整個 `worldContextBlock` 手刻邏輯。**優點**:對齊 AIDV-303 的 sanitize/lineage,未來對齊門第 3 問可以直接查 `sourceRefs`。**缺點**:引入「聊天請求路徑上可能觸發 DB 寫入 + adapter fan-out」的延遲風險,30 分鐘 TTL 內重複對話沒事,但 TTL 過期後第一次對話會變慢;需要先確認 P95 延遲可接受,建議先用 `getLatestProjectPacket`(唯讀,`:307`起,不觸發 adapter fan-out)取代熱路徑上的 `compileProjectContextPacket`,把「整理上下文」的重動作留在使用者主動觸發的 `/create` 頁面按鈕,聊天路徑只讀最近一次已算好的 packet。

**不做的代價**:`ai.chat`(全站最大流量的入口,15 精靈都經過這裡)繼續看不到 `creativeProjectId`,M2 整個「AI 讀單一專案上下文」能力對「主聊天」這個最大入口仍是空的,只有 `director.chat`(次要入口)受益。

### 我的建議
`director.chat` 走選項 A(工作量小、現成邏輯完整,建議本波直接做)。`ai.chat` 建議選項 B 起步(最小修補,先把已經在傳輸層存在的 `currentCreativeProjectId` 接上,用輕量摘要,不引入新的 DB 寫入路徑到聊天熱路徑),選項 C(正規接 `contextPacketService`)留到 M2 Phase 2/3(屆時對齊門真的需要 `sourceRefs` 機械檢查時再升級,並且要先做「唯讀讀取最新 packet、不在聊天路徑觸發 compile」的延遲防護設計)。

### 工作量
- `director.chat` 選項 A:**S**(旗標開關 + 1 個呼叫點補 1 個欄位,半天)
- `ai.chat` 選項 B:**S/M**(server 端加一段讀取 + 擴充摘要邏輯,約 1-2 天;若要把 `projectContextService.ts` 的 `ProjectContextSummary`——世界觀/風格聖經/團隊摘要/近期素材/未完成任務/預算——完整接進來會偏 M)
- `ai.chat` 選項 C:**M**(需先做延遲防護設計,建議獨立立項,不排本波)

### 解鎖什麼
`director.chat`(選項 A):/video 座艙內導演對話立即能感知世界觀,`/director` 獨立頁補齊後也能。
`ai.chat`(選項 B):全站最大流量的光球主聊天首次能感知「目前是哪個專案」,是 M2 Phase 2(引導狀態機從 /video 解放)與 Phase 3(對齊門)能接上光球的前提資料源。

### 風險
- `director.chat`:低,旗標預設 OFF、灰度開啟,邏輯已寫好且 best-effort 吞錯,符合「零回歸」設計。
- `ai.chat` 選項 B:中低——延伸手刻邏輯而非導向正規 `contextPacketService`,長期會有兩套「專案上下文摘要」邏輯並存(`ai.ts` 手刻版 + `contextPacketService` 正規版)的技術債,需要在 Phase 2/3 收斂時明確排單一遷移點,否則兩套邏輯各自演化會分裂。

### 需要 Bruce 拍板的點
1. `director.chat` 的 `ENABLE_DIRECTOR_WORLD_CONTEXT` 旗標是否本波直接開(哪怕先灰度)?
2. `ai.chat` 走選項 B(快但欠對齊門所需的 sourceRefs)還是直接跳選項 C(對齊 M2 長期設計但要先做延遲防護)——建議 B,但要 Bruce 確認「先求有、後求對」的排序可接受。
3. 選項 B 若採用,是否同意「手刻摘要邏輯與 `contextPacketService` 並存」是本波可接受的技術債(需要在後續 Phase 明確排收斂)?

---

## 未查證部分(誠實列出)

- 決策卡 1:63 筆新增 registry 的 `allowedArgsSchema` 具體欄位定義,本輪只抽查 `securityGuard.*` 四個工具的執行邏輯確認無破壞性動作,未逐一核對其餘家族(orchestrator/videoSpecialist/voiceSpecialist/learningSpecialist/legalAdvisor/communityManager/onboardingCoach/companion)每個工具的內部實作細節,僅以「風格與已註冊家族一致」推論低風險,建議 PR review 時逐一過目。
- 決策卡 2:未實際起併發/重試請求量測「客戶端超時重試整個 mutation」情境下選項 A vs B 的實際差異,只以程式碼路徑推理。
- 決策卡 3:`resolveStepRefsInArgs` 是否能直接無修改地重用於 `storyboardPipelineRunner`(而非只是「概念上可借用其設計」),需要實作時寫一份小型 spike 驗證;`fine_tuned_models` 表的 LoRA id→URL 查表邏輯本輪未讀,只確認需求存在。
- 決策卡 4:`ai.chat` 選項 B/C 的實際 P95 延遲影響未實測(`compileProjectContextPacket` 的 adapter fan-out 耗時未量測);`getLatestProjectPacket` 是否真的完全不觸發任何 adapter 呼叫,本輪只讀了函式簽章與開頭幾行,未讀完整函式體確認。
- 四張卡均未估算跨團隊排程(工程師人力/衝刺排期),僅估算單一 PR 的技術工作量。

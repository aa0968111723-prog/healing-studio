# X15 — 北極星③ 自動化工作流引擎(orbWorkflowEngine + orbTaskOrchestrator)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/orbWorkflowEngine.ts(1057)、server/services/orbTaskOrchestrator.ts(1046)

## 0. 範圍與方法聲明

本波單線程逐行全讀兩份檔案(共 2103 行),並為佐證關鍵斷言額外讀取以下依賴檔案(**非本波主要稽核對象,僅作交叉證據**):`server/services/agentToolExecutor.ts`(僅讀取 `executeOrbToolCalls` 開頭派工邏輯 533-830 行、`requiresHuman`/`requireConfirmation` 閘門片段、`workflowEngine.*` dispatch 2760-2800/7007-7140 行,未逐行全讀 8087 行全檔)、`server/services/orbTaskStore.ts`(1-150 行,`get()`/TTL/持久化邏輯)、`server/services/orbTaskStateMachine.ts`(僅 grep 定位 `getOrbAgentTask`/`completeOrbAgentStep`/`failOrbAgentStep` 簽章)、`shared/orb-step-ref-resolver.ts`(全讀,162 行)、`server/services/orbTaskRecoveryPolicy.ts`(全讀,40 行)、`shared/global-agent-tools.ts`(僅讀 1-100 行註冊表片段 + grep `workflowEngine.*`/`requiresHuman`)、`server/services/spiritTools/workflowEngineTools.ts`(全讀,約 220 行)。

**與既有波次的關係**:發現 `docs/research/V2-orb-task-engine-deepdive.md`(commit 7f4417da)與 `docs/research/X2-tool-executor-deepdive.md` 已對這兩份檔案做過部分逐行分析。本文對每條發現皆標註「新發現」或「確認(cite 前波)」,已確認項目只補充本波獨立重讀後驗證的細節,不重複邀功。`docs/research/00-summary.md` 的 R15(orbTask FSM in-memory 重啟即失)亦在本波範圍內重新驗證。

**誠實揭露(可達性)**:本波獨立以 `grep -rn "orbWorkflowEngine" server/routers` 確認 **`server/routers/**` 下無任何檔案直接 import `orbWorkflowEngine`**——目前唯一呼叫鏈是 `server/services/spiritTools/workflowEngineTools.ts` / `workflowAutomationTools.ts` → `server/services/agentToolExecutor.ts:2788-2796`(`workflowEngine.*` case)。X2(H2)已指出這條 `dispatchWorkflowEngineTool` 分支是否會被 LLM 實際呼叫,取決於 `workflowEngine.*` 是否出現在送給模型的 tool schema 清單裡——這點屬於 G3 報告的既有結論範圍,**本波未重新查證 tool schema 清單本身**,故對此按「未在本檔驗證」處理。以下發現的嚴重度評級,是針對**程式碼本身的邏輯缺陷**(只要有任何呼叫端——現有的 spiritTools、或未來新增的管理後台/排程/API——實際觸發,缺陷就會生效),而非對「今天此刻是否已被使用者觸發過」的斷言。

---

## 1. 發現總表(按嚴重度排序)

### 【嚴重 C1 - 新發現】orbWorkflowEngine.ts 四個執行控制/查詢函式完全沒有 userId 擁有權檢查,構成完整跨使用者 IDOR 鏈(讀取 + 控制 + 私人範本列表洩漏)

**發現**

`getExecutionStatus`、`pauseExecution`、`resumeExecution`、`cancelExecution` 四個公開方法的簽章都**只收 `executionId: string`,不收 `userId`**,DB 查詢也只用 `id` 過濾:

```ts
// orbWorkflowEngine.ts:631
async getExecutionStatus(executionId: string): Promise<{...}> {
  ...
  const [executionRow] = await db
    .select()
    .from(orbWorkflowExecutions)
    .where(eq(orbWorkflowExecutions.id, Number(executionId)))   // :642 — 只比對 id
    .limit(1);
```

```ts
// orbWorkflowEngine.ts:705, 728, 758
async pauseExecution(executionId: string): Promise<void> {
  ...
  .where(eq(orbWorkflowExecutions.id, Number(executionId)));    // :713
}
async resumeExecution(executionId: string): Promise<void> {
  ...
  .where(eq(orbWorkflowExecutions.id, Number(executionId)));    // :736
  this.runWorkflow(executionId).catch(...)                       // :740 — 重跑,執行身分沿用 DB 內原 execution.userId
}
async cancelExecution(executionId: string): Promise<void> {
  ...
  .where(eq(orbWorkflowExecutions.id, Number(executionId)));    // :770
}
```

`executionId` 本身是 `String(insertResult.insertId)`(:341)——MySQL 自增 bigint,**可枚舉**(1、2、3...)。對照同檔 `getUserWorkflowHistory`(:853-895)正確地用 `eq(orbWorkflowExecutions.userId, userId)`(:864)過濾——證明開發者知道這個過濾模式,只是在這四個函式漏做,不是「設計上不需要」。

往上一層呼叫鏈同樣沒有補這道檢查:`server/services/spiritTools/workflowEngineTools.ts:149-151`(`getExecutionStatus(executionId)`)、`:194-202`(`controlWorkflow` 的 `pause/resume/cancel`)都是原封不動把 `executionId`/`action` 傳下去,完全沒有比對呼叫者的 `opts.userId` 與該 execution 的擁有者。

再往上一層,`executeWorkflow`(:290-320)本身也只憑 `input.templateId` 讀模板,**不檢查 `template.isPublic || template.creatorUserId === input.userId`**:

```ts
// orbWorkflowEngine.ts:295-303
const [template] = await db
  .select()
  .from(orbWorkflowTemplates)
  .where(eq(orbWorkflowTemplates.id, input.templateId))
  .limit(1);
if (!template) { throw new Error(`Template ${input.templateId} not found`); }
```

且 `getTemplates`(:201-285)僅在呼叫端**主動**帶 `isPublic: true` 時才加篩選(:225-227 `if (typeof options?.isPublic === "boolean")`);若呼叫端(如 `workflowEngineTools.getWorkflowTemplates`,轉發 LLM tool-call 的 `args.isPublic`,未強制預設值)沒帶這個參數,`getTemplates()` **回傳全站所有使用者的範本**,不分公開/私人、不分建立者。

**組合成的完整攻擊鏈**:①呼叫 `getTemplates()`(不帶 isPublic)→ 看到其他使用者的私人範本 `id`/`name`/`description`/`tags`;②呼叫 `executeWorkflow({templateId: 該私人範本id, userId: 自己})`→ 系統接受並開始執行,用**執行者自己的** `userId` 記錄執行,但實際跑的是**範本作者**設計的 `steps`(含其 prompt/工具選擇);③呼叫 `getExecutionStatus(自己剛拿到的 executionId)`→ 步驟紀錄裡的 `inputs`(即 `step.parameters`,:494 `inputs: step.parameters`)和 `outputs` 完整回傳,等同讀出範本作者當初設計的精確 prompt/參數與生成結果——private 範本的「配方」被完整還原。

**影響**:cluster: security-idor。任何使用者可以讀取、暫停、恢復、取消任何其他使用者的工作流程執行(control-plane 層級的越權操作),並可完整竊取其他使用者未公開範本的內容與產出。嚴重度定為「嚴重」是因為即使目前(依 0 節說明)僅有一條可能休眠的呼叫鏈,程式碼本身**零防禦**——沒有任何一層做了擁有權檢查。

**建議**:四個函式簽章加上 `userId: number` 參數,查詢一律加 `and(eq(...id, ...), eq(...userId, userId))`,無 match 回傳「not found」而非洩漏「exists but forbidden」;`executeWorkflow` 加上 `template.isPublic || template.creatorUserId === input.userId` 檢查;`getTemplates` 在沒有明確 `creatorUserId`/`isPublic` 篩選時,預設只回傳 `isPublic = true` 的範本(呼叫端要看見自己的私人範本必須顯式帶 `creatorUserId`)。

---

### 【嚴重 C2 - 確認 + 補充】runWorkflow 對每一步工具呼叫硬編碼 `approved: true`,徹底繞過 `requiresHuman` 核准閘門

**已知**:`docs/research/X2-tool-executor-deepdive.md` §H2 已載此發現(標記「目前休眠」)。本波獨立重讀後確認程式碼現狀與 X2 描述一致,並補上以下兩點新證據:

**發現**

```ts
// orbWorkflowEngine.ts:522-538
while (retryCount <= maxRetries && !stepSuccess) {
  try {
    if (!step.toolName) { throw new Error(`Step ${i} has no toolName`); }
    if (!isKnownGlobalAgentTool(step.toolName)) { throw new Error(`Unknown tool: ${step.toolName}`); }
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [{ name: step.toolName, args: resolvedArgs as Record<string, unknown> | undefined }],
      userId: execution.userId,
      userRole: "user",
      approved: true,                 // ← 對任何 step.toolName 都恆真
      taskId: executionId,
      stepId: step.stepId,
    });
```

`isKnownGlobalAgentTool` 只驗證工具名稱存在於 `GLOBAL_AGENT_TOOL_REGISTRY`(`shared/global-agent-tools.ts:15-…`),**不判斷風險等級**。本波新查證:該登錄表裡 `studio.generateImage` 明確標 `requiresHuman: true`(`shared/global-agent-tools.ts:83`),而 `agentToolExecutor.ts` 內至少 3 處(:1001、:7554、:7785)有 `if (def.requiresHuman && !opts.approved) { return 拒絕 }` 這道閘門——`orbWorkflowEngine.ts` 傳入的 `approved: true` 讓這道閘門對**每一個**步驟都形同虛設。

第二點新證據:本波對 `agentToolExecutor.ts` 全檔(8087 行)grep `credit|charge|billing|deduct|balance|cost`,**沒有找到任何點數/餘額扣款或額度檢查程式碼**(唯一相關命中是與計費無關的 `budgetPoints` 參數轉發、`assertAllowedEndpoint` 等),`orbWorkflowEngine.ts`/`orbTaskOrchestrator.ts` 兩份稽核檔案本身也是同樣結果。也就是說,不只是「人工核准」被繞過,**逐步計費/額度檢查機制本檔案範圍內完全不存在**——若成本控管確實只靠 `requiresHuman` 這道閘門把關(本波未查證是否在更上層,例如 router 進入點,有另一道與 orbWorkflowEngine 完全無關的餘額檢查),則 C2 等於同時繞過了唯一可考的人工核准與唯一可考的成本控管。

**影響**:cluster: billing。一旦此路徑變為可達(X2 提醒的「修 gate 即引爆」情境,或任何新增的直接呼叫端),`orbWorkflowEngine` 可以在**零人工確認、零額度檢查**下對任意數量步驟連續呼叫 `studio.generateImage`/`generateVideo`/`trainLora` 等成本工具。

**建議**:同 X2 建議——把 `approved: true` 改成依 `getGlobalAgentTool(step.toolName)?.requiresHuman` 動態判斷,並比照 `orbTaskOrchestrator.ts` 已有的 `stepApprovals`(TTL 檢查,見下方「已驗證排除的疑慮」)補上真正的核准流程,而不是整批硬編碼放行。

---

### 【高 H1 - 新發現】createTemplate 對步驟數量、`maxRetries` 都沒有上限驗證,搭配 C2 可無上限觸發付費呼叫

**發現**

```ts
// orbWorkflowEngine.ts:124-136
async createTemplate(input: CreateTemplateInput): Promise<WorkflowTemplate> {
  try {
    if (!input.steps || input.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }
    for (const step of input.steps) {
      if (!step.stepId || !step.spiritId || !step.toolName) {
        throw new Error("Each step must have stepId, spiritId, and toolName");
      }
    }
```

驗證只檢查「至少 1 步」與「三個必填字串存在」——沒有步驟數上限、沒有對 `step.conditions.maxRetries`(`runWorkflow` 直接讀取,:480 `const maxRetries = step.conditions?.maxRetries ?? 0;`)做任何範圍檢查、也沒有在建立時驗證 `step.toolName` 是否真的是可執行工具(那要等到 `runWorkflow` 執行時才用 `isKnownGlobalAgentTool` 檢查,:527)。

**影響**:cluster: billing。任何呼叫 `createWorkflowTemplate`(`workflowEngineTools.ts:13-46`/`workflowAutomationTools.ts`)的使用者都能建立一個含數百步 `studio.generateImage`、每步 `maxRetries` 設超高值的範本,搭配 C2 的 `approved: true`,`executeWorkflow` 之後就是一段**無人值守、無節流**的付費呼叫序列。

**建議**:`createTemplate` 加上步驟數上限(例如 20-50)與 `maxRetries` 上限(例如 3),超出直接拒絕建立;比照 `orbTaskOrchestrator.ts` 的 `stepRetryBudget` 硬夾在 `Math.min(2, Math.max(0, ...))`(:285)做法。

---

### 【高 H2 - 確認 + 補充】暫停/取消偵測只在 for 迴圈最外層做,重試 while 迴圈內部無感知;`maxRetries` 無上限時取消可能要等指數退避跑完才生效

**已知**:V2 §3.1(pause/cancel 終端寫入無條件覆蓋)、§3.3(無殭屍偵測)、§3.4(`retryOn` 死欄位)已分別描述本函式的三個面向。本波把三者串起來指出一個 V2 未點出的**交互作用**:

**發現**

```ts
// orbWorkflowEngine.ts:436-449 — 只在「每一步開始前」查一次狀態
for (let i = execution.currentStepIndex; i < steps.length; i++) {
  const step = steps[i];
  const [currentExecution] = await db.select()...
  if (currentExecution.status === "paused" || currentExecution.status === "cancelled") {
    return;
  }
  ...
  // :522-556 重試 while 迴圈——這中間完全不會再檢查 paused/cancelled
  while (retryCount <= maxRetries && !stepSuccess) {
    try { ... }
    catch (error) {
      retryCount++;
      if (retryCount > maxRetries) break;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));  // :554
    }
  }
```

因為 `retryOn` 死欄位(V2 3.4 已載)且 `maxRetries` 沒有上限(H1),一個範本作者可以設 `maxRetries: 20`——此時單一步驟的重試迴圈最壞情況要跑 `2^20` 秒(約 12 天)的累計退避才會結束並進入下一次「是否已取消」檢查。使用者在這期間呼叫 `cancelExecution`(:758-780)只會把 DB 的 `status` 改成 `"cancelled"`,但 `runWorkflow` 完全不知情,持續在原本的 while 迴圈裡對外部付費 API 做重試——且 V2 §3.1 已指出:重試結束後不論成功或失敗,外層 `catch`(:607-625)或成功路徑(:589-601)都會**無條件覆蓋**掉使用者已下的 `"cancelled"` 狀態。

**影響**:cluster: billing。取消操作在高 `maxRetries` 場景下形同虛設,且最終執行紀錄不會反映使用者的取消意圖。

**建議**:重試 while 迴圈內部(至少在每次 sleep 前後)也應重新查一次 execution 狀態;`maxRetries` 加上限(見 H1);cancel/pause 應該用單調的「使用者最後動作時間戳」機制,終態寫入前先檢查目前狀態是否已被使用者手動改為 cancelled,若是則不覆寫。

---

### 【高 H3 - 確認】`resumeExecution`/`executeWorkflow` 對同一 `executionId` 沒有任何並發鎖,可能雙重執行、雙重扣點

**已知**:V2 §3.2 已完整記載此發現(含與 `orbTaskOrchestrator` 側 `orbAutoDriverInFlight` 防重入機制的對比)。本波獨立重讀 `executeWorkflow`(:290-388,fire-and-forget 呼叫 `this.runWorkflow(execution.id).catch(...)`,:372-377)與 `resumeExecution`(:728-753,同樣 fire-and-forget 再呼叫一次,:740)後確認程式碼現狀與 V2 描述完全一致——**沒有找到任何 in-memory Set / DB 樂觀鎖 / advisory lock** 能阻止同一 `executionId` 被兩個 `runWorkflow` 迴圈同時驅動。

**影響**:cluster: persistence。使用者連點兩次「恢復」或前端重複送出請求,會造成同一步驟被重複執行、重複計費,且 `currentStepIndex` 的更新順序不保證,可能導致步驟被跳過或步驟紀錄重複。結合 C1(任何人都能呼叫別人的 `resumeExecution`),這個並發缺陷甚至可以被**非擁有者**觸發在受害者的執行上。

**建議**:同 V2 建議——比照 `_aiHelpers.ts` 的 `orbAutoDriverInFlight`(TTL in-memory Map)在 `orbWorkflowEngine` 內部加一個等效的「此 executionId 是否已有迴圈在跑」guard。

---

### 【高 H4 - 新發現】orbWorkflowEngine.ts 沒有「未解析步驟參照」防護,壞掉的 `${step.path}` 佔位符會原樣送進外部付費 API

**發現**

`orbTaskOrchestrator.ts` 在真正派工前,明確地檢查 `resolveStepRefsInArgs` 之後是否還殘留 `${...}` 佔位符,若有就直接判該步驟失敗、不派工:

```ts
// orbTaskOrchestrator.ts:265-283
const unresolvedToolResults: OrbToolCallResult[] = [];
for (const call of calls) {
  const refs = collectUnresolvedStepRefs(call.args);
  if (refs.length > 0) {
    unresolvedToolResults.push({ name: call.name, ok: false, error: `unresolved-step-ref:${refs.slice(0, 4).join(",")}` });
  }
}
if (unresolvedToolResults.length > 0) {
  return { attempted: true, toolResults: unresolvedToolResults, ok: false, blockedByApproval: false };
}
```

`orbWorkflowEngine.ts` 呼叫**同一個** `resolveStepRefsInArgs`(:517-520)解析 `${stepId.path}` 參照,但本波對全檔 grep `collectUnresolvedStepRefs|unresolved`,**零匹配**——`runWorkflow` 解析完 `resolvedArgs` 後直接送進 `executeOrbToolCalls`(:530),完全不檢查是否還有殘留佔位符。若某步驟參照了一個尚未產出對應欄位的前置步驟(前置步驟失敗、或欄位名稱寫錯),字面字串 `"${step3.video_url}"` 會被原封不動當成 prompt/URL 參數送給 fal.ai/Suno 等外部服務。

**影響**:cluster: injection(也是 billing:浪費真實付費呼叫在必然失敗的請求上,且每次重試——見 H2——都會重複發生)。兩個「共用同一份解析器」的引擎,一個做了防護、一個完全沒做,是可驗證的實作落差。

**建議**:在 `runWorkflow` 呼叫 `executeOrbToolCalls`(:530)前比照 `orbTaskOrchestrator.ts:265-283` 加上同樣的 `collectUnresolvedStepRefs` 檢查。

---

### 【中 M1 - 新發現】`ExecuteWorkflowInput.inputs` 驗證、持久化,但從未真正注入步驟參數解析——執行時提供的輸入對實際跑的步驟沒有任何作用

**發現**

`executeWorkflow` 驗證使用者傳入的 `inputs` 是否滿足 `inputSchema` 的必填欄位:

```ts
// orbWorkflowEngine.ts:307-320
if (template.inputSchema) {
  const schema = typeof template.inputSchema === "string" ? JSON.parse(template.inputSchema) : template.inputSchema;
  if (input.inputs) {
    for (const key of Object.keys(schema)) {
      if (schema[key].required && !(key in input.inputs)) {
        throw new Error(`Missing required input: ${key}`);
      }
    }
  }
}
```

並把 `input.inputs` 存進 DB(:331 建立時、:358 回傳物件)。但真正執行步驟時,唯一會被送進 `resolveStepRefsInArgs` 的資料來源是**先前步驟的輸出**,不含 `execution.inputs`:

```ts
// orbWorkflowEngine.ts:512-520
const priorResults = Object.entries(outputs).map(([stepId, data]) => ({
  stepId,
  toolResults: [{ ok: true, data: data as unknown }],
}));
const resolvedArgs = step.parameters && Object.keys(step.parameters).length > 0
  ? (resolveStepRefsInArgs({ args: step.parameters, perStepToolResults: priorResults }) ?? step.parameters)
  : step.parameters;
```

`outputs`(:429)是本次執行過程中累積的**步驟輸出**物件,從未被 `execution.inputs` 初始化或合併。本波交叉讀 `shared/orb-step-ref-resolver.ts`(全讀)確認解析器本身也沒有任何「`input.` 前綴保留字」的特殊處理——它只認得 `perStepToolResults` 裡出現過的 `stepId`。也就是說,`inputSchema`/`inputs` 這一整套「執行前參數化」的契約,**只做了輸入驗證與紀錄,實際執行時完全是死的**——同一個範本不論呼叫者在 `executeWorkflow` 傳入什麼 `inputs`,產生的每一步工具呼叫參數(`step.parameters`,建立範本時就固定寫死)都完全相同。

**影響**:cluster: deadcode / northstar gap。「自動化工作流」作為北極星③ 的核心賣點之一應該是「同一份範本,不同輸入,產出不同結果」,但目前的實作讓範本的可重用性形同虛設——使用者以為自己輸入的參數會被使用,實際上被靜默忽略。

**建議**:在建立 `priorResults`(:513)之前,先把 `execution.inputs` 以一個保留字(例如 `"input"`)注入同一個 map,讓範本步驟可以寫 `"${input.topic}"` 之類的參照;或至少在文件/UI 上明確告知「執行輸入目前不影響步驟參數」避免誤導範本作者與使用者。

---

### 【中 M2 - 新發現】`orbTaskOrchestrator.ts` 的 `hashPayload` 對 `JSON.stringify` 沒有 try/catch,不可序列化資料會讓步驟收尾邏輯提前拋例外

**發現**

```ts
// orbTaskOrchestrator.ts:487-489
function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}
```

用於逐步觀測記錄(:816-831,在 `store.reportStep`/FSM 收尾**之前**執行):

```ts
// orbTaskOrchestrator.ts:821-830
console.info("[orb.tool_call]", {
  ...
  inputHash: hashPayload(step.toolCalls.find(c => c.name === r.name)?.args ?? null),
  outputHash: hashPayload(r.data ?? r.error ?? null),
  ...
});
```

`JSON.stringify` 對 `BigInt` 值會直接 `throw TypeError`(標準行為),且不會被上層任何 `try/catch` 包住。本倉庫在多處使用 bigint 自增 id(本次稽核的 `orbWorkflowEngine.ts` 本身就有 `Number(result.insertId)`/`String(insertResult.insertId)` 這類轉換的存在,證明底層 driver 確實會吐出 bigint 型別),若任何工具的 `data`/`error` 欄位中夾帶一個未轉字串的原始 `BigInt`(例如某個 `db.*` 工具直接回傳 DB 查詢的 id 欄位),`hashPayload` 會在該次迴圈 for-loop(:816)裡拋出未捕捉例外,導致這次 `runOrbTaskToCompletion` 呼叫**在 `store.reportStep`/`completeOrbAgentStep`/`failOrbAgentStep` 都還沒被呼叫之前**就整個中斷——該步驟的工具呼叫(可能已經是一次真實的付費呼叫)執行了,但其成功/失敗都不會被寫回 store/FSM,任務停在原地(`currentStepIndex` 不會前進),使用者看到的進度卡住,且外層若沒有專門 catch 這個例外(本波未追蹤呼叫端 `server/routers/_aiHelpers.ts` 是否有包 try/catch),可能連帶讓上層 promise reject。

**影響**:cluster: persistence / other。這是一個「可觀測性程式碼反而讓核心流程變脆弱」的具體案例——記錄用的 debug log 呼叫不應該有能力中斷主流程。

**建議**:把 `hashPayload` 內部包一層 try/catch(或用 `JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)` 這種 replacer),任何序列化失敗都回傳一個固定的 sentinel hash 而不是往外拋。

---

### 【中 M3 - 確認 + 補充】`classifyOrbStepError` 把 `unresolved-step-ref` 誤歸類為 `selector_not_found`,與既有的「required 裸字優先序」問題同源,一起污染 circuit-breaker

**已知**:`docs/research/V2-orb-task-engine-deepdive.md` §1.4 已指出 `classifyOrbStepError`(`orbTaskRecoveryPolicy.ts:16-23`)裡 `policy_blocked` 正則含裸字 `required`,順序排最前,導致 `validation_error` 分支幾乎打不到,並指出這會污染 `orbTaskOrchestrator.ts:846-848`(分類)與 `:880-889`(circuit-breaker streak)。

**本波補充的細節**:同一張表的第二條規則本身也定義不精確:

```ts
// orbTaskRecoveryPolicy.ts:19
if (/selector|element|not found|unresolved-step-ref/.test(value)) return "selector_not_found";
```

`unresolved-step-ref` 是 `orbTaskOrchestrator.ts:272` 自己產生的錯誤字串前綴(`unresolved-step-ref:${refs...}`),語意是「規劃器引用了一個不存在/尚未產出的前置步驟輸出」——這是一個**資料依賴鏈斷裂**的問題,與 `selector_not_found` 原本要描述的「DOM 選擇器/元素找不到」(對照 `recoveryActionFor` 回傳的 `relocate_selector`,是給**客戶端頁面代理**設計的復原動作,見檔頭註解「client steps drive a React SPA」)語意完全不同。這條規則把兩種完全不相關的失敗模式歸成同一類,`recovery_action` 顯示 `relocate_selector` 對一個「規劃器少寫欄位」的錯誤是誤導性建議,且會跟 V2 §1.4 描述的裸字 `required` 問題一樣污染 `MAX_SAME_ERROR_STREAK`(:577)circuit-breaker 的連續同錯誤計數。

**影響**:cluster: other。屬於既有 V2 §1.4 發現的同一根因、不同觸發字串,建議與該發現一併修復。

**建議**:`unresolved-step-ref` 應該獨立分類(例如新增 `OrbStepErrorCode = "unresolved_dependency"`),對應的 `recoveryActionFor` 回傳類似「等待/重排步驟順序」而非「重新定位選擇器」。

---

### 【中 M4 - 確認】`WorkflowStep.conditions.retryOn` 欄位宣告但從未被讀取

**已知**:V2 §3.4 已載。本波獨立 grep 全檔 `retryOn`,確認**除了型別宣告(:34)外零引用**,`runWorkflow` 重試迴圈(:480, 522-556)只讀 `maxRetries`,不看 `retryOn`——與 V2 描述完全一致。

```ts
// orbWorkflowEngine.ts:32-36
conditions?: {
  skipIf?: string;
  retryOn?: string[];     // 宣告後全檔案零引用
  maxRetries?: number;
};
```

**影響**:cluster: deadcode。範本作者以為可以用 `retryOn` 限定「只有特定錯誤才重試」,實際上任何錯誤只要 `maxRetries > 0` 都會無差別重試到底。

**建議**:實作 `retryOn` 語意(比對 `stepError` 內容是否命中清單內任一字串,不命中則直接跳過剩餘重試判失敗),或從型別定義移除避免誤導。

---

### 【中 M5 - 確認】orbWorkflowEngine 是本次稽核所知三套執行引擎中,唯一沒有殭屍/逾時偵測的一套

**已知**:V2 §3.3 已載(`server/jobs/staleJobChecker.ts` 只掃描 `background_jobs` 表,與 `orb_workflow_executions`/`orb_workflow_step_executions` 零交集)。本波獨立確認 `runWorkflow`(:393-626)對 `executeOrbToolCalls` 呼叫(:530)本身沒有任何 `AbortController`/timeout 包裝,重試迴圈(:522-556)裡的 `setTimeout` 只是重試之間的退避 sleep,不是單次呼叫的逾時保護。

**影響**:cluster: persistence。若某步驟的外部工具呼叫卡住不回應,該 execution 會永久停在 `status="running"`,沒有任何自動化機制發現或清理——這與 R15 描述的「重啟即失」是互補的兩種失效模式(一個是進程重啟丟狀態,一個是進程存活但邏輯卡死不會有人發現)。

**建議**:比照 `server/jobs/staleJobChecker.ts` 的模式,新增一個掃描 `orb_workflow_executions` 表中 `status = 'running'` 且 `updatedAt` 超過閾值的 job。

---

### 【中 M6 - 確認】R15(orbTask 狀態機 in-memory、無 idempotency/quota guard)對本次兩份稽核檔案依然成立

**已知**:`docs/research/00-summary.md` R15:「orbTask FSM in-memory 重啟即失…idempotency/quota guard 預設 OFF」。本波獨立驗證:

- `orbTaskOrchestrator.ts` 依賴的 FSM 狀態存放於 `server/services/orbTaskStateMachine.ts` 的 `const taskStore = new Map<string, OrbAgentTask>();`(本波 grep 確認,純記憶體、無任何持久化寫入痕跡);`getOrbAgentTask`/`completeOrbAgentStep`/`failOrbAgentStep`/`appendOrbAgentTaskAuditEvent` 皆直接讀寫此 Map。
- `orbTaskOrchestrator.ts` 自身的 `recoveryMetrics` 統計(:578 `new Map<string, {...}>()`)同樣是純記憶體,重啟歸零(此為既有 `resetRecoveryMetrics`/`COUNTER_CAP` 註解自承的設計,影響僅限觀測儀表板,非任務正確性,嚴重度低於前項)。
- 本波對 `orbWorkflowEngine.ts`、`orbTaskOrchestrator.ts` 兩檔全文 grep `idempoten|quota`,**零匹配**——確認 R15 提到的「idempotency/quota guard 預設 OFF」在這兩個檔案的範圍內,實際上是「完全不存在」,不只是「預設關閉」。

**影響**:cluster: persistence。redeploy/多 replica 情境下,`orbTaskOrchestrator.ts` 主迴圈依賴的 `store.get()`(legacy `OrbTaskStore`)雖有選擇性檔案持久化(`orbTaskStore.ts:82-111`,僅在建構子傳入 `persistenceFile` 時才寫),但 FSM 側的稽核事件、以及本次稽核兩檔案內外的所有「重複提交是否重複扣點」防護,在程式碼層級都找不到任何 idempotency key/幂等鎖的實作痕跡。

**建議**:與 R15 既有建議一致——FSM 狀態需要走向真正持久化存放(DB 或 Redis),並在工具呼叫入口加上 idempotency key(例如以 `taskId+stepId+attempt` 組成)防止網路重試/使用者雙擊造成的重複扣款。

---

## 2. 已驗證排除的疑慮(negative results)

以下項目在深挖過程中**曾懷疑但實際讀碼後排除**,列出以避免報告只呈現壞消息:

1. **`skipIf` 條件求值不是任意表達式引擎,沒有程式碼注入風險**——`orbWorkflowEngine.ts:453-457` 明確只接受字面量 `"true"`/`"1"`,其餘一律視為「不跳過」(fail-safe),註解自陳「AIDV-779: safe literal-only evaluator」。本波確認實作與註解一致,無 `eval`/`new Function` 等動態求值。

2. **未知工具名稱不會被靜默執行**——`agentToolExecutor.ts:746-753` 對任何不在 `db.*`/`studio.*`/`director.*`/三個具名研究工具前綴、且不在呼叫端傳入的 `tools` 註冊表裡的 `call.name`,一律回傳 `{ok:false, error:"tool-not-found"}`,不會意外派工到非預期程式碼路徑。

3. **`orbTaskOrchestrator.ts` 自身的迭代上限有確實生效的防護,不會無限迴圈燒錢**——`stepRetryBudget` 被硬夾在 `Math.min(2, Math.max(0, input.stepRetryBudget ?? 2))`(:285),`maxIterations` 的動態成長也被 `MAX_DYNAMIC_ITERATIONS = 32` 上限鎖死(:661,replan 成功時每次只 +4,:839-842/934-935)——即使 replan 反覆觸發,迴圈次數仍有硬上限,不會像 `orbWorkflowEngine.ts` 的重試迴圈那樣因使用者可控的 `maxRetries` 無上限失控(見 H1/H2)。

4. **`orbTaskOrchestrator.ts` 的每步核准判斷有正確做 TTL 檢查,沒有重蹈「同意後過期仍生效」的錯**——`stepAlreadyApproved`(:787-792)呼叫 `store.hasUnexpiredStepApproval`,`stepTokenValid`(:793-796)呼叫 `store.isStepApproved`,兩者皆傳入目前時間 `clock()` 比對 `expiresAt`;程式碼內的 F4 修復註解(:217-220)描述的問題(「6 分鐘前同意,5 分鐘後重連仍觸發」)經本波核對程式碼,確認已用 `expiresAt >= now` 正確處理,不是只寫在註解裡的假修復。

5. **circuit-breaker 的「連續同錯」計數邏輯,本波逐行核對後確認與其 F5 修復註解描述一致,不會把間歇性失敗誤判為連續失敗**——`orbTaskOrchestrator.ts:880-888` 從陣列尾端往前找,遇到「成功」或「不同 error_code」就中斷計數,不是先 filter 掉成功步驟再看位置(那樣才會把 33% 間歇性失敗誤算成連續 100% 失敗)。程式碼確實如註解所述正確實作。

6. **`orbTaskOrchestrator.ts` 主迴圈依賴的 `store.get()` 有正確的擁有權檢查,不會重蹈 C1 的 IDOR**——`server/services/orbTaskStore.ts:146` 的 `get(taskId, userId, ...)` 明確 `if (!task || task.userId !== userId) return null;`。與 `orbWorkflowEngine.ts` 的四個函式(C1)相比,`runOrbTaskToCompletion` 的每一輪迭代都會透過 `store.get(input.taskId, input.userId, ...)` 重新拿一次任務(:669),`userId` 不匹配會直接以 `"task-not-found"` 結束——這代表 `orbTaskOrchestrator.ts` 本身的多步驟驅動迴圈**沒有** C1 那種跨使用者存取問題;`getOrbAgentTask(taskId)`(FSM 側,無 userId 參數)雖然本身沒有擁有權檢查,但因為只在 `store.get()` 已驗證擁有權後才被呼叫,實務上不構成獨立可利用的洞。

7. **`executeCurrentStepTools` 的核准判斷不會被「未設定 riskLevel」意外繞過成高風險工具自動放行**——`stepRisk`(:200)在缺欄位時預設為最低風險 `"low"`,而 `explicitlyRequiresApproval`(:206-208)這個獨立閘門仍會檢查工具**登錄表**(而非 LLM 自報的 `riskLevel`)的 `requireConfirmation` 旗標,兩者是 OR 關係(:209-214)——只要工具本身在登錄表標記需要確認,就不會因為某一步驟少寫 `riskLevel` 而被自動放行(本波未逐一查證登錄表對「高成本」工具是否都正確標了 `requireConfirmation`,那部分屬於 agentToolExecutor.ts 內部配置,未在本檔驗證)。

8. **`learnWorkflowFromHistory` 是誠實的未完成 stub,不會偽造假結果**——`orbWorkflowEngine.ts:959-1053` 分析執行歷史找出重複模式(頻率門檻 30%),但函式本身、連同其自身的 log 訊息(:1035-1040)都明確承認「目前只做到模式偵測,產生範本需要對話上下文,尚未實作」,並不論任何輸入都誠實回傳 `null`——沒有偽裝成功或產生誤導性的假範本。屬於北極星③ 的能力缺口(northstar gap),但不是隱藏性的錯誤行為。

---

## 3. 未查證部分(誠實揭露)

1. 「workflowEngine.* 工具是否目前真的出現在送給 LLM 的 function-calling schema 清單裡」——本波只驗證了 `server/routers/**` 無人直接呼叫 `orbWorkflowEngine`,以及 `agentToolExecutor.ts` 內有對應 `case` 分支存在;schema 清單本身(決定 G3/X2 所稱「目前是否可達」)未在本波重新查證,採信 X2 既有結論但明確標註未獨立複驗。
2. `agentToolExecutor.ts` 的 `dispatchStudioTool`/`dispatchDatabaseTool`/`dispatchDirectorTool` 內部針對各別工具是否有獨立的額度/餘額檢查——本波只確認全檔案 grep 找不到 credit/charge/quota 字樣的**通用**扣款邏輯,不排除個別工具(未讀到的數千行)有分散的檢查點。
3. `server/services/orbTaskStore.ts` 除 `get()`/TTL/檔案持久化外的其餘方法(`reportStep`/`approve`/`hasUnexpiredStepApproval` 完整實作)只做了片段讀取,未逐行核對其並發安全性。
4. `shared/global-agent-tools.ts` 僅讀取前 100 行與 grep 特定條目,1850 行全檔的其餘工具風險分級未逐一核對是否合理。

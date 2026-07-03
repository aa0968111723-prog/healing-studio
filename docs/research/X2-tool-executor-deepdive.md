# X2 — agentToolExecutor.ts 執行器本體逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/agentToolExecutor.ts(8087 行)

> 前置聲明:G3(`docs/research/G3-orb-tools-spirits.md`)已逐行證實 `executeOrbToolCalls`(:533)
> 的路由 gate(:706-744)只放行 `research.*` / `db.*` / `studio.*` / `director.*` 五類前綴,
> 導致 `dispatchStudioTool`(:986-2837)內部寫給 22 個精靈命名空間、約 178 個 `<spirit>.<tool>`
> case(:2397-2829)永遠打不到——本檔不重複此發現,只在「這批孤兒 handler 裡面藏著什麼」與
> 「執行器本體(db./studio./連外 connector/授權閘門)自身邏輯是否正確」上往下挖一層。方法:先用
> `grep`/`awk` 掃出全部 case 標籤與函式呼叫關係,建立「誰呼叫誰」的可達性圖,再對可達與不可達
> 兩類分別逐行核對 userId 範圍、額度扣點順序、SSRF allowlist、`requireConfirmation` 閘門是否
> 對所有分支一致生效。所有行號皆為 commit 812f6fdb 當下版本;跨檔佐證另附檔名。

---

## 摘要

執行器本體(`executeOrbToolCalls` + 其六條分支)本身寫得中規中矩:`db.*` 的 `userId` 一律由伺服端
以物件展開順序強制覆寫(:913-917)、連外 connector 的 `endpoint` 完全來自伺服端註冊表而非呼叫參數
(SSRF allowlist 生效)、`x-orb-user-id` header 無法被 `args` 覆寫。但往下挖兩層後找到兩類新問題:

1. **兩處「危險工具的授權閘門」自身有洞**——一是連外 connector 的 `fallbackTools` 降級路徑完全
   跳過 `requireConfirmation` 檢查(只驗證 SSRF allowlist 與角色);二是 `workflowEngine.*` 自動化
   功能在重新呼叫 `executeOrbToolCalls` 執行「工作流程裡的每一步工具」時,把 `approved` **硬編碼
   為 `true`**,徹底繞過 `requiresHuman`/`requireConfirmation`。後者目前因 G3 記錄的 gate 缺口而
   休眠,但屬於「哪天 gate 被修好就立刻引爆」的地雷,必須跟 gate 修法一起處理。
2. G3 已記錄的 178 個孤兒 case 裡,至少有 2 個 handler 的內部邏輯本身就相信 `args.userId`
   而非強制用 `opts.userId` 覆寫——與 `db.*` 系列「一律伺服端覆寫」的既定慣例矛盾。目前一樣休眠,
   但若照 G3 建議的「改用 `isKnownGlobalAgentTool` 放行」修法直接上,會立即變成可讀取任意使用者
   學習進度 / 全站或他人成本資料的 IDOR。
3. `studio.*` 生成工具的「每日生成額度」(`GENERATION_SLOT_TOOLS`)在**內容審核之前**就先扣點,
   且全倉庫找不到任何退還/回滾機制——使用者送出被擋內容或 fal 端失敗一樣燒掉當日額度。
4. 該額度計數器是純記憶體 `Map`,行程重啟即歸零,若未來擴成多副本部署會被進一步繞過。

以下依嚴重度列出完整發現、影響與建議,文末列出本次已查證、可排除的疑慮(negative results)。

---

## High

### H1. 連外 connector 的 `fallbackTools` 降級路徑完全跳過 `requireConfirmation` 授權閘門

**發現(附行號)**

`executeOrbToolCalls`(:533-890)對「主工具」有明確的確認閘門:

```ts
// agentToolExecutor.ts:807-827
if (tool.requireConfirmation && !opts.approved) {
  const fail = { name: call.name, ok: false, error: "confirmation-required" } as const;
  out.push(fail);
  ...
  continue;
}
let result = await executeWithRecovery(tool, call, opts.userId);
if (!result.ok && Array.isArray(tool.fallbackTools) && tool.fallbackTools.length > 0) {
  const fallbackTool = tool.fallbackTools
    .map(name => byName.get(name))
    .find(
      candidate =>
        candidate &&
        (!candidate.allowedRoles ||
          candidate.allowedRoles.length === 0 ||
          candidate.allowedRoles.includes(opts.userRole))
    );
  if (fallbackTool) {
    assertAllowedEndpoint(fallbackTool.endpoint);          // ← 只驗證 SSRF allowlist
    const fallbackResult = await executeWithRecovery(fallbackTool, call, opts.userId); // ← 沒有 requireConfirmation 檢查
    ...
```
(:828-849)

主工具失敗後選用的 `fallbackTool` 只檢查 `assertAllowedEndpoint`(SSRF)與 `allowedRoles`(角色),
**完全沒有再檢查 `fallbackTool.requireConfirmation`**——即使原本呼叫的主工具不需要人工確認
(`requireConfirmation: false`/未設),只要它在 `OrbApiTool.fallbackTools` 裡列了一個
`requireConfirmation: true` 的高風險工具當降級選項,一旦主工具傳回非 2xx,就會直接以 `opts.approved`
未經檢查的狀態執行那個高風險工具。

**影響**

`ORB_TOOL_REGISTRY_JSON`(:359-390 所引用的環境變數,依 G3 記載預設為空)是這條路徑的資料來源;
只要有一天有人設定了「低風險工具 A 的 fallback 是高風險工具 B」這樣的註冊表(架構本身允許、且
沒有任何程式碼阻止這種配置),B 就會在完全沒有使用者確認的情況下被觸發。這是「危險工具授權」
的核心閘門本身有結構性缺口,不是配置錯誤才會出現的邊角案例——只要 fallback 鏈接到高風險工具就
必然發生,屬於程式碼層級的缺陷。本次未取得/未檢視實際的 `ORB_TOOL_REGISTRY_JSON` 內容(環境變數,
不在 repo 內),因此無法斷言目前正式環境是否已有這種配置,但程式碼本身允許此繞過。

**建議**

在 :839 進入 fallback 分支前,補上與主工具一致的 `if (fallbackTool.requireConfirmation && !opts.approved)` 檢查;或更保守地規定 `requireConfirmation: true` 的工具不得出現在任何工具的 `fallbackTools` 清單中(啟動自檢 `runOrbToolExecutorStartupSelfCheck` 順便加驗證)。

- cluster: security-idor

---

### H2. `orbWorkflowEngine` 執行工作流程每一步時對 `executeOrbToolCalls` 硬編碼 `approved: true`,徹底繞過 `requiresHuman` 閘門(目前休眠,屬「修 gate 即引爆」地雷)

**發現(附行號)**

從 `agentToolExecutor.ts` 追蹤 `workflowEngine.executeWorkflow` 這條 case:

```ts
// agentToolExecutor.ts:7070-7091(dispatchWorkflowEngineTool)
case "workflowEngine.executeWorkflow": {
  const templateId = args.templateId as number;
  ...
  const result = await executeWorkflow({
    templateId,
    userId: opts.userId,          // ← 這一層有正確覆寫,無 IDOR
    conversationId: args.conversationId as string | undefined,
    inputs: args.inputs as Record<string, unknown> | undefined,
  });
```

`executeWorkflow`(`server/services/spiritTools/workflowEngineTools.ts:113`)呼叫
`orbWorkflowEngine.executeWorkflow` → 內部 `runWorkflow` 逐步執行工作流程樣板中每一個
`WorkflowStep`(`toolName` + `parameters` 在建立樣板時由 `creatorUserId` 自由填寫,見
`orbWorkflowEngine.ts:27-36` 的 `WorkflowStep` 介面),對每一步重新呼叫本檔案的
`executeOrbToolCalls`:

```ts
// server/services/orbWorkflowEngine.ts:522-538
while (retryCount <= maxRetries && !stepSuccess) {
  try {
    if (!step.toolName) { throw new Error(`Step ${i} has no toolName`); }
    if (!isKnownGlobalAgentTool(step.toolName)) { throw new Error(`Unknown tool: ${step.toolName}`); }
    const results = await executeOrbToolCalls({
      tools: [],
      calls: [{ name: step.toolName, args: resolvedArgs as Record<string, unknown> | undefined }],
      userId: execution.userId,
      userRole: "user",
      approved: true,              // ← 硬編碼,與這一步工具實際的 requiresHuman 無關
      taskId: executionId,
      stepId: step.stepId,
    });
```

`isKnownGlobalAgentTool` 只驗證工具名稱存在於註冊表,不判斷風險等級;`approved: true` 對所有
`step.toolName`(可以是 `studio.trainLora`、`studio.generateVideo` 等 `requiresHuman: true` 的
高成本/高風險工具)一律成立,等於**整條 workflow 自動化功能對「requiresHuman/requireConfirmation」
授權閘門的支援是名存實亡**。

**現況可達性(誠實揭露)**:`orbWorkflowEngine.executeWorkflow` / `createTemplate` 在
`server/` 全樹的呼叫點,只找到 `workflowEngineTools.ts` 與同構的 `workflowAutomationTools.ts`
兩個 spiritTools wrapper,而這兩個 wrapper 本身又只被 `agentToolExecutor.ts:7007`
(`dispatchWorkflowEngineTool`)匯入——也就是 G3 已記載「打不到」的孤兒 case 之一
(`agentToolExecutor.ts:2788-2793`)。本次掃描未找到任何 router(`workflow.ts`、
`agentWorkflowRouter.ts` 均未 import `orbWorkflowEngine`)直接觸發它。**因此本項目前實務上
休眠**,不構成當下可利用的漏洞;但它是貨真價實寫在程式碼裡的授權繞過,一旦 G3 建議的 gate 修法
(改用 `isKnownGlobalAgentTool(call.name)` 放行所有已註冊工具)落地,`workflowEngine.*` 整條
自動化功能會在同一次改動裡瞬間讓每一步工具「無視 requiresHuman、一律視為已核准」執行,且
`WorkflowStep.toolName`/`parameters` 來自建立樣板當時的 `creatorUserId`(樣板可設 `isPublic`)——
若被其他使用者執行,等同讓樣板作者可以在未經該使用者任何確認的情況下,替該使用者觸發任意已註冊
工具(含燒錢的生成工具)。

**建議**

修 G3 gate 之前,必須先把 `orbWorkflowEngine.ts:535` 的 `approved: true` 改成依
`step.toolName` 對應的工具定義(`getGlobalAgentTool(step.toolName).requiresHuman`)動態判斷,
並比照 `orbTaskOrchestrator.ts` 已有的 per-step token 機制(`store.isStepApproved` +
`hasUnexpiredStepApproval`,見 negative results)補上真正的人工核准流程,而不是整批硬編碼放行。

- cluster: security-idor

---

## Medium

### M1. 兩個目前休眠的 dead-code handler 相信 `args.userId` 而非強制覆寫,是「修 gate 即引爆」的 IDOR 地雷

**發現(附行號)**

`db.*` 系列的既定慣例是「一律用 `opts.userId` 覆寫」(見 negative results N1)。但同樣位於
`dispatchStudioTool` 巨型 switch(目前因 G3 記錄的 gate 缺口而不可達)內的兩個 handler 反其道而行:

```ts
// agentToolExecutor.ts:5380-5389(learningSpecialist.getUserLearningProgress)
case "learningSpecialist.getUserLearningProgress": {
  const userId = typeof args.userId === "number" ? args.userId : opts.userId;
  const result = await getUserLearningProgress({ userId });
  ...
}

// agentToolExecutor.ts:5391-5403(learningSpecialist.getNextLearningStep)
case "learningSpecialist.getNextLearningStep": {
  const result = await getNextLearningStep({
    userId: typeof args.userId === "number" ? args.userId : opts.userId,
    ...
  });
```

`getUserLearningProgress`(`server/services/spiritTools/learningSpecialistTools.ts:1134-1204`)
直接用傳入的 `userId` 查 `orbFeatureDiscovery.getUserStats(input.userId)` /
`generateRecommendations(input.userId, 5)`,回傳該使用者的功能使用足跡與熟練度——只要
`args.userId` 是 number,就會覆蓋 `opts.userId`,讀到任意使用者的資料。

另一處是系統監控工具:

```ts
// agentToolExecutor.ts:7194-7208(systemMonitor.getCostAnalysis)
case "systemMonitor.getCostAnalysis": {
  const result = await getCostAnalysis({
    userId: args.userId as number | undefined,   // ← 完全來自 args,無 opts.userId 兜底/覆寫
    startDate: args.startDate as string | undefined,
    endDate: args.endDate as string | undefined,
  });
```

`getCostAnalysis`(`server/services/spiritTools/systemMonitorTools.ts:55-103`)呼叫
`orbSystemMonitor.getCostBreakdown({ userId: input.userId, ... })`,而該函式
(`server/services/orbSystemMonitor.ts:499-538`)只在 `options.userId` 為 truthy 時才加
`eq(orbCostAttribution.userId, options.userId)` 條件——`args.userId` 缺省時完全不過濾,
回傳**全站所有使用者**的成本歸因彙總(`bySpirit`/`byTool` 統計);帶入他人 `userId` 則回傳
該特定使用者的成本明細。此 handler 完全沒有 `opts.userId` 兜底或覆寫。

**現況可達性**:與 H2 相同,`learningSpecialist.getUserLearningProgress`/`getNextLearningStep`/
`systemMonitor.getCostAnalysis` 這幾個 case 名稱不以 `studio.`/`director.` 開頭,目前一樣被
G3 記錄的 gate 缺口擋住,**現況不可達**、不構成當下可利用漏洞。

**影響**

若日後 gate 修法(如 G3 建議的 `isKnownGlobalAgentTool(call.name)`)未同時檢查/修正這兩個
handler,會立即造成:①任何使用者可讀取任意其他使用者的學習進度/功能使用足跡;
②任何使用者可讀取全站成本歸因彙總,或指定他人 `userId` 讀取其個別成本資料。

**建議**

在 gate 修復的同一個 PR 裡,把這兩處改成與 `db.*` 系列一致的「`{ ...args, userId: opts.userId }`
強制覆寫」寫法,而不是「`args.userId` 優先、`opts.userId` 只當兜底」。`systemMonitor.getCostAnalysis`
額外需要決定:是否該限定只有特定角色(如 admin)才能看全站彙總——目前程式碼完全沒有角色檢查。

- cluster: security-idor

---

### M2. 生成工具每日額度在「內容審核」之前就先扣點,且全倉庫無任何退還/回滾機制

**發現(附行號)**

`dispatchStudioTool` 對所有 `studio.*` 呼叫的共通前置流程:

```ts
// agentToolExecutor.ts:1009-1024(額度扣點,先執行)
if (GENERATION_SLOT_TOOLS.has(call.name)) {
  const quota = checkAndConsumeQuota("generation", { userId: opts.userId });
  if (!quota.allowed) {
    return { name: call.name, ok: false, error: quota.reason ?? "generation-quota-exceeded" };
  }
}

const args = (call.args ?? {}) as Record<string, unknown>;

// agentToolExecutor.ts:1028-1045(內容審核,額度扣完之後才做)
for (const key of ["prompt", "text", "script", "lyrics", "negative_prompt"] as const) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) continue;
  const verdict = moderateOrbContent(value);
  if (verdict.action === "block") {
    ...
    return { name: call.name, ok: false, error: `moderation-blocked:${categories || "policy"}` };
  }
}
```

`checkAndConsumeQuota`(`server/services/orbQuota.ts:66-99`)在 `next > limit` 之前就已經
`userDailyCounters.set(counterKey, next)`——也就是說,只要進了這個 if 區塊就一定扣點,不論後面
是被 moderation 擋下、還是 `dispatchFalQueueTask`/`awaitFalForOrb` 之後真正呼叫 fal.ai 失敗
(:1163-1173 等每個 `studio.*` case 都可能回傳 `ok:false, error: awaited.error`)。全倉庫(含
`orbQuota.ts`、`agentToolExecutor.ts`)搜尋 `refund`/`release`/`rollback` 等關鍵字,**找不到
任何地方會把已扣的 `generation` 額度加回去**。

**影響**

使用者的 40 次/日(`DAILY_LIMITS.generation = 40`,`orbQuota.ts:29`)生成額度,會被下列「使用者
沒拿到任何產出」的情境無回饋地燒掉:①prompt/text/script/lyrics/negative_prompt 命中內容審核
被擋;②fal.ai 端逾時/報錯(`awaited.status === "failed"`);③F1/F8 修復邏輯本身也承認的
「completed 但拿不到任何 URL」情境(:161-186,`awaitFalForOrb` 會 fail-safe 轉成 failed,但
一樣不退額度)。對使用者而言等同「被無聲扣了一次生成券卻什麼都沒生成」,且無法申訴或自動補償。

**建議**

至少在 moderation block 的分支(:1037-1044)裡呼叫一個新增的 `releaseQuota("generation", opts.userId)`
把剛剛消耗的 slot 加回去,因為此時根本還沒有任何外部呼叫發生;fal 呼叫真失敗的情境則可依錯誤分類
(可重試 vs 不可重試)決定要不要退,並在 UI 上明確告知使用者「本次未消耗生成次數」。

- cluster: billing

---

### M3. 每日生成額度計數器為純記憶體 `Map`,行程重啟即全站歸零;若未來多副本部署會被進一步繞過

**發現(附行號)**

```ts
// server/services/orbQuota.ts:22-24
const userDailyCounters = new Map<string, number>();
const sessionClicks = new Map<string, number[]>();
const providerRateCounters = new Map<string, number[]>();
```

`checkAndConsumeQuota`(:66-99)完全靠這個行程內記憶體 `Map` 計數,沒有寫回資料庫或任何跨行程
共享儲存(如 Redis)。`agentToolExecutor.ts:1015-1024` 的 `GENERATION_SLOT_TOOLS` 額度檢查
完全依賴這一份計數。

**影響**

①`node dist/index.js` 這個單一行程每次重啟(部署新版本、`railway.toml` 設定的
`restartPolicyMaxRetries = 3` 觸發的當機重啟等)都會讓 `userDailyCounters` 清空——相當於
每次部署都幫全站使用者重置一次當日額度,運維行為間接影響了本應是「每日」的額度政策,且無任何
稽核紀錄可回溯「這次額度重置是部署造成還是使用者本來就沒用滿」。②本次檢視的 `railway.toml`
未見多副本/水平擴展設定,故「同一使用者打到不同副本各自累積額度」這個更嚴重的繞過情境**目前
未在本檔驗證是否會真的發生**——但只要日後改成多副本部署,這個純記憶體設計會直接讓每日上限
變成「上限 × 副本數」,屬設計上的已知隱患,建議在真的要水平擴展前先處理。

**建議**

至少把 `generation` 這個會影響「花費上限」的類別遷移到資料庫或 Redis 等跨行程共享的儲存;
若短期內不擴充多副本,也應在文件/程式碼註解裡明確記錄「此計數器行程重啟會歸零」這個已知取捨,
避免日後有人誤以為它是持久化的每日上限。

- cluster: persistence

---

## 已驗證排除的疑慮(negative results)

以下項目經逐行核對,**未發現**任務指示重點懷疑的漏洞型態,附證據供覆核:

- **N1:`db.*` 工具的 `userId` 一律由伺服端物件展開順序強制覆寫,無法被 `args` 覆蓋。**
  `dispatchDatabaseTool`(:900-969)第 913-917 行:`const params = { ...args, userId: opts.userId };`
  ——`userId` 寫在展開之後,即使 `call.args` 塞了 `userId` 也會被蓋掉。`orbDatabaseTools.ts` 的
  13 個查詢模板(:174-551)全部用 Drizzle `eq(table.userId, userId)` 搭配這個伺服端值,沒有一個
  case 改用其他欄位當作使用者範圍界線。唯一不吃 `userId` 的 `search_prompts`
  (`orbDatabaseTools.ts:522-551`)只查 `promptLibrary.isPublic = true` 的公開資料,設計上本來
  就不分使用者,不構成 IDOR。

- **N2:連外 connector 的 `endpoint` 完全來自伺服端註冊表,`call.args` 無法控制打到哪裡(SSRF
  allowlist 有效生效)。** `executeOrbToolCalls` 對一般工具的 URL 組裝(`executeWithRecovery`,
  :475-531)一律用 `tool.endpoint`(來自 `opts.tools`,即 `getOrbToolRegistry()` 讀
  `ORB_TOOL_REGISTRY_JSON` 建出的靜態清單,見 `server/config/orbToolRegistry.ts`),`call.args`
  只會被組進 query string(GET,:444-453,`URLSearchParams` 正常編碼)或 JSON body(POST),
  完全不會拼進 URL 本身。`assertAllowedEndpoint`(:359-390)對外部呼叫做 origin allowlist,
  正式環境(`NODE_ENV=production`)沒有顯式設定 `ORB_TOOL_ALLOWED_ORIGINS` 就直接
  `PRECONDITION_FAILED` fail-closed(:374-384),不會靜默放行。

- **N3:`x-orb-user-id` header 無法被 `call.args` 覆寫。** `withUserHeaders`(:426-432)把
  `"x-orb-user-id": String(userId)` 放在 `...headers`(來自 `tool.headers`,靜態註冊表)展開
  **之前**,且 `call.args` 從未參與這個 header 物件的組裝,呼叫端無法偽造 `x-orb-user-id`。

- **N4:語音自訂設定(`customBlockId`)查詢已修正過 IDOR,現在有 `userId` 過濾。**
  `studio.generateVoice` 分支(:2264-2277,commit 訊息標記 AIDV-793)：
  `const block = await getCustomBlockById(args.customBlockId, opts.userId);`——查詢時帶入
  `opts.userId`,不是只用 `args.customBlockId` 查任意使用者的自訂語音區塊。

- **N5:`studio.trainLora` 建立的 `fine_tuned_models`/`background_jobs` 一律綁 `opts.userId`。**
  `dispatchTrainingTool`(:7545-7660 一帶)第 7636-7652 行的 `db.createFineTunedModel({ userId:
  opts.userId, ... })`、`db.createBackgroundJob({ userId: opts.userId, ... })` 均未讓
  `args` 覆寫 `userId`。

- **N6:`db.*` 查詢模板沒有字串拼接 SQL 注入面。** 全部透過 Drizzle ORM 的 `eq`/`and`/`like`/`gt`
  建構條件式;唯一的自由文字輸入(`searchQuery`)一律先過 `escapeLikePattern()` 再塞進
  `like(...)` 樣板(`orbDatabaseTools.ts:220`、`300`),沒有裸字串拼接的 `sql\`...\`` 用法。
  本檔(`agentToolExecutor.ts`)全文搜尋 `sql\``、`exec(`、`execSync`、`eval(`、`new Function(`
  均無結果。

- **N7:`agentToolExecutor.ts` 本身不做任何真實金流/點數扣款,不構成本檔內的重複扣款風險。**
  本檔搜尋 `credit`/`coin`/`balance` 等關鍵字,唯一命中的是 ElevenLabs 代理憑證 header
  名稱(:2245)與 `budgetPoints`/`budgetMode` 這類*傳遞給下游*的參數(:4843、7811 等),
  實際扣點邏輯位於 `falDispatcher.ts` 的 `dispatchFalQueueTask`(`pointsDeducted`/
  `pointsBreakdown` 欄位,:70、153-154 等),不在本次稽核範圍內,本檔對它是單純委派、
  未發現在委派前後有重複計費或漏算的邏輯。

- **N8:`orbTaskOrchestrator.ts` 的多步驟 plan-executor 路徑,對 `requireConfirmation` 工具有
  正確的「每步驟 + TTL token」核准機制,不是像 H2 那樣整批硬編碼放行。**
  `orbTaskOrchestrator.ts:774-797`:`stepRequiresApproval` 判斷該步驟工具是否需要確認,
  `store.hasUnexpiredStepApproval(...)` 檢查是否已核准且未過期,`store.isStepApproved(...,
  stepToken, ...)` 驗證呼叫端帶來的核准 token,兩者其一成立才把 `approvedForStep` 設為
  `true` 餵給 `executeCurrentStepTools`(:799-814)。程式碼註解本身也記載了一次修正
  (「F4 修復:原本 `task.approvedStepIds.includes` 完全繞過 TTL」),顯示這條路徑的授權設計
  是經過迭代加固的,值得作為 H2/M1 修復時的參考範本。

---

## 附錄:本檔關鍵函式可達性速查(僅列與本次發現直接相關者)

| 函式/位置 | 呼叫者 | 可達性 |
|---|---|---|
| `dispatchDatabaseTool`(:900) | `executeOrbToolCalls`(:688,`db.*` 前綴) | 可達 |
| `dispatchStudioTool`(:986) 內 `studio.*` case(:1049-2394) | `executeOrbToolCalls`(:727,`studio.` 前綴) | 可達 |
| `dispatchStudioTool` 內 22 個精靈命名空間 case(:2397-2829,含 `learningSpecialist.*`、`systemMonitor.*`) | 僅被 `dispatchStudioTool` 內部 switch 呼叫,而該 switch 只在 `call.name` 以 `studio.`/`director.` 開頭時才會被進入 | **不可達**(G3 已記錄;M1 建立在此基礎上) |
| `executeOrbToolCalls` 一般 connector 分支 + fallback(:746-850) | `ai.executeTools`(routers/ai.ts:3017)、`orbTaskOrchestrator.ts:290`、`orbWorkflowEngine.ts:530`、`planExecutorTools.ts:311` | 可達(H1 位於此分支) |
| `orbWorkflowEngine.runWorkflow`(orbWorkflowEngine.ts:393-630 一帶,硬編碼 approved 於 :535) | `workflowEngineTools.ts:113`/`workflowAutomationTools.ts:117` → 僅被 `agentToolExecutor.ts:7007`(`dispatchWorkflowEngineTool`)匯入,而後者本身屬於上一列「不可達」的 22 個命名空間之一 | **目前不可達**(H2 的「休眠地雷」定性依據) |

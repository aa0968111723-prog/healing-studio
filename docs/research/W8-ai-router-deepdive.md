# W8 — ai.ts 主 AI/光球 router 逐行深挖(逐檔深挖 wave W)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/routers/ai.ts(3366 行)

## 範圍與方法

本檔案全文(1-3366 行)逐行核對,並交叉讀以下依賴檔以驗證「未在 ai.ts 本體但決定 ai.ts 行為」的關鍵函式:`server/services/orbTaskExecutor.ts`、`server/services/falDispatcher.ts`、`server/services/agentToolExecutor.ts`、`server/services/orbCostGuard.ts`、`server/services/orbCodeTask.ts`、`server/services/orbTaskStateMachine.ts`、`server/services/agentPlanner.ts`(僅 `input.context` 相關段落)、`server/services/siteKnowledge.ts`(`serializeSnapshotBlock`)、`server/services/ai-adapters/providers/fal.adapter.ts`、`server/_core/trpc.ts`(`brainProcedure` 定義)、`server/_core/rateLimiter.ts`、`shared/genId.ts`。

**前置文件關係**(不重複其結論,僅標注延伸/確認/深化):
- `docs/research/U2-ai-chat-orchestration-deepdive.md` 已逐行讀完 `ai.chat`(434-2994)本體,本文件**確認**其核心發現(execute_task/execute_generate_image 繞過四道防線、LLM 成本零計入 api_usage_logs)仍在現行 commit 成立,並針對「計費」與「action 安全閘」兩項**往下多追一層**,找到比 U2 更底層的結構性證據。
- `docs/research/U3-fal-dispatch-webhook-deepdive.md` finding #3 已指出 `agentToolExecutor.ts` 的生成工具零扣點,本文件確認 `ai.ts` 內所有可達到該路徑的入口(`executeTools`/`reportTaskStep`/`orbTask.approve`/`orbTask.retry`/`orbTask.resume`/`approveTask`)全數受影響。
- `docs/research/W6-siteknowledge-deepdive.md` 已指出 `input.context`(`pageContext`)繞過 `sanitizeOrbMessages`,本文件在 `ai.ts` 本體內把這條路徑**從 1 條擴充到 4 條**,並新增第二個同類注入面(`pageSnapshot`)。
- `docs/research/W1-director-router-deepdive.md` 已指出 `director.askForStudioPlan` 繞過全站安全閘,本文件在 `ai.ts` 找到**另一個獨立的**閘門繞過案例(`ai.executeTools` 的 `approved` 布林值)。
- 本文件**未重讀** `orbTaskOrchestrator.ts`/`orbTaskChainRunner.ts`/`multiAgentIntegration.ts` 全文(E/U2 已覆蓋),僅在需要確認呼叫鏈終點時做定點交叉查證。

---

## 發現清單(依嚴重度排序)

### 🔴 嚴重 1(新發現,深化 U2/U3):`executeOrbTask`/`executeGenerateImage` 在 ai.chat 內同步呼叫的生成路徑,結構上不可能被計費——不是「漏算」,是函式簽名裡根本沒有 `userId` 這個欄位

**證據鏈**:

1. `ai.ts:2200`(converted 分支)與 `ai.ts:2759`(legacy fallback 分支)呼叫 `executeGenerateImage(String(ctx.user.id), imagePrompt, model)`。此函式定義在 `server/services/orbTaskExecutor.ts:19-49`:
   ```ts
   export async function executeGenerateImage(userId: string, prompt: string, model?: string) {
     ...
     const fal = getAdapter("fal_ai");
     const response = await fal.proxy({ pathWithQuery: modelId, method: "POST", ... });
     ...
   }
   ```
   `fal.proxy`(`server/services/ai-adapters/providers/fal.adapter.ts:10-31`)是對 fal.ai 的**原始 HTTP 透傳**——直接 `fetch` 打 fal.ai API,不經過 `dispatchFalTask`、不呼叫 `estimatePoints`、不呼叫 `deductCredits`/`reconcileCredits`。這條路徑完全在計費機制之外,`userId` 參數只用來塞進一個 `X-Orb-User-Id` header,不參與任何扣點判斷。

2. `ai.ts:2230`(converted 分支)與 `ai.ts:2793`(legacy fallback 分支)呼叫 `executeOrbTask(ctx.user.id, task)`(`orbTaskExecutor.ts:86-132`)。此函式**確實**呼叫 `dispatchImageGeneration`/`dispatchVideoGeneration`/`dispatchAudioGeneration`(`orbTaskExecutor.ts:92-97,101-106,110-113`),但這三個 convenience wrapper 的參數型別(`falDispatcher.ts:727-738,758-767,783-800`)**完全沒有 `userId` 欄位**:
   ```ts
   export async function dispatchImageGeneration(params: {
     modelId: string; prompt: string; negativePrompt?: string;
     imageUrl?: string; seed?: number; numInferenceSteps?: number;
     guidanceScale?: number; imageSize?: string; aspectRatio?: string; strength?: number;
   }): Promise<FalDispatchResult> {
     const category = params.imageUrl ? "image-to-image" : "text-to-image";
     return dispatchFalTask({ modelId: params.modelId, category, prompt: params.prompt, ... }); // 無 userId
   }
   ```
   往下追到真正做計費判斷的 `dispatchFalTask`(`falDispatcher.ts:282-717`),扣點邏輯完全包在:
   ```ts
   if (typeof input.userId === "number") {
     if (typeof input.estimatedCredits === "number") {
       await reconcileCredits(input.userId, input.estimatedCredits, actualCost);
     } else {
       await deductCredits(input.userId, actualCost);
     }
     ...
   }
   ```
   (`falDispatcher.ts:480-504`,重試降級鏈分支同款邏輯見 `:618-624`)。因為 `dispatchImageGeneration`/`dispatchVideoGeneration`/`dispatchAudioGeneration` 從未把 `userId` 放進傳給 `dispatchFalTask` 的物件,`input.userId` 恆為 `undefined`,`typeof input.userId === "number"` 恆為 `false`——**這個 if 區塊在 `executeOrbTask` 這條呼叫鏈上永遠不會執行**,`deductCredits`/`reconcileCredits` 零呼叫,是型別層級就註定的結構性缺口,而非執行期偶發 bug。

3. 交叉確認 `orbCostGuard.ts` 的 `deductCredits`/`reconcileCredits`(全 repo 唯一封裝 `deductUserPoints`/`refundUserPoints` 給 orb 生成路徑使用的函式)只在 `falDispatcher.ts:482,484,620,622` 被呼叫,`grep` 全 repo 確認**沒有任何其他呼叫點**(`server/services/agentToolExecutor.ts` 全文 `deductUserPoints|deductCredits|reconcileCredits|refundUserPoints` 零命中,與 U3 finding #3 一致)。

4. 這條路徑目前是否為死碼取決於 U2 finding #1 已核實的觸發條件(schema-first planner 判 `decision.mode="direct"` 產出 `execute_task`,或 legacy fallback 解析出 `[ACTION:execute_task:...]`/`[ACTION:execute_generate_image:...]` marker)——U2 已確認兩者皆可達,本文件在現行 commit(812f6fdb)重新核對 `ai.ts:2179-2249`/`2742-2809` 兩段程式碼,行號與內容與 U2 記載幾乎一致(僅極小幅漂移),**確認此路徑仍然可達、仍然是生產程式碼**。

**與 U2/U3 的關係**:U2 已指出這條路徑「繞過成本守衛/生成配額/逐欄內容審核/使用者工具黑名單」四層防線;U3 finding #3 已指出 `agentToolExecutor.ts` 的 tasked→approve 路徑同樣零扣點。本發現的新增價值是:**往下多追一層,證明連 tasked→approve 這條「正規」路徑之外的 converted/legacy 捷徑,在型別系統層級就不可能計費**——`dispatchImageGeneration` 等三個函式的參數介面根本沒有留 `userId` 的位置,這比「呼叫時忘記傳」更嚴重,因為即使日後有人想「補上計費」,也要先改函式簽名才行,現狀不是一行漏寫,是整條管線的介面設計就沒有預留計費掛鉤點。

**影響**:凡是使用者透過光球對話觸發、由 `ai.chat` 的 converted 或 legacy fallback 分支直接執行的圖片/影片/音樂生成(不需要使用者按下任何「核准」按鈕,LLM 判定走這條分支即同步執行完畢),100% 不會扣除任何點數/額度——與 `director.ts` 的批次生成鏈(`executeGenerationTask`,W1 已確認完整計費)、`proStudio.ts`(U3 已確認 `chargeForFalTask` 全站 33 處呼叫)形成鮮明對比。

**建議**:
- 短期:在 `dispatchImageGeneration`/`dispatchVideoGeneration`/`dispatchAudioGeneration` 的參數型別加上必填 `userId: number`,並要求 `orbTaskExecutor.ts` 的 `executeOrbTask`/`executeGenerateImage` 呼叫時強制傳入,讓 TypeScript 編譯期就擋掉遺漏。
- 中期:評估是否應該直接移除 converted/legacy 分支的「同步內嵌執行」設計,統一導回 `tasked → approve → orchestrator → agentToolExecutor` 這條唯一有風控/配額掛鉤點的路徑(即使該路徑目前也零扣點,至少介面上有 `userId` 可以掛)。

---

### 🔴 嚴重 2(新發現):`ai.codeTask.approve` / `ai.codeTask.cancel` 完全沒有擁有權檢查,且底層資料模型本身不含 `userId` 欄位——任何登入使用者只要拿到 codeTaskId 就能核准或取消別人的 Claude Code/Codex 修改任務

**證據**:

- `ai.ts:3356-3363`:
  ```ts
  codeTask: router({
    approve: brainProcedure
      .input(z.object({ codeTaskId: z.string().min(1).max(72) }))
      .mutation(({ input }) => approveCodeTask(input.codeTaskId)),
    cancel: brainProcedure
      .input(z.object({ codeTaskId: z.string().min(1).max(72), reason: z.string().max(240).optional() }))
      .mutation(({ input }) => cancelCodeTask(input.codeTaskId, input.reason)),
  }),
  ```
  兩個 mutation 的 handler 完全不讀取 `ctx.user.id`,直接把 client 提供的 `codeTaskId` 傳給服務層函式。
- `server/services/orbCodeTask.ts:130-147`(`approveCodeTask`)、`:168-186`(`cancelCodeTask`):兩者都只用 `codeTaskId` 從 `codeTaskStore`(模組級 `Map<string, OrbCodeTask>`)取出任務、改狀態,**函式簽名裡沒有 `userId` 參數**。往上追 `createOrbCodeTask`(`orbCodeTask.ts:56-118`,`ai.ts:2535` 唯一呼叫點)的輸入型別(`taskId/planId/traceId/provider/repository/baseBranch/title/objective/filesAllowed/filesForbidden/acceptanceCriteria/testCommands/riskLevel/summary/rollbackPlan`)——**整個 `OrbCodeTask` 資料模型從建立那一刻起就沒有 `userId` 欄位**,這不是「檢查漏寫」,是資料模型本身沒有使用者邊界的概念。
- `codeTaskId` 的產生方式:`orbCodeTask.ts:14-16` `function id(prefix) { return genId(prefix); }`,`genId`(`shared/genId.ts:11-13`)的文件開頭明寫:
  ```ts
  /**
   * genId — shared non-cryptographic ID generator.
   * Format: `{prefix}_{ms}_{rand}`
   * ...
   * Use only for trace IDs, task IDs, and similar non-secret identifiers.
   * Do NOT use for secrets, tokens, or security-sensitive values.
   */
  ```
  即产出格式為 `code_task_<毫秒時間戳>_<8碼base36隨機>`——作者自己的文件已聲明「不可用於安全性用途」,但 `ai.codeTask.approve`/`cancel` 目前正是把這個 ID 當成唯一的存取控制邊界在用。

**攻擊面**:`createOrbCodeTask` 只在 `ai.chat` 判定使用者意圖涉及程式碼協作(`codeCapabilityDetected && codeCollabEnabled`,`ai.ts:2505`)時建立,`riskLevel` 可為 `"high"`(:2554),`requiresHuman: true` 恆為真(`orbCodeTask.ts:98`)——代表這是一個**設計上就要求人工核准**才會真的驅動 Claude Code / Codex 去改動程式碼並開 PR 的高風險任務。任何已登入使用者(不需要是該任務的建立者),只要透過時間戳範圍猜測或側錄取得他人的 `codeTaskId`,即可呼叫 `ai.codeTask.approve` 把別人的程式碼修改任務核准掉,或呼叫 `cancel` 惡意終止別人正在等待核准的任務。

**與同檔案其他端點的對比**:`ai.ts:3239-3244` 的 `reportPageState` 端點註解明確寫著(針對 `orbTask.*` 的 FSM taskId,同款 `genId` 格式):
> 「Agent loop v10 — verify caller owns the taskId before accepting the snapshot. Without this a malicious user could pollute another user's task state (taskIds are guessable in shape `orb_task_<ts>_<rand>`)」

也就是說,開發團隊**已經明確意識到並修過**這一類「taskId 可猜測、必須加擁有權檢查」的風險模式(至少 9 個 `orbTask.*` 端點都有對應檢查,見下一條發現),但 `codeTask.approve`/`cancel` 兩個一樣使用 `genId` 格式 ID、一樣是高風險 mutation 的端點,完全沒有套用同一套修法。

**建議**:
1. 在 `OrbCodeTaskSchema`/`createOrbCodeTask` 加上 `userId: number` 欄位(呼叫端 `ai.ts:2535` 已經有 `ctx.user.id` 可用)。
2. `codeTask.approve`/`codeTask.cancel` 比照 `orbTask.approve`/`cancel` 的模式,加上「`task.userId != null && task.userId !== ctx.user.id → NOT_FOUND`」檢查。

---

### 🔴 嚴重 3(新發現):`orbTask.get` / `orbTask.events` / `orbTask.traceDebug` 三個查詢端點沒有擁有權檢查,同一 router 內其餘 7 個寫入端點都有——任何登入使用者可讀到別人完整的任務內容與稽核紀錄

**證據**:

- `ai.ts:3048-3052`:
  ```ts
  get: brainProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(({ input }) => {
      return getOrbAgentTask(input.taskId);
    }),
  ```
- `ai.ts:3224-3228`:
  ```ts
  events: brainProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(({ input }) => {
      return getOrbAgentTaskEvents(input.taskId);
    }),
  ```
- `ai.ts:3342-3353`(`traceDebug`):只檢查 `task` 是否存在(`if (!task) return {...}`),不比對 `task.userId`。
- 對照同一個 `orbTask` router 內其餘全部 7 個會修改狀態的端點:`approve`(:3075-3078)、`cancel`(:3114-3117)、`retry`(:3132-3135)、`pause`(:3193-3196)、`resume`(:3208-3211)、`completeStep`(:3288-3291)、`failStep`(:3303-3306)、`updateStepStatus`(:3329-3332,註解明寫「AIDV-885: ownership check (mirrors sibling completeStep/failStep)」),全都執行:
  ```ts
  const existing = getOrbAgentTask(input.taskId);
  if (existing?.userId != null && existing.userId !== ctx.user.id) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  ```
- `getOrbAgentTask(taskId: string)` / `getOrbAgentTaskEvents(taskId: string)`(`server/services/orbTaskStateMachine.ts:236,750`)兩者的函式簽名**都只接受 `taskId`,不接受/不強制 `userId`**——擁有權檢查 100% 是呼叫端(`ai.ts`)自己的責任,而 `get`/`events`/`traceDebug` 三個查詢端點沒有做這件事。
- `taskId` 格式(`orbTaskStateMachine.ts:76,172`:`genId("orb_task", 8)` → `orb_task_<ms>_<8碼隨機>`)與前一條發現的 `codeTaskId` 同款,且同檔案 `:3241` 註解已自承「guessable」。

**影響**:任何登入使用者只要拿到(或猜到)別人的 `taskId`,即可:
- 用 `orbTask.get` 讀到該任務完整內容(`intent`、`steps`、每一步的 `toolCalls`/`toolArgs`——可能包含使用者的生成 prompt、上傳的檔案 URL、個人化偏好等)。
- 用 `orbTask.events` 讀到該任務的完整稽核事件序列。
- 用 `orbTask.traceDebug` 額外讀到 `chainEvents`(跨任務記憶鏈)。

這是本 router 內目前**唯一**一組「同一資源、寫入受保護但讀取不受保護」的不一致案例,且修復動作(AIDV-885)明顯只覆蓋了會寫入狀態的端點,三個唯讀端點被遺漏。嚴重度定為「嚴重」是因為:(a) 不需要任何猜測技巧,只要曾經在同一瀏覽器/裝置上看過或側錄過任一 taskId 字串即可長期重放讀取;(b) 洩漏的資料面(生成 prompt、任務意圖、工具呼叫細節)可能包含使用者不願公開的創作題材或個資痕跡。

**建議**:為 `get`/`events`/`traceDebug` 三個端點補上與其餘 7 個端點完全相同的擁有權檢查,並建議在 `getOrbAgentTask`/`getOrbAgentTaskEvents` 服務層直接加上可選的 `requestingUserId` 參數,把檢查收斂到單一實作點,避免未來新增端點時再次遺漏。

---

### 🔴 嚴重 4(確認+深化 W6):`input.context`(10,000 字自由文字)在 ai.chat 內至少 4 條路徑繞過全站唯一的 `sanitizeOrbMessages` 呼叫,其中一條路徑被 `agentPlanner.ts` 用正則解讀成可強制跳過澄清、直接執行任務的硬指令

**證據**:

- `ai.ts:443`:`context: z.string().max(10_000).optional()`——無內容過濾,純長度上限。
- 全 repo grep `sanitizeOrbMessages\(`:只有 `ai.ts:1543` 一處生產呼叫點(另有 `server/orb-prompt-defense.test.ts` 的單元測試呼叫),且**只套用在 `input.messages`**,不套用在 `input.context`。`agentPlanner.ts` 全文 grep `sanitizeOrbMessages`/`orb-prompt-defense`:零匹配。
- 未清洗的 `input.context` 在 `ai.ts` 內至少流向 4 個地方:
  1. `ai.ts:1240-1254`(主 planner 路徑):`mergedPromptContext = [input.context, worldContextBlock, persistedOrbMemorySummary].filter(...).join("\n\n")`,直接傳給 `buildOrbSystemPrompt(...)`(:1252-1254)——這段程式碼在 `try` 區塊(:1538 開始,`sanitizeOrbMessages` 呼叫點 :1543)**之前**就已執行完畢,系統提示詞組裝時 `sanitizeOrbMessages` 根本還沒跑。
  2. `ai.ts:1864`(agent kill-switch/chat-only 分支):`buildOrbSystemPrompt(input.personality, input.context ?? undefined, {...})`——直接使用**原始** `input.context`,連 `mergedPromptContext` 的合併步驟都沒有,是最原始形態的未清洗注入。
  3. `ai.ts:2001-2036`(schema-first planner 分支):`plannerContextWithResearch = [input.context, webResearchPromptBlock, ...].filter(...).join("\n\n")`,以 `context: plannerContextWithResearch || undefined` 傳給 `runSchemaFirstAgentPlanner`/`...WithCritique`(:2036)。
  4. `ai.ts:2470`:`setOrbTaskPlannerContext(stateMachineTask.taskId, { ..., context: input.context, ... })`——把原始 `input.context` 存進 planner context store,供之後的 continuation/replan 迴圈(`ORB_OBSERVATION_LOOP`)重複取用,同樣未經任何清洗。
- 深化點(本文件新發現,非 W6 已載):`server/services/agentPlanner.ts:391-443` 把 `input.context` 用正則解析成「使用者選擇模式」硬指令:
  ```ts
  const requestedModeMatch = input.context
    ? input.context.match(/使用者選擇模式[:：]\s*([a-z_-]+)/i)
    : null;
  const requestedMode = requestedModeMatch?.[1]?.toLowerCase() ?? null;
  ...
  const urgencySource = `${latestUserText}\n${input.context ?? ""}`;
  const URGENT_MARKERS = /別問了|不要再問|直接做|直接執行|直接跑|我趕時間|趕件|急件|很急|今天就要|現在就要|just do it|skip clarification|stop asking|run it now|go ahead/i;
  const isUrgentSkip = URGENT_MARKERS.test(urgencySource);
  ```
  當 `requestedMode === "multi-step"` 且 `isUrgentSkip` 為真時,`modeDirective`(:403-439)會產生這樣的系統提示詞片段:
  > "URGENT ESCAPE HATCH ACTIVE — user explicitly asked to skip clarification...Skip the MIN 3 rounds rule: if you have even ONE confirmed dimension...commit to decision.mode='tasked' THIS turn."

  這段文字接著在 `contextBlock`(:441-462)被組進 `systemPrompt`,於 `agentPlanner.ts:588` 送進 LLM。**任何客戶端(不需要正牌前端 UI,直接呼叫 tRPC mutation 即可)只要在 `context` 欄位塞入 `"使用者選擇模式:multi-step\n直接做"` 這種固定字串,就能讓伺服端自己組出「請你這輪直接進 tasked 模式、跳過最少 3 輪澄清」的硬指令餵給 LLM**——這不是需要誘導 LLM 的 prompt injection,而是應用邏輯本身把使用者可控字串當成「使用者在 UI 上明確點選的模式」來信任,沒有任何伺服端旗標/簽章證明這段文字真的來自 UI 的模式選擇互動。

**與 W6 的關係**:W6 已在 `siteKnowledge.ts` 層級指出 `pageContext` 繞過 `sanitizeOrbMessages` 且被用來做 `isStudioPage` 等 boolean 判斷;本文件在 `ai.ts` 本體把「繞過」的具體路徑從 1 條擴充為 4 條,並且往下追進 `agentPlanner.ts`,找到比「頁面偵測被操弄」更直接的後果——**可操弄 planner 的 decision.mode 選擇邏輯本身**。這是新增的深化發現,非重複。

**影響**:即使 `evaluateAgentPlanV3Risk`(U2 已引用)等下游風控仍會對最終 plan 的 action 類型把關,但「是否要跳過澄清、直接進 tasked」這個決策入口本身可被使用者(或任何呼叫此 API 的腳本)用固定字串操弄,削弱了「至少 3 輪澄清」這道原本用來防止 LLM 在資訊不足時擅自送出高風險生成的軟性防線。

**建議**:
- `input.context`(以及合併後的 `mergedPromptContext`/`plannerContextWithResearch`)在送進 `buildOrbSystemPrompt`/`runSchemaFirstAgentPlanner` 前,一併跑過 `sanitizeOrbMessages`(或至少等強度的角色標記剝除)。
- `requestedMode`/`isUrgentSkip` 這類「應被視為結構化 UI 事件」的訊號,改用獨立的、有型別的 zod 欄位(例如 `composerMode: z.enum([...]).optional()`)傳遞,不要用正則從自由文字反解——這樣才能讓「使用者真的在 UI 點了『直接做』」與「使用者在對話框打字提到這幾個字」有本質上的區別。

---

### 🟠 高 1(新發現):`ai.executeTools` 的 `approved` 布林值完全由客戶端提供、無簽章/token,可直接滿足 `agentToolExecutor.ts` 對 studio.* 生成工具的 `requiresHuman` 確認閘

**證據**:

- `ai.ts:3018-3045`:
  ```ts
  executeTools: brainProcedure
    .input(z.object({
      calls: z.array(z.object({ name: z.string().min(2).max(64), args: z.record(...).optional() })).max(5),
      approved: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const results = await executeOrbToolCalls({
        tools: getOrbToolRegistry(),
        calls: input.calls,
        userId: ctx.user.id,
        userRole: ctx.user.role,
        approved: input.approved,   // ← 直接來自客戶端輸入,無任何伺服端驗證
        requestId: `adhoc_${ctx.user.id}_${Date.now()}`,
        ...
      });
      return { results };
    }),
  ```
- `server/services/agentToolExecutor.ts:1000-1007`(`dispatchStudioTool`,`studio.generateImage`/`generateVideo`/`generateAudio`/`generateVoice`/`trainLora` 等生成工具的橋接函式):
  ```ts
  // ── 風險閘門:requiresHuman 必須有 approved ──
  if (def.requiresHuman && !opts.approved) {
    return { name: call.name, ok: false, error: "confirmation-required" };
  }
  ```
  同款 gate 另在 `agentToolExecutor.ts:7554,7785` 重複出現。
- 對照同檔案內**真正有伺服端驗證**的核准機制:`ai.ts:339-382`(`reportTaskStep`)的 `approved` 是這樣算出來的:
  ```ts
  approved:
    !currentTask.needsApproval ||
    orbTaskRepository.isStepApproved(input.taskId, ctx.user.id, input.stepId, input.approvalToken, input.at),
  ```
  `approvalToken` 由 `approveTaskStep`(:323-337)在使用者按下核准當下產生並回傳給前端(`task?.stepApprovals.find(...).token`),`isStepApproved` 會核對這個 token 與過期時間——這才是真正的「伺服端已驗證使用者確實核准過」。`executeTools` 端點完全沒有這一層,只是把客戶端送來的布林值原樣轉發。

**影響**:`ai.executeTools` 被 U2 記載為「獨立 adhoc 端點」——任何登入使用者可以繞過正常的「光球規劃 → 產生 taskDraft → 使用者按核准 → orchestrator 執行」流程,直接呼叫這個 tRPC mutation,帶上 `calls:[{name:"studio.generateVideo", args:{...}}]` 與 `approved:true`,`requiresHuman` 閘門立即放行——與 W1 記載的 `askForStudioPlan`(client 端信任 LLM 輸出的 `submit` action 直接執行)屬於同一類「client 端旗標被當成安全邊界」的病灶,但這裡連 LLM 都不需要參與,是最直接的一種閘門繞過。

**建議**:`executeTools` 的 `approved` 欄位應移除,改為要求呼叫端先透過既有的 `taskDraft`/`approvalToken` 流程取得憑證,或至少讓 `approved:true` 只在對應的 `taskId`/`stepId` 存在且該步驟確實已進入「等待人工核准」狀態時才生效(比照 `reportTaskStep` 的模式)。

---

### 🟠 高 2(新發現,同類注入面第二例):`pageSnapshot` 各欄位與 `input.context` 一樣未經任何清洗,以權威語氣直接塞進系統提示詞

**證據**:

- `ai.ts:448-474`:`pageSnapshot.pageLabel`/`capabilities[].label`/`capabilities[].hint`/`capabilities[].options[].label` 均為 `z.string()`(部分 `.optional()`),**沒有任何一個有 `.max()` 長度上限**,也沒有內容過濾。
- `server/services/siteKnowledge.ts:1393-1429`(`serializeSnapshotBlock`)把這些欄位原樣拼接:
  ```ts
  lines.push(`【使用者目前在「${snap.pageLabel}」（${snap.pagePath}，pageId=${snap.pageId}）】`);
  ...
  lines.push(`- ${cap.label} [${cap.action}]${current}`);
  ...
  if (cap.hint) lines.push(`  備註：${cap.hint}`);
  ```
  只有 `snap.state`(`z.record(z.string(), z.unknown())`)裡的值有做 40 字截斷,`pageLabel`/`cap.label`/`cap.hint` 完全沒有長度或內容限制,且被包在「【此頁可用的代理人動作(請只從這些 id 中挑選)】」這種指示性語句下方一併送給 LLM。

**影響**:與 W6 已載的 `pageContext`/`recentFeedback.note` 屬於同一類「client 可控自由文字、以權威框架注入系統提示詞、無 `sanitizeOrbMessages` 保護」的問題,是本檔內**第三個**同類注入面(`context`、`recentFeedback.note`、`pageSnapshot.*`),影響範圍同樣侷限在「使用者操弄自己的助手」,尚未發現跨租戶擴散路徑。

**建議**:`pageSnapshot` 理論上應該是「前端頁面自身宣告的固定能力清單」(不應包含使用者輸入),建議在 zod schema 層對 `pageLabel`/`capabilities[].label`/`hint` 加上合理的 `.max()`(例如 40-80 字),並評估是否該整批併入 `sanitizeOrbMessages` 或同等強度的清洗流程。

---

### 🟡 中 1(新發現):`ai.codeTask` 的任務生命週期只有 create/approve/cancel 接線,其餘 6 個狀態轉移函式在生產程式碼零呼叫點,只被單元測試呼叫——核准後的任務永遠卡在 `"approved"`

**證據**:

- `server/services/orbCodeTask.ts` 匯出 `createOrbCodeTask`/`getCodeTask`/`listRecentCodeTasks`/`approveCodeTask`/`markCodeTaskRunning`/`cancelCodeTask`/`attachCodeTaskPr`/`markCodeTaskFailed`/`markCodeTaskMerged`/`markCodeTaskReviewRequired`/`getCodeTaskTelemetry`。
- `ai.ts:88-100` import 了全部 11 個函式,但全文 grep(排除 import 那行本身)只有 `createOrbCodeTask`(:2535)、`approveCodeTask`(:3359)、`cancelCodeTask`(:3362)三個被實際呼叫。
- `listRecentCodeTasks`/`getCodeTaskTelemetry`/`markCodeTaskFailed`/`markCodeTaskMerged`/`markCodeTaskReviewRequired`/`markCodeTaskRunning`/`attachCodeTaskPr` 這 7 個匯入在 `ai.ts` 全檔零呼叫;全 repo grep(排除 `orbCodeTask.ts` 本體與 `server/orb-code-task.test.ts`)同樣零命中——**除了單元測試,生產程式碼裡沒有任何地方會把一個已核准的 code task 推進到 `running`/`pr_created`/`merged`/`failed`**。

**影響**:使用者透過 `ai.codeTask.approve` 核准一個程式碼協作任務後,若沒有其他未被本次稽核發現的接線(本文件已用 grep 排除 `server/` 目錄下的其他 import 點),該任務的狀態機會永久停在 `"approved"`,前端若有對應的「執行中/PR 已建立/已合併」狀態顯示,將永遠等不到更新。

**建議**:確認實際驅動 Claude Code/Codex 執行、回寫 PR 狀態的程式碼是否存在於本次稽核範圍外的其他服務(例如獨立的 worker/webhook,非 `server/routers`、`server/services` 樹狀結構內);若確實沒有任何生產路徑會呼叫這 7 個函式,應視為未完成功能,建議標記追蹤卡或移除死碼。

---

### 🟢 低 1(新發現):三組匯入的函式在 ai.ts 全檔零呼叫,是計費/記憶守衛「原本打算接線但沒接」的具體佐證

**證據**:

- `ai.ts:180-181`:`estimatePoints`/`getModelPricing`(來自 `../services/modelPricing`)——全檔 grep 除了 import 那兩行,**零其他出現**。這兩個函式正是全站計費估價的核心工具(`falDispatcher.ts` 內部用它們算 `estimate`/`retryEstimate`),`ai.ts` 匯入卻從未使用,是「本檔原本可能打算自行計費/估價,但從未真正接線」的直接程式碼證據,呼應嚴重發現 1。
- `ai.ts:26`:`buildMemoryContext`/`upsertMemory`(來自 `../services/ragMemory`)——全檔 grep 零其他出現。這兩個函式在 `server/routers/generate.ts:681,1395` 有正確的生產呼叫(含 `guardCreativeMemoryContext` 包裹,見下一點),`ai.ts` 的 import 是純粹的死碼。
- `ai.ts:27-30`:`guardCreativeMemoryContext`(來自 `../services/security/ragInjectionGuard`)——全檔 grep 零其他出現(注意:`guardOrbMemorySummary` 是另一個函式,在 `ai.ts:1034` **有**被正確呼叫,兩者不要混淆)。`ragInjectionGuard.ts:382-384` 的函式註解明寫「routers.ts buildMemoryContext → compileElitePrompt 路徑(側門1)的接線形狀」,對照 `generate.ts:696` 確實有 `memoryContext = guardCreativeMemoryContext(memoryContext)` 這行——這組 guard 是為**另一個檔案**(`generate.ts`)寫的,在 `ai.ts` 匯入純屬多餘。

**影響**:純維護性負擔,不構成安全或功能風險,但容易誤導後續開發者以為 `ai.ts` 内已經對某段記憶/計費做了防護。

**建議**:移除這 5 個未使用的 import(`estimatePoints`、`getModelPricing`、`buildMemoryContext`、`upsertMemory`、`guardCreativeMemoryContext`),讓 lints/tree-shaking 反映真實依賴關係。

---

### 🟢 低 2(新發現,命名瑕疵):`moderatedReply` 變數名稱具誤導性,ai.ts 本體從未對它呼叫過 `moderateOrbContent`

**證據**:

- `ai.ts:2163`:`const moderatedReply = plannerResult.reply ?? "我已幫你整理好下一步。";`——變數名稱暗示這是「已審核過」的回覆文字,但 `ai.ts` 全檔 grep `moderateOrbContent\(` 只有 `:2711` 一處呼叫(套用在 legacy fallback 分支的 `legacy.reply`),`moderatedReply`(converted 分支使用的變數)**沒有**在 `ai.ts` 本體被送過 `moderateOrbContent`——真正的審核(若有)發生在 `agentPlanner.ts` 內部的 `applyModerationGate`(U2 已載,`moderateOrbContent(gated.reply ?? "")`),對 `ai.ts` 的讀者而言,`moderatedReply` 這個變數名字本身即造成誤導。

**影響**:純命名/可讀性瑕疵,不構成功能風險(因為審核確實在上游 `agentPlanner.ts` 執行過一次)。

**建議**:重新命名為 `plannerReply`/`gatedReply` 等不暗示「本地已審核」的名稱,避免未來維護者誤以為需要在 `ai.ts` 內再包一層審核而重複呼叫,或反過來誤以為此處毋需審核。

---

## 對照表:ai.ts 內「會呼叫 LLM 或觸發生成」的 procedure 逐一核對計費狀態

| Procedure | 觸發的 LLM/生成路徑 | 計費狀態 | 依據 |
|---|---|---|---|
| `chat`(:434-2994) | 主 planner(`invokeLLM`,`director.model`)、chat-only kill-switch(`invokeLLM`)、critique/refine(`runSchemaFirstAgentPlannerWithCritique`)、fire-and-forget 記憶摘要(`gpt-4o-mini`) | **零計費**(LLM tokens 不寫入 `api_usage_logs`,U2 已確認;本文件重新 grep `createApiUsageLog` 確認全 repo 唯一呼叫端仍是 `generate.ts`) | U2 確認 |
| `chat` converted 分支 `execute_generate_image`(:2200) | `executeGenerateImage` → `fal.proxy` 原始透傳 | **零計費**(結構上不可能,見嚴重發現 1) | 本文件新增 |
| `chat` converted 分支 `execute_task`(:2230) | `executeOrbTask` → `dispatchImageGeneration`/`Video`/`Audio` | **零計費**(`dispatchFalTask` 的 `userId` 判斷恆為 false,見嚴重發現 1) | 本文件新增 |
| `chat` legacy fallback `execute_generate_image`(:2759)/`execute_task`(:2793) | 同上兩者 | **零計費** | 本文件新增 |
| `reportTaskStep`(:339-417) | `executeCurrentStepTools` → 同款 `agentToolExecutor`/`dispatchStudioTool` 路徑 | **零計費**(`agentToolExecutor.ts` 全文無扣點呼叫,U3 finding #3 確認) | U3 確認 |
| `approveTask`(:286-321) / `orbTask.approve`(:3060-3104) / `orbTask.retry`(:3124-3183) / `orbTask.resume`(:3200-3222) | `driveOrbTaskInBackground` → orchestrator → 同款生成工具路徑 | **零計費**(同上,終點相同) | 本文件推論(終點路徑已確認零計費) |
| `executeTools`(:3018-3045) | `executeOrbToolCalls` → `dispatchStudioTool` | **零計費** + 額外有 `approved` 閘門繞過(高 1) | 本文件新增 |
| `codeTask.approve`(:3357-3359) | 觸發 Claude Code/Codex 外部 API(非 fal,屬於伺服端自身 LLM/Agent 成本) | 本檔案內無使用者點數扣除呼叫;是否應向使用者收費屬產品決策範圍,本稽核僅確認「沒有扣點程式碼」 | 本文件新增(範圍限定) |
| **對照組**:`director.ts` 的 `executeGenerationTask`(批次生成鏈) | 同樣是 fal.ai 生成 | **完整計費**(`deductUserPoints`/`atomicClaimJobRefund`/失敗原子退款) | W1 已確認,列為對照 |
| **對照組**:`proStudio.ts` 各生成 mutation | 同樣是 fal.ai 生成 | **完整計費**(`chargeForFalTask` 先扣點,33 處呼叫) | U3 已確認,列為對照 |

**結論**:`ai.chat` 及其衍生的所有 orb 任務執行入口(`executeTools`/`reportTaskStep`/`orbTask.*`/`approveTask`)在本次逐行核對下,**沒有任何一條路徑會對使用者的生成產出扣除點數/額度**——U2 提出的「ai.chat 繞過計費」在本檔案的追蹤下**坐實**,且比 U2 原本描述的更嚴重:不只是「planner 沒把成本記到 `api_usage_logs`」,連 orb 對話觸發的 fal.ai 生成本身(不論走 converted/legacy 捷徑或走正規 tasked→approve 流程)都在結構上不可能被扣點,與同一產品內 `director.ts`/`proStudio.ts` 兩條「做對了」的對照組形成鮮明落差。

---

## 已查驗、確認無新問題的項目(避免誤報)

- **`db.*` 工具的 userId 強制覆寫**:`agentToolExecutor.ts` 的 `dispatchDatabaseTool` 用 `{ ...args, userId: opts.userId }` 展開順序強制覆寫任何 LLM 可能夾帶的 `userId`,`opts.userId` 一路回溯到 `ctx.user.id`——此點 W6 已驗證,本文件在 `ai.ts` 呼叫端(`reportTaskStep:363`、`executeTools:3035`)重新核對 `userId: ctx.user.id` 皆為登入身份而非 client 可控值,確認一致。
- **世界觀資料的擁有權比對**:`ai.ts:1193-1196` 的 `wb.userId === ctx.user.id` 檢查存在且位置正確(W6 已載,本文件重新讀取確認行號與邏輯未變)。
- **`startTask`/`task`/`taskTimeline`/`toolCallLogs`/`approveTask`/`approveTaskStep`(:207-417,舊版 `orbTaskRepository` 系統)**:皆把 `ctx.user.id` 當參數傳入 `orbTaskRepository.*` 方法本體(`get`/`approve`/`approveStep`/`getTimelinePage`),擁有權檢查收斂在 repository 層而非呼叫端各自為政,是比 FSM `orbTask.*` router(擁有權檢查散落在每個呼叫端、如嚴重發現 3 所示)更穩健的設計模式,本文件未在這組舊版端點發現新的擁有權缺口。
- **`chatProgress` 無擁有權檢查**:U2 已載,本文件重新確認 `ai.ts:3002-3016` 現況一致,不重複列為新發現。

---

## 未查證 / 未讀完部分

1. `orbTaskOrchestrator.ts`/`orbTaskChainRunner.ts`/`multiAgentIntegration.ts` 全文本波未重讀(E/U2 已覆蓋),「零計費」結論在 `orbTask.approve`/`retry`/`resume` 這幾條路徑上是透過「同樣終點是 `agentToolExecutor.ts`/`dispatchStudioTool`」的邏輯推論得出,未逐行重新走過 orchestrator 內部是否有本波未發現的另一條計費分支。
2. `codeTask.approve` 核准後,是否有本次稽核範圍外(例如獨立 worker、GitHub Actions webhook)的機制驅動 Claude Code/Codex 執行與狀態回寫——本文件僅確認 `server/routers`、`server/services` 樹狀結構內零呼叫點,未排查是否有完全獨立的服務入口。
3. `genId` 的 `Math.random()` 隨機性在對抗性猜測下的實際可行性(暴力枚舉需要多少請求量、是否有其他限流會擋下)未做量化評估,僅引用原始碼文件自承「不可用於安全性用途」作為設計層級證據,而非實測滲透結果。
4. `ai.executeTools`/`orbTask.*` 除 `chat`/`retry` 外,其餘端點(`startTask`/`approveTask`/`approveTaskStep`/`reportTaskStep`/`executeTools`/`orbTask.approve`/`pause`/`resume`/`completeStep`/`failStep`/`updateStepStatus`/`codeTask.*`)完全沒有請求層級限流(僅 `brainProcedure`,無 `checkTrpcRateLimit`/`tryConsumeChatToken`),W1 已在 `director.ts` 記載同款模式為「成本 DoS 面」,本文件僅在此處確認 `ai.ts` 同樣成立,未重新量化「無限流 + 背景驅動 orchestrator」疊加後的實際資源消耗上限。

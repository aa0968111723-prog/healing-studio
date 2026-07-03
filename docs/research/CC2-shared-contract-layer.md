# CC2 — shared/ 契約層深挖(agent-actions/plan-safety/schema)

- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:shared/agent-actions.ts(1261)、shared/agent-plan-safety.ts(615)、shared/agent-plan-schema.ts、shared/appRegistry.ts

> 核對:`git diff 812f6fdb HEAD -- <本次四檔>` 為空,四檔在 812f6fdb 之後未變動,行號可信。
> 方法:本文件全程手動逐行閱讀完成,對抗式挑錯,未 spawn 子代理。為了證實「契約有沒有真的被遵守」,對三個
> 交叉引用檔案(`shared/global-agent-capabilities.ts`、`shared/global-agent-tools.ts`、`shared/agent-plan-adapter.ts`、
> `client/src/contexts/PageAgentContext.tsx`)做了**定點**查證(非逐行審查),用以確認四道主稽核檔案宣告的
> 「安全閘」是否真的接到下游、有沒有被別的檔案抵銷或補強。這些交叉檔案本身的其餘部分不在本次範圍內。

## 摘要(先講結論)

這四個檔案共同構成「光球 AI 代理人動作」的型別 SSOT(agent-actions.ts)、風控 Zod schema(agent-plan-schema.ts)、
執行前五道安全閘(agent-plan-safety.ts)、頁面能力/路由白名單(appRegistry.ts)。逐行核對後,**這一層「契約」在四個
檔案之間至少有三處結構性各自為政**,导致「看起来有闸门」但闸门实际上没接住真正该挡的东西:

1. `appRegistry.ts` 明確設計並文件化的「頁面能力白名單」(`supportedActions`)从未被 `agent-plan-safety.ts` 唯一的
   頁面能力檢查(`hasCapabilityForPage`)讀取——後者讀的是另一個獨立維護、與頁面無關的固定清單,雙向都會出錯
   (該擋的沒擋、不該擋的被擋)。
2. `evaluateWorkflowSafety`(`RunWorkflowAction` 專用安全評估)在呼叫 `evaluateAgentPlanSafety` 之前,會先把**任何**
   無法辨識的 `actionType` 字串靜默轉成 `fillPrompt`,導致「未知動作」這道閘對這個入口**結構性永遠打不到**。
3. 「哪些 `AgentActionType` 算已知/算破壞性/算高風險」在 `agent-actions.ts`、`agent-plan-schema.ts`、
   `agent-plan-safety.ts`、`global-agent-capabilities.ts` 四處各自維護一份清單,彼此不同步,其中 `execute_task`
   自相矛盾最嚴重:schema 承認它是合法 action,但 plan-safety 的「已知動作」清單漏收它,導致它在 schema-first
   管線裡**必定**被判定為 unknown_action 而擋下——這剛好意外遮蔽了另一個更深的地雷(見發現 6)。

以下依嚴重度排序,每條含「發現 → 影響 → 建議」,並在最後附上已核對無誤的 negative results。

---

## 🔴 嚴重(Critical)

### 發現 1 — `appRegistry.ts` 的 `supportedActions` 頁面白名單與 `agent-plan-safety.ts` 實際呼叫的能力檢查函式完全脫鉤,雙向都會判錯

**cluster:contract-mismatch**

**證據鏈**:

- `shared/appRegistry.ts:100-109` 明確寫著 `supportedActions` 的存在理由:「orb 的靜態備援路由用這個欄位,避免
  把 action 送到一個處理不了的頁面(過去最常見的失敗案例:setModality 被送去 `/image-studio`,但那頁沒有
  setModality 的 case → 派送靜默失敗)」。
- `shared/appRegistry.ts:290-341`(`image-studio` 頁面條目)`supportedActions` 明確**不包含** `"setModality"`
  (只有 `setTab/setModel/fillPrompt/applyPreset/submit/reset/openDialog/setParam/focusElement`)——完全對應上面
  註解描述的那個歷史 bug 案例。
- 但 `shared/agent-plan-safety.ts:10` 匯入、`:436` 呼叫的 `hasCapabilityForPage(step.pagePath, actionType)`
  ——這是 `evaluateAgentPlanV3Risk` 裡**唯一**會把「這個 action 這頁能不能做」變成 blocker 的地方——其實作在
  `shared/global-agent-capabilities.ts:187-195`:
  ```ts
  export function hasCapabilityForPage(pagePath: string | undefined, actionType: string): boolean {
    if (!pagePath) return true;
    return GLOBAL_AGENT_CAPABILITY_REGISTRY.some(
      capability => capability.enabled && capability.pagePath === pagePath && capability.actionType === actionType
    );
  }
  ```
  而 `GLOBAL_AGENT_CAPABILITY_REGISTRY`(`global-agent-capabilities.ts:156-173`)**不是**從
  `APP_PAGE_REGISTRY[i].supportedActions` 建出來的,而是「每個 `supportsPageAgent:true` 的頁面」× 一份寫死的
  `DEFAULT_ACTION_CAPABILITIES` 固定清單(13 種 action:fillPrompt/setModel/setMode/setTab/setParam/applyPreset/
  submit/reset/navigate/openDialog/runWorkflow/search/setModality,`global-agent-capabilities.ts:19-154`)做笛卡兒積。
- `image-studio` 的 `supportsPageAgent: true`(appRegistry.ts:303),所以
  `hasCapabilityForPage("/image-studio", "setModality")` 回傳 **true**——與 appRegistry 自己白紙黑字說「這頁沒有
  setModality」直接矛盾。也就是說:appRegistry 註解描述要防止的那個歷史 bug,在 v3 risk 評估這條路徑上**目前完全
  沒有被擋住**。

**反方向的誤傷同時存在**:`DEFAULT_ACTION_CAPABILITIES` 沒有 `"focusElement"` 這一項(appRegistry.ts 裡有 7 個頁面
——`studio`(287)、`image-studio`(339)、`video-studio`(390)、`pro-studio`(441)、`director`(489)、
`animation-studio`(559)、`lora-trainer`(603)——的 `supportedActions` 明確包含 `focusElement`)。只要 planner 對
`focusElement` 步驟填了 `pagePath`(`agent-plan-adapter.ts:207` 的系統提示只豁免 `navigate`,沒有明確禁止
`focusElement` 帶 `pagePath`),`hasCapabilityForPage(pagePath, "focusElement")` 會**永遠回傳 false**(因為
`DEFAULT_ACTION_CAPABILITIES` 裡根本沒有這個 actionType,不論哪個頁面),這 7 個頁面完全合法的 focusElement 步驟
就會被判定「no registered capability」而擋下、逼迫重新規劃。`toggleSetting` 也一樣完全不在
`DEFAULT_ACTION_CAPABILITIES` 裡(但目前沒有任何頁面在 `supportedActions` 宣告 toggleSetting,見發現 12,這個方向
的影響目前是空集合)。

**交叉查證(未在本次四檔清單內,僅用來確認嚴重度沒有被下游補救)**:
- `shared/orb-page-state-graph.ts:30,78,126,252-259` 有正確讀 `item.supportedActions`——但只用在
  `findPagesForAction`(路徑規劃/提示詞序列化),不是阻擋執行。
- `client/src/contexts/PageAgentContext.tsx:366-374` 偵測到「派送的 action 該頁沒宣告 capability」時只是
  `console.warn`,警告完照樣 `await page.handle(action)` 執行——同樣不阻擋。

三個「本該把關」的地方(orb-page-state-graph 的路徑規劃、client 端 console.warn、shared 端
`hasCapabilityForPage`)裡,**只有** `hasCapabilityForPage` 名義上是硬性 blocker,但它讀的是錯的資料源。等於
appRegistry 精心設計、寫了詳細註解的「頁面能力白名單」全站沒有任何一處真的拿它來做強制阻擋。

**影響**:
- (低估風險方向)v3 plan 可以把 `submit`/`applyPreset`/`reset` 等高風險 action 的 `pagePath` 填成任何一個
  `supportsPageAgent:true` 的頁面(包括 `/admin`、`/admin/api-usage`——這兩頁在 appRegistry 只宣告
  `supportedActions: ["navigate","setTab"]`),`hasCapabilityForPage` 一樣會回傳 true,「no registered capability」
  這道閘完全不會擋下這種請求;實際會不會出事取決於該頁 client 端 `useRegisterPageAgent` 有沒有真的註冊對應
  case(未在本檔驗證,但至少這道 shared 層的閘門本身已經失效)。
- (高估風險方向)7 個頁面的合法 focusElement 步驟可能被無謂拒絕,造成使用者體驗回歸(重新規劃/多問一輪)。

**建議**:把 `GLOBAL_AGENT_CAPABILITY_REGISTRY` 從「固定 13 種 action × 全部 supportsPageAgent 頁面」改成直接由
`APP_PAGE_REGISTRY[i].supportedActions` 生成(每頁只登記自己宣告的 action,而不是套用同一份全域清單),讓
`hasCapabilityForPage` 真正變成 appRegistry 的下游,而不是第三份平行維護的清單。修完後補一個「registry 一致性」單元
測試,斷言 `hasCapabilityForPage(page.path, action)` 對每個 `page.supportedActions` 都回 true、對其餘 action 都回
false。

---

### 發現 2 — `evaluateWorkflowSafety` 的 `unknown_action` 閘門對 `RunWorkflowAction` 結構性打不到,任何無法辨識的步驟都會被靜默判定為安全的 fillPrompt

**cluster:contract-mismatch**

**證據**:`shared/agent-plan-safety.ts:591-615`

```ts
export function evaluateWorkflowSafety(action: RunWorkflowAction): AgentPlanSafetyEvaluation {
  const syntheticPlan: AgentPlan = {
    ...
    steps: action.steps.map((step, index) => {
      const normalizedAction = workflowStepToSyntheticAction(step);   // ← 轉換,見下
      ...
    }),
  };
  return evaluateAgentPlanSafety(syntheticPlan);
}
```

`workflowStepToSyntheticAction`(`:281-324`)的 `switch (step.actionType)` 最後一組:

```ts
case "appendPrompt":
case "fillNegativePrompt":
case "fillLyrics":
case "fillPrompt":
default:
  return { type: "fillPrompt", text: payload || step.label };
```

`default:` 分支與已知的 `fillPrompt` 系列共用同一段程式碼——**任何**沒有被前面 case 命中的 `actionType` 字串(它的
型別只是 `z.string().trim().min(1).max(64)`,`agent-plan-schema.ts:31`,沒有做值域限制),都會被轉成一個看起來完全
正常、低風險的 `fillPrompt` 動作。而 `evaluateAgentPlanSafety`(:168-177)的「unknown_action」blocker 判斷的是
**這個轉換後的 `normalizedAction.type`**,而它必定是已知的 `"fillPrompt"`——`isKnownActionType` 永遠不會在這個入口
回傳 false。也就是說,「unknown_action」這個 blocker case,對 `evaluateWorkflowSafety` 這條路徑而言是**永遠不可能
觸發的死碼**。

`RunWorkflowAction` 是可以被自由格式的 `coerceAgentAction`(`agent-actions.ts:629-655`)直接從 LLM 原始 JSON 建構
出來的(對 `steps[].actionType` 只驗證 `typeof === "string" 或 typeof toolName === "string"`,`agent-actions.ts:643-651`
與 `coerceWorkflowStep`,`:718-750`,對 `actionType` 的值域沒有任何白名單檢查),所以這不是純理論——只要 LLM(或任何
可以構造這個 JSON 形狀的呼叫方)給出一個沒被任何 case 命中的 `actionType`(例如打字錯誤、幻覺出的新動作名、或刻意
用來繞過風控的字串),`evaluateWorkflowSafety` 給出的評估結果會把它當成一則普通的填字動作對待,不會標記為
`unknown_action`,風險評分也只會落在 fillPrompt 的低風險層級。

同段函式還有一個較輕的姊妹問題(**cluster:other**,併入本發現一起看):`case "setModality":`
(`:292-296`)對於不是 `video/audio/voice` 的 payload 一律靜默 fallback 成 `"image"`,不會產生任何 warning——同樣是
「吞掉不符預期輸入」而非「舉報」的模式。

**影響**:「這個 workflow 安全嗎」的評估結果,系統性地無法反映「有沒有出現看不懂的步驟類型」這件事——如果真正執行
這個 workflow 的派送端(client 端 `useRegisterPageAgent` case 分支,不在本次四檔範圍)對同一個未知
`actionType` 有不同於「當作 fillPrompt」的處理方式(例如落到某個通用 fallback handler、或被其他中介層另作解讀),
安全評估看到的行為模型就會與實際執行的行為系統性地不一致。即使目前執行端多半只是「孤兒 case,靜默無效」(與既有
研究 W1/X2 記錄的模式一致),這道閘本身在程式碼層級就是不可能發揮作用的擺設,一旦執行端邏輯改變就會立刻變成真正
的風險。

**建議**:`workflowStepToSyntheticAction` 的 `default:` 分支不應該與已知類型共用同一段程式碼;應該回傳一個帶有
「原始未知類型」標記的合成動作(或讓 `evaluateWorkflowSafety` 在轉換前先對 `action.steps[].actionType` 做一次
獨立於 `AgentActionType` 字面量的白名單檢查),讓 `unknown_action` blocker 有機會真正被觸發。

---

## 🟠 高(High)

### 發現 3 — Schema-first 安全管線(`AgentPlanStepSchema.action`)只認得 23 種 `AgentAction` 中的 15/16 種;其餘 8 種(含 execute_task)靠自由格式 `coerceAgentAction` 繞過全部風控

**cluster:contract-mismatch**

**證據(三份「已知動作清單」逐一列出,互相對照)**:

| 清單 | 檔案:行號 | 數量 | 內容 |
|---|---|---|---|
| `AgentAction`(型別 SSOT) | `agent-actions.ts:284-307` | 23 | fillPrompt/setModel/setTab/setMode/setModality/setParam/applyPreset/submit/reset/navigate/focusElement/openDialog/search/toggleSetting/**execute_task**/**execute_worldbuilding_task**/**execute_worldbuilding_task_batch**/runWorkflow/**exportChatPdf**/**shareViaLink**/**generateCharacter**/**generateScene**/**generateStoryboard** |
| `AgentExecutableActionSchema`(Zod,`AgentPlanStepSchema.action` 用的就是這個) | `agent-plan-schema.ts:36-106` | 15 | 同上,但**沒有** execute_worldbuilding_task/_batch、exportChatPdf、shareViaLink、generateCharacter/Scene/Storyboard(7 種),**有** execute_task |
| `KNOWN_ACTION_TYPES`(`agent-plan-safety.ts` 的 `isKnownActionType`) | `agent-plan-safety.ts:47-63` | 15 | 同上 15 種再扣掉 execute_task,改成加回 runWorkflow;即**沒有** execute_task,也沒有上面那 7 種(共缺 8 種) |

即:
- 7 個新動作類型(worldbuilding 生成三兄弟 + execute_worldbuilding_task/_batch + exportChatPdf + shareViaLink)
  在 Zod 層級就無法出現在任何 `AgentPlanStep.action` 裡——`AgentPlanStepSchema.safeParse` 對它們直接判 `invalid`。
  這代表這 7 種動作**完全無法**透過 schema-first planner(`AgentPlan`/`AgentPlanV3`)產生,只能經由
  `agent-actions.ts` 的自由格式 `coerceAgentAction`/`parseLLMActions`(舊版 `ai.chat [ACTION:...]` 解析路徑)
  產生——而這條路徑**沒有**任何等價於 `evaluateAgentPlanSafety`/`evaluateAgentPlanV3Risk` 的五道閘評估(只有各自
  動作型別上寬鬆的欄位型別檢查,見發現 9)。
- `execute_task` 反而是相反的问题:它**通過**了 Zod schema(`agent-plan-schema.ts:98-105` 明確把它列為合法
  discriminated union 成員),但 `KNOWN_ACTION_TYPES`(plan-safety.ts)漏收了它。結果是:一個完全符合 Zod 驗證、
  結構正確的 `execute_task` 步驟,送進 `evaluateAgentPlanSafety`(:168-177)或 `evaluateAgentPlanV3Risk`(:406-416)
  時,`isKnownActionType("execute_task")` 一定回 false,一律被判定 `unknown_action` blocker、整個 plan 被擋下。

**影響**:這個「schema-first 安全管線覆蓋率不足」的架構缺口,意味著产品线上凡是用到 worldbuilding 生成
(generateCharacter/generateScene/generateStoryboard)、匯出聊天 PDF、分享連結、或(意外地)`execute_task` 本身的
plan,如果是從新版 `AgentPlan`/`AgentPlanV3` 走的,要嘛完全無法通過 schema 驗證,要嘛在通過驗證後被安全閘誤判為
未知動作擋下——這兩種結果都會讓功能不可用,而不是「風控生效」。真正能讓這些動作執行的路徑,是完全繞過這一整層
風控框架的舊版自由格式解析。

**建議**:
1. 立刻把 `execute_task` 加入 `KNOWN_ACTION_TYPES`(`agent-plan-safety.ts:47-63`)與其對應的 `AgentActionTypeSchema`
   (已經有了,只是 plan-safety 沒跟上)——但**務必**與發現 6 一起修,否則會踩到风险分级的地雷。
2. 針對 7 個目前完全无法进入 schema 管线的动作類型,產品面決定「這些動作本質上就不该走 schema-first plan」還是
   「該補進 AgentExecutableActionSchema 並配上對應的風險分級/破壞性判斷」;不管選哪個,現狀(靜默地兩套並存、
   沒有文件說明「這 7 種只能走舊路徑」)都是一個很容易被忽略的架構债。

---

### 發現 4 — `generateCharacter`/`generateScene`/`generateStoryboard` 未被判定為「破壞性動作」,但已由既有研究證實會直接觸發真實 LLM 生成並寫入資料庫

**cluster:contract-mismatch**(涉及使用者確認流程,亦可視為安全相關)

**證據**:`shared/agent-actions.ts:764-778` 的 `isDestructiveAction`(決定光球是否要先跳確認卡片再執行的判斷式):

```ts
export function isDestructiveAction(action: AgentAction): boolean {
  switch (action.type) {
    case "submit": case "reset": case "applyPreset": case "setModality":
    case "execute_task": case "execute_worldbuilding_task": case "execute_worldbuilding_task_batch":
    case "runWorkflow":
      return true;
    default:
      return false;
  }
}
```

`generateCharacter`/`generateScene`/`generateStoryboard`(`agent-actions.ts:156-186` 定義,型別上明確標示「生成角色
/生成場景/生成分鏡」)全部落入 `default: return false`——即光球判定這三種動作**不需要**使用者先確認就能直接執行。

但根據既有研究 `docs/research/V4-worldbuilding-generation-deepdive.md`(第 56-60 行)已核實:「`generateCharacter`/
`generateScene` 對應到 `worldbuildingGeneration.ts` 的真實 procedure,LLM 呼叫成功即回傳結果、寫入世界觀 JSON」
——也就是說這三個動作**不是**單純的「填表單」,而是會真的打 LLM(有真實 API 成本)並寫資料庫的生成動作,與同一個
`switch` 裡明確列為破壞性的 `execute_worldbuilding_task`(功能上做的事情高度類似)相比,分類邏輯並不一致。

**影響**:光球以 `runWorkflow` 或直接 dispatch 方式送出的 `generateCharacter`/`generateScene`/`generateStoryboard`
步驟,依 `isDestructiveAction` 的判斷不會被要求使用者先確認,使用者可能在沒有意識到的情況下觸發真實計費的生成
呼叫並讓資料被覆寫(尤其 V4 已指出這批寫入本身還有「整欄覆寫、無版本檢查」的資料遺失風險,兩個問題疊加)。

**建議**:把 `generateCharacter`/`generateScene`/`generateStoryboard` 加進 `isDestructiveAction` 的破壞性清單,並
同步檢查 `agent-plan-safety.ts` 的 `isDestructiveAgentAction`/`inferRiskLevelForAction`(agent-plan-schema.ts)是否
也需要覆蓋(目前這三者的 `switch` 也都沒有涵蓋這三個動作類型,`default` 一律低風險,見發現 6)。

---

### 發現 5 — `AgentPlanV3` 的風險評估器(`evaluateAgentPlanV3Risk`)遺漏了 v1 已有的 navigate 目的地路徑安全檢查

**cluster:contract-mismatch**(對照既有研究 W1「navigate 無白名單」finding,本檔證實新版評估器連 v1 既有的「語法
層級檢查」都沒有繼承)

**證據**:

`evaluateAgentPlanSafety`(v1,`agent-plan-safety.ts:162-244`)對每一步驟做了**兩次** `isSafeInternalPath` 檢查:

```ts
if (!isSafeInternalPath(step.pagePath)) { ... }                                    // :179
if (step.action.type === "navigate" && !isSafeInternalPath(step.action.path)) { ... }  // :190
```

而 `evaluateAgentPlanV3Risk`(v3,`agent-plan-safety.ts:403-485`)的整個 for 迴圈裡,**只有** `step.pagePath` 那一次
檢查(`:474`),完全沒有對 `step.action.type === "navigate"` 時的 `step.action.path` 做任何 `isSafeInternalPath`
呼叫。`agent-plan-schema.ts` 對 `navigate.path` 的 Zod 定義也只是 `z.string().trim().min(1).max(240)`
(`agent-plan-schema.ts:76-78`),沒有格式限制——即 schema 層與 v3 風控層,對 navigate 目的地路徑**同時**沒有任何
安全檢查。

**交叉查證(超出本次範圍,僅用以評估實際暴露面)**:`shared/agent-plan-adapter.ts:599-636` 有一段「navigate-mode
契約檢查」,會用 `getPageByPath` 核對目的地是否落在 `APP_PAGE_REGISTRY` 裡——但這段檢查**只在**
`options?.requestedMode === "navigate" && plan.decision.mode === "direct"` 時才執行(即使用者明確選了「跳頁」
composer 模式,且 LLM 判斷可以直接執行時)。對所有其他情境(一般對話模式下 LLM 自己決定要不要在多步驟計畫裡插入
一個 navigate 步驟、或 `decision.mode` 是 `tasked`),這個註冊表核對完全不會執行,回到只剩下 `evaluateAgentPlanV3Risk`
——而它對 navigate 目的地是零檢查。

**影響**:在「一般聊天模式」下由 v3 planner 產生、內含 `navigate` 步驟的 plan,其目的地路徑值只受 Zod 的
`min(1).max(240)` 字串長度限制,沒有任何協定(`javascript:`)、跨網域(`//host`)、或「是否為站內真實路由」的檢查。
是否能造成實際傷害,取決於 client 端如何消費這個路徑字串(既有研究 W1 指出 client 端用 wouter 的
`setLocation(targetPath)`,本身不是完整的 URL 解析,開放重導向的實際可利用性未在本次四檔驗證範圍內確認)——但 shared
層本應提供的「最後一道語法防線」在 v3 這條路徑上確實是缺失的。

**建議**:把 `evaluateAgentPlanV3Risk` 的每步驟迴圈補上與 v1 對等的
`if (step.action.type === "navigate" && !isSafeInternalPath(step.action.path)) blockers.push(...)`,並考慮讓
`agent-plan-adapter.ts` 的 registry 核對邏輯不再只綁定 `requestedMode === "navigate"`,而是對所有 decision.mode
（direct/tasked）的 navigate 步驟都執行。

---

### 發現 6 —(與發現 3 成對的潛伏地雷)一旦未來單獨修補 `KNOWN_ACTION_TYPES` 補上 `execute_task`,它會被同層的風險/破壞性判斷全部誤判為低風險、非破壞性

**cluster:contract-mismatch**

**證據**:假設發現 3 的建議 1(把 `execute_task` 加進 `KNOWN_ACTION_TYPES`)被單獨執行、沒有同時檢查以下三個函式:

- `inferRiskLevelForAction`(`agent-plan-schema.ts:205-217`):
  ```ts
  switch (action.type) {
    case "submit": case "reset": return "high";
    case "applyPreset": case "setModality": case "toggleSetting": return "medium";
    default: return "low";
  }
  ```
  `execute_task` 落入 `default: "low"`。
- `HIGH_RISK_ACTION_TYPES`(`agent-plan-safety.ts:337-341`):只有 `submit/reset/applyPreset`,不含 `execute_task`。
- `isDestructiveAgentAction`(`agent-plan-safety.ts:89-100`):只有 `submit/reset/applyPreset/setModality/runWorkflow`,
  同樣不含 `execute_task`。

而 `execute_task` 依照它自己在 `agent-actions.ts:205-213` 的定義,是「交由後端直接執行的創作任務(生成圖片/音樂/
影片)」——即真正會扣點、真正打 fal.ai 之類外部生成 API 的動作,`agent-actions.ts` 自己的 `isDestructiveAction`
（:764-778)也明確把它列為破壞性動作,需要使用者確認。

**影響**:今天這個「execute_task 被誤判低風險」的地雷,因為發現 3 那個獨立的 bug(`KNOWN_ACTION_TYPES` 漏收
execute_task 導致它必定被 `unknown_action` 擋下)而被意外掩蓋——execute_task 步驟根本走不到風險分級那一步。這是
典型的「先修好看到的 bug,結果打開了一個更嚴重的洞」的修復順序陷阱。

**建議**:發現 3 與發現 6 必須同批修復——把 `execute_task` 加入 `KNOWN_ACTION_TYPES` 的同一個 PR,必須同時把它加入
`HIGH_RISK_ACTION_TYPES`(v3)與 `isDestructiveAgentAction`,並在 `inferRiskLevelForAction` 的 switch 裡明確給它
`"high"`(v1),而不是留給 `default`。建議在程式碼裡加一條「新增 AgentActionType 時必須同步更新的清單」的內部
一致性測試(見「綜合建議」)。

---

## 🟡 中(Medium)

### 發現 7 — `applyPreset` 的風險分級在 v1 與 v3 不一致(medium vs high),只有 v3 會自動修正 `requiresApproval`

**cluster:contract-mismatch**

`agent-plan-schema.ts:210-213`(v1 用的 `inferRiskLevelForAction`)把 `applyPreset` 分類為 `"medium"`;
`agent-plan-safety.ts:337-341`(v3 用的 `HIGH_RISK_ACTION_TYPES`)把 `applyPreset` 分類為 `"high"` 並在
`:449-472` 對 `requiresApproval` 做自動修正(若 LLM 忘記設,強制改成 true)。v1 的 `evaluateAgentPlanSafety`
對 `risk === "medium"` 的破壞性動作只會在 `:234-243` 補一條 `destructive_without_approval` **警告**,**不會**
自動把 `step.requiresApproval` 改成 true(那段自動修正只發生在 `risk === "high"` 的分支,:218-233)。

**影響**:同一個 `applyPreset` 步驟,若透過 v1 `AgentPlan` 建構且 LLM 沒設 `requiresApproval`,評估完後這個欄位
仍然是 `false`(只有整體 plan 的 `askBeforeAct` 會是 true,不影響整體「先問過使用者」的閘,但任何**逐步驟**判讀
`requiresApproval` 的下游消費者(例如 `RunWorkflowAction.confirmationMode: "step-by-step"` 情境)會看到這一步「不
需要確認」);同一個動作走 v3 則會被強制改成 `true`。兩個版本應該是同一個安全政策的相容表示法,實際行為卻不同。

**建議**:讓 v1 的 auto-fix 分支條件從 `risk === "high"` 放寬為 `risk !== "low"`(即 medium 與 high 都自動修正
`requiresApproval=true`),或者統一 `inferRiskLevelForAction` 與 `HIGH_RISK_ACTION_TYPES` 對 `applyPreset` 的分級。

---

### 發現 8 — `AgentPlanV3Step.approvalGate` 是一個只寫不讀的欄位,但系統提示詞把它當成與 `requiresApproval` 同等重要的安全開關要求 LLM 填寫

**cluster:deadcode**

**證據**:
- `agent-plan-schema.ts:440` 定義 `approvalGate: z.boolean().default(false)`(`AgentPlanV3Step` 專有,v1 沒有這個
  欄位)。
- 全站對 `approvalGate` 的**唯一**寫入點在 `agent-plan-schema.ts:547-553`(`AgentPlanV3Schema.superRefine`):
  ```ts
  const highRiskAction = ["submit", "reset"].includes(step.action.type)
    || /publish|覆寫|overwrite|扣點|deduct/i.test(step.label);
  if (highRiskAction && !step.approvalGate) { step.approvalGate = true; }
  ```
  （這條規則本身也只認 `submit`/`reset` 兩種 action type + label 關鍵字比對,不含 `applyPreset`——與發現 7 的
  `HIGH_RISK_ACTION_TYPES` 又是第三份不一致的「高風險動作」清單。）
- 全 repo 用 `grep -rn "\.approvalGate"` 搜尋(`*.ts` 全庫),**沒有任何檔案讀取** `step.approvalGate`
  的值——它只在這裡被寫入,從未被任何執行/UI/風控邏輯消費。
- 但 `shared/agent-plan-adapter.ts:899` 的 planner 系統提示詞明確要求:「submit / publish / reset / points
  deduction / overwrite-content steps MUST set approvalGate=true and requiresApproval=true.」——即產品面認定這是
  一個與 `requiresApproval` 同等重要、LLM 必須主動設置的安全欄位。

**影響**:這不是一個會被繞過的安全閘(因為它本來就沒人讀,談不上「繞過」),而是一個**假安全感**風險:所有花在
「讓 LLM 正確填寫 approvalGate」「用正則表達式自動修正 approvalGate」上的心力目前對系統行為零影響,真正生效的是
`requiresApproval`。如果未來有新工程師假設「這欄位existing且被強調,應該就是權威的核准開關」而在新功能裡改讀
`approvalGate` 而非 `requiresApproval`,就會直接繼承這裡覆蓋率更窄的判斷(只有 submit/reset/關鍵字比對,不含
applyPreset/setModality/execute_task 等)。

**建議**:要嘛把 `approvalGate` 直接刪除(改成只維護 `requiresApproval`,减少一份平行状态),要嘛讓真正的執行閘門
明確改讀 `approvalGate`(並讓它的計算邏輯與 `requiresApproval`/`isDestructiveAgentAction` 對齊),兩者只能留一個
作為唯一真相來源。

---

### 發現 9 — `isSafeInternalPath` 的協定偵測正則表達式沒有處理控制字元,理論上可被瀏覽器「解析時去除 tab/換行」的行為繞過

**cluster:injection**

**證據**:`agent-plan-safety.ts:79-87`:

```ts
export function isSafeInternalPath(path: string | undefined): boolean {
  if (!path) return true;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.includes("\\")) return false;
  return true;
}
```

偵測協定字首的正則要求「`/` 之後緊接的字元一路都屬於 `[a-z0-9+.-]` 直到冒號」——如果字串裡插入了 tab(`\t`)
之類的控制字元(例如 `"/java\tscript:alert(1)"`),因為 tab 不屬於 `[a-z0-9+.-]`,正則在冒號前就無法連續匹配,
`.test()` 回傳 false,函式判定這條路徑「安全」。但主流瀏覽器在把字串當成 URL 解析時,會先去除協定名稱裡的
tab/CR/LF 字元(這是行之有年的一類 XSS/scheme-smuggling 手法)。

**影響**:本檔範圍內無法確認這是否構成實際可利用的漏洞——關鍵在於下游是否真的把 `navigate` 的 `path` 字串當成
一個完整 URL 交給瀏覽器解析(若像既有研究 W1 記錄的 `client/src/contexts/PageAgentContext.tsx:332-343` 那樣,只是
交給 wouter 的 `setLocation()` 做 SPA 內部路由,`pushState` 不會把字串當協定解析,則此路不通)。**未在本檔驗證**
實際的下游消費行為,僅指出這個正則本身的已知弱點模式,建議連同發現 5 一起補強。

**建議**:改用「先移除所有 C0 控制字元(` -`)再檢查協定字首」的寫法,與 `agent-actions.ts:1242-1245`
(`cleanString`)已經在用的控制字元過濾邏輯保持一致——這也順便修正了同一個 shared 層裡「有些地方過濾控制字元、
有些地方不過濾」的不一致。

---

### 發現 10 — `coerceAgentAction` 對 `setParam.key` 與 `openDialog.params` 沒有做危險鍵名過濾,與 Zod schema 層一致地缺這道防線

**cluster:injection**

**證據**:`agent-actions.ts:543-545`(`setParam`)與 `:572-588`(`openDialog`)都直接把外部輸入的字串當鍵名塞進
輸出物件,沒有排除 `__proto__`/`constructor`/`prototype` 等原型鏈鍵名。`agent-plan-schema.ts` 的
`AgentExecutableActionSchema` 對 `setParam.key`/`openDialog.params`(`paramsRecord = z.record(z.string(), z.unknown())`,
`agent-plan-schema.ts:27`)同樣沒有做任何鍵名黑名單。既有研究 `W1-director-router-deepdive.md` 第 113-117 行已在
另一個檔案(`exportScript` 的 `customColumns.field`)記錄過同一類「鍵名未過濾可指定 `__proto__`」的輸入形狀縫隙,
這是同一個問題模式在 shared 層的第二個例證。

**影響**:是否會真的造成原型污染,取決於下游是否用類似 `state[key] = value` 或未加防護的 `Object.assign` 方式消費
這個 `key`/`params`(**未在本檔驗證**)。即使下游有防護,這裡也值得補上一致的輸入過濾,避免每個消費端都要各自
重新做一次防禦。

**建議**:在 `coerceAgentAction` 的 `setParam`/`openDialog`/`toggleSetting` 分支,以及 Zod 的 `paramsRecord`,統一
排除 `__proto__`/`constructor`/`prototype` 鍵名。

---

## 🟢 低(Low)

### 發現 11 — `getPrimaryQuickAction` 是死碼:只有單元測試呼叫,沒有任何production程式碼使用

**cluster:deadcode**

**證據**:`appRegistry.ts:1513-1514`:
```ts
export const getPrimaryQuickAction = (pageId: string): AppPageQuickAction | undefined =>
  getPageById(pageId)?.quickActions[0];
```
全 repo `grep -rln "getPrimaryQuickAction"`(排除 `.test.` 檔)只命中 `shared/appRegistry.ts` 自己;唯一呼叫者是
`server/app-registry-selectors.test.ts:64`。實際上 `client/src/pages/AgentChat.tsx:583` 需要同樣邏輯時,是直接寫
`page.quickActions[0]`,並沒有呼叫這個共用函式——即這個抽象已經被繞過,形同虛設。

**影響**:純維護負擔,無安全/正確性影響。

**建議**:若確定沒有規劃用途就移除(連同其測試),或者讓 `AgentChat.tsx:583` 改用它以物盡其用。

---

### 發現 12 — `toggleSetting` 是全站唯一「已建模但零可達路徑」的 action type

**cluster:deadcode**

**證據**:`toggleSetting` 存在於 `AgentAction`(`agent-actions.ts:117-121`)、`KNOWN_ACTION_TYPES`
(`agent-plan-safety.ts:61`)、`AgentActionTypeSchema`(`agent-plan-schema.ts:21`)——三層都承認它是合法動作。但
`grep -n "toggleSetting" shared/appRegistry.ts` 沒有任何一個頁面在 `supportedActions` 裡宣告它(所有頁面清單裡
完全沒出現這個字串),`DEFAULT_ACTION_CAPABILITIES`(`global-agent-capabilities.ts`)也沒有這一項(見發現 1 的
13 種清單)。

**影響**:無實際風險(也就是完全打不到,連發現 1 那種「該檔案沒讀該讀的清單」的誤傷都不會發生,因為沒有任何頁面
宣稱支援它)。單純是一個目前完全不可達的功能分支,值得記錄以避免未來誤以為它已經在某處生效。

**建議**:確認是否有計畫中的頁面要用到(例如深色模式/自動存檔切換),若短期沒有就先不用處理;若排入計畫,記得同步
appRegistry 與 global-agent-capabilities 兩處清單(而不是只改一處,重蹈發現 1 的覆轍)。

---

### 發現 13 — `mergeFeedbackHistories` 的去重鍵在同毫秒時間戳下可能誤刪語意不同的事件

**cluster:other**

**證據**:`agent-actions.ts:939-956`,去重鍵為 `` `${ev.at}|${ev.actionType}|${ev.status}` ``——如果 session 內事件
與 DB 長期記憶事件剛好有相同的 `at`(毫秒級 `Date.now()`,批次寫入或測試環境有一定機率碰撞)、相同
`actionType`/`status`,但 `note`/`pageId` 不同,會被視為重複而只保留其中一筆。

**影響**:低風險邊角案例(丟失一則 feedback 記錄,不影響安全性/計費),僅在批次寫入或時鐘解析度不足的環境下才會
出現。

**建議**:去重鍵可以考慮加入 `note`/`pageId` 一併比較,或改用穩定 id 而非時間戳當去重依據。

---

## Negative Results(已核對、確認沒有問題的部分)

- **812f6fdb → HEAD 對本次四檔零 diff**(`git diff 812f6fdb HEAD -- shared/agent-actions.ts shared/agent-plan-safety.ts
  shared/agent-plan-schema.ts shared/appRegistry.ts` 空輸出),本文件所有行號可直接對照現行檔案使用。
- **`actionToWorkflowStep`(agent-plan-schema.ts:223-288)有編譯期窮盡性檢查**:`switch` 最後用
  `const _exhaustive: never = action;` 收尾,只要 `AgentExecutableAction` 新增一個字面量而這裡沒同步補 case,
  TypeScript 編譯就會直接報錯——這是全庫目前**唯一**一處「新增 action 類型時不可能被靜默漏收」的地方,值得當作
  修復發現 3/6/7/8 提到的其他清單(KNOWN_ACTION_TYPES、HIGH_RISK_ACTION_TYPES、DEFAULT_ACTION_CAPABILITIES、
  inferRiskLevelForAction、isDestructiveAction/isDestructiveAgentAction)的範本寫法。
- **v1 與 v3 的步驟數/送出數上限一致**:`AgentPlanSchema.steps`(agent-plan-schema.ts:143)與
  `AgentPlanV3Schema.steps`(:520)都是 `.max(12)`,`evaluateAgentPlanSafety` 的 `DEFAULT_MAX_STEPS = 12`
  (agent-plan-safety.ts:44)也一致;`DEFAULT_MAX_SUBMITS = 6`(:45)未發現與 schema 端有衝突之處。
- **`client/src/config/appRegistry.ts` 是乾淨的 re-export**,直接從 `shared/appRegistry.ts` 匯出全部符號,沒有
  client 端另外維護一份 `APP_PAGE_REGISTRY` 分岔副本——這條 SSOT 本身沒有 client/server 分岔問題,問題出在
  `agent-plan-safety.ts` 讀了不對的下游函式(見發現 1),不是 appRegistry 資料本身被複製走樣。
- **`enqueueAction`/`drainActionsForPage`/`sameSlot`(agent-actions.ts:392-432,1252-1261)邏輯正確**:
  `navigate` 動作被正確排除在 `drainActionsForPage` 之外(:422,對應型別註解「由 orb 層處理,頁面端不會收到這個」),
  過期判斷(`PENDING_ACTION_TTL_MS`)與去重槽位邏輯逐行核對後沒有發現邊界錯誤。
- **`buildOrbGuideStepPrompt`/`parseOrbGuideStepReply`/`tryParseJson`/`cleanString`/`truncate`
  (agent-actions.ts:1109-1249)防禦寫得紮實**:對 LLM 回覆的長度上限、控制字元剝除、markdown 圍欄剝除、額外選項
  數量上限都有處理,任何解析失敗都乾淨地回傳空物件讓呼叫端 fallback 回預設文案,沒有發現可以讓 LLM 回覆內容跳脫
  預期欄位範圍的路徑。
- **`AgentPlanSchema`/`AgentPlanV3Schema` 的 `superRefine` 澄清/直接執行必要條件檢查正確**
  (agent-plan-schema.ts:160-175,525-554):`shouldAskClarification` 与 `clarificationQuestion` 的互相要求、
  `direct`/`tasked` 模式下 `steps.length === 0` 的擋阻,都對應到合理的錯誤訊息與路徑,沒有發現可繞過的組合。

---

## 綜合建議(依修復順序)

1. **优先且必须同批修复**:發現 3 + 發現 6(execute_task 的 unknown_action 誤判 + 修完之後的風險分級地雷)—— 這是
   一個「看起来只要加一行就能修好」但實際上牽動三個函式的案例,單獨修任何一處都會製造新問題。
2. **發現 1(appRegistry 契約脫鉤)**影響面最廣,建議把 `GLOBAL_AGENT_CAPABILITY_REGISTRY` 改成從
   `APP_PAGE_REGISTRY.supportedActions` 直接生成,一次性消除「三份頁面能力清單各自維護」的根因。
3. **發現 2(evaluateWorkflowSafety 的 unknown_action 死碼)**與**發現 5(v3 navigate 路徑檢查缺失)**都是「閘門
   看起來存在但打不到目標」的同類問題,建議在同一輪修補裡處理,並各補一條回歸測試(餵一個刻意設計的「不合法
   actionType 的 workflow 步驟」/「navigate 到外部網域的 v3 plan」,斷言兩者都會被擋下)。
4. **根因層級的建議**:目前「哪些 AgentActionType 屬於高風險/破壞性/需要能力登記」在 `agent-actions.ts`、
   `agent-plan-schema.ts`、`agent-plan-safety.ts`、`global-agent-capabilities.ts` 四個檔案各自維護至少 6 份平行清單
   （AgentAction 型別本身、AgentActionTypeSchema、KNOWN_ACTION_TYPES、HIGH_RISK_ACTION_TYPES、
   isDestructiveAction、isDestructiveAgentAction、inferRiskLevelForAction、DEFAULT_ACTION_CAPABILITIES）。建議
   仿照 `actionToWorkflowStep` 已經在用的 `_exhaustive: never` 模式,把這些清單改成從單一 `Record<AgentActionType, {...}>`
   衍生(TypeScript 會強制要求每個 key 都存在),讓「新增一種 action 類型卻忘記更新某份清單」在編譯期就報錯,而不是
   靠人工記得同步更新四個檔案。這是本次發現的多數 contract-mismatch 問題的共同根因,也是投報率最高的結構性修復。

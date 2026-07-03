# Y5 — 光球 global agent 前端 + action 派發安全深挖
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:client/src/contexts/GlobalOrbChatContext.tsx(6567)、client/src/contexts/PageAgentContext.tsx、client/src/components/OrbUnifiedAssistant.tsx

## 稽核方法
逐段讀完三支目標檔案（`GlobalOrbChatContext.tsx` 用 offset 分段全讀、`PageAgentContext.tsx`/`OrbUnifiedAssistant.tsx` 全讀），沿著 `dispatch` / `dispatchMany` / `executeActions` / `executeGlobalActions` 呼叫鏈追進 `shared/agent-actions.ts`、`shared/global-agent-orchestrator.ts`、`shared/global-agent-workflows.ts`、`shared/agent-plan-schema.ts`、`shared/agent-plan-safety.ts`；並對每個「client 期待的欄位/白名單/UI 承諾」回 `server/routers/ai.ts`、`server/services/orbReplyParser.ts` 查證是否真的存在、契約是否一致。過程中有兩個初始假設在深挖後被推翻，已記錄在「已驗證排除的疑慮」，不列為正式發現。

---

## 發現一(CRITICAL):`runWorkflow` 執行引擎只有「事前一次性」確認卡,永遠沒有逐步確認 — 對照 W1/W8 的 client 布林當閘門病灶,這裡是更深一層的「閘門本身就沒接線」

### 證據

1. **`hasImplicitImageGeneration` 只檔「submit 且沒有 setModel」這一種形狀,完全不檢查 `reset`**
   `client/src/contexts/GlobalOrbChatContext.tsx:5394-5400`:
   ```ts
   const hasImplicitImageGeneration = pendingPlan.actions.some(action => {
     if (action.type !== "runWorkflow") return false;
     const hasSubmit = action.steps.some(step => step.actionType === "submit");
     if (!hasSubmit) return false;
     const hasExplicitModelSelection = action.steps.some(step => step.actionType === "setModel");
     return !hasExplicitModelSelection;
   });
   ```
   同檔全文對 `"reset"` 字串做 grep 是 0 筆命中 — `reset` 步驟從未被這個守門邏輯考慮過。只要 workflow 明確帶了 `setModel` 步驟(例如「換成 flux pro 然後送出」這種最常見的形狀,`shared/global-agent-workflows.ts` 內建的 client-only fallback workflow builder — 如 `buildBrandContentWorkflow`(:522)—本身就會產生 `setModel` + `submit` 組合;全檔 `actionType: "submit"` 出現 14 次),`hasImplicitImageGeneration` 就是 `false`。

2. **一旦 `policy === "always_approve"`(或 `autoApproveTools` 覆蓋全部步驟類型),整個 workflow 直接自動開跑,完全不經 `WorkflowConfirmationCard`**
   `client/src/contexts/GlobalOrbChatContext.tsx:5402-5409`:
   ```ts
   if ((policy === "always_approve" || everyStepIsAutoApprovedTool) && !hasImplicitImageGeneration) {
     setTimeout(() => { void startPendingWorkflowRef.current?.(); }, 0);
   }
   ```
   註解宣稱「Runtime gates (high-risk steps + per-step requiresApproval) still apply」(:5381-5382),但 `AgentWorkflowStep`(`shared/agent-actions.ts:236-282`)這個型別上根本沒有 `requiresApproval` 欄位 — 這個承諾在型別層級就不成立。

3. **即使使用者真的手動點下「開始執行」,`startPendingWorkflow` 也是無條件把 `requireConfirmation:false` 往下傳,對任何 policy 都一樣**
   `client/src/contexts/GlobalOrbChatContext.tsx:5756-5759`:
   ```ts
   await executeActions(plan.actions, {
     intent: plan.intent,
     requireConfirmation: false,
   });
   ```
   `executeActions` 內把這個值原封不動變成 `requireConfirmationForWorkflowSteps: false`(硬編碼,:3357-3358):
   ```ts
   requireConfirmation: options.requireConfirmation === true,
   requireConfirmationForWorkflowSteps: false,
   ```
   追進 `shared/global-agent-orchestrator.ts`,`runWorkflow` 的每一步 dispatch 走的是 `ctx.requireConfirmationForWorkflowSteps ?? false`(:1377-1380 / :1552-1555),而不是「扁平單一 action」路徑用的 `ctx.requireConfirmation ?? false`(:1552-1555 是同一份程式碼但用在非 workflow 分支 —見下方對照)。也就是說:**只要 action 被包進 `runWorkflow`,`PageAgentContext.dispatch()` 自己的 `isDestructiveAction()` 逐步確認閘門就被顯式關掉**,不管 `submit`/`reset` 是第 1 步還是第 10 步,不管使用者當初對整包計畫按下「開始執行」時到底看清楚了幾步。

4. **共用 orchestrator 內建的更精細守門機制(`confirmStep`、`estimateAndConfirmBudget`)在這支 client 從未被接線**
   `shared/global-agent-orchestrator.ts:939-940` 定義了逐步確認鉤子:
   ```ts
   if (ctx.confirmStep && shouldRequestStepConfirm(confirmationMode, s)) {
     const decision = await ctx.confirmStep(...)
   ```
   對 `client/src/contexts/GlobalOrbChatContext.tsx` 全文搜尋 `confirmStep` 是 **0 筆命中**。同理 `estimateAndConfirmBudget`(cost governor pre-flight,`shared/global-agent-orchestrator.ts:183-189`,`:1436`)也是 **0 筆命中**。結果是:LLM 或伺服端規劃器就算把 `RunWorkflowAction.confirmationMode` 設成 `"step-by-step"` 或 `"high-risk-only"`,在這支 client 上完全沒有作用 — `shouldRequestStepConfirm` 就算回傳 `true`,`ctx.confirmStep` 是 `undefined`,`if` 判斷式短路,永遠不會真的暫停等使用者確認。

5. **UI 對使用者的明文承諾與上述行為直接矛盾**
   `client/src/components/orb-agent/OrbAgentPresetCards.tsx` 的四組預設卡:
   - 「全自動代理」(`confirmationPolicy: "always_approve"`,:85-102):文案寫「信任光球，多步驟工作流自動跑完。**submit / reset 仍會問**。」(:87)— 但依上面 1–3 點,只要工作流同時有 `setModel`+`submit`(最常見形狀)或任何 `reset`,submit/reset **完全不會問**。
   - 「測試模式」(`confirmationPolicy: "confirm_all"`,:103-121):badge 寫「**每步確認**」,描述「全部動作必經人工確認」(:106/:120)— 但依第 3 點,不管 policy 是什麼,一旦使用者對 `WorkflowConfirmationCard` 按下「開始執行」,workflow 內的每一步都是 `requireConfirmation:false` 跑到底,從來沒有「每一步」個別確認過;使用者得到的其實是「整包計畫按一次鍵」而非「逐步確認」。

6. **`shared/agent-plan-safety.ts` 的伺服端安全網也是靠這個(其實不存在的)前端逐步閘門背書**
   `shared/agent-plan-safety.ts:218-229`:
   ```ts
   if (risk === "high" && !step.requiresApproval) {
     // Auto-fix: silently coerce requiresApproval=true on high-risk steps and
     // emit a warning instead of blocking. Runtime gates (orbTaskOrchestrator
     // + WorkflowConfirmationCard + user agent preferences) still enforce
     // approval at execution time, so the policy is preserved...
     step.requiresApproval = true;
   ```
   這段註解明確把「`WorkflowConfirmationCard` 在執行時仍會強制要求核准」當成安全網的一部分,拿來合理化「plan 驗證失敗時只警告、不擋」的決策。但 `WorkflowConfirmationCard` 對應的 `startPendingWorkflow` 從第 3 點證實只有一次性、非逐步的確認,且該次確認在 `always_approve`/`autoApproveTools` 情境下還可能被整段跳過。這代表伺服端一個關鍵的「反正前端會擋」假設,在前端根本不成立。

### 影響
- 選用「全自動代理」預設(或自訂 `autoApproveTools` 覆蓋到 workflow 常見步驟類型)的使用者,會在**完全沒有被詢問**的情況下,由光球跨頁跑完含真實 `submit`(fal.ai 真實計費生成)與 `reset`(清空當前草稿)的多步驟計畫 — 與該預設卡片自己承諾的「submit / reset 仍會問」直接矛盾,構成假的安全感。
- 就算使用者選的是預設值 `confirm_high_risk` 或刻意選了強調「每步確認」的「測試模式」,一旦對整包 workflow 按下唯一一次「開始執行」,後面每一步(包含中途新增的 submit/reset)都不會再問 — 對用來 debug/熟悉新功能的「每步確認」使用情境是明確的功能缺失。
- 這與 W1(`confirmBeforeGenerate` 預設關閉直接讓 `submit` 進 `handleGenerate()`)、W8(`ai.executeTools` 信任 client 傳的 `approved:true`)是同一類「client 端旗標被當成安全邊界」病灶的第三種變體:這次連旗標本身要保護的「逐步確認」機制都沒有被真正實作/接線,只是靠註解自我宣稱存在。

### 建議
1. 在 `GlobalOrbChatContext.tsx` 呼叫 `executeGlobalActions` 時真正提供 `confirmStep`(依 `RunWorkflowAction.confirmationMode` 彈出逐步確認卡)與 `estimateAndConfirmBudget`(串接 costEstimate,讓高預算計畫强制升級成逐步確認),而不是把兩者留白。
2. 把 `hasImplicitImageGeneration` 擴充成「掃描 `submit` 與 `reset` 兩種類型、且不論是否有 `setModel`」都視為需要人工確認,不要只堵一種形狀。
3. 修正/弱化「全自動代理」「測試模式」兩張卡片的文案,使其準確反映目前「只在啟動前問一次」的實際行為;或依文案落實真正的逐步/高風險限定確認。

---

## 發現二(HIGH):編編(composer)自然語言指令路徑硬編碼 `requireConfirmation:false`,且行內註解宣稱的「preferences 決定確認」根本不存在

### 證據
`client/src/contexts/GlobalOrbChatContext.tsx:4605-4613`:
```ts
try {
  await executeActions(parsed.actions, {
    intent: `編編：${cleanPrompt.slice(0, 40)}`,
    // 純頁面動作風險低；submit 時 executeActions 內部
    // 已會依 preferences 決定是否要彈確認卡。
    requireConfirmation: false,
  });
}
```
`parsed.actions` 來自 `shared/composer-imperative-parser.ts` 的 `parseComposerImperatives`,而該解析器在使用者純打字「送出」或「換成 flux pro 然後送出」這類句子時,會直接產生 `{ type: "submit" }`(`shared/composer-imperative-parser.ts:270-285`)。

但實際檢視 `executeActions`(`client/src/contexts/GlobalOrbChatContext.tsx:3203-3423`)全文,它**沒有任何一行**依 `preferences`/`confirmationPolicy` 重算確認與否 — 唯一影響確認行為的就是呼叫端直接傳進來的 `options.requireConfirmation`,這裡是寫死的 `false`。行內註解描述的「executeActions 內部已會依 preferences 決定是否要彈確認卡」與程式碼實際行為不符。

### 影響
- 使用者在對話框打「@編編 送出」(或任何被 `isPureSubmit`/`hasSubmitIntent` 判定為送出意圖的句子),只要頁面上已有提示詞,就會**立即**觸發真實付費生成,不經過 `askBeforeAct`/`shouldAskBeforeAct` 計算,也不受 `confirmBeforeGenerate`/`confirmationPolicy` 影響 — 與主要 LLM 派工路徑(:5496-5509,正確地算出 `askBeforeAct` 才決定要不要確認)不一致。
- 註解與程式碼行為不符,容易誤導未來維護者以為這裡有依偏好把關,實際上沒有。

### 建議
- 讓此呼叫改用與主路徑相同的 `shouldAskBeforeAct(parsed.actions, preferencesForChat, { currentPagePath: locationPath })` 計算結果,而不是寫死 `false`;或至少修正註解,誠實描述「這裡不檢查任何偏好，一律直接執行」。

---

## 發現三(MEDIUM):`context` 字串把 client 可完全控制的自由文字(選取文字、世界觀標題)未結構化地拼進送給 LLM 的欄位

### 證據
`client/src/contexts/GlobalOrbChatContext.tsx:4925-4933`:
```ts
const selectedTextHint = (() => {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return "";
  const selected = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (!selected) return "";
  const clipped = selected.length > 500 ? `${selected.slice(0, 500)}…` : selected;
  return ` · 使用者目前選取文字: ${clipped}`;
})();
```
以及 :4956-4963 把這段與 `worldContext.currentProject.title`/`worldFrameworkName`、`backendSummary`、`modeHint`、`parsedStructureHint` 一起接成單一 `context: string` 欄位送進 `aiChat.mutateAsync`。這整段字串沒有任何結構化分隔(不是獨立 JSON 欄位,只是文字串接),而 `window.getSelection()` 抓的是使用者當下在頁面上「反白選取」的任意文字 — 若頁面上存在使用者貼上的第三方文字、公開提示詞庫內容、或任何可被使用者選取到的字串,這段文字會被原樣塞進送給 LLM 的 `context`。

### 影響
- 這是一個「client 可完全控制的自由文字如何進入 prompt 組裝」的具體示例。雖然本檔案本身沒有進一步驗證伺服端如何處理這個 `context` 欄位(是否會被當成獨立、明確標記為「不可信任」的資料段落,或是直接混進系統/使用者訊息 — **未在本檔驗證**,需查 `server/routers/ai.ts` 內對 `input.context` 的實際 prompt 組裝方式才能確認風險等級),但結合發現一(auto-approve 情境下 workflow 全自動執行),理論上構成一條「選取文字 → LLM 誤讀成指令 → 產生 runWorkflow → 在 always_approve 使用者身上直接執行」的鏈路。
- `ChatAttachment.extractedText`(:153-165,上傳 .txt/.md/.docx 會被抽出全文並「inline 進使用者訊息本文」)是同一類風險的另一個入口,兩者都是預期功能(讓 LLM 讀腳本/選取內容),非單純 bug,但都是「prompt 組裝把 client 可控文字直接送出」的真實案例,值得在威脅模型中記錄。

### 建議
- 若尚未做,建議伺服端把 `context`/`selectedTextHint`/`extractedText` 等使用者可控字串明確標記為「參考資料,非指令」的獨立區段(例如用 XML/JSON 分隔而非字串拼接),降低被解讀成可執行指令的機率。

---

## 發現四(MEDIUM):`PageAgentContext.dispatch()` 對 `navigate` 動作的直接處理沒有走 orchestrator 的已知路由白名單檢查

### 證據
`client/src/contexts/PageAgentContext.tsx:332-344`:
```ts
if (action.type === "navigate") {
  const targetPath = action.path;
  if (targetPath && targetPath !== locationPathRef.current) {
    setLocation(targetPath);
  }
  reportFeedback({ status: "completed", actionType: "navigate" });
  return { ok: true, message: `navigated to ${targetPath}` };
}
```
`action.path` 唯一的型別檢查是 `coerceAgentAction`(`shared/agent-actions.ts:561-563`)的 `typeof (obj.path ?? obj.payload) === "string"` — 任何字串都會通過。相對地,`shared/global-agent-orchestrator.ts` 自己的 `executeGlobalAction` 在真的要換頁前,會先呼叫 `isKnownRegistryPath(step.path)`(:1503-1514)擋掉未註冊路徑。但當 `navigate` 是**直接**丟進 `PageAgentContext.dispatch()`(例如 `OrbGuidePanel`「直接帶我去」按鈕,或本檔內其他呼叫端)時,完全繞過那道白名單檢查,直接呼叫 wouter 的 `setLocation()`。

### 影響
- 這不是可執行任意程式碼或開放重導向到外部網域的漏洞(`setLocation` 只操作 SPA 內部路由狀態,不接受絕對 URL/協定),但確實是「同一個 `navigate` action type,兩條 dispatch 路徑,一條有白名單、一條沒有」的契約不一致 — 若日後有任何呼叫端把未經 `coerceAgentAction`/`isKnownRegistryPath` 驗證的路徑字串直接塞進 `pageAgent.dispatch({type:"navigate", path})`,SPA 可能被導去不存在的路由(使用者看到的行為取決於 App 對未知路由的 fallback,例如 404 頁),沒有更深一層的伺服端或型別把關。

### 建議
- 讓 `PageAgentContext.dispatch()` 的 `navigate` 分支也呼叫與 orchestrator 相同的 `isKnownRegistryPath` 檢查(或直接複用同一個檢查函式),讓兩條路徑的白名單行為一致。

---

## 發現五(LOW,dead-ui):`executeApprovedTask` / `ApprovedTask` / `approvedByB` 完整實作但整個程式庫從未被呼叫

### 證據
`client/src/contexts/PageAgentContext.tsx:98-104`(型別)、:468-512(完整實作,含逐步狀態機 `AgentTaskExecutionState`)。對整個 repo(含 `client/src`、`server`、`shared`)搜尋 `executeApprovedTask`/`ApprovedTask`,**唯一**的呼叫端就是這個函式自己的定義與其 `noop` fallback(:234);另一個提及處是 `docs/audits/brain-route-scan-2026-04-21.md:93-104`,內容是「下一步可直接下給 A 線的執行規格」的設計文件,描述的正是這組型別要對接的「B 已批准指令」流程 — 但依規格的第 2/3 步(頁內執行 + 執行中 UI)從未被任何頁面/元件實際接上 `executeApprovedTask`。

### 影響
- 這是一個依照內部稽核文件規格完整寫好、但從未被任何 UI 呼叫的「A/B 兩層審批」執行引擎,目前完全不會被觸發,對使用者沒有風險,但也沒有提供文件承諾的價值。
- 附帶一提:`if (!task.approvedByB || task.source !== "B")`(:487-488)這個檢查本質上只是比對一個 client 自建物件裡的布林 + 字面量字串,沒有任何簽章或伺服端驗證 — 若未來真的把某個呼叫端接上 `executeApprovedTask` 且該 `ApprovedTask` 物件是由前端(而非伺服端簽發)組裝,這組「approvedByB」閘門會是與 W8 `approved:true` 同類、可被任意繞過的自我宣告旗標。目前因為完全沒有呼叫端,這只是設計提醒,不是現行漏洞。

### 建議
- 若計畫維持這條路線,建議接線時把 `approvedByB` 改成由伺服端核發、可驗證的憑證(例如伺服端簽發的一次性 token),而非單純的 client 端布林;若已棄用該設計,建議移除死碼並更新對應的稽核文件。

---

## 已驗證排除的疑慮(negative results)

1. **「WorkflowConfirmationCard / NavigationConfirmationCard 只在 `/agent` 頁面渲染,其餘頁面(浮動光球)是死 UI」— 初始假設,已被推翻。**
   一開始只在 `AgentChat.tsx`(:2438-2457)找到對 `pendingWorkflow`/`pendingNavigation` 的引用,一度懷疑浮動光球(`ProactiveOrbWidget`/`OrbGuidePanel`/`OrbUnifiedAssistant`)完全沒有對應 UI,會讓跨頁確認卡永遠卡住。深挖後在 `GlobalOrbChatContext.tsx` 自己的 Provider render 輸出(:6424-6522)找到這些卡片其實是**由 Provider 本身**以 `fixed` 定位全域渲染(桌面版右下/左下堆疊、手機版底部堆疊),`App.tsx:442-462` 把 `GlobalOrbChatProvider` 掛在整個路由樹外層 — 因此除了 `/agent` 頁自己會用行內卡片(並主動 suppress 浮動版避免重複渲染,:6424-6428)之外,所有頁面都能看到這些卡片。**此假設不成立,不列入正式發現。**

2. **`PendingConfirmation`(`isDestructiveAction` 觸發的確認卡)是否有 UI 消費 — 已確認有,非死碼。**
   `AgentIntentPreview.tsx` 是唯一消費者,且已確認掛在 `DashboardLayout.tsx:961`(`{user && <AgentIntentPreview />}`),對登入使用者全域可見。

3. **`coerceAgentAction`/`parseLLMActions` 的 action type 白名單機制運作正常。**
   `shared/agent-actions.ts:511-706` 的 `switch` 對每個已知 type 個別驗證欄位型別,`default: return null`(:703-704);未知 type 一律被 `parseLLMActions` 丟棄,不會進入 dispatch。

4. **`RunWorkflowAction.steps` 在解析階段(`coerceWorkflowStep`)雖不驗證 `actionType` 是否為已知類型,但執行前(`workflowStepToAction`,`shared/global-agent-workflows.ts:77-124`)有第二層白名單擋掉未知類型(`default: return null`,搭配 `expandWorkflowAction` 的 `if (!concrete) continue`)。** 兩層合起來沒有讓未註冊的 action type 真正被 dispatch,只是白名單延後到執行前才生效,非漏洞。

5. **`OrbUnifiedAssistant.tsx` 本身沒有引入額外的確認繞過。**
   全檔搜尋確認:它從未對 `pageAgent.dispatch()` 傳入 `requireConfirmation`(無論是 quickActions 的 `dispatch(qa.action,{source:"manual"})`、`fillPromptCap`/`setModelCap` 的呼叫都只傳 `source`),因此正確地落回 `PageAgentContext.dispatch()` 的預設 `isDestructiveAction()` 判斷。它派發的 action 類型(`fillPrompt`/`setModel`)也都不在 `isDestructiveAction` 清單內。

6. **`OrbUnifiedAssistant.tsx` 呼叫的 tRPC 端點與 server 端契約一致,無 contract-mismatch。**
   逐一比對 `credits.myBalance`(`server/routers/credits.ts:55`)、`credits.pricingCatalog`(:10)、`accountant.estimate`/`compare`/`usage`(`server/routers/accountant.ts:21/36/68`)、`notes.*`(`server/routers/notes.ts`)、`promptLibrary.*`(`server/routers/promptLibrary.ts`)均存在對應的 router 實作。

7. **`data.askBeforeAct` 是伺服端真實回傳的欄位,非 client 憑空假設的契約。**
   `server/routers/ai.ts` 內至少 10 處明確設定 `askBeforeAct`(例如 :2253-2256、:2297、:2350、:2602),且 `server/services/orbReplyParser.ts` 的 `ORB_DESTRUCTIVE_ACTIONS`(:92-101)把 `runWorkflow` 列為破壞性動作,會強制該欄位為 `true`。問題不在契約缺失,而在發現一所述——client 在 `pendingPlan`(`runWorkflow`)分支完全沒有讀取這個欄位(`askBeforeAct` 字串在全檔只出現在 :5497-5509,屬於 `pendingPlan` 為 `null` 時才會執行到的另一條分支)。

8. **`runWorkflow` 不是遺留/已停用的動作類型。**
   `server/services/orbReplyParser.ts` 的 `ORB_ALLOWED_ACTIONS`(:59-86)明確把 `runWorkflow` 列在「Phase 4:全站代理人擴展」白名單內,證實發現一所述路徑是現行、仍在使用的功能,不是可以忽略的死路徑。

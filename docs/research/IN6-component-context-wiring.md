# IN6 — 元件間接線（context/props/callback）

- 產生日期：2026-07-03
- 依據 commit：579a5100（HEAD；任務指定的 812f6fdb 為其祖先版本，本稽核以現況樹為準）
- 稽核接縫：`client/src/contexts/{GlobalOrbChatContext,ProjectsContext,PageAgentContext,BackgroundTasksContext,WorldContextContext}.tsx` ↔ 其 consumer 元件

## 方法

逐一讀完五個 context 檔（GlobalOrbChatContext.tsx 6567 行、ProjectsContext.tsx 495 行、
PageAgentContext.tsx 598 行、BackgroundTasksContext.tsx 618 行、WorldContextContext.tsx 209 行），
抓出每個 context 對外的 `*ContextValue` 介面／`createContext` 預設值／`useMemo` 組出的實際
`value`，再用 grep 找出所有 `useXxxContext()` / `useXxx()` consumer，逐一比對欄位名稱、callback
簽章、以及「呼叫端怎麼詮釋回傳值」。凡是兩端都讀過、判斷「接得對」的也列在最後一節，不只列問題。

---

## 發現（按嚴重度排序）

### F1（High）broken-wiring — `/agent` 頁的跳頁確認卡（NavigationConfirmationCard）重複渲染

**接縫斷點**
- 端 A（Provider 的「floating 版本自動 suppress」邏輯）：
  `client/src/contexts/GlobalOrbChatContext.tsx:6416-6428` —— 註解明講「偵測到 /agent 時把
  **這三張卡**（Clarification / Workflow confirm / Workflow exec）的 prompt 設為 null 給
  floating 版本，避免重複渲染」，程式碼也確實只把 `floatingClarification` /
  `floatingWorkflow` / `floatingExecution` 三個變數在 `onAgentPage` 時清成 `null`
  （`client/src/contexts/GlobalOrbChatContext.tsx:6424-6428`）。
  但 `NavigationConfirmationCard` 在桌面版（`:6501-6506`）與行動版（`:6445-6450`）都是直接
  傳入**未經過濾**的 `pendingNavigation`，沒有比照其他三張卡做 `onAgentPage ? null : pendingNavigation`
  的 gating。
- 端 B（`/agent` 頁自己也 inline 渲染同一張卡）：
  `client/src/pages/AgentChat.tsx:2396-2401` 的註解寫「GlobalOrbChatProvider 也偵測 /agent
  路徑時自動 suppress floating 版本，避免雙重顯示」，並在 `:2402-2405` 的條件式裡把
  `globalChat.pendingNavigation` 也算進「要不要顯示 inline pending 卡」的判斷，於
  `:2438-2444` 渲染自己的 `<NavigationConfirmationCard pendingNavigation={globalChat.pendingNavigation} .../>`。

**影響**：當光球在對話中提出跨頁導航（`executeActions` 內的 `confirmNavigation` 分支，
`GlobalOrbChatContext.tsx:3369-3385`）且使用者目前正停留在 `/agent` 頁時，畫面上會同時出現
**兩張**「光球準備跳頁，等你點確認」卡片 —— 一張是 Provider 全域掛載的 floating 卡（右下角／
手機版堆疊），一張是 `/agent` 頁自己 inline 在聊天區的卡。這是舊有假設（「這三張卡都會被
suppress」）在 `pendingNavigation` 功能後續加入時沒有同步更新 suppress 清單所致的程式碼漂移，
两端读起来都能各自解释得通，但合起来就是重复渲染。

**建議**：在 `GlobalOrbChatContext.tsx` 的 `onAgentPage` 判斷式旁加入
`floatingNavigation = onAgentPage ? null : pendingNavigation`，並把 6445 / 6501 兩處的
`pendingNavigation={pendingNavigation}` 改成 `pendingNavigation={floatingNavigation}`，或反過來
在 `AgentChat.tsx` 拿掉 inline 版本，二擇一即可、但要更新雙邊註解使其保持一致。

---

### F2（High）contract-mismatch — `dispatchMany` 回傳 `AgentActionResult[]`，呼叫端當 boolean 用 → 破壞性動作出現「假成功」toast

**接縫斷點**
- 端 A（宣告 + 實作）：
  - 介面：`client/src/contexts/PageAgentContext.tsx:170-173`
    ```ts
    dispatchMany: (
      actions: AgentAction[],
      opts?: DispatchOptions
    ) => Promise<AgentActionResult[]>;
    ```
  - 實作：`client/src/contexts/PageAgentContext.tsx:454-458`，回傳的是逐一 `dispatch()` 結果組成
    的陣列（永遠是陣列，非空陣列在 JS 中恆為 truthy）。
  - `dispatch()` 對破壞性動作（`submit`/`reset`/`applyPreset`/`setModality`/…，見
    `shared/agent-actions.ts:764-778`）的分支（`PageAgentContext.tsx:421-435`）不會真的執行
    action，只是 `setPendingConfirmation(...)` 後立刻 `return { ok: true, message: "awaiting user
    confirmation" }`——也就是說「已經 resolve」不代表「已經做完」。
- 端 B（呼叫端把回傳陣列當 boolean）：
  - `client/src/components/OrbGuidePanel.tsx:113-128`（`useOrbActionRunner`，供 t2i / edit /
    upscale / pose / sd 五個 Image Studio 面板與多處導覽卡共用）：
    ```ts
    const ok = await pageAgent.dispatchMany(actions, { source: "manual" });
    if (ok) {
      toast.success(`已執行：${label}`);
      if (closeAfter) onClose();
    }
    ```
    `ok` 型別其實是 `AgentActionResult[]`，`if (ok)` 只要陣列存在就一定為真——不論陣列裡每個
    action 實際 `ok: true/false`，也不論該 action 是否根本還沒執行、只是被塞進
    `pendingConfirmation` 等使用者按「好啊」。
  - 同一 bug 在 `client/src/pages/Studio.tsx:1360-1371`（「徵詢導演」按鈕）以更直接的形式出現：
    連 `ok` 都不檢查，`await pageAgent.dispatchMany(result.actions, ...)` 後直接
    `toast.success(...)`。
  - 具體可重現路徑：`client/src/components/OrbGuidePanel.tsx:761-766` 的「氛圍」chip 呼叫
    `buildImageStudioApplyVibeActions(v.id)`（`shared/orb-studio-actions.ts:392-399`，回傳
    `[{type:"setTab"}, {type:"applyPreset", presetId}]`）。`applyPreset` 是破壞性動作
    （`shared/agent-actions.ts:768`），所以使用者點一下氛圍 chip 時：
    1. `runActions` 立刻顯示 `"已執行：加入「電影感」氛圍"`（toast.success）；
    2. 但 `applyPreset` 這個 action 其實才剛被塞進 `pendingConfirmation`，真正要問使用者的文案
       是 `summarizeAction` 產生的 `"想套用「cinematic」這組預設"`
       （`shared/agent-actions.ts:810-811`），透過全站掛載的
       `client/src/components/AgentIntentPreview.tsx`（掛載點：
       `client/src/components/DashboardLayout.tsx:961`）另外冒出一張「光球想跟你確認一下」卡片。
    使用者會同時看到「已執行」與「想套用……好啊/先不要」兩個互相矛盾的訊息；若使用者忽略/
    划掉確認卡，氛圍其實從未真的套用，但「已執行」的 toast 已經誤導他相信完成了。
  - 同款按鈕（「送出…（API）」「重設此頁」）在 `OrbGuidePanel.tsx` 內出現十餘處（例如
    `:889` `:1161` `:1176` `:1353` `:1367` `:1520` `:1534` `:1827` `:1839` `:2125` `:2137`
    `:2389` `:2403`），全部都是單一 `submit`/`reset` action、且都經過 `useOrbActionRunner`，
    因此每次點「送出」都會先跳出「已執行：送出生成（API）」，即便該次 submit 因為是破壞性
    動作而其實正停在確認卡等待使用者點頭——文案上把「還沒做」講成「已做完」。

**影響**：使用者對「這顆按鈕按下去到底做了沒」會得到自相矛盾的兩份回饋，且失敗案例（page
handler 回傳 `ok:false`）也會被這個永真判斷吃掉，不會顯示錯誤 toast，`closeAfter` 還是會關閉
面板，讓使用者以為送出成功、實際上沒有。

**建議**：`useOrbActionRunner`／`Studio.tsx` 改成檢查 `results.every(r => r.ok)`，並對
`message === "awaiting user confirmation"` 的項目特殊處理（不要顯示「已執行」，維持沉默讓
`AgentIntentPreview` 卡片自己接手）。

---

### F3（Medium）race — `PageAgentContext.pendingConfirmation` 是單一物件，非佇列

**接縫斷點**
- `client/src/contexts/PageAgentContext.tsx:421-435`：`dispatch()` 對破壞性動作一律
  `setPendingConfirmation({...})`，覆蓋（不合併/不排隊）任何既有的 pending 項目。
- `client/src/contexts/PageAgentContext.tsx:454-458`：`dispatchMany` 是 `for...of` +
  `await dispatch(...)` 的序列迴圈；但因為 F2 提到的「`dispatch()` 對破壞性動作立刻
  resolve、不等使用者真的按確認」，這個 `await` 幾乎不花時間，迴圈會在同一個 tick 內連續呼叫
  `setPendingConfirmation`，若一次 `dispatchMany` 傳入 2 個以上破壞性動作，只有**最後一個**
  會留在 state 裡；前面的請求連 `AgentIntentPreview`
  （`client/src/components/AgentIntentPreview.tsx:31` 只 render 單一
  `pendingConfirmation` 物件，不是陣列/佇列）都沒機會顯示就被覆蓋、resolve 值
  `{ ok: true, message: "awaiting user confirmation" }` 仍然回給呼叫端，形同「已排隊確認」的
  承諾沒兌現。

**現況查核**：目前在 repo 內找到的 `dispatchMany` 呼叫點（`OrbGuidePanel.tsx`、
`ProactiveOrbWidget.tsx`、`Studio.tsx`）都沒有在同一次呼叫裡塞入 2 個以上「未顯式
`requireConfirmation:false`」的破壞性動作——多動作呼叫（如
`ProactiveOrbWidget.tsx:1949` `:2126` `:2161`）都明確帶了 `requireConfirmation: false`，繞開此
機制；`GlobalOrbExecutor`／`useGlobalOrbExecutor.ts:47` 也是固定傳
`requireConfirmation: false`（因為它自己有 `approvedSteps` 這套獨立的逐步核准機制，見
`client/src/agent/GlobalOrbExecutor.ts:205-237`，兩者不衝突）。**因此這是一個機制上確認存在、
但截至 HEAD 尚未找到會觸發的呼叫點的潛伏競態**——未在兩端找到目前活著的觸發路徑，故標記
Medium 而非 High；一旦未來新增「LLM 一次規劃多個破壞性 UI 動作又不主動 `requireConfirmation:false`」
的呼叫路徑就會立刻現形。

**建議**：把 `pendingConfirmation` 改成 `pendingConfirmations: PendingConfirmation[]`（佇列），
`AgentIntentPreview` 依序顯示／逐一 `confirmPending()`；或至少在 `dispatch()` 偵測到已有
pending 項目時把新請求排隊而非覆蓋。

---

### F4（Medium）broken-handoff — Conversation CRUD 的 server 端失敗只 `console.warn`，不通知使用者（與既有 `ProjectNotesDrawer` 缺 `onError` 為同型態缺口）

**接縫斷點**
- `client/src/contexts/GlobalOrbChatContext.tsx:6128-6157`（`createConversation`）、
  `:6273-6282`（`renameConversation`）、`:6287-6298`（`deleteConversation`）三處對
  `createConversationServer` / `updateConversationServer` / `deleteConversationServer` 的
  `mutateAsync` 都只用 `try { await ... } catch (err) { console.warn(...) }` 吞掉失敗，**沒有
  `toast.error` 或任何 UI 訊號**。
- 對照：`client/src/components/ProjectNotesDrawer.tsx:182-187` 的 `trpc.notes.create.useMutation`
  同樣只設 `onSuccess`、沒有 `onError`（本次稽核範圍外的元件，但正是任務指定的參照樣板）——
  兩處是同一種「client 端已經樂觀更新完 local state，server 端失敗卻無聲無息」的缺口形狀。
- 尤其 `deleteConversation`（`:6287-6337`）在 server 端 `deleteConversationServer.mutateAsync`
  失敗（例如網路抖動、對話已在其他裝置被刪除的 404 以外錯誤）時，仍會繼續往下把該對話從
  `conversations` state 與 `localStorage` 移除（`:6299-6311`）——本機看起來「已刪除」，但
  server 端那筆列可能還在，下次跨裝置同步／伺服器端列表重新拉取時可能又冒出來，使用者完全
  不會被告知這個不一致。

**影響**：多裝置情境下，重新命名/刪除對話的 server 端寫入若失敗，使用者拿到的是「本機顯示已成功」
但「伺服器端仍是舊狀態」的分歧，且沒有任何錯誤提示可以讓使用者知道要重試。

**建議**：至少在 `catch` 分支補一個低調的 `toast.error`（例如「已在本機更新，但可能未同步到雲端」），
讓使用者有機會重新整理／重試，而不是完全靜默。

---

### F5（Low）other — `WorldContextContext` 是五個 context 裡唯一沒有用 `useMemo` 包裝 Provider value 的

**接縫斷點**
- `client/src/contexts/WorldContextContext.tsx:190-203`：
  ```ts
  const value: WorldContextValue = { currentProjectId, setCurrentProjectId, ... };
  return <WorldContext.Provider value={value}>{children}</WorldContext.Provider>;
  ```
  每次 `WorldContextProvider` 重新 render（包含它自己的 `trpc.creativeProject.get.useQuery` /
  `trpc.worldbuilding.summarizeForPrompt.useQuery` 週期性 refetch、或任何父層 re-render）都會
  產生一個全新的 `value` 物件，`setCurrentProjectId` 本身也是每次 render 重新宣告的箭頭函式
  （`:115-118`，未用 `useCallback`）。
- 對照組：其餘四個 context 的 provider value 全部用 `useMemo` 包裝
  （`ProjectsContext.tsx:322-345` / `:446-467`、`PageAgentContext.tsx:538-556`、
  `BackgroundTasksContext.tsx:557-570`、`GlobalOrbChatContext.tsx:6352-6391`）。
- 下游已知副作用：`ProjectsContext.tsx:251-261` 的 `setActiveProjectId` 把
  `world.setCurrentProjectId` 放進 `useCallback` 依賴陣列，並用
  `// eslint-disable-next-line react-hooks/exhaustive-deps -- WorldContext 的 setter 每次
  render 都是新函式；以 provider 身分穩定即可` 承認了這個不穩定性——即該檔案的作者已經知道
  `WorldContextContext` 的 setter 每次都是新函式，選擇繞過而非在源頭修掉。

**影響**：任何只讀 `useWorldContext()` 的元件（`ProjectsContext`、`GlobalOrbChatContext`、
Studio 頁面等）都會在 `WorldContextProvider` 每次 re-render 時被迫重新 render，即使
`currentProjectId`／`currentProject`／`consistencyPrefix` 等實際值完全沒變。目前看沒有造成
資料錯誤（值本身讀取正確），純粹是效能與「context 更新是否真的對應到值變化」一致性上的
架構漂移。

**建議**：把 `value` 與 `setCurrentProjectId` 分別包 `useMemo` / `useCallback`，讓
`WorldContextContext` 與其餘四個 context 的記憶化慣例一致。

---

## 已驗證接得對的接縫（negative results）

以下皆為「讀完兩端、確認欄位/回呼/型別一致」的正向結果，列出以避免稽核報告只講壞消息：

1. **`GlobalOrbChatContext` 預設 stub 與真實 Provider value 形狀一致**——`createContext` 的預設物件
   （`GlobalOrbChatContext.tsx:2164-2203`）逐欄位對照 `GlobalOrbChatProvider` 實際組出的
   `value`（`:6352-6391`），欄位數與型別完全對得上，Provider 尚未掛載時的 fallback 不會讓
   consumer 讀到 `undefined`。
2. **`useGlobalOrbChat()` 的 16 個 consumer 檔案**（`ProactiveOrbWidget.tsx`、`OrbGuidePanel.tsx`、
   `CommandPalette.tsx`、`AgentSettingsSheet.tsx`、`DashboardLayout.tsx`、
   `OrbUnifiedAssistant.tsx`、`AidvOrbMount.tsx`、`useGlobalChatShortcut.ts`、
   `useSlashCommandContext.ts`、`emptyPromptHelper.ts`、`AgentChat.tsx`、`ProcessViewerPage.tsx`、
   `DashboardPage.tsx`、`ConversationTabs.tsx`、`CollaborativeDiscussionLauncher.tsx`）逐一
   grep 出的欄位存取（`messages`/`input`/`isSending`/`pendingClarification`/`pendingNavigation`/
   `pendingWorkflow`/`workflowExecution`/`conversations`/`activeConversationId`/
   `createConversation`/`switchConversation`/`renameConversation`/`deleteConversation`/
   `startCollaborativeDiscussion`/`collaborativeDiscussionMeta` 等）全部存在於介面
   （`GlobalOrbChatContext.tsx:2016-2121`）裡，沒有讀到 provider 沒給的欄位。
3. **`AgentChat.tsx` 的本地 `input`/`setInput` 其實就是 `globalChat.input`/`globalChat.setInput`
   的別名**（`pages/AgentChat.tsx:716-717`），`CollaborativeDiscussionLauncher` 的
   `onAfterLaunch={() => setInput("")}`（`pages/AgentChat.tsx:1604-1608`）確實清得到同一份
   context state，跨元件的 clear-after-launch 回呼有接上。
4. **`DashboardLayout.tsx` 的 `context_near_full` proactive 事件 → `orbChat.createConversation()`
   CTA**（`:547-558`）與 `GlobalOrbChatContext.tsx:2868-2895` 發布該事件的 `publish` 呼叫，
   `dedupeKey`／事件名稱兩端字串一致，端到端可追。
5. **`switchConversation` 的跨對話污染防護**（`GlobalOrbChatContext.tsx:6205-6219`）：await
   期間使用者若又切走再切回（A→B→A），用 `activeConversationIdRef.current !== conversationId`
   比對，確保過期的 fetch 結果只寫回 `localStorage`、不會誤把 B 對話的訊息混進目前顯示的 A。
6. **`approvePendingNavigation`/`declinePendingNavigation` 防止重複 resolve**
   （`GlobalOrbChatContext.tsx:5817-5841`）：兩者都在開頭 `if (!active) return;`，就算 F1
   描述的重複渲染卡片被連點兩次，也不會對同一個 Promise resolve 兩次或丟例外。
7. **`useGlobalOrbExecutor` 的 `dispatchAction` 明確傳 `requireConfirmation: false`**
   （`client/src/agent/useGlobalOrbExecutor.ts:47`），因為 `GlobalOrbExecutor` 自己有一套獨立
   的逐步核准機制（`approvedSteps` / `needsExplicitApproval`，
   `client/src/agent/GlobalOrbExecutor.ts:205-237`）。這條路徑與 `PageAgentContext` 自己的
   `pendingConfirmation` 機制刻意不重疊，沒有雙重確認的衝突。
8. **`useBackgroundTasks()` 的 12 個 consumer**（`ProStudio.tsx`、`ImageStudio.tsx`、
   `useSubmitGeneration.ts`、`SegmentProgressLabel.tsx`、`BackgroundTasksDrawer.tsx`、
   `ActiveVideoTasksBanner.tsx`、`Studio.tsx`、`DirectorAI.tsx`、`SSEFallbackBanner.tsx`、
   `AppleDock.tsx`）讀取的欄位（`tasks`/`activeCount`/`sseConnected`/`previewUrls`/
   `segmentProgress`/`notifyJobStarted`/`drawerOpen`/`setDrawerOpen`）全部對得上
   `BackgroundTasksContextValue`（`BackgroundTasksContext.tsx:148-174`）。
9. **`BackgroundTasksContext.submitTask` 已修過的 onError 缺口**
   （`BackgroundTasksContext.tsx:538-547`）：程式碼註解本身記錄了「之前這裡只 `return null`
   把送出失敗整個吞掉」的舊 bug，現況已改成 `console.error` + `toast.error` 顯性化失敗——與
   F4 描述的「目前仍未修」形成對照組，證明同一類缺口在這個 context 內其他地方（`submitTask`）
   已被處理過，只是 conversation CRUD 那三個 mutation 還沒套用同樣的修法。
10. **`segmentProgress` SSE 競態已有 fallback 兜底**：`SegmentProgressLabel.tsx:1-13` 的檔頭註解
    與 `segmentProgress.ts:1-15` 都記載了「`segment_started`/`segment_completed` 兩個 SSE 事件
    會因『訂閱晚於 emit』與『complete 後才 emit、連線已關』而結構性漏接」的已知限制，但
    `SegmentProgressLabel.tsx:29-32` 用 `segmentProgress?.[jobId] ??
    deriveSegmentProgressFromJobMeta(resultJson)` 做兩層 fallback，兩端資料源都缺時才安靜地
    render `null`——是一個「知道有競態、已經設計了降級路徑」的健康接縫，不需要新開 finding。
11. **`useProjects()` 的 9 個 consumer**（`ProjectDetailPage.tsx`、`ContinueWhereYouLeftOff.tsx`、
    `ProjectsListPage.tsx`、`CreationHub.tsx`、`ProjectSelector.tsx`、`OrbFloatButton.tsx`）讀取的
    `projects`/`activeProjectId`/`getProjectById`/`setActiveProjectId`/`isLoading`/`error`/
    `activeProject` 全部存在於 `ProjectsContextValue`（`ProjectsContext.tsx:53-72`），SSOT／Mock
    兩條路徑（`RealProjectsProvider`/`MockProjectsProvider`）也都各自完整實作同一份介面，沒有
    consumer 讀到只有其中一條路徑才有的欄位。
12. **`createProject` 的樂觀更新沒有提前把 `activeProjectId` 指向臨時負數 id**
    （`ProjectsContext.tsx:268-314`）：`world.setCurrentProjectId(id)` 是在
    `await createMutation.mutateAsync(...)` **resolve 之後**才呼叫，用的是伺服器回傳的真實 id，
    不會有「使用者建立專案後被導去一個之後會消失的臨時 id」的競態。

---

## 已知接縫斷點（prior，僅確認現況，未重複展開）

- **SSOT-1**（`appRegistry.supportedActions` ↔ `hasCapabilityForPage` 脫鉤）：在
  `PageAgentContext.tsx:362-374` 看到的是**第三套**能力宣告來源——執行期由
  `useRegisterPageAgent` 註冊進 `page.snapshot.capabilities`，只在 dispatch 時 `console.warn`
  （不擋執行）；而 `client/src/agent/GlobalOrbExecutor.ts:228` 走的是
  `shared/global-agent-capabilities.ts` 的靜態 `hasCapabilityForPage`，不合就直接 `throw`。
  兩套機制（PageAgentContext 的執行期 warn-only 檢查 vs. GlobalOrbExecutor 的靜態 throw 檢查）
  確認仍分開存在、未合流，與既有 SSOT-1 描述的脫鉤現象一致——本次未再深入展開，因為根因在
  `shared/` 層而非本次五個 context 檔本身。

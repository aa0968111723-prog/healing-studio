# IN5 — 頁面間交接(navigation + 狀態傳遞)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb（任務指定值；本 repo `git cat-file -t 812f6fdb` 查無此物件，未在兩端驗證。實測以 `git rev-parse HEAD` 取得的實際 HEAD `cbccc30189a4ec94c4835421398762ce06392cec`（短碼 `cbccc301`，2026-07-03 22:55:03 +0000）為準，本文所有行號皆對照此 commit）
- 稽核接縫:全站 client:路由(App.tsx/shells/*)、sessionStorage/localStorage 交接、query-param(?docId= 等)、光球 navigate、深連結

## 讀法
- 「接縫斷點」一律列兩端(client 期待 vs 實際渲染/處理端)的 `檔案:行號`，兩端皆已用 Read 工具實讀，不臆測。
- 嚴重度：**P0**(使用者完全不可達/資料靜默流失) > **高**(功能可達但體驗/資料明顯壞掉) > **中**(降級但不崩潰) > **低**(理論風險/已有防線)。
- 全域旗標現況(已讀值，非臆測)：`ENABLE_4SHELL` 預設 `true`(`client/src/config/featureFlags.ts:53`)、`SHELL_LEARN_RICH` 預設 `true`(`client/src/shells/learn/learnFlags.ts:31`)、`SHELL_SETTINGS_RICH` 存在但本次未逐行驗證其預設值——本文假設「線上預設路徑」= 兩個旗標皆 ON 的狀態。

---

## P0 — 接縫斷點

### IN5-01 · `/assets?section=X` 深連結整組死亡：`getInitialSection()` 硬編死值，四個舊路由 + 光球快捷全部落空
- **client 期待端**：
  - `client/src/App.tsx:222-228`(`AssetsRedirect`)— `/vault`(App.tsx:289-291)、`/background-tasks`(App.tsx:369-371)、`/prompt-library`(App.tsx:375-377)、`/prompt-collection`(App.tsx:378-380)四條舊路由,全部 `navigate(\`/assets?section=${section}\`, {replace:true})`,`section` 分別為 `vault`/`tasks`/`prompts`/`collection`。
  - `client/src/contexts/OrbGuideContext.tsx:400-404`— 光球在 `/assets` 首頁提供「去提示詞庫挑模板」快捷,action 是 `{ type:"navigate", path:"/assets?section=prompts" }`。
- **實際渲染端**：`client/src/pages/AssetsLibrary.tsx:241-244`
  ```ts
  function getInitialSection(): SectionId {
    // 2026-05: 入口統一為「數位資產庫」單頁,不再讓使用者在此頁切換到其他子頁。
    return "assets";
  }
  ```
  `useState<SectionId>(getInitialSection)`(:474)完全不讀 `window.location.search`；且全檔案 grep `setSection(` **零命中**——`section` 這個 state 從掛載到卸載恆為 `"assets"`,沒有任何 UI 或 URL 路徑能把它改成別的值。結果：`section === "prompts"`(:1433)、`"collection"`(:1440)、`"vault"`(:1447)、`"tasks"`(:1454)、`"drive"`(:1461)這五段 JSX(各自渲染 `PromptLibraryPage`/`PromptCollectionPage`/`VaultPage`/`BackgroundTasksPage`/`DriveLibrarySection`)是**死代碼**,且反查全站無其他路由指到這四個頁面元件(`shells/shellRouteTable.ts` 未收編任何一個)。
- **影響**：`PromptLibraryPage`、`PromptCollectionPage`、`VaultPage`、`BackgroundTasksPage` 四個真實頁面元件在生產環境(預設旗標)**100% 不可達**——無論走舊 URL(`/vault`、`/prompt-library`、`/prompt-collection`、`/background-tasks`)還是光球快捷,終點都是同一張「數位資產庫」預設畫面,使用者看不到任何錯誤,只會覺得功能消失了。這比 FE-03(素材抽屜 `hidden`)更嚴重——FE-03 是入口被藏,這裡是**整條路由+ query-param 契約失效**。
- **對照組(已驗證接得對，同檔案內)**：`/assets?section=history`(App.tsx:318-320)與光球的「看我最近的生成歷史」(OrbGuideContext.tsx:393-397，`?section=history`)、「看共享空間」(:407-411，`?section=shared`)**確實可達**——因為 `client/src/pages/assetsLibraryRouteState.ts:41-57` 把 `section=history`/`section=shared` 這兩個舊值特判進 `viewMode`/`tab`(`getInitialViewMode()`/`getInitialTab()`，AssetsLibrary.tsx:246-252)，而 `viewMode`/`tab` 這兩個 state **有**真正的 `setViewMode`/`setTab` 呼叫點(AssetsLibrary.tsx:504、881 等)接上 UI。同一檔案裡「加了特判的兩個舊值可達、沒加特判的四個舊值死亡」，證明這是 2026-05 那次重構漏收尾,不是刻意下線。
- **建議**：`getInitialSection()` 恢復讀 `resolveAssetsLibraryRouteState(window.location.search).section`（該函式本來就會回傳合法的 `SectionId`，只是沒被接上）；或若 vault/prompts/collection/tasks 已確定要下線，四條 App.tsx 舊路由與 OrbGuideContext 的 3 個 quick action 要跟著砍掉/改導向，並在 `PromptLibraryPage`/`VaultPage`/`BackgroundTasksPage`/`PromptCollectionPage` 加 dead-code 註記或整支移除，別留下「看起來完整、其實摸不到」的頁面。

---

## 高

### IN5-02 · LearnHub `?docId=` 深連結在預設旗標下雙重失聯（延伸/確認 FE-01，現況已惡化）
- **client 期待端**：`client/src/components/learn-hub/PersonalDatabasePanel.tsx:160`（`navigate("/learn?docId=deep-cross-modal")`）、`:355`（`navigate("/learn?docId=api-pinecone-rag")`）——都假設 `/learn?docId=X` 會開啟對應學習文件。
- **舊接收端（已確認存在但不可達）**：`client/src/pages/LearnHub.tsx:2171-2184` 有完整的 `?docId=` deep-link 邏輯（`params.get("docId")` → `setOpenDocId`），但 `client/src/App.tsx:345-347` 把 `LearnHub` 掛在 `<Route path="/learn">`，而這條 Route 排在 `shellRoutes()`（App.tsx:244）**之後**——wouter `<Switch>` 只取第一個命中的子節點，`ENABLE_4SHELL` 預設 `true` 時 `/learn` 早被 shell 掛載點截走，`LearnHub.tsx` 這整支元件連掛載機會都沒有（沿用 FE-01 原始診斷，此為現況重新驗證，非新結論）。
- **新惡化點（本次新驗證）**：即使 `ENABLE_4SHELL` 曾經被人為關閉，`SHELL_LEARN_RICH` 預設也是 `true`（`learnFlags.ts:31`），此時 `/learn` 走的是 `client/src/shells/learn/LearnShell.tsx:25-33` 的富 shell 分支——`<Route path="/learn"><LearnHome /></Route>`，渲染的是**全新元件 `LearnHome`**，不是 `P.LearnHub`。`client/src/shells/learn/LearnHome.tsx:42-54` 的 `readSub()`/`useSearch()` 只認 `?sub=`（如 `?sub=models`），完全没有任何一行讀取或轉發 `docId`。也就是說，就算未來把 `shellRouteTable.ts` 的 `/learn → P.LearnHub` 映射修好，P6 的富 shell 分支現在也接管了 `/learn`，`docId` 深連結需要兩層都補（`ShellRoutes`/`shellRouteTable` 的舊映射 + `LearnShell.tsx`/`LearnHome.tsx` 的新映射），目前兩層都沒接。
- **影響**：`PersonalDatabasePanel` 的「不知道去哪找？看範例」「API + Pinecone RAG 範例」兩個引導連結（分別在「教學檔案未上傳」空狀態與一個按鈕上）點下去後，使用者落地 `/learn` 首頁（六分頁 Tabs 的 `LearnHome`），完全看不到承諾的文件,是「死指令」。
- **建議**：在 `LearnShell.tsx` 或 `LearnHome.tsx` 加一層 `?docId=` → 開啟對應學習文件 modal/panel 的轉接（可轉發到 `LearnDocsPanel` 內部搜尋，或恢復掛載 `LearnHub` 的 docId 開啟邏輯），並同步把 `PersonalDatabasePanel.tsx` 的目標連結改成新架構下真正可達的路徑。

### IN5-03 · ImageStudio/VideoStudio/ProStudio →「回到導演 AI」(`directorReturn`)：`importedSegments` 為空時靜默擱置，零回饋
- **client 寫入端**：
  - `client/src/pages/ImageStudio.tsx:3013-3043`（`handleReturnToDirector`）：寫 `sessionStorage["directorReturn"]`（含 `sceneName`/`finalPrompt`/`modelId`/`resultUrl`），`navigate("/director")`。
  - `client/src/pages/VideoStudio.tsx:4967-4993`：同款寫入，但 **`resultUrl: null` 是寫死的常數**（:4985）——**此為既有已知斷點 C-01（VideoStudio→DirectorAI resultUrl:null）在本次 HEAD 的重新確認，行號不變**。
  - `client/src/pages/ProStudio.tsx:4326-4354`：同款寫入，`resultUrl: null` 同樣寫死（:4346）——**延伸 C-01：ProStudio 端有一模一樣的 resultUrl 恆為 null 問題，先前記錄只點名 VideoStudio，實測 ProStudio 也中。**
- **client 讀取端**：`client/src/pages/DirectorAI.tsx`
  - `:2429-2447` 讀 `sessionStorage["directorReturn"]` → `setPendingStudioReturn(data)`。
  - `:2596-2654` 的回填 effect：`if (importedSegments.length === 0) return;`(:2624) 是**唯一**的空段落防線——沒有 `else` 分支、沒有 toast、沒有 TTL 判斷（寫入端明明有 `ts: Date.now()` 卻從未在讀取端被檢查），`pendingStudioReturn` 就這樣停留在 React state 裡，effect deps 是 `[pendingStudioReturn, importedSegments]`（:2654），只有等 `importedSegments` 之後變成非空才會重跑。
  - `importedSegments` 初始值是 `[]`（:2578），DirectorAI 是透過 wouter 路由整支重新掛載（不是同頁 state 保留），要嘛靠使用者手動「載入會話」(`handleLoadSession`, :3487-3514，需要使用者自己點)，要嘛靠 `PLANNING_DRAFT_KEY` 的 localStorage 草稿自動還原(`:3830-3856`，**但只在草稿裡剛好有 `session.linkedScript.segments` 時才會回填 `importedSegments`**，跟「腳本分析」匯入流程是否曾經綁定過 `planningSession.linkedScript` 有關，不保證每次都命中）。
  - **兩個明確有回饋的分支**（對照組，證明「空狀態」是漏掉的第三分支）：`matchIdx === -1` 時有 `toast.info(...)`（:2631-2637）；`matchIdx` 找到時進 `pendingFill` 對話框（:2643-2653 → JSX 於 :6378-6419，含「已回填」「已忽略」兩種 toast）。唯獨 `importedSegments.length === 0` 這個分支**什麼都不做**。
- **影響**：使用者在 ImageStudio/VideoStudio/ProStudio 生成完成、點「回到導演 AI」，若當下 DirectorAI 沒有可自動還原的腳本（例如第一次用、清過瀏覽器資料、或這次的匯入腳本從未被綁進 planningSession.linkedScript），落地後**完全沒有任何提示**（不是錯誤、不是「找不到分鏡」的 toast，是徹底沉默）——使用者以為「回填」發生了，其實資料留在一個永遠不會被消費的 state 裡直到分頁關閉。這正是題目要求追的「sessionStorage handoff 有沒有靜默流失」，此為新確認的具體案例。
- **建議**：`importedSegments.length === 0` 分支補一個「已收到 X 的成品，尚未載入對應腳本，請先匯入/繼續規劃後再套用」的持久提示（例如存一個「待回填」badge，而非單純 return）；同時把寫入端的 `ts` 拿來做 TTL（比照 `director-handoff.ts` 的 `STALE_AFTER_MS` 慣例），避免過期資料在使用者之後載入無關腳本時，因 `sceneHeading` 湊巧同名而被誤套用（次要的 race 風險，見下方中風險項）。

---

## 中

### IN5-04 · `/director?tab=script` 深連結：讀取端存在、註解宣稱的寫入端在全庫查無實作
- **讀取端**：`client/src/pages/DirectorAI.tsx:2559-2570`
  ```ts
  // 支援 URL query 預選分頁，例如 /director?tab=script 由世界觀系統的「腳本分析」按鈕導向。
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t && ["chat","script","planning","worldbuilding"].includes(t)) return t;
  ```
- **註解宣稱的寫入端（實測不存在）**：全庫 `grep -rn "director?tab="` 只命中這一行註解本身。`client/src/pages/AnimationStudio.tsx` 兩處「返回導演 AI」按鈕（:5802、:6002）都只是 `navigate("/director")`，不帶任何 query；`handleWorldbuildingAction`（:5956-5966）處理的是**頁內**分頁切換（`setSelectedTab`），從未跨頁 `navigate` 到 `/director` 帶 `tab=script`。
- **影響**：讀取端本身會優雅降級（找不到合法 `tab` 值就回退 `"chat"`），不會壞，但代表「從世界觀系統一鍵跳到導演 AI 的腳本分析分頁」這個被註解描述的功能，目前**完全沒有任何呼叫點**——使用者從 AnimationStudio 按「返回導演 AI」永遠落在 `chat` 分頁，不是註解暗示的 `script` 分頁。屬於 dead-seam：query-param 契約單邊存在。
- **建議**：若此功能仍要保留，在 AnimationStudio 對應的「腳本分析」/「返回導演 AI」按鈕補上 `navigate("/director?tab=script")`；若已改用別的路徑（如透過 `sendToStudio`／`director-handoff` 傳遞），把這條過時註解與死 parsing 邏輯一併清掉，避免下一個開發者誤以為這條線是通的。

### IN5-05 · 光球 `writeDirectorHandoff` 的「已經在目的地」判斷用 raw location 而非 canonical path，4-shell 下永遠判定為「未到達」
- **端 A（寫入觸發條件）**：`client/src/contexts/GlobalOrbChatContext.tsx:3281`
  ```ts
  if (path === "/director" && locationPath !== "/director") { writeDirectorHandoff(...); }
  ```
  這裡的 `locationPath` 來自 wouter 的 `useLocation()`（raw 目前 URL）。
- **端 B（實際掛載路徑）**：`client/src/shells/shellRouteTable.ts:92`：`{ from: "/director", to: "/video/director" }`——`ENABLE_4SHELL` 預設 `true` 時，`/director` 會被 `NavigateRedirect` 立刻轉址成 `/video/director`（`client/src/app/ShellRoutes.tsx:60-63`），所以使用者實際停留頁面的 `locationPath` 永遠是 `"/video/director"`，**不會**等於字面 `"/director"`。
- **影響**：`locationPath !== "/director"` 這個條件在 4-shell 預設開啟下**恆為 true**（即使使用者已經站在導演 AI 頁面），代表只要光球再送一次 `navigate("/director")`，就會重複覆寫 `sessionStorage["directorHandoff"]`，即使目的地根本沒變。目前沒有觀察到資料損毀（因為 payload 內容本身是「最近幾輪對話」，重寫並不算錯誤），但這個判斷式的本意（避免同頁面重複寫入）在 4-shell 下已經失效，值得列為「脆弱但暫無害」的接縫，避免未來疊加其他依賴此判斷式的邏輯時出錯。
- **建議**：判斷式改用 canonical path 比較（例如透過 `pageAgent.snapshot?.pagePath` 或正規化過的 `getPageByPath` 結果），而不是直接比對 wouter 的 raw location 字串。

---

## 已驗證接得對的接縫（negative results，供對照）

| # | 接縫 | 兩端 | 結論 |
|---|---|---|---|
| N1 | 光球對話(`/agent`) → 導演 AI(`/director`)的話題交接 | 寫：`GlobalOrbChatContext.tsx:3283`(`writeDirectorHandoff`) ↔ 讀：`DirectorAI.tsx:2463-2470`(`readAndClearDirectorHandoff`，含 `source==="agent_chat"` 過濾 + 10 分鐘 TTL，`lib/director-handoff.ts:92-95`) | **接得對**。且因 `DirectorAI` 元件同時被 `App.tsx:255-257`(`/director`)與 `shellRouteTable.ts:40`(`/video/director`, index)掛載，`ENABLE_4SHELL` 開/關兩態都到得了同一支元件，讀取邏輯不受 shell 路由影響。 |
| N2 | 導演 AI → 圖片/影片/音訊工作室的 `sendToStudio` 主要欄位(`prompt`/`overrideEngine`/`sceneName`/`segmentContext`) | 寫：`send-to-studio.ts:155-176`＋`DirectorAI.tsx:1239-1319` ↔ 讀：`ImageStudio.tsx:3192-3237`／`VideoStudio.tsx:4823-4880`／`Studio.tsx:847-1040` | **接得對**。四個目的地都各自對 `generationType` 做過濾、都在讀完後 `sessionStorage.removeItem`，batch 任務也經 `routeForBatch`/`routeForModality` 正確導頁、由 `Studio.tsx:709-739`(`submitDirectorBatch`)逐筆提交。 |
| N3 | `/assets?section=history`、`/assets?section=shared` 舊深連結 | 寫：`App.tsx:318-320`、`OrbGuideContext.tsx:393-397,407-411` ↔ 讀：`assetsLibraryRouteState.ts:41-57`(legacy alias 特判)→`AssetsLibrary.tsx:246-252`(`getInitialViewMode`/`getInitialTab`)→ 真正接 UI 的 `setViewMode`/`setTab`(`:504`,`:881`) | **接得對**，與 IN5-01 死掉的 `prompts`/`collection`/`vault`/`tasks` 四個值形成鮮明對照——同一次重構裡，`history`/`shared` 有補特判、其餘四個沒有。 |
| N4 | 光球能力白名單(`hasCapabilityForPage`)在 4-shell 路由前綴下是否失聯(對照 SSOT-1) | 檢查點：`shared/global-agent-capabilities.ts:187-195`(`capability.pagePath === pagePath`嚴格字串比對)vs 實際掛載路徑(如 `/video/director`) | **對已註冊頁面而言接得對**：`DirectorAI.tsx:4271`、`AnimationStudio.tsx:5658` 等頁面元件在 `usePageAgent()` 註冊時寫死 canonical path(如 `"/director"`、`"/animation"`)，與實際 URL(`/video/director`)無關；`useGlobalOrbExecutor.ts:51`(`getCurrentPagePath: () => pageAgent.snapshot?.pagePath ?? locationPath`)優先吃這個 canonical 值，只有在頁面**尚未完成註冊**的極短暫掛載窗口才會 fallback 到 raw `locationPath`。此 race window 兩端(before/after `usePageAgent` effect 觸發的確切時序)未在本次逐行驗證，若要下結論需另開 race 類調查，此處僅記「穩態下接得對」。 |

---

## 附註：與既有卡片的關係
- **C-01**(VideoStudio→DirectorAI resultUrl:null)：本次於 `VideoStudio.tsx:4985` 重新確認仍存在，並新增 `ProStudio.tsx:4346` 同款寫死 `null` 的證據，建議 C-01 的修復範圍納入 ProStudio。
- **C-02**(batchGenerateWithSession 不傳 storyboardId)：本次未在 `batchGenerateWithSession`(`server/routers/director.ts:1175`)本身重新驗證；但發現同檔案內另一條相鄰路徑 `Studio.tsx:709-739`(`submitDirectorBatch`，服務 `DirectorAI.tsx:3417-3449` 的 `handleSendToStudio` 批次)同樣把 `storyboardId` 完全遺漏（`submitAsyncMutation.mutateAsync` 的 payload 裡沒有這個欄位），屬於同一類缺陷在另一條呼叫鏈的重複出現，值得一併排查，但不計入本次 IN5 的頁面交接主結論。
- **SSOT-1**：見上表 N4，本次針對「已完成 `usePageAgent` 註冊」的穩態做了正向驗證（接得對），但未推翻 SSOT-1 對其他情境(如尚未掛載完成的 race window、或未呼叫 `usePageAgent` 的頁面)的原始診斷——那些情境本次未逐行覆查，維持「未在兩端驗證」。
- **FE-01**：本次為 IN5-02，屬「延伸/確認現況」——不僅確認 shell-shadow 仍成立，還新發現 P6 富 shell(`LearnHome`)這一層本身也不轉發 `docId`，代表就算修好 `shellRouteTable` 的舊映射，深連結仍會在 `LearnHome` 這一關卡住，需要兩處都補。

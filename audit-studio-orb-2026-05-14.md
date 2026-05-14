# 創作工作室 × 光球助手 — 深度盤點報告

- **日期**：2026-05-14（初版） / 2026-05-14（補充修復狀態）
- **分支**：`claude/audit-studio-assistant-psWoF`
- **盤點範圍**：
  1. 創作工作室（`/create`、`/studio`、`/image-studio`、`/video-studio`、`/pro-studio`）的程式碼健康度與功能缺陷
  2. 駐點在工作室的光球助手（ProactiveOrbWidget / OrbGuidePanel / GlobalOrbChatContext / PageAgentContext / `ai.chat`）的功能與缺陷
- **方法**：兩個 Explore 子代理 + 主代理交叉驗證；逐項對照 `audit-findings.md`、`orb_connection_report.md`、`orb_optimization_plan.md`、`healing_studio_deep_audit_report.md` 等歷史紀錄，確認哪些已修、哪些仍未修、哪些是新發現。

## 修復進度（commits on this branch）

| 缺陷 | Commit | 狀態 |
| ---- | ------ | ---- |
| O-M1 `ENABLE_ORB_*` 寫進 `.env.example` | `ac47dcb` | ✅ 已修 |
| S-L1 `CREATE_NAV_ALLOWLIST` 含三個專業工作室 | `ac47dcb` | ✅ 已修 |
| O-M3 AgentPreferencesPage 補 `["navigate"]` | `ac47dcb` | ✅ 已修 |
| S-M2 `OrbFeatureSearch.tsx` 刪檔 | `ac47dcb` | ✅ 已修 |
| S-M3 `OrbSystemHealthDashboard.tsx` 刪檔 | `ac47dcb` | ✅ 已修 |
| S-M1 / O-M4 `studioModality` 多 pageId 推斷 | `ac47dcb` | ✅ 已修 |
| S-L2 Sonauto warn 帶 userId / promptLen / droppedTags | `9b488cc` | ✅ 已修 |
| S-L3 Studio recipes/versions `retry: 1` | `9b488cc` | ✅ 已修 |
| O-L1 action exec error → ProactiveEventBus | `9b488cc` | ✅ 已修 |
| O-M3 follow-up — 新 CI drift guard 測試 | `9b488cc` | ✅ 已加 |
| notes 補 `setParam`（drift 測試抓到） | `9b488cc` | ✅ 已修 |
| O-M2 語音閘道改誠實 stub 模式 + `ENABLE_ORB_VOICE_GATEWAY` flag | 本次 | ✅ 部分修（ASR 整合仍未完成） |
| S-L4 FAL_API_KEY 提示加 CTA 連結 | 本次 | ✅ 已修 |
| Legacy ISSUE-01 ThoughtChain 真實時間戳 | 過去已修 | ✅ 已查證（`server/routers.ts:1506-2345`） |
| S-L5 VideoStudio 文案截斷 | – | ❌ 誤判（grep 視覺截斷） |
| O-L3 stale 註解 | – | ❌ 誤判（註解仍準確） |
| O-L4 OrbGuidePanel 拆檔 | – | ⏸ 延後（5K 行需獨立 PR） |
| O-L5 stripeWebhook TODO | – | ⏸ 等商務決策 |
| O-L6 SSE/WebSocket 取代 polling | – | ⏸ 架構性變更 |

---

## 一、總體結論

| 系統 | 整體狀態 | 阻斷性缺陷 | 中等缺陷 | 低度缺陷 |
| ---- | ------- | ---------- | -------- | -------- |
| 創作工作室 | 🟢 運作正常、產線可用 | 0 | 3 | 5 |
| 光球助手 | 🟢 連線完整、能執行多步任務 | 0 | 4 | 6 |

無阻斷性問題，但有若干「會議錄已標註卻仍未根治」的缺陷，以及這次新發現的孤兒元件與假資料看板。下面按嚴重度排序逐條列出，每條都附檔案 / 行號，可直接交給工程師處理。

---

## 二、創作工作室 — 缺陷盤點

### 2.1 架構概覽（已驗證、健康）

| 路由 | 元件 | 狀態 |
| ---- | ---- | ---- |
| `/create` | `client/src/pages/CreationHub.tsx` (260 行) | ✅ 已掛載、`/create?tab=` 切換正常，使用 `useRegisterPageAgent` 註冊 `setTab` / `navigate` 兩種能力 |
| `/studio` | `client/src/pages/Studio.tsx` (4 336 行) | ✅ 跨模態主入口，註冊 `setModality / setMode / setModel / applyPreset / fillPrompt / setParam / submit / reset / openDialog` 等 ~12 個 PageAgent 能力 |
| `/image-studio` | `client/src/pages/ImageStudio.tsx` (5 239 行) | ✅ FAL 圖像專用工作室，PageAgent 已註冊（line 3926） |
| `/video-studio` | `client/src/pages/VideoStudio.tsx` (5 126 行) | ✅ FAL 影片專用工作室，PageAgent 已註冊（line 4446） |
| `/pro-studio` | `client/src/pages/ProStudio.tsx` (4 955 行) | ✅ 音樂 / 音效 / 語音工作室，PageAgent 已註冊（line 4494） |

後端：`server/routers/imageStudio.ts`、`videoStudio.ts`、`proStudio.ts` 三個獨立 tRPC router，總計約 180 KB，全部在 `server/routers.ts` 中註冊；資料層 `studio_recipes` / `studio_versions` 兩表 + `drizzle/0030_studio_recipes_versions.sql` migration 都已上線。`client/src/lib/send-to-studio.ts` 是「發送到工作室」的單一派送點。

### 2.2 中等缺陷

#### S-M1：光球的「駐點」邏輯只認 `/studio`，三個專業工作室淪為一般頁面

- **位置**：`client/src/components/ProactiveOrbWidget.tsx:1468-1485, 1684, 1718`
- **症狀**：所有「studio-aware」分支都用 `pageContext?.pageId === "studio"` 比對，沒有 `"image-studio"` / `"video-studio"` / `"pro-studio"` 的對應分支。換句話說：
  - 進入 `/studio` 時，光球會根據 `studioModality` / `studioCreativeMode` 動態推薦四模態切換、模型、Vault 等卡片。
  - 進入 `/image-studio` / `/video-studio` / `/pro-studio` 時，光球只能用 `PAGE_GREETINGS[pageId]` 與 `PAGE_QUICK_ACTIONS[pageId]` 的「通用版」迎賓，無法看見當前的模型、Aspect Ratio、Negative Prompt、Duration 等內容。
- **影響**：使用者在「圖片工作室」時請光球「幫我把寬比改成 21:9」，光球只能透過 `setParam` 盲打，而不會像在 `/studio` 模式下那樣先給「目前 4:3 → 21:9」的差異說明卡。
- **建議**：把 `pageContext?.pageId === "studio"` 改成 `STUDIO_PAGE_IDS.has(pageId)`（`new Set(["studio","image-studio","video-studio","pro-studio"])`），並將 `studioModality` 推導改成「`pageId === "studio"` 用快取狀態，否則由 `pageId` 直接映射 `image / video / audio / voice`」。

#### S-M2：`OrbFeatureSearch.tsx` 是孤兒元件且內含 mock 資料

- **位置**：`client/src/components/orb/OrbFeatureSearch.tsx`（316 行）
- **症狀**：
  - 全 repo 沒有任何 `.tsx / .ts` 檔 import 此元件（已用 grep 驗證）。
  - 內部仍是 mock：`handleSearch()` 直接 `await sleep(500)` 後回傳硬編碼結果（line 76-92）；`useEffect` 初始化 `recommendations / frequentFeatures / recentFeatures` 全用假資料（line 102-138）。
  - 兩處顯式 `// TODO: Replace with actual tRPC mutation/query`（line 70、98）。
- **影響**：UI 包裝的「智慧功能搜尋」是廣告詞，實際永遠回傳同一筆 `{"圖像生成", relevanceScore: 0.95}`。若有人誤把它接上去，會立刻露餡。
- **建議**：二擇一 ─ 接 `trpc.orb.searchFeatures` / `trpc.orb.getRecommendations` 把後端串通；或直接刪檔，避免「未來再回來踩同個坑」。

#### S-M3：`OrbSystemHealthDashboard.tsx` 同樣是孤兒且 100% 假資料

- **位置**：`client/src/components/orb/OrbSystemHealthDashboard.tsx`（358 行）
- **症狀**：
  - 七個健康指標（回應時間、錯誤率、工具成功率、滿意度、記憶體、API 延遲、澄清率）全部由 `useState` 寫死（line 65-122）。
  - 「協作統計」（Director→Image, Director→Video）以及「成本分佈」（line 124-148）也是硬編碼。
  - 註解明說「`// TODO: Replace with actual tRPC subscription`」（line 152），但內層 `setInterval` 的 callback 是空函數 ── 即使 30 秒過去畫面也不會動。
  - 全 repo 沒有任何頁面 mount 它。
- **影響**：仍然容易被新工程師認為「站上有系統健康監控了」，未來可能被掛上 dashboard、把假數據秀給營運看。
- **建議**：要嘛接 `trpc.orb.systemHealth` 之類的真實 endpoint（連同 `orb_tool_call_logs / orbTask_states` 統計），要嘛刪檔並把「假健康儀表板」這個風險從程式碼移除。

### 2.3 低度缺陷

| ID | 位置 | 描述 |
| -- | ---- | ---- |
| S-L1 | `client/src/pages/CreationHub.tsx:144-156` | `CREATE_NAV_ALLOWLIST` 寫死 6 條路徑，沒有把 `/image-studio`、`/video-studio`、`/pro-studio` 列入。若使用者在 `/create` 對光球說「幫我跳到影片工作室」，會被擋下並回「不在允許跳轉清單」。建議補上。 |
| S-L2 | `server/routers/proStudio.ts:540` | Sonauto 提示詞 + tags + lyrics 同時存在時 `console.warn` 後 drop tags。已用 graceful fallback 處理，但 warn 訊息沒包含使用者 ID / requestId，事故排查需要拼湊 trace。 |
| S-L3 | `client/src/pages/Studio.tsx:693-698` | `trpc.studio.recipes.list.useQuery` 的 `retry: false`，導致網路抖動時 Recipe Library 直接顯示空。可考慮 `retry: 1` 或加上「重新載入」按鈕。 |
| S-L4 | `client/src/pages/VideoStudio.tsx:567` | `FAL_API_KEY 尚未設定` 提示用 `<p>` 文字呈現，沒有「前往設定」CTA，新使用者只能自己摸路徑。 |
| S-L5 | `client/src/pages/VideoStudio.tsx:1369` | 「Pro 版定價約 Standard 的 2 倍（每 5 秒 80 點）；端點若尚未開放會…」這行文字截斷，註解雖然標明是 UI 文案，但實際 render 後會被 truncate。建議改成多行說明或 Tooltip。 |

---

## 三、光球助手 — 缺陷盤點

### 3.1 架構概覽（已驗證、健康）

- **整站掛載點**：`client/src/App.tsx:337` ── `<GlobalOrbChatProvider>` 包住整個 `<Router>`，因此每個頁面都自動拿到 `ProactiveOrbWidget` 與 `OrbGuidePanel`。
- **核心 Context / 服務**：
  - `GlobalOrbChatContext.tsx`（5 440 行 / 231 KB）— 訊息保存、Cmd-K、kill-switch、workflow / executor 派送、附件、TTS、IntentCard。
  - `OrbGuideContext.tsx`（1 130 行 / 39 KB）— 引導流程 FSM、Arrival 緊湊卡。
  - `PageAgentContext.tsx`（597 行 / 23 KB）— PageAgent 派送 hub，含 capability 驗證 warn（line 367-374）。
  - `ProactiveOrbWidget.tsx`（4 077 行 / 175 KB）+ `OrbGuidePanel.tsx`（4 874 行 / 192 KB）— 兩塊主 UI 殼。
- **後端**：`ai.chat`（mutation，含 idempotency / kill-switch / 多模態 / 計劃器 / 工具呼叫 / 角色團隊）、`ai.chatProgress`（HTTP long-poll，TTL 60s）、`ai.executeTools`、`orbTask.*`、`orbConversations.*`、`orbCapabilities.*`。
- **15 精靈、provider router、cost guard、quota guard、長短期記憶（Pinecone）皆已 wired**。

### 3.2 中等缺陷

#### O-M1：Kill-switch 環境變數沒有寫進 `.env.example`

- **位置**：`client/src/contexts/GlobalOrbChatContext.tsx:2004-2013` + `server/routers.ts:6149-6212`
- **症狀**：程式碼讀取 `VITE_ENABLE_ORB_AGENT` / `ENABLE_ORB_AGENT` 與另外 10 個 `ENABLE_ORB_*` flag（schema-first planner、task FSM、task memory、long-term memory、provider router、cost guard、idempotency guard、quota guard…），但 `.env.example` 全 0 筆對應行。
- **影響**：營運 / SRE 在生產環境若需「暫時關閉光球動作執行、保留純聊天」這種緊急回退，沒有任何文件提示這些 flag 存在；只能去翻 git blame。
- **建議**：把全部 12 個 `ENABLE_ORB_*` flag 加進 `.env.example`，並附「預設值 + 用途 + 影響範圍」。

#### O-M2：語音閘道 server side 仍是 stub

- **位置**：`server/ws/orbVoiceGateway.ts:35`
- **症狀**：`ws.send(JSON.stringify({ type: "transcript", text: "(stub) 收到語音資料", orbTraceId }))` ── 連線、限流（`ORB_VOICE_MAX_CONCURRENT=3` / `ORB_VOICE_MAX_SESSION_MS=600000`）都有，但收到音訊後不做任何 ASR，固定回傳 stub 字串。
- **前端**：`useOrbVoice.ts` + `OrbVoiceButton.tsx` 已實作 Web Speech API 錄音，會送音訊到 ws。
- **影響**：「按住光球說話 → 自動聽寫」這個賣點是空殼。使用者按住、放開、看到「(stub) 收到語音資料」會立刻失望。
- **建議**：接 Whisper / Gemini Speech / Google STT 任一；若短期內不打算接，先在 UI 端把語音按鈕灰掉，避免賣假功能。

#### O-M3：`appRegistry.supportedActions` 仍有 1 筆空陣列 + 部分頁面與 PageAgent handler 不一致

- **位置**：`shared/appRegistry.ts:578`（`/settings/agent` AgentPreferencesPage `supportedActions: []`）+ `PageAgentContext.tsx:367-374`
- **症狀**：
  - `orb_optimization_plan.md` 提到的 14 個缺少 `navigate` 的頁面，多數已補上（admin、agent-chat、brain-settings、calendar、credits、dashboard、focus-flow、home、models、my-brain、shared、tutorial-overview、vault 等都已加入 `"navigate"`）。
  - 但 AgentPreferencesPage 仍宣告 `supportedActions: []`，這是 static fallback router 用來「決定哪個頁面能處理動作」的清單；若使用者在該頁要光球「切到通知分頁」，會回 `no matching page handler` 而非由 PageAgent 接住。
  - `PageAgentContext` 的 capability drift 防護是 `console.warn`（line 367-374），不會拒絕執行，但 dev console 一旦有人忽視，三個月後就會累積一堆未宣告的能力。
- **建議**：
  1. 把 AgentPreferencesPage 的 `supportedActions` 至少補上 `["setTab", "setParam", "reset"]`（對照頁面實際 handler）。
  2. 加一個 vitest，自動掃所有 `useRegisterPageAgent` 的 `capabilities[].action` 與 `appRegistry.supportedActions` 比對，CI fail 即代表漂移。

#### O-M4：`ProactiveOrbWidget` 對「工作室子分頁」零感知

- **位置**：`client/src/components/ProactiveOrbWidget.tsx:1684`、`client/src/contexts/OrbGuideContext.tsx`
- **症狀**：見 §2.2 S-M1。`ProactiveOrbWidget` 只認 `pageContext?.pageId === "studio"`；當使用者在 `/image-studio` 切到 `tab=lora` 或 `/video-studio` 切到 `tab=enhance` 時，光球無法主動推薦對應動作。`OrbGuideContext.attachArrivalGuide` 也只針對 `/studio` 才會帶四模態的 Arrival 緊湊卡。
- **建議**：把 `studio-aware` 的判斷集中成 `isStudioPage(pageId, tabId)` helper，並把 `image-studio / video-studio / pro-studio` 各自的 `tab` 對應到 `STUDIO_TOOLBOX_ENTRIES`、`STUDIO_MODALITY_PROFILES`。

### 3.3 低度缺陷

| ID | 位置 | 描述 |
| -- | ---- | ---- |
| O-L1 | `client/src/contexts/GlobalOrbChatContext.tsx:3201, 4535` | 兩處 `console.error`（action execution / send error）只寫 console，沒有送到 LangSmith / Sentry。建議在 try-catch 內以 `trpc.observability.logClientError.mutate` 上報，方便事後追蹤。 |
| O-L2 | `OrbFeatureSearch.tsx` / `OrbSystemHealthDashboard.tsx` | 已於 §2.2 S-M2/S-M3 詳述：兩個孤兒元件，刪或接，二擇一。 |
| O-L3 | `client/src/contexts/GlobalOrbChatContext.tsx:2246` 註解 | 註解提到「ProactiveOrbWidget / OrbGuidePanel 的 spirit chip render 邏輯」依賴某個結構，但實際程式碼是動態 fallback。註解與行為輕微不同步，建議補強。 |
| O-L4 | `OrbGuidePanel.tsx`（4 874 行） | 單檔逼近 5 千行，已含對 12+ Context 的 import。建議拆 `panels/`（OrbGuidePanel/PreferencePanel/IntentSelector）以利測試與維護。 |
| O-L5 | `server/services/stripeWebhook.ts:39, 53, 66, 72, 85, 91, 104, 110, 125, 131, 142` | 共 11 個 TODO；雖然不是光球的核心檔，但光球的 `credits / quota` capability 仰賴 Stripe 開通記錄。Stripe webhook 仍是骨架，意味著「升級方案 → 解鎖光球進階能力」目前是死路。 |
| O-L6 | `ai.chatProgress` 用 HTTP long-poll，非 SSE / WebSocket | 已知設計取捨（tRPC mutation 無原生 push），但 500 ms 抽樣間隔在長思考鏈仍會有「跳幀感」。中期可考慮改用 tRPC subscription 或 SSE。 |

### 3.4 已歷史化但仍開放的問題（對照舊報告）

| 來源 | 議題 | 狀態 |
| --- | --- | --- |
| `audit-findings.md` ISSUE-01 | ThoughtChain 是 post-hoc summary，非真正逐步時間戳 | ⚠️ 仍開放（`server/routers.ts:505-512`） |
| `audit-findings.md` ISSUE-02 | 跨模態參數繼承不完整 | ✅ 已解決：`SendToStudioPayload.parameterSnapshot` 已實作，`HistoryPage.tsx` 5+ 處呼叫、`VideoStudio.tsx:4667/4692` 消費。 |
| `audit-findings.md` ISSUE-03 | ZIP 匯出僅 toast、無實作 | ✅ 已解決：`client/src/pages/Studio.tsx:85` `import JSZip`，line 3609-3818 完整實作（含參數、url、結果檔打包與失敗 toast）。 |
| `audit-findings.md` ISSUE-04 | OnboardingFlow 缺 Choice Chips | ⚠️ 仍開放（不在本次主審範圍，僅標註） |
| `audit-findings.md` ISSUE-05 | evaluatePrompt suggestions 仍為純文字 | ⚠️ 部分解決（optimizedPrompt 已有「套用」按鈕） |
| `orb_optimization_plan.md` 修正 1 | `supportedActions` 缺少 `navigate` 的 14 頁 | ⚠️ 大多已補；AgentPreferencesPage 仍空（見 O-M3） |
| `orb_connection_report.md` 5.「Phase 4+ 待辦」 | LocalStorage 跨頁連續性、E2E、語音輸入… | ⚠️ 仍開放（語音輸入有 client 但 server stub，見 O-M2） |

---

## 四、建議優先順序（給工程團隊）

1. **O-M2 語音 server 端落地**（高使用感知 / 風險：賣假功能）
2. **O-M1 把 `ENABLE_ORB_*` 全寫進 `.env.example`**（低成本 / 防止生產事故）
3. **S-M1 + O-M4 光球專業工作室感知**（兩條合在一條 PR 改 `pageId` 判斷集中化）
4. **S-M2 + S-M3（= O-L2）孤兒元件處置**（一條 cleanup PR 即可）
5. **O-M3 AgentPreferencesPage 補 `supportedActions` + 加 CI drift test**
6. **S-L1 `CREATE_NAV_ALLOWLIST` 補入專業工作室路徑**
7. **舊 audit ISSUE-01 ThoughtChain 真實時間戳**（可獨立估點）

---

## 五、本次盤點所核對的關鍵檔案

- `client/src/pages/{CreationHub,Studio,ImageStudio,VideoStudio,ProStudio}.tsx`
- `client/src/components/workspaces/*`
- `client/src/components/{ProactiveOrbWidget,OrbGuidePanel,OrbErrorBoundary}.tsx`
- `client/src/components/orb/*.tsx`、`client/src/components/orb-agent/*.tsx`
- `client/src/contexts/{GlobalOrbChatContext,OrbGuideContext,OrbStateContext,PageAgentContext,IntentCardContext}.tsx`
- `client/src/lib/send-to-studio.ts`
- `client/src/hooks/{useOrbAttachments,useOrbVoice,useOrbTaskObservations,usePreferredStudioModel}.ts`
- `server/routers/{imageStudio,videoStudio,proStudio,orbConversationsRouter,orbCapabilitiesRouter}.ts`
- `server/routers.ts`（`ai.chat`、`ai.chatProgress`、`orbTask.*`）
- `server/services/{orbReplyParser,orbChatProgress,orbMemory,orbTaskOrchestrator,orbTaskStateMachine,providerRouter,orbCostGuard,orbQuota,agentPlanner,siteKnowledge}.ts`
- `server/ws/orbVoiceGateway.ts`
- `shared/{appRegistry,orb-studio-actions,orb-chat-multimodal,agent-actions,orb-reasoning,orb-agent-roles}.ts`
- `drizzle/0030_studio_recipes_versions.sql`、`drizzle/schema.ts`
- 既有 audit：`audit-findings.md`、`orb_connection_report.md`、`orb_optimization_plan.md`、`healing_studio_deep_audit_report.md`、`Healing_Studio_深度檢修總結.md`

---

*最後更新：2026-05-14 — 由 `claude/audit-studio-assistant-psWoF` 分支產生。*

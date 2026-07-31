# 圖像創作室 + 光球助手 深度盤點報告

> 對應分支：`claude/audit-image-studio-asJNx`
> 盤點日期：2026-05-14
> 範圍：`client/src/pages/ImageStudio.tsx`、`server/routers/imageStudio.ts`、
> `client/src/contexts/PageAgentContext.tsx`、`client/src/components/ProactiveOrbWidget.tsx`、
> `client/src/components/OrbGuidePanel.tsx`、`shared/orb-studio-actions.ts`、
> `shared/orb-specialized-agents.ts`、`shared/appRegistry.ts`、相關測試。

---

## 一、圖像創作室缺陷盤點

### A. 功能性／邏輯 Bug（P0 — 影響使用者實際操作）

| # | 位置 | 缺陷 |
|---|------|------|
| A1 | `ImageStudio.tsx:5175` | 歷史側欄 JSX 寫成 `{false && showHistory && (...)}` — 開頭 `false &&` 永遠短路，整個側欄不會渲染。對應的「歷史」按鈕（`showHistory` state）有更新但永遠看不到結果，是已死的功能。 |
| A2 | `ImageStudio.tsx:4292, 4303` | 標題列的「歷史」「素材」按鈕 `className="hidden flex items-center..."` — Tailwind `hidden`（display:none）會被後續 `flex` 覆寫，所以「隱藏」其實沒生效。這兩顆按鈕始終顯示，但點下去只會切 state（搭配 A1，等於完全沒效果）。 |
| A3 | `ImageStudio.tsx:3460, 3471` | `fluxKontext` / `flux2ProEdit` 用 `...(seedNum && { seed: seedNum })` 來傳 seed。若使用者明確輸入 `0`，`seedNum` 變成 `0`（falsy），spread 跳過，seed 被靜默丟掉，破壞「相同 prompt + seed = 相同結果」承諾。其他分支（如 3361, 3420）已用 `seedNum !== undefined`，本檔內不一致。 |
| A4 | `ImageStudio.tsx:3306-3326` | `handleGenerate` 先做 `setIsGenerating(true)` → `setAIState("generating")` → `setResultImages([])` → `setResult3d(null)` → `setResultPose(null)` → `setLastGenMeta(null)`，然後才檢查 prompt / 參考圖。任何驗證失敗（toast.error + return）都會留下「結果區已清空但根本沒跑」的副作用 — 使用者剛剛的成果被清掉了。應該先驗證，再進 generating 狀態。 |
| A5 | `ImageStudio.tsx:3094-3099` | tab 切換的 effect deps 只放 `[activeTab]`，但 closure 內讀 `tabModels`、`selectedModelId`。仰賴 `tabModels` 是同一 render 派生（目前是這樣），但繞過 lint，脆。 |
| A6 | `ImageStudio.tsx:3193-3222` | `mutations` 物件每次 render 重建，呼叫 22 個 `trpc.imageStudio.*.useMutation()`。React 規則上允許（順序穩定），但 22 個 mutation 鍵每次都新建監聽，記憶體與訂閱成本明顯偏高，應該抽成 stable hook 或 useMemo。 |
| A7 | `ImageStudio.tsx:3409` | `nanoBanana2Edit` 分支硬寫 `aspect_ratio: "auto" as any`，完全忽略使用者選的 `aspectRatio` state。後端 schema（`imageStudio.ts:751-770`）支援 15 個比例，是有意義的選項，但前端永遠送 `"auto"`。 |
| A8 | `ImageStudio.tsx:3509, 3528, 3541` | SD 分支用 `parseInt(sdSeed)` 沒帶 radix（業界慣例會帶 `10`）。雖然數字字串實際解析正確，但與其他分支不一致；linter 通常會擋。 |

### B. UI / UX 缺陷

| # | 位置 | 缺陷 |
|---|------|------|
| B1 | `ImageStudio.tsx:4346-4433` | 「模型細膩導覽」Collapsible 整段以 `className="hidden"` 隱藏，註解標明「與光球助手重複」。約 87 行的 zombie code，應該刪除而不是隱藏。 |
| B2 | `ImageStudio.tsx:5204-5228` | 行動版 sticky 生成 bar 沒有暴露 Ctrl+Enter 快捷鍵提示；桌機版（5027）有。行動鍵盤本來就難按 Ctrl+Enter，但提示不一致看起來像 bug。 |
| B3 | `ImageStudio.tsx:923-948` | `ApiKeyBanner` 用 `trpc.imageStudio.checkApiKey.useQuery()` 但沒有 `refetchOnFocus`、`refetchInterval`、也沒有手動重試按鈕。使用者剛去後台補完 `FAL_API_KEY` 回到頁面，banner 仍會掛著到下次 mount。 |
| B4 | `ImageStudio.tsx:1783` | `<img onError={() => onChange("")} />`：參考圖 URL 一旦 transient 404 就會被自動清空，使用者看到欄位變空卻不知道為何。應該改為 inline error icon。 |
| B5 | `ImageStudio.tsx:609-618` | `ASPECT_RATIOS` 前端僅 8 種，後端 `imageStudio.ts:276-288` 列出 11 種（多 `4:1`、`1:4`、`21:9`）。Nano Banana 2 等模型支援 11 種但 UI 選不到。 |
| B6 | `ImageStudio.tsx:5240-` | 整個檔案 **5,239 行單檔**，包含 12 個內嵌子元件、 23 個 mutation hooks、超過 35 個 useState。光是 default export `ImageStudio()` 就佔 2,360 行（2880–5239）。可維護性瀕臨臨界。 |
| B7 | `ImageStudio.tsx:3306-3786` | `handleGenerate` 的 `useCallback` deps 列表（3732-3786）共 54 個依賴，極易誤漏導致 stale closure。理想做法是把參數收進 ref 或 reducer。 |
| B8 | `ImageStudio.tsx:1196-1435` | `HistoryPanel` 元件存在但因為 A1 永遠不會被掛載 — 整段約 240 行邏輯（包含 server merge / dedupe / bookmark / delete）目前是死碼。 |

### C. 後端 Router 缺陷（`server/routers/imageStudio.ts`）

| # | 位置 | 缺陷 |
|---|------|------|
| C1 | 243-251 | `falQueueRun(modelId, input, waitSec=180)` 接了 `waitSec` 參數但函式內完全沒使用 — 直接 return `request_id`，是死參數，呼叫處（每個 mutation）都在浪費資訊。 |
| C2 | 254-265 | `extractImageUrl` 用 `||` 鏈解析，遇到 `image_url: ""` 會自動 fallback，但若所有鏈路都是空字串會回 `null` 而不報錯；偵錯時無法分辨「fal 沒回」vs「fal 回了空 URL」。 |
| C3 | 217, 1440 | `recordErrorTrace({ userId: 0, ... })` — `falRun` 失敗路徑與 `checkImageStatus` FAILED 分支都用 `userId: 0`，因為這層沒帶使用者 context。所有圖像錯誤線索都被歸到「使用者 0」，無法分析個別使用者問題。 |
| C4 | 520-522 | `nanoBananaProEdit` 用 `normalizeAspectRatio(input.aspect_ratio, ASPECT_RATIOS)` —但 `ASPECT_RATIOS` 是所有比例的全集，沒有對齊 Nano Banana Pro Edit 實際支援的子集，仍可能傳到 fal.ai 後 400。其他模型（seedream/imagen）有專屬 `SEEDREAM_V4_RATIOS`、`IMAGEN4_RATIOS`，Edit 系列卻沒有。 |
| C5 | 303-307 | `mergeNegativePrompt` 在使用者已填負向時無條件附加 `DEFAULT_NEGATIVE_PROMPT`（12 個品質詞）。對「故意 low quality」的藝術用途會打架。應該提供 opt-out。 |
| C6 | 1376-1422 | `checkImageStatus` 用 `compiledPrompt = [imageStudio:${modelId}:${requestId}]` 作為 dedupe 標記直接塞進 prompt 欄位 — 把唯一鍵與業務資料耦合。未來想用 prompt 搜尋會撞這些標記字。 |
| C7 | — | 未在生成前接 `shared/orb-content-moderation.ts` 做內容審核（`docs/agent/light-ball-agent-enhancement-plan.md` 缺口三已點名）。 |
| C8 | — | 未做生成後品質驗證（同上，缺口一）。全黑圖、aspect ratio 不符的結果不會被攔截。 |
| C9 | 78-94 | `falQueueSubmit` 從 `process.env.VITE_SITE_URL` 取 webhook 基底，但 `VITE_` 前綴是 Vite 前端規範；後端應該用 `SITE_URL` 等明確環境變數，否則部署時容易拿不到。 |

### D. 測試覆蓋缺陷

| # | 範圍 | 缺陷 |
|---|------|------|
| D1 | `server/image-studio-aspect-ratio.test.ts` | 只測 `normalizeAspectRatio`。22 個 router endpoint 沒有 input schema / 回傳 shape 的整合測試。 |
| D2 | — | 沒有測試驗證「前端 `mutations[model.id]` 鍵集 ⊆ router 實際 procedure 名稱」。任一邊新增/刪除都會 silent break。 |
| D3 | — | 沒有 page-scoped action handler（`runImageStudioAction`，4044-4258）的單元測試 — 這是光球與頁面 25 個參數的接觸面，bug surface 最大。 |
| D4 | — | drawMode 7 個值的對齊（4146-4165 的 fix）沒有 regression test。 |

---

## 二、駐點光球助手（光球 / 圖圖）：功能與缺陷盤點

光球在 `/image-studio` 的駐點精靈被解析為 `image-specialist`（暱稱「圖圖」，`shared/orb-agent-roles.ts:930`、`orb-specialized-agents.ts:43`、`orb-agent-roles.ts:2160`）。

### A. 已實作的功能

| # | 功能 | 來源 |
|---|------|------|
| 1 | **頁面能力註冊**：頁面用 `useRegisterPageAgent()` 宣告 8 種 action — `setTab`、`setModel`、`fillPrompt`、`applyPreset`（氛圍卡）、`submit`、`reset`、`openDialog`、`setParam`。 | `ImageStudio.tsx:3833-3924` |
| 2 | **Action handler `runImageStudioAction`**：可切分頁、切模型（自動同步 tab）、填三種 prompt（含 append）、套氛圍卡、調 25 個參數（aspectRatio/seed/strength/guidance/inferSteps/drawMode/hunyuan 系列/rodin 系列/...）、送出生成、重設、開關面板。 | `ImageStudio.tsx:4044-4258` |
| 3 | **狀態快照（observer feed）**：每次 render 把 modality、activeTab、selectedModelId、modelName、promptPreview、appliedVibes、aspectRatio、numImages、hasRefImage、isGenerating、hasResult、+ 每個 tab 專屬欄位（共 25 欄）回報給 `globalAgentRegistry` 與 per-task 觀察器。 | `ImageStudio.tsx:3931-3985`、`PageAgentContext.tsx:387-402` |
| 4 | **頁面感知問候語**：3 條 image-studio 專屬開場白。 | `ProactiveOrbWidget.tsx:336-340` |
| 5 | **頁面快速動作**：4 顆 chip — 模型推薦、模型細節導覽、提詞優化、生成積分預估。 | `ProactiveOrbWidget.tsx:552-577` |
| 6 | **跨頁 action builders**：`buildImageStudioSetModelActions` / `applyVibeActions` / `fillPromptActions` / `setAspectRatioActions`，以及 edit/upscale/pose/SD 各分頁的對應 builders（共 17 個 builder 函式）。 | `shared/orb-studio-actions.ts:352-1184` |
| 7 | **OrbGuidePanel 深度面板**：偵測 `pageId === "image-studio"`，依當前 tab 顯示不同的引導 UI。 | `OrbGuidePanel.tsx:131-143, 3692-4352` |
| 8 | **路由註冊**：`{ prefix: "/image-studio", role: "image-specialist" }`；意圖含「圖片/圖像/照片/image/picture」走 image-specialist。 | `orb-agent-roles.ts:2160`、`orb-specialized-agents.ts:403` |
| 9 | **聚光燈（spotlight）**：context 層自動處理 `focusElement` action，顯示元素標亮提示 4.5 秒。 | `PageAgentContext.tsx:260-286, 345-351` |
| 10 | **能力宣告驗證 telemetry**：dispatch 動作未在 capability list 宣告時 `console.warn`（不擋）。 | `PageAgentContext.tsx:362-374` |

### B. 缺陷盤點

#### B1. 駐點層（image-specialist 角色 / appRegistry）

| # | 位置 | 缺陷 |
|---|------|------|
| B1.1 | `shared/appRegistry.ts:247-257` | image-studio 的 `supportedActions` 沒有列 `navigate` 或 `focusElement`，但實際上：context 會直接處理 `navigate`（`PageAgentContext.tsx:332`），頁面 handler 也接 `focusElement`（4227）。`appRegistry` 是 static fallback ranker 的依據，未宣告意味光球的離線路由可能誤判 "page cannot navigate"（已記錄於 `orb_optimization_plan.md`，未修）。 |
| B1.2 | `orb-agent-roles.ts:930` | 同一角色三個暱稱（圖圖／阿圖／圖像精靈），對使用者造成「光球自我介紹不一致」的混亂。 |
| B1.3 | `orb-specialized-agents.ts:403`、`orb-agent-roles.ts:859, 1131` | 註解承認 `image-specialist` 的單字 trigger「畫」與「畫面」會 substring collide（搶走 video）。當前用 guard 擋住，但 collision 邏輯仍然脆弱，未來新增單字 trigger 會持續踩雷。 |
| B1.4 | `ProactiveOrbWidget.tsx:552-577` | image-studio 的 4 個 page quick actions 全是 `chat-*`（送 prompt 給 LLM），沒有任何一顆能直接 `dispatch` 一個 action（如直接 `setModel`），所有「動作」都繞 chat 一圈，latency 偏高且使用者預期落差。 |
| B1.5 | `ProactiveOrbWidget.tsx:336-340` | image-studio 是全站 action surface 最大的頁面（25 個參數、22 個模型、6 個 tab），但 page greetings 只有 3 句，缺乏多樣性，與 dashboard 等簡單頁面同等待遇。 |

#### B2. 頁面註冊層（`useRegisterPageAgent` in ImageStudio.tsx）

| # | 位置 | 缺陷 |
|---|------|------|
| B2.1 | `ImageStudio.tsx:4227-4228` | `case "focusElement": return { ok: true };` — handler 只回 ok，不做任何 scroll/focus。context 層的 spotlight 會顯示，但長表單下使用者根本沒滾到那個元素，光球說「請看右邊的生成按鈕」其實看不到。 |
| B2.2 | `ImageStudio.tsx:3834-3924` | capability declarations 沒列出 `focusElement` 與 `navigate`，與 B1.1 對稱。 |
| B2.3 | `ImageStudio.tsx:4088-4097` | `setParam("aspectRatio", value)` 沒驗證 value ∈ `ASPECT_RATIOS`。光球可以送 `12:5`，頁面照吃，後端 `normalizeAspectRatio` 會解，但 UI 比例按鈕沒有對應高亮 → 狀態漂移。 |
| B2.4 | `ImageStudio.tsx:4215-4225` | `case "reset":` 直接清掉 prompt、vibe、ref image、mask、neg、所有結果，**沒有走 `isDestructiveAction` 確認 gate**。比對 `shared/agent-actions.ts:648`，`reset` 並未被視為破壞性（只有 `submit/applyPreset/setModality` 是）— 結果光球一個 reset 就把使用者剛跑出的圖洗掉。 |
| B2.5 | `ImageStudio.tsx:3931-3985` | `useRegisterPageAgent` 的 `state` 物件有 25 個欄位，`stateKey` 用 `JSON.stringify` 衍生。任一欄位改變就觸發完整 re-register（含 `globalAgentRegistry.register`）。重度操作（拉 slider）會在 1 秒內噴 10+ 次註冊。應加 debounce 或 reducer。 |
| B2.6 | `ImageStudio.tsx:4047-4061` | `fillPrompt` 對未知 slot 沒報錯：fallback 直接寫 `setPrompt`。如果光球誤送 `slot: "title"`，會悄悄把標題塞進主 prompt 欄。 |
| B2.7 | `ImageStudio.tsx:3074-3080`（`handleQuickTry`） | 「一鍵帶操」恆寫死 `t2i + seedreamV4 + watercolor`，沒有 modality 分流，光球如果在 edit / SD / 3D tab 觸發 autopilot，會跳回 t2i 蓋掉使用者進度。 |
| B2.8 | `ImageStudio.tsx:4148-4165` | drawMode allow-list 已從 4 個擴成 7 個與 UI 對齊（comment 顯示是修過的 bug），但**沒留下回歸測試**，下次重構容易 regress。 |
| B2.9 | `ImageStudio.tsx:3949-3984` | tab-specific state 用 conditional spread。`activeTab === "edit"` 只暴露 `strength/guidance/inferSteps/outputSize`，但 edit tab 也用到 `negPrompt`、`refImageUrl`、`extraRefUrls`、`maskUrl`（影響生成）— observer 看不到這些，光球無法判斷「為何 nano-banana-pro-edit 失敗」。 |

#### B3. Context / 觀察器層（`PageAgentContext.tsx`）

| # | 位置 | 缺陷 |
|---|------|------|
| B3.1 | `PageAgentContext.tsx:362-374` | capability 不符時只 `console.warn` 不擋。Production build 通常會把 console 過濾掉，這個警告等於不存在。應該至少 `reportFeedback` 一筆 "capability_drift"。 |
| B3.2 | `PageAgentContext.tsx:387-402` | per-task state 上報用 fire-and-forget `mutate`，server-side 4 kB cap 失敗會被 `onError: () => {}` 吞掉。image-studio 25 欄位 state 容易接近 cap，但**前端完全無感**，observer 默默失去視野。 |
| B3.3 | `PageAgentContext.tsx:421-435` | `dispatch` 的 `requireConfirmation` 預設 = `isDestructiveAction(action) && pageRef.current !== null`。在頁面尚未 register 完成（剛 navigate 過去）的瞬間 `pageRef.current` 是 null，此時破壞性動作會跳過 confirmation 直接 enqueue。隊列 drain 時實際執行卻沒被攔。 |
| B3.4 | `PageAgentContext.tsx:498` | `runWithTimeout` 預設 `15_000` ms — image-studio 的 `submit` 不會立刻完成，這個逾時時間設計給「dispatch 派發」而非「生成完成」，但測試 / e2e 容易誤解為「光球願意等 15s」。 |

#### B4. 跨層的根本性缺口（與 `docs/agent/light-ball-agent-enhancement-plan.md` 對齊）

| # | 缺口 | 影響 image-studio |
|---|------|---------------|
| B4.1 | 缺 step reflection / quality check | 全黑圖、aspect-ratio mismatch、文字嚴重變形 — orchestrator 完全沒察覺，盲目繼續下一步。 |
| B4.2 | Modality coherence 沒接 | 圖→影片 跨頁時，16:9 餵 1:1 only 模型直接 400。 |
| B4.3 | Content moderation 沒接 | image-studio prompt 直送 fal.ai，無前置審核。 |
| B4.4 | Memory RAG 沒做避坑提取 | 失敗工作流沒回灌 planner，重複踩雷。 |
| B4.5 | Workflow template 沒接 | 「IG Reels 30s」每次都要 planner 重新發明。 |

---

## 三、修補優先序（建議）

| 優先 | 項目 | 影響面 |
|------|------|--------|
| P0 | 修 `{false && showHistory && ...}` → `{showHistory && ...}`，或刪除整個歷史側欄與 HistoryPanel（240 行死碼） | A1, B8 |
| P0 | `handleGenerate` 先驗證再進 generating 狀態 | A4 |
| P0 | flux 系列改 `seedNum !== undefined` | A3 |
| P0 | `reset` 列入 `isDestructiveAction`，光球觸發要 confirm | B2.4 |
| P1 | 刪除 `className="hidden"` 的「模型細膩導覽」整段（87 行死碼） | B1 |
| P1 | 補 `appRegistry["image-studio"].supportedActions` 含 `navigate`、`focusElement` | B1.1, B2.2 |
| P1 | `focusElement` handler 加上 `scrollIntoView` 並 focus 元素 | B2.1 |
| P1 | `nanoBanana2Edit` 接上 `aspectRatio` state；`ASPECT_RATIOS` 與後端對齊（11 個） | A7, B5 |
| P1 | `mutations` 物件 memoise / 改成命名 hook | A6 |
| P1 | `setParam` 加 enum 驗證（aspectRatio、drawMode、rodinQuality、hunyuanGenType…） | B2.3 |
| P1 | image-studio 的 page quick actions 至少新增 1 顆「真的會 dispatch」的 chip（如「直接套水彩風格」） | B1.4 |
| P2 | 統一 `image-specialist` 對外暱稱（建議只留「圖圖」） | B1.2 |
| P2 | 補 page-scoped action handler 單元測試 + 「frontend mutations 鍵 ⊆ router procedures」整合測試 | D2, D3 |
| P2 | 後端 `falQueueRun` 刪掉死參數 `waitSec`；`recordErrorTrace` 帶 userId | C1, C3 |
| P2 | 後端為 nanoBananaProEdit / nanoBanana2Edit / flux2ProEdit 補 model-specific aspect ratio 子集 | C4 |
| P2 | 接 step reflection + modality coherence + content moderation（Phase 1–2 of enhancement-plan） | B4.1, B4.2, B4.3 |
| P3 | 拆分 `ImageStudio.tsx`（5,239 行）— 至少 12 個 sub-component 抽到 `client/src/pages/image-studio/` 子目錄 | B6 |
| P3 | `handleGenerate` deps 列表（54 個）改 reducer | B7 |

---

## 四、附錄：盤點到的相對健康的部分

- 後端 `normalizeAspectRatio` 有完整單元測試覆蓋（SeeDream / Imagen4 / NanoBanana 三套支援集），邏輯穩。
- `falDispatcher` + fallback chain 把模型錯誤切換邏輯與 router 解耦。
- 非同步任務經由 webhook（`webhookFal`）回灌結果 + `checkImageStatus` polling 雙保險。
- 光球 action 透過 `useRegisterPageAgent` 完整覆蓋 6 個 tab、22 個模型、25 個參數。
- Orb feedback / memory persistence 已透過 `trpc.orbMemory.append` 寫回。
- 既有規劃文件（`docs/agent/light-ball-agent-enhancement-plan.md`、`orb_optimization_plan.md`、`orb_connection_report.md`）已系統性列出更深層缺口；本報告的 P2/P3 與其呼應。

---

## 五、檔案座標索引

| 角色 | 路徑 | 行數 |
|------|------|------|
| Image Studio 主頁 | `client/src/pages/ImageStudio.tsx` | 5,239 |
| Image Studio Router | `server/routers/imageStudio.ts` | 1,457 |
| 光球 Page Agent Context | `client/src/contexts/PageAgentContext.tsx` | 597 |
| 光球 Widget 駐點 | `client/src/components/ProactiveOrbWidget.tsx` | 4,077 |
| 光球引導面板 | `client/src/components/OrbGuidePanel.tsx` | ~4,400 |
| 跨頁 Action Builders | `shared/orb-studio-actions.ts` | 3,020 |
| 角色定義（圖圖） | `shared/orb-agent-roles.ts` | 2,323 |
| 角色推薦（圖像意圖） | `shared/orb-specialized-agents.ts` | 412 |
| 全站 App Registry | `shared/appRegistry.ts` | 1,162 |
| 比例正規化測試 | `server/image-studio-aspect-ratio.test.ts` | 245 |
| 光球 image edit 路由測試 | `server/orb-image-edit-routing.test.ts` | 109 |
| 既有增強計畫 | `docs/agent/light-ball-agent-enhancement-plan.md` | 79 |
| 既有光球優化計畫 | `orb_optimization_plan.md` | — |

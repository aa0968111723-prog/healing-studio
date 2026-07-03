# CC1 — AnimationStudio.tsx 前端深挖(Y4 重跑)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:client/src/pages/AnimationStudio.tsx(6946 行)

## 範圍與方法
本次為**獨立重跑**的對抗式稽核,不採信任何前次報告的結論——每一條發現都由本檔或其直接呼叫的
`server/routers/*.ts`、`server/services/*.ts`、`shared/*.ts`、`drizzle/schema.ts` 原始碼重新讀取驗證,
逐一標註「檔案:行號」。已存在 `docs/research/Y4-animation-studio-frontend.md`(同一 commit,檔案內容
逐字比對 `git diff 812f6fdb HEAD -- client/src/pages/AnimationStudio.tsx` 為空,無變動);本次交叉核對其
全部發現後,**逐一在原始碼中重新驗證屬實**(未發現任何行號或事實性錯誤),因此不重複列出完全相同的證據鏈,
但會用自己的話重新引用關鍵行號。本次新增的獨立深挖聚焦在題目指定的三個角度,且是 Y4 未觸及的缺口:
(1) `creativeProjectId`/`worldFrameworkId` 是否真的貫穿本頁的北極星資料脊椎、
(2) 首跑產出的「髒分鏡」(空 `scenesJson`)在資料層與 UI 層是否有任何補救路徑、
(3) AnimationStudio 的「編排管線」與 DirectorAI 的「送入影片製作佇列」是否為同一條北極星產線或已分岔成兩條互不相通的路。

北極星本質對照基準:創作者在單一專案裡走 **腳本→分鏡→逐幕(字卡+畫面圖影+聲音)→簡易拼接→輸出→打包**,
且應由 `creative_projects`(`drizzle/schema.ts:3678-3728`)這個「脊椎」把 Director session、世界觀
framework、世界分鏡三者綁定成同一個可被全站光球/各 Studio 頁共享的創作單位。

---

## 嚴重度:CRITICAL

### CC-1. `generateStoryboard` 首跑必產「髒分鏡」,且本頁 UI 完全沒有事後修補能力——唯一出路是刪除重來
- **發現**:
  - Page-agent 唯一可觸發的「生成分鏡」action(`client/src/pages/AnimationStudio.tsx:5625-5640`,
    呼叫 `generateStoryboardMutation`,定義於 `:5520-5529`)實際打到
    `worldbuildingGeneration.generateStoryboard`(`server/services/worldbuildingGeneration.ts:425-458`)。
    該端點檔頭註解自證(`:9`)「`generateStoryboard` 只建分鏡骨架(DB row),不在這層做 AI」,實作
    (`:443-455`)呼叫 `db.createWorldStoryboard({ ..., scenesJson: [], ... })`——**沒有任何 LLM 呼叫**,
    `scenesJson` 恆為空陣列,`name` 只是把 description 截前 30 字。
  - 成功後 `onSuccess`(`:5521-5527`)無條件顯示「分鏡已生成」的成功 toast,並 `navigate(/animation/${storyboardId})`
    直接跳轉到分鏡細節頁——使用者(或 AI 代理)得到的是「看起來成功、實際是空殼」的**已落地 DB row**,
    這正是題目所指「首跑產出髒資料」的具體樣貌:不是報錯,是靜默寫入一筆 0 場次的分鏡草稿。
  - 分鏡細節視圖(`:5788-5876`)渲染這筆髒資料**不會崩潰**——`StoryboardTimelinePreview`
    (`:3212-3260`)在 `storyboard.scenes = []` 時單純顯示「0 場 · 0 圖楨」與空的時間軸尺規
    (已讀原始碼確認,無防禦性判斷但邏輯本身對空陣列安全);`planAnimationPipeline`
    (`shared/worldbuilding-animation.ts:616-637`,`for (const scene of storyboard.scenes)`)同樣對空陣列
    安全,只是回傳 0 步驟的計畫——使用者按下「編排動畫管線」會得到「管線編排完成:0 步驟、估時
    0:00、估價 $0」的**空洞成功訊息**(`:5687-5695` 的 toast 樣板套用 `data.steps.length` 等欄位)。
  - **關鍵新發現(Y4 未觸及)**:伺服器端 `worldStoryboard.update` 的 patch schema
    (`server/routers/worldStoryboard.ts` 內 `worldStoryboardInputSchema.partial()`)明確支援
    `scenes` 欄位並會寫回 `scenesJson`(該 router 檔內 `update` mutation:
    `...(p.scenes !== undefined ? { scenesJson: p.scenes } : {})`)——也就是說,「修補一筆既有分鏡的場次
    內容」這個後端能力**是存在的**。但 `client/src/pages/AnimationStudio.tsx` 全文對
    `trpc.worldStoryboard.update` 唯一的呼叫是 `renameStoryboard`(`:5724-5729`),而它在整份檔案的兩處
    呼叫點(`:6695`、`:6708`)**都只送 `{ patch: { name: trimmed } }`**——只改名字,從未送出 `scenes`。
    換言之:後端能修、前端完全沒接。一旦 `generateStoryboard` 落地一筆空分鏡,使用者在這個頁面上
    **沒有任何按鈕、表單或編輯器可以把場次內容補進去**——只能用垃圾桶圖示(`:6575-6591`,
    `deleteStoryboard.mutate`)整筆刪掉,再用完全不同的表單 `SeedStoryboardForm`
    (`:6725-6884`,呼叫 `worldStoryboard.seedSkeleton`)重新「派生」一次——這就是題目所指的
    「需重跑」:不是重試同一個動作,而是必須換一條完全不同的產線路徑才能拿到真正有內容的分鏡。
  - 進一步確認:`seedSkeleton` 本身(`server/routers/worldStoryboard.ts:230-266`)輸入 schema 沒有
    `scriptId` 欄位(僅 `worldId, totalDurationSec, sceneCount, aspectRatio, fps, autoSave, name`),
    只讀世界觀 framework(角色/場景/風格/音樂),不讀腳本內容——所以「重跑」出來的分鏡與使用者原本
    想描述的腳本/描述文字也是脫鉤的,並非單純的「換一顆按鈕重新生成同樣的東西」。
- **影響**:北極星「腳本→分鏡」這一步在 AnimationStudio 內部就已經是斷裂且不可逆的:
  (a) 唯一支援「依描述/腳本生成」語意的路徑產出空殼且不可修補,(b) 唯一可修補的後端欄位完全沒有
  前端入口,(c) 唯一能拿到真內容的路徑不吃腳本內容。三者疊加,使用者對「AI 生成分鏡」功能的信任會在
  第一次使用就崩潰,且無任何錯誤訊息提示「這是空的」——UI 全程顯示「成功」。
- **建議**:
  1. 短期:`generateStoryboard` 的 `onSuccess` 判斷 `data.storyboard?.scenes?.length` 若為 0,不要顯示
     「分鏡已生成」,改導向「請改用『派生分鏡骨架』」的明確提示,或乾脆讓 agent action 直接改呼叫
     `seedSkeleton`(把 description 轉成 `name`)。
  2. 中期:在分鏡細節視圖補一個「編輯場次」UI,實際呼叫已存在的 `worldStoryboard.update` 的 `scenes`
     patch 欄位,讓「髒分鏡」可以原地修補而非只能刪除重建。
  3. 讓 `seedSkeleton`/`generateStoryboard` 至少其中一條路徑真正吃腳本內容(呼應 Y4 M3 的建議)。

### CC-2. `creativeProjectId`/`worldFrameworkId` 完全未貫穿本頁——AnimationStudio 是北極星脊椎外的孤島
- **發現**:
  - 全文搜尋 `client/src/pages/AnimationStudio.tsx` 對 `creativeProject`、`creativeProjectId`、
    `worldFrameworkId`、`useActiveProject`、`useWorldContext`、`useProjectSpine` 六個關鍵字,**零命中**。
    本頁唯一的路由參數是 `useParams<{ storyboardId?: string }>()`(`:5350`),沒有任何 `projectId` 概念;
    「目前在編輯哪個世界觀」完全由頁面本地 `useState<number | null>` 的 `selectedWorldId`
    (`:5361`)決定,初始值由 `worldsQuery.data`(`trpc.worldbuilding.list`,`:5356`)**依
    `updatedAt` 降冪排序**(`server/db.ts:3163-3173`,`orderBy(desc(worldbuildingFrameworks.updatedAt))`)
    取第一筆自動選取(`:5383-5392`)。
  - 對照 `drizzle/schema.ts:3669-3728`(`creative_projects` 表)的檔頭註解:「把 Director session +
    Worldbuilding framework + World Storyboard 三者綁定成一個有意義的創作單位,讓全站光球與各 Studio
    頁面可以共享上下文」,以及 `server/routers/creativeProject.ts`(完整 CRUD + `link` mutation,可設/解綁
    `worldFrameworkId`)——這一整套「脊椎」機制在伺服器端與前端 context 層都已經是完工狀態:
    `client/src/contexts/WorldContextContext.tsx:121-194` 會 `trpc.creativeProject.get.useQuery(...)`
    取出 `projectQuery.data?.worldFrameworkId`,並透過 `useWorldContext()` 供全站元件讀取;
    `WorldContextProvider` 在 `client/src/App.tsx:440-464` 包住整個 `<Router />`(含 `/animation` 路由),
    **不是沒接上基礎建設,是這頁自己選擇不讀它**。
  - **對照組(證明是本頁的疏漏,不是架構本身缺失)**:`client/src/pages/DirectorAI.tsx:107`
    import `useWorldContext`,`:2385` 呼叫 `const worldCtx = useWorldContext();`,並在兩處關鍵動作——
    `:2843`(批次 CO-STAR)、`:4075-4076`(`queueForVideo` 的 `worldId` 決策:
    `overrideWorldId ?? worldbuildingSelectedId ?? worldCtx.worldFrameworkId`)——都會 fallback 到
    「目前 active creative project 綁定的世界觀」。也就是說,**同一個「當前世界觀」概念在 DirectorAI
    正確接上了脊椎,在 AnimationStudio 完全沒接**。
  - 反向連結同樣缺失:`client/src/spine/projectGateway.ts:314-316`(`linkWorld` →
    `creativeProject.link.mutate({ id, worldFrameworkId })`)與唯一消費它的 UI
    `client/src/shells/video/console/WorldLinkPicker.tsx`,只出現在 `/video` 座艙(且掛載端受
    `ENABLE_PROJECT_HUB` 旗標保護,`client/src/config/videoFlags.ts:67` 預設 **OFF**——已用
    `readFlag("VITE_ENABLE_PROJECT_HUB", false)` 驗證)。AnimationStudio 本身沒有任何「連結到目前創作專案」
    的按鈕或狀態顯示,使用者在這裡建立/編輯的世界觀,無法從這頁反向寫回 `creative_projects.worldFrameworkId`。
- **具體會踩到的情境**:使用者在 `/video` 座艙建立了創作專案 A、連結了世界觀 W1;之後想幫 W1 補角色設定,
  從導覽進到 `/animation`——這裡完全不知道「專案 A」的存在,只會依 `updatedAt` 自動選出最近更新的世界觀
  (若使用者剛好前一刻在別處碰過 W2,例如透過 API/另一個分頁動過 W2 的資料),使用者會在不知情的狀況下
  編輯到 W2 而非 W1;回到 DirectorAI 產生腳本時,`worldCtx.worldFrameworkId` 讀到的仍是專案 A 綁定的 W1,
  兩邊「當前世界觀」的認知會靜默分岔。
- **影響**:違反北極星「AI 讀單一專案上下文全程逐步引導」的核心訴求——「專案」在這個頁面上根本不存在,
  使用者建立的世界觀是游離於 `creative_projects` 脊椎之外的資料孤島,只能靠自己記得哪個世界觀對應哪個
  專案。這是題目要求檢查的「creativeProjectId 是否貫穿」在本頁的答案:**沒有貫穿**。
- **建議**:讓 AnimationStudio 讀 `useWorldContext()`,當 `worldFrameworkId` 非 null 時優先選取對應世界觀
  (而非單純取 `updatedAt` 最新一筆),並在頁面顯示「目前連結專案:__」+ 提供連結/解綁入口
  (可重用既有 `creativeProject.link` procedure,零新後端)。

---

## 嚴重度:HIGH

### H1. Rules-of-Hooks 違規——首次載入與「建立第一個世界」必定觸發 React crash(獨立重新驗證,屬實)
- **發現**:元件主體 `export default function AnimationStudio()`(`:5348`)從 `:5356` 起無條件呼叫
  `worldsQuery`/`voicesQuery`/`linkableModelsQuery`/多個 `useMutation`/`useEffect`。但四個提前 `return`——
  `:5734`(`worldsQuery.isLoading`)、`:5742`(`loadError`)、`:5761`(`worlds.length === 0`)、`:5788`
  (`detailStoryboardId && storyboardDetailQuery.data && selectedWorld`)——全部寫在 `:5879` 起的 7 個
  hook 呼叫**之前**:`effectiveWorld` useMemo(`:5879`)、`visualAssetGallery` useMemo(`:5898`)、
  `worldProgress`/`readiness`/`actionPlan` 三個 useMemo(`:5952-5954`)、`handleWorldbuildingAction`
  useCallback(`:5956`)、`completionRatio` useMemo(`:5968`)。經逐行重讀 `:5348-5982` 確認:
  - 首次掛載時 `worldsQuery.isLoading === true`,只跑到 `:5734` 就 return,不呼叫後面 7 個 hook。
  - 資料回來後同一個 fiber 觸發 update render,若 `worlds.length > 0` 且無 `detailStoryboardId`,會一路
    執行到 `:5879`,多呼又 7 個 hook——React 依上一輪 hook 鏈走訪,會丟出
    `Rendered more hooks than during the previous render.`。
  - 同一模式在「世界觀列表 0→1 筆」時重現:`createWorld.onSuccess`(`:5418-5424`)成功後
    `setSelectedWorldId(data.id)`,`worlds.length` 從 0 變 1,同一元件實例從「提前 return」路徑轉為
    「完整路徑」,一樣會多呼叫 7 個 hook。
  - 已驗證排除:`/animation` 與 `/animation/:storyboardId` 是 `client/src/App.tsx:270-275` 兩個獨立
    `<Route>`,經 `RouteTransition`(`key={location}`)remount,不會在這兩個 view 之間切換時觸發此問題;
    只在「同一次掛載內」的 loading→loaded 或 0→1 轉場才會炸。
  - **根因確認**:`eslint.config.js`(專案根目錄,全檔讀畢)是 stub——`languageOptions.parser` 的
    `parseForESLint()` 永遠回傳空 AST(`body: []`),`rules: {}` 完全無規則,含
    `react-hooks/rules-of-hooks` 在內的所有規則實質不執行,靜態檢查對此類 bug 完全失能。
- **影響**:此為北極星入口頁的首次載入必炸路徑,任何未預先快取(新分頁、清快取、剛登入)的正常訪問,
  或任何新使用者建立第一個世界觀後的下一秒都會觸發未捕捉例外,被 `ErrorBoundary` 接住顯示「頁面暫時
  遇到了一點小狀況」,重試後因快取已有資料而「自我痊癒」——這也是為何此 critical bug 可能長期未被
  人工測試發現。
- **建議**:把 `:5879-5968` 的 7 個 hook 呼叫全部移到檔案最上方、四個提前 return 之前;修好
  `eslint.config.js`,至少接上 `eslint-plugin-react-hooks` 的 `rules-of-hooks`。
- **Cluster**: northstar / other(靜態品保根因)。

### H2. 北極星「打包/最終成品」與「素材管理」三元件已完工,但整頁從未渲染(獨立重新驗證,屬實)
- **發現**:`:91`(`ProductionPackagePreview`)、`:92`(`VisualInspirationLibraryPanel`)、`:99`
  (`ConsistencyCheckPanel`)三個 import,對整份 6946 行檔案搜尋 `<ProductionPackagePreview`、
  `<VisualInspirationLibraryPanel`、`<ConsistencyCheckPanel`**零命中**——只有各自的 import 陳述式,
  無任何 JSX 使用。三者均為完整實作(非 TODO 佔位):
  - `client/src/components/animation/ProductionPackagePreview.tsx:12-21` 是觸發文字為
    「產生完整製作包」的 Dialog,呼叫 `shared/worldbuilding-production-package.ts` /
    `shared/worldbuilding-generation-tasks.ts` 的純函式,對應北極星「輸出→打包」最後一步,純前端無
    未接後端依賴,可隨時掛載。
  - `client/src/components/animation/VisualInspirationLibraryPanel.tsx:7-16` 對應「快速素材管理」。
  - `client/src/components/animation/ConsistencyCheckPanel.tsx:39,56` 呼叫真實存在的
    `trpc.worldbuilding.checkConsistency`(已在 `server/routers/worldbuilding.ts:688` 驗證存在)。
  - 已排除的疑慮:`GenerateImageButton`(`:495`、`:4063`)、`GenerateVoiceButton`(`:1088`)、
    `CompositionAssistant`(`:6667`)確實有掛載,並非整批 import 都是死的。
- **影響**:對照北極星終點「達最終成品」,使用者做完角色/場景/分鏡後,在這頁**找不到任何**「產生完整
  製作包」的入口——不是後端沒做、不是元件沒寫,純粹是頁面忘了掛載。
- **建議**:在世界觀主畫面(`PageHeader` 的 `secondaryActions` 或新增「打包/靈感庫」分頁)接上這三個元件。
- **Cluster**: deadcode / northstar。

### H3. AnimationStudio 的「編排動畫管線」與 DirectorAI 的「送入影片製作佇列」是兩條互不相通的獨立產線
- **發現**:
  - AnimationStudio 內「編排動畫管線」按鈕(`:5851-5860`,`planPipeline.mutate({ id: sb.id, persist: true })`)
    呼叫 `worldStoryboard.planPipeline`(`server/routers/worldStoryboard.ts:284-311`),只把
    `planAnimationPipeline()` 的結果寫回 `pipelinePlanJson` 供顯示(`PipelinePlanView`,
    `:6888-6946`,只有 `Badge`/`Collapsible`,**沒有任何 `<Button>`** 可以真正執行或前往執行頁)。
    對應的 `updateJob`(`server/routers/worldStoryboard.ts:314-350`,讓渲染管線回報進度用)在整個 client
    端(含 `DirectorAI.tsx`)搜尋 **零呼叫方**——沒有任何目前程式碼會回寫這個進度欄位,`sb.jobsJson`
    是一個只寫不讀回的死欄位。
  - 與此同時,`client/src/pages/DirectorAI.tsx:2812-2824`(`queueForVideoMut`,
    呼叫 `worldStoryboard.queueForVideo`,`server/routers/worldStoryboard.ts:506-538`)是**另一條完全獨立
    可執行**的「腳本段落→分鏡→送去影片製作」路徑:它自己組 `scenes`、自己 `createWorldStoryboard`,
    成功後 toast 附「前往影片製作」action(`navigate('/video-studio?queue=...')`,`:2818-2821`),
    真的把使用者導去下一步。`worldStoryboard.createFromSegments`(`:2800-2809`)成功後甚至會
    `navigate(/animation/${data.id})`——即 DirectorAI 產生的分鏡會被導回 AnimationStudio 的分鏡細節頁
    顯示,但 AnimationStudio 自己規劃出的 `pipelinePlanJson` 從未被這條真正執行的路徑讀取或使用。
  - 也就是說:全站唯二涉及「動畫管線規劃/執行」語意的機制(`planAnimationPipeline`
    vs `queueForVideo`+`createFromSegments`)是完全獨立、互不引用的兩套實作,分別活在
    AnimationStudio(規劃但不可執行)與 DirectorAI(可執行但不讀規劃結果)。
- **影響**:即使把「執行交給 Director AI」視為合理的架構分工(`worldStoryboard.ts:12-15` 檔頭註解也如此
  聲明),AnimationStudio 本身完全沒有把使用者導向那條真正可執行的路徑——沒有「前往導演 AI 執行」按鈕、
  沒有連結。頁面內僅有的 `/director` 連結(`:5802`、`:6002`「返回導演 AI」)只在沉浸模式顯示,語意是
  「返回」而非「前進執行」,且與是否已產生 `pipelinePlan` 無關(恆常顯示)。使用者做完「編排動畫管線」後,
  在這個頁面裡找不到「那接下來呢?」的答案,而真正能推進到底的路徑要靠使用者自己知道要去 DirectorAI
  重新走一遍(用不同的資料模型:腳本段落而非 `pipelinePlanJson`)。
- **建議**:`sb.pipelinePlan` 存在時,在 `PipelinePlanView` 旁補一顆導到 `/director`(帶 `storyboardId`)
  的 CTA;中長期評估是否該讓 `queueForVideo` 直接消費 `planAnimationPipeline` 的輸出,避免兩套規劃邏輯
  各自演化、產生行為分歧。
- **Cluster**: northstar / contract-mismatch。

### H4. `generateStoryboard` 對外承諾「AI 生成分鏡時間軸」,伺服器端自證不做 AI(獨立重新驗證,屬實)
- 與 CC-1 為同一組證據鏈(`worldbuildingGeneration.ts:9,425-458` vs `:5566-5569` 的 hint 文案
  「可根據腳本或描述生成分鏡時間軸」),此處僅標注契約落差本身:hint 文案承諾生成「時間軸」,實際只建立
  空殼 DB row。已併入 CC-1 的建議一併處理,不重複列建議。
- **Cluster**: contract-mismatch。

### H5. AI「生成角色/生成場景」在人類可見 UI 上完全不可觸發,只有 page-agent 能呼叫(獨立重新驗證,屬實)
- **發現**:`generateCharacterMutation`(`:5499-5508`)、`generateSceneMutation`(`:5510-5518`)兩個
  mutation 在整份檔案中只在 page-agent 的 `handle` callback 內被呼叫(`:5593-5607`、`:5609-5623`)。
  「characters」分頁(`:6284`起)與「scenes」分頁(`:6345`起,經檢視實際 render 內容)只有手動新增空白
  角色/場景的按鈕,沒有任何「AI 生成」按鈕、輸入框或觸發點。
- **影響**:兩個已打通後端 LLM 的生成能力,在一般使用者從未主動呼叫頁面 AI 代理聊天的情況下等同不存在。
- **建議**:在角色/場景分頁補一顆「AI 生成」按鈕(描述輸入 + 呼叫既有 mutation)。
- **Cluster**: deadcode / northstar。

---

## 嚴重度:MEDIUM

### M1. Debounce 自動存檔沒有 flush,快速切換/新增/刪除世界觀會靜默遺失最近一次編輯(獨立重新驗證,屬實)
- **發現**:`handlePatchWorld`(`:5462-5496`)用 600ms `setTimeout` 去抖動存檔;三個 `useEffect`
  (`:5383`、`:5405`、`:5446`)逐一讀畢確認**沒有任何一個**在世界切換時 flush/clearTimeout 這個計時器。
  `:5446-5458` 的同步邏輯:只要 `lastSyncedIdRef.current !== selectedWorld.id` 就立刻用伺服器資料整個
  覆寫 `draft`。重現路徑:打字觸發 600ms 計時器 → 600ms 內切換世界(下拉選單 `:6034` 一帶)、新增世界
  (`createWorld.onSuccess` `:5422` 呼叫 `setSelectedWorldId`)或刪除當前世界
  (`deleteWorld.onSuccess` `:5430`)→ effect 立刻覆寫 `draft` → 600ms 後計時器觸發的
  `updateWorld.mutate(...)` 讀到已被覆寫的新資料,舊世界那筆編輯從未送到伺服器,且無 toast 警告。
- **影響**:對「打字→立刻切換世界比較」這種自然操作模式,是無提示的資料遺失。
- **建議**:在 `saveTimer` 觸發前偵測 `selectedWorldId`/unmount 變化時先 flush,或改用「離開前偵測 dirty
  state 並提示」模式。
- **Cluster**: persistence。

### M2. LoRA 訓練頁面文案承諾「角色 ID 自動連結回來」,但沒有任何回傳識別欄位(獨立重新驗證,屬實)
- **發現**:`TrainCharacterLoraSection`(`:2409-2474`)說明文字(`:2456`)宣稱「完成後角色 ID 會自動連結
  回來」,但 `handleTrain`(`:2432-2448`)組出的 `URLSearchParams` 只有
  `modelName/triggerWord/description/trainingType/seedImages` 五個欄位,沒有 `characterId`、`worldId`,
  也沒有 `returnTo`/callback 參數。對 `client/src/pages/LoraTrainer.tsx` 全文搜尋
  `characterId`/`worldId`/`returnTo`/`linkBack`/`onComplete`/`animation`,**零命中**。真正把訓練好模型
  接回角色的機制是完全獨立、需手動操作的下拉選單 `character.linkedModelId`(`:1281-1293` 一帶,資料源
  `linkableModelsQuery` `:5358`)。
- **影響**:文案做了「自動化」承諾,實際上使用者訓練完得自己想起來回角色卡手動選,新手易誤判模型是否已連結。
- **建議**:要嘛實作「帶 characterId 回跳並自動寫入 linkedModelId」,要嘛修正文案為「訓練完成後請回到
  角色卡手動選擇模型連結」。
- **Cluster**: contract-mismatch。

### M3. Agent action schema 正式支援的 `"internal_model"` 執行模式,全專案唯一出現處是直接拒絕它(獨立重新驗證,屬實)
- **發現**:`shared/agent-actions.ts:218,224`(`mode: "dry_run" | "internal_model" | "page_agent"`)正式列為
  合法模式之一,`shared/worldbuilding-generation-tasks.ts:9` 也重複宣告同一組字面量類型。全 repo 搜尋
  `internal_model`,唯一的**執行邏輯**在 `client/src/pages/AnimationStudio.tsx:5645-5647`:
  ```
  if (action.mode === "internal_model") {
    return { ok: false, reason: "內建模型批次執行尚未啟用，請先使用 dry-run 或代理 workflow" };
  }
  ```
  沒有任何其他檔案(含 `DirectorAI.tsx`)對此 mode 做出真正處理。
- **影響**:型別/schema 對外承諾三種模式,實際只有 2/3 有作用;雖然是明確拒絕而非靜默失敗,仍是
  「schema 與實作不一致」的契約落差,對依賴型別簽章串接的呼叫端(含未來自動化工作流)是陷阱。
- **建議**:短期把型別上的 `"internal_model"` 標成 `@deprecated`/未實作,或補齊實作。
- **Cluster**: contract-mismatch。

---

## 低嚴重度 / 附加觀察(已驗證屬實,非本次主打)

- **`GenerateMusicButton` 死 import**:`:95` 匯入但整份檔案再無使用(對照 `GenerateImageButton`
  `:495,:4063`、`GenerateVoiceButton` `:1088` 皆有用到)。`MusicThemeCard`(`:2839-2932`)音樂主題卡只有
  「試聽 URL」文字輸入,沒有 AI 快速生成入口,與角色/場景卡的 Image/Voice 快速生成不對等。
  Cluster: deadcode。
- **重新命名圖示語意錯置**:分鏡卡片「重新命名」按鈕使用 `Wand2`(魔杖/AI 意象)圖示(`:6573`),但動作
  只是純文字重新命名,無 AI 成分,容易誤導使用者。Cluster: other。
- **沉浸模式狀態不持久**:`immersiveMode`(`:5354`)是純 `useState`,無 localStorage/URL 持久化;由於
  `/animation` 與 `/animation/:id` 是不同 Route(見 H1 已驗證排除段落),兩者間切換會整個 remount、
  把沉浸模式重置回 false。Cluster: other。
- **巨型單檔 + 無效 ESLint 的維護性問題**:本檔 6946 行內共塞了 1 個頁面 + 16 個獨立子元件
  (`ExpressionEditor` `:194`、`OutfitEditor` `:316`、`ThreeViewEditor` `:439`、
  `CharacterAnimationCard` `:530`、`TrainCharacterLoraSection` `:2409`、`StyleProfileCard` `:2478`、
  `MusicThemeCard` `:2839`、`StoryboardTimelinePreview` `:3212`、`WorldBasicsEditor` `:3322`、
  `ProductionManifestEditor` `:3410`、`SceneCard` `:3838`、`ImportExportButtons` `:4680`、
  `ResearchDatabaseEditor` `:4777`、`SoundLibraryEditor` `:5031`、`SeedStoryboardForm` `:6725`、
  `PipelinePlanView` `:6888`),搭配全檔失效的 `eslint.config.js`,是 H1 這種硬 crash 級 bug 能存在而未被
  攔下的根本原因之一。建議至少把上述子元件拆到 `client/src/components/animation/` 下個別檔案。
  Cluster: other。
- **`StoryboardTimelineUploader` 對空分鏡場次的降級行為**:`client/src/components/animation/
  StoryboardTimelineUploader.tsx:32-34` 用 `storyboard.scenes[0] || null` 取預設場次;若
  `storyboard.scenes` 為空(即 CC-1 描述的髒分鏡),`selectedScene` 恆為 `null`,「timeline」分頁的圖幀
  上傳功能會因缺乏可標記的場次而實質不可用(未進一步追蹤上傳按鈕是否有為 `null` 場次做禁用處理——
  **未在本檔驗證**其禁用邏輯細節,僅確認預設值來源)。Cluster: northstar。

---

## 已驗證排除的疑慮(negative results)

- **本頁使用到的所有 tRPC 端點在伺服器端皆存在**,經逐一開檔核對輸入/輸出 schema:
  `worldbuilding.{list,linkableVoices,linkableModels,create,delete,update,exportFull,importFull}`、
  `worldbuildingGeneration.{generateCharacter,generateScene,generateStoryboard}`、
  `worldStoryboard.{listByWorld,get,seedSkeleton,planPipeline,exportShotList,delete,update}`——
  無「呼叫不存在後端」的情況。`worldbuilding.checkConsistency`(`:688`)、`saveComposition`(`:753`)、
  `getCompositionSuggestions`(`:796`)、`worldStoryboard.queueForVideo`(`:506`)、`createFromSegments`、
  `updateJob`(`:314`)在伺服器端也都存在,只是各自的呼叫方不在本檔內(見 H2/H3)。
- **本頁未見任何 feature flag 直接鎖住本頁功能**:對 `client/src/config/featureFlags.ts`、
  `videoFlags.ts`、`projectFlags.ts` 搜尋 "animation" 字樣**零命中**——AnimationStudio 本身沒有被任何
  `ENABLE_*` 旗標包住(路由層面 `/animation` 也不在 `ENABLE_4SHELL` 的四殼路由之下,是舊版一直存在的獨立
  頁面)。與本頁相關但**互不相通**的旗標鎖是 `ENABLE_PROJECT_HUB`(預設 OFF,鎖住 `/video` 座艙內用來把
  世界觀連回創作專案的 `WorldLinkPicker`)——這進一步強化 CC-2 的結論:即使日後想透過 `/video` 座艙的
  UI 補上連結,那個入口本身現在也是預設關閉的。
- **本頁本身未發現用客戶端布林值/旗標充當安全邊界的 client-security 問題**(例如把角色/方案判斷寫死在
  前端擋 UI、藉此假設後端也擋住):本檔內搜尋 `isPro`/`plan`/`quota`/`credits`(僅命中「製作 credits/演職
  表」語意,非計費)/`role ===`/`isAdmin`/`subscription`/`tier` 皆與計費或權限判斷無關;敏感操作(建立
  /刪除/更新世界觀與分鏡)均透過 `protectedProcedure`,且已核對 `worldbuilding.get`/`worldStoryboard.get`/
  `create` 等端點在伺服器端皆有 `row.userId !== ctx.user.id` 的擁有權比對(`server/routers/worldbuilding.ts`
  一帶、`server/routers/worldStoryboard.ts` 一帶),非僅靠前端隱藏 UI。完整權限模型(RBAC 分層)
  **未在本檔驗證**。
- **本頁未發現注入類風險**:搜尋 `dangerouslySetInnerHTML`/`eval(`/`new Function(` **零命中**。
- **本頁未發現計費(billing)相關的直接漏洞**:圖像/語音生成走 `QuickGenerateButtons.tsx` 內的
  `GenerateImageButton`/`GenerateVoiceButton`,呼叫 `imageStudio.*`/`proStudio.elevenLabsTTS` 等獨立
  procedure,是否有 credit 額度檢查屬於這些 procedure 自己的伺服器端邏輯,**未在本檔驗證**
  (超出 AnimationStudio.tsx 本檔範圍)。
- **`worldbuilding.update` 的 `patch` 逐欄位比對無靜默丟棄**:`handlePatchWorld` 送出的 16 個欄位
  (`:5471-5488`)在伺服器端 `server/routers/worldbuilding.ts` 的 `update` 分支全部都有對應寫入分支。
- **`handleExportShotList`(`:5701-5715`)讀取的 `result.data.{body,mimeType}`** 與
  `worldStoryboard.exportShotList`(`server/routers/worldStoryboard.ts:620` 一帶)實際回傳欄位一致。
- **`/animation` 與 `/animation/:storyboardId` 為兩個獨立 `<Route>`**(`client/src/App.tsx:270-275`),
  經 `RouteTransition`(`key={location}`)remount,不會在這兩個 view 間切換時觸發 H1 的 hook 順序問題,
  只在同一次掛載內的 loading→loaded 或 worlds 0→1 轉場發生。
- **`SeedStoryboardForm` 的 `autoSave` 恆為 `true`**(`:6873`,硬編碼,非使用者可調),因此
  `worldStoryboard.seedSkeleton` 回傳的 `data.id` 在這條 UI 路徑上必為非 null,不會發生「派生了但沒存檔」
  的資料遺失——此路徑本身是乾淨的,「首跑髒資料」問題**只**發生在 CC-1 描述的 `generateStoryboard`
  (page-agent-only)路徑,而非人類可見的 `SeedStoryboardForm`。
- **`WorldContextProvider` 基礎建設本身正常**:`client/src/App.tsx:440` 確認其包住整個 `<Router/>`,
  非本頁不可達,而是本頁選擇不消費(見 CC-2)。

---

## 附錄:發現彙總表

| # | 嚴重度 | Cluster | 一句話 |
|---|---|---|---|
| CC-1 | critical | northstar | `generateStoryboard` 首跑產出空殼分鏡(髒資料),前端無任何修補入口,只能刪除重跑 |
| CC-2 | critical | northstar | `creativeProjectId`/`worldFrameworkId` 完全未貫穿本頁,與 DirectorAI 的脊椎串接脫鉤 |
| H1 | high | northstar / other | 條件式 hook 呼叫,首次載入/建立第一個世界必定觸發 React crash |
| H2 | high | deadcode / northstar | 製作包預覽/視覺靈感庫/一致性檢查三元件已完工但整頁從未渲染 |
| H3 | high | northstar / contract-mismatch | 「編排動畫管線」與 DirectorAI「送入影片製作佇列」是互不相通的兩條產線 |
| H4 | high | contract-mismatch | `generateStoryboard` 承諾 AI 生成時間軸,伺服器註解自證只建空殼(併入 CC-1) |
| H5 | high | deadcode / northstar | AI 生成角色/場景只有 page-agent 能觸發,UI 上無按鈕 |
| M1 | medium | persistence | debounce 存檔無 flush,快速切換世界會靜默丟失編輯 |
| M2 | medium | contract-mismatch | LoRA 訓練「自動連結角色」承諾與實作(純手動)不符 |
| M3 | medium | contract-mismatch | `internal_model` 模式型別存在但全專案只有拒絕邏輯 |
| low | low | deadcode/other | `GenerateMusicButton` 死 import、重新命名圖示語意錯置、沉浸模式不持久、巨型單檔維護性、`StoryboardTimelineUploader` 對空場次的降級行為 |

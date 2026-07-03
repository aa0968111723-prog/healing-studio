# Y4 — AnimationStudio.tsx 前端深挖(最大頁)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:client/src/pages/AnimationStudio.tsx(6946 行,鎖定北極星/契約/死UI,不必逐行)

## 範圍與方法
本次稽核以 `client/src/pages/AnimationStudio.tsx` 為核心,對照其呼叫的 tRPC 端點在
`server/routers/worldbuilding.ts`、`server/routers/worldStoryboard.ts`、
`server/services/worldbuildingGeneration.ts` 三個檔案中的實際實作(輸入/輸出 schema、
是否真的做 AI 生成),以及其匯入但可能未渲染的子元件(`client/src/components/animation/*`)。
對每一條發現皆先讀檔驗證,不臆測;無法在本檔驗證的部分已標註「未在本檔驗證」。

北極星本質對照基準:創作者在單一專案裡走 **腳本→分鏡→逐幕(字卡+畫面圖影+聲音)→簡易拼接→輸出→打包**;
AI 全程逐步引導、不跑偏;快速素材管理+目標管理;達最終成品。

---

## 嚴重度:CRITICAL

### C1. Rules-of-Hooks 違規 — 首次載入 / 建立第一個世界後必定觸發 React crash
- **檔案:行號**:`client/src/pages/AnimationStudio.tsx:5734`、`5742`、`5761`、`5788`(四個提前 `return`)vs
  `5879`(`useMemo` effectiveWorld)、`5898`(`useMemo` visualAssetGallery)、`5952-5954`(三個 `useMemo`:
  worldProgress / readiness / actionPlan)、`5956`(`useCallback` handleWorldbuildingAction)、
  `5968`(`useMemo` completionRatio)、`5982`(最後一個 `return null`)。
- **證據**:元件主體從 `export default function AnimationStudio()`(5348)開始,`worldsQuery`、
  `voicesQuery`、`storyboardsQuery`、多個 `useMutation` 等 hook 都在第一個 `if` 之前(5348–5733)無條件呼叫。
  但 `5734 if (worldsQuery.isLoading) return …`、`5742 if (loadError) return …`、
  `5761 if (worlds.length === 0) return …`、`5788 if (detailStoryboardId && … ) return …` 四個提前
  return **都寫在** 5879 起的 7 個 hook 呼叫**之前**。也就是說:
  - 首次掛載(`worldsQuery.isLoading === true`)這次 render 只呼叫「早期」的 hook,提前 return,
    **不會**呼叫 5879 起的 7 個 hook。
  - 資料回來後同一個 fiber 觸發 update render,這次 `isLoading` 為 false、`loadError` 為 null、
    `worlds.length` 若 >0 且沒有 `detailStoryboardId`,就會一路執行到 5879 呼叫「多出來」的 7 個 hook。
  - React 對同一個 fiber 的 update render 会依照上一輪建立的 hook 鏈走訪(`updateWorkInProgressHook`),
    多呼叫的 hook 會撞上 `nextCurrentHook === null`,丟出
    `Error: Rendered more hooks than during the previous render.`。
  - 完全相同的模式也發生在「世界觀列表從 0 筆變 1 筆」的瞬間:使用者在空狀態按「建立空白世界觀」
    (`createWorld.mutate`,5770-5782)成功後,`worlds.length` 從 0→1,**同一個** AnimationStudio 實例
    (未經路由切換、未 remount)從「提前 return」路徑轉為「完整路徑」,一樣會多呼叫 7 個 hook 而 crash。
- **已排除的疑慮**:`/animation` 與 `/animation/:storyboardId` 是 `client/src/App.tsx:270-275` 兩個
  獨立的 `<Route>`,各自包一層 `RouteTransition`(`client/src/components/RouteTransition.tsx:16`
  以 `key={location}` remount),所以「列表 view ↔ 分鏡細節 view」這兩個分支之間切換時 pathname 改變、
  元件會整個 remount,清空 hook 鏈,**不會**觸發此 crash(已驗證排除)。真正會炸的是「同一頁面、
  同一次掛載內」的兩個轉換:loading→loaded、以及 worlds 0→1。
- **為何沒被靜態檢查攔下**:專案根目錄 `eslint.config.js` 是一個 stub — `languageOptions.parser` 自訂了
  一個永遠回傳空 AST 的 `parseForESLint()`,且 `rules: {}` 完全沒有規則(含 `react-hooks/rules-of-hooks`)。
  ESLint 執行時實質上什麼都沒檢查。
- **影響**:AnimationStudio 是北極星「世界觀→分鏡」流程的**入口頁**。任何一次沒有預先快取資料的正常訪問
  (新分頁、清快取、剛登入),或任何新使用者「建立第一個世界觀」後的下一秒,都會在同一個 render 週期內
  丟出未捕捉例外,被 `App.tsx:169`(`ProtectedDashboardRoute`)包住的 `<ErrorBoundary inline>` 接住,
  對使用者顯示「頁面暫時遇到了一點小狀況」+ 手動「重新載入」卡片(`client/src/components/ErrorBoundary.tsx:145-168`)。
  按下重試後因為 React Query 快取已有資料、重新掛載時一次就走完整路徑,所以會「自我痊癒」——這也是這個
  critical bug 為何可能長期沒被人工測試盯上(看起來像偶發的「閃一下錯誤又正常了」)。
- **建議**:把 5879–5968 這 7 個 hook 呼叫全部搬到檔案最上方、四個提前 return 之前(hook 呼叫永遠不可放在
  條件式或 return 之後);同時修好 `eslint.config.js`,至少接上 `eslint-plugin-react-hooks` 的
  `rules-of-hooks`,否則同類問題會在其他巨型頁重演。

### C2. 北極星「打包/最終成品」與「素材管理」步驟已完整開發,但整頁從未渲染 — 三個元件是純死碼
- **檔案:行號**:`client/src/pages/AnimationStudio.tsx:91`(`import { ProductionPackagePreview } …`)、
  `:92`(`import { VisualInspirationLibraryPanel } …`)、`:99`(`import { ConsistencyCheckPanel } …`)。
- **證據**:對整份 6946 行檔案做全文搜尋 `<ProductionPackagePreview`、`<VisualInspirationLibraryPanel`、
  `<ConsistencyCheckPanel`,三者的 JSX 用法**零命中** — 除了各自的 `import` 陳述式外,再沒有任何地方
  提到這三個識別字。三者皆為完整實作、非 TODO 佔位:
  - `client/src/components/animation/ProductionPackagePreview.tsx:12-21` 是一個 Dialog,觸發按鈕文字
    直接就是「**產生完整製作包**」,內容呼叫 `shared/worldbuilding-production-package.ts` 的
    `buildWorldbuildingProductionPackage()` 與 `shared/worldbuilding-generation-tasks.ts` 的
    `buildWorldbuildingGenerationTasks()`,可複製/下載 Markdown、圖像/影片/語音 prompt——這正是北極星
    「輸出→打包」的最後一步,且是純前端(靠 shared 純函式運算,不依賴任何本頁未接的後端),隨時可掛。
  - `client/src/components/animation/VisualInspirationLibraryPanel.tsx:7-16` 是「視覺靈感庫」,呼叫
    `shared/visual-inspiration-library.ts` 的 `buildVisualInspirationLibrary()` /
    `scoreVisualInspirationCompleteness()`,對應北極星「快速素材管理」。
  - `client/src/components/animation/ConsistencyCheckPanel.tsx:39,56` 呼叫真實存在的後端端點
    `trpc.worldbuilding.checkConsistency`(已在 `server/routers/worldbuilding.ts:688` 驗證存在並可運作)。
- **影響**:三個「已完工」的北極星關鍵環節(打包、素材庫、一致性檢查)使用者永遠看不到、永遠點不到——
  不是後端沒做,也不是元件沒寫,純粹是頁面忘了掛載。對照北極星「達最終成品」的終點,這是目前最直接的
  斷點:使用者做完角色/場景/分鏡後,找不到任何「產生完整製作包」的入口。
- **已驗證排除的疑慮**:`GenerateImageButton`(:495、:4063)與 `GenerateVoiceButton`(:1088)則確實有
  掛載使用,並非整批 import 都是死的,只有上述三個 + 下述 C-list 的 `GenerateMusicButton` 是死的。
- **建議**:在世界觀主畫面(如 `PageHeader` 的 `secondaryActions` 或新增一個「打包/靈感庫」分頁)接上這三個
  元件,補上對應的 props(`world`、`storyboards`、`readinessPercent`、`warnings`)。

---

## 嚴重度:HIGH

### H1. `generateStoryboard` 對外承諾「AI 生成分鏡時間軸」,但伺服器端自己註明「不在這層做 AI」
- **檔案:行號**:
  - 承諾文案:`client/src/pages/AnimationStudio.tsx:5566-5569`
    ```
    action: "generateStoryboard",
    label: "生成分鏡",
    hint: "可根據腳本或描述生成分鏡時間軸",
    ```
  - 呼叫:`client/src/pages/AnimationStudio.tsx:5520-5529`(`generateStoryboardMutation`)、
    `5625-5640`(page-agent handler 內的 `mutateAsync`)。
  - 伺服器實作:`server/services/worldbuildingGeneration.ts:1-10` 檔頭註解第 9 行明講:
    「`generateStoryboard` 只建分鏡骨架(DB row),不在這層做 AI。」`425-458` 的實作也確實只是
    `db.createWorldStoryboard({ …, name: input.description.substring(0, 30) || "新分鏡", scenesJson: [], … })`
    — 沒有呼叫任何 LLM、沒有 `invokeLLM`、`scenesJson` 恆為空陣列。對照同檔 `generateCharacter`
    (`:341-381`)、`generateScene`(`:383-423`)兩者都會 `await generateCharacter(...)` /
    `await generateScene(...)`(內部呼叫 `invokeLLM`,檔頭註解第 4 行也明講「都會呼叫 LLM」)。
- **影響**:AI 代理(orb)若依照 `hint` 文字對使用者宣稱「可以幫你根據腳本生成分鏡時間軸」,實際執行後
  使用者只會得到一個名稱截字自 description、**完全沒有場景內容**的空分鏡殼。真正「會」把世界觀資料
  (角色/場景/風格/音樂/研究/音效/製作目標)派生成有內容的分鏡時間軸的是完全不同的端點
  `worldStoryboard.seedSkeleton`(`server/routers/worldStoryboard.ts:230-266`),但這支端點**沒有**被接到
  page-agent 的 `generateStoryboard` action——agent 只能呼叫到那支「假生成」。
- **建議**:要嘛把 agent 的 `generateStoryboard` action 改接 `seedSkeleton`(並補上 scriptId/描述轉場景數等
  參數),要嘛修正 hint 文案,不要對外承諾「生成分鏡時間軸」。

### H2. AI「生成角色 / 生成場景」在人類可見 UI 上完全不可觸發,只有 page-agent 能呼叫
- **檔案:行號**:`generateCharacterMutation`(`:5499-5508`)、`generateSceneMutation`(`:5510-5518`)
  兩個 mutation 在整份檔案中**只**在 page-agent 的 `handle` callback 內被呼叫
  (`:5593-5607`、`:5609-5623`);對「characters」分頁(`:6284-6343`)與「scenes」分頁
  (`:6345-6387`)實際 render 的按鈕只有手動新增空白角色/場景的 `+ 主角/配角/反派/路人`
  (`:6310-6339`)與 `+ 新增場景`(`:6370-6384`),兩個分頁裡沒有任何「AI 生成」按鈕、輸入框或觸發點。
- **影響**:這兩個已經打通後端 LLM 的生成能力(`server/services/worldbuildingGeneration.ts:341-423`),
  在一般使用者從未主動呼叫頁面 AI 代理聊天的情況下,是完全不可發現、等同不存在的功能——不符合北極星
  「AI 讀單一專案上下文全程逐步引導」的訴求(引導應該要有可見的 UI 鉤子,而非隱藏在只能靠對話觸發的
  action schema 裡)。
- **建議**:在角色/場景分頁補一顆「AI 生成」按鈕(描述輸入 + 呼叫既有 mutation),讓一般使用者不需要先
  知道要去跟 AI 代理聊天才能用到這個功能。

### H3. 「編排動畫管線」規劃完成後是死路,頁面內沒有任何執行/前往入口
- **檔案:行號**:觸發計畫的按鈕 `client/src/pages/AnimationStudio.tsx:5851-5860`
  (`planPipeline.mutate({ id: sb.id, persist: true })`),結果純展示於
  `PipelinePlanView`(`:6888-6946`)——整個元件只有 `Badge`/`Collapsible` 顯示步驟數、估時、估價、
  每步驟 kind/spirit/estimatedSec,**沒有任何 `<Button>` 或連結**可以真正執行、前往執行頁,或追蹤
  進度。伺服器端 `server/routers/worldStoryboard.ts:12-15` 的檔頭註解自己說明:「動畫管線實際執行
  (kick off render jobs)會接到 cross-modality-workflows 的 VIDEO_CREATION_WORKFLOW……執行交給
  Director AI / 全域代理」,而 `planPipeline`(`:284-311`)本身只寫回 `pipelinePlanJson` 供顯示,
  對應的 `updateJob`(`:314-350`,用來讓渲染管線回報進度)在整個 client 端(含
  `client/src/pages/DirectorAI.tsx`)**都沒有任何呼叫方**——即沒有任何目前程式碼會回寫這個進度欄位。
- **已驗證排除的疑慮**:並非「假功能」——`shared/cross-modality-workflows.ts` 中確實存在
  `VIDEO_CREATION_WORKFLOW`,執行邏輯是刻意分工到別處(Director AI),不是虛構模組。
- **影響**:即使把設計拆分視為合理的架構決定,**AnimationStudio.tsx 本身完全沒有把使用者導去下一步**——
  沒有「前往導演 AI 執行」按鈕、沒有連結、沒有提示文字。頁面內僅有的 `/director` 連結
  (`:5802`、`:6002`「返回導演 AI」)是沉浸模式下的「返回」按鈕,語意是「回去」而非「前進執行」,且與
  是否已產生 pipelinePlan 無關(一直都顯示)。使用者做完「規劃」後,在這個頁面裡找不到「那接下來呢?」
  的答案。
- **建議**:`sb.pipelinePlan` 存在時,在 `PipelinePlanView` 旁補一顆「前往導演 AI 執行渲染」的 CTA
  按鈕,直接帶 storyboardId 導到 `/director`。

---

## 嚴重度:MEDIUM

### M1. Debounce 自動存檔沒有 flush,快速切換/新增/刪除世界觀會靜默遺失最近一次編輯
- **檔案:行號**:`handlePatchWorld`(`:5462-5496`)用 600ms `setTimeout` 去抖動存檔,但整份檔案的三個
  `useEffect`(`:5383`、`:5405`、`:5446`)裡**沒有任何一個**在卸載或切換世界時 `clearTimeout`/flush 這個
  `saveTimer`。世界切換的同步邏輯在 `:5446-5458`:只要 `lastSyncedIdRef.current !== selectedWorld.id`
  就立刻 `setDraft(selectedWorld)`,用伺服器資料整個蓋掉 `draft`。
- **重現路徑(皆會觸發)**:
  1. 使用者在世界觀基本資料 / 角色卡 / 場景卡打字(觸發 `handlePatchWorld`,啟動 600ms 計時器)。
  2. 在 600ms 內從下拉選單切換另一個世界(`:6034-6048`),或按「新增世界」
     (`createWorld.onSuccess` 在 `:5422` 呼叫 `setSelectedWorldId(data.id)`),或刪除當前世界
     (`deleteWorld.onSuccess` 在 `:5430` 呼叫 `setSelectedWorldId(null)`)。
  3. `:5446` effect 立刻用新世界(或 `null`)覆寫 `draft`;600ms 後計時器才觸發的
     `updateWorld.mutate(...)` 讀到的已經是新世界的乾淨資料,舊世界那筆真正的編輯**從未被送到伺服器**,
     也沒有任何 toast / 警告告訴使用者。
- **影響**:對「打字→立刻切換世界比較」這種很自然的操作模式,是無提示的資料遺失,直接傷害北極星
  「快速素材管理」與整體對「世界觀資料不會丟」的信任。
- **建議**:在 `saveTimer` 觸發前偵測 `selectedWorldId`/unmount 變化時先 flush(立即送出待存的 patch),
  或改用「離開前偵測 dirty state 並提示」的模式。

### M2. LoRA 訓練頁面文案承諾「角色 ID 自動連結回來」,但沒有任何回傳識別欄位
- **檔案:行號**:`TrainCharacterLoraSection`(`:2409-2474`)的說明文字在 `:2456`:
  「……跳轉到模型訓練中心開始訓練專屬 LoRA。**完成後角色 ID 會自動連結回來**。」但
  `handleTrain`(`:2432-2448`)組出的 URLSearchParams 只有 `modelName`、`triggerWord`、`description`、
  `trainingType`、`seedImages` 五個欄位,**沒有** `characterId`、`worldId`,也沒有任何 `returnTo`/
  callback 參數。對 `client/src/pages/LoraTrainer.tsx` 全文搜尋 `characterId`/`worldId`/`returnTo`/
  `linkBack`/`onComplete`/`animation`,**零命中**;該頁只讀取 `seedImages`/`modelName`/`trigger`
  等參數(約 `:285-323`)來預填訓練表單,完全不知道這次訓練是為了哪個角色。
- **已驗證的真實連結機制**:角色卡上真正把訓練好的模型接回角色的方式,是完全獨立、需要使用者手動操作的
  下拉選單 `character.linkedModelId`(`client/src/pages/AnimationStudio.tsx:1281-1293`),資料來源是
  `linkableModelsQuery`(`trpc.worldbuilding.linkableModels`,`:5358`)。
- **影響**:文案對使用者做了「自動化」的承諾,但實際上使用者訓練完模型後,得自己想起來回到角色卡手動選。
  對新手使用者尤其容易誤以為訓練完就自動生效,造成困惑或誤判模型是否已連結。
- **建議**:要嘛真的實作「帶 characterId 回跳並自動寫入 linkedModelId」,要嘛修正文案為「訓練完成後請回到
  角色卡手動選擇模型連結」。

### M3. 唯一「可被使用者實際觸發」的分鏡生成器(`seedSkeleton`)完全不吃腳本內容
- **檔案:行號**:`SeedStoryboardForm`(`:6725-6884`)是「storyboards」分頁裡真正會被使用者點擊、
  reachable 的分鏡骨架產生表單,其 `onSeed` 呼叫參數(`:6866-6876`)只有
  `worldId, totalDurationSec, sceneCount, aspectRatio, fps, autoSave, name`,對照
  `server/routers/worldStoryboard.ts:230-241` 的 `seedSkeleton` 輸入 schema,**完全沒有**
  `scriptId` 或任何腳本內容欄位——`seedStoryboardSkeleton()` 只讀 `framework`(世界觀角色/場景/風格/
  音樂等),不讀腳本。反觀 `ScriptEditorTab`(`:6505-6510`,獨立元件,腳本內容超出本檔範圍)所寫的劇本
  內容,在這條真正可用的路徑上完全沒有被引用。
- **影響**:北極星「腳本→分鏡」這一段橋接,在唯一「人類可實際點擊使用」的分鏡產生流程裡是斷開的;
  唯一形式上支援 `scriptId` 的路徑是 H1 提到的 `generateStoryboard`(agent-only、且不做 AI、
  `scenesJson` 恆空),等於腳本內容目前無論走哪條路都不會真正影響產生出的分鏡場景內容。
- **建議**:讓 `seedSkeleton`(或其呼叫的 `seedStoryboardSkeleton`)接受可選的腳本 ID/內容,並在
  `SeedStoryboardForm` 加入腳本選擇欄位,或至少把腳本摘要塞進 name/prompt seed。

### M4. Agent action schema 正式支援的 `"internal_model"` 執行模式,全專案唯一出現處是直接拒絕它
- **檔案:行號**:`shared/agent-actions.ts:218`、`224`(`mode: "dry_run" | "internal_model" | "page_agent"`)
  正式把 `internal_model` 列為三種合法模式之一。但全 repo 搜尋 `internal_model`,**唯一**命中的執行邏輯在
  `client/src/pages/AnimationStudio.tsx:5645-5647`:
  ```
  if (action.mode === "internal_model") {
    return { ok: false, reason: "內建模型批次執行尚未啟用,請先使用 dry-run 或代理 workflow" };
  }
  ```
  沒有任何其他檔案(包含 `DirectorAI.tsx`)對這個 mode 做出真正的處理。
- **影響**:型別系統/schema 對外承諾三種模式,實際上只有 2/3 有作用,`internal_model` 是死分支——
  雖然它有做出明確拒絕(不是靜默失敗),但仍屬於「schema 與實作不一致」的契約落差,對任何依賴型別
  簽章去串接的呼叫端(含未來的自動化工作流)是陷阱。
- **建議**:短期內把型別上的 `"internal_model"` 標成 `@deprecated`/未實作,或補齊實作;避免文件/型別
  宣稱可用而實際上永遠 reject。

---

## 低嚴重度 / 附加觀察(非本次主打,但已驗證屬實)

- **`GenerateMusicButton` 死 import**:`:95` 匯入但整份檔案再無使用(`GenerateImageButton`
  `:495,:4063`、`GenerateVoiceButton` `:1088` 皆有用到)。對照 `MusicThemeCard`(`:2839-2932`),
  音樂主題卡只有「試聽 URL」文字輸入(`:2926-2931`),沒有 AI 快速生成入口,與角色/場景卡的
  Image/Voice 快速生成不對等。
- **重新命名圖示語意錯置**:分鏡卡片的「重新命名」按鈕使用 `Wand2`(魔杖/AI 意象)圖示
  (`:6573`),但動作只是純文字重新命名,無 AI 成分,容易誤導使用者以為會觸發某種智慧命名。
- **沉浸模式狀態不持久**:`immersiveMode`(`:5354`)是純 `useState`,無 localStorage/URL 持久化;
  由於 `/animation` 與 `/animation/:id` 是不同 Route(見 C1 已驗證排除段落),兩者間切換會整個
  remount、把沉浸模式重置回 false,使用者每次點進分鏡細節都要重新切換。
- **巨型單檔 + 無效 ESLint 的維護性問題(cluster: other)**:本檔 6946 行內共塞了 1 個頁面
  + 16 個獨立子元件(`ExpressionEditor`、`OutfitEditor`、`ThreeViewEditor`、`CharacterAnimationCard`、
  `TrainCharacterLoraSection`、`StyleProfileCard`、`MusicThemeCard`、`StoryboardTimelinePreview`、
  `WorldBasicsEditor`、`ProductionManifestEditor`、`SceneCard`、`ImportExportButtons`、
  `ResearchDatabaseEditor`、`SoundLibraryEditor`、`SeedStoryboardForm`、`PipelinePlanView`),
  行號從 188 到 6946。搭配 `eslint.config.js`(全檔,stub parser + `rules: {}`)完全不做規則檢查,
  是 C1 這種硬 crash 級 bug 能夠存在而未被攔下的根本原因之一。建議至少把上述子元件拆到
  `client/src/components/animation/` 下個別檔案,並修好 lint 設定。

---

## 已驗證排除的疑慮(negative results)

- 本頁使用到的所有 tRPC 端點在伺服器端**皆存在**且輸入/輸出形狀吻合,非「呼叫不存在的後端」:
  - `worldbuilding.{list,get,create,update,delete,linkableModels,linkableVoices,exportFull,importFull,
    checkConsistency,saveComposition,getCompositionSuggestions}`
    (`server/routers/worldbuilding.ts:93-`,分別對應 `:95,101,112,155,212,227,245,560,579,688,753,796`)。
  - `worldStoryboard.{list,listByWorld,get,create,update,delete,seedSkeleton,validate,planPipeline,
    updateJob,updateSessionStatus,summarizeForPrompt,createFromSegments,queueForVideo,exportShotList}`
    (`server/routers/worldStoryboard.ts:124-`)。
  - `worldbuildingGeneration.{generateCharacter,generateScene,generateStoryboard}`
    (`server/services/worldbuildingGeneration.ts:340-459`,並在 `server/routers.ts:375` 掛載到
    `appRouter`)。
- `handleExportShotList`(`:5701-5715`)讀取的 `result.data.{body,mimeType}` 與
  `worldStoryboard.exportShotList`(`server/routers/worldStoryboard.ts:620-637`)實際回傳欄位一致,
  CSV/JSON 兩種格式皆有處理。
- `worldbuilding.update` 的 `patch`(`server/routers/worldbuilding.ts:155-209`)逐欄位比對,
  `handlePatchWorld` 送出的 16 個欄位(`:5471-5488`)全部都有對應的伺服器端寫入分支,無欄位被靜默丟棄。
- 進度/準備度/行動計畫的 shared 輔助函式簽章吻合、無 import 對不上的情況:
  `calculateWorldbuildingProgress`(`shared/worldbuilding-progress.ts:533`)、
  `getWorldbuildingActionPlan`(`shared/worldbuilding-actions.ts:27`)、
  `calculateWorldbuildingReadiness`(`shared/worldbuilding-readiness.ts:21`)、
  `buildAgentWorkflowFromGenerationTasks`(`shared/worldbuilding-agent-workflow.ts:13`)。
- 本檔案本身**未發現**用客戶端布林值/旗標充當安全邊界的 `client-security` 類問題(例如角色/方案判斷寫在
  前端),推測敏感操作皆走 `protectedProcedure`/`brainProcedure` 的伺服器端驗證,但完整權限模型
  **未在本檔驗證**(需查 `server/_core/trpc.ts`、`rbac.ts`)。
- `/animation` 與 `/animation/:storyboardId` 為兩個獨立 `<Route>`(`client/src/App.tsx:270-275`),
  彼此切換時因 `RouteTransition`(`client/src/components/RouteTransition.tsx:16`,`key={location}`)
  的關係會整個 remount,C1 的 hook 順序問題**不會**在這個轉場上發生(只會發生在同一次掛載內的
  loading→loaded 或 worlds 0→1 轉場)。

---

## 附錄:發現彙總表

| # | 嚴重度 | Cluster | 一句話 |
|---|---|---|---|
| C1 | critical | northstar-flow | 條件式 hook 呼叫,首次載入/建立第一個世界必定觸發 React crash |
| C2 | critical | dead-ui | 製作包預覽/視覺靈感庫/一致性檢查三元件已完工但整頁從未渲染 |
| H1 | high | contract-mismatch | `generateStoryboard` 承諾 AI 生成時間軸,實際只建空殼,伺服器註解自證 |
| H2 | high | dead-ui | AI 生成角色/場景只有 page-agent 能觸發,UI 上無按鈕 |
| H3 | high | northstar-flow | 編排動畫管線後無執行入口/無前往導演 AI 的 CTA |
| M1 | medium | uiux-defect | debounce 存檔無 flush,快速切換世界會靜默丟失編輯 |
| M2 | medium | contract-mismatch | LoRA 訓練「自動連結角色」承諾與實作(純手動)不符 |
| M3 | medium | northstar-flow | 唯一可用的分鏡生成器不吃腳本內容,腳本→分鏡橋接斷開 |
| M4 | medium | contract-mismatch | `internal_model` 模式型別存在但全專案只有拒絕邏輯 |

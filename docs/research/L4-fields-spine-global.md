# L4 — 欄位/元件地毯掃描：跨 shell 脊椎頁 + 全域元件 + Home（wave L，最後一塊）

> 產生日期：2026-07-03 ｜ commit：`4d137bdb907d67e6708ca360a66e89de0a6f2c2e`
> 定位：地毯掃描 wave L（最後一塊）。前情：01-features §4/§6（脊椎頁/全域系統功能盤點,不重列）、G1（VideoCockpit 座艙已細盤,本文不重複）、H2（ImageStudio/VideoStudio 欄位範本）。
> 標記約定同 H2：`⚰` 死欄位、`👻` 隱藏能力（後端有/前端無）、`≠` 預設值前後端不一致、`(共)` 共用欄位。
> 方法：逐檔 Grep `useState`/`trpc.`/`z.object` 定位 state 與 zod schema，對照前後端欄位；受篇幅限制，只逐行細讀關鍵表單區塊,其餘用結構化抽樣。

---

## 1. AssetsLibrary（/assets）

### 1.1 元件清單
UploadDialog（手動上傳）｜頂部 my/team Tabs｜assets/personal_db 大分頁｜搜尋 Input｜類型篩選 Select｜來源篩選（常用 6 按鈕 + 更多來源 Select 收合）｜排序 Select｜資產卡（展開/共享切換/刪除 AlertDialog）｜PageAgent 註冊（setTab/setParam/search/openDialog/reset 五動作）。

### 1.2 欄位表

| 欄位/控制項 | 型別 | 前端 state | 預設 | 範圍/選項 | tRPC | 資料表欄位 | 備註 |
|---|---|---|---|---|---|---|---|
| 上傳檔案 | 檔案選擇（拖框點擊） | `selectedFile` | null | 任意檔案 | 先 `uploadFileToS3` 取得 url/fileKey，再 `assets.upload` | digital_asset_library.fileUrl/fileKey | 無檔案大小/類型前端校驗（由 S3 端決定） |
| 資產標題 | Input | `title` | 檔名去副檔名 | max 255（後端） | title | .title | 選檔自動帶檔名 |
| 資產類型 | Select×6 | `assetType` | 依 MIME 自動偵測，預設 "image" | image/video/audio/voice/script/zip_bundle | assetType | .assetType | — |
| 描述 | — | — | — | zod max 500 optional | description | .description | 👻 UploadDialog 無此欄位 UI，全站唯一入口無法補描述 |
| 縮圖 URL | — | — | — | zod optional | thumbnailUrl | .thumbnailUrl | 👻 無 UI，只有生成管線自動寫入,手動上傳恆為 null |
| 搜尋 | Input | `search` | "" | 比對 title/description/promptUsed | myAssets.search/teamAssets.search | — | client 二次 filter 再疊一層（belt-and-suspenders） |
| 類型篩選 | Select | `typeFilter` | "all" | 7 選項（含 all） | assetType | — | 前後端列舉一致 |
| 來源篩選 | 按鈕×6 + Select 收合 | `sourceFilter` | "all" | all/creative/director/image/video/pro/background/webhook/suno/replicate/unknown（11） | sourceStudio | .sourceStudio | 前後端列舉逐字一致 |
| 排序 | Select | `sortKey` | "newest" | newest/oldest/by_source/by_type | 純前端 client-side sort | — | 不送後端 |
| my/team 分頁 | Tabs | `tab` | "my" | my/team | assets.myAssets / assets.teamAssets | — | URL 同步 `?tab=` |
| 檢視模式 | — | `viewMode` | "cards" | — | — | — | URL 同步 `?view=` |
| ?section= 五分支（prompts/collection/vault/tasks/drive） | — | `getInitialSection()` | 恆 "assets" | — | — | — | ⚰ 已知死碼（01-features:248 已載,本次核實同狀態未變） |

### 1.3 小結
上傳/篩選/排序主線完整；唯一缺口是 `assets.upload` 的 `description`/`thumbnailUrl` 兩個 zod 欄位在手動上傳 Dialog 完全無 UI——使用者上傳素材後只能靠事後 `assets.update`（同樣只給 title/description，UI 有 description 編輯欄？需查 AssetsLibrary 展開卡；未見獨立「編輯資產」表單，`update` 的 description 欄同樣可能是 👻）。

---

## 2. ModelsPage（/models,LoRA 中心）+ LoraTrainer（4 步精靈）

`/models` 分兩個「頁面分頁」：`pageTab="trainer"`（預設,唯一有可見 Tab 按鈕，lazy 渲染 `<LoraTrainer embedded />`）與 `pageTab="forge"`（**UI 上沒有任何切換按鈕**——唯一切換入口是 PageAgent capability `setTab id="forge"`，即光球可把使用者導去這個隱藏分頁）。

### 2.1 LoraTrainer 四步精靈欄位（`step: dataset → captioning → hyperparams → training`）

| 欄位/控制項 | 型別 | 前端 state | 預設 | 範圍/選項 | tRPC 參數 | 資料表 | 備註 |
|---|---|---|---|---|---|---|---|
| 訓練類別卡（10 種） | 卡片選擇 | `selectedTrainingType` | "image_subject" | image_subject/portrait_lora/style_lora/scene_lora/video_lora/voice_clone/concept_lora/product_lora/fashion_lora/pose_lora（`TRAINING_CATEGORIES`,shared/types.ts:391） | `modelType`（送出時 `as` 斷言成 6 種) | fine_tuned_models.modelType | **⚰ 型別斷言假安全**：後端 `models.create` zod `modelType` enum 只收 6 種（缺 concept_lora/product_lora/fashion_lora/pose_lora）；選這 4 類走完全部 4 步、通過前端 `canProceed()` 校驗後，`createMutation.mutate` 送出即被 zod 拒絕（400），使用者卡在「開始訓練」按鈕失敗——4/10 訓練類別是死路 |
| 模型名稱 * | Input | `modelName` | "" | 必填（前端擋） | name | .name | zod min1 max100 |
| 描述 | Textarea | `description` | "" | — | description | .description | zod max500 |
| 資料集圖片 | 多檔上傳+角度標籤 | `datasetImages` | [] | 依類別 min/max（3–50） | datasetImages[] | configJson.datasetImages | 角度 front/side/back/expression/other |
| 資料集影片 | 多檔上傳 | `datasetVideos` | [] | video_lora/pose_lora 類接受，max 20（後端） | datasetVideos[] | configJson.datasetVideos | — |
| AI 自動補角度強度 | Slider | `autofillStrength` | 0.45 | UI 0.2–0.8 | `models.autofillAngles{strength}` | — | 獨立 mutation，非 create 的一部分 |
| 觸發詞 | Input | `triggerWord` | "" | zod max50 | triggerWord | configJson.triggerWord | captioning 步驟必填（`canProceed` 擋） |
| 訓練引擎 | 唯讀衍生（非使用者可選） | `trainingEngine` | image_subject→replicate,其餘→fal | replicate/fal | trainingEngine | .trainingEngine | 依類別鎖死,無切換 UI |
| 訓練輪數 Epochs（replicate） | Slider | `epochs` | 20 | **UI 5–50** ｜ zod 5–100 | epochs | configJson.epochs | UI 較窄,非 bug,只是收窄一半可用範圍（👻） |
| 批次大小 Batch Size（replicate） | Slider | `batchSize` | 4 | **UI 1–16** ｜ **zod 1–8** | batchSize | configJson.batchSize | **⚰ 範圍矛盾**：UI 允許拖到 9–16,送出必 400（zod max 8） |
| 訓練步數 Steps（fal） | Slider | `trainingSteps` | 1000 | UI 200–3000 ｜ zod 100–5000 | steps | configJson.steps | UI 較窄,無 bug |
| 學習率 Learning Rate | Slider（×10000 換算） | `learningRate` | 0.0001 | **UI 0.0001–0.001**（slider 1–10 步1）｜ zod 0.00001–0.01 | learningRate | configJson.learningRate | 👻 zod 允許範圍比 UI 寬 10 倍,使用者拿不到更保守/更激進的極端值 |
| 主體類型（consent 分流） | native `<select>` | `subjectType` | "synthetic" | synthetic/self/real_person/copyrighted | subjectType | model_training_consents 關聯判定 | 後端依此 + modelType==="portrait_lora" 判斷是否要求同意書 |
| 引用同意書（多選） | Checkbox 列表 | `selectedConsentIds` | [] | `modelConsents.list` 中 `isActive` 者 | consentIds[] | model_training_consents.id | 需真人/版權素材時前端擋（`toast.error`）,後端二次校驗（存在/屬本人/未撤回未過期/portrait_lora 需 portrait 類型同意書） |
| 新增同意書 | Dialog | `consentDialogOpen` | false | — | `ConsentFormDialog`（未逐行,信任既有審查） | — | — |
| 撤回同意書 | AlertDialog | `pendingRevokeId` | null | — | `modelConsents.revoke` | — | — |

**訓練 job 狀態輪詢**：`generate.jobStatus{jobId}` 每輪詢一次；完成/失敗態有明確 CTA（訓練新模型/查看紀錄/重新開始）。

### 2.2 ⚠ 重大發現：ModelsPage 隱藏「forge」分頁繞過同意書閘門

`ModelsPage.tsx` 內仍保留一份**獨立、更早期**的訓練精靈實作（同檔 728 行 `createMutation.mutate`），與 §2.1 的 LoraTrainer 精靈**功能不對等**：

| 面向 | LoraTrainer（`pageTab="trainer"`,預設可見） | ModelsPage 內建 forge（`pageTab="forge"`） |
|---|---|---|
| UI 切換入口 | 頁面唯一分頁鈕 | **無**（0 個按鈕；`grep "forge"` 只在 PageAgent action id 出現） |
| 訓練類別選擇 | 10 種卡片 | 無選擇器（隱含 modelType 全靠後端 default = image_subject） |
| `subjectType`/`consentIds` | 有（見上表） | **完全沒有**（`grep consentsQuery/ConsentFormDialog/同意書` 於 ModelsPage.tsx 皆 0 命中） |
| `trainingEngine` | 依類別鎖定並送出 | **不送**（後端 default "replicate"） |
| `createMutation.mutate` 送出欄位 | name/triggerWord/description/modelType/trainingEngine/epochs/learningRate/batchSize/steps/isStyle/datasetImages/datasetVideos/subjectType/consentIds（13 欄） | 只有 name/triggerWord/description/epochs/learningRate/batchSize/datasetImages（7 欄） |
| batchSize 滑桿範圍 | 1–16（同上表 bug） | 同一顆滑桿程式碼複製,同 max=16 vs zod max 8 bug |

**風險**：由於 `subjectType` 未送 → 後端 zod default `"synthetic"` → `requiresConsent` 判定為 false（除非 `modelType==="portrait_lora"`,而 forge 分頁也不送 modelType）→ **後端同意書閘門對這條路徑形同虛設**。這條路徑目前只能透過光球 PageAgent 動作 `{action:"setTab", tabId:"forge"}` 到達（AgentCapability 選項確有列出 `{ id: "forge", label: "角色鍛造所" }`,見 ModelsPage.tsx:784）,不是一般使用者點擊可達，但只要光球執行該動作即可讓使用者用真人照片訓練模型而完全不需簽署數位肖像權同意書——這是一條**後端信任前端自報 subjectType**、且「唯一有 consent UI 的入口可被繞過」的合規缺口，建議後端改成不論前端是否宣稱 synthetic，只要偵測到影像疑似人臉都要求同意書，或直接砍掉 forge 分頁死碼。

---

## 3. SharedSpace（/shared）

搜尋 Input（`searchQuery`）｜Tab（`activeTab`："assets"/其餘）｜資產類型篩選（`assetTypeFilter`）｜my/team 四支唯讀 query（`assets.teamAssets`/`models.teamModels`/`assets.myAssets`/`models.myModels`）｜「直送工作室」動作：sessionStorage payload + `routeForModality` 導頁,並呼叫 `agentModelPicks.recordPick` 記錄偏好。無獨立表單 Dialog，控制項均為篩選類,全部前後端一致，未見死欄位。

---

## 4. NotesPage（/notes）+ CalendarPage（行事曆分頁）

`notes.create`/`notes.update` 的完整 zod 欄位：`title / content / scriptJson / noteType / status / scheduledDate / endDate / reminderMinutes / location{name,address,lat,lng} / meetingUrl / tags[]`（server/routers/notes.ts:204-241）。全站有 **3 個獨立實作**的「新增筆記」快速表單，欄位覆蓋率不一：

| 建立入口 | 欄位 | 缺少（👻） |
|---|---|---|
| NotesPage.tsx 主 Dialog（`showCreate`） | title / type(note\|script\|calendar_event 按鈕) / content / tags（逗號分隔 Input） | scheduledDate / endDate / reminderMinutes / location / meetingUrl——**即使選了「行事曆事件」類型,此 Dialog 仍不出現任何日期欄位**，事件會建立成 `scheduledDate=null` |
| CalendarPage.tsx `QuickScheduleForm`（點日曆格子建立） | title / content / allDay / 開始時間 timeStr / 時長 durationMinutes（Select 30m–整天7選）/ 提醒 reminderMinutes（Select）/ 地點 location（LocationPicker）/「同時加入 Google 日曆」`addToGoogle` checkbox | **meetingUrl（全站唯一 zod 有的欄位,無任何 UI 入口）** |
| ProjectNotesDrawer.tsx（光球快速釘選） | title / content（自動組裝 prompt/seed/mode/resultUrl）/ tags（逗號 chip） | noteType（恆預設 note,無 calendar_event 選項）/ scheduledDate 等全部日曆欄位 |
| OrbUnifiedAssistant.tsx 內建 Notes tab（§9.3） | title / content / tags / type(note\|script\|calendar_event) | 同 NotesPage 主 Dialog——**同一套缺口被複製第 4 次** |

**`meetingUrl`** 是唯一一個全站零 UI 入口的 zod 欄位（4 個建立表單都不送）——線上會議連結欄位形同虛設,只能靠未來 API/腳本直接寫入。

`addToGoogle` 不是資料庫欄位，是純前端動作：成功後呼叫 `openGoogleCalendar(...)` 開新分頁,不送後端、不落庫。

| 行事曆控制項 | 型別 | state | 預設 | 備註 |
|---|---|---|---|---|
| 月曆切換 | `month` state + 上下月按鈕 | `month` | 今天所在月 | 純前端 |
| 拖曳排程 | dragOverDate | `dragOverDate` | null | 拖筆記卡到日期格 → `notes.update{scheduledDate}` |
| ICS 訂閱（webcal://） | 連結按鈕 | `webcalUrl`（由 https URL 字串替換 scheme） | — | feed token 可輪替（icsExport service,未逐行；01-features 已載為完整功能） |
| 篩選/檢視 | `selectedDate`/`armedNoteId`/`pendingDeleteId` | — | — | 標準互動 state,無持久化落差 |

---

## 5. CreativeProjectPage（/creative-projects）+ ProjectsListPage/ProjectDetailPage（/projects）

`CreateProjectDialog`：title（必填,max255）/ description（可選,max10000）/ status（Select,`STATUS_OPTIONS`）/ worldFrameworkId（Select,含「未綁定」）/ worldStoryboardId（Select,含「未綁定」）——五欄全部送 `creativeProject.create`，未見死欄位。`BindProjectDialog` 同款（world/storyboard 二選）。

ProjectsListPage/ProjectDetailPage（`video_projects`/`ProjectsContext` SSOT 側）：**純唯讀展示 + 動作按鈕**，无表单栏位——卡片顯示 title/type/status/progress/currentStep/nextAction/updatedAt,操作僅「繼續創作」（導頁）與「複製專案」（`creativeProject.duplicate`）。ProjectDetailPage 的「下一步建議」按鈕依 binding 狀態算出導頁目標（AIDV-961 補的死路修復，見檔頭註解）,無新增欄位。與 §2 對照：/projects 與 /creative-projects 是同資料兩視角並存（01-features 已載,本次核實一致）。

---

## 6. AgentChat（/agent）

### 6.1 輸入區/附件
`useOrbAttachments` hook（AgentChat/ProactiveOrbWidget/OrbGuidePanel 三處共用）：

| 欄位/控制項 | 型別 | state | 範圍 | 備註 |
|---|---|---|---|---|
| 附件挑選 | 隱藏 `<input type=file>` + `pickAttachment()` | `attachments: ChatAttachment[]` | 圖片/影片/音訊/PDF/文字（`resolveOrbAttachmentKind`） | **無檔案大小限制檢查**（對照 ImageStudio RefImageInput ≤16MB、VideoStudio MediaInput ≤50MB 皆有前端擋——附件上傳唯獨沒有,直接丟給 S3） |
| 文字類附件（txt/md/docx） | 自動擷取文字 | `extractedText` | — | 擷取失敗 toast 錯誤但仍上傳檔案（保留下載連結） |
| 移除附件 | × 鈕 | `removeAttachment(id)` | — | — |
| 清空附件 | 送出後自動 | `clearAttachments()` | — | — |

### 6.2 Slash Command
`shared/slash-commands.ts`：18 個具名指令（mode/help/session/action/memory/navigation 六組）+ `SPIRIT_COMMANDS`（25 精靈,映射成 slash）。`useSlashCommandMenu` 提供 ↑↓/Tab 補全/Enter 套用/Esc 關閉（保留輸入）；`runSlashCommand` 依 `action.kind` 分派（send-with-mode/send-as-spirit/navigate/orb-phrase/client-action/info + clear-history/new-conversation/show-memory/export-pdf/share-workflow/open-palette/open-settings/open-codex 等）。指令本身**無專屬後端**——全部翻譯成既有 `sendMessage`/`navigate`/現有 tRPC procedure（與 01-features §6 結論一致，本次核實指令總數與分類）。

### 6.3 確認卡（送出走確認閘）
三張卡並存：`ClarificationPromptCard`（追問澄清,支援單答/多答）｜`NavigationConfirmationCard`（跳頁批准/拒絕）｜`WorkflowConfirmationCard`（多步驟計畫開始/修改/取消）。三者互斥渲染（`pendingClarification`/`pendingNavigation`/`pendingWorkflow` 各自判斷），符合「submit 走確認閘」的敘事。

---

## 7. FocusFlowPage（/focus-flow）番茄鐘設定

`FocusFlowContext` 集中管理，設定與計時器狀態**持久化程度不同**（對 01-features「三頁皆…重整即失」的一處修正）：

| 設定 | state | 預設 | 持久化 | 備註 |
|---|---|---|---|---|
| 番茄鐘工作時長 | `pomodoroWorkMin`（`prefs.pomodoroWorkMin`） | 25 | **localStorage（`PREFS_KEY`），重整不丟** | `setPomodoroWorkMin` 僅在未運行時可改 |
| 番茄鐘休息時長 | `pomodoroBreakMin` | 5 | 同上,localStorage | — |
| 療癒模式時長 | `healingMin` | 5 | 同上,localStorage | — |
| 番茄鐘進行中狀態 | `pomodoroPhase`/`pomodoroRemaining`/`pomodoroRunning`/`pomodoroRounds` | work/未跑 | **無持久化**,`useState` 純記憶體 | ⚰ 重整即失（此部分符合 01-features 描述） |
| 呼吸模式進行中狀態 | `healingRemaining`/`healingRunning`/`breathPhaseIdx`/`breathLabel` | — | 無持久化 | 同上 |
| 想法便利貼 | `thoughts: ThoughtEntry[]` | [] | **localStorage（`focus-flow-thoughts`），每次變更即寫入,重整不丟** | ⚠ 與 01-features「想法(重整即失)」的描述不符——實測程式碼有 `useEffect` 持久化,建議更正該條結論 |

FocusFlowMini（浮動光球內嵌版）直接複用同一 Context,無獨立設定副本。

---

## 8. UnorganizedArea（/unorganized）、ProcessViewerPage（/process）

**UnorganizedArea**：純導航頁,無表單欄位。依 `appRegistry` 分組列出未在主選單顯示的頁面,按鈕即 `navigate(page.path)`；`HIDDEN_FROM_UNORGANIZED` 明確排除 unorganized/home/project-detail 三個 id。

**ProcessViewerPage**：讀 `?spec=<base64url>` 解析流程規格渲染步驟清單,`completed: Set<number>` 純前端勾選狀態,無後端呼叫,無表單。

兩頁皆確認「純前端零後端」定位成立,無新增死欄位/隱藏能力可報。

---

## 9. Home（/,首頁）

### 9.1 `HOME_FEATURE_FLAGS` 休眠旗標區塊（Home.tsx:99-129）

13 個布林旗標中僅 1 個為 true（外加頁尾額外一個 `SHOW_BOTTOM_CTA` 常數,共 14 個開關,13 個 OFF）：

| 旗標 | 值 | 對應區塊 | 備註 |
|---|---|---|---|
| `showLegacyTopNav` | false | 頂部場景切換/聲音/開始創作 nav | Dock 已涵蓋,故關閉 |
| `showSceneBadge` | false | 「夜深了…」情境問候徽章 | 視覺裝飾保留 |
| `showOarsGreeting` | false | OARS 多段 hero 文案 | 已被「今天想創作什麼？」取代 |
| `showHeroCtaButtons` | **true**（唯一 ON） | Hero 下方單一 CTA「進入創作作業系統」 | Phase 2c 首頁瘦身後的唯一入口 |
| `showScrollIndicator` | false | 「向下探索」滑鼠 icon | — |
| `enableHeroScrollAnimations` | false | heroY/heroOrbScale/heroOrbDrift 視差 | 對應 `useTransform` 全部停用,程式碼保留 |
| `showOrbCreationStage` | false | 互動式創作劇場（佔滿版高） | — |
| `showIntentWhisper` | false | 意圖推論低語卡 | 「資訊量太密」而隱藏 |
| `showIntentOnboarding` | false | I-9 意圖個人化引導卡（AIDV-87） | 預設 OFF=零行為改變 |
| `showIntelBento` | false | IntelBentoGrid 情報站 | — |
| `showShowcaseMasonry` | false | 精選作品瀑布流 | — |
| `showVisualSoulInvitation` | false | 光球行動+邀約區塊 | — |
| `showLegacyFooter` | false | Footer 區塊 | Dock 已涵蓋品牌資訊 |
| `SHOW_BOTTOM_CTA`（獨立常數,非物件內） | false | 頁尾第二顆 CTA 區塊 | 與 hero CTA 重複而關閉 |

**結論**：Home.tsx 近 1928 行中，真正渲染給使用者的只有「情境自適應樣式（SCENE_STYLES 四情境）+ Hero 區 + 單一 CTA + 狀態群集」；其餘約 10 個曾經的行銷向 section（動畫劇場/情報站/瀑布流/邀約卡/舊 nav/舊 footer）程式碼與 import 完整保留但被旗標整批關閉,對應 01-features 提到的「800 行旗標休眠碼」現況——本次逐一核實旗標值與其控制區塊的對應關係,13 個關閉、1 個開啟,並非全部關閉（`showHeroCtaButtons` 是首頁唯一存活的旗標分支）。

---

## 10. 全域元件/抽屜/Dialog

### 10.1 CommandPalette（⌘K/Ctrl-K）
`CommandInput` 純搜尋框,列出 `getSidebarGroups`/`getAllPages`（頁面跳轉）+ `SLASH_COMMANDS`（同 §6.2）+ 一個 `orbProxy.clearAllPreferenceMemory` mutation（清除記憶按鈕）。無表單欄位,純導航/指令觸發器。

### 10.2 SiteOnboardingOverlay + SiteOnboardingContext
新手導覽疊層,無表單；狀態機純 `localStorage`（`hasSeenTour`/各頁 `TOUR_DEFINITIONS[pageId].storageKey`），Skip/Next/Start 皆本地寫 key,無後端。

### 10.3 ProjectNotesDrawer（光球快速釘選）
見 §4 表格（第 3 行）——title/content/tags 三欄,noteType 恆 "note"。

### 10.4 AssetsQuickDrawer
`search` Input + `typeFilter` Select + `assets.myAssets` 唯讀 query,無新增/編輯表單,純瀏覽挑選（供光球/其他流程插入資產參照用）。

### 10.5 BackgroundTasksDrawer
純展示元件（0 個 `useState`/`trpc.` 直接呼叫,完全消費 `BackgroundTasksContext`）：任務清單 + 退款狀態徽章（`RefundStatusBadge`）+ 重試/查看連結按鈕。無表單欄位。對照 01-features「BackgroundTasksDrawer 元件孤兒」——本次確認元件本身無 mount 入口問題,只是純展示,Context 邏輯完整運作於別處消費。

### 10.6 光球面板群

**OrbGuidePanel**（引導式問答精靈→生成，4883 行）：
- `panelMode` 宣告為 `const [panelMode] = useState<"guide"|"chat"|"unified">("unified")`——**沒有解構 setter**，值恆為 `"unified"`。程式碼中仍有 `panelMode === "guide"`（例如重置鈕條件,:3943）與其他分支判斷式，這些條件**恆為 false，是無法觸發的死碼分支**（⚰,非顯示層小事——意味著「guide 模式專屬 UI」如重置鈕已被永久隱藏,且未來若忘記這個限制去改別處邏輯容易誤判）。
- 主要輸入面：意圖選擇卡（image/video/music/voice/script/lora/explore 七選一）→ 問答（`currentQuestion.options` 動態,支援「直接帶你走」skip）→ 確認態,無獨立表單欄位表（走 stock options,非自由輸入）。

**ProactiveOrbWidget**（全域浮動光球,4160 行）：`panelView`（main/chat/inspiration/focus-flow/capabilities 五態切換,純前端 UI 狀態）；`position`（拖曳定位,localStorage `loadPosition()` 持久化）；聊天輸入複用 `useOrbAttachments`（同 §6.1,同樣無檔案大小擋）；`focus-flow` 分頁直接嵌入 `<FocusFlowMini />`,與 §7 同一份 Context,無獨立設定副本。

**OrbUnifiedAssistant**（統一助手面板,2448 行,含多個子 Tab）：
- PromptWorkbench 風格子元件：`scope`(mine/reference)/`search`/`category`(Select)/`favoritesOnly`(Switch)——promptLibrary 篩選,完整。
- 新增/編輯提示詞 Dialog：`title`/`content`/`category`/`isPublic`(Switch)——四欄,對應 `promptLibrary.create`/`update`,無死欄位。
- Credits 分頁 `EstimateView`：`selectedModelId`(Select,來自 pricingCatalog)/`durationSec`/`charCount`/`imageCount`（依模型 unit 動態顯示其中之一）→ `accountant.estimate` 唯讀試算,含「套用到當前頁」動作（`pageAgent.dispatch setModel`）。
- Credits 分頁 `CompareView`：`category`(Select)/`durationSec`/`charCount`/`imageCount` → `accountant.compare`,同類模型比價,唯讀。
- **Notes 分頁**：又一份 title/content/tags/noteType 建立表單（見 §4 表格第 4 行）——**同一個「行事曆事件缺日期欄位」缺口在此第 4 度重現**。

### 10.7 AvatarStudio
三分頁：**preset**（預設頭像選單,點選即 `auth.updateAvatar{avatarUrl:"preset:id"}`）／**upload**（本地壓縮成 dataURL,**限制 ≤60KB，直接存 base64 字串於 `avatarUrl` 欄位,不走 S3**——與全站其餘上傳流程 S3+URL 模式不同的獨立小路徑）／**ai**（`prompt` Textarea,固定 `aspect_ratio:"1:1"`、`num_images:1`,直接呼叫 `imageStudio.nanoBanana2` 產生預覽再套用)。

⚠ AI 頭像生成直接呼叫 ImageStudio 的原始生成 mutation（非 estimateCost→submitStudioJob 的成本閘門管線），且畫面上**沒有任何成本提示/扣點 UI**（對照全站「先估成本→先扣後生成」的一致敘事,見 G1 §3.1-3）——是否實際扣點需查 `generationProcedure` 中介層與帳務服務,本次未能確認扣點時點,列為待查缺口而非結論。

### 10.8 各確認 Dialog（AlertDialog 通用模式抽樣）
刪除資產（AssetsLibrary）/刪除模型（ModelsPage,`pendingDeleteModelId`）/刪除筆記（NotesPage/CalendarPage）/刪除創作專案（CreativeProjectPage）皆為標準二鍵 AlertDialog（取消/確認,確認鍵呼叫對應 `*.delete` mutation 後 toast + refetch/invalidate），未見獨立表單欄位或死控制項。

---

## 11. 跨頁彙總：本次新增死欄位/隱藏能力/假控制項清單

**⚰ 死欄位/假安全**
1. LoRA 訓練精靈：`selectedTrainingType` 10 選項中 4 個（concept_lora/product_lora/fashion_lora/pose_lora）在 `models.create` zod `modelType` enum 中不存在,選了走完 4 步必 400（LoraTrainer.tsx:805-811 vs server/routers/models.ts:275-284）。
2. LoRA 訓練精靈 batchSize 滑桿 UI 允許 1–16，zod 只收 1–8（LoraTrainer.tsx:1893-1900,ModelsPage.tsx:1257 同款複製）。
3. ModelsPage 隱藏 `pageTab="forge"` 分頁：無 UI 入口（僅 PageAgent 可達）,且训练送出完全不含 `subjectType`/`consentIds`/`trainingEngine`/`modelType`——**繞過同意書閘門**（§2.2）。
4. OrbGuidePanel `panelMode` 無 setter,恆 "unified"，所有 `panelMode==="guide"` 分支為死碼。
5. AssetsLibrary `?section=` 五分支（既有已知死碼,本次核實現況未變）。

**👻 隱藏能力（後端有、前端無 UI）**
6. `assets.upload` 的 `description`/`thumbnailUrl`。
7. `notes.create`/`update` 的 `meetingUrl`——全站 4 個建立表單皆未提供,唯一 zod 欄位零 UI 入口。
8. NotesPage 主 Dialog + ProjectNotesDrawer + OrbUnifiedAssistant Notes 分頁三處「新增筆記」皆不提供 `scheduledDate/endDate/reminderMinutes/location`（僅 CalendarPage 的 QuickScheduleForm 有,但仍缺 meetingUrl）。
9. LoRA 學習率 zod 範圍（0.00001–0.01）比 UI 滑桿（0.0001–0.001）寬 10 倍。

**⚠ 待查（非結論，列給後續 wave）**
10. AvatarStudio AI 頭像生成直接呼叫 `imageStudio.nanoBanana2`,UI 無成本提示,實際是否扣點未確認。
11. AssetsQuickDrawer/BackgroundTasksDrawer 均為唯讀展示,未見表單缺口，但 BackgroundTasksDrawer 的「孤兒」狀態（01-features 既有結論）本次僅確認元件本身無新增問題,未重新驗證其 mount 樹位置。

---

## 12. 缺讀聲明

- ProStudio（/video/pro）、AnimationStudio、Playground、DirectorAI、LightOrbCreationStudio 等 video shell 子頁不在本卡範圍（01-features/G1/G2 已涵蓋）。
- OrbGuidePanel 的問答題庫內容（各 intent 對應的 `currentQuestion.options` 全量清單）未逐一列出,僅確認機制與死碼分支。
- OrbUnifiedAssistant 除 Notes/Credits/PromptWorkbench 三塊外,其餘 Tab（若有）未逐行讀。
- ConsentFormDialog 內部表單欄位未逐行读,信任其已通過既有審查（同意書簽署流程本身不在本卡範圍）。
- AvatarStudio 的生成扣點時點需查 `generationProcedure`/帳務中介層原始碼,本文未深入。
- 各 AlertDialog 只抽樣 4 個確認同款式,未逐頁列舉全站所有刪除確認框。

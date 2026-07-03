# Y3 — VideoStudio.tsx 影片座艙 + 場景切換前端深挖

- 產生日期:2026-07-03
- 依據 commit:812f6fdb(已核對:`git diff 812f6fdb HEAD --stat -- client/src/pages/VideoStudio.tsx client/src/components/SceneSwitcher.tsx client/src/components/VideoProjectCreateDialog.tsx` 為空,三檔在 812f6fdb 與稽核時 HEAD(47917e3a)間位元相同)
- 稽核檔案:client/src/pages/VideoStudio.tsx(5408 行)、client/src/components/SceneSwitcher.tsx(245 行)、client/src/components/VideoProjectCreateDialog.tsx(158 行)
- 交叉核對:server/routers/videoProject.ts、server/routers/videoStudio.ts、server/routers/worldStoryboard.ts、client/src/shells/video/VideoCockpit.tsx、client/src/spine/ProjectSpineProvider.tsx、client/src/pages/DirectorAI.tsx、client/src/pages/ImageStudio.tsx、client/src/pages/Home.tsx、client/src/components/AmbientEnvironment.tsx、client/src/App.tsx、client/src/shells/shellRouteTable.ts、client/src/components/VideoInputAssetsUploader.tsx
- 前置已讀既有研究(避免重工,獨立覆核而非照抄):G1-video-cockpit.md、M1-project-spine-assembly.md、N2-architecture-decisions.md、L1-fields-audio-studio.md、H2-fields-image-video.md、Y2-director-ai-frontend.md、X12-output-assets-deepdive.md、C-uiux.md、P1-uiux-solutions.md
- **開篇澄清(任務框架 vs 實況落差)**:任務假設「逐幕三軌在座艙」「SceneSwitcher 是場景切換元件」皆需先核實。實讀後確認:①`VideoStudio.tsx` 不是北極星座艙本體——它是掛在 `/video-studio`→(內部轉址)`/video/video` 的獨立單鏡頭 AI 生成工具(文生影/圖生影/影生影/畫質優化/進階控制五分頁),與座艙本體 `shells/video/VideoCockpit.tsx`(G1 已逐行覆蓋,不在本檔範圍)是同一 `video` shell 下的**平行子路由**,非同一元件;②`SceneSwitcher.tsx` 與影片「逐幕」完全無關,是 Home 首頁的**環境氛圍背景切換器**(夜空/晨光/咖啡廳/深海四種背景漸層),全站僅 `Home.tsx` 一處引用,和 VideoStudio.tsx 沒有任何 import/使用關係。以下發現依此澄清後的實況展開。

---

## 發現(按嚴重度排序)

### 【CRITICAL・northstar-flow】1. 「建立空白專案」單一動作同時:遺棄使用者正在看的專案、複製出第二個 creative_project、產生一個與兩者都無關聯的 video_project

**發現**:`VideoCockpit.tsx:96-172`(`VideoProjectCreateDialog` 的實際掛載處)在「空白專案」分支渲染時,`p = spine.project` 已經是**當前使用者已選定、正在畫面上顯示的專案**(:28,117,120——只是 shots/characters 皆空)。使用者按「建立空白專案」(:158-160)時:
1. `VideoProjectCreateDialog.tsx:76-85` 送出 `videoProject.create`,**完全不帶 `creativeProjectId`**(Props 介面 `{open, onClose, onCreated}` 本身就沒有此欄位可傳入,VideoProjectCreateDialog.tsx:49-53)。
2. `onCreated` 回呼(VideoCockpit.tsx:168-171)呼叫 `spine.createProject("未命名創作", "影片")`,**建立另一筆全新 `creative_projects`**(而非重用當前 `p.id`,也不是把 `p` 從「空白」補成「有內容」)。
3. `createProjectImpl`(`ProjectSpineProvider.tsx:457-464`)在建案成功後立刻 `setActiveProject(newId)`——**把當前作用中的專案從 `p` 切換成這個新建、標題寫死「未命名創作」的專案**。使用者原本在看的 `p`(即便已投入時間但仍是空的)就此從畫面上消失、不再是 active project。
4. 最終產出:①原 `p`(遺棄、非 active、可能永遠找不回);②新 `creative_projects` 列「未命名創作」(active,但與剛建的 video_project 無外鍵);③`video_projects` 列「未命名影片」(`creativeProjectId: null`,`videoProject.ts:70,85` schema 明明接受該欄位卻沒人餵)。三者互不關聯。

**影響**:直接違反北極星「單一專案主幹」本質——同一個「建立空白專案」按鈕,一次點擊產生三個互不相干的實體,且悄悄丟棄使用者原本的工作情境(active project 被替換,無任何提示或確認)。若使用者稍後想找回「原本那個空白專案」,UI 沒有任何入口(專案切換器只列 `spine.projects`,舊 `p` 若未被其他地方引用等同遺失)。這比既有 G1 §1.2 記載的「雙寫」更深一層:G1 指出「一次動作兩個平行專案體系各一筆」,本次進一步追蹤到 `spine.createProject` 內部的 `setActiveProject` 呼叫,證實使用者**原本已選定的專案會被靜默替換**,不只是「多一筆」而已。

**建議**:比照 N2 已提出的方案(N2:24,42)——`VideoProjectCreateDialog` 新增 `creativeProjectId` prop,由 `VideoCockpit.tsx` 傳入 `p.id`;`onCreated` 不再呼叫 `spine.createProject`,而是把新建的 `video_project` 掛回當前 `p`(或更新 `p` 的關聯後 reload),不建立第二個 creative_project、不切換 active project。

**證據**:`client/src/shells/video/VideoCockpit.tsx:23-28,96-172`;`client/src/spine/ProjectSpineProvider.tsx:457-464`;`client/src/components/VideoProjectCreateDialog.tsx:49-85`;`server/routers/videoProject.ts:64-90`

---

### 【CRITICAL・northstar-flow / dead-ui】2. `worldStoryboard.updateJob`(逐鏡生成狀態回寫的唯一端點)全 repo 零呼叫端——VideoStudio.tsx 佇列面板的狀態徽章永遠停在建立當下的值

**發現**:`server/routers/worldStoryboard.ts:314-349` 定義了 `updateJob`(檔頭註解「更新某個 step 的執行狀態,給渲染管線回寫進度用」),含合法的狀態機驗證(`canTransitionSegment`)與樂觀鎖式的 atomic 更新(`db.updateWorldStoryboardJobAtomic`)。`grep -rn "updateJob\b" client/src server`(排除 `.test.` 檔)**只命中定義本身這一行**,沒有任何呼叫端——不是本頁沒接,是**全站沒有任何生成管線、任何前端頁面呼叫這支 API**。

同時,`worldStoryboard.ts:587-598`(`queueForVideo`)在建立佇列時,把每個 `jobsJson[segmentId].status` 寫死初始化為 `"queued"`。`VideoStudio.tsx:5151-5249`(AIDV-151「導演 AI 影片製作佇列」面板)用 `trpc.worldStoryboard.get` 讀出這份 `jobs`,以 `status` 欄位渲染徽章顏色(queued/success/failed/running,:5182-5187),但**本檔案本身零 `worldStoryboard.*` mutation 呼叫**(grep `worldStoryboard\.` 只命中唯讀的 `get`,VideoStudio.tsx:4417)——點擊面板內「生成」鈕(:5204-5220)只是把 `visualPrompt` 塞進 t2v 分頁的 prompt 欄位,生成完成與否**完全不會回寫**任何地方。

**影響**:這個「佇列狀態」UI 從第一天就不可能反映真實生成結果——不是本檔的疏漏,是全站沒有任何回寫生產者。使用者在此面板看到的 queued/success/failed 徽章,只可能是 `queueForVideo` 建立當下寫死的值(通常全是 `"queued"`),永遠不會變成 `success`/`failed`,即便使用者已經按了好幾次「生成」並且影片真的做出來了。這是北極星「逐幕→生成→看到反映」迴圈的結構性斷點。

**建議**:(a)短期:VideoStudio.tsx 的「生成」按鈕成功後呼叫 `worldStoryboard.updateJob({id, stepId: segId, status: "success", output: {video_url}})`,讓面板至少反映本頁觸發的生成結果;(b)若判斷此佇列面板已被 shells/video/ 座艙的 shot 生成取代,應評估直接砍掉這個 AIDV-151 面板與 `updateJob` 端點,避免死狀態機誤導使用者。

**證據**:`server/routers/worldStoryboard.ts:314-349,587-598`;`client/src/pages/VideoStudio.tsx:4417-4421,5151-5249`;`grep -rn "updateJob\b" client/src server` 僅 1 命中(定義處)

---

### 【HIGH・contract-mismatch】3. 「回到導演 AI」永遠回傳 `resultUrl: null`——DirectorAI.tsx 端已備妥的回填邏輯永遠吃不到真實生成結果

**發現**:`VideoStudio.tsx:4968-4993`(`handleReturnToDirector`)寫入 `sessionStorage["directorReturn"]` 時,`resultUrl` 欄位**寫死為 `null`**(:4985),無論使用者是否已經成功生成影片。追查原因:此函式唯一能取得的資料是 `agentBus.getChildState()`(:4970),而該狀態由各分頁 `reportState` 上報(`bus.reportState("t2v", {...})` 等,VideoStudio.tsx:1028、1938、2713、3208、3657)——**五個分頁的 reportState 都只回報 `promptPreview`/`duration`/`aspectRatio`/`cfgScale` 等輸入參數,沒有任何一個回報生成結果的 video_url**。也就是說,即使想修,目前的資料流架構本身就拿不到這個值。

對照 `DirectorAI.tsx:2427,2634,2651` 的接收端——`DirectorReturnPayload.resultUrl` 被實際消費:無對應分鏡時當 toast 的 `description`(:2634),有對應分鏡時存進 `pendingFill.resultUrl`(:2651)供後續回填卡使用(:6411,6419)。這條消費鏈是**真實、已建好、等著吃資料的**,只是 VideoStudio 這端永遠餵 `null`。

對照組(同一模式的另外兩個 studio):`ImageStudio.tsx:3009-3027,3824` 正確地把 `resultUrl: firstImage`(真實生成圖網址)送出;但 `ProStudio.tsx:4326-4346` 與 VideoStudio.tsx 一樣,`resultUrl` 也寫死 `null`——顯示這不是單一檔案的疏漏,而是「影片/音樂系列 studio 的回程橋接從未真正接上結果」的重複模式(ProStudio.tsx 不在本次稽核範圍,僅列為佐證,**未在本檔驗證** ProStudio 全貌)。

**影響**:「導演 AI 送出分鏡→VideoStudio 生成→回到導演 AI 自動回填成果」這條敘事上完整的北極星迴圈,在影片這一段實際上是斷的——使用者按下「回到導演 AI」,系統會顯示「已從 XX 場景生成」之類的措辭(需在 DirectorAI.tsx 進一步確認實際文案,**未在本檔驗證**呈現細節),但沒有任何實際影片連結被帶回,使用者得自己回頭找剛剛生成的影片 URL 手動貼回。

**建議**:至少讓其中一個分頁(如 t2v)的 `reportState` 額外回報 `videoUrl: klingResult?.video_url ?? null` 等值,`handleReturnToDirector` 改讀該欄位而非寫死 `null`。

**證據**:`client/src/pages/VideoStudio.tsx:1028,1938,2713,3208,3657(reportState 無 video_url)`、`4968-4993(resultUrl: null)`;`client/src/pages/DirectorAI.tsx:2422-2434,2596-2654`;對照組 `client/src/pages/ImageStudio.tsx:3009-3027,3824`;反例佐證 `client/src/pages/ProStudio.tsx:4326-4346`(未逐行驗證全貌)

---

### 【HIGH・northstar-flow】4. VideoStudio.tsx 本身無任何「逐幕三軌(字卡+畫面+聲音)」或專案概念——是獨立單鏡頭生成工具,不是座艙

**發現**:全檔案 `grep -c "creativeProject"` = 0、`grep -c "videoProjectId"` = 0——本檔唯一與 `videoProject` router 的接觸點是 `outputSpecEntitlement`(:877,單純查詢方案是否付費,用來決定 4K 是否可選),**沒有任何專案建立/讀取/更新/切換邏輯**。本檔的核心結構是 `TABS`(:106-117)五個分頁——文生影/圖生影/影生影/畫質優化/進階控制——每個分頁各自管理獨立的 prompt/duration/aspect 等 local state(如 kling/wan/minimax/veo3/veo3pro/ltx/sora 七組各自的 `useState`),每次生成呼叫都是獨立、無狀態的單次請求,`VideoResult`(:98-102)只含 `video_url/request_id/raw` 三欄,沒有任何「幕」「字卡」「聲音軌」的資料結構。

路由上,`/video-studio` 經 `shellRouteTable.ts:99` 轉址至 `/video/video`(`shellRouteTable.ts:47`),是 `video` shell 下與 `/video`(座艙本體)**平行**的子路由之一(App.tsx:65,342)——不是座艙的一部分,是舊版 studio 頁面被「re-home」進同一個 shell 外框但內容未變(此點 G1 §1.1 已載明「其餘 studio 子路由 re-home,不重寫」)。座艙本體(`shells/video/VideoCockpit.tsx`→`DirectorConsole`→`StorySpineColumn`+`CreationCanvas`+`ContextSidecar`)才是北極星「腳本→分鏡→逐幕(字卡+畫面+聲音)→拼接→輸出→打包」設計意圖的實際承載處,但那一層已由 G1 逐行覆蓋、且已記載其自身的「寫路徑半成品」問題(G1 §3.2、§5),**不在本檔重複**。

本檔唯一與「分鏡/幕」沾邊的地方是 AIDV-151 佇列面板(見發現 #2),但那只是一個「把某幕的 visualPrompt 文字塞進通用生成表單」的單向捷徑,沒有字卡欄位、沒有聲音軌顯示、沒有依序逐幕导览,和北極星描述的「逐幕(字卡+畫面圖影+聲音)三軌編輯」完全是兩回事——三軌編輯器本身,依 M1(M1:186)的方案設計文件,**目前整個代碼庫都還沒有**(M1 明確排除在首個 PR 範圍外)。

**影響**:若任務或使用者以為 VideoStudio.tsx 是「北極星座艙」的三軌編輯落點,這個假設不成立——需要對照 shells/video/ 才能評估三軌落地程度(該範圍已由 G1 覆蓋)。VideoStudio.tsx 本身作為「單鏡頭 AI 影片生成器」的定位是自洽的(有獨立、合理的模型選單/成本預估/結果播放器),只是與本次任務要核對的「逐幕三軌在座艙的實況」無關——這是任務框架與程式碼實況的落差,而非 VideoStudio.tsx 本身的功能缺陷。

**建議**:若產品意圖是讓 VideoStudio.tsx 承接北極星流程的一部分(例如作為座艙 shot 畫布之外的「進階生成」逃生口),應明確定義它與 `creative_projects`/`world_storyboards` 的關聯方式(例如強制要求從佇列面板進入時鎖定對應 `segId`,生成結果自動回寫,見發現 #2 建議);若只是單純的獨立工具,建議在 UI 上更清楚區隔(目前佇列面板已有此意圖但未完整,見發現 #2)。

**證據**:`client/src/pages/VideoStudio.tsx:1-120(檔頭/TABS/型別),877(唯一 videoProject 接觸點)`;`client/src/App.tsx:65,342`;`client/src/shells/shellRouteTable.ts:39-49,91-101`;`docs/research/M1-project-spine-assembly.md:186`(獨立確認三軌編輯器不在首個 PR 範圍)

---

### 【HIGH・northstar-flow / contract-mismatch】5. 拼接/輸出/打包 UI 在 VideoStudio.tsx 完全不存在,只有單鏡頭「下載 MP4」

**發現**:全檔案搜尋 `zip|打包|JSZip|匯出|拼接|裝袋|package|compose` **零命中**。本檔唯一的「輸出」相關 UI 是 `VideoPlayer` 元件(`VideoStudio.tsx:203-266`)裡每個生成結果各自的「下載 MP4」按鈕(:224-251,經 `/api/proxy-download` 代理下載單一 blob)+ 複製 URL(:252-260)+ 開新分頁(:261 起)——三個動作都是**單一影片檔案層級**,沒有任何跨鏡頭彙整、批次下載、或打包成品的概念。

對照北極星「簡易拼接→輸出→打包」與任務指定對照的「M1 NS-05 compose 唯一大件」:`docs/research/M1-project-spine-assembly.md:19,121-133` 已獨立確認**全代碼庫沒有真正的媒體合成(compose)服務**——`server/services/videoCompiler.ts`/`audioCompiler.ts` 是「情感→動作提示詞」的**文字編譯器**,不是把多段影片檔接成一支影片的合成引擎;真正的 compose 服務「目前需要新建」(M1:128)。VideoStudio.tsx 完全沒有,也不曾嘗試提供這塊——它連座艙(shells/video/RoughCutCanvas,G1:82)那種「誠實佔位:打包鈕只 setQueued(true)」的半成品都沒有,是徹底空白。

**影響**:確認任務要求核對的「拼接/輸出/打包 UI 是否存在」在本次稽核的三個檔案範圍內答案是明確的:不存在。這與 M1 對全站的診斷結論一致(compose 是唯一尚待新建的大件),本檔重新從 VideoStudio.tsx 角度獨立驗證了這一點成立。

**建議**:與 M1 建議一致——compose 服務是北極星「達最終成品」步驟的關鍵缺口,需要新建 `server/services/videoComposer.ts` 等級的媒體合成服務;VideoStudio.tsx 若要在北極星旅程中扮演角色,應等該服務就緒後再評估是否需要跨鏡頭彙整 UI。

**證據**:`client/src/pages/VideoStudio.tsx` 全檔(0 命中 zip/打包/匯出/拼接/compose);`client/src/pages/VideoStudio.tsx:203-266`(唯一輸出 UI,單檔下載);`docs/research/M1-project-spine-assembly.md:19,121-133`

---

### 【HIGH・contract-mismatch,已知缺口,本次獨立覆核為現況仍成立】6. `creativeProjectId` 在 VideoProjectCreateDialog.tsx 建案流程中從未被送出,即使後端 schema 已支援

**發現**(N2:24、M1:36,42 已記載,本次於 812f6fdb/HEAD 現況重新逐行核對,確認仍成立、未被修正):`server/routers/videoProject.ts:70`(`create` 的 zod input)、`:85`(寫入 db)明確支援可選的 `creativeProjectId: z.number().int().positive().optional()`,`drizzle/schema.ts` 上 `video_projects` 表本身就有此外鍵欄位(依 M1:36 記載,**未在本檔重新讀 schema.ts 逐行驗證**,信任 M1 既有引用)。但 `VideoProjectCreateDialog.tsx:55-85` 的 `Props` 介面與 `handleConfirm()` 送出的 `createMut.mutate({...})` payload(:79-84)**完全沒有 `creativeProjectId`** 這個欄位或概念——不是傳了空值,是整個組件從沒有這個輸入路徑。

另外重新確認:`grep -rn "getByCreativeProjectId" server client` 在本次稽核時依然 **0 命中**——N2(N2:24)當初記載的「唯讀查詢目前不存在」現況未變。

**影響**:與發現 #1 相互印證——即使將來修好 #1(VideoCockpit.tsx 傳入 `p.id`),`VideoProjectCreateDialog.tsx` 本身現在的元件簽章也接不住這個參數,需要同步擴充 Props。這也代表北極星「單一專案主幹」在建案這個入口點目前是結構性斷開的,不只是呼叫端沒填值这么簡單。

**建議**:與 N2:42 建議一致——`VideoProjectCreateDialog` 新增 `creativeProjectId?: number` prop,送出時原樣帶入(schema 已支援,零後端改動);新增 `videoProject.getByCreativeProjectId` 唯讀查詢供後續讀取用。

**證據**:`client/src/components/VideoProjectCreateDialog.tsx:49-85`;`server/routers/videoProject.ts:64-90`;`docs/research/N2-architecture-decisions.md:24,42`;`docs/research/M1-project-spine-assembly.md:36,42`

---

### 【MEDIUM・contract-mismatch】7. AIDV-270 多模態輸入素材(`inputAssets`)全鏈路只有「收」沒有「用」——生成管線零消費端

**發現**:`VideoProjectCreateDialog.tsx:139-144` 掛載 `VideoInputAssetsUploader`,把使用者上傳/貼上的圖片/音訊(含 role 標記)存進 `inputAssets` state,建案時隨 `videoProject.create` 一起送出(:82-84)。伺服器端完整支援 CRUD:`videoProject.ts:75,89,111,135,156,174,243,335,373,391`(create/get/list/update/duplicate 皆含此欄位)、`videoRoute.ts:80,156,164,184,250,275`、`v1.ts:25-27`、`db.ts:5697` 都有對應處理。

但 `grep -rln "inputAssets" client/src` **只命中 `VideoProjectCreateDialog.tsx` 這一個檔案**——沒有任何座艙畫布(AssetGenCanvas/ShotDetailCanvas 等,G1 已列)、沒有 `generate.ts`、沒有任何 `server/services/*.ts` 讀取或消費這個欄位去實際影響生成請求。也就是說,使用者在建案當下花力氣上傳的參考圖/參考音檔,存進資料庫後,**目前沒有任何程式碼路徑會把它們真正餵給 fal.ai 或任何生成呼叫**——是一個只寫不讀的資料黑洞。

**影響**:功能在 UI 層看起來「已完成」(有完整的拖放上傳區塊、role 選擇、序列上傳邏輯,VideoInputAssetsUploader.tsx),使用者體驗上會誤以為上傳的素材會被用於後續生成,但目前這是一個純粹的資料收集動作,對最終生成結果沒有任何影響——若使用者期待「傳了張參考圖,生成應該長得像」,會落空且沒有任何提示告知「此素材目前尚未接入生成」。

**建議**:短期在 `VideoInputAssetsUploader` 或建案完成後的提示文案上誠實標註「輸入素材將用於後續生成」尚未成立(比照座艙其他半成品「誠實佔位」慣例,G1 §3.1-2);中期需要在 shot/asset 生成路徑讀取 `video_projects.inputAssets` 並實際套用(例如以 role="reference_image" 的素材作為 i2v 首幀)。

**證據**:`client/src/components/VideoProjectCreateDialog.tsx:30-31,58-59,82-84,139-144`;`grep -rln "inputAssets" client/src` 僅 1 檔;`grep -rn "inputAssets" server/routers/generate.ts server/services/*.ts` 0 命中

---

### 【MEDIUM・uiux-defect】8. VideoProjectCreateDialog.tsx 沒有專案名稱輸入欄位,雙寫的兩筆記錄各自寫死不同的預設標題

**發現**:`VideoProjectCreateDialog.tsx` 整個對話框(:87-158)只有畫面比例、輸出規格、輸入素材三組控制項,**沒有任何文字輸入框讓使用者命名這個專案**。送出的 payload(:79-84)沒有 `title` 欄位,因此永遠吃 `videoProject.ts:69` 的 schema default `"未命名影片"`。與此同時,發現 #1 追蹤到的 `VideoCockpit.tsx:170` 呼叫 `spine.createProject("未命名創作", "影片")` 也是寫死字串,不吃對話框的任何輸入(因為對話框根本沒有名稱輸入可傳)。

**影響**:即使發現 #1/#6 的雙寫問題被修正(改成同一個專案、同一個外鍵),使用者依然無法在建案當下自己命名專案——兩個系統各自的預設標題文字不同("未命名影片" vs "未命名創作"),對使用者而言是更難堪的體驗細節:創作了老半天,系統裡卻同時存在兩個「未命名 XX」的稱呼指向理論上同一個東西。

**建議**:對話框新增一個標題輸入欄位(可選,留空時維持現有 default 行為,零破壞性),兩處預設字串至少統一用詞。

**證據**:`client/src/components/VideoProjectCreateDialog.tsx:55-158`(全對話框 UI,無 title 欄位);`server/routers/videoProject.ts:69`;`client/src/shells/video/VideoCockpit.tsx:170`

---

### 【MEDIUM・dead-ui / other(任務框架澄清)】9. SceneSwitcher.tsx 與影片「逐幕」無關,且其唯一掛載處被預設關閉的旗標鎖死

**發現**:
- **範疇澄清**:`SceneSwitcher.tsx:1-46` 的 `SceneId`/`SCENE_META` 是四個**環境氛圍背景**(夜空 nightSky / 晨光 morning / 咖啡廳 cafe / 深海 deepSea,:22-46),來自 `@/components/AmbientEnvironment`(:11)——是首頁裝飾性背景漸層的切換器,**不是**任何影片專案/分鏡/場景的資料實體。全站 `grep -rln "SceneSwitcher"` 只命中 5 個檔案,扣除本檔自身與 `AmbientEnvironment.tsx`(定義來源)、`ThemeContext.tsx:133`(僅程式碼註解提及,非 import)、`server/routers/learnHub.seed.ts:2530`(教學內容文字,非程式碼)後,**唯一實際 import/渲染的檔案是 `client/src/pages/Home.tsx:60,1200`**——`client/src/pages/VideoStudio.tsx` 對本元件零引用,兩者無任何關係。
- **dead-ui**:`Home.tsx:1200` 對 `<SceneSwitcher>` 的渲染包在 `{HOME_FEATURE_FLAGS.showLegacyTopNav && (...)}`(:1180)條件內,而 `HOME_FEATURE_FLAGS.showLegacyTopNav` 在 `Home.tsx:102` **硬編碼為 `false`**,註解明講原因:「登入後 Dock 已負責導覽,這個 nav 在創作中樞情境下會重複,所以預設關閉」。因為這是全站唯一的渲染點且無其他開關可以打開它(純前端常數,非 feature-flag 服務讀取),`SceneSwitcher.tsx` 這 245 行元件(含 framer-motion 動畫、4 選項面板、`localStorage`(經由 `AmbientEnvironment.tsx:649-679` 的 `useAmbientEnvironment` hook)持久化邏輯)在目前預設組態下**永遠不會出現在畫面上**。使用者因此沒有任何 UI 入口可以手動切換/覆寫背景場景——雖然背景本身(`<AmbientEnvironment forceScene={sceneId}>`,Home.tsx:1174)仍會依時間自動切換並正常顯示,只是「手動選」這個能力整條路徑都摸不到。

**影響**:對本次任務而言,重要的是排除「SceneSwitcher.tsx 是逐幕三軌相關元件」這個假設——它與任務要核對的北極星逐幕三軌(字卡+畫面+聲音)完全無關,是不同子系統(首頁裝飾)的元件,命名恰好都含"Scene"造成任務描述上的潛在誤讀。其次,即使就其自身功能(背景美術切換)而言,也是一個目前不可達的死 UI,屬於刻意的產品決策(非程式錯誤),但仍構成「維護的程式碼路徑無法在預設組態下被使用者觸及」的技術負債。

**建議**:若確認不再需要手動場景切換,可評估連同 `SceneSwitcher.tsx`+相關 `localStorage` override 邏輯一併移除,減少維護面;若未來要重新啟用,需要一個非「首頁頂部 nav」的新掛載點(例如 Dock 內或設定頁),而不是依賴已註記「用不到」的 `showLegacyTopNav`。

**證據**:`client/src/components/SceneSwitcher.tsx:1-46`(場景定義);`grep -rln "SceneSwitcher" 全 repo` 5 檔,其中僅 `Home.tsx:60,1200` 為實際 import/渲染;`client/src/pages/Home.tsx:99-102,1180-1210`;`client/src/components/AmbientEnvironment.tsx:645-694`;`grep -n "SceneSwitcher\|creativeProject\|videoProjectId" client/src/pages/VideoStudio.tsx` 0 命中

---

### 【LOW・uiux-defect】10. t2v 分頁「共用輸出規格」選擇器對 Sora 顯示重複、易混淆的雙重解析度控制

**發現**:`VideoStudio.tsx:1172-1185` 的「輸出規格」`OutputSpecSelector` 區塊在 t2v 分頁**無條件渲染**(不依 `activeT2VModel` 分支),文案為「套用於下方文生影模型;實際生效程度依模型而定」(:1176-1177)。已由 `docs/research/H2-fields-image-video.md:198` 確認並定性為**非缺陷**:`outputSpec` 只送進 kling/wan/minimax/veo3 四支 mutation(本次重新核對 `outputSpec:` 出現次數與位置,VideoStudio.tsx:1048,1068,1086,1105,確認與 H2 記載一致),veo3Pro/ltx/sora 三支後端 zod schema 本來就沒有 `outputSpec` 欄位(`videoStudio.ts:756-837,844-`——Veo3Pro/LTX/Sora 的 input schema 逐一核對確認無此欄),前端也正確地沒有送——**契約本身是對齊的,不是本次新發現的錯誤**。

本次新增的、H2 未提及的觀察點:選擇 Sora 模型時,畫面上會**同時**出現兩組看起來都是「解析度」的控制項——頂部共用區塊的 `OutputSpecSelector`(對 Sora 無效)與 Sora 專屬的「解析度」下拉選單(`VideoStudio.tsx:1704-1719`,值為 `soraRes`,真正被 `runSora()` 使用,:1159)。兩者在畫面上並列,沒有任何視覺或文字提示告知使用者「上面那組對這個模型不生效,請看下面這組」。

**影響**:輕微——不影響功能正確性(H2 已證實資料真的沒送錯),但使用者選 Sora 時面對兩個標籤相近的解析度選項,容易誤改上面那組以為有效,造成困惑。

**建議**:Sora(及 LTX/Veo3 Pro)分頁可考慮隱藏或淡化頂部共用選擇器,或在其旁加註「此模型使用下方專屬設定」。

**證據**:`client/src/pages/VideoStudio.tsx:1172-1185,1704-1719,1151-1168`;`server/routers/videoStudio.ts:755-843`(veo3Pro/ltx schema 無 outputSpec);`docs/research/H2-fields-image-video.md:198`(契約正確性既有結論)

---

## 已驗證排除的疑慮(negative results)

1. **4K/付費方案的守門不是純前端旗標,不構成 client-security 繞過**:`VideoProjectCreateDialog.tsx` 的 `clampOutputSpecToPlan`(:78)與 `VideoStudio.tsx` 的 `effectiveOutputSpec = outputSpecForGeneration(t2vOutputSpec, isPaidPlan)`(:883)確實只是前端防呆,但伺服器端 `server/routers/videoProject.ts` 的 `assertPaidFor4K`(建案路徑,:61-62 呼叫點)與 `server/routers/videoStudio.ts:361-366` 的 `assertResolutionAllowed`(逐一在 kling/wan/minimax/veo3 四個有 outputSpec 的生成端點內呼叫,:591-603 等)都會獨立、伺服器端重新驗證付費狀態並在非付費選 4K 時擲 `FORBIDDEN`。繞過前端 UI 直接呼叫 API 無法取得未付費的 4K 生成。
2. **佇列面板讀取的 `worldStoryboard.get.jobs` 鬆散型別不構成 contract-mismatch/當機風險**:`worldStoryboard.ts:69`(`jobs?: Record<string, Record<string, unknown>> | null`)本身就是無嚴格 schema 的 JSON blob,`VideoStudio.tsx:5177-5181` 讀取時全程使用 `as Record<string, unknown>` + `??` 預設值防禦(`status ?? "queued"`、`sceneHeading ?? segId`、`visualPrompt ?? ""`),不會因欄位缺失而崩潰或顯示 `undefined`。
3. **「前往分鏡板」導覽目標是真實存在的路由,非死連結**:`VideoStudio.tsx:5232` 的 `navigate(\`/animation/${queueStoryboardId}\`)` 對應 `App.tsx:273` 與 `shellRouteTable.ts:45` 皆有註冊 `/video/animation/:storyboardId`(經 `SHELL_INTERNAL_REDIRECTS` 由 `/animation/:storyboardId` 轉入),路徑有效。
4. **`queueForVideo → /video-studio?queue=:id` 的初始交接是接上的,斷點只在後續狀態回寫**:`DirectorAI.tsx` 的 `queueForVideoMut.onSuccess` 導覽與 `VideoStudio.tsx:4400-4421` 的 `useSearch()`+`worldStoryboard.get` 消費端確實對應(此點 `docs/research/Y2-director-ai-frontend.md:127` 已記載,本次重新核對現況仍成立),問題是發現 #2 記載的「回寫端全站零呼叫」,不是交接本身斷開。
5. **`aspectRatio`/`outputSpec` 列舉值前後端一致**:`VideoProjectCreateDialog.tsx` 的 `ASPECT_OPTIONS`(16:9/9:16/1:1)、`OutputSpecSelector` 的解析度/幀率/編碼選項與 `server/routers/videoProject.ts:30-36` 的 zod enum(`aspectRatioSchema`、`outputSpecSchema`)逐一核對一致,無枚舉漂移。
6. **`<video><track kind="captions" /></video>` 空殼是既有已記載的無障礙缺口,非本次新發現、與「字卡」概念無關**:`docs/research/C-uiux.md:161` 已記載此為低風險 a11y 註記(生成預覽用途)。特別澄清:這是「聽障字幕軌」(accessibility captions),與北極星「字卡」(scene title card,逐幕的文字卡面)是完全不同的概念,不應混淆——VideoStudio.tsx 本身沒有任何「字卡」(scene caption/title card)資料結構或編輯 UI,此點已於發現 #4 說明。

---

## 缺讀聲明

- `client/src/shells/video/` 全目錄(VideoCockpit.tsx 除外,僅為追查發現 #1 讀取 :1-182 全檔)、`client/src/spine/`(僅為追查發現 #1 讀取 `ProjectSpineProvider.tsx:74,411,455-465`,非逐行通讀)——此範圍已由 `docs/research/G1-video-cockpit.md` 逐行覆蓋,本檔僅做交叉引用查證,不重複稽核。
- `client/src/pages/DirectorAI.tsx`、`client/src/pages/ImageStudio.tsx`、`client/src/pages/ProStudio.tsx`——僅讀取與「directorReturn/resultUrl」直接相關的片段(DirectorAI.tsx:2420-2660、ImageStudio.tsx:3009-3027 附近、ProStudio.tsx:4326-4346),未逐行通讀全檔;ProStudio.tsx 的 `resultUrl: null` 僅列為佐證,未在本檔驗證其完整脈絡是否與 VideoStudio.tsx 同因。
- `client/src/components/AmbientEnvironment.tsx`——僅讀取 `useAmbientEnvironment` hook 相關的 :645-694,未逐行通讀全檔(場景漸層渲染細節、時間自動切換演算法未核對)。
- `client/src/components/VideoInputAssetsUploader.tsx`——僅讀取檔頭與關鍵函式簽章(:1-161),未逐行核對上傳流程的錯誤處理與 SSRF 防線細節(依 commit message 與 `docs/research/X12-output-assets-deepdive.md:252` 既有結論,信任其「非 IDOR 路徑」判斷,未重新驗證)。
- `server/routers/videoStudio.ts`、`server/routers/worldStoryboard.ts`——僅針對本次發現點相關的段落抽讀(outputSpec 套用邏輯、`updateJob`/`queueForVideo`/`get` 三支程序),未逐行通讀全檔(1779 行/更長,其餘 i2v/v2v/enhance/control 端點的欄位映射細節、`worldStoryboard.ts` 其餘 procedure 未核對)。
- `drizzle/schema.ts` 的 `video_projects`/`world_storyboards` 表定義——本檔信任 M1/G1/X12 既有引用(欄位存在性、外鍵關係),未重新逐行讀取 schema.ts 原始定義。
- VideoStudio.tsx 的 i2v/v2v/enhance/control 四個分頁內部欄位映射(僅 t2v 分頁因與發現 #3/#10 直接相關而深讀)——未逐行核對,是否存在類似 #10 的雙重控制或 #6 類的欄位缺口,**未在本檔驗證**。

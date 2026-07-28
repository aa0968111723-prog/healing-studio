# M1 — 單一專案主幹 + 逐幕組裝 + 拼接輸出打包(方案設計 wave M:對齊創作本質)

- 產生日期:2026-07-03
- 依據 commit:`7d1752bd4956519181c86eef51f700b46deef9dc`
- 性質:**方案設計文件(非診斷)**——本文不重證缺口,一律引用既有研究(00-summary、D-adoption §3/§4、G1-video-cockpit、G2-worldbuilding-detail、02-fullstack §2.4、I-debt-dormant §2.4、J-code-structure);只回答「怎麼把它做成一套貼合創作本質的方案」
- 本質定義(必須對齊,逐字重述):創作者建「單一專案」,流程 = **腳本→分鏡→每一幕(字卡+畫面圖/影+聲音配音/音樂)→簡易拼接→輸出→打包**;要能一步步建構、達到最終成品
- 讀者:決定下一批 PR 範圍的技術決策者;每個小節附檔案路徑,可直接轉成 Jira 卡的 acceptance criteria

---

## 0. 一頁地圖:六缺口 → 六軌 → 一條龍

| # | 現況缺口(引自既有研究) | 對應軌 | 本質對齊句 |
|---|---|---|---|
| ① | 三套專案體系並存(creative_projects/video_projects/world_storyboards 橋接鬆散,I §1.2 債 #13) | **軌 A:專案主幹統一** | 「創作者建**單一專案**」 |
| ② | 分鏡管線可規劃不可執行(planPipeline 工具名 server 不存在、AIDV-44 零呼叫、frames 永遠 queued,G2 §3.2、I §2.4-1) | **軌 B:分鏡管線執行化** | 「腳本→**分鏡**」到「每一幕」之間的橋 |
| ③ | 座艙只生成靜態影格,kind=video 丟 AdapterPendingError(G1 §2.1、I §2.4-2) | **軌 C:kind=video 轉接器** | 每一幕的「畫面**圖/影**」缺一半 |
| ④ | 逐幕三軌(字卡/圖影/聲音)唯讀預覽非編輯器(G2 §3.1) | **軌 D:逐幕組裝編輯器** | 「每一幕(字卡+畫面圖/影+聲音配音/音樂)」需要**可編輯**才叫「組裝」 |
| ⑤ | 拼接=前端 JSZip 無真影片 compose(G1 §1.3、§4;videoCompiler/audioCompiler 是**提示詞編譯器不是媒體合成器**,見 §3.5 勘誤) | **軌 E:拼接/輸出/打包** | 「簡易拼接→輸出→打包」 |
| ⑥ | Studio 生成結果進背景抽屜不進專案(01 §7、D §2.1-3) | **軌 F:結果歸戶** | 沒有這條,前面五條生出來的素材找不到路徑進「單一專案」 |

六軌共用同一張底圖:**creative_projects(主幹)→world_storyboards.scenesJson(分鏡=幕列表)→StoryboardFrame/StoryboardAudioClip(逐幕三軌資料)→compose 服務(拼接)→videoProject 快取欄位(輸出)→JSZip(打包)**。下面逐軌展開,最後給分階段路線與首個 PR。

---

## 軌 A:專案主幹統一(單一專案 SSOT)

### A1 本質對齊
「創作者建**單一專案**」——本質要求全流程只認一個專案 id,腳本/分鏡/生成/交付都掛在它下面,不是三張表各自為政。

### A2 目標狀態
創作者在座艙(或任一入口)建一個專案,之後不論走 DirectorAI 腳本、AnimationStudio 世界觀分鏡、VideoCockpit 逐幕生成、匯出打包,看到的都是**同一個專案 id 與同一份進度**;不會出現「座艙裡建立空白專案時同時多出一筆 video_projects 且標題對不上」(G1 §1.2 已證實的雙寫)這種分裂體驗。

### A3 重用什麼
- `drizzle/schema.ts:3678` `creativeProjects`(creative_projects)——已具備 `worldFrameworkId`/`worldStoryboardId` 外鍵欄位,結構上已經是「主幹掛世界觀掛分鏡」的形狀,只是沒被所有頁面當唯一入口用。
- `drizzle/schema.ts:4604` `videoProjects`(video_projects)——**已有 `creativeProjectId` 欄位**(:4609)與 AIDV-684 輸出快取三欄(`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`,:4622-4625)。這代表 schema 層其實已經預留「video_projects 是 creative_projects 的輸出/算繪中繼資料子表」這個關係,只是前端建立流程沒有照這個關係走(`VideoProjectCreateDialog.tsx:66` 建案時另外呼叫 `spine.createProject` 產生第二筆,G1 §1.2)。
- `client/src/spine/projectGateway.ts`(`makeProjectGatewayTrpc`:115、`assembleProject`:363)——已是「聚合 5 個 procedure 組一份專案視圖」的脊椎層,是統一入口的天然落點。
- `client/src/contexts/WorldContext` 的 `activeProjectId`(G1 §2.1「全站唯一來源」)——已經是事實上的當前專案單一狀態來源,只差 video_projects 建立流程沒有回頭寫它。

### A4 要補什麼(最小新增)
1. **SSOT 裁定:`creative_projects.id` 是唯一對外「專案 id」**;`video_projects` 降級為「輸出算繪中繼資料」子表(1 個 creative_project 對 0/1 個 active video_project),不再是可獨立建立的平行實體。
2. `VideoProjectCreateDialog.tsx:66` 的建案流程改為:**先** `spine.createProject`(或使用既有 `activeProjectId`)拿到 `creativeProjectId`,**再** `videoProject.create` 帶入該 id 作為外鍵,標題吃同一個輸入值(而非目前的雙寫、標題寫死「未命名創作」)。
3. `videoProject.ts` 補一個 `getByCreativeProjectId` 查詢(唯讀,依 `creativeProjectId` 找唯一 active 列),取代 Sidecar `VideoProjectLifecycleCard`(G1 §1.6)目前「卡內自選第一筆,非當前專案」的錯配讀法。
4. 不動 `world_storyboards`(它本來就靠 `creative_projects.worldStoryboardId` 掛回主幹,方向正確,只是消費面要用一致)。

---

## 軌 B:分鏡管線執行化(腳本→分鏡 到 每一幕 的橋)

### B1 本質對齊
「腳本→**分鏡**→每一幕」——分鏡必須真的能從「規劃」走到「產出每一幕的素材」,否則腳本與分鏡只是文件,不是可建構的產能。

### B2 目標狀態
創作者在 AnimationStudio 按下「編排動畫管線」後,不只看到估價表(現況),而是可以按「開始執行」,看著每個 frame/audioClip 的狀態從 `queued`→`t2i_done`/`generating`→`refined`/`done` 真實推進,失敗有錯誤訊息與重試,而不是 UI 上的「m/n 已轉影」永遠卡在 0(G2 §3.2)。

### B3 重用什麼(關鍵:不新建執行器)
- `server/routers/worldStoryboard.ts:284` `planPipeline` 與其純函式 `planAnimationPipeline`(`animation.ts:616-1000`)——**規劃邏輯保留全部不動**,只換掉「工具名不對應真 procedure」這一段。
- **同名工具其實在光球 executor 是可達的**:`server/services/agentToolExecutor.ts:986` `dispatchStudioTool`,16 個 `studio.*` case 含 `studio.generateImage`/`studio.generateVideo`/`studio.generateAudio`/`studio.generateVoice`/`studio.generateSfx`/`studio.generate3D`(G3 §1.2 權威表),是「194 個工具中真正可達的 37 個」之一群,且已接 `GENERATION_SLOT_TOOLS`(:15)額度守門與 fal 派工。**這正是 I-debt-dormant §2.4-1 指名的喚醒路徑**:pipeline runner 不用自建生成呼叫,直接把 plan 的每個 step 轉成一次 `executeOrbToolCalls`(:533)呼叫即可拿到扣點/風控/fal 派工全套。
- `updateJob`(worldStoryboard.ts:314)+ `db.updateWorldStoryboardJobAtomic`(:342)+ `updateSessionStatus`(:353)——AIDV-44 狀態機**程式碼已完整**,只是 0 呼叫者(I §2.2 表)。runner 每完成一步就呼叫它們回寫,frame/audioClip 狀態才會真的動。
- `generate.submitStudioJob`(`server/routers/generate.ts:2143`)——已存在的「登記到 background_jobs 讓任意頁面追蹤」端點,runner 可直接借用,不用另開追蹤機制。

### B4 要補什麼(最小新增)
1. 一個 **pipeline runner 服務**(新檔,如 `server/services/storyboardPipelineRunner.ts`):讀 `pipelinePlanJson`,依序(或依 DAG 淺層並行)把每個 step 的 `tool` 欄位對應到 `executeOrbToolCalls` 可接受的 call 格式,呼叫後把回傳結果(assetUrl/jobId)寫回對應 frame(`imageUrl`→`refinedImageUrl`→`videoClipUrl`)或 audioClip(`audioUrl`),並呼叫 `updateJob`/`updateSessionStatus` 推進狀態。
2. `worldStoryboard.ts` 新增一個 `runPipeline` mutation(或把 runner 掛進既有 cron/queue),作為「編排動畫管線」按鈕旁「開始執行」的後端落點——**不改 planPipeline 本身**。
3. `jobsJson` 需要一個消費者(現況只有 `queueForVideo` 會 seed `queued`,I §2.2 已指出):runner 即是這個消費者,跑完把 `jobsJson[i].status` 從 `queued` 更新到 `running`/`done`/`failed`。
4. 失敗重試沿用現有「單鏡重生成」語意(座艙 shot 畫布已有此 UX,ShotDetailCanvas.tsx,G1 §1.5),不必新設計。

---

## 軌 C:kind=video 轉接器(每一幕的「圖/影」補完)

### C1 本質對齊
每一幕要求「畫面**圖/影**」——圖是現況(座艙唯一路徑),影(i2v)是本質明文要求但目前技術性缺一角。

### C2 目標狀態
座艙 shot 畫布生成時選「影片」而非「靜態影格」,能真的產出一段影片(而非丟 `AdapterPendingError`);流程與圖片生成同構(先估→先扣→佇列→資產庫),使用者不需要察覺這是「新接的一角」。

### C3 重用什麼
- `generation.trpc.ts:117-122` 的 `AdapterPendingError`(M3 待建)標記處——已知的唯一斷點,**不是整條管線都缺**,只缺這個 adapter case。
- videoStudio 的 i2v procedures「全部現成」(I §2.4-2 明確結論)——`server/routers/videoStudio.ts` 既有 Kling/Wan/MiniMax/LTX 等 image-to-video 端點(01/02 §2.3 已盤點),供 adapter 直接呼叫。
- `dispatchStudioTool` 的 `studio.generateVideo`(G3 §1.2)同一支落地邏輯——與軌 B 共用同一個真正執行入口,兩軌可以共用同一次補強。

### C4 要補什麼(最小新增)
1. `generation.trpc.ts` 的 adapter 分派加一個 `kind === "video"` case:輸入取 shot 目前的 `imageUrl`(keyframe)當首幀,呼叫既有 i2v procedure(依 `modelHints.video` 或大腦預設引擎),沿用同一套 estimateCost→submitStudioJob→輪詢→recordGenResult 骨架(座艙圖片路徑已有,不重寫)。
2. `StoryboardFrame.videoClipUrl`(既有型別欄位,worldbuilding-animation.ts:88-120)作為寫入落點——欄位已在,只差寫入者。
3. 匯出素材包目前檔名一律 `.mp4`(CreationFlowBar.tsx:283-307)但實際是圖片——此軌補完後這個「假檔名」問題自然消失,不需要單獨修。

---

## 軌 D:逐幕組裝編輯器(字卡 + 圖影 + 聲音三軌可編輯)

### D1 本質對齊
「每一幕(字卡+畫面圖/影+聲音配音/音樂)」——三個並列元素,本質要求它們是**創作者可逐項編輯**的組裝單位,不是建立後只能整體刪除的唯讀清單。

### D2 目標狀態
創作者點開任一幕,看到三軌並排:字卡(文字/時間點)、畫面(圖/影,可重生或替換)、聲音(配音/音樂/音效,可調時間偏移與音量),每軌可獨立增刪改,不需要重新整個分鏡重建。這是把現況「`StoryboardTimelinePreview` 純顯示」(G2 §3.1)升級為真編輯器。

### D3 重用什麼
- 資料形狀已經是三軌對齊的形狀,不必重新設計 schema:`StoryboardFrame`(`shared/worldbuilding-animation.ts:88-120`,含 `atSec`/`shotDescription`/`imageUrl`/`videoClipUrl`)+ `StoryboardAudioClip`(:124-149,`kind=music|voiceover|sfx`+`startOffsetSec`+`audioUrl`)+ `StoryboardCharacterBeat`(:59-80,含 `dialogue`)——**字卡目前沒有專屬欄位**(見 D4),但畫面/聲音兩軌的資料模型已完整存在,只缺 UI 寫入路徑。
- `worldStoryboard.ts` 的 `update` procedure(全量 `scenesJson` patch,G2 §2.3)——逐幕編輯可先用「單場 patch 後整包送 update」的寫法起步,不必馬上做細粒度 API。
- ShotDetailCanvas(座艙,G1 §1.5)已有的「大圖預覽+生成/核准/同 seed 重生」UI 骨架——三軌編輯器的「畫面軌」可直接沿用,不必重畫。
- VoiceAmbientCanvas / MusicCanvas(座艙,G1 §1.5)已有的配音/配樂生成 UI——「聲音軌」的生成面板可直接掛進逐幕編輯器,差別只是要把結果寫回**該幕的** `audioClips[]` 而非目前散落的 proStudio 呼叫。

### D4 要補什麼(最小新增)
1. **字卡欄位**(目前 0 型別存在,經 grep 確認):`StoryboardFrame` 加一個輕量欄位如 `captionText?: string`(+可選 `captionStyle`),或重用 `characterBeats[].dialogue`/`innerThought` 當口白字卡、另加一個 scene 層 `titleCardText?: string` 當轉場字卡——依創作者實測後二選一,**不要一次做成通用字幕系統**(避免過度設計)。
2. 一個**逐幕三軌編輯 UI**(新元件,建議掛在 `client/src/shells/video/canvas/` 下,與 `ShotDetailCanvas` 並列或擴充之):左字卡輸入框、中畫面(重生/替換/選 kind=image|video)、右聲音軌列表(增刪 audioClip、拖動 `startOffsetSec`)。
3. 對應的**細粒度後端 procedure**(取代目前「整包 scenesJson 送 update」的粗寫法待量測後再拆,近期先用整包 patch 亦可接受,見 §5 路線分期)。
4. 不做:frame-accurate 時間軸拖拉、多軌混音——本質只要求「配音/音樂」存在且可組裝,不要求 DAW 級編輯(對齊 D-adoption §3.2「先讓迴圈在站內閉合,不求 frame-accurate」的既有結論)。

---

## 軌 E:拼接 / 輸出 / 打包

### E1 本質對齊
「簡易拼接→輸出→打包」——本質明講是「**簡易**拼接」,不是專業剪輯台;但「拼接」二字要求真的把多幕串成一個成品,不能只是「把檔案分別放進 zip」。

### E2 目標狀態
創作者在專案完成所有幕後按「輸出成片」,系統把已核准的 frames(圖或影)+ audioClips(配音/音樂)按時間軸串成一支影片(簡易拼接:順序串接+疊音軌+可選字卡疊圖,不要求轉場特效),產出一個下載連結;打包鈕則把「成片+分鏡逐幕素材+腳本」一起 zip 供離站保存/分享。

### E3 重用什麼(含關鍵勘誤)
- **勘誤**(方案設計前必須先更正既有認知,避免走錯方向):`server/services/videoCompiler.ts`、`server/services/audioCompiler.ts`(`server/video-compiler.test.ts`/`audio-compiler.test.ts` 為證)**不是媒體合成/拼接引擎**,而是「情感→物理動作/相機運動」與「Tag Stacking」的**提示詞編譯器**,服務於 Studio 積木系統(ProgressivePromptBuilder,G2 §4.1)產生送給 fal/Suno 的 prompt 文字。它們與「把多段影片檔案接成一支影片」無關,**不能作為拼接服務的重用對象**,只能在「生成前組 prompt」階段重用。真正需要新建的是媒體層 compose 服務(見 E4)。
- `videoProject.requestExport`(`server/routers/videoProject.ts:469`)+ `getExportUrl`(:440)+ AIDV-684 快取三欄(`outputStoragePath`/`outputSignedUrl`/`outputExpiresAt`,schema.ts:4622-4625)——**現況只做「單一已存在的 digital_asset 產生 presigned 下載連結」**,不做拼接;但快取欄位形狀與流程(先建/找到 asset→presign→寫快取→前端讀快取)正是輸出流程要的殼,**拼接完成後的成品直接借這條路徑輸出**,不必另起輸出端點。
- R2/S3 上傳鏈(`isR2Configured`、presign,已在 `requestExport` 內使用)——compose 完的檔案上傳沿用同一套,不必新建物件儲存整合。
- 前端 JSZip(RoughCutCanvas「打包」鈕現況為 `setQueued(true)` 佔位,CreationFlowBar「匯出素材包」已是真的逐鏡下載+全部下載,:241-334)——**打包(zip)這一層前端邏輯已經是對的**,缺的只是「先有一支拼好的成片可以一起打包」,不需要重寫 JSZip 邏輯。
- `background_jobs` 表 + `generate.submitStudioJob`/`jobStatus` 輪詢骨架——compose 任務可註冊成一種新 `jobType`("compose"),沿用同一套追蹤 UI(AgentProgressPanel、ActiveVideoTasksBanner 已存在,G1 §1.1/§1.6),不必新建進度追蹤系統。

### E4 要補什麼(最小新增,唯一真正的「淨新建」大件)
1. **compose 服務**(新檔,如 `server/services/videoComposer.ts`):輸入=一個 storyboard 的已核准 frames(依 `atSec` 排序)+ audioClips,輸出=一支影片檔。技術路線二選一(依團隊 infra 現況擇一,不在本文件內裁定,建議列為 spike):
   a. **伺服器端 ffmpeg**(需在 Railway Dockerfile 加 ffmpeg 二進位,concat + amix + drawtext 字卡疊圖,量級可控但吃 CPU/記憶體、需佇列限流);
   b. **委外合成 API**(若 fal/Replicate 有影片拼接/concat 端點,理念與現有「呼叫外部模型」架構一致,量級較小但要盤點供應商是否支援任意時長拼接)。
2. `videoProject.requestExport` 前面加一段:若目標不是單一 asset 而是整個 storyboard,先呼叫 compose 服務產生成品 asset,再走原有 presign+快取寫入邏輯(即 compose 是 requestExport 的「新輸入來源」,不是取代它)。
3. `background_jobs.jobType = "compose"` 的一個新分支,供 compose 服務登記與輪詢(沿用 `submitStudioJob`/`jobStatus` 既有 shape)。
4. CompletionCanvas(G1 §1.5)的「組合中」佔位邏輯改接真實 `outputUrl` 回填——UI 已存在,只是回填來源從「永遠沒有」變成「compose job 完成後寫入」。

---

## 軌 F:結果歸戶(生成結果進專案,不進背景抽屜孤島)

### F1 本質對齊
若前五軌生出的素材不進「單一專案」,本質就是斷的——「一步步建構、達到最終成品」要求每一步的產出都疊加在同一個專案容器內。

### F2 目標狀態
不論從 Studio 直接生成、座艙逐幕生成、或分鏡管線批次生成,產出的資產除了進 `digital_asset_library`(全站共用資產庫,不變),**只要生成時帶有 projectId/storyboardId 上下文,就同時掛回該幕的 frame/audioClip 欄位**,創作者在專案內就能看到「這是屬於哪一幕的素材」,不需要再去背景任務抽屜或素材庫用肉眼比對。

### F3 重用什麼
- 座艙生成路徑(`generation.trpc.ts:83-174`)本來就有 `recordGenResult` 之後的落點——只是目前只寫三張全站共用表,不回寫 storyboard frame。這條路徑軌 B/C 本身已經在改(runner 寫回 frame),軌 F 是同一份改動的自然延伸,**不是獨立大工程**。
- `assets.recentLineage`(AssetLineageCard,G1 §1.6)已有「最近生成資產→prompt 血統」的唯讀視覺化,可作為「這個資產屬於哪個專案/幕」補一個欄位後的顯示落點,不必新建 UI。

### F4 要補什麼(最小新增)
1. 生成呼叫(不論來源)若挾帶 `storyboardId`+`frameId`/`audioClipId` 上下文,`recordGenResult` 完成後除寫三張表,**額外**呼叫一次 `worldStoryboard.update` 或細粒度 patch(依軌 D 決定的 API 形狀)把 URL 寫回對應幕欄位。
2. Studio(非座艙)頁面若要納入同一專案語意,需要一個「選擇目前作用中專案的幕」的選擇器(輕量下拉,取 `activeProjectId` 底下的 storyboard scenes)——**建議放中期**,近期先讓座艙(本來就已綁 `activeProjectId`)這條路徑歸戶即可,不必一次擴到全站五個生成入口。

---

## 附:六軌對應的「一句話重用地圖」(便於做卡)

| 資源 | 路徑 | 在方案中的角色 |
|---|---|---|
| 專案主幹 | `drizzle/schema.ts:3678`(creative_projects)、`client/src/spine/projectGateway.ts` | SSOT + 聚合脊椎(軌 A) |
| 分鏡資料 | `shared/worldbuilding-animation.ts`(StoryboardScene/Frame/AudioClip/CharacterBeat) | 幕列表 + 三軌資料模型(軌 B/D) |
| 管線規劃 | `server/routers/worldStoryboard.ts:284`(planPipeline)、`server/services/.../animation.ts:616-1000` | 步驟藍圖,原樣保留(軌 B) |
| 管線執行 | `server/services/agentToolExecutor.ts:533`(executeOrbToolCalls)、`:986`(dispatchStudioTool,16 個 studio.*) | 真正的生成執行器,pipeline runner 借用(軌 B/C) |
| 狀態機 | `worldStoryboard.ts:314`(updateJob)、`:353`(updateSessionStatus) | AIDV-44 回寫落點(軌 B) |
| 生成統一入口 | `server/routers/generate.ts:2143`(submitStudioJob) | 任務登記/追蹤共用骨架(軌 B/E) |
| 影片轉接 | `client/src/adapters/generation.trpc.ts:117-122`(AdapterPendingError) | 唯一缺口,videoStudio i2v procedures 現成(軌 C) |
| 輸出快取 | `drizzle/schema.ts:4604`(video_projects,含 AIDV-684 三欄)、`videoProject.ts:440,469`(getExportUrl/requestExport) | 輸出/presign 既有殼,compose 完成後借用(軌 E) |
| 打包 | CreationFlowBar「匯出素材包」(逐鏡下載/全部下載)、RoughCutCanvas(打包鈕現為佔位) | 前端 JSZip 邏輯已對,缺輸入來源(軌 E) |
| 提示詞編譯(非拼接) | `server/services/videoCompiler.ts`/`audioCompiler.ts` | **勘誤**:只服務生成前 prompt 組裝,不是媒體拼接引擎(軌 E 說明) |

---

## 5. 分階段路線(近/中/長)+ 首個 PR 具體範圍

### 5.1 近期(≤3 週;目標:讓「規劃→產出→回填」第一次跑通一整條,哪怕只有一幕)

**里程碑**:創作者對**一個已連結世界觀的專案**建一個只有 1-2 幕的分鏡,按「編排動畫管線」→「開始執行」,能看到 frame 狀態從 `queued` 變成有真實 `imageUrl`,匯出素材包下載到的是真實圖檔(非假 `.mp4` 命名的圖片)。範圍 = 軌 B(核心)+ 軌 C(第一個 kind=video case)+ 軌 F 最小版(生成完成回寫該幕欄位)。

**首個 PR 具體範圍(檔案級)**:
1. 新增 `server/services/storyboardPipelineRunner.ts`:讀 `pipelinePlanJson` → 逐 step 轉呼 `executeOrbToolCalls`(`server/services/agentToolExecutor.ts`)→ 呼叫 `updateJob`/`updateSessionStatus`(`server/routers/worldStoryboard.ts:314,353`)回寫。
2. `server/routers/worldStoryboard.ts`:新增 `runPipeline` mutation(輸入 `storyboardId`,觸發 runner;先做同步跑 1-2 幕的量級,批次並行留到中期)。
3. `server/services/agentToolExecutor.ts`:確認/補上 pipeline runner 呼叫 `executeOrbToolCalls` 所需的呼叫慣例(若既有 gate 只放行特定前綴,需要把 runner 的呼叫路徑也納入放行清單,對照 I §1.1 債項 #2 的 gate 修法一併處理,避免重複踩雷)。
4. `client/src/adapters/generation.trpc.ts`:kind=video 分支,呼叫既有 videoStudio i2v procedure,移除 `AdapterPendingError` 分支(:117-122)。
5. `client/src/shells/video/canvas/ShotDetailCanvas.tsx` 或 `AnimationStudio.tsx`(:5851-5860 按鈕區):加「開始執行」按鈕呼叫 `runPipeline`,顯示 `PipelinePlanView`(:6888-6946)旁的即時進度(輪詢 `jobsJson` 或既有 `generate.myJobs`)。
6. 測試:`server/routers/worldStoryboard.*.test.ts` 新增 runner 端到端 mock 測試(避免重蹈「假測試/mock 掉執行器測不到」的覆轍,G3/I R17 已警示)。

**不在首個 PR 範圍**:逐幕三軌編輯器(軌 D)、compose 拼接(軌 E)、專案主幹統一的 UI 改動(軌 A,先在 SSOT 裁定與資料層對齊即可,前端建案流程改動排中期)。

### 5.2 中期(1-2 個月;目標:創作者能「組裝」而非只能「重建」)

**里程碑**:逐幕三軌編輯器上線(軌 D),創作者可對單一幕改字卡/換畫面/調音軌;專案主幹統一收尾(軌 A,建案流程改為單一 SSOT);結果歸戶擴大到 Studio 頁面(軌 F 完整版)。

對應交付:字卡欄位 schema 補丁 + 三軌編輯 UI + `VideoProjectCreateDialog.tsx` 改一次寫入 + `getByCreativeProjectId` 查詢 + Studio 幕選擇器。

### 5.3 長期(2-4 個月;目標:一鍵到成片)

**里程碑**:compose 服務上線(軌 E 核心),創作者按「輸出成片」拿到真實拼接好的影片,CompletionCanvas 回填成功,打包鈕把「成片+素材+腳本」一起 zip。此階段需要一次技術 spike(ffmpeg vs 委外 API)先行,再排開發。

對應交付:`videoComposer.ts` + `requestExport` 擴充 compose 輸入來源 + `background_jobs.jobType="compose"` + CompletionCanvas 回填 + Dockerfile(若走 ffmpeg 路線)。

---

## 6. 防跑偏機制(每一步如何鎖在單一專案上下文、不讓創作者迷路)

1. **id 鎖定**:所有新增 procedure(`runPipeline`/`getByCreativeProjectId`/compose 相關)一律以 `creativeProjectId`(或其唯一衍生的 `storyboardId`)作為必要輸入參數,不接受「當前使用者最新一筆」這種隱式推斷(現況 `VideoProjectLifecycleCard` 卡內自選第一筆的錯配寫法,G1 §1.6,是本方案要杜絕的反例)。
2. **UI 只有一個「當前專案」概念**:沿用既有 `WorldContext.activeProjectId`(G1 §2.1 已是「全站唯一來源」),六軌新增的所有按鈕/面板一律讀這個值,不新建第二個專案上下文 state;軌 A 的建案流程修正即是為了讓 `video_projects` 也乖乖掛在這個值下面,而不是另開一個。
3. **每軌落地前先確認「幕」的唯一定位**:`atSec`/`sequenceIndex`(StoryboardScene 既有欄位)是幕的唯一排序依據,三軌編輯器、compose 服務、pipeline runner 三者都以此排序,不各自維護一份順序邏輯,避免「編輯器看到的順序」與「compose 出來的順序」不一致造成創作者困惑。
4. **明確唯讀 vs 可寫邊界**:座艙既有的「唯讀唯讀唯讀」文化(§3.1 誠實待後端徽章)要延續到新功能——三軌編輯器若某軌暫時只做完 UI 沒做完後端(例如字卡先於畫面軌上線),必須明確標「待後端」而非樂觀假成功,避免重蹈「上傳參考照零上傳假成功」(G1 §3.2-2)覆轍。
5. **不擴大範圍到審改/協作**:D-adoption 中期路線的「審批/評論/集合」(§3.2)是另一條獨立的軌(審改迴圈),**不併入本方案**——本方案只解決「單一創作者一步步建構到成品」,團隊審批留給既有 D 路線,避免本次 PR 範圍失控。
6. **不重寫已完整的部分**:軌 B 不動 `planAnimationPipeline` 規劃邏輯本身;軌 E 不重寫前端 JSZip;軌 C 不重寫圖片生成鏈——所有補強都以「加一個 case/加一個回寫點」為原則,任何「順手重構」都應該拆成獨立 PR,不與本方案的核心里程碑混在一起送審。
7. **每個里程碑都有可展示的端到端 demo**:近期里程碑要求「至少一幕從規劃到有真實圖檔」可錄影展示;中期要求「改一幕的字卡/畫面/聲音後重新整理頁面,改動還在」;長期要求「按一次輸出鈕,幾分鐘後有一支可播放的成片」。任何一步做不到 demo,視為該階段未完成,不進下一階段。

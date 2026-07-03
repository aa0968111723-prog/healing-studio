# P3 — 業界創作流 UX 對照 teardown(腳本→分鏡→逐幕→拼接→輸出)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 性質:**深度研究 wave P(業界對照,上網查)**——本文不重複 `D-adoption.md` §4 已建立的商業模式/定價/enterprise 治理對照,只專攻「腳本→分鏡→逐幕→拼接→輸出」這條創作流本身的 **UX 細節**(畫面怎麼排、互動怎麼設計、引導怎麼給),供 M1(專案主幹+拼接輸出)、M2(單專案 AI 引導)、M4(素材/一致性)三軌方案取材
- 共同依據:`D-adoption.md` §4(業界對照總覽,勿重讀已有結論)、`M0-solution-blueprint.md`(七支柱本質)、`M1-project-spine-assembly.md`(六軌:主幹/分鏡執行化/kind=video/逐幕三軌/拼接輸出/結果歸戶)
- 對照的本站畫面(先報備,後文引用簡稱):`AnimationStudio`(世界觀+分鏡列表)、`ShotDetailCanvas`(座艙單鏡生成/核准)、`StoryboardTimelinePreview`(逐幕三軌唯讀預覽)、`DirectorAI` CO-STAR 對話→批次生成鏈、`consistency_vault`(角色/場景一致性錨點)、`studio_recipes`(生成配方)、`CreationFlowBar`(匯出素材包)、`RoughCutCanvas`(打包鈕現為佔位)、`CompletionCanvas`(成片回填現為佔位)、`ProjectFlowGuide`(五步引導,旗標鎖)、光球(全域代理,`orbTaskStateMachine`)、`SocialPublish`(mock 發佈)
- 方法聲明:全部依 WebSearch 摘要交叉比對官方頁與第三方評測整理;凡官方頁(ltx.io/help.ltx.io、blog.google、workspace.google.com、higgsfield.ai、klingai.com/kling.ai、descript.com/help.descript.com、adobe.com/blog.adobe.com、florafauna.ai、krea.ai/docs.krea.ai、openart.ai、help.runwayml.com、figma.com/weave.figma.com)可得優先採用;第三方(chasejarvis、wireflow、gaga.art、uraiguide、topview.ai 等)僅作交叉驗證,未逐頁核實者於 §末「查不到/未涵蓋」註明
- 查詢日期:**2026-07-03**(以下所有來源檢索日期同此,不逐條重複標註;外部文章內容以其發佈當時為準)

---

## 0. 四個對照維度(每個競品都問這四題)

1. **分鏡→逐幕的 UX**:一幕一幕怎麼呈現?字卡/畫面/聲音三軌怎麼編輯?時間軸長什麼樣?
2. **AI 引導/一步步的 UX**:有無「下一步」引導?怎麼避免創作者迷路?
3. **素材/一致性管理 UX**:角色/風格一致性怎麼鎖?對照本站 Vault/世界觀。
4. **拼接輸出的 UX**:簡易拼接怎麼做?輸出打包長什麼樣?

---

## 1. LTX Studio(narrative-first,與本站最同構)

**分鏡→逐幕**:上傳劇本後 AI 自動切「場景(scene)→鏡頭(shot)」兩層結構,畫面先給「共有幾幕、每幕文字摘要」的總覽清單再逐一生成,不是一次性吐一支長影片;可選 FLUX 或 Nano Banana 出圖模型、**先在總覽層統一定好長寬比**,避免逐鏡各自跑掉。旁白/配音走**內嵌 TTS**:選底聲、調語氣、貼腳本文字,可加「情緒/表達方式」提示詞,生出的旁白**落在獨立音軌**,可像其他聲音元素一樣被裁切;新版 **Timeline Editor** 是「熟悉的剪輯介面」(排場景、調時間、加轉場),且**場景級時間軸可單獨精修某一鏡,不需要重跑整個序列**。來源:[LTX Blog 2026 features](https://ltx.io/blog/top-ltx-studio-features)、[Rundown University timeline workshop](https://app.therundown.ai/workshops/from-storyboard-to-final-cut-mastering-ltx-studios-new-timeline-feature)、[Animatics 頁](https://ltx.studio/platform/animatics-software)。

**AI 引導**:新手路徑明確四步——**建專案→生一張圖→把圖動畫化→丟進 Storyboard**,官方文案強調「這套流程走一次要幾分鐘,走熟後幾秒」,刻意設計成「不會一開始就被功能量淹沒」但也「不是走馬看花跳過細節」的中間值。登入後給兩條路:「從零開始寫故事」或「寫一句提示詞讓 AI 生故事」,且**不確定寫什麼時可以選預設選項並持續 refresh 直到滿意**——這是一個「降低空白畫布焦慮」的具體 UI 招式。來源:[LTX Studio Tutorial](https://ltx.io/blog/ltx-studio-tutorial)、[topview.ai 教學](https://www.topview.ai/blog/how-to-use-ltx-studio-the-ai-video-generator-tutorial)。

**一致性管理**:**Elements** 是資產一致性引擎——角色/場景/物件/品牌資產各自建一個 Element,**每個 Element 可傳最多 10 張參考圖**,建議角色至少 3-5 張不同角度、正面優先、乾淨中性背景;寫 prompt 時用 **`@` 標記**(如社群平台標記人一樣)呼叫特定 Element,**確保引用的是同一個資產而不是重新讓 AI 憑描述詮釋一次**。來源:[Elements 介紹](https://help.ltx.io/hc/en-us/articles/33578393195922-Introduction-to-Elements)、[如何維持角色一致性](https://ltx.io/blog/how-to-maintain-character-consistency-in-ai-video)、[品牌一致廣告教學](https://ltx.io/blog/create-a-brand-consistent-ad-using-ltx-studio)。

**拼接輸出**:Timeline Editor 本身即拼接介面(排列/修剪/轉場),輸出走一般影片匯出;無另外發現獨立於編輯器之外的「打包」步驟(即編輯完成=可直接匯出,不是先拼接再另外包裝)。

**對本站啟示**:①「總覽先定長寬比+批次確認再生成」直接對應 M1 軌 B 的 `runPipeline` 前置確認步;②`@` 標記呼叫一致性資產,是本站 `consistency_vault` 目前「選角色→注入生成」流程可以直接抄的互動細節,把「選取」變成「輸入時自然帶出」;③「場景級時間軸單獨精修不必重跑全序列」正是本站逐幕三軌編輯器(軌 D)要達到的體驗基準線。

---

## 2. Runway(單模型旗艦,Chat Mode 對話式構思)

**分鏡→逐幕**:Runway 本身不是 storyboard-first 產品,官方教學把「storyboard」放在**流程建議**而非產品原生功能——推薦流程是「Step 1 定 brief/選角/畫分鏡(用外部工具如 Canva)→Step 2 生片段→Step 3 剪輯定案」,即 storyboard 這層目前**外包給使用者自己的前置工具**,Runway 專注在生成與後段剪輯。來源:[Segmind Gen-3 教學](https://blog.segmind.com/how-to-use-runway-gen-3-alpha-image-to-video-with-examples/)、[Lemon Slice 產品廣告教學](https://lemonslice.com/blog/create-product-ads)。

**AI 引導**:**Chat Mode** 是本輪調研中最值得借鏡的「引導型」介面——用自然語言對話**先腦力激盪與構思分鏡**,再生成圖/影,接著**用對話反覆迭代**結果(「再暗一點」「鏡頭拉遠」),官方定位為「先協作討論 prompt 想法,再開始生成」的前置階段。**Director Mode** 則是另一種引導:辨識具體運鏡術語(pan/tilt/zoom/dolly),讓運鏡與主體動作**可分開控制**,把「創作者不知道怎麼下 prompt 才能拍出想要的鏡頭」變成選單化操作。來源:[Runway 官方 Chat Mode 說明](https://help.runwayml.com/hc/en-us/articles/42290974553875-Creating-with-Chat-Mode)、[Gen-4 Chat Mode 教學](https://academy.runwayml.com/tutorial/creating-with-chat-mode)。

**一致性管理**:本輪檢索未見 Runway 有等同 Elements/Character Builder 的專屬一致性資產庫(其一致性依賴模型本身+同一參考圖重複輸入),UX 層面弱於 LTX/Higgsfield/OpenArt。

**拼接輸出**:未見原生「一鍵拼接多鏡成片」介面,官方建議是產出片段後**手動送外部剪輯軟體定案**——這點與本站現況(前端 JSZip 純打包、無 compose)相似,是「反面案例」而非可抄範例。

**對本站啟示**:①Chat Mode「先對話構思分鏡、再生成、再對話迭代」的三段式,值得對照本站 DirectorAI CO-STAR 對話——本站已有對話出腳本,但**迭代修改目前要重新走批次生成**,可借鏡「同一對話串內針對單鏡追問式迭代」的互動模式;②Director Mode 的「運鏡與主體動作分軌控制」可對應 `ShotDetailCanvas` 補一個運鏡選單(非必要但高感知)。

---

## 3. Krea(64+ 模型套件,node 工作流+Node Agent)

**分鏡→逐幕**:Krea 本質是 node canvas 而非線性時間軸產品,「逐幕」概念被拆成節點鏈(生成→放大→編輯→輸出各自一個節點),沒有專屬的「一幕一幕」列表視圖。

**AI 引導**:2026 推出的 **Node Agent** 是本輪最值得借鏡的「AI 引導不迷路」設計——使用者打一句話描述想做的東西,Agent **讀取目前畫布狀態、規劃管線、把節點接線**,關鍵是**先秀出計畫給使用者看,經核准後才動手**,且**核准後節點是一層一層出現在畫布上、每個新節點即時接上前一個**(逐步具現化,而非瞬間吐出整包結果讓人看不懂發生了什麼)。同時期介面大改版強調「統一導覽、透明模型選擇、可自訂工作區」,官方自承「64+ 模型+Nodes+Apps+Realtime+LoRA+Enhance+3D,新手上手要一個下午」,即**功能廣度本身就是迷路風險**,Node Agent 正是為了緩解這點而生。來源:[Krea Node Agent 公告](https://www.krea.ai/index/ai-workflow-agent)、[Node Agent 部落格](https://www.krea.ai/blog/ai-workflow-agent)、[Nodes 官方文件](https://docs.krea.ai/user-guide/features/nodes)、[ThePlanetTools 評測](https://theplanettools.ai/tools/krea-ai)。

**一致性管理**:未見獨立於 LoRA 訓練外的「角色鎖」UI;一致性主要靠使用者自訓 LoRA 或重複參考圖輸入到節點。

**拼接輸出**:Realtime 畫布(<50ms 延遲)是即時預覽/迭代取向,不是輸出打包功能;節點鏈的終點即輸出節點,無獨立「打包」步驟。

**對本站啟示**:**Node Agent「先秀計畫→核准→逐步具現化」的三段式,直接對應本站光球 `orbTaskStateMachine` 目前的體驗缺口**——現況光球任務規劃對使用者是黑盒,Krea 這套「畫布上一個一個節點浮現、使用者全程看得懂 AI 正在做什麼」的視覺回饋,是防止「創作者不知道 AI 在幹嘛而迷路」的具體解法,比純文字進度條更直覺,值得作為 M2 對齊門+光球進度呈現的參考範式。

---

## 4. OpenArt(統一工作區+Smart Shot+Worlds)

**分鏡→逐幕**:**Smart Shot** 功能是「描述一次場景,AI 規劃整段序列(角度/運動/節奏),產出含 3-5 個鏡頭的 10-20 秒多鏡剪輯」,且提供**可編輯的 Shot Plan**——內含分鏡小圖、運鏡設定、鏡頭順序,使用者可以在生成**之前**先調整這份計畫。這與本站「AI 生分鏡計畫→執行前可調整」的既定方向(`planPipeline`)高度同構。來源:[Smart Shot 頁](https://openart.ai/features/smart-shot/)。

**AI 引導**:官方將自己定位成「統一工作區(unified workspace)」——圖/影/角色/音訊工具都在**同一個創作面板**,不需要切頁面或重新上傳,可**跨工具拖放素材**共用同一資產庫;第三方評測形容為「像一個有八大分區的座艙,但沒有東西被藏起來,不用鑽子選單找角色工具」。這是「引導」的一種反直覺解法:**不是靠精靈式步驟,而是靠把所有功能攤平在同一畫面**降低「這功能在哪」的迷路感。來源:[OpenArt Suite](https://openart.ai/home)、[aigearbase 評測](https://aigearbase.com/tool/openart-ai)。

**一致性管理**:**Stories/Characters 系統**維持角色跨畫格/短片段一致性,支援用參考圖自訓客製模型、一鍵故事產生器;搭配 **Worlds**(環境庫),Smart Shot 生成時可同時吃「已存角色」+「Worlds 裡的環境」維持身分與場景視覺延續性——即「角色一致性」與「場景一致性」是兩個獨立庫但生成時共同注入,概念上與本站「世界觀(場景/角色)+ Vault 錨點」同構,但 OpenArt 多了「一鍵故事產生器」把兩者串成敘事的自動化層。來源:[AI Character Generator](https://openart.ai/features/ai-character/)、[Medium 場景一致性實測](https://medium.com/@latouralexandre/my-ai-animators-dream-achieving-scene-consistency-and-continuity-in-animation-with-openart-ai-76b32b2bed87)。

**拼接輸出**:Smart Shot 直接輸出「已拼好的多鏡剪輯」而非分開的片段讓使用者自己接——即**拼接發生在生成階段本身**,不是生成完再手動拼。這是與 LTX(先生成分開鏡頭、後在 Timeline Editor 拼接)不同的路線選擇。

**對本站啟示**:①Smart Shot「一次描述→AI 出可編輯 Shot Plan→執行前可調」與本站 `planPipeline`(規劃但不可執行,見 M1 軌 B)幾乎是同一形狀,可直接對照補齊「執行前調整」這一步的 UI;②「攤平所有工具在同一面板」的策略值得對照本站「生成可從 7 條路徑發起」(D-adoption §2.1 已診斷同一問題)——OpenArt 選擇了統一面板而非統一入口引導,是另一種解法,可與本站規劃中的「Commander 收件匣」比較優劣。

---

## 5. Google Flow(Veo 專屬,Scene Builder)

**分鏡→逐幕**:**Scene Builder** 是 Flow 與多數單鏡 AI 影片工具的分水嶺——讓使用者「編輯並延伸既有鏡頭」(揭露更多動作、或轉場到下一步發生的事,同時保持動作連續與角色一致),本質是**把多個鏡頭縫在一條時間軸上**,而非只生單一片段。介面上可**拖曳把手裁切片段頭尾、拖動重新排序調整節奏**,且有**時間軸「Expand」功能**——預測片段接下來會發生什麼、無縫延伸畫面長度。官方定位:「橋接『生出一支酷炫 GIF』和『真的在剪一個場景』之間的鴻溝」。來源:[Google Flow 官方部落格](https://blog.google/technology/ai/google-flow-veo-ai-filmmaking-tool/)、[UIUXShowcase 拆解](https://uiuxshowcase.com/resources/flow-an-ai-filmmaking-tool/)。

**AI 引導**:官方強調 Flow 是「為創作者實際思考方式設計的 AI 原生電影工作空間——用場景、鏡頭、節拍、想法來想」,並把運鏡控制(角度/運動/鏡頭類型)直接暴露在介面上給結構化控制。但第三方評測也誠實指出**現階段 UX 令人困惑,還沒到「可上場」的成熟度**——是少數本輪調研中「野心對但執行未到位」的反例,值得注意但不宜照抄其現況介面,只抄其設計意圖。來源:[Chase Jarvis 實測](https://chasejarvis.com/blog/what-is-google-flow-my-honest-review-of-their-ai-video-editor/)。

**一致性管理**:Scene Builder 延伸鏡頭時「保持連續動作與一致角色」是模型層能力(Veo),UI 層未見獨立的角色資產庫管理介面(不同於 LTX Elements/Higgsfield Soul ID 的顯式資產庫模式)。

**拼接輸出**:Scene Builder 本身即是拼接介面(時間軸上的多鏡頭);未見獨立的「打包」步驟資訊。

**對本站啟示**:**「Expand 延伸片段」**是本輪唯一直接對應「i2v 級聯」概念的業界 UX 案例——本站 M1 軌 C 的「用首幀呼叫 i2v」若做出使用者介面,可參考 Flow 把它包裝成「延伸這一幕」的按鈕語意,而非單純「重新生成」;「時間軸上拖曳把手裁切/拖動排序」則是逐幕三軌編輯器(軌 D)可以直接沿用的互動慣例。

---

## 6. Google Vids(Workspace 內建,腳本→分鏡→旁白全自動起手)

**分鏡→逐幕**:給一句 prompt + 一份 Drive 文件,Gemini **直接產出含建議場景、腳本、旁白、素材與音樂的完整初稿**——即「起手是一份已經填好的分鏡草稿讓你改」,而非「空白畫布」。旁白可**逐場景個別生成或一次全部生成**。來源:[Google Vids 官方頁](https://workspace.google.com/products/vids/)、[Plan your video with AI](https://support.google.com/docs/answer/15067819?hl=en)。

**AI 引導**:**用括號標記情緒/節奏/音效提示詞**是一個極簡但有效的引導設計——例如 `[Read this like you're excited]: 你的腳本文字`,把「怎麼下 prompt 控制 AI 旁白語氣」這件事降到「打字打括號」的認知負擔,不需要另開一個「語氣選單」介面。來源:[AI 旁白說明](https://support.google.com/docs/answer/15070345?hl=en)。

**一致性管理**:未見角色/風格一致性資產庫(Vids 定位是文件轉簡報式影片,非敘事型角色影片,場景一致性需求本來就低)。

**拼接輸出**:輸出選項清楚分層——**下載 MP4/GIF、匯出到 Drive、或(2026-04 新增)直接發佈到 YouTube**;直發 YouTube 時**預設為 Private**,給使用者機會先補標籤/描述/結尾畫面、確認內容後才手動切到 Public/Unlisted——這是「先安全預設,人工確認才擴大可見度」的具體發佈流程設計。分享 Vids 檔案本身則有 Viewer/Commenter/Editor 三級權限。來源:[Export 直發 YouTube 公告](https://workspaceupdates.googleblog.com/2026/04/export-google-vids-directly-to-youtube.html)、[Share & collaborate](https://support.google.com/a/users/answer/14817958?hl=en)。

**對本站啟示**:①括號式情緒標記可直接抄進 ProStudio 的旁白/配音生成輸入框說明文字,零開發成本、高感知;②「直發社群預設 Private,人工確認才轉 Public」正是本站 `SocialPublish` 從 mock 走向真接線時該採用的安全預設模式,呼應 D-adoption §3.2「社群發佈真接線」路線。

---

## 7. Higgsfield(Character Lock+可複用模板)

**分鏡→逐幕**:官方教學明確描述創作者流程是「**從你的分鏡逐鏡生成**(generate the shots from their storyboard one by one),用細節化 prompt,並確保鎖定角色模型以維持一致性」——即分鏡本身可能來自站外(或站內 storyboard 模板),但**逐鏡生成時強制帶入角色鎖**是它的核心步驟,不是選配。來源:[Scribe 新手教學](https://scribehow.com/page/How_to_Create_AI_Videos_on_Higgsfield_Complete_Beginners_Guide__2xgPGYenR6CzT246xkXqeA)。

**AI 引導**:**模板(Templates)可存成可重複的管線**——廣告變體/角色表/分鏡等任何重複執行的流程,存成模板後**複製、換輸入素材,幾分鐘出新一版**而不必從零建立;這是「引導」的另一種形態:不是逐步教學,而是把「上一次做對的流程」變成下一次的起點,降低「每次都要重新想怎麼設定」的認知負擔。來源:[Chase Jarvis 深度介紹](https://chasejarvis.com/blog/higgsfield-ai-for-creative-professionals-a-deep-dive/)、[freeaitool 指南](https://freeaitool.com/en/image-tools/higgsfield-ai-video-generator-complete-guide/)。

**一致性管理**:**Soul ID** 是顯式的角色身分系統——上傳一張臉、指派一個 Soul 2.0 身分,之後任何專案都可重用;「角色鎖(character locking)」是跨鏡的**開關式**功能,與運鏡(Cinema Studio,鏡頭/景深模擬)、動作控制(可堆疊多個相機運動)並列為三個正交的控制軸。來源:[Higgsfield AI Video 首頁](https://higgsfield.ai/ai-video)、[Segmind 功能整理](https://blog.segmind.com/higgsfield-ai-enhanced-video-creation/)。

**拼接輸出**:本輪檢索未見 Higgsfield 有獨立於生成流程外的「拼接/打包」介面資訊,推測其定位偏「單鏡精緻生成引擎」,拼接留給使用者站外剪輯。

**對本站啟示**:①「模板=複製上次配置換輸入」與本站 `studio_recipes`(生成配方)概念一致,但 Higgsfield 把它明確做成「一鍵複製成新專案」的動作,本站可直接把配方頁加一個「用此配方開新專案」按鈕;②Soul ID 的「上傳一張臉→指派身分→之後任何專案重用」三步驟,是 `consistency_vault` 建立流程可以參考的最簡互動基準(本站現況資料結構更深,但建立流程步驟感是否一樣簡潔,值得對照)。

---

## 8. Kling / 可靈(快手,故事板模式+多鏡頭單次生成)

**分鏡→逐幕**:Kling 3.0 的「多鏡頭模式」提供**故事板介面規劃序列中每個鏡頭**——在單次 3-15 秒生成內定義 2-5 個鏡頭,每個鏡頭可有自己的運鏡角度與構圖,模型自動維持角色與環境跨鏡一致;另有 **Kling-Omni** 可解讀一組相關圖片(無論是同一鏡頭的連續畫格或複雜多鏡序列),智慧補完畫格間的視覺間隙,把靜態故事板轉成動態影片。來源:[SoraVideo Kling 3.0 教程](https://soravideo.art/zh/blog/how-to-use-kling-3)、[騰訊新聞故事板轉影片報導](https://view.inews.qq.com/a/20251204A01UG600)。

**AI 引導**:官方定位「AI 故事板輔助,透過多輪對話自動完成超長影片故事板設計,自動排程跨場景鏡頭邏輯」——即分鏡規劃本身走**對話迭代**形態,與 DirectorAI 現有 CO-STAR 對話出腳本→拆分鏡的路徑高度同構,是本輪調研中與本站架構最像的一家。

**一致性管理**:多模態引擎解析圖片特徵做「跨場景主體元素遷移與組合複用」,**視訊模式支援最多 7 個預設主體**自動達成角色/道具跨鏡一致——「數量上限」是一個值得注意的產品化細節:明確告知創作者「最多可鎖幾個一致性錨點」,而非無上限但體感不穩定。

**拼接輸出**:多鏡頭模式的輸出本身就是「已縫合的單一影片」(拼接內建於生成),與 OpenArt Smart Shot 同一路線(拼接發生在生成時,非生成後)。

**對本站啟示**:①「明確 7 個主體上限」的設計提示——本站 Vault 若无上限承諾但注入效果會隨錨點數量下降,不如仿效明講一個建議上限,管理使用者期待;②多鏡頭單次生成即拼接完成的路線,提示 M1 軌 E 的 compose 服務除了「生成後拼接」也可以考慮「規劃階段就決定分段生成後自動首尾銜接」這種替代技術路徑,列入 spike 選項。

---

## 9. Descript(Underlord 文字驅動剪輯+Scene=Slide)

**分鏡→逐幕**:2025 改版後 Descript 圍繞「Scenes」重新設計——用 `/` 快捷鍵把腳本切成場景,**之後排列視覺元素的方式就像操作投影片編輯器一樣**(場景=一張投影片),可套用「自動版型」處理 B-roll/多機位/標題/字幕。這個「場景即投影片」的心智模型,把本來屬於「影片剪輯」的任務重新框成大多數辦公室工作者已經很熟悉的「做簡報」動作。來源:[The editor interface](https://help.descript.com/hc/en-us/articles/37585546799757-The-editor-interface)、[GoTranscript Scenes/Layouts/Underlord 教學](https://gotranscript.com/public/learn-descript-video-editing-scenes-layouts-underlord)。

**AI 引導**:核心賣點「編輯文字=編輯影片」——刪一個字,對應畫面片段就跟著刪,零學習門檻(「會用 backspace 和複製貼上,就會用 Descript 剪片」)。2025-08 推出的 **Underlord** 是「能動手做事」的代理式共同編輯者(agentic co-editor):打字說想要什麼,Underlord 直接執行——收緊剪輯節奏、去除靜音/贅字、改善音訊、甚至加畫面或字幕,**同時保持創作者的原始創作意圖**(即 AI 動手但不擅自改變創作方向)。來源:[Underlord 產品頁](https://www.descript.com/underlord)、[Underlord beta 說明](https://help.descript.com/hc/en-us/articles/36803785502221-Underlord-beta-Your-AI-co-editor-in-Descript)。

**一致性管理**:Descript 是後製/剪輯工具而非生成工具,無角色一致性資產庫概念,此維度不適用。

**拼接輸出**:文字編輯即時同步影片剪輯結果,匯出走一般影片匯出流程,未見獨立「打包」概念(產品定位本身就是單一成片剪輯,無「多素材集合打包」需求)。

**對本站啟示**:①「Scene=Slide」心智模型值得作為本站逐幕三軌編輯器(軌 D)的框架語言——把「編輯一幕」講成「編輯一張投影片」,對非技術創作者更好懂,比「時間軸軌道」的剪輯行話門檻低;②Underlord「代理動手但保留創作意圖」的敘事,對應本站光球未來若要做「自動潤飾/自動剪輯」功能時的產品定位語言,可作為說明文案參考(降低使用者對「AI 亂改我的東西」的疑慮)。

---

## 10. Adobe Firefly Boards + Premiere Pro(2026-04 NAB 更新)

**分鏡→逐幕**:2026 更新加入「AI 輔助故事板生成,將前期製作時間縮短 30-40%」;創作者可在 **Firefly Boards** 視覺化構思、產生分鏡或 b-roll,再**把圖片/影片直接送進 Premiere 專案,不需要手動下載再匯入**——即「分鏡構思」與「正式剪輯」是兩個獨立產品(Firefly Boards / Premiere),靠專案級直送打通,而非同一個介面內完成。來源:[Adobe 2026-04 NAB 官方公告](https://blog.adobe.com/en/publish/2026/04/15/adobe-extends-leadership-video-unleashing-new-ai-powered-creation-firefly-reinventing-color-editors-in-premiere)、[Daily Camera News 整理](https://www.dailycameranews.com/2026/04/adobe-nab-2026-ai-firefly-premiere-frameio/)。

**AI 引導**:新的 **Firefly AI Assistant** 走「敘述性代理」路線——創作者用自己的話描述想要的結果,Assistant **橫跨 Photoshop/Premiere/Illustrator 等多個 Creative Cloud App 編排多步驟工作流**,不需要創作者自己知道該去哪個 App 按哪個按鈕。來源:[VentureBeat 報導](https://venturebeat.com/technology/adobes-new-firefly-ai-assistant-wants-to-run-photoshop-premiere-illustrator-and-more-from-one-prompt)、[Adobe 官方 Creative Agent 公告](https://news.adobe.com/news/2026/04/adobe-new-creative-agent)。

**一致性管理**:專案可在 Firefly/Premiere/After Effects 之間移動,**保留完整圖層相容性**,相較獨立 AI 影片工具平均節省 47% 專案建置時間——一致性策略是「同一份專案檔案格式跨產品互通」而非「一致性資產庫」,與本站/LTX 的角色錨點路線是不同層次的解法(檔案互通 vs 視覺一致性)。來源:[同上 2026-04 公告]。

**拼接輸出**:**Generative Extend** 讓剪輯師對片段**加影格**以撐住角色反應鏡頭或做更順的轉場——這是「拼接」層面的具體工具(填補剪輯點之間的落差),而非重新生成整段。來源:[Generative Extend 官方說明](https://helpx.adobe.com/premiere/desktop/edit-projects/edit-with-generative-ai/generative-extend-overview.html)。

**對本站啟示**:①「Firefly Boards 構思→一鍵直送 Premiere,不必下載再匯入」的模式,對照本站現況「Studio 生成結果進背景抽屜、需自行去資產庫找」(D-adoption §2.1 已診斷同一斷點)——本站 M1 軌 F(結果歸戶)本質上就是在做同一件事,可用「一鍵直送」作為對外溝通語言;②Generative Extend 的「幫剪輯點兩端補影格讓過場順」概念,可作為 M1 軌 E compose 服務的加分項(而非首版必要):兩段生成素材首尾銜接生硬時,補一段過渡而非要求使用者自己找素材填空。

---

## 11. Flora / Figma Weave(node canvas 兩個標竿,深化 D-adoption §4.5)

**分鏡→逐幕**:Flora 提供「敘事工具」可**從腳本或文字提示自動產生電影感故事板、角色設計、影片序列**;核心心智模型是「每個輸出即節點,可鏈入下一個 prompt」——即上一步生成結果本身變成下一步的輸入節點,不需要離開畫面複製貼上。**Style DNA** 讓團隊從介面內用少量範例訓練輕量客製風格,套用到後續所有節點輸出。來源:[Flora 官方](https://www.florafauna.ai/)、[MOGE 產品介紹](https://moge.ai/product/florafauna-ai)。

**AI 引導**:**Flows 模板**繞過「空白畫布問題」——提供常見用例的預建節點鏈,使用者從模板起步而非從零拉節點;定位為「優先易用與視覺迭代,而非技術複雜度」,鎖定非技術創作者。Figma Weave 這邊的等價設計是**「App Mode」**——把複雜節點工作流**轉換成簡單表單介面**,讓非技術的關係人(stakeholder)只需要填參數、看結果,完全不必看到底層節點圖;Weave 另有**「同一 prompt 同時餵多個模型、輸出並排比較」**的介面,及**可在 Figma Community 分享/複製的 Weave workflow 模板**(可批量套用生成圖片/影片/插畫集)。來源:[Weavy vs Flora](https://www.wireflow.ai/blog/weavy-vs-flora)、[Figma Weave 五個工作流案例](https://www.figma.com/blog/five-figma-weave-workflows/)、[houseofgai 節點工具解析](https://www.houseofgai.com/blog/node-based-ai-tools-weavy-figma-weave)。

**一致性管理**:一致性主要透過 Style DNA(風格)與節點重複接同一參考圖(角色)達成,無獨立於節點圖之外的「角色庫」介面——即一致性資產本身也是畫布上的節點,而非另開的側欄管理頁。

**拼接輸出**:node canvas 的本質輸出是「畫布終端節點的產物」,兩者皆未見獨立於節點圖之外的「打包」介面;Weave 的多模型並排比較則是「決策輔助」而非「拼接」。

**對本站啟示**:**Weave「App Mode:節點圖→簡單表單」是本輪最值得借鏡的單一模式**——本站 `studio_recipes`(配方)概念上已經是「把一組參數存起來重複用」,但目前呈現仍是專業參數面板;若能把配方包裝成「填空即跑」的簡化表單(對應 M0 §3.2「非技術隊友用簡化 UI 跑固定工作流」的既定方向,亦呼應 ComfyDeploy 的同一結論),即是把 node canvas 的團隊治理智慧,用零 node UI 的方式吃下來。

---

## 12. 可借鏡模式表(彙整,12 條)

| # | 模式 | 誰做得好 | 對應本站哪個畫面 | 借鏡難度 |
|---|---|---|---|---|
| 1 | **執行前總覽+統一定基本參數**(長寬比/預估點數),批次確認後才逐鏡生成 | LTX Studio(storyboard 總覽)、OpenArt(Shot Plan 可編輯) | `AnimationStudio` 編排動畫管線 → `planPipeline` 執行前確認步(M1 軌 B) | 低(後端 estimatePoints 已有,缺 UI 步驟) |
| 2 | **`@` 標記呼叫一致性資產**,輸入 prompt 時自然帶出角色/場景,而非另開選單挑選 | LTX Studio Elements | `ShotDetailCanvas`/`DirectorAI` 對話輸入框、`consistency_vault` 注入互動 | 中(需 prompt 輸入元件加自動完成) |
| 3 | **代理「先秀計畫→核准→逐步具現化」**,畫布/畫面上一個一個元素浮現讓使用者看懂 AI 在做什麼 | Krea Node Agent | 光球 `orbTaskStateMachine` 任務進度呈現(M2 對齊門) | 中(UI 呈現邏輯,不需改規劃演算法) |
| 4 | **「Scene = 投影片」心智模型**,逐幕編輯用簡報式語言取代時間軸剪輯行話 | Descript Scenes | 逐幕三軌編輯器(M1 軌 D,取代 `StoryboardTimelinePreview` 唯讀預覽) | 中(UI 框架設計,資料模型已備妥) |
| 5 | **括號式情緒/節奏標記**控制旁白語氣(如 `[興奮]:文字`),免開語氣選單 | Google Vids | ProStudio 配音/TTS 生成輸入框 | 低(純文案+輸入解析) |
| 6 | **對話式構思分鏡→生成→對話迭代**單鏡結果的三段式互動 | Runway Chat Mode | `DirectorAI` CO-STAR 對話鏈補「單鏡追問迭代」子模式 | 低-中(對話流程已在,補迭代分支) |
| 7 | **延伸片段(Expand)包裝成「延伸這一幕」按鈕**,而非單純「重新生成」 | Google Flow Scene Builder | `ShotDetailCanvas` i2v 級聯(M1 軌 C) | 中(需 UI 語意重新包裝+首尾銜接邏輯) |
| 8 | **配方/模板一鍵複製成新專案**(換輸入即可跑) | Higgsfield Templates、ComfyDeploy(D-adoption 已提) | `studio_recipes`「用此配方開新專案」按鈕 | 低(資料結構已有) |
| 9 | **一致性錨點數量上限明講**(如「最多 7 個主體」),管理使用者對一致性穩定度的預期 | Kling 多鏡頭模式 | `consistency_vault` 選取 UI 加建議上限提示 | 低(純文案+前端限制) |
| 10 | **節點圖包裝成「填空即跑」簡單表單**(App Mode),給非技術隊友用固定工作流 | Figma Weave App Mode、Flora Flows 模板 | `studio_recipes` 進化成團隊模板表單(對齊 D-adoption §3.2/M0 中期路線) | 中(需表單生成器+配方參數schema化) |
| 11 | **「構思工具→一鍵直送正式編輯/剪輯專案」**,不必下載再匯入 | Adobe Firefly Boards→Premiere | Studio 生成結果 → 逐幕歸戶(M1 軌 F),取代目前「背景抽屜找結果」 | 中(涉及跨頁面資料流,M1 軌 F 已規劃) |
| 12 | **發佈預設 Private,人工確認才轉 Public/公開** | Google Vids YouTube 直發 | `SocialPublish` 從 mock 走向真接線時的預設安全流程 | 低(產品政策決定,實作視接線對象而定) |

---

## 13. 差異化機會(基於本輪 UX 深挖的新發現,補充 D-adoption §4.10)

D-adoption §4.10 已指出「世界觀+分鏡+一致性錨點+教材 RAG+光球代理五者同一資料模型」是業界無人同時擁有的組合。本輪 UX 細節深挖後,可以把這個機會**具體化到互動層面**:

- **業界的一致性管理與規劃引導是分開的兩件事**:LTX Elements、Higgsfield Soul ID、Kling 多鏡頭上限,都是「事後鎖定」型互動(先建角色資產,生成時手動 @ 呼叫或勾選);Krea Node Agent、OpenArt Smart Shot 的「規劃」則不知道有沒有鎖角色。**沒有一家把「AI 幫你規劃分鏡的同時,自動知道這一幕該用哪個已鎖定的世界觀角色/場景」做成同一步**——本站因為世界觀資料結構(角色/場景/LoRA/語音已互相連結)天生具備這個條件,`planAnimationPipeline` 若能在規劃階段就自動帶入對應 Vault 錨點(而非規劃完再手動勾選),即是業界都還沒做到的「規劃即一致性」體驗,比任何單一「@ 標記」或「Soul ID 開關」都更省一步。
- **業界的「App Mode/模板」與「代理引導」也是兩條分開路線**(Weave App Mode 是靜態表單、Krea Node Agent 是動態規劃),本站光球代理若能**動態生成當前配方的簡化表單**(把 studio_recipes 參數 schema 化後,由代理依對話內容預填表單而非要求使用者手動填),等於同時吃下「非技術友善殼」與「代理引導」兩個業界正在分頭發展的方向。
- 前提仍是 M0 §4 已指出的:先把 §1.2(D-adoption)的協作缺口與 M1 六軌基礎打通到「不扣分」水準,上述差異化才有地基可長。

---

## 14. 查不到/未涵蓋

- **Descript「Storyboard」專屬頁**(`descript.com/storyboard`)僅在搜尋結果列出標題,內容未經 WebFetch 逐字核實,§9 的 Scenes/Underlord 描述來自其他頁面交叉驗證,未涵蓋該頁可能揭露的額外細節。
- **Kling/可靈官方介面截圖**未直接開啟 `klingai.com`/`kling.ai` 逐頁核實(中國大陸服務與國際版介面可能有別),§8 內容全部來自第三方教程與新聞交叉比對,故事板模式的精確 UI 佈局(按鈕位置、面板配置)未經一手驗證。
- **Adobe Premiere Pro 逐格截圖**未核實 Firefly Boards→Premiere 直送的實際互動細節(是拖曳、選單、還是自動同步),官方公告偏敘事性,§10 描述停留在功能存在層級。
- **OpenArt Worlds 的建立流程**(如何定義一個「世界」、與 Character 如何綁定)僅有功能存在的證據,未找到逐步教學頁描述其 UI 互動細節。
- **Runway 是否有內建 storyboard 產品功能**(而非流程建議)本輪檢索結果傾向「沒有」,但未能百分之百排除近期(2026 上半年)是否新增過某個 storyboard 相關 beta 功能,§2 判定基於現有檢索結果,建議下一輪若有新資訊需回頭校正。
- 本文所有第三方評測(gaga.art、topview.ai、uraiguide、chasejarvis、wireflow、freeaitool、theplanettools、aigearbase 等)僅經搜尋摘要交叉比對,延續 D-adoption §6 同等級的核實限制聲明。

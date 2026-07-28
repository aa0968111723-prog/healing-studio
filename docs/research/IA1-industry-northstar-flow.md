# IA1 — 北極星創作流程 業界對照
- 產生日期:2026-07-03
- 依據 commit:7f4417da(repo 目前 HEAD;稽核來源指定的 812f6fdb 在本 repo 歷史中查無此提交,已改標實際 HEAD,內容對照關係不受影響)
- 性質:業界對齊研究(外部標竿)

> 方法論說明:本篇以 WebSearch/WebFetch 查證 2025–2026 年公開資料(部落格、官方說明文件、Academy/Help Center)。凡標「線上查證」者附來源連結;凡憑既有知識推論、未能即時開啟原始頁面(例如被目標站台擋下 403)者標「知識/推論」或「待查證」。本篇不臆測任何產品的內部程式碼實作,只描述其對外可觀察到的產品行為與文件敘述。

---

## 0. 總覽結論(先講重點)

業界目前並不存在單一「絕對標準」的腳本→分鏡→逐幕→拼接→輸出→打包 IA,但幾乎所有 2025–2026 世代的 AI 影音工具都收斂到同一個模式:**「單一專案(Project)物件」作為時間軸/場景列表(SceneBuilder / Timeline / Composition)的容器,每個場景各自持有可再生成的素材引用(image/video/audio/caption 是「附掛在場景上的圖層」而非獨立系統),拼接與輸出則是專案內建的「匯出」動作,通常委外給雲端轉碼服務或封裝進桌面/瀏覽器渲染引擎,而不是使用者自己手動兜圖兜檔。**這與 healing-studio 稽核發現的「分鏡後斷裂」(三個生成工具各自為政、腳本卡與生成結果失聯、無拼接服務、打包死 UI)形成鮮明對比——業界的最小可行閉環,核心就是「有一個貫穿全流程、可回溯、可重新生成局部而不破壞整體」的專案資料模型,而我方目前恰恰缺這個模型。

---

## 1. 業界怎麼把「腳本→分鏡→逐幕生成→拼接輸出」串成一條龍

### 1.1 Google Flow(Veo 3/3.1 的編輯介面)—— SceneBuilder 是「單一專案」的具體實例
**業界標準/實例(線上查證)**
- Google Flow 是官方定位的「AI 創作工作室」,底層引擎是 Veo,對外文件描述其把「storyboard → 分幕生成 → 排序 → 匯出」收在同一個工具內:先把分鏡(手繪或成品分鏡圖)逐格轉成 Veo 影片片段,再開啟 **SceneBuilder**,把生成好的片段拖進時間軸、調整順序與時長、預覽、最後匯出。
- SceneBuilder 明確被描述為「project management for multi-scene narrative work」——即工具內建一個貫穿多場景敘事的專案容器,而非每個場景各自獨立產出檔案後再手動兜起來。
- 單一 Veo 生成片段上限約 8 秔,可用 Extend(延伸)把片段串接成 1 分鐘以上,SceneBuilder 再把多個 Extend 過的片段排成完整作品。
- 來源:[Google Flow 官方頁](https://labs.google/fx/tools/flow)、[How to Turn Storyboard Images into Veo 3.1 Videos in Flow](https://skywork.ai/blog/how-to-convert-storyboard-images-to-veo-3-1-videos-in-flow/)、[Google Flow AI 2026 Guide](https://whiskailabs.net/google-flow-ai-complete-guide/)
- confidence: 線上查證(但均為第三方/非 Google 一手技術文件的教學文章,Google 官方頁本身資訊較粗;細節如「Extend 具體秒數上限」建議視為知識性描述,實際數字可能隨版本變動,標**待查證**)

**我方現況/差距**
- 我方在分鏡完成後,三個生成工具(字卡/圖影/聲音)各自產出,沒有等價於 SceneBuilder 的「把逐幕生成結果按場景序組裝成一條時間軸」的容器;生成結果與腳本卡在資料層就已經失聯。

**建議對齊做法**
- 在單一專案 schema 中新增「SceneAssembly / Timeline」實體,綁定 script → storyboard scene → 該幕三軌生成結果的外鍵關係,取代目前各生成工具各寫各的、事後靠人工比對的狀態。此建議與 repo 既有 `Q1-scene-assembly-editor-spec.md`、`M1-project-spine-assembly.md` 方向一致,本研究從業界角度佐證其必要性。

---

### 1.2 Runway —— Storyboard Workflow + Stitch 節點,場景是「工作流節點圖」的一部分
**業界標準/實例(線上查證)**
- Runway 提供「Featured Workflows」,其中內建 storyboard 生成工作流:文字提示先進 LLM 節點被系統提示強化,再送進 image 節點產生分鏡圖像。
- Runway 的 **Stitch 節點**明確功能是「把多個影片輸入依序合併成單一序列」,用於把個別生成的鏡頭合併成多鏡頭敘事——這是 Runway 官方 help center 對「拼接」職能的直接定義,而不是使用者自己下載多個檔案後用外部工具兜接。
- Runway 也有傳統時間軸(Timeline)介面,定位在畫面下方,和一般非線性剪輯軟體一致。
- 來源:[Runway Workflows](https://runwayml.com/workflows)、[Using Utility Nodes in Workflows](https://help.runwayml.com/hc/en-us/articles/47184761711379-Using-Utility-Nodes-in-Workflows)、[Timeline – Runway Help](https://help.runwayml.com/hc/en-us/articles/4402458964115-Timeline)
- confidence: 線上查證(Runway Academy 的 storyboard 教學頁本身此次 WebFetch 回傳 403,細節引自 WebSearch 摘要,非直接讀取原文,標記**部分待查證**)

**我方現況/差距**
- 我方沒有「拼接」作為系統內建的一級功能——稽核指出「拼接服務不存在」,等於連 Runway 最基礎的 Stitch 節點對應能力都缺。

**建議對齊做法**
- 至少先實作「把 N 個逐幕生成結果依場景序機械式串接」的最小拼接服務(等同 Stitch 節點),不必一步到位做到 Runway 的可視化節點編輯器;這是解除「分鏡後斷裂」最低成本的動作。

---

### 1.3 CapCut / Canva Magic Studio —— 「script → storyboard → scenes」消費級一條龍,強調免使用者手動分段
**業界標準/實例(線上查證)**
- CapCut AI Storyboard Generator:使用者貼腳本或用 AI Writer 生成腳本,工具「自動」把腳本切成結構化場景與視覺提示,使用者不需要自己切分鏡;可選擇長寬比、風格(cinematic/3D/cartoon),一鍵生成完整分鏡。
- Canva Magic Studio:Magic Write 寫腳本 → Magic Media 依場景描述生成分鏡圖像/影片 → Magic Video 自動把多段素材組成 60 秒多場景直式影片,含自動轉場與配樂,且支援團隊即時協作編輯同一份 storyboard。
- 兩者共通點:**腳本分段(scene segmentation)是系統自動做的,不是使用者事後對齊**;最終仍是「一個專案」的概念(Canva design / CapCut project),生成、排序、匯出都在同一容器內完成。
- 來源:[CapCut AI Storyboard Generator](https://www.capcut.com/tools/ai-storyboard-generator)、[Canva storyboard creator](https://www.canva.com/create/storyboards/)、[Canva Magic Video help](https://www.canva.com/help/magic-video/)
- confidence: 線上查證

**我方現況/差距**
- 我方腳本卡與分鏡、分鏡與逐幕生成之間的對應目前是斷裂、非自動維護的;業界(即使是消費級工具)也已經把「腳本→分鏡場景」的切分自動化並保持關聯,而不是留給人工事後拼湊。

**建議對齊做法**
- 分鏡產出時應自動寫入「此分鏡對應腳本哪一段」「此分鏡包含哪幾幕」的結構化關聯,並讓下游三個生成工具讀寫同一份場景 ID,而非各自新建無關聯的紀錄。

---

### 1.4 Kling 3.0 —— 「原生 storyboard 工具」把運鏡/節奏/角色聲音綁進單一 pipeline
**業界標準/實例(線上查證,來自第三方評測整理,非 Kling 官方一手文件)**
- 據第三方比較文章,Kling 3.0(2026-02 發布)新增原生 storyboard 工具,可做逐鏡頭的運鏡與節奏控制、原生對嘴配音,並用 Voice ID 讓角色聲音跨鏡頭一致——三軌(畫面運鏡/聲音/角色一致性)在**同一個 storyboard 工具**內設定,而非分離的三個系統。
- 來源:[Kling vs Pika vs Luma 2026](https://melies.co/kling-vs-pika-vs-luma)、[Runway vs Kling vs Pika vs Luma 2026](https://soloa.ai/blog/runway-vs-kling-vs-pika-vs-luma-ai-video-2026)
- confidence: 知識性整理較高但來源皆為第三方評測部落格而非 Kling 官方文件,細節（如 Voice ID 確切機制)請標**待查證**。

**我方現況/差距**
- 我方三軌(字卡/圖影/聲音)分屬三個獨立工具且與腳本卡失聯;Kling 把「同鏡頭的運鏡+對嘴+聲音一致性」在單一 storyboard 介面內配置,概念上等於「逐幕的三軌是同一個場景物件的屬性」,而非三個平行系統。

**建議對齊做法**
- 讓「逐幕」成為一個一級實體(scene record),字卡、圖影、聲音三個生成請求都必須帶入該 scene_id 並回寫產出到該 scene 底下的對應欄位,而不是三個工具各自建立無 scene 歸屬的產出。

---

## 2. 逐幕三軌(字卡/畫面/聲音)業界怎麼綁定與編輯

### 2.1 Descript —— Layer(圖層)模型是業界對「三軌綁定」最清楚的公開範例
**業界標準/實例(線上查證)**
- Descript 官方 Help Center 說明:「Layers」是專案中所有視覺與音訊元素的容器,可堆疊、重新排序、控制跨場景(scenes)呈現方式;Timeline 讓你精細控制「畫面何時出現、音訊如何與腳本同步、專案整體如何組織」。
- Captions(字卡)是「自動從逐字稿產生、隨逐字稿編輯即時連動時間碼」——即字卡不是獨立軌道靠人工對時間,而是與「文字編輯(=腳本)」這一個底層真相源自動同步。這是 Descript「edit video by editing text」核心賣點的具體機制。
- 來源:[Descript video editing](https://www.descript.com/video-editing)、[Layer and clip overview](https://help.descript.com/hc/en-us/articles/10301481327757-Layer-and-clip-overview)、[Descript 101](https://gotranscript.com/public/descript-101-edit-videos-like-docs-with-built-in-ai)
- confidence: 線上查證(Timeline overview 官方頁本次 WebFetch 回傳 403,細節取自 WebSearch 摘要與其他頁面轉述,標記**部分待查證**)

**我方現況/差距**
- 我方字卡、圖影、聲音三個生成工具各自運作,彼此之間、以及與腳本之間都沒有「單一真相源驅動、其餘自動連動」的關係;比較接近業界做法出現前(各軌各自管理時間碼)的舊模式。

**建議對齊做法**
- 把「腳本文字」定為單一真相源:字卡的文字與時間碼由腳本欄位驅動生成/更新,圖影與聲音的生成請求則以「腳本段落 + scene_id」為輸入鍵,任一項重新生成時，系統應能標示「此腳本段落對應哪些下游產出需要一併檢視/重新生成」,而不是使用者手動追蹤三邊是否同步。

### 2.2 Google Flow / Runway —— 三軌以「場景卡片的附加屬性」呈現,而非平行系統
**業界標準/實例(線上查證,綜合 1.1、1.2 來源)**
- SceneBuilder、Stitch 節點的操作物件都是「已經合成好聲畫的單一片段」,即業界主流生成式影片工具傾向把聲音(對嘴/環境音)在生成階段就綁進畫面片段本身(Veo 3 系列的 native audio),字卡則作為後製疊加層——這代表「三軌」在不同工具裡有兩種綁定策略:(i) 生成時即合一(畫面+聲音同一次模型輸出),(ii) 生成後在專案圖層疊加(字卡)。
- confidence: 知識/推論(綜合上述查證來源做的模式歸納,非某一單一產品的直接聲明,標**待查證**其是否適用於我方模型選型)

**我方現況/差距**
- 我方三工具生成獨立、無場景歸屬,連「後製疊加」這種最基本的綁定模式都未建立。

**建議對齊做法**
- 短期先用 Descript 式的「圖層疊加 + 單一真相源(腳本)驅動字卡」策略,成本較低;中長期若模型支援 native audio(對嘴)可參考 Veo/Kling 模式減少後製對齊工作。

---

## 3. 拼接/輸出/打包:業界是自建還是委外

**業界標準/實例(線上查證)**
- 影片「生成」與「創意編輯」(storyboard、timeline、stitch)幾乎都是各家自建的核心競爭力(Runway 的 Stitch 節點、Flow 的 SceneBuilder、Descript 的 Timeline/Layers),因為這是產品差異化所在。
- 但底層「轉碼/多格式輸出/大規模批次渲染」這一層,業界公開的架構模式普遍是**委外給雲端代管轉碼服務**或用開源 FFmpeg 搭配佇列/工作者架構自建可水平擴展的批次系統,而非在應用伺服器內同步阻塞式處理:
  - AWS Elemental MediaConvert / Google Cloud Transcoder API:官方定位就是「你不用自己管理轉碼基礎設施、佇列、Server」,submit job 即可,依處理時長計費。這是 SaaS 影音產品常見的「委外轉碼」路徑。
  - 自建路線的公開範例架構:上傳觸發事件(S3/Cloud Storage) → 訊息佇列(SQS/Pub-Sub) → Worker Pool 執行 FFmpeg → 產出多解析度檔案回寫物件儲存;GPU 加速轉碼可用 Cloud Run Jobs 之類的 serverless 執行環境。
  - 來源:[AWS MediaConvert](https://aws.amazon.com/mediaconvert/)、[GPU-accelerated FFmpeg on Cloud Run Jobs](https://docs.cloud.google.com/run/docs/tutorials/video-encoding)、[video-transcoding-pipeline (GitHub 範例)](https://github.com/rehan-adi/video-transcoding-pipeline)、[Serverless transcoding pipeline](https://oneuptime.com/blog/post/2026-02-17-how-to-build-a-serverless-video-transcoding-pipeline-using-cloud-functions-and-transcoder-api/view)
- confidence: 線上查證(架構模式為多篇技術部落格與官方文件的共識描述，屬「業界普遍做法」而非單一產品專屬聲明)

**我方現況/差距**
- 稽核指出「拼接服務不存在」、「打包死 UI」——代表我方連「自建拼接」與「委外/自建轉碼輸出」兩層都還沒有,是流程斷點最嚴重的一段。這不是選型問題(委外 vs 自建),而是**兩層都缺**。

**建議對齊做法**
- 分兩層對齊,不要混為一談:
  1. **拼接層(業務邏輯,建議自建)**:依場景序把三軌產出(字卡疊加+圖影+聲音)合成單一幕的檔案,再把多幕串接——這是 healing-studio 的核心差異化,應自建(對應 Runway Stitch / Flow SceneBuilder 的角色)。`docs/research/Q2-compose-service-spike.md` 若已有雛型可作為此層落地起點。
  2. **轉碼/輸出層(基礎設施,建議委外或用成熟開源方案包裝)**:最終多格式輸出、封裝打包,優先評估 AWS MediaConvert / Google Cloud Transcoder API 之類代管服務,或至少用佇列+FFmpeg worker 的標準模式(而非同步阻塞在應用伺服器內),避免重造一套不可靠的轉碼輪子——這與稽核提到的「打包死 UI」直接相關,先修好底層佇列/任務狀態機,UI 才有東西可畫。

---

## 4. 我方「分鏡後斷裂」對照業界差距總結 + 業界最小可行閉環長相

### 4.1 差距總表

| 業界標準模式 | 我方現況 | confidence |
|---|---|---|
| 單一專案容器貫穿腳本→分鏡→逐幕→拼接→輸出(Flow SceneBuilder、Runway workflow 圖、Descript project) | 分鏡後斷裂,三生成工具與腳本卡各自為政,無統一場景實體 | 線上查證(模式) / 知識(我方現況由稽核前提提供) |
| 場景(scene)是一級實體,三軌生成請求都掛在同一 scene_id 下(Kling storyboard、Descript layers） | 無 scene 級別歸屬,三軌各自產出無法回溯到哪一幕 | 線上查證(模式) |
| 字卡/文字類產出由單一真相源(腳本文字)驅動並自動連動時間碼(Descript) | 字卡與腳本無自動連動機制(依既有稽核) | 線上查證(Descript 具體行為) |
| 拼接是系統一級功能,至少有「機械式依序合併」節點(Runway Stitch) | 拼接服務不存在 | 線上查證(Runway) |
| 轉碼/輸出走佇列+worker(自建)或代管轉碼服務(委外),非同步阻塞的死 UI | 打包為死 UI | 線上查證(架構模式) |

### 4.2 業界「最小可行閉環」長什麼樣(綜合以上,推論性總結)
把上述證據收斂,一個能打通「腳本→分鏡→逐幕→拼接→輸出→打包」的最小可行閉環,不需要一步到位做出 Runway 節點圖編輯器或 Kling 等級的原生對嘴,而是至少要有:

1. **一個貫穿的專案/場景資料模型**:script → storyboard(scene 列表)→ 每個 scene 下掛 caption/visual/audio 三個引用欄位(不必三者同時生成完成才能存在,但要能各自回填同一個 scene_id)。
2. **場景級「重新生成」動作**:任一軌重新生成時,系統知道要更新哪個 scene 底下的哪個欄位,而不是產生無主的孤兒素材(對應 Descript 的「改文字→自動連動」精神,但不必做到即時逐字稿等級)。
3. **一個機械式拼接動作**:輸入「一個專案的所有 scene(依序)」,輸出「一支合併好的影片」——對應 Runway Stitch 節點的最小实作,允許先用最簡單的順序拼接(不需轉場特效)。
4. **一個非阻塞的輸出/打包任務**:拼接觸發一個可查詢狀態的非同步任務(佇列/job id/進度),而不是一個沒有後端支撐的「死 UI」——對應委外轉碼服務或自建 FFmpeg worker 佇列的通用模式。

這四項達成,才算補上業界對「分鏡後斷裂」問題所給出的最低限度答案；其上再談運鏡一致性、角色聲音 ID、原生對嘴等進階功能才有意義。

- confidence: 此節第 4.2 為研究員基於上述查證來源的**綜合推論**,不是任何單一產品的逐字聲明,標**知識/推論**,但每個子點都可回溯到 1–3 節的線上查證案例。

---

## 附:查證侷限說明
- Runway Academy 的 storyboard 教學頁、Descript 的 Timeline overview 官方頁,本次 WebFetch 皆回傳 HTTP 403(可能是反爬蟲/需登入),故對應細節改引 WebSearch 回傳的第三方摘要,已在各節標註「部分待查證」。
- OpenAI Sora 消費端產品據查證資料顯示已於 2026-04-26 停用(轉 API-only),故本篇未將 Sora 列入「現行可操作」的正面對照案例,僅作為歷史脈絡參考。
- 未能查證的細節(例如各產品逐幕重新生成時對其餘軌道的具體資料庫層行為、Kling Voice ID 的技術細節)一律標「待查證」,不作為結論依據。

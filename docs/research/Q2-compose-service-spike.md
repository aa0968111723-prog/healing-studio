# Q2 — compose 服務技術 spike(規格設計 wave Q:技術 spike,上網查)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 性質:**技術 spike(上網查證,非診斷、非決策)**——回應 N2 決策卡 2「是否核准先花 1 週做 fal ffmpeg-api 能力 spike」,本文件就是那次 spike 的產出。任務範圍限定在 M1 軌 E 認定的「唯一真正淨新建大件」:compose 服務(多幕 frames + audioClips → 一支影片)。
- 方法:實讀 repo 既有程式碼確認現況邊界,再用 WebSearch 查證外部 API 能力(WebFetch/curl 對 fal.ai 網域在本次會話全程回傳 403,只有 GitHub / gist / n8n 社群等網域可直接 fetch;fal.ai 相關資訊改以 WebSearch 摘要取得,細節保真度標於各節)。
- 讀者:決定 compose 服務技術路線的技術決策者(對應 N2 卡 2 需要 Bruce 拍板的第 1 點)。

---

## 0. 先確認現況邊界(實讀程式碼,非重述既有研究)

| 查證項 | 檔案/位置 | 結論 |
|---|---|---|
| videoCompiler/audioCompiler 是否為媒體合成引擎 | `server/services/videoCompiler.ts`(情感→運鏡 CameraVector/Frame Anchoring 翻譯器)、`server/services/audioCompiler.ts`(Tag Stacking→Suno/Udio 提示詞編譯器) | **不是**。兩者輸出都是文字 prompt(`VideoCompilerInput`→運鏡描述字串、`AudioCompilerInput`→`[Verse]`/`[Chorus]` 結構化歌詞提示詞),供 fal/Suno **生成前**組 prompt 用,與「把多段媒體檔案接成一支影片」無關。M1/N2 的勘誤成立。 |
| proStudio.mergeAudios 走哪條路 | `server/routers/proStudio.ts:1332-1356` | 呼叫 `falQueueSubmit("fal-ai/ffmpeg-api/merge-audios", { audio_urls, merge_strategy: "concatenate"\|"mix" })`,已接 `chargeForFalTask`/`refundUserPoints` 扣點與失敗退款。**這是 fal 代管 ffmpeg 服務,不是自架二進位**——證實 fal 平台上確實有 ffmpeg-as-a-service 端點家族,現況只接了「多音軌合併」一個 case。 |
| repo 內是否有 ffmpeg 二進位 | `Dockerfile`(runner 階段只 `apk add mariadb-client mariadb-connector-c`,無 ffmpeg)、全文 grep `ffmpeg` 只命中 fal 端點字串 | **沒有**。目前 Railway 容器完全無法執行本機 ffmpeg 轉檔。 |
| R2/S3 上傳鏈是否就緒 | `server/storage.ts:5-32,85-90`(S3 v4 簽名 PUT/DELETE,支援 R2/S3/MinIO/B2)、`server/routers/videoProject.ts:22-25,440-553`(`isR2Configured`/`presignGetDownload`/`requestExport`/`getExportUrl`) | **就緒**。任何 compose 路線產出的檔案都能走同一套「上傳→presign→寫 `outputStoragePath`/`outputSignedUrl`/`outputExpiresAt` 快取欄(schema.ts:4622-4625)」骨架,不需重建物件儲存整合。 |
| background_jobs 是否能無痛加 `jobType="compose"` | `drizzle/schema.ts:291-300` | **N2 決策卡 2 的假設需要修正**:`jobType` 是 `mysqlEnum("jobType", ["image","video","audio","voice","zip_export","multimodal","model_training","teaching_archive_ingestion"])`,**是資料庫層級列舉,不是自由字串**。新增 `"compose"` 分支需要一次 schema migration(alter enum),不是「零 migration 沿用既有 shape」——這比 N2 原文暗示的成本略高,但仍是輕量、非破壞性的 migration(單純擴充列舉值)。三條 compose 技術路線都共用同一個 migration,不因選哪條路線而改變。 |

---

## 1. 路線一:fal ffmpeg-api 家族(委外,已有一角在用)

查詢日期:2026-07-03。資料來源受限說明:fal.ai 網域本身在本次會話對 WebFetch/curl 直接連線一律 403(疑似對非瀏覽器 UA 的防護或此環境代理策略),以下內容全部來自 WebSearch 回傳的頁面摘要/快照,**未能直接讀到完整 OpenAPI JSON schema 原文**,細節(尤其是 `compose` 端點 `tracks[].type` 的完整列舉值)有一定不確定性,已在下方標註。

### 已確認存在的端點(來自 fal.ai 官方頁面標題與摘要,經多次搜尋交叉確認)

| 端點 | 用途 | 計價(查到的數字) | 備註 |
|---|---|---|---|
| `fal-ai/ffmpeg-api/merge-audios` | 多音軌合併,`merge_strategy: concatenate\|mix` | 約 $0.00017/compute-second | **repo 現況已在用**(`proStudio.ts:1332`) |
| `fal-ai/ffmpeg-api/merge-videos` | 合併 2 支以上影片 | 搜尋結果顯示定價欄位疑似佔位/未穩定顯示,未查到可信數字 | 未接入 repo |
| `fal-ai/ffmpeg-api/merge-audio-video` | 影片與音訊(或影片內音訊)合併 | 約 $0.0002/秒 | 未接入 repo |
| `fal-ai/ffmpeg-api/compose` | **從多個媒體來源組合影片**,輸入 `tracks`(track 物件陣列,含 `id`/`type`/`keyframes[].url`),輸出 `video_url`+`thumbnail_url` | 約 $0.0002/秒 | 最接近本任務需求的通用端點,但 `type` 完整列舉值(是否含 `text`/字卡疊圖)**未能從搜尋摘要直接確認**,見下方待查證 |
| `fal-ai/ffmpeg-api/waveform` | 取音訊波形資料 | 未查到明確定價 | 可能用於編輯器預覽,非本次核心需求 |
| `fal-ai/ffmpeg-api/metadata` | 取影音檔編碼中繼資料 | 未查到明確定價 | 可用於 compose 前驗證素材格式 |
| `fal-ai/ffmpeg-api/loudnorm` | 響度正規化 | 未查到明確定價 | 音軌品質處理,非核心需求 |
| `fal-ai/ffmpeg-api/extract-frame` | 從影片擷取單張影格 | 未查到明確定價 | 可用於「未輸出前產生縮圖」 |

### 對本任務(多圖+音軌→一支影片,含簡易字卡疊圖)的初步判斷

- `compose` 端點的 `tracks` 陣列結構(`{id, type, keyframes: [{url}]}`)**形狀上支援多軌道、每軌多個 keyframe URL**,理論上可承載「一軌畫面(image/video 交錯)+ 一軌音訊」的簡易拼接需求;是否原生支援「文字/字卡疊圖」(即 track type 是否有 `text`/`caption` 這個列舉值,或字卡需要另外用 `drawtext` 風格參數)**是本次 spike 唯一沒有查證到的關鍵缺口**——多次 WebSearch 都只得到 track 結構的骨架範例,沒有查到 `type` 列舉的完整清單或 `text` track 的參數規格。
- 若 `compose` 不支援文字疊圖,退路是「先用 compose 做純畫面+音軌拼接,字卡改用生成時 Studio 端把字卡烘進圖片(image compositing),或呼叫 `extract-frame`/自己在應用層疊字後再丟給 compose」——但這已經超出本次 spike 查證範圍,需要實際呼叫 API(需要 `FAL_KEY`)才能確認,建議列為「第一個里程碑」裡的驗證項而非現在就下結論。

### 架構契合度

- 呼叫模式與現有 `proStudio.mergeAudios` 完全同構:`falQueueSubmit(modelId, input)` → 非同步 queue → 輪詢 `request_id`。`videoComposer.ts` 若走這條路線,**可以直接複製 `mergeAudios` 的扣點/退款/輪詢寫法**,零新增執行環境(不需要 `child_process`、不吃 Railway 容器 CPU)。
- 對 R2 的接法:fal 端點吃的是「素材的 URL」,不是檔案上傳——只要 frames/audioClips 的 URL 是 R2 上可公開讀取(或 presigned GET)的連結,直接傳給 fal 即可,不需要額外整合。

Sources:
- [Ffmpeg Api | Video to Video | fal.ai (merge-videos)](https://fal.ai/models/fal-ai/ffmpeg-api/merge-videos/api)
- [Ffmpeg Api Merge Audio-Video | Video to Video | fal.ai](https://fal.ai/models/fal-ai/ffmpeg-api/merge-audio-video/api)
- [FFmpeg API Compose Video to Video API Docs | fal](https://fal.ai/models/fal-ai/ffmpeg-api/compose/api)
- [FFmpeg API Compose (Video to Video) API on fal](https://fal.ai/models/fal-ai/ffmpeg-api/compose)
- [FFmpeg API [Merge Audios] | Audio to Audio | fal.ai](https://fal.ai/models/fal-ai/ffmpeg-api/merge-audios)
- [FFmpeg API Waveform | JSON | fal.ai](https://fal.ai/models/fal-ai/ffmpeg-api/waveform)
- [FFmpeg API Metadata | JSON | fal.ai](https://fal.ai/models/fal-ai/ffmpeg-api/metadata)
- [Ffmpeg Api | JSON | fal.ai (loudnorm)](https://fal.ai/models/fal-ai/ffmpeg-api/loudnorm/api)
- [Ffmpeg Api | Image to Image | fal.ai (extract-frame)](https://fal.ai/models/fal-ai/ffmpeg-api/extract-frame/api)
- [Endpoint to merge audio, video and subtitles in fal ai - n8n Community](https://community.n8n.io/t/endpoint-to-merge-audio-video-and-subtitles-in-fal-ai/188008)
- [AI Video APIs for Developers - fal.ai](https://fal.ai/video)

---

## 2. 路線二:委外 compose API(Shotstack / Creatomate / Json2Video)

查詢日期:2026-07-03。

### Shotstack

- **能力**:官方定位為「用 JSON 描述整條時間軸(timeline),送到 Edit API 算繪」——`tracks`+`clips`+`assets`,支援 transitions、filters、overlays、text(title 類型 asset,如官方 `overlay-transition.json` 範例:`asset.type:"title"`、`style`、`position`、`start`/`length`、`transition.in/out`),素材採「bring-your-own-assets」(直接吃你自己的 URL,不需先上傳到 Shotstack)。字卡/文字疊圖是**原生一等公民**(title asset 類型),優於 fal compose 目前查證到的不確定性。
- **計價**:Pay-As-You-Go $0.30/分鐘(credits 一年有效);訂閱制 $39/月起 $0.20/分鐘(月結餘額可滾存至 3 倍);高量方案 5 萬分鐘/年以上另談。新用戶 10 credits(30 天內有效)。以「分鐘」計價,不分解析度。
- **與 R2 接法**:輸入直接吃 URL(素材可來自任何可公開存取的儲存,含 R2 presigned URL),輸出是 Shotstack 產的下載連結,需要應用層再把成品搬回 R2(或直接讓 `requestExport` 存 Shotstack 給的連結,但這樣快取欄位的「本站控管」語意會打折)。

### Creatomate

- **能力**:提供 `RenderScript`(JSON-based 格式)描述整支影片,支援「用模板+`modifications` 參數注入動態資料」或直接送完整 RenderScript 從零構建;輸出 MP4/GIF/PNG。走「模板優先」的產品定位(適合固定版型批量產影片),對本任務「每個專案分鏡幕數/時長都不同」的自由拼接需求,契合度不如 Shotstack/Json2Video 的「自由時間軸」定位那麼直接,但 RenderScript 本身仍可以不透過模板、直接寫任意軌道結構。
- **計價**:查到的參考數字約 $54/月起、約 143 分鐘(720p);TTS 等加值功能另計 credits。未查到 pay-as-you-go 選項的明確頁面(可能存在但本次搜尋未命中)。
- **與 R2 接法**:同樣是 URL-in / URL-out 模式。

### Json2Video

- **能力**:JSON 規格 → REST 端點 → 算繪,明確支援「TTS 配音、字幕(subtitles)、轉場、匯入自有素材」,官方文件寫明「可直接提供你自己 CDN/儲存的素材連結,不需要先下載再上傳」——與 R2 接法最直接。字幕/文字疊圖同樣是原生功能。
- **計價**:Credits 制,依解析度計費——Full HD(1920×1080 或 1080×1920)1 credit/秒,4K 4 credits/秒。免費方案含全部 API 功能,最高 600 秒總算繪額度、單支影片上限 60 秒。
- **與 R2 接法**:官方文件內容最明確支援「自帶儲存」,三家裡對本任務(R2 為底)接法阻力最低。

### 共同特徵(三家一致)

- 都是「送 JSON 時間軸描述 → 非同步算繪 → 拿到結果 URL」的模式,與現有 `background_jobs`/`submitStudioJob` 輪詢骨架相容,不需要改動追蹤 UI。
- 都需要**新的外部供應商 API key**(不像 fal 已經是現有整合方,是全新記帳/合約關係),對應 N2 卡 2 已指出需要走 `externalServicesRouter` 記�004模式,且新增付費依賴需要 Bruce/財務核准(超出工程範圍)。
- 三家対字卡疊圖(text/title/subtitle)都是**原生一等公民**功能,這點優於目前查證到的 fal `compose`(未確認是否支援文字軌)。

Sources:
- [Shotstack - Pricing](https://shotstack.io/pricing/)
- [Shotstack v1 API Reference Documentation](https://shotstack.io/docs/api/)
- [Shotstack Edit - Video Editing API](https://shotstack.io/product/video-editing-api/)
- [json-examples/examples/overlay-transition.json — shotstack/json-examples (GitHub)](https://github.com/shotstack/json-examples/blob/main/examples/overlay-transition.json)
- [Shotstack Pricing & Free Tier 2026 — json2video.com 對照](https://json2video.com/how-to/shotstack-alternative/)
- [Creatomate — API for Automated Video Generation](https://creatomate.com/)
- [The JSON structure of RenderScript - Creatomate](https://creatomate.com/docs/api/render-script/json-structure)
- [Create a video by template - Creatomate](https://creatomate.com/docs/api/quick-start/create-a-video-by-template)
- [Creatomate Pricing & Alternative 2026 — json2video.com 對照](https://json2video.com/how-to/creatomate-alternative/)
- [Pricing - Video Editing API - JSON2Video](https://json2video.com/pricing/)
- [Credits & limits - JSON2VIDEO Documentation](https://json2video.com/docs/v2/pricing)
- [API Specification - JSON2Video.com](https://json2video.com/docs/api/)

---

## 3. 路線三:自建 ffmpeg(Railway 容器內裝二進位)

查詢日期:2026-07-03。

### repo 現況(實讀,非網路查證)

- `Dockerfile` runner 階段目前只有 `apk add mariadb-client mariadb-connector-c`(給 mysqldump 用),要加 ffmpeg 只需再加一行 `apk add ffmpeg`(Alpine 套件,體積增量通常在數十 MB 級,遠大於現有 mariadb-client 的 +3~4MB,但仍是可控的映像檔增量,非本次查證重點)。
- `videoComposer.ts` 需要用 `child_process.spawn` 組 concat demuxer(多影格/影片 concat)+ `amix`/`amerge` filter(音軌疊加)+ `drawtext`(字卡疊圖)的 filter graph,技術上成熟(ffmpeg 這三種操作都是標準能力,無第三方 API 功能上限問題)。

### 外部查證(Railway 資源模型)

- WebSearch 未查到 Railway 各方案(Hobby/Pro/Team)明確的 CPU 核數/記憶體上限對照表——Railway 官方文件把「資源上限」描述為「升級方案會提高單一 replica 可用的資源上限,應用只用到需要的量,直到碰到上限」,屬於彈性配額模式而非固定核數宣告,**這與 N2 決策卡 2 已指出的「未查證項」一致,本次 spike 同樣沒有查到具體數字,需要 Bruce 或維運方直接查 Railway dashboard 帳單頁**。
- 查到的旁證:ffmpeg 轉檔是 CPU-bound 工作,記憶體超過所需門檻後對速度影響很小(社群討論提到 1GB→4GB 記憶體只帶來 0.5~1% 速度差異),真正的瓶頸是 CPU 核數與並發任務數——這代表 Railway 方案的 CPU 核數(而非記憶體)才是決定「能撐多少併發轉檔」的關鍵未知數。
- 沒有查到 Railway 官方文件明確支援「background worker 與 web API 分離成不同 service/replica」的具體操作指南片段,但 Railway 產品線本身支援「同專案內多個 service」,理論上 compose 轉檔可以獨立成一個 service 而非與主 API 搶同一個容器的資源(此為架構常識推論,非本次查到的 Railway 專屬文件佐證,建議在正式排入開發前另外查證 Railway 是否方便做這種拆分)。

### 對本任務判斷

- 品質/功能上限最高(ffmpeg 濾鏡鏈可做任何「簡易拼接」要求的操作:順序 concat、音軌 amix、`drawtext`/`overlay` 字卡),不受第三方 API 功能集限制。
- 主要風險是**維運面**(佇列限流、與主 API 容器搶資源、Railway 方案 CPU 核數未知),不是技術可行性問題。

Sources:
- [Troubleshooting Slow Deployments and Applications | Railway Docs](https://docs.railway.com/deployments/troubleshooting/slow-deployments)
- [Railway — using serverless (station.railway.com 討論)](https://station.railway.com/questions/using-serverless-e3666dfe)
- [ffmpeg CPU usage - VideoHelp Forum](https://forum.videohelp.com/threads/339896-ffmpeg-CPU-usage)

---

## 4. 路線四:前端 WebCodecs

查詢日期:2026-07-03。

### 瀏覽器支援現況(2026-07 查證)

- **Safari(含 iOS/iPadOS,即行動端關鍵瀏覽器)**:Safari 26.0 起才有完整 WebCodecs 支援(含 `AudioEncoder`)。Safari 16.4–18.7 只有「部分實作」——僅 `VideoDecoder`/`VideoEncoder`/`EncodedVideoChunk`/`VideoFrame`,**沒有音訊、沒有 image 類別**。這代表在 Safari 26 全面普及前,**行動端(iOS Safari)做「圖+音軌合成一支影片」這個需求會直接卡在音訊編碼能力缺失**,不是體驗差,是功能不存在。
- **Firefox**:130+ 才在**桌面**啟用,**Android 版 Firefox 目前 `VideoDecoder` 仍是 `undefined`**——行動端 Firefox 需要完全的 fallback 路徑(等同不支援)。
- **Chrome/Edge/Opera/Samsung Internet**:支援較早較完整(Chrome/Edge 94+、Opera 80+、Samsung Internet 17+)。

### 對本任務判斷

- 「多圖+音軌→一支影片」這個里程碑的最小需求本身就包含「音訊編碼」,而音訊編碼正是 Safari 舊版本缺失的那塊——**在使用者裝置涵蓋率不確定(尤其創作者是否大量用 iPhone/iPad)的前提下,WebCodecs 路線現階段有明確的裝置相容性缺口**,不是單純「效能較差」的取捨。
- 架構面：repo 內零基礎(`package.json` 無 `@ffmpeg/ffmpeg`/WebCodecs 封裝套件),且與現有「送出→`background_jobs`→輪詢→presign 下載」的一致模式完全不同調(使用者要保持分頁開啟等轉檔完成),無法重用 `AgentProgressPanel` 等既有追蹤 UI。
- 結論與 N2 卡 2 一致:此路線目前不建議排入近期路線,若日後行動端瀏覽器普及率提升(Safari 26 全面鋪開後)可重新評估,作為「輕量本地預覽/免佇列」的補充路線,而非唯一或首選 compose 路徑。

Sources:
- [WebCodecs API - Web APIs | MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- [WebCodecs: Browser Support, Features, Use Cases | TestMu AI](https://www.testmuai.com/learning-hub/webcodecs-browser-support/)
- [WebCodecs API Browser Compatibility On Safari](https://www.testmuai.com/web-technologies/webcodecs-safari/)
- [WebCodecs API | Can I use...](https://caniuse.com/webcodecs)

---

## 5. 四路線比較表

| 面向 | ① fal ffmpeg-api | ② 委外 compose API(Shotstack/Creatomate/Json2Video) | ③ 自建 ffmpeg(Railway) | ④ 前端 WebCodecs |
|---|---|---|---|---|
| **能力(多圖/多影片依時間軸排列)** | `compose` 端點結構上支援(tracks+keyframes),細節未完全查證 | 三家皆原生支援(時間軸/track/clip 模型是核心產品) | 完全支援(ffmpeg concat demuxer 成熟技術) | 技術上可行但需自寫合成邏輯,無現成高階 API |
| **音軌疊加** | `merge-audios`/`merge-audio-video` 已驗證存在;`compose` 是否整合音軌未完全確認 | 三家皆原生支援 | 完全支援(`amix`/`amerge`) | 可行,但 Safari 舊版無 `AudioEncoder`(見路線四) |
| **字卡/文字疊圖** | **未查證到明確支援**(`compose` 的 `text` track 類型未確認) | **原生一等公民**(Shotstack title asset、Json2Video subtitles、Creatomate text element) | 完全支援(`drawtext`/`overlay` filter) | 需自行疊 canvas 再編碼,工程量大 |
| **品質上限** | 依 fal 供應商實作,細節未知 | 依供應商產品線,通常足夠「簡易拼接」但非 ffmpeg 濾鏡等級客製 | 最高(不受第三方功能集限制) | 依瀏覽器 codec 支援,理論可達高品質但工程投入大 |
| **成本/計價模式** | 依秒/compute-second 計費,約 $0.00017~0.0002/秒,與現有 fal 帳務框架一致 | Shotstack 分鐘計費($0.20~0.30/分);Json2Video 依解析度秒計(1~4 credit/秒);Creatomate 訂閱制($54/月起) | 無按次計費,但吃 Railway 容器資源(間接成本,方案未知) | 使用者裝置算力,對本站零直接金錢成本 |
| **維護面** | 低——沿用 `falQueueSubmit` 既有模式,零新技術棧 | 中——新供應商 API key/合約/SLA,需走 `externalServicesRouter` | 中-高——需要維護 filter graph、佇列限流、容器資源監控 | 高——全新前端合成邏輯,長期獨立於後端任務系統 |
| **與現有 R2 接法** | 直接吃 URL,天然相容 | 直接吃 URL(Json2Video 官方文件最明確支援「自帶儲存」),輸出需搬回 R2 | 完全自控,產出直接走既有 R2 上傳鏈 | 前端合成後仍需上傳回 R2,上傳邏輯需另寫 |
| **與 background_jobs 接法** | 天然相容(非同步 queue 輪詢,同 `mergeAudios` 模式) | 天然相容(送出→輪詢→拿結果 URL) | 完全相容,但需要新增佇列限流機制避免搶主 API 資源 | **不相容**——需要分頁開啟等待,無法用既有輪詢 UI |
| **jobType 遷移成本(本次新發現)** | 三條路線共通:`jobType` 是 mysqlEnum,新增 `"compose"` 都需要一次 schema migration(輕量、非破壞性) | 同左 | 同左 | 不適用(不走 background_jobs) |
| **上手難度(1-5,5 最難)** | 2(複製既有 `mergeAudios` 模式) | 3(需學新供應商 JSON 格式+新增 API key 管理) | 3(需要 ffmpeg filter graph 知識+佇列限流設計) | 5(全新技術棧+裝置相容性研究) |
| **新增外部依賴/合約** | 無(fal 已是現有整合方) | 有(需 Bruce/財務核准新供應商月費) | 無(僅 apk 套件) | 無 |
| **主要未查證缺口** | `compose` 是否支援文字疊圖軌;實際呼叫需要 `FAL_KEY` 才能驗證 | 三家皆需實測是否能一次 API 呼叫涵蓋「任意 frame 數+音軌+字卡」 | Railway 方案 CPU 核數/並發轉檔上限(帳務事實,repo 外) | Safari 26 實際市佔率、行動端普及時程 |

---

## 6. 推薦路線與理由

**建議路線:① fal ffmpeg-api 家族為主,若 `compose` 端點證實不支援文字疊圖軌,則退回「① 做畫面+音軌拼接 + ③ 自建 ffmpeg 只做 `drawtext` 字卡疊圖這一小段」的混合路線;不建議 ② 委外專職 SaaS 作為首選,④ WebCodecs 不建議排入近期路線。**

理由:
1. **邊際成本最低**:`proStudio.mergeAudios` 已經證明 fal ffmpeg-api 家族與現有扣點/退款/輪詢架構完全同構,`videoComposer.ts` 可以直接複製這個模式,零新增外部供應商合約、零新增執行環境,對應 N2 卡 2 已指出的「與現有『呼叫外部生成模型』架構一致」判斷,本次 spike 用 WebSearch 驗證了該端點家族確實存在且持續在擴充(compose/waveform/metadata/loudnorm/extract-frame 都是本次新確認的端點,不只已知的 merge-audios)。
2. **唯一真正的缺口(文字疊圖)有低成本備援**:即使 `compose` 端點證實不支援字卡軌,備援方案不是整個放棄委外路線,而是「音軌+畫面拼接繼續走 fal,字卡疊圖這一小段單獨用 Railway 容器裝 ffmpeg 跑一次 `drawtext`(或在既有 Studio 生成階段就把字卡烘進圖片,完全不需要合成期疊字)」——這比一開始就整套自建 ffmpeg 的維運負擔小很多,且與 M1 §D4「字卡先用輕量欄位,不做通用字幕系統」的既有克制精神一致。
3. **委外專職 SaaS(路線二)品質/功能不是問題,是新增合約成本問題**:Shotstack/Json2Video 在字卡/字幕上其實比目前查到的 fal compose 更成熟,但代價是全新供應商 API key、月費、SLA——這是需要 Bruce 財務/業務核准的決策(N2 卡 2 已明講),不是工程能單方面選的最低阻力路徑;若 spike 驗證 fal `compose` 真的不夠用,再考慮升級到路線二作為 fallback,而非一開始就跳過現有整合方去簽新供應商。
4. **WebCodecs(路線四)現階段有結構性裝置缺口**:本次查證確認 Safari(iOS/iPadOS)完整支援要等到 Safari 26,Android Firefox 完全不支援——這不是「近期效能較差」而是「部分使用者裝置上功能不存在」,與 M1「一步步建構到成品」不該讓創作者遇到裝置相關的隨機失敗的精神衝突,維持 N2 已有的「排除在近期候選外」判斷。

---

## 7. 第一個里程碑(最小 compose:多圖+音軌→一支影片)

**範圍**:創作者對一個已有 2-3 個核准 frame(`imageUrl`,依 `atSec` 排序)與 1 段 audioClip(`kind=music` 或 `voiceover`)的 storyboard,按下「輸出成片」,拿到一支「圖片依序播放(每張固定秒數或依 `atSec` 差值)+ 疊一軌音訊」的 MP4,**不含字卡疊圖**(留到下一個里程碑,視 spike 對 `compose` 文字軌的驗證結果決定走 fal 內建或另接 `drawtext`)。

**具體交付(檔案級)**:
1. `server/services/videoComposer.ts`(新檔):輸入 = 已排序 frames(image URL 陣列)+ 一段 audioClip URL + 每張圖片顯示秒數;呼叫 `fal-ai/ffmpeg-api/compose`(或若驗證後發現該端點不吃靜態圖片轉影格,退而用 `merge-videos` 前置一個「圖轉短片」步驟,如既有 i2v procedure 或 fal 的 image-to-video 靜態轉場端點)產生 `video_url`。
2. `drizzle/schema.ts`:`backgroundJobs.jobType` enum 新增 `"compose"` 值(**本次 spike 新發現的必要 migration**,N2 原文未點出此需求,需一併排入卡的成本估算)。
3. `server/routers/videoProject.ts`:`requestExport` 前段加一段「若輸入是 storyboardId 而非已存在 asset id,先呼叫 `videoComposer` 產生成品,再走原有 presign+快取寫入邏輯」(M1 §E4 已定義的介面形狀)。
4. **實測驗證項(本次 spike 未能單靠 WebSearch 確認,需要實際呼叫 API)**:
   - `fal-ai/ffmpeg-api/compose` 的 `tracks[].type` 是否吃靜態圖片 URL(image)、是否需要先轉成短片才能塞進 track;
   - 該端點是否支援每個 keyframe 指定顯示時長(對應 `atSec` 排序需求);
   - 呼叫一次實際 compose 請求(需要 `FAL_KEY`),確認回傳的 `video_url`/`thumbnail_url` 格式與現有 R2 上傳鏈銜接是否需要額外轉換。
5. 測試:比照 `server/video-compiler.test.ts`/`audio-compiler.test.ts` 的既有測試慣例,新增 `videoComposer` 端到端 mock 測試(mock `falQueueSubmit`),避免重蹈「假測試測不到真執行器」的覆轍(G3/I 已警示的既有教訓)。

**不在第一個里程碑範圍**:字卡疊圖、轉場特效、多音軌混音、任意時長長片(先驗證短分鏡的可行性再談長片限流)。

---

## 8. 查不到的 / 待查證項(誠實列出)

1. **fal.ai 官方 API 文件全文無法直接 fetch**:本次會話 WebFetch/curl 對 `fal.ai` 網域全程回傳 403(GitHub/n8n 社群等網域可正常 fetch,判斷是該網域特定的存取限制而非本環境全面失效),所有 fal 端點細節均來自 WebSearch 摘要,**未能取得 `fal-ai/ffmpeg-api/compose` 的完整 OpenAPI schema 原文**。
2. **`compose` 端點 `tracks[].type` 的完整列舉值**(是否有 `text`/`caption` 類型、字卡疊圖的確切參數格式)——多次搜尋只查到 `{id, type, keyframes:[{url}]}` 的骨架範例,未查到列舉值全貌。
3. **`fal-ai/ffmpeg-api/merge-videos` 的確切計價**——搜尋結果顯示疑似佔位/未穩定的 "$0/compute-second" 字樣,無法確認是否真的免費或只是頁面快取問題。
4. **Railway 目前方案的實際 CPU 核數、記憶體上限、是否支援 service 拆分做獨立轉檔 worker**——這是帳務/主控台事實,不在 repo 內、也不在公開網路文件內,需要 Bruce 或維運方直接查 Railway dashboard(與 N2 卡 2 已指出的缺口一致,本次 spike 未能補上)。
5. **Creatomate 是否有 pay-as-you-go(非訂閱制)方案**——本次搜尋只查到訂閱制報價,未查到明確的按次計費選項頁面。
6. **三家委外 SaaS(Shotstack/Creatomate/Json2Video)是否接受 R2 的 presigned GET URL(有效期限制的簽名連結)作為輸入素材,而非永久公開 URL**——官方文件泛稱「自帶儲存/自有 CDN」,但未查到明確測試過「短效期簽名 URL」是否會在算繪佇列排隊等待期間過期的說明。

---

## 9. 附:本次 spike 對既有研究文件的一處修正

N2 決策卡 2 原文影響面段落隱含「`background_jobs.jobType="compose"` 可沿用既有 shape,不需要新 migration」的印象(可比對現有 `mergeAudios` 沿用 fal 呼叫模式的低成本敘事)。**本次實讀 `drizzle/schema.ts:291-300` 證實 `jobType` 是 `mysqlEnum` 而非自由字串**,三條路線(①②③)只要走 `background_jobs` 追蹤,都需要一次「擴充 enum 列舉值」的 schema migration——成本仍然很低(非破壞性、單純加值),但這是本次 spike 補上的一個小修正,建議排入實際開發卡的 acceptance criteria。

# H2 欄位字典（上）：ImageStudio × VideoStudio

> 產生日期：2026-07-03 ｜ 補充 wave H
> commit：7918160f90b85a0ff724641cafadcc260f8878d5（HEAD 實測；任務單標示 aef4214178ed 與現況 HEAD 不符，本文以 HEAD 為準）
> 來源：client/src/pages/ImageStudio.tsx（5354 行）、VideoStudio.tsx（5408 行）對照 server/routers/imageStudio.ts（1514 行）、videoStudio.ts（1779 行）
> 前情：02-fullstack §2.3（每模型一支 mutation → falQueueRun 回 request_id → 前端輪詢）、01-features §1.7-1.8（模型清單行號，不重列）

標記約定：`⚰` 死欄位（前端有 UI/state 但後端不收或送出即被丟）、`👻` 隱藏能力（後端 zod 有、前端無 UI）、`≠` 預設值前後端不一致、`(共)` 引用共用欄位。

---

## 1. ImageStudio（/video/image）

### 1.1 共用欄位（宣告一次，各模型引用）

| ID | 欄位（UI label） | 控制項 | 前端 state | 預設 | 範圍/選項 | 備註 |
|---|---|---|---|---|---|---|
| C-P | 提示詞 * | Textarea（PromptBuilder :1541） | `prompt` | "" | max 4000（後端） | 送出前併入氛圍關鍵字＋worldCtx.injectIntoPrompt 前綴（:3376-3385） |
| C-VIBE | 氛圍風格 | 多選 pill×8（VibeSelector） | `vibeIds` | [] | cinematic/dreamy/minimal/dark/anime/photo/watercolor/vintage | 無獨立 tRPC 參數，關鍵字串接進 prompt |
| C-AR | 畫面比例 | 按鈕格×8 | `aspectRatio` | "1:1" | 1:1/16:9/9:16/4:3/3:4/3:2/2:3/auto | ≠ 後端 nanoBanana2/Pro zod default "auto"（前端必送故後端 default 不生效）；seedream/imagen 後端 normalizeAspectRatio 收斂到 7/5 種 |
| C-NUM | 生成數量 | 按鈕 1/2/4 | `numImages` | 1 | UI 只有 1/2/4；zod min1 max4（**3 選不到**） | 僅 t2i 與 sd 分頁出 UI |
| C-NEG | 負向提示詞 | Textarea | `negPrompt` | "" | 自由文字 | t2i（supportsNeg 模型）與 sd 分頁共用同一 state；後端一律 mergeNegativePrompt 附加品質保護詞（imageStudio.ts:362） |
| C-SEED | 種子碼（Seed） | Input（整數）＋骰子/沿用/清空鈕 | `seed`（字串） | "" | 隨機鈕 0~2^31-1 | supported=MODELS_WITH_SEED（僅 seedream×3/flux×2/seedVR）；其餘顯示「不支援」並 disabled |
| C-REF | 原始圖片（待編輯） | RefImageInput（URL input＋上傳 S3＋拖放，≤16MB） | `refImageUrl` | "" | image/* | edit 分頁必填（前端擋） |
| C-XREF | 額外參考圖 / 多圖參考 | 動態 Input 列表＋新增鈕 | `extraRefUrls` | [] | t2i ≤14、edit ≤13 | supportsMultiRef 模型才顯示 |

### 1.2 文生圖 4 模型（分頁 t2i）

| 模型（mutation） | 欄位 | 對應 tRPC 參數 | fal payload key | 備註 |
|---|---|---|---|---|
| nanoBanana2 | C-P / C-AR / C-NUM / C-XREF | prompt / aspect_ratio / num_images / image_urls | 同名直通 | C-SEED 顯示為不支援（後端 zod 也無 seed）✅一致 |
| nanoBananaPro | 同上 | 同上 | 同名 | 同上 |
| seedreamV4 | C-P / C-AR / C-NUM / C-NEG / C-SEED | prompt / aspect_ratio / negative_prompt / num_images / seed | aspect_ratio 經 normalizeAspectRatio(7種) | zod seed z.int |
| imagen4 | C-P / C-AR / C-NUM / C-NEG | prompt / aspect_ratio / num_images / negative_prompt | normalizeAspectRatio(5種) | 後端無 seed，C-SEED 正確 disabled |

### 1.3 圖片編輯 9 模型（分頁 edit）

分頁級欄位：C-REF（必）、C-XREF（supportsMultiRef）、C-P、C-VIBE、C-SEED；條件欄位如下。

| 欄位（UI label） | 控制項 | state | 預設 | 範圍 | tRPC 參數 | fal key | 顯示條件 |
|---|---|---|---|---|---|---|---|
| 遮罩圖片（Mask） | Input URL | `maskUrl` | "" | — | mask_url | mask_url | 僅 gptImage15Edit（supportsMask） |
| 輸出尺寸 | Select | `outputSize` | "auto" | auto/1024x1024/1536x1024/1024x1536 | size | size | 僅 gptImage15Edit（supportsSize）；預設一致 |
| 編輯強度 | Slider | `strength` | 0.8 | UI 0.1–1 step .05；zod 0–1 default .8 | strength | strength | seedreamV45Edit / seedreamV5LiteEdit |
| 引導強度 | Slider | `guidance` | 3.5 | 1–30 step .5（=zod） | guidance_scale | guidance_scale | 僅 fluxKontext |
| 推理步數 | Slider | `inferSteps` | 28 | UI 10–50；zod 1–50 default 28 | num_inference_steps | num_inference_steps | 僅 fluxKontext |

每模型送出組（handleGenerate :3445-3574）：

| 模型 | 實送參數 | 落差 |
|---|---|---|
| nanoBananaProEdit | prompt / image_url / image_urls | 👻 zod 另收 aspect_ratio(default auto)、num_images(1-4) 無 UI |
| nanoBananaEdit | prompt / image_url / image_urls | zod 僅此三欄，一致 |
| nanoBanana2Edit | prompt / image_url / image_urls / **aspect_ratio 硬編碼 "auto"**（:3486） | 👻 zod 收 15 種 aspect_ratio、resolution(0.5K/1K/2K/4K，4K 付費 gate :834-841)、num_images——UI 全未暴露（01-features 已標半成品）；resolution 未送→後端 default "1K" |
| seedreamV45Edit | prompt / image_url / strength / seed | 👻 negative_prompt、num_images 有 zod 無 UI 送出（C-NEG 在 edit 分頁不顯示） |
| seedreamV5LiteEdit | 同上 | 同上 |
| grokEdit | prompt / image_url | zod 僅此二欄，一致 |
| gptImage15Edit | prompt / image_url / size / mask_url | 一致 |
| fluxKontext | prompt / image_url / guidance_scale / num_inference_steps / seed | 👻 output_format(jpeg/png，default jpeg) 無 UI；**seed 用 truthy 判斷 `...(seedNum && {...})`（:3557）→ seed=0 被丟棄** |
| flux2ProEdit | prompt / image_url / image_urls / seed | 👻 image_size(7 選項 default auto) 無 UI；**zod image_urls max(2) 但共用 C-XREF 允許加到 13 張 → 加 3 張以上直接 zod 400**；seed=0 同 truthy bug（:3572） |

### 1.4 放大 / 骨骼 / SD 系列 / 3D（分頁 upscale・pose・sd・3d）

**seedVRUpscale（upscale 分頁，UpscalePanel :1939）**

| 欄位 | 控制項 | state | 預設 | 範圍 | tRPC | fal key | 備註 |
|---|---|---|---|---|---|---|---|
| 原始圖片 | RefImageInput | `upscaleImageUrl` | "" | — | image_url | image_url | 必填（前端擋） |
| 放大模式 | 按鈕×2 | `upscaleMode` | "factor" | factor/target | upscale_mode | upscale_mode | 一致 |
| 放大倍數 | Slider | `upscaleFactor` | 2 | UI 1–4 step1（**×1/×3 可選**，卡片文案只說 ×2/×4）；zod 1–4 | upscale_factor | upscale_factor | factor 模式顯示；**兩模式參數都全送**（:3581-3587），由 upscale_mode 決定生效 |
| 目標解析度 | 按鈕×4 | `targetRes` | "1080p" | 720p/1080p/1440p/2160p | target_resolution | target_resolution | target 模式顯示 |
| 種子碼 | C-SEED(共) | `seed` | "" | — | seed | seed | supported=true |
| — | — | — | — | — | 👻 noise_scale(0–1 default .1)、output_format(png/jpg/webp default jpg) | | 後端有、無 UI |

**dwPose（pose 分頁，PosePanel :2036）**：人物圖片（RefImageInput，`poseImageUrl`→image_url，必填）＋偵測模式（按鈕×7，`drawMode` 預設 "body-pose" = zod default ✅）→ draw_mode。無落差。

**SD 系列 3 模型（sd 分頁，SDPanel :2088）**

| 欄位 | 控制項 | state | 預設 | 範圍 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| 圖片尺寸 | 按鈕×6 | `sdImageSize` | "landscape_4_3" | square_hd/square/portrait_4_3/portrait_16_9/landscape_4_3/landscape_16_9 | image_size | ≠ fastSdxl、sdLora zod default "square_hd"（前端必送 landscape_4_3，後端 default 架空）；stableDiffusion35 default 相同 ✅ |
| 負向提示詞 | Textarea | `negPrompt`(共) | "" | — | negative_prompt | 三模型皆送；後端再 merge 預設負詞 |
| 引導強度 | Slider（進階） | `sdGuidance` | 3.5 | 1–20 step .5 | guidance_scale | **只有 stableDiffusion35 實際送出**；sdLora 也顯示此滑桿但 payload 不含（:3637-3644）→ ⚰ 對 sdLora 是死控制項；fastSdxl 隱藏 ✅ |
| 推理步數 | Slider（進階） | `sdInferSteps` | 28 | UI 10–50 | num_inference_steps | 同上：僅 SD35 送出；**fastSdxl/sdLora 顯示滑桿但不送** ⚰（後端 zod 也無此欄） |
| 種子碼 | C-SEED 樣式 | `sdSeed`（獨立 state） | "" | 整數 | seed | 三模型皆送（`sdSeed && parseInt`→seed="0" 被 truthy 丟棄） |
| LoRA 選擇器 | Select（訓練模型清單，loraTrainer.trainingHistory） | — | "__manual__" | ready 且 image 型 LoRA | — | 選擇後回填 loraPath＋觸發詞注入 prompt |
| LoRA 路徑 | Input | `loraPath` | "" | HF 路徑或 URL | SD35/fastSdxl→lora_path；sdLora→loras:[{path,scale}] | 後端組 loras[] |
| LoRA 強度 | Slider | `loraScale` | 1.0 | 0–2 step .1 | lora_scale / loras[].scale | loraPath 非空才顯示 |
| ControlNet 控制圖片 | Input URL | `controlnetImageUrl` | "" | — | controlnet_image_url | 僅 stableDiffusion35 區塊 |
| ControlNet 模式 | Select×5 | `controlnetPath` | canny-sdxl-1.0 | canny/depth/openpose/zoe/qrcode | controlnet_path | 有控制圖才顯示；後端組 controlnet{path,control_image_url,conditioning_scale} |
| 控制強度 | Slider | `controlnetScale` | 1.0 | 0–2 step .1 | controlnet_scale | 同上 |
| 生成數量 | C-NUM(共) | `numImages` | 1 | 1/2/4 | num_images | 三模型皆送 |
| — | — | — | — | — | 👻 sdLora 的 model_name（default SDXL base）、SD35 的 output_format | 無 UI |

**圖轉 3D 5 模型（3d 分頁，ThreeDPanel :2401）**：共用「來源圖片」（RefImageInput，`imageUrl3d`；rodin3d 標選填）。

| 模型 | 欄位（UI label→state→tRPC） | 落差 |
|---|---|---|
| trellis2 | 解析度（按鈕 512/1024/1536，`trellisResolution`=1024→resolution）；紋理尺寸（按鈕 1024/2048/4096，`trellisTextureSize`=2048→texture_size） | 👻 remesh(default true)、seed、ss_guidance_strength(7.5)、shape_slat_guidance_strength(7.5) 全靠 zod default，無 UI |
| sam3dObjects | 偵測目標描述（Input，`samPrompt`="object"→prompt，預設一致 ✅）；export_textured_glb 前端硬編碼 true | 👻 detection_threshold(0.1–1)、seed 無 UI |
| hunyuan3d | 啟用 PBR（Switch，`enablePbr`=true→enable_pbr ✅）；生成類型（按鈕 Normal/LowPoly/Geometry→generate_type ✅）；面數 face_count（原生 range 40000–1500000 step10000，`hunyuanFaceCount`=500000 ✅）；多邊形類型（三角/四邊→polygon_type ✅）；背/左/右視角圖（RefImageInput×3→back/left/right_image_url） | 全欄位對齊，無隱藏能力 ✅ |
| rodin3d | 文字描述（Textarea，`prompt3d`→prompt）；參考圖（`imageUrl3d`→image_urls:[url]，zod max 8 但 UI 只給 1 張 👻）；材質（PBR/Shaded→material ✅）；品質（Select high/medium/low/extra-low，=medium ✅）；幾何格式（Select glb/usdz/fbx/obj/stl ✅）；條件模式（concat/fuse，=concat ✅）；Hyper 加速（Switch=false→use_hyper ✅） | 👻 seed 無 UI |
| hunyuanWorld | labels_fg1（Input="foreground objects" ✅）；labels_fg2（="background elements" ✅）；classes（="general scene" ✅）；匯出 Draco（Switch=false→export_drc ✅） | 全對齊（預設值前後端逐字相同） |

### 1.5 ImageStudio 小結

- **欄位總數**：共用 8 ＋ t2i 0 專屬 ＋ edit 5 條件欄 ＋ upscale 4 ＋ pose 2 ＋ sd 12 ＋ 3d 21 ≈ **52 個獨立表單控制項**（同一 state 跨分頁重用者計一次），驅動 23 支 mutation。
- **死欄位（⚰）**：① sd 分頁「引導強度/推理步數」滑桿對 fastSdxl（步數）與 sdLora（兩者）顯示但不送、後端 zod 也不收；② `addToHistory`/`recordGenResult` 同步回存段（:3771-3827）因 isAsyncResult 永真為死碼（01-features §1.7 已標）；③ seed=0 在 fluxKontext/flux2ProEdit/SD 系列被 truthy 判斷丟棄（功能性死值）。
- **隱藏能力（👻，後端 zod 有、無 UI）**：nanoBananaProEdit 的 aspect_ratio/num_images；nanoBanana2Edit 的 15 種比例＋resolution 0.5K–4K（含 4K 付費 gate）；seedream 編輯×2 的 negative_prompt/num_images；fluxKontext output_format；flux2ProEdit image_size；seedVR noise_scale/output_format；trellis2 remesh/seed/雙 guidance；sam3d detection_threshold/seed；rodin3d seed＋image_urls 可 8 張；sdLora model_name。合計 **約 20 個 zod 欄位未出 UI**。
- **預設值不一致（≠）**：aspectRatio 前端 "1:1" vs nanoBanana2/Pro zod default "auto"；sdImageSize 前端 "landscape_4_3" vs fastSdxl/sdLora zod "square_hd"（皆因前端必送而使後端 default 架空）。
- **驗證缺口**：flux2ProEdit 共用 13 張額外參考圖 UI，但 zod `image_urls.max(2)` → 超過即 400。

---

## 2. VideoStudio（/video/video）

### 2.1 共用機制

| ID | 欄位 | 控制項 | state | 預設 | 備註 |
|---|---|---|---|---|---|
| V-P | 提詞 * | Textarea（每模型各自 state） | `xxPrompt` | "" | 送出前 injectWorld() 注入世界觀前綴 |
| V-MEDIA | 圖片/影片 URL | MediaInput（URL＋上傳 S3 ≤50MB＋拖放＋預覽） | `xxImage`/`xxVideo` | "" | required 由前端擋 |
| V-SPEC | 輸出規格（AIDV-255） | OutputSpecSelector：解析度 720p/1080p/4K、幀率 24/30/60、編碼 h264/h265/vp9 | `t2vOutputSpec` | {1080p,30,h264} | 僅 t2v 分頁有選擇器；等於預設→送 undefined（後端零行為變化路徑）；4K 非付費前端先降 1080p（outputSpecForGeneration），後端再守門；codec 僅專案標註不影響輸出 |

分頁卡片數 vs 標頭徽章：`MODEL_COUNT = {t2v:6, i2v:5, v2v:3, enhance:3, control:4}`（:4510）→ 標頭顯示「共 21 個模型」，**實際卡片 7+6+3+3+4=23**（Veo3 Pro、Kling Pro i2v 未計入）。

### 2.2 文生影 7 模型（t2v 分頁）

| 模型（mutation） | UI 欄位（label→state→tRPC 參數→fal key） | 落差（👻/≠/⚰） |
|---|---|---|
| klingTextToVideo | 提詞(`klingPrompt`→prompt)；負面提詞(Input `klingNeg`→negativePrompt→negative_prompt)；時長(Select 5/10s `klingDuration`="5"→duration ✅)；寬高比(Select 16:9/9:16/1:1 `klingAspect`="16:9"→aspectRatio→aspect_ratio ✅)；創意強度 CFG(Slider 0–1 step.05 `klingCfg`=0.5→cfgScale→cfg_scale ✅)；V-SPEC→outputSpec | 👻 motionIntensity(0–1→motion_intensity) 無 UI |
| wanTextToVideo | 提詞/負面提詞；解析度(Select 720p/480p `wanRes`="720p"→resolution ✅)；幀數(Slider 16–81 step5 `wanFrames`=81→numFrames→num_frames ✅)；V-SPEC | 👻 aspectRatio(default 16:9)、enableSafety(default false，經 resolveFalSafetyChecker)、seed 無 UI |
| minimaxTextToVideo | 提詞；AI 提詞優化(Switch `mmOptimize`=true→promptOptimizer→prompt_optimizer ✅)；V-SPEC | 👻 duration(6/10 default 6)、resolution(768p/1080p default 1080p)、aspectRatio 全無 UI——**t2v 版 MiniMax 只有 2 個控制項，i2v 版反而全有** |
| veo3TextToVideo | 提詞(`veoPrompt`)；寬高比(Select 16:9/9:16 `veoAspect` ✅)；生成配音(Switch `veoAudio`=true→generateAudio→generate_audio ✅)；V-SPEC | 👻 negativePrompt、enhancePrompt(default true)、seed 無 UI |
| veo3ProTextToVideo | **與 Veo3 共用 veoPrompt/veoAspect/veoAudio 三個 state**（:855-857 註解），僅結果分開；不送 outputSpec | 後端 zod 本來就無 outputSpec ✅；👻 同 Veo3（neg/enhance/seed） |
| ltxTextToVideo | 提詞(`ltxPrompt`)；負面提詞(Input `ltxNeg`) — **僅 2 欄** | 👻 numFrames(25–257 def 125)、fps(8–30 def 25)、height(256–720 def 480)、width(256–1280 def 848)、guidanceScale(1–5 def 3)、seed、expandPrompt(def true)、numInferenceSteps(4–50) 共 8 欄全靠 default |
| soraTextToVideo | 提詞；時長(Slider 5–20s `soraDuration`=10 ✅)；解析度(Select 480/720/1080p ="720p" ✅)；寬高比(Select 3 選 ="16:9" ✅) | 全欄對齊；上游停用→catalog 自動替代 veo3（withSubstitutionMeta 回 degraded） |

另：費用預估列（brain.pricingSummary，durationSec=klingDuration）與 PromptVaultAdoption（ENABLE_PROMPT_VAULT 預設 OFF → 整塊隱藏）。

### 2.3 圖生影 6 模型（i2v 分頁）

| 模型 | UI 欄位 | 落差 |
|---|---|---|
| klingImageToVideo | 提詞(`klingPrompt`)；起始圖片 URL *(MediaInput `klingImage`→imageUrl→image_url)；結束圖片 URL(選填 `klingTail`→tailImageUrl→tail_image_url)；時長(5/10s ✅) | 👻 negativePrompt、aspectRatio(def 16:9)、cfgScale(def 0.5，前端不送→後端 default 進 payload)、motionIntensity、seed 無 UI |
| klingProImageToVideo | **無自有輸入欄**：共用 Standard 的 prompt/image/tail/duration，卡片只有說明＋按鈕（:2143-2183） | 隱藏能力同 Standard |
| wanImageToVideo | 提詞；圖片 URL *；負向提詞(Textarea `wanNeg`)；解析度(720/480p ✅)；幀數(Slider 16–81 step1 `wanFrames`=81 ✅，附秒數換算) | 👻 seed |
| runwayImageToVideo | 提詞；圖片 URL *；時長(5/10 → 後端 parseInt 成 number)；寬高比(Select `runwayRatio`="1280:720"→ratio ✅) | ⚠ UI 只列 4 個 ratio，zod enum 有 6（缺 832:1104、1584:672）👻；👻 seed |
| pixverseImageToVideo | 提詞；圖片 URL *；負向提詞；時長(5/8s ✅)；畫質(Select 360/540/720/1080p ="720p" ✅)；畫面比例(3 選 ✅)；風格(Select 寫實(_none)/anime/3d_animation/clay/comic/cyberpunk，空字串不送 ✅) | 👻 motionMode(normal/fast def normal)、seed |
| minimaxImageToVideo | 提詞；圖片 URL *；時長(6/10s ="6" ✅)；解析度(1080p/768p ="1080p" ✅)；AI 提詞優化(Switch=true ✅) | 全欄對齊（後端本無 seed）✅ |

### 2.4 影生影（v2v 分頁，3 卡＝2 支 v2v ＋ 1 支 LTX 關鍵幀）

| 模型 | UI 欄位 | 落差 |
|---|---|---|
| wanVideoToVideo | 新風格提詞；原始影片 URL *(`wanVideo`→videoUrl→video_url)；負向提詞；重繪強度(Slider 0.1–1 step.05 `wanStrength`=0.7→strength ✅) | 👻 seed |
| klingVideoToVideo | 重繪提詞；原始影片 URL *；負向提詞；CFG 強度(Slider 0–1 `klingCfg`=0.5→cfgScale ✅) | 👻 seed |
| ltxImageToVideo（放在 v2v 分頁） | 動態描述；關鍵幀圖片 URL *(`ltxImage`→imageUrl)；負面提詞；幀數(Slider 25–257 `ltxFrames`=125 ✅ 附 @25fps 換算)；CFG 強度(Slider 1–5 step.1 `ltxGuidance`=3→guidanceScale ✅)；fal 提詞補強(Switch `ltxExpand`=true→expandPrompt ✅) | 👻 fps(8–30 def 25)、seed |

### 2.5 後處理 3 工具（enhance 分頁）

| 模型 | UI 欄位 | 落差 |
|---|---|---|
| videoUpscale | 原始影片 URL *(`upVideo`)；放大倍率(Select 2x/4x `upFactor`="2"→upscaleFactor ✅) | 全對齊；上游停用→替代 wan v2v（後端把倍率翻譯成 enhance prompt＋strength 0.35） |
| frameInterpolation | 影片 URL *；補幀倍率(Select 2x/4x ="2"→multiplier ✅)；目標幀率(Slider 24–120 step6 `rifeFps`=60→outputFps ✅) | 全對齊；替代 wan v2v(strength 0.25) |
| topazEnhance | 影片 URL *；AI 模型(Select iris/artemis/theia/gaia/nyx ="iris"→model ✅)；輸出倍率(Slider 1–4 `topazScale`=2→outputScale ✅) | 全對齊；替代 wan v2v（model 翻譯成 prompt 預設集） |

### 2.6 特殊工具 4（control 分頁）

| 模型 | UI 欄位 | 落差 |
|---|---|---|
| camMaster | 場景描述 *；參考圖片 URL *(`camImage`)；鏡頭運動(Select 17 種 `camMotion`="push_in"→cameraMotion ✅ default 相同)；時長(Slider 3–10s `camDuration`=5→duration ✅) | 👻 aspectRatio(16:9/9:16/1:1 def 16:9) 無 UI；上游停用→替代 kling pro i2v（運鏡轉自然語言接進 prompt） |
| animateDiff | 提詞 *；負面提詞；控制影片 URL *(`adVideo`)；ControlNet 類型(Select openpose/canny/depth/none ="openpose" ✅)；引導強度(Slider 1–20 step.5 `adGuide`=7.5→guidanceScale ✅) | 👻 controlnetScale(0–2 def 1.0)、numSteps(10–50 def 25)、seed 無 UI |
| depthCrafter | **僅 1 欄**：原始影片 URL *(`dcVideo`→videoUrl) | 👻 numDenoising(1–25 def 25)、guidance(1–20 def 1.0)、windowSize(4–110 def 110)、overlap(1–25 def 25)、maxRes(256–2048 def 1024) 共 5 個進階參數全無 UI；上游停用→替代 animatediff depth ControlNet |
| viduReferenceToVideo | 場景提詞 *；參考圖片 1–3(MediaInput 動態列表 `viduImages`=["",""]，第 1 張必填，zod min1 max3 ✅)；時長(4/8s ="4" ✅)；畫面比例(3 選 ✅)；解析度(720p/1080p ="720p" ✅) | 全對齊 ✅ |

### 2.7 運鏡編譯器（SmartPromptDialog :4073 → videoStudio.compilePrompt）

| 欄位（UI label） | 控制項 | state | 預設 | 範圍 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|
| 主體（可空） | Input | `subject` | "" | — | blocks[category=subject] | 空則不加 block |
| 環境（可空） | Input | `environment` | "" | — | blocks[category=environment] | |
| 情緒 | Select×14 | `mood` | "serenity" | COMPILE_MOODS | blocks[mood]＋moodKeywords:[mood] | 雙路送出 |
| 運鏡 | Select（listCameraModes 動態） | `cameraMode` | ""（依情緒自動） | 後端相機清單 | forceCameraMode | ⚠ zod enum 只列 15 種；若 listCameraModes 回傳 enum 外的模式 id，送出即 zod 400（前端型別斷言只寫 3 種是斷言不設限） |
| 畫面比例 | Select×4 | `aspect` | "16:9" | 16:9/9:16/1:1/4:3 | aspectRatio | ✅ |
| 時長 | Slider 3–20s | `duration` | 5 | =zod 3–20 | targetDurationSec | ✅ |
| 風格（選填） | Input | `styleTag` | "" | max 80 | blocks[style]＋styleOverride | 雙路送出 |
| 慢動作 | Switch | `slow` | false | — | slowMotion | ✅ |
| — | — | — | — | — | 👻 freePrompt(max2500)、firstFrameUrl/lastFrameUrl、firstFrameDesc/lastFrameDesc(max500) | 後端 zod 有、對話框無 UI |

結果套用：`onApply` → agentBus.dispatch fillPrompt → **廣播寫入當前分頁所有模型的 prompt state**（非單一模型）。

### 2.8 VideoStudio 小結

- **欄位總數**：t2v 20（含 V-SPEC 3 子控制）＋ i2v 24 ＋ v2v 14 ＋ enhance 8 ＋ control 15 ＋ 編譯器 8 ≈ **89 個表單控制項**，驅動 22 支生成 mutation ＋ compilePrompt。
- **死欄位（⚰）**：本頁幾乎沒有「送了後端不收」的欄位（各 mutation payload 均是 zod 子集）；死象限主要是**顯示層**：MODEL_COUNT 徽章少算 2 個模型（t2v 標 6 實 7、i2v 標 5 實 6，標頭「共 21 個」實 23）；Kling Pro i2v／Veo3 Pro 卡片零自有輸入欄（借用 Standard state）。
- **隱藏能力（👻）**：合計 **約 35 個 zod 欄位無 UI**——最重災區：LTX t2v（8 欄）、depthCrafter（5 欄）、Kling i2v（5 欄：neg/aspect/cfg/motion/seed）、MiniMax t2v（duration/resolution/aspect）、animateDiff（controlnetScale/numSteps/seed）；幾乎每支 mutation 的 `seed` 都有 zod 無 UI（**整頁沒有任何影片 seed 輸入框**，與 ImageStudio 的 SeedInput 形成落差）；Runway ratio 少列 2 個 enum 值；compilePrompt 的 freePrompt/首尾幀 4 欄。
- **預設值一致性**：抽查 22 組（duration/resolution/cfg/strength/frames/fps/scale/model…）前後端全部一致，唯 V-SPEC 靠「等於預設就不送」策略維持零行為變化；outputSpec 只接到 kling/wan/minimax/veo3 四支 t2v（LTX/Sora/Veo3Pro 後端 zod 無此欄，前端也正確未送）。
- **可用性接線缺口**：三張 Wan 卡片的 `modelId` prop 用舊 id（fal-ai/wan-ai/wan2.1-t2v-720p、…-i2v-720p、…-v2v-480p），與 modelAvailability 回傳鍵（fal-ai/wan-t2v、fal-ai/wan-i2v、fal-ai/wan/v2.1/video-to-video）**查表不中**→ Wan 系列即使上游停用也不會顯示灰化/替代徽章（ToolCard :504 查 ctx 恆 null）。

---

## 3. 兩頁對照速覽

| 面向 | ImageStudio | VideoStudio |
|---|---|---|
| 表單架構 | 單一 handleGenerate 巨型 if-else（:3367-3890），共用 state 跨 23 模型 | 每模型獨立 state＋runXxx，5 個 Tab 元件互不共享（Pro 卡借用例外） |
| Seed | 有專用 SeedInput（支援度標示/骰子/沿用），6 模型可用 | 後端 14 處收 seed，前端 0 個輸入框 |
| 隱藏能力規模 | ~20 欄 | ~35 欄 |
| 死控制項 | SD 分頁 guidance/steps 對 fastSdxl/sdLora；同步回存死碼 | 模型數徽章失真；Wan 卡可用性查表失效 |
| 共用預設風險 | aspectRatio "1:1" 蓋掉後端 "auto" | V-SPEC「等於預設不送」避開同類問題 |

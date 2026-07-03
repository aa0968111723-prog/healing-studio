# L1 — 地毯掃描（ProStudio／Studio／AnimationStudio／VideoCockpit 逐欄）

> 產生日期：2026-07-03 ｜ 任務單標示 commit `4d137bdb907d67e6708ca360a66e89de0a6f2c2e`；本次實掃 HEAD=`fc860b45a50de5ff…`（兩者 client/server 相關檔案位元相同，僅文件層新增，未見落差）｜「地毯掃描 wave L」
> 範圍：ProStudio 7 分頁全欄＋Studio 四模態表單＋AnimationStudio 角色/場景/風格/配樂編輯器＋VideoCockpit 確認門/生成設定/抽屜表單。本檔為先前中斷的 **H3 補完＋擴大**（H3 原定 ProStudio/Studio/AnimationStudio/VideoCockpit 四塊，本檔即其重寫版本）。
> 方法：`server/routers/proStudio.ts`（2227 行全讀）＋`client/src/pages/ProStudio.tsx`（4948 行全讀，7 個 Tab 元件逐一讀完）；`server/routers/generate.ts` submitMultimodalAsync zod（:1561-2100 全讀）對照 `client/src/pages/Studio.tsx` 提交段（:1554-1690）＋`client/src/components/workspaces/{Image,Video,Audio,Voice}Workspace.tsx`（全讀）＋`stores/workspaceStore.ts`（全讀）；AnimationStudio 沿用 G2 §1 的逐欄實讀結果（`shared/worldbuilding-types.ts` 全型別）並補充控制項/驗證範圍；VideoCockpit 沿用 G1 全篇並補讀 `VideoProjectCreateDialog.tsx`／`OutputSpecSelector.tsx`／`GuidedJourney.tsx`／`AssetGenCanvas.tsx`／`CreationFlowBar.tsx`(:1-100) 表單細節。
> 標記約定同 H2：`⚰` 死欄位（UI 有但不送/送了無效果）、`👻` 隱藏能力（後端收、前端無 UI）、`≠` 前後端預設不一致。

---

## 1. ProStudio（/video/pro，7 分頁）

### 1.1 音樂生成（MusicTab）

| 欄位（UI label） | 控制項 | state | 預設 | 範圍/選項 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|
| 選擇模型 | 按鈕格×6（4 fal＋2 Suno） | `musicModel` | "ace-step" | ace-step/sonauto/stable-audio/musicgen/suno-v3.5/suno-v4 | model／走 Suno 走 modelVersion | fal 四模型送 `textToMusic`；Suno 送獨立 `generateMusicSuno` |
| 音樂描述 * | Textarea | `prompt` | "" | zod min1 max2000（textToMusic）／max4000（Suno） | prompt | |
| 風格標籤 | MusicTagPicker | `tags` | "" | 自由文字 | tags（逗號轉陣列）／Suno `style` | |
| 參考音訊 | FileUploadInput | `referenceAudioUrl` | "" | audio/* | referenceAudioUrl→audio_url | 僅非 Suno 顯示；zod url().max(2000) |
| 純音樂開關 | Switch | `instrumental` | false | — | instrumental | Suno 對應 `instrumental` |
| 歌詞 | Textarea | `lyrics` | "" | — | lyrics／Suno `lyrics`（customMode=!!lyrics） | 僅 sonauto/ace-step/Suno 顯示 |
| 音樂時長 | Slider | `duration` | 30 | 5–180s（Suno/sonauto 隱藏） | duration | sonauto 由 API 自主決定，UI 提示但仍會送隱藏 undefined |
| — | — | — | — | — | 👻 `bpm`（zod 40–300，全模型皆收） | **完全無 UI**，音樂積木子系統 mus-bpm 欄屬另一套死系統見 §1.9 |
| — | — | — | — | — | 👻 `negativePrompt`（DEF-S1，僅 Stable Audio 生效，max500） | **完全無 UI**——MusicTab 沒有負向詞輸入框 |
| — | — | — | — | — | 👻 Suno `title`（zod optional，用於命名） | UI 從不填，一律用 `input.title?.trim() || "Suno {v} 音樂"` 預設 label |

### 1.2 音效生成（SoundEffectsTab）

| 欄位 | 控制項 | state | 預設 | 範圍 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| 選擇模型 | 按鈕×3 | `sfxModel` | "stable-audio" | stable-audio/audioldm2/elevenlabs | model | 與後端 `resolveSfxModelChoice` 預設一致 |
| 音效描述 * | Textarea | `text` | "" | zod min1 max500 | text | |
| 指定時長開關 | Switch | `useDuration` | false | — | — | 關閉時 `duration_seconds` 送 undefined→後端各模型各自預設(stable 10s/audioldm2 15s) |
| 時長 | Slider | `duration` | 10 | 1–180（elevenlabs 上限 22，切模型自動夾） | duration_seconds | ✅ 一致 |
| 提示詞影響強度 | Slider（僅 elevenlabs 顯示） | `influence` | 0.3 | 0–1 step.05 | prompt_influence | ≡ zod default 0.3 |

### 1.3 語音合成（TTSTab）

| 欄位 | 控制項 | state | 預設 | 範圍 | tRPC | 備註 |
|---|---|---|---|---|---|---|
| 引擎選擇 | 按鈕×2 | `engine` | "elevenlabs" | elevenlabs/qwen | — | |
| 合成文字 * | Textarea（顯示字數/5000） | `text` | "" | zod max5000（eleven）/max5000（qwen） | text | |
| ElevenLabs 引擎 | 按鈕×4 | `elevenEngine` | "turbo-v2.5" | turbo/flash/multilingual-v2/eleven-v3 | engine | ✅ 與後端 fallback 一致 |
| 語音選擇（eleven） | 快選卡×8＋自訂輸入 | `voiceId` | "" | 自由 voice_id | voice_id | 空值→后端不帶，走 fal 預設 |
| Qwen 語音選擇 | 快選卡×4＋輸入 | `voiceId` | "" | Chelsie/Ethan/Vivian/Dylan 或自訂 | voice | 空值→後端 `resolvedVoice` 補 "Vivian" |
| 穩定性（eleven） | Slider | `stability` | 0.5 | 0–1 step.05 | stability | |
| 相似度（eleven） | Slider | `similarity` | 0.75 | 0–1 step.05 | similarity_boost | |
| ~~語速~~ | **無渲染 UI** | `speed` | 1.0 | 0.5–2（僅光球 agent-bridge setParam 可改） | **不存在此欄** | ⚰ zod `elevenLabsTTS`/`qwenTTS` 都沒有 speed 欄位；此 state 僅供光球 `getState/setParam` 讀寫，人類使用者在畫面上完全看不到、按鈕也不會送出——是純裝飾/agent-only 死狀態，非任務單原先猜測的「滑桿不送」而是「連滑桿都沒有」 |
| — | — | — | — | — | 👻 `style`（0–1，emphasisLevel 積木才有值） | TTSTab 無 UI，只有 CloneTab 外的 `customBlockId` 路徑能間接觸發 |
| — | — | — | — | — | 👻 `model_id`（覆寫原生 ElevenLabs model_id）、`language_code`、`customBlockId` | 三者皆無 UI |
| — | — | — | — | — | 👻 qwenTTS `language`（11 語言 enum，default Auto）、`reference_text`、`speaker_voice_embedding_file_url` | TTSTab 呼叫僅送 `{text, voice}`，三欄靠 zod default／undefined，唯二能填的路徑是 CloneTab 的 `qwenCloneAndSpeak`（送 reference_text/language）|

### 1.4 聲音克隆×5（CloneTab）

| 模式 | UI 欄位 | tRPC | 落差 |
|---|---|---|---|
| Qwen 克隆＋合成 | 參考音訊*(FileUploadInput,需 https://)／參考文字稿（選填）／合成文字* | `qwenCloneAndSpeak` | 前端擋非 https:// URL（DEF-08）；zod `language` enum 11 語言完全無 UI，恆用 default "Auto" |
| Dia 多說話者 | 合成文字*（[S1]/[S2] 標籤，無參考音訊欄） | `diaTTSVoiceClone` | 一致（僅 text） |
| Qwen 語音設計 | 語音特徵描述*／測試文字（選填） | `qwenVoiceDesign` | 一致；text 留空時後端 default「你好，我是你設計的聲音。」|
| ElevenLabs IVC | 參考音訊*(30s–3min)／聲音名稱*／聲音描述（選填） | `elevenLabsVoiceClone` | 👻 `labels`(Record<string,string>) 無 UI |
| Kling 語音建立 | 音訊來源*／語音名稱* | `klingCreateVoice` | 一致（僅 2 欄，zod 亦僅 2 欄）|

### 1.5 音訊處理×4＋ASR（ProcessTab／ASRTab）

| 工具 | UI 欄位 | tRPC | 落差 |
|---|---|---|---|
| Demucs 分軌 | 音訊*／分離模型 Select×5（htdemucs_ft/htdemucs/htdemucs_6s/mdx/mdx_extra） | `demucs` | ≡ 預設 htdemucs_ft；👻 `output_format`（mp3/wav，zod default mp3）**完全無 UI**，永遠送 mp3；stems 由後端依 model 自動判定，UI 無挑選 |
| 音訊隔離 | 音訊* | `audioIsolation` | 一致（僅 1 欄） |
| 多音訊合併 | 音訊列表*（≥2，動態新增）／合併方式（串接/混音） | `mergeAudios` | ≡ zod default concatenate；zod `.max(10)` 但 UI 無上限提示 |
| 聲音變換 | 音訊*／目標語音 ID*（快選×4＋自訂）／去背景噪音開關 | `voiceChanger` | 一致 |
| ASR 語音識別 | 音訊*／加速模式 Select×4 | `speechToText` | ≡ default "none"；zod 無 language/task 欄，UI 已誠實不留空位 |

### 1.6 AI 形像影片×6（AvatarVideoTab）

| 模型 | UI 欄位 | tRPC | 落差 |
|---|---|---|---|
| Wan 說話人 | 人物圖片*／驅動音訊*／提示詞（選填） | `speechToVideo` | 👻 `num_frames`（16–200）完全無 UI，恆用 fal 端預設 |
| EchoMimic V3 | 人物圖片*／驅動音訊（選填）／提示詞當 text（選填） | `echoMimic` | 👻 `pose_style`（0–45，zod default 0）無 UI |
| Stable Avatar | 人物圖片*／驅動音訊* | `stableAvatar` | **UI 完全不顯示 prompt 輸入框**（唯一沒有 Prompt 區塊的模型）；zod `prompt` 有 min1 default"a person speaking naturally"，故不影響提交，但代表使用者永遠無法自訂此模型的動作/表情文字 |
| LongCat Avatar | 人物圖片*／驅動音訊*／提示詞（選填） | `longcatAvatar` | 一致 |
| LTX-2 音訊→影片 | 提示詞*／驅動音訊* | `ltxAudioToVideo` | 👻 `image_url`(選填首幀)、`lora_url`、`num_frames`(8–257 def121)、`resolution`(480p/720p def720p) 全無 UI |
| ElevenLabs 配音 | 影片 URL（與音訊二選一）／音訊（二選一）／目標語言 Select×7 | `dubbing` | 👻 `source_language`（zod default "zh"）、`num_speakers`（1–10）無 UI；targetLang 前端預設 "en" 純前端猜測值（後端無預設，必填） |

### 1.7 無入口/半成品 procedure

`compiledTextToMusic`（AudioBlock[] 積木→AudioCompiler→音樂生成，28KB 邏輯）、`qwenCloneVoice`（單獨克隆回 embedding，不合成音訊）、`voiceStyles`（實際消費者是 VideoCockpit VoiceAmbientCanvas，非 ProStudio 自身）——三支後端皆完整但 **ProStudio 頁面零入口**（沿用 01-features §1.9 既有判定，本次逐行確認無新入口）。

### 1.8 ProStudio 小結

- **欄位總數**：音樂 8＋音效 5＋TTS 7＋克隆 5 模式合計 11 個獨立欄＋處理 4 工具合計 9 個欄＋ASR 2＋形像影片 6 模型合計 13 個欄 ≈ **55 個獨立表單控制項**，驅動 26 支 mutation。
- **死欄位（⚰）**：TTS 的 `speed` state（無 UI 渲染、無 zod 對應欄、僅光球可寫，人類完全看不見也送不出）——比原任務單描述的「滑桿不送後端」更徹底：**滑桿本身不存在**。
- **隱藏能力（👻，合計約 20 個 zod 欄位無 UI）**：音樂 bpm／negativePrompt／Suno title；TTS style／model_id／language_code／customBlockId／qwen language／reference_text；克隆 IVC labels；Demucs output_format；形像影片 num_frames×2／pose_style／lora_url／resolution／source_language／num_speakers。
- **前後端預設不一致（≠）**：無重大不一致——ProStudio 逐一模型皆刻意把 UI 預設值對齊 zod default（`resolveMusicModelChoice`/`resolveSfxModelChoice` 等 resolver 函式即為此目的而寫），是全站少見的「預設值治理良好」頁面。
- **設計性缺口（非死欄位但值得注意）**：MusicTab 永遠顯式送 `model` 參數，等同**前端每次都覆蓋大腦（Brain）音訊引擎組態**——`resolveMusicModelChoice`/`resolveSfxModelChoice` 的「未指定 model 時吃大腦設定」分支在 ProStudio 主 UI 實際上永不觸發（僅 `compiledTextToMusic` 等無入口 procedure 才可能不帶 model）。

---

## 2. Studio（/video/studio，四模態統一工作室）

### 2.1 提交路徑與 zod 全貌

實際生成走 `generate.submitMultimodalAsync`（Studio.tsx:1622-1664，背景任務模式；01-features §1.4 已標「頁內結果直出」為半成品，此為唯一真正使用中的提交路徑）。zod 完整欄位：`prompt/generationType/mode/seed` 共用＋各模態專屬＋`vaultCharacterId/vaultSceneId/fineTunedModelId/loraWeight/overrideModelId/modelParams`。

### 2.2 四模態工作區逐欄

| 模態 | 欄位（UI label） | 控制項 | state | 預設 | 範圍 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|---|
| 共用 | 生成模式 | 按鈕×2（閃電/深度精確） | `mode` | "lightning" | lightning/deep_precision | mode | ⚰ **zod 收但 submitMultimodalAsync 函式體全文 0 處讀取 `input.mode`**（grep 確認）——只有另一支同步端點 `generate.multimodal`（Studio 未使用的舊路徑）才會用 mode 決定 gemini_flash/gemini_pro。閃電/深度精確是**全 Studio 最顯眼卻完全不影響生成結果的死開關** |
| 共用 | 種子碼 | Input | `seed` | "" | 整數字串 | seed | 送出前 parseInt，失敗→undefined |
| 共用 | LoRA 權重 | Slider | `loraWeight` | 0.7 | 0–1（zod 同） | loraWeight | 僅 fineTunedModelId 有值時實際生效（走 fal-ai/lora） |
| 圖像 | 畫面比例 | 按鈕×5 | `imageState.aspectRatio` | "16:9" | 1:1/16:9/9:16/4:3/3:2 | aspectRatio | |
| 圖像 | 排除描述 | Textarea＋10 chips | `imageState.negativePrompt` | "" | 自由文字 | negativePrompt | |
| 圖像 | 風格/氛圍參考圖 | VaultDropzone×2 | `styleReferenceUrl`/`vibeReferenceUrl` | null | — | styleReferenceUrl/vibeReferenceUrl | |
| 影片 | 首/末幀 | VaultDropzone×2 | `firstFrameUrl`/`lastFrameUrl` | null | — | firstFrameUrl/lastFrameUrl | |
| 影片 | 角色一致性參考 | VaultDropzone | `characterRefUrl` | null | — | characterRefUrl | |
| 影片 | 影片長度 | 按鈕×4 | `duration` | "8" | 4/8/16/30s | videoDurationSeconds | |
| 影片 | 鏡頭運動 pan/zoom/tilt | Slider×3 | `cameraMotion` | {0,0,0} | -100~100 step5 | cameraMotion{pan,zoom,tilt} | 後端 `applyCameraMotionToPrompt` 轉譯成英文提示詞附加，非結構化 API 參數（各 fal 影片模型無 camera 欄） |
| 音樂 | 純音樂/含人聲 | Switch | `isInstrumental` | true | — | isInstrumental | |
| 音樂 | 歌詞 | Textarea（含人聲時顯示） | `lyrics` | "" | — | **不送**（zod 無此欄） | ⚰ 見 §2.3 |
| 音樂 | 音樂風格 | 按鈕×10 | `musicStyle` | "ambient" | 10 選 | musicStyle | |
| 音樂 | 曲目長度 | Slider | `duration` | 30 | 15–120s step5 | audioDuration | |
| 音樂 | 能量強度 | Slider | `energy` | 50 | 0–100 step5 | **不送**（zod 無此欄） | ⚰ 見 §2.3 |
| 語音 | 常用語境預設 | 快選卡×3 | 一次套用多欄 | — | 冥想/旁白/廣告 | — | |
| 語音 | 語音角色 | 卡片×5＋自訂克隆模型 | `voiceActorId` | "default-warm" | 5 內建＋myModels | voiceModelId | |
| 語音 | 語音文字 | Textarea | `text` | "" | — | voiceText（亦作 prompt） | |
| 語音 | 情感類型 | 按鈕×6 | `emotionType` | "neutral" | 6 選 | voiceEmotionType | 見 §2.3 |
| 語音 | 情感強度 | Slider | `emotionIntensity` | 0.5 | 0–1 step.05 | voiceEmotionIntensity | 見 §2.3（純裝飾） |
| 語音 | 語速 | Slider | `speed` | 1.0 | 0.5–2.0 step.1 | voiceSpeed | 有實際效果（見下） |
| 語音 | 穩定性 | Slider | `stability` | 0.5 | 0–1 step.05 | voiceStability | 有實際效果 |

### 2.3 落差細節（比 H2 更深一層：字段送達≠字段生效）

1. **`mutationInput` 死物件**（Studio.tsx:1574-1618）：`handleGenerate` 先組出一個包含 `vibeCardIds/temperature/lyrics/audioEnergy` 等完整欄位的 `mutationInput`，但下面實際呼叫 `submitAsyncMutation.mutateAsync(...)` 時**只取用 `mutationInput.prompt` 與 `mutationInput.seed` 兩個值**（:1623,1626），其餘欄位（含音樂模態的 `lyrics`/`audioEnergy`）純屬計算後即丟棄的死計算——不是「忘記接」而是「算兩次、只用一次」。
2. **音樂歌詞／能量強度**：`AudioWorkspace` 有完整 UI（Textarea 歌詞、0-100 能量滑桿），但 `generate.submitMultimodalAsync` 的 zod **從未定義** `lyrics`/`audioEnergy` 欄位——不論是否死物件問題，這兩欄在 Studio 的音樂模態下**物理上無法送達後端**，音樂生成永遠是「純風格描述＋樂器」，使用者填的歌詞從未被使用。
3. **語音情感強度／穩定性只半生效**：async 路徑把 `voiceStability` 映射進 `voice_settings.stability`（實際生效），但 `voiceEmotionType`/`voiceEmotionIntensity` 在 async 路徑的 `falInput` 組裝中**完全未被讀取**（只寫入下游 resultData/history 供顯示，不影響生成）；唯一會用 `voiceEmotionType` 的是另一條同步路徑 `generate.multimodal`（依 emotionType 對照 6 組寫死 voice_id），但 Studio 預設不走這條路徑。換言之：情感類型/強度兩個精心設計的 UI 控制項對 Studio 實際使用者而言是**觀感操作，非功能操作**。
4. **`mode`（閃電/深度精確）**：見 §2.2，zod 收、函式體 0 引用，純裝飾切換。

### 2.4 積木/思考島/負向詞（pro 模式，系統 A／B，沿用 G2 §4 結論不重複展開）

- 系統 A（ProgressivePromptBuilder + customBlocks/blockCombos）：完整鏈，唯一消費點。
- 系統 B（StructuredBlocksEditor/ThoughtIslandsPanel/PromptStrengthControl）：**只在 pro 模式生效**；standard 模式下編輯系統 B 積木不會反映到送出的 prompt（G2 已證實）；`negativePrompts` state 只活在編譯字串內，實際 API 的 `negativePrompt` 參數另外取自 `imageState.negativePrompt`——即系統 B 的負向詞編輯完全不是 submitMultimodalAsync 的 `negativePrompt` 來源。

### 2.5 Studio 小結

- **欄位總數**：共用 3（mode/seed/loraWeight）＋圖像 4＋影片 5（含 cameraMotion 3 子控制計 1 組）＋音樂 5＋語音 6 ＋ Vault/模型注入 3（vaultCharacterId/vaultSceneId/fineTunedModelId）≈ **26 個核心生成表單控制項**（不含積木/思考島/版本庫等編譯層 UI，那批已由 G2 詳列）。
- **死欄位（⚰）**：`mode`（閃電/深度精確，async 路徑 0 引用）、音樂 `lyrics`／`energy`（zod 無此欄，UI 填了也送不出）、`mutationInput` 死物件本身。
- **隱藏能力（👻）**：`modelParams`（動態每模型專屬進階參數，UI 有但僅 pro 模式模型卡展開時出現，simple/standard 用戶看不到）；`overrideModelId` 只由 Director AI 建議流程注入，一般手動操作不可見。
- **前後端預設不一致（≠）**：未發現顯著不一致（各欄前端初始值與 zod optional 缺省行為一致，因為多數欄位 optional 無 default，前端本來就是唯一預設來源）。
- **半功能欄位（比死欄位更隱蔽的一類）**：`voiceEmotionType`／`voiceEmotionIntensity`／`stability`（async 路徑部分或完全不生效但 UI 呈現「已套用」的滑桿數值與百分比，使用者無從得知）。

---

## 3. AnimationStudio 編輯器（角色／場景／風格／配樂）

> 資料模型逐欄已由 G2 §1 全數盤點（含 UI 掛載行號、生成/消費鏈路）；本節補上**控制項型別＋zod 驗證範圍**兩個 G2 未逐欄列出的維度，並標出「零 UI 覆蓋」欄位。角色/場景巢狀子結構 v2/v3/v4 共 20+ 組，此處僅列具代表性的驗證邊界，完整子結構清單見 G2 §1.2-1.5。

### 3.1 角色編輯器（CharacterAnimationCard，全欄 UI 對照 `worldCharacterSchema`）

| 欄位 | 控制項 | 預設 | 驗證範圍（zod） | 必填 | 備註 |
|---|---|---|---|---|---|
| 名稱 name | Input | "" | draftLabel(128)＝max128 | 是（min1） | |
| 角色定位 role | Select | — | enum protagonist/supporting/antagonist/npc | 是 | |
| 標語 tagline | Input | "" | max255 | 否 | |
| 個性 personality | Textarea | "" | max2000 | 否 | |
| 喜好/興趣 likes/interests | 動態標籤列表 | [] | 各 max50 項、單項 max128 | 否 | |
| 外觀 appearance | Textarea | "" | max2000 | 否 | |
| 背景故事 backstory | Textarea | "" | max5000 | 否 | |
| 連結 LoRA linkedModelId | Select（linkableModels） | null | int positive nullable | 否 | |
| 觸發詞 triggerWord | Input | "" | max128 | 否 | |
| 三視圖 threeViewSheet.* | ThreeViewEditor（URL×4＋GenerateImageButton） | — | 每張 draftUrl()；referenceImageUrls max20；generationPrompt max2000 | 否 | 唯一含站內圖生成按鈕的子結構 |
| 表情 expressions[] | ExpressionEditor＋presets | [] | max50 筆；intensity 0–1 | 否 | 無一鍵生成（僅三視圖有） |
| 服裝 outfits[] | OutfitEditor＋presets | [] | max30 筆；palette max12 色 | 否 | |
| 口氣 speechTone.* | 表單（formality/pace enum＋列表） | — | catchphrases/mannerisms 各 max20，forbiddenWords max50 | 否 | |
| 語音 voiceProfile.* | 表單（engine/voiceId/pitch/speed…） | — | pitch -1~1；speed 0.25–4；cloneSampleUrls max10 | 否 | GenerateVoiceButton 直呼 elevenLabsTTS |
| 腳本定位 scriptRole.* | 表單（archetype/arcType enum/avgScreenTimeRatio…） | — | relationships max50；avgScreenTimeRatio 0–1；signatureLines max20 項 max255 字 | 否 | seedSkeleton 核心輸入 |
| **身體 body.\*** | **無任何編輯 UI** | — | heightCm 0–1000；distinctiveFeatures max20 | 否 | ❌ G2 已確認：僅 buildFramePrompt 讀取，AnimationStudio 完全無寫入介面 |
| Rig rigSpec.* | 表單（rigType enum/boneCount/ikChains…） | — | boneCount int 0–5000；blendShapeCount 0–1000 | 否 | 純文件性，無管線消費 |
| 口型 lipSyncSet.* | 表單（PRESTON_BLAIR_PHONEMES） | — | — | 否 | 無管線消費 |
| 演技 actingNotes.* | 表單 | — | — | 否 | buildFramePrompt fallback 讀 defaultPosture |
| 聲音樣本 soundProfile.* | AssetUploader×N | — | — | 否 | 無管線消費 |

**分頁小計**：角色編輯器單一角色卡含約 **60+ 個獨立表單控制項**（含所有 v1-v4 子結構展開）；其中 `body.*`（5 欄）**零 UI 覆蓋 = 純後端讀取用型別**，是本節最大的「隱藏能力反向案例」——不是後端多收，而是**後端有讀取邏輯但前端無寫入介面**，資料實際上永遠是 null。

### 3.2 場景編輯器（SceneCard，對照 `worldSceneSchema`）

| 欄位群 | 控制項摘要 | 預設/驗證 | 備註 |
|---|---|---|---|
| 基本（name/environment/flora/fauna/props/lighting/mood） | Input/Textarea＋presets | mood/lighting/environmentChanges 皆為 preset chips | AI `generateScene` 只產這批 |
| 建場圖 establishingShotUrl | URL＋GenerateImageButton（fal 生成）＋上傳 | "" | 站內生成 |
| 時段 timeOfDay[] | preset chips 多選 | [] | seedSkeleton 輪替使用 |
| 風格/配樂關聯 styleProfileId/musicThemeId | Select（下拉引用） | null | |
| 運鏡/比例 defaultCameraMovement/preferredAspectRatio | Select×2 | preset | |
| Layout（floorPlanUrl/blockingDiagramUrl/entry/exit/heroShotAngle/coverageAngles/approxDimensions） | 表單群 | — | seedSkeleton 用於首格 hero shot |
| 美術 productionDesign.* | 表單群 | — | buildFramePrompt 讀取 |
| 大氣 atmospherics.* | 表單群（fogDensity 等數值） | — | |
| 聲音設計 soundDesign.* | 表單群＋上傳 | — | signatureSfx 前 2 個自動變分鏡 sfx |

無零 UI 覆蓋欄位（G2 §1.3 已確認全對齊）。

### 3.3 風格 Profile（StyleProfileCard，對照 `worldStyleProfileSchema`）

| 欄位 | 控制項 | 驗證 | 備註 |
|---|---|---|---|
| artStyle/palette/lighting | Input/多選 | palette max24 | |
| lensSpec.focalLengthMm/aperture/depthOfField | 表單 | focalLength 1–2000mm | |
| postProcessing/fps | 多選/數字 | fps int 1–120 | |
| shootOn（1/2/4 格）/schoolReference | Select | union literal 1\|2\|3\|4 | |
| lineSpec.weight/lineStyle | 表單 | weight 0–20 | |
| shadingModel/colorSpace/masterResolution/masterCodec | Select×4 | enum 各 5-6 選 | |
| **letterboxing** | ❌ 無 UI | max128 | 純 schema |
| **subtitleSpec.{font,sizePt,color,outlineColor}** | ❌ 無 UI | sizePt int 8–200 | 純 schema |
| **titleCardStyle** | ❌ 無 UI | max500 | 純 schema |
| 設為預設 defaultStyleProfileId | Toggle | — | 世界觀層級單選 |

三個純 schema 欄位（letterboxing/subtitleSpec/titleCardStyle）client/server 皆 0 消費，與 G2 §1.4 一致確認。

### 3.4 配樂主題編輯器（MusicThemeCard，對照 `worldMusicThemeSchema`）

| 欄位 | 控制項 | 驗證 | 備註 |
|---|---|---|---|
| mood/instruments/key/timeSignature | Input/多選 | instruments max20 | |
| bpm | 數字輸入 | int 20–400 | |
| applicableSceneIds/applicableCharacterIds | 多選（引用） | 各 max100 | |
| leitmotif.{description,melodicPhrase,midiUrl} | 表單 | melodicPhrase max500 | |
| cueVariants[] | 表單＋上傳 | max20 筆；durationSec 0–3600 | label 借用 sfxDescription 攜帶 `cue:` 前綴給 seedSkeleton |
| stems.{drums,bass,melody,harmony,pads,fx} | 6 個上傳欄 | draftUrl() | |
| lufsTarget | Select（preset） | — | |
| transitionStyle | Select | — | |
| stingerPoints | 逗號分隔 Input | — | |

無零 UI 覆蓋欄位。

### 3.5 AnimationStudio 小結

- **欄位總數**：角色編輯器 ≈60＋場景編輯器 ≈35＋風格 Profile ≈20＋配樂主題 ≈15 ≈ **130 個獨立表單控制項**（單一世界觀，多角色/場景時線性放大）。
- **死欄位（⚰）**：本節性質與其他頁不同——AnimationStudio 幾乎沒有「送了後端不收」的死欄位（因為是 JSON 欄位全量 patch 寫入，見 G2 §1.1「每次存檔都把全部 JSON 欄一起送」），死的是**下游管線消費**（見 G2 §2-3：checkConsistency mock、scene_compositions insert-only、planPipeline 有計畫無執行器）。
- **隱藏能力（👻，反向：UI 缺，非後端缺）**：`CharacterBody`（5 欄，僅讀取無寫入）、`objects`（WorldObject[]，無編輯分頁）、`tags`/`isActive`（無 UI）、風格 Profile 3 欄（letterboxing/subtitleSpec/titleCardStyle）。
- **前後端預設不一致（≠）**：未發現——所有子結構皆 optional 無 zod default，UI 初始值即唯一預設來源，天然不會不一致。
- **與 H2/G2 差異**：本頁的「隱藏能力」不是「前端沒接 UI 送某個後端本來就收的欄位」，而是「型別定義了欄位、後端某處會讀，但整個 client 找不到任一寫入路徑」——即**結構性零寫入欄位**，比一般 UI 疏漏更難察覺（TypeScript 型別存在會讓開發者誤以為「有地方在填」）。

---

## 4. VideoCockpit 表單（確認門／生成設定／抽屜）

> 座艙架構與接線已由 G1 全篇覆蓋；本節補齊 G1 未逐欄列出的**表單控制項層**。

### 4.1 建立影片專案對話框（VideoProjectCreateDialog，AIDV-252/255/270）

| 欄位 | 控制項 | state | 預設 | 選項 | tRPC 參數 | 備註 |
|---|---|---|---|---|---|---|
| 畫面比例 | 單選卡×3（radiogroup） | `aspectRatio` | "16:9" | 16:9/9:16/1:1 | aspectRatio | |
| 解析度 | 單選列×3（OutputSpecSelector） | `outputSpec.resolution` | "1080p" | 720p/1080p/4K（4K 需付費，非付費 disabled+鎖圖示） | outputSpec.resolution | ≡ 後端 `VIDEO_OUTPUT_SPEC_DEFAULT` |
| 幀率 | 單選列×3 | `outputSpec.fps` | 30 | 24/30/60 | outputSpec.fps | 註記「部分模型支援，其餘由平台預設」 |
| 編碼 | 單選列×3 | `outputSpec.codec` | "h264" | h264/h265/vp9 | outputSpec.codec | ⚰ 誠實標註「目前僅作專案標註，不影響實際生成輸出」——UI 自己承認是裝飾欄 |
| 輸入素材 | VideoInputAssetsUploader（image/audio+role，動態列表） | `inputAssets` | [] | — | inputAssets（空陣列時整欄省略） | |

送出前 `clampOutputSpecToPlan` 防呆：非付費殘留 4K 一律收斂 1080p，與後端 fail-closed 邏輯對齊（單一真實來源函式）。

### 4.2 確認門卡（ConfirmGate，右欄 ContextSidecar）

UI 呈現三態計數（ready/partial/blocked）＋具名待補列表，無獨立表單欄位——**互動只有「上傳參考照」一個按鈕**，且該按鈕是假上傳（G1 §3.2-2 已證實：零檔案選擇器，點擊即本地把角色標記為「精準+四鎖全開」，`vault.update` 因 id 型別不符幾乎必然跳過回寫）。本次逐行確認：按鈕本身無任何 `<input type="file">`或拖放區，純 `onClick` 觸發樂觀 state 變更，UI 層面「表單」的唯一輸入是 0 個。

### 4.3 引導式創作（GuidedJourney）

| 欄位 | 控制項 | state | 預設 | tRPC | 備註 |
|---|---|---|---|---|---|
| 長腳本 | Textarea | `text` | "" | `commander.breakdownScript`（實際=`director.importScript`） | AIDV-180 |
| 專案名稱 | Input | `name` | "" | `worldStoryboard.createFromSegments`（name） | 僅連結世界觀時回寫，否則留本地 |

僅 2 個欄位，是座艙內最精簡的表單；三步驟（input→loading→review）皆前端狀態機。

### 4.4 自由素材生成畫布（AssetGenCanvas）

| 欄位 | 控制項 | state | 預設 | 選項 | 備註 |
|---|---|---|---|---|---|
| 提示詞 | Textarea | `prompt` | "" | — | |
| 模型 | Select | `model` | `IMAGE_MODELS[0]` | 4 個**寫死短 id**（如 `nano-banana-2`，非完整 fal id） | 走 generation 接縫 estimateCost→submitStudioJob；G1 已標「上傳自有/外部帶入」兩 tab 為誠實佔位 |

無 aspectRatio/seed/negativePrompt 等其他生成參數 UI——是全站生成表單中**控制項最少**的一個（相較 ImageStudio 同類頁面少約 6-8 個欄位）。

### 4.5 成本階梯（CreationFlowBar 常駐儀表，非對話框，但為「生成設定」感知面）

| 欄位 | 控制項 | 選項/單價 | 備註 |
|---|---|---|---|
| Provider 選擇 | 按鈕×4 | hf $0.012／gemini $0.02／fal $0.04／mock $0（每張，寫死原型值） | ⚰ 選擇的 provider **不進 `submitStudioJob` payload**（generation.trpc.ts:128-133，G1 已證實），点选後对实际生成/计费零影响，只是儀表板上的心理暗示數字 |

### 4.6 VideoCockpit 小結

- **欄位總數**：建立專案對話框 5＋確認門 0（僅按鈕）＋引導式創作 2＋自由素材畫布 2＋成本階梯 1（4 選項）≈ **10 個核心表單控制項**（其餘座艙功能為唯讀查詢面板／抽屜目錄，非表單，已由 G1 §1.6-1.7 逐一列出）。
- **死欄位（⚰）**：編碼 codec（UI 自承裝飾）；成本階梯 provider 選擇（不入 payload）；確認門「上傳參考照」（無檔案輸入的假表單）。
- **隱藏能力（👻）**：`videoProject.requestExport`（完整後端，前端 0 呼叫點，G1 §1.2/§4 已證實）；AssetGenCanvas 缺 aspectRatio/seed/negativePrompt 等 ImageStudio 同級頁面常見欄位。
- **前後端預設不一致（≠）**：未發現——OutputSpecSelector 明確以「等於後端預設就不送」策略維持一致（`outputSpecForGeneration`），是本次四頁中預設值治理最嚴謹的表單。

---

## 5. 四頁橫向對照

| 面向 | ProStudio | Studio | AnimationStudio | VideoCockpit |
|---|---|---|---|---|
| 表單規模 | ~55 欄／26 mutation | ~26 核心欄（+ 積木層另計）／1 mutation | ~130 欄／2 mutation（create/update 全量 patch） | ~10 欄／少量 mutation，多為唯讀面板 |
| 死欄位性質 | 1 個純裝飾 state（speed 無 UI） | mode 全域裝飾開關＋2 個 zod 未定義欄（歌詞/能量）＋1 個死物件 | 管線執行層死（非表單本身） | codec／provider 儀表裝飾＋假上傳表單 |
| 隱藏能力規模 | ~20 個 zod 欄無 UI | modelParams（僅 pro 模式可見）＋overrideModelId（僅 AI 建議可觸發） | CharacterBody 等「型別有、寫入介面無」的結構性零寫入（AnimationStudio 特有現象） | requestExport 完整後端零前端呼叫 |
| 預設值治理 | 最佳（resolver 函式主動對齊） | 良好（optional 無 default，天然一致） | 良好（JSON 全量 patch，无 default 可比） | 最佳（`outputSpecForGeneration` 明確策略） |
| 本次新增最重大發現 | TTS speed 連 UI 都不存在 | **`mode`（閃電/深度精確）async 路徑 0 引用，全站最顯眼的死開關之一**；音樂歌詞/能量強度 zod 根本沒定義 | CharacterBody 等「結構性零寫入」現象命名 | （沿用 G1，本次補齊表單控制項清單，未見新增死欄位）|

---

## 6. 缺讀聲明

- ProStudio：`getVoiceStyleCatalog`/`getAudioCompiler`/`voiceCompiler.ts` 內部實作未逐行（僅讀呼叫介面）；`AsyncAudioPoller`/`FileUploadInput`/`ToolCard` 等共用元件僅讀 props 介面。
- Studio：`ProgressivePromptBuilder.tsx`（2032 行）/`PromptCompiler.ts`/`RecipeLibraryPanel.tsx`（823 行）/`VersionHistoryPanel.tsx` 沿用 G2 既有結論未重讀；`generate.multimodal`（同步舊路徑）僅讀與 async 路徑的差異段落，未逐行對照。
- AnimationStudio：角色/場景/風格/配樂的 React 元件渲染細節（ExpressionEditor/OutfitEditor/ThreeViewEditor 等）沿用 G2 已讀結果，本次僅新增 zod 驗證範圍比對，未重新逐行讀取 AnimationStudio.tsx。
- VideoCockpit：`design-kit` 內部元件實作、`spine/gate.ts` 純函式邏輯、10 個抽屜內部表單細節沿用 G1 既有結論；本次僅新增 4 個先前未列出的獨立表單（建案對話框/引導創作/自由素材畫布/成本階梯）之控制項層。

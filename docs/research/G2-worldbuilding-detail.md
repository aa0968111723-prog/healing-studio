# G2 — 世界觀 / 分鏡 / 工作台細節逐欄盤點（補洞 wave G）

- 產生日期：2026-07-03
- 依據 commit：`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 波次：**補洞 wave G**
- 方法：逐欄實讀 `drizzle/schema.ts:3462-3667`、`shared/worldbuilding-types.ts`（2709 行全型別）、`shared/worldbuilding-animation.ts`、`shared/worldbuilding-timeline.ts`、`server/routers/worldbuilding.ts`（814 行全讀）、`server/routers/worldStoryboard.ts`（710 行全讀）、`server/services/worldbuildingGeneration.ts`、`client/src/pages/AnimationStudio.tsx`（6946 行，中後段 3212-6946 補讀）、`client/src/pages/Studio.tsx`（積木段補讀）、`client/src/components/ProgressivePromptBuilder.tsx`、`client/src/components/workspaces/PromptCompiler.ts`、`server/routers/customBlocks.ts`、`server/routers/blockCombos.ts`，並全 repo grep 寫入路徑
- 標記約定：✅ 有 UI 寫入＋後端寫入｜🟡 有後端寫入、UI 缺或間接｜❌ 僅 schema/型別定義，無實際寫入或無消費者

---

## 1. worldbuilding_frameworks 資料模型逐欄（schema.ts:3470-3534）

### 1.1 表層欄位

寫入面統一經兩支 procedure：`worldbuilding.create`（worldbuilding.ts:112-152，錯誤處理特別把 Drizzle cause 拉出來重拋）與 `worldbuilding.update`（:155-209，partial patch、逐欄條件展開）；另有 `importFull`（:579-610，永遠建新列、名稱加「（匯入）」後綴）。UI 寫入源是 AnimationStudio 的 `handlePatchWorld`（AnimationStudio.tsx:5462-5496，本地 draft + 600ms debounce 全量 patch，**每次存檔都把全部 JSON 欄一起送**）。

| 欄位 | 型別 | UI 寫入 | 後端寫入 | 備註 |
|---|---|---|---|---|
| id / userId | int | — | create | userId 由 ctx 注入；所有讀寫都做 ownership check |
| name | varchar(255) | WorldBasicsEditor（:3322） | create/update | |
| description / genre / era | text / varchar(128)×2 | WorldBasicsEditor（genre/era 有 preset chips） | create/update | genre 與 era 正交（schema 註解） |
| charactersJson | json `WorldCharacter[]` | 角色分頁 CharacterAnimationCard（:530-2408）＋ AI `worldbuildingGeneration.generateCharacter` | create/update | ✅ 詳見 §1.2 |
| scenesJson | json `WorldScene[]` | 場景分頁 SceneCard（:3838-4679）＋ AI `generateScene` | create/update | ✅ 詳見 §1.3 |
| objectsJson | json `WorldObject[]` | 🟡 **AnimationStudio 無 objects 編輯分頁**；僅 create/update patch 帶入 | create/update | 讀取端有：queryEntities、seedSkeleton 的 pickObjectsForScene、summarizeForPrompt |
| linkedModelIds | json number[] | 角色/場景卡的 LoRA 下拉（來源 `worldbuilding.linkableModels`，濾 status=ready/training） | create/update | ✅ |
| styleProfilesJson | json `WorldStyleProfile[]` | 風格分頁 StyleProfileCard（:2478-2838） | create/update | ✅ 詳見 §1.4 |
| musicThemesJson | json `WorldMusicTheme[]` | 配樂分頁 MusicThemeCard（:2839-3211） | create/update | ✅ 詳見 §1.5 |
| defaultStyleProfileId | varchar(64) | StyleProfileCard「設為預設」toggle（:6403-6410） | create/update | ✅ |
| globalNegativePrompt | text | 製作目標卡下方單行 Input（:6171-6178） | create/update | ✅ 消費端：`buildGlobalNegativePrompt` → summarizeForPrompt → WorldContextContext 全站注入 |
| productionTargetsJson | json | 首頁快速編輯（格式/時長/受眾/平台，:6094-6170）＋ production 分頁 ProductionManifestEditor（:3410-3837，milestones/credits/masterSpec/deliverables/rating/字幕配音語言/budgetUsd 全有欄位） | create/update | ✅ |
| researchEntriesJson | json `WorldResearchEntry[]` | research 分頁 ResearchDatabaseEditor（:4777-5030） | create/update | ✅ v4 |
| soundLibraryJson | json `WorldSoundLibraryItem[]` | sounds 分頁 SoundLibraryEditor（:5031-5347，含 AssetUploader/SourcePicker 上傳音檔） | create/update | ✅ v4 |
| uploadedAssetsJson | json `WorldAssetRef[]` | 各卡片 AssetUploader（走 `/api/upload` → uploadFileToS3，記 fileKey） | create/update | ✅ v4 |
| tags | json string[] | 🟡 patch 帶入但 AnimationStudio 無 tags 編輯 UI | create/update | |
| isActive | boolean | 🟡 無 UI toggle | create/update/importFull | 預設 true |

### 1.2 角色 `WorldCharacter` 子結構逐欄（worldbuilding-types.ts:185-248）

編輯 UI 全在 `CharacterAnimationCard`（AnimationStudio.tsx:530-2408，含子編輯器 ExpressionEditor:194、OutfitEditor:316、ThreeViewEditor:439、TrainCharacterLoraSection:2409）。

| 子結構 | 版本 | UI 寫入 | 生成/消費接線 | 判定 |
|---|---|---|---|---|
| 基本敘事欄（name/role/tagline/personality/likes/interests/appearance/backstory/signatureItems/notes/outfit 舊欄） | v1 | CharacterAnimationCard 基本區 | LLM `generateCharacter`（worldbuildingGeneration.ts:154-245）**只產這 10 個敘事欄**（json_schema strict，system prompt 明言 rig/lipSync 等不歸它管）；`buildCharacterConsistencyPrompt` 消費 | ✅ |
| linkedModelId / triggerWord | v1 | LoRA 下拉＋trigger 欄；TrainCharacterLoraSection 可跳去訓練 | buildFramePrompt 注入 triggerWord；planPipeline collectActiveLoraIds | ✅ |
| **threeViewSheet**（front/side/back/threeQuarter/referenceImageUrls/generationPrompt） | v2 | ThreeViewEditor（:439-526）：每視角 URL 輸入＋**GenerateImageButton 直呼 fal**（prompt=consistencyPrompt+角度+「character turnaround sheet, white background, A-pose」）＋AssetUploader＋SourcePicker | 讀取：readiness visualCoverage、visualAssetGallery | ✅（含站內圖生成） |
| **expressions**（id/name/description/imageUrl/promptKeywords/intensity/triggers） | v2 | ExpressionEditor（:194-315）＋EXPRESSION_PRESETS chips；imageUrl 僅 URL/上傳/挑選（**無一鍵生成按鈕**） | 分鏡 beat.expressionId → buildFramePrompt「表情：」＋promptKeywords；exportShotList 表情欄 | ✅ |
| **outfits**（occasion/season/palette/isDefault/triggerWord） | v2 | OutfitEditor（:316-438）＋OUTFIT_OCCASION_PRESETS | beat.outfitId → buildFramePrompt（outfit.triggerWord+description）；seedSkeleton 挑 isDefault | ✅ |
| **speechTone**（baseTone/formality/pace/catchphrases/mannerisms/self/thirdParty/forbiddenWords） | v2 | 口氣區（17 處引用，含 VOICE_TONE_BASE_PRESETS） | summarizeFrameworkForPrompt → 導演對白生成 | ✅ |
| **voiceProfile**（engine/voiceId/languageCode/pitch/speed/emotion/sampleAudioUrl/useClone/cloneSampleUrls/promptPrefix） | v2 | 語音區（27 處）；voiceId 下拉來源 `worldbuilding.linkableVoices`（VOICE_MODEL_REGISTRY）；**GenerateVoiceButton「一鍵試聽（說招牌台詞）」直呼 `proStudio.elevenLabsTTS`**（:1088-1097） | planPipeline generate_voiceover step 全量帶入 voiceProfile | ✅ |
| **scriptRole**（archetype/arcType/defaultPosition/avgScreenTimeRatio/relationships/signatureLines/appearsInBeats） | v2 | 腳本定位區（18 處） | **seedSkeleton 核心輸入**：主角 always-in 判定、appearsInBeats 命中節拍、signatureLines→對白、narrator 不入鏡 | ✅ |
| **body**（heightCm/ageStage/build/species/distinctiveFeatures） | v2 | ❌ **AnimationStudio 完全沒有 body 編輯欄**（grep 0 處） | 但有讀取：buildFramePrompt 注入 species/ageStage/distinctiveFeatures；director/WorldbuildingPanel.tsx:147 顯示 ageStage tag | ❌ 僅型別＋讀取，無寫入路徑 |
| rigSpec（rigType/boneCount/ikChains/blendShapeCount/cloth/hair/eye/rigger/rigAssetUrl/riggerNotes） | v3 | Rig 區（22 處，RIG_TYPE_PRESETS） | 純文件性（無管線消費） | ✅ UI／消費弱 |
| lipSyncSet（system/shapes/enabled/primaryLanguage） | v3 | 口型區（16 處，PRESTON_BLAIR_PHONEMES） | 無管線消費 | ✅ UI／消費弱 |
| actingNotes（emotionalRange/signatureGestures/walkCycleStyle/defaultPosture/gazePattern/tics/cameraPreference/squashStretch/vodirection） | v3 | 演技區（24 處） | buildFramePrompt fallback 姿勢=defaultPosture；seedSkeleton pickPoseForBeat | ✅ |
| ageVariants（imageUrls/linkedModelId/triggerWord） | v3 | 年齡變體區（12 處） | visualAssetGallery 顯示 | ✅ |
| soundProfile（footsteps map/breath/laugh/cry/shout/hurt/sigh/customSamples） | v3 | 聲音樣本區（12 處，AssetUploader 上傳） | 無管線消費 | ✅ UI／消費弱 |
| referenceLibrary（imageUrl/category/tags） | v3 | 參考圖庫區（11 處） | visualAssetGallery、readiness 視覺覆蓋率 | ✅ |
| realWorldRefs（refType/personName/externalUrl/imageUrls/citation） | v4 | 真實參考區（11 處） | queryEntities 可搜；summarize | ✅ |
| uploadedAssets（WorldAssetRef[]） | v4 | AssetUploader | — | ✅ |

### 1.3 場景 `WorldScene` 子結構（types.ts:531-586；UI＝SceneCard :3838-4679）

| 子結構 | 版本 | UI | 消費 | 判定 |
|---|---|---|---|---|
| 基本（name/tagline/environment/flora/fauna/props/lighting/mood/environmentChanges/linkedModelId/triggerWord/notes） | v1 | SceneCard＋SCENE_MOOD/LIGHTING/ENVIRONMENT_CHANGE presets；AI `generateScene` 只產這批敘事欄 | buildFramePrompt / buildSceneConsistencyPrompt | ✅ |
| establishingShotUrl | v2 | URL＋**GenerateImageButton fal 生成**（prompt=場景一致性+「establishing shot, wide angle, no characters」，:4055-4080）＋上傳 | SceneEnvironmentPreview（:3889） | ✅ |
| timeOfDay[]（label/lighting/palette/imageUrl） | v2 | preset chips toggle（:4142-4152） | seedSkeleton pickTimeOfDayForScene（多場輪替） | ✅ |
| styleProfileId / musicThemeId | v2 | SceneCard 下拉（props 傳入 styleProfiles/musicThemes） | seedSkeleton、buildFramePrompt 風格解析鏈 | ✅ |
| defaultCameraMovement / preferredAspectRatio | v2 | CAMERA_MOVEMENT_PRESETS 下拉/比例欄 | seedSkeleton cameraDirection、SeedStoryboardForm 預設比例 | ✅ |
| layout（floorPlanUrl/blockingDiagramUrl/entry/exit/heroShotAngle/coverageAngles/approxDimensions） | v3 | Layout 區（29 處） | seedSkeleton 首格 hero shot；buildFramePrompt「機位：」 | ✅ |
| productionDesign（architecturalStyle/materials/periodDetails/setPieces/colorScript/referenceUrls） | v3 | 美術區（24 處） | buildFramePrompt 建築/建材 | ✅ |
| atmospherics（fogDensity/dustMotes/lightShafts/precipitation/lightning/customParticles） | v3 | 大氣區（10 處） | buildFramePrompt 濃霧/光柱/粒子 | ✅ |
| soundDesign（ambientBedUrl/roomToneUrl/reverb/signatureSfx/diegeticSources） | v3 | 聲音設計區（21 處，上傳） | **seedSkeleton 把 signatureSfx 前 2 個自動展開成分鏡 sfx audioClips** | ✅ |
| realWorldRefs（GPS 座標/mapImageUrl/yearOfReference…）/ uploadedAssets / soundLibraryRefs | v4 | 真實參考區＋音效庫引用 | seedSkeleton 把 soundLibraryRefs 展開為 ambient sfx clips；visualAssetGallery | ✅ |

### 1.4 風格 Profile `WorldStyleProfile`（types.ts:661-725；UI＝StyleProfileCard）

v1/v2 欄（artStyle/palette/lighting/lensSpec/postProcessing/fps/referenceImageUrls/triggerWord/negativePrompt/linkedModelId/description）與 v3 專業欄（shootOn、schoolReference、lineSpec、shadingModel、compositingPasses、colorSpace、masterResolution、masterCodec）**全部有 UI 編輯**（實測 :2597-2733 逐一 Select/toggle）。消費端：buildFramePrompt（triggerWord/artStyle/school/palette/景深/著色/線條/拍格）、buildFrameNegativePrompt、summarizeForPrompt 技術行。

例外三欄 ❌：`letterboxing`、`subtitleSpec`、`titleCardStyle` —— 全 client/server 0 引用（僅型別＋zod），**無 UI、無消費、純 schema 定義**。

### 1.5 配樂主題 `WorldMusicTheme`（types.ts:731-784；UI＝MusicThemeCard）

v1/v2 欄（mood/instruments/bpm/timeSignature/key/applicableSceneIds/applicableCharacterIds/promptKeywords/sampleAudioUrl/description）與 v3 專業欄**全部有 UI**：leitmotif（:2839 起）、cueVariants（含音檔上傳 :3105-3128）、stems 六分軌（:3046-3054）、lufsTarget（LUFS preset 下拉 :2986）、transitionStyle（:3008）、stingerPoints（逗號分隔輸入 :3191）。消費端：seedSkeleton 按場景情緒挑主題＋cue 變體 label（借 sfxDescription 欄攜帶 `cue:` 前綴）、planPipeline generate_music step、exportShotList 配樂欄。另有 QuickGenerateButtons 的 `proStudio.textToMusic` 一鍵試做。

### 1.6 「v2 動畫擴充」落地判定（routers.ts:370 註解查證）

routers.ts 註解宣稱的 v2 範圍（三視圖、表情、穿衣、口氣、語音、腳本定位、風格 profile、配樂主題）——**8 項全部有 UI＋讀寫鏈，完整落地**；且實際已擴到 v3（rig/lipSync/acting/年齡變體/聲音檔/參考圖庫＋場景 layout/美術/大氣/聲音設計＋風格 v3＋音樂 v3）與 v4（研究資料庫/音效庫/上傳資產/真實參考）。殘洞只有：`CharacterBody` 無編輯 UI（但 buildFramePrompt 會讀）、styleProfile 三欄純 schema、objects/tags/isActive 無專屬 UI、`worldbuilding.queryEntities`（:296-554，號稱給光球代理查世界設定的文字相似度檢索）**全 repo 0 消費者**（orb 工具registry 也沒接）。

---

## 2. timeline_frames / scene_compositions 寫入路徑查證

兩表均來自 migration `drizzle/0064_timeline_frames_and_compositions.sql`，設計源頭是 `docs/plans/worldview-system-enhancements.md`（AIDV-433；建議欄 AIDV-847）。**兩表都不是空殼——寫入鏈存在且 UI 可達**，但各有一個 JSON 欄是死欄。

### 2.1 timeline_frames（schema.ts:3596-3629）

| 欄位 | 寫入者 | 判定 |
|---|---|---|
| storyboardId/sceneId/userId/timeOffsetSec/imageUrl/frameType/title/description/tags | `worldbuilding.uploadTimelineFrame`（worldbuilding.ts:643-673）→ `db.createTimelineFrame`（db.ts:3295-3302） | ✅ 完整鏈：AnimationStudio「時間軸上傳」分頁（:6618-6662，先選分鏡）→ `StoryboardTimelineUploader`（components/animation/StoryboardTimelineUploader.tsx：選 scene＋timeOffset → POST `/api/upload` 拿 URL → mutate）；刪除走 `deleteTimelineFrame`；列表 `listTimelineFrames`（timeOffsetSec decimal 以字串存、讀回 parseFloat） |
| **consistency_check_json** | `worldbuilding.checkConsistency`（:688-719）→ `db.updateTimelineFrameConsistency` | ❌×2：(1) 該 procedure 是**硬編碼 mock**（固定 overallScore 85、罐頭 issues/suggestions；註解「Vision API Phase 2 待接入」），沒有任何視覺分析；(2) 它唯一的前端消費者 `ConsistencyCheckPanel.tsx:39` 在 AnimationStudio.tsx:99 **被 import 但從未 render**（全 repo 無 `<ConsistencyCheckPanel`）——正式環境此欄實際永遠 NULL |

### 2.2 scene_compositions（schema.ts:3637-3664）

| 欄位 | 寫入者 | 判定 |
|---|---|---|
| worldId/storyboardId/userId/name/description/canvasWidth/canvasHeight/backgroundSceneId/backgroundImageUrl/elements_json | `worldbuilding.saveComposition`（:753-776）→ `db.createSceneComposition`（db.ts:3360-3367） | ✅ UI 可達：AnimationStudio「構圖助手」分頁（:6664-6675）掛 `CompositionAssistant`（canvas 拖拉 character/object/effect/text 元素，position/size/rotation/opacity/zIndex/expressionId/outfitId/pose，zod 上限 50 元素、8192px）。注意 **insert-only**：無 update procedure，每次儲存都是新列（覆蓋式編輯會累積重複列）；刪除有 `deleteComposition` |
| **ai_suggestions_json** | **無人寫入** | ❌ `getCompositionSuggestions`（:796-813，AIDV-847 已從 mock 換成真 LLM `compositionSuggestionService.ts`，失敗降級空陣列）只把建議**回傳給前端顯示，從不落 DB**；`saveComposition` 也不帶此欄 → 純 schema 欄 |

### 2.3 world_storyboards.scenesJson 逐欄（shape 定義在 `shared/worldbuilding-animation.ts`，**不是** worldbuilding-timeline.ts——後者只管上面兩張表）

`StoryboardScene`（:153-185）：id、sequenceIndex、startSec/endSec（全片絕對秒）、title、worldSceneId（繫 framework.scenes）、characterBeats[]、actionDescription、cameraDirection、transitionOut、frames[]、audioClips[]、styleProfileId/musicThemeId（覆蓋層）、status（draft→in_review→approved→rendering→rendered/needs_revision）、notes。

- `StoryboardCharacterBeat`（:59-80）：characterId、startOffsetSec、durationSec、outfitId、expressionId、pose、dialogue、innerThought、goal、interactionTags。
- `StoryboardFrame`（:88-120）：id、atSec、shotDescription、shotSize、cameraMovement、prompt/negativePrompt、三階段產物 imageUrl→refinedImageUrl→videoClipUrl、modelHints{image/refine/video}、status（queued/t2i_done/refined/i2v_done/failed）、errorMessage、seed。
- `StoryboardAudioClip`（:124-149）：kind=music|voiceover|sfx、startOffsetSec、durationSec、characterId+text（voiceover）、musicThemeId（music）、sfxDescription（sfx）、volume、fadeIn/OutSec、audioUrl、status。

scenesJson 的寫入者共 5 條（全在後端 create，**無逐場編輯 UI**，見 §3）：`worldStoryboard.create`（zod 全驗證）、`seedSkeleton`（autoSave）、`createFromSegments`（Director 腳本段落→場景，角色/地點按名字比對）、`queueForVideo`（AIDV-151，同時 seed jobsJson=queued）、`worldbuildingGeneration.generateStoryboard`；rename 走 `update`。另 4-shell 的 GuidedJourney/ScriptCanvas 經 `projectGateway.ts:311` 呼叫 createFromSegments（樂觀本地＋回寫重試）。

---

## 3. AnimationStudio 時間軸編輯器（先前未讀中段）＋ planPipeline 接線

### 3.1 「時間軸」其實是唯讀預覽，不是編輯器

分鏡細節視圖（`/video/animation/:storyboardId`，AnimationStudio.tsx:5788-5876）＝標題列（productionStatus badge、匯出鏡頭表、編排動畫管線、沉浸式模式 EarthGlobeAnimation）＋ `StoryboardTimelinePreview`（:3212-3318）＋ `PipelinePlanView`（:6888-6946）。

- **StoryboardTimelinePreview 是純顯示**：時間尺（每場一個依 startSec/endSec 定位的百分比色塊，只有 title tooltip）＋每場資訊卡（時間碼、worldScene 名、status badge、登場角色名、動作描述、🎵 配樂主題名、🎤 配音段數、「圖楨 n 格（m/n 已轉影）」）。**沒有任何拖拉、裁切、時間調整、逐格/逐音軌編輯互動**——scenes/frames/audioClips 建立後在 UI 只能整體刪除（deleteStoryboard）或重新命名（renameStoryboard=update{name}），不能逐項改。
- **音軌（music/voiceover/sfx）從何而來**：不是使用者手動擺的——`seedStoryboardSkeleton`（worldbuilding-animation.ts:1402-1720）在派生時自動 seed：按場景情緒配 musicThemes（含 cueVariants label 借 sfxDescription 攜帶）、場景 soundDesign.signatureSfx 前 2 個→sfx clips、soundLibraryRefs→ambient sfx、角色招牌台詞→voiceover clips。`createFromSegments`/`queueForVideo` 則一律 `audioClips: []`。
- 「storyboards」分頁的 `SeedStoryboardForm`（:6725-6884）是主要建立入口：名稱/總長/場數/比例（STORYBOARD_ASPECT_RATIO_PRESETS）/FPS（12/24/30/60），上方顯示六個模組串連 chips（角色/場景/風格/配樂/研究/音效 各含筆數），文案明言派生會串連 outfit/expression/scriptRole/styleProfile/musicTheme/soundDesign/研究/音效庫/製作目標。
- 「script」分頁 `ScriptEditorTab`：貼長腳本 → `director.importScript` LLM 拆段 → `worldStoryboard.create`，是第三條建分鏡路徑。

### 3.2 planPipeline 接線與斷點

- UI「編排動畫管線」按鈕（:5851-5860）→ `worldStoryboard.planPipeline`（router :284-311）→ 純函式 `planAnimationPipeline`（animation.ts:616-1000）拓樸展開步驟：每 frame `t2i($0.02)→refine($0.03)→i2v($0.12)`（skipRefine/skipVideo 可跳過）、每 audioClip `generate_music($0.08)/generate_voiceover($0.04，全量帶 voiceProfile)/generate_sfx($0.02)`、每場 `compose_audio_track`、最後 `compose_final_video($0.1)`；persist=true 時寫回 `pipelinePlanJson`＋`estimatedCostUsd`。toast 回報步驟數/估時/估價，`PipelinePlanView` 唯讀顯示（badge 統計＋Collapsible 步驟表）。
- **執行層不存在**：(1) plan 步驟的 `tool` 識別碼（`studio.generateImage`、`studio.imageToImage`、`studio.imageToVideo`、`studio.generateMusic`、`studio.generateVoice`、`studio.generateSfx`、`audio.composeTrack`、`video.composeFinal`）**在整個 server 都沒有對應 procedure**（grep 0 hit）——是為未來 orchestrator 預留的假想工具名（router 檔頭註解自承「執行交給 Director AI / 全域代理」，cross-modality-workflows.ts 也只宣告到 seedSkeleton/update）。(2) 回寫進度的 `updateJob`（:314-350，含 SEGMENT_STATUSES 狀態機驗證＋`updateWorldStoryboardJobAtomic` 原子寫）與 `updateSessionStatus`（AIDV-44 session 狀態機）**除測試外 0 呼叫者**。(3) `jobsJson` 只有 `queueForVideo` 會 seed 成 `queued`，**沒有任何 worker/輪詢消費它**。(4) `validate`、`summarizeForPrompt`（storyboard 版）也無前端消費者。⇒ **管線=「可規劃、可估價、不可執行」**；frames 的 status 永遠停在 queued，preview 的「m/n 已轉影」恆為 0。
- `finalVideoUrl`/`productionStatus` 進階狀態（generating_frames…final_compose）因此同樣無人推進；唯一非 planning 的狀態是 queueForVideo 直接寫 `in_progress`。
- **但世界觀編輯層的生成是真接的**：`QuickGenerateButtons.tsx` 包 `imageStudio.nanoBanana2/nanoBananaPro/seedreamV4/imagen4`、`videoStudio.klingImageToVideo`、`proStudio.textToMusic`、`proStudio.elevenLabsTTS`，掛在三視圖（:495）、場景建場圖（:4063）、語音試聽（:1088）——修正 01 §1.6 可能造成的印象：AnimationStudio 不是只有純文字 LLM，逐欄位的 fal 圖/語音生成存在；純文字的是 `worldbuildingGeneration` router 本身。
- `worldbuildingGeneration.generateStoryboard`（worldbuildingGeneration.ts:425-458）**名不符實**：不呼叫 LLM，只 insert 一列空分鏡（scenesJson=[]、60s、24fps、16:9、planning），名稱取 description 前 30 字。頁面代理的「生成分鏡」action 即此。
- 匯出鏡頭表：`exportShotList`（router :620-706）CSV（`@shared/csv-safe` 防公式注入，AIDV-562）逐 beat 展開順序/起訖/場景/角色/表情/穿著/對白/鏡頭/配樂，UI 前端 Blob 下載（:5701-5715，固定 csv，json 分支 UI 未用）。
- 死 import：`VisualInspirationLibraryPanel`（:92）與 `ConsistencyCheckPanel`（:99）import 後未 render；`ProductionPackagePreview`（→內含 `WorldbuildingAgentExecutionPanel`＋`buildWorldbuildingGenerationTasks` 任務清單）只掛在**導演 AI 側**的 `director/WorldbuildingPanel.tsx:448`，不在 AnimationStudio。頁面代理 action `execute_worldbuilding_task(_batch)`（:5641-5653）中 `internal_model` 模式明碼回「內建模型批次執行尚未啟用」，page_agent 模式只回 workflow preview——世界觀→批次生成的代理執行同樣未落地。

---

## 4. Studio 積木編輯器（Studio.tsx 先前未讀段）＋ customBlocks/blockCombos 全鏈

Studio 其實有**兩套互不相通的積木系統**，按 creativeMode（simple/standard/pro，pro=workspaceMode "advanced"）分層顯示：

### 4.1 系統 A：ProgressivePromptBuilder（靈感積木）—— customBlocks/blockCombos 的唯一前端消費點

- 掛載：Studio.tsx:2740（voice 模態不顯示 :2734；simple 模式有精簡版＋InspirationQuickPanel）。**全 repo 僅此一處 mount**——這就是 01 未盤到的 `customBlocks`/`blockCombos` router 消費點。
- 功能（ProgressivePromptBuilder.tsx，2032 行）：內建靈感積木依模態分類（圖像/影片/音樂/配音靈感積木）、VIBE_CARDS 氛圍卡（`@shared/types`）、rawPrompt token 解析＋Self-Attention 權重滑桿（`compileWithWeights`）、advancedFields（Subject/Action/Environment/Lighting/Camera）→ `buildCompiledPrompt`（:1200-1235：raw(權重版)+Advanced 欄+`Style: vibe labels`）。
- **customBlocks 完整鏈** ✅：`CreateBlockDialog`（:837，選類別+標籤+英文提示詞）→ `customBlocks.create`（server/routers/customBlocks.ts:14-34，zod modality/category/label≤128/prompt≤512/emoji）→ `custom_blocks` 表（schema.ts:996-1019，index userId+modality）；`list`（按模態查 :1119）；`delete`（積木角落 X :1132）。自訂積木以 `*` 前綴顯示、依 category 併入內建分類。
- **blockCombos 完整鏈** ✅：`SaveComboDialog`（:971，需已選積木/氛圍卡）→ `blockCombos.create`（blockCombos.ts:14-34）→ `block_combos` 表（schema.ts:1025-1049；blockIds=內建積木 id 字串陣列、customBlockIds=自訂積木 number 陣列、vibeCardIds）；`list`/`rename`/`delete`（:1125-1152）。套用組合（:1380-1430）重選積木＋把各積木 prompt join 成 rawPrompt＋vibe 標籤進 compiledPrompt。
- **孤兒表** ❌：`custom_blocks_combo`（schema.ts:1637-1746，S-S-L-C-M 五大類完整積木 JSON＋freeformPrompt/negativePrompt/compiledPrompt 快照＋parameterSnapshot＋brainConfigSnapshot，設計含管理員精選）——server/db.ts **無任何 CRUD**（唯一出現是 db.ts:5324 帳號刪除表名清單與 learnHub.seed.ts 教學文），無 router、無 UI。整表純 schema 定義。

### 4.2 系統 B：StructuredBlocks／思考島／負向詞（workspaces 系）

- 狀態全在 Studio.tsx useState（:450-477）：`structuredBlocks`（Record<modality, StructuredBlock[]>，StructuredBlock={fieldKey,label,value,category:required|control|correction,enabled}，預設 `getDefaultBlocks`）、`thoughtIslands`（ThoughtIsland={category,content,hint}）、`advancedPrompt`＋`advancedPromptOverride`、`negativePrompts`、`promptStrength`（low/medium/high/locked）。
- 顯示層級：`StructuredBlocksEditor` standard＋pro（:2918-2927）；`ThoughtIslandsPanel`（:2723-2731）、`PromptStrengthControl`、`ReferencePanel`、`AdvancedPromptPanel`（含負向詞欄）、`PromptCompilerPreview`（warnings/changedFields/summary）皆 **pro-only**。
- 編譯：`compilePrompt`（components/workspaces/PromptCompiler.ts:236-308，純前端）——advanced override 短路→思考島 `Context: ...`→locked 前綴「MUST follow…」→按模態欄位序（image: composition/lighting/style/subject_detail/negative…）排序＋強度修飾（`(important:)`/`((strictly:))`）→**負向詞以字面 `Negative: xxx` 併進同一字串**→append advanced。`lintPrompt` 做衝突對（realistic photography vs flat illustration 等）與模態錯欄檢查。
- **接線細節（01 未及）**：compiled 結果只在 pro（workspaceMode==="advanced"）才回寫 promptBuilder（:597-604），standard 模式下系統 B 的積木**編了不生效**（StructuredBlocksEditor 有顯示但 compile 結果不進送出 prompt）；送出時 `generate.submitMultimodalAsync` 的 `negativePrompt` 參數取的是 `imageState.negativePrompt`（ImageWorkspace 欄，:1587），系統 B 的 `negativePrompts` state 只活在編譯字串裡，不會成為 API 層負向詞參數。
- 持久化：兩系統的積木/思考島/強度/參考/負向詞以 payload 快照存 `studio_versions`（每次送出自動 `versions.create`，:663-686）與 `studio_recipes`（RecipeLibraryPanel 手動存），還原時整包 spread 回 state（:509-555）。除此之外系統 B 無獨立 DB 表。
- 「思考島」一詞對應兩個東西：輸入端 `ThoughtIslandsPanel`（上下文島）與輸出端 `ThoughtIslandChain`（:3044-3097，D3 生成進度節點鏈，可釘選節點到筆記 pin-to-notes 事件）；01 §1.4 已注記 resultUrl/thoughtChain 頁內直出是半成品。

---

## 5. 消費面補充：世界觀 → 全站注入

`WorldContextContext.tsx:144` 用 `worldbuilding.summarizeForPrompt`（含 characterPrefixes/scenePrefixes/globalNegativePrompt 字典）把當前創作專案（creative_projects.worldFrameworkId）的世界觀摘要做成 `injectIntoPrompt()`，供各 Studio 生成前注入——這是 framework JSON 欄位在世界觀系統之外最主要的活消費鏈；`director/scriptGenerationService.ts:114` 亦吃同一摘要。

## 6. 缺口清單（本波確認）

| # | 缺口 | 證據 |
|---|---|---|
| 1 | 動畫管線只到 plan，無執行器：plan tool 名稱無對應 procedure；updateJob/updateSessionStatus/jobsJson 無消費者 | worldStoryboard.ts:284-378；grep 全 repo |
| 2 | 分鏡時間軸無逐項編輯 UI（frames/audioClips/beats 建後不可改） | AnimationStudio.tsx:3212-3318、5788-5876 |
| 3 | checkConsistency 是硬編碼 mock 且其面板未掛載 → consistency_check_json 實際恆空 | worldbuilding.ts:688-719；AnimationStudio.tsx:99 |
| 4 | scene_compositions 為 insert-only（無 update），ai_suggestions_json 永不落庫 | worldbuilding.ts:753-813 |
| 5 | generateStoryboard 無 AI，僅建空列 | worldbuildingGeneration.ts:425-458 |
| 6 | queryEntities、CharacterBody 編輯、styleProfile letterboxing/subtitleSpec/titleCardStyle、custom_blocks_combo 表：定義存在、鏈路缺 | 各節 |
| 7 | Studio 系統 B 積木在 standard 模式編了不進 prompt；negativePrompts 不作為 API 負向詞參數 | Studio.tsx:597-604、1587 |

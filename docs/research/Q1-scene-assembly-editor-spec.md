# Q1 — 逐幕組裝編輯器(字卡+圖影+聲音三軌)元件級規格(規格設計 wave Q)

- 產生日期:2026-07-03
- 依據 commit:`91117649`
- 波次:**規格設計 wave Q**
- 性質:**元件級規格文件(可直接轉 Jira 卡的 acceptance criteria)**——承接 M1(軌 D:逐幕組裝編輯器)、P2(§3② 逐幕組裝畫面 UX 藍圖)、G2(StoryboardFrame/AudioClip/CharacterBeat 資料模型逐欄盤點)、02-fullstack §2.4;本文不重新診斷,只把「怎麼做」釘死到檔案/欄位/procedure 層級
- 範圍鎖定:只做**逐幕組裝編輯器**本體(M1 軌 D)。管線執行(軌 B)、kind=video adapter(軌 C)、compose 拼接(軌 E)、專案主幹統一(軌 A)、結果歸戶(軌 F)只在本文件內以「依賴關係」出現,不重新設計
- 方法:實讀 `shared/worldbuilding-animation.ts`(全 1826 行之 1-1324)、`shared/worldbuilding-timeline.ts`(全 254 行)、`server/routers/worldStoryboard.ts`(全 710 行之 1-391)、`drizzle/schema.ts`(world_storyboards/timeline_frames/scene_compositions 三表)、`shared/worldbuilding-types.ts`(WorldStyleProfile 字卡相關欄位)、`client/src/shells/video/canvas/ShotDetailCanvas.tsx`(全)、`VoiceAmbientCanvas.tsx`(全)、`MusicCanvas.tsx`(全)、`client/src/spine/projectGateway.ts`(assembleProject/loadProject 段)、`client/src/spine/ProjectSpineProvider.tsx`(genOne/generateShot 段)
- 本文件**禁止 spawn 子代理**,純研究/規格,不寫程式碼

---

## 0. 一句話定位 + 一個必須先講的勘誤

**逐幕組裝編輯器 = 一個新的、綁定 `worldStoryboard.*` procedures 與 `StoryboardScene/Frame/AudioClip`(`shared/worldbuilding-animation.ts:88-185`)的畫面,不是「把 ShotDetailCanvas 接上另一份資料」這麼簡單。**

M1/P2 兩份文件都寫「畫面軌直接沿用 ShotDetailCanvas 骨架」,這句話在**視覺互動模式**層面成立(大圖預覽 + 確認門 + 生成/核准/重生按鈕的排版與狀態機語意值得照抄),但在**資料綁定**層面必須訂正,理由如下(本波新查證,M1/P2 未深入到這層):

1. `ShotDetailCanvas` 完全綁在 `useProjectSpine()`(`client/src/spine/ProjectSpineProvider.tsx`)的 `shot` 物件上,呼叫 `computeGate`、`spine.generateShot`、`spine.approveShot`——這一整套「Shot」抽象**不是** `StoryboardFrame`。
2. 追到 `client/src/spine/projectGateway.ts:398-417` 的 `assembleProject`:`board`(來自 `worldStoryboard.listByWorld` 查詢結果)本身**已經是 `WorldStoryboard[]`(分鏡列陣列)**,`Array.isArray(board)` 為真,於是 `boardRows = board` **未經任何攤平**——即「一個 storyboard row 被硬套成一個 Shot」,`sh.shotNumber`/`sh.act`/`sh.characterIds`/`sh.assetUrl` 等欄位在 `WorldStoryboard` 型別上根本不存在,全靠 `??` 預設值墊底(空字串/`idle`/`false`)。**座艙的 `spine.project.shots` 目前對世界觀分鏡而言是一組近乎空殼的假資料,不是 `scene.frames[]` 攤平的結果。**
3. 承上,`ProjectSpineProvider.tsx` 的 `genOne`(:180-250)生成完成後只 `patchShot`/`patchProject`(純前端 state)+ 呼叫 `generate.recordGenResult`(資產庫記帳),**從未呼叫任何 `worldStoryboard.*` procedure 回寫** `scenesJson`——這正是 M1 軌 F(結果歸戶)點名的斷點,在这条路径上被本波逐行證實。

**結論(本文件的核心設計裁定)**:逐幕組裝編輯器是一個**全新元件樹**,直接讀寫 `worldStoryboard.get`/`update`(及本文件 §4 設計的細粒度 procedure),**不掛在 `useProjectSpine()`/`ShotDetailCanvas` 下面**;沿用的是 ShotDetailCanvas 的 UI 骨架與確認門語意(拷貝寫法、不共用元件實例),聲音軌沿用 `VoiceAmbientCanvas`/`MusicCanvas` 的生成表單 UI(這兩個現成 UI **確實**可原樣沿用,只是要在其 `onSuccess` 之後加一段回寫 glue——見 §4)。

---

## 1. 資料模型盤點與缺口

### 1.1 三軌現況讀寫欄位盤點(逐欄對照「幕」= `StoryboardScene`)

一「幕」是 `worldStoryboard.scenesJson` 陣列裡的一個 `StoryboardScene`(`shared/worldbuilding-animation.ts:153-185`),編輯器導覽的最小單位是**這一層**(不是 frame、也不是 storyboard 整體)。

| 軌 | 資料型別/欄位 | 現況 | 本波判定 |
|---|---|---|---|
| **字卡** | (無) | ❌ 全 repo 0 型別存在(G2 已證實;本波複查 `worldbuilding-animation.ts` 全檔,`StoryboardScene`/`StoryboardFrame`/`StoryboardAudioClip` 三型皆無任何 caption/subtitle/字卡欄位) | **淨新增欄位**,見 §1.2 裁定 |
| **畫面(圖/影)** | `StoryboardFrame.imageUrl`/`refinedImageUrl`/`videoClipUrl`/`shotDescription`/`shotSize`/`cameraMovement`/`prompt`/`negativePrompt`/`modelHints{imageModel,refineModel,videoModel}`/`status`(`queued\|t2i_done\|refined\|i2v_done\|failed`)/`errorMessage`/`seed`(:88-120) | ✅ 型別完整,✅ zod schema 完整(`storyboardFrameSchema`:286-307),❌ 無任何寫入 UI(G2 §3.1 已證實:`StoryboardTimelinePreview` 純顯示) | **欄位不缺,缺 UI 與細粒度寫入路徑** |
| **聲音** | `StoryboardAudioClip.kind`(`music\|voiceover\|sfx`)/`startOffsetSec`/`durationSec`/`characterId`/`text`/`musicThemeId`/`sfxDescription`/`volume`/`fadeInSec`/`fadeOutSec`/`audioUrl`/`status`(`pending\|generating\|ready\|failed`)(:124-149) | ✅ 型別完整,✅ zod schema 完整(:309-325),❌ 無編輯 UI(現有音軌全部由 `seedStoryboardSkeleton` 自動 seed,G2 §3.1 已證實使用者不能手動增刪改) | **欄位不缺,缺 UI 與細粒度寫入路徑** |
| **幕本身** | `StoryboardScene.title`/`worldSceneId`/`characterBeats[]`/`actionDescription`/`cameraDirection`/`transitionOut`/`styleProfileId`/`musicThemeId`/`status`/`notes`(:153-185) | ✅ 型別完整,同樣無逐項編輯 UI | 本畫面**不編輯**幕排序/`startSec`/`endSec`(見 §3.4 範圍收斂),但**編輯** `notes`(輔助字卡草擬來源之一,可選)不在 v1 範圍 |

**畫面軌與聲音軌不缺欄位,只缺(a) UI (b) 細粒度後端 procedure (c) 生成結果回寫的 glue code**——這三項就是本規格 §2-§4 的主體。字卡軌則連欄位都要新增,是本規格**唯一的資料模型淨新增項**。

### 1.2 字卡欄位抉擇(裁定,非「待研究」)

M1 軌 D4 把此題列為「二選一,待創作者實測後決定」;本規格文件的職責是**做出裁定**,理由如下:

**裁定:在 `StoryboardScene` 新增 `captionText?: string`(scene 層,非 frame 層),不在 `StoryboardFrame` 加欄位。**

理由:
1. P2 §3② 的畫面設計(`幕 S02 · 00:12~00:18` 導覽單位)本身就是以「幕」為粒度顯示單一行字卡文字,不是每個 frame 各自一行——UI 粒度已經替此題做了選擇,欄位粒度應該對齊 UI 粒度,不應該讓一幕內多個 frame 各自攜帶可能互相打架的 caption。
2. 若掛在 `StoryboardFrame`,一幕有 N 個 frame 時,「這幕的字卡」變成要跑遍 frames 取第一個非空值或另建聚合邏輯——純屬過度設計,且與 M1 §D4「不要一次做成通用字幕系統」的既有結論衝突。
3. `StoryboardCharacterBeat.dialogue`/`innerThought`(:59-80)已經是「角色在場對白/內心 OS」的字卡類欄位,語意上與「字卡」(非角色專屬、旁白/場景轉場文字)不同,**不應合併**——但 UI 可以提供「從對白帶入」一鍵動作(讀 `characterBeats[].dialogue` 或 `.innerThought` 塞進 `captionText` 草稿,使用者仍需按確認),不做資料層統一。

**新增欄位規格**:

```ts
// shared/worldbuilding-animation.ts — StoryboardScene 新增(型別 + zod schema 同步)
captionText?: string;        // max 500 字,scene 層,顯示於畫面 4 頂部字卡軌輸入框
captionStyleRef?: string;    // 指向 framework.styleProfiles[].id,讀其既有 subtitleSpec/titleCardStyle 渲染樣式
```

`captionStyleRef` **不新建樣式 schema**——直接複用 `WorldStyleProfile.subtitleSpec`(`shared/worldbuilding-types.ts:717-722`,`{font?, sizePt?, color?, outlineColor?}`)與 `titleCardStyle`(:724,`string`)。這兩欄目前是 G2 §1.4 點名的**「例外三欄之二」:全 repo 0 引用的純 schema 定義**(第三欄 `letterboxing` 與字卡無關,不動)。用 `captionStyleRef` 把它們接上消費者,是本規格附帶關掉的一個既有債務,不是額外新開工程——UI 上「樣式▾」下拉即讀取當前 storyboard 對應 world 的 `styleProfiles[].subtitleSpec/titleCardStyle` 供選。

zod 修改點(`storyboardSceneSchema`,:327-351):
```ts
captionText: z.string().max(500).optional(),
captionStyleRef: z.string().max(64).optional(),
```

不做:`captionDurationSec`/`captionStartSec` 等子區間控制(字卡預設顯示整幕時長,對齊 M1 §D4「不做 frame-accurate、不做通用字幕系統」)。

### 1.3 需要新增的欄位/表清單(彙整)

| 項目 | 位置 | 動作 |
|---|---|---|
| `captionText` | `StoryboardScene`(`shared/worldbuilding-animation.ts:153-185`) + zod(:327-351) | 新增(必要) |
| `captionStyleRef` | 同上 | 新增(必要,但值域讀既有 `WorldStyleProfile.subtitleSpec`/`titleCardStyle`,無需新表) |
| `videoClipUrl` 寫入 UI | `StoryboardFrame`(既有欄位,:88-120) | 不新增欄位,新增 UI + adapter(依賴 M1 軌 C) |
| `StoryboardAudioClip` 增刪改 UI | 既有欄位(:124-149) | 不新增欄位,新增 UI + 細粒度 procedure |
| DB migration | 無需新表——`world_storyboards.scenesJson` 是 JSON 欄(`drizzle/schema.ts:3562`),新增的 `captionText`/`captionStyleRef` 直接落在既有 JSON blob 裡,**不需要 schema migration**,只需型別/zod 更新 | 零 migration |

### 1.4 `timeline_frames`/`scene_compositions` 不涉入本規格(結論性排除)

本波複查 `drizzle/schema.ts:3596-3667` 與 `shared/worldbuilding-timeline.ts` 全檔,確認這兩張表(`TimelineFrame`/`SceneComposition`)服務的是**另一條獨立功能線**——「事後上傳參考圖做時間軸比對」與「多角色構圖畫布」(AnimationStudio「時間軸上傳」「構圖助手」分頁,G2 §2.1/§2.2),其 `sceneId`/`storyboardId` 只是鬆散外鍵,不是逐幕組裝的資料來源。**逐幕組裝編輯器讀寫的唯一資料來源是 `world_storyboards.scenesJson` 內的 `StoryboardScene.frames[]`/`.audioClips[]`**,與這兩張表無關,本規格後續章節不再提及它們。

---

## 2. 元件樹

### 2.1 掛載位置

新路由/畫面:`/video/animation/:storyboardId`(既有 AnimationStudio 分鏡細節路由,`AnimationStudio.tsx:5788-5876`)下新增一個分頁或子路由,例如 `/video/animation/:storyboardId/scene/:sceneId`——與既有 `StoryboardTimelinePreview`(純顯示,:3212-3318)並列,不取代它(時間軸全覽 vs 單幕編輯是兩種視圖,互為導覽入口:全覽點一幕 → 跳進單幕編輯;單幕編輯「返回總覽」→ 回全覽)。

### 2.2 元件樹(沿用 vs 新建標注)

```
SceneAssemblyEditor                                    【新建 · 容器/資料層】
├─ 讀 worldStoryboard.get({ id: storyboardId })         【沿用既有 procedure,worldStoryboard.ts:141-149】
├─ SceneNavBar                                          【新建 · 幕導覽列】
│   "◀ 上一幕 / 幕 S02 · 00:12~00:18 / 下一幕 ▶"
│   資料來源:sortedScenes = [...scenes].sort(a,b => a.sequenceIndex - b.sequenceIndex)
│
├─ CaptionTrackEditor                                   【新建 · 字卡軌】
│   ├─ Textarea(captionText,max 500)                    沿用 shadcn <Textarea>(既有 UI kit 元件,非新建)
│   ├─ 樣式下拉(captionStyleRef → styleProfiles[].subtitleSpec/titleCardStyle)
│   └─ 「從對白帶入」按鈕(讀 scene.characterBeats[].dialogue 草稿,非資料綁定)
│
├─ VisualTrackEditor                                    【新建外殼 + 沿用 ShotDetailCanvas 視覺/狀態機寫法】
│   ├─ 沿用:大圖預覽版面、確認門待補區塊排版(拷貝寫法,非共用元件實例——見 §0 勘誤)
│   │   參考:client/src/shells/video/canvas/ShotDetailCanvas.tsx:95-158(大圖區)、160-181(確認門)
│   ├─ 資料改綁:frame.imageUrl/refinedImageUrl/videoClipUrl/status(非 shot.gen.assetUrl)
│   ├─ kind 切換 Toggle(○圖 ●影)                        新建,依賴 M1 軌 C(kind=video adapter)
│   ├─ [重生成] [替換](上傳)[升級成影]                    重生成/替換沿用既有生成表單模式(estimateCost→submit→輪詢);
│   │                                                    「升級成影」在軌 C 未完成前顯示為 disabled + tooltip「即將推出」
│   └─ frame 選擇器(一幕可能有多個 frame,預設顯示 sequenceIndex 最小者;非本 v1 必要,可先只顯示單一 hero frame)
│
├─ AudioTrackEditor                                      【新建外殼 + 沿用 VoiceAmbientCanvas/MusicCanvas 表單 UI】
│   ├─ AudioClipList(該幕 audioClips[],依 kind 分組:配音/音樂/音效)
│   │   每筆:播放按鈕、刪除、startOffsetSec 數值輸入、volume 滑桿
│   ├─ 「+ 新增音軌」→ 選 kind → 開對應面板:
│   │   ├─ kind=voiceover/sfx → 沿用 VoiceAmbientCanvas 表單(client/src/shells/video/canvas/VoiceAmbientCanvas.tsx,全檔沿用,僅加 onSuccess 回寫 glue)
│   │   └─ kind=music         → 沿用 MusicCanvas 表單(client/src/shells/video/canvas/MusicCanvas.tsx,全檔沿用,僅加 onSuccess 回寫 glue)
│   └─ 生成中/已完成狀態徽章(沿用兩個 Canvas 既有的 CircleCheck/Loader2 視覺,§4 說明回寫時機)
│
└─ SceneAssemblyFooter                                   【新建】
    校驗提示區(§3.4 時間對齊規則命中時顯示警示,不阻擋切幕但阻擋「進到拼接預覽」)
```

### 2.3 明確不沿用的元件(避免工程實作誤植)

| 誤以為可沿用 | 實際狀況 | 正確做法 |
|---|---|---|
| `<ShotDetailCanvas />`(整個元件實例) | 綁死 `useProjectSpine()`,資料源是與 storyboard 無關的假 Shot(§0 勘誤) | 只抄視覺/狀態機寫法,重新用 `worldStoryboard.*` 資料綁定寫一份 |
| `spine.generateShot`/`spine.approveShot` | 生成結果只寫本地 state + `generate.recordGenResult`,不回寫任何 storyboard 欄位 | 逐幕組裝編輯器的生成動作走 §4 新設計的回寫路徑 |
| `StoryboardTimelinePreview` 直接加編輯互動 | 該元件是唯讀時間尺 + 卡片摘要,職責是「全覽」,加編輯互動會讓單一元件承擔兩種心智模型 | 全覽維持唯讀,單幕編輯是獨立畫面,兩者靠點擊互相導覽 |

---

## 3. 互動規格

### 3.1 字卡軌

| 動作 | 互動 | 校驗 |
|---|---|---|
| 編輯文字 | Textarea 即時輸入,失焦或停頓 600ms 後 debounce 寫入(沿用 AnimationStudio `handlePatchWorld` 已驗證過的 600ms debounce 慣例,G2 §1) | max 500 字(zod 上限一致) |
| 選樣式 | 下拉列出當前世界觀 `styleProfiles[]`,顯示 `subtitleSpec`/`titleCardStyle` 若有值的預覽文字 | 若當前世界觀無任何 profile 設定 subtitleSpec/titleCardStyle,下拉退化成「使用預設樣式」單一選項(不擋路) |
| 從對白帶入 | 讀 `scene.characterBeats[]` 中第一個有 `dialogue` 的 beat,填入 Textarea **草稿**(需再按一次確認寫入) | 不自動寫入,避免「靜默覆蓋創作者已打的字卡」 |
| 清空 | 「清除字卡」按鈕 → `captionText` 設為 `undefined` | 不需要額外校驗 |

### 3.2 畫面軌(圖/影)

| 動作 | 互動 | 對應狀態 |
|---|---|---|
| 生成(初次) | frame.status 為 `queued` 時顯示「生成(先估成本)」,沿用 ShotDetailCanvas 的估價→扣點→佇列敘事 | `queued` → `t2i_done` |
| 重生成(同 seed) | frame.status 為 `t2i_done`/`refined`/`i2v_done` 且非過期時顯示「同 seed 重生」 | 保持同 `seed`,產生新 `imageUrl` |
| 切換 kind=image/video | Toggle 按鈕,選 video 時呼叫既有 i2v procedure(輸入=當前 `imageUrl` 當首幀),依賴 M1 軌 C adapter 完成 `kind==="video"` case(`client/src/adapters/generation.trpc.ts:117-122` 目前丟 `AdapterPendingError`) | 完成時寫 `videoClipUrl`,`status` → `i2v_done` |
| 升級成影(未達依賴前) | 按鈕 disabled + tooltip「i2v 轉接器尚未上線(M1 軌 C)」——**誠實待後端徽章**,不假裝可用(對齊 M1 §6-4 座艙既有文化) | 不呼叫任何 procedure |
| 替換(上傳) | 上傳自有圖檔取代 `imageUrl`,走既有 `/api/upload` → 拿 URL → 寫回 | `status` 保持或視情況設回 `t2i_done` |
| 失敗重試 | `status === "failed"` 時顯示錯誤訊息(`errorMessage`)+ 重試按鈕 | 沿用既有「單鏡重生成」語意(M1 §B4-4 已確認不必新設計) |

### 3.3 聲音軌(配音/音樂/音效)

| 動作 | 互動 | 校驗 |
|---|---|---|
| 列表顯示 | 依 `kind` 分三組(配音🎤/音樂🎵/音效🔊),每組列出 `audioClips[]` 中對應 kind 的項目,顯示 `startOffsetSec→startOffsetSec+durationSec`、`volume`、播放/刪除按鈕 | — |
| 新增 | 「+ 新增音軌」→ 選 kind → 開 `VoiceAmbientCanvas`(voiceover/sfx)或 `MusicCanvas`(music)既有表單,填完送出後產生一筆 `status="generating"` 的 clip 佔位,等 fal 任務完成後回填 `audioUrl`+`status="ready"`(§4 詳細回寫時序) | 送出前沿用兩個 Canvas 既有的「估算成本→確認生成」兩步驟 |
| 刪除 | 刪除按鈕 → 從 `audioClips[]` 移除該筆(不影響已產生的 fal 任務,僅移除本地引用) | 需二次確認(避免誤刪已生成音檔) |
| 調時間偏移 | `startOffsetSec` 數值輸入框(非拖曳,對齊 M1 §D4「輕量數值輸入,非 DAW 級」) | 即時校驗:`0 ≤ startOffsetSec` 且 `startOffsetSec + durationSec ≤ scene.endSec - scene.startSec`(見 §3.4) |
| 調音量 | `volume` 滑桿 0-1 | 對應 zod `volume: z.number().min(0).max(1)` |

### 3.4 三軌時間對齊校驗規則

沿用 M1 §6-3 既有設計要求(「`atSec`/`sequenceIndex` 是幕的唯一排序依據,三者都以此排序,不各自維護一份順序邏輯」),本規格把它落實成具體校驗:

1. **幕的時間基準**:`sceneLengthSec = scene.endSec - scene.startSec`,是本畫面三軌共享的唯一長度基準。
2. **畫面軌**:`frame.atSec` 必須 `≤ sceneLengthSec + 0.01`(沿用既有 `validateStoryboardTimeline` 的容差寫法,`shared/worldbuilding-animation.ts:413-418`)。
3. **聲音軌**:`clip.startOffsetSec + clip.durationSec ≤ sceneLengthSec + 0.01`——輸入時即時校驗(前端擋下不合法輸入,顯示「超出本幕時長 Xs」),**不是等存檔後才由 `worldStoryboard.validate` 抓到**(現況 `validate` 是唯讀 query,需手動呼叫;本畫面把同一條規則前移到輸入框層級即時擋)。
4. **幕本身的順序**(`sequenceIndex`/`startSec`/`endSec`)**不在本畫面調整**——這是分鏡重排的職責,回到 `StorySpineColumn` 或 P2 §3③ 拼接預覽處理,逐幕組裝編輯器只編輯「幕內部」三軌內容,不編輯「幕與幕之間」的順序(對齊 P2 §3② 防跑偏條款,避免範圍蔓延)。
5. **校驗失敗不阻擋離開**:切換上一幕/下一幕不因校驗失敗被擋(創作者可以先切走,晚點回來修),但§進到拼接預覽前(P2 §3③)必須無校驗失敗——此為跨畫面規則,本文件只定義校驗本身,不重新設計拼接預覽門檻(該畫面設計屬 P2 範圍)。

---

## 4. 接線(每個編輯動作 → tRPC procedure)

### 4.1 讀取

| 動作 | procedure | 備註 |
|---|---|---|
| 載入整份分鏡(進畫面時) | `worldStoryboard.get({ id: storyboardId })` | 既有,`worldStoryboard.ts:141-149`,回傳含 `scenes[]`(含 `frames[]`/`audioClips[]`) |
| 找出當前幕 | 前端從 `scenes` 陣列以 `sceneId` 過濾,不需要新 query | — |

### 4.2 字卡軌寫入

**首個 PR(最小可交付)**:沿用既有 `worldStoryboard.update`(:174-212)——前端讀出整份 `scenes[]`,把當前幕的 `captionText`/`captionStyleRef` patch 進去,整包 `scenes` 陣列送 `update({ id, patch: { scenes } })`。這是 M1 §D4-3 已預告的「近期先用整包 patch」路線,**不需要新 procedure 就能上線**。

**中期升級(細粒度,設計但非首個 PR 必要)**:

```ts
// server/routers/worldStoryboard.ts 新增
updateScene: protectedProcedure
  .input(z.object({
    id: z.number().int().positive(),
    sceneId: z.string().min(1),
    patch: z.object({
      captionText: z.string().max(500).optional(),
      captionStyleRef: z.string().max(64).optional(),
      notes: z.string().max(2000).optional(),
    }),
  }))
  .mutation(async ({ ctx, input }) => {
    // load row → ownership check → scenes.map(s => s.id===sceneId ? {...s, ...patch} : s)
    // → db.updateWorldStoryboard(id, { scenesJson: nextScenes })
  }),
```

底層儲存仍是整個 `scenesJson` 欄位覆寫(JSON 欄本質如此),但**API 合約**是細粒度(呼叫端只送單一幕的 diff,不必自己組裝整個 `scenes` 陣列),降低前端誤覆蓋其他幕資料的風險。

### 4.3 畫面軌寫入

| 動作 | 生成呼叫 | 回寫 procedure |
|---|---|---|
| 生成/重生 kind=image | `client/src/adapters/generation.trpc.ts` 既有圖片生成骨架(estimateCost→submitStudioJob→輪詢→assetUrl) | 完成後呼叫 `worldStoryboard.upsertFrame`(新設計,見下)或首個 PR 期沿用整包 `update` |
| 生成 kind=video | 依賴 M1 軌 C:`generation.trpc.ts` 新增 `kind==="video"` case → 呼叫既有 videoStudio i2v procedure(輸入 `frame.imageUrl` 當首幀) | 同上,寫 `videoClipUrl` |
| 底層生成引擎(若走光球/pipeline 而非座艙直接呼叫) | `studio.generateImage`/`studio.generateVideo`(`server/services/agentToolExecutor.ts:1049`/`:1280`,confirmed 可達的 `dispatchStudioTool` case) | 同上 |

新設計的細粒度 procedure(中期):

```ts
upsertFrame: protectedProcedure
  .input(z.object({
    id: z.number().int().positive(),
    sceneId: z.string().min(1),
    frame: storyboardFrameSchema.partial().extend({ id: z.string().min(1) }),
  }))
  .mutation(async ({ ctx, input }) => {
    // load row → 找 scene → frames: 若 frame.id 已存在則 merge patch,否則 push 新 frame
    // → db.updateWorldStoryboard(id, { scenesJson: nextScenes })
  }),

deleteFrame: protectedProcedure
  .input(z.object({ id: z.number().int().positive(), sceneId: z.string(), frameId: z.string() }))
  .mutation(/* 同模式,從 frames[] 移除 */),
```

### 4.4 聲音軌寫入(含關鍵 glue code 缺口)

**現況**:`VoiceAmbientCanvas`/`MusicCanvas` 呼叫的是 `proStudio.qwenTTS`/`proStudio.elevenLabsTTS`/`proStudio.soundEffects`/`proStudio.textToMusic`(四個既有、真實可用的 procedure,VoiceAmbientCanvas.tsx:69-71、MusicCanvas.tsx:29),送出後只拿到 `{ request_id, estimated_credits }`,**完全不帶 `storyboardId`/`sceneId`/`audioClipId` 上下文**,完成結果只落 `background_jobs` + 資產庫,不回寫任何 storyboard 欄位。

**必要新增的 glue(本規格範圍內、非額外大工程,但是首個真正要寫的新程式碼)**:

1. 送出生成請求前,先在該幕的 `audioClips[]` 建立一筆 `status: "generating"` 的佔位 clip(呼叫 §4.2 同款整包 `update` 或新 `upsertAudioClip`),把 `request_id` 暫存在前端 state(不需要新欄位存 requestId——沿用既有 `background_jobs` 輪詢慣例,前端輪詢 `generate.myJobs`/`jobStatus` 比對 `request_id`)。
2. 輪詢偵測到該 `request_id` 完成後(既有 `AgentProgressPanel`/`ActiveVideoTasksBanner` 已有的輪詢骨架,`server/routers/generate.ts:2143` `submitStudioJob` 同一套追蹤),呼叫回寫 procedure 把 `audioUrl`/`status: "ready"` 填回對應 `audioClipId`。
3. 若輪詢逾時或失敗,把該 clip `status` 改 `"failed"`,UI 顯示可重試。

新設計的細粒度 procedure(中期):

```ts
upsertAudioClip: protectedProcedure
  .input(z.object({
    id: z.number().int().positive(),
    sceneId: z.string().min(1),
    clip: storyboardAudioClipSchema.partial().extend({ id: z.string().min(1) }),
  }))
  .mutation(/* 同 upsertFrame 模式,操作 audioClips[] */),

deleteAudioClip: protectedProcedure
  .input(z.object({ id: z.number().int().positive(), sceneId: z.string(), clipId: z.string() }))
  .mutation(/* 同模式 */),
```

**重要澄清(避免工程實作混淆兩條平行的生成呼叫路徑)**:本系統同時存在兩條「生成」呼叫路徑——(a) `proStudio.*`(給座艙/Studio 面板使用者直接手動觸發,VoiceAmbientCanvas/MusicCanvas 走這條)與 (b) `studio.*`(給光球代理/`executeOrbToolCalls`/pipeline runner 呼叫,`agentToolExecutor.ts:986` `dispatchStudioTool`)。**逐幕組裝編輯器的聲音軌沿用 (a) proStudio.\* 路徑**(因為 UI 表單已經是現成的,直接沿用),不需要繞道 (b) studio.\*——(b) 是軌 B pipeline runner 的呼叫路徑,兩者服務不同呼叫者,本規格不混用。

### 4.5 procedure 對照總表

| 編輯動作 | 讀 | 寫(首個 PR 可用) | 寫(中期細粒度,本文件設計) |
|---|---|---|---|
| 載入畫面 | `worldStoryboard.get` | — | — |
| 字卡文字/樣式 | — | `worldStoryboard.update`(整包 scenes patch) | `worldStoryboard.updateScene` |
| 畫面軌生成 kind=image | — | `generation.trpc.ts` 既有骨架 + `worldStoryboard.update` | `worldStoryboard.upsertFrame` |
| 畫面軌生成 kind=video | — | 依賴軌 C adapter + `worldStoryboard.update` | `worldStoryboard.upsertFrame` |
| 畫面軌刪除/替換 | — | `worldStoryboard.update` | `worldStoryboard.upsertFrame`/`deleteFrame` |
| 聲音軌新增(送出生成) | — | `proStudio.qwenTTS`/`elevenLabsTTS`/`soundEffects`/`textToMusic` + 佔位 `worldStoryboard.update` | 同左 + `upsertAudioClip` |
| 聲音軌完成回寫 | 輪詢 `generate.myJobs`/`jobStatus` | `worldStoryboard.update` | `worldStoryboard.upsertAudioClip` |
| 聲音軌刪除/調偏移/調音量 | — | `worldStoryboard.update` | `worldStoryboard.deleteAudioClip`/`upsertAudioClip` |

---

## 5. 狀態/防跑偏(所有寫入鎖在 storyboardId+frameId,禁止跨幕污染)

1. **每個 mutation 必要輸入雙鍵**:所有新設計的 procedure(`updateScene`/`upsertFrame`/`deleteFrame`/`upsertAudioClip`/`deleteAudioClip`)一律要求 `{ id: storyboardId, sceneId, ...}`(frame/clip 類再加 `frameId`/`clipId`),**不接受「當前作用中的幕」這種前端隱式推斷**——對齊 M1 §6-1 已定的「不接受『使用者最新一筆』這種隱式推斷」原則,理由同樣是要杜絕 `VideoProjectLifecycleCard` 錯配讀法(G1 §1.6)那類反例。
2. **後端寫入前先做 ownership + 存在性雙重檢查**:沿用既有 `update`/`updateJob` 的寫法(`row.userId !== ctx.user.id` → `NOT_FOUND`;`scenes.find(s => s.id === sceneId)` 找不到 → 明確拋錯,不是靜默 no-op)。
3. **前端狀態绑定用 `sceneId` 當 key,不是陣列 index**:`scenes` 陣列若因其他操作(如拼接預覽的排序調整)重排,以 index 綁定會指錯幕;所有內部 state(`useState`/`useMemo`)一律以 `scene.id`/`frame.id`/`clip.id` 為 key。
4. **JSON 欄位 read-modify-write 的併發風險(本規格明確標注、不解決)**:`updateScene`/`upsertFrame`/`upsertAudioClip` 三者都對同一個 `scenesJson` 欄位做「讀整包→改一小塊→整包寫回」,若同一使用者開兩個分頁同時編輯同一幕,後寫入者會覆蓋先寫入者(無版本號/樂觀鎖)。本規格判定:**單創作者情境下風險可接受,不在首個 PR 解決**,若之後要處理,建議在 `world_storyboards` 表加 `version` 欄做樂觀鎖(比較欄位,非本規格範圍,留給後續卡)。
5. **生成中狀態不可被字卡/樣式編輯打斷**:畫面軌/聲音軌某筆處於 `generating`/`queued` 時,對應項目的刪除按鈕應 disable(避免刪除一筆正在跑的 fal 任務導致孤兒 `request_id` 找不到回寫目標)。
6. **誠實徽章原則貫穿三軌**:kind=video 在軌 C 未上線前必須顯示「待後端」而非讓按鈕可點但實際丟 `AdapterPendingError`(沿用 M1 §6-4 既有座艙文化);同理,若中期細粒度 procedure 尚未實作,字卡/畫面/聲音三軌一律先用「整包 `update`」頂著,**不可在 UI 上宣稱已是細粒度儲存**。
7. **幕際順序與幕內三軌的編輯範圍嚴格分離**(重申 §3.4-4):本編輯器的所有 mutation 都不觸碰 `sequenceIndex`/`startSec`/`endSec`,避免與 P2 §3③ 拼接預覽的排序邏輯打架。

---

## 6. 首個 PR 拆分

### 6.1 裁定:先字卡軌,理由

字卡軌 vs 畫面軌兩者選一先做,本規格裁定**先字卡軌**,理由:

1. **零依賴外部軌**:字卡軌不依賴 M1 軌 C(kind=video adapter 尚未完成),而畫面軌的「影」半邊做了也用不了,只能先做「圖」半邊——但圖半邊仍要複製一份 ShotDetailCanvas 生成骨架(estimateCost→submit→輪詢),工程量遠大於字卡軌。
2. **零 migration、零新 procedure 即可上線**:字卡軌用整包 `worldStoryboard.update` 就能完整跑通「輸入→存檔→重新整理頁面,改動還在」這個 P2 §5 定義的中期 demo 標準的**簡化版**(先驗證讀寫迴圈,不需要生成引擎介入)。
3. **驗證「幕級 UI 容器」骨架**:`SceneAssemblyEditor`/`SceneNavBar` 這兩個所有三軌共用的外殼,可以用字卡軌這個最簡單的子元件先把資料流(讀 `get`→本地 draft→debounce 寫 `update`→重新讀)跑穿,畫面軌/聲音軌之後接進同一個外殼,不必重新設計容器層。

### 6.2 首個 PR 具體範圍(檔案級)

1. `shared/worldbuilding-animation.ts`:`StoryboardScene` 型別 + `storyboardSceneSchema` 新增 `captionText`/`captionStyleRef` 兩欄(§1.2)。
2. 新增 `client/src/shells/video/canvas/SceneAssemblyCanvas.tsx`(或依實際路由掛載位置命名):
   - 讀 `worldStoryboard.get({ id })`,本地 state 存 `scenes[]`
   - `SceneNavBar`(依 `sequenceIndex` 排序,上一幕/下一幕切換 `currentSceneId`)
   - `CaptionTrackEditor`(Textarea + debounce 600ms + 樣式下拉,樣式下拉讀取當前世界觀 `styleProfiles[]` 的 `subtitleSpec`/`titleCardStyle`)
   - 送出時組裝整包 `scenes`(把當前幕的 patch merge 進去)呼叫 `worldStoryboard.update({ id, patch: { scenes } })`
3. `client/src/shells/video/canvas/ShotDetailCanvas.tsx`:**不改動**(僅供視覺參考,§0 已定不共用實例)。
4. 測試:新增 `SceneAssemblyCanvas.test.tsx`,涵蓋(a) 載入顯示當前幕字卡 (b) 編輯後 debounce 觸發 `update` mutation (c) 樣式下拉在世界觀無 `subtitleSpec` 時降級為「使用預設樣式」單一選項 (d) 上一幕/下一幕切換後草稿正確歸零(不殘留前一幕文字)。

### 6.3 不在首個 PR 範圍

- 畫面軌(等軌 C 或至少先做「只生圖不生影」的簡化版,列為第二個 PR)
- 聲音軌(§4.4 的 glue code 工程量較大——需要輪詢+回寫,列為第三個 PR)
- §4.2-4.4 所有「中期細粒度 procedure」(`updateScene`/`upsertFrame`/`deleteFrame`/`upsertAudioClip`/`deleteAudioClip`)——首個 PR 全部用整包 `update` 頂著
- §5-4 的樂觀鎖/`version` 欄——留待後續卡

### 6.4 首個 PR 的可展示 demo(對齊 M1 §6-7 每個里程碑都要有 demo 的要求)

創作者打開一個已有分鏡的專案,進入任一幕,輸入一句字卡文字,選一個樣式(若世界觀有設定),切到下一幕再切回來,字卡文字與樣式選擇都還在(證明真的寫進 `scenesJson` 而非只是本地 state)。

---

## 附:一句話重用地圖

| 資源 | 路徑 | 在本規格中的角色 |
|---|---|---|
| 幕/畫面/聲音資料模型 | `shared/worldbuilding-animation.ts:88-185` | 三軌讀寫的唯一權威型別 |
| 分鏡讀寫 procedure | `server/routers/worldStoryboard.ts:141-149`(get)、:174-212(update) | 首個 PR 唯一需要的後端接線 |
| 字卡樣式值域(既有死欄復活) | `shared/worldbuilding-types.ts:717-724`(`subtitleSpec`/`titleCardStyle`) | `captionStyleRef` 的讀取來源,零新 schema |
| 畫面軌視覺參考(非共用實例) | `client/src/shells/video/canvas/ShotDetailCanvas.tsx` | 大圖/確認門排版抄寫對象 |
| 聲音軌生成表單(原樣沿用) | `client/src/shells/video/canvas/VoiceAmbientCanvas.tsx`、`MusicCanvas.tsx` | proStudio.* 送出表單,加 onSuccess 回寫 glue |
| 座艙「Shot」資料綁定(本波證實不可沿用) | `client/src/spine/projectGateway.ts:398-417`、`client/src/spine/ProjectSpineProvider.tsx:180-250` | 反例:說明為何不能直接掛在 `useProjectSpine()` 下面 |
| 光球可達生成工具(軌 B/C 用,本畫面聲音軌不用) | `server/services/agentToolExecutor.ts:1049,1280,1423`(`studio.generateImage/generateVideo/generateAudio`) | 澄清用,避免與 `proStudio.*` 路徑混淆 |

---

## 未查證/未涵蓋部分

1. **`upsertFrame`/`upsertAudioClip` 等中期細粒度 procedure 尚未實際撰寫程式碼**——本文件只給出設計簽名與行為描述,實作時的 race condition 細節(例如同時 upsertFrame 又 upsertAudioClip 兩個請求交錯)未逐一推演,建議實作時在 `db.updateWorldStoryboard` 那層做單一 mutex 或至少 `SELECT ... FOR UPDATE`(若底層 MySQL 支援,需查證 `server/db.ts` 現有 `updateWorldStoryboardJobAtomic` 是否已有可借用的原子寫模式——本波未深入 `db.ts` 該函式實作)。
2. **`captionStyleRef` 下拉的 UI 呈現細節**(例如是否要即時渲染字卡預覽套用 font/color)未設計,只定義資料綁定,視覺呈現留給落地時決定。
3. **`proStudio.*` 四個生成 procedure 的 `request_id` 與 `background_jobs` 表的確切關聯欄位**(本文件假設可用既有 `generate.myJobs`/`jobStatus` 輪詢比對,但未逐行核對 `proStudio.qwenTTS` 等 mutation 內部是否真的把 `request_id` 寫進 `background_jobs.resultJson` 供之後查詢——只在 `studio.generateAudio` 的 Suno 分支見到明確的 `createBackgroundJob`/`jobId` 關聯寫法,`agentToolExecutor.ts:1443-1465`,`proStudio.*` 路徑本身未逐行核查)。
4. **多分頁併發編輯同一幕的實際發生機率與影響**——§5-4 判定「風險可接受」是基於「單創作者情境」的假設,未與 Bruce 核對是否有多人協作情境會提前踩到這個坑。
5. **`captionText` 是否需要跟著 `resolveNarrativeBeat`(既有敘事節拍推導,:1027-1038)自動草擬一句起手式**——P2 §4.1「下一步建議卡」曾提及類似「用對白草擬一句字卡」的光球提示,本規格只設計「從對白帶入」的手動按鈕,AI 自動草擬字卡的光球介接留給 AI 引導層(P2 §4)之後的卡處理,不在本規格範圍。

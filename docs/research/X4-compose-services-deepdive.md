# X4 — 拼接/合成服務(video/audio/voice Compiler)逐行深挖(地毯掃描 wave X)
- 產生日期:2026-07-03
- 依據 commit:812f6fdb
- 稽核檔案:server/services/videoCompiler.ts(1500)、server/services/audioCompiler.ts(951)、server/services/voiceCompiler.ts(1038)

> 前置聲明(先讀檔後判斷):任務單要求聚焦「M1 compose/拼接」的 ffmpeg/外部合成呼叫、逾時、暫存檔
> 清理、SSRF(下載素材 URL)、大檔記憶體風險、指令注入(shell/ffmpeg 參數)。逐行讀完三檔並對
> `fs.`、`writeFile`、`unlink`、`tmpdir`、`mkdtemp`、`createWriteStream`、`child_process`、`spawn`、
> `execFile`、`exec(`、`ffmpeg` 做全文比對後結果為**零命中**——這三個檔案**不是**會呼叫 ffmpeg 或
> 拼接實體媒體檔案的服務。它們是「積木 JSON → 結構化提示詞/SSML 字串」的**純函式編譯器**
> (video/audio 兩支完全無 I/O;voice 額外含一段直連 ElevenLabs/Google Cloud TTS 的 HTTP/SDK 呼叫,
> 但同樣不含 ffmpeg、不含暫存檔)。因此本報告不臆測任何 ffmpeg/暫存檔清理機制存在,轉而針對
> 「這三支編譯器實際在做什麼、實際被誰呼叫、輸出是否真的被下游採用」逐行核實,並把發現對應到
> 任務單指定的 cluster 分類。跨檔佐證(`server/routers/videoStudio.ts`、`server/routers/proStudio.ts`、
> `server/services/compilerValidation.ts`)僅作為「誰呼叫本檔案」的可達性佐證,不重複審計該檔案
> 自身邏輯。

---

## 摘要

三支編譯器中,`videoCompiler.ts`(→ `server/routers/videoStudio.ts:520`)與 `audioCompiler.ts`
(→ `server/routers/proStudio.ts:1858`)確實被生產路由呼叫,輸出的 `prompt`/`styleTag` 字串會送進
fal.ai 的影片/音樂生成模型。`voiceCompiler.ts` 則相反:全站只有 `parseVoiceBlockPrompt()` 這個
20 行工具函式被 `proStudio.ts` 引用,整個 SSML 編譯管線(`compile()`/`resolveEmotion()`/
`splitIntoSegments()`)與直連 ElevenLabs/Google TTS 的 `synthesizeSpeech()` 系列方法(約 260+ 行,
佔全檔 1/4)在生產路由中**完全沒有呼叫點**——實際語音合成走的是完全不同的 fal.ai 代理路徑
(`proStudio.ts:elevenLabsTTS`),送出的是使用者原始文字而非本檔編譯出的 SSML。

三項主要發現:

1. **VideoCompiler 的「視角跳躍阻擋」(Camera Vector Binder)機制自我矛盾且是純裝飾**——
   `CAMERA_VECTORS` 裡沒有任何一個運鏡模式把自己列入 `allowedTransitions`(即「維持同一運鏡」永遠
   被判定為非法轉場),而 `buildShots()` 產生的多鏡頭序列的中間鏡頭恰好都沿用同一個
   `cameraVector.promptFragment`——這代表**任何 `targetDurationSec > 8` 秒的多鏡頭輸出必定觸發
   假陽性 `jumpBlockCount`**;更嚴重的是,`compile()` 的「修正」只改寫 `shots[i].cameraMotion`
   欄位,而實際組進最終 `prompt` 字串的是早於此步驟就已定案的 `shots[i].prompt`——所以就算某天真
   的偵測到跳躍,這個「阻擋」機制也**從未真正改變送去 AI 影片模型的文字**,是全程無效的安全機制。
2. **VoiceCompiler 的 SSML 組裝在多處欄位上完全沒有逸出**——引號外的劇本文字(佔多數 EmotionProfile
   的 `emphasisLevel`)、以及使用者可直接控制的 `rateOverride`/`resolvedCustomProfile`,都是原樣
   字串樣板插入 `<prosody rate="...">`/`<break time="...">` 屬性,沒有走 `escapeSSML()`。這是可驗證
   的 SSML/XML 屬性注入,但因發現 1 的「整條管線目前無人呼叫」而暫時無法從任何生產端點觸發。
3. 三檔本身皆不含使用者身分(`userId`/`ownerId`)、資料庫存取、計費/退款呼叫——這類風險正確地被
   放在呼叫端路由(`videoStudio.ts`/`proStudio.ts`),不在本次稽核檔案範圍內;抽查的兩個呼叫點也
   確認了「先 `compile()` 後扣點」的安全順序(compiler 拋錯不會造成先扣點後失敗的退款缺口)。

以下依嚴重度列出發現、影響與建議,文末列出本次已查證、可排除的疑慮(negative results)。

---

## High

### H1. VideoCompiler「阻擋視角跳躍」機制:自我轉場永遠不合法 + 修正不影響實際輸出字串

**發現(附行號)**

`CAMERA_VECTORS`(videoCompiler.ts:467-655)逐一列出 16 種運鏡模式,每一筆 `allowedTransitions`
都**不包含自己的 id**。例如:

```ts
// videoCompiler.ts:492-502
dolly_in: {
  id: "dolly_in",
  ...
  allowedTransitions: ["static", "dolly_out", "orbit", "push_in"], // 無 "dolly_in"
  ...
},
```

16 筆逐一核對(static/dolly_in/dolly_out/pan_left/pan_right/tilt_up/tilt_down/orbit/crane_up/
crane_down/tracking/handheld/aerial_descent/aerial_ascent/push_in/pull_out)全數如此,無一例外。

`buildShots()`(videoCompiler.ts:1240-1331)在多鏡頭分支(`totalDuration > 5`)中,除了首尾鏡頭外,
中間鏡頭一律沿用同一個 `cameraVector.promptFragment`:

```ts
// videoCompiler.ts:1300-1308
let shotCamera: string;
if (isFirst) {
  shotCamera = cameraVector.promptFragment;
} else if (isLast) {
  shotCamera = endCamera.promptFragment;
} else {
  shotCamera = cameraVector.promptFragment;   // 與首鏡頭完全相同的運鏡片段
}
```

`compile()` Step 7(videoCompiler.ts:1128-1146)逐一比對相鄰鏡頭的運鏡:

```ts
// videoCompiler.ts:1129-1146
for (let i = 1; i < shots.length; i++) {
  const prevCamera = this.extractCameraMode(shots[i - 1].cameraMotion);
  const currCamera = this.extractCameraMode(shots[i].cameraMotion);
  if (prevCamera && currCamera) {
    const validation = this.validateCameraTransition(prevCamera, currCamera);
    if (!validation.valid) {
      jumpBlockCount++;
      log.push(`[VideoCompiler] ⚠️ 視角跳躍阻擋 Shot ${i}: ${validation.reason}`);
      shots[i].cameraMotion = cameraVector.promptFragment;   // 「修正」
    }
  }
}
```

由於中間鏡頭與前一鏡頭的 `cameraMotion` 字串完全相同,`extractCameraMode` 對兩者解析出**同一個
id**,`validateCameraTransition(id, id)` 因為 `allowedTransitions` 不含自身而必定回傳
`valid: false`——即「鏡頭沒有換運鏡」被系統誤判為「視角跳躍」。當 `targetDurationSec > 8`
(此時 `shotCount = min(ceil(duration/4), 5) >= 3`,見 videoCompiler.ts:1275)時,必然出現至少一組
中間鏡頭對中間鏡頭的比較,`jumpBlockCount` 必為正值。

更關鍵的是:上面「修正」只改寫 `shots[i].cameraMotion`,但最終送給 AI 影片模型的文字來自
`assemblePrompt()`,它只讀取 `shot.prompt`(在 `buildShots()` 裡於 Step 7 執行**之前**就已經用
`formatShotPrompt()` 定案),完全不讀 `shot.cameraMotion`:

```ts
// videoCompiler.ts:1386-1392（assemblePrompt 節錄）
if (shots.length === 1) {
  lines.push(shots[0].prompt);
} else {
  for (const shot of shots) {
    lines.push(`[Shot ${shot.shotNumber}] ${shot.prompt}`);   // 只用 .prompt，不用 .cameraMotion
  }
}
```

**影響**

- 檔頭註解宣稱的「Camera Vector Binder — 穩定光學運鏡約束,阻擋視角跳躍」在目前實作下對「維持
  同一運鏡的正常多鏡頭序列」100% 誤判為跳躍;`jumpBlockCount`(經 `videoStudio.ts:545` 原樣回傳給
  前端)因此對任何 >8 秒的合成請求都會回報「有跳躍被擋」,但實際上什麼都沒發生也什麼都沒被擋。
- 即使未來真的出現需要糾正的跳躍,目前寫回的欄位(`cameraMotion`)也不會被 `assemblePrompt()`
  讀取——這個「安全機制」對外部使用者看到的最終合成提示詞**沒有任何實際效果**,只是往
  `compilationLog`/`jumpBlockCount` 寫入誤導性的診斷資訊。
- 產品面:使用者/客服若依賴 `jumpBlockCount` 判斷「這次生成的運鏡是否穩定」,得到的訊號完全不可信。

**建議**

1. 在 `validateCameraTransition` 或呼叫端補上「相同 id 視為合法(維持運鏡)」的短路判斷,或在
   `CAMERA_VECTORS` 定義時明確把自身 id 併入 `allowedTransitions`。
2. 若 Step 7 判定確實需要修正運鏡,應同步重建該鏡頭的 `prompt` 欄位(重新呼叫
   `formatShotPrompt()`),而不是只改 `cameraMotion` 中繼欄位。
3. 建議補一條單元測試:對 `targetDurationSec=12`(3 鏡頭)組譯後斷言 `jumpBlockCount === 0`,
   目前應會直接失敗,可作為此問題的迴歸測試起點。

---

### H2. VoiceCompiler:`rateOverride` 與 `resolvedCustomProfile` 未經逸出直接嵌入 SSML 屬性,可跳脫屬性注入任意標籤

**發現(附行號)**

`rateOverride` 是使用者輸入欄位,schema 只限制長度、不限字元集:

```ts
// compilerValidation.ts:115
rateOverride: z.string().max(20).optional(),
```

`compile()` 直接把它指派進 `effectiveProfile.rate`,沒有任何字元過濾:

```ts
// voiceCompiler.ts:877-881
const effectiveProfile = { ...profile };
if (input.rateOverride) {
  effectiveProfile.rate = input.rateOverride;
  compilationLog.push(`[VoiceCompiler] ⏩ 語速覆寫: ${input.rateOverride}`);
}
```

`compileSegment()` 的每一個分支都把 `profile.rate`/`profile.pitch`/`profile.volume`
以樣板字串方式直接插入屬性值,完全沒有呼叫 `escapeSSML()`:

```ts
// voiceCompiler.ts:668-671（default 分支，其餘 exclamation/question/whisper/emphasis/dialogue 分支同樣模式）
return (
  `<prosody rate="${profile.rate}" pitch="${profile.pitch}" volume="${profile.volume}">${content}</prosody>` +
  `<break time="${profile.sentenceBreakMs}ms"/>`
);
```

只要 `rateOverride` 內含一個雙引號即可跳脫 `rate="..."` 屬性、提前閉合 `<prosody>` 並插入自訂標籤
片段(20 字元上限雖限制單次注入長度,但已足以插入如 `X"/><break t="` 之類跳脫序列,破壞既有 XML
結構或插入額外的自訂停頓/韻律標籤)。

同一路徑的第二個入口是 `resolvedCustomProfile`,schema 完全不限型別/形狀:

```ts
// compilerValidation.ts:118
resolvedCustomProfile: z.record(z.string(), z.unknown()).optional(),
```

`resolveEmotion()` 在 `moodBlock.isCustom === true` 時,直接把它整包丟給 `mergeEmotionProfile()`,
**繞過**同檔案內本來設計給這個用途、且有型別檢查的 `parseVoiceBlockPrompt()`:

```ts
// voiceCompiler.ts:781-787
if (input.moodBlock?.isCustom && input.resolvedCustomProfile) {
  const merged = mergeEmotionProfile(DEFAULT_EMOTION, input.resolvedCustomProfile);
  return {
    profile: merged,
    source: `customBlock:${input.moodBlock.customBlockId ?? "unknown"} (${input.moodBlock.label})`,
  };
}
```

```ts
// voiceCompiler.ts:344-356（mergeEmotionProfile：逐 key 覆蓋，未做型別/內容檢查）
function mergeEmotionProfile(base, overrides) {
  const merged = { ...base };
  for (const key of Object.keys(overrides)) {
    const val = overrides[key];
    if (val !== undefined && val !== null) {
      (merged as any)[key] = val;
    }
  }
  return merged;
}
```

檔案內註解(voiceCompiler.ts:313-321)明文要求「呼叫端必須先用 `parseVoiceBlockPrompt()` 轉換過
才能傳入 `resolvedCustomProfile`」,但這只是文件約定,`resolveEmotion()` 本身沒有做任何 runtime
檢查強制這個契約——一旦有呼叫端(或未來重構)直接把未過濾的 JSON 丟進來,`rate`/`pitch`/
`sentenceBreakMs` 等欄位可以是任意字串/型別,同樣會流入上面未逸出的樣板字串。

**影響**

- 這是一個可驗證的 SSML/XML 屬性注入缺陷:攻擊者可用 20 字元內的 `rateOverride` 跳脫屬性、插入
  額外標籤(例如偽造更長的 `<break time="...">` 停頓,或撐爆 `<prosody>` 的 `rate`/`pitch` 使 TTS
  服務端解析異常)。
- 目前**未造成生產風險**:見 M1——`compile()`/`synthesizeSpeech()` 這整條路徑在生產路由中沒有任何
  呼叫點,所以此缺陷現階段打不到任何真實使用者。但這是一顆「哪天有人接上 `VoiceCompiler.compile()`
  或 `compileToSSML()`(兩者皆為 export 的公開方法)就會立刻引爆」的地雷,且函式簽章本身完全看
  不出這個逸出缺口,未來重新接線時很容易被忽略。

**建議**

1. 在 `compileSegment()` 組樣板前,對 `profile.rate`/`profile.pitch`/`profile.volume` 等會進入
   XML 屬性值的欄位一律呼叫 `escapeSSML()`(或改用白名單格式驗證,如 `/^-?\d+%$/`)。
2. `resolvedCustomProfile` 的 schema 從 `z.record(z.string(), z.unknown())` 收斂為與
   `parseVoiceBlockPrompt()` 回傳型別一致的具名 `z.object({...}).partial()`,把「呼叫端必須先過濾」
   的文件約定變成 runtime 強制契約。
3. 若決定保留現有函式簽章,至少在 `mergeEmotionProfile()` 內對每個欄位做型別檢查(比照
   `parseVoiceBlockPrompt()` 已有的邏輯),避免未來呼叫端誤用。

---

### H3. VoiceCompiler：`wrapEmphasis` 只逸出引號內文字,`emphasisLevel !== "none"` 時引號外文字完全不逸出

**發現(附行號)**

```ts
// voiceCompiler.ts:579-588
function wrapEmphasis(text, level) {
  if (level === "none") return escapeSSML(text);

  return text.replace(EMPHASIS_PATTERN, (_, content) => {
    return `<emphasis level="${level}">${escapeSSML(content)}</emphasis>`;
  });
}
```

當 `level !== "none"` 時,`String.prototype.replace` 只改寫「匹配到引號的片段」,**其餘所有文字
原樣輸出、完全沒有呼叫 `escapeSSML`**。而內建 14 組 `EMOTION_PROFILES`(voiceCompiler.ts:136-294)
中,只有 `nature`/`minimal`/`contemplative` 三組的 `emphasisLevel` 是 `"none"`,其餘 11 組(含最
常見的 `warm`/`joyful`/`dramatic`/`hopeful` 等)都是 `"moderate"`/`"strong"`/`"reduced"`——也就是
說絕大多數情緒設定檔案下,**劇本文字裡任何不在「」『』或雙引號內的 `&`、`<`、`>` 都會原樣進入
最終 SSML**。對照現有測試(`voice-compiler.test.ts:372-379`)只驗證了「不帶 moodBlock、走預設
`DEFAULT_EMOTION`(`emphasisLevel: "none"`)」這一條路徑會完整逸出,並未覆蓋
`emphasisLevel !== "none"` 且特殊字元在引號外的組合,所以這個逸出缺口沒有被既有測試蓋到。

**影響**

- 與 H2 同源但觸發條件不同(H2 是「使用者直接控制的欄位」,這裡是「劇本正文本身」):只要
  `script` 內含 `<`/`&`/`"` 等字元且選用的情緒不是 `none` 等級,就可能破壞 SSML 結構或被解析成
  非預期標籤。
- 同樣受 M1(整條管線目前無生產呼叫點)限制,現階段不可從任何真實端點觸發。

**建議**

- 讓 `wrapEmphasis` 對「未匹配到引號」的片段也跑一次 `escapeSSML`,例如改用「先整體逸出、再對
  引號內容重新包 `<emphasis>`」的順序,而不是「只逸出匹配到的片段」。
- 補一條測試:`emphasisLevel: "moderate"`(如 `moodBlock.blockId: "warm"`)+ 劇本含未加引號的
  `A < B & C` 應斷言 `result.ssml` 仍包含 `&lt;`/`&amp;`。

---

## Medium

### M1. VoiceCompiler 核心 SSML 編譯管線與直連 TTS 方法在生產路由中完全未被呼叫(deadcode / northstar 缺口)

**發現(附行號)**

全倉庫搜尋 `VoiceCompiler`/`getVoiceCompiler`/`synthesizeSpeech`/`compileToSSML` 的呼叫端,結果
只有測試檔案(`voice-compiler.test.ts`、`compiler-schema-validation.test.ts`)與檔案自身。唯一
被生產路由引用的是一個獨立小工具函式:

```ts
// server/routers/proStudio.ts:53-54
import { parseVoiceBlockPrompt } from "../services/voiceCompiler";
import type { EmotionProfile } from "../services/voiceCompiler";
```

`proStudio.ts` 的 `elevenLabsTTS` 端點實際送出的是使用者原始文字,而非 `VoiceCompiler.compile()`
編譯出的 SSML:

```ts
// server/routers/proStudio.ts:890-899
const { request_id } = await falQueueSubmit(submitModelId, {
  text: input.text,                 // 原始文字，非 ssml
  voice_id: input.voice_id,
  model_id: nativeModelId,
  voice_settings: {
    stability: resolvedStability,
    similarity_boost: resolvedSimilarityBoost,
    style: resolvedStyle,
  },
  language_code: input.language_code,
}, getElevenLabsProxyHeaders());
```

`EmotionProfile.emphasisLevel`/`volume` 只被拿去粗略映射成 ElevenLabs 的
`stability`/`style`/`similarity_boost` 三個數值旋鈕(proStudio.ts:858-868),劇本文字本身的斷點
(`<break>`)、強調(`<emphasis>`)、感嘆/疑問句 prosody 調整全部沒有被套用。也就是說,
`voiceCompiler.ts` 檔頭宣稱的「在劇本斷點處自動植入 `<break>` 換氣停頓」「支援 ElevenLabs SSML
子集」等核心能力,在目前唯一存在的生產配音端點上完全沒有生效——真正生效的合成引擎走的是
`server/routers/proStudio.ts` 內建的、平行存在的 fal.ai ElevenLabs TTS 代理路徑,與
`voiceCompiler.ts` 自己實作的 `synthesizeWithElevenLabs()`/`synthesizeWithGoogleTTS()`
(voiceCompiler.ts:680-742,直連 ElevenLabs API 與 Google Cloud TTS SDK,非走 fal.ai)是兩套完全
獨立、互不相通的實作。

**影響**

- 約 260+ 行(`compile()`、`resolveEmotion()`、`splitIntoSegments()`、SSML 組裝函式群、
  `synthesizeSpeech()` 及其兩個 provider 方法,佔全檔 1038 行的 1/4 強)在當前 HEAD 屬於孤兒程式碼
  ——沒有任何路由把它們接上真實流量。
- 這也是 H2/H3 兩個注入缺陷「現階段打不到」的根本原因;但也代表這部分程式碼長期沒有真實流量驗證,
  一旦被接線,連同其中的逸出缺口會一起上線。
- 產品面:「換氣停頓的人類感」這個檔頭宣稱的賣點,目前對終端使用者不存在。

**建議**

1. 與產品/後端對齊:這條管線是「尚待接線的規劃中功能」還是「已被功能對等的 fal.ai 路徑取代、
   應該砍掉」——目前兩者並存造成維護負擔與誤導。
2. 若決定接線,務必先處理 H2/H3 的逸出缺口,並讓 `elevenLabsTTS` 改送 `compile().ssml`(需確認
   fal.ai ElevenLabs TTS 代理是否支援 SSML `text_type` 或等效欄位,本次未在這三個檔案範圍內查證)。
3. 若決定棄用,建議把 `synthesizeSpeech()`/`synthesizeWithElevenLabs()`/`synthesizeWithGoogleTTS()`
   一併移除,只保留仍在使用的 `parseVoiceBlockPrompt()`/`parseVoiceBlockSettings()` 與型別定義。

---

### M2. VoiceCompiler 直連 TTS 呼叫沒有逾時控制

**發現(附行號)**

```ts
// voiceCompiler.ts:687-699（synthesizeWithElevenLabs）
const baseUrl = resolveProviderBaseUrl("elevenlabs");
const response = await fetch(`${baseUrl}/v1/text-to-speech/${voiceId}`, {
  method: "POST",
  headers: { ... },
  body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
});
```

```ts
// voiceCompiler.ts:716-728（synthesizeWithGoogleTTS）
const client = credentialJson
  ? new textToSpeech.TextToSpeechClient({ credentials: ... })
  : new textToSpeech.TextToSpeechClient();
const [response] = await client.synthesizeSpeech({ ... });
```

兩處外部呼叫都沒有 `AbortController`/逾時設定,若 ElevenLabs 或 Google TTS 端掛起,呼叫會無限期
等待。

**影響**

- 依 M1,此路徑目前沒有生產呼叫點,故現階段風險為零;但若日後被接線(見 M1 建議),掛起的外部
  呼叫會佔用請求處理資源且無自我恢復機制,任務單明確要求核對此類「逾時」缺口,故仍列記於此以便
  接線時一併處理。

**建議**

- 比照本檔已有的 ElevenLabs 401/403 fallback 邏輯(voiceCompiler.ts:753-765),在 `fetch`/
  `synthesizeSpeech` 呼叫外包一層固定逾時(如 15-30 秒)並在逾時後走 Google TTS 備援或直接回傳
  `voice-provider-unavailable`,與現有 `synthesizeWithGoogleTTS` 的錯誤處理風格一致。

---

## 已驗證排除的疑慮(negative results)

1. **無 ffmpeg/子行程/檔案系統操作**:對三個檔案全文比對
   `fs.`/`writeFile`/`unlink`/`tmpdir`/`mkdtemp`/`createWriteStream`/`child_process`/`spawn`/
   `execFile`/`exec(`/`ffmpeg`,結果為零命中。這三支服務是純字串/JSON 編譯器(voice 額外含 HTTP/
   SDK 呼叫),任務單原先設想的「暫存檔清理」「shell/ffmpeg 參數注入」在這三個檔案裡沒有對應的
   程式碼路徑,不予臆測、如實記錄為「不適用」。
2. **SSRF(素材 URL)風險已在呼叫端擋下,本檔案內無下載行為**:`VideoCompilerInput.firstFrameUrl`/
   `lastFrameUrl`(compilerValidation.ts:85-86)在 `videoCompiler.ts` 內**只被當成字串嵌入輸出
   提示詞**(`assemblePrompt()`:videoCompiler.ts:1374-1375、1397-1398 的
   `[First/Last Frame Reference: ...]` 標記),本檔案自身從未 `fetch`/下載這兩個 URL。生產路由
   `server/routers/videoStudio.ts:510-511` 呼叫 compile() 前,已用 `safeExternalUrlOptional`
   (`server/utils/validateSafeUrl.ts`,要求 https 且非私有 IP)驗證過這兩個欄位;`compile()` 端
   點與實際會把圖片 URL 傳給 fal.ai 生成模型的端點(`image_url`/`tail_image_url`,如
   videoStudio.ts:906-911)是兩個不同的 mutation,不共用 `firstFrameUrl`/`lastFrameUrl`。
   `audioCompiler.ts`/`voiceCompiler.ts` 的輸入 schema 完全沒有 URL 欄位,無對應攻擊面。
   （註:僅發現 `compilerValidation.ts` 自身的 `VideoCompilerInputSchema` 對這兩個欄位只驗證
   `z.string().max(2048)`、不驗證格式，屬於縱深防禦層面的次要缺口，但因目前唯一呼叫端已在更外層
   做了格式/私網驗證，未達獨立列為 finding 的門檻。）
3. **計費/退款不在這三個檔案的職責範圍,抽查的呼叫順序安全**:三檔皆無 `userId`/`ownerId`/資料庫
   存取/`charge`/`refund` 呼叫,職責正確地留在呼叫端路由。抽查 `proStudio.ts` 的
   `compiledTextToMusic`(呼叫 `audioCompiler.compile()`)可見 `compiler.compile(compilerInput)`
   (proStudio.ts:1868)在 `chargeForFalTask`(proStudio.ts:1899)**之前**執行——代表若
   `AudioCompiler.compile()` 因輸入驗證失敗而拋錯,請求會在扣點前就結束,不會造成「先扣點後編譯
   失敗」的退款缺口。（此結論僅涵蓋本次抽查到的這一個呼叫點,`videoCompiler.ts` 的 compile
   endpoint —— `videoStudio.ts` 的 `compileVideoPrompt` 系 mutation —— 本身不呼叫任何計費函式,
   影片生成扣點發生在另一個獨立 mutation 中,兩者屬不同請求,同理不構成先扣點後失敗。）
4. **`customBreakpoints` 已正確逸出,無正規表達式注入**:`voiceCompiler.ts:529` 用使用者提供的
   `customBreakpoints` 字串陣列組出 `new RegExp(...)` 前,先對每個元素跑過
   `escapeRegex()`(voiceCompiler.ts:560-562,逐字元跳脫 regex 特殊符號),沒有讓使用者字串以
   regex 原文形式進入 `new RegExp`,排除 ReDoS/regex 注入疑慮。
5. **AIDV-677(`moodBlock.emotionOverride` 為 dead field)已於本次稽核的 HEAD 修復**:先前
   `docs/audits/opt-cycle-2026-06-29.md` 記錄 `emotionOverride` 宣告於 schema 但
   `resolveEmotion()` 從未讀取;本次逐行核對 `voiceCompiler.ts:789-795` 確認該欄位現在確實被
   讀取並優先套用(commit `01e6650d`),不再重複列為發現。
6. **輸入長度上限對三支編譯器內部迴圈提供了合理的演算法複雜度上限**:`blocks` 陣列上限 50
   (compilerValidation.ts:39、61)、`script`/`lyrics`/`freePrompt` 均有數千字元上限、
   `moodKeywords`/`vibeCardIds`/`customBreakpoints` 上限 20 筆;三檔內所有迴圈不是被這些上限
   界定,就是被固定大小的內部表(如 16 筆 `CAMERA_VECTORS`、7 種 `STRUCTURE_TEMPLATES`)界定,
   沒有發現無界迴圈或可被使用者輸入放大到失控規模的演算法複雜度風險。
7. **`VideoCompilerInput.blocks` 的 `"camera"` 類別型別宣告後從未被讀取**(videoCompiler.ts:28
   宣告、`parseBlocks()`:videoCompiler.ts:1203-1238 只 filter `subject`/`action`/`environment`/
   `style` 四類,`"mood"` 另於 `resolveEmotion()` 處理,`"camera"` 完全沒有對應的 filter 分支)。
   在 `client/` 目錄搜尋不到任何建構 `category: "camera"` 積木的來源,無法判定前端是否真的曾經/
   目前提供此分類供使用者選擇,故僅在此記錄為「型別與管線契約落差」,不臆測為已確認的使用者體驗
   缺陷,亦不列入上方 High/Medium 分級發現。

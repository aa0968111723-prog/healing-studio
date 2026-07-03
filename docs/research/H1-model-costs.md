# H1 — 模型成本全表(repo 內建定價)(補充 wave H)

- 產生日期:2026-07-03
- 依據 commit:`aef4214178edfbbe28a9140b1b954addc9108a8c`
- 補充對象:A-cost-integrations.md(A 文件因「不編數字」原則未填單價;本文件填的是**程式碼事實**)

> **⚠️ 重要聲明:以下全部是程式碼內建估價表(`estimatePoints` / 成本歸屬用),≠ 供應商實際帳單;兩者落差需對帳(見 A §待補)。**
> 表內 USD 均為 `baseCostUsd` 欄位值或 `points ÷ 100` 換算(`shared/currency.ts:16` `POINTS_PER_USD = 100`;`credits.ts:66` 同一基準),為 repo 作者在 2025 Q2 前後「對齊供應商牌價」手訂的參考值,不是即時牌價。

---

## 0. 計價機制(modelPricing.ts:1-31, 3268-3413)

- **單位**:平台積分 Points;**1 USD ≈ 100 pts**。
- **公式**(`estimatePoints`,modelPricing.ts:3268):
  `total = basePoints + max(0, durationSec − freeSecondsInBase) × pointsPerSecond + ceil(charCount/1000) × pointsPer1kChars + max(0, imageCount−1) × pointsPerImage + trainingSteps × pointsPerStep`,最後 clamp 到 `[minPoints, maxPoints]`。
- **未知模型 fallback**(modelPricing.ts:3279-3288):modelId 不在目錄 → **一律扣固定 5 pts**($0.05),breakdown 標「未知模型(標準計費 5 pts)」,**不看時長/字數** —— 貴模型漏登錄=嚴重少收。
- `calculateActualCost`(:3376)供 webhook 對帳:優先吃 `billingSeconds`/`outputImages` 實際產出量,同一公式重算。
- 扣點入口:`proStudio.chargeForFalTask`(proStudio.ts:67,先估點→`deductUserPoints`→失敗 `PAYMENT_REQUIRED`,送單失敗退款)、`director.autoGenerateFromSegments`(director.ts:2142+,只預檢餘額不扣,實扣在派工)、generate/imageStudio/videoStudio 同模式。
- **成本歸屬後援**:`server/services/cost/catalogCostFallback.ts` —— fal/gemini/elevenlabs/suno 回應沒有 `usage.cost` 時,用本目錄單位價 × 實際用量推 USD,寫 ledger 標 `costSource="catalog"`(與 `provider` 區分,稽核可辨)。

**目錄規模**:共 **200 個 modelId**;provider 分佈 fal 151 / gemini 13 / openrouter 12 / vertex 8 / elevenlabs 6 / perplexity 5 / nvidia 3 / suno 2;tier 分佈 premium 77 / standard 75 / economy 25 / ultra 23。

---

## 1. MODEL_PRICING_CATALOG 全表(modelPricing.ts:129-3261)

欄位:base=basePoints(=baseCostUsd×100,除少數例外於備註標明);加乘=pointsPerSecond(/s)、pointsPer1kChars(/1k 字)、pointsPerStep(/步);free=freeSecondsInBase(base 已含秒數);範圍=minPoints–maxPoints。USD=base÷100。

### 1.1 text-to-image(19)

| modelId | tier | base pts | 範圍 | USD/張 | 備註 |
|---|---|---|---|---|---|
| fal-ai/flux-pro/v1.1 | premium | 4 | 4–20 | $0.04 | **imageEngine 預設** |
| fal-ai/flux/dev | premium | 3 | 3–15 | $0.025 | baseCostUsd 0.025≠3pts |
| fal-ai/flux/schnell | economy | 1 | 1–5 | $0.003 | 補貼(真實 ~$0.003) |
| fal-ai/flux-schnell (alias) | economy | 1 | 1–5 | $0.01 | |
| fal-ai/stable-diffusion-v3-medium | standard | 2 | 2–10 | $0.02 | |
| fal-ai/stable-diffusion-v35-large | standard | 2 | 2–10 | $0.02 | |
| fal-ai/fast-sdxl | economy | 1 | 1–5 | $0.01 | |
| fal-ai/aura-flow | standard | 2 | 2–10 | $0.02 | |
| fal-ai/ideogram/v2 | premium | 4 | 4–20 | $0.04 | |
| fal-ai/nano-banana-2 | economy | 1 | 1–5 | $0.01 | |
| fal-ai/nano-banana-pro | standard | 2 | 2–10 | $0.02 | |
| fal-ai/imagen4/preview | premium | 5 | 5–25 | $0.05 | fal 版 Imagen4 |
| fal-ai/bytedance/seedream/v4/text-to-image | standard | 2 | 2–10 | $0.02 | |
| fal-ai/lora | standard | 2 | 2–10 | $0.02 | SD+LoRA 推理 |
| gemini/imagen-3 | premium | 4 | 4–20 | $0.04 | |
| gemini/imagen-3-fast | economy | 1 | 1–5 | $0.01 | |
| gemini/imagen-4 | premium | 5 | 5–25 | $0.05 | |
| vertex/imagen-3 | premium | 5 | 5–25 | $0.05 | |
| vertex/imagen-4 | premium | 6 | 6–30 | $0.06 | |

### 1.2 image-to-image / 語意編輯(17)

| modelId | tier | base pts | 範圍 | USD/次 |
|---|---|---|---|---|
| fal-ai/flux/dev/image-to-image | premium | 3 | 3–15 | $0.03(falImageToImageEngine 預設) |
| fal-ai/stable-diffusion-v3-medium/image-to-image | standard | 2 | 2–10 | $0.02 |
| fal-ai/ip-adapter-face-id | premium | 4 | 4–20 | $0.04 |
| fal-ai/controlnet-union | standard | 3 | 3–15 | $0.03 |
| fal-ai/aura-sr | economy | 1 | 1–5 | $0.005 |
| fal-ai/seedvr/upscale/image | standard | 2 | 2–10 | $0.02 |
| fal-ai/dwpose | economy | 1 | 1–3 | $0.005 |
| fal-ai/imageutils/rembg | economy | 1 | 1–3 | $0.001 |
| fal-ai/nano-banana-pro/edit | premium | 3 | 3–15 | $0.03 |
| fal-ai/nano-banana/edit | economy | 1 | 1–5 | $0.01 |
| fal-ai/nano-banana-2/edit | economy | 1 | 1–5 | $0.01 |
| fal-ai/bytedance/seedream/v4.5/edit | standard | 2 | 2–10 | $0.02 |
| fal-ai/bytedance/seedream/v5/lite/edit | economy | 1 | 1–5 | $0.01 |
| xai/grok-imagine-image/edit | standard | 2 | 2–10 | $0.02 |
| fal-ai/gpt-image-1.5/edit | premium | 5 | 5–25 | $0.05 |
| fal-ai/flux-pro/kontext | premium | 4 | 4–20 | $0.04 |
| fal-ai/flux-2-pro/edit | premium | 4 | 4–20 | $0.04 |

### 1.3 text-to-video(21)

| modelId | tier | base pts | /s | free s | 範圍 | 5s 成本 |
|---|---|---|---|---|---|---|
| fal-ai/kling-video/v2.1/pro/text-to-video | ultra | 49 | 9.8 | 5 | 49–500 | 49 pts $0.49(**falTextToVideoEngine 預設**) |
| fal-ai/kling-video/v2.1/standard/text-to-video | premium | 30 | 6 | 5 | 30–350 | 30 pts $0.30 |
| fal-ai/kling-video/v1.5/pro/text-to-video | premium | 30 | 6 | 5 | 30–350 | deprecated→V2.1 計費 |
| fal-ai/minimax-video/text-to-video | standard | 20 | 3.3 | 6 | 20–200 | 20 pts(6s base) |
| fal-ai/minimax/hailuo-02/pro/text-to-video | premium | 28 | 4.7 | **0** | 28–280 | 5s=52 pts(無 free 秒,雙重計) |
| fal-ai/minimax/video-01 (alias) | standard | 20 | 3.3 | 6 | 20–200 | |
| fal-ai/luma-dream-machine | premium | 30 | 6 | 5 | 30–300 | 30 pts |
| fal-ai/wan-t2v-v2.1 | standard | 15 | 3 | 5 | 15–150 | 15 pts |
| fal-ai/wan-t2v (alias) | standard | 15 | 3 | 5 | 15–150 | **videoEngine(studio 槽)預設** |
| fal-ai/wan-ai/wan2.1-t2v-720p (alias) | standard | 15 | 3 | 5 | 15–150 | |
| fal-ai/wan/v2.2-14b | standard | 15 | 3 | 5 | 15–150 | |
| fal-ai/cogvideox-5b | standard | 15 | 2.5 | 6 | 15–150 | |
| fal-ai/ltx-video-13b-distilled | standard | 18 | 3.6 | 0 | 18–180 | 5s=36 pts |
| fal-ai/sora | ultra | 60 | 12 | 0 | 60–600 | 5s=120 pts;fal 可用性不穩自動降級 |
| fal-ai/veo3 | premium | 40 | 8 | 5 | 40–400 | 40 pts $0.40 |
| fal-ai/veo3/pro | ultra | **80** | 16 | 5 | 80–800 | 80 pts $0.80(端點未開放時 404) |
| gemini/veo-2 | ultra | 35 | 7 | 5 | 35–350 | |
| gemini/veo-3 | ultra | 50 | 10 | 5 | 50–500 | preview |
| gemini/veo-3-fast | premium | 30 | 6 | 5 | 30–300 | |
| vertex/veo-2 | ultra | 40 | 8 | 5 | 40–400 | |
| vertex/veo-3 | ultra | 55 | 11 | 5 | 55–550 | preview |

### 1.4 image-to-video(21)

| modelId | tier | base | /s | free | 範圍 | 5s 成本 |
|---|---|---|---|---|---|---|
| fal-ai/kling-video/v2.1/pro/image-to-video | ultra | 55 | 11 | 5 | 55–550 | 55 pts $0.55(**falImageToVideoEngine 預設**) |
| fal-ai/kling-video/v2.1/standard/image-to-video | premium | 35 | 7 | 5 | 35–350 | 35 pts |
| fal-ai/kling-video/v1.5/pro/image-to-video | premium | 35 | 7 | 5 | 35–400 | deprecated |
| fal-ai/runway-gen3/turbo/image-to-video | premium | 40 | 8 | 5 | 40–400 | |
| fal-ai/runway-gen4-turbo/image-to-video | ultra | 50 | 10 | 0 | 50–500 | 5s=100 pts(無 free 秒) |
| fal-ai/stable-video | standard | 15 | 3 | 1 | 15–150 | 每25幀≈1s base |
| fal-ai/minimax-video/image-to-video | standard | 22 | 3.7 | 6 | 22–220 | |
| fal-ai/minimax/hailuo-02/pro/image-to-video | premium | 30 | 5 | 0 | 30–300 | 5s=55 pts |
| fal-ai/minimax/video-01/image-to-video (alias) | standard | 20 | 3.3 | 6 | 20–200 | |
| fal-ai/luma-dream-machine/image-to-video | premium | 32 | 6.4 | 5 | 32–320 | |
| fal-ai/ltx-video/image-to-video | standard | 20 | 4 | 0 | 20–200 | 5s=40 pts |
| fal-ai/wan-i2v (alias) | standard | 20 | 4 | 5 | 20–200 | |
| fal-ai/wan-ai/wan2.1-i2v-720p (alias) | standard | 20 | 4 | 5 | 20–200 | |
| fal-ai/pixverse/v4.5/image-to-video | standard | 20 | 4 | 5 | 20–200 | |
| fal-ai/cammaster | premium | 35 | 7 | 0 | 35–350 | 鏡頭運動控制 |
| fal-ai/vidu/q1/reference-to-video | premium | 30 | 6 | 0 | 30–300 | |
| fal-ai/wan/v2.2-14b/speech-to-video | premium | 12 | 1.5 | 0 | 12–200 | avatar |
| fal-ai/echomimic-v3 | premium | 10 | 1.2 | 0 | 10–150 | avatar |
| fal-ai/stable-avatar | premium | 12 | 1.4 | 0 | 12–250 | avatar |
| fal-ai/longcat-single-avatar/audio-to-video | premium | 12 | 1.3 | 0 | 12–250 | avatar |
| fal-ai/ltx-2-19b/distilled/audio-to-video/lora | premium | 10 | 1.0 | 0 | 10–180 | avatar |

### 1.5 text-to-audio / 音樂 / 音訊處理(21)

| modelId | tier | base | 加乘 | free | 範圍 | 備註 |
|---|---|---|---|---|---|---|
| fal-ai/stable-audio | premium | 5 | 0.17/s | 30s | 5–60 | **falTextToAudioEngine 預設**;30s=5 pts $0.05 |
| fal-ai/ace-step | premium | 8 | 0.13/s | 60s | 8–80 | **audioEngine(studio 槽)預設** |
| fal-ai/mmaudio-v2 | standard | 4 | 0.27/s | 15s | 4–40 | |
| fal-ai/audioldm2 | standard | 4 | 0.27/s | 15s | 4–40 | 端點已下架→normalize 到 mmaudio-v2,數值對齊 |
| fal-ai/musicgen | standard | 3 | 0.2/s | 15s | 3–30 | |
| **suno-v4** | premium | **10** | 無(每首固定) | — | 10–50 | $0.10/首;經第三方 proxy |
| **suno-v3.5** | standard | **6** | 無 | — | 6–30 | $0.06/首 |
| fal-ai/sonauto | standard | 5 | 無 | — | 5–50 | 每首 |
| sonauto/v2/text-to-music | premium | 5 | 無 | — | 5–50 | dispatcher normalize 後真實 key |
| gemini/lyria-2 | premium | 8 | 0.27/s | 30s | 8–80 | |
| gemini/lyria-3 | premium | 10 | 0.33/s | 30s | 10–100 | |
| vertex/lyria-2 | premium | 10 | 0.33/s | 30s | 10–100 | |
| elevenlabs/music | premium | 10 | 0.33/s | 30s | 10–100 | |
| elevenlabs/sound-effects | standard | 3 | 無 | — | 3–15 | |
| fal-ai/elevenlabs/sound-effects | standard | 3 | 無 | — | 3–15 | fal proxy |
| fal-ai/elevenlabs/sound-effects/v2 | standard | 3 | 無 | — | 3–15 | fal canonical(DEF-EL6) |
| fal-ai/demucs | standard | 4 | 無 | — | 4–30 | 音幹分離 |
| fal-ai/elevenlabs/audio-isolation | standard | 3 | 無 | — | 3–20 | |
| fal-ai/elevenlabs/voice-changer | standard | 4 | 無 | — | 4–25 | |
| fal-ai/elevenlabs/dubbing | premium | 8 | 0.8/s | 0 | 8–200 | |
| fal-ai/ffmpeg-api/merge-audios | economy | 1 | 無 | — | 1–10 | |

### 1.6 text-to-speech(22)

| modelId | tier | base | /1k 字 | 範圍 | 備註 |
|---|---|---|---|---|---|
| fal-ai/elevenlabs/tts/turbo-v2.5 | standard | 1 | 1 | 1–50 | **voiceEngine + falTextToSpeechEngine 預設** |
| fal-ai/elevenlabs/tts/flash-v2.5 | economy | 1 | 1 | 1–50 | |
| fal-ai/elevenlabs/tts/multilingual-v2 | premium | 3 | 3 | 1–150 | |
| fal-ai/elevenlabs/tts/eleven-v3 | premium | 4 | 4 | 1–200 | |
| elevenlabs/eleven-v3 | premium | 4 | 4 | 1–200 | 直連;真實 ~$0.18/1k,catalog 補貼 4 pts/1k(檔頭 :26 註明) |
| elevenlabs/multilingual-v2 | premium | 3 | 3 | 1–150 | |
| elevenlabs/turbo-v2.5 | economy | 1 | 1 | 1–50 | |
| elevenlabs/flash-v2.5 | economy | 1 | 1 | 1–50 | |
| fal-ai/metavoice-v1 | premium | 5 | 5 | 2–100 | |
| fal-ai/playai-tts | premium | 4 | 4 | 2–80 | |
| fal-ai/f5-tts | standard | 2 | 2 | 1–60 | |
| fal-ai/kokoro | economy | 1 | 1 | 1–30 | |
| fal-ai/orpheus-tts | standard | 2 | 2 | 1–60 | |
| fal-ai/dia-tts | standard | 2 | 2 | 1–60 | |
| fal-ai/dia-tts/voice-clone | standard | 2 | 2 | 2–30 | 實為多說話者對話 TTS(DEF-D2) |
| gemini/tts-flash | economy | 1 | 1 | 1–50 | |
| gemini/tts-pro | standard | 2 | 2 | 1–80 | |
| fal-ai/qwen-3-tts/text-to-speech/1.7b | economy | 1 | 1 | 1–20 | |
| fal-ai/qwen-3-tts/clone-voice/1.7b | standard | 4 | 無 | 4–20 | 每次克隆 |
| fal-ai/qwen-3-tts/voice-design/1.7b | standard | 3 | 無 | 3–20 | |
| fal-ai/kling-video/create-voice | standard | 3 | 無 | 3–15 | |
| fal-ai/elevenlabs/voice-cloning | premium | 8 | 無 | 8–40 | Instant Voice Clone |

### 1.7 3D(image-to-3d 9 + text-to-3d 5)

| modelId | 類別 | tier | base | 範圍 |
|---|---|---|---|---|
| fal-ai/trellis | i2-3d | premium | 10 | 10–50(falImageTo3dEngine 預設) |
| fal-ai/trellis-2 | i2-3d | standard | 5 | 5–50 |
| fal-ai/triposr | i2-3d | standard | 5 | 5–25 |
| fal-ai/stable-zero123 | i2-3d | standard | 4 | 4–20 |
| fal-ai/zero123plus | i2-3d | standard | 4 | 4–20 |
| fal-ai/mv-adapter | i2-3d | premium | 12 | 12–60 |
| fal-ai/sam-3/3d-objects | i2-3d | premium | 5 | 5–25 |
| fal-ai/hunyuan3d-v3/image-to-3d | i2-3d | premium | 8 | 8–40 |
| fal-ai/hunyuan_world/image-to-world | i2-3d | premium | 10 | 10–50 |
| fal-ai/hyper3d/rodin | t2-3d | premium | 15 | 15–75(falTextTo3dEngine 預設) |
| fal-ai/meshy-4 | t2-3d | premium | 20 | 20–100 |
| fal-ai/shap-e | t2-3d | standard | 5 | 5–25 |
| fal-ai/dreamgaussian | t2-3d | standard | 8 | 8–40 |
| fal-ai/fantasia3d | t2-3d | premium | 12 | 12–60 |

### 1.8 video-to-*(v2a 2 + v2t 2 + v2v 14)+ audio-to-text 1

| modelId | 類別 | tier | base | 加乘 | free | 範圍 |
|---|---|---|---|---|---|---|
| fal-ai/mmaudio-v2/video-to-audio | v2a | premium | 8 | 0.27/s | 30s | 8–80(falVideoToAudioEngine 預設) |
| fal-ai/sync-lipsync | v2a | premium | 15 | 0.25/s | 60s | 15–150 |
| fal-ai/whisper | v2t | economy | 1 | 0.017/s | 60s | 1–30(falVideoToTextEngine 預設;~$0.006/min) |
| fal-ai/wizper | v2t | economy | 1 | 0.01/s | 60s | 1–20 |
| fal-ai/nemotron/asr/stream | a2t | standard | 2 | 無 | — | 2–20 |
| fal-ai/kling-video/v2.1/standard/video-to-video | v2v | ultra | 45 | 9/s | 5 | 45–450(falVideoToVideoEngine 預設) |
| fal-ai/kling-video/v1.6/standard/video-to-video | v2v | premium | 35 | 7/s | 0 | 35–350 |
| fal-ai/wan-v2v (alias) | v2v | standard | 15 | 3/s | 5 | 15–150 |
| fal-ai/wan/v2.1/video-to-video | v2v | standard | 15 | 3/s | 0 | 15–150 |
| fal-ai/wan-ai/wan2.1-v2v-480p (alias) | v2v | standard | 15 | 3/s | 5 | 15–150 |
| fal-ai/video-to-video | v2v | standard | 12 | 2.4/s | 5 | 12–120 |
| fal-ai/cogvideox-5b/video-to-video | v2v | standard | 15 | 3/s | 5 | 15–150 |
| fal-ai/animatediff-v2v | v2v | standard | 18 | 3.6/s | 0 | 18–180 |
| fal-ai/stable-video-upscaler | v2v | standard | 10 | 0.17/s | 60s | 10–100 |
| fal-ai/bytedance/upscaler/video | v2v | premium | 25 | 0.42/s | 0 | 25–250 |
| fal-ai/rife-v4.6/video | v2v | standard | 8 | 0.13/s | 0 | 8–80 |
| fal-ai/topaz/video-enhance | v2v | ultra | 40 | 0.67/s | 0 | 40–600 |
| fal-ai/topaz-upscale-video | v2v | premium | 20 | 0.33/s | 60s | 20–200 |
| fal-ai/depthcrafter | v2v | standard | 22 | 0.37/s | 0 | 22–220 |

### 1.9 fal LLM / JSON 視覺分析(llm 11 + image-to-json 4)

| modelId | tier | base | /1k 字 | 範圍 |
|---|---|---|---|---|
| fal-ai/any-llm | standard | 2 | 2 | 1–50(falLlm/Json/TextToJson/ImageToJson 四槽預設) |
| fal-ai/meta-llama/llama-3.2-90b-vision-instruct | premium | 5 | 5 | 2–100 |
| fal-ai/meta-llama/llama-3.1-8b-instruct | economy | 1 | 1 | 1–20 |
| fal-ai/wizardlm-2-8x22b | premium | 4 | 4 | 2–80 |
| fal-ai/dolphin-2.9.2-qwen2-72b | premium | 4 | 4 | 2–80 |
| fal-ai/lmstudio / outlines / wizardcoder | standard | 2 | 2 | 1–40 |
| minimaxai/minimax-m2.7(NVIDIA NIM) | standard | 1 | 無 | 1–10 |
| nvidia/llama-3.1-nemotron-ultra-253b-v1 | premium | 3 | 無 | 2–30(baseCostUsd 0.04≠3pts) |
| nvidia/llama-3.3-nemotron-super-49b-v1.5 | standard | 1 | 無 | 1–12 |
| fal-ai/moondream / doctr | economy | 1 | 無 | 1–5 |
| fal-ai/llava-next / sam2 | standard | 2 | 無 | 2–10 |

### 1.10 training(8)

| modelId | tier | base pts | pts/步 | 範圍 | 1000 步實算 |
|---|---|---|---|---|---|
| fal-ai/flux-lora-fast-training | ultra | 200 | 0.1 | 200–2000 | **300 pts = $3.00**(falTrainingEngine 預設) |
| fal-ai/flux-lora-portrait-trainer | ultra | 250 | 0.12 | 250–2500 | 370 pts |
| fal-ai/flux-2-trainer | ultra | 250 | 0.12 | 250–2500 | 370 pts |
| fal-ai/dreambooth-flux | ultra | 300 | 0.15 | 300–3000 | 450 pts |
| fal-ai/sd3-lora-training | premium | 150 | 0.08 | 150–1500 | 230 pts |
| fal-ai/turbo-flux-trainer | premium | 100 | 0.05 | 100–1000 | 150 pts |
| fal-ai/hunyuan-video-lora-training | ultra | 400 | 0.18 | 400–4000 | 580 pts |
| fal-ai/cogvideox-lora-training | ultra | 500 | 0.2 | 500–5000 | 700 pts |

### 1.11 reasoning(大腦槽 LLM,23)

| modelId | tier | base | /1k 字 | 範圍 |
|---|---|---|---|---|
| anthropic/claude-opus-4.7 | ultra | 12 | 12 | 4–400(**5 個推理槽中 4 個的預設**) |
| anthropic/claude-sonnet-4.6 / 4.5 | premium | 5 | 5 | 2–150 |
| anthropic/claude-haiku-4.5 | standard | 1 | 1 | 1–40 |
| openai/gpt-5 | ultra | 10 | 10 | 4–320 |
| google/gemini-3-pro | ultra | 7 | 7 | 3–220 |
| google/gemini-2.5-pro | premium | 4 | 4 | 2–120 |
| google/gemini-2.5-flash | standard | 1 | 1 | 1–30 |
| gemini-3-pro(原生) | ultra | 6 | 6 | 2–200 |
| gemini-2.5-pro(原生) | premium | 3 | 3 | 1–100 |
| gemini-2.5-flash(原生) | economy | 1 | 1 | 1–30 |
| perplexity/sonar-deep-research | ultra | 12 | 12 | 4–400 |
| perplexity/sonar-reasoning-pro | ultra | 8 | 8 | 3–240 |
| perplexity/sonar-pro | premium | 4 | 4 | 2–120(analyst 槽預設) |
| perplexity/sonar-reasoning | premium | 3 | 3 | 2–90 |
| perplexity/sonar | standard | 1 | 1 | 1–40 |
| minimax/minimax-m2 | standard | 1 | 1 | 1–30 |
| mistralai/mistral-nemo | economy | 1 | 1 | 1–20 |
| meta-llama/llama-3.1-405b-instruct | premium | 5 | 5 | 2–150 |
| meta-llama/llama-3.2-90b-vision-instruct | premium | 4 | 4 | 2–120 |
| vertex/gemini-2.5-pro | premium | 4 | 4 | 2–120 |
| vertex/gemini-2.5-flash | standard | 2 | 2 | 1–50 |
| vertex/llama-3.2-90b | premium | 5 | 5 | 2–150 |

### 1.12 不在定價表內的模型(→ fallback 固定 5 pts)

用 `falModels.ts` 目錄(131 個 fal id)與各 router/dispatcher 實際使用的 modelId 對 `MODEL_PRICING_CATALOG` 200 keys 做差集:

| 缺定價 modelId | 出處 | 影響 |
|---|---|---|
| fal-ai/flux/dev/controlnet | falModels.ts 目錄 | 走 5 pts flat |
| fal-ai/tripo3d | falModels.ts 目錄 | 走 5 pts flat |
| fal-ai/stable-diffusion-xl | router 引用 | 走 5 pts flat |
| fal-ai/kling-video/v1/standard/text-to-video | modelClients.ts:315(legacy "kling-v1" 映射) | **影片只扣 5 pts,不看時長 → 嚴重少收** |
| fal-ai/wan/t2v-turbo | learnHub.seed.ts 展示內容(非扣點路徑) | 若被送單同樣 5 pts |

覆蓋率整體良好(131 個 fal 目錄模型僅 2 個漏登錄),但 fallback 是「固定 5 pts、無時長/字數乘數」,對影片級模型是數量級低估。

---

## 2. LLM USD/MTok 內建估價表(server/_core/llm.ts:599-641)

**用途**:僅供 LangSmith trace 的 `cost_usd` 欄位(內部成本歸屬),**不扣使用者點數**、不進帳單。公式 `prompt_tokens/1M × input + completion_tokens/1M × output`。

| model key | input $/MTok | output $/MTok |
|---|---|---|
| anthropic/claude-opus-4.7・claude-opus-4-7 | 15.0 | 75.0 |
| anthropic/claude-sonnet-4.6・4.5・claude-sonnet-4-6 | 3.0 | 15.0 |
| anthropic/claude-haiku-4.5・claude-haiku-4-5 | 0.8 | 4.0 |
| openai/gpt-5・gpt-5 | 10.0 | 30.0 |
| openai/gpt-4o・gpt-4o | 2.5 | 10.0 |
| google/gemini-3-pro・gemini-3-pro | 2.5 | 15.0 |
| google/gemini-2.5-pro・gemini-2.5-pro | 1.25 | 5.0 |
| google/gemini-2.5-flash・gemini-2.5-flash | 0.075 | 0.3 |
| minimax/minimax-m2・MiniMax-M2.7・minimaxai/minimax-m2.7 | 0.3 | 1.2 |
| mistralai/mistral-nemo | 0.15 | 0.15 |
| meta-llama/llama-3.1-405b-instruct | 2.7 | 2.7 |

**Fallback(llm.ts:634-635)**:以 `model.includes(key)` 做子字串匹配;匹配不到 → **一律按 gemini-2.5-flash 費率**($0.075/$0.3)計。因此:

- **Perplexity sonar 全系列不在表內** → 導演 chat(`perplexity/sonar-pro`,costarService.ts:166)與 analyst 槽的 trace 成本被以 Flash 費率**大幅低估**(sonar-pro 官方牌價含 grounding 附加費,量級遠高於 Flash)。
- NVIDIA Nemotron、vertex/*、freellmapi 引擎同樣 fallback 到 Flash 費率。

### 2.1 user_ai_brain 5 個推理槽預設模型對照(drizzle/schema.ts:1337-1415)

| 槽 | 預設模型 | temp/topP | llm.ts 估價 | modelPricing points |
|---|---|---|---|---|
| director(導演) | anthropic/claude-opus-4.7 | 0.4/0.9 | $15/$75 MTok | 12 base +12/1k 字(4–400) |
| analyst(分析師) | perplexity/sonar-pro | 0.3/0.8 | **不在表 → Flash 費率(低估)** | 4 base +4/1k(2–120) |
| storyteller(說書人) | anthropic/claude-opus-4.7 | 0.9/0.95 | $15/$75 | 同 director |
| technician(技師) | anthropic/claude-opus-4.7 | 0.2/0.7 | $15/$75 | 同 director |
| curator(策展人) | anthropic/claude-opus-4.7 | 0.8/0.9 | $15/$75 | 同 director |

### 2.2 每次光球/導演對話的內建估算量級(假設:輸入 3,000 tok + 輸出 1,000 tok)

> 光球 chat(`ai.chat`)按意圖動態選 5 槽之一(ai.ts:1307 `pickReasoningSlotForOrbChat`);Sonar 槽遇 schema-first planner 時規劃階段改用 director 的 Claude(ai.ts:1325-1339)。**光球對話本身不扣點**(ai.ts 無 `estimatePoints`/`deductUserPoints` 呼叫),LLM 成本全由平台吸收,只在 LangSmith 記 USD。

| 槽模型 | 計算式 | 每回合估 USD |
|---|---|---|
| Opus 4.7(4 槽預設) | 3k/1M×15 + 1k/1M×75 | **$0.120** |
| Sonnet 4.6 | 3k/1M×3 + 1k/1M×15 | $0.024 |
| Haiku 4.5(手動切槽) | 3k/1M×0.8 + 1k/1M×4 | **$0.0064**(≈Opus 的 1/19) |
| sonar-pro(analyst 槽) | 表內無 → Flash 費率 | $0.000525(**確定低估,真實成本另需含搜尋 grounding**) |

長對話(輸入 10k tok 含歷史+pageSnapshot)Opus 每回合 ≈ $0.225;重度使用者一天 50 回合 ≈ $11(內建表口徑)。

---

## 3. credits.pricingCatalog 公開目錄(server/routers/credits.ts:10-47)

- `publicProcedure`(**無需登入**)→ `getAllPricingByCategory()`(modelPricing.ts:3486):把 200 條全量吐給前端,按 16 個 category 分組、各組依 basePoints 升冪。
- 每條輸出欄位:`modelId, label, provider, tier, basePoints, unit, minPoints, maxPoints, pointsPerSecond?, pointsPer1kChars?, pointsPerImage?, pointsPerStep?`(**不含** baseCostUsd / keyEnvVar / availabilityNote —— 內部成本與 key 需求不外洩)。
- 分類與條數:reasoning 23、text-to-speech 22、text-to-video 21、text-to-audio 21、image-to-video 21、text-to-image 19、image-to-image 17、video-to-video 14、llm 11、image-to-3d 9、training 8、text-to-3d 5、image-to-json 4、video-to-text 2、video-to-audio 2、audio-to-text 1。
- 同 router:`myBalance`(protected)回 `remaining`(users.remainingGenerations)、近 30 天 topModel、`totalSpentPoints = getUserCostSummary().totalCost(USD) × 100`(credits.ts:66-67,即帳面 USD→pts 同一 100 倍換算)、`usedPct`。
- 另有 `brain.pricingSummary`(brain.ts:571)回四生成引擎槽的 estimatedPoints/estimatedUsd + rateNote「1 USD≈100pts」(見 02-fullstack §2.2)。

---

## 4. 典型操作成本速查表(全部用內建 estimatePoints 計算)

| 操作 | 模型(預設槽) | 計算式 | points | 估 USD |
|---|---|---|---|---|
| 生成 1 張圖 | fal-ai/flux-pro/v1.1(imageEngine 預設) | base 4,無乘數 | **4** | $0.04 |
| 1 支 5s 影片(t2v) | fal-ai/kling-video/v2.1/pro/text-to-video | base 49 已含 5s free | **49** | $0.49 |
| 1 支 5s 影片(i2v) | fal-ai/kling-video/v2.1/pro/image-to-video | base 55 已含 5s | **55** | $0.55 |
| 1 支 10s Kling Pro t2v | 同上 | 49 + (10−5)×9.8 | **98** | $0.98 |
| 1 支 5s Veo3(fal) | fal-ai/veo3 | base 40 已含 5s | **40** | $0.40 |
| 1 支 5s Veo3 Pro | fal-ai/veo3/pro | base 80 已含 5s | **80** | $0.80 |
| 1 支 8s Veo3 Pro | 同上 | 80 + 3×16 | **128** | $1.28 |
| 1 段音樂 30s | fal-ai/stable-audio(falTextToAudioEngine 預設) | base 5 已含 30s | **5** | $0.05 |
| 1 段音樂 60s | fal-ai/stable-audio | 5 + round(30×0.17)=5+5 | **10** | $0.10 |
| 1 首完整歌曲 | suno-v4(proStudio.ts:2040 依 modelVersion 選 key) | 每首固定 | **10** | $0.10 |
| 1 首完整歌曲 | suno-v3.5 | 每首固定 | **6** | $0.06 |
| 1 段 TTS 100 字 | fal-ai/elevenlabs/tts/turbo-v2.5(voiceEngine 預設) | 1 + ceil(0.1×1)=1+1 | **2** | $0.02 |
| 1 段 TTS 100 字(高階) | elevenlabs/eleven-v3 | 4 + ceil(0.1×4)=4+1 | **5** | $0.05 |
| 1 次 LoRA 訓練(預設 1000 步,loraTrainer.ts:164) | fal-ai/flux-lora-fast-training | 200 + 1000×0.1 | **300** | $3.00 |
| 1 次光球對話 | Opus 槽 / Haiku 槽 | **0 pts(不扣點)**;內部 USD 見 §2.2 | 0 | $0.12 / $0.0064(平台吸收) |
| 1 次導演 chat | perplexity/sonar-pro | 不扣點;trace USD 被 Flash 費率低估 | 0 | ~$0.0005(低估) |

### 導演批次:60 段全模態一鍵(director.autoGenerateFromSegments,director.ts:2178-2402)

假設每段 5s(storyboard 未標時長時預設 5s,:2194)、旁白 ~100 字、全勾 image+video+audio+voice+sfx、引擎用 fal 槽預設:

| 模態 | 模型 | 每段 pts | ×60 |
|---|---|---|---|
| image | flux-pro/v1.1 | 4 | 240 |
| video(t2v) | kling v2.1 pro t2v | 49 | 2,940 |
| audio(配樂) | stable-audio(5s≤30s free) | 5 | 300 |
| voice(旁白 100 字) | elevenlabs tts turbo-v2.5 | 2 | 120 |
| sfx(soundDesign 有值時) | stable-audio(≤30s) | 5 | 300 |
| **合計** | | | **3,900 pts ≈ $39.0** |

- 勾 `useImageAsFirstFrame` → video 改 kling pro **i2v** 55 pts/段 → 合計 **4,260 pts ≈ $42.6**。
- 若段長 10s:video 98/段、audio 仍 5 → 合計約 6,840 pts ≈ $68。
- 此 mutation 只**預檢**餘額(:2384-2402,不足拋 FORBIDDEN),實際逐任務扣點在派工執行時;CO-STAR 腳本批次 LLM 呼叫(:1091)不扣點。

---

## 5. 落差風險(內建表 vs 供應商實際帳單)

| # | 風險點 | 證據 | 影響 |
|---|---|---|---|
| 1 | **定價快照時點=2025 Q2**(檔頭 :23「參考真實成本(2025 Q2)」),而 fal 模型單價常變(新模型上架即降價、preview→GA 改價) | modelPricing.ts:23-31 | 全表單價可能已漂移;Veo3/Sora 級尤甚 |
| 2 | **最後實質更新 2026-05-18**(`442c2e2a` align DB defaults + Gemini 3 Pro/GPT-5);之後 6 週無 pricing 調整 commit | `git log -- server/services/modelPricing.ts`:442c2e2a(05-18)、92c05cd9(05-16)、1956d81d(05-08)、ccc71c1b(05-06)、507d411f(05-03) | 05-18 起的 fal 牌價變動未反映 |
| 3 | **Suno 走第三方 proxy credit 制**(apibox.erweima.ai 預儲 credit、按首扣),內建表按 10/6 pts 固定;proxy 匯率與官方無關且可單方調整(2026-05 已發生回應契約變更,modelClients.ts:434) | A 文件 §1.1、proStudio.ts:2029-2091 | 每首實際成本與 10 pts 假設可能脫鉤;需拿 providerSnapshotJob 的 credit 快照對帳 |
| 4 | **未知模型 fallback 固定 5 pts、不乘時長** | modelPricing.ts:3279-3288 | `fal-ai/kling-video/v1/standard/text-to-video`(modelClients.ts:315 legacy 映射)等 5 個漏登錄 id 若被送單,影片只收 $0.05 |
| 5 | **多處刻意補貼/不對齊**:ElevenLabs V3 真實 ~$0.18/1k 只收 4 pts/1k(:26);flux/dev base 3 pts vs baseCostUsd 0.025;nemotron-ultra 3 pts vs 0.04 | modelPricing.ts:26,148-161,3232-3245 | points 收入 < 內建 USD 成本,毛利為負的條目需盤點 |
| 6 | **LLM 完全不扣點**:光球/導演/精靈全部 LLM 呼叫 0 pts,成本僅 LangSmith trace 歸屬;且 sonar/nemotron 不在 llm.ts USD 表 → 按 Flash 費率低估 | ai.ts(無扣點呼叫)、llm.ts:634-635 | LLM 帳單(OpenRouter/Anthropic)整塊在 points 體系外,重度聊天使用者=純成本 |
| 7 | **LoRA 訓練扣點路徑存疑**:`loraTrainer.ts` 與 `models.ts` 內找不到 `estimatePoints`/`deductUserPoints`;僅精靈工具 trainingSpecialistTools.ts:579 有估算 | grep 驗證 | 若訓練提交確實未扣點,每次 $2-5 真實成本無人買單(需人工確認派工鏈是否另有扣點) |
| 8 | 對帳機制已存在但依賴目錄準確:`calculateActualCost`(webhook 實際秒數重算)與 `catalogCostFallback`(`costSource=catalog` 標記)都以本表單價為真值 —— **表錯則對帳一起錯** | modelPricing.ts:3376、cost/catalogCostFallback.ts | 建議定期抓 fal 牌價 diff 本表(A §待補) |

---

*資料來源:server/services/modelPricing.ts(3,500 行全讀)、server/_core/llm.ts:599-641、server/routers/credits.ts、drizzle/schema.ts:1337-1547、server/routers/director.ts:2140-2410、server/routers/proStudio.ts:60-120,2029-2091、server/routers/loraTrainer.ts:164、shared/currency.ts:16、server/services/cost/catalogCostFallback.ts。*

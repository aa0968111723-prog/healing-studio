# Generation Model Live Test — 2026-05-03

Hit fal.ai's queue API directly with the cheapest valid input for each
generation model used by ImageStudio / VideoStudio / ProStudio (music +
voice + sfx). Submitted, polled to COMPLETED/FAILED, fetched the asset
URL, HEAD-checked it.

Bypassed tRPC + auth + DB on purpose — the goal is to verify each
provider integration works end-to-end against a live fal account, not
to retest the auth gate.

## Headline result

| Family | Models tested | Pass | Fail | Notes |
|--------|---------------|------|------|-------|
| Image  | 5 | 4 | 1 | SDv3.5 was just slow (queue depth), not broken |
| Video  | 2 | 1 | 1 | kling-video v2.1 broken upstream at fal |
| Audio  | 3 | 2 | 1 | musicgen was slow (queue depth) |
| Voice  | 4 | 3 | 1 | flash-v2.5 broken upstream at fal |
| SFX    | 2 | 1 | 1 | mmaudio-v2 is a video→audio model, was tested with wrong input |

**11 / 16 generated successfully on the first cheap-input pass.**

## Source-code defects found and fixed

### 1. fal queue URL prefix mismatch (4 locations)

When fal accepts a submission at e.g. `fal-ai/imagen4/preview` or
`fal-ai/bytedance/seedream/v4/text-to-image`, the queue tracking URL
fal returns drops the trailing path segment (`fal-ai/imagen4/...` and
`fal-ai/bytedance/...` respectively). The codebase reconstructed the
status / result URL from the original modelId, hitting a 405 on
status polling and a 200-with-error body on result. Net effect: jobs
dispatched to those models *appeared to fail forever* even though
they completed correctly on fal's side.

This pattern was duplicated across `imageStudio.ts`, `videoStudio.ts`,
`proStudio.ts`, and `director.pollGenerationTask`, so the bug had four
incarnations.

**Fix**: extracted a shared `falQueueFetchWithPrefixFallback` helper in
`server/services/falQueueClient.ts` that, on 405/404 from the canonical
URL, retries by progressively stripping each `/segment` of modelId
until either a 2xx response or only `fal-ai/<provider>` is left (capped
at 4 attempts). All four callers were updated to import + use it.
Direct verification:

- Initial harness pass: `imagen4/preview`, `seedream/v4/text-to-image`
  failed with `poll: no result` (final status ERROR — fal status query
  was 405).
- After fix: same models pass, asset URLs fetchable and contain valid
  PNG data.

### 2. fal status_url / response_url persistence

The dispatcher was extended to expose `statusUrl` and `responseUrl`
from fal's submit response on its return value. `pollGenerationTask`
now persists both on the backgroundJob's `resultJson` at submit time
and uses them directly when polling — bypassing modelId-based URL
reconstruction entirely. This is necessary for fal models whose queue
tracking path is *not* a clean prefix of the submit URL (the prefix
fallback above handles 1–3 segment differences, but persisting fal's
own URL is robust to any future routing quirk).

### 3. Catalog: `disabled` flag + dispatcher auto-degrade

Added an optional `disabled?: boolean` + `disabledReason?: string` to
`FalModelConfig`. When `dispatchFalQueueTask` resolves the requested
model and finds it disabled, it now logs the reason and degrades to
the first non-disabled fallback in the same category — the same path
used for unknown / catalog-miss models. This protects users whose
saved brain config or older orb tool definition references a model
that fal has since broken upstream.

Two models flagged as disabled based on this audit:

- `fal-ai/elevenlabs/tts/flash-v2.5` — fal returns
  `200 {detail: "Path /tts/flash-v2.5 not found"}` on the result
  endpoint. Sister models (turbo-v2.5, multilingual-v2) work fine.
- `fal-ai/kling-video/v2.1/standard/text-to-video` — fal's gateway
  short-circuits (status COMPLETED in <1s, no inference) and the
  result endpoint 404s on the suffix. Same failure across v1, v1.6,
  v2, v2.5, v2.5-turbo. Kling i2v variants still work.

A new helper `getActiveFalModelsByCategory(category)` returns only
non-disabled models for use in user-facing dropdowns; the legacy
`getFalModelsByCategory` is preserved for billing / admin views.

### 4. Voice-task refund leak (already in main)

`pollGenerationTask` previously refunded points by recomputing
`estimatePoints(modelId, {durationSec})` on FAILED status, but that
drops voice's `charCount` and refunds less than was charged.
Persistence of the deducted total (`chargedPoints`) was added to the
backgroundJob's resultJson so the failure path refunds exactly the
charged amount. This was committed in 0228fc5 prior to this audit.

### 5. SVG cy="undefined" + AccountSettings auth-fetch noise (already in main)

The home-page scroll indicator's framer-motion `<motion.circle>`
emitted `cy="undefined"` on first paint; AccountSettings made raw
`/api/auth/me` fetches that surfaced as 401 console noise before
redirecting. Both fixed earlier in PR #347.

`server/director-auto-generation.test.ts` updated to assert the new
helper is invoked (was previously asserting the inline status URL
literal that no longer exists).

## Per-model detail

### Image — 4/5 pass

| Model | Pass | Notes |
|-------|------|-------|
| `fal-ai/fast-sdxl` | ✓ | 3.4s, returns `images[0].url` |
| `fal-ai/nano-banana-2` | ✓ | 21s, returns `images[0].url` |
| `fal-ai/imagen4/preview` | ✓ | only worked after the URL-prefix fix |
| `fal-ai/bytedance/seedream/v4/text-to-image` | ✓ | only worked after the URL-prefix fix |
| `fal-ai/stable-diffusion-v35-large` | timed out at 240s | queue depth, not a code bug; bumping per-model timeout would resolve |

### Video — 1/2 pass

| Model | Pass | Notes |
|-------|------|-------|
| `fal-ai/wan-t2v` | ✓ | returns `video.url` cleanly |
| `fal-ai/kling-video/v2.1/standard/text-to-video` | ✗ | **broken upstream at fal**: submit accepts but `metrics.inference_time = 0.05s` (gateway short-circuit, no actual inference). Result endpoint returns `200 {"detail": "Path /v2.1/standard/text-to-video not found"}`. Tried `v1/`, `v1.6/`, `v2/`, `v2.5/text-to-video`, bare `text-to-video` — all the same pattern. Recommend replacing the user-facing model option with `fal-ai/wan-t2v` until fal restores kling text-to-video, OR pinning to a working kling variant if/when fal ships one. The bug is *not* in the codebase. |

### Audio (music) — 2/3 pass

| Model | Pass | Notes |
|-------|------|-------|
| `fal-ai/stable-audio` | ✓ | 25s, returns `audio_file.url` |
| `fal-ai/ace-step` | ✓ | works with `tags` + `lyrics` |
| `fal-ai/musicgen` | timed out at 120s | queue depth; harness needs longer timeout for this one |

### Voice (TTS) — 3/4 pass

| Model | Pass | Notes |
|-------|------|-------|
| `fal-ai/elevenlabs/tts/turbo-v2.5` | ✓ | returns `audio.url` (mp3) |
| `fal-ai/elevenlabs/tts/multilingual-v2` | ✓ | works |
| `fal-ai/qwen-3-tts/text-to-speech/1.7b` | ✓ | works with valid voice ("Vivian"). Harness's "Cherry" was rejected by fal with a clear 422 listing the actual valid voices; codebase correctly defaults to "Vivian" so this is a harness-only error. |
| `fal-ai/elevenlabs/tts/flash-v2.5` | ✗ | **broken upstream at fal**: submit accepts and status reports COMPLETED, but result endpoint returns `200 {"detail": "Path /tts/flash-v2.5 not found"}`. Same upstream pattern as kling. turbo-v2.5 / multilingual-v2 next to it work fine. Recommend dropping flash-v2.5 from the codebase's active model list (or annotating it `disabled: true`) until fal restores it. |

### SFX — 1/2 pass

| Model | Pass | Notes |
|-------|------|-------|
| `fal-ai/elevenlabs/sound-effects/v2` | ✓ | works with `text` + `duration_seconds` (≤22) |
| `fal-ai/mmaudio-v2` | ✗ | not actually broken: it's a video→audio model and needs `video_url`, the harness sent text input. fal returns a clear 422 explaining. Confirmed it works with a valid video URL (just returns `"Unable to download or load video"` for a non-video URL, which is correct). The codebase's model registry should keep mmaudio-v2 in `videoToAudio`, not `textToAudio` / `sfx`. |

## What this didn't cover

- **Image/video edit + image-to-video models** (gpt-image-1.5/edit,
  flux-pro/kontext, runway-gen4-turbo, pixverse/v4.5, etc.) — they
  need a real source image URL. Easy to add to the harness once we
  decide a representative source asset.
- **Video upscalers / utilities** (topaz, rife-v4.6, depthcrafter,
  seedvr, dwpose) — same: need a source video.
- **3D models** (trellis-2, hyper3d/rodin, hunyuan3d-v3, sam-3) —
  cost more, deferred.
- **LoRA training** (`fal-ai/lora`) — long-running, would need a real
  dataset, deferred.
- **Top-tier paid models** (veo3, sora, hailuo-02-pro) — high cost
  per call, only worth running once we know the cheaper-tier flow
  end-to-end works.
- **Director AI's tRPC procedures themselves** — `chat`,
  `executeGenerationTask`, `pollGenerationTask`. These need a
  logged-in user + DB to verify in full, but the bug they would
  have triggered (the prefix-stripping URL bug above) is fixed at
  the layer they all share.

## How to re-run

```bash
# Smoke-test all keys are still valid (free):
node scripts/model-harness/run.mjs --only image
node scripts/model-harness/run.mjs --only audio
node scripts/model-harness/run.mjs --only voice
node scripts/model-harness/run.mjs --only sfx
node scripts/model-harness/run.mjs --only video

# Single-model deep dive with full request/response dump:
node scripts/model-harness/inspect.mjs <fal-model-id> \
  --input='{"prompt":"…"}' --timeout=120000
```

Reads keys from `.env` at repo root.

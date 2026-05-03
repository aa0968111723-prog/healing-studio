#!/usr/bin/env node
/**
 * scripts/model-harness/run.mjs
 *
 * Hits fal.ai's queue API directly with the cheapest valid input for each
 * generation model used by ImageStudio / VideoStudio / ProStudio / Director.
 * Records pass / fail / error per model, downloads (HEAD) the asset URL on
 * success to confirm it's actually fetchable, and writes a JSON + Markdown
 * report.
 *
 * Bypasses tRPC + auth + DB on purpose: the goal is to verify each
 * provider integration end-to-end, not to retest the auth gate.
 *
 * Usage:
 *   node scripts/model-harness/run.mjs                     # default: full matrix
 *   node scripts/model-harness/run.mjs --only image        # one family
 *   node scripts/model-harness/run.mjs --only video        # …
 *   node scripts/model-harness/run.mjs --models a,b,c      # subset by model id
 *   node scripts/model-harness/run.mjs --skip-elevenlabs   # skip TTS (chars limited)
 *
 * Reads from .env at repo root.
 */

import "dotenv/config";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const REPORT_JSON = resolve(here, "report.json");
const REPORT_MD = resolve(here, "report.md");

const FAL_BASE = "https://queue.fal.run";
const FAL_KEY = process.env.FAL_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
if (!FAL_KEY) {
  console.error("FAL_API_KEY not set. Aborting.");
  process.exit(1);
}

const args = process.argv.slice(2);
const onlyFamily = (args.find(a => a.startsWith("--only=")) ?? "").slice(7) ||
  (args.includes("--only") ? args[args.indexOf("--only") + 1] : "");
const skipElevenLabs = args.includes("--skip-elevenlabs");
const onlyModelsArg = args.find(a => a.startsWith("--models="));
const onlyModels = onlyModelsArg ? new Set(onlyModelsArg.slice(9).split(",")) : null;

// ─── Cheapest valid inputs per model family ────────────────────────────────
//
// Each entry: { id, family, input, timeoutMs, notes, extraHeaders? }
// The harness submits, polls until COMPLETED / FAILED / timeout, and HEAD's
// the resulting asset URL when present.

// Verified-good source assets used as inputs for edit / i2v / v2v / 3D /
// avatar models. Generated earlier in this session via fast-sdxl + wan-t2v
// + a 5-image fast-sdxl LoRA dataset uploaded to fal storage.
const SAMPLE_IMAGE_URL = "https://v3b.fal.media/files/b/0a98c663/krVUyyLsiqoYAwkEfJpN4.jpg";
const SAMPLE_VIDEO_URL = "https://v3b.fal.media/files/b/0a98c6dd/-bgu5wjZ3W-Z1KHeNzR1c_tmpm9cv2tiq.mp4";
const SAMPLE_AUDIO_URL = "https://v3b.fal.media/files/b/0a98ba30/AfX8tACsBP_mfS6conJ7k_output.mp3";
const SAMPLE_LORA_DATASET_URL = "https://v3b.fal.media/files/b/0a98c6e2/iZ7BLqx6y0FwPWppnl4la_lora-dataset.zip";

const MATRIX = [
  // ────────── IMAGE: text-to-image ─────────────
  {
    id: "fal-ai/fast-sdxl",
    family: "image",
    input: { prompt: "a serene zen garden, minimal", num_inference_steps: 10, image_size: "square" },
    timeoutMs: 60_000,
  },
  {
    id: "fal-ai/nano-banana-2",
    family: "image",
    input: { prompt: "a serene zen garden, minimal", aspect_ratio: "1:1", num_images: 1 },
    timeoutMs: 90_000,
  },
  {
    id: "fal-ai/imagen4/preview",
    family: "image",
    input: { prompt: "a serene zen garden, minimal", aspect_ratio: "1:1", num_images: 1 },
    timeoutMs: 90_000,
  },
  {
    id: "fal-ai/bytedance/seedream/v4/text-to-image",
    family: "image",
    input: { prompt: "a serene zen garden, minimal", aspect_ratio: "1:1", num_images: 1 },
    timeoutMs: 90_000,
  },
  {
    id: "fal-ai/stable-diffusion-v35-large",
    family: "image",
    input: { prompt: "a serene zen garden, minimal", num_inference_steps: 12, image_size: "square_hd" },
    timeoutMs: 240_000,
  },

  // ────────── VIDEO: text-to-video (low cost only) ─────────────
  {
    id: "fal-ai/wan-t2v",
    family: "video",
    input: { prompt: "a peaceful pond at dawn, gentle ripples", num_frames: 81, aspect_ratio: "16:9" },
    timeoutMs: 180_000,
  },
  {
    id: "fal-ai/kling-video/v2.1/standard/text-to-video",
    family: "video",
    input: { prompt: "a peaceful pond at dawn, gentle ripples", duration: "5", aspect_ratio: "16:9" },
    timeoutMs: 240_000,
  },
  // Skipping veo3 / sora / hailuo-02-pro by default — high cost. Add via --models if needed.

  // ────────── AUDIO: text-to-music ─────────────
  {
    id: "fal-ai/stable-audio",
    family: "audio",
    input: { prompt: "lofi piano study session", seconds_total: 10 },
    timeoutMs: 120_000,
  },
  {
    id: "fal-ai/musicgen",
    family: "audio",
    input: { prompt: "lofi piano study session", duration: 10 },
    timeoutMs: 120_000,
    notes: "musicgen historically aliases under different fal endpoints — first canonical try here.",
  },
  {
    id: "fal-ai/ace-step",
    family: "audio",
    input: { tags: "ambient, calm, piano", lyrics: "[instrumental]" },
    timeoutMs: 180_000,
  },

  // ────────── SFX (sound effects) ─────────────
  {
    id: "fal-ai/mmaudio-v2",
    family: "sfx",
    input: { prompt: "rain on a tin roof", duration: 5 },
    timeoutMs: 120_000,
    // mmaudio-v2 actually requires an input video — may fail; we'll see what error comes back.
  },
  // ElevenLabs SFX is gated on EL credentials passthrough header.
  ...(skipElevenLabs ? [] : [{
    id: "fal-ai/elevenlabs/sound-effects/v2",
    family: "sfx",
    input: { text: "rain on tin roof", duration_seconds: 5, prompt_influence: 0.3 },
    timeoutMs: 60_000,
    extraHeaders: ELEVENLABS_KEY ? { "x-fal-client-credentials": ELEVENLABS_KEY } : undefined,
  }]),

  // ────────── VOICE: text-to-speech ─────────────
  // Keep TEXT VERY short to conserve ElevenLabs char budget (~37k total).
  ...(skipElevenLabs ? [] : [
    {
      id: "fal-ai/elevenlabs/tts/turbo-v2.5",
      family: "voice",
      input: { text: "Hi.", voice: "Rachel" },
      timeoutMs: 60_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
    {
      id: "fal-ai/elevenlabs/tts/flash-v2.5",
      family: "voice",
      input: { text: "Hi.", voice: "Rachel" },
      timeoutMs: 60_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
    {
      id: "fal-ai/elevenlabs/tts/multilingual-v2",
      family: "voice",
      input: { text: "Hi.", voice: "Rachel" },
      timeoutMs: 60_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
  ]),
  // Qwen TTS via fal (does not need ElevenLabs creds)
  {
    id: "fal-ai/qwen-3-tts/text-to-speech/1.7b",
    family: "voice",
    input: { text: "你好", voice: "Cherry" },
    timeoutMs: 60_000,
  },

  // ────────── IMAGE EDIT (i2i) ─────────────
  {
    id: "fal-ai/nano-banana/edit",
    family: "image-edit",
    input: { prompt: "make it sunset", image_urls: [SAMPLE_IMAGE_URL] },
    timeoutMs: 120_000,
  },
  {
    id: "fal-ai/nano-banana-2/edit",
    family: "image-edit",
    input: { prompt: "make it sunset", image_urls: [SAMPLE_IMAGE_URL] },
    timeoutMs: 120_000,
  },
  {
    id: "fal-ai/nano-banana-pro/edit",
    family: "image-edit",
    input: { prompt: "make it sunset", image_urls: [SAMPLE_IMAGE_URL] },
    timeoutMs: 180_000,
  },
  {
    id: "fal-ai/flux-pro/kontext",
    family: "image-edit",
    input: { prompt: "make it sunset", image_url: SAMPLE_IMAGE_URL },
    timeoutMs: 120_000,
  },
  {
    id: "fal-ai/seedvr/upscale/image",
    family: "image-edit",
    input: { image_url: SAMPLE_IMAGE_URL, upscale_factor: 2 },
    timeoutMs: 180_000,
  },

  // ────────── IMAGE-TO-VIDEO (i2v) ─────────────
  {
    id: "fal-ai/wan-i2v",
    family: "i2v",
    input: { prompt: "gentle camera pan", image_url: SAMPLE_IMAGE_URL, num_frames: 81 },
    timeoutMs: 300_000,
  },
  {
    id: "fal-ai/ltx-video/image-to-video",
    family: "i2v",
    input: { prompt: "gentle motion", image_url: SAMPLE_IMAGE_URL },
    timeoutMs: 240_000,
  },
  // High-cost i2v — minimum duration each
  {
    id: "fal-ai/runway-gen4-turbo/image-to-video",
    family: "i2v",
    input: { prompt: "soft cinematic pan", image_url: SAMPLE_IMAGE_URL, duration: "5", ratio: "1280:720" },
    timeoutMs: 300_000,
    notes: "high-cost",
  },
  {
    id: "fal-ai/pixverse/v4.5/image-to-video",
    family: "i2v",
    input: { prompt: "soft motion", image_url: SAMPLE_IMAGE_URL, duration: "5", quality: "360p", aspectRatio: "1:1" },
    timeoutMs: 300_000,
  },
  {
    id: "fal-ai/kling-video/v2.1/standard/image-to-video",
    family: "i2v",
    input: { prompt: "soft motion", image_url: SAMPLE_IMAGE_URL, duration: "5", aspect_ratio: "16:9" },
    timeoutMs: 300_000,
  },

  // ────────── VIDEO-TO-VIDEO + UTILITY (v2v) ─────────────
  {
    // canonical fal path is rife/v4.6 with a slash. The codebase used to
    // reference rife-v4.6/video which 404s; alias added in
    // shared/engineModelIds.ts.
    id: "fal-ai/rife/v4.6",
    family: "v2v",
    input: { video_url: SAMPLE_VIDEO_URL, multiplier: 2 },
    timeoutMs: 240_000,
  },
  {
    id: "fal-ai/animatediff-v2v",
    family: "v2v",
    input: { prompt: "anime style", video_url: SAMPLE_VIDEO_URL },
    timeoutMs: 300_000,
  },
  // depthcrafter — fal removed this app entirely (404 'Application "depthcrafter" not found')
  // Marked disabled in the catalog rather than retried here.

  // ────────── 3D ─────────────
  {
    id: "fal-ai/trellis-2",
    family: "3d",
    input: { image_url: SAMPLE_IMAGE_URL },
    timeoutMs: 240_000,
  },
  {
    id: "fal-ai/hyper3d/rodin",
    family: "3d",
    input: { input_image_urls: [SAMPLE_IMAGE_URL] },
    timeoutMs: 600_000,
  },

  // ────────── AVATAR / TALKING-HEAD (image+audio → video) ─────────────
  {
    id: "fal-ai/stable-avatar",
    family: "avatar",
    input: { image_url: SAMPLE_IMAGE_URL, audio_url: SAMPLE_AUDIO_URL, text_prompt: "calm" },
    timeoutMs: 600_000,
  },

  // ────────── VOICE-CLONE / DESIGN ─────────────
  {
    id: "fal-ai/qwen-3-tts/clone-voice/1.7b",
    family: "voice-clone",
    input: { audio_url: SAMPLE_AUDIO_URL, reference_text: "Hi" },
    timeoutMs: 120_000,
    notes: "returns speaker_embedding, not audio — pickAssetUrl will miss; OK to fail at extract",
  },
  {
    id: "fal-ai/qwen-3-tts/voice-design/1.7b",
    family: "voice-clone",
    input: { description: "calm warm female voice", text: "Hi", language: "English" },
    timeoutMs: 120_000,
  },
  ...(skipElevenLabs ? [] : [
    {
      id: "fal-ai/elevenlabs/voice-changer",
      family: "voice-clone",
      input: { audio_url: SAMPLE_AUDIO_URL, voice: "Rachel" },
      timeoutMs: 120_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
  ]),

  // ────────── AUDIO UTILITIES ─────────────
  {
    id: "fal-ai/demucs",
    family: "audio-util",
    input: { audio_url: SAMPLE_AUDIO_URL },
    timeoutMs: 180_000,
  },
  ...(skipElevenLabs ? [] : [
    {
      id: "fal-ai/elevenlabs/audio-isolation",
      family: "audio-util",
      input: { audio_url: SAMPLE_AUDIO_URL },
      timeoutMs: 120_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
  ]),

  // ────────── HIGH-COST T2V (premium / ultra tier) ─────────────
  // Each pinned to MINIMUM cost: smallest duration / cheapest preset.
  {
    id: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    family: "premium-t2v",
    input: { prompt: "a peaceful pond", duration: "6", resolution: "768P" },
    timeoutMs: 600_000,
    notes: "high-cost",
  },
  {
    id: "fal-ai/ltx-video-13b-distilled",
    family: "premium-t2v",
    input: { prompt: "a peaceful pond" },
    timeoutMs: 600_000,
  },
  // veo3 / sora often run >$0.40 per call; gated behind --include-ultra
  ...((process.argv.includes("--include-ultra")) ? [
    {
      id: "fal-ai/veo3",
      family: "ultra-t2v",
      input: { prompt: "a peaceful pond" },
      timeoutMs: 600_000,
      notes: "ultra-cost",
    },
    {
      id: "fal-ai/sora",
      family: "ultra-t2v",
      input: { prompt: "a peaceful pond" },
      timeoutMs: 600_000,
      notes: "ultra-cost",
    },
  ] : []),

  // ────────── LoRA TRAINING ─────────────
  // Smallest viable run on a 5-image dataset I uploaded to fal storage.
  {
    id: "fal-ai/lora",
    family: "training",
    input: {
      images_data_url: SAMPLE_LORA_DATASET_URL,
      steps: 100,
      trigger_word: "zenharness",
      create_masks: false,
    },
    timeoutMs: 1_200_000,
    notes: "trains LoRA on 5 zen-garden images, ~$3-5 budget",
  },

  // ────────── ROUND 4: REMAINING FAMILIES ─────────────

  // Voice clone + design (round 4)
  {
    id: "fal-ai/dia-tts/voice-clone",
    family: "voice-clone-r4",
    input: { text: "[S1] Hi everyone! [S2] Hi back!" },
    timeoutMs: 120_000,
  },
  ...(skipElevenLabs ? [] : [
    {
      id: "fal-ai/elevenlabs/voice-cloning",
      family: "voice-clone-r4",
      input: { audio_url: SAMPLE_AUDIO_URL, name: "harness-test-voice" },
      timeoutMs: 120_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
  ]),
  {
    id: "fal-ai/kling-video/create-voice",
    family: "voice-clone-r4",
    input: { audio_url: SAMPLE_AUDIO_URL, name: "harness-test-voice" },
    timeoutMs: 180_000,
  },

  // Avatar / talking head (round 4)
  {
    id: "fal-ai/longcat-single-avatar/audio-to-video",
    family: "avatar-r4",
    input: { image_url: SAMPLE_IMAGE_URL, audio_url: SAMPLE_AUDIO_URL },
    timeoutMs: 600_000,
  },
  {
    id: "fal-ai/echomimic-v3",
    family: "avatar-r4",
    input: { image_url: SAMPLE_IMAGE_URL, audio_url: SAMPLE_AUDIO_URL },
    timeoutMs: 600_000,
  },

  // Video utilities (round 4)
  {
    id: "fal-ai/topaz/video-enhance",
    family: "video-util",
    input: { video_url: SAMPLE_VIDEO_URL, output_scale: 2 },
    timeoutMs: 900_000,
    notes: "ultra-tier",
  },
  {
    id: "fal-ai/bytedance/upscaler/video",
    family: "video-util",
    input: { video_url: SAMPLE_VIDEO_URL, target_resolution: "2k" },
    timeoutMs: 600_000,
  },
  {
    id: "fal-ai/cammaster",
    family: "video-util",
    input: { video_url: SAMPLE_VIDEO_URL, prompt: "smooth dolly zoom" },
    timeoutMs: 600_000,
  },
  {
    id: "fal-ai/dwpose",
    family: "video-util",
    input: { video_url: SAMPLE_VIDEO_URL },
    timeoutMs: 240_000,
  },

  // 3D round 4
  {
    id: "fal-ai/hunyuan3d-v3/image-to-3d",
    family: "3d-r4",
    input: { input_image_url: SAMPLE_IMAGE_URL },
    timeoutMs: 600_000,
  },
  {
    id: "fal-ai/sam-3/3d-objects",
    family: "3d-r4",
    input: { image_url: SAMPLE_IMAGE_URL, prompt: "garden lantern" },
    timeoutMs: 240_000,
  },

  // Sonauto music
  {
    id: "sonauto/v2/text-to-music",
    family: "audio-r4",
    input: { tags: "ambient, piano, calm", duration: 30 },
    timeoutMs: 300_000,
    notes: "fal alias for sonauto",
  },

  // ASR
  {
    id: "fal-ai/whisper",
    family: "asr",
    input: { audio_url: SAMPLE_AUDIO_URL },
    timeoutMs: 120_000,
  },
  {
    id: "fal-ai/wizper",
    family: "asr",
    input: { audio_url: SAMPLE_AUDIO_URL },
    timeoutMs: 120_000,
  },

  // ElevenLabs dubbing
  ...(skipElevenLabs ? [] : [
    {
      id: "fal-ai/elevenlabs/dubbing",
      family: "audio-util-r4",
      input: { video_url: SAMPLE_VIDEO_URL, target_lang: "es" },
      timeoutMs: 600_000,
      extraHeaders: { "x-fal-client-credentials": ELEVENLABS_KEY },
    },
  ]),
];

// ─── HTTP plumbing ─────────────────────────────────────────────────────────

async function falSubmit(modelId, input, extraHeaders) {
  const res = await fetch(`${FAL_BASE}/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(input),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    return { ok: false, status: res.status, body };
  }
  return { ok: true, body };
}

async function falStatus(modelId, requestId, statusUrl) {
  // Prefer the status_url returned by fal at submit time. fal sometimes
  // routes /preview, /text-to-image and similar variants to a different
  // queue prefix than the submit path, so reconstructing the URL from
  // modelId yields 405 for those models. The submit response always
  // carries the canonical tracking URL — use it.
  const url = statusUrl ?? `${FAL_BASE}/${modelId}/requests/${requestId}/status`;
  const res = await fetch(url, { headers: { Authorization: `Key ${FAL_KEY}` } });
  return res.ok ? res.json() : { status: "ERROR", _http: res.status };
}

async function falResult(modelId, requestId, responseUrl) {
  const url = responseUrl ?? `${FAL_BASE}/${modelId}/requests/${requestId}`;
  const res = await fetch(url, { headers: { Authorization: `Key ${FAL_KEY}` } });
  return res.ok ? res.json() : null;
}

function pickAssetUrl(data) {
  if (!data || typeof data !== "object") return null;
  // Recursive walk: return the first string value that looks like an HTTPS
  // asset URL anywhere in the response payload. This covers all common
  // shapes the harness encounters: top-level url, image[].url,
  // speaker_embedding.url (qwen voice clone), vocals.url / drums.url
  // (demucs), audio_isolated.url (elevenlabs isolation), output.url, etc.
  // Skips fal's own metadata URLs (status_url, response_url, cancel_url).
  const SKIP_KEYS = new Set([
    "status_url",
    "response_url",
    "cancel_url",
  ]);
  function walk(node, key) {
    if (typeof node === "string") {
      if (SKIP_KEYS.has(key)) return null;
      if (/^https?:/.test(node) || /^data:/.test(node)) return node;
      return null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, key);
        if (found) return found;
      }
      return null;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (SKIP_KEYS.has(k)) continue;
        const found = walk(v, k);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(data, "");
}

async function headOk(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return { ok: res.ok, status: res.status, contentType: res.headers.get("content-type") };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function runOne(entry) {
  const startedAt = Date.now();
  console.log(`▶ ${entry.id} (${entry.family})`);
  const submit = await falSubmit(entry.id, entry.input, entry.extraHeaders);
  if (!submit.ok) {
    return {
      id: entry.id, family: entry.family,
      pass: false,
      stage: "submit",
      httpStatus: submit.status,
      error: typeof submit.body === "string"
        ? submit.body.slice(0, 600)
        : JSON.stringify(submit.body).slice(0, 600),
      durationMs: Date.now() - startedAt,
    };
  }
  const requestId = submit.body?.request_id;
  const statusUrl = submit.body?.status_url;
  const responseUrl = submit.body?.response_url;
  if (!requestId) {
    return {
      id: entry.id, family: entry.family, pass: false, stage: "submit",
      error: "no request_id in submit response",
      durationMs: Date.now() - startedAt,
    };
  }

  // Poll until COMPLETED/FAILED/timeout
  const deadline = startedAt + entry.timeoutMs;
  let lastStatus = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await falStatus(entry.id, requestId, statusUrl);
    lastStatus = st;
    if (st.status === "COMPLETED" || st.status === "FAILED" || st.status === "ERROR") break;
  }

  if (lastStatus?.status !== "COMPLETED") {
    return {
      id: entry.id, family: entry.family, pass: false,
      stage: "poll",
      finalStatus: lastStatus?.status ?? "TIMEOUT",
      error: lastStatus?.error || lastStatus?.detail || "no result",
      requestId,
      durationMs: Date.now() - startedAt,
    };
  }

  // Fetch result, extract asset URL, HEAD it
  const result = await falResult(entry.id, requestId, responseUrl);
  const url = pickAssetUrl(result);
  if (!url) {
    return {
      id: entry.id, family: entry.family, pass: false,
      stage: "extract",
      error: "no asset URL in result",
      result: JSON.stringify(result).slice(0, 600),
      requestId,
      durationMs: Date.now() - startedAt,
    };
  }
  const head = await headOk(url);
  return {
    id: entry.id, family: entry.family,
    pass: head.ok,
    stage: head.ok ? "ok" : "head-failed",
    url,
    contentType: head.contentType ?? null,
    headStatus: head.status ?? null,
    requestId,
    durationMs: Date.now() - startedAt,
  };
}

async function main() {
  let matrix = MATRIX;
  if (onlyFamily) matrix = matrix.filter(m => m.family === onlyFamily);
  if (onlyModels) matrix = matrix.filter(m => onlyModels.has(m.id));

  console.log(`Running ${matrix.length} models against fal.ai…`);
  const results = [];
  for (const entry of matrix) {
    try {
      const r = await runOne(entry);
      results.push(r);
      const tag = r.pass ? "✓" : "✗";
      console.log(`  ${tag} ${entry.id} — ${r.stage}${r.error ? `: ${String(r.error).slice(0, 120)}` : ""}`);
    } catch (err) {
      const r = {
        id: entry.id, family: entry.family, pass: false, stage: "harness-crash",
        error: err.message,
      };
      results.push(r);
      console.log(`  ✗ ${entry.id} — harness-crash: ${err.message}`);
    }
  }

  await fs.writeFile(REPORT_JSON, JSON.stringify(results, null, 2));

  const lines = [];
  lines.push(`# Model Harness Report\n`);
  lines.push(`Ran ${results.length} models. Pass: ${results.filter(r => r.pass).length}. Fail: ${results.filter(r => !r.pass).length}.\n`);
  lines.push(`## Per-model summary\n`);
  lines.push(`| Family | Model | Pass | Stage | Notes |`);
  lines.push(`|--------|-------|------|-------|-------|`);
  for (const r of results) {
    const tag = r.pass ? "✓" : "✗";
    const note = r.pass
      ? `${r.contentType ?? "?"} · ${Math.round(r.durationMs / 1000)}s`
      : (String(r.error ?? r.stage).replace(/\|/g, "\\|").slice(0, 200));
    lines.push(`| ${r.family} | \`${r.id}\` | ${tag} | ${r.stage} | ${note} |`);
  }
  lines.push(`\n## Failures (full detail)\n`);
  for (const r of results.filter(r => !r.pass)) {
    lines.push(`### \`${r.id}\` (${r.family})`);
    lines.push(`- stage: \`${r.stage}\``);
    if (r.httpStatus) lines.push(`- http: ${r.httpStatus}`);
    if (r.finalStatus) lines.push(`- final fal status: ${r.finalStatus}`);
    if (r.requestId) lines.push(`- request_id: \`${r.requestId}\``);
    if (r.error) lines.push(`- error: \`${String(r.error).slice(0, 600)}\``);
    if (r.result) lines.push(`- result: \`${String(r.result).slice(0, 600)}\``);
    lines.push("");
  }
  await fs.writeFile(REPORT_MD, lines.join("\n"));
  console.log(`\nReport: ${REPORT_MD}`);
}

main().catch(err => { console.error(err); process.exit(1); });

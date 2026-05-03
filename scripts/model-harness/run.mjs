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

  // ────────── UTILITY: video upscaler / image upscaler / depth ─────────────
  // Skipping by default; need a real source URL to test.
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
  const candidates = [];
  candidates.push(data.url);
  candidates.push(data.audio_url);
  candidates.push(data.video_url);
  candidates.push(data.image_url);
  if (data.image && typeof data.image === "object") candidates.push(data.image.url);
  if (Array.isArray(data.images) && data.images[0]) candidates.push(data.images[0].url);
  if (data.video && typeof data.video === "object") candidates.push(data.video.url);
  if (Array.isArray(data.videos) && data.videos[0]) candidates.push(data.videos[0].url);
  if (data.audio && typeof data.audio === "object") candidates.push(data.audio.url);
  if (data.audio_file && typeof data.audio_file === "object") candidates.push(data.audio_file.url);
  if (data.output && typeof data.output === "object") candidates.push(data.output.url);
  if (Array.isArray(data.audios) && data.audios[0]) candidates.push(data.audios[0].url);
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
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

/**
 * orbVoiceProcessor.ts — ASR + LLM + TTS pipeline for OrbVoice Gateway (AIDV-120)
 *
 * Three stateless service functions:
 *   transcribeAudioBuffer  — Buffer → text  (Whisper via BUILT_IN_FORGE_API_URL)
 *   generateOrbReply       — text  → text  (invokeLLM, auto-engine)
 *   synthesizeOrbSpeech    — text  → mp3 Buffer (ElevenLabs)
 *
 * All fail-closed: missing keys throw synchronously, never produce silent garbage.
 */

import { ENV } from "../_core/env";
import { invokeLLM } from "../_core/llm";
import { resolveProviderBaseUrl, providerGatewayHeaders } from "../_core/providerFacade";

const ORB_VOICE_ID =
  process.env.ORB_ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL"; // ElevenLabs "Sarah"

// ── ASR ──────────────────────────────────────────────────────────────────────

export async function transcribeAudioBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  if (!ENV.forgeApiUrl) throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  if (!ENV.forgeApiKey) throw new Error("BUILT_IN_FORGE_API_KEY is not configured");

  const ext = mimeToExt(mimeType);
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("prompt", "Transcribe the user's voice to text");

  const baseUrl = ENV.forgeApiUrl.replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ENV.forgeApiKey}`,
      "Accept-Encoding": "identity",
    },
    body: form,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Whisper ASR failed: ${res.status} ${msg}`);
  }

  const json = (await res.json()) as { text?: string };
  if (!json.text) throw new Error("Whisper returned empty transcript");
  return json.text.trim();
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
  };
  return map[mime] ?? "webm";
}

// ── LLM ──────────────────────────────────────────────────────────────────────

const ORB_SYSTEM =
  "你是癒心所（Healing Studio）的 AI 助手 Orb，專門協助創作者製作療癒系短影音。" +
  "請用溫暖、簡潔的語氣回答，回應不超過 3 句話，優先使用繁體中文。";

export async function generateOrbReply(userText: string): Promise<string> {
  const result = await invokeLLM({
    messages: [{ role: "user", content: userText }],
    systemPrompt: ORB_SYSTEM,
    maxTokens: 256,
    temperature: 0.7,
    timeoutMs: 20_000,
    runName: "orb-voice-reply",
  });

  const content = result.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? (content as Array<{ type: string; text?: string }>)
            .map(c => (c.type === "text" ? (c.text ?? "") : ""))
            .join("")
        : "";

  if (!text.trim()) throw new Error("LLM returned empty reply");
  return text.trim();
}

// ── TTS ──────────────────────────────────────────────────────────────────────

export async function synthesizeOrbSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured");

  const baseUrl = resolveProviderBaseUrl("elevenlabs");
  const res = await fetch(`${baseUrl}/v1/text-to-speech/${ORB_VOICE_ID}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
      ...providerGatewayHeaders("elevenlabs"),
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: 1.0 },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${msg}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

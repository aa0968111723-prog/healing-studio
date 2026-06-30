import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { verifySessionToken } from "../_core/googleAuth";
import { getAllowedOrigins } from "../services/agentToolExecutor";
import { randomUUID } from "node:crypto";
import {
  transcribeAudioBuffer,
  generateOrbReply,
  synthesizeOrbSpeech,
} from "../services/orbVoiceProcessor";

// Keyed by authenticated identity (payload.sub), not by client-controlled userId.
const activeSessions = new Map<string, number>();
// Global ceiling prevents FD/timer exhaustion regardless of per-user limits.
let globalConnections = 0;
const MAX_GLOBAL_CONNECTIONS = Number(process.env.ORB_VOICE_MAX_GLOBAL ?? 100);
// 64 KB per frame; enforced before ws buffers entire payload.
export const ORB_MAX_PAYLOAD_BYTES = 64 * 1024;

export async function handleOrbVoiceConnection(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifySessionToken(token);
  if (!payload?.sub) {
    ws.close(1008, "unauthorized");
    return;
  }

  // Use authenticated identity — never the client-supplied userId query param.
  const userKey = payload.sub;
  const orbTraceId = url.searchParams.get("orbTraceId") || `orb_${randomUUID()}`;
  const maxConcurrent = Number(process.env.ORB_VOICE_MAX_CONCURRENT ?? 3);
  const maxSessionMs = Number(process.env.ORB_VOICE_MAX_SESSION_MS ?? 600000);

  if (globalConnections >= MAX_GLOBAL_CONNECTIONS) {
    ws.close(1013, "server-at-capacity");
    return;
  }
  const current = activeSessions.get(userKey) ?? 0;
  if (current >= maxConcurrent) {
    ws.close(1013, "too-many-sessions");
    return;
  }
  activeSessions.set(userKey, current + 1);
  globalConnections += 1;

  const audioChunks: Buffer[] = [];
  let audioMimeType = "audio/webm";
  let processing = false;

  const timer = setTimeout(() => ws.close(1000, "session-timeout"), maxSessionMs);

  ws.on("message", async (raw: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    const chunk: Buffer =
      Buffer.isBuffer(raw)
        ? raw
        : typeof raw === "string"
          ? Buffer.from(raw, "utf8")
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw)
            : ArrayBuffer.isView(raw)
              ? Buffer.from((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength)
              : Buffer.concat(raw as Buffer[]);

    if (chunk.length > ORB_MAX_PAYLOAD_BYTES) {
      ws.send(JSON.stringify({ type: "error", message: "audio-chunk-too-large", orbTraceId }));
      return;
    }

    if (!isBinary) {
      // Text frame — control message
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(chunk.toString("utf8")) as Record<string, unknown>;
      } catch {
        return;
      }

      if (msg.type === "mimeType" && typeof msg.value === "string") {
        audioMimeType = msg.value;
        return;
      }

      if (msg.type === "stop") {
        if (processing || audioChunks.length === 0) return;
        processing = true;
        const audioBuffer = Buffer.concat(audioChunks.splice(0));

        try {
          // 1. ASR: audio → user text
          const userText = await transcribeAudioBuffer(audioBuffer, audioMimeType);
          if (ws.readyState !== 1 /* OPEN */) return;
          ws.send(JSON.stringify({ type: "userTranscript", text: userText, orbTraceId }));

          // 2. LLM: user text → orb reply
          const replyText = await generateOrbReply(userText);
          if (ws.readyState !== 1) return;
          ws.send(JSON.stringify({ type: "transcript", text: replyText, orbTraceId }));

          // 3. TTS: orb reply → speech
          const audioData = await synthesizeOrbSpeech(replyText);
          if (ws.readyState !== 1) return;
          ws.send(
            JSON.stringify({
              type: "audio",
              data: `data:audio/mpeg;base64,${audioData.toString("base64")}`,
              orbTraceId,
            }),
          );
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : "voice-pipeline-error";
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "error", message: errMsg, orbTraceId }));
          }
        } finally {
          processing = false;
        }
      }
      return;
    }

    // Binary frame = audio chunk from MediaRecorder
    audioChunks.push(chunk);
  });

  ws.on("close", () => {
    clearTimeout(timer);
    activeSessions.set(userKey, Math.max(0, (activeSessions.get(userKey) ?? 1) - 1));
    globalConnections = Math.max(0, globalConnections - 1);
  });

  ws.send(JSON.stringify({ type: "ready", allowedOrigins: getAllowedOrigins(), orbTraceId }));
}

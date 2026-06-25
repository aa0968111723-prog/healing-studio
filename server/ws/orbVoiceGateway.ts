import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { verifySessionToken } from "../_core/googleAuth";
import { getAllowedOrigins } from "../services/agentToolExecutor";
import { randomUUID } from "node:crypto";

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

  const timer = setTimeout(() => ws.close(1000, "session-timeout"), maxSessionMs);
  ws.on("message", (raw: any) => {
    const size = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
    if (size > ORB_MAX_PAYLOAD_BYTES) {
      ws.send(JSON.stringify({ type: "error", message: "audio-chunk-too-large", orbTraceId }));
      return;
    }
    ws.send(JSON.stringify({ type: "transcript", text: "(stub) 收到語音資料", orbTraceId }));
  });

  ws.on("close", () => {
    clearTimeout(timer);
    activeSessions.set(userKey, Math.max(0, (activeSessions.get(userKey) ?? 1) - 1));
    globalConnections = Math.max(0, globalConnections - 1);
  });

  ws.send(JSON.stringify({ type: "ready", allowedOrigins: getAllowedOrigins(), orbTraceId }));
}

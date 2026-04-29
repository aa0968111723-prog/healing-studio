import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { verifySessionToken } from "../_core/googleAuth";
import { getAllowedOrigins } from "../services/agentToolExecutor";
import { randomUUID } from "node:crypto";

const activeSessions = new Map<number, number>();

export async function handleOrbVoiceConnection(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token") ?? "";
  const payload = await verifySessionToken(token);
  if (!payload?.sub) {
    ws.close(1008, "unauthorized");
    return;
  }

  const userId = Number(url.searchParams.get("userId") ?? 0) || 0;
  const orbTraceId = url.searchParams.get("orbTraceId") || `orb_${randomUUID()}`;
  const maxConcurrent = Number(process.env.ORB_VOICE_MAX_CONCURRENT ?? 3);
  const maxSessionMs = Number(process.env.ORB_VOICE_MAX_SESSION_MS ?? 600000);
  const current = activeSessions.get(userId) ?? 0;
  if (current >= maxConcurrent) {
    ws.close(1013, "too-many-sessions");
    return;
  }
  activeSessions.set(userId, current + 1);

  const timer = setTimeout(() => ws.close(1000, "session-timeout"), maxSessionMs);
  ws.on("message", (raw: any) => {
    if (typeof raw !== "string" && raw.byteLength > 32 * 1024) {
      ws.send(JSON.stringify({ type: "error", message: "audio-chunk-too-large", orbTraceId }));
      return;
    }
    ws.send(JSON.stringify({ type: "transcript", text: "(stub) 收到語音資料", orbTraceId }));
  });

  ws.on("close", () => {
    clearTimeout(timer);
    activeSessions.set(userId, Math.max(0, (activeSessions.get(userId) ?? 1) - 1));
  });

  ws.send(JSON.stringify({ type: "ready", allowedOrigins: getAllowedOrigins(), orbTraceId }));
}

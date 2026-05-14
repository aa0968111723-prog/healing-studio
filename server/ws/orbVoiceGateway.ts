import type { IncomingMessage } from "http";
import type WebSocket from "ws";
import { verifySessionToken } from "../_core/googleAuth";
import { getAllowedOrigins } from "../services/agentToolExecutor";
import { randomUUID } from "node:crypto";

const activeSessions = new Map<number, number>();

/**
 * 語音閘道目前處於骨架狀態 —— ASR / Gemini Live 整合尚未串接。為避免在前端
 * 顯示「假 transcript」誤導使用者，預設會回傳結構化錯誤；管理員若想本地測試
 * 連線握手 / 限流邏輯，可把 ENABLE_ORB_VOICE_GATEWAY 設為 "true"。
 *
 * 等真實 ASR pipeline 落地後，把預設改為啟用並把這段邏輯換成轉送 Gemini
 * Live / Whisper / Google STT 即可。
 */
function isGatewayEnabled(): boolean {
  const raw = String(process.env.ENABLE_ORB_VOICE_GATEWAY ?? "false").toLowerCase();
  return raw === "true" || raw === "1";
}

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

  // 未啟用時：依然完成握手（讓前端拿到 traceId 不會 hang），但立刻送出結構化
  // 錯誤，前端會在 mic 圖示旁顯示「⚠️ 語音助理尚未啟用」，比之前回假 transcript
  // 對使用者更誠實。連線在訊息送出後優雅關閉。
  if (!isGatewayEnabled()) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "語音助理仍在串接 ASR，目前未啟用（ENABLE_ORB_VOICE_GATEWAY=false）",
        code: "voice-gateway-disabled",
        orbTraceId,
      })
    );
    setTimeout(() => ws.close(1011, "voice-gateway-disabled"), 50);
    return;
  }

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
    // ⚠️ ASR 尚未串接。即使 ENABLE_ORB_VOICE_GATEWAY=true 也只是讓 socket 維持
    // 連線狀態方便除錯——任何音訊資料都會回固定的 stub 標籤，前端會在 transcript
    // 區塊顯示「[STUB] ...」讓除錯者知道這不是真的辨識結果。
    ws.send(
      JSON.stringify({
        type: "transcript",
        text: "[STUB] 收到語音資料（語音 ASR 尚未串接）",
        stub: true,
        orbTraceId,
      })
    );
  });

  ws.on("close", () => {
    clearTimeout(timer);
    activeSessions.set(userId, Math.max(0, (activeSessions.get(userId) ?? 1) - 1));
  });

  ws.send(
    JSON.stringify({
      type: "ready",
      allowedOrigins: getAllowedOrigins(),
      gatewayMode: "stub",
      orbTraceId,
    })
  );
}

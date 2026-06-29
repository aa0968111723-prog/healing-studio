/**
 * SSE Route — Streams real-time generation events to the frontend.
 *
 * GET /api/generation-events/:jobId
 *
 * The client opens an EventSource connection after starting a generation.
 * Each thought-chain node update, progress change, and completion event
 * is pushed as an SSE message in real time.
 */

import { Router, Request, Response } from "express";
import { generationBus, type GenerationEvent } from "./generationEvents";
import { authenticateRequest, isDemoMode } from "./_core/googleAuth";
import { getBackgroundJob, getFineTunedModel } from "./db";
import { serverEnv } from "./_core/env.validated";

export const sseRouter = Router();

/**
 * AIDV-58（H3）：SSE 擁有權鎖門旗標——預設「安全 = ON」。
 * 鎖門 ON（預設／留空／"true"/"1"）：訂閱前比對 job/model.userId === user.id，非擁有者 403（修 IDOR）。
 * 鎖門 OFF（明確設 "false"/"0"）：緊急回退用——仍要求登入（未登入 401），只略過擁有權比對。
 * 不論旗標如何，登入仍是必要條件；demo 模式一律安全降級（見各路由）。
 */
function isOwnershipLockdownEnabled(): boolean {
  const raw = serverEnv.SSE_OWNERSHIP_LOCKDOWN.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

/** Maximum SSE connection lifetime (5 minutes). Prevents stale connections. */
const SSE_MAX_LIFETIME_MS = 5 * 60 * 1000;

/** Heartbeat interval — keeps the connection alive through proxies. */
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/** MySQL signed INT 上限；超過會在 driver 拋 out-of-range，所以在進 DB 前先擋掉。 */
const MAX_SIGNED_INT = 2147483647;

// ─── AIDV-632: per-user concurrent SSE connection limit ─────────────────────
// In-memory counter — single-process guard; note for future: move to Redis for multi-instance.

/** Active SSE connection counts keyed by userId. */
const activeSseConnections = new Map<number, number>();

function getSseMaxConnectionsPerUser(): number {
  const raw = serverEnv.SSE_MAX_CONNECTIONS_PER_USER.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return Infinity;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Attempt to claim a slot for userId. Returns false (→ 429) if limit reached. */
function acquireSseSlot(userId: number): boolean {
  const max = getSseMaxConnectionsPerUser();
  if (max === Infinity) return true;
  const current = activeSseConnections.get(userId) ?? 0;
  if (current >= max) return false;
  activeSseConnections.set(userId, current + 1);
  return true;
}

/** Release one slot for userId on connection close. */
function releaseSseSlot(userId: number): void {
  const current = activeSseConnections.get(userId) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) activeSseConnections.delete(userId);
  else activeSseConnections.set(userId, next);
}

/**
 * 解析並驗證路徑上的數字 id（jobId / modelId）。
 * 同時擋掉非數字、非正整數、超過 MySQL signed INT 上限的值，
 * 以免 `eq(col, hugeNumber)` 在 driver 端拋 out-of-range（配合缺 try/catch 會變成 hang）。
 * 回傳 null 代表無效，呼叫端應回 400。
 */
function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0 || id > MAX_SIGNED_INT) return null;
  return id;
}

sseRouter.get(
  "/api/generation-events/:jobId",
  async (req: Request, res: Response) => {
    const jobId = parseId(req.params.jobId);
    if (jobId === null) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }

    // ── AIDV-58: 在開串流之前驗證登入＋擁有權，修補 IDOR ──
    // pre-stream 段（auth + 擁有權查詢）以 try/catch 包住：authenticateRequest 內部
    // 會 await db.getUserByOpenId()、getBackgroundJob 會打 MySQL，任一 reject（DB down、
    // 連線錯誤、out-of-range int）在 express 4 + 無 express-async-errors 下不會進
    // globalErrorHandler，會變成 unhandled rejection＋client 永久 hang。改成主動回 500。
    try {
      // Demo / 無 DATABASE_URL 模式：submitStudioJob 不建 DB row、回假 jobId，
      // getBackgroundJob 會回 undefined → 永遠 403。此模式無法驗擁有權，
      // 放行已驗證（DEMO_USER）的請求，維持 demo 串流不被擋。
      if (isDemoMode()) {
        openGenerationStream(req, res, jobId, null);
        return;
      }

      // 1) 驗證登入：authenticateRequest 從 same-origin cookie 取 user，失敗回 null（不 throw）。
      //    無論鎖門旗標如何，登入都是必要條件——回退旗標只放鬆擁有權、不放鬆登入。
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      // 2) 擁有權檢查（鎖門 ON＝預設）：job 不存在或非本人 → 403（避免洩漏 id 是否存在）。
      //    鎖門 OFF（緊急回退）時略過此比對，但已登入要求仍在。
      if (isOwnershipLockdownEnabled()) {
        const job = await getBackgroundJob(jobId);
        if (!job || job.userId !== user.id) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
      // 3) AIDV-632: 並發連線上限。demo 模式跳過（無 userId）。
      if (!acquireSseSlot(user.id)) {
        res.status(429).json({ error: "Too many SSE connections" });
        return;
      }
      openGenerationStream(req, res, jobId, user.id);
    } catch (err) {
      console.error("[SSE] generation-events pre-stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
      return;
    }
  }
);

/** 開啟 /api/generation-events 的 SSE 串流（已通過驗證後呼叫）。 */
function openGenerationStream(req: Request, res: Response, jobId: number, userId: number | null): void {
  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Send initial connection event
  const orbTraceId = req.header("x-orb-trace-id") || req.header("x-trace-id") || null;
  res.write(`data: ${JSON.stringify({ type: "connected", jobId, orbTraceId })}\n\n`);

  // Cleanup helper — ensures timers and subscriptions are released exactly once
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetimeTimer);
    unsubscribe();
    if (userId !== null) releaseSseSlot(userId);
  };

  // Subscribe to generation events for this job
  const unsubscribe = generationBus.subscribe(
    jobId,
    (event: GenerationEvent) => {
      // Guard against writing to an already-closed response
      if (cleaned) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      // Close connection after complete or error
      if (event.type === "complete" || event.type === "error") {
        clearInterval(heartbeat);
        unsubscribe();
        setTimeout(() => {
          cleanup();
          res.end();
        }, 500);
      }
    }
  );

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    if (!cleaned) res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_INTERVAL_MS);

  // Auto-close connection after max lifetime to prevent stale connections
  const maxLifetimeTimer = setTimeout(() => {
    if (!cleaned) {
      res.write(
        `data: ${JSON.stringify({ type: "error", message: "SSE connection timeout" })}\n\n`
      );
      cleanup();
      res.end();
    }
  }, SSE_MAX_LIFETIME_MS);

  // Clean up on client disconnect
  req.on("close", cleanup);
}

// ─── GET /api/model-training-events/:modelId ───────────────────────────────
// 與 /api/generation-events/:jobId 結構相同，差別在 channel 是 model-training:*
sseRouter.get(
  "/api/model-training-events/:modelId",
  async (req: Request, res: Response) => {
    const modelId = parseId(req.params.modelId);
    if (modelId === null) {
      res.status(400).json({ error: "Invalid modelId" });
      return;
    }

    // ── AIDV-58: 在開串流之前驗證登入＋擁有權，修補 IDOR（try/catch 見上方說明）──
    try {
      // Demo / 無 DATABASE_URL：getFineTunedModel 回 null → 永遠 403，放行已驗證請求。
      if (isDemoMode()) {
        openTrainingStream(req, res, modelId, null);
        return;
      }

      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      // 擁有權檢查（鎖門 ON＝預設）；鎖門 OFF 時只略過比對，登入要求仍在。
      if (isOwnershipLockdownEnabled()) {
        const model = await getFineTunedModel(modelId);
        if (!model || model.userId !== user.id) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
      // AIDV-632: 並發連線上限。
      if (!acquireSseSlot(user.id)) {
        res.status(429).json({ error: "Too many SSE connections" });
        return;
      }
      openTrainingStream(req, res, modelId, user.id);
    } catch (err) {
      console.error("[SSE] model-training-events pre-stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal error" });
      return;
    }
  }
);

/** 開啟 /api/model-training-events 的 SSE 串流（已通過驗證後呼叫）。 */
function openTrainingStream(req: Request, res: Response, modelId: number, userId: number | null): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`data: ${JSON.stringify({ type: "connected", modelId })}\n\n`);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearTimeout(maxLifetimeTimer);
    unsubscribe();
    if (userId !== null) releaseSseSlot(userId);
  };

  const unsubscribe = generationBus.subscribeTraining(
    modelId,
    (event: GenerationEvent) => {
      if (cleaned) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "complete" || event.type === "error") {
        clearInterval(heartbeat);
        unsubscribe();
        setTimeout(() => {
          cleanup();
          res.end();
        }, 500);
      }
    }
  );

  const heartbeat = setInterval(() => {
    if (!cleaned) res.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_INTERVAL_MS);

  const maxLifetimeTimer = setTimeout(() => {
    if (!cleaned) {
      res.write(
        `data: ${JSON.stringify({ type: "error", message: "SSE connection timeout" })}\n\n`
      );
      cleanup();
      res.end();
    }
  }, SSE_MAX_LIFETIME_MS);

  req.on("close", cleanup);
}

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
import { authenticateRequest } from "./_core/googleAuth";
import { getBackgroundJob, getFineTunedModel } from "./db";

export const sseRouter = Router();

/** Maximum SSE connection lifetime (5 minutes). Prevents stale connections. */
const SSE_MAX_LIFETIME_MS = 5 * 60 * 1000;

sseRouter.get(
  "/api/generation-events/:jobId",
  async (req: Request, res: Response) => {
    const jobId = parseInt(req.params.jobId, 10);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "Invalid jobId" });
      return;
    }

    // ── AIDV-58: 在開串流之前驗證登入＋擁有權，修補 IDOR ──
    // 1) 驗證登入：authenticateRequest 從 same-origin cookie 取 user，失敗回 null（不 throw）。
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // 2) 擁有權檢查：job 不存在或非本人 → 403（避免洩漏 id 是否存在）。
    const job = await getBackgroundJob(jobId);
    if (!job || job.userId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

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
    }, 15000);

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
);

// ─── GET /api/model-training-events/:modelId ───────────────────────────────
// 與 /api/generation-events/:jobId 結構相同，差別在 channel 是 model-training:*
sseRouter.get(
  "/api/model-training-events/:modelId",
  async (req: Request, res: Response) => {
    const modelId = parseInt(req.params.modelId, 10);
    if (isNaN(modelId)) {
      res.status(400).json({ error: "Invalid modelId" });
      return;
    }

    // ── AIDV-58: 在開串流之前驗證登入＋擁有權，修補 IDOR ──
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const model = await getFineTunedModel(modelId);
    if (!model || model.userId !== user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

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
    }, 15000);

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
);

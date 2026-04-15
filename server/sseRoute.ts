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

export const sseRouter = Router();

/** Maximum SSE connection lifetime (5 minutes). Prevents stale connections. */
const SSE_MAX_LIFETIME_MS = 5 * 60 * 1000;

sseRouter.get(
  "/api/generation-events/:jobId",
  (req: Request, res: Response) => {
    const jobId = parseInt(req.params.jobId, 10);
    if (isNaN(jobId)) {
      res.status(400).json({ error: "Invalid jobId" });
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
    res.write(`data: ${JSON.stringify({ type: "connected", jobId })}\n\n`);

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

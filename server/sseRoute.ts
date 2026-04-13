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

sseRouter.get("/api/generation-events/:jobId", (req: Request, res: Response) => {
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

  // Subscribe to generation events for this job
  const unsubscribe = generationBus.subscribe(jobId, (event: GenerationEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Close connection after complete or error
    if (event.type === "complete" || event.type === "error") {
      clearInterval(heartbeat);
      unsubscribe();
      setTimeout(() => {
        res.end();
      }, 500);
    }
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

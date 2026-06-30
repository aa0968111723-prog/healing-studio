/**
 * unifiedSseRoute.ts — AIDV-716: unified /api/sse endpoint
 *
 * GET /api/sse?jobId=X&modelId=Y&collaborationId=Z&projectId=W
 *
 * Accepts any combination of the four query params and multiplexes the
 * corresponding bus subscriptions into a single SSE stream as UnifiedSseEvent
 * envelopes (see types/sse-events.ts).
 *
 * Feature flag: set server env UNIFIED_SSE_ROUTER=1 to register this route
 * in _core/index.ts. Default OFF — legacy endpoints remain canonical.
 *
 * Auth + ownership: mirrors sseRoute.ts / agentEventsRoute.ts exactly.
 *   - 登入必要條件（無論鎖門旗標）
 *   - SSE_OWNERSHIP_LOCKDOWN ON（預設）: 每個 id 比對 DB 擁有權
 *   - SSE_OWNERSHIP_LOCKDOWN OFF: 略過擁有權比對，保留登入要求
 * Max lifetime: 10 min; heartbeat: 15 s.
 */

import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { authenticateRequest, isDemoMode } from "./_core/googleAuth";
import { getBackgroundJob, getFineTunedModel, getDb } from "./db";
import { agentCollaborationSessions, videoProjects } from "../drizzle/schema";
import { serverEnv } from "./_core/env.validated";
import { SseRouter } from "./services/sseRouter";
import type { UnifiedSseEvent } from "../types/sse-events";

export const unifiedSseRouter = Router();

const MAX_LIFETIME_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_SIGNED_INT = 2_147_483_647;

function parseIntId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_SIGNED_INT) return null;
  return n;
}

function isOwnershipLockdownEnabled(): boolean {
  const raw = serverEnv.SSE_OWNERSHIP_LOCKDOWN.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "no";
}

unifiedSseRouter.get("/api/sse", async (req: Request, res: Response) => {
  const jobId = parseIntId(req.query.jobId as string | undefined);
  const modelId = parseIntId(req.query.modelId as string | undefined);
  const collaborationId = req.query.collaborationId as string | undefined;
  const projectId = parseIntId(req.query.projectId as string | undefined);

  // At least one subscription target is required
  if (
    jobId === null &&
    modelId === null &&
    collaborationId === undefined &&
    projectId === null
  ) {
    res.status(400).json({ error: "At least one of jobId/modelId/collaborationId/projectId is required" });
    return;
  }

  // Validate collaborationId length
  if (collaborationId !== undefined && (collaborationId.length === 0 || collaborationId.length > 128)) {
    res.status(400).json({ error: "Invalid collaborationId" });
    return;
  }

  // ── Auth + ownership (same guard pattern as sseRoute.ts) ──────────────────
  try {
    if (!isDemoMode()) {
      const user = await authenticateRequest(req);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (isOwnershipLockdownEnabled()) {
        // Ownership checks run concurrently for performance
        const checks: Promise<boolean>[] = [];

        if (jobId !== null) {
          checks.push(
            getBackgroundJob(jobId).then(job => Boolean(job && job.userId === user.id)),
          );
        }
        if (modelId !== null) {
          checks.push(
            getFineTunedModel(modelId).then(model => Boolean(model && model.userId === user.id)),
          );
        }
        if (collaborationId !== undefined || projectId !== null) {
          checks.push(
            getDb().then(async db => {
              if (!db) return false;
              const innerChecks: Promise<boolean>[] = [];
              if (collaborationId !== undefined) {
                innerChecks.push(
                  db
                    .select({ collaborationId: agentCollaborationSessions.collaborationId })
                    .from(agentCollaborationSessions)
                    .where(
                      and(
                        eq(agentCollaborationSessions.collaborationId, collaborationId),
                        eq(agentCollaborationSessions.userId, user.id),
                      ),
                    )
                    .limit(1)
                    .then(rows => rows.length > 0),
                );
              }
              if (projectId !== null) {
                innerChecks.push(
                  db
                    .select({ id: videoProjects.id })
                    .from(videoProjects)
                    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.userId, user.id)))
                    .limit(1)
                    .then(rows => rows.length > 0),
                );
              }
              const results = await Promise.all(innerChecks);
              return results.every(Boolean);
            }),
          );
        }

        const results = await Promise.all(checks);
        if (!results.every(Boolean)) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }
    }
  } catch (err) {
    console.error("[SSE] /api/sse pre-stream error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal error" });
    return;
  }

  // ── Open unified SSE stream ───────────────────────────────────────────────
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  let closed = false;

  const router = new SseRouter(
    (event: UnifiedSseEvent) => {
      if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    {
      jobId: jobId ?? undefined,
      modelId: modelId ?? undefined,
      collaborationId,
      projectId: projectId ?? undefined,
    },
  );

  const heartbeat = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  const lifetime = setTimeout(() => {
    if (!closed) {
      res.write(`data: ${JSON.stringify({ type: "timeout", reason: "max_lifetime" })}\n\n`);
      cleanup();
      res.end();
    }
  }, MAX_LIFETIME_MS);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    router.destroy();
  };

  req.on("close", cleanup);
});

/**
 * agentEventsRoute.ts — AIDV-331 State Broadcast SSE endpoint
 *
 * GET /api/agent-events/:collaborationId
 *
 * Streams AgentCollabEvent (project_updated) to subscribers.
 * Requires authenticated session (same pattern as sseRoute.ts).
 * Heartbeat every 15 s; auto-closes after 10 minutes.
 */

import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { authenticateRequest } from "./_core/googleAuth";
import { agentEventBus, type AgentCollabEvent } from "./services/agentEventBus";
import { getDb } from "./db.js";
import { agentCollaborationSessions } from "../drizzle/schema.js";

export const agentEventsRouter = Router();

const MAX_LIFETIME_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

agentEventsRouter.get(
  "/api/agent-events/:collaborationId",
  async (req: Request, res: Response) => {
    const { collaborationId } = req.params;

    if (!collaborationId || collaborationId.length > 128) {
      res.status(400).json({ error: "Invalid collaborationId" });
      return;
    }

    let user: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      user = await authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // AIDV-379: ownership check — verify collaborationId belongs to this user
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "Service unavailable" });
      return;
    }
    const [owned] = await db
      .select({ collaborationId: agentCollaborationSessions.collaborationId })
      .from(agentCollaborationSessions)
      .where(
        and(
          eq(agentCollaborationSessions.collaborationId, collaborationId),
          eq(agentCollaborationSessions.userId, user.id)
        )
      )
      .limit(1);
    if (!owned) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);

    const lifetime = setTimeout(() => {
      res.write("event: close\ndata: {\"reason\":\"max_lifetime\"}\n\n");
      res.end();
    }, MAX_LIFETIME_MS);

    const unsubscribe = agentEventBus.subscribe(collaborationId, (event: AgentCollabEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    req.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      unsubscribe();
    });
  }
);

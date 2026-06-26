/**
 * agentStatusRoute.ts — AIDV-334 多代理監控儀表板
 *
 * GET /api/agents/status   — auth required; returns all agents with real-time status
 * GET /api/agents/metrics  — admin required; Prometheus text format
 * GET /api/agents/heartbeat — SSE; auth required; broadcasts snapshot every 30 s
 */

import { Router, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { isAdmin } from "@shared/const";
import { authenticateRequest } from "../_core/googleAuth";
import { getDb } from "../db.js";
import { agentDynamicRegistry } from "../../drizzle/schema.js";
import { getPriorityQueueDepth } from "../services/priorityQueue.js";
import { logger } from "../_core/logger.js";

export const agentStatusRouter = Router();

// ─── Shared auth helpers ──────────────────────────────────────────────────────

async function requireAuth(req: Request, res: Response) {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    return user;
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
}

async function requireAdmin(req: Request, res: Response) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (!isAdmin(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return user;
}

// ─── Agent snapshot helper ────────────────────────────────────────────────────

interface AgentSnapshot {
  id: string;
  status: "active" | "idle" | "offline";
  load: number;
  queueDepth: number;
  capabilities: string[];
  lastSeenMs: number;
}

async function buildAgentSnapshot(): Promise<AgentSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  const agents = await db
    .select({
      agentId: agentDynamicRegistry.agentId,
      currentLoad: agentDynamicRegistry.currentLoad,
      isActive: agentDynamicRegistry.isActive,
      lastHeartbeatAt: agentDynamicRegistry.lastHeartbeatAt,
      capabilities: agentDynamicRegistry.capabilities,
    })
    .from(agentDynamicRegistry)
    .where(eq(agentDynamicRegistry.isActive, true))
    .orderBy(agentDynamicRegistry.currentLoad)
    .limit(100);

  const now = Date.now();
  const queueDepth = await getPriorityQueueDepth();

  return agents.map(a => {
    const load = Number(a.currentLoad);
    const ageMs = now - new Date(a.lastHeartbeatAt).getTime();
    const offline = ageMs > 5 * 60 * 1000;
    const status: AgentSnapshot["status"] = offline ? "offline" : load > 0.5 ? "active" : "idle";
    return {
      id: a.agentId,
      status,
      load,
      queueDepth: queueDepth < 0 ? 0 : queueDepth,
      capabilities: (a.capabilities as string[]) ?? [],
      lastSeenMs: ageMs,
    };
  });
}

// ─── GET /api/agents/status ───────────────────────────────────────────────────

agentStatusRouter.get("/api/agents/status", async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  try {
    const agents = await buildAgentSnapshot();
    res.json({ agents });
  } catch (err) {
    logger.error("agents_status_error", { err });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/agents/metrics ──────────────────────────────────────────────────

agentStatusRouter.get("/api/agents/metrics", async (req: Request, res: Response) => {
  const user = await requireAdmin(req, res);
  if (!user) return;

  try {
    const agents = await buildAgentSnapshot();
    const lines: string[] = [
      "# HELP agent_count Total number of registered agents",
      "# TYPE agent_count gauge",
      `agent_count ${agents.length}`,
      "# HELP agent_load Current load per agent (0–1)",
      "# TYPE agent_load gauge",
      ...agents.map(a => `agent_load{agent_id="${a.id}"} ${a.load.toFixed(4)}`),
      "# HELP agent_status Agent status (1=active, 0.5=idle, 0=offline)",
      "# TYPE agent_status gauge",
      ...agents.map(a => {
        const v = a.status === "active" ? 1 : a.status === "idle" ? 0.5 : 0;
        return `agent_status{agent_id="${a.id}"} ${v}`;
      }),
      "# HELP agent_queue_depth Priority queue depth",
      "# TYPE agent_queue_depth gauge",
      `agent_queue_depth ${agents[0]?.queueDepth ?? 0}`,
      "",
    ];
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(lines.join("\n"));
  } catch (err) {
    logger.error("agents_metrics_error", { err });
    res.status(500).send("# error generating metrics\n");
  }
});

// ─── GET /api/agents/heartbeat (SSE) ─────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_LIFETIME_MS = 60 * 60 * 1000;

agentStatusRouter.get("/api/agents/heartbeat", async (req: Request, res: Response) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  async function sendSnapshot() {
    try {
      const agents = await buildAgentSnapshot();
      res.write(`data: ${JSON.stringify({ agents })}\n\n`);
    } catch {
      res.write(": error fetching snapshot\n\n");
    }
  }

  await sendSnapshot();
  const interval = setInterval(sendSnapshot, HEARTBEAT_INTERVAL_MS);

  const lifetime = setTimeout(() => {
    res.write("event: close\ndata: {\"reason\":\"max_lifetime\"}\n\n");
    res.end();
  }, MAX_LIFETIME_MS);

  req.on("close", () => {
    clearInterval(interval);
    clearTimeout(lifetime);
  });
});

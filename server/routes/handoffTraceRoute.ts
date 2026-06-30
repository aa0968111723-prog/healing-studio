/**
 * handoffTraceRoute.ts — AIDV-318 multi-agent handoff trace API
 *
 * GET /api/video/project/:projectId/handoff-trace
 *
 * Returns the ordered handoff chain for a given Supabase video_project UUID.
 * Requires app-level authentication. Proxies the Supabase REST API using the
 * service-role key so RLS on agent_handoff_log does not filter results here
 * (the app auth gate is the ownership check).
 *
 * 503 is returned when SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are not
 * configured (graceful degradation — feature is opt-in via env vars).
 */

import { Router, type Request, type Response } from "express";
import { authenticateRequest } from "../_core/googleAuth";
import { serverEnv } from "../_core/env.validated";
import { logger } from "../_core/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handoffTraceRouter = Router();

handoffTraceRouter.get(
  "/api/video/project/:projectId/handoff-trace",
  async (req: Request, res: Response) => {
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

    const { projectId } = req.params;
    if (!UUID_RE.test(projectId ?? "")) {
      res.status(400).json({ error: "Invalid project ID — must be a UUID" });
      return;
    }

    const supabaseUrl = serverEnv.SUPABASE_URL;
    const serviceKey = serverEnv.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      res.status(503).json({ error: "Handoff trace not configured" });
      return;
    }

    try {
      const params = new URLSearchParams({
        project_id: `eq.${projectId}`,
        order: "handoff_at.asc",
        select: "id,from_task_id,to_task_id,from_agent,to_agent,payload_hash,handoff_at,status",
      });
      const url = `${supabaseUrl}/rest/v1/agent_handoff_log?${params.toString()}`;

      const resp = await fetch(url, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!resp.ok) {
        logger.warn("handoff_trace_supabase_error", {
          userId: user.id,
          projectId,
          status: resp.status,
        });
        res.status(502).json({ error: "Failed to fetch handoff trace" });
        return;
      }

      const handoffs = (await resp.json()) as unknown[];
      res.json({ projectId, handoffs });
    } catch (err) {
      logger.error("handoff_trace_error", { err, projectId, userId: user.id });
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

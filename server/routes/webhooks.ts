import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { runSchemaFirstAgentPlanner } from "../services/agentPlanner";
import { executeCurrentStepTools } from "../services/orbTaskOrchestrator";
import { getOrbToolRegistry } from "../config/orbToolRegistry";
import type { OrbTask } from "../../shared/orb-agent-contract";

const bodySchema = z.object({
  webhookSecret: z.string(),
  userId: z.number().int().positive(),
  taskDescription: z.string().min(1),
  pageId: z.string().optional(),
});

function isValidSecret(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const limiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const webhooksRouter = express.Router();

webhooksRouter.post("/orb", limiter, async (req, res) => {
  const parse = bodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "invalid-request" });
    return;
  }

  const expected = process.env.ORB_WEBHOOK_SECRET ?? "";
  if (!expected || !isValidSecret(parse.data.webhookSecret, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const taskId = `orb_webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.status(202).json({ taskId });

  void (async () => {
    const plannerResult = await runSchemaFirstAgentPlanner({
      messages: [{ role: "user", content: parse.data.taskDescription }],
      ...(parse.data.pageId
        ? {
            pageSnapshot: {
              pageId: parse.data.pageId,
              pageLabel: parse.data.pageId,
              pagePath: "/",
              capabilities: [],
            },
          }
        : {}),
    });

    if (plannerResult.status !== "tasked" || !plannerResult.task) return;

    const now = Date.now();
    const orchestratorTask: OrbTask = {
      ...plannerResult.task,
      taskId,
      userId: parse.data.userId,
      status: "running",
      currentStepIndex: 0,
      approvedStepIds: [],
      stepApprovals: [],
      stepReports: [],
      createdAt: now,
      updatedAt: now,
    };

    await executeCurrentStepTools({
      task: orchestratorTask,
      userId: parse.data.userId,
      userRole: "user",
      tools: getOrbToolRegistry(),
      approved: true,
      requestId: taskId,
    });
  })();
});

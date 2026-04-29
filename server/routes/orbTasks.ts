import { Router, type Request, type Response } from "express";
import { verifyToken } from "../middleware/verifyToken";
import { orbTaskStore } from "../services/orbTaskStore";

type AuthenticatedRequest = Request & {
  user?: {
    id: number;
  };
};

export const orbTasksRouter = Router();

orbTasksRouter.get("/api/tasks/:taskId/status", verifyToken, (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const task = orbTaskStore.get(req.params.taskId, userId, Date.now());
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.json({
    status: task.status,
    currentStepIndex: task.currentStepIndex,
    steps: task.steps,
    stepReports: task.stepReports,
    result: task.result ?? null,
  });
});

orbTasksRouter.get("/api/tasks/:taskId/stream", verifyToken, (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const taskId = req.params.taskId;
  const initial = orbTaskStore.get(taskId, userId, Date.now());
  if (!initial) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let cursor = 0;

  const writeStatus = () => {
    const task = orbTaskStore.get(taskId, userId, Date.now());
    if (!task) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Task not found" })}\n\n`);
      return;
    }
    const timeline = orbTaskStore.getTimeline(taskId, userId, {
      cursor,
      limit: 100,
      order: "asc",
      now: Date.now(),
    });
    if (timeline.length > 0) {
      cursor = timeline[timeline.length - 1]!.at + 1;
      for (const evt of timeline) {
        res.write(`event: stateMachineEvent\ndata: ${JSON.stringify(evt)}\n\n`);
      }
    }

    res.write(
      `event: status\ndata: ${JSON.stringify({
        status: task.status,
        currentStepIndex: task.currentStepIndex,
        steps: task.steps,
        stepReports: task.stepReports,
        result: task.result ?? null,
      })}\n\n`
    );
  };

  writeStatus();
  const timer = setInterval(writeStatus, 1500);

  req.on("close", () => {
    clearInterval(timer);
    res.end();
  });
});

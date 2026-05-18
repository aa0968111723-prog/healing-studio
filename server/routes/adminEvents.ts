import { Router, type Request, type Response } from "express";
import { verifyToken } from "../middleware/verifyToken";
import { generationEventBus } from "../generationEvents";
import type { UserRole } from "@shared/const";

type AuthenticatedRequest = Request & {
  user?: { role?: UserRole };
};

export const adminEventsRouter = Router();

adminEventsRouter.get("/api/admin/events/stream", verifyToken, (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;
  if (authReq.user?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const handler = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  generationEventBus.on("generation", handler);

  req.on("close", () => {
    generationEventBus.off("generation", handler);
    res.end();
  });
});

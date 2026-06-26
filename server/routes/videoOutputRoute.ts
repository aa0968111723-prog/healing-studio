/**
 * videoOutputRoute.ts — HMAC-signed video redirect proxy (AIDV-280)
 *
 * GET /api/video-output?r=<requestId>&u=<userId>&e=<expiresAt>&t=<hmac>
 *
 * Validates:
 *   1. Caller is authenticated (verifyToken)
 *   2. HMAC-SHA256("v1:<requestId>:<userId>:<expiresAt>", JWT_SECRET) === t
 *   3. expiresAt is in the future (1h TTL issued by checkVideoStatus)
 *   4. job.userId === req.user.id (ownership re-check after DB lookup)
 *
 * On success: 302 redirect to the actual Fal.ai CDN video_url.
 * On any failure: 403 (no detail leak).
 *
 * This prevents BOLA: the raw CDN URL never reaches the frontend; only the
 * signed proxy URL is exposed, and it is tied to the authenticated user.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { serverEnv } from "../_core/env.validated";
import { verifyToken } from "../middleware/verifyToken";
import { getBackgroundJobByRequestId } from "../db";

type AuthedReq = Request & {
  user?: { id: number };
};

export const videoOutputRouter = Router();

videoOutputRouter.get(
  "/api/video-output",
  verifyToken,
  async (req: AuthedReq, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { r: requestId, u: uidStr, e: expiresAtStr, t: mac } = req.query as Record<string, string>;

    if (!requestId || !uidStr || !expiresAtStr || !mac) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    const uidParam = parseInt(uidStr, 10);

    if (
      isNaN(expiresAt) ||
      isNaN(uidParam) ||
      Math.floor(Date.now() / 1000) > expiresAt
    ) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (uidParam !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const expected = crypto
      .createHmac("sha256", serverEnv.JWT_SECRET)
      .update(`v1:${requestId}:${userId}:${expiresAt}`)
      .digest("base64url");

    const macBuf = Buffer.from(mac);
    const expBuf = Buffer.from(expected);
    // timingSafeEqual requires equal-length buffers; unequal length is always invalid
    const hmacValid =
      macBuf.length === expBuf.length &&
      crypto.timingSafeEqual(macBuf, expBuf);
    if (!hmacValid) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const job = await getBackgroundJobByRequestId(requestId).catch(() => undefined);
    if (!job || job.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const resultJson = job.resultJson as Record<string, unknown> | null;
    const videoUrl =
      (resultJson?.video_url as string | undefined) ||
      (resultJson?.url as string | undefined) ||
      ((resultJson?.video as { url?: string } | undefined)?.url);

    if (!videoUrl || typeof videoUrl !== "string") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.redirect(302, videoUrl);
  }
);

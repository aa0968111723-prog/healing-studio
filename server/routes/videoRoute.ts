/**
 * videoRoute.ts — REST /api/video CRUD endpoints (AIDV-735)
 *
 * Exposes thin REST wrappers over the existing videoProject DB functions
 * for multi-agent creator workflows that need standard HTTP verbs instead
 * of tRPC.  Business logic lives in db.ts; this file is pure I/O plumbing.
 *
 * Auth: Bearer JWT (verifyToken middleware on every route).
 * Attribution: X-Agent-Id and X-Trace-Id headers are forwarded to the audit log.
 *
 * Endpoints:
 *   GET    /api/video                  — list (cursor pagination)
 *   POST   /api/video                  — create
 *   GET    /api/video/:id              — get by ID
 *   PUT    /api/video/:id              — partial update (CAS via expectedVersion)
 *   DELETE /api/video/:id              — 501 (requires migration; use tRPC meanwhile)
 *   POST   /api/video/:id/process      — 501 (use tRPC videoStudio.* meanwhile)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { verifyToken } from "../middleware/verifyToken";
import {
  createVideoProject,
  getVideoProject,
  getVideoProjectsByUserPaged,
  updateVideoProject,
  getUserSubscription,
} from "../db";
import { VIDEO_OUTPUT_SPEC_DEFAULT } from "../../drizzle/schema";
import { videoInputAssetsSchema } from "../../shared/video-input-assets";
import { sanitizePlainText } from "../utils/sanitize";
import { recordAuditEvent } from "../services/audit/auditLog";

type AuthedReq = Request & { user?: { id: number; role?: string } };

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isPaidFor4K(userId: number): Promise<boolean> {
  const plan = await getUserSubscription(userId);
  return (
    !!plan &&
    (plan.status === "active" || plan.status === "trialing") &&
    plan.planId.toLowerCase() !== "free"
  );
}

function ok(res: Response, body: unknown, status = 200) {
  res.status(status).json(body);
}

function fail(res: Response, status: number, message: string, code?: string) {
  res.status(status).json({ error: message, ...(code ? { code } : {}) });
}

function agentMeta(req: Request) {
  return {
    agentId: (req.headers["x-agent-id"] as string | undefined) ?? null,
    traceId: (req.headers["x-trace-id"] as string | undefined) ?? null,
  };
}

const aspectRatioValues = ["16:9", "9:16", "1:1"] as const;
const priorityClassValues = ["standard", "express", "critical"] as const;

const outputSpecSchema = z.object({
  resolution: z.enum(["720p", "1080p", "4K"]).default("1080p"),
  fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
  codec: z.enum(["h264", "h265", "vp9"]).default("h264"),
});

function serializeProject(row: Awaited<ReturnType<typeof getVideoProject>>) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    aspectRatio: row.aspectRatio,
    outputSpec: row.outputSpec ?? VIDEO_OUTPUT_SPEC_DEFAULT,
    // AIDV-270: 多模態輸入素材（未提供時為空陣列，形狀對前端穩定）。
    inputAssets: row.inputAssets ?? [],
    version: row.version,
    deadlineAt: row.deadlineAt?.toISOString() ?? null,
    priorityClass: row.priorityClass,
    outputStoragePath: row.outputStoragePath ?? null,
    outputSignedUrl:
      row.outputSignedUrl &&
      row.outputExpiresAt &&
      row.outputExpiresAt.getTime() > Date.now()
        ? row.outputSignedUrl
        : null,
    outputExpiresAt: row.outputExpiresAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

// ── Router ────────────────────────────────────────────────────────────────────

export const videoRouter = Router();

videoRouter.use(verifyToken);

// ── GET /api/video ────────────────────────────────────────────────────────────

videoRouter.get("/api/video", async (req: AuthedReq, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return void fail(res, 401, "Unauthorized", "UNAUTHORIZED");

  const parsed = z
    .object({
      // AIDV-576：游標為 opaque 字串（編碼複合鍵 updatedAt+id），原樣回傳 nextCursor。
      cursor: z.string().min(1).max(64).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      search: z.string().trim().max(255).optional(),
    })
    .safeParse(req.query);

  if (!parsed.success) {
    return void fail(res, 400, parsed.error.issues[0]?.message ?? "Bad Request", "BAD_REQUEST");
  }

  try {
    const { cursor, limit, search } = parsed.data;
    const page = await getVideoProjectsByUserPaged({ userId, limit, cursor, search });

    ok(res, {
      items: page.items.map(serializeProject),
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/video]", err);
    if (!res.headersSent) fail(res, 500, "內部伺服器錯誤", "INTERNAL_SERVER_ERROR");
  }
});

// ── POST /api/video ───────────────────────────────────────────────────────────

videoRouter.post("/api/video", async (req: AuthedReq, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return void fail(res, 401, "Unauthorized", "UNAUTHORIZED");

  const parsed = z
    .object({
      title: z
        .string()
        .min(1)
        .max(255)
        .transform(sanitizePlainText)
        .default("未命名影片"),
      aspectRatio: z.enum(aspectRatioValues).default("16:9"),
      creativeProjectId: z.number().int().positive().optional(),
      outputSpec: outputSpecSchema.optional(),
      deadlineAt: z.string().datetime().optional(),
      priorityClass: z.enum(priorityClassValues).default("standard"),
      // AIDV-270: 多模態輸入素材（image/audio + role）。省略時維持既有純文字生成。
      inputAssets: videoInputAssetsSchema.optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return void fail(res, 400, parsed.error.issues[0]?.message ?? "Bad Request", "BAD_REQUEST");
  }

  const { title, aspectRatio, creativeProjectId, outputSpec, deadlineAt, priorityClass, inputAssets } =
    parsed.data;

  try {
    if (outputSpec?.resolution === "4K") {
      if (!(await isPaidFor4K(userId))) {
        return void fail(res, 403, "4K 解析度需付費方案", "FORBIDDEN");
      }
    }

    const meta = agentMeta(req);

    const id = await createVideoProject({
      userId,
      title,
      aspectRatio,
      creativeProjectId: creativeProjectId ?? null,
      outputSpec: outputSpec ?? VIDEO_OUTPUT_SPEC_DEFAULT,
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
      priorityClass,
      inputAssets: inputAssets ?? null,
    });

    const row = await getVideoProject(id);
    if (!row) return void fail(res, 500, "Project created but could not be retrieved", "INTERNAL_SERVER_ERROR");

    recordAuditEvent({
      actorUserId: userId,
      actorRole: req.user?.role ?? "user",
      action: "videoProject.create",
      targetType: "videoProject",
      targetId: id,
      metadata: { title, agentId: meta.agentId, traceId: meta.traceId },
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    ok(res, serializeProject(row), 201);
  } catch (err) {
    console.error("[POST /api/video]", err);
    if (!res.headersSent) fail(res, 500, "內部伺服器錯誤", "INTERNAL_SERVER_ERROR");
  }
});

// ── GET /api/video/:id ────────────────────────────────────────────────────────

videoRouter.get("/api/video/:id", async (req: AuthedReq, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return void fail(res, 401, "Unauthorized", "UNAUTHORIZED");

  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id) || id <= 0) return void fail(res, 400, "Invalid project ID", "BAD_REQUEST");

  try {
    const row = await getVideoProject(id);
    if (!row) return void fail(res, 404, "Project not found", "NOT_FOUND");
    if (row.userId !== userId) return void fail(res, 403, "Forbidden", "FORBIDDEN");

    ok(res, serializeProject(row));
  } catch (err) {
    console.error("[GET /api/video/:id]", err);
    if (!res.headersSent) fail(res, 500, "內部伺服器錯誤", "INTERNAL_SERVER_ERROR");
  }
});

// ── PUT /api/video/:id ────────────────────────────────────────────────────────

videoRouter.put("/api/video/:id", async (req: AuthedReq, res: Response) => {
  const userId = req.user?.id;
  if (!userId) return void fail(res, 401, "Unauthorized", "UNAUTHORIZED");

  const id = parseInt(req.params.id ?? "", 10);
  if (isNaN(id) || id <= 0) return void fail(res, 400, "Invalid project ID", "BAD_REQUEST");

  const row = await getVideoProject(id);
  if (!row) return void fail(res, 404, "Project not found", "NOT_FOUND");
  if (row.userId !== userId) return void fail(res, 403, "Forbidden", "FORBIDDEN");

  const parsed = z
    .object({
      title: z.string().min(1).max(255).transform(sanitizePlainText).optional(),
      aspectRatio: z.enum(aspectRatioValues).optional(),
      outputSpec: outputSpecSchema.optional(),
      deadlineAt: z.string().datetime().nullable().optional(),
      priorityClass: z.enum(priorityClassValues).optional(),
      // AIDV-270: 多模態輸入素材可更新；傳 [] 清空、傳 null 亦清空。
      inputAssets: videoInputAssetsSchema.nullable().optional(),
      expectedVersion: z.number().int().nonnegative().optional(),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    return void fail(res, 400, parsed.error.issues[0]?.message ?? "Bad Request", "BAD_REQUEST");
  }

  const { expectedVersion, ...fields } = parsed.data;

  try {
    if (fields.outputSpec?.resolution === "4K") {
      if (!(await isPaidFor4K(userId))) {
        return void fail(res, 403, "4K 解析度需付費方案", "FORBIDDEN");
      }
    }

    const patch: Record<string, unknown> = {};
    if (fields.title !== undefined) patch.title = fields.title;
    if (fields.aspectRatio !== undefined) patch.aspectRatio = fields.aspectRatio;
    if (fields.outputSpec !== undefined) patch.outputSpec = fields.outputSpec;
    if (fields.deadlineAt !== undefined)
      patch.deadlineAt = fields.deadlineAt ? new Date(fields.deadlineAt) : null;
    if (fields.priorityClass !== undefined) patch.priorityClass = fields.priorityClass;
    if (fields.inputAssets !== undefined) patch.inputAssets = fields.inputAssets ?? null;

    const meta = agentMeta(req);
    const { updated } = await updateVideoProject(
      id,
      patch as Parameters<typeof updateVideoProject>[1],
      { expectedVersion }
    );

    if (!updated) {
      return void fail(
        res,
        409,
        "Version conflict — reload and retry",
        "CONFLICT"
      );
    }

    const newVersion = (row.version ?? 0) + 1;
    res.setHeader("ETag", `"${newVersion}"`);

    recordAuditEvent({
      actorUserId: userId,
      actorRole: req.user?.role ?? "user",
      action: "videoProject.update",
      targetType: "videoProject",
      targetId: id,
      metadata: { patch: Object.keys(patch), agentId: meta.agentId, traceId: meta.traceId },
      ipAddress: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    ok(res, { ok: true, version: newVersion });
  } catch (err) {
    console.error("[PUT /api/video/:id]", err);
    if (!res.headersSent) fail(res, 500, "內部伺服器錯誤", "INTERNAL_SERVER_ERROR");
  }
});

// ── DELETE /api/video/:id ────────────────────────────────────────────────────

videoRouter.delete("/api/video/:id", (_req: AuthedReq, res: Response) => {
  // No deleteVideoProject DB function exists; video_projects has no deletedAt/status column.
  // Implement via tRPC once the backing migration (adding deletedAt) lands.
  res.status(501).json({
    error: "Video project deletion is not yet implemented via this REST endpoint.",
    code: "NOT_IMPLEMENTED",
    hint: "Use the tRPC interface or contact the platform team.",
  });
});

// ── POST /api/video/:id/process ──────────────────────────────────────────────

videoRouter.post("/api/video/:id/process", (_req: AuthedReq, res: Response) => {
  // Multi-agent processing is dispatched through tRPC videoStudio.* procedures
  // (e.g. videoStudio.klingTextToVideo) via the fal.ai async queue.
  // A unified REST trigger endpoint requires a job-orchestration layer not yet present.
  res.status(501).json({
    error: "Async video processing via REST is not yet implemented.",
    code: "NOT_IMPLEMENTED",
    hint: "Use tRPC videoStudio.klingTextToVideo / wanTextToVideo / etc. for generation.",
  });
});

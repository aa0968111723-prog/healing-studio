/**
 * v1.ts — AIDV-276 程式化 API REST 層
 *
 * POST /api/v1/videos          — 建立影片專案（scope: video:create）
 * GET  /api/v1/videos/:id      — 取得影片專案（scope: video:read）
 *
 * 鑑權：Authorization: Bearer aidv_<key>；SHA-256 查 api_keys 表。
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { apiKeys } from "../../drizzle/schema";
import { createVideoProject, getVideoProject } from "../db";
import { logger } from "../_core/logger";

export const v1Router = Router();

/**
 * AIDV-270: REST 回應的 input_assets 正規化（null → []）——與 tRPC 層的
 * resolveInputAssets 同義，讓 API 消費端不用特判 DB 的 null。
 */
function normalizeProject<T extends { inputAssets?: unknown } | null>(project: T) {
  if (!project) return project;
  return { ...project, inputAssets: project.inputAssets ?? [] };
}

// ─── API Key auth ─────────────────────────────────────────────────────────────

interface ApiAuthedRequest extends Request {
  apiUserId?: number;
  apiScopes?: string[];
}

async function authenticateApiKey(req: ApiAuthedRequest, res: Response): Promise<boolean> {
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer aidv_")) {
    res.status(401).json({ error: "Missing or invalid API key" });
    return false;
  }
  const raw = auth.slice("Bearer ".length);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");

  const db = await getDb();
  if (!db) {
    res.status(503).json({ error: "Database unavailable" });
    return false;
  }

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (rows.length === 0) {
    res.status(401).json({ error: "Invalid or revoked API key" });
    return false;
  }

  const key = rows[0];
  req.apiUserId = key.userId;
  req.apiScopes = (key.scopes as string[]) ?? [];

  db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});
  return true;
}

function hasScope(req: ApiAuthedRequest, scope: string): boolean {
  return req.apiScopes?.includes(scope) ?? false;
}

// ─── POST /api/v1/videos ─────────────────────────────────────────────────────

const CreateVideoBody = z.object({
  title: z.string().min(1).max(255).default("未命名影片"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
});

v1Router.post("/api/v1/videos", async (req: ApiAuthedRequest, res: Response) => {
  if (!(await authenticateApiKey(req, res))) return;
  if (!hasScope(req, "video:create")) {
    res.status(403).json({ error: "API key missing scope: video:create" });
    return;
  }

  const parsed = CreateVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  try {
    const id = await createVideoProject({
      userId: req.apiUserId!,
      title: parsed.data.title,
      aspectRatio: parsed.data.aspectRatio,
    });
    const project = await getVideoProject(id);
    res.status(201).json({ id, project: normalizeProject(project) });
  } catch (err) {
    logger.error("v1_create_video_error", { err });
    res.status(500).json({ error: "Failed to create video project" });
  }
});

// ─── GET /api/v1/videos/:id ──────────────────────────────────────────────────

v1Router.get("/api/v1/videos/:id", async (req: ApiAuthedRequest, res: Response) => {
  if (!(await authenticateApiKey(req, res))) return;
  if (!hasScope(req, "video:read")) {
    res.status(403).json({ error: "API key missing scope: video:read" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid video ID" });
    return;
  }

  try {
    const project = await getVideoProject(id);
    if (!project) {
      res.status(404).json({ error: "Video project not found" });
      return;
    }
    if (project.userId !== req.apiUserId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    res.json({ project: normalizeProject(project) });
  } catch (err) {
    logger.error("v1_get_video_error", { err });
    res.status(500).json({ error: "Failed to get video project" });
  }
});

/**
 * download.ts — 媒體成品強制下載代理
 *
 * GET /api/media/download?url=<encoded>&filename=<optional>
 *
 * 只允許下載已持久化到內部 S3/Forge 儲存的媒體 URL，
 * 拒絕直接代理外部第三方 CDN（防止 SSRF）。
 */

import { Router, Request, Response } from "express";
import { serverEnv } from "../_core/env.validated";
import { verifyToken } from "../middleware/verifyToken";
import { isExactOriginAllowed } from "../_core/ssrfGuard";

type AuthedReq = Request & {
  user?: { id: number; openId: string; email: string | null };
};

export const mediaDownloadRouter = Router();

// 50 MB hard cap on proxied downloads.
const DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024;

function isAllowedOrigin(url: string): boolean {
  return isExactOriginAllowed(url, [
    serverEnv.S3_PUBLIC_URL,
    serverEnv.S3_PUBLIC_DOMAIN,
    serverEnv.BUILT_IN_FORGE_API_URL,
  ]);
}

function guessContentType(url: string): string {
  const lower = url.split("?")[0].toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

mediaDownloadRouter.get(
  "/api/media/download",
  verifyToken,
  async (req: AuthedReq, res: Response) => {
    if (!req.user) {
      res.status(401).json({ error: "請先登入" });
      return;
    }
    const rawUrl = req.query["url"] as string | undefined;
    const filename = (req.query["filename"] as string | undefined) ?? "download";

    if (!rawUrl) {
      res.status(400).json({ error: "缺少 url 參數" });
      return;
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(rawUrl);
      new URL(decoded); // validate
    } catch {
      res.status(400).json({ error: "無效的 URL 格式" });
      return;
    }

    if (!isAllowedOrigin(decoded)) {
      res.status(403).json({
        error: "只允許下載已持久化至內部儲存的媒體",
      });
      return;
    }

    try {
      const upstream = await fetch(decoded, {
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      if (!upstream.ok) {
        res.status(502).json({ error: `上游回應 ${upstream.status}` });
        return;
      }

      const contentType =
        upstream.headers.get("content-type") || guessContentType(decoded);
      const contentLength = upstream.headers.get("content-length");
      if (contentLength && Number(contentLength) > DOWNLOAD_MAX_BYTES) {
        res.status(413).json({ error: "檔案過大" });
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(filename)}"`
      );
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Cache-Control", "no-store");

      const reader = upstream.body?.getReader();
      if (!reader) {
        res.status(502).json({ error: "無法讀取上游串流" });
        return;
      }
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      console.warn("[download] stream failed", { url: decoded, headersSent: res.headersSent, err });
      if (!res.headersSent) {
        res.status(502).json({ error: "下載失敗，請稍後重試" });
      } else {
        res.end();
      }
    }
  }
);

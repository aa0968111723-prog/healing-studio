import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { uploadRouter } from "../uploadRoute";
import { sseRouter } from "../sseRoute";
import { initNewsFetcherCron } from "../jobs/newsFetcher";
import { initModelTrainingWorkerCron } from "../jobs/modelTrainingWorker";

// ─── Allowlist helpers for proxy-download ─────────────────────────────────
const PROXY_ALLOWED_HOSTS = [
  "fal.media",
  "cdn.fal.ai",
  "storage.googleapis.com",
  "v3.fal.media",
  "r2.cloudflarestorage.com",
  "amazonaws.com",
  "replicate.delivery",
  "pbxt.replicate.delivery",
  "suno.ai",
  "elevenlabs.io",
];

function isProxyAllowed(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return PROXY_ALLOWED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith("." + h));
  } catch {
    return false;
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // File upload API
  app.use(uploadRouter);
  // SSE for real-time generation events
  app.use(sseRouter);

  // ── 後端代理下載（解決前端直接 fetch CDN 時的 CORS 問題）──────────────────
  // GET /api/proxy-download?url=<encodedUrl>
  app.get("/api/proxy-download", async (req, res) => {
    const raw = req.query.url as string | undefined;
    if (!raw) { res.status(400).json({ error: "Missing url parameter" }); return; }

    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(raw);
    } catch {
      res.status(400).json({ error: "Invalid url encoding" }); return;
    }

    if (!isProxyAllowed(targetUrl)) {
      res.status(403).json({ error: "URL not in allowlist" }); return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: { "User-Agent": "HealingStudio/1.0 AssetProxy" },
      });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` }); return;
      }
      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const contentLength = upstream.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      // Stream the response
      const buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[proxy-download] Error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Initialize scheduled jobs after server is ready
    initNewsFetcherCron();
    initModelTrainingWorkerCron();
  });
}

startServer().catch(console.error);

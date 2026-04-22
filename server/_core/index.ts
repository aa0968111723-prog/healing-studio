import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { uploadRouter } from "../uploadRoute";
import { sseRouter } from "../sseRoute";
import { initNewsFetcherCron, stopNewsFetcherCron } from "../jobs/newsFetcher";
import {
  initModelTrainingWorkerCron,
  stopModelTrainingWorkerCron,
} from "../jobs/modelTrainingWorker";
import {
  initLearnDocSyncerCron,
  stopLearnDocSyncerCron,
} from "../jobs/learnDocSyncer";
import {
  initApiHealthMonitorCron,
  stopApiHealthMonitorCron,
} from "../jobs/apiHealthMonitor";
import {
  initBraveLearnFetcherCron,
  stopBraveLearnFetcherCron,
} from "../jobs/braveLearnFetcher";
import { detectStorageBackend } from "../storage";
import { closeDb } from "../db";
import { langsmithRouter } from "../routes/langsmith";
import { falWebhookRouter } from "../routes/webhookFal";
import { stripeWebhookRouter } from "../routes/stripeWebhook";
import {
  initR2SnapshotCron,
  stopR2SnapshotCron,
} from "../jobs/r2SnapshotJob";
import {
  initProviderSnapshotCron,
  stopProviderSnapshotCron,
} from "../jobs/providerSnapshotJob";
import {
  initApiUsageAlertCron,
  stopApiUsageAlertCron,
} from "../jobs/apiUsageAlertJob";
import {
  initUserAutoCreditCron,
  stopUserAutoCreditCron,
} from "../jobs/userAutoCreditJob";
import { aiProxyRouter } from "../routes/aiProxy";
import { installFetchGuard } from "./fetchGuard";
import { globalErrorHandler, registerFatalErrorHandlers } from "./error_handler";
import { logger, requestTraceMiddleware } from "./logger";
import { closeDatabaseManager } from "./DatabaseManager";

type ScheduledMaintenanceJob = {
  name: string;
  start: () => void;
  stop: () => void;
};

const SCHEDULED_MAINTENANCE_JOBS: ScheduledMaintenanceJob[] = [
  {
    name: "newsFetcher",
    start: initNewsFetcherCron,
    stop: stopNewsFetcherCron,
  },
  {
    name: "modelTrainingWorker",
    start: initModelTrainingWorkerCron,
    stop: stopModelTrainingWorkerCron,
  },
  {
    name: "learnDocSyncer",
    start: initLearnDocSyncerCron,
    stop: stopLearnDocSyncerCron,
  },
  {
    name: "apiHealthMonitor",
    start: initApiHealthMonitorCron,
    stop: stopApiHealthMonitorCron,
  },
  {
    name: "braveLearnFetcher",
    start: initBraveLearnFetcherCron,
    stop: stopBraveLearnFetcherCron,
  },
  {
    name: "r2SnapshotJob",
    start: initR2SnapshotCron,
    stop: stopR2SnapshotCron,
  },
  {
    name: "providerSnapshotJob",
    start: initProviderSnapshotCron,
    stop: stopProviderSnapshotCron,
  },
  {
    name: "apiUsageAlertJob",
    start: initApiUsageAlertCron,
    stop: stopApiUsageAlertCron,
  },
  {
    name: "userAutoCreditJob",
    start: initUserAutoCreditCron,
    stop: stopUserAutoCreditCron,
  },
];

function startScheduledMaintenanceJobs(): void {
  for (const job of SCHEDULED_MAINTENANCE_JOBS) {
    try {
      job.start();
      logger.info("[Jobs] Started scheduled maintenance job", { jobName: job.name });
    } catch (error) {
      logger.error("[Jobs] Failed to start scheduled maintenance job", {
        jobName: job.name,
        err: error,
      });
    }
  }
}

function stopScheduledMaintenanceJobs(): void {
  for (const job of SCHEDULED_MAINTENANCE_JOBS) {
    try {
      job.stop();
      logger.info("[Jobs] Stopped scheduled maintenance job", { jobName: job.name });
    } catch (error) {
      logger.error("[Jobs] Failed to stop scheduled maintenance job", {
        jobName: job.name,
        err: error,
      });
    }
  }
}

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
  // Demo sample assets
  "images.unsplash.com",
  "www.soundhelix.com",
  "gtv-videos-bucket.storage.googleapis.com",
];

function isProxyAllowed(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return PROXY_ALLOWED_HOSTS.some(
      h => u.hostname === h || u.hostname.endsWith("." + h)
    );
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
  installFetchGuard();

  const app = express();
  const server = createServer(app);

  // ── Security headers ─────────────────────────────────────────────────────
  app.use(requestTraceMiddleware);

  // ── Security headers ─────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // CSP managed separately (inline scripts, CDNs)
      crossOriginEmbedderPolicy: false, // Allow cross-origin media assets
    })
  );

  // ── Gzip/Brotli compression (60-80% smaller text/JSON responses) ────────
  app.use(compression({ threshold: 1024 }));

  // ── Rate limiting for API endpoints ─────────────────────────────────────
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // limit each IP to 300 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  });
  app.use("/api/", apiLimiter);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // File upload API
  app.use(uploadRouter);
  // SSE for real-time generation events
  app.use(sseRouter);
  // LangSmith observability stats
  app.use(langsmithRouter);
  app.use(falWebhookRouter);
  app.use(stripeWebhookRouter);
  // AI Provider Proxy Gateway
  app.use(aiProxyRouter);

  // ── 後端代理下載（解決前端直接 fetch CDN 時的 CORS 問題）──────────────────
  // GET /api/proxy-download?url=<encodedUrl>
  app.get("/api/proxy-download", async (req, res) => {
    const raw = req.query.url as string | undefined;
    if (!raw) {
      res.status(400).json({ error: "Missing url parameter" });
      return;
    }

    let targetUrl: string;
    try {
      targetUrl = decodeURIComponent(raw);
    } catch {
      res.status(400).json({ error: "Invalid url encoding" });
      return;
    }

    if (!isProxyAllowed(targetUrl)) {
      res.status(403).json({ error: "URL not in allowlist" });
      return;
    }

    try {
      const upstream = await fetch(targetUrl, {
        headers: { "User-Agent": "HealingStudio/1.0 AssetProxy" },
      });
      if (!upstream.ok) {
        res
          .status(upstream.status)
          .json({ error: `Upstream returned ${upstream.status}` });
        return;
      }
      const contentType =
        upstream.headers.get("content-type") || "application/octet-stream";
      const contentLength = upstream.headers.get("content-length");
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400"); // 24h cache
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      // Stream the response body instead of buffering into memory
      if (upstream.body) {
        const reader = upstream.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            if (!res.write(value)) {
              // Handle backpressure
              await new Promise<void>(resolve => res.once("drain", resolve));
            }
          }
        };
        pump().catch(err => {
          logger.error("[proxy-download] Stream error", { targetUrl, err });
          if (!res.headersSent)
            res.status(500).json({ error: "Stream failed" });
          else res.end();
        });
      } else {
        // Fallback for environments without ReadableStream
        const buffer = await upstream.arrayBuffer();
        res.send(Buffer.from(buffer));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[proxy-download] Error", { msg, targetUrl });
      res.status(500).json({ error: msg });
    }
  });

  // ── Plain HTTP healthcheck (Railway uses this path to verify container is up) ──
  // Must respond within the healthcheck window (typically 5m on Railway)
  app.get("/api/health", (_req, res) => {
    const storageBackend = detectStorageBackend();
    res.json({ ok: true, ts: Date.now(), storage: storageBackend });
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
  app.use(globalErrorHandler);

  // In production (Railway), always use the PORT env var directly and bind 0.0.0.0
  // In development, scan for an available port starting from 3000
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port =
    process.env.NODE_ENV === "production"
      ? preferredPort
      : await findAvailablePort(preferredPort);

  if (process.env.NODE_ENV !== "production" && port !== preferredPort) {
    logger.warn("Preferred port unavailable, switched port", {
      preferredPort,
      selectedPort: port,
    });
  }

  server.listen(port, "0.0.0.0", () => {
    logger.info("Server started", { port, host: "0.0.0.0" });

    // Log storage backend status on startup
    try {
      const backend = detectStorageBackend();
      const backendLabels: Record<string, string> = {
        s3: "✅ S3 / Cloudflare R2（S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY + S3_BUCKET_NAME）",
        gcs: "✅ Google Cloud Storage（GCS_BUCKET_NAME + GOOGLE_APPLICATION_CREDENTIALS_JSON）",
        manus:
          "✅ Manus Storage Proxy（BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY）",
        none:
          "❌ 未設定任何儲存後端！請在 Railway 環境變數中設定以下任一組合：\n" +
          "   ▸ 方案A（推薦）Cloudflare R2：S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY + S3_BUCKET_NAME\n" +
          "   ▸ 方案B Google GCS：GCS_BUCKET_NAME + GOOGLE_APPLICATION_CREDENTIALS_JSON\n" +
          "   ▸ 方案C Manus Proxy：BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY",
      };
      logger.info("[Storage] 目前使用的儲存後端", {
        backend: backendLabels[backend] ?? backend,
      });
    } catch (e) {
      logger.warn("[Storage] 無法偵測儲存後端", { err: e });
    }

    // Initialize scheduled maintenance jobs after server is ready
    startScheduledMaintenanceJobs();
  });

  // ── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.warn("[Server] Starting graceful shutdown", { signal });
    stopScheduledMaintenanceJobs();
    server.close(async () => {
      await closeDb();
      await closeDatabaseManager();
      logger.info("[Server] All resources released. Exiting.");
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      logger.warn("[Server] Graceful shutdown timed out. Forcing exit.");
      process.exit(1);
    }, 10_000);
  };

  registerFatalErrorHandlers(shutdown);

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(error => {
  logger.error("Failed to start server", { err: error });
});

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import compression from "compression";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { googleAuthRouter } from "../routes/googleAuth";
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
import { closeDb, runMigrations } from "../db";
import { falWebhookRouter } from "../routes/webhookFal";
import { sunoWebhookRouter } from "../routes/webhookSuno";
import { replicateWebhookRouter } from "../routes/webhookReplicate";
import { stripeWebhookRouter } from "../routes/stripeWebhook";
import { mediaDownloadRouter } from "../routes/download";
import { icsFeedRouter } from "../routes/icsFeed";
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
import { localAuthRouter } from "../routes/localAuth";
import { passwordResetRouter } from "../routes/passwordResetRoutes";
import { webhooksRouter } from "../routes/webhooks";
import { orbTasksRouter } from "../routes/orbTasks";
import { adminEventsRouter } from "../routes/adminEvents";
import { toolsModelsRouter } from "../routes/toolsModels";
import { installFetchGuard } from "./fetchGuard";
import { globalErrorHandler, registerFatalErrorHandlers } from "./error_handler";
import { logger, requestTraceMiddleware } from "./logger";
import { closeDatabaseManager } from "./DatabaseManager";
import { bootstrapAiAdapters } from "../services/ai-adapters/bootstrap";
import { runOrbToolExecutorStartupSelfCheck } from "../services/agentToolExecutor";
import { serverEnv } from "./env.validated";
import { startOrbScheduler } from "../services/orbScheduler";
import {
  checkElevenLabsHealth,
  setElevenLabsAvailability,
} from "../services/providerHealth";
import { WebSocketServer } from "ws";
import { handleOrbVoiceConnection } from "../ws/orbVoiceGateway";
import { cache } from "./cache";
import { metrics } from "./metrics";
import { featureFlags } from "./featureFlags";
import { rateLimiters, rateLimitContextMiddleware } from "./rateLimiter";

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
  bootstrapAiAdapters();
  runOrbToolExecutorStartupSelfCheck();
  featureFlags.logStartupState();
  const elevenLabsHealthy = await checkElevenLabsHealth();
  setElevenLabsAvailability(elevenLabsHealthy);
  if (!elevenLabsHealthy) {
    console.warn(
      "[Voice] ElevenLabs health check failed at startup. Please update ELEVENLABS_API_KEY; Google TTS fallback will be used."
    );
  }

  if (process.env.NODE_ENV === "production") {
    const explicitAllowOrigins = (process.env.ORB_TOOL_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
    if (explicitAllowOrigins.length === 0) {
      logger.error(
        "[FATAL] ORB_TOOL_ALLOWED_ORIGINS is empty in production. Refusing to boot. See .env.example -> 光球代理 Orb Tool Execution."
      );
      process.exit(1);
    }
  }

  // ── Run DB migrations eagerly before the server handles any requests ─────
  // This ensures tables like `login_history` exist even if the login endpoint
  // is the very first request (which uses DatabaseManager, not getDb()).
  try {
    await runMigrations();
  } catch (err) {
    logger.error("[Server] DB migration failed on startup — server will continue", { err });
  }
  // Reload persisted orb scheduled jobs from the DB and seed env-defined
  // jobs. Awaited so the scheduler is fully ready before the HTTP server
  // accepts requests.
  try {
    await startOrbScheduler();
  } catch (err) {
    logger.error(
      "[Server] OrbScheduler bootstrap failed — server will continue without persisted jobs",
      { err }
    );
  }

  const app = express();
  const server = createServer(app);

  // Trust Railway's reverse proxy so req.ip / X-Forwarded-For work correctly
  app.set("trust proxy", 1);

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

  // ── Rate limiting context (adds degraded-mode helper to res) ────────────
  app.use(rateLimitContextMiddleware);

  // ── Tiered rate limiting for API endpoints ───────────────────────────────
  // Keep strict auth throttling only on credential-mutating routes.
  // Read-only auth probes (/api/auth/me, /api/auth/google/status) must stay
  // responsive, otherwise the login UI can soft-lock before users submit forms.
  app.use("/api/auth/login", rateLimiters.auth);
  app.use("/api/auth/register", rateLimiters.auth);
  app.use("/api/auth/forgot-password", rateLimiters.auth);
  app.use("/api/auth/reset-password", rateLimiters.auth);
  app.use("/api/auth/change-password", rateLimiters.auth);
  app.use("/api/", rateLimiters.api);

  // Configure body parser with larger size limit for file uploads.
  // The `verify` callback exposes the original byte buffer on `req.rawBody`
  // so webhook handlers (fal / suno / replicate / stripe) can compute HMAC /
  // Ed25519 signatures over the exact bytes the upstream service signed —
  // re-stringifying `req.body` after JSON parse can re-order keys and break
  // signature verification.
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        if (buf && buf.length) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    })
  );
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(googleAuthRouter);
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // File upload API
  app.use(uploadRouter);
  // Local uploads directory (dev/demo fallback when no cloud storage configured)
  if (process.env.NODE_ENV !== "production") {
    const localUploadsPath = path.resolve(process.cwd(), "uploads");
    if (!fs.existsSync(localUploadsPath)) {
      fs.mkdirSync(localUploadsPath, { recursive: true });
    }
    app.use("/uploads", express.static(localUploadsPath));
  }
  // SSE for real-time generation events
  app.use(sseRouter);
  // (LangSmith stats moved to tRPC: trpc.langsmith.stats)
  app.use(falWebhookRouter);
  app.use(sunoWebhookRouter);
  app.use(replicateWebhookRouter);
  app.use(stripeWebhookRouter);
  app.use(mediaDownloadRouter);
  app.use(icsFeedRouter);
  // AI Provider Proxy Gateway
  app.use(aiProxyRouter);
  app.use(localAuthRouter);
  app.use(passwordResetRouter);
  app.use(orbTasksRouter);
  app.use(adminEventsRouter);
  app.use(toolsModelsRouter);

  // ── Maps proxy（隱藏 FRONTEND_FORGE_API_KEY，避免前端暴露）───────────────
  app.get("/api/maps/proxy/*", async (req, res) => {
    const forgeBase = serverEnv.FRONTEND_FORGE_API_URL.trim();
    const forgeKey = serverEnv.FRONTEND_FORGE_API_KEY.trim();
    if (!forgeKey) {
      res.status(503).json({ error: "FRONTEND_FORGE_API_KEY 未設定" });
      return;
    }

    const wildcardPath = (req.params as { "0"?: string })["0"] ?? "";
    if (wildcardPath !== "maps/api/js") {
      res.status(404).json({ error: "Unsupported maps proxy path" });
      return;
    }
    const upstreamUrl = new URL(`/v1/maps/proxy/${wildcardPath}`, forgeBase);

    const allowedQueryKeys = new Set([
      "v",
      "libraries",
      "language",
      "region",
      "callback",
      "channel",
      "solution_channel",
    ]);
    for (const [key, value] of Object.entries(req.query)) {
      if (!allowedQueryKeys.has(key)) continue;
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const item of value) upstreamUrl.searchParams.append(key, String(item));
      } else {
        upstreamUrl.searchParams.set(key, String(value));
      }
    }
    upstreamUrl.searchParams.set("key", forgeKey);

    try {
      const upstream = await fetch(upstreamUrl.toString(), {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": "HealingStudio/1.0 MapsProxy",
          Accept: req.headers.accept ?? "*/*",
        },
      });

      res.status(upstream.status);
      const contentType = upstream.headers.get("content-type");
      const contentLength = upstream.headers.get("content-length");
      if (contentType) res.setHeader("Content-Type", contentType);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      res.setHeader("Cache-Control", "public, max-age=600");

      if (upstream.body) {
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise<void>(resolve => res.once("drain", resolve));
          }
        }
        res.end();
        return;
      }

      const body = await upstream.arrayBuffer();
      res.send(Buffer.from(body));
    } catch (error) {
      logger.error("[maps-proxy] upstream error", { err: error });
      res.status(502).json({ error: "Maps proxy upstream failed" });
    }
  });

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
        signal: AbortSignal.timeout(30_000),
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

  // ── Performance metrics endpoint ─────────────────────────────────────────
  // Returns in-process latency, error rates, cache stats, and feature flags.
  // Restricted to internal/admin use — not rate-limited by the API limiter.
  app.get("/api/metrics", (_req, res) => {
    const snap = metrics.getSnapshot();
    const cacheStats = cache.getStats();
    const flags = featureFlags.getAllStatuses();
    res.json({
      ok: true,
      metrics: snap,
      cache: cacheStats,
      featureFlags: flags,
    });
  });
  app.use("/api/webhooks", webhooksRouter);

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
        local:
          "⚠️  本機暫存（開發模式）— 檔案儲存於 ./uploads/，重啟後可能遺失。請在正式環境設定雲端儲存。",
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

  const wss = new WebSocketServer({ server, path: "/ws/orb-voice" });
  wss.on("connection", (ws: unknown, req: unknown) => {
    void handleOrbVoiceConnection(ws as never, req as never);
  });

  // ── Graceful Shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.warn("[Server] Starting graceful shutdown", { signal });
    stopScheduledMaintenanceJobs();
    // Flush final metrics snapshot before shutdown
    logger.info("[Server] Final metrics snapshot", { metrics: metrics.getSnapshot() });
    server.close(async () => {
      await closeDb();
      await closeDatabaseManager();
      // Release in-process resources
      cache.destroy();
      metrics.destroy();
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

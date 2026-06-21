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
import { assertJwtSecretReady, authenticateRequest } from "./googleAuth";
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
  initTeachingArchiveIngestionWorkerCron,
  stopTeachingArchiveIngestionWorkerCron,
} from "../jobs/teachingArchiveIngestionWorker";
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
import { closeDb, runMigrations, isMigrationFailClosed } from "../db";
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
  initCostLedgerReconcileCron,
  stopCostLedgerReconcileCron,
} from "../jobs/costLedgerReconcileJob";
import {
  initCostAttributionOutboxCron,
  stopCostAttributionOutboxCron,
} from "../jobs/costAttributionOutboxJob";
import {
  initUserAutoCreditCron,
  stopUserAutoCreditCron,
} from "../jobs/userAutoCreditJob";
import {
  initModelCatalogResearchCron,
  stopModelCatalogResearchCron,
} from "../jobs/modelCatalogResearchJob";
import {
  initMediaArchivalCron,
  stopMediaArchivalCron,
} from "../jobs/mediaArchivalCron";
import {
  initDbBackupCron,
  stopDbBackupCron,
} from "../jobs/dbSnapshotJob";
import {
  initAssetCleanupCron,
  stopAssetCleanupCron,
} from "../jobs/assetCleanupJob";
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
import { initErrorTracking, errorTrackingExpressErrorHandler } from "./errorTracking";
import { metricsRouter } from "./metricsRoute";
import {
  initGenerationLockBackend,
  closeGenerationLockBackend,
} from "./redisGenerationLockStore";

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
    name: "teachingArchiveIngestionWorker",
    start: initTeachingArchiveIngestionWorkerCron,
    stop: stopTeachingArchiveIngestionWorkerCron,
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
    name: "costLedgerReconcileJob",
    start: initCostLedgerReconcileCron,
    stop: stopCostLedgerReconcileCron,
  },
  {
    name: "costAttributionOutboxJob",
    start: initCostAttributionOutboxCron,
    stop: stopCostAttributionOutboxCron,
  },
  {
    name: "userAutoCreditJob",
    start: initUserAutoCreditCron,
    stop: stopUserAutoCreditCron,
  },
  {
    name: "modelCatalogResearchJob",
    start: initModelCatalogResearchCron,
    stop: stopModelCatalogResearchCron,
  },
  {
    name: "mediaArchivalCron",
    start: initMediaArchivalCron,
    stop: stopMediaArchivalCron,
  },
  {
    name: "dbSnapshotJob",
    start: initDbBackupCron,
    stop: stopDbBackupCron,
  },
  {
    name: "assetCleanupJob",
    start: initAssetCleanupCron,
    stop: stopAssetCleanupCron,
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
  // AIDV-59（H4 JWT 硬化）：開機即驗證 session 簽章密鑰。
  // 正式環境若 JWT_SECRET（或別名 AUTH_SECRET）缺失／太弱會在此 throw，
  // 讓部署「響亮地」失敗，而不是先啟動再用弱密鑰簽 1 年 token。
  assertJwtSecretReady();
  // AIDV-58（H3）：錯誤追蹤接線——依 serverEnv.SENTRY_DSN env-gated。
  // 未設 DSN（最常見）→ 完全 no-op，不報錯、不阻塞開機；@sentry/node 缺席亦安全降級。
  await initErrorTracking();
  installFetchGuard();
  bootstrapAiAdapters();
  runOrbToolExecutorStartupSelfCheck();
  featureFlags.logStartupState();
  // AIDV-20: upgrade the generation dedup lock to its Redis backend when
  // REDIS_URL is configured (cross-instance dedup for multi-replica). No
  // REDIS_URL → keeps the in-memory store (single-instance, zero change).
  // Never throws; a Redis problem leaves the in-memory store in place.
  initGenerationLockBackend();
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
    const hasToolRegistry = (process.env.ORB_TOOL_REGISTRY_JSON ?? "").trim().length > 0;
    if (explicitAllowOrigins.length === 0 && hasToolRegistry) {
      logger.error(
        "[FATAL] ORB_TOOL_ALLOWED_ORIGINS is empty in production. Refusing to boot. See .env.example -> 光球代理 Orb Tool Execution."
      );
      process.exit(1);
    }
    if (explicitAllowOrigins.length === 0 && !hasToolRegistry) {
      logger.warn(
        "[Orb] ORB_TOOL_ALLOWED_ORIGINS is empty in production, but ORB_TOOL_REGISTRY_JSON is not set. " +
          "Booting with outbound orb tools disabled by default."
      );
    }
  }

  // ── Run DB migrations eagerly before the server handles any requests ─────
  // This ensures tables like `login_history` exist even if the login endpoint
  // is the very first request (which uses DatabaseManager, not getDb()).
  try {
    await runMigrations();
  } catch (err) {
    // AIDV-61（H6）：fail-closed 開機門。
    // 預設 OFF（MIGRATION_FAIL_CLOSED!=="true"）：維持現狀 — 只記錄錯誤、繼續啟動
    //   （fail-open；對現有 prod 零行為改變）。注意 OFF 時 applyMigrations 的 catch
    //   根本不會 rethrow，這個 catch 平時不會被觸發。
    // ON（MIGRATION_FAIL_CLOSED==="true"）：migration 真實 apply 失敗會 rethrow 到此，
    //   印致命 log 後 process.exit(1) 擋啟動（對齊本檔上方 ORB_TOOL_ALLOWED_ORIGINS
    //   的 fatal 模式），令 /api/health 失敗、Railway 偵測不健康後自動重啟或人工回滾。
    // demo / 無 DATABASE_URL 不會進到這裡：runMigrations→getDb 回 null，從不拋錯。
    if (isMigrationFailClosed()) {
      logger.error(
        "[FATAL] DB migration failed on startup and MIGRATION_FAIL_CLOSED is enabled — refusing to boot. " +
          "Roll back to the last healthy Railway deploy and fix the failing migration. " +
          "See docs/guides/MIGRATION_FAILURE_SOP.md.",
        { err }
      );
      process.exit(1);
    }
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
  // H5（AIDV-60）：upload 限流器寫好後從未掛載——補掛。此處在 auth 中介層
  // 之前，key 退化為 per-IP（20 req/15min/IP）；per-user 細分留待 upload
  // 路由內建 auth 重構時一併處理。
  // （llm／llmPerUser 兩個限流器掛在 aiProxyRouter 內、verifyToken 之後，
  //   見 routes/aiProxy.ts —— 在那裡才拿得到 req.user 做 per-user key。）
  //
  // AIDV-15 限流對等：嚴格 upload 限流器（20/15min）只計「真正承載成本」的端點——
  //   • base64 全量上傳 POST /api/upload（單次上傳=1 請求）
  //   • signed-URL 取簽 POST /api/upload/presign（單次上傳=1 請求）
  // finalize 只做一次 HeadObject（外加可選的 64-byte ranged GET），成本極低，
  // 故放行到較寬的 /api/ 限流器（300/15min），避免 signed 流程每次上傳吃掉 2 個
  // upload 配額、把每 IP 有效上傳數從 20 砍半成 ~10（批次/大檔場景最先撞 429）。
  // 結果：不論走 base64 還是 signed，一次成功上傳都只消耗 1 個 upload 配額。
  app.use("/api/upload", (req, res, next) => {
    // 掛在 "/api/upload" 之下，req.path 已去前綴：finalize 端點 = "/finalize"。
    // finalize 只做 HeadObject(+可選 64-byte GET)，成本極低 → 放行到較寬的 api
    // 限流（下方 /api/ 那道），不吃嚴格 upload 配額。
    if (req.path === "/finalize") {
      return next();
    }
    return (rateLimiters.upload as express.RequestHandler)(req, res, next);
  });
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
    // AIDV-64: serve user uploads with nosniff so the browser never
    // content-type-sniffs an uploaded body into executable HTML/SVG (defence
    // in depth alongside the upload-time content guard + safe storage ext).
    app.use(
      "/uploads",
      express.static(localUploadsPath, {
        setHeaders: res => {
          res.setHeader("X-Content-Type-Options", "nosniff");
        },
      })
    );
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
  //
  // AIDV-58（維運鏡審查）：此端點無 auth、對整個網際網路可見，故只回最小存活訊號。
  // 不再外洩 DB 內部狀態（manager.lastError / failureCount / circuitOpen，原始 DB 錯誤字串
  // 可能含 host/driver/連線細節）與 drizzle poolStats（active/idle/queued/total 連線數），
  // 也不外洩具體 storage backend 類型——只回布林（是否已設定後端）。
  // 詳細 dbHealth 移到 admin-only 的 /api/health/detail（與 /api/metrics 同源守門）。
  app.get("/api/health", (_req, res) => {
    // storage:boolean — 「是否已設定後端」而非具體類型（s3/gcs/manus）。
    // 'none' = 生產未設定任何雲端儲存；dev 預設 'local' 仍視為已設定。
    const storageConfigured = detectStorageBackend() !== "none";
    res.json({ ok: true, ts: Date.now(), storage: storageConfigured });
  });

  // ── Performance metrics endpoint（AIDV-58 H3：admin-only）────────────────
  // 守門邏輯抽到 _core/metricsRoute.ts（沿用 @shared/const 單一 isAdmin、可單元測試）。
  // 未登入 → 401；非 admin → 403（fail-closed）。demo（role=user）→ 403。
  app.use(metricsRouter);
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
  // AIDV-58（H3）：Sentry error 中介層必須排在 globalErrorHandler 之前——
  // 先把錯誤上報（env-gated；無 DSN 時為透傳 no-op），再交給既有 handler 回應 client。
  // 此中介層只 next(err)、不改回應，故不影響既有行為與 aiProxy 路徑。
  app.use(errorTrackingExpressErrorHandler());
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

  // Use noServer mode + manual upgrade dispatch so Vite HMR (which opens its
  // own WebSocket on "/") and any future WS endpoints can coexist. With
  // `{ server, path }`, the ws library aborts every non-matching upgrade,
  // which silently breaks Vite HMR and leaves the dev home page in a reload
  // loop where modules never finish loading.
  const orbVoiceWss = new WebSocketServer({ noServer: true });
  orbVoiceWss.on("connection", (ws: unknown, req: unknown) => {
    void handleOrbVoiceConnection(ws as never, req as never);
  });
  server.on("upgrade", (req, socket, head) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (pathname !== "/ws/orb-voice") return;
    orbVoiceWss.handleUpgrade(req, socket, head, (ws: unknown) => {
      orbVoiceWss.emit("connection", ws, req);
    });
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
      // AIDV-20: stop the generation-lock self-heal/sweep timers and close the
      // shared Redis client (no-op when REDIS_URL is unset).
      await closeGenerationLockBackend();
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

import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import fs from "fs";
import path from "path";
import compression from "compression";
import helmet from "helmet";
import { helmetOptions, permissionsPolicyMiddleware } from "./securityHeaders";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { assertJwtSecretReady, authenticateRequest } from "./googleAuth";
import { googleAuthRouter } from "../routes/googleAuth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { uploadRouter } from "../uploadRoute";
import { sseRouter } from "../sseRoute";
import { agentEventsRouter } from "../agentEventsRoute";
import { unifiedSseRouter } from "../unifiedSseRoute";
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
import { closeDb, runMigrations, isMigrationFailClosed, checkDrizzleHealth } from "../db";
import { validateEnvConfig } from "../lib/config-check";
import { falWebhookRouter } from "../routes/webhookFal";
import { sunoWebhookRouter } from "../routes/webhookSuno";
import { replicateWebhookRouter } from "../routes/webhookReplicate";
import { stripeWebhookRouter } from "../routes/stripeWebhook";
import { mediaDownloadRouter } from "../routes/download";
import { videoOutputRouter } from "../routes/videoOutputRoute";
import { videoRouter } from "../routes/videoRoute";
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
import {
  initAuditLogPurgeCron,
  stopAuditLogPurgeCron,
} from "../jobs/auditLogPurgeJob";
import {
  initStaleJobCheckerCron,
  stopStaleJobCheckerCron,
} from "../jobs/staleJobChecker";
import {
  initLoginHistoryPurgeCron,
  stopLoginHistoryPurgeCron,
} from "../jobs/loginHistoryPurgeJob";
import {
  initBackgroundJobPurgeCron,
  stopBackgroundJobPurgeCron,
} from "../jobs/backgroundJobPurgeJob";
import {
  initCredentialExpiryAlertCron,
  stopCredentialExpiryAlertCron,
} from "../jobs/credentialExpiryAlertJob";
import {
  initProviderHealthProbeCron,
  stopProviderHealthProbeCron,
} from "../jobs/providerHealthProbeJob";
import {
  initGoTrueHealthMonitorCron,
  stopGoTrueHealthMonitorCron,
} from "../jobs/goTrueHealthMonitor";
import {
  initAgentDlqPollerCron,
  stopAgentDlqPollerCron,
} from "../jobs/agentDlqPoller";
import { agentStatusRouter } from "../routes/agentStatusRoute";
import { handoffTraceRouter } from "../routes/handoffTraceRoute";
import { v1Router } from "../routes/v1";
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
import { jsonDepthGuard } from "./inputGuard";
import { closeDatabaseManager } from "./DatabaseManager";
import { bootstrapAiAdapters } from "../services/ai-adapters/bootstrap";
import { runOrbToolExecutorStartupSelfCheck } from "../services/agentToolExecutor";
import { initLearnHubFromDb } from "../routers/learnHub";
import { serverEnv } from "./env.validated";
import { startOrbScheduler } from "../services/orbScheduler";
import {
  checkElevenLabsHealth,
  setElevenLabsAvailability,
} from "../services/providerHealth";
import { WebSocketServer } from "ws";
import { handleOrbVoiceConnection, ORB_MAX_PAYLOAD_BYTES } from "../ws/orbVoiceGateway";
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
import {
  initCreatorQuotaBackend,
  closeCreatorQuotaBackend,
} from "./redisCreatorQuotaStore";

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
  {
    name: "staleJobChecker",
    start: initStaleJobCheckerCron,
    stop: stopStaleJobCheckerCron,
  },
  {
    name: "auditLogPurgeJob",
    start: initAuditLogPurgeCron,
    stop: stopAuditLogPurgeCron,
  },
  {
    name: "loginHistoryPurgeJob",
    start: initLoginHistoryPurgeCron,
    stop: stopLoginHistoryPurgeCron,
  },
  {
    name: "backgroundJobPurgeJob",
    start: initBackgroundJobPurgeCron,
    stop: stopBackgroundJobPurgeCron,
  },
  {
    name: "credentialExpiryAlertJob",
    start: initCredentialExpiryAlertCron,
    stop: stopCredentialExpiryAlertCron,
  },
  {
    name: "providerHealthProbeJob",
    start: initProviderHealthProbeCron,
    stop: stopProviderHealthProbeCron,
  },
  {
    name: "goTrueHealthMonitor",
    start: initGoTrueHealthMonitorCron,
    stop: stopGoTrueHealthMonitorCron,
  },
  {
    name: "agentDlqPoller",
    start: initAgentDlqPollerCron,
    stop: stopAgentDlqPollerCron,
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
  // AIDV-261：棄用環境變數警告（不 throw，只 warn）。
  validateEnvConfig();
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
  // AIDV-923: upgrade the per-creator concurrency quota to its Redis backend
  // when REDIS_URL is configured (cross-instance enforcement for multi-replica).
  // No REDIS_URL → keeps the in-memory store (single-instance, zero change).
  // Never throws; a Redis problem leaves the in-memory store in place.
  initCreatorQuotaBackend();
  // AIDV: fire-and-forget — never block boot on this non-essential probe.
  // ELEVENLABS_AVAILABLE defaults to true and is updated when this resolves, so
  // until then the app behaves as available (Google TTS is the fallback anyway).
  // Awaiting it here would gate server.listen() on an external network call;
  // a slow/unreachable ElevenLabs would delay port binding and risk a Railway
  // healthcheck timeout. It already carries its own 5s fetch timeout.
  void checkElevenLabsHealth()
    .then(elevenLabsHealthy => {
      setElevenLabsAvailability(elevenLabsHealthy);
      if (!elevenLabsHealthy) {
        console.warn(
          "[Voice] ElevenLabs health check failed at startup. Please update ELEVENLABS_API_KEY; Google TTS fallback will be used."
        );
      }
    })
    .catch(() => {
      setElevenLabsAvailability(false);
    });

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

  // ── Deferred boot init (migrations · LearnHub · OrbScheduler) ────────────
  // These DB-bound steps USED to be awaited BEFORE server.listen(), so the HTTP
  // server (and /api/health) could not respond until they finished. A slow
  // migration or a hung dependency therefore blocked the port from ever
  // accepting connections → Railway's healthcheck got no response → the deploy
  // FAILED with a healthcheck timeout despite a healthy app (real incident
  // 2026-06-30; cf. the unbounded ElevenLabs probe fixed in providerHealth.ts).
  //
  // Fix: bind the port first (server.listen below), then run this init in the
  // background. `bootReady` gates /api/health — it returns 503 ("booting")
  // until init completes, so Railway still won't route real traffic to an
  // un-migrated DB (preserving the original "no requests before migrations"
  // guarantee), but the server is now ALWAYS responsive instead of hanging:
  // the healthcheck just retries until init finishes (bounded by DB work, not
  // by an unbounded pre-listen await).
  let bootReady = false;
  const runDeferredBootInit = async (): Promise<void> => {
    // Run DB migrations before serving real traffic. Ensures tables like
    // `login_history` exist even if the login endpoint is the very first
    // request (which uses DatabaseManager, not getDb()).
    try {
      await runMigrations();
    } catch (err) {
      // AIDV-61（H6）：fail-closed 開機門。
      // 預設 OFF（MIGRATION_FAIL_CLOSED!=="true"）：只記錄錯誤、繼續啟動（fail-open；
      //   對現有 prod 零行為改變）。OFF 時 applyMigrations 的 catch 不會 rethrow。
      // ON（MIGRATION_FAIL_CLOSED==="true"）：migration 真實 apply 失敗會 rethrow 到此，
      //   印致命 log 後 process.exit(1) 擋啟動，令 Railway 偵測不健康後自動重啟或人工回滾。
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
    // AIDV-214: Load admin-created learn hub docs persisted in DB.
    // Runs after migrations so the learn_modules table is guaranteed to exist.
    try {
      await initLearnHubFromDb();
    } catch (err) {
      logger.error("[Server] LearnHub DB init failed — server will continue with seed docs only", { err });
    }
    // Reload persisted orb scheduled jobs from the DB and seed env-defined jobs.
    try {
      await startOrbScheduler();
    } catch (err) {
      logger.error(
        "[Server] OrbScheduler bootstrap failed — server will continue without persisted jobs",
        { err }
      );
    }
    // Scheduled maintenance cron jobs start only after migrations, so their
    // first run never hits a missing table (preserves pre-listen ordering).
    startScheduledMaintenanceJobs();
    bootReady = true;
    logger.info("[Server] Deferred boot init complete — /api/health now reports ready");
  };

  const app = express();
  const server = createServer(app);

  // Trust Railway's reverse proxy so req.ip / X-Forwarded-For work correctly
  app.set("trust proxy", 1);

  // ── Request trace middleware ──────────────────────────────────────────────
  app.use(requestTraceMiddleware);

  // ── Security headers ─────────────────────────────────────────────────────
  // AIDV-313/251/312: helmet with CSP + DENY frame-guard + HSTS(preload) +
  // Referrer-Policy + Permissions-Policy. Config lives in ./securityHeaders so
  // production and the unit test share one source of truth (no header drift).
  // CORS wildcard stays on CDN-proxy-download route only — intentional for
  // public media delivery; tRPC/auth routes share same origin so no CORS needed.
  // NOTE: helmet(...) is called inline here (not via applySecurityHeaders) so the
  // brainPipeline MIDDLEWARE_STACK static scan still detects the `helmet(` signal.
  app.use(helmet(helmetOptions));
  app.use(permissionsPolicyMiddleware);

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

  // AIDV-294: Body size limit reduced from 50 MB to 4 MB.
  // Uploads bypass express.json (presigned S3 / multipart), so 4 MB comfortably
  // covers the largest legitimate tRPC payload (director.saveSession 2 MB sessionData
  // + JSON overhead) while blocking bulk-data DoS attacks.
  // The `verify` callback exposes the original byte buffer on `req.rawBody`
  // so webhook handlers (fal / suno / replicate / stripe) can compute HMAC /
  // Ed25519 signatures over the exact bytes the upstream service signed.
  app.use(
    "/api/upload",
    express.json({
      limit: "4mb",
      verify: (req, _res, buf) => {
        if (buf && buf.length) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    })
  );
  app.use(express.urlencoded({ limit: "4mb", extended: true }));

  // AIDV-558: Global CSRF origin guard for non-tRPC, non-webhook state-changing Express routes.
  // Complements the tRPC x-trpc-source check (line ~845) for auth routes like /api/oauth/logout.
  // Skipped in dev/test and when CSRF_PROTECTION=0 kill-switch is set.
  const CSRF_BYPASS_PREFIXES = ["/api/trpc", "/api/webhook/"];
  const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (
      process.env.CSRF_PROTECTION === "0" ||
      process.env.NODE_ENV === "test" ||
      CSRF_SAFE_METHODS.has(req.method) ||
      CSRF_BYPASS_PREFIXES.some((p) => req.path.startsWith(p))
    ) {
      return next();
    }
    const siteUrl = process.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
    if (!siteUrl || siteUrl.includes("localhost") || siteUrl.includes("127.0.0.1")) {
      return next();
    }
    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;
    let requestOrigin: string | undefined;
    if (origin) {
      requestOrigin = origin.replace(/\/$/, "");
    } else if (referer) {
      try { requestOrigin = new URL(referer).origin; } catch { /* malformed referer — block */ }
    }
    if (!requestOrigin) {
      res.status(403).json({ error: "CSRF 防護：缺少 Origin header" });
      return;
    }
    if (requestOrigin !== siteUrl) {
      res.status(403).json({ error: "CSRF 防護：不允許的 Origin" });
      return;
    }
    return next();
  });

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
  // SSE for multi-agent collaboration state broadcast (AIDV-331)
  app.use(agentEventsRouter);
  // AIDV-716: unified /api/sse endpoint (gated — set UNIFIED_SSE_ROUTER=1 to enable)
  if (process.env.UNIFIED_SSE_ROUTER === "1") {
    app.use(unifiedSseRouter);
  }
  // Agent status dashboard + SSE heartbeat + Prometheus metrics (AIDV-334/336)
  app.use(agentStatusRouter);
  // Multi-agent handoff trace (AIDV-318)
  app.use(handoffTraceRouter);
  // Programmatic REST API v1 (AIDV-276)
  app.use(v1Router);
  // AIDV-770: rawBody capture for /api/webhook/* signature verification (fal/suno/replicate).
  // Must be scoped to /api/webhook (NOT /api/webhooks) and mounted BEFORE the webhook routers.
  app.use(
    "/api/webhook",
    express.json({
      limit: "4mb",
      verify: (req, _res, buf) => {
        if (buf && buf.length) {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        }
      },
    })
  );
  // (LangSmith stats moved to tRPC: trpc.langsmith.stats)
  app.use(falWebhookRouter);
  app.use(sunoWebhookRouter);
  app.use(replicateWebhookRouter);
  app.use(stripeWebhookRouter);
  app.use(mediaDownloadRouter);
  app.use(videoOutputRouter);
  app.use(videoRouter);
  app.use(icsFeedRouter);
  // AI Provider Proxy Gateway
  app.use(aiProxyRouter);
  app.use(localAuthRouter);
  app.use(passwordResetRouter);
  app.use(orbTasksRouter);
  app.use(adminEventsRouter);
  app.use(toolsModelsRouter);

  // AIDV-518: Provider key health status endpoint。
  // AIDV-614：原本此 inline 路由零 auth，匿名即可取得 AI 供應商拓撲＋即時健康/連續失敗/延遲
  //（與孿生的 /api/metrics、/api/health/detail 的 requireAdmin 門不一致）。已搬進 metricsRouter
  // 並沿用同一道 fail-closed admin 守門（見 _core/metricsRoute.ts），對外不再洩漏供應商明細。

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

  // AIDV-311: CORS allowlist for the proxy-download endpoint.
  // Builds allowed origins from BASE_URL (e.g. https://director.today) plus localhost
  // in development. Returns the reflected origin if matched, null otherwise — never
  // uses wildcard because the endpoint requires auth and Cache-Control: private.
  function getProxyDownloadCorsOrigin(reqOrigin: string | undefined): string | null {
    if (!reqOrigin) return null;
    const allowed: string[] = [];
    const base = (serverEnv.BASE_URL || "").replace(/\/$/, "");
    if (base) {
      allowed.push(base);
      // Also allow www. variant if base is apex (e.g. https://director.today → https://www.director.today)
      try {
        const u = new URL(base);
        if (!u.hostname.startsWith("www.")) {
          allowed.push(`${u.protocol}//www.${u.hostname}${u.port ? `:${u.port}` : ""}`);
        }
      } catch {
        // ignore malformed BASE_URL
      }
    }
    if (serverEnv.NODE_ENV !== "production") {
      allowed.push("http://localhost:3000", "http://localhost:5173");
    }
    return allowed.includes(reqOrigin) ? reqOrigin : null;
  }

  // AIDV-265: Max bytes the proxy-download stream will forward.
  // Prevents a malicious/massive upstream response from exhausting server RAM.
  const PROXY_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

  // ── 後端代理下載（解決前端直接 fetch CDN 時的 CORS 問題）──────────────────
  // GET /api/proxy-download?url=<encodedUrl>
  // AIDV-265: requires auth + dedicated rate limit + 100 MB byte cap.
  app.get("/api/proxy-download", authenticateRequest, rateLimiters.proxyDownload, async (req, res) => {
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
      // private: endpoint now requires auth — no shared cache should store this.
      res.setHeader("Cache-Control", "private, max-age=86400");
      // AIDV-311: reflect specific origin from allowlist; never use wildcard on an
      // auth-gated endpoint (browsers block credentials + '*' anyway, and it signals
      // unauthenticated cross-origin reads are intended when they are not).
      const corsOrigin = getProxyDownloadCorsOrigin(req.headers.origin);
      if (corsOrigin) res.setHeader("Access-Control-Allow-Origin", corsOrigin);
      if (contentLength) res.setHeader("Content-Length", contentLength);
      // Stream the response body instead of buffering into memory.
      // AIDV-265: track bytes forwarded; abort and close once the cap is hit.
      if (upstream.body) {
        const reader = upstream.body.getReader();
        let bytesForwarded = 0;
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            bytesForwarded += value.byteLength;
            if (bytesForwarded > PROXY_DOWNLOAD_MAX_BYTES) {
              reader.cancel().catch(() => {});
              if (!res.headersSent)
                res.status(413).json({ error: "Response too large" });
              else res.end();
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
        if (buffer.byteLength > PROXY_DOWNLOAD_MAX_BYTES) {
          res.status(413).json({ error: "Response too large" });
          return;
        }
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
  // AIDV-58（維運鏡審查）：此端點無 auth、對整個網際網路可見。
  // 不外洩 DB 錯誤字串（可能含 host/port/driver 細節）、poolStats、具體 storage 類型。
  // 詳細 dbHealth 在 admin-only 的 /api/health/detail（與 /api/metrics 同源守門）。
  //
  // AIDV-261：升級為雙重探測（DB + JWT auth），DB 停機時回 HTTP 503。
  // UptimeRobot 已設定偵測 503；Railway 的容器存活判定可接受 503 或依 body.ok。
  app.get("/api/health", async (_req, res) => {
    // AIDV-259: Cache-Control: no-store prevents CDN/proxy caching a stale 200
    // during a DB outage that would mask 503 from uptime monitors.
    res.setHeader("Cache-Control", "no-store, no-cache");

    // storage:boolean — 「是否已設定後端」而非具體類型。
    const storageConfigured = detectStorageBackend() !== "none";

    // Demo mode（無 DATABASE_URL）：跳過 DB 探測，直接回 200 OK。
    // demo 無 migrations，故不受 bootReady 門限制。
    if (!process.env.DATABASE_URL) {
      return res.json({ ok: true, status: "ok", ts: Date.now(), storage: storageConfigured });
    }

    // Boot gate：deferred init（migrations · LearnHub · OrbScheduler）完成前回 503，
    // 讓 Railway 在 DB 尚未 migrate 完成前不要把真實流量導進來。server 此時已在
    // listen，故這是「快速 503」而非掛起——healthcheck 會持續重試到 init 完成
    // （耗時受 DB 工作量限制，不再受無上限的 pre-listen await 拖住）。
    if (!bootReady) {
      return res.status(503).json({
        ok: false,
        status: "booting",
        ts: Date.now(),
        storage: storageConfigured,
      });
    }

    // 探測 1：DB ping（3 秒超時，避免長時間阻塞 health 回應）
    const dbStart = Date.now();
    const dbOk = await Promise.race([
      checkDrizzleHealth().catch(() => false),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3000)),
    ]);
    const dbLatencyMs = Date.now() - dbStart;

    // 探測 2：Auth 服務可用性（JWT_SECRET 必須存在且有效長度）
    const jwtSecret = process.env.JWT_SECRET ?? "";
    const authOk = jwtSecret.length >= 16;

    const allOk = dbOk && authOk;

    // 不外洩原始錯誤訊息（可能含連線細節），只回狀態布林。
    const body = {
      ok: allOk,
      status: allOk ? "ok" : "down",
      ts: Date.now(),
      storage: storageConfigured,
      checks: {
        db: dbOk
          ? { status: "ok", latencyMs: dbLatencyMs }
          : { status: "down" },
        auth: authOk
          ? { status: "ok" }
          : { status: "down" },
      },
    };

    res.status(allOk ? 200 : 503).json(body);
  });

  // ── Performance metrics endpoint（AIDV-58 H3：admin-only）────────────────
  // 守門邏輯抽到 _core/metricsRoute.ts（沿用 @shared/const 單一 isAdmin、可單元測試）。
  // 未登入 → 401；非 admin → 403（fail-closed）。demo（role=user）→ 403。
  app.use(metricsRouter);
  app.use("/api/webhooks", webhooksRouter);

  // AIDV-572: tRPC JSON body parser. The global express.urlencoded() mounted
  // earlier runs `req.body = req.body || {}` BEFORE its own content-type check
  // (body-parser/lib/types/urlencoded.js), so EVERY request — including
  // application/json — leaves this middleware chain with `req.body` already set
  // to `{}`. tRPC v11's express adapter then sees `"body" in req` is true and
  // uses that empty `{}` verbatim instead of reading the raw request stream, so
  // every mutation receives empty/undefined input and zod rejects it with HTTP
  // 400 ("expected object, received undefined"). /api/trpc had no JSON parser
  // (express.json is only mounted on /api/upload, L536), so this hit ALL tRPC
  // writes on real HTTP. Mounting express.json here — before jsonDepthGuard —
  // restores the real parsed body (so mutations work) AND makes the depth guard
  // below operate on the actual payload instead of an always-empty `{}`. 4 MB
  // matches the /api/upload limit (AIDV-294, largest legitimate tRPC payload).
  app.use("/api/trpc", express.json({ limit: "4mb" }));

  // AIDV-293: JSON nesting-depth guard — rejects payloads with >32 levels of
  // nesting (Billion Laughs / deeply recursive objects → 400). Applied only to
  // tRPC so webhook routes are unaffected.
  app.use("/api/trpc", jsonDepthGuard(32));

  // AIDV-219：tRPC CSRF guard — POST 必須帶 x-trpc-source header。
  // 跨站 form/fetch 不帶自訂 header，瀏覽器會發 CORS preflight；
  // 攻擊者站台沒有跨域允許，mutation 無法通過。
  // 退路：CSRF_PROTECTION=0（env flag）可秒關，production 預設 ON。
  app.use("/api/trpc", (req, _res, next) => {
    if (
      req.method !== "POST" ||
      process.env.CSRF_PROTECTION === "0" ||
      process.env.NODE_ENV === "test"
    ) {
      return next();
    }
    if (!req.headers["x-trpc-source"]) {
      _res.status(403).json({ error: "CSRF 防護：缺少 x-trpc-source header" });
      return;
    }
    return next();
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
  // AIDV-58（H3）：Sentry error 中介層必須排在 globalErrorHandler 之前——
  // 先把錯誤上報（env-gated；無 DSN 時為透傳 no-op），再交給既有 handler 回應 client。
  // 此中介層只 next(err)、不改回應，故不影響既有行為與 aiProxy 路徑。
  app.use(errorTrackingExpressErrorHandler());
  app.use(globalErrorHandler);

  // Always use Railway's injected $PORT when set. Only scan for an available
  // port in genuine local dev where PORT is absent. Never gate on NODE_ENV —
  // a dashboard variable override or missing value must not change port binding.
  const port = process.env.PORT
    ? parseInt(process.env.PORT)
    : await findAvailablePort(3000);

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

    // Port is bound and /api/health is already answering (503 "booting"). Now
    // kick off the heavy DB init in the background; it flips bootReady → true
    // (and starts maintenance jobs) when done, at which point health returns
    // 200 and Railway routes traffic. Never awaited here so a slow/hung step
    // can never block the listening socket.
    void runDeferredBootInit().catch(err => {
      logger.error("[Server] Deferred boot init crashed unexpectedly", { err });
    });
  });

  // Use noServer mode + manual upgrade dispatch so Vite HMR (which opens its
  // own WebSocket on "/") and any future WS endpoints can coexist. With
  // `{ server, path }`, the ws library aborts every non-matching upgrade,
  // which silently breaks Vite HMR and leaves the dev home page in a reload
  // loop where modules never finish loading.
  const orbVoiceWss = new WebSocketServer({ noServer: true, maxPayload: ORB_MAX_PAYLOAD_BYTES });
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
      // AIDV-923: stop the creator-quota Redis backend (no-op when REDIS_URL is unset).
      await closeCreatorQuotaBackend();
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

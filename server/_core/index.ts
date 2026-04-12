import "dotenv/config";
import express from "express";
import { createServer } from "http";
import fs from "fs";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { uploadRouter } from "../uploadRoute";
import { sseRouter } from "../sseRoute";
import { initNewsFetcherCron } from "../jobs/newsFetcher";
import { initModelTrainingWorkerCron } from "../jobs/modelTrainingWorker";

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

  // Simple health check endpoint (for Railway/Docker healthcheck — no tRPC overhead)
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, ts: Date.now() });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Use static files if dist/public/index.html exists (production build), otherwise Vite (dev)
  const distPublic = path.resolve(process.cwd(), "dist", "public");
  const isBuilt = fs.existsSync(path.join(distPublic, "index.html"));
  console.log(`[Server] NODE_ENV=${process.env.NODE_ENV} | cwd=${process.cwd()} | dist/public/index.html=${isBuilt}`);

  if (isBuilt) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  // Always use the PORT env var directly — Railway proxies to exactly this port
  const port = parseInt(process.env.PORT || "3000", 10);

  server.listen(port, "0.0.0.0", () => {
    console.log(`[Server] Listening on http://0.0.0.0:${port}/`);
    console.log(`[Server] NODE_ENV=${process.env.NODE_ENV}`);

    // Initialize scheduled jobs after server is ready
    initNewsFetcherCron();
    initModelTrainingWorkerCron();
  });

  server.on("error", (err) => {
    console.error(`[Server] Failed to start on port ${port}:`, err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});

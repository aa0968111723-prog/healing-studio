import { Router, type Request, type Response } from "express";

/**
 * AIDV-952：build-version 自我檢查端點。
 *
 * 公開、唯讀、零認證的 `GET /api/version`，回報目前運行版本的 git commit SHA
 * 與 Railway deployment id，讓 qa-explore / sec-patrol 能直接以
 *   curl -s https://director.today/api/version | jq .commit
 * 比對 `main` HEAD，確認 prod 是否已部署到最新 commit——取代過去從靜態資產
 * `Last-Modified` header 間接推斷部署新舊的脆弱訊號（AIDV-949 / AIDV-951）。
 *
 * 為何刻意保持「公開」（與 AIDV-58/518/614 把 infra 端點鎖成 admin-only 的慣例不同）：
 * 本 repo 的 `main` HEAD commit SHA 對任何拿得到 repo URL 的人都已是公開資訊
 * （GitHub API/UI 皆可見），此端點不洩漏任何新東西；而本票券的核心目的正是要能
 * 「未認證 curl」供 CI/QA 自我檢查，加上守門反而會讓端點失去意義。
 * `RAILWAY_DEPLOYMENT_ID` 為 Railway 內部非敏感識別碼（非 token/憑證），僅作為
 * 區分「同一 commit 的重新部署」的佐證資訊。
 */
export const versionRouter = Router();

versionRouter.get("/api/version", (_req: Request, res: Response) => {
  // Railway 於部署時自動注入 RAILWAY_GIT_COMMIT_SHA（參見 _core/errorTracking.ts
  // 同名使用）；本地 / 非 Railway 環境（含單元測試）一律回報 "dev"，永不拋錯。
  // 每次請求即時讀取 process.env：成本可忽略，且便於測試覆蓋有/無 SHA 兩個分支。
  const commit = (process.env.RAILWAY_GIT_COMMIT_SHA || "").trim() || "dev";
  const deploymentId = process.env.RAILWAY_DEPLOYMENT_ID || null;

  // AIDV-259 同源理由：no-store 防止 CDN/proxy 快取舊版 SHA，否則正是本票券
  // 要解決的「看到的不是真的當前部署」失敗模式。
  res.setHeader("Cache-Control", "no-store, no-cache");
  res.json({
    ok: true,
    commit,
    shortCommit: commit === "dev" ? "dev" : commit.slice(0, 7),
    deploymentId,
    ts: Date.now(),
  });
});

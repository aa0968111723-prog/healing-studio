/**
 * metricsRoute.ts — AIDV-58（H3 監控鎖門）：/api/metrics 的 admin-only 守門。
 *
 * 原本此端點為 inline 路由且零 auth → 對外洩漏延遲 / 錯誤率 / feature flags。
 * 抽成獨立 router 以便：
 *  1. 守門邏輯可被單元測試直接覆蓋（不需 boot 整個 server）；
 *  2. 沿用 @shared/const 的單一 isAdmin 判定（與 tRPC adminProcedure 同源），不再手寫 role 比較。
 *
 * 守門順序（fail-closed）：
 *  - authenticateRequest 從 same-origin cookie 取 user；過程 throw（DB 短暫錯誤）→ 視為未登入。
 *  - 未登入 → 401；已登入但非 admin → 403（leader 不算 admin，監控洩漏只給 admin）。
 *  - demo 模式 DEMO_USER.role="user" → 403，等於在無 DB 部署關閉此洩漏。
 *
 * 註：若要給外部監控（UptimeRobot）抓取，請用公開的 /api/health；不要放寬此端點 auth。
 *     真要對外，改採 token/IP allowlist，由 Bruce 拍板。
 */

import { Router, type Request, type Response } from "express";
import { isAdmin } from "@shared/const";
import { authenticateRequest } from "./googleAuth";
import { getDatabaseManager } from "./DatabaseManager";
import { metrics } from "./metrics";
import { cache } from "./cache";
import { featureFlags } from "./featureFlags";

export const metricsRouter = Router();

metricsRouter.get("/api/metrics", async (req: Request, res: Response) => {
  let user: Awaited<ReturnType<typeof authenticateRequest>> = null;
  try {
    user = await authenticateRequest(req);
  } catch {
    // 認證 / 查 user 期間的短暫錯誤 → fail-closed，不開放。
  }
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isAdmin(user.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Refresh database metrics in the collector before responding.
  try {
    const manager = getDatabaseManager();
    metrics.setDatabaseMetrics({
      connections: manager.getPoolStats(),
      health: manager.getConnectionHealth(),
      performance: manager.getPerformanceStats(),
    });
  } catch {
    // DatabaseManager may not be initialised (no DATABASE_URL).
  }

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

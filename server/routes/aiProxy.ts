/**
 * aiProxy.ts — AI Provider Proxy Gateway
 * ──────────────────────────────────────────────────────────────────────────
 * Intercepts all AI API calls via /api/ai/:provider/*, injects secrets,
 * forwards to the corresponding provider, and logs usage events.
 *
 * Keys are read from environment variables (serverEnv), never hardcoded.
 */

import { Router, type Request, type Response } from "express";
import { serverEnv } from "../_core/env.validated";
import { getDb } from "../db";
import { aiUsageEvents, rateLimitRules } from "../../drizzle/schema";
import { eq, and, gte, sql, or, isNull } from "drizzle-orm";
import { traceToolRun } from "../services/langsmithTracer";
import { verifyToken } from "../middleware/verifyToken";
import { rateLimiters } from "../_core/rateLimiter";
import { getAdapter } from "../services/ai-adapters/registry";
import { bootstrapAiAdapters } from "../services/ai-adapters/bootstrap";
import { extractUsageCostUsd } from "../services/usageCost";
import {
  resolveProviderBaseUrl,
  type FacadeProvider,
} from "../_core/providerFacade";

// ─── Provider Config ─────────────────────────────────────────────────────────
// base URL 一律由 _core/providerFacade 解析（統一門面；CF AI Gateway 啟用時
// 自動換軌），這裡只保留金鑰與導引資訊。

type ProviderKey = Extract<
  FacadeProvider,
  "fal_ai" | "gemini" | "elevenlabs" | "suno"
>;

interface ProviderConfig {
  keyEnvVar: keyof typeof serverEnv;
  headerName: string;
  headerPrefix: string;
  applyGuideUrl: string;
}

const PROVIDER_CONFIG: Record<ProviderKey, ProviderConfig> = {
  fal_ai: {
    keyEnvVar: "FAL_API_KEY",
    headerName: "Authorization",
    headerPrefix: "Key ",
    applyGuideUrl: "https://fal.ai/dashboard/keys",
  },
  gemini: {
    keyEnvVar: "GEMINI_API_KEY",
    headerName: "x-goog-api-key",
    headerPrefix: "",
    applyGuideUrl: "https://aistudio.google.com/apikey",
  },
  elevenlabs: {
    keyEnvVar: "ELEVENLABS_API_KEY",
    headerName: "xi-api-key",
    headerPrefix: "",
    applyGuideUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  suno: {
    keyEnvVar: "SUNO_API_KEY",
    headerName: "Authorization",
    headerPrefix: "Bearer ",
    applyGuideUrl: "https://suno.com/",
  },
};

const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_CONFIG));

// ─── PostHog Dual-Write ──────────────────────────────────────────────────────

async function postHogCapture(event: Record<string, unknown>): Promise<void> {
  const apiKey = serverEnv.POSTHOG_API_KEY;
  const host = serverEnv.POSTHOG_HOST;
  if (!apiKey) return;

  try {
    await fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        event: "ai_api_call",
        distinct_id: String(event.userId || "system"),
        properties: event,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn("[AI Proxy] PostHog capture failed:", err);
  }
}

// ─── Rate Limit Check ────────────────────────────────────────────────────────

/**
 * DB 規則限流檢查（rate_limit_rules 表）。
 *
 * H5（AIDV-60）改為 fail-closed：查不到 DB 或查詢爆炸時一律「擋」，
 * 不再「出錯就放行」。付費上游的保險絲斷了就該斷電，而不是直通。
 * `degraded: true` 表示是檢查機制本身故障（回 503），與真的超限（429）區分。
 */
async function checkRateLimit(
  provider: ProviderKey,
  userId?: number
): Promise<{ allowed: boolean; reason?: string; degraded?: boolean }> {
  try {
    const db = await getDb();
    if (!db) {
      return {
        allowed: false,
        reason: "Rate limit check unavailable (no database)",
        degraded: true,
      };
    }

    const rules = await db
      .select()
      .from(rateLimitRules)
      .where(
        and(
          eq(rateLimitRules.isActive, true),
          or(
            eq(rateLimitRules.provider, provider),
            eq(rateLimitRules.provider, "all"),
            isNull(rateLimitRules.provider)
          )
        )
      );

    if (rules.length === 0) return { allowed: true };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const rule of rules) {
      if (rule.ruleType === "per_user" && userId) {
        if (rule.targetId && String(userId) !== rule.targetId) continue;

        if (rule.dailyCallLimit) {
          const [result] = await db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(aiUsageEvents)
            .where(
              and(
                eq(aiUsageEvents.userId, userId),
                gte(aiUsageEvents.createdAt, today)
              )
            );

          if (Number(result?.cnt ?? 0) >= rule.dailyCallLimit) {
            return {
              allowed: false,
              reason: `Daily call limit exceeded (${rule.dailyCallLimit} calls/day)`,
            };
          }
        }

        if (rule.dailyCostLimitUsd) {
          const [result] = await db
            .select({ total: sql<number>`COALESCE(SUM(${aiUsageEvents.costUsd}), 0)` })
            .from(aiUsageEvents)
            .where(
              and(
                eq(aiUsageEvents.userId, userId),
                gte(aiUsageEvents.createdAt, today)
              )
            );

          if (Number(result?.total ?? 0) >= Number(rule.dailyCostLimitUsd)) {
            return {
              allowed: false,
              reason: `Daily cost limit exceeded ($${rule.dailyCostLimitUsd}/day)`,
            };
          }
        }
      }

      if (rule.ruleType === "global") {
        if (rule.dailyCallLimit) {
          const [result] = await db
            .select({ cnt: sql<number>`COUNT(*)` })
            .from(aiUsageEvents)
            .where(gte(aiUsageEvents.createdAt, today));

          if (Number(result?.cnt ?? 0) >= rule.dailyCallLimit) {
            return {
              allowed: false,
              reason: `Global daily call limit exceeded (${rule.dailyCallLimit} calls/day)`,
            };
          }
        }
      }
    }

    return { allowed: true };
  } catch (err) {
    console.warn("[AI Proxy] Rate limit check failed, blocking request (fail-closed):", err);
    return {
      allowed: false,
      reason: "Rate limit check failed",
      degraded: true,
    };
  }
}

// ─── Express Router ──────────────────────────────────────────────────────────

export const aiProxyRouter = Router();
bootstrapAiAdapters();
// H5（AIDV-60）鎖門：
//   1. verifyToken（嚴格版）— 未登入一律 401。前端零直接呼叫 /api/ai（全走
//      tRPC），所以這不破壞任何現有流程；之前的 optionalVerifyToken 等於把
//      付費上游敞開給任何人。
//   2. rateLimiters.llm／llmPerUser — 已寫好但從未掛載的兩個限流器。順序
//      必須在 verifyToken 之後，限流 key 才能拿到 req.user 做 per-user 計數
//      （否則全部退化成 per-IP）。
aiProxyRouter.use(
  "/api/ai",
  verifyToken,
  rateLimiters.llm,
  rateLimiters.llmPerUser
);

aiProxyRouter.all("/api/ai/:provider/*", async (req: Request, res: Response) => {
  const provider = req.params.provider as string;

  // Validate provider
  if (!VALID_PROVIDERS.has(provider)) {
    res.status(400).json({
      error: `Invalid provider: ${provider}. Valid: ${Array.from(VALID_PROVIDERS).join(", ")}`,
    });
    return;
  }

  const providerKey = provider as ProviderKey;
  const config = PROVIDER_CONFIG[providerKey];
  const baseUrl = resolveProviderBaseUrl(providerKey);
  const apiKey = serverEnv[config.keyEnvVar];

  if (!apiKey || (typeof apiKey === "string" && apiKey.trim().length === 0)) {
    res.status(503).json({
      error: `Provider ${provider} is not configured. Missing ${config.keyEnvVar}.`,
      missingEnvVar: config.keyEnvVar,
      applyGuideUrl: config.applyGuideUrl,
      action:
        "請先在服務商後台申請 API Key，設定到 .env / Railway Variables，並重啟伺服器。",
    });
    return;
  }

  // Extract userId from request context (if authenticated)
  const userId = (req as unknown as { user?: { id?: number } }).user?.id;

  // Rate limit check（fail-closed：degraded＝檢查機制故障回 503，超限回 429）
  const rateCheck = await checkRateLimit(providerKey, userId);
  if (!rateCheck.allowed) {
    try {
      const db = await getDb();
      if (db) {
        await db.insert(aiUsageEvents).values({
          provider: providerKey,
          endpoint: req.params[0] || "/",
          userId: userId ?? null,
          status: "rate_limited",
          latencyMs: 0,
          costUsd: "0",
        });
      }
    } catch { /* best effort */ }

    if (rateCheck.degraded) {
      res.status(503).json({
        error: "Rate limit check unavailable",
        detail: rateCheck.reason,
      });
    } else {
      res.status(429).json({
        error: "Rate limit exceeded",
        detail: rateCheck.reason,
      });
    }
    return;
  }

  // Build upstream URL — sanitize path to prevent SSRF
  const pathSuffix = (req.params[0] || "").replace(/\.\./g, "").replace(/[^a-zA-Z0-9\-_\/.:@=&?%+,]/g, "");
  const queryStr = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${baseUrl}/${pathSuffix}${queryStr}`;

  // Validate the resolved URL stays within the expected base URL
  // （base 由門面解析：直連或 CF Gateway，host 驗證跟著同一來源走）
  try {
    const resolved = new URL(upstreamUrl);
    const expected = new URL(baseUrl);
    if (resolved.hostname !== expected.hostname) {
      res.status(400).json({ error: "Invalid upstream URL: hostname mismatch" });
      return;
    }
  } catch {
    res.status(400).json({ error: "Invalid URL construction" });
    return;
  }

  // Build headers (strip hop-by-hop, inject API key)
  const forwardHeaders: Record<string, string> = {};
  const skipHeaders = new Set([
    "host", "connection", "keep-alive", "transfer-encoding",
    "te", "trailer", "upgrade", "proxy-authorization",
    "proxy-authenticate", "authorization", "content-length",
  ]);

  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.has(key.toLowerCase()) && typeof value === "string") {
      forwardHeaders[key] = value;
    }
  }

  forwardHeaders[config.headerName] = `${config.headerPrefix}${apiKey}`;

  const startMs = Date.now();
  let status: "success" | "failed" | "timeout" = "success";
  let errorMessage: string | undefined;
  let upstreamStatus = 200;
  // AIDV-14：真實 USD 成本（DECIMAL(12,6) 字串）。預設 "0"，僅在成功且回應
  // body 帶有 OpenRouter 風格 usage.cost 時被覆寫。所有計算都在 res.send
  // 之後（請求熱路徑之外），且擷取函式 pure / 永不 throw。
  let costUsd = "0";

  const requestBody: BodyInit | undefined =
    req.method === "GET" || req.method === "HEAD"
      ? undefined
      : typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? new Uint8Array(req.body)
        : Object.keys(req.body ?? {}).length > 0
          ? JSON.stringify(req.body)
          : undefined;

  const requestBodyByteLength =
    typeof requestBody === "string"
      ? Buffer.byteLength(requestBody)
      : requestBody instanceof Uint8Array
        ? requestBody.byteLength
        : 0;

  // ── Transient-error retry：5xx / timeout / 網路錯誤短重試一次 ───────────
  // 為了不打擾上游的計費（避免重複計費），4xx 一律不重試（caller error）。
  // 只重試一次：兩次嘗試之間相隔 400 ms，多一次仍失敗就告知 client 這是真的故障。
  // 對 GET/HEAD/idempotent 路徑或 user 主動取消的 POST，retry 都安全；對非
  // idempotent POST（例如 fal-queue submit 帶有 webhook 的 idempotencyKey）
  // 上游 SDK 自身會去重，所以這裡的 retry 仍然安全。
  const MAX_PROXY_RETRIES = 2;
  const PROXY_RETRY_DELAY_MS = 400;

  // Use globalThis.Response (Web Fetch) — `Response` here is express.Response
  let upstreamRes: globalThis.Response | null = null;
  let attempt = 0;
  while (attempt < MAX_PROXY_RETRIES) {
    attempt++;
    try {
      const adapter = getAdapter(providerKey);
      upstreamRes = await adapter.proxy({
        pathWithQuery: `${pathSuffix}${queryStr}`,
        method: req.method,
        headers: forwardHeaders,
        body: requestBody,
        timeoutMs: 120_000,
      });
      upstreamStatus = upstreamRes.status;

      // 5xx 或 429 → 重試（最多 MAX_PROXY_RETRIES 次）
      if (
        attempt < MAX_PROXY_RETRIES &&
        (upstreamRes.status >= 500 || upstreamRes.status === 429)
      ) {
        // 釋放 body 避免連線被卡住
        try {
          await upstreamRes.arrayBuffer();
        } catch {
          /* best effort */
        }
        await new Promise(r => setTimeout(r, PROXY_RETRY_DELAY_MS * attempt));
        continue;
      }
      break;
    } catch (err: unknown) {
      const isAbortError = err instanceof Error && err.name === "AbortError";
      const isNetworkError =
        err instanceof Error &&
        (err.message.includes("fetch failed") ||
          err.message.includes("ECONNRESET") ||
          err.message.includes("ETIMEDOUT") ||
          err.message.includes("ENOTFOUND"));

      if (
        attempt < MAX_PROXY_RETRIES &&
        (isAbortError || isNetworkError)
      ) {
        await new Promise(r => setTimeout(r, PROXY_RETRY_DELAY_MS * attempt));
        continue;
      }

      // 重試額度耗盡 → 結束 / 回報錯誤
      if (isAbortError) {
        status = "timeout";
        errorMessage = "Request timed out (120s)";
        if (!res.headersSent) res.status(504).json({ error: "Gateway timeout" });
      } else {
        status = "failed";
        errorMessage = err instanceof Error ? err.message : String(err);
        if (!res.headersSent) res.status(502).json({ error: "Bad gateway" });
      }
      upstreamRes = null;
      break;
    }
  }

  if (upstreamRes) {
    if (!upstreamRes.ok) {
      status = "failed";
      errorMessage = `Upstream returned ${upstreamRes.status}`;
    }

    // Forward safe response headers
    for (const h of ["content-type", "x-request-id", "x-ratelimit-remaining"]) {
      const val = upstreamRes.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    res.status(upstreamRes.status);

    const buffer = await upstreamRes.arrayBuffer();
    const payload = Buffer.from(buffer);
    res.send(payload);

    // ── AIDV-14：res.send 之後再算成本 ────────────────────────────────────
    // 此處在回應已 flush 給 client 之後執行，不在請求熱路徑上、不新增任何
    // res.send 之前的 await，且 extractUsageCostUsd 為 pure 同步函式、永不
    // throw。只有成功回應才嘗試擷取；失敗/錯誤 body 自然回 "0"。
    if (status === "success") {
      costUsd = extractUsageCostUsd(
        payload,
        upstreamRes.headers.get("content-type"),
      );
    }
  }

  const latencyMs = Date.now() - startMs;

  // Async: log usage event + PostHog (non-blocking)
  const endpoint = req.params[0] || "/";
  const bodyObj =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};
  const inferredModel =
    (typeof req.query.model === "string" && req.query.model) ||
    (typeof bodyObj.model === "string" && bodyObj.model) ||
    (typeof bodyObj.model_id === "string" && bodyObj.model_id) ||
    endpoint.split("/").find(p => p.includes("fal-ai/")) ||
    "";
  setImmediate(async () => {
    try {
      const db = await getDb();
      if (db) {
        await db.insert(aiUsageEvents).values({
          provider: providerKey,
          endpoint,
          userId: userId ?? null,
          status,
          latencyMs,
          costUsd,
          errorMessage,
        });
      }
    } catch (err) {
      console.warn("[AI Proxy] Failed to log usage event:", err);
    }

    postHogCapture({
      provider: providerKey,
      endpoint,
      userId,
      status,
      latencyMs,
      upstreamStatus,
    });

    void traceToolRun({
      runName: `api-proxy/${providerKey}`,
      provider: providerKey,
      model: String(inferredModel),
      route: `/api/ai/${providerKey}/${endpoint}`,
      method: req.method,
      userId: userId ?? null,
      inputs: {
        endpoint,
        query: req.query as Record<string, unknown>,
        body_keys: Object.keys(bodyObj),
        request_bytes: requestBodyByteLength,
      },
      outputs: {
        status,
        upstream_status: upstreamStatus,
        response_sent: res.headersSent,
      },
      error: errorMessage,
      durationMs: latencyMs,
    });
  });
});

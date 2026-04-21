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

// ─── Provider Config ─────────────────────────────────────────────────────────

type ProviderKey = "fal_ai" | "gemini" | "elevenlabs" | "suno";

interface ProviderConfig {
  baseUrl: string;
  keyEnvVar: keyof typeof serverEnv;
  headerName: string;
  headerPrefix: string;
  applyGuideUrl: string;
}

const PROVIDER_CONFIG: Record<ProviderKey, ProviderConfig> = {
  fal_ai: {
    baseUrl: "https://fal.run",
    keyEnvVar: "FAL_API_KEY",
    headerName: "Authorization",
    headerPrefix: "Key ",
    applyGuideUrl: "https://fal.ai/dashboard/keys",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com",
    keyEnvVar: "GEMINI_API_KEY",
    headerName: "x-goog-api-key",
    headerPrefix: "",
    applyGuideUrl: "https://aistudio.google.com/apikey",
  },
  elevenlabs: {
    baseUrl: "https://api.elevenlabs.io",
    keyEnvVar: "ELEVENLABS_API_KEY",
    headerName: "xi-api-key",
    headerPrefix: "",
    applyGuideUrl: "https://elevenlabs.io/app/settings/api-keys",
  },
  suno: {
    baseUrl: "https://api.sunoapi.org",
    keyEnvVar: "SUNO_API_KEY",
    headerName: "Authorization",
    headerPrefix: "Bearer ",
    applyGuideUrl: "https://suno.com/",
  },
};

const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_CONFIG));

// ─── PostHog Dual-Write ──────────────────────────────────────────────────────

async function postHogCapture(event: Record<string, unknown>): Promise<void> {
  // POSTHOG_API_KEY / POSTHOG_HOST are optional and not in serverEnv validated schema
  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
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

async function checkRateLimit(
  provider: ProviderKey,
  userId?: number
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const db = await getDb();
    if (!db) return { allowed: true };

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
    console.warn("[AI Proxy] Rate limit check failed, allowing request:", err);
    return { allowed: true };
  }
}

// ─── Express Router ──────────────────────────────────────────────────────────

export const aiProxyRouter = Router();

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

  // Rate limit check
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

    res.status(429).json({
      error: "Rate limit exceeded",
      detail: rateCheck.reason,
    });
    return;
  }

  // Build upstream URL — sanitize path to prevent SSRF
  const pathSuffix = (req.params[0] || "").replace(/\.\./g, "").replace(/[^a-zA-Z0-9\-_\/.:@=&?%+,]/g, "");
  const queryStr = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const upstreamUrl = `${config.baseUrl}/${pathSuffix}${queryStr}`;

  // Validate the resolved URL stays within the expected base URL
  try {
    const resolved = new URL(upstreamUrl);
    const expected = new URL(config.baseUrl);
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: requestBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    upstreamStatus = upstreamRes.status;

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
    res.send(Buffer.from(buffer));
  } catch (err: unknown) {
    const isAbortError = err instanceof Error && err.name === "AbortError";
    if (isAbortError) {
      status = "timeout";
      errorMessage = "Request timed out (120s)";
      if (!res.headersSent) res.status(504).json({ error: "Gateway timeout" });
    } else {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) res.status(502).json({ error: "Bad gateway" });
    }
  }

  const latencyMs = Date.now() - startMs;

  // Async: log usage event + PostHog (non-blocking)
  const endpoint = req.params[0] || "/";
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
          costUsd: "0",
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
  });
});

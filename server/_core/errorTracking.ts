/**
 * errorTracking.ts — AIDV-58（H3 監控鎖門）錯誤追蹤接線（Sentry，env-gated）
 *
 * 設計原則（對齊安全鐵則）：
 *  1. 金鑰只走環境變數：DSN 從 serverEnv.SENTRY_DSN 讀取，絕不寫進 repo。
 *  2. 未設 DSN = 完全 no-op：不初始化、不報錯、不阻塞任何請求。
 *  3. @sentry/node 為「選用相依」：若該套件未安裝（Railway 未加），動態 import 失敗
 *     會被 catch 並降級為 no-op——絕不讓「監控套件缺席」拖垮開機或請求路徑。
 *  4. 上報不阻塞、不洩漏敏感資料：以 fire-and-forget 方式 captureException；
 *     beforeSend 會剝除 cookie / authorization / x-*-token / set-cookie 等標頭，
 *     並關閉 sendDefaultPii，避免把 session、IP、PII 送到第三方。
 *
 * 對外只暴露三個函式：
 *   - initErrorTracking()                  在 server bootstrap 早期呼叫（idempotent）
 *   - errorTrackingExpressErrorHandler()   回傳一個 express error 中介層（DSN 未設 → no-op passthrough）
 *   - captureError(err, context?)          供任意背景流程主動上報（無 DSN → no-op）
 */

import type { ErrorRequestHandler } from "express";
import { serverEnv } from "./env.validated";
import { logger } from "./logger";

/**
 * Sentry client 的最小型別介面（只描述我們會用到的方法），
 * 避免在未安裝 @sentry/node 時依賴其型別宣告。
 */
interface MinimalSentryClient {
  init: (options: Record<string, unknown>) => void;
  captureException: (err: unknown, hint?: Record<string, unknown>) => string;
  Handlers?: {
    errorHandler: () => ErrorRequestHandler;
  };
}

let sentry: MinimalSentryClient | null = null;
let initialized = false;

/** 需要從上報 payload 中剝除的敏感標頭（小寫比對）。 */
const SENSITIVE_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-orb-webhook-secret",
  "x-uptimerobot-token",
]);

/**
 * 動態載入 @sentry/node。
 * 用「非字面」specifier 讓 TypeScript（moduleResolution: bundler）與打包器
 * 不在編譯期硬解析這個選用相依；若套件不存在，import 會 reject 而被 catch。
 */
async function loadSentry(): Promise<MinimalSentryClient | null> {
  try {
    const moduleName = ["@sentry", "node"].join("/");
    const mod = (await import(/* @vite-ignore */ moduleName)) as unknown as MinimalSentryClient;
    if (mod && typeof mod.init === "function" && typeof mod.captureException === "function") {
      return mod;
    }
    logger.warn("[errorTracking] @sentry/node loaded but missing expected API; skipping");
    return null;
  } catch {
    // 套件未安裝或無法載入 → 安全降級為 no-op。
    logger.warn(
      "[errorTracking] SENTRY_DSN is set but @sentry/node is not installed — error tracking disabled (no-op). Run `npm i @sentry/node` to enable."
    );
    return null;
  }
}

/** 剝除單一 headers 物件中的敏感欄位（回傳淺拷貝，不改原物件）。 */
function scrubHeaders(headers: unknown): unknown {
  if (!headers || typeof headers !== "object") return headers;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    cleaned[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value;
  }
  return cleaned;
}

/**
 * beforeSend：在 event 離開行程前剝除敏感資料。
 * - request.headers / request.cookies 一律清除
 * - 不送 IP（sendDefaultPii:false 已關閉，但此處再防一層）
 */
function beforeSend(event: Record<string, unknown>): Record<string, unknown> {
  const req = event.request as Record<string, unknown> | undefined;
  if (req && typeof req === "object") {
    if ("headers" in req) req.headers = scrubHeaders(req.headers);
    if ("cookies" in req) req.cookies = "[redacted]";
    if ("data" in req) delete req.data; // 請求 body 可能含 token / PII
    // 縱深防禦：即使本 app 只用 cookie 認證（query 不帶 secret），仍剝除 query_string
    // 與 url 上的 query 片段，避免未來新增的帶參路由把 token/PII 帶進第三方。
    if ("query_string" in req) req.query_string = "[redacted]";
    if ("url" in req && typeof req.url === "string") req.url = req.url.split("?")[0];
  }
  if (event.user && typeof event.user === "object") {
    const user = event.user as Record<string, unknown>;
    delete user.ip_address;
    delete user.email;
  }
  return event;
}

/**
 * 在 server bootstrap 早期呼叫（assertJwtSecretReady 之後、路由註冊之前）。
 * - DSN 未設 → 直接回傳，不做任何事（no-op）。
 * - DSN 已設 → 嘗試載入並 init @sentry/node；失敗則降級 no-op。
 * idempotent：重複呼叫只會初始化一次。
 */
export async function initErrorTracking(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const dsn = serverEnv.SENTRY_DSN.trim();
  if (!dsn) {
    // 最常見路徑：未設 DSN，完全靜默 no-op。
    return;
  }

  const client = await loadSentry();
  if (!client) {
    // DSN 有設但套件缺席 → 已在 loadSentry 內 warn，這裡保持 no-op。
    return;
  }

  const tracesSampleRate = (() => {
    const parsed = Number.parseFloat(serverEnv.SENTRY_TRACES_SAMPLE_RATE);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
  })();

  try {
    // release：以 Railway 注入的 commit SHA（或顯式 SENTRY_RELEASE）標記版本，
    // 讓 Sentry 能按部署/版本分流錯誤、做 regression 偵測與 source-map 對應。
    // 為選填 metadata 故直接讀 process.env（非驗證型設定），未設則省略。
    const release =
      (process.env.SENTRY_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || "").trim() || undefined;

    client.init({
      dsn,
      environment: serverEnv.SENTRY_ENVIRONMENT.trim() || serverEnv.NODE_ENV,
      release,
      tracesSampleRate,
      sendDefaultPii: false,
      beforeSend,
    });
    sentry = client;
    logger.info("[errorTracking] Sentry initialized", {
      environment: serverEnv.SENTRY_ENVIRONMENT.trim() || serverEnv.NODE_ENV,
      tracesSampleRate,
    });
  } catch (err) {
    // init 失敗（DSN 格式錯誤等）→ 不讓它阻擋開機。
    sentry = null;
    logger.error("[errorTracking] Sentry init failed — continuing without error tracking", {
      err,
    });
  }
}

/**
 * 主動上報一個錯誤（fire-and-forget，永不 throw、永不阻塞）。
 * 無 DSN / 未初始化 → no-op。
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!sentry) return;
  try {
    sentry.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // 上報本身出錯絕不可影響呼叫端。
  }
}

/**
 * 回傳一個 express error 中介層。
 * - Sentry 已初始化且提供 Handlers.errorHandler → 用官方 handler（會把錯誤丟給 next）。
 * - 否則 → 回傳「透傳」中介層（直接 next(err)），讓既有 globalErrorHandler 接手。
 * 不論哪條路徑，都不會吞掉錯誤、不會改變既有回應行為。
 */
export function errorTrackingExpressErrorHandler(): ErrorRequestHandler {
  if (sentry?.Handlers?.errorHandler) {
    try {
      return sentry.Handlers.errorHandler();
    } catch {
      // 取得 handler 失敗 → 退回透傳。
    }
  }
  // No-op passthrough：保留錯誤鏈給 globalErrorHandler。
  const passthrough: ErrorRequestHandler = (err, _req, _res, next) => {
    // 即使沒有官方 handler，仍主動上報一次（captureError 在無 DSN 時 no-op）。
    captureError(err);
    next(err);
  };
  return passthrough;
}

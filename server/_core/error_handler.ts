import type { ErrorRequestHandler } from "express";
import { getTraceId, logger } from "./logger";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorCode: string;

  constructor(params: {
    message: string;
    statusCode?: number;
    isOperational?: boolean;
    errorCode?: string;
    cause?: unknown;
  }) {
    super(params.message, params.cause ? { cause: params.cause } : undefined);
    this.name = "AppError";
    this.statusCode = params.statusCode ?? 500;
    this.isOperational = params.isOperational ?? true;
    this.errorCode = params.errorCode ?? "APP_ERROR";
    Error.captureStackTrace?.(this, AppError);
  }
}

// ─── Error Rate Tracker ────────────────────────────────────────────────────

interface EndpointErrorStats {
  total: number;
  errors5xx: number;
  lastErrorAt: number | null;
  lastErrorCode: string | null;
}

/**
 * Lightweight in-process error rate tracker keyed by "METHOD /path".
 * Exposed via getErrorRateSnapshot() for the /api/metrics endpoint.
 */
class ErrorRateTracker {
  private readonly stats = new Map<string, EndpointErrorStats>();

  record(endpoint: string, statusCode: number, errorCode?: string): void {
    if (!this.stats.has(endpoint)) {
      this.stats.set(endpoint, {
        total: 0,
        errors5xx: 0,
        lastErrorAt: null,
        lastErrorCode: null,
      });
    }
    const s = this.stats.get(endpoint)!;
    s.total++;
    if (statusCode >= 500) {
      s.errors5xx++;
      s.lastErrorAt = Date.now();
      s.lastErrorCode = errorCode ?? null;
    }
  }

  getSnapshot(): Record<string, EndpointErrorStats & { errorRate5xx: number }> {
    const out: Record<string, EndpointErrorStats & { errorRate5xx: number }> = {};
    for (const [endpoint, s] of Array.from(this.stats.entries())) {
      out[endpoint] = {
        ...s,
        errorRate5xx:
          s.total === 0
            ? 0
            : Math.round((s.errors5xx / s.total) * 10_000) / 100,
      };
    }
    return out;
  }

  clear(): void {
    this.stats.clear();
  }
}

export const errorRateTracker = new ErrorRateTracker();

// ─── Exponential Backoff Retry ─────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 200 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 5000 */
  maxDelayMs?: number;
  /** Predicate to decide whether an error is retryable. Default: always true */
  isRetryable?: (err: unknown, attempt: number) => boolean;
  /** Optional label for log messages */
  label?: string;
}

/**
 * Execute `fn` with exponential backoff retry on failure.
 *
 * Delays follow the formula: min(baseDelayMs * 2^(attempt-1), maxDelayMs)
 * with ±10% jitter to prevent thundering-herd on simultaneous retries.
 *
 * @example
 *   const result = await withRetry(
 *     () => fetchExternalApi(params),
 *     { maxAttempts: 3, label: "fetchExternalApi" }
 *   );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 200,
    maxDelayMs = 5_000,
    isRetryable = () => true,
    label = "withRetry",
  } = opts;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxAttempts;
      if (isLast || !isRetryable(err, attempt)) {
        throw err;
      }

      // Exponential backoff with ±10% jitter
      const base = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const jitter = base * 0.1 * (Math.random() * 2 - 1);
      const delayMs = Math.round(base + jitter);

      logger.warn(`[${label}] Attempt ${attempt} failed, retrying in ${delayMs}ms`, {
        attempt,
        maxAttempts,
        delayMs,
        err: err instanceof Error ? err.message : String(err),
      });

      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Should never reach here, but satisfies TypeScript
  throw lastError;
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError({
      message: error.message,
      statusCode: 500,
      isOperational: false,
      errorCode: "UNEXPECTED_ERROR",
      cause: error,
    });
  }

  return new AppError({
    message: "Unknown error",
    statusCode: 500,
    isOperational: false,
    errorCode: "UNKNOWN_ERROR",
    cause: error,
  });
}

export const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const normalized = normalizeError(err);
  const traceId = getTraceId();
  const endpoint = `${req.method} ${req.path}`;

  // Track error rate by endpoint for the /api/metrics snapshot
  errorRateTracker.record(endpoint, normalized.statusCode, normalized.errorCode);

  if (normalized.statusCode >= 500) {
    // Structured 5xx log — includes request ID, endpoint, and full error context
    // so on-call engineers can correlate logs with the /api/metrics error rates.
    logger.error("[5xx] Server error", {
      traceId,
      endpoint,
      statusCode: normalized.statusCode,
      errorCode: normalized.errorCode,
      isOperational: normalized.isOperational,
      userAgent: req.get("user-agent") ?? "",
      ip: req.ip,
      err,
    });

    if (!normalized.isOperational) {
      logger.error("[5xx] Non-operational error — manual investigation required", {
        traceId,
        endpoint,
        errorCode: normalized.errorCode,
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  } else {
    // 4xx errors are operational — log at warn level without stack traces
    logger.warn("Request error captured", {
      traceId,
      endpoint,
      statusCode: normalized.statusCode,
      errorCode: normalized.errorCode,
    });
  }

  res.status(normalized.statusCode).json({
    success: false,
    traceId,
    error: {
      code: normalized.errorCode,
      message: normalized.isOperational
        ? normalized.message
        : "Internal server error",
    },
  });
};

let fatalHandlersRegistered = false;
let isShuttingDown = false;

export function registerFatalErrorHandlers(
  shutdown: (reason: string) => Promise<void>
): void {
  if (fatalHandlersRegistered) return;
  fatalHandlersRegistered = true;

  const handleFatal = async (reason: string, error: unknown) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    const traceId = getTraceId();
    logger.error("Fatal Error", {
      reason,
      traceId,
      err: error,
    });

    try {
      await shutdown(reason);
    } finally {
      process.exit(1);
    }
  };

  process.on("uncaughtException", error => {
    void handleFatal("uncaughtException", error);
  });

  process.on("unhandledRejection", reason => {
    void handleFatal("unhandledRejection", reason);
  });
}

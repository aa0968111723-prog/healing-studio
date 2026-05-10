import type { ErrorRequestHandler } from "express";
import { getTraceId, logger } from "./logger";
import { metrics } from "./metrics";
import { alerting } from "./alerting";

// ─── AppError ──────────────────────────────────────────────────────────────

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

// ─── Error Classification ──────────────────────────────────────────────────

/**
 * Transient errors are temporary failures that may succeed on retry:
 * network timeouts, upstream 5xx, rate limits (429), connection resets.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof AppError) {
    const { statusCode, errorCode } = err;
    if (statusCode === 429) return true; // rate limited — back off and retry
    if (statusCode >= 500 && statusCode < 600) return true;
    if (errorCode === "AI_UPSTREAM_UNAVAILABLE") return true;
    if (errorCode === "HTTP_REQUEST_FAILED" && statusCode >= 500) return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      err.name === "AbortError" ||
      /timeout|timed out|econnreset|econnrefused|enotfound|network|socket hang up|aborted/i.test(
        msg
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Permanent errors are deterministic failures that will not succeed on retry:
 * bad input (4xx), auth failures, not-found, schema violations.
 */
export function isPermanentError(err: unknown): boolean {
  if (err instanceof AppError) {
    const { statusCode } = err;
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) return true;
  }
  return false;
}

/**
 * Map an error to a severity level for alerting and log routing.
 */
export function getErrorSeverity(
  err: unknown
): "critical" | "error" | "warn" {
  if (err instanceof AppError) {
    if (!err.isOperational) return "critical";
    if (err.statusCode >= 500) return "error";
    if (err.statusCode === 429) return "warn";
    if (err.statusCode >= 400) return "warn";
  }
  if (isTransientError(err)) return "warn";
  return "error";
}

// ─── Error Recovery Utilities ──────────────────────────────────────────────

/**
 * Retry an async function with exponential back-off.
 *
 * @param fn          The async operation to attempt.
 * @param maxAttempts Total number of attempts (including the first).
 * @param baseDelayMs Initial delay in ms; doubles on each retry.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 200
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === maxAttempts;
      if (isLast || !isTransientError(err)) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn("[retryWithBackoff] Transient error — retrying", {
        attempt,
        maxAttempts,
        delayMs,
        err,
      });
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * Execute `primary`; if it throws, execute `fallback` instead.
 * Both the primary error and any fallback error are logged.
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  label = "operation"
): Promise<T> {
  try {
    return await primary();
  } catch (primaryErr) {
    logger.warn(`[withFallback] Primary failed for "${label}", trying fallback`, {
      err: primaryErr,
    });
    try {
      return await fallback();
    } catch (fallbackErr) {
      logger.error(`[withFallback] Fallback also failed for "${label}"`, {
        primaryErr,
        fallbackErr,
      });
      throw fallbackErr;
    }
  }
}

/**
 * Race a promise against a timeout.
 * Rejects with an AppError (statusCode 504) if the timeout fires first.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation"
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError({
          message: `"${label}" timed out after ${timeoutMs}ms`,
          statusCode: 504,
          isOperational: true,
          errorCode: "OPERATION_TIMEOUT",
        })
      );
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────

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

// ─── Express Error Handler ─────────────────────────────────────────────────

export const globalErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const normalized = normalizeError(err);
  const traceId = getTraceId();
  const endpoint = `${req.method} ${req.originalUrl}`;

  logger.error("Request error captured", {
    traceId,
    path: req.originalUrl,
    method: req.method,
    statusCode: normalized.statusCode,
    errorCode: normalized.errorCode,
    isOperational: normalized.isOperational,
    err,
  });

  // Record error in metrics for visibility
  metrics.recordError(endpoint, normalized.statusCode, normalized.errorCode);

  if (!normalized.isOperational) {
    logger.error("Non-operational error detected. Severe alert should be triggered.", {
      traceId,
      errorCode: normalized.errorCode,
    });
    alerting.fire({
      key: `non-operational-error:${normalized.errorCode}`,
      severity: "critical",
      title: "Non-operational server error",
      message: `A non-operational error (${normalized.errorCode}) occurred on ${endpoint}. This may indicate a programming bug or infrastructure failure.`,
      metadata: {
        traceId,
        endpoint,
        errorCode: normalized.errorCode,
        statusCode: normalized.statusCode,
      },
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

// ─── Fatal Error Handlers ──────────────────────────────────────────────────

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

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

// ─── Database-specific log helpers ──────────────────────────────────────────

export interface DbErrorContext {
  sql?: string;
  params?: readonly unknown[];
  errorCode?: string;
  isTransient?: boolean;
  poolStats?: { active: number; idle: number; queued: number; total: number };
  circuitOpen?: boolean;
  consecutiveFailures?: number;
  elapsedMs?: number;
}

/**
 * Log a database error with rich context. Automatically classifies the error
 * as transient or permanent and adjusts the log level accordingly.
 */
export function logDbError(message: string, ctx: DbErrorContext & { err: unknown }): void {
  const level: LogLevel = ctx.isTransient ? "warn" : "error";
  write(level, `[DB] ${message}`, ctx);
}

/**
 * Log a slow query warning with query details.
 */
export function logSlowQuery(sql: string, elapsedMs: number, params?: readonly unknown[]): void {
  write("warn", "[DB] Slow query detected", {
    sql: sql.slice(0, 500),
    elapsedMs,
    params,
  });
}

/**
 * Log a circuit-breaker state change.
 */
export function logCircuitBreaker(
  state: "opened" | "closed" | "half-open",
  context: { consecutiveFailures?: number; errorCode?: string; previousFailures?: number }
): void {
  const level: LogLevel = state === "opened" ? "error" : "info";
  write(level, `[DB] Circuit breaker ${state}`, context);
}

type RequestContext = {
  traceId: string;
  orbTraceId: string;
  /** x-request-id (AIDV-289): standard W3C correlation header echoed in response. */
  requestId: string;
};

type Serializable = unknown;

const contextStorage = new AsyncLocalStorage<RequestContext>();

function serializeError(error: Error): Record<string, Serializable> {
  const source = error as Error & {
    code?: string;
    sqlState?: string;
    sqlMessage?: string;
    errno?: number;
  };

  return {
    name: source.name,
    message: source.message,
    stack: source.stack ?? "",
    code: source.code ?? "",
    sqlState: source.sqlState ?? "",
    sqlMessage: source.sqlMessage ?? "",
    errno: source.errno ?? 0,
  };
}

function safeSerialize(value: unknown): Serializable {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => safeSerialize(item));
  }
  if (typeof value === "object") {
    const mapped: Record<string, Serializable> = {};
    for (const [key, innerValue] of Object.entries(value as object)) {
      mapped[key] = safeSerialize(innerValue);
    }
    return mapped;
  }
  return String(value);
}

function formatLog(level: LogLevel, message: string, metadata?: unknown): string {
  const context = contextStorage.getStore();

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    traceId: context?.traceId ?? null,
    orbTraceId: context?.orbTraceId ?? null,
    requestId: context?.requestId ?? null,
    metadata: safeSerialize(metadata ?? {}),
  };

  return JSON.stringify(payload);
}

function write(level: LogLevel, message: string, metadata?: unknown): void {
  const line = formatLog(level, message, metadata);
  if (level === "error") {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, metadata?: unknown) => write("debug", message, metadata),
  info: (message: string, metadata?: unknown) => write("info", message, metadata),
  warn: (message: string, metadata?: unknown) => write("warn", message, metadata),
  error: (message: string, metadata?: unknown) =>
    write("error", message, metadata),
};

export function getTraceId(): string | null {
  return contextStorage.getStore()?.traceId ?? null;
}

export function getOrbTraceId(): string | null {
  return contextStorage.getStore()?.orbTraceId ?? null;
}

export function getRequestId(): string | null {
  return contextStorage.getStore()?.requestId ?? null;
}

export function runWithTraceContext<T>(
  traceId: string,
  orbTraceId: string,
  requestId: string,
  callback: () => T
): T {
  return contextStorage.run({ traceId, orbTraceId, requestId }, callback);
}

export function requestTraceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingTraceId = req.header("x-trace-id");
  const incomingOrbTraceId = req.header("x-orb-trace-id") || req.header("x-trace-id");
  const traceId = incomingTraceId || randomUUID();
  const orbTraceId = incomingOrbTraceId || `orb_${randomUUID()}`;
  // AIDV-289: accept x-request-id from callers (agents/headless API); fall back to traceId.
  const requestId = req.header("x-request-id") || traceId;

  runWithTraceContext(traceId, orbTraceId, requestId, () => {
    res.setHeader("x-trace-id", traceId);
    res.setHeader("x-orb-trace-id", orbTraceId);
    res.setHeader("x-request-id", requestId);
    logger.info("HTTP request received", {
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("user-agent") ?? "",
    });

    res.on("finish", () => {
      logger.info("HTTP request completed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      });
    });

    next();
  });
}

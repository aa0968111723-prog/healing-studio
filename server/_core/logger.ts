import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

type RequestContext = {
  traceId: string;
  orbTraceId: string;
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

// ─── Structured Error Logging Helpers ─────────────────────────────────────

export interface ErrorLogContext {
  /** tRPC procedure or Express route label, e.g. "news.list" */
  endpoint?: string;
  /** Unique request trace ID (auto-injected from AsyncLocalStorage when omitted) */
  traceId?: string | null;
  /** Any additional key/value pairs to attach to the log entry */
  [key: string]: unknown;
}

/**
 * Log a structured application error with full context.
 * Automatically attaches the current traceId from AsyncLocalStorage.
 */
export function logError(
  message: string,
  err: unknown,
  context: ErrorLogContext = {}
): void {
  write("error", message, {
    traceId: context.traceId ?? getTraceId(),
    ...context,
    err,
  });
}

/**
 * Log a structured warning with context.
 */
export function logWarning(
  message: string,
  context: ErrorLogContext = {}
): void {
  write("warn", message, {
    traceId: context.traceId ?? getTraceId(),
    ...context,
  });
}

/**
 * Log a structured informational event with context.
 */
export function logInfo(
  message: string,
  context: ErrorLogContext = {}
): void {
  write("info", message, {
    traceId: context.traceId ?? getTraceId(),
    ...context,
  });
}

/**
 * Log a Zod / input validation failure with the offending field and message.
 */
export function logValidationError(
  field: string,
  err: unknown,
  context: ErrorLogContext = {}
): void {
  write("warn", "[Validation] Input validation failed", {
    traceId: context.traceId ?? getTraceId(),
    field,
    ...context,
    err,
  });
}

/**
 * Log an external API / third-party service failure with the service name.
 */
export function logExternalApiError(
  service: string,
  err: unknown,
  context: ErrorLogContext = {}
): void {
  write("error", `[ExternalAPI] ${service} request failed`, {
    traceId: context.traceId ?? getTraceId(),
    service,
    ...context,
    err,
  });
}

/**
 * Log a database query failure with the query label (never the raw SQL).
 */
export function logDatabaseError(
  query: string,
  err: unknown,
  context: ErrorLogContext = {}
): void {
  write("error", `[Database] Query failed: ${query}`, {
    traceId: context.traceId ?? getTraceId(),
    query,
    ...context,
    err,
  });
}

export function getTraceId(): string | null {
  return contextStorage.getStore()?.traceId ?? null;
}

export function getOrbTraceId(): string | null {
  return contextStorage.getStore()?.orbTraceId ?? null;
}

export function runWithTraceContext<T>(
  traceId: string,
  orbTraceId: string,
  callback: () => T
): T {
  return contextStorage.run({ traceId, orbTraceId }, callback);
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

  runWithTraceContext(traceId, orbTraceId, () => {
    res.setHeader("x-trace-id", traceId);
    res.setHeader("x-orb-trace-id", orbTraceId);
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

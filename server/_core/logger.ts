import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export type LogLevel = "debug" | "info" | "warn" | "error";

type RequestContext = {
  traceId: string;
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

export function runWithTraceId<T>(traceId: string, callback: () => T): T {
  return contextStorage.run({ traceId }, callback);
}

export function requestTraceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const incomingTraceId = req.header("x-trace-id");
  const traceId = incomingTraceId || randomUUID();

  runWithTraceId(traceId, () => {
    res.setHeader("x-trace-id", traceId);
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

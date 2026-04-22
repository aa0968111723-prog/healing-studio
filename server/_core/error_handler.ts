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

  logger.error("Request error captured", {
    traceId,
    path: req.originalUrl,
    method: req.method,
    statusCode: normalized.statusCode,
    errorCode: normalized.errorCode,
    isOperational: normalized.isOperational,
    err,
  });

  if (!normalized.isOperational) {
    logger.error("Non-operational error detected. Severe alert should be triggered.", {
      traceId,
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

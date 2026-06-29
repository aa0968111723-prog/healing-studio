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

export interface ProcessErrorHandlerOptions {
  /** Rolling window size in ms for storm detection (default: 60_000) */
  stormWindowMs?: number;
  /** Rejections per window that triggers fatal shutdown; ≤0 disables (default: 50) */
  stormThreshold?: number;
  /** Injectable exit function for unit testing */
  exit?: (code: number) => never;
}

/**
 * Creates isolated process-level error handlers with storm detection.
 * uncaughtException → always fatal (process state is unknown).
 * unhandledRejection → log only; only fatal when storm threshold is exceeded.
 */
export function createProcessErrorHandlers(
  shutdown: (reason: string) => Promise<void>,
  options: ProcessErrorHandlerOptions = {}
): {
  handleUncaughtException: (error: unknown) => void;
  handleUnhandledRejection: (reason: unknown) => void;
} {
  const {
    stormWindowMs = 60_000,
    stormThreshold = 50,
    exit: exitFn = (code: number) => process.exit(code) as never,
  } = options;

  let shutdownCalled = false;
  const rejectionTimestamps: number[] = [];

  const doFatal = async (reason: string, error: unknown): Promise<void> => {
    if (shutdownCalled) return;
    shutdownCalled = true;

    const traceId = getTraceId();
    logger.error("Fatal Error", { reason, traceId, err: error });

    try {
      await shutdown(reason);
    } finally {
      exitFn(1);
    }
  };

  const handleUncaughtException = (error: unknown): void => {
    void doFatal("uncaughtException", error);
  };

  const handleUnhandledRejection = (reason: unknown): void => {
    const now = Date.now();

    if (stormThreshold > 0) {
      rejectionTimestamps.push(now);
      // Evict timestamps outside the rolling window
      let i = 0;
      while (i < rejectionTimestamps.length && now - rejectionTimestamps[i] >= stormWindowMs) {
        i++;
      }
      rejectionTimestamps.splice(0, i);

      if (rejectionTimestamps.length >= stormThreshold) {
        void doFatal("unhandledRejectionStorm", reason);
        return;
      }
    }

    logger.error("Unhandled promise rejection (non-fatal)", {
      traceId: getTraceId(),
      err: reason,
    });
  };

  return { handleUncaughtException, handleUnhandledRejection };
}

export function registerFatalErrorHandlers(
  shutdown: (reason: string) => Promise<void>
): void {
  if (fatalHandlersRegistered) return;
  fatalHandlersRegistered = true;

  const { handleUncaughtException, handleUnhandledRejection } =
    createProcessErrorHandlers(shutdown);

  process.on("uncaughtException", handleUncaughtException);
  process.on("unhandledRejection", handleUnhandledRejection);
}

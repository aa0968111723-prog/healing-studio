import { AppError } from "./error_handler";
import { logger } from "./logger";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type HttpRequestOptions = {
  method?: HttpMethod;
  headers?: HeadersInit;
  body?: BodyInit | null;
  timeoutMs?: number;
  retries?: number;
};

function maskSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

function maskHeaders(headers?: HeadersInit): Record<string, string> {
  const output: Record<string, string> = {};
  const normalized = new Headers(headers);

  normalized.forEach((value, key) => {
    if (/(authorization|api[-_]?key|token|secret)/i.test(key)) {
      output[key] = maskSecret(value);
      return;
    }
    output[key] = value;
  });

  return output;
}

function maskUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.forEach((value, key) => {
    if (/(token|api[-_]?key|secret|signature)/i.test(key)) {
      url.searchParams.set(key, maskSecret(value));
    }
  });
  return url.toString();
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class HttpClient {
  async request<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const maxRetries = options.retries ?? 3;
    const maxAttempts = maxRetries + 1;
    const timeoutMs = options.timeoutMs ?? 10_000;

    let attempt = 1;
    let lastError: unknown;

    while (attempt <= maxAttempts) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers: options.headers,
          body: options.body,
          signal: controller.signal,
        });

        const elapsedMs = Date.now() - startedAt;
        const telemetry = {
          attempt,
          elapsedMs,
          url: maskUrl(url),
          method: options.method ?? "GET",
          headers: maskHeaders(options.headers),
          status: response.status,
        };

        if (elapsedMs > 2000) {
          logger.warn("[Slow API Request]", telemetry);
        } else {
          logger.info("API request completed", telemetry);
        }

        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          const waitMs = 200 * 2 ** (attempt - 1);
          logger.warn("Retryable upstream status code received", {
            ...telemetry,
            nextRetryInMs: waitMs,
          });
          await delay(waitMs);
          attempt += 1;
          continue;
        }

        if (!response.ok) {
          throw new AppError({
            message: `HTTP request failed with status ${response.status}`,
            statusCode: response.status,
            isOperational: true,
            errorCode: "HTTP_REQUEST_FAILED",
          });
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          return (await response.json()) as T;
        }
        return (await response.text()) as T;
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        lastError = error;
        const isTimeout =
          error instanceof Error &&
          (error.name === "AbortError" || /aborted/i.test(error.message));

        logger.error("API request failed", {
          attempt,
          elapsedMs,
          timeoutMs,
          url: maskUrl(url),
          headers: maskHeaders(options.headers),
          isTimeout,
          err: error,
        });

        const canRetry = attempt < maxAttempts;
        if (!canRetry) break;

        if (isTimeout || (error instanceof AppError && error.statusCode >= 500)) {
          const waitMs = 200 * 2 ** (attempt - 1);
          await delay(waitMs);
          attempt += 1;
          continue;
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AppError({
      message: "External AI API request exhausted retries",
      statusCode: 502,
      isOperational: true,
      errorCode: "AI_UPSTREAM_UNAVAILABLE",
      cause: lastError,
    });
  }
}

export const httpClient = new HttpClient();

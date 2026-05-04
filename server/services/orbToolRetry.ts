/**
 * server/services/orbToolRetry.ts
 *
 * 光球代理工具呼叫的增強型錯誤恢復與重試中間件。
 *
 * 設計目標：
 *   1. 為 research.deepSearch 等外部依賴工具提供自動重試
 *   2. 為多步驟代理提供更優雅的錯誤恢復機制
 *   3. 記錄重試遙測數據，幫助後續優化
 *
 * 使用方式：
 *   在 agentToolExecutor 或 orbTaskOrchestrator 中包裝工具呼叫：
 *   ```
 *   const result = await withToolRetry(
 *     () => dispatchDeepSearchTool(call, opts),
 *     { maxRetries: 2, toolName: call.name }
 *   );
 *   ```
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolRetryOptions {
  /** 最大重試次數（不含首次嘗試） */
  maxRetries?: number;
  /** 重試間隔基數（毫秒），實際延遲 = baseDelayMs * 2^retryIndex */
  baseDelayMs?: number;
  /** 最大延遲上限（毫秒） */
  maxDelayMs?: number;
  /** 工具名稱（用於遙測） */
  toolName?: string;
  /** 是否在重試前記錄日誌 */
  verbose?: boolean;
  /** 可重試的錯誤碼列表（空 = 所有錯誤都重試） */
  retryableErrors?: string[];
  /** 不可重試的錯誤碼列表 */
  nonRetryableErrors?: string[];
  /** 重試事件回調 */
  onRetry?: (attempt: number, error: string, delayMs: number) => void;
}

export interface ToolRetryResult<T> {
  result: T;
  attempts: number;
  totalDurationMs: number;
  retried: boolean;
  retryErrors?: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 8_000;

/** 這些錯誤碼表示暫時性問題，值得重試 */
const TRANSIENT_ERROR_PATTERNS = [
  "timeout",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "fetch failed",
  "network",
  "rate_limit",
  "429",
  "500",
  "502",
  "503",
  "504",
  "service_unavailable",
  "internal_server_error",
];

/** 這些錯誤碼表示永久性問題，不應重試 */
const PERMANENT_ERROR_PATTERNS = [
  "tool-blocked-by-user",
  "research-query-required",
  "invalid_api_key",
  "unauthorized",
  "forbidden",
  "400",
  "401",
  "403",
  "404",
  "quota_exceeded",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function isTransientError(error: string): boolean {
  const lower = error.toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function isPermanentError(error: string): boolean {
  const lower = error.toLowerCase();
  return PERMANENT_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  // 指數退避 + 隨機抖動
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs * 0.5;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * 包裝工具呼叫，提供自動重試和指數退避。
 *
 * 重試策略：
 *   - 暫時性錯誤（網路超時、伺服器錯誤）→ 自動重試
 *   - 永久性錯誤（無效 API key、被封鎖）→ 立即返回
 *   - 指數退避 + 隨機抖動，避免雷群效應
 */
export async function withToolRetry<T extends { ok: boolean; error?: string }>(
  fn: () => Promise<T>,
  options: ToolRetryOptions = {}
): Promise<ToolRetryResult<T>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const toolName = options.toolName ?? "unknown";
  const retryErrors: string[] = [];
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();

      // 成功 → 直接返回
      if (result.ok) {
        return {
          result,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: retryErrors.length > 0 ? retryErrors : undefined,
        };
      }

      // 失敗但有錯誤碼 → 判斷是否可重試
      const error = result.error ?? "unknown-error";

      // 永久性錯誤 → 不重試
      if (isPermanentError(error)) {
        if (options.verbose) {
          console.warn(
            `[ToolRetry] ${toolName} permanent error on attempt ${attempt + 1}: ${error}`
          );
        }
        return {
          result,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: retryErrors.length > 0 ? retryErrors : undefined,
        };
      }

      // 自定義不可重試錯誤
      if (
        options.nonRetryableErrors &&
        options.nonRetryableErrors.some((e) =>
          error.toLowerCase().includes(e.toLowerCase())
        )
      ) {
        return {
          result,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: retryErrors.length > 0 ? retryErrors : undefined,
        };
      }

      // 已達最大重試次數 → 返回最後結果
      if (attempt >= maxRetries) {
        if (options.verbose) {
          console.warn(
            `[ToolRetry] ${toolName} exhausted ${maxRetries} retries, last error: ${error}`
          );
        }
        return {
          result,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: retryErrors.length > 0 ? retryErrors : undefined,
        };
      }

      // 暫時性錯誤 → 重試
      retryErrors.push(error);
      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs);

      if (options.verbose) {
        console.info(
          `[ToolRetry] ${toolName} transient error on attempt ${attempt + 1}: ${error}, retrying in ${Math.round(delayMs)}ms`
        );
      }

      options.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
    } catch (thrown) {
      const error =
        thrown instanceof Error ? thrown.message : String(thrown);

      // 永久性異常 → 不重試
      if (isPermanentError(error)) {
        return {
          result: {
            ok: false,
            error,
          } as T,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: retryErrors.length > 0 ? retryErrors : undefined,
        };
      }

      // 已達最大重試次數
      if (attempt >= maxRetries) {
        return {
          result: {
            ok: false,
            error: `max-retries-exhausted: ${error}`,
          } as T,
          attempts: attempt + 1,
          totalDurationMs: Date.now() - startTime,
          retried: attempt > 0,
          retryErrors: [...retryErrors, error],
        };
      }

      retryErrors.push(error);
      const delayMs = calculateDelay(attempt, baseDelayMs, maxDelayMs);

      if (options.verbose) {
        console.info(
          `[ToolRetry] ${toolName} exception on attempt ${attempt + 1}: ${error}, retrying in ${Math.round(delayMs)}ms`
        );
      }

      options.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
    }
  }

  // 理論上不會到這裡，但作為安全網
  return {
    result: { ok: false, error: "retry-logic-error" } as T,
    attempts: maxRetries + 1,
    totalDurationMs: Date.now() - startTime,
    retried: true,
    retryErrors,
  };
}

/**
 * 為特定工具類型提供預設的重試配置。
 */
export function getDefaultRetryOptions(
  toolName: string
): Partial<ToolRetryOptions> {
  // 外部搜尋工具：較多重試，因為外部 API 可能暫時不穩定
  if (
    toolName.startsWith("research.") ||
    toolName.startsWith("inspiration.")
  ) {
    return {
      maxRetries: 2,
      baseDelayMs: 1_500,
      maxDelayMs: 10_000,
      verbose: true,
    };
  }

  // 生成工具：只重試一次，因為生成成本較高
  if (toolName.startsWith("studio.")) {
    return {
      maxRetries: 1,
      baseDelayMs: 2_000,
      maxDelayMs: 5_000,
      verbose: true,
    };
  }

  // 其他工具：預設配置
  return {
    maxRetries: 1,
    baseDelayMs: 1_000,
    maxDelayMs: 5_000,
  };
}

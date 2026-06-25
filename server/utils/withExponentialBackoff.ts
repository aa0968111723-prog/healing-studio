/**
 * withExponentialBackoff — AIDV-357 雷鳴群（Thundering Herd）防護
 *
 * 對任意非同步函式套用指數退避 + jitter 重試，防止多代理同步失敗後
 * 立即同步重試，導致 LLM API 成本放大 N×。
 *
 * 預設行為（對齊卡片驗收）：
 *   base=500ms, maxRetries=5, jitter=true（0–50% 隨機擾動）
 *
 * 退避時序：
 *   retry 1: 500ms  ± jitter
 *   retry 2: 1000ms ± jitter
 *   retry 3: 2000ms ± jitter
 *   retry 4: 4000ms ± jitter
 *   retry 5: 8000ms ± jitter（最後一次重試後不等待，直接拋錯）
 *
 * 只有當 shouldRetry(err) 回傳 true 時才重試（預設：所有錯誤均重試）。
 */

export interface ExponentialBackoffOptions {
  /** 初始等待毫秒（第 1 次重試之前）。預設 500。 */
  base?: number;
  /** 最大重試次數（不含第 1 次嘗試）。預設 5。 */
  maxRetries?: number;
  /** 是否加 0–50% 隨機 jitter（防同步重試風暴）。預設 true。 */
  jitter?: boolean;
  /** 自訂判斷是否重試的函式。回傳 false 立即拋出（不再重試）。 */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** 每次重試前的 hook（可選，用於 logging / metrics）。 */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 執行 fn，失敗時以指數退避 + jitter 重試至多 maxRetries 次。
 * 超過重試上限後重新拋出最後一次的錯誤。
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  options: ExponentialBackoffOptions = {}
): Promise<T> {
  const {
    base = 500,
    maxRetries = 5,
    jitter = true,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === maxRetries;
      if (isLastAttempt || !shouldRetry(err, attempt)) {
        throw err;
      }

      const exponentialMs = base * Math.pow(2, attempt);
      const jitterMs = jitter ? Math.random() * exponentialMs * 0.5 : 0;
      const delayMs = Math.round(exponentialMs + jitterMs);

      onRetry?.(err, attempt + 1, delayMs);

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * 包裝一個只回傳 void 的函式（常用於 cron job / fire-and-forget）。
 * 語法糖：省去每次寫 `() =>` 的重複。
 */
export function wrapWithExponentialBackoff<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
  options: ExponentialBackoffOptions = {}
): (...args: Args) => Promise<void> {
  return (...args: Args) => withExponentialBackoff(() => fn(...args), options);
}

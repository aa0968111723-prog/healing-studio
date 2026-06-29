/**
 * falRecoveryPolicy.ts — ADP-2: fal.ai 三層失敗分類與恢復策略
 *
 * 三層：
 *   transient  — 429 / timeout / 網路抖動          → 退避重試（最多 3 次）
 *   content    — 壞輸出 / 內容審核拒絕             → 修改 prompt 重試（最多 2 次）
 *   hard       — 模型不可用 / 永久 4xx             → 降級模型重試（最多 1 次）
 *
 * 核心 invariant：
 *   - 分類 > 重試上限 → 結束，標 degraded=true（工作流不中止）。
 *   - 未知錯誤預設 transient（安全側）。
 *
 * 本模組同時提供兩套 API（融合 #1192 與 #1140 兩版，互不破壞）：
 *   ① 主路徑（runFalWithRecovery / classifyFalError / shouldRetry …）— 三層含
 *      content 改 prompt + hard 降級 model 的完整恢復包裝器，供 agentToolExecutor
 *      的 fal dispatch 使用。
 *   ② 相容層（classifyFalFailure / isAdp2RetryEnabled / getAdp2MaxRetries /
 *      adp2BackoffMs …）— 較早版（ADP2_RETRY_ENABLED / ADP2_MAX_RETRIES 旗標）
 *      的 transient 重試 API，保留以維持既有呼叫端與測試不破壞。
 */

export type FalFailureKind = "transient" | "content" | "hard";

export interface FalRecoveryPolicy {
  /** 429/timeout/network 退避重試上限。 */
  maxTransientRetries: number;
  /** 內容拒絕改 prompt 重試上限。 */
  maxContentRetries: number;
  /** 模型不可用降級重試上限。 */
  maxHardRetries: number;
  /** 退避基數（ms）：第 N 次等 base * 2^(N-1)，上限 30s。 */
  backoffBaseMs: number;
}

export const DEFAULT_FAL_RECOVERY_POLICY: FalRecoveryPolicy = {
  maxTransientRetries: 3,
  maxContentRetries: 2,
  maxHardRetries: 1,
  backoffBaseMs: 2_000,
};

// 永久客戶端錯誤（4xx 除 429/404）= hard
const HARD_PATTERNS: RegExp[] = [
  /model.*not.*found/i,
  /model.*unavailable/i,
  /not.*supported/i,
  /deprecated/i,
  /HTTP 40[023568]\b/,
];

// 內容審核 / 輸出品質問題 = content
const CONTENT_PATTERNS: RegExp[] = [
  /content.*policy/i,
  /safety/i,
  /nsfw/i,
  /refus/i,
  /inappropriate/i,
  /no.url.extracted/i,
  /output_url.*缺失/i,
];

// 暫態網路/速率問題 = transient（其餘未知亦歸此）
const TRANSIENT_PATTERNS: RegExp[] = [
  /429/,
  /rate.?limit/i,
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /network/i,
  /temporarily/i,
  /HTTP 5\d\d\b/,
  /fal status HTTP 5/,
  /fal status HTTP 429/,
];

export function classifyFalError(error: string): FalFailureKind {
  if (HARD_PATTERNS.some(p => p.test(error))) return "hard";
  if (CONTENT_PATTERNS.some(p => p.test(error))) return "content";
  if (TRANSIENT_PATTERNS.some(p => p.test(error))) return "transient";
  return "transient"; // 安全側預設
}

export function shouldRetry(
  kind: FalFailureKind,
  attempt: number,
  policy: FalRecoveryPolicy = DEFAULT_FAL_RECOVERY_POLICY
): boolean {
  if (kind === "transient") return attempt <= policy.maxTransientRetries;
  if (kind === "content") return attempt <= policy.maxContentRetries;
  if (kind === "hard") return attempt <= policy.maxHardRetries;
  return false;
}

export function getBackoffMs(attempt: number, baseMs: number): number {
  return Math.min(baseMs * Math.pow(2, attempt - 1), 30_000);
}

export function buildRetryPrompt(prompt: string, attempt: number): string {
  return `${prompt}\n\n[Retry ${attempt}: Please ensure the output follows all content guidelines and produces valid results.]`;
}

// 降級對照表：先選成本較低/可用性較高的模型。
const HARD_FALLBACK_MODELS: Record<string, string> = {
  "fal-ai/flux-pro/v1.1-ultra": "fal-ai/flux-pro",
  "fal-ai/flux-pro": "fal-ai/flux/dev",
  "fal-ai/flux/dev": "fal-ai/flux/schnell",
  "fal-ai/wan/v2.1/14b": "fal-ai/wan/v2.1/1.3b",
  "fal-ai/hunyuan-video": "fal-ai/wan/v2.1/1.3b",
  "fal-ai/stable-video-diffusion": "fal-ai/wan/v2.1/1.3b",
  "fal-ai/kling-video/v2.1/pro/text-to-video": "fal-ai/kling-video/v2.1/standard/text-to-video",
  "fal-ai/kling-video/v2.1/pro/image-to-video": "fal-ai/kling-video/v2.1/standard/image-to-video",
};

export function getHardFallbackModel(modelId: string): string | null {
  return HARD_FALLBACK_MODELS[modelId] ?? null;
}

export interface FalResultLike {
  status?: string;
  error?: string;
  degraded?: boolean;
}

/**
 * ADP-2 三層恢復包裝器。
 *
 * 呼叫端提供一個 factory（取 modelId + promptOverride → 執行 dispatch+await），
 * 本函式依策略自動：
 *   transient → sleep + 相同 model/prompt 重試
 *   content   → 附加反饋說明修改 prompt 重試
 *   hard      → 換降級 model 重試（標 degraded=true）
 * 超出上限時回傳最後一次結果，不拋錯（工作流不中止）。
 */
export async function runFalWithRecovery<T extends FalResultLike>(
  dispatchAndAwait: (modelId: string, promptOverride?: string) => Promise<T>,
  initialModelId: string,
  initialPrompt: string | undefined,
  options?: {
    policy?: FalRecoveryPolicy;
    /** Test seam：覆蓋 sleep，讓測試不用真的等待。 */
    sleepFn?: (ms: number) => Promise<void>;
  }
): Promise<T> {
  const policy = options?.policy ?? DEFAULT_FAL_RECOVERY_POLICY;
  const sleepFn =
    options?.sleepFn ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  let modelId = initialModelId;
  let prompt = initialPrompt;
  let degraded = false;

  for (let attempt = 1; ; attempt++) {
    const result = await dispatchAndAwait(modelId, prompt);
    if (result.status !== "failed") {
      // 降級 model 成功時，標 degraded=true（即使結果本身沒有這個欄位）。
      return degraded ? { ...result, degraded: true } : result;
    }

    const kind = classifyFalError(result.error ?? "unknown");
    if (!shouldRetry(kind, attempt, policy)) {
      return { ...result, degraded: kind === "hard" ? true : (result.degraded ?? degraded) };
    }

    await sleepFn(getBackoffMs(attempt, policy.backoffBaseMs));

    if (kind === "content") {
      prompt = buildRetryPrompt(prompt ?? "", attempt);
    } else if (kind === "hard") {
      const fallback = getHardFallbackModel(modelId);
      if (!fallback) {
        return { ...result, degraded: true };
      }
      modelId = fallback;
      degraded = true;
    }
    // transient: 相同 modelId + prompt，下一輪直接重試
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 相容層（legacy ADP-2 API，#1192）— transient-only 重試門檻 + env 旗標。
// 與上方主路徑共存：既有呼叫端／測試使用以下 API，不受主路徑改動影響。
// 分類器 classifyFalFailure 採較寬的 raw 物件掃描，故維持獨立的 pattern 集。
// ─────────────────────────────────────────────────────────────────────────────

export type FalFailureCategory = "transient" | "content" | "hard";

// Patterns that indicate a content-policy rejection from fal or the underlying model.
const ADP2_CONTENT_PATTERNS: RegExp[] = [
  /content[_\s-]?policy/i,
  /policy[_\s-]?violation/i,
  /moderat/i,
  /\bnsfw\b/i,
  /inappropriate/i,
  /\bsafety\b/i,
  /blocked\s+by/i,
  /prohibited/i,
];

// Patterns that indicate a hard failure (bad input / unknown model / format mismatch).
const ADP2_HARD_PATTERNS: RegExp[] = [
  /model\s+not\s+found/i,
  /unknown\s+model/i,
  /invalid\s+model/i,
  /model\s+unavailable/i,
  /no\s+such\s+model/i,
  /invalid\s+input/i,
  /bad\s+request/i,
  /validation[\s_-]*error/i,
  /unprocessable\s+entity/i,
  /not\s+supported/i,
  /\b422\b/,
  /\b400\b/,
];

/**
 * Classify a fal failure to decide whether to retry.
 *
 * Returns:
 *   "content"   → policy/moderation violation; do NOT retry
 *   "hard"      → structural error (bad model/input); do NOT retry
 *   "transient" → infra error (timeout, 5xx, queue overload); safe to retry
 */
export function classifyFalFailure(
  error: string | undefined,
  raw: unknown
): FalFailureCategory {
  const rawStr = (() => {
    try {
      return typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
    } catch {
      return "";
    }
  })();
  const haystack = `${error ?? ""} ${rawStr}`;

  if (ADP2_CONTENT_PATTERNS.some(p => p.test(haystack))) return "content";
  if (ADP2_HARD_PATTERNS.some(p => p.test(haystack))) return "hard";
  return "transient";
}

/**
 * Whether ADP-2 retry is enabled.
 * Default ON; set env ADP2_RETRY_ENABLED=0 to disable.
 */
export function isAdp2RetryEnabled(): boolean {
  return process.env.ADP2_RETRY_ENABLED !== "0";
}

/**
 * Maximum number of retry attempts (excluding the initial attempt).
 * Env ADP2_MAX_RETRIES overrides; capped at 5 to prevent runaway retries.
 */
export function getAdp2MaxRetries(): number {
  const v = parseInt(process.env.ADP2_MAX_RETRIES ?? "", 10);
  if (!Number.isFinite(v) || v < 0) return 2;
  return Math.min(v, 5);
}

/**
 * Sleep seam — replaced in tests to avoid real delays.
 * @internal
 */
export let _adp2SleepFn: (ms: number) => Promise<void> = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

/** @internal — test hook only */
export function _setAdp2SleepFnForTest(fn: (ms: number) => Promise<void>): void {
  _adp2SleepFn = fn;
}

/** @internal — restore default sleep after test */
export function _resetAdp2SleepFn(): void {
  _adp2SleepFn = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Exponential backoff delay for retry attempt N (1-indexed).
 * 1s → 2s → 4s → … capped at 8s.
 */
export function adp2BackoffMs(attempt: number): number {
  return Math.min(1_000 * Math.pow(2, attempt - 1), 8_000);
}

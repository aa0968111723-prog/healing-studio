import { getAdapter } from "./ai-adapters/registry";

export type OrbTaskProvider = "fal_ai" | "suno" | "elevenlabs";

export interface OrbTaskExecutionStep {
  provider: OrbTaskProvider;
  path: string;
  method?: "GET" | "POST";
  payload?: Record<string, unknown>;
}

export interface OrbTaskExecutionResult {
  status: "success" | "failed";
  provider: OrbTaskProvider;
  model?: string;
  retryable: boolean;
  result?: unknown;
  error?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function executeOrbTaskStep(step: OrbTaskExecutionStep): Promise<OrbTaskExecutionResult> {
  try {
    const adapter = getAdapter(step.provider);
    const response = await adapter.proxy({
      method: step.method ?? "POST",
      pathWithQuery: step.path,
      headers: { "content-type": "application/json" },
      body: step.payload ? JSON.stringify(step.payload) : undefined,
      timeoutMs: 120_000,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        status: "failed",
        provider: step.provider,
        retryable: isRetryableStatus(response.status),
        error: typeof (json as { error?: unknown }).error === "string" ? (json as { error: string }).error : `HTTP ${response.status}`,
      };
    }
    return {
      status: "success",
      provider: step.provider,
      retryable: false,
      result: json,
      model: typeof (json as { model?: unknown }).model === "string" ? (json as { model: string }).model : undefined,
    };
  } catch (error) {
    return {
      status: "failed",
      provider: step.provider,
      retryable: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function executeOrbTaskChain(steps: OrbTaskExecutionStep[]): Promise<OrbTaskExecutionResult[]> {
  const results: OrbTaskExecutionResult[] = [];
  let prev: unknown = null;
  for (const step of steps) {
    const payload = step.payload ? { ...step.payload, previousResult: prev } : { previousResult: prev };
    const result = await executeOrbTaskStep({ ...step, payload });
    results.push(result);
    if (result.status !== "success") break;
    prev = result.result;
  }
  return results;
}

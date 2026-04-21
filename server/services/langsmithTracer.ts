import { serverEnv } from "../_core/env.validated";

let _langSmithClient: import("langsmith").Client | null = null;

async function getLangSmithClient(): Promise<import("langsmith").Client | null> {
  if (!serverEnv.LANGSMITH_API_KEY) return null;
  if (_langSmithClient) return _langSmithClient;
  try {
    const { Client } = await import("langsmith");
    _langSmithClient = new Client({
      apiKey: serverEnv.LANGSMITH_API_KEY,
      apiUrl: serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
    });
    return _langSmithClient;
  } catch {
    return null;
  }
}

function summarize(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.toLowerCase().includes("key") || k.toLowerCase().includes("token") || k.toLowerCase().includes("authorization")) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = summarize(v);
      }
    }
    return out;
  }
  return String(value);
}

export async function traceToolRun(opts: {
  runName: string;
  provider: string;
  model?: string;
  route?: string;
  method?: string;
  userId?: number | null;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}): Promise<void> {
  const client = await getLangSmithClient();
  if (!client) return;
  const endTime = Date.now();
  const projectName = serverEnv.LANGSMITH_PROJECT || "網站";
  try {
    await client.createRun({
      id: `trace-${endTime}-${Math.random().toString(36).slice(2, 10)}`,
      name: opts.runName,
      run_type: "tool",
      project_name: projectName,
      start_time: endTime - Math.max(0, opts.durationMs),
      end_time: endTime,
      inputs: summarize({
        provider: opts.provider,
        model: opts.model,
        route: opts.route,
        method: opts.method,
        user_id: opts.userId ?? null,
        ...(opts.inputs || {}),
      }) as Record<string, unknown>,
      outputs: summarize(opts.outputs || {}) as Record<string, unknown>,
      ...(opts.error ? { error: opts.error } : {}),
      extra: {
        metadata: {
          provider: opts.provider,
          model: opts.model ?? null,
          route: opts.route ?? null,
          method: opts.method ?? null,
          duration_ms: opts.durationMs,
        },
      },
    });
  } catch {
    // Observability only: must not break business flow.
  }
}

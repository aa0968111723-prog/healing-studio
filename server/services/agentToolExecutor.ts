import { TRPCError } from "@trpc/server";

export interface OrbApiTool {
  name: string;
  description: string;
  method: "GET" | "POST";
  endpoint: string;
  headers?: Record<string, string>;
  requireConfirmation?: boolean;
}

export interface OrbToolCall {
  name: string;
  args?: Record<string, unknown>;
}

export interface OrbToolCallResult {
  name: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

export interface ExecuteOrbToolCallsOptions {
  tools: OrbApiTool[];
  calls: OrbToolCall[];
  userId: number;
  approved: boolean;
}

const TOOL_TIMEOUT_MS = 12_000;

function getAllowedOrigins(): string[] {
  const raw = process.env.ORB_TOOL_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function assertAllowedEndpoint(endpoint: string): void {
  const allowed = getAllowedOrigins();
  if (!allowed.length) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "尚未設定 ORB_TOOL_ALLOWED_ORIGINS，暫時不允許光球代理連外 API。",
    });
  }

  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `無效的 endpoint：${endpoint}`,
    });
  }

  if (!allowed.includes(origin)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `endpoint 不在 allowlist：${origin}`,
    });
  }
}

function withUserHeaders(headers: Record<string, string> | undefined, userId: number) {
  return {
    "content-type": "application/json",
    "x-orb-user-id": String(userId),
    ...headers,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOOL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function executeOrbToolCalls(
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult[]> {
  const byName = new Map(opts.tools.map(t => [t.name, t]));
  const out: OrbToolCallResult[] = [];

  for (const call of opts.calls) {
    const tool = byName.get(call.name);
    if (!tool) {
      out.push({ name: call.name, ok: false, error: "tool-not-found" });
      continue;
    }

    try {
      assertAllowedEndpoint(tool.endpoint);

      if (tool.requireConfirmation && !opts.approved) {
        out.push({ name: call.name, ok: false, error: "confirmation-required" });
        continue;
      }

      const qs = tool.method === "GET" && call.args
        ? `?${new URLSearchParams(
            Object.entries(call.args).reduce<Record<string, string>>((acc, [k, v]) => {
              if (v === undefined || v === null) return acc;
              acc[k] = String(v);
              return acc;
            }, {})
          ).toString()}`
        : "";

      const res = await fetchWithTimeout(`${tool.endpoint}${qs}`, {
        method: tool.method,
        headers: withUserHeaders(tool.headers, opts.userId),
        body: tool.method === "POST" ? JSON.stringify(call.args ?? {}) : undefined,
      });

      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = await res.text();
      }

      if (!res.ok) {
        out.push({
          name: call.name,
          ok: false,
          status: res.status,
          error: typeof data === "string" ? data : "tool-http-error",
          data,
        });
      } else {
        out.push({ name: call.name, ok: true, status: res.status, data });
      }
    } catch (err) {
      out.push({
        name: call.name,
        ok: false,
        error: err instanceof Error ? err.message : "tool-execute-failed",
      });
    }
  }

  return out;
}

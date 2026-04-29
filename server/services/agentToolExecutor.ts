import { TRPCError } from "@trpc/server";

export interface OrbApiTool {
  name: string;
  description: string;
  method: "GET" | "POST";
  endpoint: string;
  version?: string;
  riskLevel?: "low" | "medium" | "high";
  allowedRoles?: string[];
  retryPolicy?: {
    maxRetries?: number;
    backoffMs?: number;
  };
  fallbackTools?: string[];
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
  attempts?: number;
  usedTool?: string;
}

export interface ExecuteOrbToolCallsOptions {
  tools: OrbApiTool[];
  calls: OrbToolCall[];
  userId: number;
  userRole: string;
  approved: boolean;
  requestId?: string;
  taskId?: string;
  stepId?: string;
  onAuditEvent?: (event: {
    requestId: string;
    userId: number;
    userRole: string;
    taskId?: string;
    stepId?: string;
    toolName: string;
    usedTool?: string;
    ok: boolean;
    status?: number;
    error?: string;
    attempts?: number;
    startedAt: number;
    endedAt: number;
  }) => void;
  blockedTools?: string[];
}

const TOOL_TIMEOUT_MS = 30_000; // 增加至 30s，容納較慢的 LLM 回應（原 12s 在 NVIDIA 降級時易超時）
const DEFAULT_RETRY_BACKOFF_MS = 200;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 開發環境自動允許 localhost 的 origin，避免 .env 未填寫時阻斷本機開發。
 * 正式環境（NODE_ENV === "production"）一律不啟用，必須由 ORB_TOOL_ALLOWED_ORIGINS 顯式列出。
 */
const DEV_LOCAL_ORIGINS: readonly string[] = [
  "http://localhost",
  "http://127.0.0.1",
];

function isDevLocalhostOrigin(origin: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function getAllowedOrigins(): string[] {
  const raw = process.env.ORB_TOOL_ALLOWED_ORIGINS ?? "";
  const explicit = raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production") return explicit;
  // 非正式環境追加 localhost 起手包（dev / test 不影響正式安全姿態）
  return Array.from(new Set([...explicit, ...DEV_LOCAL_ORIGINS]));
}

export function assertAllowedEndpoint(endpoint: string): void {
  let origin: string;
  try {
    origin = new URL(endpoint).origin;
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `無效的 endpoint：${endpoint}`,
    });
  }

  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) return;
  if (isDevLocalhostOrigin(origin)) return;

  if (!allowed.length || allowed.every(o => isDevLocalhostOrigin(o))) {
    // 沒有任何「實質」allowlist 條目（只剩 dev localhost 預設值）
    const nodeEnv = process.env.NODE_ENV ?? "development";
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        `尚未設定 ORB_TOOL_ALLOWED_ORIGINS（NODE_ENV=${nodeEnv}），暫時不允許光球代理連外 API。` +
        " 請在 .env 內填入信任的 origin（半形逗號分隔），" +
        "範例與說明請見 https://github.com/aa0968111723-prog/healing-studio/blob/main/.env.example#L133-L170 。",
    });
  }

  throw new TRPCError({
    code: "FORBIDDEN",
    message: `endpoint 不在 allowlist：${origin}`,
  });
}

/**
 * 啟動時自我健檢：
 * 若已設定 ORB_TOOL_REGISTRY_JSON（=有定義工具）但 ORB_TOOL_ALLOWED_ORIGINS 是空的，
 * 在 stderr 印一次明顯警告，避免「上線後第一次工具呼叫才發現 pipeline 是死路」。
 */
let _selfCheckRan = false;
export function runOrbToolExecutorStartupSelfCheck(): void {
  if (_selfCheckRan) return;
  _selfCheckRan = true;
  const hasRegistry = (process.env.ORB_TOOL_REGISTRY_JSON ?? "").trim().length > 0;
  const explicitAllow = (process.env.ORB_TOOL_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
  if (hasRegistry && explicitAllow.length === 0) {
    const env = process.env.NODE_ENV ?? "development";
    const severity = env === "production" ? "error" : "warn";
    const message =
      `[Orb] ORB_TOOL_REGISTRY_JSON is set but ORB_TOOL_ALLOWED_ORIGINS is empty.` +
      ` All tool calls will fail with PRECONDITION_FAILED in ${env}.` +
      ` See .env.example -> "光球代理 Orb Tool Execution" for the required origins list.`;
    if (severity === "error") console.error(message);
    else console.warn(message);
  }
}

/** 測試用：重置自我健檢狀態 */
export function _resetOrbToolExecutorSelfCheckForTest(): void {
  _selfCheckRan = false;
}

// 模組載入時即執行一次（純 console，不會阻斷啟動）
runOrbToolExecutorStartupSelfCheck();

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

function buildQueryString(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  return `?${new URLSearchParams(
    Object.entries(args).reduce<Record<string, string>>((acc, [k, v]) => {
      if (v === undefined || v === null) return acc;
      acc[k] = String(v);
      return acc;
    }, {})
  ).toString()}`;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function extractError(data: unknown): string {
  return typeof data === "string" ? data : "tool-http-error";
}

async function parseResponseData(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  return await res.text();
}

async function executeWithRecovery(
  tool: OrbApiTool,
  call: OrbToolCall,
  userId: number
): Promise<OrbToolCallResult> {
  const maxRetries = Math.max(0, Math.min(3, tool.retryPolicy?.maxRetries ?? 0));
  const backoffMs = Math.max(50, tool.retryPolicy?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS);
  const queryString = tool.method === "GET" ? buildQueryString(call.args) : "";
  let attempts = 0;
  let lastFailure: OrbToolCallResult | null = null;

  while (attempts <= maxRetries) {
    attempts += 1;
    const res = await fetchWithTimeout(`${tool.endpoint}${queryString}`, {
      method: tool.method,
      headers: withUserHeaders(tool.headers, userId),
      body: tool.method === "POST" ? JSON.stringify(call.args ?? {}) : undefined,
    });

    const data = await parseResponseData(res);

    if (res.ok) {
      return {
        name: call.name,
        ok: true,
        status: res.status,
        data,
        attempts,
        usedTool: tool.name,
      };
    }

    lastFailure = {
      name: call.name,
      ok: false,
      status: res.status,
      error: extractError(data),
      data,
      attempts,
      usedTool: tool.name,
    };

    const canRetry = attempts <= maxRetries && isTransientStatus(res.status);
    if (!canRetry) break;
    // 指數退避：backoffMs * 2^(attempts-1)，上限 8 秒
    const delay = Math.min(backoffMs * Math.pow(2, attempts - 1), 8_000);
    await wait(delay);
  }

  return lastFailure ?? {
    name: call.name,
    ok: false,
    error: "tool-http-error",
    attempts,
    usedTool: tool.name,
  };
}

export async function executeOrbToolCalls(
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult[]> {
  const byName = new Map(opts.tools.map(t => [t.name, t]));
  const out: OrbToolCallResult[] = [];

  for (const call of opts.calls) {
    const startedAt = Date.now();
    const requestId =
      opts.requestId ?? `orb_req_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
    const tool = byName.get(call.name);
    if (!tool) {
      const fail = { name: call.name, ok: false, error: "tool-not-found" } as const;
      out.push(fail);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        ok: false,
        error: fail.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }
    if ((opts.blockedTools ?? []).includes(call.name)) {
      const fail = { name: call.name, ok: false, error: "tool-blocked-by-user" } as const;
      out.push(fail);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        ok: false,
        error: fail.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }

    try {
      assertAllowedEndpoint(tool.endpoint);

      if (
        Array.isArray(tool.allowedRoles) &&
        tool.allowedRoles.length > 0 &&
        !tool.allowedRoles.includes(opts.userRole)
      ) {
        const fail = { name: call.name, ok: false, error: "forbidden-role" } as const;
        out.push(fail);
        opts.onAuditEvent?.({
          requestId,
          userId: opts.userId,
          userRole: opts.userRole,
          taskId: opts.taskId,
          stepId: opts.stepId,
          toolName: call.name,
          ok: false,
          error: fail.error,
          startedAt,
          endedAt: Date.now(),
        });
        continue;
      }

      if (tool.requireConfirmation && !opts.approved) {
        const fail = {
          name: call.name,
          ok: false,
          error: "confirmation-required",
        } as const;
        out.push(fail);
        opts.onAuditEvent?.({
          requestId,
          userId: opts.userId,
          userRole: opts.userRole,
          taskId: opts.taskId,
          stepId: opts.stepId,
          toolName: call.name,
          ok: false,
          error: fail.error,
          startedAt,
          endedAt: Date.now(),
        });
        continue;
      }
      let result = await executeWithRecovery(tool, call, opts.userId);
      if (!result.ok && Array.isArray(tool.fallbackTools) && tool.fallbackTools.length > 0) {
        const fallbackTool = tool.fallbackTools
          .map(name => byName.get(name))
          .find(
            candidate =>
              candidate &&
              (!candidate.allowedRoles ||
                candidate.allowedRoles.length === 0 ||
                candidate.allowedRoles.includes(opts.userRole))
          );
        if (fallbackTool) {
          assertAllowedEndpoint(fallbackTool.endpoint);
          const fallbackResult = await executeWithRecovery(fallbackTool, call, opts.userId);
          if (fallbackResult.ok) {
            result = {
              ...fallbackResult,
              name: call.name,
              usedTool: fallbackTool.name,
            };
          }
        }
      }
      out.push(result);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: result.usedTool,
        ok: result.ok,
        status: result.status,
        error: result.error,
        attempts: result.attempts,
        startedAt,
        endedAt: Date.now(),
      });
    } catch (err) {
      const fail = {
        name: call.name,
        ok: false,
        error: err instanceof Error ? err.message : "tool-execute-failed",
      };
      out.push(fail);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        ok: false,
        error: fail.error,
        startedAt,
        endedAt: Date.now(),
      });
    }
  }

  return out;
}

import { TRPCError } from "@trpc/server";
import { awaitFalQueueResult, type FalAwaitResult } from "./falQueueAwaiter";
import { checkAndConsumeQuota } from "./orbQuota";
import { injectModelPrompt } from "../../shared/modelPromptTemplates";
import { moderateOrbContent } from "../../shared/orb-content-moderation";

/** Tool names that consume a `generation` daily slot when executed. */
const GENERATION_SLOT_TOOLS = new Set([
  "studio.generateImage",
  "studio.generate3D",
  "studio.generateVideo",
  "studio.generateAudio",
  "studio.generateSfx",
  "studio.generateVoice",
  "studio.cloneVoice",
  "studio.designVoice",
  "studio.separateStems",
  "studio.isolateAudio",
  "studio.mergeAudios",
  "studio.changeVoice",
  "studio.animateSpeaker",
  "studio.enhanceVideo",
  "studio.trainLora",
]);

/**
 * Default wait budget for orb-side tool calls that dispatch to fal.ai's queue.
 * The orchestrator chains step N → step N+1 by reading step N's output_url
 * (image_url / video_url / audio_url) — and that output only exists after
 * fal completes, not after the queue submit returns. 120s covers the
 * majority of image / short-video generations; longer jobs get returned with
 * status="pending" + request_id so the caller can poll later or retry.
 */
const ORB_FAL_AWAIT_TIMEOUT_MS = 120_000;

interface FalDispatchEnvelope {
  request_id: string;
  modelId: string;
  degraded?: boolean;
}

/**
 * 解析光球工具的目標模型：
 *  1. 呼叫端有指定 modelId → 直接用
 *  2. 否則讀使用者大腦組態的對應 engine slot
 *  3. brain 載入失敗或 slot 為空 → 用 hardcoded fallback
 *
 * 同時應用於 studio.generateImage / generateVideo（t2v）/ generateAudio /
 * generateVoice，避免「使用者改了大腦組態，光球仍用舊預設」的回歸。
 */
async function resolveOrbEngine(
  requestedModelId: string,
  userId: number,
  slot: "imageEngine" | "videoEngine" | "audioEngine" | "voiceEngine",
  hardcodedFallback: string
): Promise<string> {
  if (requestedModelId) return requestedModelId;
  try {
    const { buildBrainContext } = await import("../middleware/brainContext");
    const brain = await buildBrainContext(userId);
    const fromBrain = brain.getEngine(slot).engine;
    if (fromBrain) return fromBrain;
  } catch {
    // brain 載入失敗（DB 不可用等），落到 fallback
  }
  return hardcodedFallback;
}

/**
 * Wait for a fal queue dispatch to terminate (completed / failed / pending),
 * then merge the awaited URLs into the dispatcher's envelope so downstream
 * step-ref placeholders (`${step1.video_url}`) resolve. Honours the
 * conventional `args.wait === false` opt-out for fire-and-forget callers.
 */
async function awaitFalForOrb(
  envelope: FalDispatchEnvelope,
  args: Record<string, unknown>
): Promise<FalDispatchEnvelope & Partial<FalAwaitResult>> {
  if (args.wait === false) return { ...envelope, status: "pending" };
  const timeoutMs =
    typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? Math.min(args.timeoutMs, 5 * 60_000)
      : ORB_FAL_AWAIT_TIMEOUT_MS;
  const awaited = await awaitFalQueueResult(
    envelope.request_id,
    envelope.modelId,
    { timeoutMs }
  );
  return {
    request_id: envelope.request_id,
    modelId: envelope.modelId,
    degraded: envelope.degraded ?? false,
    status: awaited.status,
    output_url: awaited.output_url,
    image_url: awaited.image_url,
    video_url: awaited.video_url,
    audio_url: awaited.audio_url,
    raw: awaited.raw,
    error: awaited.error,
  };
}

/**
 * 解析 studio.generateImage 的路由分類與圖片 URL 集合。
 * - 有 image_url 或 image_urls 陣列 → image-to-image
 * - 否則 → text-to-image
 * - 回傳的 imageUrls 會將 image_url 合併進 image_urls（fal.ai edit endpoints 需要陣列）
 *
 * @internal exported for unit tests
 */
export function resolveImageGenRouting(args: Record<string, unknown>): {
  category: "text-to-image" | "image-to-image";
  imageUrls: string[] | undefined;
} {
  const singleUrl =
    typeof args.image_url === "string" && args.image_url
      ? [args.image_url as string]
      : [];
  const multiUrls = Array.isArray(args.image_urls)
    ? (args.image_urls as string[]).filter(u => typeof u === "string" && u)
    : [];
  const isImageToImage = singleUrl.length > 0 || multiUrls.length > 0;
  const category: "text-to-image" | "image-to-image" = isImageToImage
    ? "image-to-image"
    : "text-to-image";
  // Merge image_url + image_urls into a deduplicated array for fal.ai edit endpoints
  const merged = isImageToImage
    ? Array.from(new Set([...singleUrl, ...multiUrls]))
    : undefined;
  return { category, imageUrls: merged };
}

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

    // ── research.deepSearch：Perplexity 深度搜尋（外部網路搜尋）──
    if (call.name === "research.deepSearch") {
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
      // v2: 整合重試中間件，外部搜尋 API 可能暫時不穩定
      const { withToolRetry, getDefaultRetryOptions } = await import("./orbToolRetry");
      const retryOpts = getDefaultRetryOptions(call.name);
      const retryResult = await withToolRetry(
        () => dispatchDeepSearchTool(call, opts),
        { ...retryOpts, toolName: call.name }
      );
      const deepSearchResult = retryResult.result;
      if (retryResult.retried) {
        console.info(
          `[ToolExecutor] research.deepSearch retried ${retryResult.attempts} times, ` +
          `total ${retryResult.totalDurationMs}ms, errors: ${retryResult.retryErrors?.join(", ") ?? "none"}`
        );
      }
      out.push(deepSearchResult);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: deepSearchResult.usedTool,
        ok: deepSearchResult.ok,
        error: deepSearchResult.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }

    // ── inspiration.fetch：Perplexity Sonar 即時靈感 / 時事 / 社群偏好 ──
    if (call.name === "inspiration.fetch") {
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
      const inspirationResult = await dispatchInspirationTool(call, opts);
      out.push(inspirationResult);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: inspirationResult.usedTool,
        ok: inspirationResult.ok,
        error: inspirationResult.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }

    // ── db.* 資料庫查詢工具：安全的資料庫存取 ──
    if (call.name.startsWith("db.")) {
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
      const dbResult = await dispatchDatabaseTool(call, opts);
      out.push(dbResult);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: dbResult.usedTool,
        ok: dbResult.ok,
        error: dbResult.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }

    // ── studio.* 生成工具：橋接到 dispatchFalQueueTask / SunoClient ──
    // ── director.* 規劃工具：橋接到 director.askForStudioPlan ──
    if (call.name.startsWith("studio.") || call.name.startsWith("director.")) {
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
      const bridgeResult = call.name.startsWith("studio.")
        ? await dispatchStudioTool(call, opts)
        : await dispatchDirectorTool(call, opts);
      out.push(bridgeResult);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: bridgeResult.usedTool,
        ok: bridgeResult.ok,
        error: bridgeResult.error,
        startedAt,
        endedAt: Date.now(),
      });
      continue;
    }

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

// ═══════════════════════════════════════════════════════════════════════════
// db.* 資料庫查詢工具橋接：安全的資料庫存取
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 橋接 db.* 資料庫查詢工具到 orbDatabaseTools.ts 的安全查詢執行器。
 * 所有查詢都是 user-scoped，使用預定義的查詢模板，只允許 SELECT 操作。
 */
async function dispatchDatabaseTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    executeDbQuery,
    validateQueryParams,
  } = await import("./orbDatabaseTools");

  // Extract query name from tool name (e.g., "db.list_my_assets" -> "list_my_assets")
  const queryName = call.name.replace(/^db\./, "") as any;
  const args = call.args ?? {};

  // Inject userId into query params (user-scoping security)
  const params = {
    ...args,
    userId: opts.userId,
  };

  // Validate parameters
  const validation = validateQueryParams(queryName, params);
  if (!validation.valid) {
    return {
      name: call.name,
      ok: false,
      error: validation.error ?? "invalid-parameters",
      usedTool: call.name,
    };
  }

  try {
    // Execute the safe database query
    const result = await executeDbQuery(queryName, params);

    if (!result.success) {
      return {
        name: call.name,
        ok: false,
        error: result.error ?? "database-query-failed",
        data: {
          queryName: result.queryName,
          executionTimeMs: result.executionTimeMs,
        },
        usedTool: call.name,
      };
    }

    return {
      name: call.name,
      ok: true,
      data: {
        queryName: result.queryName,
        rows: result.data,
        rowCount: result.rowCount,
        executionTimeMs: result.executionTimeMs,
      },
      usedTool: call.name,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ToolExecutor] db.${queryName} failed:`, errorMessage);

    return {
      name: call.name,
      ok: false,
      error: errorMessage,
      usedTool: call.name,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// studio.* 生成工具橋接：直接走 dispatchFalQueueTask / SunoClient
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 studio.generateImage / generateVideo / generateAudio / generateVoice
 * 工具呼叫橋接到後端對應的 fal.ai queue 任務或 Suno API。
 *
 * 流程：
 *  1. 從 shared/global-agent-tools 讀取定義，做 requireHuman 風險閘門
 *  2. 根據工具名稱選擇 category 與預設模型
 *  3. studio.generateAudio + modelId 起頭為 "suno" → 走 SunoClient.generateMusic
 *  4. 其餘走 dispatchFalQueueTask（含 fallback chain）
 *  5. 回傳 { request_id | taskId, modelId, engine } 供前端輪詢
 */
async function dispatchStudioTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { getGlobalAgentTool } = await import("../../shared/global-agent-tools");
  const def = getGlobalAgentTool(call.name);
  if (!def) {
    return {
      name: call.name,
      ok: false,
      error: "studio-tool-not-registered",
    };
  }

  // ── 風險閘門：requiresHuman 必須有 approved ──
  if (def.requiresHuman && !opts.approved) {
    return {
      name: call.name,
      ok: false,
      error: "confirmation-required",
    };
  }

  // ── 全站每日生成額度閘門 ──
  // The planner is told it has DAILY_LIMITS.generation slots/day; without
  // this gate the studio.* dispatchers ran unconstrained and the planner's
  // staging instructions were unenforceable. Counts only when the tool
  // actually consumes a generation slot (image/video/audio/voice/enhance/
  // train) — director.suggestPlan and other helpers stay free.
  if (GENERATION_SLOT_TOOLS.has(call.name)) {
    const quota = checkAndConsumeQuota("generation", { userId: opts.userId });
    if (!quota.allowed) {
      return {
        name: call.name,
        ok: false,
        error: quota.reason ?? "generation-quota-exceeded",
      };
    }
  }

  const args = (call.args ?? {}) as Record<string, unknown>;

  // ── DEF-AG3 內容審核閘門：每步的 prompt / text / script 過 moderateOrbContent ──
  // 之前 moderation 只 gate planner 的 reply。planner 通過、但個別 step 的
  // prompt 仍可能夾帶被禁內容（暴力 / 仇恨 / 露骨 / 自殘）— 沒這道 gate
  // 那段 prompt 會原文送進 fal.ai / Suno / ElevenLabs。block 時直接擋下，
  // warn 時不擋（self-harm 類別保留訊息但記 audit），讓使用者真的能看到提示。
  for (const key of ["prompt", "text", "script", "lyrics", "negative_prompt"] as const) {
    const value = args[key];
    if (typeof value !== "string" || value.length === 0) continue;
    const verdict = moderateOrbContent(value);
    if (verdict.action === "block") {
      const categories = Array.from(new Set(verdict.findings.map(f => f.category))).join(",");
      return {
        name: call.name,
        ok: false,
        error: `moderation-blocked:${categories || "policy"}`,
      };
    }
  }

  try {
    switch (call.name) {
      case "studio.generateImage": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        // img2img：有 image_url 或 image_urls 時改走 image-to-image 路由，
        // 讓 dispatcher 對 LoRA / 編輯類模型套對應的 fallback chain。
        const { category, imageUrls } = resolveImageGenRouting(args);
        // Category-aware default:當光球規劃 edit step 又沒明指 modelId 時,
        // 不能 fallback 到 t2i 模型(fal-ai/flux/dev),否則會把 edit 提示送到
        // 文生圖端點得到語意不對的結果。i2i 走 flux/dev/image-to-image,
        // 跟 brain config 的 falImageToImageEngine 預設一致。
        const hardcodedDefault =
          category === "image-to-image"
            ? "fal-ai/flux/dev/image-to-image"
            : "fal-ai/flux/dev";
        const modelId = await resolveOrbEngine(
          (args.modelId as string) || "",
          opts.userId,
          "imageEngine",
          hardcodedDefault
        );
        const input: Record<string, unknown> = {};
        // Inject the per-model prompt template so SD-style models get their
        // quality tags + negative defaults, FLUX gets cinematic suffixes,
        // SeeDream gets oriental aesthetic, etc. The user's literal prompt
        // and any user-supplied negative_prompt are always preserved; we
        // only add hints the model is documented to respond to.
        if (typeof args.prompt === "string") {
          const injection = injectModelPrompt(args.prompt, modelId, {
            userNegativePrompt:
              typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
          });
          input.prompt = injection.prompt;
          if (
            typeof args.negative_prompt !== "string" &&
            injection.defaultNegativePrompt
          ) {
            input.negative_prompt = injection.defaultNegativePrompt;
          }
        }
        if (typeof args.aspect_ratio === "string")
          input.aspect_ratio = args.aspect_ratio;
        if (typeof args.num_images === "number")
          input.num_images = args.num_images;
        if (typeof args.negative_prompt === "string")
          input.negative_prompt = args.negative_prompt;
        if (typeof args.image_url === "string") input.image_url = args.image_url;
        // Auto-populate image_urls from image_url for fal.ai edit endpoints
        if (imageUrls) input.image_urls = imageUrls;
        if (typeof args.strength === "number") input.strength = args.strength;
        if (typeof args.seed === "number") input.seed = args.seed;
        if (typeof args.guidance_scale === "number")
          input.guidance_scale = args.guidance_scale;
        if (typeof args.num_inference_steps === "number")
          input.num_inference_steps = args.num_inference_steps;
        if (typeof args.output_format === "string")
          input.output_format = args.output_format;
        // Model-specific edit params
        if (typeof args.resolution === "string") input.resolution = args.resolution;
        if (typeof args.mask_url === "string") input.mask_url = args.mask_url;
        if (typeof args.size === "string") input.size = args.size;
        if (typeof args.image_size === "string") input.image_size = args.image_size;
        // Upscale params
        if (typeof args.upscale_factor === "number") input.upscale_factor = args.upscale_factor;
        if (typeof args.upscale_mode === "string") input.upscale_mode = args.upscale_mode;
        if (typeof args.target_resolution === "string") input.target_resolution = args.target_resolution;
        // Pose detection params
        if (typeof args.detect_hand === "boolean") input.detect_hand = args.detect_hand;
        if (typeof args.detect_face === "boolean") input.detect_face = args.detect_face;
        if (typeof args.detect_body === "boolean") input.detect_body = args.detect_body;
        if (typeof args.lora_url === "string") {
          // fal LoRA-aware models 期望 loras 為陣列
          input.loras = [
            {
              path: args.lora_url,
              scale: typeof args.lora_scale === "number" ? args.lora_scale : 1,
            },
          ];
        }
        // ControlNet field
        if (typeof args.controlnet_conditioning_scale === "number")
          input.controlnet_conditioning_scale = args.controlnet_conditioning_scale;
        const r = await dispatchFalQueueTask({
          modelId,
          category,
          input,
          route: "orb-tool/studio.generateImage",
          modality: "image",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: {
            ...awaited,
            originalModel: r.originalModel,
            engine: "fal",
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      case "studio.generate3D": {
        // 3D 創作室統一入口：trellis-2 / sam-3/3d-objects / hunyuan3d-v3 /
        // hyper3d/rodin / hunyuan_world 五個模型共用一個工具,executor 根據
        // args 自動選 category 並組 payload。HunYuan3D v3 用 input_image_url,
        // 其他模型用 image_url — 兩個欄位都會填上去（procedure 端 zod 會挑用）。
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = (args.modelId as string) || "fal-ai/trellis-2";
        const input: Record<string, unknown> = {};
        // 通用：prompt / image / 多視角
        if (typeof args.prompt === "string") input.prompt = args.prompt;
        if (typeof args.image_url === "string") input.image_url = args.image_url;
        if (typeof args.input_image_url === "string")
          input.input_image_url = args.input_image_url;
        if (Array.isArray(args.image_urls))
          input.image_urls = args.image_urls as string[];
        if (typeof args.back_image_url === "string")
          input.back_image_url = args.back_image_url;
        if (typeof args.left_image_url === "string")
          input.left_image_url = args.left_image_url;
        if (typeof args.right_image_url === "string")
          input.right_image_url = args.right_image_url;
        // Trellis 2
        if (typeof args.resolution === "string" || typeof args.resolution === "number")
          input.resolution = args.resolution;
        if (typeof args.texture_size === "string" || typeof args.texture_size === "number")
          input.texture_size = args.texture_size;
        if (typeof args.remesh === "boolean") input.remesh = args.remesh;
        // HunYuan3D v3
        if (typeof args.enable_pbr === "boolean")
          input.enable_pbr = args.enable_pbr;
        if (typeof args.face_count === "number")
          input.face_count = args.face_count;
        if (typeof args.generate_type === "string")
          input.generate_type = args.generate_type;
        if (typeof args.polygon_type === "string")
          input.polygon_type = args.polygon_type;
        // SAM 3D
        if (typeof args.export_textured_glb === "boolean")
          input.export_textured_glb = args.export_textured_glb;
        if (typeof args.detection_threshold === "number")
          input.detection_threshold = args.detection_threshold;
        // Rodin
        if (typeof args.condition_mode === "string")
          input.condition_mode = args.condition_mode;
        if (typeof args.geometry_file_format === "string")
          input.geometry_file_format = args.geometry_file_format;
        if (typeof args.material === "string") input.material = args.material;
        if (typeof args.quality === "string") input.quality = args.quality;
        if (typeof args.use_hyper === "boolean")
          input.use_hyper = args.use_hyper;
        // HunYuan World
        if (typeof args.labels_fg1 === "string")
          input.labels_fg1 = args.labels_fg1;
        if (typeof args.labels_fg2 === "string")
          input.labels_fg2 = args.labels_fg2;
        if (typeof args.classes === "string") input.classes = args.classes;
        if (typeof args.export_drc === "boolean")
          input.export_drc = args.export_drc;
        // 通用 seed
        if (typeof args.seed === "number") input.seed = args.seed;
        // category：Rodin 純文字模式（有 prompt 但沒任何圖）→ text-to-3d；其餘走 image-to-3d。
        const hasAnyImage =
          typeof args.image_url === "string" ||
          typeof args.input_image_url === "string" ||
          (Array.isArray(args.image_urls) && args.image_urls.length > 0);
        const category: "text-to-3d" | "image-to-3d" =
          !hasAnyImage && typeof args.prompt === "string"
            ? "text-to-3d"
            : "image-to-3d";
        const r = await dispatchFalQueueTask({
          modelId,
          category,
          input,
          route: "orb-tool/studio.generate3D",
          modality: "image",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: {
            ...awaited,
            originalModel: r.originalModel,
            engine: "fal",
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      case "studio.generateVideo": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const hasVideo = typeof args.video_url === "string" && args.video_url;
        const hasImage = typeof args.image_url === "string" && args.image_url;
        // 路由優先序：video_url → v2v；image_url → i2v；其餘 → t2v
        const category: "text-to-video" | "image-to-video" | "video-to-video" =
          hasVideo ? "video-to-video" : hasImage ? "image-to-video" : "text-to-video";
        const defaultModelByCategory = {
          "video-to-video": "fal-ai/kling-video/v2.1/standard/video-to-video",
          "image-to-video": "fal-ai/kling-video/v2.1/pro/image-to-video",
          "text-to-video": "fal-ai/kling-video/v2.1/pro/text-to-video",
        } as const;
        // brain 的 videoEngine 是 t2v 預設；i2v / v2v 各自有結構性預設模型，不該被覆寫。
        const modelId =
          category === "text-to-video"
            ? await resolveOrbEngine(
                (args.modelId as string) || "",
                opts.userId,
                "videoEngine",
                defaultModelByCategory[category]
              )
            : (args.modelId as string) || defaultModelByCategory[category];
        const input: Record<string, unknown> = {};
        // Same per-model prompt enrichment as generateImage — Kling and Veo
        // benefit from cinematic motion descriptors, others fall back to
        // pass-through. User's negative_prompt is preserved if provided.
        if (typeof args.prompt === "string") {
          const injection = injectModelPrompt(args.prompt, modelId, {
            userNegativePrompt:
              typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
          });
          input.prompt = injection.prompt;
          if (
            typeof args.negative_prompt !== "string" &&
            injection.defaultNegativePrompt
          ) {
            input.negative_prompt = injection.defaultNegativePrompt;
          }
        }
        if (typeof args.image_url === "string") input.image_url = args.image_url;
        if (typeof args.end_image_url === "string")
          input.end_image_url = args.end_image_url;
        if (typeof args.video_url === "string") input.video_url = args.video_url;
        if (typeof args.strength === "number") input.strength = args.strength;
        if (typeof args.cfg_scale === "number") input.cfg_scale = args.cfg_scale;
        if (typeof args.duration === "number") input.duration = args.duration;
        if (typeof args.aspect_ratio === "string")
          input.aspect_ratio = args.aspect_ratio;
        if (typeof args.negative_prompt === "string")
          input.negative_prompt = args.negative_prompt;
        if (typeof args.seed === "number") input.seed = args.seed;
        if (typeof args.num_frames === "number")
          input.num_frames = args.num_frames;
        if (typeof args.fps === "number") input.fps = args.fps;
        if (typeof args.width === "number") input.width = args.width;
        if (typeof args.height === "number") input.height = args.height;
        const r = await dispatchFalQueueTask({
          modelId,
          category,
          input,
          route: "orb-tool/studio.generateVideo",
          modality: "video",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: { ...awaited, engine: "fal" },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      case "studio.enhanceVideo": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const operation = String(args.operation ?? "enhance");
        const defaultModelByOp = {
          upscale: "fal-ai/bytedance/upscaler/video",
          interpolate: "fal-ai/rife-v4.6/video",
          enhance: "fal-ai/topaz/video-enhance",
        } as const;
        const modelId =
          (args.modelId as string) ||
          defaultModelByOp[operation as keyof typeof defaultModelByOp] ||
          defaultModelByOp.enhance;
        const input: Record<string, unknown> = {};
        if (typeof args.video_url === "string") input.video_url = args.video_url;
        if (typeof args.upscale_factor === "number")
          input.upscale_factor = args.upscale_factor;
        if (typeof args.multiplier === "number")
          input.multiplier = args.multiplier;
        if (typeof args.output_fps === "number")
          input.output_fps = args.output_fps;
        if (typeof args.output_scale === "number")
          input.output_scale = args.output_scale;
        if (typeof args.topaz_model === "string")
          input.model = args.topaz_model;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "video-to-video",
          input,
          route: "orb-tool/studio.enhanceVideo",
          modality: "video",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: { ...awaited, operation, engine: "fal" },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      case "studio.generateAudio": {
        const requestedModel = (args.modelId as string) || "";
        // Suno 路徑：modelId 起頭為 "suno" 走 SunoClient
        if (requestedModel.toLowerCase().startsWith("suno")) {
          const { getOrchestrator } = await import("./modelClients");
          const { suno } = getOrchestrator();
          if (!suno.isAvailable) {
            return {
              name: call.name,
              ok: false,
              error: "SUNO_API_KEY 未設定",
            };
          }
          const sunoResult = await suno.generateMusic({
            prompt: (args.prompt as string) ?? "",
            instrumental: (args.instrumental as boolean) ?? false,
            lyrics: args.lyrics as string | undefined,
          });
          return {
            name: call.name,
            ok: true,
            data: {
              taskId: sunoResult.taskId,
              status: sunoResult.status,
              engine: "suno",
            },
            usedTool: call.name,
          };
        }

        // fal.ai 路徑（預設）
        // DEF-15：接通大腦 audioEngine — 光球代理/助手未指定 modelId 時，
        // 採用使用者大腦組態（含降級後的 fallback engine），而非硬編碼 ace-step。
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        let modelId = requestedModel;
        if (!modelId) {
          try {
            const { buildBrainContext } = await import("../middleware/brainContext");
            const brain = await buildBrainContext(opts.userId);
            modelId = brain.generation.audioEngine.engine || "fal-ai/ace-step";
          } catch {
            modelId = "fal-ai/ace-step";
          }
        }
        // DEF-So1 / DEF-M1 / DEF-M2：四個音樂引擎的欄位形狀互不相容，
        // 統一在此依 canonical modelId 構建正確的 fal 輸入：
        //   - Sonauto v2  → prompt + lyrics_prompt + tags[] + output_format + num_songs（無時長）
        //   - ACE-Step    → prompt + lyrics（可選）+ duration
        //   - Stable Audio → prompt + seconds_total + negative_prompt（可選）
        //   - MusicGen    → prompt + duration（不接受 lyrics/negative_prompt）
        // 過去 else 分支對所有非 Sonauto 引擎都送 lyrics+duration，導致 MusicGen
        // 收到無用 lyrics、Stable Audio 的時長被吃掉（fal 落回 30s 預設）。
        const { normalizeEngineModelId } = await import(
          "../../shared/engineModelIds"
        );
        const canonicalAudioModel = normalizeEngineModelId(modelId);
        const isSonauto = canonicalAudioModel === "sonauto/v2/text-to-music";
        const isAceStep = canonicalAudioModel === "fal-ai/ace-step";
        const isStableAudio = canonicalAudioModel === "fal-ai/stable-audio";
        const isMusicGen = canonicalAudioModel === "fal-ai/musicgen";

        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
        if (isSonauto) {
          if (typeof args.lyrics === "string") input.lyrics_prompt = args.lyrics;
          if (typeof args.tags === "string") {
            const tagsArr = args.tags.split(",").map(t => t.trim()).filter(Boolean);
            if (tagsArr.length) input.tags = tagsArr;
          } else if (Array.isArray(args.tags)) {
            input.tags = args.tags;
          }
          // DEF-So2：bpm 是 Sonauto 風格控制的關鍵欄位（影響節拍密度與曲種風格）。
          // 沒透傳 → 光球請求的「90 BPM lo-fi」最終生成成預設節拍歌曲。
          if (typeof args.bpm === "number") input.bpm = args.bpm;
          input.output_format = "mp3";
          input.num_songs = 1;
          // 注意：duration 由 Sonauto 自決，刻意不傳。
        } else if (isStableAudio) {
          const dur =
            typeof args.duration === "number" ? args.duration : undefined;
          if (dur !== undefined) input.seconds_total = dur;
          if (typeof args.negativePrompt === "string") {
            input.negative_prompt = args.negativePrompt;
          } else if (typeof args.negative_prompt === "string") {
            input.negative_prompt = args.negative_prompt;
          }
        } else if (isAceStep) {
          if (typeof args.lyrics === "string") input.lyrics = args.lyrics;
          if (typeof args.duration === "number") input.duration = args.duration;
        } else if (isMusicGen) {
          if (typeof args.duration === "number") input.duration = args.duration;
        } else {
          // 未知音樂引擎：保守傳 prompt + duration，由 dispatcher 的 fallback chain 處理。
          if (typeof args.duration === "number") input.duration = args.duration;
        }
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input,
          route: "orb-tool/studio.generateAudio",
          modality: "audio",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: { ...awaited, engine: "fal" },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      // DEF-SFX2 / DEF-EL4：光球專用 SFX 工具 — 與 generateAudio（音樂）分流，
      // 不接受 lyrics/tags 等音樂專屬欄位，路由到 SFX-capable 引擎。
      // 大腦 audioEngine 為 SFX-capable 時跟隨；否則退回 fal-ai/stable-audio。
      // ElevenLabs SFX 額外要求 ELEVENLABS_API_KEY，缺 key 時退回 stable-audio。
      case "studio.generateSfx": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const requestedModel = (args.modelId as string) || "";
        let modelId = requestedModel;
        const sfxCapable = new Set([
          "fal-ai/stable-audio",
          "fal-ai/mmaudio-v2",
          "fal-ai/audioldm2",
          "fal-ai/elevenlabs/sound-effects/v2",
          "fal-ai/elevenlabs/sound-effects",
        ]);
        if (!modelId) {
          try {
            const { buildBrainContext } = await import("../middleware/brainContext");
            const brain = await buildBrainContext(opts.userId);
            const brainEngine = brain.generation.audioEngine.engine;
            modelId = sfxCapable.has(brainEngine) ? brainEngine : "fal-ai/stable-audio";
          } catch {
            modelId = "fal-ai/stable-audio";
          }
        }
        const isElevenLabsSfx =
          modelId === "fal-ai/elevenlabs/sound-effects/v2" ||
          modelId === "fal-ai/elevenlabs/sound-effects";
        // 缺 ELEVENLABS_API_KEY 時退回 stable-audio，避免光球任務 401 浪費 step。
        if (isElevenLabsSfx && !process.env.ELEVENLABS_API_KEY) {
          modelId = "fal-ai/stable-audio";
        }
        const finalIsElevenLabs =
          modelId === "fal-ai/elevenlabs/sound-effects/v2" ||
          modelId === "fal-ai/elevenlabs/sound-effects";
        const sfxInput: Record<string, unknown> = {};
        if (typeof args.prompt === "string") {
          // ElevenLabs 用 text 欄位，其他 SFX 引擎用 prompt
          if (finalIsElevenLabs) sfxInput.text = args.prompt;
          else sfxInput.prompt = args.prompt;
        }
        const sfxCap = finalIsElevenLabs ? 22 : 30;
        const sfxDuration =
          typeof args.duration === "number" ? Math.min(args.duration, sfxCap) : undefined;
        if (sfxDuration !== undefined) {
          if (finalIsElevenLabs) {
            sfxInput.duration_seconds = sfxDuration;
          } else if (modelId === "fal-ai/stable-audio") {
            sfxInput.seconds_total = sfxDuration;
          } else {
            sfxInput.duration = sfxDuration;
          }
        }
        if (finalIsElevenLabs) {
          sfxInput.prompt_influence = 0.3;
        }
        const elevenLabsHeaders =
          finalIsElevenLabs && process.env.ELEVENLABS_API_KEY
            ? { "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY }
            : undefined;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input: sfxInput,
          route: "orb-tool/studio.generateSfx",
          modality: "audio",
          userId: opts.userId,
          ...(elevenLabsHeaders ? { extraHeaders: elevenLabsHeaders } : {}),
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: { ...awaited, engine: "fal", kind: "sfx" },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      // DEF-VC1 / DEF-IVC3：光球專用 voice cloning — 兩家 clone 引擎輸出格式不同：
      //   - Qwen 3 clone（預設，zero-shot 30 秒參考音訊內）
      //     → 回 speaker_embedding.url（.safetensors）；只能餵給 Qwen TTS
      //   - ElevenLabs IVC（永久建立 voice_id；需 1-3 分鐘參考 + ELEVENLABS_API_KEY）
      //     → 回 voice_id；可餵給 ElevenLabs 全家族 TTS / dubbing / voice-changer
      // 兩種輸出都 hoist 到 data 頂層，後續 step 可用 ${stepN.speaker_voice_embedding_file_url}
      // 或 ${stepN.voice_id} 接到 studio.generateVoice。
      case "studio.cloneVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        let modelId =
          (args.modelId as string) || "fal-ai/qwen-3-tts/clone-voice/1.7b";
        const isElevenLabsIvc = modelId === "fal-ai/elevenlabs/voice-cloning";
        // 缺 ELEVENLABS_API_KEY 時退回 Qwen clone（不需特殊 key）。
        if (isElevenLabsIvc && !process.env.ELEVENLABS_API_KEY) {
          modelId = "fal-ai/qwen-3-tts/clone-voice/1.7b";
        }
        const finalIsElevenLabsIvc = modelId === "fal-ai/elevenlabs/voice-cloning";
        const cloneInput: Record<string, unknown> = {};
        if (typeof args.audio_url === "string") cloneInput.audio_url = args.audio_url;
        if (finalIsElevenLabsIvc) {
          // ElevenLabs IVC 需要 name（必填）— args.name 缺失時用 timestamp 補
          cloneInput.name =
            typeof args.name === "string" && args.name
              ? args.name
              : `Cloned Voice ${new Date().toISOString().slice(0, 19)}`;
          if (typeof args.description === "string") {
            cloneInput.description = args.description;
          }
        } else {
          // Qwen clone 接受 reference_text（可選，提升品質）
          if (typeof args.reference_text === "string") {
            cloneInput.reference_text = args.reference_text;
          }
        }
        const elevenLabsHeaders =
          finalIsElevenLabsIvc && process.env.ELEVENLABS_API_KEY
            ? { "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY }
            : undefined;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-speech",
          input: cloneInput,
          route: "orb-tool/studio.cloneVoice",
          modality: "voice",
          userId: opts.userId,
          ...(elevenLabsHeaders ? { extraHeaders: elevenLabsHeaders } : {}),
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // 兩種引擎都 hoist 各自的 voice 識別子到 data 頂層 —
        //   - Qwen → speaker_voice_embedding_file_url（.safetensors）
        //   - ElevenLabs → voice_id（永久 ID，可被全家族 TTS 復用）
        const raw = awaited.raw as
          | {
              speaker_embedding?: { url?: string };
              voice?: { voice_id?: string };
              voice_id?: string;
            }
          | undefined;
        const speakerEmbedding = raw?.speaker_embedding?.url ?? null;
        const voiceId = raw?.voice?.voice_id ?? raw?.voice_id ?? null;
        const haveOutput = finalIsElevenLabsIvc ? !!voiceId : !!speakerEmbedding;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && haveOutput,
          data: {
            ...awaited,
            engine: "fal",
            kind: finalIsElevenLabsIvc ? "voice-clone-permanent" : "voice-clone",
            speaker_voice_embedding_file_url: speakerEmbedding,
            voice_id: voiceId,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !haveOutput && awaited.status !== "pending"
              ? {
                  error: finalIsElevenLabsIvc
                    ? "voice-clone: voice_id 缺失"
                    : "voice-clone: speaker_embedding 缺失",
                }
              : {}),
        };
      }

      // DEF-VD1：光球專用 voice design — 用文字描述設計虛擬聲音，輸出 speaker
      // embedding URL，後續 step 可帶 speaker_voice_embedding_file_url 給
      // studio.generateVoice 復用該設計音色。預設 fal-ai/qwen-3-tts/voice-design/1.7b。
      case "studio.designVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId =
          (args.modelId as string) || "fal-ai/qwen-3-tts/voice-design/1.7b";
        const designInput: Record<string, unknown> = {};
        if (typeof args.voice_description === "string") {
          designInput.voice_description = args.voice_description;
        }
        // text 為可選預覽文字（fal 會用設計出的聲音念這段文字回傳音檔），
        // 與 proStudio.qwenVoiceDesign:980 的預設一致。
        designInput.text =
          typeof args.text === "string" && args.text
            ? args.text
            : "你好，我是你設計的聲音。";
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-speech",
          input: designInput,
          route: "orb-tool/studio.designVoice",
          modality: "voice",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // 與 cloneVoice 同一回傳契約：把 speaker_embedding.url 平推到頂層 —
        // 後續 step 可用 ${stepN.speaker_voice_embedding_file_url} 接到 generateVoice。
        const speakerEmbedding =
          (awaited.raw as { speaker_embedding?: { url?: string } } | undefined)
            ?.speaker_embedding?.url ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!speakerEmbedding,
          data: {
            ...awaited,
            engine: "fal",
            kind: "voice-design",
            speaker_voice_embedding_file_url: speakerEmbedding,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !speakerEmbedding && awaited.status !== "pending"
              ? { error: "voice-design: speaker_embedding 缺失" }
              : {}),
        };
      }

      // DEF-DM2：光球專用音幹分離 — 把整首歌拆成 4 軌（vocals/drums/bass/other）
      // 或 6 軌（+guitar/piano，僅 htdemucs_6s）。後續 step 可用
      // ${stepN.vocals_url} / ${stepN.drums_url} 等接混音 / 替換人聲 / 取樣等流程。
      // 預設 fal-ai/demucs（htdemucs_ft），與 proStudio.demucs DEF-04 stems 強制
      // 限制邏輯一致 — 4 軌模型不送 guitar/piano，否則 fal 422。
      case "studio.separateStems": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = (args.modelId as string) || "fal-ai/demucs";
        const stemModel =
          typeof args.stem_model === "string" && args.stem_model
            ? args.stem_model
            : "htdemucs_ft";
        const SIX_STEM_MODELS = new Set(["htdemucs_6s"]);
        const stems = SIX_STEM_MODELS.has(stemModel)
          ? ["vocals", "drums", "bass", "other", "guitar", "piano"]
          : ["vocals", "drums", "bass", "other"];
        const outputFormat =
          args.output_format === "wav" ? "wav" : "mp3";
        const separateInput: Record<string, unknown> = {
          model: stemModel,
          stems,
          output_format: outputFormat,
        };
        if (typeof args.audio_url === "string") {
          separateInput.audio_url = args.audio_url;
        }
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input: separateInput,
          route: "orb-tool/studio.separateStems",
          modality: "audio",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // Demucs 回 { vocals: { url }, drums: { url }, ... } —— 把每軌 URL
        // 平推到 data 頂層，方便 step refs 使用 ${stepN.vocals_url} 等。
        const raw = awaited.raw as Record<string, { url?: string } | undefined> | undefined;
        const stemUrls: Record<string, string | null> = {};
        for (const stem of stems) {
          stemUrls[`${stem}_url`] = raw?.[stem]?.url ?? null;
        }
        const haveAnyStem = Object.values(stemUrls).some(Boolean);
        return {
          name: call.name,
          ok: awaited.status !== "failed" && haveAnyStem,
          data: {
            ...awaited,
            engine: "fal",
            kind: "stem-separation",
            stem_model: stemModel,
            ...stemUrls,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !haveAnyStem && awaited.status !== "pending"
              ? { error: "stem-separation: 所有 stem URL 缺失" }
              : {}),
        };
      }

      // DEF-AI3：光球專用音訊隔離 — 從含背景噪訊的錄音抽出乾淨人聲/語音。
      // 預設走 fal-ai/elevenlabs/audio-isolation（需 ELEVENLABS_API_KEY）；
      // 缺 key 時退回 fal-ai/demucs htdemucs_ft 並回傳 vocals 軌作為等價輸出。
      case "studio.isolateAudio": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        let modelId =
          (args.modelId as string) || "fal-ai/elevenlabs/audio-isolation";
        const isElevenLabsIsolation =
          modelId === "fal-ai/elevenlabs/audio-isolation";
        // 缺 ELEVENLABS_API_KEY 時退回 Demucs（取 vocals 軌即等同 isolation）。
        if (isElevenLabsIsolation && !process.env.ELEVENLABS_API_KEY) {
          modelId = "fal-ai/demucs";
        }
        const finalIsElevenLabs =
          modelId === "fal-ai/elevenlabs/audio-isolation";
        const isolationInput: Record<string, unknown> = {};
        if (typeof args.audio_url === "string") {
          isolationInput.audio_url = args.audio_url;
        }
        // Demucs 退回路徑：4 軌 htdemucs_ft 取 vocals 即等同 isolation
        if (modelId === "fal-ai/demucs") {
          isolationInput.model = "htdemucs_ft";
          isolationInput.stems = ["vocals", "drums", "bass", "other"];
          isolationInput.output_format = "mp3";
        }
        const elevenLabsHeaders =
          finalIsElevenLabs && process.env.ELEVENLABS_API_KEY
            ? { "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY }
            : undefined;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input: isolationInput,
          route: "orb-tool/studio.isolateAudio",
          modality: "audio",
          userId: opts.userId,
          ...(elevenLabsHeaders ? { extraHeaders: elevenLabsHeaders } : {}),
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // 兩條路徑的輸出形狀不同：
        //   - ElevenLabs isolation → audio.url（單軌）
        //   - Demucs vocals 退回路徑 → vocals.url（多軌之一）
        // 統一以 `audio_url` 平推到 data 頂層，後續 step 不需關心走哪條路徑。
        const raw = awaited.raw as
          | { audio?: { url?: string }; vocals?: { url?: string } }
          | undefined;
        const isolatedUrl =
          raw?.audio?.url ?? raw?.vocals?.url ?? awaited.audio_url ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!isolatedUrl,
          data: {
            ...awaited,
            engine: "fal",
            kind: "audio-isolation",
            audio_url: isolatedUrl,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !isolatedUrl && awaited.status !== "pending"
              ? { error: "audio-isolation: 隔離後音檔 URL 缺失" }
              : {}),
        };
      }

      // DEF-MA3：光球專用多音訊合併 — separateStems → 替換人聲 → mergeAudios
      // 三段式工作流的最後一塊。把多段音訊以 concatenate（序接）或 mix（混音）
      // 合併成一段。範例：分離歌曲後替換人聲、再與原伴奏混回成品。
      case "studio.mergeAudios": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId =
          (args.modelId as string) || "fal-ai/ffmpeg-api/merge-audios";
        const audioUrls = Array.isArray(args.audio_urls)
          ? args.audio_urls.filter(
              (u): u is string => typeof u === "string" && u.length > 0
            )
          : [];
        if (audioUrls.length < 2) {
          return {
            name: call.name,
            ok: false,
            error: "merge-audios: 至少需要 2 段 audio_urls",
            usedTool: call.name,
          };
        }
        const mergeStrategy =
          args.merge_strategy === "mix" ? "mix" : "concatenate";
        const mergeInput: Record<string, unknown> = {
          audio_urls: audioUrls.slice(0, 10), // fal 上限 10 段
          merge_strategy: mergeStrategy,
        };
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input: mergeInput,
          route: "orb-tool/studio.mergeAudios",
          modality: "audio",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // FFmpeg merge 通常回 audio.url（單一輸出）；統一以 data.audio_url 平推
        // 到頂層，後續 step 可用 ${stepN.audio_url} 接到 isolation / voiceChanger / 終端發布。
        const raw = awaited.raw as { audio?: { url?: string } } | undefined;
        const mergedUrl =
          raw?.audio?.url ?? awaited.audio_url ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!mergedUrl,
          data: {
            ...awaited,
            engine: "fal",
            kind: "merge-audios",
            merge_strategy: mergeStrategy,
            audio_url: mergedUrl,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !mergedUrl && awaited.status !== "pending"
              ? { error: "merge-audios: 合併後音檔 URL 缺失" }
              : {}),
        };
      }

      // DEF-VCH4：光球專用聲音變換 — 把現有錄音的聲音換成指定 voice_id，
      // 保留原始語速/停頓/情緒。需 ELEVENLABS_API_KEY proxy；缺 key 時無法降級
      // （因為產出的是「同樣語氣的不同聲音」，Qwen TTS 重念新文字無法等價）—
      // 因此缺 key 直接回 error 而非靜默替換引擎。
      case "studio.changeVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        if (!process.env.ELEVENLABS_API_KEY) {
          return {
            name: call.name,
            ok: false,
            error:
              "voice-changer: 需要 ELEVENLABS_API_KEY；本工具無等價替代品",
            usedTool: call.name,
          };
        }
        const modelId =
          (args.modelId as string) || "fal-ai/elevenlabs/voice-changer";
        const changeInput: Record<string, unknown> = {};
        if (typeof args.audio_url === "string") {
          changeInput.audio_url = args.audio_url;
        }
        if (typeof args.voice_id === "string") {
          changeInput.voice_id = args.voice_id;
        }
        if (typeof args.remove_background_noise === "boolean") {
          changeInput.remove_background_noise = args.remove_background_noise;
        }
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-audio",
          input: changeInput,
          route: "orb-tool/studio.changeVoice",
          modality: "audio",
          userId: opts.userId,
          extraHeaders: {
            "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY,
          },
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // ElevenLabs voice-changer 回 audio.url；統一以 data.audio_url 平推到頂層。
        const raw = awaited.raw as { audio?: { url?: string } } | undefined;
        const changedUrl = raw?.audio?.url ?? awaited.audio_url ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!changedUrl,
          data: {
            ...awaited,
            engine: "fal",
            kind: "voice-change",
            audio_url: changedUrl,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !changedUrl && awaited.status !== "pending"
              ? { error: "voice-change: 變聲後音檔 URL 缺失" }
              : {}),
        };
      }

      // DEF-WAN2：光球專用說話人動畫 — 靜態頭像 + 配音 → 對嘴說話影片。
      // 與 generateVideo 不同：必須帶 audio_url，產出對嘴影片而非純動畫。
      // 完成「文字稿 → TTS → 對嘴影片」全鏈最後一塊。
      case "studio.animateSpeaker": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId =
          (args.modelId as string) || "fal-ai/wan/v2.2-14b/speech-to-video";
        const animateInput: Record<string, unknown> = {};
        if (typeof args.image_url === "string") {
          animateInput.image_url = args.image_url;
        }
        if (typeof args.audio_url === "string") {
          animateInput.audio_url = args.audio_url;
        }
        if (typeof args.prompt === "string" && args.prompt) {
          animateInput.prompt = args.prompt;
        }
        if (typeof args.num_frames === "number") {
          // fal Wan 接受 16-200 frames（≈ 24fps，0.7-8.3 秒）
          animateInput.num_frames = Math.max(16, Math.min(200, args.num_frames));
        }
        if (!animateInput.image_url || !animateInput.audio_url) {
          return {
            name: call.name,
            ok: false,
            error: "animate-speaker: image_url 與 audio_url 都是必填",
            usedTool: call.name,
          };
        }
        const r = await dispatchFalQueueTask({
          modelId,
          category: "image-to-video",
          input: animateInput,
          route: "orb-tool/studio.animateSpeaker",
          modality: "video",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // Wan 回傳 { video: { url } }；統一以 data.video_url 平推到頂層。
        const raw = awaited.raw as { video?: { url?: string } } | undefined;
        const videoUrl = raw?.video?.url ?? awaited.video_url ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!videoUrl,
          data: {
            ...awaited,
            engine: "fal",
            kind: "speech-to-video",
            video_url: videoUrl,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !videoUrl && awaited.status !== "pending"
              ? { error: "animate-speaker: 對嘴影片 URL 缺失" }
              : {}),
        };
      }

      // DEF-ASR3：光球專用 ASR — 把音訊轉文字稿，後續 step 可接到 LLM
      // 翻譯／摘要 / 再合成。預設 Nemotron ASR Stream（自動偵測語言），
      // 不需特殊 key。標 riskLevel:low + requiresHuman:false 讓光球可自主呼叫
      // （與 generateVoice 不同 — generateVoice 產出新音訊需人類審核）。
      case "studio.transcribe": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId =
          (args.modelId as string) || "fal-ai/nemotron/asr/stream";
        const transcribeInput: Record<string, unknown> = {};
        if (typeof args.audio_url === "string") {
          transcribeInput.audio_url = args.audio_url;
        }
        if (typeof args.acceleration === "string") {
          transcribeInput.acceleration = args.acceleration;
        }
        const r = await dispatchFalQueueTask({
          modelId,
          category: "audio-to-text",
          input: transcribeInput,
          route: "orb-tool/studio.transcribe",
          modality: "voice",
          userId: opts.userId,
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        // ASR 模型回傳格式不一：Nemotron 回 { text, segments? }；wizper/whisper
        // 回 { text, chunks }。統一抓出 text 欄位平推到 data.text。
        const raw = awaited.raw as
          | { text?: string; transcription?: string }
          | undefined;
        const transcript = raw?.text ?? raw?.transcription ?? null;
        return {
          name: call.name,
          ok: awaited.status !== "failed" && !!transcript,
          data: {
            ...awaited,
            engine: "fal",
            kind: "transcription",
            text: transcript,
          },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error
            ? { error: awaited.error }
            : !transcript && awaited.status !== "pending"
              ? { error: "transcribe: 文字稿缺失" }
              : {}),
        };
      }

      case "studio.generateVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        // DEF-V2：光球 generateVoice 過去硬編碼 turbo-v2.5，從未讀使用者
        // 大腦 voiceEngine。改成：args.modelId > brain.voiceEngine > turbo-v2.5。
        let modelId = (args.modelId as string) || "";
        if (!modelId) {
          try {
            const { buildBrainContext } = await import("../middleware/brainContext");
            const brain = await buildBrainContext(opts.userId);
            modelId =
              brain.generation.voiceEngine.engine ||
              "fal-ai/elevenlabs/tts/turbo-v2.5";
          } catch {
            modelId = "fal-ai/elevenlabs/tts/turbo-v2.5";
          }
        }
        // DEF-V1：ElevenLabs proxy endpoint 必須帶 x-fal-client-credentials，
        // 否則 fal 回 401，光球 step 浪費掉。缺 key 時退回 turbo-v2.5 的呼叫但
        // 仍會 401；更安全的處理是退回不需 key 的 fal-ai/f5-tts。
        const isElevenLabsTts =
          modelId.startsWith("fal-ai/elevenlabs/tts/") ||
          modelId === "fal-ai/elevenlabs/tts";
        if (isElevenLabsTts && !process.env.ELEVENLABS_API_KEY) {
          modelId = "fal-ai/f5-tts";
        }
        // DEF-Q3 / DEF-D3：每家 TTS 欄位形狀不同 —
        //   - Qwen：voice（不是 voice_id）+ speaker_voice_embedding_file_url；不接受 speed
        //   - Dia voice-clone：只接受 text，且必須以 [S1]/[S2] 標籤標注說話者，
        //                       無 [S1] 標籤時 fal 回 422 — 與 proStudio.diaTTSVoiceClone:1015 行為對齊
        //   - ElevenLabs：voice_id + voice_settings + 原生 model_id（DEF-V10）
        //   - 其他（f5-tts / kokoro / orpheus）：voice_id + speed
        const isQwenTts = modelId.startsWith("fal-ai/qwen-3-tts/text-to-speech");
        const isDiaVoiceClone =
          modelId === "fal-ai/dia-tts/voice-clone" ||
          modelId === "fal-ai/dia-tts";
        const input: Record<string, unknown> = {};
        if (typeof args.text === "string") {
          input.text = isDiaVoiceClone && !/\[S\d\]/.test(args.text)
            ? `[S1] ${args.text}`
            : args.text;
        }
        if (isDiaVoiceClone) {
          // Dia 不接受 voice_id / speed / voice_settings — 跳過所有額外欄位
        } else if (isQwenTts) {
          const qwenVoice =
            (typeof args.voice_id === "string" && args.voice_id) ||
            (typeof args.voice === "string" && args.voice) ||
            "Vivian";
          input.voice = qwenVoice;
          if (typeof args.speaker_voice_embedding_file_url === "string") {
            input.speaker_voice_embedding_file_url =
              args.speaker_voice_embedding_file_url;
          }
        } else {
          if (typeof args.voice_id === "string") input.voice_id = args.voice_id;
          if (typeof args.speed === "number") input.speed = args.speed;
        }
        // DEF-V11：多語 TTS 與 ElevenLabs voice_settings 必須從光球 args
        // 傳到 fal payload，否則「日文 TTS」、「微調穩定度」這類請求會落回
        // 預設值。language_code 是 fal ElevenLabs proxy 的通用欄位（非 Dia
        // 專屬，且 Qwen 也接受），voice_settings 是 ElevenLabs 專屬聚合物。
        if (!isDiaVoiceClone && typeof args.language_code === "string") {
          input.language_code = args.language_code;
        }
        if (!isDiaVoiceClone && !isQwenTts) {
          const voiceSettings: Record<string, number> = {};
          if (typeof args.stability === "number")
            voiceSettings.stability = args.stability;
          if (typeof args.similarity_boost === "number")
            voiceSettings.similarity_boost = args.similarity_boost;
          if (typeof args.style === "number") voiceSettings.style = args.style;
          if (typeof args.use_speaker_boost === "boolean")
            voiceSettings.use_speaker_boost = args.use_speaker_boost ? 1 : 0;
          if (Object.keys(voiceSettings).length > 0) {
            input.voice_settings = voiceSettings;
          }
        }
        const finalIsElevenLabs =
          modelId.startsWith("fal-ai/elevenlabs/") &&
          !!process.env.ELEVENLABS_API_KEY;
        // DEF-V10：fal ElevenLabs proxy 需要 body.model_id（原生 ElevenLabs id），
        // 否則 V3 / Multilingual / Flash 會在 fal 端落到預設 Turbo。
        // 從 canonical fal 路徑回推（eleven-v3 → eleven_v3 等）。
        if (finalIsElevenLabs && !input.model_id) {
          const { nativeElevenLabsModelId } = await import(
            "../../shared/engineModelIds"
          );
          const nativeId = nativeElevenLabsModelId(modelId);
          if (nativeId) input.model_id = nativeId;
        }
        const elevenLabsHeaders = finalIsElevenLabs
          ? { "x-fal-client-credentials": process.env.ELEVENLABS_API_KEY! }
          : undefined;        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-speech",
          input,
          route: "orb-tool/studio.generateVoice",
          modality: "voice",
          userId: opts.userId,
          ...(elevenLabsHeaders ? { extraHeaders: elevenLabsHeaders } : {}),
        });
        const awaited = await awaitFalForOrb(
          { request_id: r.request_id, modelId: r.modelId, degraded: r.degraded ?? false },
          args
        );
        return {
          name: call.name,
          ok: awaited.status !== "failed",
          data: { ...awaited, engine: "fal" },
          usedTool: call.name,
          ...(awaited.status === "failed" && awaited.error ? { error: awaited.error } : {}),
        };
      }

      case "studio.trainLora": {
        // Kick off a LoRA / style / portrait / video-LoRA training run.
        // Training takes 5–30 minutes — too long to await synchronously
        // inside an HTTP request, so we create the model + background job
        // rows up front, return modelId/jobId immediately so the user can
        // monitor on /training-jobs, and let the worker write the result
        // back when fal completes.
        const trainingResult = await dispatchTrainingTool(call, opts);
        return trainingResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // orchestrator.* tools for chief-orchestrator (總總)
      // ════════════════════════════════════════════════════════════════════

      case "orchestrator.getTeamStatus": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      case "orchestrator.getSpiritStatus": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      case "orchestrator.delegateTask": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      case "orchestrator.queryProgress": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      case "orchestrator.escalateIssue": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      case "orchestrator.getStatistics": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      // ── 自主能力 tools (autonomy) ──
      case "orchestrator.decomposeGoal":
      case "orchestrator.recommendSpirit":
      case "orchestrator.analyzeBottlenecks":
      case "orchestrator.retryWithFallback":
      case "orchestrator.setDeadline": {
        const orchestratorResult = await dispatchOrchestratorTool(call, opts);
        return orchestratorResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // notesCurator.* tools for notes-curator (記記)
      // ════════════════════════════════════════════════════════════════════

      case "notesCurator.createNote": {
        const notesCuratorResult = await dispatchNotesCuratorTool(call, opts);
        return notesCuratorResult;
      }

      case "notesCurator.searchNotes": {
        const notesCuratorResult = await dispatchNotesCuratorTool(call, opts);
        return notesCuratorResult;
      }

      case "notesCurator.scheduleTask": {
        const notesCuratorResult = await dispatchNotesCuratorTool(call, opts);
        return notesCuratorResult;
      }

      case "notesCurator.tagAssets": {
        const notesCuratorResult = await dispatchNotesCuratorTool(call, opts);
        return notesCuratorResult;
      }

      case "notesCurator.getAssetStatistics": {
        const notesCuratorResult = await dispatchNotesCuratorTool(call, opts);
        return notesCuratorResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // settingsDetail.* tools for settings-detail (細細)
      // ════════════════════════════════════════════════════════════════════

      case "settingsDetail.getPreferences": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      case "settingsDetail.updatePreference": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      case "settingsDetail.explainSetting": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      case "settingsDetail.getAllSettings": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      case "settingsDetail.validatePreference": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // accountant.* tools for accountant (財財)
      // ════════════════════════════════════════════════════════════════════

      case "accountant.estimate":
      case "accountant.compare":
      case "accountant.usage":
      case "accountant.savings": {
        const accountantResult = await dispatchAccountantTool(call, opts);
        return accountantResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // companion.* tools for companion (暖暖)
      // ════════════════════════════════════════════════════════════════════

      case "companion.detectMood":
      case "companion.clarifyIntent":
      case "companion.recommendNextSpirit":
      case "companion.calmBreak": {
        const companionResult = await dispatchCompanionTool(call, opts);
        return companionResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // imageSpecialist.* tools for image-specialist (圖圖)
      // ════════════════════════════════════════════════════════════════════

      case "imageSpecialist.generate":
      case "imageSpecialist.edit":
      case "imageSpecialist.upscale":
      case "imageSpecialist.getModels":
      case "imageSpecialist.getTips": {
        const imageResult = await dispatchImageSpecialistTool(call, opts);
        return imageResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // videoSpecialist.* tools for video-specialist (影影)
      // ════════════════════════════════════════════════════════════════════

      case "videoSpecialist.generate":
      case "videoSpecialist.imageToVideo":
      case "videoSpecialist.lipSync":
      case "videoSpecialist.getModels":
      case "videoSpecialist.getTips": {
        const videoResult = await dispatchVideoSpecialistTool(call, opts);
        return videoResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // voiceSpecialist.* tools for voice-specialist (聲聲)
      // ════════════════════════════════════════════════════════════════════

      case "voiceSpecialist.generateSpeech":
      case "voiceSpecialist.transcribe":
      case "voiceSpecialist.getVoices":
      case "voiceSpecialist.getTips": {
        const voiceResult = await dispatchVoiceSpecialistTool(call, opts);
        return voiceResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // learningSpecialist.* tools for learning-specialist (學學)
      // ════════════════════════════════════════════════════════════════════

      case "learningSpecialist.getTutorial":
      case "learningSpecialist.listTutorials":
      case "learningSpecialist.getQuickTips": {
        const learningResult = await dispatchLearningSpecialistTool(call, opts);
        return learningResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // musicSpecialist.* tools for music-specialist (音音)
      // ════════════════════════════════════════════════════════════════════

      case "musicSpecialist.generate":
      case "musicSpecialist.generateSoundEffect":
      case "musicSpecialist.getOptions":
      case "musicSpecialist.getTips": {
        const musicResult = await dispatchMusicSpecialistTool(call, opts);
        return musicResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // trainingSpecialist.* tools for training-specialist (練練)
      // ════════════════════════════════════════════════════════════════════

      case "trainingSpecialist.train":
      case "trainingSpecialist.getStatus":
      case "trainingSpecialist.getTips": {
        const trainingResult = await dispatchTrainingSpecialistTool(call, opts);
        return trainingResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // legalAdvisor.* tools for legal-advisor (法法)
      // ════════════════════════════════════════════════════════════════════

      case "legalAdvisor.checkCompliance":
      case "legalAdvisor.checkLicense":
      case "legalAdvisor.getGuidelines": {
        const legalResult = await dispatchLegalAdvisorTool(call, opts);
        return legalResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // securityGuard.* tools for security-guard (守守)
      // ════════════════════════════════════════════════════════════════════

      case "securityGuard.checkHealth":
      case "securityGuard.scanSecurity":
      case "securityGuard.getRecommendations":
      case "securityGuard.reportIssue": {
        const securityResult = await dispatchSecurityGuardTool(call, opts);
        return securityResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // communityManager.* tools for community-manager (社社)
      // ════════════════════════════════════════════════════════════════════

      case "communityManager.submitFeedback":
      case "communityManager.getUserFeedback":
      case "communityManager.getAnnouncements":
      case "communityManager.getEngagementTips": {
        const communityResult = await dispatchCommunityManagerTool(call, opts);
        return communityResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // onboardingCoach.* tools for onboarding-coach (引引)
      // ════════════════════════════════════════════════════════════════════

      case "onboardingCoach.startOnboarding":
      case "onboardingCoach.trackProgress":
      case "onboardingCoach.getQuickStart": {
        const onboardingResult = await dispatchOnboardingCoachTool(call, opts);
        return onboardingResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // planExecutor.* tools for plan-executor (執執)
      // ════════════════════════════════════════════════════════════════════

      case "planExecutor.createPlan":
      case "planExecutor.executeStep":
      case "planExecutor.getStatus":
      case "planExecutor.getTemplates": {
        const planResult = await dispatchPlanExecutorTool(call, opts);
        return planResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // inspirationSpecialist.* tools for inspiration-specialist (靈靈)
      // ════════════════════════════════════════════════════════════════════

      case "inspirationSpecialist.searchTrends":
      case "inspirationSpecialist.getSuggestions":
      case "inspirationSpecialist.analyzeReference":
      case "inspirationSpecialist.getStyleMixing": {
        const inspirationSpecResult = await dispatchInspirationSpecialistTool(call, opts);
        return inspirationSpecResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // anatomySpecialist.* tools for anatomy-specialist (體體)
      // ════════════════════════════════════════════════════════════════════

      case "anatomySpecialist.buildPrompt":
      case "anatomySpecialist.nextClarification":
      case "anatomySpecialist.labelChecklist": {
        const anatomyResult = await dispatchAnatomySpecialistTool(call, opts);
        return anatomyResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // memoryManager.* tools for memory-manager (記記)
      // ════════════════════════════════════════════════════════════════════

      case "memoryManager.storeMemory":
      case "memoryManager.searchMemories":
      case "memoryManager.getStats":
      case "memoryManager.consolidate": {
        const memoryResult = await dispatchMemoryManagerTool(call, opts);
        return memoryResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // clarificationEngine.* tools for intent clarification
      // ════════════════════════════════════════════════════════════════════

      case "clarificationEngine.identifyIntent":
      case "clarificationEngine.recordAnswer":
      case "clarificationEngine.getPattern":
      case "clarificationEngine.getStats": {
        const clarificationResult = await dispatchClarificationEngineTool(call, opts);
        return clarificationResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // featureDiscovery.* tools for feature usage tracking
      // ════════════════════════════════════════════════════════════════════

      case "featureDiscovery.recordUsage":
      case "featureDiscovery.recordDiscovery":
      case "featureDiscovery.getStats":
      case "featureDiscovery.getRecommendations":
      case "featureDiscovery.getInsights": {
        const featureResult = await dispatchFeatureDiscoveryTool(call, opts);
        return featureResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // workflowEngine.* tools for workflow automation
      // ════════════════════════════════════════════════════════════════════

      case "workflowEngine.createTemplate":
      case "workflowEngine.getTemplates":
      case "workflowEngine.executeWorkflow":
      case "workflowEngine.getStatus":
      case "workflowEngine.controlWorkflow":
      case "workflowEngine.getHistory": {
        const workflowResult = await dispatchWorkflowEngineTool(call, opts);
        return workflowResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // systemMonitor.* tools for system health monitoring
      // ════════════════════════════════════════════════════════════════════

      case "systemMonitor.getHealth":
      case "systemMonitor.getCostAnalysis":
      case "systemMonitor.getCollaborationStats":
      case "systemMonitor.getPerformanceTrends": {
        const monitorResult = await dispatchSystemMonitorTool(call, opts);
        return monitorResult;
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown-studio-tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// accountant.* 工具橋接：財財（accountant）的成本控制工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 accountant.* 工具呼叫橋接到 accountantTools 服務。
 * 提供財財（accountant）即時呼叫的能力：
 * - accountant.estimate: 精算單次任務點數
 * - accountant.compare:  列出同類別所有模型 + 在這個 params 下的點數比較
 * - accountant.usage:    取使用者近 30 天用量摘要
 * - accountant.savings:  對特定模型給可替換的省法 + 預估省幾點 + tier 風險
 *
 * 四個工具都是唯讀（無扣款 / 無 DB 寫入），可放心對 LLM 開放、無需 approval。
 * category 在 compare 工具裡會白名單驗證；非合法 enum 直接返回 400。
 */
async function dispatchAccountantTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    estimateCost,
    compareModels,
    getMonthlyUsage,
    suggestSavings,
  } = await import("./spiritTools/accountantTools");
  const { MODEL_PRICING_CATALOG } = await import("./modelPricing");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "accountant.estimate": {
        const modelId = typeof args.modelId === "string" ? args.modelId.trim() : "";
        if (!modelId) {
          return { name: call.name, ok: false, error: "modelId is required" };
        }
        const result = estimateCost({
          modelId,
          durationSec: typeof args.durationSec === "number" ? args.durationSec : undefined,
          charCount: typeof args.charCount === "number" ? args.charCount : undefined,
          imageCount: typeof args.imageCount === "number" ? args.imageCount : undefined,
          trainingSteps: typeof args.trainingSteps === "number" ? args.trainingSteps : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.compare": {
        const category = typeof args.category === "string" ? args.category.trim() : "";
        if (!category) {
          return { name: call.name, ok: false, error: "category is required" };
        }
        // Validate category against catalog. We don't trust LLM-supplied enums
        // — pass an unknown category and we'd silently return an empty list,
        // which is worse than a clear error.
        const knownCategories = new Set(
          Object.values(MODEL_PRICING_CATALOG).map(p => p.category)
        );
        if (!knownCategories.has(category as never)) {
          return {
            name: call.name,
            ok: false,
            error: `unknown category: ${category}. Valid examples: ${Array.from(knownCategories).slice(0, 5).join(", ")}…`,
          };
        }
        const result = compareModels({
          category: category as Parameters<typeof compareModels>[0]["category"],
          durationSec: typeof args.durationSec === "number" ? args.durationSec : undefined,
          charCount: typeof args.charCount === "number" ? args.charCount : undefined,
          imageCount: typeof args.imageCount === "number" ? args.imageCount : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.usage": {
        const result = await getMonthlyUsage(opts.userId);
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.savings": {
        const modelId = typeof args.modelId === "string" ? args.modelId.trim() : "";
        if (!modelId) {
          return { name: call.name, ok: false, error: "modelId is required" };
        }
        const result = suggestSavings({
          modelId,
          durationSec: typeof args.durationSec === "number" ? args.durationSec : undefined,
          charCount: typeof args.charCount === "number" ? args.charCount : undefined,
          imageCount: typeof args.imageCount === "number" ? args.imageCount : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown accountant tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// companion.* 工具橋接：暖暖（companion）的情緒 / 意圖 / 交棒 / 穩定情緒工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 companion.* 工具呼叫橋接到 companionTools 服務。
 * 暖暖（companion）以前是純 LLM 人格、tools: []，現在升級為真實 AI agent：
 * - companion.detectMood: 從文字抽情緒標籤 + 強度
 * - companion.clarifyIntent: 把模糊訊息結構化 (modality / urgency / 下一步)
 * - companion.recommendNextSpirit: 依情緒 + 意圖挑下一棒精靈 + 招呼語
 * - companion.calmBreak: 偵測到沮喪 / 卡關時給 3 步穩定方案
 *
 * 全部唯讀純函式（無 DB / 無外部 API / 無扣點），對 LLM 開放、無需 approval。
 * 暖暖人格守則保留：工具不執行動作，只回結構化資料給 LLM 念出來。
 */
async function dispatchCompanionTool(
  call: OrbToolCall,
  _opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    detectMood,
    clarifyIntent,
    recommendNextSpirit,
    calmBreak,
  } = await import("./spiritTools/companionTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "companion.detectMood": {
        const text = typeof args.text === "string" ? args.text : "";
        const result = detectMood({ text });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "companion.clarifyIntent": {
        const text = typeof args.text === "string" ? args.text : "";
        const pagePath =
          typeof args.pagePath === "string" ? args.pagePath : null;
        const result = clarifyIntent({ text, pagePath });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "companion.recommendNextSpirit": {
        const text = typeof args.text === "string" ? args.text : "";
        const mood =
          typeof args.mood === "string"
            ? (args.mood as Parameters<typeof recommendNextSpirit>[0]["mood"])
            : undefined;
        const pagePath =
          typeof args.pagePath === "string" ? args.pagePath : null;
        const mutedSpirits = Array.isArray(args.mutedSpirits)
          ? (args.mutedSpirits as Parameters<typeof recommendNextSpirit>[0]["mutedSpirits"])
          : undefined;
        const result = recommendNextSpirit({ text, mood, pagePath, mutedSpirits });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "companion.calmBreak": {
        const mood =
          typeof args.mood === "string"
            ? (args.mood as Parameters<typeof calmBreak>[0]["mood"])
            : "neutral";
        const turnCount =
          typeof args.turnCount === "number" ? args.turnCount : undefined;
        const result = calmBreak({ mood, turnCount });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown companion tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// orchestrator.* 工具橋接：總總（chief-orchestrator）的精靈調度與監控工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 orchestrator.* 工具呼叫橋接到 orchestratorTools 服務。
 * 提供總總（chief-orchestrator）調度所有精靈的能力：
 * - orchestrator.getTeamStatus: 查看所有精靈狀態
 * - orchestrator.getSpiritStatus: 查看特定精靈狀態
 * - orchestrator.delegateTask: 分配任務給精靈
 * - orchestrator.queryProgress: 查詢任務進度
 * - orchestrator.escalateIssue: 升級精靈執行失敗
 * - orchestrator.getStatistics: 監控統計資料
 */
async function dispatchOrchestratorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    getAllSpiritsStatus,
    getSpiritStatus,
    getSpiritsForUser,
    delegateTaskToSpirit,
    queryTaskProgress,
    escalateIssue,
    getMonitoringStatistics,
    decomposeGoal,
    recommendSpiritForTask,
    analyzeBottlenecks,
    retryTaskWithFallback,
    setTaskDeadline,
  } = await import("./spiritTools/orchestratorTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "orchestrator.getTeamStatus": {
        // Get complete team status including all spirits
        const teamStatus = getAllSpiritsStatus();

        return {
          name: call.name,
          ok: true,
          data: {
            totalSpirits: teamStatus.totalSpirits,
            idleCount: teamStatus.idleCount,
            busyCount: teamStatus.busyCount,
            errorCount: teamStatus.errorCount,
            offlineCount: teamStatus.offlineCount,
            spirits: teamStatus.spirits,
            longRunningTasks: teamStatus.longRunningTasks,
            recentErrors: teamStatus.recentErrors,
          },
          usedTool: call.name,
        };
      }

      case "orchestrator.getSpiritStatus": {
        // Get status of a specific spirit
        const spiritId = args.spiritId as string;
        if (!spiritId) {
          return {
            name: call.name,
            ok: false,
            error: "spiritId is required",
          };
        }

        const status = getSpiritStatus(spiritId as any);
        if (!status) {
          return {
            name: call.name,
            ok: false,
            error: `Spirit ${spiritId} not found`,
          };
        }

        return {
          name: call.name,
          ok: true,
          data: status,
          usedTool: call.name,
        };
      }

      case "orchestrator.delegateTask": {
        // Delegate a task to a specific spirit
        const spiritId = args.spiritId as string;
        const taskId = args.taskId as string;
        const taskType = args.taskType as string;

        if (!spiritId || !taskId || !taskType) {
          return {
            name: call.name,
            ok: false,
            error: "spiritId, taskId, and taskType are required",
          };
        }

        const result = await delegateTaskToSpirit({
          spiritId: spiritId as any,
          taskId,
          taskType,
          userId: opts.userId,
          metadata: args.metadata as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            message: result.message,
            spiritStatus: result.spiritStatus,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "orchestrator.queryProgress": {
        // Query progress of a specific task
        const taskId = args.taskId as string;
        if (!taskId) {
          return {
            name: call.name,
            ok: false,
            error: "taskId is required",
          };
        }

        const progress = queryTaskProgress(taskId);

        return {
          name: call.name,
          ok: progress.found,
          data: progress,
          usedTool: call.name,
          ...(progress.found ? {} : { error: "Task not found" }),
        };
      }

      case "orchestrator.escalateIssue": {
        // Escalate an issue when a spirit encounters an error
        const spiritId = args.spiritId as string;
        const taskId = args.taskId as string;
        const issue = args.issue as string;
        const severity = (args.severity as "warning" | "error" | "critical") || "error";

        if (!spiritId || !taskId || !issue) {
          return {
            name: call.name,
            ok: false,
            error: "spiritId, taskId, and issue are required",
          };
        }

        const result = await escalateIssue({
          spiritId: spiritId as any,
          taskId,
          issue,
          severity,
        });

        return {
          name: call.name,
          ok: result.escalated,
          data: {
            escalated: result.escalated,
            recommendations: result.recommendations,
            alternativeSpirits: result.alternativeSpirits,
          },
          usedTool: call.name,
        };
      }

      case "orchestrator.getStatistics": {
        // Get monitoring statistics
        const stats = getMonitoringStatistics();

        return {
          name: call.name,
          ok: true,
          data: stats,
          usedTool: call.name,
        };
      }

      case "orchestrator.decomposeGoal": {
        // 把使用者目標拆成精靈分派 DAG — 給總總當骨架，他再用 LLM 細化。
        const userMessage = args.userMessage as string;
        if (!userMessage || typeof userMessage !== "string") {
          return {
            name: call.name,
            ok: false,
            error: "userMessage is required",
          };
        }

        const plan = decomposeGoal({
          userMessage,
          domainHints: args.domainHints as ReadonlyArray<never> | undefined,
        });

        return {
          name: call.name,
          ok: true,
          data: plan,
          usedTool: call.name,
        };
      }

      case "orchestrator.recommendSpirit": {
        // 智能推薦：領域 + 負載 + 歷史成功率 三維打分。
        const recommendations = recommendSpiritForTask({
          domain: args.domain as never,
          taskHint: args.taskHint as string | undefined,
          specialisation: args.specialisation as string | undefined,
          taskType: args.taskType as string | undefined,
          excludeSpirits: args.excludeSpirits as ReadonlyArray<never> | undefined,
        });

        return {
          name: call.name,
          ok: true,
          data: {
            recommendations,
            top: recommendations[0] ?? null,
          },
          usedTool: call.name,
        };
      }

      case "orchestrator.analyzeBottlenecks": {
        // 主動瓶頸分析：卡住任務 + 失敗聚類 + 到期風險。
        const analysis = analyzeBottlenecks();
        return {
          name: call.name,
          ok: true,
          data: analysis,
          usedTool: call.name,
        };
      }

      case "orchestrator.retryWithFallback": {
        // 自動降級重試：原精靈失敗 → 切替代精靈。
        const failedSpiritId = args.failedSpiritId as string;
        const failedTaskId = args.failedTaskId as string;
        const taskType = args.taskType as string;
        const failureReason = (args.failureReason as string) ?? "unspecified failure";

        if (!failedSpiritId || !failedTaskId || !taskType) {
          return {
            name: call.name,
            ok: false,
            error: "failedSpiritId, failedTaskId, and taskType are required",
          };
        }

        const result = await retryTaskWithFallback({
          failedSpiritId: failedSpiritId as never,
          failedTaskId,
          taskType,
          userId: opts.userId,
          failureReason,
          preferredAlternatives: args.preferredAlternatives as ReadonlyArray<never> | undefined,
          taskHint: args.taskHint as string | undefined,
        });

        return {
          name: call.name,
          ok: result.retrying,
          data: result,
          usedTool: call.name,
          ...(result.retrying ? {} : { error: result.message }),
        };
      }

      case "orchestrator.setDeadline": {
        // 為任務加 SLA 截止時間，到期風險會出現在 team summary。
        const taskId = args.taskId as string;
        const deadlineAt = args.deadlineAt as number;

        if (!taskId || typeof deadlineAt !== "number") {
          return {
            name: call.name,
            ok: false,
            error: "taskId and numeric deadlineAt are required",
          };
        }

        const result = setTaskDeadline({ taskId, deadlineAt });
        return {
          name: call.name,
          ok: result.set,
          data: result,
          usedTool: call.name,
          ...(result.set ? {} : { error: result.message }),
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown orchestrator tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// notesCurator.* 工具橋接：記記（notes-curator）的筆記與資產管理工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 notesCurator.* 工具呼叫橋接到 notesCuratorTools 服務。
 * 提供記記（notes-curator）筆記與資產管理的能力：
 * - notesCurator.createNote: 建立新筆記
 * - notesCurator.searchNotes: 搜尋筆記
 * - notesCurator.scheduleTask: 排程任務
 * - notesCurator.tagAssets: 為資產加上標籤
 * - notesCurator.getAssetStatistics: 取得資產統計與建議
 */
async function dispatchNotesCuratorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    createNote,
    searchNotes,
    scheduleTask,
    tagAssets,
    getAssetStatistics,
  } = await import("./spiritTools/notesCuratorTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "notesCurator.createNote": {
        const title = args.title as string;
        const content = args.content as string;

        if (!title || !content) {
          return {
            name: call.name,
            ok: false,
            error: "title and content are required",
          };
        }

        const result = await createNote({
          userId: opts.userId,
          title,
          content,
          tags: args.tags as string[] | undefined,
          category: args.category as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            noteId: result.noteId,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "notesCurator.searchNotes": {
        const query = args.query as string;

        if (!query) {
          return {
            name: call.name,
            ok: false,
            error: "query is required",
          };
        }

        const result = await searchNotes({
          userId: opts.userId,
          query,
          limit: args.limit as number | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            notes: result.notes,
            total: result.total,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: "search failed" }),
        };
      }

      case "notesCurator.scheduleTask": {
        const taskName = args.taskName as string;
        const scheduledFor = args.scheduledFor as string;

        if (!taskName || !scheduledFor) {
          return {
            name: call.name,
            ok: false,
            error: "taskName and scheduledFor are required",
          };
        }

        const result = await scheduleTask({
          userId: opts.userId,
          taskName,
          scheduledFor,
          description: args.description as string | undefined,
          metadata: args.metadata as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            jobId: result.jobId,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "notesCurator.tagAssets": {
        const assetIds = args.assetIds as number[];
        const tags = args.tags as string[];
        const action = (args.action as "add" | "remove" | "replace") || "add";

        if (!Array.isArray(assetIds) || !Array.isArray(tags)) {
          return {
            name: call.name,
            ok: false,
            error: "assetIds and tags must be arrays",
          };
        }

        const result = await tagAssets({
          userId: opts.userId,
          assetIds,
          tags,
          action,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            updated: result.updated,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "notesCurator.getAssetStatistics": {
        const result = await getAssetStatistics(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            statistics: result.statistics,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: "failed to get statistics" }),
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown notesCurator tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// settingsDetail.* 工具橋接：細細（settings-detail）的設定管理工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 settingsDetail.* 工具呼叫橋接到 settingsDetailTools 服務。
 * 提供細細（settings-detail）設定管理的能力：
 * - settingsDetail.getPreferences: 取得使用者偏好設定
 * - settingsDetail.updatePreference: 更新單一偏好設定
 * - settingsDetail.explainSetting: 解釋設定項目
 * - settingsDetail.getAllSettings: 取得所有可用設定
 * - settingsDetail.validatePreference: 驗證偏好設定值
 */
async function dispatchSettingsDetailTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    getPreferences,
    updatePreference,
    explainSetting,
    getAllSettings,
    validatePreference,
  } = await import("./spiritTools/settingsDetailTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "settingsDetail.getPreferences": {
        const result = await getPreferences(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            preferences: result.preferences,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: "failed to get preferences" }),
        };
      }

      case "settingsDetail.updatePreference": {
        const key = args.key as string;
        const value = args.value;

        if (!key || value === undefined) {
          return {
            name: call.name,
            ok: false,
            error: "key and value are required",
          };
        }

        // Validate before updating
        const validation = validatePreference(key, value);
        if (!validation.valid) {
          return {
            name: call.name,
            ok: false,
            error: validation.error,
            data: {
              suggestion: validation.suggestion,
            },
          };
        }

        const result = await updatePreference({
          userId: opts.userId,
          key,
          value,
        });

        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "settingsDetail.explainSetting": {
        const settingKey = args.settingKey as string;

        if (!settingKey) {
          return {
            name: call.name,
            ok: false,
            error: "settingKey is required",
          };
        }

        const result = explainSetting(settingKey);

        return {
          name: call.name,
          ok: result.found,
          data: {
            found: result.found,
            explanation: result.explanation,
          },
          usedTool: call.name,
          ...(result.found ? {} : { error: "setting not found" }),
        };
      }

      case "settingsDetail.getAllSettings": {
        const result = getAllSettings();

        return {
          name: call.name,
          ok: true,
          data: {
            settings: result.settings,
          },
          usedTool: call.name,
        };
      }

      case "settingsDetail.validatePreference": {
        const key = args.key as string;
        const value = args.value;

        if (!key || value === undefined) {
          return {
            name: call.name,
            ok: false,
            error: "key and value are required",
          };
        }

        const result = validatePreference(key, value);

        return {
          name: call.name,
          ok: true,
          data: {
            valid: result.valid,
            error: result.error,
            suggestion: result.suggestion,
          },
          usedTool: call.name,
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown settingsDetail tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// imageSpecialist.* 工具橋接：圖圖（image-specialist）的圖片生成工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 imageSpecialist.* 工具呼叫橋接到 imageSpecialistTools 服務。
 */
async function dispatchImageSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    generateImage,
    editImage,
    upscaleImage,
    getImageModels,
    getImageGenerationTips,
  } = await import("./spiritTools/imageSpecialistTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "imageSpecialist.generate": {
        const prompt = args.prompt as string;
        if (!prompt) {
          return {
            name: call.name,
            ok: false,
            error: "prompt is required",
          };
        }

        const result = await generateImage({
          userId: opts.userId,
          prompt,
          modelId: args.modelId as string | undefined,
          aspectRatio: args.aspectRatio as string | undefined,
          numImages: args.numImages as number | undefined,
          negativePrompt: args.negativePrompt as string | undefined,
          seed: args.seed as number | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "imageSpecialist.edit": {
        const imageUrl = args.imageUrl as string;
        const prompt = args.prompt as string;

        if (!imageUrl || !prompt) {
          return {
            name: call.name,
            ok: false,
            error: "imageUrl and prompt are required",
          };
        }

        const result = await editImage({
          userId: opts.userId,
          imageUrl,
          prompt,
          strength: args.strength as number | undefined,
          maskUrl: args.maskUrl as string | undefined,
          modelId: args.modelId as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "imageSpecialist.upscale": {
        const imageUrl = args.imageUrl as string;

        if (!imageUrl) {
          return {
            name: call.name,
            ok: false,
            error: "imageUrl is required",
          };
        }

        const result = await upscaleImage({
          userId: opts.userId,
          imageUrl,
          scaleFactor: args.scaleFactor as number | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "imageSpecialist.getModels": {
        const result = getImageModels();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "imageSpecialist.getTips": {
        const result = getImageGenerationTips(args.scenario as string | undefined);
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown imageSpecialist tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// videoSpecialist.* 工具橋接：影影（video-specialist）的影片生成工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 videoSpecialist.* 工具呼叫橋接到 videoSpecialistTools 服務。
 */
async function dispatchVideoSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    generateVideo,
    imageToVideo,
    createLipSync,
    getVideoModels,
    getVideoGenerationTips,
  } = await import("./spiritTools/videoSpecialistTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "videoSpecialist.generate": {
        const prompt = args.prompt as string;
        if (!prompt) {
          return {
            name: call.name,
            ok: false,
            error: "prompt is required",
          };
        }

        const result = await generateVideo({
          userId: opts.userId,
          prompt,
          modelId: args.modelId as string | undefined,
          duration: args.duration as number | undefined,
          aspectRatio: args.aspectRatio as string | undefined,
          fps: args.fps as number | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "videoSpecialist.imageToVideo": {
        const imageUrl = args.imageUrl as string;
        if (!imageUrl) {
          return {
            name: call.name,
            ok: false,
            error: "imageUrl is required",
          };
        }

        const result = await imageToVideo({
          userId: opts.userId,
          imageUrl,
          prompt: args.prompt as string | undefined,
          modelId: args.modelId as string | undefined,
          duration: args.duration as number | undefined,
          motion: args.motion as "subtle" | "moderate" | "dynamic" | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "videoSpecialist.lipSync": {
        const videoUrl = args.videoUrl as string;
        const audioUrl = args.audioUrl as string;

        if (!videoUrl || !audioUrl) {
          return {
            name: call.name,
            ok: false,
            error: "videoUrl and audioUrl are required",
          };
        }

        const result = await createLipSync({
          userId: opts.userId,
          videoUrl,
          audioUrl,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "videoSpecialist.getModels": {
        const result = getVideoModels();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "videoSpecialist.getTips": {
        const result = getVideoGenerationTips();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown videoSpecialist tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// voiceSpecialist.* 工具橋接：聲聲（voice-specialist）的語音合成工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 voiceSpecialist.* 工具呼叫橋接到 voiceSpecialistTools 服務。
 */
async function dispatchVoiceSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    generateSpeech,
    transcribeAudio,
    getAvailableVoices,
    getVoiceGenerationTips,
  } = await import("./spiritTools/voiceSpecialistTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "voiceSpecialist.generateSpeech": {
        const text = args.text as string;
        if (!text) {
          return {
            name: call.name,
            ok: false,
            error: "text is required",
          };
        }

        const result = await generateSpeech({
          userId: opts.userId,
          text,
          voiceId: args.voiceId as string | undefined,
          language: args.language as string | undefined,
          speed: args.speed as number | undefined,
          emotion: args.emotion as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "voiceSpecialist.transcribe": {
        const audioUrl = args.audioUrl as string;
        if (!audioUrl) {
          return {
            name: call.name,
            ok: false,
            error: "audioUrl is required",
          };
        }

        const result = await transcribeAudio({
          userId: opts.userId,
          audioUrl,
          language: args.language as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "voiceSpecialist.getVoices": {
        const result = getAvailableVoices();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "voiceSpecialist.getTips": {
        const result = getVoiceGenerationTips();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown voiceSpecialist tool: ${call.name}`,
        };
    }
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// learningSpecialist.* 工具橋接：學學（learning-specialist）的學習與教學工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchLearningSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { getTutorial, listTutorials, getQuickTips } = await import("./spiritTools/learningSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "learningSpecialist.getTutorial": {
        const featureName = args.featureName as string;
        if (!featureName) {
          return { name: call.name, ok: false, error: "featureName is required" };
        }
        const result = getTutorial(featureName);
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "learningSpecialist.listTutorials": {
        const result = listTutorials();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "learningSpecialist.getQuickTips": {
        const result = getQuickTips();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown learningSpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// musicSpecialist.* 工具橋接：音音（music-specialist）的音樂生成工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchMusicSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { generateMusic, generateSoundEffect, getMusicOptions, getMusicGenerationTips } = await import("./spiritTools/musicSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "musicSpecialist.generate": {
        const prompt = args.prompt as string;
        if (!prompt) {
          return { name: call.name, ok: false, error: "prompt is required" };
        }
        const result = await generateMusic({
          userId: opts.userId,
          prompt,
          duration: args.duration as number | undefined,
          genre: args.genre as string | undefined,
          mood: args.mood as string | undefined,
          instrumental: args.instrumental as boolean | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "musicSpecialist.generateSoundEffect": {
        const description = args.description as string;
        if (!description) {
          return { name: call.name, ok: false, error: "description is required" };
        }
        const result = await generateSoundEffect({
          userId: opts.userId,
          description,
          duration: args.duration as number | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "musicSpecialist.getOptions": {
        const result = getMusicOptions();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "musicSpecialist.getTips": {
        const result = getMusicGenerationTips();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown musicSpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// trainingSpecialist.* 工具橋接：練練（training-specialist）的模型訓練工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchTrainingSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { trainModel, getTrainingStatus, getTrainingTips } = await import("./spiritTools/trainingSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "trainingSpecialist.train": {
        const modelName = args.modelName as string;
        const trainingType = args.trainingType as
          | "lora"
          | "dreambooth"
          | "fine-tune"
          | undefined;

        if (!modelName || !trainingType) {
          return {
            name: call.name,
            ok: false,
            error: "modelName and trainingType are required",
          };
        }

        const datasetImages = Array.isArray(args.datasetImages)
          ? (args.datasetImages as string[])
          : undefined;

        const result = await trainModel({
          userId: opts.userId,
          modelName,
          trainingType,
          datasetImages,
          baseModel: args.baseModel as string | undefined,
          steps: args.steps as number | undefined,
          learningRate: args.learningRate as number | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "trainingSpecialist.getStatus": {
        const trainingId = (args.trainingId ?? args.jobId) as string;
        if (!trainingId) {
          return { name: call.name, ok: false, error: "trainingId is required" };
        }

        const result = await getTrainingStatus({
          userId: opts.userId,
          trainingId,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "trainingSpecialist.getTips": {
        const result = getTrainingTips();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown trainingSpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// legalAdvisor.* 工具橋接：法法（legal-advisor）的法律合規工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchLegalAdvisorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { checkCompliance, checkLicense, getLegalGuidelines } = await import("./spiritTools/legalAdvisorTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "legalAdvisor.checkCompliance": {
        const contentType = args.contentType as "image" | "video" | "audio" | "text";
        const description = args.description as string;

        if (!contentType || !description) {
          return { name: call.name, ok: false, error: "contentType and description are required" };
        }

        const result = checkCompliance({ contentType, description });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: "Compliance check failed" }),
        };
      }

      case "legalAdvisor.checkLicense": {
        const assetType = args.assetType as string;
        const useCase = args.useCase as "personal" | "commercial" | "redistribution";

        if (!assetType || !useCase) {
          return { name: call.name, ok: false, error: "assetType and useCase are required" };
        }

        const result = checkLicense({
          assetType,
          modelName: args.modelName as string | undefined,
          useCase,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "legalAdvisor.getGuidelines": {
        const result = getLegalGuidelines();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown legalAdvisor tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// securityGuard.* 工具橋接：守守（security-guard）的安全監控工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchSecurityGuardTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { checkSystemHealth, scanForSecurityIssues, getSecurityRecommendations, reportSecurityIssue } = await import("./spiritTools/securityGuardTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "securityGuard.checkHealth": {
        const result = await checkSystemHealth();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "securityGuard.scanSecurity": {
        const scope = args.scope as "user" | "system" | "content";
        if (!scope) {
          return { name: call.name, ok: false, error: "scope is required" };
        }

        const result = scanForSecurityIssues({
          userId: opts.userId,
          scope,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "securityGuard.getRecommendations": {
        const result = getSecurityRecommendations();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "securityGuard.reportIssue": {
        const issueType = args.issueType as "bug" | "vulnerability" | "suspicious_activity" | "other";
        const description = args.description as string;
        const severity = args.severity as "low" | "medium" | "high" | "critical";

        if (!issueType || !description || !severity) {
          return { name: call.name, ok: false, error: "issueType, description, and severity are required" };
        }

        const result = await reportSecurityIssue({
          userId: opts.userId,
          issueType,
          description,
          severity,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown securityGuard tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// communityManager.* 工具橋接：社社（community-manager）的社群互動工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchCommunityManagerTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { submitFeedback, getUserFeedback, getAnnouncements, getEngagementTips } = await import("./spiritTools/communityManagerTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "communityManager.submitFeedback": {
        const type = args.type as "bug" | "feature" | "improvement" | "praise" | "other";
        const title = args.title as string;
        const description = args.description as string;

        if (!type || !title || !description) {
          return { name: call.name, ok: false, error: "type, title, and description are required" };
        }

        const result = await submitFeedback({
          userId: opts.userId,
          type,
          title,
          description,
          rating: args.rating as number | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "communityManager.getUserFeedback": {
        const result = await getUserFeedback({
          userId: opts.userId,
          limit: args.limit as number | undefined,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "communityManager.getAnnouncements": {
        const result = getAnnouncements();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "communityManager.getEngagementTips": {
        const result = getEngagementTips();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown communityManager tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// onboardingCoach.* 工具橋接：引引（onboarding-coach）的新手引導工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchOnboardingCoachTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { startOnboarding, trackOnboardingProgress, getQuickStartGuide } = await import("./spiritTools/onboardingCoachTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "onboardingCoach.startOnboarding": {
        const userType = args.userType as "beginner" | "intermediate" | "advanced";
        if (!userType) {
          return { name: call.name, ok: false, error: "userType is required" };
        }

        const result = startOnboarding({
          userId: opts.userId,
          userType,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "onboardingCoach.trackProgress": {
        const stepId = args.stepId as string;
        const completed = args.completed as boolean;

        if (!stepId || typeof completed !== "boolean") {
          return { name: call.name, ok: false, error: "stepId and completed are required" };
        }

        const result = await trackOnboardingProgress({
          userId: opts.userId,
          stepId,
          completed,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "onboardingCoach.getQuickStart": {
        const result = getQuickStartGuide();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown onboardingCoach tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// planExecutor.* 工具橋接：執執（plan-executor）的工作流程執行工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchPlanExecutorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { createWorkflowPlan, executeWorkflowStep, getWorkflowStatus, getWorkflowTemplates } = await import("./spiritTools/planExecutorTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "planExecutor.createPlan": {
        const goal = args.goal as string;
        const steps = args.steps as Array<{ action: string; parameters?: Record<string, unknown> }>;

        if (!goal || !steps || !Array.isArray(steps)) {
          return { name: call.name, ok: false, error: "goal and steps are required" };
        }

        const result = await createWorkflowPlan({
          userId: opts.userId,
          goal,
          steps,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.executeStep": {
        const planId = args.planId as string;
        const stepIndex = args.stepIndex as number;

        if (!planId || typeof stepIndex !== "number") {
          return { name: call.name, ok: false, error: "planId and stepIndex are required" };
        }

        const result = await executeWorkflowStep({
          userId: opts.userId,
          planId,
          stepIndex,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.getStatus": {
        const planId = args.planId as string;
        if (!planId) {
          return { name: call.name, ok: false, error: "planId is required" };
        }

        const result = await getWorkflowStatus({
          userId: opts.userId,
          planId,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "planExecutor.getTemplates": {
        const result = getWorkflowTemplates();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown planExecutor tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// inspirationSpecialist.* 工具橋接：靈靈（inspiration-specialist）的靈感收集工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchInspirationSpecialistTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { searchTrends, getCreativeSuggestions, analyzeReference, getStyleMixingSuggestions } = await import("./spiritTools/inspirationSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "inspirationSpecialist.searchTrends": {
        const category = args.category as "image" | "video" | "music" | "general";
        if (!category) {
          return { name: call.name, ok: false, error: "category is required" };
        }

        const result = await searchTrends({
          category,
          region: args.region as string | undefined,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.getSuggestions": {
        const intent = args.intent as string;
        if (!intent) {
          return { name: call.name, ok: false, error: "intent is required" };
        }

        const result = getCreativeSuggestions({
          intent,
          style: args.style as string | undefined,
          modality: args.modality as "image" | "video" | "audio" | undefined,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.analyzeReference": {
        const imageUrl = args.imageUrl as string;
        if (!imageUrl) {
          return { name: call.name, ok: false, error: "imageUrl is required" };
        }

        const result = await analyzeReference({ imageUrl });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "inspirationSpecialist.getStyleMixing": {
        const result = getStyleMixingSuggestions();
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      default:
        return { name: call.name, ok: false, error: `unknown inspirationSpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// anatomySpecialist.* 工具橋接：體體（anatomy-specialist）的解剖插圖工具
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchAnatomySpecialistTool(
  call: OrbToolCall,
  _opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    buildAnatomyPrompt,
    nextClarificationQuestion,
    getLabelChecklistForPart,
  } = await import("./spiritTools/anatomySpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "anatomySpecialist.buildPrompt": {
        const bodyPart = args.bodyPart as
          | "full-body" | "head" | "skeleton" | "muscular"
          | "nervous" | "vascular" | "internal-organs" | "limbs";
        const view = args.view as
          | "anterior" | "posterior" | "lateral"
          | "superior" | "inferior" | "cross-section";
        const style = args.style as
          | "medical-textbook" | "3d-render"
          | "hand-drawn" | "simplified-diagram";
        const purpose = args.purpose as
          | "teaching" | "labeling" | "reference" | "artistic";
        if (!bodyPart || !view || !style || !purpose) {
          return {
            name: call.name,
            ok: false,
            error: "bodyPart, view, style, and purpose are required",
          };
        }
        const extra = Array.isArray(args.extraDescriptors)
          ? (args.extraDescriptors as string[])
          : undefined;
        const result = buildAnatomyPrompt({
          bodyPart, view, style, purpose, extraDescriptors: extra,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "anatomySpecialist.nextClarification": {
        const partial = (args.partial ?? {}) as Record<string, unknown>;
        // 只接受合法欄位名稱；多餘 key 不要傳進去，避免污染。
        const safe: Record<string, unknown> = {};
        for (const k of ["bodyPart", "view", "style", "purpose"] as const) {
          if (partial[k]) safe[k] = partial[k];
        }
        const q = nextClarificationQuestion(safe as Parameters<typeof nextClarificationQuestion>[0]);
        return {
          name: call.name,
          ok: true,
          data: { question: q },
          usedTool: call.name,
        };
      }

      case "anatomySpecialist.labelChecklist": {
        const bodyPart = args.bodyPart as
          | "full-body" | "head" | "skeleton" | "muscular"
          | "nervous" | "vascular" | "internal-organs" | "limbs";
        if (!bodyPart) {
          return { name: call.name, ok: false, error: "bodyPart is required" };
        }
        const labels = getLabelChecklistForPart(bodyPart);
        return {
          name: call.name,
          ok: true,
          data: { labels },
          usedTool: call.name,
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown anatomySpecialist tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// memoryManager.* 工具橋接：記記（memory-manager）的長期記憶管理工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 memoryManager.* 工具呼叫橋接到 memoryManagerTools 服務。
 * 提供記記（memory-manager）管理長期記憶的能力：
 * - memoryManager.storeMemory: 儲存新記憶
 * - memoryManager.searchMemories: 搜尋相關記憶
 * - memoryManager.getStats: 取得記憶統計
 * - memoryManager.consolidate: 整合與清理記憶
 */
async function dispatchMemoryManagerTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { storeMemory, searchMemories, getMemoryStats, consolidateMemories } = await import("./spiritTools/memoryManagerTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "memoryManager.storeMemory": {
        const content = args.content as string;
        const memoryType = args.memoryType as string;

        if (!content || !memoryType) {
          return { name: call.name, ok: false, error: "content and memoryType are required" };
        }

        const result = await storeMemory({
          userId: opts.userId,
          memoryType: memoryType as any,
          content,
          importanceScore: typeof args.importanceScore === "number" ? args.importanceScore : 0.5,
          sourceType: (args.sourceType as any) || "conversation",
          sourceId: args.sourceId as string | undefined,
          spiritId: args.spiritId as string | undefined,
          metadata: args.metadata as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "memoryManager.searchMemories": {
        const query = args.query as string;

        if (!query) {
          return { name: call.name, ok: false, error: "query is required" };
        }

        const memoryTypeArg = args.memoryType ?? args.memoryTypes;
        const memoryTypes = Array.isArray(memoryTypeArg)
          ? (memoryTypeArg as any[])
          : memoryTypeArg
            ? [memoryTypeArg as any]
            : undefined;

        const result = await searchMemories({
          userId: opts.userId,
          query,
          memoryTypes,
          limit: typeof args.limit === "number" ? args.limit : 10,
          minImportance: typeof args.minImportance === "number" ? args.minImportance : undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "memoryManager.getStats": {
        const result = await getMemoryStats(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "memoryManager.consolidate": {
        const result = await consolidateMemories(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown memoryManager tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// clarificationEngine.* 工具橋接：意圖澄清與使用者模式學習工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 clarificationEngine.* 工具呼叫橋接到 clarificationEngineTools 服務。
 * 提供意圖識別、澄清問題、學習使用者回答模式的能力：
 * - clarificationEngine.identifyIntent: 識別使用者意圖
 * - clarificationEngine.recordAnswer: 記錄澄清問題的答案
 * - clarificationEngine.getPattern: 取得使用者回答模式
 * - clarificationEngine.getStats: 取得澄清統計資料
 */
async function dispatchClarificationEngineTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    identifyUserIntent,
    recordClarificationAnswer,
    getUserAnswerPattern,
    getClarificationStats,
  } = await import("./spiritTools/clarificationEngineTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "clarificationEngine.identifyIntent": {
        const userInput = args.userInput as string;
        const conversationId = args.conversationId as string;

        if (!userInput || !conversationId) {
          return { name: call.name, ok: false, error: "userInput and conversationId are required" };
        }

        const result = await identifyUserIntent({
          userId: opts.userId,
          conversationId,
          userInput,
          context: args.context as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "clarificationEngine.recordAnswer": {
        const clarificationId = args.clarificationId as string;
        const userAnswer = args.userAnswer as string;

        if (!clarificationId || !userAnswer) {
          return { name: call.name, ok: false, error: "clarificationId and userAnswer are required" };
        }

        const result = await recordClarificationAnswer({
          clarificationId,
          userAnswer,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "clarificationEngine.getPattern": {
        const questionType = args.questionType as string;

        if (!questionType) {
          return { name: call.name, ok: false, error: "questionType is required" };
        }

        const result = await getUserAnswerPattern({
          userId: opts.userId,
          questionType,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "clarificationEngine.getStats": {
        const result = await getClarificationStats(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown clarificationEngine tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// featureDiscovery.* 工具橋接：功能使用追蹤與推薦工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 featureDiscovery.* 工具呼叫橋接到 featureDiscoveryTools 服務。
 * 提供功能使用記錄、發現追蹤、個性化推薦的能力：
 * - featureDiscovery.recordUsage: 記錄功能使用
 * - featureDiscovery.recordDiscovery: 記錄功能發現路徑
 * - featureDiscovery.getStats: 取得使用統計
 * - featureDiscovery.getRecommendations: 生成功能推薦
 * - featureDiscovery.getInsights: 取得發現洞察
 */
async function dispatchFeatureDiscoveryTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    recordFeatureUsage,
    recordFeatureDiscovery,
    getFeatureStats,
    generateFeatureRecommendations,
    getDiscoveryInsights,
  } = await import("./spiritTools/featureDiscoveryTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "featureDiscovery.recordUsage": {
        const featureId = args.featureId as string;
        const success = args.success as boolean;

        if (!featureId || typeof success !== "boolean") {
          return { name: call.name, ok: false, error: "featureId and success are required" };
        }

        const result = await recordFeatureUsage({
          userId: opts.userId,
          featureId,
          success,
          duration: typeof args.duration === "number" ? args.duration : undefined,
          metadata: args.metadata as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "featureDiscovery.recordDiscovery": {
        const featureId = args.featureId as string;
        const discoveryMethod = args.discoveryMethod as string;

        if (!featureId || !discoveryMethod) {
          return { name: call.name, ok: false, error: "featureId and discoveryMethod are required" };
        }

        const result = await recordFeatureDiscovery({
          userId: opts.userId,
          featureId,
          discoveryMethod: discoveryMethod as any,
          fromFeatureId: args.fromFeatureId as string | undefined,
          context: args.context as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "featureDiscovery.getStats": {
        const result = await getFeatureStats({
          userId: opts.userId,
          featureId: args.featureId as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "featureDiscovery.getRecommendations": {
        const result = await generateFeatureRecommendations({
          userId: opts.userId,
          limit: typeof args.limit === "number" ? args.limit : 5,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "featureDiscovery.getInsights": {
        const result = await getDiscoveryInsights(opts.userId);

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown featureDiscovery tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// workflowEngine.* 工具橋接：工作流程自動化工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 workflowEngine.* 工具呼叫橋接到 workflowEngineTools 服務。
 * 提供工作流程模板管理、執行、監控的能力：
 * - workflowEngine.createTemplate: 建立工作流程模板
 * - workflowEngine.getTemplates: 取得工作流程模板列表
 * - workflowEngine.executeWorkflow: 執行工作流程
 * - workflowEngine.getStatus: 取得執行狀態
 * - workflowEngine.controlWorkflow: 控制工作流程（暫停/繼續/取消）
 * - workflowEngine.getHistory: 取得執行歷史
 */
async function dispatchWorkflowEngineTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    createWorkflowTemplate,
    getWorkflowTemplates,
    executeWorkflow,
    getWorkflowStatus,
    controlWorkflow,
    getWorkflowHistory,
  } = await import("./spiritTools/workflowEngineTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "workflowEngine.createTemplate": {
        const name = args.name as string;
        const category = args.category as string;
        const steps = args.steps as any[];

        if (!name || !category || !steps || !Array.isArray(steps)) {
          return { name: call.name, ok: false, error: "name, category, and steps are required" };
        }

        const result = await createWorkflowTemplate({
          creatorUserId: opts.userId,
          name,
          description: args.description as string | undefined,
          category,
          isPublic: args.isPublic as boolean | undefined,
          steps,
          difficulty: args.difficulty as any,
          tags: args.tags as string[] | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "workflowEngine.getTemplates": {
        const result = await getWorkflowTemplates({
          category: args.category as string | undefined,
          difficulty: args.difficulty as any,
          isPublic: args.isPublic as boolean | undefined,
          search: args.search as string | undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "workflowEngine.executeWorkflow": {
        const templateId = args.templateId as number;

        if (typeof templateId !== "number") {
          return { name: call.name, ok: false, error: "templateId is required" };
        }

        const result = await executeWorkflow({
          templateId,
          userId: opts.userId,
          conversationId: args.conversationId as string | undefined,
          inputs: args.inputs as Record<string, unknown> | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "workflowEngine.getStatus": {
        const executionId = args.executionId as string;

        if (!executionId) {
          return { name: call.name, ok: false, error: "executionId is required" };
        }

        const result = await getWorkflowStatus(executionId);

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "workflowEngine.controlWorkflow": {
        const executionId = args.executionId as string;
        const action = args.action as "pause" | "resume" | "cancel";

        if (!executionId || !action) {
          return { name: call.name, ok: false, error: "executionId and action are required" };
        }

        const result = await controlWorkflow({
          executionId,
          action,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "workflowEngine.getHistory": {
        const result = await getWorkflowHistory({
          userId: opts.userId,
          limit: typeof args.limit === "number" ? args.limit : 20,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown workflowEngine tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// systemMonitor.* 工具橋接：系統健康監控與分析工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 systemMonitor.* 工具呼叫橋接到 systemMonitorTools 服務。
 * 提供系統健康監控、成本分析、協作效能追蹤的能力：
 * - systemMonitor.getHealth: 取得系統健康摘要
 * - systemMonitor.getCostAnalysis: 取得成本分析與優化建議
 * - systemMonitor.getCollaborationStats: 取得精靈協作統計
 * - systemMonitor.getPerformanceTrends: 取得效能趨勢
 */
async function dispatchSystemMonitorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    getHealthSummary,
    getCostAnalysis,
    getCollaborationStats,
    getPerformanceTrends,
  } = await import("./spiritTools/systemMonitorTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "systemMonitor.getHealth": {
        const result = await getHealthSummary();

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "systemMonitor.getCostAnalysis": {
        const result = await getCostAnalysis({
          userId: args.userId as number | undefined,
          startDate: args.startDate as string | undefined,
          endDate: args.endDate as string | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "systemMonitor.getCollaborationStats": {
        const result = await getCollaborationStats();

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "systemMonitor.getPerformanceTrends": {
        const metricType = args.metricType as any;

        if (!metricType) {
          return { name: call.name, ok: false, error: "metricType is required" };
        }

        const result = await getPerformanceTrends({
          metricType,
          spiritId: args.spiritId as string | undefined,
          days: typeof args.days === "number" ? args.days : 7,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      default:
        return { name: call.name, ok: false, error: `unknown systemMonitor tool: ${call.name}` };
    }
  } catch (err) {
    return { name: call.name, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// inspiration.fetch 工具橋接：呼叫 Perplexity Sonar 抓即時靈感 / 時事 / 社群偏好
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 inspiration.fetch 工具呼叫橋接到 inspirationFetcher 服務。
 * 永遠回傳 ok=true 給 planner（即使 Sonar 失敗也回 ok=true + 空 cards），
 * 避免單一外部依賴失敗就讓整個 plan 中斷。失敗訊息透過 result.error 傳遞。
 */
async function dispatchInspirationTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { fetchInspiration } = await import("./inspirationFetcher");
  const args = (call.args ?? {}) as Record<string, unknown>;
  const topic = typeof args.topic === "string" ? args.topic : "";
  if (!topic.trim()) {
    return {
      name: call.name,
      ok: false,
      error: "inspiration-topic-required",
    };
  }
  try {
    const result = await fetchInspiration({
      // userId 帶進去讓 perplexityThrottle 計入 per-user 配額（per-hour /
      // per-day），同一個使用者亂呼叫不會把全站額度燒光。
      userId: opts.userId,
      topic: topic.trim(),
      modality:
        typeof args.modality === "string"
          ? (args.modality as
              | "image"
              | "video"
              | "audio"
              | "voice"
              | "3d"
              | "general")
          : undefined,
      angle:
        typeof args.angle === "string"
          ? (args.angle as
              | "trending"
              | "community"
              | "news"
              | "seasonal"
              | "model_release")
          : undefined,
      format:
        typeof args.format === "string"
          ? (args.format as
              | "visual_styles"
              | "prompt_keywords"
              | "mood_board"
              | "quick_facts")
          : undefined,
      maxResults:
        typeof args.maxResults === "number" ? args.maxResults : undefined,
    });

    return {
      name: call.name,
      ok: true,
      usedTool: `inspiration.fetch:${result.provider}`,
      data: {
        provider: result.provider,
        cards: result.cards,
        sources: result.sources,
        summary: result.summary,
        ...(result.error ? { warning: result.error } : {}),
      },
    };
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// research.deepSearch 工具橋接：呼叫 Perplexity 深度搜尋進行外部網路搜尋
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 research.deepSearch 工具呼叫橋接到 perplexityDeepSearch 服務。
 * 永遠回傳 ok=true 給 planner（即使搜尋失敗也回 ok=true + 空 sources），
 * 避免單一外部依賴失敗就讓整個 plan 中斷。失敗訊息透過 result.error 傳遞。
 *
 * 支援參數：
 *   - query (string, required): 搜尋查詢
 *   - recencyFilter ("day"|"week"|"month"|"year"): 時間範圍
 *   - domainFilter (string[]): 限定搜尋網域
 *   - language (string): 搜尋語言偏好
 *   - maxResults (number): 最大結果數
 *   - addToLearnHub (boolean): 是否寫入學習文件中心
 */
async function dispatchDeepSearchTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { executeDeepSearch, formatDeepSearchAsLearnDoc } = await import(
    "./perplexityDeepSearch"
  );
  const args = (call.args ?? {}) as Record<string, unknown>;
  const query = typeof args.query === "string" ? args.query : "";
  if (!query.trim()) {
    return {
      name: call.name,
      ok: false,
      error: "research-query-required",
    };
  }
  try {
    const result = await executeDeepSearch({
      query: query.trim(),
      userId: opts.userId,
      recencyFilter:
        typeof args.recencyFilter === "string"
          ? (args.recencyFilter as "day" | "week" | "month" | "year")
          : undefined,
      domainFilter: Array.isArray(args.domainFilter)
        ? (args.domainFilter as string[]).filter(
            (d) => typeof d === "string" && d
          )
        : undefined,
      language:
        typeof args.language === "string"
          ? (args.language as "zh-TW" | "zh-CN" | "en" | "ja" | "ko")
          : "zh-TW",
      maxResults:
        typeof args.maxResults === "number" ? args.maxResults : undefined,
      addToLearnHub:
        typeof args.addToLearnHub === "boolean"
          ? args.addToLearnHub
          : false,
    });

    return {
      name: call.name,
      ok: true,
      usedTool: `research.deepSearch:${result.provider}`,
      data: {
        provider: result.provider,
        summary: result.summary,
        sources: result.sources,
        durationMs: result.durationMs,
        ...(result.error ? { warning: result.error } : {}),
      },
    };
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// director.* 規劃工具橋接：呼叫導演 AI 為當前工作室規劃下一步
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 director.suggestPlan 工具呼叫橋接到後端 invokeLLM。
 * 直接 reuse director.askForStudioPlan 同樣的 prompt + parseLLMActions 流程，
 * 但不經 tRPC layer（避免 caller 自我引用）。
 */

// ═══════════════════════════════════════════════════════════════════════════
// studio.trainLora 訓練橋接：建立 fineTunedModel + backgroundJob，背景啟動
// runFalTrainingJob / runLoraTrainingJob，立即回傳 modelId+jobId 給光球。
// ═══════════════════════════════════════════════════════════════════════════

const SUPPORTED_TRAINING_MODEL_TYPES = new Set([
  "image_subject",
  "voice_clone",
  "style_lora",
  "scene_lora",
  "video_lora",
  "portrait_lora",
]);

const STEPS_PER_EPOCH_FOR_ORB = 100;
const MIN_TRAINING_STEPS_FOR_ORB = 200;
const MAX_TRAINING_STEPS_FOR_ORB = 4_000;

interface DatasetMediaItem {
  url: string;
  fileKey?: string;
}

function coerceDatasetArray(value: unknown): DatasetMediaItem[] {
  if (!Array.isArray(value)) return [];
  const out: DatasetMediaItem[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      out.push({ url: item.trim() });
    } else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) continue;
      const fileKey =
        typeof record.fileKey === "string" ? record.fileKey : undefined;
      out.push({ url, ...(fileKey ? { fileKey } : {}) });
    }
  }
  return out;
}

async function dispatchTrainingTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { getGlobalAgentTool } = await import("../../shared/global-agent-tools");
  const def = getGlobalAgentTool(call.name);
  if (!def) {
    return { name: call.name, ok: false, error: "training-tool-not-registered" };
  }
  if (def.requiresHuman && !opts.approved) {
    return { name: call.name, ok: false, error: "confirmation-required" };
  }

  const args = (call.args ?? {}) as Record<string, unknown>;
  const modelType = String(args.modelType ?? "");
  const name = String(args.name ?? "").trim();
  const triggerWord =
    typeof args.triggerWord === "string" ? args.triggerWord.trim() : "";
  const description =
    typeof args.description === "string" ? args.description.trim() : undefined;
  const trainingEngine =
    typeof args.trainingEngine === "string" && args.trainingEngine === "replicate"
      ? "replicate"
      : "fal";
  const isStyle = args.isStyle === true;
  const epochs =
    typeof args.epochs === "number" && args.epochs > 0 ? args.epochs : 20;
  const learningRate =
    typeof args.learningRate === "number" && args.learningRate > 0
      ? args.learningRate
      : 0.0001;
  const batchSize =
    typeof args.batchSize === "number" && args.batchSize > 0 ? args.batchSize : 4;
  const datasetImages = coerceDatasetArray(args.datasetImages);
  const datasetVideos = coerceDatasetArray(args.datasetVideos);
  const totalDataCount = datasetImages.length + datasetVideos.length;

  if (!SUPPORTED_TRAINING_MODEL_TYPES.has(modelType)) {
    return {
      name: call.name,
      ok: false,
      error: `unsupported-training-model-type: ${modelType}`,
    };
  }
  if (!name) {
    return {
      name: call.name,
      ok: false,
      error: "training-name-required",
    };
  }
  if (totalDataCount === 0) {
    return {
      name: call.name,
      ok: false,
      error: "training-dataset-empty (need datasetImages and/or datasetVideos)",
    };
  }
  if (trainingEngine === "fal" && !process.env.FAL_API_KEY) {
    return { name: call.name, ok: false, error: "FAL_API_KEY not configured" };
  }
  if (trainingEngine === "replicate" && !process.env.REPLICATE_API_TOKEN) {
    return {
      name: call.name,
      ok: false,
      error: "REPLICATE_API_TOKEN not configured",
    };
  }

  const effectiveSteps = Math.min(
    Math.max(epochs * STEPS_PER_EPOCH_FOR_ORB, MIN_TRAINING_STEPS_FOR_ORB),
    MAX_TRAINING_STEPS_FOR_ORB
  );
  const configJson: Record<string, unknown> = {
    triggerWord,
    epochs,
    learningRate,
    batchSize,
    steps: effectiveSteps,
    isStyle,
    datasetImages,
    datasetVideos,
  };
  if (typeof args.falModelId === "string" && args.falModelId.trim()) {
    configJson.falModelId = args.falModelId.trim();
  }

  let modelId: number;
  let jobId: number;
  try {
    const db = await import("../db");
    modelId = await db.createFineTunedModel({
      userId: opts.userId,
      name,
      description,
      modelType: modelType as never,
      fileUrl: datasetImages[0]?.url || datasetVideos[0]?.url || "",
      fileKey: datasetImages[0]?.fileKey,
      configJson,
    } as never);
    jobId = await db.createBackgroundJob({
      userId: opts.userId,
      jobType: "model_training",
      status: "queued",
      progress: 0,
      progressMessage: "光球已將訓練任務加入佇列",
      resultJson: { modelId, modelName: name, engine: trainingEngine },
    } as never);
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: `training-job-create-failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  // Fire the actual long-running training job in the background. We
  // explicitly do NOT await — training takes 5–30 minutes which would
  // blow the HTTP request lifetime. The user monitors via /training-jobs
  // and the existing fal/replicate webhook callbacks update DB rows.
  const imageUrls = datasetImages.map(item => item.url);
  const videoUrls = datasetVideos.map(item => item.url);

  if (trainingEngine === "fal") {
    void import("./falTrainer")
      .then(({ runFalTrainingJob, resolveFalTrainingModel }) => {
        const resolvedFalModel =
          (typeof args.falModelId === "string" && args.falModelId.trim()) ||
          resolveFalTrainingModel(modelType as never);
        return runFalTrainingJob({
          userId: opts.userId,
          modelId,
          jobId,
          modelName: name,
          modelType: modelType as never,
          triggerWord,
          steps: effectiveSteps,
          learningRate,
          isStyle,
          imageUrls,
          videoUrls,
          falModelId: resolvedFalModel,
        });
      })
      .catch(err => {
        console.error(
          `[orb-tool/studio.trainLora] fal background job failed for model ${modelId}:`,
          err
        );
      });
  } else {
    void import("./loraTrainer")
      .then(({ runLoraTrainingJob }) =>
        runLoraTrainingJob({
          userId: opts.userId,
          modelId,
          jobId,
          modelName: name,
          modelType: modelType as never,
          triggerWord,
          steps: effectiveSteps,
          learningRate,
          isStyle,
          imageUrls,
        } as never)
      )
      .catch(err => {
        console.error(
          `[orb-tool/studio.trainLora] replicate background job failed for model ${modelId}:`,
          err
        );
      });
  }

  return {
    name: call.name,
    ok: true,
    data: {
      modelId,
      jobId,
      status: "queued",
      modelType,
      modelName: name,
      triggerWord,
      trainingEngine,
      datasetSize: totalDataCount,
      steps: effectiveSteps,
      monitorUrl: `/training-jobs?jobId=${jobId}`,
      engine: trainingEngine,
    },
    usedTool: call.name,
  };
}

async function dispatchDirectorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const { getGlobalAgentTool } = await import("../../shared/global-agent-tools");
  const def = getGlobalAgentTool(call.name);
  if (!def) {
    return {
      name: call.name,
      ok: false,
      error: "director-tool-not-registered",
    };
  }

  if (def.requiresHuman && !opts.approved) {
    return {
      name: call.name,
      ok: false,
      error: "confirmation-required",
    };
  }

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    if (call.name !== "director.suggestPlan") {
      return {
        name: call.name,
        ok: false,
        error: `unknown-director-tool: ${call.name}`,
      };
    }

    const { invokeLLM, extractMessageText } = await import("../_core/llm");
    const { buildBrainContext } = await import("../middleware/brainContext");
    const { parseLLMActions } = await import("../../shared/agent-actions");
    const { extractJsonObjectFromText } = await import(
      "../../shared/agent-plan-adapter"
    );

    const brain = await buildBrainContext(opts.userId);
    const director = brain.getBrain("director");

    const personality =
      typeof args.personality === "string" ? args.personality : "creative";
    const activeModality =
      typeof args.activeModality === "string" ? args.activeModality : "image";
    const userIntent =
      typeof args.userIntent === "string" ? args.userIntent : "";
    const selectedFalModelId =
      typeof args.selectedFalModelId === "string"
        ? args.selectedFalModelId
        : "(未指定)";
    const hasTokenWeights = !!args.hasTokenWeights;
    const hasFineTunedModel = !!args.hasFineTunedModel;

    const systemPrompt = `你是「導演 AI」，使用者正在創作工作室裡建立內容。
你的任務：根據使用者當前的工作室狀態，建議下一步行動。

回傳格式（嚴格 JSON）：
{
  "actions": [
    { "type": "fillPrompt", "text": "...", "slot": "prompt", "append": false },
    { "type": "setModality", "modality": "image|video|audio|voice" },
    { "type": "setMode", "modeId": "lightning|deep_precision" },
    { "type": "setModel", "modelId": "fal-ai/..." }
  ],
  "rationale": "簡短中文說明"
}

規範：
- 最多回 4 個 actions
- 風格 = ${personality}
- 不要回多餘內容，只回 JSON
${director.systemPrompt ? `\n附加大腦指令：\n${director.systemPrompt}` : ""}`;

    const studioContext = `
當前活躍模態：${activeModality}
選中模型：${selectedFalModelId}
啟用自注意力：${hasTokenWeights ? "是" : "否"}
使用微調 LoRA：${hasFineTunedModel ? "是" : "否"}

使用者想做什麼：${userIntent || "(未說明，請主動建議下一步)"}
`.trim();

    const llmResponse = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: studioContext },
      ],
      model: director.model,
      temperature: director.temperature,
      topP: director.topP,
      responseFormat: { type: "json_object" },
    });

    const text = extractMessageText(llmResponse.choices[0]?.message?.content);

    const extracted = extractJsonObjectFromText(text);
    if (!extracted || typeof extracted !== "object") {
      const trimmed = text.trim();
      return {
        name: call.name,
        ok: true,
        data: {
          actions: [],
          rationale: trimmed
            ? trimmed.slice(0, 400)
            : "導演沒有回應，請稍後再試",
          rawResponse: text.slice(0, 500),
        },
        usedTool: call.name,
      };
    }

    const parsed = extracted as { actions?: unknown; rationale?: string };
    const actions = parseLLMActions(parsed.actions);
    return {
      name: call.name,
      ok: true,
      data: {
        actions,
        rationale:
          typeof parsed.rationale === "string" ? parsed.rationale : "",
      },
      usedTool: call.name,
    };
  } catch (err) {
    return {
      name: call.name,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

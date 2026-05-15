import { TRPCError } from "@trpc/server";
import { awaitFalQueueResult, type FalAwaitResult } from "./falQueueAwaiter";
import { checkAndConsumeQuota } from "./orbQuota";
import { injectModelPrompt } from "../../shared/modelPromptTemplates";
import { moderateOrbContent } from "../../shared/orb-content-moderation";
import type { AgentRole } from "../../shared/orb-agent-roles";

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

    // ── research.compareModels：站內模型 catalogue 結構化比較（查查專用） ──
    // 純資料工具，不打 LLM、不過 Perplexity 節流。
    if (call.name === "research.compareModels") {
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
      const compareResult = await dispatchCompareModelsTool(call);
      out.push(compareResult);
      opts.onAuditEvent?.({
        requestId,
        userId: opts.userId,
        userRole: opts.userRole,
        taskId: opts.taskId,
        stepId: opts.stepId,
        toolName: call.name,
        usedTool: compareResult.usedTool,
        ok: compareResult.ok,
        error: compareResult.error,
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

      case "notesCurator.createNote":
      case "notesCurator.searchNotes":
      case "notesCurator.listNotes":
      case "notesCurator.updateNote":
      case "notesCurator.updateNoteStatus":
      case "notesCurator.deleteNote":
      case "notesCurator.scheduleTask":
      case "notesCurator.scheduleEvent":
      case "notesCurator.listUpcoming":
      case "notesCurator.summarizeRecent":
      case "notesCurator.tagAssets":
      case "notesCurator.categorizeAsset":
      case "notesCurator.searchAssets":
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

      // ── 細細 autonomous capabilities ─────────────────────────────────
      case "settingsDetail.bulkUpdate":
      case "settingsDetail.previewDiff":
      case "settingsDetail.applyPreset":
      case "settingsDetail.listPresets":
      case "settingsDetail.resetPreference":
      case "settingsDetail.searchSettings":
      case "settingsDetail.detectInconsistencies":
      case "settingsDetail.recommendOptimizations": {
        const settingsDetailResult = await dispatchSettingsDetailTool(call, opts);
        return settingsDetailResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // accountant.* tools for accountant (財財)
      // ════════════════════════════════════════════════════════════════════

      case "accountant.estimate":
      case "accountant.compare":
      case "accountant.usage":
      case "accountant.savings":
      case "accountant.workflowEstimate":
      case "accountant.budgetForecast":
      case "accountant.budget":
      case "accountant.trend":
      case "accountant.forecast": {
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
      case "imageSpecialist.recommendModel":
      case "imageSpecialist.enhancePrompt":
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
      case "videoSpecialist.enhance":
      case "videoSpecialist.recommendModel":
      case "videoSpecialist.estimateCost":
      case "videoSpecialist.planWorkflow":
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
      case "voiceSpecialist.cloneVoice":
      case "voiceSpecialist.designVoice":
      case "voiceSpecialist.changeVoice":
      case "voiceSpecialist.generateSfx":
      case "voiceSpecialist.getVoices":
      case "voiceSpecialist.pickVoice":
      case "voiceSpecialist.recommendModel":
      case "voiceSpecialist.planVoiceover":
      case "voiceSpecialist.getEmotionTags":
      case "voiceSpecialist.getTips": {
        const voiceResult = await dispatchVoiceSpecialistTool(call, opts);
        return voiceResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // learningSpecialist.* tools for learning-specialist (學學)
      // ════════════════════════════════════════════════════════════════════

      case "learningSpecialist.getTutorial":
      case "learningSpecialist.listTutorials":
      case "learningSpecialist.getQuickTips":
      case "learningSpecialist.searchLearningContent":
      case "learningSpecialist.recommendForContext":
      case "learningSpecialist.generateLearningPath":
      case "learningSpecialist.explainConcept":
      case "learningSpecialist.getUserLearningProgress":
      case "learningSpecialist.getNextLearningStep": {
        const learningResult = await dispatchLearningSpecialistTool(call, opts);
        return learningResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // musicSpecialist.* tools for music-specialist (音音)
      // ════════════════════════════════════════════════════════════════════

      case "musicSpecialist.generate":
      case "musicSpecialist.generateSoundEffect":
      case "musicSpecialist.getOptions":
      case "musicSpecialist.getTips":
      case "musicSpecialist.recommendEngine":
      case "musicSpecialist.buildPrompt":
      case "musicSpecialist.estimateCost":
      case "musicSpecialist.listEngines":
      case "musicSpecialist.getRecentAssets": {
        const musicResult = await dispatchMusicSpecialistTool(call, opts);
        return musicResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // trainingSpecialist.* tools for training-specialist (練練)
      // ════════════════════════════════════════════════════════════════════

      case "trainingSpecialist.listMyModels":
      case "trainingSpecialist.getModelStatus":
      case "trainingSpecialist.recommendParams":
      case "trainingSpecialist.analyzeDataset":
      case "trainingSpecialist.estimateTraining":
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
      // communityManager.* tools for community-manager (群群)
      // ════════════════════════════════════════════════════════════════════

      case "communityManager.buildPostPlan":
      case "communityManager.nextClarification":
      case "communityManager.recommendHashtags":
      case "communityManager.planWeeklySchedule":
      case "communityManager.critiqueHook":
      case "communityManager.formatCaption":
      case "communityManager.listPlatforms": {
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
      // planExecutor.* tools for plan-executor (步步)
      //
      // 從 mock stub 升級為真實 agent：planFromGoal 餵 agentPlanner 規劃、
      // runPlan 跑整條、controlPlan 暫停/續跑/中止、replanOnFailure 自動修補。
      // ════════════════════════════════════════════════════════════════════

      case "planExecutor.planFromGoal":
      case "planExecutor.createPlan":
      case "planExecutor.runPlan":
      case "planExecutor.executeStep":
      case "planExecutor.getStatus":
      case "planExecutor.controlPlan":
      case "planExecutor.listRuns":
      case "planExecutor.replanOnFailure":
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
      case "inspirationSpecialist.getStyleMixing":
      case "inspirationSpecialist.buildMoodBoard":
      case "inspirationSpecialist.refinePromptVariants":
      case "inspirationSpecialist.rankStylesByIntent":
      case "inspirationSpecialist.getStyleAtlas": {
        const inspirationSpecResult = await dispatchInspirationSpecialistTool(call, opts);
        return inspirationSpecResult;
      }

      // ════════════════════════════════════════════════════════════════════
      // anatomySpecialist.* tools for anatomy-specialist (體體)
      // ════════════════════════════════════════════════════════════════════

      case "anatomySpecialist.buildPrompt":
      case "anatomySpecialist.nextClarification":
      case "anatomySpecialist.labelChecklist":
      case "anatomySpecialist.parseIntent":
      case "anatomySpecialist.buildMultiViewBatch":
      case "anatomySpecialist.verifyResult":
      case "anatomySpecialist.recommendModels":
      case "anatomySpecialist.summarize": {
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

      // ════════════════════════════════════════════════════════════════════
      // critic.* tools for critic (品品)
      // ════════════════════════════════════════════════════════════════════

      case "critic.review":
      case "critic.score":
      case "critic.compare":
      case "critic.suggestRewrite":
      case "critic.planHandoff": {
        const criticResult = await dispatchCriticTool(call, opts);
        return criticResult;
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
    workflowEstimate,
    getBudgetForecast,
    getBudget,
    getDailyTrend,
    getForecast,
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

      case "accountant.workflowEstimate": {
        const stepsRaw = Array.isArray(args.steps) ? args.steps : null;
        if (!stepsRaw || stepsRaw.length === 0) {
          return {
            name: call.name,
            ok: false,
            error: "steps[] is required and must contain at least one step",
          };
        }
        // 對每個 step 收欄位 — 漏 modelId 直接 400，免得讓 estimate 把整條
        // workflow 都用 5pts unknown-fallback 算出來給 LLM 報錯數字。
        const steps: Array<{
          label?: string;
          modelId: string;
          durationSec?: number;
          charCount?: number;
          imageCount?: number;
          trainingSteps?: number;
        }> = [];
        for (let i = 0; i < stepsRaw.length; i++) {
          const s = stepsRaw[i] as Record<string, unknown>;
          const modelId = typeof s?.modelId === "string" ? s.modelId.trim() : "";
          if (!modelId) {
            return {
              name: call.name,
              ok: false,
              error: `steps[${i}].modelId is required`,
            };
          }
          steps.push({
            label: typeof s.label === "string" ? s.label : undefined,
            modelId,
            durationSec: typeof s.durationSec === "number" ? s.durationSec : undefined,
            charCount: typeof s.charCount === "number" ? s.charCount : undefined,
            imageCount: typeof s.imageCount === "number" ? s.imageCount : undefined,
            trainingSteps:
              typeof s.trainingSteps === "number" ? s.trainingSteps : undefined,
          });
        }
        const result = workflowEstimate({ steps });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.budgetForecast": {
        const result = await getBudgetForecast(opts.userId);
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.budget": {
        const result = await getBudget(opts.userId);
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.trend": {
        const result = await getDailyTrend(opts.userId, {
          days: typeof args.days === "number" ? args.days : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "accountant.forecast": {
        const result = await getForecast(opts.userId, {
          observationDays:
            typeof args.observationDays === "number" ? args.observationDays : undefined,
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
// critic.* 工具橋接：品品（critic）的結構化評審工具
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 critic.* 工具呼叫橋接到 criticTools 服務。
 * 提供品品（critic）即時呼叫的能力：
 * - critic.review:         結構化評審（亮點 + 改進 + rubric scores + 交棒）
 * - critic.score:          純打分，含 weakDimensions（給 proactive trigger）
 * - critic.compare:        多輪迭代比較，回 winner + 進步 / 退步維度
 * - critic.suggestRewrite: 給 1-3 個可貼的 prompt 改寫版本
 * - critic.planHandoff:    依 critique 性質決定下一棒交給誰
 *
 * 五個工具都是純函式（無 DB / 無 LLM 呼叫），可放心對 LLM 開放、無需 approval。
 * modality 在每個工具裡會白名單驗證；非合法 enum 直接返回 400。
 */
async function dispatchCriticTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    reviewAsset,
    scoreAsset,
    compareIterations,
    suggestPromptRewrite,
    planHandoff,
  } = await import("./spiritTools/criticTools");

  const VALID_MODALITIES = new Set(["image", "video", "music", "voice", "text"]);
  const VALID_CRITIQUE_TYPES = new Set([
    "prompt-level",
    "model-level",
    "settings-level",
    "creative-direction",
  ]);

  const args = (call.args ?? {}) as Record<string, unknown>;

  function readModality(): {
    ok: true;
    value: "image" | "video" | "music" | "voice" | "text";
  } | { ok: false; error: string } {
    const m = typeof args.modality === "string" ? args.modality.trim() : "";
    if (!VALID_MODALITIES.has(m)) {
      return {
        ok: false,
        error: `modality must be one of: ${Array.from(VALID_MODALITIES).join(", ")}`,
      };
    }
    return { ok: true, value: m as "image" | "video" | "music" | "voice" | "text" };
  }

  try {
    switch (call.name) {
      case "critic.review": {
        const mod = readModality();
        if (!mod.ok) return { name: call.name, ok: false, error: mod.error };
        const result = reviewAsset({
          modality: mod.value,
          prompt: typeof args.prompt === "string" ? args.prompt : undefined,
          negativePrompt:
            typeof args.negativePrompt === "string" ? args.negativePrompt : undefined,
          modelId: typeof args.modelId === "string" ? args.modelId : undefined,
          aspect: typeof args.aspect === "string" ? args.aspect : undefined,
          durationSec:
            typeof args.durationSec === "number" ? args.durationSec : undefined,
          goal: typeof args.goal === "string" ? args.goal : undefined,
          userFeedback:
            typeof args.userFeedback === "string" ? args.userFeedback : undefined,
          iteration:
            typeof args.iteration === "number" ? args.iteration : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "critic.score": {
        const mod = readModality();
        if (!mod.ok) return { name: call.name, ok: false, error: mod.error };
        const result = scoreAsset({
          modality: mod.value,
          prompt: typeof args.prompt === "string" ? args.prompt : undefined,
          negativePrompt:
            typeof args.negativePrompt === "string" ? args.negativePrompt : undefined,
          modelId: typeof args.modelId === "string" ? args.modelId : undefined,
          aspect: typeof args.aspect === "string" ? args.aspect : undefined,
          durationSec:
            typeof args.durationSec === "number" ? args.durationSec : undefined,
          goal: typeof args.goal === "string" ? args.goal : undefined,
          userFeedback:
            typeof args.userFeedback === "string" ? args.userFeedback : undefined,
          iteration:
            typeof args.iteration === "number" ? args.iteration : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "critic.compare": {
        const iterationsArg = Array.isArray(args.iterations) ? args.iterations : [];
        if (iterationsArg.length === 0) {
          return {
            name: call.name,
            ok: false,
            error: "iterations is required (non-empty array)",
          };
        }
        // Validate each iteration has a modality
        type IterationArg = Parameters<typeof compareIterations>[0]["iterations"][number];
        const iterations: IterationArg[] = [];
        for (let i = 0; i < iterationsArg.length; i++) {
          const it = iterationsArg[i];
          if (!it || typeof it !== "object") {
            return {
              name: call.name,
              ok: false,
              error: `iterations[${i}] must be an object`,
            };
          }
          const itObj = it as Record<string, unknown>;
          const itMod = typeof itObj.modality === "string" ? itObj.modality.trim() : "";
          if (!VALID_MODALITIES.has(itMod)) {
            return {
              name: call.name,
              ok: false,
              error: `iterations[${i}].modality must be one of: ${Array.from(VALID_MODALITIES).join(", ")}`,
            };
          }
          if (typeof itObj.id !== "string" || itObj.id.length === 0) {
            return {
              name: call.name,
              ok: false,
              error: `iterations[${i}].id is required`,
            };
          }
          iterations.push({
            id: itObj.id,
            modality: itMod as "image" | "video" | "music" | "voice" | "text",
            prompt: typeof itObj.prompt === "string" ? itObj.prompt : undefined,
            modelId: typeof itObj.modelId === "string" ? itObj.modelId : undefined,
            aspect: typeof itObj.aspect === "string" ? itObj.aspect : undefined,
            durationSec:
              typeof itObj.durationSec === "number" ? itObj.durationSec : undefined,
            userFeedback:
              typeof itObj.userFeedback === "string" ? itObj.userFeedback : undefined,
            iteration:
              typeof itObj.iteration === "number" ? itObj.iteration : undefined,
          });
        }
        const result = compareIterations({
          iterations,
          goal: typeof args.goal === "string" ? args.goal : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "critic.suggestRewrite": {
        const mod = readModality();
        if (!mod.ok) return { name: call.name, ok: false, error: mod.error };
        const originalPrompt =
          typeof args.originalPrompt === "string" ? args.originalPrompt : "";
        if (originalPrompt.trim().length === 0) {
          return {
            name: call.name,
            ok: false,
            error: "originalPrompt is required",
          };
        }
        const targetDims = Array.isArray(args.targetDimensions)
          ? (args.targetDimensions.filter(d => typeof d === "string") as string[])
          : undefined;
        const result = suggestPromptRewrite({
          modality: mod.value,
          originalPrompt,
          targetDimensions: targetDims,
          goal: typeof args.goal === "string" ? args.goal : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "critic.planHandoff": {
        const mod = readModality();
        if (!mod.ok) return { name: call.name, ok: false, error: mod.error };
        const ct =
          typeof args.critiqueType === "string" ? args.critiqueType.trim() : "";
        if (!VALID_CRITIQUE_TYPES.has(ct)) {
          return {
            name: call.name,
            ok: false,
            error: `critiqueType must be one of: ${Array.from(VALID_CRITIQUE_TYPES).join(", ")}`,
          };
        }
        const result = planHandoff({
          modality: mod.value,
          critiqueType: ct as "prompt-level" | "model-level" | "settings-level" | "creative-direction",
          userAcceptedFix: args.userAcceptedFix === true,
          suggestedHandoff:
            args.suggestedHandoff && typeof args.suggestedHandoff === "object"
              ? (args.suggestedHandoff as { to: AgentRole; reason: string })
              : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown critic tool: ${call.name}`,
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
 * 提供記記（notes-curator）筆記、待辦、行事曆與資產管理的完整能力：
 *
 * 筆記 / 待辦：
 * - notesCurator.createNote: 建立筆記 / 腳本 / 行事曆事件
 * - notesCurator.searchNotes: 依關鍵字搜尋筆記（可附 noteType / status filter）
 * - notesCurator.listNotes: 列出筆記（可依 noteType / status / category / tag 篩選）
 * - notesCurator.updateNote: 修改既有筆記
 * - notesCurator.updateNoteStatus: 標記任務 todo → in_progress → done
 * - notesCurator.deleteNote: 刪除筆記
 *
 * 排程：
 * - notesCurator.scheduleEvent: 建立行事曆事件（推薦使用）
 * - notesCurator.scheduleTask: 舊版 alias，內部走 scheduleEvent
 * - notesCurator.listUpcoming: 近期即將到來的事件（預設 7 天）
 * - notesCurator.summarizeRecent: 近期活動摘要（記憶用）
 *
 * 素材庫：
 * - notesCurator.tagAssets: 為素材加 / 移除 / 覆蓋標籤
 * - notesCurator.categorizeAsset: 設定素材分類
 * - notesCurator.searchAssets: 搜尋素材
 * - notesCurator.getAssetStatistics: 素材統計與建議
 */
async function dispatchNotesCuratorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const tools = await import("./spiritTools/notesCuratorTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  const ok = (data: Record<string, unknown>): OrbToolCallResult => ({
    name: call.name,
    ok: true,
    data,
    usedTool: call.name,
  });
  const fail = (error: string): OrbToolCallResult => ({
    name: call.name,
    ok: false,
    error,
    usedTool: call.name,
  });

  try {
    switch (call.name) {
      case "notesCurator.createNote": {
        const title = args.title as string;
        const content = args.content as string;
        if (!title || !content) return fail("title and content are required");

        const result = await tools.createNote({
          userId: opts.userId,
          title,
          content,
          tags: args.tags as string[] | undefined,
          category: args.category as string | undefined,
          noteType: args.noteType as "note" | "script" | "calendar_event" | undefined,
          status: args.status as "todo" | "in_progress" | "done" | undefined,
          scheduledDate: args.scheduledDate as string | undefined,
          endDate: args.endDate as string | undefined,
          reminderMinutes: args.reminderMinutes as number | undefined,
          location: args.location as Parameters<typeof tools.createNote>[0]["location"],
          meetingUrl: args.meetingUrl as string | undefined,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          noteId: result.noteId,
          message: result.message,
        });
      }

      case "notesCurator.searchNotes": {
        const query = args.query as string;
        if (!query) return fail("query is required");
        const result = await tools.searchNotes({
          userId: opts.userId,
          query,
          limit: args.limit as number | undefined,
          noteType: args.noteType as "note" | "script" | "calendar_event" | undefined,
          status: args.status as "todo" | "in_progress" | "done" | undefined,
          category: args.category as string | undefined,
        });
        if (!result.success) return fail("search failed");
        return ok({
          success: true,
          notes: result.notes,
          total: result.total,
        });
      }

      case "notesCurator.listNotes": {
        const result = await tools.listNotes({
          userId: opts.userId,
          limit: args.limit as number | undefined,
          noteType: args.noteType as "note" | "script" | "calendar_event" | undefined,
          status: args.status as "todo" | "in_progress" | "done" | undefined,
          category: args.category as string | undefined,
          tag: args.tag as string | undefined,
        });
        if (!result.success) return fail("list failed");
        return ok({
          success: true,
          notes: result.notes,
          total: result.total,
        });
      }

      case "notesCurator.updateNote": {
        const noteId = args.noteId as number;
        if (!Number.isFinite(noteId)) return fail("noteId is required");
        const result = await tools.updateNote({
          userId: opts.userId,
          noteId,
          title: args.title as string | undefined,
          content: args.content as string | undefined,
          tags: args.tags as string[] | undefined,
          category: args.category as string | null | undefined,
          status: args.status as "todo" | "in_progress" | "done" | undefined,
          noteType: args.noteType as "note" | "script" | "calendar_event" | undefined,
          scheduledDate: args.scheduledDate as string | null | undefined,
          endDate: args.endDate as string | null | undefined,
          reminderMinutes: args.reminderMinutes as number | null | undefined,
          location: args.location as Parameters<typeof tools.updateNote>[0]["location"],
          meetingUrl: args.meetingUrl as string | null | undefined,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          note: result.note,
          message: result.message,
        });
      }

      case "notesCurator.updateNoteStatus": {
        const noteId = args.noteId as number;
        const status = args.status as "todo" | "in_progress" | "done";
        if (!Number.isFinite(noteId) || !status) {
          return fail("noteId and status are required");
        }
        if (!["todo", "in_progress", "done"].includes(status)) {
          return fail("status must be todo | in_progress | done");
        }
        const result = await tools.updateNoteStatus({
          userId: opts.userId,
          noteId,
          status,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          note: result.note,
          message: result.message,
        });
      }

      case "notesCurator.deleteNote": {
        const noteId = args.noteId as number;
        if (!Number.isFinite(noteId)) return fail("noteId is required");
        const result = await tools.deleteNote({
          userId: opts.userId,
          noteId,
        });
        if (!result.success) return fail(result.message);
        return ok({ success: true, message: result.message });
      }

      case "notesCurator.scheduleTask": {
        const taskName = args.taskName as string;
        const scheduledFor = args.scheduledFor as string;
        if (!taskName || !scheduledFor) {
          return fail("taskName and scheduledFor are required");
        }
        const result = await tools.scheduleTask({
          userId: opts.userId,
          taskName,
          scheduledFor,
          description: args.description as string | undefined,
          metadata: args.metadata as Record<string, unknown> | undefined,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          jobId: result.jobId,
          message: result.message,
        });
      }

      case "notesCurator.scheduleEvent": {
        const title = args.title as string;
        const scheduledFor = args.scheduledFor as string;
        if (!title || !scheduledFor) {
          return fail("title and scheduledFor are required");
        }
        const result = await tools.scheduleEvent({
          userId: opts.userId,
          title,
          scheduledFor,
          endDate: args.endDate as string | undefined,
          description: args.description as string | undefined,
          reminderMinutes: args.reminderMinutes as number | undefined,
          location: args.location as Parameters<typeof tools.scheduleEvent>[0]["location"],
          meetingUrl: args.meetingUrl as string | undefined,
          tags: args.tags as string[] | undefined,
          category: args.category as string | undefined,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          eventId: result.eventId,
          message: result.message,
        });
      }

      case "notesCurator.listUpcoming": {
        const result = await tools.listUpcoming({
          userId: opts.userId,
          withinDays: args.withinDays as number | undefined,
          limit: args.limit as number | undefined,
          includeStatuses: args.includeStatuses as
            | Array<"todo" | "in_progress" | "done">
            | undefined,
        });
        if (!result.success) return fail("list upcoming failed");
        return ok({
          success: true,
          events: result.events,
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
        });
      }

      case "notesCurator.summarizeRecent": {
        const result = await tools.summarizeRecentActivity({
          userId: opts.userId,
          sinceDays: args.sinceDays as number | undefined,
        });
        if (!result.success) return fail("summarize failed");
        return ok({
          success: true,
          sinceDays: result.sinceDays,
          counts: result.counts,
          byStatus: result.byStatus,
          recentTitles: result.recentTitles,
        });
      }

      case "notesCurator.tagAssets": {
        const assetIds = args.assetIds as number[];
        const tags = args.tags as string[];
        const action = (args.action as "add" | "remove" | "replace") || "add";
        if (!Array.isArray(assetIds) || !Array.isArray(tags)) {
          return fail("assetIds and tags must be arrays");
        }
        const result = await tools.tagAssets({
          userId: opts.userId,
          assetIds,
          tags,
          action,
        });
        if (!result.success) return fail(result.message);
        return ok({
          success: true,
          updated: result.updated,
          message: result.message,
        });
      }

      case "notesCurator.categorizeAsset": {
        const assetId = args.assetId as number;
        if (!Number.isFinite(assetId)) return fail("assetId is required");
        const category =
          args.category === null || args.category === undefined
            ? null
            : String(args.category);
        const result = await tools.categorizeAsset({
          userId: opts.userId,
          assetId,
          category,
        });
        if (!result.success) return fail(result.message);
        return ok({ success: true, message: result.message });
      }

      case "notesCurator.searchAssets": {
        const result = await tools.searchAssets({
          userId: opts.userId,
          query: args.query as string | undefined,
          tag: args.tag as string | undefined,
          category: args.category as string | undefined,
          assetType: args.assetType as
            | "image"
            | "video"
            | "audio"
            | "voice"
            | "script"
            | "zip_bundle"
            | undefined,
          limit: args.limit as number | undefined,
        });
        if (!result.success) return fail("search assets failed");
        return ok({
          success: true,
          assets: result.assets,
          total: result.total,
        });
      }

      case "notesCurator.getAssetStatistics": {
        const result = await tools.getAssetStatistics(opts.userId);
        if (!result.success) return fail("failed to get statistics");
        return ok({
          success: true,
          statistics: result.statistics,
        });
      }

      default:
        return fail(`unknown notesCurator tool: ${call.name}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
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
    bulkUpdatePreferences,
    previewPreferenceDiff,
    applyPreset,
    listPresets,
    resetPreference,
    searchSettings,
    detectInconsistencies,
    recommendOptimizations,
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

      case "settingsDetail.bulkUpdate": {
        const items = args.items;
        if (!Array.isArray(items) || items.length === 0) {
          return {
            name: call.name,
            ok: false,
            error: "items must be a non-empty array of { key, value } objects",
          };
        }
        const result = await bulkUpdatePreferences({
          userId: opts.userId,
          items: items as Array<{ key: string; value: unknown }>,
        });
        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            applied: result.applied,
            failed: result.failed,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "settingsDetail.previewDiff": {
        const items = args.items;
        if (!Array.isArray(items) || items.length === 0) {
          return {
            name: call.name,
            ok: false,
            error: "items must be a non-empty array of { key, value } objects",
          };
        }
        const result = await previewPreferenceDiff({
          userId: opts.userId,
          items: items as Array<{ key: string; value: unknown }>,
        });
        return {
          name: call.name,
          ok: result.success,
          data: {
            diff: result.diff,
            invalid: result.invalid,
          },
          usedTool: call.name,
        };
      }

      case "settingsDetail.applyPreset": {
        const presetId = args.presetId as string;
        if (!presetId) {
          return {
            name: call.name,
            ok: false,
            error: "presetId is required",
          };
        }
        const result = await applyPreset({ userId: opts.userId, presetId });
        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            preset: result.preset,
            applied: result.applied,
            failed: result.failed,
            message: result.message,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "settingsDetail.listPresets": {
        const result = listPresets();
        return {
          name: call.name,
          ok: true,
          data: result,
          usedTool: call.name,
        };
      }

      case "settingsDetail.resetPreference": {
        const key = args.key as string;
        if (!key) {
          return {
            name: call.name,
            ok: false,
            error: "key is required",
          };
        }
        const result = await resetPreference({ userId: opts.userId, key });
        return {
          name: call.name,
          ok: result.success,
          data: {
            success: result.success,
            message: result.message,
            resetTo: result.resetTo,
          },
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "settingsDetail.searchSettings": {
        const query = args.query as string;
        if (typeof query !== "string") {
          return {
            name: call.name,
            ok: false,
            error: "query (string) is required",
          };
        }
        const result = searchSettings(query);
        return {
          name: call.name,
          ok: true,
          data: result,
          usedTool: call.name,
        };
      }

      case "settingsDetail.detectInconsistencies": {
        const result = await detectInconsistencies(opts.userId);
        return {
          name: call.name,
          ok: result.success,
          data: {
            inconsistencies: result.inconsistencies,
            count: result.inconsistencies.length,
          },
          usedTool: call.name,
        };
      }

      case "settingsDetail.recommendOptimizations": {
        const result = await recommendOptimizations(opts.userId);
        return {
          name: call.name,
          ok: result.success,
          data: {
            recommendations: result.recommendations,
            count: result.recommendations.length,
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
    recommendModel,
    enhancePrompt,
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

      case "imageSpecialist.getModels": {
        const rawCategory =
          typeof args.category === "string" ? args.category.trim().toLowerCase() : "all";
        const category: "text-to-image" | "image-to-image" | "all" =
          rawCategory === "text-to-image" || rawCategory === "image-to-image"
            ? rawCategory
            : "all";
        const result = getImageModels(category);
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "imageSpecialist.recommendModel": {
        const rawIntent =
          typeof args.intent === "string" ? args.intent.trim().toLowerCase() : "";
        // 對齊 imageSpecialistTools.ImageIntent — LLM 傳近似詞做白名單檢查，避免
        // 用 "fancy" / "good" 之類無效 intent 落到 fallback。
        const validIntents = [
          "realistic",
          "draft",
          "illustration",
          "brand",
          "lora",
          "edit",
          "upscale",
          "text-design",
          "anatomy",
          "anime",
        ] as const;
        type Intent = typeof validIntents[number];
        if (!validIntents.includes(rawIntent as Intent)) {
          return {
            name: call.name,
            ok: false,
            error: `intent must be one of: ${validIntents.join(", ")}`,
          };
        }
        const result = recommendModel({
          intent: rawIntent as Intent,
          useCase: typeof args.useCase === "string" ? args.useCase : undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "imageSpecialist.enhancePrompt": {
        const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
        if (!prompt) {
          return {
            name: call.name,
            ok: false,
            error: "prompt is required",
          };
        }
        const style = typeof args.style === "string" ? args.style : undefined;
        const mood = typeof args.mood === "string" ? args.mood : undefined;
        const useCase = typeof args.useCase === "string" ? args.useCase : undefined;
        const result = enhancePrompt({
          prompt,
          style: style as Parameters<typeof enhancePrompt>[0]["style"],
          mood: mood as Parameters<typeof enhancePrompt>[0]["mood"],
          useCase,
        });
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
    enhanceVideo,
    recommendModel,
    estimateCost,
    planVideoWorkflow,
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
          imageUrl: args.imageUrl as string | undefined,
          endImageUrl: args.endImageUrl as string | undefined,
          videoUrl: args.videoUrl as string | undefined,
          duration: args.duration as number | undefined,
          aspectRatio: args.aspectRatio as string | undefined,
          fps: args.fps as number | undefined,
          negativePrompt: args.negativePrompt as string | undefined,
          qualityTier: args.qualityTier as
            | "draft"
            | "standard"
            | "premium"
            | "ultra"
            | undefined,
          seed: args.seed as number | undefined,
          awaitCompletion: args.awaitCompletion as boolean | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.error ?? result.message }),
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
          endImageUrl: args.endImageUrl as string | undefined,
          duration: args.duration as number | undefined,
          aspectRatio: args.aspectRatio as string | undefined,
          motion: args.motion as "subtle" | "moderate" | "dynamic" | undefined,
          qualityTier: args.qualityTier as
            | "draft"
            | "standard"
            | "premium"
            | "ultra"
            | undefined,
          seed: args.seed as number | undefined,
          awaitCompletion: args.awaitCompletion as boolean | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.error ?? result.message }),
        };
      }

      case "videoSpecialist.lipSync": {
        // 新版 lipSync 接收 imageUrl + audioUrl（image 是頭像，audio 是配音）。
        // 舊版接收 videoUrl + audioUrl，所以 videoUrl 在缺 imageUrl 時可以做為
        // fallback——這層相容性讓既有 LLM 規劃即使沒切換也能跑。
        const imageUrl =
          (args.imageUrl as string | undefined) ||
          (args.videoUrl as string | undefined);
        const audioUrl = args.audioUrl as string;

        if (!imageUrl || !audioUrl) {
          return {
            name: call.name,
            ok: false,
            error: "imageUrl (or videoUrl) and audioUrl are required",
          };
        }

        const result = await createLipSync({
          userId: opts.userId,
          imageUrl,
          audioUrl,
          prompt: args.prompt as string | undefined,
          modelId: args.modelId as string | undefined,
          qualityTier: args.qualityTier as
            | "draft"
            | "standard"
            | "premium"
            | "ultra"
            | undefined,
          numFrames: args.numFrames as number | undefined,
          awaitCompletion: args.awaitCompletion as boolean | undefined,
        });

        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.error ?? result.message }),
        };
      }

      case "videoSpecialist.enhance": {
        const videoUrl = args.videoUrl as string;
        const operation = args.operation as
          | "upscale"
          | "interpolate"
          | "enhance"
          | undefined;
        if (!videoUrl) {
          return {
            name: call.name,
            ok: false,
            error: "videoUrl is required",
          };
        }
        if (
          operation !== "upscale" &&
          operation !== "interpolate" &&
          operation !== "enhance"
        ) {
          return {
            name: call.name,
            ok: false,
            error:
              "operation must be one of: upscale, interpolate, enhance",
          };
        }
        const result = await enhanceVideo({
          userId: opts.userId,
          videoUrl,
          operation,
          modelId: args.modelId as string | undefined,
          upscaleFactor: args.upscaleFactor as number | undefined,
          multiplier: args.multiplier as number | undefined,
          outputFps: args.outputFps as number | undefined,
          topazModel: args.topazModel as string | undefined,
          awaitCompletion: args.awaitCompletion as boolean | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.error ?? result.message }),
        };
      }

      case "videoSpecialist.recommendModel": {
        const intent = args.intent as
          | "text-to-video"
          | "image-to-video"
          | "video-to-video"
          | "speech-to-video"
          | "enhance-video"
          | undefined;
        if (!intent) {
          return {
            name: call.name,
            ok: false,
            error: "intent is required",
          };
        }
        const result = recommendModel({
          intent,
          durationSec: args.durationSec as number | undefined,
          budgetPoints: args.budgetPoints as number | undefined,
          qualityTier: args.qualityTier as
            | "draft"
            | "standard"
            | "premium"
            | "ultra"
            | undefined,
          hint: args.hint as string | undefined,
        });
        return {
          name: call.name,
          ok: true,
          data: result,
          usedTool: call.name,
        };
      }

      case "videoSpecialist.estimateCost": {
        const modelId = args.modelId as string;
        if (!modelId) {
          return {
            name: call.name,
            ok: false,
            error: "modelId is required",
          };
        }
        const result = await estimateCost({
          modelId,
          durationSec: args.durationSec as number | undefined,
        });
        return {
          name: call.name,
          ok: true,
          data: result,
          usedTool: call.name,
        };
      }

      case "videoSpecialist.planWorkflow": {
        const goal = args.goal as string;
        if (!goal) {
          return {
            name: call.name,
            ok: false,
            error: "goal is required",
          };
        }
        const result = planVideoWorkflow({
          goal,
          durationSec: args.durationSec as number | undefined,
          withLipSync: args.withLipSync as boolean | undefined,
          withVoiceover: args.withVoiceover as boolean | undefined,
          withMusic: args.withMusic as boolean | undefined,
          withEnhance: args.withEnhance as boolean | undefined,
          startingImageUrl: args.startingImageUrl as string | undefined,
        });
        return {
          name: call.name,
          ok: true,
          data: result,
          usedTool: call.name,
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
        const scenario = args.scenario as
          | "text-to-video"
          | "image-to-video"
          | "video-to-video"
          | "speech-to-video"
          | "enhance-video"
          | "general"
          | undefined;
        const result = getVideoGenerationTips(scenario);
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
    cloneVoice,
    designVoice,
    changeVoice,
    generateSfx,
    getAvailableVoices,
    pickVoice,
    recommendModel,
    planVoiceover,
    getEmotionTags,
    getVoiceGenerationTips,
  } = await import("./spiritTools/voiceSpecialistTools");

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "voiceSpecialist.generateSpeech": {
        const text = args.text as string;
        if (!text) {
          return { name: call.name, ok: false, error: "text is required" };
        }
        const result = await generateSpeech({
          userId: opts.userId,
          text,
          voiceId: args.voiceId as string | undefined,
          language: args.language as string | undefined,
          speed: args.speed as number | undefined,
          emotionTags: Array.isArray(args.emotionTags)
            ? (args.emotionTags as string[])
            : undefined,
          stability: args.stability as number | undefined,
          similarityBoost: args.similarityBoost as number | undefined,
          style: args.style as number | undefined,
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

      case "voiceSpecialist.transcribe": {
        const audioUrl = args.audioUrl as string;
        if (!audioUrl) {
          return { name: call.name, ok: false, error: "audioUrl is required" };
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

      case "voiceSpecialist.cloneVoice": {
        const audioUrl = args.audioUrl as string;
        if (!audioUrl) {
          return { name: call.name, ok: false, error: "audioUrl is required" };
        }
        const result = await cloneVoice({
          userId: opts.userId,
          audioUrl,
          name: args.name as string | undefined,
          description: args.description as string | undefined,
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

      case "voiceSpecialist.designVoice": {
        const description = args.description as string;
        if (!description) {
          return {
            name: call.name,
            ok: false,
            error: "description is required",
          };
        }
        const result = await designVoice({
          userId: opts.userId,
          description,
          previewText: args.previewText as string | undefined,
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

      case "voiceSpecialist.changeVoice": {
        const audioUrl = args.audioUrl as string;
        const voiceId = args.voiceId as string;
        if (!audioUrl || !voiceId) {
          return {
            name: call.name,
            ok: false,
            error: "audioUrl and voiceId are required",
          };
        }
        const result = await changeVoice({
          userId: opts.userId,
          audioUrl,
          voiceId,
          removeBackgroundNoise:
            args.removeBackgroundNoise as boolean | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "voiceSpecialist.generateSfx": {
        const description = args.description as string;
        if (!description) {
          return {
            name: call.name,
            ok: false,
            error: "description is required",
          };
        }
        const result = await generateSfx({
          userId: opts.userId,
          description,
          durationSeconds: args.durationSeconds as number | undefined,
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
        const result = getAvailableVoices({
          gender: args.gender as "male" | "female" | "neutral" | undefined,
          language: args.language as string | undefined,
          mood: args.mood as string | undefined,
          limit: args.limit as number | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "voiceSpecialist.pickVoice": {
        const result = pickVoice({
          language: args.language as string | undefined,
          gender: args.gender as "male" | "female" | "neutral" | undefined,
          scenario: args.scenario as string | undefined,
          mood: args.mood as string | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "voiceSpecialist.recommendModel": {
        const result = recommendModel({
          language: args.language as string | undefined,
          scenario: args.scenario as string | undefined,
          needsEmotion: args.needsEmotion as boolean | undefined,
          needsLowLatency: args.needsLowLatency as boolean | undefined,
          needsMultiSpeaker: args.needsMultiSpeaker as boolean | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "voiceSpecialist.planVoiceover": {
        const script = args.script as string;
        if (!script) {
          return { name: call.name, ok: false, error: "script is required" };
        }
        const result = planVoiceover({
          script,
          baseEmotion: args.baseEmotion as
            | "neutral"
            | "calm"
            | "warm"
            | "excited"
            | "serious"
            | "playful"
            | undefined,
          multiSpeaker: args.multiSpeaker as boolean | undefined,
          charsPerSecond: args.charsPerSecond as number | undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.reasoning }),
        };
      }

      case "voiceSpecialist.getEmotionTags": {
        const result = getEmotionTags();
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "voiceSpecialist.getTips": {
        const result = getVoiceGenerationTips(args.scenario as string | undefined);
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
  const {
    getTutorial,
    listTutorials,
    getQuickTips,
    searchLearningContent,
    recommendForContext,
    generateLearningPath,
    explainConcept,
    getUserLearningProgress,
    getNextLearningStep,
  } = await import("./spiritTools/learningSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  type Difficulty = "beginner" | "intermediate" | "advanced";
  const asDifficulty = (v: unknown): Difficulty | undefined =>
    v === "beginner" || v === "intermediate" || v === "advanced" ? v : undefined;

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

      case "learningSpecialist.searchLearningContent": {
        const query = args.query as string;
        if (!query || typeof query !== "string") {
          return { name: call.name, ok: false, error: "query is required" };
        }
        const type = args.type === "doc" || args.type === "video" || args.type === "quiz" || args.type === "all"
          ? args.type
          : undefined;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const result = searchLearningContent({
          query,
          type,
          difficulty: asDifficulty(args.difficulty),
          limit,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "learningSpecialist.recommendForContext": {
        const result = recommendForContext({
          currentPath: typeof args.currentPath === "string" ? args.currentPath : undefined,
          topic: typeof args.topic === "string" ? args.topic : undefined,
          difficulty: asDifficulty(args.difficulty),
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

      case "learningSpecialist.generateLearningPath": {
        const goal = args.goal as string;
        if (!goal || typeof goal !== "string") {
          return { name: call.name, ok: false, error: "goal is required" };
        }
        const result = generateLearningPath({
          goal,
          currentLevel: asDifficulty(args.currentLevel),
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "learningSpecialist.explainConcept": {
        const concept = args.concept as string;
        if (!concept || typeof concept !== "string") {
          return { name: call.name, ok: false, error: "concept is required" };
        }
        const result = explainConcept({
          concept,
          level: asDifficulty(args.level),
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "learningSpecialist.getUserLearningProgress": {
        const userId = typeof args.userId === "number" ? args.userId : opts.userId;
        const result = await getUserLearningProgress({ userId });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
      }

      case "learningSpecialist.getNextLearningStep": {
        const result = await getNextLearningStep({
          userId: typeof args.userId === "number" ? args.userId : opts.userId,
          currentPath: typeof args.currentPath === "string" ? args.currentPath : undefined,
          hint: typeof args.hint === "string" ? args.hint : undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
        };
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
  const tools = await import("./spiritTools/musicSpecialistTools");
  const {
    generateMusic,
    generateSoundEffect,
    getMusicOptions,
    getMusicGenerationTips,
    recommendEngine,
    buildPrompt,
    estimateMusicCost,
    listEngines,
    getRecentAudioAssets,
  } = tools;
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
          modelId: args.modelId as string | undefined,
          duration: args.duration as number | undefined,
          genre: args.genre as string | undefined,
          mood: args.mood as string | undefined,
          instrumental: args.instrumental as boolean | undefined,
          lyrics: args.lyrics as string | undefined,
          tags: args.tags as string | undefined,
          bpm: args.bpm as number | undefined,
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
          modelId: args.modelId as string | undefined,
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

      case "musicSpecialist.recommendEngine": {
        const capability = args.capability as string | undefined;
        if (!capability) {
          return { name: call.name, ok: false, error: "capability is required" };
        }
        const result = recommendEngine({
          capability: capability as Parameters<typeof recommendEngine>[0]["capability"],
          durationSec: args.durationSec as number | undefined,
          needsVocals: args.needsVocals as boolean | undefined,
          prioritizeBudget: args.prioritizeBudget as boolean | undefined,
          excludeModelIds: Array.isArray(args.excludeModelIds)
            ? (args.excludeModelIds as string[])
            : undefined,
        });
        return { name: call.name, ok: !!result.primary, data: result, usedTool: call.name };
      }

      case "musicSpecialist.buildPrompt": {
        const modelId = args.modelId as string | undefined;
        if (!modelId) {
          return { name: call.name, ok: false, error: "modelId is required" };
        }
        const result = buildPrompt({
          modelId,
          mood: args.mood as string | undefined,
          genre: args.genre as string | undefined,
          instruments: Array.isArray(args.instruments)
            ? (args.instruments as string[])
            : undefined,
          bpm: args.bpm as number | undefined,
          seamlessLoop: args.seamlessLoop as boolean | undefined,
          references: args.references as string | undefined,
          lyrics: args.lyrics as string | undefined,
          durationSec: args.durationSec as number | undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "musicSpecialist.estimateCost": {
        const modelId = args.modelId as string | undefined;
        if (!modelId) {
          return { name: call.name, ok: false, error: "modelId is required" };
        }
        const result = estimateMusicCost({
          modelId,
          durationSec: args.durationSec as number | undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "musicSpecialist.listEngines": {
        const capability = args.capability as string | undefined;
        type ListEnginesInput = NonNullable<Parameters<typeof listEngines>[0]>;
        const result = listEngines(
          capability
            ? { capability: capability as ListEnginesInput["capability"] }
            : {}
        );
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "musicSpecialist.getRecentAssets": {
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const result = await getRecentAudioAssets(opts.userId, limit);
        return { name: call.name, ok: true, data: result, usedTool: call.name };
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
  const {
    listMyModels,
    getModelStatus,
    recommendParams,
    analyzeDataset,
    estimateTraining,
    getTips,
    isTrainingModelType,
  } = await import("./spiritTools/trainingSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "trainingSpecialist.listMyModels": {
        const result = await listMyModels(opts.userId);
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "trainingSpecialist.getModelStatus": {
        const rawId = args.modelId ?? args.id;
        const modelId =
          typeof rawId === "number"
            ? rawId
            : typeof rawId === "string"
              ? Number.parseInt(rawId, 10)
              : NaN;
        if (!Number.isFinite(modelId)) {
          return { name: call.name, ok: false, error: "modelId (number) is required" };
        }
        const result = await getModelStatus({ userId: opts.userId, modelId });
        return {
          name: call.name,
          ok: result.ok,
          data: result,
          usedTool: call.name,
          ...(result.ok ? {} : { error: result.summary }),
        };
      }

      case "trainingSpecialist.recommendParams": {
        const modelType = args.modelType;
        if (!isTrainingModelType(modelType)) {
          return {
            name: call.name,
            ok: false,
            error:
              "modelType is required (image_subject | portrait_lora | style_lora | scene_lora | video_lora | voice_clone)",
          };
        }
        const imageCount =
          typeof args.imageCount === "number" ? args.imageCount : undefined;
        const videoCount =
          typeof args.videoCount === "number" ? args.videoCount : undefined;
        const preference =
          args.preference === "speed" ||
          args.preference === "quality" ||
          args.preference === "balanced"
            ? args.preference
            : undefined;
        const result = recommendParams({
          modelType,
          imageCount,
          videoCount,
          preference,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "trainingSpecialist.analyzeDataset": {
        const modelType = args.modelType;
        if (!isTrainingModelType(modelType)) {
          return {
            name: call.name,
            ok: false,
            error: "modelType is required",
          };
        }
        const imageCount =
          typeof args.imageCount === "number" ? args.imageCount : undefined;
        const videoCount =
          typeof args.videoCount === "number" ? args.videoCount : undefined;
        const result = analyzeDataset({ modelType, imageCount, videoCount });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "trainingSpecialist.estimateTraining": {
        const modelType = args.modelType;
        if (!isTrainingModelType(modelType)) {
          return {
            name: call.name,
            ok: false,
            error: "modelType is required",
          };
        }
        const steps = typeof args.steps === "number" ? args.steps : undefined;
        const falModelId =
          typeof args.falModelId === "string" ? args.falModelId : undefined;
        const result = estimateTraining({ modelType, steps, falModelId });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "trainingSpecialist.getTips": {
        const modelType = args.modelType;
        const result = getTips(
          isTrainingModelType(modelType) ? { modelType } : {}
        );
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      default:
        return {
          name: call.name,
          ok: false,
          error: `unknown trainingSpecialist tool: ${call.name}`,
        };
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
// communityManager.* 工具橋接：群群（community-manager）的社群經營工具
// 6 個純函式工具 + 1 個平台元資料查詢，全對應 system prompt slice 的
// 「平台 × 年齡層 × 貼文公式 × hashtag × 排程」職責。
// ═══════════════════════════════════════════════════════════════════════════

const COMMUNITY_PLATFORMS: ReadonlySet<string> = new Set([
  "instagram", "tiktok", "youtube", "xiaohongshu", "facebook", "linkedin",
]);
const COMMUNITY_AUDIENCE_AGES: ReadonlySet<string> = new Set([
  "13-17", "18-24", "25-34", "35-44", "45+",
]);
const COMMUNITY_ASSET_TYPES: ReadonlySet<string> = new Set([
  "short-video", "image-post", "carousel", "long-video", "text-only",
]);
const COMMUNITY_GOALS: ReadonlySet<string> = new Set([
  "reach", "engagement", "conversion", "branding",
]);

async function dispatchCommunityManagerTool(
  call: OrbToolCall,
  _opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const {
    buildPostPlan,
    nextClarificationQuestion,
    recommendHashtags,
    planWeeklySchedule,
    critiqueHook,
    formatCaption,
    listSupportedPlatforms,
  } = await import("./spiritTools/communityManagerTools");
  type CM = typeof import("./spiritTools/communityManagerTools");
  type Platform = Parameters<CM["buildPostPlan"]>[0]["platform"];
  type Age = Parameters<CM["buildPostPlan"]>[0]["audienceAge"];
  type Asset = Parameters<CM["buildPostPlan"]>[0]["assetType"];
  type Goal = NonNullable<Parameters<CM["buildPostPlan"]>[0]["goal"]>;

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "communityManager.buildPostPlan": {
        const platform = args.platform as string;
        const audienceAge = args.audienceAge as string;
        const theme = args.theme as string;
        const assetType = args.assetType as string;
        const goal = args.goal as string | undefined;

        if (!COMMUNITY_PLATFORMS.has(platform)) {
          return { name: call.name, ok: false, error: `platform must be one of: ${Array.from(COMMUNITY_PLATFORMS).join(", ")}` };
        }
        if (!COMMUNITY_AUDIENCE_AGES.has(audienceAge)) {
          return { name: call.name, ok: false, error: `audienceAge must be one of: ${Array.from(COMMUNITY_AUDIENCE_AGES).join(", ")}` };
        }
        if (typeof theme !== "string" || theme.trim().length === 0) {
          return { name: call.name, ok: false, error: "theme is required" };
        }
        if (!COMMUNITY_ASSET_TYPES.has(assetType)) {
          return { name: call.name, ok: false, error: `assetType must be one of: ${Array.from(COMMUNITY_ASSET_TYPES).join(", ")}` };
        }
        if (goal !== undefined && !COMMUNITY_GOALS.has(goal)) {
          return { name: call.name, ok: false, error: `goal must be one of: ${Array.from(COMMUNITY_GOALS).join(", ")}` };
        }
        const result = buildPostPlan({
          platform: platform as Platform,
          audienceAge: audienceAge as Age,
          theme: theme.trim(),
          assetType: assetType as Asset,
          ...(goal ? { goal: goal as Goal } : {}),
          ...(typeof args.rawDraft === "string" ? { rawDraft: args.rawDraft } : {}),
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "communityManager.nextClarification": {
        // 只接受合法欄位名稱；多餘 key 不要傳進去，避免污染。
        const partial = (args.partial ?? args) as Record<string, unknown>;
        const safe: Record<string, unknown> = {};
        if (typeof partial.platform === "string" && COMMUNITY_PLATFORMS.has(partial.platform)) safe.platform = partial.platform;
        if (typeof partial.audienceAge === "string" && COMMUNITY_AUDIENCE_AGES.has(partial.audienceAge)) safe.audienceAge = partial.audienceAge;
        if (typeof partial.theme === "string" && partial.theme.trim().length > 0) safe.theme = partial.theme.trim();
        if (typeof partial.assetType === "string" && COMMUNITY_ASSET_TYPES.has(partial.assetType)) safe.assetType = partial.assetType;
        if (typeof partial.goal === "string" && COMMUNITY_GOALS.has(partial.goal)) safe.goal = partial.goal;
        const q = nextClarificationQuestion(safe as Parameters<typeof nextClarificationQuestion>[0]);
        return { name: call.name, ok: true, data: { question: q }, usedTool: call.name };
      }

      case "communityManager.recommendHashtags": {
        const platform = args.platform as string;
        const theme = args.theme as string;
        if (!COMMUNITY_PLATFORMS.has(platform)) {
          return { name: call.name, ok: false, error: `platform must be one of: ${Array.from(COMMUNITY_PLATFORMS).join(", ")}` };
        }
        if (typeof theme !== "string" || theme.trim().length === 0) {
          return { name: call.name, ok: false, error: "theme is required" };
        }
        const maxCount = typeof args.maxCount === "number" && Number.isFinite(args.maxCount) ? args.maxCount : undefined;
        const result = recommendHashtags({
          platform: platform as Platform,
          theme: theme.trim(),
          ...(maxCount !== undefined ? { maxCount } : {}),
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "communityManager.planWeeklySchedule": {
        const platforms = args.platforms;
        if (!Array.isArray(platforms) || platforms.length === 0) {
          return { name: call.name, ok: false, error: "platforms must be a non-empty array" };
        }
        const invalid = platforms.find(p => typeof p !== "string" || !COMMUNITY_PLATFORMS.has(p));
        if (invalid !== undefined) {
          return { name: call.name, ok: false, error: `invalid platform: ${String(invalid)}` };
        }
        const startDate = typeof args.startDate === "string" ? args.startDate : undefined;
        const result = planWeeklySchedule({
          platforms: platforms as Platform[],
          ...(startDate ? { startDate } : {}),
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "communityManager.critiqueHook": {
        const hook = args.hook as string;
        const platform = args.platform as string;
        if (typeof hook !== "string" || hook.trim().length === 0) {
          return { name: call.name, ok: false, error: "hook is required" };
        }
        if (!COMMUNITY_PLATFORMS.has(platform)) {
          return { name: call.name, ok: false, error: `platform must be one of: ${Array.from(COMMUNITY_PLATFORMS).join(", ")}` };
        }
        const result = critiqueHook({ hook: hook.trim(), platform: platform as Platform });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "communityManager.formatCaption": {
        const rawText = args.rawText as string;
        const platform = args.platform as string;
        if (typeof rawText !== "string" || rawText.trim().length === 0) {
          return { name: call.name, ok: false, error: "rawText is required" };
        }
        if (!COMMUNITY_PLATFORMS.has(platform)) {
          return { name: call.name, ok: false, error: `platform must be one of: ${Array.from(COMMUNITY_PLATFORMS).join(", ")}` };
        }
        const hashtags = Array.isArray(args.hashtags)
          ? (args.hashtags as unknown[]).filter((t): t is string => typeof t === "string")
          : undefined;
        const result = formatCaption({
          rawText,
          platform: platform as Platform,
          ...(hashtags ? { hashtags } : {}),
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "communityManager.listPlatforms": {
        const result = listSupportedPlatforms();
        return { name: call.name, ok: true, data: { platforms: result }, usedTool: call.name };
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
// planExecutor.* 工具橋接：步步（plan-executor）的真實 agent 引擎
// ═══════════════════════════════════════════════════════════════════════════

async function dispatchPlanExecutorTool(
  call: OrbToolCall,
  opts: ExecuteOrbToolCallsOptions
): Promise<OrbToolCallResult> {
  const mod = await import("./spiritTools/planExecutorTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "planExecutor.planFromGoal": {
        const goal = typeof args.goal === "string" ? args.goal : "";
        if (!goal) return { name: call.name, ok: false, error: "goal is required" };
        const result = await mod.planFromGoal({
          userId: opts.userId,
          userRole: opts.userRole,
          goal,
          context: typeof args.context === "string" ? args.context : undefined,
          // Pass the orchestrator's tool registry so the runner can actually
          // dispatch HTTP-target tools when the plan asks for them.
          tools: opts.tools,
          blockedTools: opts.blockedTools,
          maxSteps: typeof args.maxSteps === "number" ? args.maxSteps : undefined,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.createPlan": {
        const goal = typeof args.goal === "string" ? args.goal : "";
        const steps = Array.isArray(args.steps) ? args.steps : null;
        if (!goal || !steps) {
          return { name: call.name, ok: false, error: "goal and steps are required" };
        }
        // Accept BOTH shapes:
        //   - legacy: [{ action: "studio.x", parameters: {...} }]
        //   - new:    [{ id, label, toolName, toolArgs, dependsOn, ... }]
        const normalized = steps.map((raw, idx) => {
          const r = raw as Record<string, unknown>;
          const legacyAction = typeof r.action === "string" ? (r.action as string) : undefined;
          return {
            id: typeof r.id === "string" ? (r.id as string) : `step${idx + 1}`,
            label: typeof r.label === "string" ? (r.label as string) : legacyAction ?? `Step ${idx + 1}`,
            toolName:
              typeof r.toolName === "string"
                ? (r.toolName as string)
                : legacyAction && legacyAction.includes(".")
                  ? legacyAction
                  : undefined,
            toolArgs:
              (r.toolArgs as Record<string, unknown> | undefined) ??
              (r.parameters as Record<string, unknown> | undefined),
            toolResultBinding: typeof r.toolResultBinding === "string" ? (r.toolResultBinding as string) : undefined,
            dependsOn: Array.isArray(r.dependsOn) ? (r.dependsOn as string[]) : undefined,
            path: typeof r.path === "string" ? (r.path as string) : undefined,
            actionType: typeof r.actionType === "string" ? (r.actionType as string) : undefined,
            payload: typeof r.payload === "string" ? (r.payload as string) : undefined,
            retryPolicy: r.retryPolicy as
              | { maxAttempts?: number; backoffMs?: number; skipOnFail?: boolean }
              | undefined,
          };
        });
        const result = mod.createPlan({
          userId: opts.userId,
          userRole: opts.userRole,
          goal,
          steps: normalized,
          tools: opts.tools,
          blockedTools: opts.blockedTools,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.runPlan": {
        const planId = typeof args.planId === "string" ? args.planId : "";
        if (!planId) return { name: call.name, ok: false, error: "planId is required" };
        const result = await mod.runPlan({
          userId: opts.userId,
          planId,
          async: args.async === false ? false : true,
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
        const planId = typeof args.planId === "string" ? args.planId : "";
        if (!planId) return { name: call.name, ok: false, error: "planId is required" };
        const stepIndex = typeof args.stepIndex === "number" ? (args.stepIndex as number) : undefined;
        const stepId = typeof args.stepId === "string" ? (args.stepId as string) : undefined;
        if (stepIndex === undefined && !stepId) {
          return { name: call.name, ok: false, error: "stepIndex or stepId is required" };
        }
        const result = await mod.executeStep({
          userId: opts.userId,
          planId,
          stepIndex,
          stepId,
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
        const planId = typeof args.planId === "string" ? args.planId : "";
        if (!planId) return { name: call.name, ok: false, error: "planId is required" };
        const result = mod.getStatus({ userId: opts.userId, planId });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "planExecutor.controlPlan": {
        const planId = typeof args.planId === "string" ? args.planId : "";
        const action = args.action as "pause" | "resume" | "cancel" | undefined;
        if (!planId || !action) {
          return { name: call.name, ok: false, error: "planId and action are required" };
        }
        if (action !== "pause" && action !== "resume" && action !== "cancel") {
          return { name: call.name, ok: false, error: `invalid action: ${action}` };
        }
        const result = mod.controlPlan({ userId: opts.userId, planId, action });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.listRuns": {
        const limit = typeof args.limit === "number" ? (args.limit as number) : undefined;
        const result = mod.listRuns({ userId: opts.userId, limit });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "planExecutor.replanOnFailure": {
        const planId = typeof args.planId === "string" ? args.planId : "";
        if (!planId) return { name: call.name, ok: false, error: "planId is required" };
        const result = await mod.replanOnFailure({
          userId: opts.userId,
          userRole: opts.userRole,
          planId,
          hint: typeof args.hint === "string" ? (args.hint as string) : undefined,
          tools: opts.tools,
          blockedTools: opts.blockedTools,
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "planExecutor.getTemplates": {
        const result = mod.getWorkflowTemplates();
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
  const {
    searchTrends,
    getCreativeSuggestions,
    analyzeReference,
    getStyleMixingSuggestions,
    buildMoodBoard,
    refinePromptVariants,
    rankStylesByIntent,
    getStyleAtlas,
  } = await import("./spiritTools/inspirationSpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  const asString = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v : undefined;
  const asNumber = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const asStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

  type Modality = "image" | "video" | "audio" | "voice" | "3d" | "general";
  const VALID_MODALITIES: ReadonlyArray<Modality> = [
    "image",
    "video",
    "audio",
    "voice",
    "3d",
    "general",
  ];
  const asModality = (v: unknown): Modality | undefined => {
    const s = asString(v);
    return s && (VALID_MODALITIES as ReadonlyArray<string>).includes(s) ? (s as Modality) : undefined;
  };

  try {
    switch (call.name) {
      case "inspirationSpecialist.searchTrends": {
        const category = args.category as "image" | "video" | "music" | "general";
        if (!category) {
          return { name: call.name, ok: false, error: "category is required" };
        }

        const result = await searchTrends({
          category,
          region: asString(args.region),
          topic: asString(args.topic),
          maxResults: asNumber(args.maxResults),
          userId: opts.userId,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.getSuggestions": {
        const intent = asString(args.intent);
        if (!intent) {
          return { name: call.name, ok: false, error: "intent is required" };
        }

        const result = getCreativeSuggestions({
          intent,
          style: asString(args.style),
          modality: asModality(args.modality),
          count: asNumber(args.count),
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.analyzeReference": {
        const imageUrl = asString(args.imageUrl);
        if (!imageUrl) {
          return { name: call.name, ok: false, error: "imageUrl is required" };
        }

        const result = await analyzeReference({
          imageUrl,
          userId: opts.userId,
          userHint: asString(args.userHint),
        });
        return {
          name: call.name,
          ok: result.success,
          data: result,
          usedTool: call.name,
          ...(result.success ? {} : { error: result.message }),
        };
      }

      case "inspirationSpecialist.getStyleMixing": {
        const result = getStyleMixingSuggestions({
          seedStyle: asString(args.seedStyle),
          modality: asModality(args.modality),
          count: asNumber(args.count),
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.buildMoodBoard": {
        const topic = asString(args.topic);
        if (!topic) {
          return { name: call.name, ok: false, error: "topic is required" };
        }
        const result = await buildMoodBoard({
          topic,
          modality: asModality(args.modality),
          size: asNumber(args.size),
          userId: opts.userId,
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.refinePromptVariants": {
        const draftPrompt = asString(args.draftPrompt);
        if (!draftPrompt) {
          return { name: call.name, ok: false, error: "draftPrompt is required" };
        }
        const result = refinePromptVariants({
          draftPrompt,
          modality: asModality(args.modality),
          count: asNumber(args.count),
          excludeStyles: asStringArray(args.excludeStyles),
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.rankStylesByIntent": {
        const intent = asString(args.intent);
        if (!intent) {
          return { name: call.name, ok: false, error: "intent is required" };
        }
        const result = rankStylesByIntent({
          intent,
          modality: asModality(args.modality),
          limit: asNumber(args.limit),
        });
        return { name: call.name, ok: result.success, data: result, usedTool: call.name };
      }

      case "inspirationSpecialist.getStyleAtlas": {
        const result = getStyleAtlas({
          modality: asModality(args.modality),
        });
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
    parseAnatomyIntent,
    buildMultiViewBatch,
    verifyAnatomyResult,
    recommendAnatomyModels,
    summarizeAnatomyRequest,
  } = await import("./spiritTools/anatomySpecialistTools");
  const args = (call.args ?? {}) as Record<string, unknown>;

  // 共用：narrow runtime string → enum，命中合法值才回，否則回 undefined。
  // 用 readonly array 不是 Set 是因為這幾組 enum 太短，linear scan 更便宜。
  const pickEnum = <T extends string>(
    raw: unknown,
    allowed: readonly T[],
  ): T | undefined =>
    typeof raw === "string" && (allowed as readonly string[]).includes(raw)
      ? (raw as T)
      : undefined;

  const BODY_PARTS = [
    "full-body", "head", "skeleton", "muscular",
    "nervous", "vascular", "internal-organs", "limbs",
  ] as const;
  const VIEWS = [
    "anterior", "posterior", "lateral",
    "superior", "inferior", "cross-section",
  ] as const;
  const STYLES = [
    "medical-textbook", "3d-render", "hand-drawn", "simplified-diagram",
  ] as const;
  const PURPOSES = [
    "teaching", "labeling", "reference", "artistic",
  ] as const;

  try {
    switch (call.name) {
      case "anatomySpecialist.buildPrompt": {
        const bodyPart = pickEnum(args.bodyPart, BODY_PARTS);
        const view = pickEnum(args.view, VIEWS);
        const style = pickEnum(args.style, STYLES);
        const purpose = pickEnum(args.purpose, PURPOSES);
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
        // 只接受合法欄位 + 合法 enum 值，避免污染。
        const safe: Record<string, string> = {};
        const bp = pickEnum(partial.bodyPart, BODY_PARTS);
        if (bp) safe.bodyPart = bp;
        const vw = pickEnum(partial.view, VIEWS);
        if (vw) safe.view = vw;
        const st = pickEnum(partial.style, STYLES);
        if (st) safe.style = st;
        const pp = pickEnum(partial.purpose, PURPOSES);
        if (pp) safe.purpose = pp;
        const freeText =
          typeof args.freeText === "string" ? args.freeText : undefined;
        const q = nextClarificationQuestion(
          safe as Parameters<typeof nextClarificationQuestion>[0],
          freeText ? { freeText } : undefined,
        );
        return {
          name: call.name,
          ok: true,
          data: { question: q },
          usedTool: call.name,
        };
      }

      case "anatomySpecialist.labelChecklist": {
        const bodyPart = pickEnum(args.bodyPart, BODY_PARTS);
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

      case "anatomySpecialist.parseIntent": {
        const text = typeof args.text === "string" ? args.text : "";
        if (!text) {
          return { name: call.name, ok: false, error: "text is required" };
        }
        const partial = parseAnatomyIntent(text);
        return {
          name: call.name,
          ok: true,
          data: { partial },
          usedTool: call.name,
        };
      }

      case "anatomySpecialist.buildMultiViewBatch": {
        const bodyPart = pickEnum(args.bodyPart, BODY_PARTS);
        const style = pickEnum(args.style, STYLES);
        const purpose = pickEnum(args.purpose, PURPOSES);
        if (!bodyPart || !style || !purpose) {
          return {
            name: call.name,
            ok: false,
            error: "bodyPart, style, and purpose are required",
          };
        }
        const views = Array.isArray(args.views)
          ? (args.views as unknown[])
              .map(v => pickEnum(v, VIEWS))
              .filter((v): v is typeof VIEWS[number] => v != null)
          : undefined;
        const extra = Array.isArray(args.extraDescriptors)
          ? (args.extraDescriptors as string[])
          : undefined;
        const result = buildMultiViewBatch({
          bodyPart,
          style,
          purpose,
          views,
          extraDescriptors: extra,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "anatomySpecialist.verifyResult": {
        const bodyPart = pickEnum(args.bodyPart, BODY_PARTS);
        if (!bodyPart) {
          return { name: call.name, ok: false, error: "bodyPart is required" };
        }
        const detected = Array.isArray(args.detectedLabels)
          ? (args.detectedLabels as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : [];
        const result = verifyAnatomyResult({
          bodyPart,
          detectedLabels: detected,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "anatomySpecialist.recommendModels": {
        const style = pickEnum(args.style, STYLES);
        const purpose = pickEnum(args.purpose, PURPOSES);
        if (!style || !purpose) {
          return {
            name: call.name,
            ok: false,
            error: "style and purpose are required",
          };
        }
        const result = recommendAnatomyModels({
          style,
          purpose,
          hasReferenceImage:
            typeof args.hasReferenceImage === "boolean"
              ? args.hasReferenceImage
              : undefined,
        });
        return { name: call.name, ok: true, data: result, usedTool: call.name };
      }

      case "anatomySpecialist.summarize": {
        const partial = (args.partial ?? args) as Record<string, unknown>;
        const safe: Record<string, string> = {};
        const bp = pickEnum(partial.bodyPart, BODY_PARTS);
        if (bp) safe.bodyPart = bp;
        const vw = pickEnum(partial.view, VIEWS);
        if (vw) safe.view = vw;
        const st = pickEnum(partial.style, STYLES);
        if (st) safe.style = st;
        const pp = pickEnum(partial.purpose, PURPOSES);
        if (pp) safe.purpose = pp;
        const summary = summarizeAnatomyRequest(
          safe as Parameters<typeof summarizeAnatomyRequest>[0],
        );
        return {
          name: call.name,
          ok: true,
          data: { summary },
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
// research.compareModels 工具橋接：查查專用 — 站內模型 catalogue 結構化比較
// ═══════════════════════════════════════════════════════════════════════════

/**
 * compareModels 是純資料工具 — 從 MODEL_PRICING_CATALOG 拉出某類別所有
 * 模型（或指定的 modelIds）做結構化比較。不打 LLM、不過外部 API，所以
 * 不過 perplexityThrottle、也沒有 retry 包裝。失敗時直接回 ok=false。
 */
async function dispatchCompareModelsTool(
  call: OrbToolCall,
): Promise<OrbToolCallResult> {
  const { getGlobalAgentTool } = await import("../../shared/global-agent-tools");
  const def = getGlobalAgentTool(call.name);
  if (!def) {
    return {
      name: call.name,
      ok: false,
      error: "research-tool-not-registered",
    };
  }

  const args = (call.args ?? {}) as Record<string, unknown>;
  const category = typeof args.category === "string" ? args.category : "";
  if (!category.trim()) {
    return {
      name: call.name,
      ok: false,
      error: "missing-category",
    };
  }

  try {
    const { compareModels, getCategoriesInCatalog } = await import(
      "./spiritTools/researcherTools"
    );
    const available = getCategoriesInCatalog();
    if (!available.includes(category as never)) {
      return {
        name: call.name,
        ok: false,
        error: `unknown-category:${category}`,
        data: { availableCategories: available },
      };
    }
    const modelIds = Array.isArray(args.modelIds)
      ? (args.modelIds.filter(m => typeof m === "string") as string[])
      : undefined;
    const useCase =
      typeof args.useCase === "string" ? (args.useCase as never) : undefined;
    const includeUnavailable = !!args.includeUnavailable;
    const maxResults =
      typeof args.maxResults === "number" ? args.maxResults : undefined;
    const estimateFor =
      args.estimateFor && typeof args.estimateFor === "object"
        ? (args.estimateFor as Record<string, number>)
        : undefined;

    const result = compareModels({
      category: category as never,
      modelIds,
      useCase,
      includeUnavailable,
      maxResults,
      estimateFor,
    });

    return {
      name: call.name,
      ok: true,
      data: result,
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
    // ── 純資料工具（不打 LLM）：直接走 server-side 計算 ──
    if (call.name === "director.composeWorkflow") {
      const { composeWorkflow } = await import("./spiritTools/directorTools");
      const brief = typeof args.brief === "string" ? args.brief : "";
      if (!brief.trim()) {
        return {
          name: call.name,
          ok: false,
          error: "missing-brief",
        };
      }
      const kind = typeof args.kind === "string" ? (args.kind as "short_video") : undefined;
      const platform =
        typeof args.platform === "string" ? (args.platform as "general") : undefined;
      const budgetMode =
        typeof args.budgetMode === "string" ? (args.budgetMode as "balanced") : undefined;
      const stepByStep = !!args.stepByStep;
      const result = composeWorkflow({ brief, kind, platform, budgetMode, stepByStep });
      return {
        name: call.name,
        ok: true,
        data: {
          // 同時回傳 actions 陣列（前端 page-agent 可直接 dispatch）與
          // workflow 物件（UI 渲染 plan preview 用）
          actions: [result.workflow],
          workflow: result.workflow,
          handoffs: result.handoffs,
          kind: result.kind,
          rationale: `導導已組好「${result.workflow.name}」（${result.workflow.steps.length} 步），下一棒可交給 ${result.handoffs
            .map(h => `@${h.nickname}`)
            .join("→")}`,
        },
        usedTool: call.name,
      };
    }

    if (call.name === "director.estimateBudget") {
      const { estimateWorkflowBudget } = await import("./spiritTools/directorTools");
      // 接受兩種輸入：直接給 steps 陣列、或包在 workflow 物件裡
      const rawSteps = Array.isArray(args.steps)
        ? args.steps
        : args.workflow &&
            typeof args.workflow === "object" &&
            Array.isArray((args.workflow as { steps?: unknown }).steps)
          ? (args.workflow as { steps: unknown[] }).steps
          : null;
      if (!rawSteps) {
        return {
          name: call.name,
          ok: false,
          error: "missing-steps",
        };
      }
      // 型別硬轉到 AgentWorkflowStep[] — estimateWorkflowBudget 內部
      // 會 pickStepParams 取需要的欄位、忽略不認識的；非標準步驟會被
      // 當成「非生成步驟」算 0 點，不會丟例外。
      const report = estimateWorkflowBudget({
        steps: rawSteps as Array<{
          id?: string;
          label: string;
          actionType: string;
          payload: string;
          toolArgs?: Record<string, unknown>;
        }> as never,
      });
      return {
        name: call.name,
        ok: true,
        data: report,
        usedTool: call.name,
      };
    }

    if (call.name === "director.suggestHandoff") {
      const { suggestHandoff } = await import("./spiritTools/directorTools");
      const fromRole =
        typeof args.fromRole === "string" ? (args.fromRole as "director") : undefined;
      const userIntent =
        typeof args.userIntent === "string" ? args.userIntent : undefined;
      const hintTokens = Array.isArray(args.hintTokens)
        ? (args.hintTokens.filter(t => typeof t === "string") as string[])
        : undefined;
      const mutedRoles = Array.isArray(args.mutedRoles)
        ? (args.mutedRoles.filter(t => typeof t === "string") as Array<"director">)
        : undefined;
      const busyRoles = Array.isArray(args.busyRoles)
        ? (args.busyRoles.filter(t => typeof t === "string") as Array<"director">)
        : undefined;
      const recentRoles = Array.isArray(args.recentRoles)
        ? (args.recentRoles.filter(t => typeof t === "string") as Array<"director">)
        : undefined;
      const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : undefined;
      const result = suggestHandoff({
        fromRole,
        userIntent,
        hintTokens,
        mutedRoles,
        busyRoles,
        recentRoles,
        maxDepth,
      });
      return {
        name: call.name,
        ok: true,
        data: result,
        usedTool: call.name,
      };
    }

    if (call.name === "director.refineWorkflow") {
      const { refineWorkflowMechanically } = await import("./spiritTools/directorTools");
      const workflow = args.workflow;
      const operations = args.operations;
      if (
        !workflow ||
        typeof workflow !== "object" ||
        !Array.isArray((workflow as { steps?: unknown }).steps) ||
        !Array.isArray(operations)
      ) {
        return {
          name: call.name,
          ok: false,
          error: "missing-workflow-or-operations",
        };
      }
      const result = refineWorkflowMechanically({
        workflow: workflow as never,
        operations: operations as never,
      });
      return {
        name: call.name,
        ok: true,
        data: result,
        usedTool: call.name,
      };
    }

    if (call.name !== "director.suggestPlan") {
      return {
        name: call.name,
        ok: false,
        error: `unknown-director-tool: ${call.name}`,
      };
    }

    // ── LLM-driven 工具：director.suggestPlan ──
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

    // 升級版 system prompt：開放 `runWorkflow` 作為合法 action type，讓導演在
    // 「跨頁 / 多步驟」需求下能直接回傳完整工作流，而不是單頁建議。為了
    // 避免回到「光跳頁不執行」的反模式，prompt 明確要求多步驟計畫需含真正
    // 會動作的 step（fillPrompt / submit / toolName=studio.*）。
    const systemPrompt = `你是「導演 AI」（導導），使用者正在創作工作室裡建立內容。
你的任務：根據使用者當前的工作室狀態，建議下一步行動 — 視需求可以是「單一動作組合」或「整條跨頁 workflow」。

回傳格式（嚴格 JSON）：
{
  "actions": [
    // 單頁動作（用在使用者已在對的頁、只差最後幾步）：
    { "type": "fillPrompt", "text": "...", "slot": "prompt|negativePrompt|lyrics|voice", "append": false },
    { "type": "setModality", "modality": "image|video|audio|voice" },
    { "type": "setTab", "tabId": "t2v|i2v|v2v|t2i|i2i|music|voice" },
    { "type": "setMode", "modeId": "lightning|deep_precision|inspiration|standard|professional" },
    { "type": "setModel", "modelId": "fal-ai/..." },
    { "type": "setParam", "key": "duration|aspectRatio|...", "value": "..." },
    { "type": "applyPreset", "presetId": "creative:simple|creative:standard|creative:pro" },
    { "type": "submit" },
    // 跨頁多步驟 workflow（用在使用者需求是「整條跑完」）：
    {
      "type": "runWorkflow",
      "name": "中文摘要的計畫名稱",
      "confirmationMode": "step-by-step|all-at-once|high-risk-only",
      "steps": [
        {
          "id": "step_image", "path": "/image-studio",
          "actionType": "submit", "payload": "",
          "label": "圖圖：產 key visual",
          "toolName": "studio.generateImage",
          "toolArgs": { "prompt": "...", "modelId": "fal-ai/flux-pro/v1.1", "aspect_ratio": "9:16" }
        },
        {
          "id": "step_video", "path": "/video-studio",
          "actionType": "submit", "payload": "",
          "label": "影影：i2v 動畫",
          "toolName": "studio.generateVideo",
          "dependsOn": ["step_image"],
          "toolArgs": { "prompt": "...", "modelId": "fal-ai/kling-video/v2.1/standard/image-to-video",
                        "image_url": "\${step_image.image_url}", "duration": 5, "aspect_ratio": "9:16" }
        }
      ]
    }
  ],
  "rationale": "用 1-2 句中文說明為什麼這樣排，並指出下一棒交給哪位精靈（用 @暱稱）"
}

決策規範：
- 風格 = ${personality}
- 使用者只在「當頁」需要幫助 → 回單頁動作組合（≤ 6 個）
- 使用者目標是「整條短片 / 跨頁工作流」→ 回單一 \`runWorkflow\` action，每步用 \`toolName=studio.*\` 真的執行，不要只有 navigate
- 多步驟 workflow 必須有真正會動作的 step（toolName / fillPrompt / submit），不能整條只跳頁
- 影片 / 圖片步驟連動：i2v step 用 \`image_url: "\${step_image.image_url}"\` 引用上一步 image 結果
- 預設 confirmationMode=step-by-step（先讓使用者逐步審核）
- rationale 結尾用 @暱稱 點名下一棒接手的精靈（@圖圖 / @影影 / @音音 / @聲聲 / @品品 / @步步）
- 不要回多餘內容，只回 JSON

導導可主動呼叫的兄弟工具（在 plan 真正執行前先這樣鋪路會更穩）：
- director.composeWorkflow（brief → 完整 workflow 模板）
- director.estimateBudget（workflow → 總點數 + 替代模型省錢建議）
- director.suggestHandoff（給 hintTokens → 下一棒精靈鏈）
- director.refineWorkflow（已存在的 workflow → 機械式微調）
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

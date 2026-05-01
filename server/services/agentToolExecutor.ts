import { TRPCError } from "@trpc/server";
import { awaitFalQueueResult, type FalAwaitResult } from "./falQueueAwaiter";

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

  const args = (call.args ?? {}) as Record<string, unknown>;

  try {
    switch (call.name) {
      case "studio.generateImage": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = (args.modelId as string) || "fal-ai/flux/dev";
        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
        if (typeof args.aspect_ratio === "string")
          input.aspect_ratio = args.aspect_ratio;
        if (typeof args.num_images === "number")
          input.num_images = args.num_images;
        if (typeof args.negative_prompt === "string")
          input.negative_prompt = args.negative_prompt;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-image",
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
        const modelId =
          (args.modelId as string) || defaultModelByCategory[category];
        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
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
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = requestedModel || "fal-ai/ace-step";
        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
        if (typeof args.lyrics === "string") input.lyrics = args.lyrics;
        if (typeof args.duration === "number") input.duration = args.duration;
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

      case "studio.generateVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId =
          (args.modelId as string) || "fal-ai/elevenlabs/tts/turbo-v2.5";
        const input: Record<string, unknown> = {};
        if (typeof args.text === "string") input.text = args.text;
        if (typeof args.voice_id === "string") input.voice_id = args.voice_id;
        if (typeof args.speed === "number") input.speed = args.speed;
        const r = await dispatchFalQueueTask({
          modelId,
          category: "text-to-speech",
          input,
          route: "orb-tool/studio.generateVoice",
          modality: "voice",
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
// director.* 規劃工具橋接：呼叫導演 AI 為當前工作室規劃下一步
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 把光球發出的 director.suggestPlan 工具呼叫橋接到後端 invokeLLM。
 * 直接 reuse director.askForStudioPlan 同樣的 prompt + parseLLMActions 流程，
 * 但不經 tRPC layer（避免 caller 自我引用）。
 */
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

    const { invokeLLM } = await import("../_core/llm");
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

    const content = llmResponse.choices[0]?.message?.content;
    const text = typeof content === "string" ? content : "";

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

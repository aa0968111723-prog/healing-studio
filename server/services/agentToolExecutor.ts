import { TRPCError } from "@trpc/server";
import { awaitFalQueueResult, type FalAwaitResult } from "./falQueueAwaiter";
import { checkAndConsumeQuota } from "./orbQuota";

/** Tool names that consume a `generation` daily slot when executed. */
const GENERATION_SLOT_TOOLS = new Set([
  "studio.generateImage",
  "studio.generateVideo",
  "studio.generateAudio",
  "studio.generateVoice",
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

  try {
    switch (call.name) {
      case "studio.generateImage": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = await resolveOrbEngine(
          (args.modelId as string) || "",
          opts.userId,
          "imageEngine",
          "fal-ai/flux/dev"
        );
        // img2img：有 image_url 或 image_urls 時改走 image-to-image 路由，
        // 讓 dispatcher 對 LoRA / 編輯類模型套對應的 fallback chain。
        const { category, imageUrls } = resolveImageGenRouting(args);
        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
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
        const modelId = await resolveOrbEngine(
          requestedModel,
          opts.userId,
          "audioEngine",
          "fal-ai/ace-step"
        );
        const input: Record<string, unknown> = {};
        if (typeof args.prompt === "string") input.prompt = args.prompt;
        if (typeof args.lyrics === "string") input.lyrics = args.lyrics;
        if (typeof args.duration === "number") input.duration = args.duration;
        if (typeof args.tags === "string") {
          // Sonauto 期望 tags 為陣列；其他模型併入 prompt
          if (modelId.includes("sonauto")) {
            const arr = args.tags
              .split(",")
              .map(t => t.trim())
              .filter(Boolean);
            if (arr.length > 0) input.tags = arr;
          } else if (typeof input.prompt === "string") {
            input.prompt = `${input.prompt}, ${args.tags}`;
          }
        }
        if (typeof args.bpm === "number") input.bpm = args.bpm;
        if (args.instrumental === true && modelId.includes("sonauto")) {
          // Sonauto 用空字串歌詞表達純音樂
          input.lyrics_prompt = "";
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

      case "studio.generateVoice": {
        const { dispatchFalQueueTask } = await import("./falDispatcher");
        const modelId = await resolveOrbEngine(
          (args.modelId as string) || "",
          opts.userId,
          "voiceEngine",
          "fal-ai/elevenlabs/tts/turbo-v2.5"
        );
        const input: Record<string, unknown> = {};
        if (typeof args.text === "string") input.text = args.text;
        if (typeof args.voice_id === "string") input.voice_id = args.voice_id;
        if (typeof args.speed === "number") input.speed = args.speed;
        // 多語 TTS：language_code 必傳到 ElevenLabs，否則 multilingual-v2
        // 會落到英文預設，光球發起的中文 / 日文 TTS 會發音怪。
        if (typeof args.language_code === "string")
          input.language_code = args.language_code;
        // 聲音調諧（stability / similarity_boost / style）走 ElevenLabs voice_settings
        const stability = typeof args.stability === "number" ? args.stability : undefined;
        const similarity = typeof args.similarity_boost === "number"
          ? args.similarity_boost
          : undefined;
        const style = typeof args.style === "number" ? args.style : undefined;
        if (stability !== undefined || similarity !== undefined || style !== undefined) {
          const voiceSettings: Record<string, unknown> = {};
          if (stability !== undefined) voiceSettings.stability = stability;
          if (similarity !== undefined) voiceSettings.similarity_boost = similarity;
          if (style !== undefined) voiceSettings.style = style;
          input.voice_settings = voiceSettings;
        }
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

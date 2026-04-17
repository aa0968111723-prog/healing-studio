/**
 * llm.ts — LLM 統一調用介面（LangSmith 深度整合版）
 *
 * 三引擎並存架構：
 *   Engine A — Gemini API  (GEMINI_API_KEY)              ← 推薦，@langchain/google-genai
 *   Engine B — Vertex AI   (GOOGLE_APPLICATION_CREDENTIALS_JSON) ← GCP 進階功能
 *   Engine C — Manus Forge (BUILT_IN_FORGE_API_KEY)      ← 向後相容降級
 *
 * LangSmith 深度整合：
 *   - LANGCHAIN_TRACING_V2=true 時自動啟用 SDK 追蹤
 *   - 所有 Prompt、Temperature、生成結果、Token 花費全部記錄到 LangSmith
 *   - 每次呼叫建立完整的 run trace（含 parent/child chain）
 *   - 失敗呼叫也會回報 error 到 LangSmith 供事後分析
 */

import { serverEnv } from "./env.validated";
import {
  resolveEngineConfig,
  getEngineFallbackChain,
  recordEngineSuccess,
  recordEngineFailure,
  type LLMEngine,
  type EngineConfig,
} from "./llmRouter";

// ─── LangSmith SDK 初始化（當 API Key 存在時） ───────────────────────────────
let langSmithClient: import("langsmith").Client | null = null;

async function getLangSmithClient(): Promise<
  import("langsmith").Client | null
> {
  if (!serverEnv.LANGSMITH_API_KEY) return null;
  if (langSmithClient) return langSmithClient;
  try {
    const { Client } = await import("langsmith");
    langSmithClient = new Client({
      apiKey: serverEnv.LANGSMITH_API_KEY,
      apiUrl: serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
    });
    return langSmithClient;
  } catch {
    return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?:
      | "audio/mpeg"
      | "audio/wav"
      | "application/pdf"
      | "audio/mp4"
      | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: { name: string };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** LangSmith 追蹤標籤 */
  runName?: string;
  /** LangSmith parent run ID（用於建立 chain 巢狀追蹤） */
  parentRunId?: string;
  /**
   * 強制指定使用哪個 LLM 引擎（覆蓋 auto 路由）
   */
  engine?: LLMEngine;
  /**
   * 創意溫度（0.0–1.0）。注入來自 ctx.brain.reasoning.storyteller.temperature
   */
  temperature?: number;
  /**
   * 核取機率（0.0–1.0）。注入來自 ctx.brain.reasoning.storyteller.topP
   */
  topP?: number;
  /**
   * 強制指定使用的模型名稱（覆蓋引擎預設模型）。
   */
  model?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

// ─── 內部工具函數 ──────────────────────────────────────────────────────────

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") return { type: "text", text: part };
  if (
    part.type === "text" ||
    part.type === "image_url" ||
    part.type === "file_url"
  )
    return part;
  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(p => (typeof p === "string" ? p : JSON.stringify(p)))
      .join("\n");
    return { role, name, tool_call_id, content };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return { role, name, content: contentParts[0].text };
  }
  return { role, name, content: contentParts };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;
  if (toolChoice === "none" || toolChoice === "auto") return toolChoice;
  if (toolChoice === "required") {
    if (!tools || tools.length === 0)
      throw new Error("tool_choice 'required' but no tools provided");
    if (tools.length > 1)
      throw new Error(
        "tool_choice 'required' with multiple tools: specify name explicitly"
      );
    return { type: "function", function: { name: tools[0].function.name } };
  }
  if ("name" in toolChoice)
    return { type: "function", function: { name: toolChoice.name } };
  return toolChoice;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}): ResponseFormat | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return undefined;
  if (!schema.name || !schema.schema)
    throw new Error("outputSchema requires both name and schema");
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// ─── 估算 Token 成本（USD） ──────────────────────────────────────────────────

function estimateTokenCostUsd(
  model: string,
  usage?: InvokeResult["usage"]
): number {
  if (!usage) return 0;
  // Approximate pricing (USD per 1M tokens)
  const PRICING: Record<string, { input: number; output: number }> = {
    "gemini-2.5-pro": { input: 1.25, output: 5.0 },
    "gemini-2.5-flash": { input: 0.075, output: 0.3 },
    "gemini-1.5-pro": { input: 1.25, output: 5.0 },
    "gemini-1.5-flash": { input: 0.075, output: 0.3 },
    "gpt-4o": { input: 2.5, output: 10.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "MiniMax-M2.7": { input: 0.3, output: 1.2 },
    "minimaxai/minimax-m2.7": { input: 0.3, output: 1.2 },
  };
  const key =
    Object.keys(PRICING).find(k => model.includes(k)) ?? "gemini-2.5-flash";
  const p = PRICING[key];
  return (
    (usage.prompt_tokens / 1_000_000) * p.input +
    (usage.completion_tokens / 1_000_000) * p.output
  );
}

// ─── LangSmith SDK 追蹤（深度整合） ──────────────────────────────────────────

async function trackLangSmithSDK(
  runId: string,
  runName: string,
  messages: Message[],
  payload: Record<string, unknown>,
  result: InvokeResult | null,
  error: Error | null,
  durationMs: number,
  engineName: string,
  parentRunId?: string
): Promise<void> {
  const client = await getLangSmithClient();
  if (!client) return;

  const projectName = serverEnv.LANGSMITH_PROJECT || "healing-studio";
  const startTime = new Date(Date.now() - durationMs);
  const endTime = new Date();
  const costUsd = result
    ? estimateTokenCostUsd(result.model || "", result.usage)
    : 0;

  try {
    if (error || !result) {
      // ── 失敗追蹤 ──
      await client.createRun({
        id: runId,
        name: runName || "llm-invoke",
        run_type: "llm",
        project_name: projectName,
        start_time: startTime.getTime(),
        end_time: endTime.getTime(),
        inputs: {
          messages: messages.map(m => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content.slice(0, 500)
                : "[multimodal]",
          })),
          model: payload.model,
          temperature: payload.temperature,
          top_p: payload.top_p,
        },
        outputs: {},
        error: error?.message || "unknown error",
        extra: {
          metadata: {
            engine: engineName,
            project: projectName,
          },
        },
        parent_run_id: parentRunId,
      });
    } else {
      // ── 成功追蹤 ──
      const outputContent = result.choices[0]?.message?.content;
      await client.createRun({
        id: runId,
        name: runName || "llm-invoke",
        run_type: "llm",
        project_name: projectName,
        start_time: startTime.getTime(),
        end_time: endTime.getTime(),
        inputs: {
          messages: messages.map(m => ({
            role: m.role,
            content:
              typeof m.content === "string"
                ? m.content.slice(0, 2000)
                : "[multimodal]",
          })),
          model: payload.model,
          temperature: payload.temperature,
          top_p: payload.top_p,
          max_tokens: payload.max_tokens,
        },
        outputs: {
          content:
            typeof outputContent === "string"
              ? outputContent.slice(0, 2000)
              : "[structured]",
          finish_reason: result.choices[0]?.finish_reason,
          usage: result.usage,
          token_usage: {
            prompt_tokens: result.usage?.prompt_tokens ?? 0,
            completion_tokens: result.usage?.completion_tokens ?? 0,
            total_tokens: result.usage?.total_tokens ?? 0,
          },
        },
        extra: {
          metadata: {
            engine: engineName,
            model: result.model,
            duration_ms: durationMs,
            cost_usd: costUsd,
            prompt_tokens: result.usage?.prompt_tokens ?? 0,
            completion_tokens: result.usage?.completion_tokens ?? 0,
            total_tokens: result.usage?.total_tokens ?? 0,
          },
        },
        parent_run_id: parentRunId,
      });
    }
  } catch {
    // LangSmith 追蹤失敗不影響主流程
  }
}

// ─── 模型名稱正規化（防止 OpenAI 模型名稱傳給 Gemini API） ──────────────────

/**
 * 當使用 Gemini API endpoint 時，將非 Gemini 模型名稱自動 remap。
 * 舊有組態（gpt-4o 等）會自動對應到相近能力的 Gemini 模型，
 * 確保 API 呼叫不會因為模型名稱不相容而發生 404。
 *
 * Vertex AI 路徑（"vertex/..."）也會被解析為純模型名稱。
 */
const GEMINI_MODEL_REMAP: Record<string, string> = {
  // OpenAI → Gemini 等效對應
  "gpt-4o": "gemini-2.5-pro",
  "gpt-4o-mini": "gemini-2.5-flash",
  "gpt-4-turbo": "gemini-2.5-pro",
  "gpt-4": "gemini-1.5-pro",
  "gpt-3.5-turbo": "gemini-2.5-flash",
  "gpt-3.5-turbo-16k": "gemini-1.5-flash",
  // Anthropic Claude → Gemini 等效對應
  "claude-3-opus": "gemini-2.5-pro",
  "claude-3.5-sonnet": "gemini-2.5-pro",
  "claude-3-sonnet": "gemini-1.5-pro",
  "claude-3-haiku": "gemini-2.5-flash",
  "claude-instant-1": "gemini-2.5-flash",
  // Mistral → Gemini
  "mistral-large": "gemini-2.5-pro",
  "mistral-medium": "gemini-1.5-pro",
  "mistral-small": "gemini-2.5-flash",
};

/**
 * 正規化模型名稱，確保與所選引擎相容。
 *   - Gemini API/Vertex API：不接受 OpenAI/Claude 名稱 → remap
 *   - Vertex 路徑（"vertex/gemini-..."）→ 取 "/" 後半段
 *   - Forge/其他代理 API：不做任何修改（代理層自行處理）
 */
function normalizeModelForEngine(model: string, engineName: string): string {
  const isGeminiEndpoint =
    engineName.includes("Gemini") || engineName.includes("Vertex");
  if (!isGeminiEndpoint) return model;

  // 處理 "vertex/gemini-2.5-pro" 路徑格式
  if (model.startsWith("vertex/")) {
    return model.split("/").slice(1).join("/");
  }

  // 已知不相容名稱 → remap
  return GEMINI_MODEL_REMAP[model] ?? model;
}

// ─── LLM retry constants ───────────────────────────────────────────────────
const LLM_REQUEST_TIMEOUT_MS = 60_000; // 60 seconds
const LLM_MAX_RETRIES = 3;
const LLM_MAX_RETRY_DELAY_MS = 8_000;

function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), LLM_MAX_RETRY_DELAY_MS);
}

// ─── 主要 LLM 呼叫函數 ────────────────────────────────────────────────────

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    maxTokens,
    max_tokens,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    runName,
    parentRunId,
    engine,
    temperature,
    topP,
    model: overrideModel,
  } = params;

  // ── 透過路由器取得引擎設定 ───────────────────────────────
  const primaryConfig = resolveEngineConfig(engine);

  // ── 嘗試主引擎 + 自動降級到備援引擎 ───────────────────────
  const engineConfigs: EngineConfig[] = [primaryConfig];

  // auto 模式下，加入備援引擎鏈（手動指定引擎不降級）
  if (!engine || engine === "auto") {
    engineConfigs.push(...getEngineFallbackChain(primaryConfig.engine));
  }

  let lastError: Error | null = null;

  for (const engineConfig of engineConfigs) {
    try {
      const result = await invokeSingleEngine(engineConfig, {
        messages,
        tools,
        toolChoice,
        tool_choice,
        maxTokens,
        max_tokens,
        outputSchema,
        output_schema,
        responseFormat,
        response_format,
        runName,
        parentRunId,
        temperature,
        topP,
        overrideModel,
      });

      // 成功 — 更新斷路器
      recordEngineSuccess(engineConfig.engine);
      return result;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // 記錄斷路器失敗
      recordEngineFailure(engineConfig.engine);

      // 如果還有備援引擎，繼續嘗試
      if (engineConfigs.indexOf(engineConfig) < engineConfigs.length - 1) {
        console.warn(
          `[LLM] ⚠️ ${engineConfig.name} 失敗，嘗試備援引擎... 錯誤: ${error.message.slice(0, 200)}`
        );
        continue;
      }
    }
  }

  // 所有引擎都失敗
  throw lastError ?? new Error("[LLM] 所有引擎都失敗");
}

/**
 * 對單一引擎執行 LLM 呼叫（含重試）
 */
async function invokeSingleEngine(
  engineConfig: EngineConfig,
  params: {
    messages: Message[];
    tools?: Tool[];
    toolChoice?: ToolChoice;
    tool_choice?: ToolChoice;
    maxTokens?: number;
    max_tokens?: number;
    outputSchema?: OutputSchema;
    output_schema?: OutputSchema;
    responseFormat?: ResponseFormat;
    response_format?: ResponseFormat;
    runName?: string;
    parentRunId?: string;
    temperature?: number;
    topP?: number;
    overrideModel?: string;
  }
): Promise<InvokeResult> {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    maxTokens,
    max_tokens,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    runName,
    parentRunId,
    temperature,
    topP,
    overrideModel,
  } = params;

  // ── 解析最終模型名稱（含 engine 相容性正規化）───────────
  const rawModel = overrideModel ?? engineConfig.model;
  const resolvedModel = normalizeModelForEngine(rawModel, engineConfig.name);

  const payload: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map(normalizeMessage),
    max_tokens: maxTokens ?? max_tokens ?? 8192,
  };

  // 注入 AI 大腦的 temperature / top_p（若已設定）
  if (typeof temperature === "number" && temperature >= 0 && temperature <= 2) {
    payload.temperature = temperature;
  }
  if (typeof topP === "number" && topP > 0 && topP <= 1) {
    payload.top_p = topP;
  }

  // Forge 引擎支援 thinking 擴展推理預算
  if (engineConfig.supportsThinking && engineConfig.name.includes("Forge")) {
    payload.thinking = { budget_tokens: 128 };
  }

  if (tools && tools.length > 0) payload.tools = tools;

  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });
  if (normalizedResponseFormat)
    payload.response_format = normalizedResponseFormat;

  const startTime = Date.now();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let result: InvokeResult | undefined;
  try {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          LLM_REQUEST_TIMEOUT_MS
        );
        const response = await fetch(engineConfig.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${engineConfig.apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(
            `[${engineConfig.name}] LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
          );
          // Retry on 5xx server errors or 429 rate limit
          if (
            (response.status >= 500 || response.status === 429) &&
            attempt < LLM_MAX_RETRIES
          ) {
            lastError = err;
            await new Promise(r => setTimeout(r, getRetryDelayMs(attempt)));
            continue;
          }
          const durationMs = Date.now() - startTime;
          trackLangSmithSDK(
            runId,
            runName || "llm-invoke",
            messages,
            payload,
            null,
            err,
            durationMs,
            engineConfig.name,
            parentRunId
          ).catch(() => {});
          throw err;
        }

        result = (await response.json()) as InvokeResult;
        lastError = null;
        break;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        const isRetryable =
          error.name === "AbortError" || error.message.includes("fetch failed");
        if (isRetryable && attempt < LLM_MAX_RETRIES) {
          await new Promise(r => setTimeout(r, getRetryDelayMs(attempt)));
          continue;
        }
        throw err;
      }
    }
    if (lastError) throw lastError;
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const error = err instanceof Error ? err : new Error(String(err));
    trackLangSmithSDK(
      runId,
      runName || "llm-invoke",
      messages,
      payload,
      null,
      error,
      durationMs,
      engineConfig.name,
      parentRunId
    ).catch(() => {});
    throw err;
  }

  if (!result) throw new Error("[LLM] Unexpected: no result after retry loop");

  const durationMs = Date.now() - startTime;
  trackLangSmithSDK(
    runId,
    runName || "llm-invoke",
    messages,
    payload,
    result,
    null,
    durationMs,
    engineConfig.name,
    parentRunId
  ).catch(() => {});

  return result;
}

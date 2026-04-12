/**
 * llm.ts — LLM 統一調用介面
 *
 * 三引擎並存架構（透過 llmRouter.ts 智慧路由）：
 *   Engine A — Gemini API  (GEMINI_API_KEY)              ← 推薦，直連無代理
 *   Engine B — Vertex AI   (GOOGLE_APPLICATION_CREDENTIALS_JSON) ← GCP 進階功能
 *   Engine C — Manus Forge (BUILT_IN_FORGE_API_KEY)      ← 向後相容降級
 *
 * 路由順序（auto 模式）：Gemini → Forge → 錯誤
 * 可在 .env 中設定 LLM_ENGINE=gemini|vertex|forge 強制指定引擎。
 *
 * LangSmith 追蹤：若 LANGSMITH_API_KEY 已設定，每次呼叫都會記錄。
 */

import { serverEnv } from "./env.validated";
import { resolveEngineConfig, type LLMEngine } from "./llmRouter";

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
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
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
  /**
   * 強制指定使用哪個 LLM 引擎（覆蓋 auto 路由）
   * 'gemini'  → 直接打 Gemini API（需 GEMINI_API_KEY）
   * 'vertex'  → Vertex AI（需 GCP 服務帳號）
   * 'forge'   → Manus Forge（向後相容，需 BUILT_IN_FORGE_API_KEY）
   * 不填     → 自動選擇最佳可用引擎
   */
  engine?: LLMEngine;
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

const ensureArray = (value: MessageContent | MessageContent[]): MessageContent[] =>
  Array.isArray(value) ? value : [value];

const normalizeContentPart = (part: MessageContent): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "text" || part.type === "image_url" || part.type === "file_url") return part;
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
    if (!tools || tools.length === 0) throw new Error("tool_choice 'required' but no tools provided");
    if (tools.length > 1) throw new Error("tool_choice 'required' with multiple tools: specify name explicitly");
    return { type: "function", function: { name: tools[0].function.name } };
  }
  if ("name" in toolChoice) return { type: "function", function: { name: toolChoice.name } };
  return toolChoice;
};

const normalizeResponseFormat = ({
  responseFormat, response_format, outputSchema, output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}): ResponseFormat | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error("responseFormat json_schema requires a defined schema object");
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return undefined;
  if (!schema.name || !schema.schema) throw new Error("outputSchema requires both name and schema");
  return {
    type: "json_schema",
    json_schema: { name: schema.name, schema: schema.schema, ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}) },
  };
};

// ─── API 端點解析（委派至 llmRouter.ts）─────────────────────────────────
// resolveEngineConfig() 實作三引擎優先邏輯，此處直接呼叫。

// ─── LangSmith 追蹤 ────────────────────────────────────────────────────────

async function trackLangSmith(
  runName: string,
  messages: Message[],
  result: InvokeResult,
  durationMs: number,
  engineName?: string
): Promise<void> {
  const apiKey = serverEnv.LANGSMITH_API_KEY;
  if (!apiKey) return;

  try {
    const endpoint = serverEnv.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com";
    await fetch(`${endpoint}/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        id: result.id,
        name: runName || "llm-invoke",
        run_type: "llm",
        start_time: new Date(Date.now() - durationMs).toISOString(),
        end_time: new Date().toISOString(),
        inputs: { messages },
        outputs: { choices: result.choices },
        extra: {
          model: result.model,
          engine: engineName,
          usage: result.usage,
          project: serverEnv.LANGSMITH_PROJECT || "ai-director",
          duration_ms: durationMs,
        },
      }),
    });
  } catch {
    // LangSmith 追蹤失敗不影響主流程
  }
}

// ─── 主要 LLM 呼叫函數 ────────────────────────────────────────────────────

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages, tools, toolChoice, tool_choice,
    outputSchema, output_schema, responseFormat, response_format,
    runName, engine,
  } = params;

  // ── 透過路由器取得引擎設定 ───────────────────────────────
  const engineConfig = resolveEngineConfig(engine);

  const payload: Record<string, unknown> = {
    model: engineConfig.model,
    messages: messages.map(normalizeMessage),
    max_tokens: 32768,
  };

  // Forge 引擎支援 thinking 擴展推理預算（Gemini 直連不需要此參數）
  if (engineConfig.supportsThinking && engineConfig.name.includes("Forge")) {
    payload.thinking = { budget_tokens: 128 };
  }

  if (tools && tools.length > 0) payload.tools = tools;

  const normalizedToolChoice = normalizeToolChoice(toolChoice || tool_choice, tools);
  if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice;

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat, response_format, outputSchema, output_schema,
  });
  if (normalizedResponseFormat) payload.response_format = normalizedResponseFormat;

  const startTime = Date.now();

  const response = await fetch(engineConfig.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${engineConfig.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `[${engineConfig.name}] LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const result = (await response.json()) as InvokeResult;
  const durationMs = Date.now() - startTime;

  // 非同步追蹤至 LangSmith（不阻塞主流程）
  trackLangSmith(runName || "llm-invoke", messages, result, durationMs, engineConfig.name).catch(() => {});

  return result;
}

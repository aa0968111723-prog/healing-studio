/**
 * llm.ts — LLM 統一調用介面
 *
 * 優先使用 Vertex AI / Gemini API（直接），
 * 若 GEMINI_API_KEY 未設定則降級至 Manus Forge API（向後相容）。
 *
 * LangSmith 追蹤：若 LANGSMITH_API_KEY 已設定，每次呼叫都會記錄至 LangSmith。
 */

import { ENV } from "./env";
import { serverEnv } from "./env.validated";

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

// ─── API 端點解析（Vertex AI 優先，Manus Forge 降級）──────────────────────

function resolveApiConfig(): { url: string; apiKey: string; isGemini: boolean } {
  // 優先：直接使用 Gemini API Key（無需 Manus 代理）
  if (ENV.geminiApiKey && ENV.geminiApiKey.trim().length > 0) {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: ENV.geminiApiKey,
      isGemini: true,
    };
  }

  // 降級：使用 Manus Forge API（向後相容）
  if (ENV.forgeApiKey && ENV.forgeApiUrl) {
    return {
      url: `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`,
      apiKey: ENV.forgeApiKey,
      isGemini: false,
    };
  }

  throw new Error(
    "LLM API 未設定：請設定 GEMINI_API_KEY（推薦）或 BUILT_IN_FORGE_API_KEY（向後相容）"
  );
}

// ─── LangSmith 追蹤 ────────────────────────────────────────────────────────

async function trackLangSmith(
  runName: string,
  messages: Message[],
  result: InvokeResult,
  durationMs: number
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
          usage: result.usage,
          project: serverEnv.LANGSMITH_PROJECT || "ai-director",
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
    runName,
  } = params;

  const { url, apiKey, isGemini } = resolveApiConfig();

  const payload: Record<string, unknown> = {
    model: "gemini-2.5-flash",
    messages: messages.map(normalizeMessage),
    max_tokens: 32768,
  };

  // Gemini 直接 API 不支援 thinking 參數（只有 Manus Forge 代理版本才有）
  if (!isGemini) {
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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
  }

  const result = (await response.json()) as InvokeResult;
  const durationMs = Date.now() - startTime;

  // 非同步追蹤至 LangSmith（不阻塞主流程）
  trackLangSmith(runName || "llm-invoke", messages, result, durationMs).catch(() => {});

  return result;
}

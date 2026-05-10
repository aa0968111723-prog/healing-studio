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
import { withLLMSlot } from "./llmConcurrency";
import { cache } from "./cache";
import { dedup } from "./deduplication";
import { logger } from "./logger";
import {
  resolveEngineConfig,
  getEngineFallbackChain,
  recordEngineSuccess,
  recordEngineFailure,
  isEngineAvailable,
  inferEngineFromModelIdSafe,
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
      | "application/pdf"
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp"
      | "image/svg+xml"
      | "image/avif"
      | "audio/mpeg"
      | "audio/wav"
      | "audio/ogg"
      | "audio/webm"
      | "audio/mp4"
      | "audio/aac"
      | "audio/flac"
      | "video/mp4"
      | "video/webm"
      | "video/ogg"
      | "video/quicktime"
      // Text-like document attachments — see shared/orb-chat-multimodal.ts
      // ORB_CHAT_ATTACHMENT_MIME_TYPES; the chat pipeline routes them through
      // file_url parts even though the actual text is inlined via extractedText.
      | "text/plain"
      | "text/markdown"
      | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    size_bytes?: number;
    duration_sec?: number;
    page_count?: number;
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
   * 強制指定使用哪個 LLM 引擎（覆蓋 auto 路由）。
   * 指定後不會自動降級到其他引擎 — 用於 debug 或明確需要特定能力時。
   */
  engine?: LLMEngine;
  /**
   * 偏好引擎：先嘗試此引擎，失敗時自動降級到備援鏈。
   * 適合 UI 層想用特定引擎（例如光球偏好 MiniMax）但仍要容錯的場景。
   * 與 engine 互斥 — 若同時提供，engine 優先（表示明確要強制）。
   */
  preferEngine?: LLMEngine;
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
  /**
   * 系統提示詞（從 ctx.brain 注入）。
   * 如果提供，將會前置插入 messages 第一條 system 訊息，或與現有 system 合併。
   */
  systemPrompt?: string | null;
  /**
   * 單一引擎呼叫的最長等待毫秒數（覆蓋全域 LLM_TIMEOUT_SECONDS）。
   * 用於需要快速降級的場景（例如光球聊天：外層 20s 包住，但希望單一引擎
   * 8 秒就放棄，讓 OpenRouter 等備援引擎還有機會被嘗試）。
   */
  timeoutMs?: number;
  /**
   * 啟用回應快取（LRU + TTL，預設 600 秒）。
   *
   * 適用情境：
   *   - 觀察者/分類器類型的呼叫（同一輸入該得到同一輸出）
   *   - 提示詞模板裡無 Date.now / 隨機 ID 等變動值
   *   - 不含 tool_use（工具回應通常依賴外部狀態）
   *
   * 安全性：cache key 由 model + messages + temperature + maxTokens 組合的
   * djb2 hash 構成；不同內容/溫度產生不同 key，不會誤命中。命中時直接回傳
   * 快取結果，不消耗 LLM 並行槽位（withLLMSlot），延遲 < 1ms。
   *
   * 預設關閉以保留歷史行為；呼叫端在確定可重複時才打開。
   */
  cacheable?: boolean;
  /**
   * 自訂快取 TTL（秒）。預設使用 cache.ts 的 namespace 預設（llm: 600）。
   * 僅在 cacheable=true 時生效。
   */
  cacheTtlSeconds?: number;
  /**
   * 啟用請求 deduplication（in-flight 合併）。預設 ON。
   *
   * 機制：當完全相同的 prompt + tool 設定在 deduplicate 進行中再次觸發時，
   * 第二個呼叫不會發出新的網路請求，而是等待第一個的結果。雙擊、重試風暴、
   * 多個 agent 平行步驟撞上同一個子任務都會被合併。
   *
   * 設為 false 的情境：呼叫端明確需要每次拿到「不同」的回應（例如創意
   * 寫作的 temperature > 0 場景，但 dedup 的 key 已涵蓋 temperature，
   * 所以這個情境其實罕見；保留旗標僅供 escape hatch）。
   */
  dedupe?: boolean;
  /**
   * Hedged request — 在 hedgeDelayMs 毫秒後，若主引擎尚未回應，並行啟動
   * 第一個備援引擎；任一引擎成功即回傳結果，落敗的呼叫被丟棄。
   *
   * 用途：對抗 P95/P99 長尾延遲。當主引擎偶發網路抖動 / 上游高負載時，
   * 不需要等到 timeout 才切換 — 在還可能成功的時刻就讓備援引擎跑起來，
   * 取最快的回應。代價是偶爾會多花一份 token 預算（被丟棄的那個）。
   *
   * 預設關閉；用戶體感敏感的路徑（例如全站光球的 clarification 對話）
   * 應該打開。長文本生成、創意寫作等會佔用大量 token 的場景不建議打開。
   */
  hedge?: boolean;
  /**
   * Hedge 啟動的延遲（毫秒）。在這段時間內，只有主引擎在跑；超過後若仍未
   * 收到回應，才會啟動備援引擎與主引擎賽跑。預設 600 ms — 大部分 LLM
   * 健康呼叫的 TTFR 在 200-500 ms 之間，600 ms 後仍未回的多半是已踩雷。
   */
  hedgeDelayMs?: number;
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

// ─── 訊息內容抽取工具 ──────────────────────────────────────────────────────
//
// LLM 回應的 `message.content` 型別是 `string | Array<TextContent | ...>`。
// 直接以 `typeof === "string"` 判斷會在 array 形式下丟失文字，導致下游
// 拿到空字串、空 JSON 或 fallback 值，例如導演AI對話模式輸出空值。
// 一律經由這兩個 helper 抽取，避免回到散落在各路由的錯誤判斷。

type LLMContent =
  | string
  | Array<TextContent | ImageContent | FileContent>
  | undefined
  | null;

export function extractMessageText(content: LLMContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part =>
        part && part.type === "text" && typeof part.text === "string"
          ? part.text
          : ""
      )
      .join("");
  }
  return "";
}

// 從 LLM 回應抽出 JSON 物件。先抽純文字（容忍 array 形式），再以呼叫端
// 提供的 fence-tolerant 解析器抽取 JSON。透過 callback 注入避免循環依賴。
export function extractMessageJson(
  content: LLMContent,
  parseJson: (text: string) => unknown
): unknown {
  const text = extractMessageText(content);
  if (!text) return null;
  return parseJson(text);
}

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


/**
 * Perplexity Sonar's chat-completions endpoint enforces stricter rules
 * than the OpenAI spec it advertises:
 *
 *   1. After the (optional) system messages, user/tool messages MUST
 *      alternate with assistant messages (no `user → user` runs).
 *   2. `tool` and `function` roles are not accepted at all.
 *   3. Multiple system messages are tolerated only when they appear
 *      contiguously at the very top.
 *
 * The schema-first planner generates a long system prompt + the original
 * conversation, and the legacy fallback prepends ANOTHER system message.
 * When the user just sent a follow-up turn, the resulting payload often
 * looks like `[system, user, user, …]`, which Sonar rejects with
 * `400 invalid_message`. The orb then has to fall back to the
 * legacy parser, and the user sees `fallback-planner-error` instead of
 * a real plan + reasoning chain.
 *
 * We coalesce here so the planner's actual reasoning makes it through:
 *   - Merge contiguous system messages into one (joined with blank lines).
 *   - Convert tool/function turns into user turns prefixed with the tool
 *     name (Sonar still grounds against the text content).
 *   - Collapse consecutive same-role user/assistant runs by joining their
 *     text contents with a blank line. Image/file parts are preserved on
 *     the kept side so Sonar still sees the attachment.
 *   - Ensure the first non-system message is a user message (if it's an
 *     assistant message, drop it — Sonar otherwise 400s).
 */
export const adaptMessagesForPerplexity = (messages: ReturnType<typeof normalizeMessage>[]) => {
  const flattenText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
          return (part as { text?: string }).text ?? "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  };

  // 1) Coerce tool/function → user; drop empty assistant placeholders.
  const coerced = messages
    .map(msg => {
      const role = (msg as { role?: string }).role;
      if (role === "tool" || role === "function") {
        const text = flattenText((msg as { content?: unknown }).content);
        const name = (msg as { name?: string }).name;
        return {
          role: "user" as const,
          content: name ? `[tool:${name}] ${text}` : text,
        };
      }
      return msg as { role: "system" | "user" | "assistant"; content: unknown };
    })
    .filter(m => {
      // Drop fully empty messages so they don't break the alternation count.
      const text = flattenText((m as { content?: unknown }).content);
      const c = (m as { content?: unknown }).content;
      const hasMedia =
        Array.isArray(c) &&
        c.some(
          p =>
            p &&
            typeof p === "object" &&
            ((p as { type?: string }).type === "image_url" ||
              (p as { type?: string }).type === "file_url")
        );
      return text.trim().length > 0 || hasMedia;
    });

  // 2) Pull contiguous system messages off the front, merging their text.
  const systemBlocks: string[] = [];
  let i = 0;
  while (i < coerced.length && (coerced[i] as { role?: string }).role === "system") {
    systemBlocks.push(flattenText((coerced[i] as { content?: unknown }).content));
    i += 1;
  }
  const rest = coerced.slice(i).filter(m => (m as { role?: string }).role !== "system");

  // 3) Drop a leading assistant turn — Sonar requires the first non-system
  //    message to be user/tool.
  while (rest.length > 0 && (rest[0] as { role?: string }).role === "assistant") {
    rest.shift();
  }

  // 4) Collapse consecutive same-role runs by joining their text content.
  //    For non-text parts (images, files), we keep them on the LAST message
  //    in the run so Sonar still sees the most recent attachment context.
  const collapsed: typeof coerced = [];
  for (const msg of rest) {
    const last = collapsed[collapsed.length - 1];
    if (last && (last as { role?: string }).role === (msg as { role?: string }).role) {
      const lastText = flattenText((last as { content?: unknown }).content);
      const curText = flattenText((msg as { content?: unknown }).content);
      const merged = [lastText, curText].filter(Boolean).join("\n\n");
      // Prefer the current message's array content (likely has fresher media),
      // falling back to plain text when both sides were strings.
      const curContent = (msg as { content?: unknown }).content;
      if (Array.isArray(curContent)) {
        const replaced = curContent.map(part => {
          if (
            part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "text"
          ) {
            return { ...(part as Record<string, unknown>), text: merged };
          }
          return part;
        });
        // If there was no text part on the current, prepend one.
        const hasText = replaced.some(
          p =>
            p &&
            typeof p === "object" &&
            (p as { type?: string }).type === "text"
        );
        const finalContent = hasText
          ? replaced
          : [{ type: "text", text: merged }, ...replaced];
        collapsed[collapsed.length - 1] = {
          ...(last as Record<string, unknown>),
          content: finalContent,
        } as (typeof collapsed)[number];
      } else {
        collapsed[collapsed.length - 1] = {
          ...(last as Record<string, unknown>),
          content: merged,
        } as (typeof collapsed)[number];
      }
    } else {
      collapsed.push(msg);
    }
  }

  // 5) Reattach the (single) merged system message.
  const out: typeof coerced = [];
  if (systemBlocks.length > 0) {
    const merged = systemBlocks.filter(Boolean).join("\n\n");
    if (merged.trim().length > 0) {
      out.push({ role: "system", content: merged } as (typeof coerced)[number]);
    }
  }
  out.push(...collapsed);
  return out;
};

const adaptMessagesForGeminiCompat = (messages: ReturnType<typeof normalizeMessage>[]) => {
  return messages.map(msg => {
    const c = (msg as { content?: unknown }).content;
    if (!Array.isArray(c)) return msg;

    const adapted = c.map(part => {
      if (
        part &&
        typeof part === "object" &&
        "type" in (part as Record<string, unknown>) &&
        (part as { type?: string }).type === "file_url"
      ) {
        const file = (part as { file_url?: { url?: string; mime_type?: string } }).file_url;
        const url = typeof file?.url === "string" ? file.url : "";
        const mime = typeof file?.mime_type === "string" ? file.mime_type : "application/octet-stream";
        return {
          type: "text" as const,
          text: `[Attached file: ${mime}] ${url}`,
        };
      }
      return part;
    });

    if (
      adapted.length === 1 &&
      adapted[0] &&
      typeof adapted[0] === "object" &&
      "type" in (adapted[0] as Record<string, unknown>) &&
      (adapted[0] as { type?: string }).type === "text" &&
      typeof (adapted[0] as { text?: unknown }).text === "string"
    ) {
      return { ...msg, content: (adapted[0] as { text: string }).text };
    }

    return { ...msg, content: adapted };
  });
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
    // Native Gemini API IDs
    "gemini-2.5-pro": { input: 1.25, output: 5.0 },
    "gemini-2.5-flash": { input: 0.075, output: 0.3 },
    // OpenRouter canonical IDs
    "google/gemini-2.5-pro": { input: 1.25, output: 5.0 },
    "google/gemini-2.5-flash": { input: 0.075, output: 0.3 },
    "anthropic/claude-opus-4.7": { input: 15.0, output: 75.0 },
    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0 },
    "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0 },
    "anthropic/claude-haiku-4.5": { input: 0.8, output: 4.0 },
    "minimax/minimax-m2": { input: 0.3, output: 1.2 },
    "mistralai/mistral-nemo": { input: 0.15, output: 0.15 },
    "meta-llama/llama-3.1-405b-instruct": { input: 2.7, output: 2.7 },
    // NVIDIA NIM
    "MiniMax-M2.7": { input: 0.3, output: 1.2 },
    "minimaxai/minimax-m2.7": { input: 0.3, output: 1.2 },
    // Native Anthropic API IDs (date-suffixed)
    "claude-opus-4-7": { input: 15.0, output: 75.0 },
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-haiku-4-5": { input: 0.8, output: 4.0 },
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
            (typeof outputContent === "string"
              ? outputContent
              : extractMessageText(outputContent)
            ).slice(0, 2000) || "[structured]",
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
  "gpt-4": "gemini-2.5-pro",
  "gpt-3.5-turbo": "gemini-2.5-flash",
  "gpt-3.5-turbo-16k": "gemini-2.5-flash",
  // Anthropic Claude → Gemini 等效對應
  "claude-3-opus": "gemini-2.5-pro",
  "claude-3.5-sonnet": "gemini-2.5-pro",
  "claude-3-sonnet": "gemini-2.5-pro",
  "claude-3-haiku": "gemini-2.5-flash",
  "claude-instant-1": "gemini-2.5-flash",
  "claude-sonnet-4.5": "gemini-2.5-pro",
  "claude-sonnet-4.6": "gemini-2.5-pro",
  "claude-opus-4.7": "gemini-2.5-pro",
  "claude-haiku-4.5": "gemini-2.5-flash",
  // Mistral → Gemini
  "mistral-large": "gemini-2.5-pro",
  "mistral-medium": "gemini-2.5-pro",
  "mistral-small": "gemini-2.5-flash",
  // Legacy Gemini 1.5 → 2.5(降版相容)
  "gemini-1.5-pro": "gemini-2.5-pro",
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-pro": "gemini-2.5-pro",
};

/**
 * 正規化模型名稱，確保與所選引擎相容。
 *   - Gemini API/Vertex API：不接受 OpenAI/Claude 名稱 → remap
 *   - Anthropic API：不接受 Gemini/OpenAI 名稱 → remap
 *   - Vertex 路徑（"vertex/gemini-..."）→ 取 "/" 後半段
 *   - Forge/其他代理 API：不做任何修改（代理層自行處理）
 */
const ANTHROPIC_MODEL_REMAP: Record<string, string> = {
  // Gemini → Claude 等效對應
  "gemini-2.5-pro": "claude-sonnet-4-6",
  "gemini-2.5-flash": "claude-haiku-4-5-20251001",
  "gemini-1.5-pro": "claude-sonnet-4-6",
  "gemini-1.5-flash": "claude-haiku-4-5-20251001",
  // OpenAI → Claude 等效對應
  "gpt-4o": "claude-sonnet-4-6",
  "gpt-4o-mini": "claude-haiku-4-5-20251001",
  "gpt-4-turbo": "claude-sonnet-4-6",
  "gpt-4": "claude-sonnet-4-6",
  "gpt-3.5-turbo": "claude-haiku-4-5-20251001",
  // OpenRouter canonical IDs → Anthropic native IDs
  "anthropic/claude-sonnet-4.5": "claude-sonnet-4-6",
  "anthropic/claude-sonnet-4.6": "claude-sonnet-4-6",
  "anthropic/claude-opus-4.7": "claude-opus-4-7",
  "anthropic/claude-haiku-4.5": "claude-haiku-4-5-20251001",
  // Friendly aliases
  "claude-haiku": "claude-haiku-4-5-20251001",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus": "claude-opus-4-7",
  "claude-sonnet-4.5": "claude-sonnet-4-6",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.7": "claude-opus-4-7",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
};

/**
 * Catalog id → OpenRouter canonical id 重映射。
 * 使用情境：當 invokeLLM 的降級鏈把帶有非 OpenRouter prefix 的 model
 * （例如 "nvidia/minimax-m2.7"、"vertex/gemini-2.5-pro"）送進 OpenRouter
 * 引擎時，OpenRouter 會以「is not a valid model」拒絕並回 400。
 * 這個 map 把這類 ID 重寫為 OpenRouter 實際支援的形式，避免斷路器連環跳閘。
 */
const OPENROUTER_CATALOG_REMAP: Record<string, string> = {
  // NVIDIA NIM 路徑 → OpenRouter 上的 MiniMax
  "nvidia/minimax-m2.7": "minimax/minimax-m2",
  "minimaxai/minimax-m2.7": "minimax/minimax-m2",
  // Vertex 內部路徑 → OpenRouter 等效（OpenRouter 不接受 vertex/ 前綴）
  "vertex/gemini-2.5-pro": "google/gemini-2.5-pro",
  "vertex/gemini-2.5-flash": "google/gemini-2.5-flash",
  // Legacy 1.5 → 2.5(OpenRouter 已不再支援 1.5 命名)
  "vertex/gemini-1.5-pro": "google/gemini-2.5-pro",
  "vertex/gemini-1.5-flash": "google/gemini-2.5-flash",
  "gemini-1.5-pro": "google/gemini-2.5-pro",
  "gemini-1.5-flash": "google/gemini-2.5-flash",
  "gemini-pro": "google/gemini-2.5-pro",
  "vertex/llama-3.2-90b": "meta-llama/llama-3.2-90b-vision-instruct",
  "vertex/llama-3.1-405b": "meta-llama/llama-3.1-405b-instruct",
  "vertex/mistral-nemo": "mistralai/mistral-nemo",
  // Anthropic native(date-suffixed)→ OpenRouter canonical
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4.5",
  "claude-haiku-4-5": "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4.6",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
  "claude-opus-4-7": "anthropic/claude-opus-4.7",
  // Legacy Claude 3 系列 → OpenRouter 4.x（保留向後相容；指向最新 4.6 Sonnet）
  "claude-3-opus": "anthropic/claude-opus-4.7",
  "claude-3.5-sonnet": "anthropic/claude-sonnet-4.6",
  "claude-3-sonnet": "anthropic/claude-sonnet-4.6",
  "claude-3-haiku": "anthropic/claude-haiku-4.5",
  // Legacy OpenAI → OpenRouter equivalents
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  "gpt-4-turbo": "openai/gpt-4-turbo",
  "gpt-4": "openai/gpt-4",
  "gpt-3.5-turbo": "openai/gpt-3.5-turbo",
};

function normalizeModelForEngine(model: string, engineName: string): string {
  const isGeminiEndpoint =
    engineName.includes("Gemini") || engineName.includes("Vertex");
  const isAnthropicEndpoint = engineName.includes("Anthropic");
  const isOpenRouterEndpoint = engineName.includes("OpenRouter");

  if (isOpenRouterEndpoint) {
    // 1) 顯式重映射（解決 nvidia/、vertex/ 等不被 OpenRouter 接受的 prefix）
    const remapped = OPENROUTER_CATALOG_REMAP[model];
    if (remapped) return remapped;

    // 2) 顯式 openrouter/ 前綴 → 去掉它（OpenRouter 不接受多餘前綴）
    if (model.startsWith("openrouter/")) {
      return model.slice("openrouter/".length);
    }

    // 3) OpenRouter expects `<provider>/<model>` format. If caller passes a
    // bare model name (e.g. "claude-sonnet-4-6"), prefix it sensibly.
    if (model.includes("/")) return model;
    if (model.startsWith("claude-")) return `anthropic/${model}`;
    if (model.startsWith("gemini-")) return `google/${model}`;
    if (model.startsWith("gpt-")) return `openai/${model}`;
    if (model.startsWith("minimax")) return `minimax/${model}`;
    if (/^sonar(-|$)/.test(model)) return `perplexity/${model}`;
    // 未知裸模型名 → 預設安全選擇（最新 Sonnet），避免送出去被 OpenRouter 直接 400
    return "anthropic/claude-sonnet-4.6";
  }

  if (isAnthropicEndpoint) {
    // Already a Claude model id → leave as-is.
    if (model.startsWith("claude-")) return model;
    return ANTHROPIC_MODEL_REMAP[model] ?? "claude-haiku-4-5-20251001";
  }

  const isNvidiaEndpoint = engineName.includes("NVIDIA NIM");

  if (isNvidiaEndpoint) {
    // NVIDIA 端點只接受 minimaxai/minimax-m2.7；若帶 nvidia/ 前綴會 404。
    if (model === "nvidia/minimax-m2.7") return "minimaxai/minimax-m2.7";
    if (model === "minimax/minimax-m2") return "minimaxai/minimax-m2.7";
    return model;
  }

  if (!isGeminiEndpoint) return model;

  // 處理 "vertex/gemini-2.5-pro" 路徑格式
  if (model.startsWith("vertex/")) {
    return model.split("/").slice(1).join("/");
  }

  // 已知不相容名稱 → remap
  return GEMINI_MODEL_REMAP[model] ?? model;
}

// ─── Gemini Schema 簡化（避免 400 "too many states" 錯誤） ──────────────────
//
// Gemini API 對 JSON Schema 的狀態機複雜度有嚴格限制。
// 當 schema 過深、屬性過多或含有複雜的 anyOf/oneOf/allOf 時，
// 會回傳 400 "The specified schema produces a constraint that has too many states for serving"。
//
// 此函數在傳送給 Gemini/Vertex 前，將 schema 簡化至安全範圍：
//   - 最大深度：3 層
//   - 每層最多屬性：20 個
//   - 移除 Gemini 不支援的關鍵字（$schema, $defs, $ref, anyOf, oneOf, allOf, not）
//   - 複雜的 anyOf/oneOf 降級為 type: "string"

const GEMINI_SCHEMA_MAX_DEPTH = 3;
const GEMINI_SCHEMA_MAX_PROPERTIES = 20;

function simplifySchemaForGemini(
  schema: Record<string, unknown>,
  depth: number = 0
): Record<string, unknown> {
  if (depth > GEMINI_SCHEMA_MAX_DEPTH) {
    // 超過最大深度 → 降級為 string
    return { type: "string" };
  }

  const simplified: Record<string, unknown> = {};

  // 保留 Gemini 支援的基本關鍵字
  const allowedKeys = [
    "type", "description", "properties", "required", "items",
    "enum", "minimum", "maximum", "minLength", "maxLength",
    "minItems", "maxItems", "nullable", "format",
  ];

  for (const key of allowedKeys) {
    if (!(key in schema)) continue;

    if (key === "properties" && typeof schema.properties === "object" && schema.properties !== null) {
      const props = schema.properties as Record<string, unknown>;
      const propKeys = Object.keys(props).slice(0, GEMINI_SCHEMA_MAX_PROPERTIES);
      const simplifiedProps: Record<string, unknown> = {};
      for (const propKey of propKeys) {
        const propVal = props[propKey];
        simplifiedProps[propKey] =
          typeof propVal === "object" && propVal !== null
            ? simplifySchemaForGemini(propVal as Record<string, unknown>, depth + 1)
            : propVal;
      }
      simplified.properties = simplifiedProps;
    } else if (key === "items" && typeof schema.items === "object" && schema.items !== null) {
      simplified.items = simplifySchemaForGemini(
        schema.items as Record<string, unknown>,
        depth + 1
      );
    } else {
      simplified[key] = schema[key];
    }
  }

  // anyOf / oneOf / allOf → 取第一個分支，或降級為 string
  for (const combiner of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[combiner]) && (schema[combiner] as unknown[]).length > 0) {
      const first = (schema[combiner] as unknown[])[0];
      if (typeof first === "object" && first !== null) {
        return simplifySchemaForGemini(first as Record<string, unknown>, depth);
      }
      return { type: "string" };
    }
  }

  // 確保 type 存在（Gemini 要求）
  if (!simplified.type) {
    simplified.type = "object";
  }

  return simplified;
}

/**
 * 針對 Gemini/Vertex 引擎，將 response_format 強制降級為 json_object。
 *
 * Gemini API 的 json_schema 模式對 schema 複雜度有嚴格限制，
 * 即使簡化後仍會回傳 400 "The specified schema produces a constraint
 * that has too many states for serving"。
 *
 * 解決方案：Gemini 一律使用 json_object 模式（仍可取得 JSON 輸出，
 * 但不強制 schema 驗證）。json_schema 模式僅保留給 Vertex AI 以外的引擎。
 */
function adaptResponseFormatForGemini(
  format: ResponseFormat
): ResponseFormat {
  // Always fall back to json_object for Gemini — json_schema mode triggers
  // "too many states" 400 errors regardless of schema complexity.
  if (format.type === "json_schema" || format.type === "json_object") {
    return { type: "json_object" };
  }
  return format;
}

/**
 * OpenRouter 的 structured output 會拒絕部分 JSON Schema 關鍵字（尤其是 `const`），
 * 在 schema-first planner 的 discriminated union 場景會直接 400。
 *
 * 這裡將 `const` 安全降級成單值 `enum`，並遞迴處理巢狀 schema，
 * 以維持約束語意，同時提高 OpenRouter 相容性。
 */
function adaptResponseFormatForOpenRouter(
  format: ResponseFormat
): ResponseFormat {
  if (format.type !== "json_schema") return format;

  const rewriteConst = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewriteConst);
    if (!value || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (key === "const") {
        // OpenRouter JSON schema validator may reject `const`.
        next.enum = [child];
        continue;
      }
      next[key] = rewriteConst(child);
    }
    return next;
  };

  return {
    ...format,
    json_schema: {
      ...format.json_schema,
      schema: rewriteConst(format.json_schema.schema) as JsonSchema["schema"],
    },
  };
}

// ─── Anthropic native API adapter ──────────────────────────────────────────
//
// Anthropic /v1/messages 使用與 OpenAI chat completions 不同的格式：
//   - system 訊息走獨立的 top-level `system` 字串欄位，不放在 `messages` 裡
//   - tools 用 { name, description, input_schema } 而不是 { function: {...} }
//   - tool_choice 形式不同：{ type: "auto" | "any" | "tool", name? }
//   - 回應是 content[] 區塊（text + tool_use），不是 choices[].message
//   - 認證用 x-api-key header，不是 Bearer
//
// 這層 adapter 負責雙向轉換，讓 invokeLLM 的呼叫端維持 OpenAI 風格的介面，
// 不需要為了 Claude 特別寫 if/else。

const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicTextBlock {
  type: "text";
  text: string;
}

interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

function messagesToAnthropic(messages: Message[]): {
  system: string | undefined;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const out: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text = Array.isArray(msg.content)
        ? msg.content
            .map(c =>
              typeof c === "string" ? c : c.type === "text" ? c.text : ""
            )
            .join("\n")
        : typeof msg.content === "string"
          ? msg.content
          : msg.content.type === "text"
            ? msg.content.text
            : "";
      system = system ? `${system}\n\n${text}` : text;
      continue;
    }

    if (msg.role === "tool" || msg.role === "function") {
      // Anthropic surfaces tool results as user messages with tool_result blocks.
      const text = Array.isArray(msg.content)
        ? msg.content
            .map(c => (typeof c === "string" ? c : JSON.stringify(c)))
            .join("\n")
        : typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id ?? "unknown",
            content: text,
          },
        ],
      });
      continue;
    }

    const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
    if (typeof msg.content === "string") {
      out.push({ role, content: msg.content });
      continue;
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const part of Array.isArray(msg.content) ? msg.content : [msg.content]) {
      if (typeof part === "string") {
        blocks.push({ type: "text", text: part });
      } else if (part.type === "text") {
        blocks.push({ type: "text", text: part.text });
      } else if (part.type === "image_url") {
        blocks.push({
          type: "image",
          source: { type: "url", url: part.image_url.url },
        });
      }
      // file_url and other types: not supported by Anthropic /v1/messages directly,
      // skip silently — caller can pre-resolve to text or images.
    }
    out.push({ role, content: blocks });
  }

  return { system, messages: out };
}

function toolsToAnthropic(tools?: Tool[]): Array<{
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}> | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
    },
  }));
}

function toolChoiceToAnthropic(
  choice: ToolChoice | undefined
): { type: "auto" } | { type: "any" } | { type: "tool"; name: string } | undefined {
  if (!choice) return undefined;
  if (choice === "none") return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && "name" in choice && typeof choice.name === "string") {
    return { type: "tool", name: choice.name };
  }
  if (typeof choice === "object" && "type" in choice && choice.type === "function") {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function anthropicResponseToInvokeResult(resp: AnthropicResponse): InvokeResult {
  const textParts = resp.content
    .filter((b): b is AnthropicTextBlock => b.type === "text")
    .map(b => b.text);
  const toolUses = resp.content.filter(
    (b): b is AnthropicToolUseBlock => b.type === "tool_use"
  );

  const tool_calls: ToolCall[] | undefined =
    toolUses.length > 0
      ? toolUses.map(b => ({
          id: b.id,
          type: "function" as const,
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }))
      : undefined;

  const finishReason =
    resp.stop_reason === "tool_use"
      ? "tool_calls"
      : resp.stop_reason === "end_turn"
        ? "stop"
        : resp.stop_reason ?? "stop";

  return {
    id: resp.id,
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textParts.join("\n").trim(),
          ...(tool_calls ? { tool_calls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: resp.usage
      ? {
          prompt_tokens: resp.usage.input_tokens,
          completion_tokens: resp.usage.output_tokens,
          total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
        }
      : undefined,
  };
}

// ─── LLM retry constants ───────────────────────────────────────────────────
// LLM_TIMEOUT_SECONDS 環境變數控制全域 timeout（預設 60s），
// 各引擎 invokeSingleEngine 內 fetch + AbortSignal 共用此值。
const LLM_REQUEST_TIMEOUT_MS = (() => {
  const parsed = parseInt(serverEnv.LLM_TIMEOUT_SECONDS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 60_000;
})();
const LLM_MAX_RETRIES = 3;
const LLM_MAX_RETRY_DELAY_MS = 8_000;

function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), LLM_MAX_RETRY_DELAY_MS);
}

// ─── Permanent error classification ───────────────────────────────────────
//
// 為什麼需要分類：當 Anthropic 回 400「credit balance is too low」、OpenRouter
// 回 401 「invalid api key」或 402「payment required」時，那不是「重試會恢復」
// 的網路抖動。每次重試都會：
//   (1) 浪費 5-10 秒等 timeout / 連線；
//   (2) 讓 fallback 鏈每次都先撞到壞掉的引擎再降級；
//   (3) 在 LangSmith 累積一堆假的 error trace 蓋住真正的問題。
//
// classifyLLMError 用來區分：
//   - permanent_quota：額度耗盡 / 帳單問題（402、credit balance、insufficient quota）
//   - permanent_auth ：API key 失效 / 未授權（401、403、invalid api key）
//   - transient      ：其他（5xx、429、網路錯誤等，繼續走原本的退避重試）
//
// 永久錯誤觸發 recordEngineFailure({ permanent: true }) → 立即斷路 10 分鐘，
// 讓系統把流量交給其他健康引擎，直到金鑰修好。

const PERMANENT_QUOTA_PATTERNS = [
  "credit balance is too low",
  "credit balance too low",
  "insufficient credit",
  "insufficient_quota",
  "insufficient quota",
  "quota exceeded",
  "quota_exceeded",
  "exceeded your current quota",
  "billing",
  "payment required",
  "you exceeded your current usage",
  "monthly spend limit",
];

const PERMANENT_AUTH_PATTERNS = [
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "api key not valid",
  "authentication failed",
  "authentication_error",
  "unauthorized",
  "forbidden",
  "no auth credentials",
];

export type LLMErrorClassification = {
  permanent: boolean;
  reason: "permanent_quota" | "permanent_auth" | "transient";
};

export function classifyLLMError(
  status: number,
  body: string
): LLMErrorClassification {
  const lower = (body || "").toLowerCase();

  // 402 Payment Required 一定是額度 / 帳單問題
  if (status === 402) {
    return { permanent: true, reason: "permanent_quota" };
  }

  // body 內出現額度耗盡的關鍵詞 → quota（即使狀態碼是 400/403）
  if (PERMANENT_QUOTA_PATTERNS.some(p => lower.includes(p))) {
    return { permanent: true, reason: "permanent_quota" };
  }

  // 401/403 通常代表金鑰失效
  if (status === 401 || status === 403) {
    return { permanent: true, reason: "permanent_auth" };
  }

  // body 出現典型 auth 字眼
  if (PERMANENT_AUTH_PATTERNS.some(p => lower.includes(p))) {
    return { permanent: true, reason: "permanent_auth" };
  }

  return { permanent: false, reason: "transient" };
}

/**
 * 帶有「永久錯誤」標記的 LLM 錯誤類別。callEngine 會檢查此屬性並把訊息
 * 傳給 recordEngineFailure({ permanent: true })，讓斷路器立刻打開。
 */
export class LLMPermanentError extends Error {
  readonly permanent = true as const;
  readonly reason: LLMErrorClassification["reason"];
  readonly status: number;
  constructor(
    message: string,
    reason: LLMErrorClassification["reason"],
    status: number
  ) {
    super(message);
    this.name = "LLMPermanentError";
    this.reason = reason;
    this.status = status;
  }
}

function isPermanentLLMError(err: unknown): err is LLMPermanentError {
  return (
    err instanceof Error &&
    (err as Error & { permanent?: boolean }).permanent === true
  );
}

// ─── 主要 LLM 呼叫函數 ────────────────────────────────────────────────────

/**
 * 為 cache / dedup 建構穩定的 fingerprint key。
 *
 * 包含：model + messages 內容 + temperature + maxTokens + tools 名稱 +
 * tool_choice + responseFormat type。
 *
 * 不包含：runName、parentRunId、systemPrompt（已併入 messages）、engine 偏好
 * （因為相同輸入不論走哪條引擎都該回相同的語義內容）— 這讓不同入口的
 * 「相同提問」可以共用快取。
 */
function buildLlmFingerprint(p: {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  responseFormat?: ResponseFormat;
}): string {
  return cache.buildLlmKey({
    model: p.model,
    messages: p.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
    temperature: p.temperature,
    maxTokens: p.maxTokens,
  }) +
    ":" +
    (p.tools?.map(t => t.function.name).sort().join(",") ?? "") +
    ":" +
    (typeof p.toolChoice === "string"
      ? p.toolChoice
      : p.toolChoice && "name" in p.toolChoice
        ? `name:${p.toolChoice.name}`
        : p.toolChoice && "function" in p.toolChoice
          ? `fn:${p.toolChoice.function.name}`
          : "auto") +
    ":" +
    (p.responseFormat?.type ?? "text");
}

/**
 * Race 多個 promise，回傳第一個成功 settle 的結果。
 * 全部失敗時 reject，error 取最後一個（與原本順序 fallback 行為一致）。
 */
function raceSuccess<T>(promises: Array<Promise<T>>): Promise<T> {
  return new Promise((resolve, reject) => {
    let pending = promises.length;
    let lastError: unknown = null;
    if (pending === 0) {
      reject(new Error("raceSuccess: empty promise array"));
      return;
    }
    promises.forEach(p => {
      p.then(
        v => resolve(v),
        err => {
          lastError = err;
          if (--pending === 0) {
            reject(lastError ?? new Error("raceSuccess: all promises rejected"));
          }
        }
      );
    });
  });
}

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
    preferEngine,
    temperature,
    topP,
    model: overrideModel,
    systemPrompt,
    timeoutMs,
    cacheable,
    cacheTtlSeconds,
    dedupe,
    hedge,
    hedgeDelayMs,
  } = params;

  // ── 注入系統提示詞（來自 ctx.brain）──────────────────────────
  let processedMessages = messages;
  if (systemPrompt) {
    // 尋找第一條 system 訊息
    const firstSystemIdx = messages.findIndex(m => m.role === "system");
    if (firstSystemIdx >= 0) {
      // 合併：AI 大腦系統提示詞在前，原有系統提示詞在後
      const originalContent = messages[firstSystemIdx].content;
      const originalText =
        typeof originalContent === "string"
          ? originalContent
          : Array.isArray(originalContent)
            ? originalContent
                .map(c => (typeof c === "string" ? c : c.type === "text" ? c.text : ""))
                .join("\n")
            : "";
      const mergedContent = `${systemPrompt}\n\n${originalText}`;
      processedMessages = [
        ...messages.slice(0, firstSystemIdx),
        { ...messages[firstSystemIdx], content: mergedContent },
        ...messages.slice(firstSystemIdx + 1),
      ];
    } else {
      // 插入新的 system 訊息在最前面
      processedMessages = [
        { role: "system" as const, content: systemPrompt },
        ...messages,
      ];
    }
  }

  // ── Cache lookup（最早 — 命中直接回傳，不消耗任何資源） ──────
  const normalizedResponseFormatForKey = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });
  const fingerprint = buildLlmFingerprint({
    model: overrideModel ?? "auto",
    messages: processedMessages,
    temperature,
    maxTokens: maxTokens ?? max_tokens,
    tools,
    toolChoice: toolChoice ?? tool_choice,
    responseFormat: normalizedResponseFormatForKey,
  });

  if (cacheable) {
    const hit = await cache.getLlmResponse<InvokeResult>(`llm:${fingerprint}`);
    if (hit) {
      logger.debug("[LLM] cache hit", { runName, model: overrideModel ?? "auto" });
      return hit;
    }
  }

  // ── 透過路由器取得引擎設定 ───────────────────────────────
  // engine（強制）優先；其次 preferEngine（偏好，允許降級）；
  // 若仍是 auto 而 overrideModel 帶有明確 prefix，依 prefix 推斷正確引擎，
  // 避免 nvidia/...、vertex/... 這類 ID 被誤送至 OpenRouter 造成 400。
  let resolvedPrimary: LLMEngine = engine ?? preferEngine ?? "auto";
  if (resolvedPrimary === "auto" && typeof overrideModel === "string") {
    const inferred = inferEngineFromModelIdSafe(overrideModel);
    if (inferred) {
      resolvedPrimary = inferred;
    }
  }

  // preferEngine 且斷路器 OPEN → 直接跳過，從健康的備援鏈開始
  const skipPreferDueToCircuit =
    preferEngine &&
    !engine &&
    preferEngine !== "auto" &&
    !isEngineAvailable(preferEngine);

  let primaryConfig: EngineConfig;
  try {
    primaryConfig = resolveEngineConfig(
      skipPreferDueToCircuit ? "auto" : resolvedPrimary
    );
  } catch (err) {
    // 偏好引擎不可用（例如 API 金鑰未設定）→ 降級到 auto
    if (preferEngine && !engine) {
      primaryConfig = resolveEngineConfig("auto");
    } else {
      throw err;
    }
  }

  // ── 嘗試主引擎 + 自動降級到備援引擎 ───────────────────────
  const engineConfigs: EngineConfig[] = [primaryConfig];

  // 允許降級的情境：auto、未指定、或 preferEngine（偏好但可降級）
  const allowFallback = !engine || engine === "auto" || !!preferEngine;
  if (allowFallback) {
    // latencyAware：根據 EMA 延遲對 fallback 排序，最快的引擎優先試
    engineConfigs.push(
      ...getEngineFallbackChain(primaryConfig.engine, { latencyAware: true })
    );
  }

  const inferredOverrideEngine =
    typeof overrideModel === "string"
      ? inferEngineFromModelIdSafe(overrideModel)
      : null;

  /**
   * 對單一引擎呼叫 — 含 model ID 兼容性處理 + 短重試（fast-fail）邏輯。
   * 當 chain 還有備援時，retriesOverride=1 讓主引擎僅試一次就交棒；
   * 當已經是 chain 的最後一個引擎時，allow 預設 3 次重試（exponential backoff）。
   */
  const callEngine = async (
    engineConfig: EngineConfig,
    isLastEngine: boolean
  ): Promise<InvokeResult> => {
    const scopedOverrideModel =
      inferredOverrideEngine && inferredOverrideEngine !== engineConfig.engine
        ? undefined
        : overrideModel;

    const startMs = Date.now();
    try {
      const result = await invokeSingleEngine(engineConfig, {
        messages: processedMessages,
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
        overrideModel: scopedOverrideModel,
        timeoutMs,
        // 還有備援引擎可用時，主引擎只試 1 次就快速交棒；最後一個引擎才允許完整重試。
        // 這把整體尾延遲從 ~24s（3 次 × 8s backoff）降到單次呼叫即切換。
        retriesOverride: isLastEngine ? undefined : 1,
      });
      const latencyMs = Date.now() - startMs;
      recordEngineSuccess(engineConfig.engine, latencyMs);
      return result;
    } catch (err) {
      // 永久錯誤（401/403/402、credit balance too low、invalid api key 等）→
      // 立即斷路 10 分鐘，不再讓 fallback 鏈每次都先撞到這個壞掉的引擎。
      if (isPermanentLLMError(err)) {
        recordEngineFailure(engineConfig.engine, {
          permanent: true,
          reason: err.reason,
        });
      } else {
        recordEngineFailure(engineConfig.engine);
      }
      throw err;
    }
  };

  // 整個引擎迴圈（含降級）共用一個並行槽位，由 MAX_CONCURRENT_LLM_CALLS 控制。
  // 同一次 invokeLLM 呼叫即使要試 3 個引擎，也只佔一個槽，避免迴圈期間槽位反覆釋放。
  const runEngineLoop = async (): Promise<InvokeResult> =>
    withLLMSlot(async () => {
      // ── Hedge 模式：主引擎與第一個備援同時賽跑（延遲後啟動備援）─
      if (hedge && engineConfigs.length >= 2) {
        const primary = engineConfigs[0];
        const secondary = engineConfigs[1];
        const delay = typeof hedgeDelayMs === "number" && hedgeDelayMs >= 0 ? hedgeDelayMs : 600;

        const primaryPromise = callEngine(primary, false);
        const secondaryPromise = (async () => {
          await new Promise(r => setTimeout(r, delay));
          return callEngine(secondary, false);
        })();

        try {
          // 任一成功即回傳；兩個都失敗則往下走 sequential fallback（從第三個引擎起）
          return await raceSuccess([primaryPromise, secondaryPromise]);
        } catch (err) {
          logger.warn("[LLM] hedged race failed; continuing sequential fallback", {
            runName,
            primary: primary.name,
            secondary: secondary.name,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
          // 從第三個引擎起繼續 sequential fallback
          let lastError: Error =
            err instanceof Error ? err : new Error(String(err));
          for (let i = 2; i < engineConfigs.length; i++) {
            const cfg = engineConfigs[i];
            const isLast = i === engineConfigs.length - 1;
            try {
              return await callEngine(cfg, isLast);
            } catch (e) {
              lastError = e instanceof Error ? e : new Error(String(e));
              console.warn(
                `[LLM] ⚠️ ${cfg.name} 失敗，嘗試下一個備援... 錯誤: ${lastError.message.slice(0, 200)}`
              );
            }
          }
          throw lastError;
        }
      }

      // ── 預設 sequential fallback ──
      let lastError: Error | null = null;
      const permanentReasons: Array<{ engine: string; reason: string }> = [];
      for (let i = 0; i < engineConfigs.length; i++) {
        const cfg = engineConfigs[i];
        const isLast = i === engineConfigs.length - 1;
        try {
          return await callEngine(cfg, isLast);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (isPermanentLLMError(err)) {
            permanentReasons.push({ engine: cfg.name, reason: err.reason });
          }
          if (!isLast) {
            console.warn(
              `[LLM] ⚠️ ${cfg.name} 失敗，嘗試備援引擎... 錯誤: ${lastError.message.slice(0, 200)}`
            );
          }
        }
      }
      // 多引擎全部因 permanent 錯誤失敗時，包成 aggregate 訊息，把運營者
      // 直接指向「補額度 / 換金鑰」的修復路徑。單引擎強制路徑（沒有 fallback）
      // 維持原始 LLMPermanentError 拋出，呼叫端可用 instanceof 判斷。
      if (
        engineConfigs.length > 1 &&
        permanentReasons.length === engineConfigs.length &&
        lastError
      ) {
        const summary = permanentReasons
          .map(r => `${r.engine}（${r.reason}）`)
          .join("、");
        const aggregate = new Error(
          `[LLM] 所有可用引擎皆因金鑰／額度問題失敗：${summary}。請檢查環境變數 OPENROUTER_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY 是否仍有效，或前往對應供應商儀表板補額度。原始錯誤：${lastError.message.slice(0, 200)}`
        );
        throw aggregate;
      }
      throw lastError ?? new Error("[LLM] 所有引擎都失敗");
    });

  // ── Dedup wrapper（in-flight 合併）+ Cache write back ──
  const shouldDedupe = dedupe !== false; // 預設 ON
  const result = shouldDedupe
    ? await dedup.deduplicate(`llm-invoke:${fingerprint}`, runEngineLoop)
    : await runEngineLoop();

  if (cacheable) {
    await cache.setLlmResponse(`llm:${fingerprint}`, result, cacheTtlSeconds);
  }

  return result;
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
    timeoutMs?: number;
    /**
     * 覆蓋此次呼叫的最大重試次數（預設 LLM_MAX_RETRIES = 3）。
     * 上層 invokeLLM 會在 chain 還有備援時設為 1，讓主引擎快速交棒，
     * 把 3 次 × backoff 的尾延遲（~24s）降到單次呼叫即切換。
     */
    retriesOverride?: number;
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
    timeoutMs,
    retriesOverride,
  } = params;
  const perEngineTimeoutMs =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? timeoutMs
      : LLM_REQUEST_TIMEOUT_MS;
  const maxRetries =
    typeof retriesOverride === "number" && retriesOverride >= 1
      ? Math.min(retriesOverride, LLM_MAX_RETRIES)
      : LLM_MAX_RETRIES;

  // ── 解析最終模型名稱（含 engine 相容性正規化）───────────
  const rawModel = overrideModel ?? engineConfig.model;
  const resolvedModel = normalizeModelForEngine(rawModel, engineConfig.name);
  const isAnthropicEngine = engineConfig.engine === "anthropic";

  const payload: Record<string, unknown> = isAnthropicEngine
    ? (() => {
        const { system, messages: anthropicMessages } = messagesToAnthropic(messages);
        const p: Record<string, unknown> = {
          model: resolvedModel,
          messages: anthropicMessages,
          max_tokens: maxTokens ?? max_tokens ?? 8192,
        };
        if (system) p.system = system;
        return p;
      })()
    : {
        model: resolvedModel,
        messages: (() => {
          const normalized = messages.map(normalizeMessage);
          if (engineConfig.engine === "gemini" || engineConfig.engine === "vertex") {
            return adaptMessagesForGeminiCompat(normalized);
          }
          if (engineConfig.engine === "perplexity") {
            return adaptMessagesForPerplexity(normalized);
          }
          return normalized;
        })(),
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

  if (tools && tools.length > 0) {
    if (isAnthropicEngine) {
      const anthropicTools = toolsToAnthropic(tools);
      if (anthropicTools) payload.tools = anthropicTools;
    } else {
      payload.tools = tools;
    }
  }

  if (isAnthropicEngine) {
    const anthropicChoice = toolChoiceToAnthropic(toolChoice || tool_choice);
    if (anthropicChoice) payload.tool_choice = anthropicChoice;
  } else {
    const normalizedToolChoice = normalizeToolChoice(
      toolChoice || tool_choice,
      tools
    );
    if (normalizedToolChoice) payload.tool_choice = normalizedToolChoice;
  }

  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });
  if (normalizedResponseFormat && !isAnthropicEngine) {
    // Gemini/Vertex 引擎：簡化 schema 以避免 400 "too many states" 錯誤
    const isGeminiEngine =
      engineConfig.engine === "gemini" || engineConfig.engine === "vertex";
    const isOpenRouterEngine = engineConfig.engine === "openrouter";
    payload.response_format = isGeminiEngine
      ? adaptResponseFormatForGemini(normalizedResponseFormat)
      : isOpenRouterEngine
      ? adaptResponseFormatForOpenRouter(normalizedResponseFormat)
      : normalizedResponseFormat;
  }
  // Anthropic doesn't accept response_format. For json_object/json_schema callers,
  // strict-JSON behaviour is achieved via the system prompt + tool_use schemas.

  const startTime = Date.now();
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let result: InvokeResult | undefined;
  try {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          perEngineTimeoutMs
        );
        const headers: Record<string, string> = isAnthropicEngine
          ? {
              "content-type": "application/json",
              "x-api-key": engineConfig.apiKey,
              "anthropic-version": ANTHROPIC_VERSION,
            }
          : {
              "content-type": "application/json",
              authorization: `Bearer ${engineConfig.apiKey}`,
            };

        // OpenRouter requests benefit from optional attribution headers —
        // the dashboard groups usage by app and gives priority routing.
        if (engineConfig.engine === "openrouter") {
          if (serverEnv.OPENROUTER_HTTP_REFERER) {
            headers["HTTP-Referer"] = serverEnv.OPENROUTER_HTTP_REFERER;
          }
          if (serverEnv.OPENROUTER_X_TITLE) {
            headers["X-Title"] = serverEnv.OPENROUTER_X_TITLE;
          }
        }
        const response = await fetch(engineConfig.url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          const classification = classifyLLMError(response.status, errorText);
          const baseMessage = `[${engineConfig.name}] LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`;
          const err = classification.permanent
            ? new LLMPermanentError(
                baseMessage,
                classification.reason,
                response.status
              )
            : new Error(baseMessage);
          // Retry on 5xx server errors or 429 rate limit, but never on permanent
          // auth/quota errors — those will keep failing until the operator fixes
          // the API key or tops up credits, and each retry just wastes latency.
          if (
            !classification.permanent &&
            (response.status >= 500 || response.status === 429) &&
            attempt < maxRetries
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

        const rawJson = await response.json();
        result = isAnthropicEngine
          ? anthropicResponseToInvokeResult(rawJson as AnthropicResponse)
          : (rawJson as InvokeResult);
        lastError = null;
        break;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        lastError = error;
        const isRetryable =
          error.name === "AbortError" || error.message.includes("fetch failed");
        if (isRetryable && attempt < maxRetries) {
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

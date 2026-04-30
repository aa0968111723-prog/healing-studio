import { z } from "zod";
import { summarizeGlobalCapabilityRegistry } from "./global-agent-capabilities";
import { summarizeGlobalToolRegistry } from "./global-agent-tools";

export const ORB_MEMORY_TYPES = [
  "user_preference",
  "successful_workflow",
  "failed_workflow",
  "prompt_pattern",
  "model_preference",
  "style_preference",
  "tool_feedback",
  "claude_code_task",
  "codex_task",
  "safety_event",
  "recovery_event",
] as const;

export const OrbMemoryTypeSchema = z.enum(ORB_MEMORY_TYPES);

export const OrbMemorySchema = z.object({
  memoryId: z.string().min(1),
  userId: z.number().int().positive().optional(),
  anonymousSessionId: z.string().min(1).max(120).optional(),
  traceId: z.string().min(1).max(120),
  planId: z.string().min(1).max(120).optional(),
  taskId: z.string().min(1).max(120).optional(),
  type: OrbMemoryTypeSchema,
  summary: z.string().min(1).max(600),
  source: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(64)).max(20).default([]),
  createdAt: z.number().int(),
  expiresAt: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type OrbMemory = z.infer<typeof OrbMemorySchema>;
export type OrbMemoryType = z.infer<typeof OrbMemoryTypeSchema>;

const SECRET_PATTERNS = [
  /(api[_-]?key|token|secret|password)\s*[:=]\s*[\w-]{6,}/i,
  /sk-[a-z0-9]{10,}/i,
  /AKIA[0-9A-Z]{12,}/,
  /(?:\d[ -]*?){13,19}/,
  /(?:身分證|身份證|id\s*card|social\s*security)/i,
  /^data:[^;]+;base64,/i,
];

export function containsSensitiveText(text: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(text));
}

export function sanitizeMemoryText(text: string): string {
  let next = text;
  next = next.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
  next = next.replace(/sk-[a-z0-9]{8,}/gi, "sk-[REDACTED]");
  next = next.replace(/AKIA[0-9A-Z]{12,}/g, "AKIA[REDACTED]");
  next = next.replace(/data:[^;]+;base64,[a-z0-9+/=\s]+/gi, "[BASE64_REDACTED]");
  if (next.length > 600) next = `${next.slice(0, 580)}…`;
  return next;
}

export function sanitizeMemoryMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    const lower = key.toLowerCase();
    if (lower.includes("key") || lower.includes("secret") || lower.includes("token") || lower.includes("password")) continue;
    if (typeof value === "string") {
      if (containsSensitiveText(value)) {
        safe[key] = "[REDACTED]";
      } else if (value.length > 300) {
        safe[key] = `${value.slice(0, 220)}…`;
      } else {
        safe[key] = value;
      }
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export function summarizeRecentMemoryForPlanner(memories: OrbMemory[]): string {
  const sorted = [...memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  return JSON.stringify(
    sorted.map(memory => ({
      // Citation tracking: surface memoryId + source so the LLM can reference
      // which prior memory drove a recommendation. The planner prompt asks the
      // LLM to cite these IDs in its `citations` array; the parser propagates
      // them to the front-end so the user sees "based on memory:abc123".
      memoryId: memory.memoryId,
      source: memory.source,
      type: memory.type,
      summary: sanitizeMemoryText(memory.summary),
      confidence: memory.confidence,
      tags: memory.tags.slice(0, 8),
      createdAt: memory.createdAt,
    }))
  );
}

export function summarizeSiteKnowledgeForPlanner(input: {
  currentPageSummary: string;
  memorySummary: string;
  taskOutcomesSummary: string;
}): string {
  return [
    `Current page:\n${input.currentPageSummary}`,
    `Available capabilities:\n${summarizeGlobalCapabilityRegistry(80)}`,
    `Available tools:\n${summarizeGlobalToolRegistry(40)}`,
    `Recent user memory:\n${input.memorySummary}`,
    `Recent task outcomes:\n${input.taskOutcomesSummary}`,
    "Safety constraints:\nNever store or echo API keys, secrets, passwords, card numbers, full transcript/media/file contents, or base64 blobs.",
  ].join("\n\n");
}

export function summarizeCapabilityRegistryForPlanner(limit = 80): string {
  return summarizeGlobalCapabilityRegistry(limit);
}

export function summarizeToolRegistryForPlanner(limit = 40): string {
  return summarizeGlobalToolRegistry(limit);
}

export interface ExtractedOrbPreferences {
  /** 從訊息裡擷取到的暱稱，用來下次主動稱呼。 */
  name?: string;
  language?: "zh-TW" | "en";
  styles: string[];
  outputs: string[];
  models: string[];
  /** 偏好影片長度：short=30 秒級、medium=1–3 分鐘、long=5 分鐘以上 */
  videoLengthHint?: "short" | "medium" | "long";
  /** 投放平台：IG、YouTube、TikTok 等 */
  platforms: string[];
  workflowHints: string[];
  riskPreference?: "confirm_first" | "direct_when_safe";
  claudeCodePreference?: string;
}

const NAME_NEGATIVE_RE =
  /^(學生|新手|老師|工程師|設計師|創作者|新人|老人|男生|女生|user|new|old|here)$/i;

/**
 * 從訊息中擷取使用者自報的名字。
 * 支援「我叫 X」「我是 X」「叫我 X」「my name is X」「I'm X」「I am X」。
 */
export function extractUserName(text: string): string | undefined {
  // ES5 target: avoid \p{Letter} (requires `u` flag, ES2018+). Use an explicit
  // BMP character class covering CJK + ASCII letters/digits, which is enough
  // for self-reported nicknames in this product.
  const NAME_BODY = "[A-Za-z0-9一-鿿぀-ヿ㐀-䶿]";
  const patterns: RegExp[] = [
    new RegExp(`我叫\\s*(${NAME_BODY}{1,12})`),
    new RegExp(`我是\\s*(${NAME_BODY}{1,12})`),
    new RegExp(`叫我\\s*(${NAME_BODY}{1,12})`),
    /(?:my\s+name\s+is|i'?m|i\s+am)\s+([A-Za-z][A-Za-z0-9]{0,15})/i,
  ];
  // Trailing softeners that often follow self-introductions in Chinese:
  // 「叫我阿傑就好」「我叫小華吧」「我是阿明哦」 — strip them so we keep the
  // actual name and not the politeness suffix.
  const STOP_SUFFIX_RE = /(就好|就是|都好|也行|沒錯|吧|啊|呢|嗎|哦|喔|呀|耶)$/;
  for (const re of patterns) {
    const match = text.match(re);
    if (!match || !match[1]) continue;
    const trimmed = match[1].trim().replace(STOP_SUFFIX_RE, "").trim();
    if (!trimmed) continue;
    if (NAME_NEGATIVE_RE.test(trimmed)) continue;
    if (containsSensitiveText(trimmed)) continue;
    return trimmed;
  }
  return undefined;
}

const PLATFORM_TOKENS: Array<{ token: string; label: string }> = [
  { token: "instagram", label: "Instagram" },
  { token: "ig", label: "Instagram" },
  { token: "限動", label: "Instagram" },
  { token: "reels", label: "Instagram Reels" },
  { token: "youtube", label: "YouTube" },
  { token: "yt", label: "YouTube" },
  { token: "shorts", label: "YouTube Shorts" },
  { token: "tiktok", label: "TikTok" },
  { token: "抖音", label: "抖音" },
  { token: "facebook", label: "Facebook" },
  { token: "fb", label: "Facebook" },
  { token: "threads", label: "Threads" },
  { token: "linkedin", label: "LinkedIn" },
];

function detectVideoLengthHint(text: string): "short" | "medium" | "long" | undefined {
  if (/長片|長影片|長視頻/.test(text)) return "long";
  const minutes = text.match(/(\d+)\s*分(?!之|秒)/);
  if (minutes) {
    const n = Number.parseInt(minutes[1], 10);
    if (n >= 5) return "long";
    if (n >= 1) return "medium";
  }
  if (/短片|reel|shorts|teaser/i.test(text)) return "short";
  const seconds = text.match(/(\d+)\s*秒/);
  if (seconds) {
    const n = Number.parseInt(seconds[1], 10);
    if (n <= 60) return "short";
    if (n <= 180) return "medium";
    return "long";
  }
  return undefined;
}

function detectPlatforms(text: string): string[] {
  const lower = text.toLowerCase();
  const seen = new Set<string>();
  for (const { token, label } of PLATFORM_TOKENS) {
    if (lower.includes(token)) seen.add(label);
  }
  return Array.from(seen);
}

export function extractOrbPreferencesFromConversation(input: {
  messages: Array<{ role: string; content: string }>;
  taskSummaries?: string[];
}): ExtractedOrbPreferences {
  // 偏好抽取只看使用者訊息，避免把 LLM 自己 echo 的內容當成記憶。
  const userText = input.messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n");
  const text = input.messages.map(m => `${m.role}:${m.content}`).join("\n").toLowerCase();
  const pick = (keywords: string[], value: string) => keywords.some(k => text.includes(k)) ? value : null;
  const styles = [
    pick(["電影", "cinematic"], "電影感"),
    pick(["寫實", "realistic"], "寫實"),
    pick(["動畫", "anime", "cartoon"], "動畫"),
    pick(["療癒", "healing"], "療癒"),
    pick(["科技", "sci-fi", "tech"], "科技感"),
  ].filter((v): v is string => Boolean(v));
  const outputs = [
    pick(["短影音", "reel", "shorts"], "短影音"),
    pick(["腳本", "script"], "腳本"),
    pick(["分鏡", "storyboard"], "分鏡"),
    pick(["提示詞", "prompt"], "提示詞"),
    pick(["配音", "voiceover"], "配音稿"),
  ].filter((v): v is string => Boolean(v));

  const models = ["veo", "suno", "gemini", "claude", "flux"].filter(model => text.includes(model));
  const workflowHints = input.taskSummaries?.slice(0, 5).map(summary => sanitizeMemoryText(summary)).filter(Boolean) ?? [];
  const language = /[\u4e00-\u9fff]/.test(text) ? "zh-TW" : text.includes("english") ? "en" : undefined;
  const riskPreference = text.includes("先確認") || text.includes("confirm first") ? "confirm_first" : "direct_when_safe";
  const claudeCodePreference = text.includes("rollback") || text.includes("測試") || text.includes("pr format")
    ? sanitizeMemoryText(text.slice(0, 120))
    : undefined;

  const name = extractUserName(userText);
  const videoLengthHint = detectVideoLengthHint(userText);
  const platforms = detectPlatforms(userText);

  return {
    name,
    language,
    styles,
    outputs,
    models,
    videoLengthHint,
    platforms,
    workflowHints,
    riskPreference,
    claudeCodePreference,
  };
}

/**
 * Durable preference profile aggregated across many memory snapshots. Used to
 * surface "what we already know about you" to the planner prompt and to the
 * client-side keyword fallback so it can fill in missing details (length /
 * platform / style) without asking again.
 */
export interface OrbUserPreferenceProfile {
  name?: string;
  styles: string[];
  outputs: string[];
  platforms: string[];
  models: string[];
  videoLengthHint?: "short" | "medium" | "long";
  language?: "zh-TW" | "en";
  /** 多少筆記憶投票，用來判斷信心 */
  evidenceCount: number;
}

const PREFERENCE_MEMORY_TYPES: OrbMemoryType[] = [
  "user_preference",
  "style_preference",
  "model_preference",
];

export function aggregatePreferenceProfile(memories: OrbMemory[]): OrbUserPreferenceProfile {
  const styles = new Set<string>();
  const outputs = new Set<string>();
  const platforms = new Set<string>();
  const models = new Set<string>();
  let name: string | undefined;
  let videoLengthHint: "short" | "medium" | "long" | undefined;
  let language: "zh-TW" | "en" | undefined;
  let evidenceCount = 0;

  const sorted = [...memories].sort((a, b) => b.createdAt - a.createdAt);
  for (const memory of sorted) {
    if (!PREFERENCE_MEMORY_TYPES.includes(memory.type)) continue;
    evidenceCount += 1;
    const meta = memory.metadata ?? {};
    if (!name && typeof meta.name === "string" && meta.name.trim()) {
      name = meta.name.trim();
    }
    if (
      !videoLengthHint &&
      (meta.videoLengthHint === "short" || meta.videoLengthHint === "medium" || meta.videoLengthHint === "long")
    ) {
      videoLengthHint = meta.videoLengthHint;
    }
    if (!language && (meta.language === "zh-TW" || meta.language === "en")) {
      language = meta.language;
    }
    const collect = (set: Set<string>, value: unknown) => {
      if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string" && item.trim()) set.add(item.trim());
      }
    };
    collect(styles, meta.styles);
    collect(outputs, meta.outputs);
    collect(platforms, meta.platforms);
    collect(models, meta.models);
    for (const tag of memory.tags) {
      if (tag.startsWith("style:")) styles.add(tag.slice(6));
      else if (tag.startsWith("platform:")) platforms.add(tag.slice(9));
      else if (tag.startsWith("output:")) outputs.add(tag.slice(7));
    }
  }

  return {
    name,
    styles: Array.from(styles).slice(0, 6),
    outputs: Array.from(outputs).slice(0, 6),
    platforms: Array.from(platforms).slice(0, 4),
    models: Array.from(models).slice(0, 6),
    videoLengthHint,
    language,
    evidenceCount,
  };
}

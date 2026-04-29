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
  language?: "zh-TW" | "en";
  styles: string[];
  outputs: string[];
  models: string[];
  workflowHints: string[];
  riskPreference?: "confirm_first" | "direct_when_safe";
  claudeCodePreference?: string;
}

export function extractOrbPreferencesFromConversation(input: {
  messages: Array<{ role: string; content: string }>;
  taskSummaries?: string[];
}): ExtractedOrbPreferences {
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

  return {
    language,
    styles,
    outputs,
    models,
    workflowHints,
    riskPreference,
    claudeCodePreference,
  };
}

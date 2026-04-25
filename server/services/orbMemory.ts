import {
  OrbMemorySchema,
  type OrbMemory,
  type OrbMemoryType,
  containsSensitiveText,
  sanitizeMemoryMetadata,
  sanitizeMemoryText,
  summarizeRecentMemoryForPlanner,
} from "../../shared/orb-memory";

interface RecordOrbMemoryInput {
  userId?: number;
  anonymousSessionId?: string;
  traceId: string;
  planId?: string;
  taskId?: string;
  type: OrbMemoryType;
  summary: string;
  source: string;
  confidence?: number;
  tags?: string[];
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

const store: OrbMemory[] = [];

function nextMemoryId() {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureMemoryEnabled(): boolean {
  const raw = process.env.ENABLE_ORB_LONG_TERM_MEMORY ?? "true";
  const normalized = String(raw).trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(normalized);
}

function isOwner(memory: OrbMemory, userId?: number, anonymousSessionId?: string): boolean {
  if (!userId && !anonymousSessionId) return true;
  if (userId && memory.userId === userId) return true;
  if (anonymousSessionId && memory.anonymousSessionId === anonymousSessionId) return true;
  return false;
}

export function recordOrbMemory(input: RecordOrbMemoryInput): OrbMemory | null {
  if (!ensureMemoryEnabled()) return null;

  const summary = sanitizeMemoryText(input.summary);
  const metadata = sanitizeMemoryMetadata(input.metadata);

  if (containsSensitiveText(input.summary)) {
    const safetyEvent = OrbMemorySchema.parse({
      memoryId: nextMemoryId(),
      userId: input.userId,
      anonymousSessionId: input.anonymousSessionId,
      traceId: input.traceId,
      planId: input.planId,
      taskId: input.taskId,
      type: "safety_event",
      summary: "Sensitive content detected and redacted in memory pipeline",
      source: input.source,
      confidence: 1,
      tags: ["redaction", "secret-detected"],
      createdAt: Date.now(),
      metadata: { reason: "secret-like-string" },
    });
    store.push(safetyEvent);
  }

  const memory = OrbMemorySchema.parse({
    memoryId: nextMemoryId(),
    userId: input.userId,
    anonymousSessionId: input.anonymousSessionId,
    traceId: input.traceId,
    planId: input.planId,
    taskId: input.taskId,
    type: input.type,
    summary,
    source: input.source,
    confidence: input.confidence ?? 0.7,
    tags: input.tags ?? [],
    createdAt: Date.now(),
    expiresAt: input.expiresAt,
    metadata,
  });
  store.push(memory);
  return memory;
}

export function getRecentOrbMemories(args: {
  userId?: number;
  anonymousSessionId?: string;
  limit?: number;
  types?: OrbMemoryType[];
}): OrbMemory[] {
  const limit = Math.max(1, Math.min(args.limit ?? 10, 100));
  const now = Date.now();
  return store
    .filter(memory => isOwner(memory, args.userId, args.anonymousSessionId))
    .filter(memory => !memory.expiresAt || memory.expiresAt > now)
    .filter(memory => !args.types || args.types.includes(memory.type))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function searchOrbMemories(args: {
  userId?: number;
  anonymousSessionId?: string;
  query: string;
  limit?: number;
}): OrbMemory[] {
  const q = args.query.trim().toLowerCase();
  if (!q) return [];
  return getRecentOrbMemories({ userId: args.userId, anonymousSessionId: args.anonymousSessionId, limit: args.limit ?? 50 })
    .filter(memory =>
      memory.summary.toLowerCase().includes(q) ||
      memory.tags.some(tag => tag.toLowerCase().includes(q)) ||
      memory.type.toLowerCase().includes(q)
    )
    .slice(0, Math.max(1, Math.min(args.limit ?? 20, 50)));
}

export function summarizeOrbMemoriesForPlanner(args: {
  userId?: number;
  anonymousSessionId?: string;
  limit?: number;
}): string {
  const memories = getRecentOrbMemories({
    userId: args.userId,
    anonymousSessionId: args.anonymousSessionId,
    limit: Math.min(args.limit ?? 10, 10),
  });

  const failed = memories.filter(memory => memory.type === "failed_workflow");
  const successful = memories.filter(memory => memory.type === "successful_workflow");
  const toolFailures = memories.filter(memory => memory.type === "tool_feedback" && memory.summary.toLowerCase().includes("failed"));

  const repeatedFailedSummary = failed.length >= 2
    ? "Self-optimization hint: avoid repeating identical failed workflow; prefer alternate model/page/workflow."
    : undefined;
  const repeatedSuccessSummary = successful.length >= 2
    ? "Self-optimization hint: similar successful workflows may be prioritized."
    : undefined;
  const toolReliability = toolFailures.length >= 2
    ? "Tool reliability hint: one or more tools have high failure frequency; require confirmation or fallback."
    : undefined;

  return JSON.stringify({
    memoryCount: memories.length,
    recent: JSON.parse(summarizeRecentMemoryForPlanner(memories)),
    hints: [repeatedFailedSummary, repeatedSuccessSummary, toolReliability].filter(Boolean),
  });
}

export function deleteOrbMemory(memoryId: string, owner: { userId?: number; anonymousSessionId?: string }): boolean {
  const idx = store.findIndex(memory => memory.memoryId === memoryId && isOwner(memory, owner.userId, owner.anonymousSessionId));
  if (idx < 0) return false;
  store.splice(idx, 1);
  return true;
}

export function clearOrbMemoryForUser(owner: { userId?: number; anonymousSessionId?: string }): number {
  const before = store.length;
  for (let i = store.length - 1; i >= 0; i -= 1) {
    if (isOwner(store[i], owner.userId, owner.anonymousSessionId)) store.splice(i, 1);
  }
  return before - store.length;
}

export function __unsafe_clearAllOrbMemoryForTests() {
  store.splice(0, store.length);
}

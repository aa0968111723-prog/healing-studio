import {
  OrbMemorySchema,
  type OrbMemory,
  type OrbMemoryType,
  containsSensitiveText,
  sanitizeMemoryMetadata,
  sanitizeMemoryText,
  summarizeRecentMemoryForPlanner,
} from "../../shared/orb-memory";
import { queryRagMemory as retrieveFromRag, upsertMemory as storeToRag } from "./ragMemory";

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
  if (input.userId) {
    void storeToRag({
      userId: input.userId,
      generationId: Date.now(),
      prompt: summary,
      generationType: input.type,
      resultSummary: input.source,
      vibeCardIds: input.tags ?? [],
    });
  }
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
  types?: OrbMemoryType[];
}): OrbMemory[] {
  const q = args.query.trim().toLowerCase();
  if (!q) return [];
  return getRecentOrbMemories({
    userId: args.userId,
    anonymousSessionId: args.anonymousSessionId,
    limit: args.limit ?? 50,
    types: args.types,
  })
    .filter(memory =>
      memory.summary.toLowerCase().includes(q) ||
      memory.tags.some(tag => tag.toLowerCase().includes(q)) ||
      memory.type.toLowerCase().includes(q)
    )
    .slice(0, Math.max(1, Math.min(args.limit ?? 20, 50)));
}

export async function searchOrbMemoriesWithRag(args: {
  userId?: number;
  anonymousSessionId?: string;
  query: string;
  limit?: number;
  degradeOnError?: boolean;
  types?: OrbMemoryType[];
}): Promise<OrbMemory[]> {
  const limit = args.limit ?? 10;
  const typeSet = args.types && args.types.length > 0 ? new Set(args.types) : null;
  let ragResults: OrbMemory[] = [];
  try {
    ragResults = await retrieveFromRag({
      query: args.query,
      userId: args.userId,
      limit,
    });
  } catch (err) {
    if (args.degradeOnError === false) throw err;
    console.warn("[orbMemory] RAG fallback failed (degrading to keyword-only):", err);
  }

  if (typeSet) {
    ragResults = ragResults.filter(m => typeSet.has(m.type));
  }

  const keywordResults = searchOrbMemories(args);
  const seen = new Set(ragResults.map(m => m.memoryId));
  const merged = [...ragResults];
  for (const m of keywordResults) {
    if (seen.has(m.memoryId)) continue;
    seen.add(m.memoryId);
    merged.push(m);
  }
  return merged.slice(0, limit);
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

export async function buildOrbMemorySummaryForPlanner(args: {
  userId?: number;
  anonymousSessionId?: string;
  query: string;
  limit?: number;
  types?: OrbMemoryType[];
}): Promise<{ summary: string; memoryInjected: boolean }> {
  const lessonTypes: OrbMemoryType[] =
    args.types ?? ["failed_workflow", "prompt_pattern", "tool_feedback"];
  try {
    const memories = await searchOrbMemoriesWithRag({
      userId: args.userId,
      anonymousSessionId: args.anonymousSessionId,
      query: args.query,
      limit: Math.min(args.limit ?? 10, 10),
      degradeOnError: false,
      types: lessonTypes,
    });
    if (memories.length > 0) {
      const failedCount = memories.filter(m => m.type === "failed_workflow").length;
      const lessonHint =
        failedCount >= 1
          ? `⚠️ 過往同類請求曾失敗 ${failedCount} 次，請選擇替代模型 / 工具鏈，並向使用者說明繞道原因。`
          : undefined;
      return {
        summary: JSON.stringify({
          memoryCount: memories.length,
          recent: JSON.parse(summarizeRecentMemoryForPlanner(memories)),
          source: "rag+keyword",
          lessonHint,
        }),
        memoryInjected: true,
      };
    }
    return {
      summary: summarizeOrbMemoriesForPlanner({
        userId: args.userId,
        anonymousSessionId: args.anonymousSessionId,
        limit: args.limit,
      }),
      memoryInjected: true,
    };
  } catch (error) {
    console.warn("[orbMemory] failed to build planner memory summary:", error);
    return {
      summary: "memory unavailable",
      memoryInjected: false,
    };
  }
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

/**
 * Clear only memories whose `type` is in the given set. Used by the memory
 * dashboard's per-category clear (e.g. "forget my style preferences"
 * without wiping successful workflows / model picks).
 */
export function clearOrbMemoryByType(
  owner: { userId?: number; anonymousSessionId?: string },
  types: OrbMemoryType[]
): number {
  if (types.length === 0) return 0;
  const typeSet = new Set(types);
  const before = store.length;
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const m = store[i];
    if (!isOwner(m, owner.userId, owner.anonymousSessionId)) continue;
    if (typeSet.has(m.type)) store.splice(i, 1);
  }
  return before - store.length;
}

/**
 * Filter-and-rewrite a single memory's metadata in place — used to surgically
 * remove one specific style/platform/output value from a memory without
 * dropping the whole row. Returns the number of metadata entries actually
 * removed across all matching memories.
 */
export function removeMetadataValue(
  owner: { userId?: number; anonymousSessionId?: string },
  metadataKey: "styles" | "platforms" | "outputs" | "models",
  value: string
): number {
  const target = value.trim();
  if (!target) return 0;
  let removed = 0;
  for (const memory of store) {
    if (!isOwner(memory, owner.userId, owner.anonymousSessionId)) continue;
    const meta = memory.metadata as Record<string, unknown>;
    const current = meta?.[metadataKey];
    if (!Array.isArray(current)) continue;
    const filtered = current.filter(v => typeof v !== "string" || v !== target);
    if (filtered.length !== current.length) {
      meta[metadataKey] = filtered;
      removed += current.length - filtered.length;
    }
    // Also strip matching prefixed tag (e.g. `style:電影感`)
    const tagPrefix =
      metadataKey === "styles"
        ? "style:"
        : metadataKey === "platforms"
        ? "platform:"
        : metadataKey === "outputs"
        ? "output:"
        : "model:";
    const fullTag = `${tagPrefix}${target}`;
    const tagIdx = memory.tags.indexOf(fullTag);
    if (tagIdx >= 0) {
      memory.tags.splice(tagIdx, 1);
    }
  }
  return removed;
}

export function __unsafe_clearAllOrbMemoryForTests() {
  store.splice(0, store.length);
}

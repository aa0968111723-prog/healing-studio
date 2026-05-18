/**
 * server/services/modelResearcher.ts
 *
 * 自動研究 + 事實查核：替每個 AI 模型透過 Perplexity Deep Search 取得最新
 * 定價、基準分數、近期更新與引用來源，並寫入 in-memory store 供前端 tRPC
 * 查詢。
 *
 * 設計重點：
 *   1. 以 shared/aiModelsCatalog.ts 的 baseline 為起點，**不覆蓋 baseline 欄位**
 *      （name / strengths / limitations 等是人工策展，事實穩定）。
 *   2. 自動研究只會更新 enrichment 欄位：pricing / benchmarks / latestUpdates /
 *      availability / factCheck。
 *   3. 多源備援：Perplexity Native → OpenRouter Sonar → Brave。失敗時保留
 *      baseline 並把 factCheck.status 設為 "error"。
 *   4. 節流：每個模型的搜尋透過 checkPerplexityThrottle("auto_research") 限制。
 *   5. 結構化 JSON 輸出：強制 response_format=json_object，再 Zod 驗證一次，
 *      避免幻覺欄位寫進 store。
 *   6. In-memory store 在程序內存活；cron 重啟後重跑即可，無需 DB schema。
 */

import { z } from "zod";
import {
  AI_MODELS_CATALOG,
  FACT_CHECK_STALE_DAYS,
  type AIModelEntry,
  type EnrichedAIModelEntry,
  type FactCheckMeta,
  type FactCheckSource,
  type ModelPricing,
  type ModelProvider,
  type BenchmarkScore,
  type ModelUpdate,
  type ModelAvailability,
  type PricingTier,
  mergeEnrichment,
  computeFactCheckStatus,
} from "../../shared/aiModelsCatalog";
import {
  checkPerplexityThrottle,
  recordPerplexityCall,
} from "./perplexityThrottle";
import { serverEnv } from "../_core/env.validated";
import { logger } from "../_core/logger";

// ─── Types & constants ─────────────────────────────────────────────────────

const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const SEARCH_TIMEOUT_MS = 30_000;
const MAX_SOURCES = 6;
const MAX_BENCHMARKS = 6;
const MAX_UPDATES = 5;

// ─── In-memory enrichment store ────────────────────────────────────────────

interface EnrichmentRecord {
  modelId: string;
  pricing?: ModelPricing;
  benchmarks?: BenchmarkScore[];
  latestUpdates?: ModelUpdate[];
  availability?: ModelAvailability;
  factCheck: FactCheckMeta;
}

const enrichmentStore = new Map<string, EnrichmentRecord>();

// ─── Discovery store ───────────────────────────────────────────────────────
// 「發現」是 cron 在每次研究循環中找到的：新模型、新論文、或既有模型的重大更新。
// 政策：研究的主要任務是 *發現*，而非反覆 re-validate。

export type DiscoveryKind = "new-model" | "new-paper" | "model-update";

export interface ModelDiscovery {
  /** Stable hash id so the UI can dedupe / track */
  id: string;
  kind: DiscoveryKind;
  title: string;
  summary: string;
  url: string;
  /** ISO date 或 YYYY-MM 字串（事件本身的發布日） */
  date: string;
  /** ISO timestamp — discovery 寫入 store 的時間 */
  discoveredAt: string;
  provider?: ModelProvider | string;
  modality?: string;
  /** 如果這個 discovery 對應到 catalog 中的既有模型，這裡是該 id */
  affectedModelId?: string;
  /** 給管理員的建議 catalog id（new-model 才有） */
  suggestedId?: string;
  /** 來源 LLM provider 標籤 */
  source?: string;
}

const MAX_DISCOVERIES = 40;
const discoveryStore: ModelDiscovery[] = [];

interface DiscoveryRunStats {
  lastRunAt?: string;
  lastRunDurationMs?: number;
  lastRunCount: number;
  lastRunError?: string;
  totalRunsCompleted: number;
}

const discoveryStats: DiscoveryRunStats = {
  lastRunCount: 0,
  totalRunsCompleted: 0,
};

interface ResearchRunStats {
  lastRunAt?: string;
  lastRunDurationMs?: number;
  lastRunModelsTried: number;
  lastRunModelsSucceeded: number;
  lastRunErrors: string[];
  totalRunsCompleted: number;
  currentRunStartedAt?: string;
}

const stats: ResearchRunStats = {
  lastRunModelsTried: 0,
  lastRunModelsSucceeded: 0,
  lastRunErrors: [],
  totalRunsCompleted: 0,
};

let activeRunPromise: Promise<ResearchRunResult> | null = null;

// ─── Zod schemas for structured LLM output ─────────────────────────────────

const pricingTierEnum = z.enum([
  "free",
  "low",
  "medium",
  "high",
  "premium",
  "self-host",
]);

const pricingSchema = z
  .object({
    inputPerMillion: z.string().optional(),
    outputPerMillion: z.string().optional(),
    unit: z.string(),
    note: z.string().optional(),
    tier: pricingTierEnum,
  })
  .optional();

const benchmarkSchema = z.object({
  name: z.string().min(1).max(60),
  score: z.string().min(1).max(40),
  rank: z.string().max(40).optional(),
  sourceUrl: z.string().url().optional(),
});

const updateSchema = z.object({
  date: z.string().min(4).max(24),
  summary: z.string().min(4).max(280),
  url: z.string().url().optional(),
});

const sourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url(),
  snippet: z.string().max(400).optional(),
});

const availabilitySchema = z
  .object({
    api: z.boolean(),
    web: z.boolean(),
    selfHost: z.boolean(),
    notes: z.string().max(280).optional(),
  })
  .optional();

const researchPayloadSchema = z.object({
  /** 自動研究是否認為這個模型在 baseline 中標示的事實仍然成立 */
  factsStillValid: z.boolean(),
  /** 如果不成立，這裡列出觀察到的差異 */
  discrepancyNotes: z.string().max(400).optional(),
  pricing: pricingSchema,
  benchmarks: z.array(benchmarkSchema).max(MAX_BENCHMARKS).optional(),
  latestUpdates: z.array(updateSchema).max(MAX_UPDATES).optional(),
  availability: availabilitySchema,
  /** 引用來源（必填，否則視為 fact-check 失敗） */
  sources: z.array(sourceSchema).min(1).max(MAX_SOURCES),
  /** 一句話總結這個模型「現在」的狀態 */
  summary: z.string().max(400).optional(),
});

type ResearchPayload = z.infer<typeof researchPayloadSchema>;

// ─── Public API ────────────────────────────────────────────────────────────

export interface ResearchOneOptions {
  /** 若為 false（預設），24h 內已查核過的模型會直接回傳上次結果，不重新呼叫 LLM */
  force?: boolean;
  userId?: number | null;
}

export interface ResearchRunResult {
  modelsTried: number;
  modelsSucceeded: number;
  errors: Array<{ modelId: string; reason: string }>;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
}

/**
 * 已成功驗證的模型在 30 天內不會重複呼叫 LLM。
 *
 * 政策變更（2026-05）：原本 24 小時就重抓，造成每天 64 個模型全部重跑 Perplexity，
 * 一旦節流或 API key 暫時失效就會集體 fall through 成「驗證失敗」。新政策：
 *   - 驗證成功 → 30 天內視為健康，不再呼叫 LLM
 *   - 驗證失敗 → 7 天內也不再 retry（FAILURE_BACKOFF_MS）
 *   - 真正觸發 re-validate 的訊號是 discovery 找到「該模型有更新」
 */
const RECENT_SUCCESS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 7 * 24 * 60 * 60 * 1000;

/** 檢查兩個搜尋提供者的 API key 是否至少有一個設定。 */
function getConfiguredProviders(): { perplexity: boolean; openrouter: boolean } {
  const perp = (
    serverEnv.PERPLEXITY_API_KEY ??
    process.env.PERPLEXITY_API_KEY ??
    ""
  ).trim();
  const openrouter = (
    (serverEnv as Record<string, string | undefined>).OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    ""
  ).trim();
  return { perplexity: Boolean(perp), openrouter: Boolean(openrouter) };
}

/** 取得目前 in-memory store 中所有 enriched models（合併 baseline + enrichment）。 */
export function getEnrichedCatalog(): EnrichedAIModelEntry[] {
  const now = new Date();
  return AI_MODELS_CATALOG.map(base => {
    const enrichment = enrichmentStore.get(base.id);
    const merged = enrichment
      ? mergeEnrichment(base, {
          pricing: enrichment.pricing,
          benchmarks: enrichment.benchmarks,
          latestUpdates: enrichment.latestUpdates,
          availability: enrichment.availability,
          factCheck: enrichment.factCheck,
        })
      : base;
    const factCheck = merged.factCheck ?? { status: "pending", sources: [] };
    return {
      ...merged,
      factCheck: {
        ...factCheck,
        status: computeFactCheckStatus(factCheck, now),
      },
    } as EnrichedAIModelEntry;
  });
}

export function getEnrichedModel(modelId: string): EnrichedAIModelEntry | null {
  const base = AI_MODELS_CATALOG.find(m => m.id === modelId);
  if (!base) return null;
  const enrichment = enrichmentStore.get(modelId);
  const merged = enrichment
    ? mergeEnrichment(base, {
        pricing: enrichment.pricing,
        benchmarks: enrichment.benchmarks,
        latestUpdates: enrichment.latestUpdates,
        availability: enrichment.availability,
        factCheck: enrichment.factCheck,
      })
    : base;
  const factCheck = merged.factCheck ?? { status: "pending", sources: [] };
  return {
    ...merged,
    factCheck: {
      ...factCheck,
      status: computeFactCheckStatus(factCheck),
    },
  } as EnrichedAIModelEntry;
}

export function getResearchStats(): ResearchRunStats & { coverage: number } {
  const coverage = AI_MODELS_CATALOG.length
    ? enrichmentStore.size / AI_MODELS_CATALOG.length
    : 0;
  return { ...stats, coverage };
}

// ─── Discovery: 找新模型 / 新論文 / 既有模型的更新 ─────────────────────────

const discoveryItemSchema = z.object({
  kind: z.enum(["new-model", "new-paper", "model-update"]),
  title: z.string().min(2).max(180),
  summary: z.string().min(8).max(360),
  url: z.string().url(),
  date: z.string().min(4).max(24),
  provider: z.string().max(60).optional(),
  modality: z.string().max(40).optional(),
  /** 如果是 model-update 或對應到 catalog 內模型，這裡是該 id（候選）。 */
  affectedModelId: z.string().max(120).optional(),
  /** new-model 時，給 admin 的建議 catalog id。 */
  suggestedId: z.string().max(120).optional(),
});

const discoveryPayloadSchema = z.object({
  items: z.array(discoveryItemSchema).max(30),
});

type DiscoveryPayload = z.infer<typeof discoveryPayloadSchema>;
type DiscoveryItem = z.infer<typeof discoveryItemSchema>;

export interface DiscoveryRunResult {
  found: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export function getDiscoveries(limit = 20): {
  items: ModelDiscovery[];
  stats: DiscoveryRunStats;
} {
  const items = [...discoveryStore]
    .sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt))
    .slice(0, Math.max(1, Math.min(MAX_DISCOVERIES, limit)));
  return { items, stats: { ...discoveryStats } };
}

/**
 * 執行一次「研究 = 發現」。問 Perplexity 過去 7 天有什麼新模型 / 新論文 /
 * 既有模型重大更新，回傳結構化清單並寫進 discoveryStore。
 *
 * 注意：本流程**不會**動 enrichmentStore — 它只負責「找到值得人類看的新東西」。
 * 如果發現對應到 catalog 內的既有模型，會把那一筆 affectedModelId 帶上來，
 * 由呼叫端（cron）決定要不要 trigger 該模型的 re-validate。
 */
export async function discoverNewAIReleases(
  options: { userId?: number | null; days?: number; minItems?: number } = {}
): Promise<DiscoveryRunResult> {
  const providers = getConfiguredProviders();
  const startedAt = new Date().toISOString();
  const start = Date.now();

  if (!providers.perplexity && !providers.openrouter) {
    const reason =
      "PERPLEXITY_API_KEY 與 OPENROUTER_API_KEY 都未設定，無法執行發現";
    discoveryStats.lastRunAt = startedAt;
    discoveryStats.lastRunDurationMs = 0;
    discoveryStats.lastRunCount = 0;
    discoveryStats.lastRunError = reason;
    discoveryStats.totalRunsCompleted += 1;
    return {
      found: 0,
      durationMs: 0,
      startedAt,
      finishedAt: startedAt,
      error: reason,
    };
  }

  const throttle = checkPerplexityThrottle({
    feature: "web_search",
    userId: options.userId ?? null,
  });
  if (!throttle.allowed) {
    const reason = `Throttled: ${throttle.reason ?? "unknown"}`;
    discoveryStats.lastRunAt = startedAt;
    discoveryStats.lastRunDurationMs = 0;
    discoveryStats.lastRunCount = 0;
    discoveryStats.lastRunError = reason;
    discoveryStats.totalRunsCompleted += 1;
    return {
      found: 0,
      durationMs: 0,
      startedAt,
      finishedAt: startedAt,
      error: reason,
    };
  }

  const days = Math.max(1, Math.min(30, options.days ?? 7));
  const query = buildDiscoveryPrompt(days);

  let payload: DiscoveryPayload | null = null;
  let providerUsed: string | null = null;
  const errors: string[] = [];

  try {
    payload = await callPerplexityDiscovery(query);
    if (payload) providerUsed = "perplexity-native";
  } catch (err) {
    errors.push(`perplexity-native: ${(err as Error).message}`);
  }

  if (!payload) {
    try {
      payload = await callOpenRouterDiscovery(query);
      if (payload) providerUsed = "openrouter-sonar";
    } catch (err) {
      errors.push(`openrouter-sonar: ${(err as Error).message}`);
    }
  }

  if (!payload || !providerUsed) {
    const reason = errors.join(" | ") || "All discovery providers failed";
    discoveryStats.lastRunAt = new Date().toISOString();
    discoveryStats.lastRunDurationMs = Date.now() - start;
    discoveryStats.lastRunCount = 0;
    discoveryStats.lastRunError = reason;
    discoveryStats.totalRunsCompleted += 1;
    logger.warn("[modelResearcher] discovery failed", { reason });
    return {
      found: 0,
      durationMs: Date.now() - start,
      startedAt,
      finishedAt: new Date().toISOString(),
      error: reason,
    };
  }

  recordPerplexityCall({
    feature: "web_search",
    userId: options.userId ?? null,
  });

  // Merge items into discoveryStore (dedupe by url)
  const seenUrls = new Set(discoveryStore.map(d => d.url));
  const knownIds = new Set(AI_MODELS_CATALOG.map(m => m.id));
  const nowIso = new Date().toISOString();
  let added = 0;

  for (const item of payload.items) {
    if (seenUrls.has(item.url)) continue;
    // If LLM suggested an affectedModelId, ensure it matches the catalog
    const affected =
      item.affectedModelId && knownIds.has(item.affectedModelId)
        ? item.affectedModelId
        : matchCatalogModel(item.title, item.provider);
    const discovery: ModelDiscovery = {
      id: hashDiscoveryId(item),
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      url: item.url,
      date: item.date,
      discoveredAt: nowIso,
      provider: item.provider,
      modality: item.modality,
      affectedModelId: affected,
      suggestedId:
        item.kind === "new-model" ? sanitizeSuggestedId(item.suggestedId, item.title) : undefined,
      source: providerUsed,
    };
    discoveryStore.unshift(discovery);
    seenUrls.add(item.url);
    added += 1;

    // If this is a model-update for a known model, mark it stale so the next
    // refresh-stale run picks it up. This is the *only* signal that should
    // trigger re-validation of an already-verified model.
    if (discovery.kind === "model-update" && discovery.affectedModelId) {
      flagModelStale(discovery.affectedModelId, `discovery: ${item.title}`);
    }
  }

  // Cap store size
  if (discoveryStore.length > MAX_DISCOVERIES) {
    discoveryStore.length = MAX_DISCOVERIES;
  }

  const durationMs = Date.now() - start;
  discoveryStats.lastRunAt = new Date().toISOString();
  discoveryStats.lastRunDurationMs = durationMs;
  discoveryStats.lastRunCount = added;
  discoveryStats.lastRunError = undefined;
  discoveryStats.totalRunsCompleted += 1;

  logger.info("[modelResearcher] discovery complete", {
    found: added,
    durationMs,
    provider: providerUsed,
  });

  return {
    found: added,
    durationMs,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

/** 針對單一模型執行自動研究（呼叫 Perplexity 取得最新事實 + 來源）。 */
export async function researchAndFactCheckModel(
  modelId: string,
  options: ResearchOneOptions = {}
): Promise<{
  ok: boolean;
  model?: EnrichedAIModelEntry;
  reason?: string;
}> {
  const base = AI_MODELS_CATALOG.find(m => m.id === modelId);
  if (!base) {
    return { ok: false, reason: `Unknown model id: ${modelId}` };
  }

  // ── Skip if recently checked & not forced ──
  if (!options.force) {
    const existing = enrichmentStore.get(modelId);
    const checkedAt = existing?.factCheck.checkedAt;
    if (existing && checkedAt) {
      const ageMs = Date.now() - new Date(checkedAt).getTime();
      // Verified models: 30-day cache window
      if (existing.factCheck.status !== "error" && ageMs < RECENT_SUCCESS_WINDOW_MS) {
        return { ok: true, model: getEnrichedModel(modelId) ?? undefined };
      }
      // Failed models: 7-day backoff so we don't retry every cron tick
      if (existing.factCheck.status === "error" && ageMs < FAILURE_BACKOFF_MS) {
        return {
          ok: false,
          reason: `Recent failure within backoff window (${Math.round(ageMs / 86_400_000)}d)`,
        };
      }
    }
  }

  // ── Throttle ──
  const throttle = checkPerplexityThrottle({
    feature: "web_search",
    userId: options.userId ?? null,
  });
  if (!throttle.allowed) {
    logger.warn("[modelResearcher] throttled", {
      modelId,
      reason: throttle.reason,
    });
    storeError(modelId, `Throttled: ${throttle.reason ?? "unknown"}`);
    return { ok: false, reason: `Throttled: ${throttle.reason ?? "unknown"}` };
  }

  // ── Build the research prompt ──
  const query = buildResearchPrompt(base);

  // ── Try providers in order ──
  let payload: ResearchPayload | null = null;
  let providerUsed: string | null = null;
  const providerErrors: string[] = [];

  try {
    const native = await callPerplexity(query);
    if (native) {
      payload = native;
      providerUsed = "perplexity-native";
    }
  } catch (err) {
    const msg = `perplexity-native: ${(err as Error).message}`;
    providerErrors.push(msg);
    logger.warn("[modelResearcher] perplexity native failed", {
      modelId,
      err: msg,
    });
  }

  if (!payload) {
    try {
      const sonar = await callOpenRouterSonar(query);
      if (sonar) {
        payload = sonar;
        providerUsed = "openrouter-sonar";
      }
    } catch (err) {
      const msg = `openrouter-sonar: ${(err as Error).message}`;
      providerErrors.push(msg);
      logger.warn("[modelResearcher] openrouter sonar failed", {
        modelId,
        err: msg,
      });
    }
  }

  if (!payload || !providerUsed) {
    const reason =
      providerErrors.length > 0
        ? providerErrors.join(" | ")
        : "All research providers failed";
    storeError(modelId, reason);
    return { ok: false, reason };
  }

  recordPerplexityCall({
    feature: "web_search",
    userId: options.userId ?? null,
  });

  // ── Persist enrichment ──
  const factCheck: FactCheckMeta = {
    status: "auto-checked",
    checkedAt: new Date().toISOString(),
    provider: providerUsed,
    sources: payload.sources.slice(0, MAX_SOURCES).map(s => ({
      title: s.title,
      url: s.url,
      snippet: s.snippet,
      domain: safeDomain(s.url),
    })),
    notes: payload.discrepancyNotes ?? payload.summary,
    hasDiscrepancy: payload.factsStillValid === false,
  };

  enrichmentStore.set(modelId, {
    modelId,
    pricing: payload.pricing ?? base.pricing,
    benchmarks:
      payload.benchmarks && payload.benchmarks.length > 0
        ? payload.benchmarks.slice(0, MAX_BENCHMARKS)
        : base.benchmarks,
    latestUpdates:
      payload.latestUpdates && payload.latestUpdates.length > 0
        ? payload.latestUpdates.slice(0, MAX_UPDATES)
        : base.latestUpdates,
    availability: payload.availability ?? base.availability,
    factCheck,
  });

  return { ok: true, model: getEnrichedModel(modelId) ?? undefined };
}

/** 對整個 catalog 執行自動研究。同時間最多一個 run，重複呼叫會 await 既有 run。 */
export async function researchAndFactCheckAllModels(
  options: {
    force?: boolean;
    concurrency?: number;
    userId?: number | null;
  } = {}
): Promise<ResearchRunResult> {
  if (activeRunPromise) {
    logger.info("[modelResearcher] Run already active, awaiting it");
    return activeRunPromise;
  }

  const providers = getConfiguredProviders();
  if (!providers.perplexity && !providers.openrouter) {
    const reason =
      "PERPLEXITY_API_KEY 與 OPENROUTER_API_KEY 都未設定，無法執行自動研究";
    logger.warn("[modelResearcher] aborting bulk run", { reason });
    const nowIso = new Date().toISOString();
    stats.lastRunAt = nowIso;
    stats.lastRunDurationMs = 0;
    stats.lastRunErrors = [reason];
    stats.lastRunModelsTried = 0;
    stats.lastRunModelsSucceeded = 0;
    stats.totalRunsCompleted += 1;
    return {
      modelsTried: 0,
      modelsSucceeded: 0,
      errors: [{ modelId: "*", reason }],
      durationMs: 0,
      startedAt: nowIso,
      finishedAt: nowIso,
    };
  }

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  const promise = (async () => {
    const started = Date.now();
    stats.currentRunStartedAt = new Date(started).toISOString();
    stats.lastRunErrors = [];
    stats.lastRunModelsTried = 0;
    stats.lastRunModelsSucceeded = 0;

    const errors: ResearchRunResult["errors"] = [];
    const queue = [...AI_MODELS_CATALOG.map(m => m.id)];
    const workers: Promise<void>[] = [];

    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        stats.lastRunModelsTried += 1;
        try {
          const result = await researchAndFactCheckModel(id, {
            force: options.force,
            userId: options.userId,
          });
          if (result.ok) {
            stats.lastRunModelsSucceeded += 1;
          } else {
            errors.push({ modelId: id, reason: result.reason ?? "unknown" });
          }
        } catch (err) {
          errors.push({
            modelId: id,
            reason: (err as Error).message ?? "exception",
          });
        }
      }
    };

    for (let i = 0; i < concurrency; i += 1) workers.push(worker());
    await Promise.all(workers);

    const finished = Date.now();
    stats.lastRunAt = new Date(finished).toISOString();
    stats.lastRunDurationMs = finished - started;
    stats.lastRunErrors = errors.map(e => `${e.modelId}: ${e.reason}`);
    stats.totalRunsCompleted += 1;
    stats.currentRunStartedAt = undefined;

    logger.info("[modelResearcher] Run complete", {
      tried: stats.lastRunModelsTried,
      succeeded: stats.lastRunModelsSucceeded,
      durationMs: stats.lastRunDurationMs,
    });

    return {
      modelsTried: stats.lastRunModelsTried,
      modelsSucceeded: stats.lastRunModelsSucceeded,
      errors,
      durationMs: finished - started,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
    };
  })();

  activeRunPromise = promise;
  try {
    return await promise;
  } finally {
    activeRunPromise = null;
  }
}

/**
 * 只查核狀態為 stale / pending / error 的模型 — 用於日常維護。
 * 比 researchAndFactCheckAllModels 便宜很多，不會碰已驗證的條目。
 */
export async function researchAndFactCheckStaleModels(
  options: {
    concurrency?: number;
    userId?: number | null;
  } = {}
): Promise<ResearchRunResult> {
  if (activeRunPromise) {
    logger.info("[modelResearcher] Run already active, awaiting it");
    return activeRunPromise;
  }

  const providers = getConfiguredProviders();
  if (!providers.perplexity && !providers.openrouter) {
    const reason =
      "PERPLEXITY_API_KEY 與 OPENROUTER_API_KEY 都未設定，無法執行自動研究";
    logger.warn("[modelResearcher] aborting stale-only run", { reason });
    const nowIso = new Date().toISOString();
    stats.lastRunAt = nowIso;
    stats.lastRunDurationMs = 0;
    stats.lastRunErrors = [reason];
    stats.lastRunModelsTried = 0;
    stats.lastRunModelsSucceeded = 0;
    stats.totalRunsCompleted += 1;
    return {
      modelsTried: 0,
      modelsSucceeded: 0,
      errors: [{ modelId: "*", reason }],
      durationMs: 0,
      startedAt: nowIso,
      finishedAt: nowIso,
    };
  }

  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  const promise = (async () => {
    const started = Date.now();
    stats.currentRunStartedAt = new Date(started).toISOString();
    stats.lastRunErrors = [];
    stats.lastRunModelsTried = 0;
    stats.lastRunModelsSucceeded = 0;

    const errors: ResearchRunResult["errors"] = [];
    const now = new Date();
    // 篩出 stale / pending / error — verified 與 auto-checked 視為健康跳過
    const queue = AI_MODELS_CATALOG.filter(base => {
      const enrichment = enrichmentStore.get(base.id);
      const factCheck = enrichment?.factCheck ?? base.factCheck ?? {
        status: "pending" as const,
        sources: [],
      };
      const status = computeFactCheckStatus(factCheck, now);
      return status === "stale" || status === "pending" || status === "error";
    }).map(m => m.id);

    logger.info("[modelResearcher] Stale-only queue prepared", {
      total: AI_MODELS_CATALOG.length,
      stale: queue.length,
    });

    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        stats.lastRunModelsTried += 1;
        try {
          // force=true so 24h cache 跳過 stale 不影響重新查核
          const result = await researchAndFactCheckModel(id, {
            force: true,
            userId: options.userId,
          });
          if (result.ok) {
            stats.lastRunModelsSucceeded += 1;
          } else {
            errors.push({ modelId: id, reason: result.reason ?? "unknown" });
          }
        } catch (err) {
          errors.push({
            modelId: id,
            reason: (err as Error).message ?? "exception",
          });
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i += 1) workers.push(worker());
    await Promise.all(workers);

    const finished = Date.now();
    stats.lastRunAt = new Date(finished).toISOString();
    stats.lastRunDurationMs = finished - started;
    stats.lastRunErrors = errors.map(e => `${e.modelId}: ${e.reason}`);
    stats.totalRunsCompleted += 1;
    stats.currentRunStartedAt = undefined;

    logger.info("[modelResearcher] Stale-only run complete", {
      tried: stats.lastRunModelsTried,
      succeeded: stats.lastRunModelsSucceeded,
      durationMs: stats.lastRunDurationMs,
    });

    return {
      modelsTried: stats.lastRunModelsTried,
      modelsSucceeded: stats.lastRunModelsSucceeded,
      errors,
      durationMs: finished - started,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
    };
  })();

  activeRunPromise = promise;
  try {
    return await promise;
  } finally {
    activeRunPromise = null;
  }
}

// ─── Internals ─────────────────────────────────────────────────────────────

/**
 * 把模型標記為 stale，讓下一次 refresh-stale 重新查證。
 * 用於 discovery 找到「該模型有更新」時 — 這是少數會主動讓既有驗證失效的情境。
 */
function flagModelStale(modelId: string, reason: string): void {
  const base = AI_MODELS_CATALOG.find(m => m.id === modelId);
  if (!base) return;
  const existing = enrichmentStore.get(modelId);
  const previousFactCheck = existing?.factCheck ?? base.factCheck;
  // 把 checkedAt 推到很久以前 → computeFactCheckStatus 會視為 stale，
  // 既不擦掉現有來源，也讓下一次 refresh-stale 自動納入。
  const stalePast = new Date(
    Date.now() - (FACT_CHECK_STALE_DAYS + 1) * 24 * 60 * 60 * 1000
  ).toISOString();
  enrichmentStore.set(modelId, {
    modelId,
    pricing: existing?.pricing ?? base.pricing,
    benchmarks: existing?.benchmarks ?? base.benchmarks,
    latestUpdates: existing?.latestUpdates ?? base.latestUpdates,
    availability: existing?.availability ?? base.availability,
    factCheck: {
      ...previousFactCheck,
      status: previousFactCheck?.status ?? "pending",
      checkedAt: stalePast,
      sources: previousFactCheck?.sources ?? [],
      notes: `${previousFactCheck?.notes ? previousFactCheck.notes + " | " : ""}${reason}`,
    },
  });
  logger.info("[modelResearcher] flagged stale via discovery", {
    modelId,
    reason,
  });
}

function buildDiscoveryPrompt(days: number): string {
  const knownProviders = Array.from(
    new Set(AI_MODELS_CATALOG.map(m => m.provider))
  ).join(", ");
  const knownModelLines = AI_MODELS_CATALOG.slice(0, 80)
    .map(m => `${m.id} (${m.name})`)
    .join("; ");
  return [
    `你是 AI 模型情報分析師。請使用 web search 找出過去 ${days} 天內：`,
    `  (a) 新發表 / 新公開可用的 AI 模型（任何模態：文字、圖像、影片、音訊、嵌入向量、多模態）`,
    `  (b) 重要的 AI 研究論文（arXiv / NeurIPS / ICLR / ICML / OpenReview）— 著重影響業界產品的`,
    `  (c) catalog 中既有模型的重大更新（價格變動、新版本、停用、功能升級）`,
    "",
    `已知 catalog 廠商：${knownProviders}`,
    `已知 catalog 模型（節錄）：${knownModelLines}`,
    "",
    "回傳「**只有一個合法 JSON 物件**」，schema 如下：",
    `{
  "items": [
    {
      "kind": "new-model" | "new-paper" | "model-update",
      "title": string,            // 模型名 / 論文標題 / 更新標題
      "summary": string,          // 1-3 句中文摘要，說明意義
      "url": string,              // 真實官方 / arXiv / 部落格連結
      "date": "YYYY-MM-DD" | "YYYY-MM",  // 事件發生日
      "provider": string?,        // 廠商或機構（new-model / model-update 必填）
      "modality": string?,        // 模態，如 text / image / video / audio / multimodal
      "affectedModelId": string?, // model-update 時填上面 catalog 中對應的 id
      "suggestedId": string?      // new-model 時，建議的 catalog id（小寫連字號）
    }
  ]
}`,
    "",
    "硬性規則：",
    "1. 至少回 3 項、最多 20 項。寧缺勿濫，不要硬塞陳年舊聞。",
    `2. date 必須在過去 ${days} 天內或剛好過期一兩天可接受；超過的請略過。`,
    "3. 不要編造 URL — 全部要是搜尋過程中實際看到的。",
    "4. summary 用繁體中文，控制在 360 字內。",
    "5. 不要包 markdown code fence。",
    "6. kind=model-update 時，affectedModelId 必須是上面 catalog 列表裡的 id。",
  ].join("\n");
}

async function callPerplexityDiscovery(
  query: string
): Promise<DiscoveryPayload | null> {
  const apiKey = (
    serverEnv.PERPLEXITY_API_KEY ??
    process.env.PERPLEXITY_API_KEY ??
    ""
  ).trim();
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY 未設定");

  const res = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content:
            "You are an AI industry intelligence analyst. Reply ONLY with the requested JSON object. Use Traditional Chinese summaries. Cite real URLs only.",
        },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2600,
      temperature: 0.25,
      search_recency_filter: "week",
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseDiscoveryPayload(content);
}

async function callOpenRouterDiscovery(
  query: string
): Promise<DiscoveryPayload | null> {
  const apiKey = (
    (serverEnv as Record<string, string | undefined>).OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    ""
  ).trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 未設定");

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://director.today",
      "X-Title": "AI Director Model Discoverer",
    },
    body: JSON.stringify({
      model: "perplexity/sonar",
      messages: [
        {
          role: "system",
          content:
            "You are an AI industry intelligence analyst. Reply ONLY with the JSON object the user describes.",
        },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2600,
      temperature: 0.25,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseDiscoveryPayload(content);
}

function parseDiscoveryPayload(raw: string): DiscoveryPayload {
  if (!raw) throw new Error("empty discovery payload");
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("discovery response did not contain JSON");
    json = JSON.parse(match[0]);
  }
  // Some models return a bare array — tolerate that
  if (Array.isArray(json)) json = { items: json };
  const parsed = discoveryPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") || "(root)";
    throw new Error(
      `discovery schema failed at ${path}: ${first?.message ?? "unknown"}`
    );
  }
  return parsed.data;
}

function matchCatalogModel(
  title: string,
  provider?: string
): string | undefined {
  const t = title.toLowerCase();
  const p = provider?.toLowerCase();
  for (const m of AI_MODELS_CATALOG) {
    const name = m.name.toLowerCase();
    const id = m.id.toLowerCase();
    const prov = m.provider.toLowerCase();
    // Title must contain the model's name OR id; if provider was given, it must match too.
    if (t.includes(name) || t.includes(id)) {
      if (!p || prov.includes(p) || p.includes(prov)) return m.id;
    }
  }
  return undefined;
}

function sanitizeSuggestedId(
  suggested: string | undefined,
  title: string
): string {
  const candidate = (suggested && suggested.trim().length > 0
    ? suggested
    : title
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return candidate || "candidate";
}

function hashDiscoveryId(item: DiscoveryItem): string {
  // Stable, short, deterministic id from kind + url + date
  const raw = `${item.kind}|${item.url}|${item.date}`;
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return `disc_${Math.abs(h).toString(36)}`;
}

function storeError(modelId: string, reason: string): void {
  const base = AI_MODELS_CATALOG.find(m => m.id === modelId);
  if (!base) return;
  const existing = enrichmentStore.get(modelId);
  enrichmentStore.set(modelId, {
    modelId,
    pricing: existing?.pricing ?? base.pricing,
    benchmarks: existing?.benchmarks ?? base.benchmarks,
    latestUpdates: existing?.latestUpdates ?? base.latestUpdates,
    availability: existing?.availability ?? base.availability,
    factCheck: {
      status: "error",
      checkedAt: new Date().toISOString(),
      sources: existing?.factCheck.sources ?? [],
      notes: reason,
    },
  });
}

function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function buildResearchPrompt(base: AIModelEntry): string {
  const keywords = (base.researchKeywords ?? []).join(" / ");
  return [
    `你是一位 AI 模型情報研究員。請使用 web search 查證「${base.name}」（廠商：${base.provider}，模態：${base.modality}）的最新公開資訊。`,
    `已知的 baseline 描述：「${base.tagline}」。`,
    keywords ? `建議搜尋關鍵字：${keywords}` : "",
    "",
    "請回傳「**只有一個合法 JSON 物件**」，schema 如下：",
    `{
  "factsStillValid": boolean,   // baseline 中的事實是否仍然成立
  "discrepancyNotes": string?,   // 若不成立，列出觀察到的差異（中文）
  "pricing": {
    "inputPerMillion": string?,  // 例如 "$3" — 若非 token 計費則省略
    "outputPerMillion": string?,
    "unit": string,              // 必填，例如 "USD / 1M tokens" 或 "USD / image"
    "note": string?,
    "tier": "free" | "low" | "medium" | "high" | "premium" | "self-host"
  }?,
  "benchmarks": [                // 主要公開 benchmark
    { "name": string, "score": string, "rank": string?, "sourceUrl": string? }
  ]?,
  "latestUpdates": [             // 過去 90 天的重要更新
    { "date": "YYYY-MM" | "YYYY-MM-DD", "summary": string, "url": string? }
  ]?,
  "availability": { "api": boolean, "web": boolean, "selfHost": boolean, "notes": string? }?,
  "sources": [                   // 必填，至少 1 個、最多 ${MAX_SOURCES} 個真實 URL
    { "title": string, "url": string, "snippet": string? }
  ],
  "summary": string?             // 一句中文總結這個模型目前的狀態
}`,
    "",
    "硬性規則：",
    "1. **不要編造 URL** — 所有 sources[].url 必須是搜尋過程中實際看到的網頁。",
    "2. **discrepancyNotes** 只在事實確實有差異時填寫，例如「定價已調整」「已釋出新版本」。",
    "3. 中文欄位（discrepancyNotes、summary、latestUpdates.summary、pricing.note）使用繁體中文。",
    "4. 若搜不到可靠資訊，回 sources 至少一個官方頁面 URL，並把 factsStillValid 設為 true、其他欄位留空。",
    "5. 不要包 markdown code fence。",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callPerplexity(query: string): Promise<ResearchPayload | null> {
  const apiKey = (
    serverEnv.PERPLEXITY_API_KEY ??
    process.env.PERPLEXITY_API_KEY ??
    ""
  ).trim();
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY 未設定");

  const res = await fetch(PERPLEXITY_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content:
            "You are an AI model intelligence researcher. Reply ONLY with the requested JSON object. Use Traditional Chinese for descriptive fields. Cite real URLs only.",
        },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2200,
      temperature: 0.2,
      search_recency_filter: "month",
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
    search_results?: Array<{ url?: string; title?: string; snippet?: string }>;
  };

  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseResearchPayload(content);

  // 若 model 沒填 sources，補進 citations / search_results
  if (parsed.sources.length === 0) {
    const fallback = (data.search_results ?? [])
      .filter(r => r.url)
      .slice(0, MAX_SOURCES)
      .map(r => ({
        title: r.title ?? r.url ?? "source",
        url: r.url!,
        snippet: r.snippet,
      }));
    parsed.sources = fallback;
  }
  return parsed;
}

async function callOpenRouterSonar(
  query: string
): Promise<ResearchPayload | null> {
  const apiKey = (
    (serverEnv as Record<string, string | undefined>).OPENROUTER_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    ""
  ).trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY 未設定");

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://director.today",
      "X-Title": "AI Director Model Researcher",
    },
    body: JSON.stringify({
      model: "perplexity/sonar",
      messages: [
        {
          role: "system",
          content:
            "You are an AI model intelligence researcher. Reply ONLY with the JSON object the user describes.",
        },
        { role: "user", content: query },
      ],
      response_format: { type: "json_object" },
      max_tokens: 2200,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseResearchPayload(content);
}


function parseResearchPayload(raw: string): ResearchPayload {
  if (!raw) throw new Error("empty response payload");
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    // Try to extract the first {...} block — some models prepend prose
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("response did not contain JSON");
    try {
      json = JSON.parse(match[0]);
    } catch (err) {
      throw new Error(`JSON parse failed: ${(err as Error).message}`);
    }
  }

  const parsed = researchPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join(".") || "(root)";
    logger.warn("[modelResearcher] payload failed schema validation", {
      issues: parsed.error.issues.slice(0, 4),
    });
    throw new Error(`schema validation failed at ${path}: ${first?.message ?? "unknown"}`);
  }

  // Normalize benchmarks (cap counts)
  const out = parsed.data;
  if (out.benchmarks) out.benchmarks = out.benchmarks.slice(0, MAX_BENCHMARKS);
  if (out.latestUpdates)
    out.latestUpdates = out.latestUpdates.slice(0, MAX_UPDATES);
  if (out.sources) out.sources = out.sources.slice(0, MAX_SOURCES);
  return out;
}

// ─── Test hooks ────────────────────────────────────────────────────────────

/** Reset the in-memory store (used by tests + admin tools). */
export function __resetEnrichmentStore(): void {
  enrichmentStore.clear();
  stats.lastRunAt = undefined;
  stats.lastRunDurationMs = undefined;
  stats.lastRunModelsTried = 0;
  stats.lastRunModelsSucceeded = 0;
  stats.lastRunErrors = [];
  stats.totalRunsCompleted = 0;
  stats.currentRunStartedAt = undefined;
  discoveryStore.length = 0;
  discoveryStats.lastRunAt = undefined;
  discoveryStats.lastRunDurationMs = undefined;
  discoveryStats.lastRunCount = 0;
  discoveryStats.lastRunError = undefined;
  discoveryStats.totalRunsCompleted = 0;
}

/** Seed a discovery directly (used by tests + admin curation). */
export function __seedDiscovery(d: ModelDiscovery): void {
  discoveryStore.unshift(d);
  if (discoveryStore.length > MAX_DISCOVERIES) {
    discoveryStore.length = MAX_DISCOVERIES;
  }
}

/** Seed the store with a synthetic enrichment record (used by tests). */
export function __seedEnrichment(record: EnrichmentRecord): void {
  enrichmentStore.set(record.modelId, record);
}

/** Inject a ResearchPayload as if from a real provider (used by tests). */
export function __ingestPayloadForTest(
  modelId: string,
  payload: ResearchPayload,
  provider = "test"
): void {
  const base = AI_MODELS_CATALOG.find(m => m.id === modelId);
  if (!base) return;
  enrichmentStore.set(modelId, {
    modelId,
    pricing: payload.pricing ?? base.pricing,
    benchmarks: payload.benchmarks ?? base.benchmarks,
    latestUpdates: payload.latestUpdates ?? base.latestUpdates,
    availability: payload.availability ?? base.availability,
    factCheck: {
      status: "auto-checked",
      checkedAt: new Date().toISOString(),
      provider,
      sources: payload.sources.map(s => ({
        ...s,
        domain: safeDomain(s.url),
      })),
      notes: payload.discrepancyNotes ?? payload.summary,
      hasDiscrepancy: !payload.factsStillValid,
    },
  });
}

export type {
  EnrichmentRecord,
  ResearchPayload,
  ResearchRunStats,
  PricingTier,
  DiscoveryPayload,
  DiscoveryRunStats,
};

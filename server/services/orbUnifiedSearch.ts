/**
 * orbUnifiedSearch.ts — 全站光球代理的統一搜尋。
 *
 * 把使用者一句「找我之前做的森林圖」變成跨四大來源的搜尋：
 *   1. 數位資產（assets）— 標題／描述／提示詞
 *   2. 專案筆記（notes）— 標題／內容
 *   3. 生成歷史（history）— prompt 文字
 *   4. 學習中心（learn hub）— 標題／摘要
 *
 * 全部串完後依匹配強度排序，回傳一份可直接渲染為跳轉卡片的清單。
 * 跨來源搜尋故意保持輕量（in-memory filter）— 任何單一來源若失敗都吞掉，
 * 避免一個 DB 表壞掉就讓整個光球搜尋體驗崩潰。
 */

import * as db from "../db";
import { cache } from "../_core/cache";
import { logger } from "../_core/logger";
import { getLearnHubOrbIndex } from "./siteKnowledge";
import type { UnifiedSearchKind } from "../../shared/orb-search-intent";

export type { UnifiedSearchKind };

/**
 * Per-source soft budget. If any single source (assets / notes / history /
 * tutorials) blows past this, we log it and treat that source as empty so
 * the overall endpoint still returns within roughly this budget. Tutorials
 * are pure in-memory so they almost never hit this; the bound is for DB-backed
 * sources whose tail latency can spike on cold caches or table locks.
 */
const DEFAULT_SOURCE_BUDGET_MS = 4_000;

/**
 * Maximum rows we read from the per-user asset / note / history tables before
 * scoring. Power users can have thousands of rows; loading all of them per
 * search keystroke ballooned RAM + GC. We cap at a number that's comfortably
 * larger than `perTypeLimit` so the per-source `byScoreDesc` sort still has
 * room to pick the strongest hit.
 */
const SOURCE_FETCH_CAP = 200;

/**
 * TTL for the in-memory result cache. Short by design — its job is to absorb
 * React strict-mode double-fires + back-to-back identical queries, NOT to
 * mask DB write latency. Long enough that two requests within a panel render
 * collapse to one; short enough that the user immediately sees newly-saved
 * assets after a few seconds.
 */
const RESULT_CACHE_TTL_SECONDS = 10;

export interface UnifiedSearchResultItem {
  kind: UnifiedSearchKind;
  /** Stable identifier within its kind. Used for React keys + click telemetry. */
  id: string;
  title: string;
  /** 1–2 sentence excerpt (≤ 160 chars). */
  snippet: string;
  /** Path the orb should navigate to when the user clicks the card. */
  path: string;
  /** Optional small badge (e.g. asset type, note type, tutorial category). */
  badge?: string;
  /** Created / updated timestamp in ms. Used for "最近 7 天" filtering + sort tie-break. */
  at?: number;
  /** 0..1 score — higher means stronger match. */
  score: number;
  /**
   * Asset / history rows can carry a thumbnail URL — surfacing it in the
   * search card lets the user spot the right item without hovering. Notes /
   * tutorials don't have thumbnails so this is optional.
   */
  thumbnailUrl?: string;
  /**
   * For images / videos, the modality (image / video / audio / voice) so
   * the card can pick the right placeholder when thumbnailUrl is missing.
   */
  modality?: "image" | "video" | "audio" | "voice" | "script" | "zip_bundle";
}

export interface UnifiedSearchInput {
  userId: number;
  query: string;
  types?: UnifiedSearchKind[];
  /** Cap per-type results before merging. Default 5. */
  perTypeLimit?: number;
  /** Total result cap. Default 12. */
  totalLimit?: number;
}

const DEFAULT_PER_TYPE = 5;
const DEFAULT_TOTAL = 12;

function clip(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * Score a free-text match. Pure + deterministic so unit tests can pin
 * behavior without the DB.
 *
 * Layers (each adds to the score, capped at 1.0):
 *   - Exact substring in title (1.0) > body (0.55)
 *   - Per-token overlap (0.15 / token, capped at 0.45)
 *   - Fuzzy near-miss in title for typos: bigram overlap ≥ 0.7 → +0.3
 *   - Inverse-document weighting for rare tokens (a 6-char token gets
 *     more weight than a 2-char token) — keeps "森林" boosting strongly
 *     while "的" doesn't.
 *
 * Recency boost is applied later, in `orbUnifiedSearch`, since it depends
 * on item createdAt which scoreMatch doesn't see.
 */
export function scoreMatch(query: string, title: string, body: string): number {
  if (!query) return 0;
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = title.toLowerCase();
  const b = body.toLowerCase();

  let score = 0;
  if (t.includes(q)) score += 1.0;
  else if (b.includes(q)) score += 0.55;

  // Per-token overlap with rare-token weighting. Tokens of length ≥ 4 get
  // more credit than 2-char ones — common short particles shouldn't dominate.
  const qTokens = q
    .split(/[\s,，、。\-_/()（）]+/)
    .filter(tok => tok.length >= 2);
  if (qTokens.length > 0) {
    let tokenBonus = 0;
    for (const tok of qTokens) {
      const inT = t.includes(tok);
      const inB = b.includes(tok);
      if (!inT && !inB) continue;
      const lenWeight = Math.min(0.18, 0.06 + tok.length * 0.02);
      tokenBonus += inT ? lenWeight : lenWeight * 0.6;
    }
    score += Math.min(0.45, tokenBonus);
  }

  // Bigram fuzzy match for typos / character drops in the title.
  // "forest moring" should still hit "Forest Morning Haze".
  if (!t.includes(q) && q.length >= 4 && t.length > 0) {
    const sim = bigramSimilarity(q, t);
    if (sim >= 0.7) score += 0.3;
    else if (sim >= 0.55) score += 0.15;
  }

  return Math.min(score, 1);
}

/**
 * Sørensen–Dice bigram similarity. Cheap, works for both Chinese (every
 * character pair is a bigram) and English (alphabet bigrams). Returns
 * 0..1 — 1 means identical.
 */
export function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const pair = s.slice(i, i + 2);
      m.set(pair, (m.get(pair) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  if (ma.size === 0 || mb.size === 0) return 0;
  let intersect = 0;
  for (const [pair, countA] of ma) {
    const countB = mb.get(pair) ?? 0;
    intersect += Math.min(countA, countB);
  }
  return (2 * intersect) / (a.length + b.length - 2);
}

/**
 * Recency multiplier. Items created in the last 7 days score 1.2×; older
 * items decay smoothly toward 0.9×. Keeps fresh assets at the top without
 * burying genuinely-relevant older content.
 */
export function recencyMultiplier(at: number | undefined, now: number = Date.now()): number {
  if (!at) return 1;
  const ageDays = Math.max(0, (now - at) / (24 * 60 * 60 * 1000));
  if (ageDays <= 7) return 1.2;
  if (ageDays <= 30) return 1.05;
  if (ageDays <= 90) return 1.0;
  return 0.9;
}

interface AssetRow {
  id: number;
  title: string;
  description?: string | null;
  promptUsed?: string | null;
  assetType?: string | null;
  thumbnailUrl?: string | null;
  fileUrl?: string | null;
  createdAt?: Date | string | number | null;
}

interface NoteRow {
  id: number;
  title: string;
  content?: string | null;
  noteType?: string | null;
  createdAt?: Date | string | number | null;
}

interface HistoryRow {
  id: number;
  prompt?: string | null;
  modality?: string | null;
  modelId?: string | null;
  thumbnailUrl?: string | null;
  resultUrl?: string | null;
  createdAt?: Date | string | number | null;
}

type AssetModality = NonNullable<UnifiedSearchResultItem["modality"]>;
function coerceModality(v: string | null | undefined): AssetModality | undefined {
  if (!v) return undefined;
  switch (v) {
    case "image":
    case "video":
    case "audio":
    case "voice":
    case "script":
    case "zip_bundle":
      return v;
    default:
      return undefined;
  }
}

function toMs(v: Date | string | number | null | undefined): number | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function logSourceFailure(
  source: UnifiedSearchKind,
  userId: number,
  err: unknown
): void {
  // We swallow per-source errors so a single broken table doesn't crash the
  // whole search, but we MUST log them — silent `catch { return [] }` was
  // the source of multiple "search just shows nothing forever" bug reports.
  const message = err instanceof Error ? err.message : String(err);
  logger.warn("[orbUnifiedSearch] source failed; treating as empty", {
    source,
    userId,
    error: message,
  });
}

async function searchAssets(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getDigitalAssetsByUser(userId, SOURCE_FETCH_CAP)) as unknown as AssetRow[];
    const out: UnifiedSearchResultItem[] = [];
    for (const row of all) {
      const body = `${row.description ?? ""}\n${row.promptUsed ?? ""}`;
      const score = scoreMatch(query, row.title, body);
      if (score <= 0) continue;
      out.push({
        kind: "asset",
        id: `asset-${row.id}`,
        title: clip(row.title, 80) || `素材 #${row.id}`,
        snippet: clip(row.description || row.promptUsed, 160),
        path: `/assets?focusAssetId=${row.id}`,
        badge: row.assetType ?? undefined,
        at: toMs(row.createdAt),
        score,
        ...(row.thumbnailUrl
          ? { thumbnailUrl: row.thumbnailUrl }
          : row.fileUrl && row.assetType === "image"
          ? { thumbnailUrl: row.fileUrl }
          : {}),
        modality: coerceModality(row.assetType),
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch (err) {
    logSourceFailure("asset", userId, err);
    return [];
  }
}

async function searchNotes(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getProjectNotesByUser(userId, SOURCE_FETCH_CAP)) as unknown as NoteRow[];
    const out: UnifiedSearchResultItem[] = [];
    for (const row of all) {
      const body = row.content ?? "";
      const score = scoreMatch(query, row.title, body);
      if (score <= 0) continue;
      out.push({
        kind: "note",
        id: `note-${row.id}`,
        title: clip(row.title, 80) || `筆記 #${row.id}`,
        snippet: clip(body, 160),
        path: `/notes?focusNoteId=${row.id}`,
        badge: row.noteType ?? "note",
        at: toMs(row.createdAt),
        score,
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch (err) {
    logSourceFailure("note", userId, err);
    return [];
  }
}

async function searchHistory(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getHistoryByUser(userId, SOURCE_FETCH_CAP)) as unknown as HistoryRow[];
    const out: UnifiedSearchResultItem[] = [];
    for (const row of all) {
      const promptText = row.prompt ?? "";
      const score = scoreMatch(query, promptText.slice(0, 40), promptText);
      if (score <= 0) continue;
      out.push({
        kind: "history",
        id: `history-${row.id}`,
        title: clip(promptText, 64) || `生成 #${row.id}`,
        snippet: clip(promptText, 160),
        path: `/assets?section=history&focusHistoryId=${row.id}`,
        badge: row.modality ?? row.modelId ?? "history",
        at: toMs(row.createdAt),
        score,
        ...(row.thumbnailUrl
          ? { thumbnailUrl: row.thumbnailUrl }
          : row.resultUrl && row.modality === "image"
          ? { thumbnailUrl: row.resultUrl }
          : {}),
        modality: coerceModality(row.modality),
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch (err) {
    logSourceFailure("history", userId, err);
    return [];
  }
}

function searchTutorials(
  query: string,
  perTypeLimit: number
): UnifiedSearchResultItem[] {
  try {
    const docs = getLearnHubOrbIndex(60);
    const out: UnifiedSearchResultItem[] = [];
    for (const doc of docs) {
      const score = scoreMatch(query, doc.title, doc.summary);
      if (score <= 0) continue;
      out.push({
        kind: "tutorial",
        id: `tutorial-${doc.id}`,
        title: clip(doc.title, 80),
        snippet: clip(doc.summary, 160),
        path: `/learn?docId=${encodeURIComponent(doc.id)}`,
        badge: doc.category,
        score,
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch (err) {
    logSourceFailure("tutorial", 0, err);
    return [];
  }
}

function byScoreDesc(a: UnifiedSearchResultItem, b: UnifiedSearchResultItem): number {
  if (a.score !== b.score) return b.score - a.score;
  // Tie-break: newer first.
  return (b.at ?? 0) - (a.at ?? 0);
}

/**
 * Re-order a score-sorted list so the result set covers every kind that
 * has at least one strong hit before piling on multiples from the
 * highest-scoring kind. Greedy round-robin: take the top item from each
 * kind in score order, then loop. Preserves stable ordering within a kind.
 *
 * Rationale: when the user searches "forest" and they have 80 forest
 * assets but also 1 brilliant forest note, the note should still surface
 * in the first 6 results — otherwise the orb feels asset-only.
 */
export function diversifyByKind(
  items: UnifiedSearchResultItem[],
  totalLimit: number
): UnifiedSearchResultItem[] {
  if (items.length <= totalLimit) return items;
  const buckets = new Map<UnifiedSearchKind, UnifiedSearchResultItem[]>();
  for (const item of items) {
    const list = buckets.get(item.kind) ?? [];
    list.push(item);
    buckets.set(item.kind, list);
  }
  // Order kinds by their best score so the strongest hit still leads.
  const orderedKinds = Array.from(buckets.entries())
    .sort((a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0))
    .map(([k]) => k);

  const out: UnifiedSearchResultItem[] = [];
  let round = 0;
  while (out.length < totalLimit) {
    let added = false;
    for (const kind of orderedKinds) {
      if (out.length >= totalLimit) break;
      const list = buckets.get(kind);
      if (list && list.length > round) {
        out.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

export interface OrbUnifiedSearchOptions extends UnifiedSearchInput {
  /**
   * When set, every result with `at >= recencyBoostFromMs` gets the
   * recency multiplier applied. Defaults to "any time" (multiplier
   * still applies; older items just stay at 0.9×).
   */
  recencyBoostFromMs?: number;
  /** Override "now" for deterministic tests. */
  now?: number;
  /**
   * Per-source soft budget (ms). When a single source (assets / notes /
   * history / tutorials) blows past this, it's logged and treated as
   * empty so a stuck table can't drag the whole search down. Default
   * `DEFAULT_SOURCE_BUDGET_MS`.
   */
  sourceBudgetMs?: number;
  /** When true, bypass the in-process result cache. Defaults to false. */
  bypassCache?: boolean;
}

/**
 * Race a per-source promise against a wall-clock budget. On timeout we log
 * + resolve to `[]` rather than rejecting, so `Promise.allSettled` doesn't
 * see a bogus "rejection" for a benignly-slow table; the slow source just
 * shows up as missing this round.
 */
function withSourceTimeout<T>(
  source: UnifiedSearchKind,
  userId: number,
  budgetMs: number,
  inner: Promise<T[]>
): Promise<T[]> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timedOut = new Promise<T[]>(resolve => {
    timer = setTimeout(() => {
      logger.warn("[orbUnifiedSearch] source timed out; treating as empty", {
        source,
        userId,
        budgetMs,
      });
      resolve([] as T[]);
    }, budgetMs);
    if (timer.unref) timer.unref();
  });
  return Promise.race([inner, timedOut]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Build a deterministic cache key for `(user, query, types, limits)`. Keep
 * the kind set canonicalized (sorted) so `["note","asset"]` and
 * `["asset","note"]` collapse to the same key.
 */
function buildResultCacheKey(input: OrbUnifiedSearchOptions): string {
  const kinds = (input.types ?? ["asset", "note", "history", "tutorial"])
    .slice()
    .sort()
    .join(",");
  const perType = input.perTypeLimit ?? DEFAULT_PER_TYPE;
  const total = input.totalLimit ?? DEFAULT_TOTAL;
  const q = input.query.trim().toLowerCase();
  return `search:orbUnified:u${input.userId}:k${kinds}:p${perType}:t${total}:${q}`;
}

export async function orbUnifiedSearch(
  input: OrbUnifiedSearchOptions
): Promise<UnifiedSearchResultItem[]> {
  const query = input.query.trim();
  if (!query) return [];
  const perTypeLimit = input.perTypeLimit ?? DEFAULT_PER_TYPE;
  const totalLimit = input.totalLimit ?? DEFAULT_TOTAL;
  const now = input.now ?? Date.now();
  const sourceBudgetMs = input.sourceBudgetMs ?? DEFAULT_SOURCE_BUDGET_MS;
  const enabled = new Set<UnifiedSearchKind>(input.types ?? [
    "asset",
    "note",
    "history",
    "tutorial",
  ]);

  const cacheKey = buildResultCacheKey(input);
  if (!input.bypassCache) {
    const cached = await cache.get<UnifiedSearchResultItem[]>(cacheKey);
    if (cached) return cached;
  }

  const tasks: Array<Promise<UnifiedSearchResultItem[]>> = [];
  if (enabled.has("asset")) {
    tasks.push(
      withSourceTimeout(
        "asset",
        input.userId,
        sourceBudgetMs,
        searchAssets(input.userId, query, perTypeLimit)
      )
    );
  }
  if (enabled.has("note")) {
    tasks.push(
      withSourceTimeout(
        "note",
        input.userId,
        sourceBudgetMs,
        searchNotes(input.userId, query, perTypeLimit)
      )
    );
  }
  if (enabled.has("history")) {
    tasks.push(
      withSourceTimeout(
        "history",
        input.userId,
        sourceBudgetMs,
        searchHistory(input.userId, query, perTypeLimit)
      )
    );
  }
  if (enabled.has("tutorial")) {
    tasks.push(Promise.resolve(searchTutorials(query, perTypeLimit)));
  }

  // allSettled: a single source rejecting (somehow bypassing the inner
  // try/catch) must not crash the orchestrator. Each fulfilled value is
  // already an array; rejections become `[]` here so the merged shape stays
  // homogeneous.
  const settled = await Promise.allSettled(tasks);
  const merged: UnifiedSearchResultItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    } else {
      logger.warn("[orbUnifiedSearch] source rejected at orchestrator", {
        userId: input.userId,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  // Apply recency boost. Tutorials don't have createdAt — they get neutral
  // multiplier (1.0). Assets / notes / history all have it.
  for (const item of merged) {
    const mult = recencyMultiplier(item.at, now);
    item.score = Math.min(1, item.score * mult);
  }

  const sorted = merged.sort(byScoreDesc);
  const final = diversifyByKind(sorted, totalLimit);

  if (!input.bypassCache) {
    await cache.set(cacheKey, final, { ttl: RESULT_CACHE_TTL_SECONDS });
  }
  return final;
}

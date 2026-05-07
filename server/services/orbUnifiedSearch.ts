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
import { getLearnHubOrbIndex } from "./siteKnowledge";
import type { UnifiedSearchKind } from "../../shared/orb-search-intent";

export type { UnifiedSearchKind };

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
  createdAt?: Date | string | number | null;
}

function toMs(v: Date | string | number | null | undefined): number | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function searchAssets(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getDigitalAssetsByUser(userId)) as unknown as AssetRow[];
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
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch {
    return [];
  }
}

async function searchNotes(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getProjectNotesByUser(userId)) as unknown as NoteRow[];
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
  } catch {
    return [];
  }
}

async function searchHistory(
  userId: number,
  query: string,
  perTypeLimit: number
): Promise<UnifiedSearchResultItem[]> {
  try {
    const all = (await db.getHistoryByUser(userId, 200)) as unknown as HistoryRow[];
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
      });
    }
    return out.sort(byScoreDesc).slice(0, perTypeLimit);
  } catch {
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
  } catch {
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
}

export async function orbUnifiedSearch(
  input: OrbUnifiedSearchOptions
): Promise<UnifiedSearchResultItem[]> {
  const query = input.query.trim();
  if (!query) return [];
  const perTypeLimit = input.perTypeLimit ?? DEFAULT_PER_TYPE;
  const totalLimit = input.totalLimit ?? DEFAULT_TOTAL;
  const now = input.now ?? Date.now();
  const enabled = new Set<UnifiedSearchKind>(input.types ?? [
    "asset",
    "note",
    "history",
    "tutorial",
  ]);

  const tasks: Array<Promise<UnifiedSearchResultItem[]>> = [];
  if (enabled.has("asset")) tasks.push(searchAssets(input.userId, query, perTypeLimit));
  if (enabled.has("note")) tasks.push(searchNotes(input.userId, query, perTypeLimit));
  if (enabled.has("history")) tasks.push(searchHistory(input.userId, query, perTypeLimit));
  if (enabled.has("tutorial"))
    tasks.push(Promise.resolve(searchTutorials(query, perTypeLimit)));

  const groups = await Promise.all(tasks);
  const merged = groups.flat();

  // Apply recency boost. Tutorials don't have createdAt — they get neutral
  // multiplier (1.0). Assets / notes / history all have it.
  for (const item of merged) {
    const mult = recencyMultiplier(item.at, now);
    item.score = Math.min(1, item.score * mult);
  }

  const sorted = merged.sort(byScoreDesc);
  return diversifyByKind(sorted, totalLimit);
}

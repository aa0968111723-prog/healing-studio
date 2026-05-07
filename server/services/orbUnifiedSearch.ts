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
 * Score a free-text match — exact substring beats word-overlap, and matches
 * inside the title beat matches inside body. Pure function so the unit tests
 * can pin behavior without spinning up the DB.
 */
export function scoreMatch(query: string, title: string, body: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  const b = body.toLowerCase();

  let score = 0;
  if (t.includes(q)) score += 1.0;
  else if (b.includes(q)) score += 0.6;

  // Word-overlap bonus for multi-word queries.
  const qTokens = q.split(/[\s,，、。\-_/]+/).filter(t => t.length >= 2);
  if (qTokens.length > 0) {
    const matched = qTokens.filter(tok => t.includes(tok) || b.includes(tok));
    score += 0.15 * (matched.length / qTokens.length);
  }
  return Math.min(score, 1);
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

export async function orbUnifiedSearch(
  input: UnifiedSearchInput
): Promise<UnifiedSearchResultItem[]> {
  const query = input.query.trim();
  if (!query) return [];
  const perTypeLimit = input.perTypeLimit ?? DEFAULT_PER_TYPE;
  const totalLimit = input.totalLimit ?? DEFAULT_TOTAL;
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
  const merged = groups.flat().sort(byScoreDesc);
  return merged.slice(0, totalLimit);
}

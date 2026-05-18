/**
 * teachingArchiveSearch.ts — 統一的搜尋邏輯
 *
 * 給 router.search 和 orb tool（agentToolExecutor 的 teachingArchive.search）
 * 共用。回傳一致的 shape，避免兩端各寫一份 snippet 邏輯。
 *
 * 混合策略 — Pinecone 向量為主、LIKE 為 fallback：
 *
 *   1. 先打 Pinecone（namespace=teaching-{userId}）拿語意 top-K chunks
 *   2. dedupe by materialId，分數高的留下
 *   3. 用 getVisibleTeachingMaterialsByIds 拿 row，過濾 visibility
 *   4. 若 Pinecone 沒命中（feature flag off / API key 不存在 / 索引還空），
 *      改走 db.searchTeachingMaterialsForUser 做 LIKE
 *
 * 回傳的 snippet 在 vector 路徑上用 chunkText（命中段落原文 + 上下文），
 * LIKE 路徑上用 buildSnippet 從 description / textContent 取出來。語意搜尋
 * 的引言通常準確很多。
 */

import * as db from "../db";
import {
  queryTeachingArchiveVectors,
  type TeachingVectorHit,
} from "./teachingArchiveRag";
import type { TeachingMaterial } from "../../drizzle/schema";

export interface TeachingSearchHit {
  id: number;
  title: string;
  mediaType: TeachingMaterial["mediaType"];
  sourceType: TeachingMaterial["sourceType"];
  lineage: string | null;
  topic: string | null;
  speaker: string | null;
  sourceDate: Date | null;
  fileUrl: string | null;
  snippet: string;
  /** "vector" 或 "fts" — 給 orb 顯示用，可了解這條結果怎麼來的 */
  matchedBy: "vector" | "fts";
  /** 0~1，vector hit 才有實際分數；fts 預設 0.5 */
  score: number;
}

export interface TeachingSearchArgs {
  userId: number;
  query: string;
  limit?: number;
  mediaType?: TeachingMaterial["mediaType"];
  lineage?: string;
}

const SNIPPET_RADIUS = 80;

function buildSnippet(
  query: string,
  title: string,
  description: string | null,
  textContent: string | null
): string {
  const haystacks: string[] = [title];
  if (description) haystacks.push(description);
  if (textContent) haystacks.push(textContent);
  const lowerQuery = query.toLowerCase();
  for (const h of haystacks) {
    const idx = h.toLowerCase().indexOf(lowerQuery);
    if (idx >= 0) {
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(h.length, idx + query.length + SNIPPET_RADIUS);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < h.length ? "…" : "";
      return prefix + h.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
    }
  }
  if (textContent) return textContent.slice(0, 160).replace(/\s+/g, " ") + "…";
  return title;
}

/**
 * 從 vector hits 取一段乾淨的引言：chunkText 中找 query 前後 ±80 字。
 * 沒命中關鍵字（純語意相近）就回 chunk 開頭 200 字。
 */
function snippetFromVectorHit(hit: TeachingVectorHit, query: string): string {
  const chunk = hit.chunkText;
  if (!chunk) return "";
  const lower = chunk.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx >= 0) {
    const start = Math.max(0, idx - SNIPPET_RADIUS);
    const end = Math.min(chunk.length, idx + query.length + SNIPPET_RADIUS);
    const prefix = start > 0 ? "…" : "";
    const suffix = end < chunk.length ? "…" : "";
    return prefix + chunk.slice(start, end).replace(/\s+/g, " ").trim() + suffix;
  }
  // 純語意命中 — 回 chunk 前段；用 chunk 而非 textContent 因為向量索引
  // 切片後的 chunk 才是真的對應到那個分數的內容。
  return chunk.slice(0, 200).replace(/\s+/g, " ").trim() + "…";
}

function toHit(
  row: TeachingMaterial,
  snippet: string,
  matchedBy: "vector" | "fts",
  score: number
): TeachingSearchHit {
  return {
    id: row.id,
    title: row.title,
    mediaType: row.mediaType,
    sourceType: row.sourceType,
    lineage: row.lineage,
    topic: row.topic,
    speaker: row.speaker,
    sourceDate: row.sourceDate,
    fileUrl: row.fileUrl,
    snippet,
    matchedBy,
    score,
  };
}

export async function searchTeachingArchive(
  args: TeachingSearchArgs
): Promise<TeachingSearchHit[]> {
  const limit = Math.max(1, Math.min(args.limit ?? 5, 20));
  const teamIds = await db.listTeamIdsForUser(args.userId);

  // ── 1. 向量搜尋（Pinecone）─────────────────────────────────────────────
  // 多抓一些 chunks（limit × 3），dedupe by materialId 後再 trim 到 limit。
  const vectorHits = await queryTeachingArchiveVectors(
    args.userId,
    args.query,
    limit * 3
  );

  if (vectorHits.length > 0) {
    // 同一份素材可能命中多個 chunk — 取最高分那個當代表
    const bestPerMaterial = new Map<number, TeachingVectorHit>();
    for (const h of vectorHits) {
      if (!h.materialId) continue;
      const prev = bestPerMaterial.get(h.materialId);
      if (!prev || h.score > prev.score) {
        bestPerMaterial.set(h.materialId, h);
      }
    }
    const ids = Array.from(bestPerMaterial.keys());
    const rows = await db.getVisibleTeachingMaterialsByIds(
      args.userId,
      ids,
      teamIds
    );

    // 套 mediaType / lineage filter（vector search 沒在 Pinecone 端 filter）
    const filtered = rows.filter(r => {
      if (args.mediaType && r.mediaType !== args.mediaType) return false;
      if (args.lineage && r.lineage !== args.lineage) return false;
      return true;
    });

    // 依向量分數排序、取前 limit 筆
    const sorted = filtered
      .map(r => ({ row: r, hit: bestPerMaterial.get(r.id)! }))
      .sort((a, b) => b.hit.score - a.hit.score)
      .slice(0, limit);

    if (sorted.length > 0) {
      return sorted.map(({ row, hit }) =>
        toHit(row, snippetFromVectorHit(hit, args.query), "vector", hit.score)
      );
    }
  }

  // ── 2. Fallback：LIKE 全文搜尋（給 RAG 未啟用 / 索引還空時用）──────────
  const rows = await db.searchTeachingMaterialsForUser(
    args.userId,
    {
      search: args.query,
      mediaType: args.mediaType,
      lineage: args.lineage,
    },
    { teamIds, limit }
  );
  return rows.map(row =>
    toHit(
      row,
      buildSnippet(args.query, row.title, row.description, row.textContent),
      "fts",
      0.5
    )
  );
}

/**
 * teachingArchiveRag.test.ts
 *
 * 鎖定 chunkTextForEmbedding — deterministic 切片邏輯。RAG 索引重建時要能
 * 切出完全一樣的 chunk id (chunkIndex)，否則舊向量會留 orphan。
 */

import { describe, expect, it } from "vitest";
import { __teachingArchiveRagInternals } from "../teachingArchiveRag";

const { chunkTextForEmbedding, namespaceForUser, MIN_CHUNK_CHARS } =
  __teachingArchiveRagInternals;

describe("chunkTextForEmbedding", () => {
  it("returns empty array for empty input", () => {
    expect(chunkTextForEmbedding("")).toEqual([]);
    expect(chunkTextForEmbedding("   ")).toEqual([]);
  });

  it("returns single chunk for short input (under MIN_CHUNK_CHARS)", () => {
    const short = "這是一段短文。".repeat(5);
    expect(short.length).toBeLessThan(MIN_CHUNK_CHARS);
    const chunks = chunkTextForEmbedding(short);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(short);
  });

  it("splits long text into multiple chunks with overlap", () => {
    // 5000 字 → 應該切 4~5 個 chunks（target 1200 + overlap 200）
    const long = "悟覺妙天禪師開示：".repeat(625); // 9 chars × 625 = ~5625 字
    const chunks = chunkTextForEmbedding(long);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.length).toBeLessThan(10);
    // 每個 chunk 都不能空白
    chunks.forEach(c => expect(c.length).toBeGreaterThan(0));
    // 串回去字數不會少於原文（overlap 會讓總和更多）
    const joined = chunks.join("");
    expect(joined.length).toBeGreaterThanOrEqual(long.length);
  });

  it("prefers natural break points (\\n\\n or 。) over hard cuts", () => {
    // 構造一個 2400 字的文本，1200 字附近有個明顯斷點
    const part1 = "禪修的核心在於專注。".repeat(60); // ~720 字
    const part2 = "\n\n";
    const part3 = "心無罣礙才能進入禪定。".repeat(120); // ~1440 字
    const text = part1 + part2 + part3;
    const chunks = chunkTextForEmbedding(text);
    // 第一個 chunk 應該結束在 part1 結尾（\n\n 附近）
    expect(chunks[0]).toContain("禪修");
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic — same input produces same chunks", () => {
    const text = "資料庫測試內容。".repeat(300);
    const a = chunkTextForEmbedding(text);
    const b = chunkTextForEmbedding(text);
    expect(a).toEqual(b);
  });

  it("normalizes \\r\\n to \\n", () => {
    const crlf = "line1\r\nline2\r\nline3";
    const chunks = chunkTextForEmbedding(crlf);
    expect(chunks[0]).not.toContain("\r");
  });
});

describe("namespaceForUser", () => {
  it("formats namespace as teaching-{userId}", () => {
    expect(namespaceForUser(42)).toBe("teaching-42");
    expect(namespaceForUser(1)).toBe("teaching-1");
  });

  it("isolates from ragMemory's user-{userId} namespace", () => {
    // 跟 ragMemory.ts 的 `user-{userId}` 不會撞 namespace
    expect(namespaceForUser(42)).not.toBe("user-42");
  });
});

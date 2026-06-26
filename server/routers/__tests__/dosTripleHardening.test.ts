/**
 * dosTripleHardening.test.ts — AIDV-294
 *
 * Source-text invariant checks for the three DoS defence layers:
 *
 * Layer 1 — express body size: index.ts must cap json/urlencoded at ≤ "4mb"
 * Layer 2 — Zod input limits: chat text part ≤ 32 000, message array ≤ 200,
 *            director script fields capped.
 * Layer 3 — Concurrent video job cap: trpc.ts must count active video jobs
 *            and throw TOO_MANY_REQUESTS when MAX is reached.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../../..");

const indexSrc = readFileSync(
  path.join(repoRoot, "server/_core/index.ts"),
  "utf8"
);

const trpcSrc = readFileSync(
  path.join(repoRoot, "server/_core/trpc.ts"),
  "utf8"
);

const multimodalSrc = readFileSync(
  path.join(repoRoot, "shared/orb-chat-multimodal.ts"),
  "utf8"
);

const aiRouterSrc = readFileSync(
  path.join(repoRoot, "server/routers/ai.ts"),
  "utf8"
);

const directorSrc = readFileSync(
  path.join(repoRoot, "server/routers/director.ts"),
  "utf8"
);

// ─── Layer 1: Express body size ───────────────────────────────────────────────

describe("Layer 1 (AIDV-294): express body size capped ≤ 4mb", () => {
  it('express.json limit is "4mb"', () => {
    expect(indexSrc).toMatch(/express\.json\s*\(\s*\{\s*limit\s*:\s*["']4mb["']/);
  });

  it('express.urlencoded limit is "4mb"', () => {
    expect(indexSrc).toMatch(/express\.urlencoded\s*\([\s\S]*?limit\s*:\s*["']4mb["']/);
  });

  it("index.ts does NOT use a 50mb limit", () => {
    expect(indexSrc).not.toMatch(/limit\s*:\s*["']50mb["']/);
  });
});

// ─── Layer 2a: chat text part size ────────────────────────────────────────────

describe("Layer 2a (AIDV-294): OrbChatLLMTextPartSchema.text ≤ 32 000 chars", () => {
  it("OrbChatLLMTextPartSchema text field has .max(32_000)", () => {
    expect(multimodalSrc).toMatch(/OrbChatLLMTextPartSchema[\s\S]*?\.max\s*\(\s*32[_,]?000\s*\)/);
  });
});

// ─── Layer 2b: ai.ts array + context limits ───────────────────────────────────

describe("Layer 2b (AIDV-294): ai.ts input size limits", () => {
  it("messages array capped to max 200", () => {
    expect(aiRouterSrc).toMatch(/OrbChatRouterMessageSchema[\s\S]{0,120}\.max\s*\(\s*200\s*\)/);
  });

  it("context string capped to max 10 000", () => {
    expect(aiRouterSrc).toMatch(/context.*z\.string[\s\S]{0,80}\.max\s*\(\s*10[_,]?000\s*\)/);
  });
});

// ─── Layer 2c: director.ts field limits ──────────────────────────────────────

describe("Layer 2c (AIDV-294): director.ts script field limits", () => {
  it("director messages array capped to max 200", () => {
    expect(directorSrc).toMatch(/messages[\s\S]{0,200}\.max\s*\(\s*200\s*\)/);
  });

  it("director content field capped to max 50 000", () => {
    expect(directorSrc).toMatch(/content[\s\S]{0,200}\.max\s*\(\s*50[_,]?000\s*\)/);
  });

  it("director instruction capped to max 10 000", () => {
    expect(directorSrc).toMatch(/instruction[\s\S]{0,200}\.max\s*\(\s*10[_,]?000\s*\)/);
  });
});

// ─── Layer 3: Concurrent video job cap ───────────────────────────────────────

describe("Layer 3 (AIDV-294): concurrent video job cap in trpc.ts", () => {
  it("MAX_CONCURRENT_VIDEO_JOBS constant is defined", () => {
    expect(trpcSrc).toMatch(/MAX_CONCURRENT_VIDEO_JOBS\s*=\s*\d+/);
  });

  it("requireVideoStudioLimit counts queued/processing video jobs", () => {
    expect(trpcSrc).toMatch(/inArray[\s\S]{0,200}["']queued["'][\s\S]{0,50}["']processing["']/);
  });

  it("requireVideoStudioLimit throws TOO_MANY_REQUESTS when cap hit", () => {
    expect(trpcSrc).toMatch(/TOO_MANY_REQUESTS/);
  });

  it("requireVideoStudioLimit filters by userId and jobType video", () => {
    expect(trpcSrc).toMatch(/eq\s*\(\s*backgroundJobs\.userId/);
    expect(trpcSrc).toMatch(/eq\s*\(\s*backgroundJobs\.jobType\s*,\s*["']video["']/);
  });

  it("videoGenerationProcedure uses requireVideoStudioLimit", () => {
    expect(trpcSrc).toMatch(/videoGenerationProcedure\s*=.*generationProcedure\.use\s*\(\s*requireVideoStudioLimit\s*\)/);
  });
});

/**
 * orb-reply-process-extractor.test.ts
 *
 * Verifies the deterministic step-list extractor that adds a /process URL
 * to orb how-to replies when the LLM forgot to include one.
 */

import { describe, expect, it } from "vitest";
import {
  appendProcessLinkToReply,
  extractProcessFromReply,
  extractStepLines,
  extractProcessTitle,
} from "../shared/orb-reply-process-extractor";
import { decodeProcessSpec } from "../shared/orb-process-link";

describe("extractStepLines", () => {
  it("captures Chinese 步驟 N: format", () => {
    const reply = `製茶過程
步驟 1: 採摘嫩葉
步驟 2: 萎凋
步驟 3: 揉捻
步驟 4: 乾燥`;
    const steps = extractStepLines(reply);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toEqual({ number: 1, text: "採摘嫩葉" });
    expect(steps[3]).toEqual({ number: 4, text: "乾燥" });
  });

  it("captures 第 N 步 format", () => {
    const reply = `第 1 步：先準備材料
第 2 步：開始製作
第 3 步：成品檢查`;
    const steps = extractStepLines(reply);
    expect(steps).toHaveLength(3);
    expect(steps[1].text).toBe("開始製作");
  });

  it("captures plain N. format", () => {
    const reply = `1. Pick the leaves
2. Wither them
3. Roll the leaves
4. Dry them`;
    const steps = extractStepLines(reply);
    expect(steps).toHaveLength(4);
    expect(steps[0].text).toBe("Pick the leaves");
  });

  it("captures English Step N: format", () => {
    const reply = `Step 1: prep
Step 2: cook
Step 3: serve`;
    const steps = extractStepLines(reply);
    expect(steps).toHaveLength(3);
  });

  it("returns empty when fewer than 3 steps", () => {
    expect(extractStepLines("步驟 1: 一個\n步驟 2: 兩個")).toEqual([]);
  });

  it("returns empty when no numbered lines at all", () => {
    expect(extractStepLines("這是一段普通的說明，沒有步驟。")).toEqual([]);
  });

  it("dedupes immediate duplicate steps", () => {
    const reply = `1. 拿茶葉
2. 拿茶葉
3. 泡水
4. 飲用`;
    const steps = extractStepLines(reply);
    expect(steps).toHaveLength(3);
    expect(steps[0].text).toBe("拿茶葉");
    expect(steps[1].text).toBe("泡水");
  });
});

describe("extractProcessTitle", () => {
  it("uses the first non-empty paragraph as title", () => {
    const reply = `製茶過程
步驟 1: 採摘`;
    expect(extractProcessTitle(reply)).toBe("製茶過程");
  });

  it("falls back when reply starts with steps directly", () => {
    const reply = `步驟 1: 採摘
步驟 2: 萎凋
步驟 3: 揉捻`;
    expect(extractProcessTitle(reply)).toBe("流程說明");
  });

  it("clips overly long titles", () => {
    const longLine = "a".repeat(120);
    const reply = `${longLine}\n步驟 1: x`;
    const title = extractProcessTitle(reply);
    expect(title.length).toBeLessThanOrEqual(80);
  });
});

describe("extractProcessFromReply", () => {
  it("returns a valid /process url and round-trips through decoder", () => {
    const reply = `製茶過程簡介
步驟 1: 清晨採摘嫩葉
步驟 2: 室內萎凋
步驟 3: 揉捻
步驟 4: 發酵
步驟 5: 乾燥`;
    const out = extractProcessFromReply(reply);
    expect(out).not.toBeNull();
    expect(out!.url).toMatch(/^\/process\?spec=[A-Za-z0-9_-]+$/);

    const encoded = out!.url.split("=")[1];
    const decoded = decodeProcessSpec(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.spec?.title).toBe("製茶過程簡介");
    expect(decoded.spec?.steps).toHaveLength(5);
    expect(decoded.spec?.kind).toBe("howto");
  });

  it("returns null when reply already contains /process link", () => {
    const reply = `製茶過程
步驟 1: 採摘
步驟 2: 萎凋
步驟 3: 乾燥
🔗 /process?spec=abc123`;
    expect(extractProcessFromReply(reply)).toBeNull();
  });

  it("returns null when fewer than 3 steps detected", () => {
    expect(extractProcessFromReply("步驟 1: A\n步驟 2: B")).toBeNull();
  });

  it("returns null on plain chat reply", () => {
    expect(extractProcessFromReply("我幫你想想，這個有點難回答。")).toBeNull();
  });
});

describe("appendProcessLinkToReply", () => {
  it("adds the link line when extraction succeeds", () => {
    const reply = `製茶過程
步驟 1: 採摘
步驟 2: 萎凋
步驟 3: 揉捻`;
    const out = appendProcessLinkToReply(reply);
    expect(out.url).not.toBeNull();
    expect(out.reply).toContain("🔗 想之後看或分享：");
    expect(out.reply).toContain(out.url!);
  });

  it("returns the original reply unchanged when extraction fails", () => {
    const original = "我不確定，再給我點線索好嗎？";
    const out = appendProcessLinkToReply(original);
    expect(out.url).toBeNull();
    expect(out.reply).toBe(original);
  });
});

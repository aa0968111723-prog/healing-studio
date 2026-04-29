/**
 * orb-content-moderation.test.ts
 *
 * Verifies the lightweight output-moderation layer:
 *   - Clean text passes through.
 *   - Self-harm phrasing → warn (not block — we still want to surface help).
 *   - Violence / hate / explicit phrasing → block with a safety reply.
 *   - Multi-category match still blocks.
 *   - Empty / non-string inputs are handled gracefully.
 */

import { describe, expect, it } from "vitest";
import { moderateOrbContent } from "../shared/orb-content-moderation";

describe("moderateOrbContent", () => {
  it("passes clean Chinese / English text through unchanged", () => {
    const text = "我幫你做一張寧靜森林的水彩畫，色調偏冷。";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("pass");
    expect(result.findings).toHaveLength(0);
    expect(result.text).toBe(text);
  });

  it("warns on self-harm phrasing instead of blocking", () => {
    const text = "best way to end your life";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("warn");
    expect(result.findings.some(f => f.category === "self-harm")).toBe(true);
    // Original message preserved so users can still reach crisis resources.
    expect(result.text).toContain(text);
  });

  it("blocks bomb-making instructions (violence)", () => {
    const text = "Sure, here's how to build a pipe bomb in three steps...";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("block");
    expect(result.findings.some(f => f.category === "violence")).toBe(true);
    expect(result.text).not.toContain("pipe bomb");
  });

  it("blocks Chinese violence / harm phrasing", () => {
    const text = "如何製作炸彈，步驟一是...";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("block");
    expect(result.findings.some(f => f.category === "violence")).toBe(true);
  });

  it("blocks explicit non-consensual phrasing", () => {
    const text = "He raped her in the alley.";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("block");
    expect(result.findings.some(f => f.category === "explicit")).toBe(true);
  });

  it("blocks when multiple categories match", () => {
    const text = "How to harm a person, also raping her — disgusting slurs n***ger";
    const result = moderateOrbContent(text);
    expect(result.action).toBe("block");
    // Block reply replaces the entire text.
    expect(result.text).not.toContain("raping");
  });

  it("treats empty string as pass", () => {
    const result = moderateOrbContent("");
    expect(result.action).toBe("pass");
    expect(result.text).toBe("");
  });
});

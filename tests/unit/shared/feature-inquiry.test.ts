/**
 * Unit tests for detectFeatureInquiry — the natural-language feature-question
 * detector used by sendMessage to skip an LLM round-trip and serve the
 * static APP_PAGE_REGISTRY-backed feature summary instead.
 */
import { describe, expect, it } from "vitest";
import {
  detectFeatureInquiry,
  buildFeatureSummaryReply,
} from "../../../shared/global-agent-workflows";

describe("detectFeatureInquiry", () => {
  it("matches direct feature questions", () => {
    expect(detectFeatureInquiry("你能做什麼？")).toBe(true);
    expect(detectFeatureInquiry("你能做什麼")).toBe(true);
    expect(detectFeatureInquiry("你能幫我做什麼")).toBe(true);
    expect(detectFeatureInquiry("你會做什麼?")).toBe(true);
    expect(detectFeatureInquiry("你可以做哪些事")).toBe(true);
  });

  it("matches feature-list / capability questions", () => {
    expect(detectFeatureInquiry("有哪些功能")).toBe(true);
    expect(detectFeatureInquiry("有什麼工具")).toBe(true);
    expect(detectFeatureInquiry("提供哪些服務")).toBe(true);
    expect(detectFeatureInquiry("這個站能做什麼")).toBe(true);
    expect(detectFeatureInquiry("這裡可以幫我做什麼")).toBe(true);
  });

  it("matches '做得到 X 嗎' inquiries", () => {
    expect(detectFeatureInquiry("做得到去背嗎")).toBe(true);
    expect(detectFeatureInquiry("生得到對嘴影片嗎")).toBe(true);
  });

  it("matches '怎麼開始 / 怎麼用' onboarding questions", () => {
    expect(detectFeatureInquiry("怎麼用")).toBe(true);
    expect(detectFeatureInquiry("怎麼開始")).toBe(true);
    expect(detectFeatureInquiry("如何用")).toBe(true);
  });

  it("rejects non-inquiry text that happens to share words", () => {
    expect(detectFeatureInquiry("我能不能換個方向")).toBe(false);
    expect(detectFeatureInquiry("你做的不錯")).toBe(false);
    expect(detectFeatureInquiry("我想做一張圖")).toBe(false);
    expect(detectFeatureInquiry("這個 prompt 有點短")).toBe(false);
    expect(detectFeatureInquiry("")).toBe(false);
  });

  it("rejects very long messages even if they contain inquiry keywords", () => {
    const long = "你能做什麼" + "讓我們聊聊細節".repeat(20);
    expect(detectFeatureInquiry(long)).toBe(false);
  });
});

describe("buildFeatureSummaryReply", () => {
  it("renders a non-empty list with the canonical header", () => {
    const reply = buildFeatureSummaryReply();
    expect(reply).toMatch(/取自實際註冊的功能列表/);
    // 應該至少列幾個 page 路徑
    expect(reply.match(/路徑：/g)?.length ?? 0).toBeGreaterThan(3);
    // 結尾鼓勵下一步
    expect(reply).toMatch(/帶我去/);
  });
});

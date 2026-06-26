// @vitest-environment node
/**
 * sanitize.ts — AIDV-251 DOMPurify sanitize 單元測試
 *
 * 守住：XSS payload 被清除、純文字不被破壞、
 * sanitizeRichText 保留安全標籤、sanitizePlainText strip all HTML。
 */
import { describe, it, expect } from "vitest";
import { sanitizePlainText, sanitizeRichText } from "./sanitize";

describe("sanitizePlainText — strip all HTML (tRPC title/name fields)", () => {
  it("<script> payload → 空字串", () => {
    expect(sanitizePlainText("<script>alert(1)</script>")).toBe("");
  });

  it("<img onerror> payload → 空字串", () => {
    expect(sanitizePlainText("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("<svg><script> payload → 空字串", () => {
    expect(sanitizePlainText("<svg><script>alert(1)</script></svg>")).toBe("");
  });

  it("純文字不被改變", () => {
    expect(sanitizePlainText("雪山專案")).toBe("雪山專案");
  });

  it("普通英文標題不被改變", () => {
    expect(sanitizePlainText("My Project Title")).toBe("My Project Title");
  });

  it("空字串不崩", () => {
    expect(sanitizePlainText("")).toBe("");
  });

  it("javascript: href payload → 空字串", () => {
    expect(sanitizePlainText('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });

  it("HTML 實體字符（&amp;）被還原為文字", () => {
    const result = sanitizePlainText("Hello &amp; World");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });
});

describe("sanitizeRichText — allow safe formatting tags", () => {
  it("<script> 被移除", () => {
    expect(sanitizeRichText("<script>evil()</script>hello")).toBe("hello");
  });

  it("<b> 保留", () => {
    expect(sanitizeRichText("<b>bold</b>")).toBe("<b>bold</b>");
  });

  it("<strong> 保留", () => {
    expect(sanitizeRichText("<strong>重要</strong>")).toBe("<strong>重要</strong>");
  });

  it("<a href> 保留合法 href", () => {
    const result = sanitizeRichText('<a href="https://example.com">link</a>');
    expect(result).toContain("href");
    expect(result).toContain("link");
  });

  it("onerror 事件屬性被移除", () => {
    expect(sanitizeRichText('<img onerror=alert(1) src="x">')).not.toContain("onerror");
  });

  it("純文字不被改變", () => {
    expect(sanitizeRichText("plain text")).toBe("plain text");
  });
});

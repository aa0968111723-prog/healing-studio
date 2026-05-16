/**
 * errorHumanizer.test.ts
 *
 * 守住「使用者永遠不會在工具錯誤訊息裡看到 ECONNRESET / status 422 /
 * Unable to validate schema 這種裸技術字串」這條不變式。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { humanizeToolError } from "../errorHumanizer";

describe("humanizeToolError", () => {
  // 壓掉 console.warn 雜訊(helper 內部會記原文給工程師)。
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it.each([
    ["Request failed with status 422", "參數"],
    ["Request failed with status code 400", "參數"],
    ["HTTP 401: Unauthorized", "認證"],
    ["403 Forbidden", "認證"],
    ["Request failed with status 404", "找不到"],
    ["429 Too Many Requests", "忙線"],
    ["Rate limit exceeded for model X", "忙線"],
    ["Quota exceeded", "忙線"],
    ["HTTP 502 Bad Gateway", "外部服務"],
    ["Internal Server Error", "外部服務"],
    ["503 Service Unavailable", "外部服務"],
    ["ECONNRESET", "網路"],
    ["ENOTFOUND api.example.com", "網路"],
    ["fetch failed", "網路"],
    ["socket hang up", "網路"],
    ["Request timeout after 30000ms", "逾時"],
    ["Unable to validate schema: input.aspect_ratio must be one of [1:1, 16:9]", "規格"],
    ["Invalid input parameter: prompt", "規格"],
    ["File too large: 50MB exceeds 25MB", "過大"],
    ["Payload too large", "過大"],
    ["Unsupported file format: tiff", "不支援"],
    ["Content policy violation", "安全"],
    ["Prohibited content detected", "安全"],
    ["NSFW content blocked", "安全"],
  ])("「%s」會被翻成中文 (含關鍵字「%s」)", (raw, keyword) => {
    const result = humanizeToolError(new Error(raw));
    expect(result).toContain(keyword);
    // 雙重保險:不洩漏任何 ASCII status 數字 / 英文 keyword
    expect(result).not.toMatch(/ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/);
    expect(result).not.toMatch(/HTTP\s*\d{3}|status\s*\d{3}/i);
    expect(result).not.toMatch(/Unable to validate|fetch failed|socket hang up/i);
  });

  it("未知錯誤走通用 fallback,不是空字串、不是英文", () => {
    const result = humanizeToolError(new Error("Something totally weird happened"));
    expect(result.length).toBeGreaterThan(8);
    expect(result).not.toMatch(/Something totally weird/);
    expect(result).toMatch(/[請稍後再試]/); // 通用 fallback 帶 actionable 詞
  });

  it("非 Error 物件也能處理(string / number / null)", () => {
    expect(humanizeToolError("ECONNRESET")).toContain("網路");
    expect(humanizeToolError(null)).toMatch(/.+/);
    expect(humanizeToolError(undefined)).toMatch(/.+/);
    expect(humanizeToolError(42)).toMatch(/.+/);
  });

  it("帶 context 時會記到 console.warn(工程師除錯用)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = new Error("ECONNRESET");
    humanizeToolError(err, { context: "imageSpecialist.generateImage" });
    expect(warnSpy).toHaveBeenCalledWith(
      "[spiritTools:imageSpecialist.generateImage]",
      err
    );
  });

  it("優先級:content policy 比 HTTP 400 series 先 match", () => {
    // 一個訊息同時帶 422 status 與 content policy 字眼,應該歸 safety,
    // 因為「請改寫描述」比「請調整參數」更貼近實際成因。
    const result = humanizeToolError(
      new Error("Request failed with status 422: Content policy violation")
    );
    expect(result).toContain("安全");
  });
});

// @vitest-environment jsdom
// ============================================================================
// social/socialErrors.test — AIDV-957 回歸守門：使用者文案不得含內部設定/環境變數字樣
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { SOCIAL_COPY_GENERATION_ERROR_MESSAGE, logSocialCopyGenerationError } from "./socialErrors";

describe("AIDV-957: social copy generation error sanitization", () => {
  it("user-facing message contains no internal env-var / adapter tokens", () => {
    const leakTokens = ["COMMANDER_ADAPTER", "VITE_", "=mock", "process.env"];
    for (const token of leakTokens) {
      expect(SOCIAL_COPY_GENERATION_ERROR_MESSAGE).not.toContain(token);
    }
  });

  it("user-facing message is plain-language and actionable", () => {
    expect(SOCIAL_COPY_GENERATION_ERROR_MESSAGE).toContain("稍後再試");
  });

  it("logSocialCopyGenerationError logs to console, not to any user-visible sink", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("COMMANDER_ADAPTER=mock fallback triggered");
    logSocialCopyGenerationError(err);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("AI 出文案失敗"), err);
    spy.mockRestore();
  });
});

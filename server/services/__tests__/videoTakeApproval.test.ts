/**
 * videoTakeApproval.test.ts — AIDV-16 take 核准 HMAC 憑證鏈單元守門
 *
 * 錨定「草稿 → 核准 → 精修」capability token 鏈的不可偽造性：
 * 綁 userId、綁 takeId、核准憑證帶時效、竄改即失效。
 */
import { describe, it, expect } from "vitest";
import {
  mintDraftTake,
  verifyDraftTakeToken,
  issueTakeApprovalToken,
  verifyTakeApprovalToken,
  isRecentRefineSubmit,
  markRefineSubmit,
  TAKE_APPROVAL_TOKEN_TTL_MS,
  REFINE_IDEMPOTENCY_WINDOW_MS,
} from "../videoTakeApproval";

describe("draft token（草稿身分）", () => {
  it("mint 出的 takeId＋draftToken 對同一 user 驗證通過", () => {
    const { takeId, draftToken } = mintDraftTake(7);
    expect(takeId.startsWith("take_")).toBe(true);
    expect(verifyDraftTakeToken(takeId, 7, draftToken)).toBe(true);
  });

  it("跨使用者 / 換 takeId / 竄改 token 一律失效", () => {
    const { takeId, draftToken } = mintDraftTake(7);
    expect(verifyDraftTakeToken(takeId, 8, draftToken)).toBe(false);
    expect(verifyDraftTakeToken("take_other", 7, draftToken)).toBe(false);
    expect(verifyDraftTakeToken(takeId, 7, draftToken.slice(0, -1) + "0")).toBe(false);
    expect(verifyDraftTakeToken(takeId, 7, "")).toBe(false);
    expect(verifyDraftTakeToken(takeId, 7, undefined)).toBe(false);
  });
});

describe("approval token（核准憑證，帶時效）", () => {
  it("簽發後對同一（takeId, userId）驗證通過，且 expiresAt = now + TTL", () => {
    const now = 1_750_000_000_000;
    const { takeId } = mintDraftTake(7);
    const { approvalToken, expiresAt } = issueTakeApprovalToken(takeId, 7, now);
    expect(expiresAt).toBe(now + TAKE_APPROVAL_TOKEN_TTL_MS);
    expect(verifyTakeApprovalToken(takeId, 7, approvalToken, now)).toBe(true);
    expect(
      verifyTakeApprovalToken(takeId, 7, approvalToken, expiresAt - 1)
    ).toBe(true);
  });

  it("過期即失效（含剛好到期的邊界）", () => {
    const now = 1_750_000_000_000;
    const { takeId } = mintDraftTake(7);
    const { approvalToken, expiresAt } = issueTakeApprovalToken(takeId, 7, now);
    expect(verifyTakeApprovalToken(takeId, 7, approvalToken, expiresAt)).toBe(false);
    expect(verifyTakeApprovalToken(takeId, 7, approvalToken, expiresAt + 1)).toBe(false);
  });

  it("跨使用者 / 換 takeId / 竄改到期時間或簽名 一律失效", () => {
    const now = 1_750_000_000_000;
    const { takeId } = mintDraftTake(7);
    const { approvalToken } = issueTakeApprovalToken(takeId, 7, now);
    const [exp, sig] = [
      approvalToken.slice(0, approvalToken.indexOf(".")),
      approvalToken.slice(approvalToken.indexOf(".") + 1),
    ];
    expect(verifyTakeApprovalToken(takeId, 8, approvalToken, now)).toBe(false);
    expect(verifyTakeApprovalToken("take_other", 7, approvalToken, now)).toBe(false);
    // 竄改到期時間（延長效期）→ 簽名不符
    expect(
      verifyTakeApprovalToken(takeId, 7, `${Number(exp) + 999_999}.${sig}`, now)
    ).toBe(false);
    // 竄改簽名
    expect(
      verifyTakeApprovalToken(takeId, 7, `${exp}.${sig.slice(0, -1)}0`, now)
    ).toBe(false);
    // 格式錯誤
    expect(verifyTakeApprovalToken(takeId, 7, "not-a-token", now)).toBe(false);
    expect(verifyTakeApprovalToken(takeId, 7, `.${sig}`, now)).toBe(false);
    expect(verifyTakeApprovalToken(takeId, 7, undefined, now)).toBe(false);
  });
});

describe("精修送單 60s 冪等窗", () => {
  it("窗內重複送單被擋、窗外放行、不同 take / user 互不影響", () => {
    const now = 2_000_000_000_000;
    expect(isRecentRefineSubmit(7, "take_idem_a", now)).toBe(false);
    markRefineSubmit(7, "take_idem_a", now);
    expect(isRecentRefineSubmit(7, "take_idem_a", now + 1)).toBe(true);
    expect(
      isRecentRefineSubmit(7, "take_idem_a", now + REFINE_IDEMPOTENCY_WINDOW_MS - 1)
    ).toBe(true);
    expect(
      isRecentRefineSubmit(7, "take_idem_a", now + REFINE_IDEMPOTENCY_WINDOW_MS)
    ).toBe(false);
    expect(isRecentRefineSubmit(8, "take_idem_a", now + 1)).toBe(false);
    expect(isRecentRefineSubmit(7, "take_idem_b", now + 1)).toBe(false);
  });
});

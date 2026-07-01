/**
 * feedbackScreenshotOwnership.test.ts — AIDV-881 / AIDV-931
 *
 * feedback.create 的 screenshotKey 必須屬於提交者（防跨帳號偽造他人截圖連結）。
 *
 * 此前的守門寫死前綴 `screenshots/<userId>/`，但簽章直傳真正鑄出的 key 一律是
 * `uploads/<userId>/...`（見 signedUpload.ts buildScopedKey / fileKey / isKeyOwnedByUser）。
 * 結果是雙重失效：
 *   ① 安全面：沒有任何 key 會落在 `screenshots/` 命名空間，所以守門「形同虛設」；
 *   ② 功能面：每一張合法截圖（key=`uploads/<id>/…`）都被 FORBIDDEN 退回 = 線上回歸。
 *
 * 修法：直接複用 signedUpload.ts 的 canonical `isKeyOwnedByUser`，讓 feedback 端的
 * 命名空間與 presign/finalize 端永遠一致。本檔以「真 caller」驗證 feedbackRouter.create
 * 的 wiring，而非只測 predicate（predicate 另由 signedUpload 測試覆蓋）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let createdWith: any = null;

vi.mock("../../db", () => ({
  createFeedbackReport: vi.fn(async (data: any) => {
    createdWith = data;
    return 4242;
  }),
}));

// rateLimiter：永遠放行，把測試焦點留給 ownership 守門
vi.mock("../../_core/rateLimiter", () => ({
  tryConsumeFeedbackToken: vi.fn(() => true),
}));

// notifyOwner 走 best-effort 動態 import；mock 掉以免真的觸發通知副作用
vi.mock("../../_core/notification", () => ({
  notifyOwner: vi.fn(async () => {}),
}));

import { feedbackRouter } from "../feedback";

const SELF = 1;
const OTHER = 2;

function caller(userId: number) {
  return feedbackRouter.createCaller({
    user: { id: userId, role: "user" },
    req: { headers: {} },
  } as any);
}

const baseInput = {
  title: "截圖回饋",
  description: "畫面有問題",
  category: "bug" as const,
  priority: "medium" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  createdWith = null;
});

describe("AIDV-881 feedback.create screenshotKey ownership", () => {
  it("合法 uploads/<self>/ key → 通過並落庫（回歸守門：舊 screenshots/ 前綴會誤退此 key）", async () => {
    const key = `uploads/${SELF}/shot-abc123.png`;
    const res = await caller(SELF).create({ ...baseInput, screenshotKey: key });
    expect(res).toEqual({ id: 4242 });
    expect(createdWith).toMatchObject({ userId: SELF, screenshotKey: key });
  });

  it("他人 uploads/<other>/ key → FORBIDDEN，且不落庫", async () => {
    const key = `uploads/${OTHER}/secret-shot.png`;
    await expect(
      caller(SELF).create({ ...baseInput, screenshotKey: key }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createdWith).toBeNull();
  });

  it("偽前綴 screenshots/<self>/ key → FORBIDDEN（該命名空間不再被信任、亦非真實 key）", async () => {
    const key = `screenshots/${SELF}/shot.png`;
    await expect(
      caller(SELF).create({ ...baseInput, screenshotKey: key }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createdWith).toBeNull();
  });

  it("前綴混淆 uploads/10/ 不屬於 user 1（尾斜線邊界）→ FORBIDDEN", async () => {
    // "uploads/10/x" 雖以 "uploads/1" 起頭，但 isKeyOwnedByUser 比對 "uploads/1/"
    // （含尾斜線），故 user 1 不能盜用 user 10 的 key。
    const key = `uploads/10/foreign.png`;
    await expect(
      caller(SELF).create({ ...baseInput, screenshotKey: key }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createdWith).toBeNull();
  });

  it("前導斜線 /uploads/<self>/ key → 正規化後通過（isKeyOwnedByUser 去除前導斜線）", async () => {
    const key = `/uploads/${SELF}/shot.png`;
    const res = await caller(SELF).create({ ...baseInput, screenshotKey: key });
    expect(res).toEqual({ id: 4242 });
    expect(createdWith).toMatchObject({ screenshotKey: key });
  });

  it("未附 screenshotKey → 略過守門，正常落庫", async () => {
    const res = await caller(SELF).create({ ...baseInput });
    expect(res).toEqual({ id: 4242 });
    expect(createdWith).toMatchObject({ userId: SELF });
    expect(createdWith.screenshotKey).toBeUndefined();
  });
});

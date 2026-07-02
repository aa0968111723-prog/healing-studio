/**
 * refundStatus（純顯示邏輯）— AIDV-650
 * 驗收條件：
 * - full → 「已退回 N 點」成功色；partial → 「部分退點 m/n」警示色；
 *   not_refunded → 「未退點」警示色＋中性補充說明
 * - none / unknown / 無資料（undefined，含 loading/error 降級）→ null 不顯示
 */
import { describe, it, expect } from "vitest";
import { describeRefundBadge, type JobRefundInfo } from "./refundStatus";

const info = (overrides: Partial<JobRefundInfo>): JobRefundInfo => ({
  taskId: 1,
  chargedPoints: 0,
  refundedPoints: 0,
  refundStatus: "unknown",
  ...overrides,
});

describe("describeRefundBadge (AIDV-650)", () => {
  it("full → 「已退回 N 點」＋成功色 ok", () => {
    const spec = describeRefundBadge(
      info({ refundStatus: "full", chargedPoints: 30, refundedPoints: 30 })
    );
    expect(spec).not.toBeNull();
    expect(spec!.label).toBe("已退回 30 點");
    expect(spec!.tone).toBe("ok");
    expect(spec!.title).toContain("全額退回 30 點");
  });

  it("partial → 「部分退點 m/n」＋警示色 warn", () => {
    const spec = describeRefundBadge(
      info({ refundStatus: "partial", chargedPoints: 30, refundedPoints: 10 })
    );
    expect(spec!.label).toBe("部分退點 10/30");
    expect(spec!.tone).toBe("warn");
    expect(spec!.title).toContain("已退回 10 點");
    expect(spec!.title).toContain("原扣 30 點");
  });

  it("not_refunded → 「未退點」＋中性補充說明（不斷言白扣款）", () => {
    const spec = describeRefundBadge(
      info({ refundStatus: "not_refunded", chargedPoints: 30 })
    );
    expect(spec!.label).toBe("未退點");
    expect(spec!.tone).toBe("warn");
    expect(spec!.title).toContain("已扣 30 點");
    expect(spec!.title).toContain("稍後自動入帳");
  });

  it("none（無扣點紀錄）→ null 不顯示", () => {
    expect(describeRefundBadge(info({ refundStatus: "none" }))).toBeNull();
  });

  it("unknown（查不到／DB 錯誤）→ null 不顯示（不得渲染成未退款）", () => {
    expect(describeRefundBadge(info({ refundStatus: "unknown" }))).toBeNull();
  });

  it("無資料（undefined / null，含 loading・error 降級）→ null", () => {
    expect(describeRefundBadge(undefined)).toBeNull();
    expect(describeRefundBadge(null)).toBeNull();
  });
});

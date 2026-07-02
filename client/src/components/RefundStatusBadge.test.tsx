// @vitest-environment jsdom
/**
 * RefundStatusBadge — AIDV-650
 * 驗收條件：
 * - full → 渲染「已退回 N 點」徽章（含完整語意 aria-label）
 * - partial / not_refunded → 渲染對應文案
 * - none / unknown / 無資料 → 完全不渲染（loading・error 安靜降級）
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RefundStatusBadge } from "./RefundStatusBadge";
import type { JobRefundInfo } from "./refundStatus";

afterEach(() => cleanup());

const info = (overrides: Partial<JobRefundInfo>): JobRefundInfo => ({
  taskId: 1,
  chargedPoints: 0,
  refundedPoints: 0,
  refundStatus: "unknown",
  ...overrides,
});

describe("RefundStatusBadge (AIDV-650)", () => {
  it("full → 顯示「已退回 30 點」且帶完整語意 aria-label", () => {
    render(
      <RefundStatusBadge
        info={info({ refundStatus: "full", chargedPoints: 30, refundedPoints: 30 })}
      />
    );
    const badge = screen.getByText("已退回 30 點");
    expect(badge).toBeDefined();
    expect(badge.getAttribute("aria-label")).toBe("此任務已全額退回 30 點");
  });

  it("partial → 顯示「部分退點 10/30」", () => {
    render(
      <RefundStatusBadge
        info={info({ refundStatus: "partial", chargedPoints: 30, refundedPoints: 10 })}
      />
    );
    expect(screen.getByText("部分退點 10/30")).toBeDefined();
  });

  it("not_refunded → 顯示「未退點」＋title 補充「稍後自動入帳」", () => {
    render(
      <RefundStatusBadge
        info={info({ refundStatus: "not_refunded", chargedPoints: 30 })}
      />
    );
    const badge = screen.getByText("未退點");
    expect(badge.getAttribute("title")).toContain("稍後自動入帳");
  });

  it("none / unknown / 無資料 → 完全不渲染（安靜降級）", () => {
    const { container: c1 } = render(
      <RefundStatusBadge info={info({ refundStatus: "none" })} />
    );
    expect(c1.innerHTML).toBe("");
    cleanup();
    const { container: c2 } = render(
      <RefundStatusBadge info={info({ refundStatus: "unknown" })} />
    );
    expect(c2.innerHTML).toBe("");
    cleanup();
    const { container: c3 } = render(<RefundStatusBadge info={undefined} />);
    expect(c3.innerHTML).toBe("");
  });
});

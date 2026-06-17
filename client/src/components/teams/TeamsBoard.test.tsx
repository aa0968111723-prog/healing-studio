// @vitest-environment jsdom
/**
 * TeamsBoard（U-13 / AIDV-116）四態 + 互動 + a11y 測試。
 * 守住：旗標預設 OFF；ready 渲染清單＋成員＋看板；切換團隊更新右側詳情；
 * loading/empty/error 三態出口；空 teams → EmptyState。純前端唯讀消費 props。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { TeamsBoard } from "./TeamsBoard";
import { TEAMS_COLLAB } from "./teamsFlags";
import { MOCK_TEAMS } from "./teamsTypes";

afterEach(() => cleanup());

describe("TeamsBoard（U-13 / AIDV-116）", () => {
  it("旗標預設 OFF（prod 隱藏、安全回滾）", () => {
    expect(TEAMS_COLLAB).toBe(false);
  });

  it("ready：渲染團隊清單卡 + 選取團隊的成員列 + 分工看板", () => {
    render(<TeamsBoard withKit={false} />);
    expect(screen.getByRole("navigation", { name: "團隊清單" })).toBeTruthy();
    // 預設選第一隊：成員列出現。
    expect(screen.getByRole("list", { name: "團隊成員" })).toBeTruthy();
    // 分工看板出現（list role）。
    expect(screen.getByRole("list", { name: "分工看板" })).toBeTruthy();
  });

  it("切換團隊 → 右側詳情更新（成員數改變）", () => {
    render(<TeamsBoard withKit={false} />);
    const nav = screen.getByRole("navigation", { name: "團隊清單" });
    const cards = within(nav).getAllByRole("button");
    // 第一隊（極光，4 員）；點第二隊（個人練習，1 員）。
    fireEvent.click(cards[1]);
    const list = screen.getByRole("list", { name: "團隊成員" });
    expect(within(list).getAllByRole("listitem").length).toBe(MOCK_TEAMS[1].members.length);
  });

  it("loading 態 → 顯示 LoadingState（role=status）", () => {
    render(<TeamsBoard withKit={false} status="loading" />);
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });

  it("error 態 → 顯示 ErrorState（role=alert）+ 重試回呼", () => {
    const onRetry = vi.fn();
    render(<TeamsBoard withKit={false} status="error" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("empty 態（或空 teams）→ 顯示 EmptyState 文案", () => {
    render(<TeamsBoard withKit={false} status="empty" />);
    expect(screen.getByText("還沒有團隊")).toBeTruthy();
  });

  it("teams=[] → 自動落 EmptyState（即使 status=ready）", () => {
    render(<TeamsBoard withKit={false} teams={[]} />);
    expect(screen.getByText("還沒有團隊")).toBeTruthy();
  });
});

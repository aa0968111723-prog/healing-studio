// @vitest-environment jsdom
/**
 * TeamCard（U-13 / AIDV-116）render + a11y + 互動測試。
 * 守住：名稱／描述／共享範圍／頭像疊放（+N）／完成度；可選取時整卡為 button
 * （aria-pressed），點擊回呼 id。純前端唯讀消費 props。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { TeamCard } from "./TeamCard";
import type { Team } from "./teamsTypes";

afterEach(() => cleanup());

const team: Team = {
  id: "t1",
  name: "極光製作組",
  blurb: "主線敘事與配樂統合。",
  scope: "team",
  members: [
    { id: "m1", name: "林維", role: "owner" },
    { id: "m2", name: "陳曦", role: "admin" },
    { id: "m3", name: "黃柏", role: "editor" },
    { id: "m4", name: "Quinn", role: "viewer" },
    { id: "m5", name: "阿德", role: "guest" },
  ],
  tasks: [
    { id: "k1", title: "A", column: "done" },
    { id: "k2", title: "B", column: "todo" },
  ],
};

describe("TeamCard", () => {
  it("非互動：渲染名稱／描述／共享範圍／完成度", () => {
    render(<TeamCard team={team} />);
    expect(screen.getByRole("heading", { name: "極光製作組" })).toBeTruthy();
    expect(screen.getByText("主線敘事與配樂統合。")).toBeTruthy();
    expect(screen.getByText("團隊")).toBeTruthy(); // scope=team
    expect(screen.getByText("1/2 完成")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("頭像疊放：5 員、max 4 → 顯示 +1", () => {
    render(<TeamCard team={team} />);
    expect(screen.getByText("+1")).toBeTruthy();
  });

  it("可選取：整卡為 button、aria-pressed 反映 selected", () => {
    render(<TeamCard team={team} onSelect={() => {}} selected />);
    const btn = screen.getByRole("button", { name: /極光製作組/ });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });

  it("點擊回呼團隊 id", () => {
    const onSelect = vi.fn();
    render(<TeamCard team={team} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /極光製作組/ }));
    expect(onSelect).toHaveBeenCalledWith("t1");
  });
});

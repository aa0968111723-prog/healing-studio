// @vitest-environment jsdom
/**
 * DivisionBoard（U-13 / AIDV-116）render + a11y 測試。
 * 守住：四欄（狀態）皆渲染、任務落正確欄、欄標題 aria-labelledby、任務數、
 * 未指派任務的 placeholder、空欄文案。看板欄位語意正確（list/group）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DivisionBoard } from "./DivisionBoard";
import type { BoardTask, TeamMember } from "./teamsTypes";

afterEach(() => cleanup());

const members: TeamMember[] = [{ id: "m1", name: "林維", role: "owner" }];

const tasks: BoardTask[] = [
  { id: "k1", title: "開場分鏡", column: "done", assigneeId: "m1" },
  { id: "k2", title: "配樂選曲", column: "doing" }, // 未指派
];

describe("DivisionBoard", () => {
  it("看板為 list，四個狀態欄皆為 group", () => {
    render(<DivisionBoard tasks={tasks} members={members} />);
    expect(screen.getByRole("list", { name: "分工看板" })).toBeTruthy();
    const groups = screen.getAllByRole("group");
    expect(groups.length).toBe(4);
  });

  it("欄標題正確（待辦／進行中／審查／完成）", () => {
    render(<DivisionBoard tasks={tasks} members={members} />);
    for (const label of ["待辦", "進行中", "審查", "完成"]) {
      expect(screen.getByRole("heading", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("任務落入正確欄位（完成欄含「開場分鏡」）", () => {
    render(<DivisionBoard tasks={tasks} members={members} />);
    const doneCol = screen.getByRole("group", { name: /完成/ });
    expect(within(doneCol).getByText("開場分鏡")).toBeTruthy();
  });

  it("已指派任務顯示成員頭像；未指派任務顯示「未指派」", () => {
    render(<DivisionBoard tasks={tasks} members={members} />);
    expect(screen.getByRole("img", { name: "林維" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "未指派" })).toBeTruthy();
  });

  it("空欄渲染「此欄沒有任務」文案", () => {
    render(<DivisionBoard tasks={[]} members={members} />);
    expect(screen.getAllByText("此欄沒有任務").length).toBe(4);
  });
});

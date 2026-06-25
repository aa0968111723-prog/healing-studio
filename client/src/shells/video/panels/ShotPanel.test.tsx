// @vitest-environment jsdom
/**
 * ShotPanel（U-2 / AIDV-92 逐殼採用 · /video S5）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Tailwind 分鏡卡＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 ShotCard（進 .aidv-kit 範圍、保留 gate/狀態文字標籤）。
 * 並驗 gate×status 動作（生成）兩版皆接回真實 spine.generateShot。
 * 設計門依據（ui-ux-pro-max）：狀態不可只靠顏色——兩版皆保留文字標籤。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { Shot } from "@/spine/types";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

const spy = vi.hoisted(() => ({
  generateShot: vi.fn(() => Promise.resolve()),
  retrySingleShot: vi.fn(() => Promise.resolve()),
  approveShot: vi.fn(() => Promise.resolve()),
  reorderShots: vi.fn(() => Promise.resolve()),
  shots: [] as Shot[],
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { shots: spy.shots, characters: [], scenes: [] },
    generateShot: spy.generateShot,
    retrySingleShot: spy.retrySingleShot,
    approveShot: spy.approveShot,
    reorderShots: spy.reorderShots,
  }),
}));

import { ShotPanel } from "./ShotPanel";

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: "s1", no: "S01", act: 1, title: "晨光開場", route: "text",
    characterIds: [], sceneId: null, seed: 7, approval: "pending", stale: false,
    gen: { status: "idle", variant: 0 },
    ...over,
  };
}

beforeEach(() => { spy.shots = [shot()]; });
afterEach(() => { cleanup(); flags.chrome = false; spy.generateShot.mockClear(); spy.retrySingleShot.mockClear(); spy.approveShot.mockClear(); spy.reorderShots.mockClear(); });

describe("ShotPanel（U-2 / AIDV-92 · /video S5）", () => {
  it("空態：無分鏡時顯示引導文案", () => {
    spy.shots = [];
    render(<ShotPanel />);
    expect(screen.getByText("尚無分鏡")).toBeTruthy();
  });

  it("旗標 OFF（預設）：既有 Tailwind 分鏡卡，鏡號/標題在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<ShotPanel />);
    expect(screen.getByText("S01")).toBeTruthy();
    expect(screen.getByText("晨光開場")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit ShotCard（進 .aidv-kit 範圍、保留 gate 文字標籤）", () => {
    flags.chrome = true;
    const { container } = render(<ShotPanel />);
    expect(screen.getByText("S01")).toBeTruthy();
    expect(screen.getByText("可量產")).toBeTruthy(); // text 路徑 → ready
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("旗標 OFF：ready+idle 點『生成』→ 觸發 spine.generateShot", () => {
    flags.chrome = false;
    render(<ShotPanel />);
    fireEvent.click(screen.getByText("生成"));
    expect(spy.generateShot).toHaveBeenCalledWith("s1");
  });

  it("旗標 ON：ready+idle 點『生成』→ 觸發同一個 spine.generateShot（行為一致）", () => {
    flags.chrome = true;
    render(<ShotPanel />);
    fireEvent.click(screen.getByText("生成"));
    expect(spy.generateShot).toHaveBeenCalledWith("s1");
  });

  // AIDV-233：單片段重試機制——error 態顯示「重試」按鈕，點擊觸發 retrySingleShot
  it("旗標 OFF（AIDV-233）：error 態顯示『生成失敗』＋『重試』→ 點擊觸發 retrySingleShot", () => {
    flags.chrome = false;
    spy.shots = [shot({ gen: { status: "error", variant: 0 } })];
    render(<ShotPanel />);
    expect(screen.getByText("生成失敗")).toBeTruthy();
    fireEvent.click(screen.getByText("重試"));
    expect(spy.retrySingleShot).toHaveBeenCalledWith("s1");
  });

  it("旗標 ON（AIDV-233）：error 態進 design-kit，『重試』同樣觸發 retrySingleShot", () => {
    flags.chrome = true;
    spy.shots = [shot({ gen: { status: "error", variant: 0 } })];
    render(<ShotPanel />);
    fireEvent.click(screen.getByText("重試"));
    expect(spy.retrySingleShot).toHaveBeenCalledWith("s1");
  });

  // AIDV-239：拖曳重排序——拖曳手把可見＋鍵盤 ArrowUp/Down（WCAG 2.1 AA）
  it("AIDV-239：多鏡時每鏡顯示拖曳手把", () => {
    spy.shots = [shot({ id: "s1" }), shot({ id: "s2", no: "S02", title: "第二鏡" })];
    render(<ShotPanel />);
    expect(screen.getAllByLabelText("拖曳重排").length).toBe(2);
  });

  it("AIDV-239：鍵盤 ArrowDown 在第一鏡 → reorderShots(['s2', 's1'])", () => {
    spy.shots = [shot({ id: "s1" }), shot({ id: "s2", no: "S02", title: "第二鏡" })];
    render(<ShotPanel />);
    const handles = screen.getAllByLabelText("拖曳重排");
    fireEvent.keyDown(handles[0], { key: "ArrowDown" });
    expect(spy.reorderShots).toHaveBeenCalledWith(["s2", "s1"]);
  });

  it("AIDV-239：鍵盤 ArrowUp 在最後一鏡 → reorderShots(['s2', 's1'])", () => {
    spy.shots = [shot({ id: "s1" }), shot({ id: "s2", no: "S02", title: "第二鏡" })];
    render(<ShotPanel />);
    const handles = screen.getAllByLabelText("拖曳重排");
    fireEvent.keyDown(handles[1], { key: "ArrowUp" });
    expect(spy.reorderShots).toHaveBeenCalledWith(["s2", "s1"]);
  });

  it("AIDV-239：單鏡時 ArrowDown 不觸發 reorderShots（無下一鏡）", () => {
    spy.shots = [shot()];
    render(<ShotPanel />);
    fireEvent.keyDown(screen.getByLabelText("拖曳重排"), { key: "ArrowDown" });
    expect(spy.reorderShots).not.toHaveBeenCalled();
  });
});

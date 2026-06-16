// @vitest-environment jsdom
/**
 * StageBar（U-5 / AIDV-95 · /video S2）行為測試。
 * 守住五階段條兩條路徑：
 *   · 旗標 OFF（預設）＝既有 <ol> 五階段條＝零變化（無 role="tablist"、不進 .aidv-kit）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 FlowBar（role="tablist"、進 .aidv-kit、保留階段名稱）。
 * 旁邊「引導式創作／生成就緒鏡」動作鈕兩版皆在、行為不變。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

const h = vi.hoisted(() => ({
  scheduleGeneration: vi.fn(),
  project: { shots: [], characters: [], scenes: [], stageIndex: 1 } as unknown,
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: h.project, scheduleGeneration: h.scheduleGeneration }),
}));

import { StageBar } from "./StageBar";

beforeEach(() => {
  h.scheduleGeneration.mockReset();
  h.project = { shots: [], characters: [], scenes: [], stageIndex: 1 };
});
afterEach(() => { cleanup(); flags.chrome = false; });

describe("StageBar（U-5 / AIDV-95 · /video S2）", () => {
  it("無專案 → 不渲染（回 null）", () => {
    h.project = null;
    const { container } = render(<StageBar onGuided={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("旗標 OFF（預設）：既有 <ol> 五階段條，階段名稱/動作在、無 tablist、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<StageBar onGuided={vi.fn()} />);
    expect(screen.getByText("世界觀")).toBeTruthy();
    expect(screen.getByText("成片")).toBeTruthy();
    expect(screen.getByText("引導式創作")).toBeTruthy();
    expect(screen.getByText(/生成就緒鏡/)).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit FlowBar（role=tablist、進 .aidv-kit、保留五階段名稱與動作鈕）", () => {
    flags.chrome = true;
    const { container } = render(<StageBar onGuided={vi.fn()} />);
    expect(screen.getByText("世界觀")).toBeTruthy();
    expect(screen.getByText("成片")).toBeTruthy();
    expect(screen.getByText("引導式創作")).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("點「引導式創作」→ 觸發 onGuided（兩版動作鈕不變）", () => {
    flags.chrome = true;
    const onGuided = vi.fn();
    render(<StageBar onGuided={onGuided} />);
    fireEvent.click(screen.getByText("引導式創作"));
    expect(onGuided).toHaveBeenCalledTimes(1);
  });
});

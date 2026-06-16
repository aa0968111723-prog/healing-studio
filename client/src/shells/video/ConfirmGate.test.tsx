// @vitest-environment jsdom
/**
 * ConfirmGate（U-2 / AIDV-92 逐殼採用 · /video S5）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Tailwind 確認門＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 GateCard（進 .aidv-kit 範圍、保留三態文字標籤與鐵則）。
 * 並驗待補角色「上傳參考照」兩版皆接回真實 spine.uploadReference。
 * 設計門依據（ui-ux-pro-max）：狀態不可只靠顏色——兩版皆保留文字標籤。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { Character, Shot } from "@/spine/types";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

const spy = vi.hoisted(() => ({
  uploadReference: vi.fn(() => Promise.resolve()),
  shots: [] as Shot[],
  characters: [] as Character[],
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({
    project: { shots: spy.shots, characters: spy.characters, scenes: [] },
    uploadReference: spy.uploadReference,
  }),
}));

import { ConfirmGate } from "./ConfirmGate";

function character(over: Partial<Character> = {}): Character {
  return {
    id: "c1", name: "小明", emoji: "🧑", sourceGrade: "unconfirmed", locked: false,
    locks: { face: false, hair: false, costume: false, accessory: false },
    loraStatus: "未訓練", refImages: 0,
    ...over,
  };
}
function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: "s1", no: "S01", act: 1, title: "對手戲", route: "ref",
    characterIds: ["c1"], sceneId: null, seed: 7, approval: "pending", stale: false,
    gen: { status: "idle", variant: 0 },
    ...over,
  };
}

beforeEach(() => { spy.shots = [shot()]; spy.characters = [character()]; });
afterEach(() => { cleanup(); flags.chrome = false; spy.uploadReference.mockClear(); });

describe("ConfirmGate（U-2 / AIDV-92 · /video S5）", () => {
  it("旗標 OFF（預設）：既有 Tailwind 確認門，三態/鐵則文字在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<ConfirmGate />);
    expect(screen.getByText("可量產")).toBeTruthy();
    expect(screen.getByText("部分待補")).toBeTruthy();
    expect(screen.getByText("全待補")).toBeTruthy();
    expect(screen.getByText(/媒體生成前先估成本/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit GateCard（進 .aidv-kit 範圍、保留三態文字與鐵則）", () => {
    flags.chrome = true;
    const { container } = render(<ConfirmGate />);
    expect(screen.getByText("可量產")).toBeTruthy();
    expect(screen.getByText("部分待補")).toBeTruthy();
    expect(screen.getByText("全待補")).toBeTruthy();
    expect(screen.getByText(/媒體生成前先估成本/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("旗標 ON：待補角色點『上傳參考照』→ 觸發 spine.uploadReference(角色 id)", () => {
    flags.chrome = true;
    render(<ConfirmGate />);
    fireEvent.click(screen.getByText("上傳參考照"));
    expect(spy.uploadReference).toHaveBeenCalledWith("c1");
  });
});

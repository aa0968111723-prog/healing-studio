// @vitest-environment jsdom
/**
 * RoughCutCanvas（U-5 / AIDV-95 · /video S4 初剪打包）行為測試。
 * 守住：
 *   1. 空態（無分鏡）→ 引導文案。
 *   2. 時間軸總覽 + zip_export 估算（50 pt）顯示。
 *   3. 鐵則：已生成但未核准 → 出未核准 banner、打包鈕停用。
 *   4. 全部已生成＋已核准 → 可打包；點打包 → zip_export「待後端」佔位（honest，不偽裝完成）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { Shot } from "@/spine/types";

const h = vi.hoisted(() => ({ shots: [] as Shot[], gateKit: false }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { shots: h.shots } }),
}));
// U-5 旗標：預設 OFF＝零變化；ON＝design-kit 確認門摘要。getter 讓每個案例可切。
vi.mock("@/config/videoFlags", () => ({
  get ENABLE_VIDEO_GATE_KIT() { return h.gateKit; },
}));

import { RoughCutCanvas, EXPORT_PTS } from "./RoughCutCanvas";

function shot(over: Partial<Shot> = {}): Shot {
  return {
    id: "s1", no: "S01", act: 1, title: "晨光開場", route: "text",
    characterIds: [], sceneId: null, seed: 7, approval: "pending", stale: false,
    gen: { status: "done", variant: 0 },
    ...over,
  };
}

afterEach(() => { cleanup(); h.shots = []; h.gateKit = false; });

describe("RoughCutCanvas（U-5 / AIDV-95 · /video S4）", () => {
  it("空態：無分鏡 → 引導文案、無打包鈕", () => {
    h.shots = [];
    render(<RoughCutCanvas />);
    expect(screen.getByText("尚無分鏡可打包")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /打包初剪/ })).toBeNull();
  });

  it("時間軸 + zip_export 估算顯示（50 pt → MP4）", () => {
    h.shots = [shot({ id: "s1", no: "S01", approval: "approved" })];
    render(<RoughCutCanvas />);
    expect(screen.getByText("晨光開場")).toBeTruthy();
    expect(screen.getByText(new RegExp(`${EXPORT_PTS} pt → MP4`))).toBeTruthy();
  });

  it("鐵則：已生成但未核准 → 未核准 banner、打包鈕停用", () => {
    h.shots = [
      shot({ id: "s1", no: "S01", approval: "approved" }),
      shot({ id: "s2", no: "S02", approval: "pending" }), // done 但未核准
    ];
    render(<RoughCutCanvas />);
    expect(screen.getByRole("alert").textContent).toMatch(/未核准/);
    const packBtn = screen.getByRole("button", { name: /打包初剪/ });
    expect((packBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("全部已生成＋已核准 → 可打包；點打包 → zip_export 待後端佔位", () => {
    h.shots = [shot({ id: "s1", no: "S01", approval: "approved" })];
    render(<RoughCutCanvas />);
    const packBtn = screen.getByRole("button", { name: /打包初剪/ });
    expect((packBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(packBtn);
    expect(screen.getByText("待後端")).toBeTruthy();
    expect(screen.getByText(/zip_export.*worker 實作待補/)).toBeTruthy();
  });

  it("旗標 OFF（預設）：未進 design-kit 範圍，沿用 amber banner（零變化）", () => {
    h.gateKit = false;
    h.shots = [shot({ id: "s1", no: "S01", approval: "pending" })]; // done 未核准
    const { container } = render(<RoughCutCanvas />);
    expect(container.querySelector(".aidv-kit")).toBeNull();
    expect(screen.queryByText("初剪打包就緒度")).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/未核准/);
  });

  it("旗標 ON：頂部出 design-kit 確認門摘要（三態文字標籤＋進 .aidv-kit 範圍）", () => {
    h.gateKit = true;
    h.shots = [
      shot({ id: "s1", no: "S01", approval: "approved" }),               // 可打包
      shot({ id: "s2", no: "S02", approval: "pending" }),                // 待核准（done 未核准）
      shot({ id: "s3", no: "S03", gen: { status: "idle", variant: 0 } }), // 未生成
    ];
    const { container } = render(<RoughCutCanvas />);
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(screen.getByText(/初剪打包就緒度/)).toBeTruthy();
    // 色彩非唯一資訊：三態文字標籤都在（「待核准/未生成」亦出現在時間軸 badge，故用 getAllByText）。
    expect(screen.getByText("可打包")).toBeTruthy();
    expect(screen.getAllByText("待核准").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未生成").length).toBeGreaterThan(0);
    // 動作脊椎仍在：打包鈕（因有未核准而停用）。
    expect((screen.getByRole("button", { name: /打包初剪/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

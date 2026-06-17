// @vitest-environment jsdom
/**
 * AssetGenCanvas（U-5 / AIDV-95 · /video S2-3 多模態素材生成）採用片行為測試。
 * 守住兩條路徑（design-kit 四態採用片）：
 *   · 旗標 OFF（預設）＝既有 shadcn 待後端區塊＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 暖光四態（EmptyState/Card/Pill）（進 .aidv-kit 範圍）。
 * 並驗一個互動：切到「上傳自有」tab → 出待後端文案（兩版皆在，文案不變）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({ gateKit: false }));

vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({ provider: "hf", adapters: { generation: { generate: vi.fn() } } }),
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { id: "1" } }),
}));
vi.mock("../DirectorConsoleProvider", () => ({
  useDirectorConsole: () => ({ setCanvasMode: vi.fn() }),
}));
vi.mock("@/spine/seedVisual", () => ({ frameStyle: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/trpc", () => ({
  trpc: { promptLibrary: { create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
}));
vi.mock("@/config/videoFlags", () => ({
  get ENABLE_VIDEO_GATE_KIT() { return h.gateKit; },
}));

// jsdom 無 ResizeObserver；Radix Select 觸發器需要（與其他座艙測試一致）。
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

import { AssetGenCanvas } from "./AssetGenCanvas";

afterEach(() => { cleanup(); h.gateKit = false; });

describe("AssetGenCanvas（U-5 / AIDV-95 · /video S2-3）", () => {
  it("render：站內生成 tab 預設出提示詞輸入與生成鈕", () => {
    render(<AssetGenCanvas />);
    expect(screen.getByText(/估算成本並生成/)).toBeTruthy();
  });

  it("旗標 OFF（預設）：切『上傳自有』→ 既有待後端區塊、未進 .aidv-kit 範圍", () => {
    h.gateKit = false;
    const { container } = render(<AssetGenCanvas />);
    fireEvent.click(screen.getByText("上傳自有"));
    expect(screen.getByText("上傳自有素材")).toBeTruthy();
    expect(screen.getByText("待後端")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：切『上傳自有』→ design-kit 暖光四態（進 .aidv-kit 範圍、文案不變）", () => {
    h.gateKit = true;
    const { container } = render(<AssetGenCanvas />);
    fireEvent.click(screen.getByText("上傳自有"));
    expect(screen.getByText("上傳自有素材")).toBeTruthy();
    expect(screen.getByText("待後端")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

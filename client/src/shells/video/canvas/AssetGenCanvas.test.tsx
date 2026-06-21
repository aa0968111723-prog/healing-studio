// @vitest-environment jsdom
/**
 * AssetGenCanvas（U-5 / AIDV-95 · /video S2-3 多模態素材生成）採用片行為測試。
 * 守住兩條路徑（design-kit 四態採用片）：
 *   · 旗標 OFF（預設）＝既有 shadcn 待後端區塊＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 暖光四態（EmptyState/Card/Pill）（進 .aidv-kit 範圍）。
 * 並驗一個互動：切到「上傳自有」tab → 出待後端文案（兩版皆在，文案不變）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdapterCostBlockedError } from "@/adapters/types";
import type { GenEvent } from "@/adapters/types";

// generate 行為可由各測試覆寫（hoisted，供 vi.mock 工廠引用）。
const h = vi.hoisted(() => ({
  gateKit: false,
  generate: vi.fn() as ReturnType<typeof vi.fn>,
}));

vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({ provider: "mock", adapters: { generation: { generate: h.generate } } }),
}));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { id: "1" } }),
}));
vi.mock("../DirectorConsoleProvider", () => ({
  useDirectorConsole: () => ({ setCanvasMode: vi.fn() }),
}));
vi.mock("@/spine/seedVisual", () => ({ frameStyle: () => ({}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
import { toast } from "sonner";
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

beforeEach(() => { vi.clearAllMocks(); h.generate = vi.fn(); });
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

  // AIDV-160：cost-blocked 不可雙 toast。generate 先 emit cost-blocked 事件（caller 顯示
  // 友善 toast），再 reject AdapterCostBlockedError；catch 不可再 fire 第二個「生成失敗」。
  describe("成本守門中止（cost-blocked）→ 恰好一個冷靜 toast", () => {
    function typeAndRun() {
      render(<AssetGenCanvas />);
      fireEvent.change(screen.getByPlaceholderText(/輸入提示詞/), { target: { value: "海邊日落" } });
      fireEvent.click(screen.getByText(/估算成本並生成/));
    }

    it("免費引擎不可用 → 只有友善『免費引擎暫時無法使用』toast、無第二個『生成失敗』", async () => {
      h.generate = vi.fn(async (_req: unknown, onEvent: (e: GenEvent) => void) => {
        onEvent({ type: "cost-blocked", provider: "mock", reason: "免費引擎暫時無法使用，未扣點。" });
        throw new AdapterCostBlockedError("免費引擎暫時無法使用，未扣點。", { seam: "generation", provider: "mock" });
      });
      typeAndRun();

      // 友善 toast 必出現一次；通用「生成失敗」絕不出現（恰好一個 error toast）。
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledTimes(1);
      });
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/免費引擎暫時無法使用/);
      expect((toast.error as ReturnType<typeof vi.fn>).mock.calls.some((c) => /生成失敗/.test(String(c[0])))).toBe(false);
    });

    it("非 cost-blocked 的硬失敗 → 仍 fire 通用『生成失敗』toast（不回歸）", async () => {
      h.generate = vi.fn(async () => { throw new Error("全部 provider 皆失敗"); });
      typeAndRun();
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("生成失敗", expect.anything());
      });
    });
  });
});

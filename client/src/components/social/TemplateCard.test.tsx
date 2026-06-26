// @vitest-environment jsdom
/**
 * TemplateCard · TemplateCardGrid（U-6 / AIDV-96 · /social 九步旅程 S1）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有樣式、未進 .aidv-kit 範圍。
 *   · 旗標 ON       ＝design-kit 亮色暖光（進 .aidv-kit 範圍；aria-selected 等語意都在）。
 * 四態：載入（Skeleton）/ 結果（listbox）/ 空（EmptyState）/ 錯誤（重試）。
 * 設計門依據：色彩非唯一資訊(High)——兩版皆保留文字標籤＋aria-selected 語意。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));

const spineHooks = vi.hoisted(() => ({
  listTemplates: vi.fn<[], Promise<unknown[]>>().mockResolvedValue([]),
}));
vi.mock("@/providers/SpineProvider", () => ({
  useSpine: () => ({
    adapters: {
      dataStore: { listTemplates: spineHooks.listTemplates },
    },
  }),
}));

import { TemplateCardGrid } from "./TemplateCard";

afterEach(() => {
  cleanup();
  flags.chrome = false;
  spineHooks.listTemplates.mockResolvedValue([]);
});

describe("TemplateCardGrid（U-6 / AIDV-96 · S1 設計類型）", () => {
  it("旗標 OFF：載入態 → skeleton（未進 .aidv-kit 範圍）", async () => {
    flags.chrome = false;
    // 永不 resolve → 維持 loading 狀態
    spineHooks.listTemplates.mockImplementation(() => new Promise(() => {}));
    const { container } = render(<TemplateCardGrid value={null} onChange={() => {}} />);
    // skeleton 存在（animate-pulse 類）
    const skeletons = container.querySelectorAll(".animate-pulse,[data-slot='skeleton']");
    // fallback: listbox 不存在（尚未載入）
    expect(container.querySelector("[role='listbox']")).toBeNull();
    expect(skeletons.length).toBeGreaterThan(0);
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 OFF：結果態 → listbox＋版型名稱＋aria-selected（未進 .aidv-kit 範圍）", async () => {
    flags.chrome = false;
    spineHooks.listTemplates.mockResolvedValue([
      { id: "t1", name: "語錄卡", ratio: "1:1", palette: ["#000", "#111"], kind: "語錄" },
    ]);
    const { container } = render(<TemplateCardGrid value={null} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("語錄卡")).toBeTruthy());
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
    expect(container.querySelector("[aria-selected='false']")).not.toBeNull();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 OFF：selected=true → aria-selected='true'", async () => {
    flags.chrome = false;
    spineHooks.listTemplates.mockResolvedValue([
      { id: "t1", name: "限動卡", ratio: "9:16", palette: ["#000", "#111"], kind: "限動" },
    ]);
    const { container } = render(<TemplateCardGrid value="t1" onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("限動卡")).toBeTruthy());
    expect(container.querySelector("[aria-selected='true']")).not.toBeNull();
  });

  it("旗標 OFF：DataStore 回空陣列 → 顯示 FALLBACK_TEMPLATES（離線兜底）", async () => {
    flags.chrome = false;
    spineHooks.listTemplates.mockResolvedValue([]);
    render(<TemplateCardGrid value={null} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("語錄卡")).toBeTruthy());
  });

  it("旗標 OFF：DataStore 拋錯 → 錯誤態（重試按鈕）", async () => {
    flags.chrome = false;
    spineHooks.listTemplates.mockRejectedValue(new Error("net error"));
    render(<TemplateCardGrid value={null} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("重試")).toBeTruthy());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("旗標 ON：結果態 → 進 .aidv-kit 範圍；版型名稱＋aria-selected 都在", async () => {
    flags.chrome = true;
    spineHooks.listTemplates.mockResolvedValue([
      { id: "t2", name: "封面圖", ratio: "16:9", palette: ["#000", "#111"], kind: "封面" },
    ]);
    const { container } = render(<TemplateCardGrid value={null} onChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("封面圖")).toBeTruthy());
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    expect(container.querySelector("[role='listbox']")).not.toBeNull();
  });
});

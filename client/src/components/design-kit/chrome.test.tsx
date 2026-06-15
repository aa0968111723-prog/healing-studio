// @vitest-environment jsdom
/**
 * design-kit Chrome 8 元件（U-10 / AIDV-101 第二批）行為測試。
 * 守住互動與 a11y：Rail/MobileNav 選殼、ProviderChip 點擊、StateInspector 四態、
 * CommandPalette ⌘K 鍵盤導航（↓/↵/Esc）＋搜尋過濾。純元件、不接頁面。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  ProviderChip, Rail, StateInspector, CommandPalette, MobileNav,
  type DkShellDef, type DkCommandItem,
} from "./chrome";

afterEach(() => cleanup());

const shells: DkShellDef[] = [
  { id: "video", emoji: "🎬", name: "影片" },
  { id: "social", emoji: "🖼", name: "社群" },
  { id: "learn", emoji: "📚", name: "學習", enabled: false },
  { id: "settings", emoji: "⚙", name: "設定" },
];

describe("design-kit Chrome 元件（U-10 / AIDV-101）", () => {
  it("ProviderChip：有 onClick → 點擊觸發", () => {
    const onClick = vi.fn();
    render(<ProviderChip provider="fal" status="ok" onClick={onClick} />);
    fireEvent.click(screen.getByText("fal"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Rail：點殼層 → onSelect(id)；disabled 殼層不觸發", () => {
    const onSelect = vi.fn();
    render(<Rail shells={shells} active="video" onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("社群"));
    expect(onSelect).toHaveBeenCalledWith("social");
    fireEvent.click(screen.getByLabelText("學習")); // disabled
    expect(onSelect).not.toHaveBeenCalledWith("learn");
  });

  it("StateInspector：點四態之一 → onChange(state)", () => {
    const onChange = vi.fn();
    render(<StateInspector value="idle" onChange={onChange} />);
    fireEvent.click(screen.getByText("協作"));
    expect(onChange).toHaveBeenCalledWith("collab");
  });

  it("CommandPalette：open=false 不渲染；open=true 顯示 dialog 與空態", () => {
    const { rerender, container } = render(<CommandPalette open={false} items={[]} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
    rerender(<CommandPalette open items={[]} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("沒有符合的指令")).toBeTruthy();
  });

  it("CommandPalette：↓↵ 選第二項 → 執行其 onRun 並關閉", () => {
    const run1 = vi.fn(), run2 = vi.fn(), onClose = vi.fn();
    const items: DkCommandItem[] = [
      { id: "a", label: "去影片", group: "導航", onRun: run1 },
      { id: "b", label: "去設定", group: "導航", onRun: run2 },
    ];
    render(<CommandPalette open items={items} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(run2).toHaveBeenCalledTimes(1);
    expect(run1).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("CommandPalette：搜尋過濾 + Escape 關閉", () => {
    const onClose = vi.fn();
    const items: DkCommandItem[] = [
      { id: "a", label: "去影片", group: "導航", onRun: vi.fn() },
      { id: "b", label: "去設定", group: "導航", onRun: vi.fn() },
    ];
    render(<CommandPalette open items={items} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("命令搜尋"), { target: { value: "設定" } });
    expect(screen.queryByText("去影片")).toBeNull();
    expect(screen.getByText("去設定")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("MobileNav：點殼層 → onSelect(id)", () => {
    const onSelect = vi.fn();
    render(<MobileNav shells={shells} active="video" onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("設定"));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });
});

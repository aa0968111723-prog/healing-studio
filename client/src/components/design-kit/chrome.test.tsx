// @vitest-environment jsdom
/**
 * design-kit Chrome 8 元件（U-10 / AIDV-101 第二批）行為測試。
 * 守住互動與 a11y：Rail/MobileNav 選殼、ProviderChip 點擊、StateInspector 四態、
 * CommandPalette ⌘K 鍵盤導航（↓/↵/Esc）＋搜尋過濾。純元件、不接頁面。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  ProviderChip, Rail, StateInspector, CommandPalette, MobileNav, AccountMenu,
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
    expect(screen.getByText("找不到指令 · 試試…")).toBeTruthy();
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

  it("MobileNav：給 onLogout → 顯示可見登出鈕並可點（行動可見出口，非只藏 ⌘K）", () => {
    const onLogout = vi.fn();
    render(<MobileNav shells={shells} active="video" onSelect={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(screen.getByLabelText("登出"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("MobileNav：未給 onLogout → 不渲染登出鈕（向後相容）", () => {
    render(<MobileNav shells={shells} active="video" onSelect={vi.fn()} />);
    expect(screen.queryByLabelText("登出")).toBeNull();
  });

  it("AccountMenu：closed 時不顯示登出；open 時顯示且點登出 → onLogout", () => {
    const onLogout = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(
      <AccountMenu label="Bruce" onLogout={onLogout} open={false} onToggle={onToggle} />,
    );
    // 入口（avatar）一律可見，aria-expanded=false；登出項收合中不渲染。
    const trigger = screen.getByLabelText("帳號選單");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("登出")).toBeNull();
    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // 展開後可見登出 → 點擊呼叫 onLogout。
    rerender(<AccountMenu label="Bruce" onLogout={onLogout} open onToggle={onToggle} />);
    expect(screen.getByLabelText("帳號選單").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByText("登出"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("AccountMenu：有 onSettings → 顯示設定項並可點", () => {
    const onSettings = vi.fn();
    render(<AccountMenu label="Bruce" onLogout={vi.fn()} onSettings={onSettings} open onToggle={vi.fn()} />);
    fireEvent.click(screen.getByText("設定"));
    expect(onSettings).toHaveBeenCalledTimes(1);
  });
});

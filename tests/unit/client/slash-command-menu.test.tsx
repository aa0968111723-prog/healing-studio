// @vitest-environment jsdom
/**
 * slash-command-menu.test.tsx — SlashCommandMenu + useSlashCommandMenu 整合測試
 *
 * 確認重點：
 *   - 輸入 "/" 開頭 → 選單顯示
 *   - ↑↓ 移動選中項，Enter 套用
 *   - Tab 補完保留 argument
 *   - Esc 關閉但保留輸入字串
 *   - 點擊命令會把命令名稱寫回 input
 *   - 非 / 開頭輸入 → 選單不顯示
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { SlashCommandMenu } from "../../../client/src/components/SlashCommandMenu";
import { useSlashCommandMenu } from "../../../client/src/hooks/useSlashCommandMenu";

afterEach(() => {
  cleanup();
});

function Harness() {
  const [input, setInput] = useState("");
  const slash = useSlashCommandMenu(input, setInput);
  return (
    <div className="relative">
      <SlashCommandMenu {...slash.menuProps} placement="above" />
      <input
        data-testid="harness-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (slash.handleKeyDown(e)) return;
        }}
      />
    </div>
  );
}

describe("SlashCommandMenu + useSlashCommandMenu", () => {
  it("does not show the menu until input starts with /", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
    fireEvent.change(input, { target: { value: "hello" } });
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
  });

  it("shows the menu when input starts with /", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
  });

  it("filters commands as the user types", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/pla" } });
    const menu = screen.getByTestId("slash-command-menu");
    const buttons = menu.querySelectorAll<HTMLButtonElement>("[data-slash-cmd-name]");
    // The /plan command should appear as the first prefix hit
    expect(buttons[0]?.dataset.slashCmdName).toBe("/plan");
  });

  it("Enter on first item writes the command back to the input", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/pla" } });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // /plan takes argument → space appended for next typing
    expect(input.value).toMatch(/^\/plan\s*$/);
  });

  it("ArrowDown / ArrowUp move the active index with wraparound", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/" } });
    const menu = screen.getByTestId("slash-command-menu");
    const items = () =>
      Array.from(menu.querySelectorAll<HTMLButtonElement>("[data-slash-cmd-name]"));
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(items()[1]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(input, { key: "ArrowUp" });
    });
    expect(items()[0]?.getAttribute("aria-selected")).toBe("true");
    // Wraparound: up from index 0
    act(() => {
      fireEvent.keyDown(input, { key: "ArrowUp" });
    });
    const list = items();
    expect(list[list.length - 1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("Escape closes the menu but preserves the input text", async () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/pla" } });
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    // AnimatePresence runs an exit animation (~0.15s) before unmount
    await waitFor(() => {
      expect(screen.queryByTestId("slash-command-menu")).toBeNull();
    });
    expect(input.value).toBe("/pla");
  });

  it("Tab completes the selected command without closing the menu", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/pla" } });
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(input.value).toMatch(/^\/plan/);
    // Menu should still be open
    expect(screen.queryByTestId("slash-command-menu")).toBeTruthy();
  });

  it("mouseDown on a command writes it back to the input", () => {
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/" } });
    const menu = screen.getByTestId("slash-command-menu");
    const target = menu.querySelector<HTMLButtonElement>(
      `[data-slash-cmd-name="/image"]`
    );
    expect(target).toBeTruthy();
    act(() => {
      fireEvent.mouseDown(target!);
    });
    expect(input.value).toMatch(/^\/image/);
  });

  it("Enter does NOT prevent default once the typed command exactly matches", () => {
    // Use case: user typed the full /plan command + space and pressed Enter
    // to send. The menu should NOT swallow that Enter.
    render(<Harness />);
    const input = screen.getByTestId("harness-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/plan 拍片" } });
    let prevented = false;
    input.addEventListener("keydown", e => {
      if (e.defaultPrevented) prevented = true;
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(prevented).toBe(false);
  });
});

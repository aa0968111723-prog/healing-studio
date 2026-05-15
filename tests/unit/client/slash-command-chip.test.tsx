// @vitest-environment jsdom
/**
 * slash-command-chip.test.tsx — SlashCommandChip 顯示與互動測試
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SlashCommandChip } from "../../../client/src/components/SlashCommandChip";

afterEach(() => {
  cleanup();
});

describe("SlashCommandChip", () => {
  it("renders nothing for non-slash input", () => {
    const { container } = render(<SlashCommandChip input="你好光球" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the command doesn't match a known one", () => {
    const { container } = render(<SlashCommandChip input="/totally-unknown" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the chip with the command name when matched", () => {
    render(<SlashCommandChip input="/plan 拍片" />);
    const chip = screen.getByTestId("slash-command-chip");
    expect(chip.getAttribute("data-command")).toBe("/plan");
    expect(chip.textContent).toContain("/plan");
  });

  it("invokes onClear when the X button is clicked", () => {
    const onClear = vi.fn();
    render(<SlashCommandChip input="/plan 拍片" onClear={onClear} />);
    const btn = screen.getByLabelText("清除 /plan 指令");
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("does not show the X button when onClear is not provided", () => {
    render(<SlashCommandChip input="/plan" />);
    expect(screen.queryByLabelText(/清除/)).toBeNull();
  });

  it("matches Chinese aliases", () => {
    render(<SlashCommandChip input="/計畫 本週" />);
    const chip = screen.getByTestId("slash-command-chip");
    expect(chip.getAttribute("data-command")).toBe("/plan");
  });

  it("matches spirit commands by nickname", () => {
    render(<SlashCommandChip input="/圖圖 賽博龐克貓" />);
    const chip = screen.getByTestId("slash-command-chip");
    expect(chip.getAttribute("data-command")).toBe("/image");
  });
});

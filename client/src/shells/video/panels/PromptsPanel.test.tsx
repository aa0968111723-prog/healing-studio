// @vitest-environment jsdom
/**
 * PromptBlockRow（U-5 / AIDV-95 逐殼採用 · /video）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Tailwind 提示詞積木列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 PromptBlock（進 .aidv-kit 範圍、label/text/uses 三欄都在）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

import { PromptBlockRow } from "./PromptsPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("PromptBlockRow（U-5 / AIDV-95 · /video）", () => {
  it("旗標 OFF（預設）：既有 Tailwind 列，label/text/uses 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<PromptBlockRow kind="combo" label="雪山·晨光" text="prompt 內容" uses={7} />);
    expect(screen.getByText("雪山·晨光")).toBeTruthy();
    expect(screen.getByText("prompt 內容")).toBeTruthy();
    expect(container.textContent).toContain("7");
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit PromptBlock（進 .aidv-kit 範圍、label/text/uses 三欄都保留）", () => {
    flags.chrome = true;
    const { container } = render(<PromptBlockRow kind="block" label="雪山·晨光" text="prompt 內容" uses={7} />);
    expect(screen.getByText("雪山·晨光")).toBeTruthy();
    expect(screen.getByText("prompt 內容")).toBeTruthy();
    expect(container.textContent).toContain("7");
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

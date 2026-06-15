// @vitest-environment jsdom
/**
 * AgentPrefsPanel · PersonaRow（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有人格選擇列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SettingRow（進 .aidv-kit 範圍；label/desc/控制項都在）。
 * 只測 PersonaRow（純展示）；面板的 trpc 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { PersonaRow } from "./AgentPrefsPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("AgentPrefsPanel · PersonaRow（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有人格選擇列，label/desc/控制項在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<PersonaRow label="預設導演人格" desc="Calm / Creative / Technical"><button>平靜</button></PersonaRow>);
    expect(screen.getByText("預設導演人格")).toBeTruthy();
    expect(screen.getByText("Calm / Creative / Technical")).toBeTruthy();
    expect(screen.getByText("平靜")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SettingRow（進 .aidv-kit 範圍；label/hint/控制項都保留）", () => {
    flags.chrome = true;
    const { container } = render(<PersonaRow label="預設導演人格" desc="Calm / Creative / Technical"><button>平靜</button></PersonaRow>);
    expect(screen.getByText("預設導演人格")).toBeTruthy();
    expect(screen.getByText("Calm / Creative / Technical")).toBeTruthy();
    expect(screen.getByText("平靜")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

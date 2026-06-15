// @vitest-environment jsdom
/**
 * GeneralSettingsPanel · SettingsRow（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有設定列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 SettingRow（進 .aidv-kit 範圍；label/hint/控制項都在）。
 * 設計門依據（ui-ux-pro-max）：Input Labels(High)——控制項需有可見標籤；兩版皆標籤可見。
 * 只測 SettingsRow（純展示）；面板的 trpc/auth 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { SettingsRow } from "./GeneralSettingsPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("GeneralSettingsPanel · SettingsRow（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有設定列，label/desc 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(
      <SettingsRow label="主題" desc="深淺色"><button>切換</button></SettingsRow>,
    );
    expect(screen.getByText("主題")).toBeTruthy();
    expect(screen.getByText("深淺色")).toBeTruthy();
    expect(screen.getByText("切換")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SettingRow（進 .aidv-kit 範圍；label/hint/控制項都保留）", () => {
    flags.chrome = true;
    const { container } = render(
      <SettingsRow label="主題" desc="深淺色"><button>切換</button></SettingsRow>,
    );
    expect(screen.getByText("主題")).toBeTruthy();
    expect(screen.getByText("深淺色")).toBeTruthy();
    expect(screen.getByText("切換")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

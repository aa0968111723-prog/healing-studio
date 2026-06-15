// @vitest-environment jsdom
/**
 * ProviderPanel · ProviderChoice / Row（U-2 / AIDV-92 逐殼採用 · /settings）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有卡/列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit ProviderOption / SettingRow（進 .aidv-kit 範圍；選擇/開關控制項都保留）。
 * 只測純展示子元件；面板的 trpc/spine 以最小 mock 隔離，避免載入重相依。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/providers/SpineProvider", () => ({ useSpine: () => ({}) }));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ProviderChoice, Row } from "./ProviderPanel";

afterEach(() => { cleanup(); flags.chrome = false; });

describe("ProviderPanel · ProviderChoice（U-2 / AIDV-92 · /settings）", () => {
  it("旗標 OFF（預設）：既有卡片，名稱/說明/成本在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<ProviderChoice pv={"hf" as any} selected down={false} onSelect={() => {}} />);
    expect(screen.getByText("hf")).toBeTruthy();
    expect(screen.getByText(/HF Inference/)).toBeTruthy();
    expect(screen.getByText(/\/張/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit ProviderOption（進 .aidv-kit 範圍；說明/成本保留），onSelect 仍可觸發", () => {
    flags.chrome = true;
    const onSelect = vi.fn();
    const { container } = render(<ProviderChoice pv={"hf" as any} selected={false} down={false} onSelect={onSelect} />);
    expect(screen.getByText("HF")).toBeTruthy();
    expect(screen.getByText(/HF Inference/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    fireEvent.click(screen.getByRole("radio"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("ProviderPanel · Row（故障注入列）", () => {
  it("旗標 OFF：既有列，label/desc/控制項在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<Row label="模擬 hf 失敗" desc="逾時 504"><button>開關</button></Row>);
    expect(screen.getByText("模擬 hf 失敗")).toBeTruthy();
    expect(screen.getByText("逾時 504")).toBeTruthy();
    expect(screen.getByText("開關")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit SettingRow（進 .aidv-kit 範圍；label/hint/控制項都保留）", () => {
    flags.chrome = true;
    const { container } = render(<Row label="模擬 hf 失敗" desc="逾時 504"><button>開關</button></Row>);
    expect(screen.getByText("模擬 hf 失敗")).toBeTruthy();
    expect(screen.getByText("逾時 504")).toBeTruthy();
    expect(screen.getByText("開關")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

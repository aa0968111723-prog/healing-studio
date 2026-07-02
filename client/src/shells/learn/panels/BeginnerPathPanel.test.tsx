// @vitest-environment jsdom
/**
 * BeginnerPathPanel × persona fork（AIDV-965）行為測試。
 * 守住：
 *   ① 【HARD 零回歸】旗標 OFF → 無 persona 選擇器、現行 5 步、現行副標題／完成文案，
 *      與 AIDV-811 現行輸出 100% 一致。
 *   ② 旗標 ON 未選 persona → 步驟／文案仍與現行 100% 一致（僅多出選擇器本身）。
 *   ③ 選 persona → chips aria-selected、STEPS 換組、localStorage 寫入；再點一次取消回預設。
 *   ④ a11y：選擇器 role=tablist、chips role=tab + aria-selected。
 *   ⑤ 完成畫面文案依 persona 客製。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

const flags = vi.hoisted(() => ({ personas: false }));
vi.mock("@/config/featureFlags", () => ({
  get FEATURE_BEGINNER_PATH_PERSONAS() { return flags.personas; },
}));

import { BeginnerPathPanel } from "./BeginnerPathPanel";
import {
  PERSONA_LS_KEY,
  DEFAULT_STEPS,
  DEFAULT_SUBTITLE,
  DEFAULT_COMPLETION,
  getStepsForPersona,
  getCompletionCopy,
} from "../beginnerPathPersonas";

// jsdom 環境可能未提供 localStorage 全域；用 Map 實作 stub。
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
});

beforeEach(() => { store.clear(); });
afterEach(() => { cleanup(); flags.personas = false; });

const DEFAULT_TITLES = DEFAULT_STEPS.map((s) => s.title);

describe("【HARD 零回歸】旗標 OFF＝與現行 100% 一致", () => {
  it("無 persona 選擇器（無 tablist/tab），現行 5 步與副標題原樣", () => {
    flags.personas = false;
    render(<BeginnerPathPanel />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByText(DEFAULT_SUBTITLE)).toBeTruthy();
    for (const t of DEFAULT_TITLES) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
  });

  it("即使 localStorage 已有 persona，旗標 OFF 仍顯示現行 5 步（不讀 persona）", () => {
    flags.personas = false;
    store.set(PERSONA_LS_KEY, "ecommerce");
    render(<BeginnerPathPanel />);
    for (const t of DEFAULT_TITLES) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.queryByText("去背／換底")).toBeNull();
  });

  it("全步完成 → 現行完成文案原樣", () => {
    flags.personas = false;
    store.set("learn:beginner-path:done", JSON.stringify(DEFAULT_STEPS.map((s) => s.id)));
    render(<BeginnerPathPanel />);
    expect(screen.getByText(DEFAULT_COMPLETION.title)).toBeTruthy();
    expect(screen.getByText(DEFAULT_COMPLETION.body)).toBeTruthy();
  });
});

describe("旗標 ON · 未選 persona＝內容仍與現行 100% 一致", () => {
  it("步驟／副標題／進度與現行相同；選擇器顯示且全部未選（aria-selected=false）", () => {
    flags.personas = true;
    render(<BeginnerPathPanel />);
    for (const t of DEFAULT_TITLES) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText(DEFAULT_SUBTITLE)).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();

    const tablist = screen.getByRole("tablist", { name: "選擇你的創作身分" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) expect(tab.getAttribute("aria-selected")).toBe("false");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "🛍️ 電商賣家", "📖 教育者", "🎨 接案者", "🏷️ 品牌方", "✨ 通用",
    ]);
  });
});

describe("旗標 ON · persona 選擇", () => {
  it("點「電商賣家」→ aria-selected=true、換成電商 4 步、寫入 localStorage", () => {
    flags.personas = true;
    render(<BeginnerPathPanel />);
    const chip = screen.getByRole("tab", { name: /電商賣家/ });
    fireEvent.click(chip);

    expect(chip.getAttribute("aria-selected")).toBe("true");
    expect(store.get(PERSONA_LS_KEY)).toBe("ecommerce");
    for (const s of getStepsForPersona("ecommerce")) {
      expect(screen.getByText(s.title)).toBeTruthy();
    }
    expect(screen.queryByText("讓圖動起來")).toBeNull(); // 預設步驟已換掉
    expect(screen.getByText("0/4")).toBeTruthy();
  });

  it("localStorage 已有 educator → 掛載即顯示教育者步驟且 chip 已選", () => {
    flags.personas = true;
    store.set(PERSONA_LS_KEY, "educator");
    render(<BeginnerPathPanel />);
    expect(screen.getByRole("tab", { name: /教育者/ }).getAttribute("aria-selected")).toBe("true");
    for (const s of getStepsForPersona("educator")) {
      expect(screen.getByText(s.title)).toBeTruthy();
    }
  });

  it("再點一次已選 chip → 取消選擇、移除 localStorage、回現行 5 步", () => {
    flags.personas = true;
    store.set(PERSONA_LS_KEY, "brand");
    render(<BeginnerPathPanel />);
    const chip = screen.getByRole("tab", { name: /品牌方/ });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-selected")).toBe("false");
    expect(store.has(PERSONA_LS_KEY)).toBe(false);
    for (const t of DEFAULT_TITLES) expect(screen.getByText(t)).toBeTruthy();
  });

  it("選「通用」→ 步驟＝現行 5 步（內容零差異），chip 有選取態", () => {
    flags.personas = true;
    render(<BeginnerPathPanel />);
    fireEvent.click(screen.getByRole("tab", { name: /通用/ }));
    for (const t of DEFAULT_TITLES) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByText("0/5")).toBeTruthy();
    expect(store.get(PERSONA_LS_KEY)).toBe("general");
  });
});

describe("旗標 ON · 完成畫面文案依 persona 客製", () => {
  it("接案者全步完成 → 顯示接案者客製完成文案（非預設）", () => {
    flags.personas = true;
    store.set(PERSONA_LS_KEY, "freelancer");
    store.set(
      "learn:beginner-path:done",
      JSON.stringify(getStepsForPersona("freelancer").map((s) => s.id)),
    );
    render(<BeginnerPathPanel />);
    const copy = getCompletionCopy("freelancer");
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.body)).toBeTruthy();
    expect(screen.queryByText(DEFAULT_COMPLETION.title)).toBeNull();
  });

  it("未選 persona 全步完成 → 現行完成文案", () => {
    flags.personas = true;
    store.set("learn:beginner-path:done", JSON.stringify(DEFAULT_STEPS.map((s) => s.id)));
    render(<BeginnerPathPanel />);
    expect(screen.getByText(DEFAULT_COMPLETION.title)).toBeTruthy();
  });
});

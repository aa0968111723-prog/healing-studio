// @vitest-environment jsdom
/**
 * design-kit atom 元件庫（U-SOP-3 / AIDV-142）行為測試。
 * 守住：btn/tag/pill/dot/meter/kbd 六類原子的 render＋變體＋a11y，
 * 並驗各原子綁 CSS 變數（不寫死 hex）、可組合。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import {
  Btn,
  IconBtn,
  Pill,
  Tag,
  ToneTag,
  Dot,
  Meter,
  MeterBar,
  Kbd,
  KbdCombo,
  Atoms,
} from "./atoms";

afterEach(() => cleanup());

describe("atom · btn（AIDV-142）", () => {
  it("Btn：render＋語氣變體＋onClick", () => {
    const onClick = vi.fn();
    render(<Btn variant="primary" size="sm" onClick={onClick}>送出</Btn>);
    const b = screen.getByRole("button", { name: "送出" });
    expect(b).toBeTruthy();
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("IconBtn：icon-only 必帶 aria-label＋正方形尺寸", () => {
    render(<IconBtn aria-label="關閉" size="xs"><span aria-hidden>×</span></IconBtn>);
    const b = screen.getByRole("button", { name: "關閉" });
    expect(b.className).toContain("size-[26px]");
  });
});

describe("atom · pill / tag（AIDV-142）", () => {
  it("Pill：語氣 kind 綁 token 色（不硬編 hex）", () => {
    render(<Pill kind="ok" dot>就緒</Pill>);
    const el = screen.getByText("就緒");
    expect(el.className).toContain("var(--ok)");
    expect(el.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("Tag：mono metadata 籤渲染內容", () => {
    render(<Tag>v1.2</Tag>);
    expect(screen.getByText("v1.2")).toBeTruthy();
  });

  it("ToneTag：語氣色綁 token 變數", () => {
    render(<ToneTag tone="bad">逾時</ToneTag>);
    expect(screen.getByText("逾時").className).toContain("var(--bad)");
  });
});

describe("atom · dot（AIDV-142）", () => {
  it("有 label → role=img＋可被 name 查到（a11y 語意）", () => {
    render(<Dot tone="warn" label="部分就緒" ring pulse />);
    const d = screen.getByRole("img", { name: "部分就緒" });
    expect(d.className).toContain("var(--warn)");
    expect(d.className).toContain("animate-pulse");
  });

  it("無 label → aria-hidden（純裝飾，不污染讀屏）", () => {
    const { container } = render(<Dot tone="ok" />);
    const d = container.querySelector("[aria-hidden]");
    expect(d).toBeTruthy();
    expect(d!.className).toContain("var(--ok)");
  });
});

describe("atom · meter（AIDV-142）", () => {
  it("MeterBar：role=progressbar＋valuenow 夾在 0–100", () => {
    render(<MeterBar pct={140} tone="ok" label="進度" showValue />);
    const m = screen.getByRole("progressbar", { name: "進度" });
    expect(m.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("MeterBar：負值夾為 0", () => {
    render(<MeterBar pct={-5} />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });

  it("Meter（primitives re-export）：可渲染", () => {
    const { container } = render(<Meter pct={50} />);
    expect(container.querySelector("i")).toBeTruthy();
  });
});

describe("atom · kbd（AIDV-142）", () => {
  it("Kbd：單鍵帽渲染", () => {
    render(<Kbd>Esc</Kbd>);
    expect(screen.getByText("Esc")).toBeTruthy();
  });

  it("KbdCombo：字串以 + 切分為多顆鍵帽", () => {
    render(<KbdCombo keys="⌘ + K" />);
    expect(screen.getByText("⌘")).toBeTruthy();
    expect(screen.getByText("K")).toBeTruthy();
  });

  it("KbdCombo：接受陣列形式", () => {
    render(<KbdCombo keys={["Ctrl", "S"]} />);
    expect(screen.getByText("Ctrl")).toBeTruthy();
    expect(screen.getByText("S")).toBeTruthy();
  });
});

describe("atom · 統一入口（AIDV-142）", () => {
  it("Atoms 聚合物件含六類原子", () => {
    for (const k of ["Btn", "IconBtn", "Pill", "Tag", "ToneTag", "Dot", "Meter", "MeterBar", "Kbd", "KbdCombo"]) {
      expect(Atoms).toHaveProperty(k);
    }
  });
});

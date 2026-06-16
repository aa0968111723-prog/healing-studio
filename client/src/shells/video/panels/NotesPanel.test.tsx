// @vitest-environment jsdom
/**
 * NoteRow（U-5 / AIDV-95 逐殼採用 · /video）行為測試。
 * 守住兩條路徑：
 *   · 旗標 OFF（預設）＝既有 Tailwind 筆記列＝零變化（不進 .aidv-kit 範圍）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 Card（進 .aidv-kit 範圍、文字與 meta 欄位都在）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({
  get ENABLE_AIDV_CHROME() { return flags.chrome; },
}));

const h = vi.hoisted(() => ({ notes: [] as Record<string, unknown>[], addNote: vi.fn() }));
vi.mock("@/spine/ProjectSpineProvider", () => ({
  useProjectSpine: () => ({ project: { notes: h.notes }, addNote: h.addNote }),
}));

import { NoteRow, NotesPanel } from "./NotesPanel";

afterEach(() => { cleanup(); flags.chrome = false; h.notes = []; });

describe("NoteRow（U-5 / AIDV-95 · /video）", () => {
  it("旗標 OFF（預設）：既有 Tailwind 筆記列，文字＋meta 在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<NoteRow text="先補實景" ts="06-15 10:00" shotNo="S03" />);
    expect(screen.getByText("先補實景")).toBeTruthy();
    expect(screen.getByText(/06-15 10:00.*S03/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit Card（進 .aidv-kit 範圍、文字＋meta 欄位都保留）", () => {
    flags.chrome = true;
    const { container } = render(<NoteRow text="先補實景" ts="06-15 10:00" shotNo="S03" />);
    expect(screen.getByText("先補實景")).toBeTruthy();
    expect(screen.getByText(/06-15 10:00.*S03/)).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });

  it("無 shotNo 時 meta 僅顯示時間（兩版皆是）", () => {
    flags.chrome = false;
    const off = render(<NoteRow text="筆記" ts="06-15" />);
    expect(off.container.textContent).toContain("06-15");
    expect(off.container.textContent).not.toContain("·");
    off.unmount();

    flags.chrome = true;
    const on = render(<NoteRow text="筆記" ts="06-15" />);
    expect(on.container.textContent).toContain("06-15");
    expect(on.container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

describe("NotesPanel 空狀態（U-5 / AIDV-95 · /video 四態）", () => {
  it("旗標 OFF（預設）：空態用共用 Empty（role=status、'尚無筆記'）、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<NotesPanel />);
    expect(screen.getByText("尚無筆記")).toBeTruthy();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：空態改用 design-kit EmptyState（進 .aidv-kit、保留文字）", () => {
    flags.chrome = true;
    const { container } = render(<NotesPanel />);
    expect(screen.getByText("尚無筆記")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

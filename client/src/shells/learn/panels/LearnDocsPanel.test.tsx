// @vitest-environment jsdom
/**
 * LearnDocsPanel · DocCard（U-2 / AIDV-92 逐殼採用 · /learn）行為測試。
 *   · 旗標 OFF（預設）＝既有文件卡（標題＋摘要＋分類/難度徽章）＝零變化（不進 .aidv-kit）。
 *   · 旗標 ON       ＝design-kit 亮色暖光 ArticleCard（進 .aidv-kit；標題＋分類，設計刻意精簡）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const flags = vi.hoisted(() => ({ chrome: false }));
vi.mock("@/config/featureFlags", () => ({ get ENABLE_AIDV_CHROME() { return flags.chrome; } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { DocCard } from "./LearnDocsPanel";

const DOC = { id: 1, title: "分鏡方法論", summary: "如何拆鏡頭。", category: "分鏡", difficulty: "進階", featured: true };

afterEach(() => { cleanup(); flags.chrome = false; });

describe("LearnDocsPanel · DocCard（U-2 / AIDV-92 · /learn）", () => {
  it("旗標 OFF（預設）：既有卡，標題/摘要/分類在、未進設計套件範圍", () => {
    flags.chrome = false;
    const { container } = render(<DocCard doc={DOC} />);
    expect(screen.getByText("分鏡方法論")).toBeTruthy();
    expect(screen.getByText("如何拆鏡頭。")).toBeTruthy();
    expect(screen.getByText("分鏡")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).toBeNull();
  });

  it("旗標 ON：改用 design-kit ArticleCard（進 .aidv-kit；標題＋分類保留）", () => {
    flags.chrome = true;
    const { container } = render(<DocCard doc={DOC} />);
    expect(screen.getByText("分鏡方法論")).toBeTruthy();
    expect(screen.getByText("分鏡")).toBeTruthy();
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
  });
});

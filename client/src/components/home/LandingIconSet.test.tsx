// @vitest-environment jsdom
/**
 * LandingIconSet（U-10 / AIDV-119）design-kit icon set 區塊 render + a11y 測試。
 * 守住：四枚 lucide SVG icon（非 emoji）、每枚 icon 容器 role=img＋aria-label、
 *       標題/說明可見、區塊有可辨識名稱。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LandingIconSet, LANDING_ICONS } from "./LandingIconSet";

afterEach(() => cleanup());

describe("LandingIconSet（U-10 / AIDV-119）", () => {
  it("渲染四枚 icon 卡片，標題可見", () => {
    render(<LandingIconSet />);
    for (const it of LANDING_ICONS) {
      expect(screen.getByText(it.title)).toBeTruthy();
    }
  });

  it("每枚 icon 容器有 role=img＋aria-label（icon-only a11y）", () => {
    render(<LandingIconSet />);
    for (const it of LANDING_ICONS) {
      expect(screen.getByRole("img", { name: it.iconLabel })).toBeTruthy();
    }
  });

  it("icon 為 lucide SVG（非 emoji）", () => {
    const { container } = render(<LandingIconSet />);
    const svgs = container.querySelectorAll('[role="img"] svg');
    expect(svgs.length).toBe(LANDING_ICONS.length);
  });

  it("區塊有可辨識的 region 名稱", () => {
    render(<LandingIconSet />);
    expect(screen.getByRole("region", { name: "療癒影像工作室的四個支點" })).toBeTruthy();
  });
});

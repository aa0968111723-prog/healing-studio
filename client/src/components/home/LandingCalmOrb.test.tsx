// @vitest-environment jsdom
/**
 * LandingCalmOrb（U-10 / AIDV-119）calm orb 平靜光球 render + a11y 測試。
 * 守住：純裝飾預設 aria-hidden（不搶焦點）；給 label 時 role=img＋可辨識名稱；
 *       reduced-motion 守則隨元件注入（@media prefers-reduced-motion）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LandingCalmOrb } from "./LandingCalmOrb";

afterEach(() => cleanup());

describe("LandingCalmOrb（U-10 / AIDV-119）", () => {
  it("預設純裝飾 → aria-hidden、不暴露為 img", () => {
    const { container } = render(<LandingCalmOrb />);
    const orb = screen.getByTestId("landing-calm-orb");
    expect(orb.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it("給 label → role=img＋可辨識名稱（a11y）", () => {
    render(<LandingCalmOrb label="平靜光球" />);
    const orb = screen.getByRole("img", { name: "平靜光球" });
    expect(orb).toBeTruthy();
    expect(orb.getAttribute("aria-hidden")).toBeNull();
  });

  it("注入 reduced-motion 守則（動效低耗、reduced-motion 靜止）", () => {
    const { container } = render(<LandingCalmOrb />);
    const style = container.querySelector("style");
    expect(style?.textContent).toContain("prefers-reduced-motion");
    expect(style?.textContent).toContain("animation: none");
  });

  it("不同 size → 不同尺寸", () => {
    const { rerender } = render(<LandingCalmOrb size="sm" />);
    expect((screen.getByTestId("landing-calm-orb") as HTMLElement).style.width).toBe("160px");
    rerender(<LandingCalmOrb size="lg" />);
    expect((screen.getByTestId("landing-calm-orb") as HTMLElement).style.width).toBe("360px");
  });
});

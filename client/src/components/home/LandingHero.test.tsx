// @vitest-environment jsdom
/**
 * LandingHero（U-10 / AIDV-119）首頁 landing 門面 KV render + 旗標 + a11y 測試。
 * 守住：旗標關閉 → 整塊不渲染（零回歸／秒回滾）；開啟 → 北極星 logline、主/次 CTA、
 *       icon set、calm orb 都在；CTA 回呼觸發；orb 可單獨關閉。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { LandingHero } from "./LandingHero";

afterEach(() => cleanup());

describe("LandingHero（U-10 / AIDV-119）", () => {
  it("旗標關閉 → 整塊不渲染（零回歸）", () => {
    const { container } = render(<LandingHero enabled={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("旗標開啟 → 門面 region＋logline＋icon set 都在", () => {
    render(<LandingHero enabled />);
    expect(screen.getByTestId("landing-hero")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByTestId("landing-icon-set")).toBeTruthy();
  });

  it("主 CTA 觸發回呼（純前端、交給掛載端）", () => {
    const onPrimary = vi.fn();
    render(<LandingHero enabled primaryCta="開始" onPrimary={onPrimary} />);
    fireEvent.click(screen.getByText("開始"));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it("次 CTA 觸發回呼", () => {
    const onSecondary = vi.fn();
    render(<LandingHero enabled secondaryCta="逛逛" onSecondary={onSecondary} />);
    fireEvent.click(screen.getByText("逛逛"));
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("calm orb 可單獨關閉（showOrb=false），門面其餘仍在", () => {
    render(<LandingHero enabled showOrb={false} />);
    expect(screen.queryByTestId("landing-calm-orb")).toBeNull();
    expect(screen.getByTestId("landing-hero")).toBeTruthy();
  });

  it("calm orb 預設隨門面顯示", () => {
    render(<LandingHero enabled showOrb />);
    expect(screen.getByTestId("landing-calm-orb")).toBeTruthy();
  });
});

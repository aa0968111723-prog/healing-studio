// @vitest-environment jsdom
/**
 * SocialJourneyStepper · 九步旅程步進指示（U-6 / AIDV-96 · /social 視覺實裝）行為＋a11y 測試。
 * 守住：
 *   · 渲染九步 S1–S9（序號＋標籤都在），包進 .aidv-kit 範圍（token 才解析成設計套件原義）。
 *   · 目前步以 aria-current="step" 標記；其前為「已完成」、其後為「待辦」（色彩非唯一資訊：皆有文字）。
 *   · current 超界自動夾住（< 1 → 1；> 9 → 9）。
 *   · nav 有可及名稱（aria-label 含目前第幾步）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { SocialJourneyStepper, SOCIAL_JOURNEY_STEPS } from "./SocialJourneyStepper";

afterEach(() => cleanup());

describe("SocialJourneyStepper（U-6 / AIDV-96 · /social 九步旅程）", () => {
  it("渲染九步 S1–S9（序號＋標籤），且包在 .aidv-kit 範圍內", () => {
    const { container } = render(<SocialJourneyStepper current={1} />);
    expect(SOCIAL_JOURNEY_STEPS).toHaveLength(9);
    for (const s of SOCIAL_JOURNEY_STEPS) {
      expect(screen.getByText(s.label)).toBeTruthy();
    }
    expect(container.querySelector(".aidv-kit")).not.toBeNull();
    // 九個列表項（S1…S9）。
    expect(container.querySelectorAll("li")).toHaveLength(9);
  });

  it("目前步以 aria-current=step 標記，且帶可讀的「（目前）」文字", () => {
    render(<SocialJourneyStepper current={3} />);
    const items = screen.getAllByRole("listitem");
    const currentItems = items.filter((li) => li.getAttribute("aria-current") === "step");
    expect(currentItems).toHaveLength(1);
    // 第 3 步（文案）為目前步。
    expect(within(currentItems[0]).getByText("文案")).toBeTruthy();
    expect(within(currentItems[0]).getByText("（目前）")).toBeTruthy();
  });

  it("色彩非唯一資訊：已完成步給「已完成」文字、待辦步給「待辦」文字（sr-only）", () => {
    render(<SocialJourneyStepper current={5} />);
    // 目前步前有已完成（4 個），後有待辦（4 個）。
    expect(screen.getAllByText("已完成")).toHaveLength(4);
    expect(screen.getAllByText("待辦")).toHaveLength(4);
  });

  it("current 超界自動夾住（>9 → 第 9 步、<1 → 第 1 步）", () => {
    const { rerender } = render(<SocialJourneyStepper current={99} />);
    let nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toContain("目前第 9 步");

    rerender(<SocialJourneyStepper current={-5} />);
    nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toContain("目前第 1 步");
  });

  it("nav 地標有可及名稱（含步數）", () => {
    render(<SocialJourneyStepper current={4} />);
    const nav = screen.getByRole("navigation", { name: /社群九步旅程.*第 4 步.*共 9 步/ });
    expect(nav).toBeTruthy();
  });
});

// @vitest-environment jsdom
/**
 * design-kit Cockpit 元件（U-10 / AIDV-101 第三批）行為測試。
 * 守住互動：StageBar 選階段、PersonaSwitch、MemoryDBTabs、OrbBubble CTA、
 * ReadinessChip、CharacterCard。純元件、不接 spine。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { StageBar, PersonaSwitch, MemoryDBTabs, OrbBubble, ReadinessChip, CharacterCard, type DkStage } from "./cockpit";

afterEach(() => cleanup());

describe("design-kit Cockpit 元件（U-10 / AIDV-101）", () => {
  it("StageBar：點階段 → onSelect(id)", () => {
    const onSelect = vi.fn();
    const stages: DkStage[] = [
      { id: "world", name: "世界觀", status: "done" },
      { id: "script", name: "劇本", status: "current" },
      { id: "shot", name: "分鏡", status: "todo", warn: 2 },
    ];
    render(<StageBar stages={stages} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("分鏡"));
    expect(onSelect).toHaveBeenCalledWith("shot");
  });

  it("PersonaSwitch：點人格 → onChange", () => {
    const onChange = vi.fn();
    render(<PersonaSwitch value="calm" onChange={onChange} />);
    fireEvent.click(screen.getByText("創意"));
    expect(onChange).toHaveBeenCalledWith("creative");
  });

  it("MemoryDBTabs：點頁籤 → onSelect", () => {
    const onSelect = vi.fn();
    render(<MemoryDBTabs tabs={[{ id: "a", label: "角色" }, { id: "b", label: "場景" }]} active="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("場景"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("OrbBubble：CTA → onCta", () => {
    const onCta = vi.fn();
    render(<OrbBubble title="可以開工了" text="有就緒鏡" cta="看就緒鏡" onCta={onCta} level="hint" />);
    expect(screen.getByText("可以開工了")).toBeTruthy();
    fireEvent.click(screen.getByText("看就緒鏡"));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it("ReadinessChip：有 onClick → 點擊；預設標籤依 state", () => {
    const onClick = vi.fn();
    render(<ReadinessChip state="blocked" onClick={onClick} />);
    fireEvent.click(screen.getByText("擋下"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("CharacterCard：顯示分級＋點卡 → onClick", () => {
    const onClick = vi.fn();
    render(<CharacterCard name="密勒日巴" grade="precise" onClick={onClick} />);
    expect(screen.getByText("✅ 精準")).toBeTruthy();
    fireEvent.click(screen.getByText("密勒日巴"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

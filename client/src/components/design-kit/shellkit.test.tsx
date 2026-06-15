// @vitest-environment jsdom
/**
 * design-kit Shell-specific 元件（U-10 / AIDV-101 第四批 · 收尾）行為測試。
 * 守住互動：SubTabs/ProviderOption/AdminUserRow/ModelCard/ExportRatioCard/KeyRow。純元件、不接後端。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { SubTabs, ProviderOption, AdminUserRow, ModelCard, ExportRatioCard, KeyRow, type DkModel } from "./shellkit";

afterEach(() => cleanup());

describe("design-kit Shell-specific 元件（U-10 / AIDV-101）", () => {
  it("SubTabs：點子分頁 → onSelect(id)", () => {
    const onSelect = vi.fn();
    render(<SubTabs tabs={[{ id: "a", label: "一般" }, { id: "b", label: "Provider" }]} active="a" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Provider"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("ProviderOption：選取＋測試各觸發其回呼", () => {
    const onSelect = vi.fn(), onTest = vi.fn();
    render(<ProviderOption name="fal" status="ok" onSelect={onSelect} onTest={onTest} />);
    fireEvent.click(screen.getByText("fal"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("測試"));
    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it("AdminUserRow：編輯/停權 → onAction(action)", () => {
    const onAction = vi.fn();
    render(<AdminUserRow name="Bruce" role="owner" credits={500} onAction={onAction} />);
    fireEvent.click(screen.getByText("編輯"));
    expect(onAction).toHaveBeenLastCalledWith("edit");
    fireEvent.click(screen.getByText("停權"));
    expect(onAction).toHaveBeenLastCalledWith("suspend");
  });

  it("ModelCard：顯示狀態＋點卡 → onClick", () => {
    const onClick = vi.fn();
    const model: DkModel = { id: "m1", name: "Veo 3.1", vendor: "Google", kind: "video", status: "可用", brainRole: "生成腦" };
    render(<ModelCard model={model} onClick={onClick} />);
    expect(screen.getByText("Veo 3.1")).toBeTruthy();
    expect(screen.getByText("可用")).toBeTruthy();
    fireEvent.click(screen.getByText("Veo 3.1"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ExportRatioCard：aria-pressed 反映 selected；點擊 → onClick", () => {
    const onClick = vi.fn();
    render(<ExportRatioCard label="IG 貼文" ratio="1:1" dims="1080×1080" selected onClick={onClick} />);
    const btn = screen.getByRole("button", { pressed: true });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("KeyRow：測試/刪除各觸發回呼", () => {
    const onTest = vi.fn(), onDelete = vi.fn();
    render(<KeyRow name="FAL_KEY" status="ok" onTest={onTest} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("測試"));
    expect(onTest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("刪除"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

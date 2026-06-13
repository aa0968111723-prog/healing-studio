// @vitest-environment jsdom
/**
 * CockpitColumns（W1-9 手機版導演台 RWD）行為測試。
 *
 * 守住驗收：
 *   1. 預設停在「畫布」（手機落地即在六步工作流所在欄）；三欄內容皆渲染。
 *   2. <lg：只有 active 欄帶 block、其餘 hidden；點底部頁籤可切到各欄（脊椎/畫布/Context）。
 *   3. showSidecar=false：無 Context 頁籤與欄。
 *   4. 桌機不變：grid 仍帶 lg:grid-cols、欄外層 lg:contents（還原成 grid 直接子項）、
 *      頁籤列 lg:hidden。
 *
 * 純展示元件，免 provider mock。jsdom 不套 CSS，故以 className token 斷言斷點行為。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";

import { CockpitColumns } from "./CockpitColumns";

const spine = <div>SPINE_CONTENT</div>;
const canvas = <div>CANVAS_CONTENT</div>;
const context = <div>CONTEXT_CONTENT</div>;

afterEach(() => cleanup());

describe("CockpitColumns RWD（W1-9）", () => {
  it("預設停在『畫布』；三欄內容與三頁籤皆在（showSidecar）", () => {
    render(<CockpitColumns showSidecar spine={spine} canvas={canvas} context={context} />);
    expect(screen.getByText("SPINE_CONTENT")).toBeTruthy();
    expect(screen.getByText("CANVAS_CONTENT")).toBeTruthy();
    expect(screen.getByText("CONTEXT_CONTENT")).toBeTruthy();

    expect(screen.getByTestId("cockpit-tab-canvas").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("cockpit-tab-spine").getAttribute("aria-selected")).toBe("false");
    // <lg：active=canvas 欄顯示、其餘 hidden
    expect(screen.getByTestId("cockpit-col-canvas").className).toContain("block");
    expect(screen.getByTestId("cockpit-col-spine").className).toContain("hidden");
  });

  it("點底部頁籤切換 active 欄（手機可達脊椎/畫布/Context）", () => {
    render(<CockpitColumns showSidecar spine={spine} canvas={canvas} context={context} />);

    fireEvent.click(screen.getByTestId("cockpit-tab-spine"));
    expect(screen.getByTestId("cockpit-tab-spine").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("cockpit-col-spine").className).toContain("block");
    expect(screen.getByTestId("cockpit-col-canvas").className).toContain("hidden");

    fireEvent.click(screen.getByTestId("cockpit-tab-context"));
    expect(screen.getByTestId("cockpit-tab-context").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("cockpit-col-context").className).toContain("block");
    expect(screen.getByTestId("cockpit-col-spine").className).toContain("hidden");
  });

  it("showSidecar=false：無 Context 頁籤與欄；保留脊椎/畫布", () => {
    render(<CockpitColumns showSidecar={false} spine={spine} canvas={canvas} context={context} />);
    expect(screen.queryByTestId("cockpit-tab-context")).toBeNull();
    expect(screen.queryByTestId("cockpit-col-context")).toBeNull();
    expect(screen.queryByText("CONTEXT_CONTENT")).toBeNull();
    expect(screen.getByTestId("cockpit-tab-spine")).toBeTruthy();
    expect(screen.getByTestId("cockpit-tab-canvas")).toBeTruthy();
  });

  it("桌機不變：grid 帶 lg:grid-cols、欄外層 lg:contents、頁籤列 lg:hidden", () => {
    const { container } = render(<CockpitColumns showSidecar spine={spine} canvas={canvas} context={context} />);
    const grid = container.querySelector(".grid") as HTMLElement;
    expect(grid.className).toContain("lg:grid-cols-[");
    expect(screen.getByTestId("cockpit-col-canvas").className).toContain("lg:contents");
    expect(screen.getByRole("tablist").className).toContain("lg:hidden");
  });
});

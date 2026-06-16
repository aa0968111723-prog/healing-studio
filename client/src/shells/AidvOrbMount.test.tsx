// @vitest-environment jsdom
/**
 * AidvOrbMount（AIDV-114 第3＋4片）— U-11 新光球真站掛載＋唯讀 adapter 行為測試。
 * 守住：FAB 渲染、點開面板、本頁分頁示範提示與 Flow 展示牆可見；
 * 純對應 orbStateToMood / pathToPageLabel。
 * 旗標 gate（ENABLE_AIDV_CHROME）由 DashboardLayout 控制，非本元件職責。
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { AidvOrbMount, orbStateToMood, pathToPageLabel } from "./AidvOrbMount";

afterEach(() => cleanup());

describe("AidvOrbMount adapter 純對應（U-11 / AIDV-114 第4片）", () => {
  it("orbStateToMood：活動狀態 → 心情四態", () => {
    expect(orbStateToMood("idle")).toBe("idle");
    expect(orbStateToMood("thinking")).toBe("thinking");
    expect(orbStateToMood("searching")).toBe("thinking");
    expect(orbStateToMood("listening")).toBe("thinking");
    expect(orbStateToMood("executing")).toBe("working");
    expect(orbStateToMood("success")).toBe("done");
    expect(orbStateToMood("error")).toBe("idle");
  });

  it("pathToPageLabel：路由 → 友善標籤；未知 → 本頁", () => {
    expect(pathToPageLabel("/video")).toBe("影片工作室");
    expect(pathToPageLabel("/video/director")).toBe("影片工作室");
    expect(pathToPageLabel("/settings")).toBe("設定");
    expect(pathToPageLabel("/unknown")).toBe("本頁");
  });
});

describe("AidvOrbMount 掛載（U-11 / AIDV-114 第3片）", () => {
  it("掛載：渲染光球 FAB（aria-expanded 預設 false）", () => {
    render(<AidvOrbMount />);
    const fab = screen.getByRole("button", { name: "光球助手" });
    expect(fab).toBeTruthy();
    expect(fab.getAttribute("aria-expanded")).toBe("false");
  });

  it("點 FAB → 開面板，本頁分頁顯示示範情境提示＋Flow 展示牆", () => {
    render(<AidvOrbMount />);
    fireEvent.click(screen.getByRole("button", { name: "光球助手" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/點上方分頁看本頁提示/)).toBeTruthy();
    expect(screen.getByText("Flow 展示牆")).toBeTruthy();
    expect(screen.getByText("成片工作流（示範）")).toBeTruthy();
  });
});

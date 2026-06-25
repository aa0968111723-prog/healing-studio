// @vitest-environment jsdom
/**
 * SSEFallbackBanner — AIDV-353
 * 驗收條件：
 * - SSE 斷線 + 有進行中任務 → banner 顯示「即時更新暫時中斷，每 5 秒自動更新」
 * - SSE 正常 → 不顯示
 * - 無進行中任務 → 不顯示
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SSEFallbackBanner } from "./SSEFallbackBanner";

afterEach(() => cleanup());

vi.mock("@/contexts/BackgroundTasksContext", () => ({
  useBackgroundTasks: vi.fn(),
}));

import { useBackgroundTasks } from "@/contexts/BackgroundTasksContext";
const mockUse = useBackgroundTasks as ReturnType<typeof vi.fn>;

describe("SSEFallbackBanner (AIDV-353)", () => {
  it("SSE 斷線且有進行中任務 → 顯示 banner", () => {
    mockUse.mockReturnValue({ sseConnected: false, activeCount: 2 });
    render(<SSEFallbackBanner />);
    expect(screen.getByText("即時更新暫時中斷，每 5 秒自動更新")).toBeDefined();
  });

  it("SSE 正常 → 不顯示 banner", () => {
    mockUse.mockReturnValue({ sseConnected: true, activeCount: 2 });
    render(<SSEFallbackBanner />);
    expect(screen.queryByText("即時更新暫時中斷，每 5 秒自動更新")).toBeNull();
  });

  it("無進行中任務 → 不顯示（即使 SSE 斷線）", () => {
    mockUse.mockReturnValue({ sseConnected: false, activeCount: 0 });
    render(<SSEFallbackBanner />);
    expect(screen.queryByText("即時更新暫時中斷，每 5 秒自動更新")).toBeNull();
  });

  it("banner 有正確 role 和 aria-live 屬性", () => {
    mockUse.mockReturnValue({ sseConnected: false, activeCount: 1 });
    render(<SSEFallbackBanner />);
    const el = screen.getByRole("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });
});

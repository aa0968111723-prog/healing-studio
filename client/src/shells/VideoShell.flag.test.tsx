// ============================================================================
// tests/cockpit-flag-gating.test.tsx — VideoShell 旗標分支測試（jsdom）
// ----------------------------------------------------------------------------
// 放置位置（套用時）：client/src/shells/VideoShell.flag.test.tsx（或任何 vitest 掃描得到處）。
// 證明「零行為改變保證」的延伸：ENABLE_VIDEO_COCKPIT=OFF → 退回 P0 ShellFrame；=ON → P2 座艙。
// 用輕量替身 mock 兩個 frame，避免拉進 DashboardLayout 等重相依。
// ============================================================================
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// 兩個 frame 用替身（兩個分支共用）。
vi.mock("@/shells/ShellFrame", () => ({
  ShellFrame: ({ shell }: { shell: string }) => <div data-testid="p0-shellframe">{shell}</div>,
}));
vi.mock("@/shells/video/VideoCockpitFrame", () => ({
  VideoCockpitFrame: () => <div data-testid="p2-cockpit" />,
}));

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderWithCockpitFlag(enabled: boolean) {
  vi.resetModules();
  // 以 doMock 控制旗標（非 hoist；對之後的 dynamic import 生效）。
  vi.doMock("@/config/videoFlags", () => ({
    ENABLE_VIDEO_COCKPIT: enabled,
    VIDEO_SPINE_MOCK: false,
    VIDEO_FLAGS: { ENABLE_VIDEO_COCKPIT: enabled, VIDEO_SPINE_MOCK: false },
  }));
  const mod = await import("@/shells/VideoShell");
  render(<mod.VideoShell />);
}

describe("VideoShell 旗標分支", () => {
  it("ENABLE_VIDEO_COCKPIT=OFF → 退回 P0 ShellFrame（shell=video），不渲染座艙", async () => {
    await renderWithCockpitFlag(false);
    expect(screen.getByTestId("p0-shellframe")).toBeTruthy();
    expect(screen.getByTestId("p0-shellframe").textContent).toBe("video");
    expect(screen.queryByTestId("p2-cockpit")).toBeNull();
  });

  it("ENABLE_VIDEO_COCKPIT=ON（預設）→ 渲染 P2 座艙，不渲染 P0 ShellFrame", async () => {
    await renderWithCockpitFlag(true);
    expect(screen.getByTestId("p2-cockpit")).toBeTruthy();
    expect(screen.queryByTestId("p0-shellframe")).toBeNull();
  });
});

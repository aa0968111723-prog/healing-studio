// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyToClipboard } from "./copyToClipboard";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
import { toast } from "sonner";

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    // 還原可能被覆寫的 clipboard / execCommand
    vi.restoreAllMocks();
  });

  it("成功複製時回傳 true 並 toast.success（含 label）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = await copyToClipboard("hello", "連結");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(toast.success).toHaveBeenCalledWith("已複製連結");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("被拒且兜底也失敗時回傳 false 並 toast.error（不謊報成功）", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    Object.assign(navigator, { clipboard: { writeText } });
    // jsdom 未實作 execCommand，先掛上再 mock 兜底失敗
    document.execCommand = vi.fn().mockReturnValue(false);

    const ok = await copyToClipboard("hello", "連結");

    expect(ok).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("複製失敗，請手動選取");
  });

  it("Clipboard API 被拒但 execCommand 兜底成功 → true + success", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    document.execCommand = vi.fn().mockReturnValue(true);

    const ok = await copyToClipboard("hello");

    expect(ok).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("已複製");
  });

  it("silent 模式不顯示任何 toast", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = await copyToClipboard("hello", { silent: true });

    expect(ok).toBe(true);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

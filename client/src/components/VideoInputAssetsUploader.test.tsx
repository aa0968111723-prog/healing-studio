// @vitest-environment jsdom
/**
 * VideoInputAssetsUploader.test.tsx — /video 素材上傳區塊（AIDV-270 AC2）
 *
 * 釘住：合法檔上傳 → onChange 收到契約物件；非法型別 → toast 錯誤且不上傳；
 * 超過 8 個上限 → 擋下；明選角色不符（uploadVideoInputAsset throw）→ toast 錯誤。
 * uploadVideoInputAsset / uploadFileToS3 皆 mock，不打真網路。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastErrorMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastErrorMock(...a),
    success: vi.fn(),
  },
}));

const uploadFileToS3Mock = vi.fn();
vi.mock("@/lib/upload", () => ({
  uploadFileToS3: (...a: unknown[]) => uploadFileToS3Mock(...a),
}));

const uploadVideoInputAssetMock = vi.fn();
vi.mock("@/lib/videoInputAssets", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/videoInputAssets")>();
  return {
    ...actual,
    uploadVideoInputAsset: (...a: unknown[]) => uploadVideoInputAssetMock(...a),
  };
});

import { VideoInputAssetsUploader } from "./VideoInputAssetsUploader";
import type { VideoInputAsset } from "@/lib/videoInputAssets";

const pngFile = (name = "a.png", size = 100): File => {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const asset = (url: string): VideoInputAsset => ({
  type: "image",
  url,
  role: "style_reference",
});

function getFileInput(): HTMLInputElement {
  return screen.getByLabelText("選擇素材檔案") as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadVideoInputAssetMock.mockResolvedValue(asset("https://cdn.x/uploaded.png"));
});

afterEach(() => cleanup());

describe("VideoInputAssetsUploader (AIDV-270 AC2)", () => {
  it("合法檔案選擇 → uploadVideoInputAsset 呼叫、onChange 收到契約物件", async () => {
    const onChange = vi.fn();
    render(<VideoInputAssetsUploader value={[]} onChange={onChange} />);

    fireEvent.change(getFileInput(), { target: { files: [pngFile()] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([asset("https://cdn.x/uploaded.png")]);
    });
    expect(uploadVideoInputAssetMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("非法型別（PDF）→ toast 錯誤、不上傳、onChange 不被呼叫", async () => {
    const onChange = vi.fn();
    render(<VideoInputAssetsUploader value={[]} onChange={onChange} />);

    const bad = new File(["x"], "doc.pdf", { type: "application/pdf" });
    fireEvent.change(getFileInput(), { target: { files: [bad] } });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("不支援的檔案類型")
      );
    });
    expect(uploadVideoInputAssetMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("已滿 8 個再加第 9 個 → 擋下（toast 上限訊息、不上傳）", async () => {
    const onChange = vi.fn();
    const full = Array.from({ length: 8 }, (_, i) => asset(`https://cdn.x/${i}.png`));
    render(<VideoInputAssetsUploader value={full} onChange={onChange} />);

    fireEvent.change(getFileInput(), { target: { files: [pngFile("ninth.png")] } });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(expect.stringContaining("上限為 8 個"));
    });
    expect(uploadVideoInputAssetMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("上傳失敗（明選角色不符 throw）→ toast 顯示錯誤訊息、onChange 不被呼叫", async () => {
    uploadVideoInputAssetMock.mockRejectedValue(new Error("背景音樂需為音訊檔"));
    const onChange = vi.fn();
    render(<VideoInputAssetsUploader value={[]} onChange={onChange} />);

    fireEvent.change(getFileInput(), { target: { files: [pngFile()] } });

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("背景音樂需為音訊檔");
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("拖放路徑（onDrop）也走同一驗證＋上傳流程", async () => {
    const onChange = vi.fn();
    render(<VideoInputAssetsUploader value={[]} onChange={onChange} />);

    const dropZone = screen.getByLabelText("拖放或點擊上傳素材");
    fireEvent.drop(dropZone, { dataTransfer: { files: [pngFile("drop.png")] } });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([asset("https://cdn.x/uploaded.png")]);
    });
  });

  it("同批多檔累積到同一次 onChange 陣列（受控 prop 不各自從舊值出發）", async () => {
    uploadVideoInputAssetMock
      .mockResolvedValueOnce(asset("https://cdn.x/1.png"))
      .mockResolvedValueOnce(asset("https://cdn.x/2.png"));
    const onChange = vi.fn();
    render(<VideoInputAssetsUploader value={[]} onChange={onChange} />);

    fireEvent.change(getFileInput(), {
      target: { files: [pngFile("1.png"), pngFile("2.png")] },
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([
        asset("https://cdn.x/1.png"),
        asset("https://cdn.x/2.png"),
      ]);
    });
  });

  it("移除鈕 → onChange 收到刪除後的陣列", () => {
    const onChange = vi.fn();
    const items = [asset("https://cdn.x/keep.png"), asset("https://cdn.x/drop.png")];
    render(<VideoInputAssetsUploader value={items} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText("移除素材 drop.png"));
    expect(onChange).toHaveBeenCalledWith([asset("https://cdn.x/keep.png")]);
  });
});

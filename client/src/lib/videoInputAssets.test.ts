/**
 * videoInputAssets.test.ts — 前端多模態素材上傳（AIDV-270）
 *
 * 釘住：驗證委派 shared、presign 上傳結果被包成契約物件、明選角色與模態不符時
 * throw（不靜默校正）、不合法檔案在上傳前即被擋（uploadFileToS3 不被呼叫）、
 * too_large 訊息依模態顯示 10MB/20MB。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpload = vi.fn();
vi.mock("./upload", () => ({
  uploadFileToS3: (...a: unknown[]) => mockUpload(...a),
}));

import {
  uploadVideoInputAsset,
  inputAssetRejectionMessage,
} from "./videoInputAssets";

/** 造一個 File-like 物件（node 環境不需真 File）。 */
function fakeFile(type: string, size: number, name = "x"): File {
  return { type, size, name } as unknown as File;
}

describe("inputAssetRejectionMessage", () => {
  it("合法 PNG → null", () => {
    expect(inputAssetRejectionMessage(fakeFile("image/png", 100))).toBeNull();
  });
  it("不支援型別 → 訊息", () => {
    expect(inputAssetRejectionMessage(fakeFile("application/pdf", 100))).toContain("不支援");
  });
  it("影像超過上限 → 訊息含 10MB", () => {
    const msg = inputAssetRejectionMessage(fakeFile("image/png", 10 * 1024 * 1024 + 1));
    expect(msg).toContain("10MB");
  });
  it("音訊超過上限 → 訊息含 20MB", () => {
    const msg = inputAssetRejectionMessage(fakeFile("audio/mpeg", 20 * 1024 * 1024 + 1));
    expect(msg).toContain("20MB");
  });
  it("0-byte 檔 → 「檔案是空的」", () => {
    expect(inputAssetRejectionMessage(fakeFile("image/png", 0))).toBe("檔案是空的");
  });
  it("空 MIME 但副檔名可辨識（a.png）→ 通過", () => {
    expect(inputAssetRejectionMessage(fakeFile("", 100, "a.png"))).toBeNull();
  });
});

describe("uploadVideoInputAsset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpload.mockResolvedValue({ url: "https://cdn.x/uploaded.png", fileKey: "k" });
  });

  it("上傳影像 → 回傳 {type:image, url, role:style_reference}", async () => {
    const asset = await uploadVideoInputAsset(fakeFile("image/png", 100), "style_reference");
    expect(asset).toEqual({
      type: "image",
      url: "https://cdn.x/uploaded.png",
      role: "style_reference",
    });
    expect(mockUpload).toHaveBeenCalledOnce();
  });

  it("MP3 被明選成 style_reference → throw（不靜默校正）且不上傳", async () => {
    await expect(
      uploadVideoInputAsset(fakeFile("audio/mpeg", 100), "style_reference"),
    ).rejects.toThrow("視覺風格參考需為影像檔");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("PNG 被明選成 background_music → throw「背景音樂需為音訊檔」", async () => {
    await expect(
      uploadVideoInputAsset(fakeFile("image/png", 100), "background_music"),
    ).rejects.toThrow("背景音樂需為音訊檔");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("未指定角色 → 依模態取預設（image→style_reference）", async () => {
    const asset = await uploadVideoInputAsset(fakeFile("image/jpeg", 100));
    expect(asset.role).toBe("style_reference");
  });

  it("未指定角色 → 音訊預設 background_music", async () => {
    mockUpload.mockResolvedValue({ url: "https://cdn.x/bgm.mp3", fileKey: "k" });
    const asset = await uploadVideoInputAsset(fakeFile("audio/mpeg", 100));
    expect(asset.type).toBe("audio");
    expect(asset.role).toBe("background_music");
  });

  it("不支援型別 → throw 且不呼叫 uploadFileToS3", async () => {
    await expect(uploadVideoInputAsset(fakeFile("application/pdf", 100))).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("影像超過 10MB → throw 且不呼叫 uploadFileToS3", async () => {
    await expect(
      uploadVideoInputAsset(fakeFile("image/png", 10 * 1024 * 1024 + 1)),
    ).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("音訊超過 20MB → throw 且不呼叫 uploadFileToS3", async () => {
    await expect(
      uploadVideoInputAsset(fakeFile("audio/wav", 20 * 1024 * 1024 + 1)),
    ).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("0-byte 檔 → throw「檔案是空的」且不上傳", async () => {
    await expect(uploadVideoInputAsset(fakeFile("image/png", 0))).rejects.toThrow(
      "檔案是空的",
    );
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

/**
 * videoInputAssets.test.ts — 前端多模態素材上傳（AIDV-270）
 *
 * 釘住：驗證委派 shared、presign 上傳結果被包成契約物件、角色與模態不符時自動校正、
 * 不合法檔案在上傳前即被擋（uploadFileToS3 不被呼叫）。
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
  it("超過上限 → 訊息含 MB", () => {
    const msg = inputAssetRejectionMessage(fakeFile("image/png", 51 * 1024 * 1024));
    expect(msg).toContain("50MB");
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

  it("MP3 被指定成 style_reference → 角色校正為 background_music", async () => {
    mockUpload.mockResolvedValue({ url: "https://cdn.x/bgm.mp3", fileKey: "k" });
    const asset = await uploadVideoInputAsset(fakeFile("audio/mpeg", 100), "style_reference");
    expect(asset.type).toBe("audio");
    expect(asset.role).toBe("background_music");
  });

  it("未指定角色 → 依模態取預設（image→style_reference）", async () => {
    const asset = await uploadVideoInputAsset(fakeFile("image/jpeg", 100));
    expect(asset.role).toBe("style_reference");
  });

  it("不支援型別 → throw 且不呼叫 uploadFileToS3", async () => {
    await expect(uploadVideoInputAsset(fakeFile("application/pdf", 100))).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("超過 50MB → throw 且不呼叫 uploadFileToS3", async () => {
    await expect(
      uploadVideoInputAsset(fakeFile("image/png", 51 * 1024 * 1024)),
    ).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

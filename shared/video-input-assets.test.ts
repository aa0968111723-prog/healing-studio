/**
 * video-input-assets.test.ts — /video 多模態輸入契約（AIDV-270）
 *
 * source-anchored：釘住 Zod 驗證、角色↔模態一致性、URL SSRF 防線、
 * fal image_url 選取優先序、檔案白名單與 per-type 大小上限
 * （image 10MB / audio 20MB，鏡射 uploadRoute PER_KIND_MAX_BYTES）。
 * 任一規則被改動（含常數字面值）即應變紅。
 */

import { describe, it, expect } from "vitest";
import {
  MAX_INPUT_ASSETS,
  MAX_INPUT_ASSET_BYTES_BY_TYPE,
  ROLE_TO_TYPE,
  videoInputAssetSchema,
  videoInputAssetsSchema,
  selectFalImageUrl,
  inferAssetTypeFromMime,
  validateAssetFile,
  defaultRoleForType,
  type VideoInputAsset,
} from "./video-input-assets";

const img = (
  url: string,
  role: "style_reference" | "product_shot" = "style_reference",
): VideoInputAsset => ({ type: "image", url, role });
const audio = (url: string): VideoInputAsset => ({
  type: "audio",
  url,
  role: "background_music",
});

describe("videoInputAssetSchema — 單一素材驗證", () => {
  it("接受合法影像素材（style_reference）", () => {
    expect(videoInputAssetSchema.safeParse(img("https://cdn.x/a.png")).success).toBe(true);
  });

  it("接受合法音訊素材（background_music）", () => {
    expect(videoInputAssetSchema.safeParse(audio("https://cdn.x/bgm.mp3")).success).toBe(true);
  });

  it("角色↔模態不一致即拒絕（audio 標成 style_reference）", () => {
    const bad = { type: "audio", url: "https://cdn.x/x.mp3", role: "style_reference" };
    const res = videoInputAssetSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("角色↔模態不一致即拒絕（image 標成 background_music）", () => {
    const bad = { type: "image", url: "https://cdn.x/x.png", role: "background_music" };
    expect(videoInputAssetSchema.safeParse(bad).success).toBe(false);
  });

  it("非法 URL 拒絕", () => {
    const bad = { type: "image", url: "not-a-url", role: "style_reference" };
    expect(videoInputAssetSchema.safeParse(bad).success).toBe(false);
  });

  it("未知 role 拒絕", () => {
    const bad = { type: "image", url: "https://cdn.x/x.png", role: "logo" };
    expect(videoInputAssetSchema.safeParse(bad).success).toBe(false);
  });

  it("audio 標成 product_shot 拒絕；image 標成 product_shot 通過", () => {
    expect(
      videoInputAssetSchema.safeParse({
        type: "audio",
        url: "https://cdn.x/x.mp3",
        role: "product_shot",
      }).success,
    ).toBe(false);
    expect(
      videoInputAssetSchema.safeParse({
        type: "image",
        url: "https://cdn.x/x.png",
        role: "product_shot",
      }).success,
    ).toBe(true);
  });

  it("ROLE_TO_TYPE 對照維持契約（style/product→image、bgm→audio）", () => {
    expect(ROLE_TO_TYPE).toEqual({
      style_reference: "image",
      product_shot: "image",
      background_music: "audio",
    });
  });
});

describe("videoInputAssetSchema — URL SSRF 防線（shared/safe-url）", () => {
  const withUrl = (url: string) => ({ type: "image" as const, url, role: "style_reference" as const });

  it("合法公網 https URL 通過", () => {
    expect(videoInputAssetSchema.safeParse(withUrl("https://cdn.example.com/a.png")).success).toBe(true);
  });

  it.each([
    ["javascript scheme", "javascript:alert(1)"],
    ["data URI", "data:text/html,x"],
    ["ftp scheme", "ftp://x/a.png"],
    ["雲端 metadata IP", "http://169.254.169.254/x"],
    ["http（非 https）也拒", "http://example.com/a.png"],
    ["私網 IP（https 也擋）", "https://192.168.1.1/a.png"],
  ])("%s → 拒絕", (_name, url) => {
    expect(videoInputAssetSchema.safeParse(withUrl(url)).success).toBe(false);
  });

  it("url 長度 2048 通過、2049 拒絕", () => {
    // https://cdn.x/ = 14 字元；補 path 湊到剛好 2048 / 2049。
    const base = "https://cdn.x/";
    const ok = base + "a".repeat(2048 - base.length);
    const tooLong = base + "a".repeat(2049 - base.length);
    expect(ok).toHaveLength(2048);
    expect(tooLong).toHaveLength(2049);
    expect(videoInputAssetSchema.safeParse(withUrl(ok)).success).toBe(true);
    expect(videoInputAssetSchema.safeParse(withUrl(tooLong)).success).toBe(false);
  });
});

describe("videoInputAssetsSchema — 陣列與數量上限", () => {
  it("MAX_INPUT_ASSETS 契約字面值＝8", () => {
    expect(MAX_INPUT_ASSETS).toBe(8);
  });

  it("空陣列合法", () => {
    expect(videoInputAssetsSchema.safeParse([]).success).toBe(true);
  });

  it(`剛好 ${MAX_INPUT_ASSETS} 個合法`, () => {
    const arr = Array.from({ length: MAX_INPUT_ASSETS }, (_, i) => img(`https://cdn.x/${i}.png`));
    expect(videoInputAssetsSchema.safeParse(arr).success).toBe(true);
  });

  it(`超過 ${MAX_INPUT_ASSETS} 個即拒絕`, () => {
    const arr = Array.from({ length: MAX_INPUT_ASSETS + 1 }, (_, i) => img(`https://cdn.x/${i}.png`));
    expect(videoInputAssetsSchema.safeParse(arr).success).toBe(false);
  });
});

describe("selectFalImageUrl — 影像 → fal image_url 選取", () => {
  it("無素材 / 空 → null（維持既有純文字路徑）", () => {
    expect(selectFalImageUrl(null)).toBeNull();
    expect(selectFalImageUrl(undefined)).toBeNull();
    expect(selectFalImageUrl([])).toBeNull();
  });

  it("只有音訊 → null（音訊不當 image_url）", () => {
    expect(selectFalImageUrl([audio("https://cdn.x/bgm.mp3")])).toBeNull();
  });

  it("style_reference 優先於 product_shot", () => {
    const assets = [
      img("https://cdn.x/product.png", "product_shot"),
      img("https://cdn.x/style.png", "style_reference"),
    ];
    expect(selectFalImageUrl(assets)).toBe("https://cdn.x/style.png");
  });

  it("無 style_reference 時取 product_shot", () => {
    const assets = [
      audio("https://cdn.x/bgm.mp3"),
      img("https://cdn.x/product.png", "product_shot"),
    ];
    expect(selectFalImageUrl(assets)).toBe("https://cdn.x/product.png");
  });

  it("皆無指定角色偏好時取第一張影像", () => {
    // 兩張都是 product_shot（無 style_reference）→ 取第一張出現的影像
    const assets = [
      img("https://cdn.x/first.png", "product_shot"),
      img("https://cdn.x/second.png", "product_shot"),
    ];
    expect(selectFalImageUrl(assets)).toBe("https://cdn.x/first.png");
  });
});

describe("檔案白名單 / 大小驗證", () => {
  it("PNG/JPG → image；MP3/WAV → audio", () => {
    expect(inferAssetTypeFromMime("image/png")).toBe("image");
    expect(inferAssetTypeFromMime("image/jpeg")).toBe("image");
    expect(inferAssetTypeFromMime("audio/mpeg")).toBe("audio");
    expect(inferAssetTypeFromMime("audio/wav")).toBe("audio");
  });

  it("MIME 別名與大小寫容錯：audio/mp3、audio/x-wav、audio/wave、IMAGE/PNG", () => {
    expect(inferAssetTypeFromMime("audio/mp3")).toBe("audio");
    expect(inferAssetTypeFromMime("audio/x-wav")).toBe("audio");
    expect(inferAssetTypeFromMime("audio/wave")).toBe("audio");
    expect(inferAssetTypeFromMime("IMAGE/PNG")).toBe("image");
  });

  it("帶參數的 MIME（image/png; charset=binary）正規化後仍辨識", () => {
    expect(inferAssetTypeFromMime("image/png; charset=binary")).toBe("image");
  });

  it("空 MIME 依副檔名 fallback：a.png→image、a.exe→null", () => {
    expect(inferAssetTypeFromMime("", "a.png")).toBe("image");
    expect(inferAssetTypeFromMime("", "a.exe")).toBeNull();
    expect(validateAssetFile({ mime: "", sizeBytes: 100, fileName: "a.png" })).toEqual({
      ok: true,
      type: "image",
    });
    expect(validateAssetFile({ mime: "", sizeBytes: 100, fileName: "a.exe" })).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("不支援型別 → null / unsupported_type", () => {
    expect(inferAssetTypeFromMime("application/pdf")).toBeNull();
    expect(validateAssetFile({ mime: "application/pdf", sizeBytes: 10 })).toEqual({
      ok: false,
      reason: "unsupported_type",
    });
  });

  it("per-type 上限契約字面值：image 10485760、audio 20971520（鏡射 uploadRoute PER_KIND_MAX_BYTES）", () => {
    expect(MAX_INPUT_ASSET_BYTES_BY_TYPE.image).toBe(10485760);
    expect(MAX_INPUT_ASSET_BYTES_BY_TYPE.audio).toBe(20971520);
  });

  it("image 剛好 10MB 通過、10MB+1 → too_large", () => {
    expect(
      validateAssetFile({ mime: "image/png", sizeBytes: MAX_INPUT_ASSET_BYTES_BY_TYPE.image }),
    ).toEqual({ ok: true, type: "image" });
    expect(
      validateAssetFile({ mime: "image/png", sizeBytes: MAX_INPUT_ASSET_BYTES_BY_TYPE.image + 1 }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("audio 剛好 20MB 通過、20MB+1 → too_large", () => {
    expect(
      validateAssetFile({ mime: "audio/mpeg", sizeBytes: MAX_INPUT_ASSET_BYTES_BY_TYPE.audio }),
    ).toEqual({ ok: true, type: "audio" });
    expect(
      validateAssetFile({ mime: "audio/mpeg", sizeBytes: MAX_INPUT_ASSET_BYTES_BY_TYPE.audio + 1 }),
    ).toEqual({ ok: false, reason: "too_large" });
  });

  it("0-byte / 負值 → empty_file", () => {
    expect(validateAssetFile({ mime: "image/png", sizeBytes: 0 })).toEqual({
      ok: false,
      reason: "empty_file",
    });
    expect(validateAssetFile({ mime: "audio/mpeg", sizeBytes: -1 })).toEqual({
      ok: false,
      reason: "empty_file",
    });
  });

  it("defaultRoleForType：image→style_reference、audio→background_music", () => {
    expect(defaultRoleForType("image")).toBe("style_reference");
    expect(defaultRoleForType("audio")).toBe("background_music");
  });
});

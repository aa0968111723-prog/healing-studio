/**
 * signed-upload.test.ts — AIDV-15：Signed-URL 直傳（廢 base64）核心邏輯測試
 *
 * 鎖定的生產契約：
 *   1. presign 產出 scoped（uploads/<userId>/…）、限型別/大小的 PUT URL。
 *   2. 旗標 OFF / 無 R2 設定 / demo → isSignedUploadAvailable()=false（路由回 503，
 *      client 回退既有 base64，既有上傳零破壞）。
 *   3. 大小 / MIME allowlist 驗證在 presign 階段把關（直傳繞過 server buffer）。
 *   4. finalize：HeadObject 驗證物件已上傳、回實際大小；key 必須屬於該 user。
 *   5. 公開 URL 形狀與既有 storagePut（s3GetUrl）一致。
 *
 * 不打真實網路：mock @aws-sdk presigner + client-s3。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock AWS SDK（presign + HeadObject 不打真實 R2）─────────────────────────
const getSignedUrlMock = vi.fn();
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: any[]) => getSignedUrlMock(...args),
}));

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = sendMock;
  },
  PutObjectCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  HeadObjectCommand: class {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
}));

import { serverEnv } from "./_core/env.validated";
import * as signed from "./signedUpload";

// 完整 R2 設定（讓 isR2Configured()=true）
const FULL_R2 = {
  S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID: "akid",
  S3_SECRET_ACCESS_KEY: "secret",
  S3_BUCKET_NAME: "my-bucket",
  S3_PUBLIC_URL: "https://pub-xyz.r2.dev",
  S3_REGION: "auto",
};

// 保存原值以便還原
const ORIGINAL: Record<string, any> = {};
const KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET_NAME",
  "S3_PUBLIC_URL",
  "S3_PUBLIC_DOMAIN",
  "S3_REGION",
  "ENABLE_SIGNED_URL_UPLOAD",
];

function setR2(on: boolean) {
  if (on) {
    Object.assign(serverEnv as any, FULL_R2);
    (serverEnv as any).S3_PUBLIC_DOMAIN = "";
  } else {
    (serverEnv as any).S3_ENDPOINT = "";
    (serverEnv as any).S3_ACCESS_KEY_ID = "";
    (serverEnv as any).S3_SECRET_ACCESS_KEY = "";
    (serverEnv as any).S3_BUCKET_NAME = "";
  }
}

beforeEach(() => {
  for (const k of KEYS) ORIGINAL[k] = (serverEnv as any)[k];
  getSignedUrlMock.mockReset();
  sendMock.mockReset();
  signed.__resetR2ClientForTests();
  getSignedUrlMock.mockResolvedValue("https://signed.example/put?sig=abc");
});

afterEach(() => {
  for (const k of KEYS) (serverEnv as any)[k] = ORIGINAL[k];
  signed.__resetR2ClientForTests();
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 旗標 / 可用性閘門（回退安全）", () => {
  it("旗標預設值未顯式 false 時視為 ON", () => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "true";
    expect(signed.isSignedUploadFlagEnabled()).toBe(true);
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = undefined;
    expect(signed.isSignedUploadFlagEnabled()).toBe(true);
  });

  it("旗標 = false/0/off/no → 關閉（client 回退 base64）", () => {
    for (const v of ["false", "0", "off", "no", "FALSE"]) {
      (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = v;
      expect(signed.isSignedUploadFlagEnabled()).toBe(false);
    }
  });

  it("旗標 ON 但無 R2 設定（demo / 本機無 R2）→ 不可用，回退 base64", () => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "true";
    setR2(false);
    expect(signed.isR2Configured()).toBe(false);
    expect(signed.isSignedUploadAvailable()).toBe(false);
  });

  it("旗標 OFF 即使 R2 齊全 → 不可用，回退 base64", () => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "false";
    setR2(true);
    expect(signed.isR2Configured()).toBe(true);
    expect(signed.isSignedUploadAvailable()).toBe(false);
  });

  it("旗標 ON ＋ R2 齊全 → 可用", () => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "true";
    setR2(true);
    expect(signed.isSignedUploadAvailable()).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 presign 驗證（型別 / 大小把關前移）", () => {
  it("MIME 不在 allowlist → 415", () => {
    const err = signed.validatePresignRequest({
      mimeType: "image/svg+xml",
      sizeBytes: 1000,
    });
    expect(err?.status).toBe(415);
  });

  it("大小 0 / 非數字 → 400", () => {
    expect(signed.validatePresignRequest({ mimeType: "image/png", sizeBytes: 0 })?.status).toBe(400);
    expect(
      signed.validatePresignRequest({ mimeType: "image/png", sizeBytes: NaN })?.status
    ).toBe(400);
  });

  it("超過 per-kind 上限（image 10MB）→ 413", () => {
    const err = signed.validatePresignRequest({
      mimeType: "image/png",
      sizeBytes: 11 * 1024 * 1024,
    });
    expect(err?.status).toBe(413);
  });

  it("合法 image 在上限內 → 通過（null）", () => {
    expect(
      signed.validatePresignRequest({ mimeType: "image/png", sizeBytes: 5 * 1024 * 1024 })
    ).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 key scope（userId 命名空間隔離）", () => {
  it("key 一律 scoped 到 uploads/<userId>/，副檔名由 mime 推導（非 filename）", () => {
    const { fileKey } = signed.buildScopedKey({
      userId: 42,
      fileName: "evil.html", // 惡意副檔名
      mimeType: "image/png", // 真實型別
    });
    expect(fileKey.startsWith("uploads/42/")).toBe(true);
    expect(fileKey.endsWith(".png")).toBe(true); // ← 不是 .html
    expect(fileKey).not.toContain("evil.html");
  });

  it("檔名非法字元被 sanitize 成底線", () => {
    const { fileKey, safeName } = signed.buildScopedKey({
      userId: 7,
      fileName: "my pic!@#.jpg",
      mimeType: "image/jpeg",
    });
    expect(safeName).toBe("my_pic___");
    expect(fileKey.startsWith("uploads/7/")).toBe(true);
    expect(fileKey.endsWith(".jpg")).toBe(true);
  });

  it("isKeyOwnedByUser：只認自己命名空間下的 key", () => {
    expect(signed.isKeyOwnedByUser("uploads/42/x-abc.png", 42)).toBe(true);
    expect(signed.isKeyOwnedByUser("uploads/42/x-abc.png", 99)).toBe(false);
    expect(signed.isKeyOwnedByUser("uploads/999/x.png", 42)).toBe(false);
    expect(signed.isKeyOwnedByUser("other/42/x.png", 42)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 presignPutUpload（簽名 + scope + 限制）", () => {
  beforeEach(() => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "true";
    setR2(true);
  });

  it("回傳 putUrl + scoped key + 鎖定的 content-type/size/效期", async () => {
    const res = await signed.presignPutUpload({
      userId: 5,
      fileName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12 * 1024 * 1024,
    });
    expect(res.putUrl).toBe("https://signed.example/put?sig=abc");
    expect(res.fileKey.startsWith("uploads/5/")).toBe(true);
    expect(res.fileKey.endsWith(".mp4")).toBe(true);
    expect(res.contentType).toBe("video/mp4");
    expect(res.maxSizeBytes).toBe(12 * 1024 * 1024);
    expect(res.expiresInSeconds).toBe(signed.PRESIGN_EXPIRES_SECONDS);
  });

  it("簽名 command 鎖了 Bucket/Key/ContentType/ContentLength，效期 5 分鐘", async () => {
    await signed.presignPutUpload({
      userId: 9,
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 2048,
    });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
    const [, command, opts] = getSignedUrlMock.mock.calls[0];
    expect(command.input.Bucket).toBe("my-bucket");
    expect(command.input.Key.startsWith("uploads/9/")).toBe(true);
    expect(command.input.ContentType).toBe("image/png");
    expect(command.input.ContentLength).toBe(2048);
    expect(opts.expiresIn).toBe(300);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 公開 URL 形狀（與 storagePut 一致）", () => {
  it("有 S3_PUBLIC_URL → publicUrl/key", () => {
    setR2(true);
    expect(signed.buildPublicUrl("uploads/1/x.png")).toBe(
      "https://pub-xyz.r2.dev/uploads/1/x.png"
    );
  });

  it("無 public domain → path-style endpoint/bucket/key", () => {
    setR2(true);
    (serverEnv as any).S3_PUBLIC_URL = "";
    (serverEnv as any).S3_PUBLIC_DOMAIN = "";
    expect(signed.buildPublicUrl("uploads/1/x.png")).toBe(
      "https://acct.r2.cloudflarestorage.com/my-bucket/uploads/1/x.png"
    );
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("AIDV-15 finalize 物件驗證（HeadObject）", () => {
  beforeEach(() => {
    (serverEnv as any).ENABLE_SIGNED_URL_UPLOAD = "true";
    setR2(true);
  });

  it("物件存在 → 回 exists + 實際大小 + content-type", async () => {
    sendMock.mockResolvedValue({ ContentLength: 4096, ContentType: "image/png" });
    const v = await signed.verifyUploadedObject("uploads/3/x-abc.png");
    expect(v.exists).toBe(true);
    expect(v.sizeBytes).toBe(4096);
    expect(v.contentType).toBe("image/png");
  });

  it("物件不存在（HeadObject throw）→ 往上拋（路由轉 409）", async () => {
    sendMock.mockRejectedValue(new Error("NotFound"));
    await expect(signed.verifyUploadedObject("uploads/3/missing.png")).rejects.toThrow();
  });
});

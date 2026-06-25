/**
 * r2SnapshotJob.test.ts — AIDV-66 M3 R2 物件層快照測試
 *
 * 覆蓋：
 *   - classifyKey：路徑前綴分類
 *   - isR2CatalogEnabled：旗標預設 ON、明確 false/0/off/no 才 OFF
 *   - takeR2Snapshot：無 R2 env → 早退（不拋錯）
 *   - takeR2ObjectCatalog：無 DB → 返回 0（不拋錯）
 *
 * db.ts 有既有重複 export（pre-existing，AIDV-29）；vi.mock 繞過 esbuild 轉換問題。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock db.js before importing the service under test.
vi.mock("../db.js", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

// Mock schema to avoid full drizzle schema import chain
vi.mock("../../drizzle/schema.js", () => ({
  r2StorageSnapshots: {},
  r2ObjectCatalog: {},
}));

import {
  classifyKey,
  isR2CatalogEnabled,
  takeR2Snapshot,
  takeR2ObjectCatalog,
} from "./r2SnapshotJob";

const R2_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET_NAME",
] as const;

const ORIGINAL: Partial<Record<string, string>> = {};

beforeEach(() => {
  R2_ENV_KEYS.forEach(k => {
    ORIGINAL[k] = process.env[k];
    delete process.env[k];
  });
  delete process.env.ENABLE_R2_CATALOG;
});

afterEach(() => {
  R2_ENV_KEYS.forEach(k => {
    const v = ORIGINAL[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  delete process.env.ENABLE_R2_CATALOG;
  vi.restoreAllMocks();
});

// ─── classifyKey ──────────────────────────────────────────────────────────────

describe("classifyKey — 路徑前綴分類", () => {
  it("images/ → images", () => {
    expect(classifyKey("images/user1/abc.png")).toBe("images");
  });
  it("videos/ → videos", () => {
    expect(classifyKey("videos/clip.mp4")).toBe("videos");
  });
  it("audio/ → audio", () => {
    expect(classifyKey("audio/narration.mp3")).toBe("audio");
  });
  it("voice/ → voice", () => {
    expect(classifyKey("voice/tts_abc.wav")).toBe("voice");
  });
  it("models/ → models", () => {
    expect(classifyKey("models/lora_fine.safetensors")).toBe("models");
  });
  it("archived/ 前綴（不在分類中）→ other", () => {
    expect(classifyKey("archived/video/1/file.mp4")).toBe("other");
  });
  it("unknown prefix → other", () => {
    expect(classifyKey("db-backups/dump.sql.gz")).toBe("other");
  });
  it("空字串 → other", () => {
    expect(classifyKey("")).toBe("other");
  });
});

// ─── isR2CatalogEnabled ───────────────────────────────────────────────────────

describe("isR2CatalogEnabled — 旗標預設 ON", () => {
  it("未設定 → ON（沒設＝有物件快照）", () => {
    delete process.env.ENABLE_R2_CATALOG;
    expect(isR2CatalogEnabled()).toBe(true);
  });
  it("空字串 → ON", () => {
    process.env.ENABLE_R2_CATALOG = "";
    expect(isR2CatalogEnabled()).toBe(true);
  });
  it('"true" / "1" → ON', () => {
    process.env.ENABLE_R2_CATALOG = "true";
    expect(isR2CatalogEnabled()).toBe(true);
    process.env.ENABLE_R2_CATALOG = "1";
    expect(isR2CatalogEnabled()).toBe(true);
  });
  it('明確 "false" / "0" / "off" / "no"（大小寫不拘）→ OFF', () => {
    for (const v of ["false", "0", "off", "no", "FALSE", "Off", " No "]) {
      process.env.ENABLE_R2_CATALOG = v;
      expect(isR2CatalogEnabled()).toBe(false);
    }
  });
});

// ─── takeR2Snapshot — HARD SAFETY skip ───────────────────────────────────────

describe("takeR2Snapshot — 無 R2 env → 靜默跳過（不拋錯）", () => {
  it("完全無 R2 env → resolve（不 throw）", async () => {
    await expect(takeR2Snapshot()).resolves.toBeUndefined();
  });

  it("只設部分 R2 env → 仍靜默跳過", async () => {
    process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    // 缺 access key id / secret / bucket
    await expect(takeR2Snapshot()).resolves.toBeUndefined();
  });
});

// ─── takeR2ObjectCatalog — 無 DB → 返回 0 ───────────────────────────────────

describe("takeR2ObjectCatalog — 無 DB → 返回 0（不拋錯）", () => {
  it("getDb() 返回 null → 返回 0", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const mockS3 = new S3Client({
      region: "auto",
      endpoint: "https://fake.r2.example.com",
      credentials: { accessKeyId: "k", secretAccessKey: "s" },
    });
    const count = await takeR2ObjectCatalog(1, mockS3, "fake-bucket");
    expect(count).toBe(0);
  });
});

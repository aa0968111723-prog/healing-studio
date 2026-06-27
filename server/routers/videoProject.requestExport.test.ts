import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/trpc", () => ({
  router: (r: object) => r,
  protectedProcedure: {
    input: (schema: object) => ({
      mutation: (fn: (args: unknown) => unknown) => ({ _schema: schema, _fn: fn }),
      query: (fn: (args: unknown) => unknown) => ({ _schema: schema, _fn: fn }),
    }),
    mutation: (fn: (args: unknown) => unknown) => ({ _fn: fn }),
    query: (fn: (args: unknown) => unknown) => ({ _fn: fn }),
  },
}));

vi.mock("../db", () => ({
  getVideoProject: vi.fn(),
  getDigitalAsset: vi.fn(),
  createVideoProject: vi.fn(),
  getVideoProjectsByUser: vi.fn(),
  updateVideoProject: vi.fn(),
  duplicateVideoProject: vi.fn(),
  listProjectSnapshots: vi.fn(),
  getProjectSnapshot: vi.fn(),
  createProjectSnapshot: vi.fn(),
}));

vi.mock("../signedUpload", () => ({
  presignGetDownload: vi.fn(),
  EXPORT_PRESIGN_EXPIRES_SECONDS: 604800,
  isR2Configured: vi.fn(),
}));

vi.mock("../../drizzle/schema", () => ({
  VIDEO_OUTPUT_SPEC_DEFAULT: { resolution: "1080p", fps: 30, codec: "h264" },
}));

vi.mock("../utils/sanitize", () => ({
  sanitizePlainText: (s: string) => s,
}));

import * as dbMock from "../db";
import * as signedUploadMock from "../signedUpload";

describe("videoProject.requestExport (AIDV-347)", () => {
  let requestExportFn: (args: {
    ctx: { user: { id: number } };
    input: { projectId: number; assetId: number; format: string };
  }) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("./videoProject");
    const router = mod.videoProjectRouter as Record<string, { _fn: typeof requestExportFn }>;
    requestExportFn = router.requestExport._fn;
    vi.mocked(signedUploadMock.isR2Configured).mockReturnValue(true);
    vi.mocked(signedUploadMock.presignGetDownload).mockResolvedValue(
      "https://r2.example.com/signed?token=abc"
    );
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("throws NOT_FOUND when project does not exist", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue(null);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 99, assetId: 1, format: "mp4" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when project belongs to different user", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 2 } as never);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 1, format: "mp4" } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND when asset does not exist", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue(null);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 99, format: "mp4" } })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN when asset belongs to different user", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue({ id: 5, userId: 2, assetType: "video", fileKey: "uploads/2/v.mp4" } as never);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 5, format: "mp4" } })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws BAD_REQUEST when asset is not video type", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue({ id: 5, userId: 1, assetType: "image", fileKey: "uploads/1/img.jpg" } as never);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 5, format: "mp4" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws PRECONDITION_FAILED when asset has no fileKey", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue({ id: 5, userId: 1, assetType: "video", fileKey: null } as never);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 5, format: "mp4" } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("throws PRECONDITION_FAILED when R2 is not configured", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue({ id: 5, userId: 1, assetType: "video", fileKey: "uploads/1/v.mp4" } as never);
    vi.mocked(signedUploadMock.isR2Configured).mockReturnValue(false);
    await expect(
      requestExportFn({ ctx: { user: { id: 1 } }, input: { projectId: 1, assetId: 5, format: "mp4" } })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("returns downloadUrl and expiresAt on success", async () => {
    vi.mocked(dbMock.getVideoProject).mockResolvedValue({ id: 1, userId: 1 } as never);
    vi.mocked(dbMock.getDigitalAsset).mockResolvedValue({
      id: 5,
      userId: 1,
      assetType: "video",
      fileKey: "uploads/1/video-abc.mp4",
    } as never);

    const result = await requestExportFn({
      ctx: { user: { id: 1 } },
      input: { projectId: 1, assetId: 5, format: "mp4" },
    }) as Record<string, unknown>;

    expect(result.downloadUrl).toBe("https://r2.example.com/signed?token=abc");
    expect(typeof result.expiresAt).toBe("string");
    expect(result.assetId).toBe(5);
    expect(result.projectId).toBe(1);
    expect(result.format).toBe("mp4");
    expect(signedUploadMock.presignGetDownload).toHaveBeenCalledWith("uploads/1/video-abc.mp4");
  });
});

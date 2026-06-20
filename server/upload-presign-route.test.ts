/**
 * upload-presign-route.test.ts — AIDV-15：presign / finalize 端點路由測試
 *
 * 驗證 HTTP 層契約（仿 server/sseRoute.test.ts：express + listen(0) + fetch，
 * 依賴用 vi.mock 攔截）：
 *  - presign / finalize 都 auth-gated：未登入 → 401（杜絕未授權拿 presign）。
 *  - 旗標 OFF / 無 R2（signed-URL 不可用）→ 503 + fallback:"base64"（client 回退）。
 *  - presign 通過 → 回 putUrl + scoped fileKey。
 *  - presign 驗證失敗（太大 / 不允許型別）→ 413 / 415（不回退，明確拒絕）。
 *  - finalize scope 守門：key 不屬於該 user → 403（杜絕用別人的 key 偽造 finalize）。
 *  - finalize 物件不存在 → 409。
 */
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock auth — 必須在 import router 之前 ──
const authenticateRequestMock = vi.fn();
vi.mock("./_core/googleAuth", () => ({
  authenticateRequest: (...args: unknown[]) => authenticateRequestMock(...args),
}));

// ── Mock signedUpload 模組（uploadRoute 對它做動態 import）──
const isSignedUploadAvailableMock = vi.fn();
const validatePresignRequestMock = vi.fn();
const presignPutUploadMock = vi.fn();
const verifyUploadedObjectMock = vi.fn();
const buildPublicUrlMock = vi.fn();
const isKeyOwnedByUserMock = vi.fn();

vi.mock("./signedUpload", () => ({
  isSignedUploadAvailable: (...a: unknown[]) => isSignedUploadAvailableMock(...a),
  validatePresignRequest: (...a: unknown[]) => validatePresignRequestMock(...a),
  presignPutUpload: (...a: unknown[]) => presignPutUploadMock(...a),
  verifyUploadedObject: (...a: unknown[]) => verifyUploadedObjectMock(...a),
  buildPublicUrl: (...a: unknown[]) => buildPublicUrlMock(...a),
  isKeyOwnedByUser: (...a: unknown[]) => isKeyOwnedByUserMock(...a),
}));

import { uploadRouter } from "./uploadRoute";

async function startTestServer() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(uploadRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("bind failed");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  isSignedUploadAvailableMock.mockReset();
  validatePresignRequestMock.mockReset();
  presignPutUploadMock.mockReset();
  verifyUploadedObjectMock.mockReset();
  buildPublicUrlMock.mockReset();
  isKeyOwnedByUserMock.mockReset();
  // 預設：可用、驗證通過、key 屬於 user
  isSignedUploadAvailableMock.mockReturnValue(true);
  validatePresignRequestMock.mockReturnValue(null);
  isKeyOwnedByUserMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
describe("POST /api/upload/presign — auth + 旗標 + 驗證 + scope", () => {
  it("未登入 → 401（杜絕未授權拿 presign）", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/presign", {
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 1000,
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it("旗標 OFF / 無 R2（不可用）→ 503 + fallback:base64（client 回退）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    isSignedUploadAvailableMock.mockReturnValue(false);
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/presign", {
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 1000,
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.fallback).toBe("base64");
    server.close();
  });

  it("缺欄位 → 400", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/presign", { fileName: "a.png" });
    expect(res.status).toBe(400);
    server.close();
  });

  it("驗證失敗（太大）→ 413（不回退，明確拒絕）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    validatePresignRequestMock.mockReturnValue({ status: 413, message: "too big" });
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/presign", {
      fileName: "big.mp4",
      mimeType: "video/mp4",
      sizeBytes: 99 * 1024 * 1024,
    });
    expect(res.status).toBe(413);
    server.close();
  });

  it("通過 → 回 putUrl + scoped fileKey", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 7 });
    presignPutUploadMock.mockResolvedValue({
      putUrl: "https://signed/put",
      fileKey: "uploads/7/a-abc.png",
      safeName: "a",
      contentType: "image/png",
      maxSizeBytes: 1000,
      expiresInSeconds: 300,
    });
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/presign", {
      fileName: "a.png",
      mimeType: "image/png",
      sizeBytes: 1000,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.putUrl).toBe("https://signed/put");
    expect(body.fileKey).toBe("uploads/7/a-abc.png");
    // 端點以 user.id 呼叫 presign（scope 由伺服器決定，client 無法指定 userId）
    expect(presignPutUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7 })
    );
    server.close();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe("POST /api/upload/finalize — auth + scope + Head 驗證", () => {
  it("未登入 → 401", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/a.png",
      mimeType: "image/png",
    });
    expect(res.status).toBe(401);
    server.close();
  });

  it("不可用 → 503 fallback", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    isSignedUploadAvailableMock.mockReturnValue(false);
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/a.png",
      mimeType: "image/png",
    });
    expect(res.status).toBe(503);
    server.close();
  });

  it("key 不屬於該 user → 403（杜絕偽造 finalize）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    isKeyOwnedByUserMock.mockReturnValue(false);
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/999/other.png",
      mimeType: "image/png",
    });
    expect(res.status).toBe(403);
    server.close();
  });

  it("不允許型別 → 415", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/x.svg",
      mimeType: "image/svg+xml",
    });
    expect(res.status).toBe(415);
    server.close();
  });

  it("物件不存在（HeadObject throw）→ 409", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    verifyUploadedObjectMock.mockRejectedValue(new Error("NotFound"));
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/missing.png",
      mimeType: "image/png",
    });
    expect(res.status).toBe(409);
    server.close();
  });

  it("通過 → 回 url + fileKey + storageBacked（與 /api/upload 同形狀）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    verifyUploadedObjectMock.mockResolvedValue({
      exists: true,
      sizeBytes: 2048,
      contentType: "image/png",
    });
    buildPublicUrlMock.mockReturnValue("https://pub.r2.dev/uploads/1/x.png");
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/x.png",
      mimeType: "image/png",
      fileName: "x.png",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://pub.r2.dev/uploads/1/x.png");
    expect(body.fileKey).toBe("uploads/1/x.png");
    expect(body.fileSizeBytes).toBe(2048);
    expect(body.storageBacked).toBe(true);
    server.close();
  });

  it("實際物件超過上限 → 413（用 HeadObject 回的真實大小把關）", async () => {
    authenticateRequestMock.mockResolvedValue({ id: 1 });
    verifyUploadedObjectMock.mockResolvedValue({
      exists: true,
      sizeBytes: 50 * 1024 * 1024, // > image 10MB
      contentType: "image/png",
    });
    const { server, baseUrl } = await startTestServer();
    const res = await post(baseUrl, "/api/upload/finalize", {
      fileKey: "uploads/1/huge.png",
      mimeType: "image/png",
    });
    expect(res.status).toBe(413);
    server.close();
  });
});

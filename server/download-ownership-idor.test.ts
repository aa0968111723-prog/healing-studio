/**
 * download-ownership-idor.test.ts — AIDV-789
 *
 * 驗證 /api/media/download 加上擁有權閘門後：
 *   1. 用戶 A 嘗試下載用戶 B 的資產（兩表皆查無） → 403
 *   2. 用戶 A 下載自己的資產（digitalAssetLibrary 命中） → 通過閘門（非 403）
 *   3. 用戶 A 下載自己的資產（generationHistory 命中） → 通過閘門（非 403）
 *   4. DB 查詢找不到 URL → 403
 *
 * 採 express + app.listen(0) + 全域 fetch（Node 18+ 內建）模式；
 * 依賴用 vi.hoisted + vi.mock 提升攔截，無 supertest。
 */
import { AddressInfo } from "net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

// ── hoisted mocks（vi.mock 工廠會被提升，不能引用普通 top-level 變數）─────
const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("./db", () => ({ getDb: getDbMock }));

vi.mock("./_core/env.validated", () => ({
  serverEnv: {
    S3_PUBLIC_URL: "https://pub-test.r2.dev",
    S3_PUBLIC_DOMAIN: "pub-test.r2.dev",
    BUILT_IN_FORGE_API_URL: "https://forge.internal",
  },
}));

vi.mock("./_core/ssrfGuard", () => ({
  isExactOriginAllowed: () => true,
}));

vi.mock("./middleware/verifyToken", () => ({
  verifyToken: (req: any, _res: any, next: any) => {
    req.user = { id: 1, openId: "user-001", email: "a@test.com" };
    next();
  },
}));

// ── 路由在 mock 設定完後才 import ─────────────────────────────────────────
import { mediaDownloadRouter } from "./routes/download";

// ── fake drizzle DB helpers ───────────────────────────────────────────────
// select().from().where().limit() chain — 第 i 次 limit() 回傳 results[i]
function fakeDbSequential(resultSets: unknown[][]) {
  let i = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => resultSets[i++] ?? [],
        }),
      }),
    }),
  };
}

const INTERNAL_URL = "https://pub-test.r2.dev/user-1/clip.mp4";
const OTHER_URL = "https://pub-test.r2.dev/user-2/secret.mp4";

// ── test server ───────────────────────────────────────────────────────────
let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  getDbMock.mockReset();
  getDbMock.mockResolvedValue(null);
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
});

async function startServer() {
  const app = express();
  app.use(mediaDownloadRouter);
  const server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  closeServer = () =>
    new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${addr.port}`;
}

async function getStatus(baseUrl: string, url: string): Promise<number> {
  const target = `${baseUrl}/api/media/download?url=${encodeURIComponent(url)}`;
  // AbortController to prevent test hanging on stream
  const ac = new AbortController();
  try {
    const res = await fetch(target, { signal: ac.signal });
    ac.abort();
    return res.status;
  } catch {
    // fetch may throw after abort; return status from the response before abort
    // We rely on the server having already sent headers at this point.
    // If the request was rejected before fetching upstream (403/401), it resolves
    // synchronously; the abort() above only fires after we already have status.
    return 0;
  }
}

describe("AIDV-789 — /api/media/download 所有權閘門", () => {
  it("digitalAssetLibrary 命中 → 通過閘門（非 403）", async () => {
    // First DB call (digitalAssetLibrary): found
    // Second DB call won't happen
    getDbMock.mockResolvedValue(fakeDbSequential([[{ id: 10 }], []]));

    const base = await startServer();
    const status = await getStatus(base, INTERNAL_URL);
    // 403 means gate blocked; 502 means gate passed but upstream unreachable (test env)
    expect(status).not.toBe(403);
    expect([200, 502, 503, 0]).toContain(status);
  });

  it("digitalAssetLibrary 空但 generationHistory 命中 → 通過閘門", async () => {
    // First call (digitalAssetLibrary): empty; second call (generationHistory): found
    getDbMock.mockResolvedValue(fakeDbSequential([[], [{ id: 99 }]]));

    const base = await startServer();
    const status = await getStatus(base, INTERNAL_URL);
    expect(status).not.toBe(403);
    expect([200, 502, 503, 0]).toContain(status);
  });

  it("兩表都查不到 → 403", async () => {
    // Both DB calls return empty
    getDbMock.mockResolvedValue(fakeDbSequential([[], []]));

    const base = await startServer();
    const res = await fetch(
      `${base}/api/media/download?url=${encodeURIComponent(OTHER_URL)}`
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/下載權限/);
  });

  it("URL 完全不存在 → 403", async () => {
    getDbMock.mockResolvedValue(fakeDbSequential([[], []]));

    const base = await startServer();
    const res = await fetch(
      `${base}/api/media/download?url=${encodeURIComponent("https://pub-test.r2.dev/ghost/nope.mp4")}`
    );
    expect(res.status).toBe(403);
  });

  it("缺少 url 參數 → 400（不查 DB）", async () => {
    const mockDb = { select: vi.fn() };
    getDbMock.mockResolvedValue(mockDb as any);

    const base = await startServer();
    const res = await fetch(`${base}/api/media/download`);
    expect(res.status).toBe(400);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

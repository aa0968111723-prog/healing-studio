/**
 * ai-proxy-auth.test.ts — H5（AIDV-60）AI 閘道鎖門
 *
 * 守住三件事：
 *   1. /api/ai 掛的是嚴格版 verifyToken —— 未帶 token 一律 401，打不到上游。
 *      （之前是 optionalVerifyToken，未登入也放行＝把付費上游敞開給任何人。
 *        本檔的 vi.mock 只匯出 verifyToken；若 aiProxy 改回 import
 *        optionalVerifyToken 會直接在載入期爆炸。）
 *   2. checkRateLimit fail-closed —— 查不到 DB（503）或查詢爆炸（503）都擋，
 *      不再「出錯就放行」。
 *   3. DB 規則超限照舊回 429（與 degraded 503 區分）。
 */
import express from "express";
import { AddressInfo } from "net";
import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

const { verifyTokenMock, getDbMock } = vi.hoisted(() => ({
  // 模擬嚴格 verifyToken 的外部行為：有 authorization 標頭→掛 user 放行；
  // 沒有→401（與 middleware/verifyToken.ts 的實作對齊）。
  verifyTokenMock: vi.fn((req: any, res: any, next: any) => {
    if (req.headers["authorization"]) {
      req.user = { id: 42 };
      next();
      return;
    }
    res.status(401).json({ error: "Unauthorized" });
  }),
  getDbMock: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock("./middleware/verifyToken", () => ({
  verifyToken: verifyTokenMock,
}));

vi.mock("./_core/env.validated", () => ({
  serverEnv: {
    FAL_API_KEY: "test-fal-key",
    GEMINI_API_KEY: "",
    ELEVENLABS_API_KEY: "",
    SUNO_API_KEY: "",
  },
}));

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("./services/langsmithTracer", () => ({
  traceToolRun: vi.fn(async () => undefined),
}));

import { aiProxyRouter } from "./routes/aiProxy";

/** 假 drizzle db：每次 select().from().where() 依序吐出 results 的下一筆。 */
function fakeDb(results: unknown[][]) {
  let i = 0;
  return {
    select: () => ({
      from: () => ({
        where: async () => results[i++] ?? [],
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  };
}

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  verifyTokenMock.mockClear();
  getDbMock.mockReset();
  getDbMock.mockResolvedValue(null);
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
});

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use(aiProxyRouter);
  const server = app.listen(0);
  const addr = server.address() as AddressInfo;
  closeServer = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return `http://127.0.0.1:${addr.port}`;
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
) {
  const target = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        headers: { "Content-Type": "application/json", ...headers },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on("data", c => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf-8"),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

const AUTHED = { authorization: "Bearer test-token" };

describe("aiProxy H5 lockdown", () => {
  it("rejects unauthenticated requests with 401 before touching upstream", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const base = await startTestServer();
    const res = await postJson(`${base}/api/ai/fal_ai/v1/models`, {
      prompt: "hello",
    });

    expect(verifyTokenMock).toHaveBeenCalled();
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("lets authenticated requests through when no rate-limit rules exist", async () => {
    process.env.FAL_API_KEY = "test-fal-key";
    // 規則查詢回空陣列 → allowed。
    getDbMock.mockResolvedValue(fakeDb([[]]));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const base = await startTestServer();
    const res = await postJson(
      `${base}/api/ai/fal_ai/v1/models`,
      { prompt: "hello" },
      AUTHED
    );

    expect(res.status).toBe(200);

    fetchMock.mockRestore();
  });

  it("fail-closed: blocks with 503 when database is unavailable", async () => {
    getDbMock.mockResolvedValue(null);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const base = await startTestServer();
    const res = await postJson(
      `${base}/api/ai/fal_ai/v1/models`,
      { prompt: "hello" },
      AUTHED
    );

    expect(res.status).toBe(503);
    expect(res.body).toContain("Rate limit check unavailable");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("fail-closed: blocks with 503 when the rate-limit query throws", async () => {
    getDbMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const base = await startTestServer();
    const res = await postJson(
      `${base}/api/ai/fal_ai/v1/models`,
      { prompt: "hello" },
      AUTHED
    );

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });

  it("still returns 429 when a DB rule limit is actually exceeded", async () => {
    // 第一查：per_user 規則 dailyCallLimit=1；第二查：今日已 5 次 → 超限。
    getDbMock.mockResolvedValue(
      fakeDb([
        [
          {
            isActive: true,
            provider: "all",
            ruleType: "per_user",
            targetId: null,
            dailyCallLimit: 1,
            dailyCostLimitUsd: null,
          },
        ],
        [{ cnt: 5 }],
      ])
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const base = await startTestServer();
    const res = await postJson(
      `${base}/api/ai/fal_ai/v1/models`,
      { prompt: "hello" },
      AUTHED
    );

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRestore();
  });
});

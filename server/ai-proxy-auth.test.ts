import express from "express";
import { AddressInfo } from "net";
import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";

const { optionalVerifyTokenMock } = vi.hoisted(() => ({
  optionalVerifyTokenMock: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 42 };
    next();
  }),
}));

vi.mock("./middleware/verifyToken", () => ({
  optionalVerifyToken: optionalVerifyTokenMock,
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
  getDb: vi.fn(async () => null),
}));

vi.mock("./services/langsmithTracer", () => ({
  traceToolRun: vi.fn(async () => undefined),
}));

import { aiProxyRouter } from "./routes/aiProxy";

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  optionalVerifyTokenMock.mockClear();
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

async function postJson(url: string, body: Record<string, unknown>) {
  const target = new URL(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      {
        method: "POST",
        hostname: target.hostname,
        port: Number(target.port),
        path: target.pathname,
        headers: { "Content-Type": "application/json" },
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

describe("aiProxy auth wiring", () => {
  it("runs optionalVerifyToken middleware before proxy handler", async () => {
    process.env.FAL_API_KEY = "test-fal-key";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const base = await startTestServer();
    const res = await postJson(`${base}/api/ai/fal_ai/v1/models`, {
      prompt: "hello",
    });

    expect(optionalVerifyTokenMock).toHaveBeenCalled();
    expect(res.status).toBe(200);

    fetchMock.mockRestore();
  });
});

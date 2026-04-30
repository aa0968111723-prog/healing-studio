import express from "express";
import { AddressInfo } from "net";
import { afterEach, describe, expect, it } from "vitest";
import { googleAuthRouter } from "./routes/googleAuth";

let closeServer: (() => Promise<void>) | null = null;

afterEach(async () => {
  if (closeServer) {
    await closeServer();
    closeServer = null;
  }
});

async function startTestServer() {
  const app = express();
  app.use(googleAuthRouter);

  const server = app.listen(0);
  const addr = server.address() as AddressInfo;
  closeServer = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return `http://127.0.0.1:${addr.port}`;
}

describe("googleAuthRouter bridges", () => {
  it("bridges /api/auth/google/start to /api/oauth/google/start with query preserved", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/api/auth/google/start?redirect=%2Fstudio`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/oauth/google/start?redirect=%2Fstudio");
  });
});

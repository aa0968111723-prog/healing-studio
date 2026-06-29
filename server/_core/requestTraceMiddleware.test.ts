/**
 * requestTraceMiddleware (AIDV-289) — x-request-id 分散式追蹤 header 測試
 *
 * 驗收條件：
 *   1. 呼叫端帶 x-request-id → response echo 相同值
 *   2. 未帶 x-request-id → 自動生成 UUID 並 echo 在 response
 *   3. x-trace-id / x-orb-trace-id 既有行為不變
 *   4. getRequestId() 在 middleware 執行期間可取得值
 */
import { describe, it, expect, vi } from "vitest";
import { requestTraceMiddleware, getRequestId, redactUrl } from "./logger";
import type { Request, Response } from "express";

function makeReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()] ?? undefined,
    method: "GET",
    originalUrl: "/api/test",
    ip: "127.0.0.1",
    get: (_: string) => undefined,
  } as unknown as Request;
}

function makeRes(): { res: Response; headers: Record<string, string>; listeners: Record<string, (() => void)[]> } {
  const headers: Record<string, string> = {};
  const listeners: Record<string, (() => void)[]> = {};
  const res = {
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    on: (event: string, cb: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    },
  } as unknown as Response;
  return { res, headers, listeners };
}

describe("requestTraceMiddleware (AIDV-289)", () => {
  it("呼叫端帶 x-request-id → response echo 相同值", () => {
    const req = makeReq({ "x-request-id": "agent-001" });
    const { res, headers } = makeRes();
    requestTraceMiddleware(req, res, () => {});
    expect(headers["x-request-id"]).toBe("agent-001");
  });

  it("未帶 x-request-id → 自動生成 UUID 並設定 response header", () => {
    const req = makeReq({});
    const { res, headers } = makeRes();
    requestTraceMiddleware(req, res, () => {});
    expect(headers["x-request-id"]).toBeTruthy();
    expect(typeof headers["x-request-id"]).toBe("string");
    expect(headers["x-request-id"].length).toBeGreaterThan(8);
  });

  it("x-trace-id 既有行為不變：呼叫端帶 x-trace-id → response echo", () => {
    const req = makeReq({ "x-trace-id": "trace-abc" });
    const { res, headers } = makeRes();
    requestTraceMiddleware(req, res, () => {});
    expect(headers["x-trace-id"]).toBe("trace-abc");
  });

  it("x-orb-trace-id 既有行為不變：呼叫端帶值 → response echo", () => {
    const req = makeReq({ "x-orb-trace-id": "orb-xyz" });
    const { res, headers } = makeRes();
    requestTraceMiddleware(req, res, () => {});
    expect(headers["x-orb-trace-id"]).toBe("orb-xyz");
  });

  it("getRequestId() 在 middleware callback 期間可取得 x-request-id 值", () => {
    const req = makeReq({ "x-request-id": "multi-agent-007" });
    const { res } = makeRes();
    let captured: string | null = null;
    requestTraceMiddleware(req, res, () => {
      captured = getRequestId();
    });
    expect(captured).toBe("multi-agent-007");
  });

  it("呼叫端同時帶 x-request-id 和 x-trace-id → 兩者獨立 echo", () => {
    const req = makeReq({ "x-request-id": "req-111", "x-trace-id": "trace-222" });
    const { res, headers } = makeRes();
    requestTraceMiddleware(req, res, () => {});
    expect(headers["x-request-id"]).toBe("req-111");
    expect(headers["x-trace-id"]).toBe("trace-222");
  });
});

// ─── AIDV-673: redactUrl ──────────────────────────────────────────────────────

describe("redactUrl (AIDV-673)", () => {
  it("token param → value replaced with ***", () => {
    const redacted = redactUrl("/api/webhook/fal?token=abc123secret");
    expect(redacted).not.toContain("abc123secret");
    expect(redacted).toContain("token=***");
  });

  it("key param → value replaced with ***", () => {
    const redacted = redactUrl("/api/foo?key=sk-live-abcdef");
    expect(redacted).not.toContain("sk-live-abcdef");
    expect(redacted).toContain("key=***");
  });

  it("secret param → redacted", () => {
    expect(redactUrl("/x?secret=mysecret")).toContain("secret=***");
    expect(redactUrl("/x?secret=mysecret")).not.toContain("mysecret");
  });

  it("password param → redacted", () => {
    expect(redactUrl("/x?password=hunter2")).toContain("password=***");
    expect(redactUrl("/x?password=hunter2")).not.toContain("hunter2");
  });

  it("non-sensitive params preserved as-is", () => {
    const redacted = redactUrl("/api/webhook/fal?modelId=flux&token=abc");
    expect(redacted).toContain("modelId=flux");
    expect(redacted).toContain("token=***");
    expect(redacted).not.toContain("abc");
  });

  it("URL without query string returned unchanged", () => {
    expect(redactUrl("/api/health")).toBe("/api/health");
  });

  it("multiple sensitive params all redacted", () => {
    const redacted = redactUrl("/x?token=t1&key=k1&other=ok");
    expect(redacted).toContain("token=***");
    expect(redacted).toContain("key=***");
    expect(redacted).toContain("other=ok");
    expect(redacted).not.toContain("t1");
    expect(redacted).not.toContain("k1");
  });
});

// ─── AIDV-673: middleware logs redacted path ──────────────────────────────────

describe("requestTraceMiddleware — AIDV-673 token redaction", () => {
  it("webhook URL with ?token=<secret> not written to logger output", () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    const req = {
      header: (_: string) => undefined,
      method: "POST",
      originalUrl: "/api/webhook/fal?token=supersecrettoken",
      ip: "1.2.3.4",
      get: (_: string) => undefined,
    } as unknown as import("express").Request;
    const { res } = makeRes();

    requestTraceMiddleware(req, res, () => {});

    vi.restoreAllMocks();

    const logged = lines.join("");
    expect(logged).not.toContain("supersecrettoken");
    expect(logged).toContain("token=***");
  });
});

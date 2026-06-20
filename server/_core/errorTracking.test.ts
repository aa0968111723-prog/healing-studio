/**
 * AIDV-58（H3）— 錯誤追蹤 env-gated no-op 測試
 *
 * 驗證未設 SENTRY_DSN 時：
 *  - initErrorTracking() 不 throw、不阻塞（完全 no-op）
 *  - errorTrackingExpressErrorHandler() 回傳「透傳」中介層：呼叫 next(err)，
 *    不吞錯、不改回應 → 既有 globalErrorHandler 仍能接手（不破壞既有錯誤路徑）
 *  - captureError() 在無 DSN 時 no-op、不 throw
 *
 * 以 vi.mock 注入空 DSN 的 serverEnv，避免依賴真實 process.env。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.validated", () => ({
  serverEnv: {
    SENTRY_DSN: "",
    SENTRY_ENVIRONMENT: "",
    SENTRY_TRACES_SAMPLE_RATE: "0.1",
    NODE_ENV: "test",
  },
}));

import {
  initErrorTracking,
  errorTrackingExpressErrorHandler,
  captureError,
} from "./errorTracking";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorTracking — SENTRY_DSN 未設時 no-op", () => {
  it("initErrorTracking() 不 throw、resolve（no-op）", async () => {
    await expect(initErrorTracking()).resolves.toBeUndefined();
  });

  it("captureError() 在無 DSN 時不 throw（no-op）", () => {
    expect(() => captureError(new Error("boom"), { foo: "bar" })).not.toThrow();
  });

  it("express error handler 為透傳：呼叫 next(err)，不改回應", async () => {
    await initErrorTracking();
    const handler = errorTrackingExpressErrorHandler();

    const err = new Error("downstream failure");
    const next = vi.fn();
    // res 上的方法若被呼叫即代表吞錯/改回應——透傳模式不應動到 res。
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      end: vi.fn().mockReturnThis(),
    };

    // express ErrorRequestHandler 簽章：(err, req, res, next)
    (handler as unknown as (e: unknown, r: unknown, s: unknown, n: unknown) => void)(
      err,
      {},
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(err);
    // 透傳不應自行回應
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });
});

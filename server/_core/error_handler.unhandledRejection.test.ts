/**
 * AIDV-592 — unhandledRejection 分流驗證
 *
 * 確認 createProcessErrorHandlers 的行為：
 * 1. 單次 unhandledRejection → log only，不 shutdown、不 exit
 * 2. uncaughtException → fatal：shutdown + exit(1)
 * 3. rejection 風暴（≥threshold） → 升級 fatal
 * 4. threshold ≤ 0 → 停用風暴偵測，任意多次都不 shutdown
 * 5. 重入保護：多次 fatal 只 shutdown 一次
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  getTraceId: () => "test-trace",
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { createProcessErrorHandlers } from "./error_handler";
import { logger } from "./logger";

function makeHandlers(opts?: Parameters<typeof createProcessErrorHandlers>[1]) {
  const shutdown = vi.fn().mockResolvedValue(undefined);
  const exitFn = vi.fn().mockImplementation(() => { /* no-op in tests */ });
  const handlers = createProcessErrorHandlers(shutdown, { exit: exitFn as never, ...opts });
  return { shutdown, exitFn, ...handlers };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createProcessErrorHandlers", () => {
  it("單次 unhandledRejection：只記 log，不 shutdown、不 exit", async () => {
    const { handleUnhandledRejection, shutdown, exitFn } = makeHandlers();

    handleUnhandledRejection(new Error("background task failed"));

    // Allow any pending microtasks to settle
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith(
      "Unhandled promise rejection (non-fatal)",
      expect.objectContaining({ err: expect.any(Error) })
    );
    expect(shutdown).not.toHaveBeenCalled();
    expect(exitFn).not.toHaveBeenCalled();
  });

  it("uncaughtException：立即 fatal — shutdown 呼叫 + exit(1)", async () => {
    const { handleUncaughtException, shutdown, exitFn } = makeHandlers();

    handleUncaughtException(new Error("truly fatal"));

    await vi.waitFor(() => expect(exitFn).toHaveBeenCalledWith(1), { timeout: 500 });
    expect(shutdown).toHaveBeenCalledWith("uncaughtException");
    expect(logger.error).toHaveBeenCalledWith(
      "Fatal Error",
      expect.objectContaining({ reason: "uncaughtException" })
    );
  });

  it("rejection 風暴（≥ threshold）：升級 fatal", async () => {
    const { handleUnhandledRejection, shutdown, exitFn } = makeHandlers({
      stormThreshold: 3,
      stormWindowMs: 60_000,
    });

    handleUnhandledRejection(new Error("err1"));
    handleUnhandledRejection(new Error("err2"));
    handleUnhandledRejection(new Error("err3"));

    await vi.waitFor(() => expect(exitFn).toHaveBeenCalledWith(1), { timeout: 500 });
    expect(shutdown).toHaveBeenCalledWith("unhandledRejectionStorm");
  });

  it("threshold ≤ 0：完全停用風暴偵測，100 次也不 shutdown", async () => {
    const { handleUnhandledRejection, shutdown, exitFn } = makeHandlers({
      stormThreshold: 0,
    });

    for (let i = 0; i < 100; i++) {
      handleUnhandledRejection(new Error(`err${i}`));
    }

    await Promise.resolve();

    expect(shutdown).not.toHaveBeenCalled();
    expect(exitFn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(100);
  });

  it("重入保護：多次 fatal 呼叫只 shutdown 一次", async () => {
    const { handleUncaughtException, shutdown, exitFn } = makeHandlers();

    handleUncaughtException(new Error("first"));
    handleUncaughtException(new Error("second"));

    await vi.waitFor(() => expect(exitFn).toHaveBeenCalledWith(1), { timeout: 500 });
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exitFn).toHaveBeenCalledTimes(1);
  });
});

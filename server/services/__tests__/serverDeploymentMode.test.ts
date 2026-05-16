/**
 * serverDeploymentMode.test.ts
 *
 * 守住 multi-instance 偵測 + 一次性警告的行為:
 *   - 沒環境變數時偵測為 single instance,不警告
 *   - 命中已知 env var(NODE_APP_INSTANCE / K8S_POD_NAME 等)時偵測為
 *     multi instance + console.warn 出大字 banner
 *   - 第二次呼叫只追加子系統名,不重發 banner(per-process 一次)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __unsafe_resetDeploymentWarnedForTests,
  detectDeploymentMode,
  warnIfMultiInstanceSingleton,
} from "../serverDeploymentMode";

const MULTI_INSTANCE_ENV_KEYS = [
  "NODE_APP_INSTANCE",
  "PM2_INSTANCE_ID",
  "KUBERNETES_PORT",
  "K8S_POD_NAME",
  "NODE_CLUSTER_WORKERS",
  "WORKER_ID",
  "INSTANCE_ID",
];

describe("serverDeploymentMode", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // 清掉所有可能的 multi-instance env var,確保乾淨起點
    for (const key of MULTI_INSTANCE_ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    __unsafe_resetDeploymentWarnedForTests();
  });

  afterEach(() => {
    // 還原
    for (const key of MULTI_INSTANCE_ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    vi.restoreAllMocks();
  });

  describe("detectDeploymentMode", () => {
    it("沒任何 multi-instance 訊號時 isLikelyMultiInstance=false", () => {
      const mode = detectDeploymentMode();
      expect(mode.isLikelyMultiInstance).toBe(false);
      expect(mode.signals).toEqual([]);
      expect(mode.reason).toMatch(/single-instance/);
    });

    it.each([
      ["NODE_APP_INSTANCE", "1"],
      ["PM2_INSTANCE_ID", "2"],
      ["K8S_POD_NAME", "healing-pod-abc"],
      ["KUBERNETES_PORT", "tcp://10.0.0.1:443"],
      ["WORKER_ID", "worker-3"],
      ["INSTANCE_ID", "i-12345"],
    ])("命中 %s=%s 時偵測為 multi-instance + signal 列入", (key, value) => {
      process.env[key] = value;
      const mode = detectDeploymentMode();
      expect(mode.isLikelyMultiInstance).toBe(true);
      expect(mode.signals).toContain(`${key}=${value}`);
      expect(mode.reason).toMatch(/Detected multi-instance signals/);
    });

    it("env value='0' 視為單 instance(PM2 cluster id=0 是第一個 worker,但常被誤設)", () => {
      // 嚴格說 PM2 的 NODE_APP_INSTANCE=0 也是 cluster mode,但實務上很多
      // 環境會把空欄位填 0,過度敏感反而誤報。本邊界選保守:0 / 空字串
      // 都跳過。命中需要明確非零字串。
      process.env.NODE_APP_INSTANCE = "0";
      const mode = detectDeploymentMode();
      expect(mode.isLikelyMultiInstance).toBe(false);
    });

    it("env value='' 空字串也視為單 instance", () => {
      process.env.WORKER_ID = "";
      expect(detectDeploymentMode().isLikelyMultiInstance).toBe(false);
    });

    it("多訊號命中時全部列出", () => {
      process.env.K8S_POD_NAME = "pod-1";
      process.env.WORKER_ID = "w-2";
      const mode = detectDeploymentMode();
      expect(mode.signals).toContain("K8S_POD_NAME=pod-1");
      expect(mode.signals).toContain("WORKER_ID=w-2");
      expect(mode.signals.length).toBe(2);
    });
  });

  describe("warnIfMultiInstanceSingleton", () => {
    it("單 instance 完全不警告", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfMultiInstanceSingleton("foo", "does in-memory things");
      expect(warn).not.toHaveBeenCalled();
    });

    it("multi-instance 第一次呼叫印 banner + 子系統說明", () => {
      process.env.K8S_POD_NAME = "pod-1";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfMultiInstanceSingleton("orbScheduler", "double-trigger risk");
      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0][0] as string;
      expect(message).toMatch(/MULTI-INSTANCE DEPLOYMENT DETECTED/);
      expect(message).toMatch(/K8S_POD_NAME=pod-1/);
      expect(message).toMatch(/orbScheduler.*double-trigger risk/);
      expect(message).toMatch(/sticky session/);
      // `s` flag 才能跨換行(banner H6 與 L4 在相鄰兩行)
      expect(message).toMatch(/H6[\s\S]*L4/);
    });

    it("multi-instance 第二次呼叫只追加子系統行,不重發 banner", () => {
      process.env.K8S_POD_NAME = "pod-1";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfMultiInstanceSingleton("orbScheduler", "double-trigger risk");
      warnIfMultiInstanceSingleton("planExecutor", "cross-worker 404 risk");
      expect(warn).toHaveBeenCalledTimes(2);
      const second = warn.mock.calls[1][0] as string;
      // 第二次只是「-子系統名:行為」格式,沒大字 banner
      expect(second).toMatch(/planExecutor.*cross-worker 404 risk/);
      expect(second).not.toMatch(/MULTI-INSTANCE DEPLOYMENT DETECTED/);
    });

    it("__unsafe_resetDeploymentWarnedForTests 後可重新警告(測試清狀態用)", () => {
      process.env.K8S_POD_NAME = "pod-1";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      warnIfMultiInstanceSingleton("a", "x");
      __unsafe_resetDeploymentWarnedForTests();
      warnIfMultiInstanceSingleton("b", "y");
      expect(warn).toHaveBeenCalledTimes(2);
      // 兩次都該是 banner 格式
      expect(warn.mock.calls[0][0]).toMatch(/MULTI-INSTANCE DEPLOYMENT DETECTED/);
      expect(warn.mock.calls[1][0]).toMatch(/MULTI-INSTANCE DEPLOYMENT DETECTED/);
    });
  });
});

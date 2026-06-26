/**
 * inputGuard (AIDV-293) — JSON body depth guard 單元測試
 *
 * 驗收條件：
 *   1. 深度 ≥ maxDepth 的物件 → 回傳 400
 *   2. 合法深度的物件 → 呼叫 next()
 *   3. body 為 undefined → 通過（不拒絕）
 *   4. 深度 100 層巢狀 → 400（Billion Laughs 防護）
 */
import { describe, it, expect, vi } from "vitest";
import { _measureDepthForTest as measureDepth, jsonDepthGuard } from "./inputGuard";
import type { Request, Response, NextFunction } from "express";

function makeGuardMocks() {
  const state = { status: null as number | null, body: undefined as unknown };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(b: unknown) { state.body = b; return res; },
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { res, next, state };
}

describe("measureDepth (AIDV-293)", () => {
  it("空物件深度為 0", () => {
    expect(measureDepth({})).toBe(0);
  });

  it("一層巢狀深度為 1", () => {
    expect(measureDepth({ a: { b: 1 } })).toBe(1);
  });

  it("計算最大深度（不同分支取最深）", () => {
    // 最深分支 a.b.c → depth 2；x 是純量不計入
    expect(measureDepth({ a: { b: { c: 1 } }, x: 1 })).toBe(2);
  });

  it("陣列巢狀計深度（3 層）", () => {
    // [[[1]]] → depth 2（兩層容器嵌套）
    expect(measureDepth([[[1]]])).toBe(2);
  });

  it("純量值深度為 0", () => {
    expect(measureDepth("hello")).toBe(0);
    expect(measureDepth(42)).toBe(0);
    expect(measureDepth(null)).toBe(0);
  });

  it("達到 limit 時提前停止並回傳 ≥ limit", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const result = measureDepth(deep, 3);
    expect(result).toBeGreaterThanOrEqual(3);
  });
});

describe("jsonDepthGuard (AIDV-293)", () => {
  it("深度 < maxDepth → 呼叫 next()", () => {
    const guard = jsonDepthGuard(5);
    const req = { body: { a: { b: 1 } } } as unknown as Request;
    const { res, next } = makeGuardMocks();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("深度 ≥ maxDepth → 400 且不呼叫 next()", () => {
    const guard = jsonDepthGuard(2);
    // depth-2 object: { a: { b: { c: 1 } } } → depth=2, 2 >= 2 → reject
    const req = { body: { a: { b: { c: 1 } } } } as unknown as Request;
    const { res, next, state } = makeGuardMocks();
    guard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(state.status).toBe(400);
  });

  it("body 為 undefined → 通過", () => {
    const guard = jsonDepthGuard(5);
    const req = {} as unknown as Request;
    const { res, next } = makeGuardMocks();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("深度 100 層巢狀（模擬 Billion Laughs pattern）→ 400", () => {
    let deep: unknown = { val: 1 };
    for (let i = 0; i < 100; i++) deep = { nested: deep };
    const guard = jsonDepthGuard(32);
    const req = { body: deep } as unknown as Request;
    const { res, next, state } = makeGuardMocks();
    guard(req, res, next);
    expect(state.status).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

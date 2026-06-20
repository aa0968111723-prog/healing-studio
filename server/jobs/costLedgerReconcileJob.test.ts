/**
 * costLedgerReconcileJob.test.ts — AIDV-153 對帳 job 測試
 * ──────────────────────────────────────────────────────────────────────────
 *   - computeDrift 純函式：一致 / drift / epsilon 容忍
 *   - runReconcile 旗標 OFF → skipped（不對帳、不刷告警）
 *   - runReconcile 無 DATABASE_URL（demo/無 DB）→ skipped
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { computeDrift, runReconcile } from "./costLedgerReconcileJob";

const ORIGINAL_FLAG = process.env.ENABLE_COST_LEDGER;
const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  delete process.env.ENABLE_COST_LEDGER;
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.ENABLE_COST_LEDGER;
  else process.env.ENABLE_COST_LEDGER = ORIGINAL_FLAG;
  if (ORIGINAL_DB_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB_URL;
});

describe("computeDrift（純函式）", () => {
  it("一致 → hasDrift=false", () => {
    expect(computeDrift(10.5, 10.5)).toEqual({ drift: 0, hasDrift: false });
  });
  it("差額超過 epsilon → hasDrift=true", () => {
    const r = computeDrift(10, 7);
    expect(r.drift).toBe(3);
    expect(r.hasDrift).toBe(true);
  });
  it("差額在 epsilon 內 → hasDrift=false（浮點雜訊容忍）", () => {
    const r = computeDrift(10.0000001, 10);
    expect(r.hasDrift).toBe(false);
  });
  it("ledger < aggregations → 負 drift", () => {
    const r = computeDrift(5, 8);
    expect(r.drift).toBe(-3);
    expect(r.hasDrift).toBe(true);
  });
});

describe("runReconcile — HARD SAFETY skip", () => {
  it("旗標 OFF → skipped（不對帳）", async () => {
    delete process.env.ENABLE_COST_LEDGER;
    const r = await runReconcile();
    expect(r.status).toBe("skipped");
  });

  it("旗標 ON 但無 DATABASE_URL（demo/無 DB）→ skipped", async () => {
    process.env.ENABLE_COST_LEDGER = "1";
    delete process.env.DATABASE_URL;
    const r = await runReconcile();
    expect(r.status).toBe("skipped");
  });
});

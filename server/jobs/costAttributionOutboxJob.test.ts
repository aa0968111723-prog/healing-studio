/**
 * costAttributionOutboxJob.test.ts — AIDV-14 drain job HARD SAFETY 測試
 * ──────────────────────────────────────────────────────────────────────────
 * 驗收：旗標 OFF → skip；無 DATABASE_URL（demo/無 DB）→ skip（永不 throw）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { runDrain } from "./costAttributionOutboxJob";

const ORIG_FLAG = process.env.ENABLE_COST_ATTRIBUTION;
const ORIG_DB = process.env.DATABASE_URL;

afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_COST_ATTRIBUTION;
  else process.env.ENABLE_COST_ATTRIBUTION = ORIG_FLAG;
  if (ORIG_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIG_DB;
});

describe("runDrain — HARD SAFETY skip", () => {
  it("旗標 OFF → skipped（不 drain）", async () => {
    process.env.ENABLE_COST_ATTRIBUTION = "false";
    const r = await runDrain();
    expect(r.status).toBe("skipped");
  });

  it("旗標 ON 但無 DATABASE_URL（demo/無 DB）→ skipped、永不 throw", async () => {
    process.env.ENABLE_COST_ATTRIBUTION = "true";
    delete process.env.DATABASE_URL;
    const r = await runDrain();
    expect(r.status).toBe("skipped");
    expect(r.scanned).toBe(0);
  });
});

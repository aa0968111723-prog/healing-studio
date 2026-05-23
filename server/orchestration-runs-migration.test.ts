/**
 * orchestration-runs-migration.test.ts — M1-B
 *
 * 守住 0070 migration：必要欄位齊全、冪等（存在才 SELECT 1）、且每段以
 * `--> statement-breakpoint` 分隔（drizzle mysql2 migrator 才能逐句執行）。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(__dirname, "../drizzle/0070_orchestration_runs.sql"),
  "utf8",
);

describe("orchestration_runs migration (0070)", () => {
  it("creates the table with all required columns", () => {
    for (const col of [
      "id",
      "userId",
      "projectId",
      "teamId",
      "mode",
      "intent",
      "status",
      "commander",
      "estimatedCostUsd",
      "actualCostUsd",
      "errorMessage",
      "createdAt",
      "updatedAt",
    ]) {
      expect(sql).toContain("`" + col + "`");
    }
  });

  it("defines the status enum default as pending", () => {
    expect(sql).toMatch(/status.*enum\(.*''pending''/s);
    expect(sql).toContain("DEFAULT ''pending''");
  });

  it("is idempotent (guards table + index creation behind existence checks)", () => {
    expect(sql).toContain("information_schema.tables");
    expect(sql).toContain("information_schema.statistics");
    // 不可使用 MySQL 不支援的 CREATE INDEX IF NOT EXISTS。
    expect(sql).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("separates every statement with a breakpoint marker", () => {
    expect(sql).toContain("--> statement-breakpoint");
    // PREPARE/EXECUTE/DEALLOCATE 都必須各自成句。
    expect(sql).toContain("PREPARE orun_stmt FROM @stmt;");
    expect(sql).toContain("DEALLOCATE PREPARE orun_stmt;");
  });

  it("is registered in the drizzle journal", () => {
    const journal = readFileSync(
      resolve(__dirname, "../drizzle/meta/_journal.json"),
      "utf8",
    );
    expect(journal).toContain("0070_orchestration_runs");
  });
});

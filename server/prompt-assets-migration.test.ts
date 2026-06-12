/**
 * prompt-assets-migration.test.ts — prompt ↔ asset junction
 *
 * 守住 0075 migration：必要欄位齊全、relation enum 四值、雙向索引＋唯一鍵、
 * 兩側 FK ON DELETE CASCADE、冪等（存在才 SELECT 1）、每段以
 * `--> statement-breakpoint` 分隔（drizzle mysql2 migrator 才能逐句執行）、
 * 且已登記 journal（沒登記 = migrate 永遠不跑，0071–0074 的孤兒前例）。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(__dirname, "../drizzle/0075_prompt_assets.sql"),
  "utf8",
);

describe("prompt_assets migration (0075)", () => {
  it("creates the table with all required columns", () => {
    for (const col of ["id", "promptId", "assetId", "relation", "createdAt"]) {
      expect(sql).toContain("`" + col + "`");
    }
  });

  it("defines the relation enum with the four agreed values, default derived", () => {
    for (const value of ["derived", "variant", "rewrite", "extended"]) {
      expect(sql).toContain(`''${value}''`);
    }
    expect(sql).toContain("DEFAULT ''derived''");
  });

  it("creates both lookup indexes and the dedupe unique key", () => {
    expect(sql).toContain("pa_promptId_idx");
    expect(sql).toContain("pa_assetId_idx");
    expect(sql).toContain("pa_prompt_asset_rel_unique");
    expect(sql).toMatch(/CREATE UNIQUE INDEX `pa_prompt_asset_rel_unique`/);
  });

  it("adds FKs to prompt_library and digital_asset_library with ON DELETE CASCADE", () => {
    expect(sql).toMatch(
      /pa_promptId_fk` FOREIGN KEY \(`promptId`\) REFERENCES `prompt_library`\(`id`\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /pa_assetId_fk` FOREIGN KEY \(`assetId`\) REFERENCES `digital_asset_library`\(`id`\) ON DELETE CASCADE/,
    );
    // FK 建立也要冪等（information_schema.table_constraints 前檢）。
    expect(sql).toContain("information_schema.table_constraints");
  });

  it("is idempotent (guards table + index creation behind existence checks)", () => {
    expect(sql).toContain("information_schema.tables");
    expect(sql).toContain("information_schema.statistics");
    // 不可使用 MySQL 不支援的 CREATE INDEX IF NOT EXISTS。
    expect(sql).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
  });

  it("separates every statement with a breakpoint marker", () => {
    expect(sql).toContain("--> statement-breakpoint");
    expect(sql).toContain("PREPARE pa_stmt FROM @stmt;");
    expect(sql).toContain("DEALLOCATE PREPARE pa_stmt;");
  });

  it("documents the rollback path in the header", () => {
    expect(sql).toContain("DROP TABLE IF EXISTS `prompt_assets`");
  });

  it("is registered in the drizzle journal", () => {
    const journal = readFileSync(
      resolve(__dirname, "../drizzle/meta/_journal.json"),
      "utf8",
    );
    expect(journal).toContain("0075_prompt_assets");
  });
});

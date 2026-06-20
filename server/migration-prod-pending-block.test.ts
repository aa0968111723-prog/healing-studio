/**
 * migration-prod-pending-block.test.ts — 生產待套用區段的可重跑鐵則
 *
 * 背景（2026-06-13 真站驗證抓到的 P0）：生產的 migration runner 卡死在
 * 0066——首次部署時 0066 的裸 ALTER 已生效、但同批 0067 因「無
 * statement-breakpoint 的多語句＋MySQL 不支援的 CREATE INDEX IF NOT EXISTS」
 * 失敗，記帳（__drizzle_migrations INSERT）整批回滾；此後每次開機從 0066
 * 重跑就撞 Duplicate column，0067 之後（creative_projects、
 * orchestration_runs、prompt_assets…）永遠套不上 → 影片專案功能全 500。
 *
 * 三條鐵則（對「生產可能重跑」的 0063 以後所有條目）：
 *   1. 不可用 MySQL 不支援的 CREATE INDEX IF NOT EXISTS（全 drizzle/ 適用）。
 *   2. 每個 chunk（以 --> statement-breakpoint 分段）只能一個語句
 *      （mysql2 migrator 逐 chunk 執行、不開 multipleStatements）。
 *   3. ALTER TABLE / CREATE INDEX 必須有 information_schema 守門
 *      （裸寫＝重跑必爆）。CREATE TABLE 用 IF NOT EXISTS 即可。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const drizzleDir = resolve(__dirname, "../drizzle");

/** 生產可能整段重跑的待套用區（0066 卡死點之後全部會在同一輪跑）。 */
const PENDING_BLOCK = [
  "0063_prompt_collection",
  "0064_timeline_frames_and_compositions",
  "0065_real_earth_information_system",
  "0066_teaching_materials_real_earth_refs",
  "0067_creative_projects",
  "0068_creative_projects_bootstrap",
  "0069_creative_projects_worldview_script",
  "0070_orchestration_runs",
  "0075_prompt_assets",
  "0076_global_audit_log",
  "0077_resource_shares",
];

function readSql(tag: string): string {
  return readFileSync(resolve(drizzleDir, `${tag}.sql`), "utf8");
}

/** 去掉 -- 註解行，避免註解內的關鍵字干擾判斷。 */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter(line => !line.trim().startsWith("--") || line.includes("statement-breakpoint"))
    .join("\n");
}

describe("drizzle 全目錄：MySQL 語法地雷", () => {
  it("沒有任何 migration 使用 CREATE INDEX IF NOT EXISTS（MySQL 不支援）", () => {
    const offenders = readdirSync(drizzleDir)
      .filter(name => name.endsWith(".sql"))
      .filter(name =>
        /CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS/i.test(
          // 剝掉 -- 註解行（修復說明可能提到這個語法本身）。
          readFileSync(resolve(drizzleDir, name), "utf8")
            .split("\n")
            .filter(line => !line.trim().startsWith("--"))
            .join("\n")
        )
      );
    expect(offenders, `這些檔用了 MySQL 不支援的 CREATE INDEX IF NOT EXISTS：${offenders.join(", ")}`).toEqual([]);
  });
});

describe("生產待套用區段（0063–0077）可重跑鐵則", () => {
  it("每個 chunk 只含一個語句（procedure 檔除外）", () => {
    for (const tag of PENDING_BLOCK) {
      const chunks = stripComments(readSql(tag)).split("--> statement-breakpoint");
      for (const [i, chunk] of chunks.entries()) {
        // CREATE PROCEDURE…END 的內部分號屬同一語句，跳過。
        if (/CREATE\s+PROCEDURE/i.test(chunk)) continue;
        const semis = (chunk.match(/;/g) || []).length;
        expect(
          semis,
          `${tag} 的第 ${i + 1} 個 chunk 含 ${semis} 個分號（mysql2 一個 chunk 只能跑一句）`
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ALTER TABLE / CREATE INDEX 一律有守門（不可裸寫在行首）", () => {
    for (const tag of PENDING_BLOCK) {
      const sql = stripComments(readSql(tag));
      // 守門版都包在 SET @stmt := IF(...) 的字串裡或 procedure 身體裡，
      // 不會出現在行首。行首裸寫＝重跑必爆。
      const bare = sql
        .split("\n")
        .filter(line => /^(ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX)/i.test(line.trim()))
        // procedure 檔的內部語句已由 IF NOT EXISTS(table) 包住，放行。
        .filter(() => !/CREATE\s+PROCEDURE/i.test(sql));
      expect(
        bare,
        `${tag} 有裸寫的 ALTER/CREATE INDEX（需 information_schema 守門）：${bare.join(" | ")}`
      ).toEqual([]);
    }
  });

  it("0066/0069 的欄位新增有 information_schema.columns 守門", () => {
    for (const [tag, column] of [
      ["0066_teaching_materials_real_earth_refs", "realEarthRefs"],
      ["0069_creative_projects_worldview_script", "worldviewId"],
      ["0069_creative_projects_worldview_script", "scriptId"],
    ] as const) {
      const sql = readSql(tag);
      expect(sql, `${tag} 應守門欄位 ${column}`).toContain("information_schema.columns");
      expect(sql).toContain(column);
      expect(sql).toMatch(/PREPARE \w+ FROM @stmt;/);
    }
  });

  it("0067/0068 的索引建立有 information_schema.statistics 守門", () => {
    for (const tag of ["0067_creative_projects", "0068_creative_projects_bootstrap"]) {
      const sql = readSql(tag);
      expect(sql).toContain("information_schema.statistics");
      for (const idx of ["cp_userId_idx", "cp_userId_updatedAt_idx", "cp_worldFrameworkId_idx", "cp_worldStoryboardId_idx"]) {
        expect(sql, `${tag} 缺索引 ${idx} 的守門`).toContain(idx);
      }
    }
  });
});

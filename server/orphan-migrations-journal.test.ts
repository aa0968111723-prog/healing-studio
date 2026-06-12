/**
 * orphan-migrations-journal.test.ts — 0071–0074 孤兒 migration 補登記（AIDV-17）
 *
 * 背景：0071–0074 四支 .sql 寫好後忘了登記 _journal.json。drizzle migrate 只跑
 * journal 裡的條目（沒登記＝永遠不跑），所以 context_packets /
 * project_data_access_rules / data_source_connections / fine_tuned_models.teamId
 * 在生產從未建立，依賴它們的功能靜默空轉。
 *
 * 補登記的眉角（守住別再犯）：
 *   drizzle mysql2 migrator 的套用規則是「journal `when` > DB 內最後一筆
 *   created_at 才會跑」。0075（when=1779050000075）已套用，所以這四筆必須用
 *   **大於 0075 的 when** 追加在陣列尾端；照原號碼塞 1779050000071–074
 *   會被永遠跳過，等於白補。
 *
 * 仍在外面的已知孤兒（待議，不在 AIDV-17 卡面範圍）：
 *   0067_repair_worldbuilding_v4_columns — 0062 的冪等補洞保險。
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const drizzleDir = resolve(__dirname, "../drizzle");

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

const journal = JSON.parse(
  readFileSync(resolve(drizzleDir, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

const REGISTERED_ORPHANS = [
  "0071_context_packets",
  "0072_project_data_access_rules",
  "0073_data_source_connections",
  "0074_fine_tuned_models_team",
];

/**
 * 仍未登記的已知孤兒（皆不在 AIDV-17 拍板範圍 — 留待議，已回報 Jira）。
 * 補登記前必須逐支確認冪等性與 schema.ts 對應，並比照本 PR 用「大於
 * 最後一筆的 when」追加，否則永遠不會套用。
 */
const KNOWN_REMAINING_ORPHANS = new Set([
  // 0062 的補洞保險（worldbuilding v4 欄位）。
  "0067_repair_worldbuilding_v4_columns",
  // 與已登記的 0033_agent_model_picks 撞號的另一支 0033。
  "0033_add_plan_status_to_sessions",
  // orb 系列六連發（journal idx 38→45 之間的洞）。
  "0039_orb_long_term_memory",
  "0040_orb_intent_clarification",
  "0041_orb_feature_usage",
  "0042_orb_workflow_templates",
  "0043_orb_system_monitoring",
  "0044_orb_template_ratings_and_alerts",
]);

describe("orphan migrations 0071–0074 journal registration (AIDV-17)", () => {
  it("registers all four previously-orphaned migrations", () => {
    const tags = new Set(journal.entries.map(e => e.tag));
    for (const tag of REGISTERED_ORPHANS) {
      expect(tags.has(tag), `${tag} 應已登記 journal`).toBe(true);
    }
  });

  it("appends them AFTER 0075 with strictly larger `when` so already-migrated DBs actually apply them", () => {
    const entry0075 = journal.entries.find(e => e.tag === "0075_prompt_assets");
    expect(entry0075).toBeDefined();
    const pos0075 = journal.entries.indexOf(entry0075!);

    for (const tag of REGISTERED_ORPHANS) {
      const entry = journal.entries.find(e => e.tag === tag)!;
      // migrator 規則：只套用 when > 最後一筆 created_at 的條目。
      expect(
        entry.when,
        `${tag} 的 when 必須大於 0075（否則生產永遠不會套用）`,
      ).toBeGreaterThan(entry0075!.when);
      expect(
        journal.entries.indexOf(entry),
        `${tag} 必須排在 0075 之後（套用順序＝陣列順序）`,
      ).toBeGreaterThan(pos0075);
    }
  });

  it("keeps the whole journal `when` strictly increasing (a smaller-when entry later in the array would be silently skipped forever)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1];
      const cur = journal.entries[i];
      expect(
        cur.when,
        `journal[${i}] ${cur.tag} 的 when 必須大於前一筆 ${prev.tag}`,
      ).toBeGreaterThan(prev.when);
    }
  });

  it("every journal entry points at an existing .sql file (readMigrationFiles throws at boot otherwise)", () => {
    const files = new Set(
      readdirSync(drizzleDir)
        .filter(name => name.endsWith(".sql"))
        .map(name => name.replace(/\.sql$/, "")),
    );
    for (const entry of journal.entries) {
      expect(files.has(entry.tag), `journal 條目 ${entry.tag} 缺 .sql 檔`).toBe(true);
    }
  });

  it("each registered orphan stays idempotent (information_schema guard + breakpoints, no unsupported IF NOT EXISTS index)", () => {
    for (const tag of REGISTERED_ORPHANS) {
      const sql = readFileSync(resolve(drizzleDir, `${tag}.sql`), "utf8");
      expect(sql, `${tag} 應有 information_schema 守門`).toContain("information_schema.");
      expect(sql, `${tag} 應以 statement-breakpoint 分段`).toContain("--> statement-breakpoint");
      expect(sql, `${tag} 應走 PREPARE/EXECUTE 動態語句`).toMatch(/PREPARE \w+ FROM @stmt;/);
      // MySQL 不支援 CREATE INDEX IF NOT EXISTS。
      expect(sql).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
    }
  });

  it("drizzle/schema.ts already defines the tables these migrations create (the precondition that made registering safe)", () => {
    const schema = readFileSync(resolve(drizzleDir, "schema.ts"), "utf8");
    for (const table of [
      "context_packets",
      "project_data_access_rules",
      "data_source_connections",
    ]) {
      expect(schema, `schema.ts 應已定義 ${table}`).toContain(`"${table}"`);
    }
    // 0074 是對既有 fine_tuned_models 加 teamId 欄。
    expect(schema).toContain('"fine_tuned_models"');
    expect(schema).toMatch(/teamId/);
  });

  it("leaves no unexpected orphan .sql files (allowlist documents the known 待議 one)", () => {
    const registered = new Set(journal.entries.map(e => e.tag));
    const orphans = readdirSync(drizzleDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .map(name => name.replace(/\.sql$/, ""))
      .filter(tag => !registered.has(tag) && !KNOWN_REMAINING_ORPHANS.has(tag));
    expect(orphans, `新的孤兒 migration（請登記 journal 或加入允許清單）：${orphans.join(", ")}`).toEqual([]);
  });
});

/**
 * orphan-migrations-journal.test.ts — 孤兒 migration 補登記（AIDV-17）
 *
 * 背景：多支 .sql 寫好後忘了登記 _journal.json。drizzle migrate 只跑 journal 裡的
 * 條目（沒登記＝永遠不跑），所以依賴它們的 schema 在生產可能從未建立、相關功能
 * 靜默空轉。
 *
 * 補登記分兩批：
 *   第一批（0071–0074）：context_packets / project_data_access_rules /
 *     data_source_connections / fine_tuned_models.teamId。
 *   第二批（本批，AIDV-17 後續清掉開機 log 列出的剩餘孤兒）：
 *     0033_add_plan_status_to_sessions — agent_collaboration_sessions 的
 *       planStatus / planData 欄與 plan_status_idx；與已登記的 0033_agent_model_picks
 *       撞號但為不同檔。原本是裸 ALTER，已改寫為資訊綱要守門 + PREPARE/EXECUTE。
 *     0039–0044 — orb 系列六支（共 16 張表），CREATE TABLE IF NOT EXISTS 風格。
 *     0067_repair_worldbuilding_v4_columns — 0062 的冪等補洞保險（對基準 schema
 *       為 no-op，欄位已由 0062 建立）。
 *
 * 補登記眉角（守住別再犯）：
 *   drizzle mysql2 migrator 規則＝「journal `when` > DB 內最後一筆 created_at 才會跑」。
 *   故新批必須用**大於最後一筆（0079, when=1779050000083）的 when**追加在陣列尾端；
 *   照原號碼塞舊 when 會被永遠跳過、等於白補。每支都已用 Docker MySQL 對「已登記
 *   0000→0079 基準 schema」實跑驗證：乾淨套用 + 重跑 no-op + 模擬 fail-closed 整段
 *   重跑（刪掉尾端記帳、結構已存在）仍冪等成功。prod 已開 MIGRATION_FAIL_CLOSED=true，
 *   套用失敗會擋啟動，故這層驗證是上線前提。
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

/** guarded-ALTER 風格孤兒（information_schema 守門 + PREPARE/EXECUTE 動態語句）。 */
const REGISTERED_ORPHANS_GUARDED = [
  "0071_context_packets",
  "0072_project_data_access_rules",
  "0073_data_source_connections",
  "0074_fine_tuned_models_team",
  "0033_add_plan_status_to_sessions",
  "0067_repair_worldbuilding_v4_columns",
];

/** CREATE TABLE IF NOT EXISTS 風格孤兒（orb 系列新表，IF NOT EXISTS 即冪等）。 */
const REGISTERED_ORPHANS_CREATE_TABLE = [
  "0039_orb_long_term_memory",
  "0040_orb_intent_clarification",
  "0041_orb_feature_usage",
  "0042_orb_workflow_templates",
  "0043_orb_system_monitoring",
  "0044_orb_template_ratings_and_alerts",
];

const ALL_REGISTERED_ORPHANS = [
  ...REGISTERED_ORPHANS_GUARDED,
  ...REGISTERED_ORPHANS_CREATE_TABLE,
];

/** 第二批（本批）— 必須追加在 0079 之後、when 嚴格遞增，否則生產永遠不會套用。 */
const SECOND_WAVE = [
  "0033_add_plan_status_to_sessions",
  "0039_orb_long_term_memory",
  "0040_orb_intent_clarification",
  "0041_orb_feature_usage",
  "0042_orb_workflow_templates",
  "0043_orb_system_monitoring",
  "0044_orb_template_ratings_and_alerts",
  "0067_repair_worldbuilding_v4_columns",
];

describe("orphan migrations journal registration (AIDV-17)", () => {
  it("registers every previously-orphaned migration", () => {
    const tags = new Set(journal.entries.map(e => e.tag));
    for (const tag of ALL_REGISTERED_ORPHANS) {
      expect(tags.has(tag), `${tag} 應已登記 journal`).toBe(true);
    }
  });

  it("appends the second wave AFTER 0079 with strictly larger `when` so already-migrated DBs actually apply them", () => {
    const entry0079 = journal.entries.find(e => e.tag === "0079_cost_attribution");
    expect(entry0079).toBeDefined();
    const pos0079 = journal.entries.indexOf(entry0079!);

    for (const tag of SECOND_WAVE) {
      const entry = journal.entries.find(e => e.tag === tag);
      expect(entry, `${tag} 應已登記 journal`).toBeDefined();
      // migrator 規則：只套用 when > 最後一筆 created_at 的條目。
      expect(
        entry!.when,
        `${tag} 的 when 必須大於 0079（否則生產永遠不會套用）`,
      ).toBeGreaterThan(entry0079!.when);
      expect(
        journal.entries.indexOf(entry!),
        `${tag} 必須排在 0079 之後（套用順序＝陣列順序）`,
      ).toBeGreaterThan(pos0079);
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

  it("uses unique idx values (collisions would corrupt ordering/bookkeeping)", () => {
    const idxs = journal.entries.map(e => e.idx);
    expect(new Set(idxs).size, "journal idx 不可重複").toBe(idxs.length);
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

  it("guarded-style orphans stay idempotent (information_schema guard + PREPARE/EXECUTE, no unsupported IF NOT EXISTS index)", () => {
    for (const tag of REGISTERED_ORPHANS_GUARDED) {
      const sql = readFileSync(resolve(drizzleDir, `${tag}.sql`), "utf8");
      expect(sql, `${tag} 應有 information_schema 守門`).toContain("information_schema.");
      expect(sql, `${tag} 應以 statement-breakpoint 分段`).toContain("--> statement-breakpoint");
      expect(sql, `${tag} 應走 PREPARE/EXECUTE 動態語句`).toMatch(/PREPARE \w+ FROM @stmt;/);
      // MySQL 不支援 CREATE INDEX IF NOT EXISTS。
      expect(sql).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
    }
  });

  it("create-table-style orphans are idempotent via CREATE TABLE IF NOT EXISTS (every CREATE TABLE guarded, no bare ALTER/CREATE INDEX)", () => {
    for (const tag of REGISTERED_ORPHANS_CREATE_TABLE) {
      const sql = readFileSync(resolve(drizzleDir, `${tag}.sql`), "utf8");
      // 每個 CREATE TABLE 都必須 IF NOT EXISTS（重跑安全）。
      const creates = sql.match(/CREATE\s+TABLE/gi) ?? [];
      const guarded = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/gi) ?? [];
      expect(creates.length, `${tag} 應至少有一個 CREATE TABLE`).toBeGreaterThan(0);
      expect(
        guarded.length,
        `${tag} 的每個 CREATE TABLE 都要 IF NOT EXISTS（${guarded.length}/${creates.length}）`,
      ).toBe(creates.length);
      // 不可裸寫 ALTER TABLE / CREATE INDEX（行首）— 重跑必爆。
      const bare = sql
        .split("\n")
        .filter(line => /^(ALTER\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX)/i.test(line.trim()));
      expect(bare, `${tag} 有裸寫的 ALTER/CREATE INDEX：${bare.join(" | ")}`).toEqual([]);
      // MySQL 不支援 CREATE INDEX IF NOT EXISTS。
      expect(sql).not.toMatch(/CREATE INDEX IF NOT EXISTS/i);
    }
  });

  it("drizzle/schema.ts already defines the tables/columns these migrations create (the precondition that made registering safe)", () => {
    const schema = readFileSync(resolve(drizzleDir, "schema.ts"), "utf8");
    for (const table of [
      // 第一批
      "context_packets",
      "project_data_access_rules",
      "data_source_connections",
      // 第二批 orb 系列（每支取一張代表表）
      "orb_long_term_memories",
      "orb_intent_logs",
      "orb_feature_usage_stats",
      "orb_workflow_templates",
      "orb_spirit_collaboration_metrics",
      "orb_workflow_template_ratings",
      "orb_system_alerts",
    ]) {
      expect(schema, `schema.ts 應已定義 ${table}`).toContain(`"${table}"`);
    }
    // 0074 是對既有 fine_tuned_models 加 teamId 欄。
    expect(schema).toContain('"fine_tuned_models"');
    expect(schema).toMatch(/teamId/);
    // 0033 的 planStatus / planData 欄掛在 agent_collaboration_sessions。
    expect(schema).toContain('"agent_collaboration_sessions"');
    expect(schema).toMatch(/planStatus/);
    expect(schema).toMatch(/planData/);
  });

  it("leaves NO orphan .sql files at all — every numbered migration is now registered", () => {
    const registered = new Set(journal.entries.map(e => e.tag));
    const orphans = readdirSync(drizzleDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .map(name => name.replace(/\.sql$/, ""))
      .filter(tag => !registered.has(tag));
    expect(orphans, `仍有未登記的孤兒 migration（請登記 journal）：${orphans.join(", ")}`).toEqual([]);
  });
});

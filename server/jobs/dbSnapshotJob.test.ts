/**
 * dbSnapshotJob.test.ts — AIDV-57 每日 DB 備份 job 測試
 * ──────────────────────────────────────────────────────────────────────────────
 *   - isDbBackupEnabled：旗標預設 ON、明確 false/0/off/no 才 OFF
 *   - parseMysqlConnection：正常 / URL-encoded 密碼 / 非法 / 缺 DB
 *   - buildMysqldumpArgs：含安全旗標、不含密碼、不含 --all-databases
 *   - buildBackupKey：時間戳累積、key 前綴、字元清洗
 *   - takeDbBackup HARD-SAFETY skip：旗標 OFF / 無 DATABASE_URL / 無 R2 → 不執行
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDbBackupEnabled,
  parseMysqlConnection,
  buildMysqldumpArgs,
  buildBackupKey,
  takeDbBackup,
} from "./dbSnapshotJob";

const ORIGINAL = {
  ENABLE_DB_BACKUP: process.env.ENABLE_DB_BACKUP,
  DATABASE_URL: process.env.DATABASE_URL,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
};

function restore(key: keyof typeof ORIGINAL) {
  const v = ORIGINAL[key];
  if (v === undefined) delete process.env[key];
  else process.env[key] = v;
}

beforeEach(() => {
  delete process.env.ENABLE_DB_BACKUP;
});

afterEach(() => {
  (Object.keys(ORIGINAL) as Array<keyof typeof ORIGINAL>).forEach(restore);
});

// ─── isDbBackupEnabled ─────────────────────────────────────────────────────────

describe("isDbBackupEnabled — 預設 ON", () => {
  it("未設定 → ON（沒設＝有備份）", () => {
    delete process.env.ENABLE_DB_BACKUP;
    expect(isDbBackupEnabled()).toBe(true);
  });
  it("空字串 → ON", () => {
    process.env.ENABLE_DB_BACKUP = "";
    expect(isDbBackupEnabled()).toBe(true);
  });
  it('"true" / "1" → ON', () => {
    process.env.ENABLE_DB_BACKUP = "true";
    expect(isDbBackupEnabled()).toBe(true);
    process.env.ENABLE_DB_BACKUP = "1";
    expect(isDbBackupEnabled()).toBe(true);
  });
  it('明確 "false" / "0" / "off" / "no"（大小寫不拘）→ OFF', () => {
    for (const v of ["false", "0", "off", "no", "FALSE", "Off", " No "]) {
      process.env.ENABLE_DB_BACKUP = v;
      expect(isDbBackupEnabled()).toBe(false);
    }
  });
});

// ─── parseMysqlConnection ──────────────────────────────────────────────────────

describe("parseMysqlConnection", () => {
  it("解析標準 mysql:// 連線字串", () => {
    const c = parseMysqlConnection("mysql://hs:hs_dev_pw@127.0.0.1:3306/healing_studio");
    expect(c).toEqual({
      host: "127.0.0.1",
      port: 3306,
      user: "hs",
      password: "hs_dev_pw",
      database: "healing_studio",
    });
  });

  it("缺 port → 預設 3306", () => {
    const c = parseMysqlConnection("mysql://root:pw@db.internal/mydb");
    expect(c?.port).toBe(3306);
    expect(c?.host).toBe("db.internal");
  });

  it("URL-encoded 密碼（含 @ : / 等特殊字元）正確 decode", () => {
    // 密碼 = "p@ss:w/rd"
    const c = parseMysqlConnection(
      "mysql://u:p%40ss%3Aw%2Frd@host:3306/db?ssl=true"
    );
    expect(c?.password).toBe("p@ss:w/rd");
    expect(c?.database).toBe("db");
  });

  it("非 mysql 協定 → null", () => {
    expect(parseMysqlConnection("postgres://u:p@h:5432/db")).toBeNull();
  });

  it("缺 database → null", () => {
    expect(parseMysqlConnection("mysql://u:p@host:3306/")).toBeNull();
  });

  it("空 / 垃圾字串 → null", () => {
    expect(parseMysqlConnection("")).toBeNull();
    expect(parseMysqlConnection("   ")).toBeNull();
    expect(parseMysqlConnection("not a url")).toBeNull();
  });
});

// ─── buildMysqldumpArgs ────────────────────────────────────────────────────────

describe("buildMysqldumpArgs — prod 唯讀安全旗標", () => {
  const conn = {
    host: "127.0.0.1",
    port: 3306,
    user: "hs",
    password: "secret_should_not_appear",
    database: "healing_studio",
  };
  const args = buildMysqldumpArgs(conn);

  it("含 --single-transaction（InnoDB 一致快照、不鎖表）", () => {
    expect(args).toContain("--single-transaction");
  });
  it("含 --quick（串流、記憶體恆定）", () => {
    expect(args).toContain("--quick");
  });
  it("含 --lock-tables=false（不鎖表）", () => {
    expect(args).toContain("--lock-tables=false");
  });
  it("含 --routines / --triggers / --events（完整結構）", () => {
    expect(args).toContain("--routines");
    expect(args).toContain("--triggers");
    expect(args).toContain("--events");
  });
  it("密碼絕不出現在 argv（金鑰只走 MYSQL_PWD env）", () => {
    const joined = args.join(" ");
    expect(joined).not.toContain("secret_should_not_appear");
    expect(args.some(a => a.startsWith("-p") || a.startsWith("--password"))).toBe(
      false
    );
  });
  it("不用 --all-databases（只 dump 指定單庫，最小範圍）", () => {
    expect(args).not.toContain("--all-databases");
    expect(args).toContain("healing_studio");
  });
  it("host/port/user 以 long-form 帶入", () => {
    expect(args).toContain("--host=127.0.0.1");
    expect(args).toContain("--port=3306");
    expect(args).toContain("--user=hs");
  });
});

// ─── buildBackupKey ────────────────────────────────────────────────────────────

describe("buildBackupKey — 時間戳累積、不覆蓋", () => {
  it("key 前綴 db-backups/<db>/ 且以 .sql.gz 結尾", () => {
    const key = buildBackupKey("healing_studio", new Date("2026-06-21T18:00:00.000Z"));
    expect(key).toBe(
      "db-backups/healing_studio/healing_studio_2026-06-21T18-00-00-000Z.sql.gz"
    );
  });
  it("不同時間 → 不同 key（天然不覆蓋）", () => {
    const a = buildBackupKey("db", new Date("2026-06-21T00:00:00.000Z"));
    const b = buildBackupKey("db", new Date("2026-06-22T00:00:00.000Z"));
    expect(a).not.toBe(b);
  });
  it("DB 名含非法字元 → 清洗為底線（key 安全）", () => {
    const key = buildBackupKey("my db/with:weird*chars");
    expect(key).toMatch(/^db-backups\/my_db_with_weird_chars\//);
    expect(key).not.toMatch(/[/:*]/g.source.replace("/", "")); // 無殘留特殊字元（除路徑斜線）
  });
});

// ─── takeDbBackup HARD-SAFETY skip（不需真 DB / 真 mysqldump）──────────────────

describe("takeDbBackup — HARD SAFETY skip（永不 throw）", () => {
  it("旗標 OFF → status:skipped（reason flag_disabled），不執行 dump", async () => {
    process.env.ENABLE_DB_BACKUP = "false";
    const r = await takeDbBackup();
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("flag_disabled");
  });

  it("旗標 ON 但無 DATABASE_URL（demo / 無 DB）→ skipped", async () => {
    process.env.ENABLE_DB_BACKUP = "true";
    delete process.env.DATABASE_URL;
    const r = await takeDbBackup();
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("no_database_url");
  });

  it("DATABASE_URL 無法解析 → skipped（unparseable）", async () => {
    process.env.ENABLE_DB_BACKUP = "true";
    process.env.DATABASE_URL = "postgres://u:p@h:5432/db";
    const r = await takeDbBackup();
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("unparseable_database_url");
  });

  it("有 DATABASE_URL 但無 R2 設定 → skipped（no_r2_config，不會誤跑 dump）", async () => {
    process.env.ENABLE_DB_BACKUP = "true";
    process.env.DATABASE_URL = "mysql://u:p@127.0.0.1:3306/db";
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET_NAME;
    const r = await takeDbBackup();
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("no_r2_config");
  });
});

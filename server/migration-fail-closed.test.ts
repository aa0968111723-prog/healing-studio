/**
 * AIDV-61（H6）— Migration fail-closed 開機門測試
 *
 * 驗證四象限行為：
 *  1) 旗標 OFF（預設）＋migration 失敗 → getDb() 不拋、回連線（維持現狀 fail-open）。
 *  2) 旗標 ON ＋migration 失敗       → getDb() 拋（擋啟動，由 bootstrap fatal handler 接）。
 *  3) 旗標 ON ＋migration 成功       → getDb() 正常回連線。
 *  4) demo / 無 DATABASE_URL ＋旗標 ON/OFF → getDb() 回 null、migrate() 從不被呼叫
 *     （demo 不受旗標影響、絕不會開不了機）。
 *
 * 另含 isMigrationFailClosed() 純函式的解析表（truthy/falsy 邊界）。
 *
 * 隔離法：mock `drizzle-orm/mysql2`（連線）與 `drizzle-orm/mysql2/migrator`（migrate），
 * 不碰真實 MySQL；每個案例用 vi.resetModules()＋動態 import 取得乾淨的 db.ts 模組狀態
 * （_db / _migrationsDone / _migrationsInFlight / _migrationsLastFailedAt 皆為模組私有）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// migrate() 的 mock — 每個案例用 mockImplementation 決定成功/失敗。
const migrateMock = vi.fn<(...args: unknown[]) => Promise<void>>();
// drizzle() 連線工廠的 mock — 回一個帶 $client 的假連線物件。
const fakeDbConnection = { $client: { end: vi.fn() } };
const drizzleMock = vi.fn(() => fakeDbConnection);

vi.mock("drizzle-orm/mysql2/migrator", () => ({
  migrate: (...args: unknown[]) => migrateMock(...args),
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: (...args: unknown[]) => drizzleMock(...args),
}));

// MIGRATION_FAIL_CLOSED 旗標：用 vi.hoisted 建立可變物件（vi.mock 工廠被提升到檔頭，
// 不能引用一般 top-level 變數）。預設 "false"（OFF＝fail-open＝現狀）。
const { migrationEnvMock } = vi.hoisted(() => ({
  migrationEnvMock: { MIGRATION_FAIL_CLOSED: "false" } as { MIGRATION_FAIL_CLOSED: string },
}));
vi.mock("./_core/env.validated", () => ({
  serverEnv: migrationEnvMock,
}));

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * 取得一份乾淨的 db.ts 模組（重置其模組私有狀態），讓每個案例互不污染。
 */
async function freshDbModule() {
  vi.resetModules();
  return import("./db");
}

beforeEach(() => {
  migrateMock.mockReset();
  drizzleMock.mockClear();
  migrationEnvMock.MIGRATION_FAIL_CLOSED = "false";
  // 預設給一個有效的 DATABASE_URL，讓「真的會跑 migration」的案例成立。
  process.env.DATABASE_URL = "mysql://user:pass@localhost:3306/test";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.restoreAllMocks();
});

describe("isMigrationFailClosed() — 純函式解析表", () => {
  it.each([
    ["true", true],
    ["TRUE", true],
    ["  true  ", true],
    ["1", true],
    ["on", true],
    ["yes", true],
    ["YES", true],
  ])("'%s' → ON (true)", async (value, expected) => {
    migrationEnvMock.MIGRATION_FAIL_CLOSED = value;
    const { isMigrationFailClosed } = await freshDbModule();
    expect(isMigrationFailClosed()).toBe(expected);
  });

  it.each([
    ["false", false],
    ["FALSE", false],
    ["0", false],
    ["off", false],
    ["no", false],
    ["", false],
    ["  ", false],
    ["maybe", false],
    ["2", false],
  ])("'%s' → OFF (false)", async (value, expected) => {
    migrationEnvMock.MIGRATION_FAIL_CLOSED = value;
    const { isMigrationFailClosed } = await freshDbModule();
    expect(isMigrationFailClosed()).toBe(expected);
  });

  it("未設定（undefined）→ OFF（安全預設）", async () => {
    // 模擬 serverEnv 完全沒有該鍵的退化情境（?? "" 兜底）。
    delete (migrationEnvMock as Partial<typeof migrationEnvMock>).MIGRATION_FAIL_CLOSED;
    const { isMigrationFailClosed } = await freshDbModule();
    expect(isMigrationFailClosed()).toBe(false);
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "false"; // 還原給 afterEach 後續案例
  });
});

describe("getDb()/applyMigrations — fail-closed 四象限", () => {
  it("旗標 OFF ＋migration 失敗 → getDb() 不拋、回連線（fail-open 現狀）", async () => {
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "false";
    migrateMock.mockRejectedValue(new Error("boom: bad SQL syntax"));
    const { getDb } = await freshDbModule();

    const db = await getDb();
    // 連線本身建立成功，migration 失敗只被吞掉（log），服務照常。
    expect(db).toBe(fakeDbConnection);
    expect(migrateMock).toHaveBeenCalledTimes(1);
  });

  it("旗標 ON ＋migration 失敗 → getDb() 拋（擋啟動）", async () => {
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "true";
    const failure = new Error("boom: duplicate column");
    migrateMock.mockRejectedValue(failure);
    const { getDb } = await freshDbModule();

    await expect(getDb()).rejects.toThrow(/duplicate column/);
    expect(migrateMock).toHaveBeenCalledTimes(1);
  });

  it("旗標 ON ＋migration 成功 → getDb() 正常回連線", async () => {
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "true";
    migrateMock.mockResolvedValue(undefined);
    const { getDb } = await freshDbModule();

    const db = await getDb();
    expect(db).toBe(fakeDbConnection);
    expect(migrateMock).toHaveBeenCalledTimes(1);
  });

  it("demo / 無 DATABASE_URL ＋旗標 ON → getDb() 回 null、migrate() 從不被呼叫", async () => {
    process.env.DATABASE_URL = ""; // demo：無 DB
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "true"; // 即使開了 fail-closed
    const { getDb, runMigrations } = await freshDbModule();

    const db = await getDb();
    expect(db).toBeNull();
    // 關鍵安全保證：demo 根本不進 migration 套用流程，旗標 ON 也不會讓 demo 開不了機。
    expect(migrateMock).not.toHaveBeenCalled();
    expect(drizzleMock).not.toHaveBeenCalled();

    // runMigrations() 也只是轉呼 getDb()，demo 下同樣安靜回 undefined、不拋。
    await expect(runMigrations()).resolves.toBeUndefined();
    expect(migrateMock).not.toHaveBeenCalled();
  });

  it("demo / 無 DATABASE_URL ＋旗標 OFF → getDb() 回 null、migrate() 從不被呼叫", async () => {
    process.env.DATABASE_URL = "";
    migrationEnvMock.MIGRATION_FAIL_CLOSED = "false";
    const { getDb } = await freshDbModule();

    const db = await getDb();
    expect(db).toBeNull();
    expect(migrateMock).not.toHaveBeenCalled();
  });
});

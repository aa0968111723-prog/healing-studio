/**
 * dbSnapshotJob.ts — AIDV-57 每日 MySQL 資料庫備份（dump → gzip → Cloudflare R2）
 * ──────────────────────────────────────────────────────────────────────────────
 * 每天凌晨 02:00（container-local，預設 UTC）將正式庫做一致性快照、串流壓縮後
 * 上傳 R2。
 *
 * 設計原則（嚴守 AIDV 安全鐵則）：
 *   1. Prod 唯讀：只用 mysqldump 讀 DB；`--single-transaction`（InnoDB 一致快照、
 *      不鎖表）+ `--quick`（逐列串流、記憶體恆定）+ `--lock-tables=false`。
 *      備份流程「絕不」對 DB 寫入 / DROP / 還原。
 *   2. Demo / 無 DATABASE_URL → 直接跳過（早退），與 getDb()===null 的降級一致。
 *   3. 不阻塞 / 不拖垮：每日一次、off-peak；mysqldump → gzip → 串流落到暫存檔
 *      （位元組不整包進 Node 記憶體），再以已知 ContentLength 上傳 R2。任何失敗
 *      只記 console.warn + Sentry，**永不 throw**、不讓 app crash（fail-safe）；
 *      ENABLE_DB_BACKUP 旗標預設 ON、可關。
 *   4. 金鑰只走 env：連線字串讀 process.env.DATABASE_URL（DB 密碼需拆解析，故不能
 *      只用 serverEnv 字串）；R2 reuse 既有 S3_* client（同 r2SnapshotJob，無新
 *      金鑰、無新依賴）。log **絕不**印密碼：密碼以 MYSQL_PWD env 傳給子程序
 *      （不進 argv，不會出現在 process list / 任何 log），連線資訊只印
 *      host/port/db/user。
 *
 * 為何用暫存檔而非 multipart 串流：避免新增 @aws-sdk/lib-storage 依賴（鐵則「不新增
 *   依賴」）。dump → gzip 先串流寫到 os.tmpdir() 的暫存檔（記憶體恆定），再用既有
 *   @aws-sdk/client-s3 的 PutObjectCommand + createReadStream + ContentLength 上傳，
 *   最後刪暫存檔。DB 規模小（gzip 後約 1–3MB），暫存檔成本可忽略。
 *
 * 保留策略：本基礎版採「時間戳累積」（key 含 ISO timestamp，天然不覆蓋）。R2
 *   lifecycle rule 或後續清理 job 可刪 N 天前舊備份——見 docs/guides/DB_RESTORE_SOP.md。
 */

import * as cron from "node-cron";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { captureError } from "../_core/errorTracking.js";

// ─── State ───────────────────────────────────────────────────────────────────
let cronTask: cron.ScheduledTask | null = null;
/** 防重入：上一輪還在跑時，新一輪直接跳過（dump 可能跨分鐘）。 */
let isRunning = false;

// ─── 旗標 ─────────────────────────────────────────────────────────────────────

/**
 * ENABLE_DB_BACKUP — 預設 ON。
 * 只有明確設成 "false" / "0" / "off" / "no"（大小寫不拘）才關閉；其餘（含留空、
 * 未設、"true"/"1"）皆視為開啟。讓「沒設＝有備份」（安全預設），需要時可關。
 */
export function isDbBackupEnabled(): boolean {
  const raw = (process.env.ENABLE_DB_BACKUP ?? "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off" || raw === "no") return false;
  return true;
}

// ─── 連線字串解析（純函式，可測） ──────────────────────────────────────────────

export interface MysqlConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * 解析 `mysql://user:pass@host:port/dbname[?...]` 為各欄位。
 * 用內建 URL 解析並 decodeURIComponent（密碼可能含 %xx 編碼）。
 * 解析失敗或缺 database 回 null（呼叫端據此跳過，不硬幹）。
 */
export function parseMysqlConnection(databaseUrl: string): MysqlConnection | null {
  const trimmed = (databaseUrl ?? "").trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "mysql:" && u.protocol !== "mysql2:") return null;
    const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!database) return null;
    const port = u.port ? Number.parseInt(u.port, 10) : 3306;
    if (!Number.isFinite(port) || port <= 0) return null;
    return {
      host: u.hostname,
      port,
      user: decodeURIComponent(u.username || "root"),
      password: decodeURIComponent(u.password || ""),
      database,
    };
  } catch {
    return null;
  }
}

/**
 * 組 mysqldump 參數（不含密碼——密碼走 MYSQL_PWD env，絕不進 argv）。
 * 鐵則對應：
 *   --single-transaction  InnoDB 一致快照、不鎖表（prod 唯讀、不阻塞寫入）
 *   --quick               逐列串流、不在 dump 端緩衝整表（記憶體恆定）
 *   --lock-tables=false   InnoDB best practice（與 single-transaction 並用）
 *   --routines --triggers --events  完整結構（stored proc / trigger / event）
 *   --no-tablespaces      不需 PROCESS 權限即可 dump（最小權限帳號也能跑）
 * 只 dump 指定 database（單庫），不用 --all-databases：最小範圍、避免誤抓系統庫。
 *
 * ⚠️ 為何「不」帶 --set-gtid-purged=OFF / --column-statistics=0（曾經有、已移除）：
 *   runtime（Dockerfile runner 階段）裝的是 Alpine 的 mariadb-client，其 mysqldump
 *   是 MariaDB fork，**不認得**這兩個 MySQL-8-client 專屬旗標——帶了會直接 exit 7、
 *   產出 0-byte dump（＝備份壞掉）。兩者對我們也都非必要：
 *     • --column-statistics 是 MySQL 8.0 client 才有的東西（會去查 column_statistics
 *       直方圖）；MariaDB client 根本不做這件事，旗標既多餘又會報錯。
 *     • --set-gtid-purged 是 MySQL 專屬；MariaDB client 不支援，且我們本就還原到
 *       「新空庫」、不依賴 GTID 對齊。
 *   （MariaDB client 能連 MySQL 8 server 的 caching_sha2_password 認證，靠 Dockerfile
 *    另裝的 mariadb-connector-c plugin——見 Dockerfile runner 階段。）
 */
export function buildMysqldumpArgs(conn: MysqlConnection): string[] {
  return [
    `--host=${conn.host}`,
    `--port=${conn.port}`,
    `--user=${conn.user}`,
    "--single-transaction",
    "--quick",
    "--lock-tables=false",
    "--routines",
    "--triggers",
    "--events",
    "--no-tablespaces",
    "--default-character-set=utf8mb4",
    conn.database,
  ];
}

/**
 * 產生 R2 物件 key：`db-backups/<db>/<db>_<ISO_timestamp>.sql.gz`。
 * 時間戳用 UTC、把 `:`/`.` 換成 `-`（R2 key 友善），天然不覆蓋既有備份。
 */
export function buildBackupKey(database: string, now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[:.]/g, "-"); // 2026-06-21T18-00-00-000Z
  const safeDb = database.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `db-backups/${safeDb}/${safeDb}_${ts}.sql.gz`;
}

// ─── R2 設定 ──────────────────────────────────────────────────────────────────

interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

/** 從 env 讀 S3/R2 設定（reuse r2SnapshotJob 同一套）；缺任一必填回 null。 */
function readR2Config(): R2Config | null {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucket = process.env.S3_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: process.env.S3_REGION || "auto",
  };
}

// ─── dump → gzip → 暫存檔（串流，記憶體恆定，永不 throw 給呼叫端的版本見 takeDbBackup）

/**
 * 把 mysqldump 的輸出經 gzip 串流寫到 destPath。
 * 解析成功 = mysqldump exit 0 且檔案寫完；任何錯誤 reject。
 * 密碼以 MYSQL_PWD 傳給子程序（不進 argv）。
 */
export async function dumpToGzipFile(
  conn: MysqlConnection,
  destPath: string
): Promise<void> {
  const args = buildMysqldumpArgs(conn);
  const child = spawn("mysqldump", args, {
    env: { ...process.env, MYSQL_PWD: conn.password },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // 收集 stderr 末段供失敗診斷（不含密碼：argv 無 -p、stderr 不回顯密碼）。
  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-2000);
  });

  // mysqldump 程序層級結果（spawn error / 非 0 exit）。
  const dumpExit = new Promise<void>((resolve, reject) => {
    child.on("error", reject); // 例如 mysqldump 不存在（ENOENT）
    child.on("close", code => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `mysqldump exited with code ${code}: ${stderrTail.trim() || "(no stderr)"}`
          )
        );
    });
  });

  // 串流管道：dump.stdout → gzip → 檔案。pipeline 會在任一端出錯時清理。
  const pipe = pipeline(child.stdout, createGzip(), createWriteStream(destPath));

  // 兩者都成功才算成功；其一失敗則殺掉子程序避免殘留。
  try {
    await Promise.all([dumpExit, pipe]);
  } catch (err) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// ─── 核心：執行一次備份 ────────────────────────────────────────────────────────

export interface DbBackupResult {
  status: "ok" | "skipped" | "error";
  reason?: string;
  /** 上傳成功時的 R2 key。 */
  key?: string;
  /** 壓縮後上傳的位元組數（可觀測）。 */
  bytesUploaded?: number;
  elapsedMs?: number;
}

/**
 * 執行一次 DB 備份：mysqldump → gzip → 暫存檔 → R2 PutObject。
 * 永不 throw——一切失敗收斂成 { status:"error" | "skipped" }，由呼叫端決定 log。
 */
export async function takeDbBackup(): Promise<DbBackupResult> {
  const startTime = Date.now();

  // ── 旗標門（預設 ON）─────────────────────────────────────────────────────
  if (!isDbBackupEnabled()) {
    console.log("[DbBackup] ⏭️  ENABLE_DB_BACKUP=false，跳過 DB 備份。");
    return { status: "skipped", reason: "flag_disabled" };
  }

  // ── DATABASE_URL 門（demo / 無 DB → 跳過，與 getDb()===null 一致）──────────
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.warn("[DbBackup] ⚠️  未設定 DATABASE_URL（demo / 無 DB），跳過 DB 備份。");
    return { status: "skipped", reason: "no_database_url" };
  }

  const conn = parseMysqlConnection(databaseUrl);
  if (!conn) {
    console.warn(
      "[DbBackup] ⚠️  DATABASE_URL 無法解析為 mysql 連線字串，跳過 DB 備份。"
    );
    return { status: "skipped", reason: "unparseable_database_url" };
  }

  // ── R2 門（無 S3_* → 跳過）────────────────────────────────────────────────
  const r2 = readR2Config();
  if (!r2) {
    console.warn(
      "[DbBackup] ⚠️  R2 環境變數未設定（S3_ENDPOINT / S3_ACCESS_KEY_ID / " +
        "S3_SECRET_ACCESS_KEY / S3_BUCKET_NAME），無處上傳，跳過 DB 備份。"
    );
    return { status: "skipped", reason: "no_r2_config" };
  }

  const key = buildBackupKey(conn.database);
  const tmpFile = join(
    tmpdir(),
    `hs-dbbackup-${Date.now()}-${Math.random().toString(36).slice(2)}.sql.gz`
  );
  // log 只印非敏感的連線資訊——密碼絕不出現。
  console.log(
    `[DbBackup] 🗄️  開始備份 ${conn.user}@${conn.host}:${conn.port}/${conn.database} → r2://${r2.bucket}/${key}`
  );

  try {
    // 1) dump → gzip → 暫存檔（串流，記憶體恆定）
    await dumpToGzipFile(conn, tmpFile);

    // 2) 取檔案大小（PutObject 需要 ContentLength；空檔視為失敗）
    const { size } = await stat(tmpFile);
    if (size === 0) {
      throw new Error("backup file is empty (0 bytes) — mysqldump produced no output");
    }

    // 3) 串流上傳 R2（reuse 既有 client-s3，無新依賴）
    const s3 = new S3Client({
      region: r2.region,
      endpoint: r2.endpoint,
      credentials: {
        accessKeyId: r2.accessKeyId,
        secretAccessKey: r2.secretAccessKey,
      },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: createReadStream(tmpFile),
        ContentLength: size,
        ContentType: "application/gzip",
      })
    );

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[DbBackup] ✅ 備份完成（${elapsedMs}ms，${(size / 1024).toFixed(1)} KB gzip）→ r2://${r2.bucket}/${key}`
    );
    return { status: "ok", key, bytesUploaded: size, elapsedMs };
  } catch (err) {
    // fail-safe：吞錯，記 console.warn + Sentry，絕不往上拋。
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[DbBackup] ❌ 備份失敗（不影響服務）：${message}`);
    captureError(err, { job: "dbSnapshotJob", database: conn.database, key });
    return { status: "error", reason: message, elapsedMs: Date.now() - startTime };
  } finally {
    // 清理暫存檔（不存在 / 已刪也無妨）。
    await unlink(tmpFile).catch(() => {
      /* ignore */
    });
  }
}

// ─── Cron Lifecycle ────────────────────────────────────────────────────────────

/**
 * 啟動每日 DB 備份 cron。
 * 規格 `0 2 * * *` 表「container 本地時區的凌晨 2:00」。Railway 容器預設 UTC，
 * 故實際是 02:00 UTC（= 10:00 UTC+8，台灣上午低流量時段，與 r2SnapshotJob 的
 * 18:00 UTC 錯開、不互踩）。要嚴格對齊「台灣凌晨 2 點」可在 Railway 設 TZ=Asia/Taipei。
 */
export function initDbBackupCron(): void {
  if (cronTask) {
    console.warn("[DbBackup] Cron already initialized, skipping.");
    return;
  }
  cronTask = cron.schedule("0 2 * * *", () => {
    if (isRunning) {
      console.warn("[DbBackup] 上一輪備份尚未結束，跳過本次觸發。");
      return;
    }
    isRunning = true;
    takeDbBackup()
      .catch(err => {
        // takeDbBackup 設計上不 throw；保險再吞一層。
        console.error("[DbBackup] Cron unexpected error:", err);
        captureError(err, { job: "dbSnapshotJob", phase: "cron" });
      })
      .finally(() => {
        isRunning = false;
      });
  });
  console.log(
    "[DbBackup] ✅ Cron initialized (daily at 02:00 container-local / 預設 UTC)"
  );
}

/** 停止每日 DB 備份 cron。 */
export function stopDbBackupCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log("[DbBackup] 🛑 Cron stopped");
  }
}

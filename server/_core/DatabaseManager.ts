import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { AppError } from "./error_handler";
import { logger } from "./logger";

type TransactionExecutor<T> = (connection: PoolConnection) => Promise<T>;

export class DatabaseManager {
  private readonly pool: Pool;

  constructor(databaseUrl: string, connectionLimit: number = 30) {
    this.pool = mysql.createPool({
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30_000,
      idleTimeout: 120_000,
    });
  }

  async query<T extends RowDataPacket[]>(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<T> {
    const startedAt = Date.now();

    try {
      const [rows] = await this.pool.query<T>(sql, params as any[]);
      const elapsedMs = Date.now() - startedAt;

      this.logSqlTelemetry(sql, params, elapsedMs);
      return rows;
    } catch (error) {
      this.handleSqlError(error, sql, params);
    }
  }

  async execute(
    sql: string,
    params: readonly unknown[] = []
  ): Promise<ResultSetHeader> {
    const startedAt = Date.now();

    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        sql,
        params as any[]
      );
      const elapsedMs = Date.now() - startedAt;

      this.logSqlTelemetry(sql, params, elapsedMs);
      return result;
    } catch (error) {
      this.handleSqlError(error, sql, params);
    }
  }

  async executeTransaction<T>(executor: TransactionExecutor<T>): Promise<T> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await executor(connection);
      await connection.commit();
      logger.info("Database transaction committed");
      return result;
    } catch (error) {
      await connection.rollback();
      logger.warn("Database transaction rolled back", { err: error });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Return a snapshot of the current connection pool state.
   * Uses the underlying mysql2 pool internals (available on Pool instances).
   */
  getPoolStats(): { total: number; active: number; idle: number; queued: number } {
    const p = this.pool as Pool & {
      pool?: {
        _allConnections?: unknown[];
        _acquiringConnections?: unknown[];
        _freeConnections?: unknown[];
        _connectionQueue?: unknown[];
      };
    };
    const inner = p.pool;
    const total = inner?._allConnections?.length ?? 0;
    const acquiring = inner?._acquiringConnections?.length ?? 0;
    const idle = inner?._freeConnections?.length ?? 0;
    const queued = inner?._connectionQueue?.length ?? 0;
    const active = total - idle - acquiring;
    return { total, active, idle, queued };
  }

  /**
   * Return pool utilisation as a value between 0 and 1.
   * Computed as active connections / total connections.
   */
  getPoolUtilization(): number {
    const stats = this.getPoolStats();
    return stats.total > 0 ? stats.active / stats.total : 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
    logger.info("Database pool closed");
  }

  private logSqlTelemetry(
    sql: string,
    params: readonly unknown[],
    elapsedMs: number
  ): void {
    const metadata = { sql, params, elapsedMs };
    if (elapsedMs > 500) {
      logger.warn("[Slow Query]", metadata);
      return;
    }
    logger.info("SQL executed", metadata);
  }

  private handleSqlError(
    error: unknown,
    sql: string,
    params: readonly unknown[]
  ): never {
    const err = error as Error & {
      code?: string;
      sqlState?: string;
      sqlMessage?: string;
      errno?: number;
    };

    logger.error("SQL execution failed", {
      sql,
      params,
      err,
    });

    const isParseError = err.code === "ER_PARSE_ERROR";
    throw new AppError({
      message: isParseError
        ? "SQL parse error encountered"
        : "Database query failed",
      statusCode: 500,
      isOperational: true,
      errorCode: err.code ?? "DATABASE_ERROR",
      cause: err,
    });
  }
}

let singleton: DatabaseManager | null = null;

export function getDatabaseManager(): DatabaseManager {
  if (singleton) return singleton;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new AppError({
      message: "DATABASE_URL is missing",
      statusCode: 500,
      isOperational: false,
      errorCode: "DATABASE_URL_MISSING",
    });
  }

  singleton = new DatabaseManager(databaseUrl);
  return singleton;
}

export async function closeDatabaseManager(): Promise<void> {
  if (!singleton) return;
  await singleton.close();
  singleton = null;
}

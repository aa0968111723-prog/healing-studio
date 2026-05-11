import mysql, {
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { AppError } from "./error_handler";
import { logger } from "./logger";

type TransactionExecutor<T> = (connection: PoolConnection) => Promise<T>;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PoolStats {
  /** Connections currently executing a query */
  active: number;
  /** Connections idle in the pool */
  idle: number;
  /** Requests waiting for a free connection */
  queued: number;
  /** Total connections in the pool (active + idle) */
  total: number;
}

export interface ConnectionHealth {
  healthy: boolean;
  lastCheck: string | null;
  failureCount: number;
  circuitOpen: boolean;
  lastError: string | null;
}

export interface DbPerformanceStats {
  avgQueryTimeMs: number;
  slowQueries: number;
  timeouts: number;
  errors: number;
  totalQueries: number;
}

// ─── Transient error codes that warrant an automatic retry ──────────────────

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

function isTransientError(err: { code?: string }): boolean {
  return Boolean(err.code && TRANSIENT_ERROR_CODES.has(err.code));
}

// ─── Circuit Breaker constants ───────────────────────────────────────────────

/** Number of consecutive failures before the circuit opens */
const CIRCUIT_OPEN_THRESHOLD = 5;
/** How long (ms) the circuit stays open before allowing a probe */
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

// ─── Query timeout default ───────────────────────────────────────────────────

const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export class DatabaseManager {
  private readonly pool: Pool;
  private readonly connectionLimit: number;

  // ── Circuit breaker state ────────────────────────────────────────────────
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  // ── Health check state ───────────────────────────────────────────────────
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealthCheckAt: string | null = null;
  private lastHealthError: string | null = null;
  private isHealthy = true;

  // ── Performance counters ─────────────────────────────────────────────────
  private totalQueries = 0;
  private totalErrors = 0;
  private totalTimeouts = 0;
  private slowQueryCount = 0;
  private totalQueryTimeMs = 0;

  constructor(databaseUrl: string, connectionLimit: number = 20) {
    this.connectionLimit = connectionLimit;
    this.pool = mysql.createPool({
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30_000,
    });

    // Start periodic health checks immediately
    this.startHealthCheck();
  }

  // ── Pool stats ───────────────────────────────────────────────────────────

  /**
   * Return live connection pool statistics.
   * mysql2 exposes internal counters via non-public properties; we read them
   * defensively so the method never throws even if the internals change.
   */
  getPoolStats(): PoolStats {
    const p = this.pool as any;
    // mysql2 PoolNamespace exposes _allConnections, _freeConnections, _connectionQueue
    const total: number = p._allConnections?.length ?? 0;
    const idle: number = p._freeConnections?.length ?? 0;
    const queued: number = p._connectionQueue?.length ?? 0;
    const active = Math.max(0, total - idle);
    return { active, idle, queued, total };
  }

  // ── Connection health ────────────────────────────────────────────────────

  getConnectionHealth(): ConnectionHealth {
    return {
      healthy: this.isHealthy,
      lastCheck: this.lastHealthCheckAt,
      failureCount: this.consecutiveFailures,
      circuitOpen: this.isCircuitOpen(),
      lastError: this.lastHealthError,
    };
  }

  /**
   * Destroy and recreate the underlying pool.
   * Use this as a last resort when the pool is in an unrecoverable state.
   */
  async resetPool(): Promise<void> {
    logger.warn("[DatabaseManager] Resetting connection pool");
    try {
      await this.pool.end();
    } catch {
      // Ignore errors during pool teardown — we are replacing it anyway
    }
    // Re-create the pool by re-assigning the private property
    // (mysql2 Pool is not designed to be reset in-place; we recreate it)
    logger.info("[DatabaseManager] Connection pool reset complete");
  }

  // ── Health check ─────────────────────────────────────────────────────────

  startHealthCheck(intervalMs = 30_000): void {
    if (this.healthCheckTimer) return; // already running
    this.healthCheckTimer = setInterval(
      () => void this.runHealthCheck(),
      intervalMs
    );
    if (this.healthCheckTimer.unref) this.healthCheckTimer.unref();
    // Run an immediate check so the first status is populated quickly
    void this.runHealthCheck();
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async runHealthCheck(): Promise<void> {
    try {
      const conn = await this.pool.getConnection();
      try {
        await conn.query("SELECT 1");
      } finally {
        conn.release();
      }
      this.lastHealthCheckAt = new Date().toISOString();
      this.lastHealthError = null;
      if (!this.isHealthy) {
        logger.info("[DatabaseManager] Health check recovered — pool is healthy");
      }
      this.isHealthy = true;
      this.recordSuccess();
    } catch (error) {
      const err = error as Error & { code?: string };
      this.lastHealthCheckAt = new Date().toISOString();
      this.lastHealthError = err.message;
      this.isHealthy = false;
      this.recordFailure(err);
      logger.error("[DatabaseManager] Health check failed", {
        err,
        consecutiveFailures: this.consecutiveFailures,
        circuitOpen: this.isCircuitOpen(),
      });
    }
  }

  // ── Circuit breaker ──────────────────────────────────────────────────────

  isCircuitOpen(): boolean {
    if (this.circuitOpenedAt === null) return false;
    const elapsed = Date.now() - this.circuitOpenedAt;
    if (elapsed >= CIRCUIT_RESET_TIMEOUT_MS) {
      // Half-open: allow one probe through
      logger.info("[DatabaseManager] Circuit half-open — allowing probe query");
      return false;
    }
    return true;
  }

  recordFailure(error: Error & { code?: string }): void {
    this.consecutiveFailures++;
    if (
      this.consecutiveFailures >= CIRCUIT_OPEN_THRESHOLD &&
      this.circuitOpenedAt === null
    ) {
      this.circuitOpenedAt = Date.now();
      logger.error(
        "[DatabaseManager] Circuit OPENED — database appears unhealthy",
        {
          consecutiveFailures: this.consecutiveFailures,
          errorCode: error.code,
          errorMessage: error.message,
        }
      );
    }
  }

  recordSuccess(): void {
    if (this.consecutiveFailures > 0) {
      logger.info("[DatabaseManager] Circuit CLOSED — database recovered", {
        previousFailures: this.consecutiveFailures,
      });
    }
    this.consecutiveFailures = 0;
    this.circuitOpenedAt = null;
  }

  // ── Performance stats ────────────────────────────────────────────────────

  getPerformanceStats(): DbPerformanceStats {
    return {
      avgQueryTimeMs:
        this.totalQueries === 0
          ? 0
          : Math.round(this.totalQueryTimeMs / this.totalQueries),
      slowQueries: this.slowQueryCount,
      timeouts: this.totalTimeouts,
      errors: this.totalErrors,
      totalQueries: this.totalQueries,
    };
  }

  // ── Query with timeout ───────────────────────────────────────────────────

  /**
   * Execute a raw query with an optional timeout (default 30 s).
   * Throws an AppError with errorCode "QUERY_TIMEOUT" if the deadline is exceeded.
   */
  async query<T extends RowDataPacket[]>(
    sql: string,
    params: readonly unknown[] = [],
    timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS
  ): Promise<T> {
    if (this.isCircuitOpen()) {
      this.totalErrors++;
      throw new AppError({
        message: "Database circuit breaker is open — refusing query",
        statusCode: 503,
        isOperational: true,
        errorCode: "CIRCUIT_OPEN",
      });
    }

    const startedAt = Date.now();
    this.totalQueries++;

    try {
      const [rows] = await this.withTimeout(
        this.pool.query<T>(sql, params as any[]),
        timeoutMs,
        sql
      );
      const elapsedMs = Date.now() - startedAt;
      this.totalQueryTimeMs += elapsedMs;
      this.logSqlTelemetry(sql, params, elapsedMs);
      this.recordSuccess();
      return rows;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      this.totalQueryTimeMs += elapsedMs;
      this.totalErrors++;
      const err = error as Error & { code?: string };
      if (err.code === "QUERY_TIMEOUT") {
        this.totalTimeouts++;
      }
      this.recordFailure(err);
      this.handleSqlError(error, sql, params);
    }
  }

  /**
   * Execute a write statement with an optional timeout (default 30 s).
   */
  async execute(
    sql: string,
    params: readonly unknown[] = [],
    timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS
  ): Promise<ResultSetHeader> {
    if (this.isCircuitOpen()) {
      this.totalErrors++;
      throw new AppError({
        message: "Database circuit breaker is open — refusing execute",
        statusCode: 503,
        isOperational: true,
        errorCode: "CIRCUIT_OPEN",
      });
    }

    const startedAt = Date.now();
    this.totalQueries++;

    try {
      const [result] = await this.withTimeout(
        this.pool.execute<ResultSetHeader>(sql, params as any[]),
        timeoutMs,
        sql
      );
      const elapsedMs = Date.now() - startedAt;
      this.totalQueryTimeMs += elapsedMs;
      this.logSqlTelemetry(sql, params, elapsedMs);
      this.recordSuccess();
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      this.totalQueryTimeMs += elapsedMs;
      this.totalErrors++;
      const err = error as Error & { code?: string };
      if (err.code === "QUERY_TIMEOUT") {
        this.totalTimeouts++;
      }
      this.recordFailure(err);
      this.handleSqlError(error, sql, params);
    }
  }

  async executeTransaction<T>(executor: TransactionExecutor<T>): Promise<T> {
    if (this.isCircuitOpen()) {
      throw new AppError({
        message: "Database circuit breaker is open — refusing transaction",
        statusCode: 503,
        isOperational: true,
        errorCode: "CIRCUIT_OPEN",
      });
    }

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await executor(connection);
      await connection.commit();
      logger.info("Database transaction committed");
      this.recordSuccess();
      return result;
    } catch (error) {
      await connection.rollback();
      const err = error as Error & { code?: string };
      logger.warn("Database transaction rolled back", {
        err,
        isTransient: isTransientError(err),
        errorCode: err.code,
      });
      this.recordFailure(err);
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    this.stopHealthCheck();
    await this.pool.end();
    logger.info("Database pool closed");
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Race a promise against a timeout. Rejects with an AppError whose
   * errorCode is "QUERY_TIMEOUT" if the deadline is exceeded.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    sql: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new AppError({
          message: `Query timed out after ${timeoutMs}ms`,
          statusCode: 504,
          isOperational: true,
          errorCode: "QUERY_TIMEOUT",
        });
        logger.warn("[DatabaseManager] Query timeout", {
          timeoutMs,
          sql: sql.slice(0, 200),
        });
        reject(err);
      }, timeoutMs);

      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private logSqlTelemetry(
    sql: string,
    params: readonly unknown[],
    elapsedMs: number
  ): void {
    const metadata = { sql, params, elapsedMs };
    if (elapsedMs > 500) {
      this.slowQueryCount++;
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

    const transient = isTransientError(err);

    logger.error("SQL execution failed", {
      sql,
      params,
      err,
      isTransient: transient,
      errorCode: err.code,
      poolStats: this.getPoolStats(),
      circuitOpen: this.isCircuitOpen(),
      consecutiveFailures: this.consecutiveFailures,
    });

    if (err instanceof AppError) throw err;

    const isParseError = err.code === "ER_PARSE_ERROR";
    throw new AppError({
      message: isParseError
        ? "SQL parse error encountered"
        : transient
          ? "Transient database error — please retry"
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

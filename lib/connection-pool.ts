// =====================================================================
// CONNECTION POOL — Active PgBouncer connection pool manager
//
// Provides two pool modes for different workloads:
//   - Transaction pool (port 6543): For regular queries, max concurrency
//   - Session pool (port 5432): For DDL, BEGIN/COMMIT, NOTIFY, SET
//
// The pooler URL is auto-detected from environment variables:
//   SUPABASE_POOLER_URL  → Full PgBouncer URL (transaction mode)
//   SUPABASE_SESSION_POOL_URL → Session mode pooler URL
//   SUPABASE_DB_URL       → Direct connection (fallback)
//
// Supabase pooler format:
//   postgresql://postgres.[project-ref]:[password]@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
//
// STB MODE (max 2GB RAM):
//   Pool sizes auto-configured from stb-config.ts.
//   env vars override defaults for fine-tuning.
// =====================================================================

import type { Pool, PoolConfig } from 'pg';
import { DB_POOL, IS_STB } from './stb-config';

// ---------------------------------------------------------------------------
// Pool instances (lazy initialized)
// ---------------------------------------------------------------------------

let _transactionPool: Pool | null = null;
let _sessionPool: Pool | null = null;

// ---------------------------------------------------------------------------
// Configuration — Environment-Variable Driven for flexibility
// ---------------------------------------------------------------------------

/**
 * Read a numeric env var with a default value.
 * This allows tuning pool sizes at runtime without code changes.
 */
function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/** Pool configuration for transaction-mode connections (high concurrency) */
const TRANSACTION_POOL_CONFIG: PoolConfig = {
  max: getEnvInt('DB_TX_POOL_MAX', DB_POOL.tx.max),
  min: getEnvInt('DB_TX_POOL_MIN', DB_POOL.tx.min),
  idleTimeoutMillis: getEnvInt('DB_IDLE_TIMEOUT', DB_POOL.tx.idleTimeoutMs),
  connectionTimeoutMillis: DB_POOL.tx.connectionTimeoutMs,
  maxLifetimeMs: DB_POOL.tx.maxLifetimeMs,
  allowExitOnIdle: IS_STB, // ✅ STB: allow exit on idle to free memory
} as PoolConfig;

/** Pool configuration for session-mode connections (DDL, transactions) */
const SESSION_POOL_CONFIG: PoolConfig = {
  max: getEnvInt('DB_SESSION_POOL_MAX', DB_POOL.session.max),
  min: getEnvInt('DB_SESSION_POOL_MIN', DB_POOL.session.min),
  idleTimeoutMillis: getEnvInt('DB_SESSION_IDLE_TIMEOUT', DB_POOL.session.idleTimeoutMs),
  connectionTimeoutMillis: DB_POOL.session.connectionTimeoutMs,
  maxLifetimeMs: DB_POOL.session.maxLifetimeMs,
  allowExitOnIdle: IS_STB, // ✅ STB: allow exit on idle to free memory
} as PoolConfig;

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

/**
 * Get the transaction-mode pooler URL.
 * Prefers SUPABASE_POOLER_URL (port 6543), falls back to SUPABASE_DB_URL.
 */
export function getTransactionPoolUrl(): string {
  return process.env.SUPABASE_POOLER_URL || process.env.SUPABASE_DB_URL || '';
}

/**
 * Get the session-mode pooler URL.
 * Prefers SUPABASE_SESSION_POOL_URL, falls back to SUPABASE_DB_URL.
 * Session mode is needed for DDL, BEGIN/COMMIT, NOTIFY, SET commands.
 */
export function getSessionPoolUrl(): string {
  return process.env.SUPABASE_SESSION_POOL_URL || process.env.SUPABASE_DB_URL || '';
}

/** Check if PgBouncer pooler URL is configured for transaction mode */
export function hasTransactionPool(): boolean {
  return !!process.env.SUPABASE_POOLER_URL;
}

/** Check if PgBouncer pooler URL is configured for session mode */
export function hasSessionPool(): boolean {
  return !!process.env.SUPABASE_SESSION_POOL_URL;
}

// ---------------------------------------------------------------------------
// Pool initialization
// ---------------------------------------------------------------------------

/**
 * Get or create the transaction-mode connection pool.
 * Use this for regular queries, SELECT, INSERT, UPDATE, DELETE.
 * NOT suitable for DDL, BEGIN/COMMIT, NOTIFY, SET, or prepared statements.
 */
export async function getTransactionPool(): Promise<Pool> {
  if (_transactionPool) return _transactionPool;

  const url = getTransactionPoolUrl();
  if (!url) {
    throw new Error(
      '[ConnectionPool] No database URL configured. Set SUPABASE_POOLER_URL or SUPABASE_DB_URL.'
    );
  }

  const { Pool } = await import('pg');

  _transactionPool = new Pool({
    ...TRANSACTION_POOL_CONFIG,
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  _transactionPool.on('error', (err: Error) => {
    console.error('[ConnectionPool:Tx] Unexpected pool error:', err.message);
  });

  console.log(
    `[ConnectionPool:Tx] Transaction-mode pool initialized (max: ${TRANSACTION_POOL_CONFIG.max}, min: ${TRANSACTION_POOL_CONFIG.min})`
  );

  return _transactionPool;
}

/**
 * Get or create the session-mode connection pool.
 * Use this for DDL operations, multi-statement transactions, NOTIFY, SET.
 * Required for setup-schema, setup-rpc, migration operations.
 */
export async function getSessionPool(): Promise<Pool> {
  if (_sessionPool) return _sessionPool;

  const url = getSessionPoolUrl();
  if (!url) {
    throw new Error(
      '[ConnectionPool] No database URL configured. Set SUPABASE_SESSION_POOL_URL or SUPABASE_DB_URL.'
    );
  }

  const { Pool } = await import('pg');

  _sessionPool = new Pool({
    ...SESSION_POOL_CONFIG,
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  _sessionPool.on('error', (err: Error) => {
    console.error('[ConnectionPool:Session] Unexpected pool error:', err.message);
  });

  console.log(
    `[ConnectionPool:Session] Session-mode pool initialized (max: ${SESSION_POOL_CONFIG.max}, min: ${SESSION_POOL_CONFIG.min})`
  );

  return _sessionPool;
}

// ---------------------------------------------------------------------------
// Convenience: Run a query directly
// ---------------------------------------------------------------------------

/**
 * Run a single query on the transaction pool.
 * Automatically acquires and releases a client.
 */
export async function poolQuery<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const pool = await getTransactionPool();
  const result = await pool.query(text, params);
  return result.rows;
}

/**
 * Run a single query on the session pool.
 * Use for DDL or operations requiring session state.
 */
export async function sessionQuery<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const pool = await getSessionPool();
  const result = await pool.query(text, params);
  return result.rows;
}

/**
 * Run multiple statements in a session-mode transaction.
 * Acquires a dedicated client, runs BEGIN, executes statements, then COMMIT.
 * On error, ROLLBACK is executed automatically.
 */
export async function sessionTransaction(
  statements: { text: string; params?: unknown[] }[]
): Promise<{ results: any[][]; errors: string[] }> {
  const pool = await getSessionPool();
  const client = await pool.connect();

  const results: any[][] = [];
  const errors: string[] = [];

  try {
    await client.query('BEGIN');

    for (const stmt of statements) {
      try {
        const result = await client.query(stmt.text, stmt.params);
        results.push(result.rows);
      } catch (err: any) {
        const msg = err.message || String(err);
        if (
          msg.includes('already exists') ||
          msg.includes('duplicate key') ||
          msg.includes('relation already exists')
        ) {
          results.push([]); // harmless, continue
        } else {
          errors.push(`${stmt.text.substring(0, 100)}: ${msg}`);
          throw err; // trigger ROLLBACK
        }
      }
    }

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (errors.length === 0) {
      errors.push(err.message || String(err));
    }
  } finally {
    client.release();
  }

  return { results, errors };
}

// ---------------------------------------------------------------------------
// Health & stats
// ---------------------------------------------------------------------------

interface PoolStats {
  name: string;
  url: string;
  mode: 'transaction' | 'session' | 'none';
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  activeConnections: number;
  isHealthy: boolean;
}

/**
 * Get connection pool statistics for health monitoring.
 */
export async function getPoolStats(): Promise<{ transaction: PoolStats; session: PoolStats }> {
  const txStats = await getStatsForPool(_transactionPool, 'Transaction', getTransactionPoolUrl(), 'transaction');
  const sessionStats = await getStatsForPool(_sessionPool, 'Session', getSessionPoolUrl(), 'session');
  return { transaction: txStats, session: sessionStats };
}

async function getStatsForPool(
  pool: Pool | null,
  name: string,
  url: string,
  mode: 'transaction' | 'session'
): Promise<PoolStats> {
  if (!pool) {
    return {
      name,
      url: url ? '[configured]' : '[not configured]',
      mode,
      totalConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      activeConnections: 0,
      isHealthy: false,
    };
  }

  try {
    // Quick connectivity check with timeout
    const result = await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);

    return {
      name,
      url: '[active]',
      mode,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      activeConnections: pool.totalCount - pool.idleCount,
      isHealthy: true,
    };
  } catch {
    return {
      name,
      url: '[error]',
      mode,
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      activeConnections: pool.totalCount - pool.idleCount,
      isHealthy: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Close all connection pools gracefully.
 * Call this on server shutdown (SIGTERM, SIGINT).
 */
export async function closeAllPools(): Promise<void> {
  const closers: Promise<void>[] = [];

  if (_transactionPool) {
    closers.push(
      _transactionPool.end().then(() => {
        console.log('[ConnectionPool:Tx] Pool closed');
      }).catch((err) => {
        console.warn('[ConnectionPool:Tx] Error closing pool:', err);
      })
    );
  }

  if (_sessionPool) {
    closers.push(
      _sessionPool.end().then(() => {
        console.log('[ConnectionPool:Session] Pool closed');
      }).catch((err) => {
        console.warn('[ConnectionPool:Session] Error closing pool:', err);
      })
    );
  }

  await Promise.allSettled(closers);
  _transactionPool = null;
  _sessionPool = null;
}

// ---------------------------------------------------------------------------
// Constants (for backward compatibility)
// ---------------------------------------------------------------------------

export const poolConfig = TRANSACTION_POOL_CONFIG;
export const POOL_HEALTH_CHECK_INTERVAL = 30_000;

// Register shutdown handler
if (typeof process !== 'undefined' && typeof window === 'undefined') {
  const shutdown = async (signal: string) => {
    console.log(`[ConnectionPool] Received ${signal}, closing pools...`);
    await closeAllPools();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

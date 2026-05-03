// =====================================================================
// STB CONFIG — Set-Top Box Memory Budget Configuration
//
// Razkindo2 ERP runs on STB devices with max 2GB RAM.
// This module provides a centralized memory budget system that all
// infrastructure modules reference for auto-tuning their parameters.
//
// Memory budget for 2GB STB:
//   OS + System:         ~400MB
//   Next.js Runtime:     ~600MB (V8 heap)
//   Event Queue Service: ~80MB
//   Database (PgBouncer): ~60MB
//   WebSocket Buffers:   ~40MB
//   Filesystem/Cache:    ~120MB
//   Headroom:            ~700MB
//
// Components read from this module at startup to auto-configure:
//   - Connection pool sizes
//   - Memory guard thresholds
//   - Performance monitor sample limits
//   - Event queue capacity
//   - Query cache size
//   - TanStack Query cache limits
// =====================================================================

/** Whether STB mode is active */
export const IS_STB = process.env.STB_MODE === 'true' || process.env.STB_MODE === '1';

/** Total device RAM in MB */
export const TOTAL_RAM_MB = IS_STB ? 2048 : 8192;

// =====================================================================
// MEMORY BUDGET (MB) — Allocated per subsystem
// =====================================================================

export const MEMORY_BUDGET = {
  /** Maximum V8 heap size for Next.js process */
  maxHeapMB: IS_STB ? 384 : 1024,

  /** Memory guard: trigger cleanup when heap exceeds this growth */
  heapGrowthThresholdMB: IS_STB ? 40 : 100,

  /** Memory guard: check interval */
  memoryCheckIntervalMs: IS_STB ? 30_000 : 120_000,

  /** Critical debounce — min time between critical memory alerts */
  criticalDebounceMs: IS_STB ? 60_000 : 300_000,

  /** Heap pressure percent to trigger "under pressure" */
  pressureThresholdPercent: IS_STB ? 90 : 95,
};

// =====================================================================
// DATABASE CONNECTION POOL
// =====================================================================

export const DB_POOL = {
  /** Transaction pool (high concurrency queries) */
  tx: {
    max: IS_STB ? 3 : 10,
    min: IS_STB ? 1 : 1,
    idleTimeoutMs: IS_STB ? 15_000 : 30_000,
    connectionTimeoutMs: IS_STB ? 8_000 : 10_000,
    maxLifetimeMs: IS_STB ? 1_800_000 : 3_600_000, // 30min vs 60min
  },
  /** Session pool (DDL, transactions, NOTIFY) */
  session: {
    max: IS_STB ? 2 : 3,
    min: 0,
    idleTimeoutMs: IS_STB ? 15_000 : 60_000,
    connectionTimeoutMs: IS_STB ? 15_000 : 30_000,
    maxLifetimeMs: IS_STB ? 1_800_000 : 3_600_000,
  },
  /** Drain idle connections after this many ms of inactivity */
  drainIdleAfterMs: IS_STB ? 20_000 : 60_000,
};

// =====================================================================
// EVENT QUEUE SERVICE
// =====================================================================

export const EVENT_QUEUE = {
  /** Max events in memory queue */
  maxQueueSize: IS_STB ? 1000 : 5000,

  /** Events processed per tick */
  batchSize: IS_STB ? 3 : 10,

  /** Tick interval in ms */
  tickIntervalMs: IS_STB ? 200 : 50,

  /** Max connections per IP */
  maxConnectionsPerIp: IS_STB ? 15 : 50,

  /** Max dead letter queue entries */
  maxDeadLetterSize: IS_STB ? 100 : 500,

  /** Backpressure threshold (0-1) */
  backpressureThreshold: IS_STB ? 0.7 : 0.8,

  /** Dedup window in ms */
  dedupWindowMs: IS_STB ? 3000 : 2000,

  /** Socket.io ping interval */
  pingIntervalMs: IS_STB ? 30_000 : 25_000,

  /** Socket.io ping timeout */
  pingTimeoutMs: IS_STB ? 60_000 : 60_000,
};

// =====================================================================
// PERFORMANCE MONITOR
// =====================================================================

export const PERF_MONITOR = {
  /** Max samples per histogram before trimming */
  maxHistogramSamples: IS_STB ? 500 : 10_000,

  /** Timer leak detection interval */
  leakDetectionIntervalMs: IS_STB ? 120_000 : 60_000,

  /** Max active timers before warning */
  maxActiveTimers: IS_STB ? 50 : 500,

  /** Timer default timeout */
  timerDefaultTimeoutMs: IS_STB ? 15_000 : 30_000,

  /** Alert monitor interval */
  alertMonitorIntervalMs: IS_STB ? 30_000 : 10_000,

  /** API response time alert threshold (ms) */
  apiResponseAlertMs: IS_STB ? 15000 : 10000,

  /** DB query time alert threshold (ms) */
  dbQueryAlertMs: IS_STB ? 8000 : 5000,
};

// =====================================================================
// CIRCUIT BREAKER
// =====================================================================

export const CIRCUIT_BREAKER = {
  /** Consecutive failures before opening */
  failureThreshold: IS_STB ? 3 : 5,

  /** Reset timeout (ms) */
  resetTimeoutMs: IS_STB ? 8_000 : 30_000,

  /** Health monitor interval (ms) */
  monitorIntervalMs: IS_STB ? 30_000 : 10_000,
};

// =====================================================================
// QUERY CACHE (in-memory)
// =====================================================================

export const QUERY_CACHE = {
  /** Max cached entries */
  maxEntries: IS_STB ? 50 : 500,

  /** Default TTL per entry (ms) */
  defaultTtlMs: IS_STB ? 30_000 : 60_000,

  /** Max memory for cached values (MB, approximate) */
  maxMemoryMB: IS_STB ? 5 : 50,
};

// =====================================================================
// WEBSOCKET / REALTIME
// =====================================================================

export const WEBSOCKET = {
  /** Invalidation debounce for critical events (ms) */
  criticalDebounceMs: IS_STB ? 1000 : 500,

  /** Invalidation debounce for medium events (ms) */
  mediumDebounceMs: IS_STB ? 3000 : 1000,

  /** Invalidation debounce for non-critical events (ms) */
  nonCriticalDebounceMs: IS_STB ? 5000 : 2000,

  /** Refresh-all debounce (ms) */
  refreshAllDebounceMs: IS_STB ? 5000 : 2000,

  /** Offline event buffer max size */
  offlineBufferMaxSize: IS_STB ? 20 : 100,
};

// =====================================================================
// CONSISTENCY CHECKER
// =====================================================================

export const CONSISTENCY = {
  /** Interval between full consistency checks */
  checkIntervalMs: IS_STB ? 12 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000, // 12h vs 6h
};

// =====================================================================
// TANSTACK QUERY (client-side defaults)
// =====================================================================

export const REACT_QUERY = {
  /** Stale time for most queries */
  defaultStaleTimeMs: IS_STB ? 60_000 : 30_000,

  /** GC time (unused cache entries) */
  gcTimeMs: IS_STB ? 120_000 : 300_000,

  /** Max concurrent queries */
  maxConcurrentQueries: IS_STB ? 5 : 10,
};

// =====================================================================
// SUMMARY — For logging / dashboard
// =====================================================================

export function getSTBSummary(): Record<string, unknown> {
  if (!IS_STB) return { stbMode: false };

  return {
    stbMode: true,
    totalRamMB: TOTAL_RAM_MB,
    memoryBudget: MEMORY_BUDGET,
    dbPool: { tx: DB_POOL.tx.max, session: DB_POOL.session.max },
    eventQueue: {
      maxQueue: EVENT_QUEUE.maxQueueSize,
      batchSize: EVENT_QUEUE.batchSize,
      tickMs: EVENT_QUEUE.tickIntervalMs,
    },
    queryCache: { maxEntries: QUERY_CACHE.maxEntries, ttlMs: QUERY_CACHE.defaultTtlMs },
    reactQuery: { staleTimeMs: REACT_QUERY.defaultStaleTimeMs, gcTimeMs: REACT_QUERY.gcTimeMs },
  };
}

console.log(
  IS_STB
    ? `[STB Config] ⚡ STB MODE ACTIVE — RAM budget: ${TOTAL_RAM_MB}MB, heap max: ${MEMORY_BUDGET.maxHeapMB}MB`
    : `[STB Config] Standard mode — RAM: ${TOTAL_RAM_MB}MB`
);

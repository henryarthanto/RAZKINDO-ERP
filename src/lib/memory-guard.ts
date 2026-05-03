// =====================================================================
// MEMORY GUARD - Memory Leak Prevention & Monitoring
//
// Monitors process memory usage and provides:
// - Periodic memory stat checks with warning/critical thresholds
// - Cleanup suggestion callbacks when memory is critical
// - Integration hook with graceful degradation
//
// IMPORTANT: V8's heap is naturally 85-95% utilized — this is NORMAL.
// CRITICAL/WARNING should only trigger when heap grows significantly
// beyond the initial allocation (suggesting a leak).
//
// STB MODE: Auto-configured from stb-config.ts for 2GB RAM devices.
// =====================================================================

import { MEMORY_BUDGET, IS_STB } from './stb-config';

export interface MemoryStats {
  used: number;       // MB - heap used
  total: number;      // MB - heap total
  percent: number;    // 0-100 - usage percentage
  rss: number;        // MB - resident set size
  heapUsedMB: number;
  heapTotalMB: number;
  underPressure: boolean;
  stbMode: boolean;   // ✅ STB indicator
  budgetMaxHeapMB: number; // ✅ configured max heap
}

type CleanupCallback = () => void;

export class MemoryGuard {
  private static instance: MemoryGuard;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private drainInterval: ReturnType<typeof setInterval> | null = null;
  private criticalCallbacks: CleanupCallback[] = [];
  private lastWarningLoggedAt: number = 0;
  private baselineHeapMB: number = 0;
  private criticalDebounceMs: number = MEMORY_BUDGET.criticalDebounceMs;

  /** Heap growth threshold to trigger "under pressure" (MB) */
  private static readonly HEAP_GROWTH_THRESHOLD_MB = MEMORY_BUDGET.heapGrowthThresholdMB;

  /** Check interval: more frequent on STB */
  private static readonly DEFAULT_CHECK_INTERVAL_MS = MEMORY_BUDGET.memoryCheckIntervalMs;

  /** Pressure threshold percent */
  private static readonly PRESSURE_PERCENT = MEMORY_BUDGET.pressureThresholdPercent;

  /** Drain idle connections after this much memory pressure */
  private drainScheduled: boolean = false;

  private constructor() {}

  /** Get singleton instance */
  static getInstance(): MemoryGuard {
    if (!MemoryGuard.instance) {
      MemoryGuard.instance = new MemoryGuard();
    }
    return MemoryGuard.instance;
  }

  /**
   * Start periodic memory monitoring.
   * @param intervalMs - Check interval in ms (auto-adjusted for STB)
   */
  start(intervalMs: number = MemoryGuard.DEFAULT_CHECK_INTERVAL_MS): void {
    if (this.checkInterval) return;

    // Record baseline heap size at startup
    const memInfo = process.memoryUsage();
    this.baselineHeapMB = memInfo.heapTotal / (1024 * 1024);

    // Run an immediate check
    this.check();

    // Unref to not prevent Node.js exit
    this.checkInterval = setInterval(() => this.check(), intervalMs);
    if (this.checkInterval && typeof this.checkInterval === 'object' && 'unref' in this.checkInterval) {
      (this.checkInterval as any).unref();
    }

    // STB: Schedule periodic proactive drain even when not under pressure
    if (IS_STB) {
      this.drainInterval = setInterval(() => {
        this.proactiveDrain();
      }, 120_000); // Every 2 minutes
      if (this.drainInterval && typeof this.drainInterval === 'object' && 'unref' in this.drainInterval) {
        (this.drainInterval as any).unref();
      }
    }
  }

  /** Stop periodic monitoring */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = null;
    }
  }

  /** Get current memory stats */
  getStats(): MemoryStats {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / (1024 * 1024);
    const heapTotalMB = mem.heapTotal / (1024 * 1024);
    const rssMB = mem.rss / (1024 * 1024);
    const percent = heapTotalMB > 0 ? Math.min((heapUsedMB / heapTotalMB) * 100, 100) : 0;

    // "Under pressure" only if heap has grown significantly beyond baseline
    // AND usage is high. A high percentage alone is not pressure — V8 naturally
    // fills the heap to ~95% and grows it on demand.
    const heapGrowthMB = heapTotalMB - this.baselineHeapMB;
    const underPressure = percent >= MemoryGuard.PRESSURE_PERCENT && heapGrowthMB > MemoryGuard.HEAP_GROWTH_THRESHOLD_MB;

    return {
      used: Math.round(heapUsedMB * 100) / 100,
      total: Math.round(heapTotalMB * 100) / 100,
      percent: Math.round(percent * 100) / 100,
      rss: Math.round(rssMB * 100) / 100,
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      underPressure,
      stbMode: IS_STB,
      budgetMaxHeapMB: MEMORY_BUDGET.maxHeapMB,
    };
  }

  /** Check if memory is under pressure */
  isUnderPressure(): boolean {
    return this.getStats().underPressure;
  }

  /**
   * Register a cleanup callback that runs when memory is critical.
   */
  onCritical(callback: CleanupCallback): void {
    this.criticalCallbacks.push(callback);
  }

  /**
   * Suggest cleanup — call all registered cleanup callbacks.
   * Also drains idle connection pools to free memory.
   */
  suggestCleanup(): void {
    if (this.drainScheduled) return; // Prevent concurrent drains
    this.drainScheduled = true;

    // Drain idle connections from pool to free memory
    try {
      import('@/lib/connection-pool').then(({ closeAllPools }) => {
        closeAllPools().catch(() => {});
        console.log('[MemoryGuard] Drained connection pools to free memory');
        this.drainScheduled = false;
      }).catch(() => {
        this.drainScheduled = false;
      });
    } catch {
      this.drainScheduled = false;
    }

    for (const cb of this.criticalCallbacks) {
      try { cb(); } catch { /* silent */ }
    }
  }

  /**
   * STB proactive drain — periodically close idle connections
   * even when not under pressure, to prevent gradual memory growth.
   */
  private proactiveDrain(): void {
    try {
      import('@/lib/connection-pool').then(({ closeAllPools }) => {
        closeAllPools().catch(() => {});
        console.log('[MemoryGuard:STB] Proactive pool drain (every 2min)');
      }).catch(() => {});
    } catch { /* ignore */ }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private check(): void {
    const stats = this.getStats();
    const now = Date.now();

    // STB: also check if heap exceeds absolute budget limit
    const overBudget = IS_STB && stats.heapUsedMB > MEMORY_BUDGET.maxHeapMB;

    // Only log if under actual pressure (heap grew significantly)
    // AND enough time has passed since last log
    const canLog = now - this.lastWarningLoggedAt > this.criticalDebounceMs;

    if (stats.underPressure || overBudget) {
      if (canLog) {
        const reason = overBudget
          ? `OVER BUDGET (${stats.heapUsedMB.toFixed(1)}MB > ${MEMORY_BUDGET.maxHeapMB}MB limit)`
          : `Heap at ${stats.percent.toFixed(1)}%`;
        console.error(
          `[MemoryGuard${IS_STB ? ':STB' : ''}] CRITICAL: ${reason} ` +
          `(${stats.heapUsedMB.toFixed(1)}MB / ${stats.heapTotalMB.toFixed(1)}MB). ` +
          `RSS: ${stats.rss.toFixed(1)}MB.`
        );
        this.lastWarningLoggedAt = now;
      }
      this.suggestCleanup();
    }
    // Normal V8 heap utilization (85-95%) is NOT logged — it's expected behavior.
  }
}

// ---------------------------------------------------------------------------
// Convenience singleton export
// ---------------------------------------------------------------------------

export const memoryGuard = MemoryGuard.getInstance();

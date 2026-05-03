// =====================================================================
// CONSISTENCY SCHEDULER — Periodic data integrity checker
//
// Auto-runs consistency checks on a schedule.
// Designed to be started from instrumentation.ts (runs once at server start).
// =====================================================================

import { consistencyChecker } from './consistency-checker';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic consistency checker.
 * Runs every 6 hours by default.
 */
export function startConsistencyScheduler(intervalMs: number = 6 * 60 * 60 * 1000): void {
  if (typeof window !== 'undefined') return; // Server-side only

  if (schedulerInterval) {
    console.log('[ConsistencyScheduler] Already running.');
    return;
  }

  console.log(
    `[ConsistencyScheduler] Starting periodic checks (every ${intervalMs / 60_000} minutes)`
  );

  // Run once immediately on startup (with a delay to let the app settle)
  const startupTimer = setTimeout(async () => {
    try {
      const results = await consistencyChecker.runAll();
      const issues = results.filter((r) => !r.ok);
      if (issues.length > 0) {
        console.warn(
          `[ConsistencyScheduler] Initial check found ${issues.length} issue(s):`,
          issues.map((i) => `${i.checkName}: ${i.message}`).join('; ')
        );
      } else {
        console.log('[ConsistencyScheduler] Initial check passed ✓');
      }
    } catch (error) {
      console.error('[ConsistencyScheduler] Initial check failed:', error);
    }
  }, 60_000); // 1 minute after startup

  // Don't prevent Node.js from exiting
  if (startupTimer.unref) {
    startupTimer.unref();
  }

  // Schedule periodic checks
  schedulerInterval = setInterval(async () => {
    try {
      const results = await consistencyChecker.runAll();
      const issues = results.filter((r) => !r.ok);
      if (issues.length > 0) {
        console.warn(
          `[ConsistencyScheduler] Found ${issues.length} issue(s):`,
          issues.map((i) => `${i.checkName}: ${i.message}`).join('; ')
        );
      } else {
        console.log('[ConsistencyScheduler] Periodic check passed ✓');
      }
    } catch (error) {
      console.error('[ConsistencyScheduler] Periodic check failed:', error);
    }
  }, intervalMs);

  // Don't prevent Node.js from exiting
  if (schedulerInterval.unref) {
    schedulerInterval.unref();
  }
}

/** Stop the periodic consistency checker */
export function stopConsistencyScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[ConsistencyScheduler] Stopped.');
  }
}

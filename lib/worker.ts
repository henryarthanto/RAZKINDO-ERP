// =====================================================================
// Background Worker Process
//
// Runs as a separate Bun process alongside the Next.js server.
// Handles long-running jobs: WhatsApp, stock sync,
// cashback processing, cleanup tasks.
//
// Usage: bun run src/lib/worker.ts
// =====================================================================

import { registerAllProcessors, schedulePeriodicJobs } from './processors';
import { getQueueStatus } from './job-queue';
import { logInfo, logError } from './logger';
import { getCacheStatus } from './redis-cache';

async function main() {
  console.log('====================================================');
  console.log('  Razkindo2 ERP - Background Worker');
  console.log('  PID:', process.pid);
  console.log('  Started:', new Date().toISOString());
  console.log('====================================================\n');

  // 1. Register all job processors
  try {
    await registerAllProcessors();
    logInfo('All job processors registered');
  } catch (err) {
    logError('Failed to register processors', err);
  }

  // 2. Schedule periodic jobs
  try {
    schedulePeriodicJobs();
    logInfo('Periodic jobs scheduled');
  } catch (err) {
    logError('Failed to schedule periodic jobs', err);
  }

  // 3. Log status
  const queueStatus = getQueueStatus();
  const cacheStatus = getCacheStatus();
  logInfo('Worker initialized', {
    queue: queueStatus,
    cache: cacheStatus,
    redis: cacheStatus.redis ? 'connected' : 'in-memory fallback',
  });

  // 4. Keep alive with periodic health check
  setInterval(() => {
    const status = getQueueStatus();
    logInfo('Worker heartbeat', {
      fallbackJobs: status.fallbackJobs,
      processors: status.registeredProcessors.length,
    });
  }, 5 * 60 * 1000); // Every 5 minutes
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logInfo('Worker shutting down (SIGTERM)');
  process.exit(0);
});

process.on('SIGINT', () => {
  logInfo('Worker shutting down (SIGINT)');
  process.exit(0);
});

main().catch((err) => {
  logError('Worker failed to start', err);
  process.exit(1);
});

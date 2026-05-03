// =====================================================================
// HEALTH CHECK ENDPOINT
// GET /api/health
//
// Returns a comprehensive system health report including database
// connectivity, memory usage, and circuit breaker states.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { CircuitBreaker } from '@/lib/circuit-breaker';
import { getDegradationLevel, featureFlags } from '@/lib/graceful-degradation';
import { memoryGuard } from '@/lib/memory-guard';
import { getPoolStats } from '@/lib/connection-pool';
import { verifyAuthToken } from '@/lib/token';
import { perfMonitor } from '@/lib/performance-monitor';
import { getCacheStatus } from '@/lib/redis-cache';
import { getQueueStatus } from '@/lib/job-queue';
type CheckStatus = 'ok' | 'warning' | 'error';
type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

interface HealthResponse {
  status: OverallStatus;
  timestamp: string;
  uptime: number;
  degradation: {
    level: 'full' | 'partial' | 'minimal';
    disabledFeatures: string[];
  };
  checks: {
    database: { status: CheckStatus; latency_ms: number };
    memory: {
      status: CheckStatus;
      used_mb: number;
      total_mb: number;
      percent: number;
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
      underPressure: boolean;
    };
    circuitBreakers: { name: string; state: string; failures: number }[];
    connectionPool: {
      transaction: {
        active: number;
        idle: number;
        waiting: number;
        healthy: boolean;
      };
      session: {
        active: number;
        idle: number;
        waiting: number;
        healthy: boolean;
      };
    };
    performance: {
      timestamp: number;
      uptimeMs: number;
      summary: {
        healthy: boolean;
        issues: number;
        message: string;
        avgApiResponseMs: number;
        avgDbQueryMs: number;
        requestsPerSec: number;
        errorRate: number;
      };
      activeAlerts: { metricName: string; type: string; message: string; value: number; severity: string; timestamp: number }[];
    };
    };
    services: {
      cache: { redis: boolean; memEntries: number };
      jobQueue: { redis: boolean; fallbackJobs: number; registeredProcessors: string[] };
    };
}

export async function GET(request: NextRequest) {
  // ── Auth check: return minimal info without auth, full details with auth ──
  const authUserId = verifyAuthToken(request.headers.get('authorization'));
  if (!authUserId) {
    return NextResponse.json({ status: 'ok' });
  }

  const timestamp = new Date().toISOString();
  const uptime = Math.floor(process.uptime());

  // Run all checks in parallel
  const [dbCheck, memoryCheck, cbCheck, poolCheck] = await Promise.all([
    checkDatabase(),
    checkMemory(),
    checkCircuitBreakers(),
    checkConnectionPool(),
  ]);

  // Determine overall status
  let status: OverallStatus = 'healthy';
  let perfMetrics: any;
  try {
    perfMetrics = perfMonitor.getMetrics();
  } catch (e) {
    console.error('[Health] perfMonitor.getMetrics failed:', e);
    perfMetrics = { timestamp: Date.now(), uptimeMs: 0, activeAlerts: [], summary: { healthy: true, issues: 0, message: 'Performance monitor unavailable', avgApiResponseMs: 0, avgDbQueryMs: 0, requestsPerSec: 0, errorRate: 0 } };
  }

  if (dbCheck.status === 'error') {
    status = 'unhealthy';
  } else if (memoryCheck.status === 'warning' || cbCheck.some((cb) => cb.state === 'open') || !perfMetrics?.summary?.healthy) {
    status = 'degraded';
  }

  // Graceful degradation info
  const degradationLevel = getDegradationLevel();
  const disabledFeatures = featureFlags.getDisabledFeatures();

  const body: HealthResponse = {
    status,
    timestamp,
    uptime,
    degradation: {
      level: degradationLevel,
      disabledFeatures,
    },
    checks: {
      database: dbCheck,
      memory: memoryCheck,
      circuitBreakers: cbCheck,
      connectionPool: poolCheck,
      performance: {
        timestamp: perfMetrics.timestamp,
        uptimeMs: perfMetrics.uptimeMs,
        summary: perfMetrics.summary,
        activeAlerts: perfMetrics.activeAlerts.map(a => ({
          metricName: a.metricName,
          type: a.type,
          message: a.message,
          value: a.value,
          severity: a.severity,
          timestamp: a.timestamp,
        })),
      },
    },
    services: {
      cache: getCacheStatus(),
      jobQueue: getQueueStatus(),
    },
  };

  const httpStatus = status === 'unhealthy' ? 503 : status === 'degraded' ? 200 : 200;

  return NextResponse.json(body, { status: httpStatus });
}

// -------------------------------------------------------------------
// Individual check functions
// -------------------------------------------------------------------

interface DatabaseCheck {
  status: 'ok' | 'error';
  latency_ms: number;
}

async function checkDatabase(): Promise<DatabaseCheck> {
  const start = performance.now();
  try {
    await db.from('settings').select('key').limit(1);
    const latency_ms = Math.round(performance.now() - start);
    return { status: 'ok', latency_ms };
  } catch {
    const latency_ms = Math.round(performance.now() - start);
    return { status: 'error', latency_ms };
  }
}

interface MemoryCheck {
  status: 'ok' | 'warning';
  used_mb: number;
  total_mb: number;
  percent: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  underPressure: boolean;
}

function checkMemory(): MemoryCheck {
  const stats = memoryGuard.getStats();
  return {
    status: stats.percent > 80 ? 'warning' : 'ok',
    used_mb: stats.used,
    total_mb: stats.total,
    percent: stats.percent,
    heapUsedMB: stats.heapUsedMB,
    heapTotalMB: stats.heapTotalMB,
    rssMB: stats.rss,
    underPressure: memoryGuard.isUnderPressure(),
  };
}

function checkCircuitBreakers(): { name: string; state: string; failures: number }[] {
  return CircuitBreaker.getAllStats();
}

async function checkConnectionPool() {
  try {
    const stats = await getPoolStats();
    return {
      transaction: {
        active: stats.transaction.activeConnections,
        idle: stats.transaction.idleConnections,
        waiting: stats.transaction.waitingRequests,
        healthy: stats.transaction.isHealthy,
      },
      session: {
        active: stats.session.activeConnections,
        idle: stats.session.idleConnections,
        waiting: stats.session.waitingRequests,
        healthy: stats.session.isHealthy,
      },
    };
  } catch {
    return {
      transaction: { active: 0, idle: 0, waiting: 0, healthy: false },
      session: { active: 0, idle: 0, waiting: 0, healthy: false },
    };
  }
}

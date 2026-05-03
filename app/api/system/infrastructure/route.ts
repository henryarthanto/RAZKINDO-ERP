import { NextRequest, NextResponse } from 'next/server';
import { getPoolStats } from '@/lib/connection-pool';
import { memoryGuard } from '@/lib/memory-guard';
import type { MemoryStats } from '@/lib/memory-guard';
import { PerformanceMonitor } from '@/lib/performance-monitor';
import { CircuitBreaker } from '@/lib/circuit-breaker';
import { getSTBSummary, IS_STB, TOTAL_RAM_MB, MEMORY_BUDGET, DB_POOL, EVENT_QUEUE, QUERY_CACHE } from '@/lib/stb-config';
import { enforceSuperAdmin } from '@/lib/require-auth';

export async function GET(request: NextRequest) {
  // SECURITY: Only super_admin can view infrastructure details (memory, pools, PIDs, etc.)
  const authResult = await enforceSuperAdmin(request);
  if (!authResult.success) return authResult.response;
  try {
    // 1. Connection Pool Stats
    let poolStats: { transaction: any; session: any } = { transaction: null, session: null };
    try {
      poolStats = await getPoolStats();
    } catch (err) {
      console.error('[InfrastructureAPI] Failed to get pool stats:', err);
    }

    // 2. Memory Guard Stats
    let memoryStats: MemoryStats | null = null;
    try {
      memoryStats = memoryGuard.getStats();
    } catch (err) {
      console.error('[InfrastructureAPI] Failed to get memory stats:', err);
    }

    // 3. Performance Monitor Metrics
    let perfMetrics: any = null;
    try {
      const perfMonitor = PerformanceMonitor.getInstance();
      perfMetrics = perfMonitor.getMetrics();
    } catch (err) {
      console.error('[InfrastructureAPI] Failed to get performance metrics:', err);
    }

    // 4. Circuit Breaker Stats
    let circuitBreakers: any[] = [];
    try {
      circuitBreakers = CircuitBreaker.getAllStats();
    } catch (err) {
      console.error('[InfrastructureAPI] Failed to get circuit breaker stats:', err);
    }

    // 5. System Info
    const uptimeMs = perfMetrics?.uptimeMs ?? 0;
    const mem = process.memoryUsage();
    const systemInfo = {
      uptime: uptimeMs,
      uptimeHuman: formatUptime(uptimeMs),
      nodeVersion: process.version,
      stbMode: IS_STB,
      environment: process.env.NODE_ENV || 'development',
      platform: process.platform,
      pid: process.pid,
      // ✅ STB budget info
      totalRamMB: TOTAL_RAM_MB,
      memoryBudget: {
        maxHeapMB: MEMORY_BUDGET.maxHeapMB,
        currentHeapUsedMB: Math.round((mem.heapUsed / (1024 * 1024)) * 100) / 100,
        currentHeapTotalMB: Math.round((mem.heapTotal / (1024 * 1024)) * 100) / 100,
        currentRssMB: Math.round((mem.rss / (1024 * 1024)) * 100) / 100,
        heapUtilization: mem.heapTotal > 0
          ? Math.round((mem.heapUsed / mem.heapTotal) * 10000) / 100
          : 0,
        rssOfTotalPercent: Math.round((mem.rss / (1024 * 1024) / TOTAL_RAM_MB) * 10000) / 100,
      },
    };

    // 6. STB Summary
    const stbSummary = getSTBSummary();

    // 7. Event Queue Stats (try fetching from service)
    let eventQueueStats: any = null;
    try {
      const queueUrl = process.env.EVENT_QUEUE_URL || 'http://127.0.0.1:3004';
      const wsSecret = process.env.WS_SECRET;
      if (wsSecret) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        const res = await fetch(`${queueUrl}/api/queue/status`, {
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${wsSecret}` },
        });
        clearTimeout(timer);
        if (res.ok) {
          eventQueueStats = await res.json();
        }
      }
    } catch {
      // Event queue service may be down — non-critical
    }

    // Aggregate health status
    const isHealthy = perfMetrics?.summary?.healthy ?? true;
    const issues = perfMetrics?.summary?.issues ?? [];

    // ✅ STB: Additional health checks
    if (IS_STB && mem.rss > TOTAL_RAM_MB * 0.7) {
      issues.push(`RSS ${Math.round(mem.rss / (1024 * 1024))}MB melebihi 70% dari ${TOTAL_RAM_MB}MB RAM`);
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      healthy: isHealthy,
      issues,
      data: {
        system: systemInfo,
        stbConfig: stbSummary,
        pools: poolStats,
        memory: memoryStats,
        performance: perfMetrics,
        circuitBreakers,
        eventQueue: eventQueueStats,
      },
    });
  } catch (error) {
    console.error('[InfrastructureAPI] Unexpected error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Gagal mengambil data infrastruktur',
        timestamp: Date.now(),
      },
      { status: 500 }
    );
  }
}

function formatUptime(ms: number): string {
  if (ms <= 0) return 'Baru mulai';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days} hari ${remainingHours} jam`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours} jam ${remainingMinutes} menit`;
  }
  if (minutes > 0) {
    return `${minutes} menit`;
  }
  return `${seconds} detik`;
}

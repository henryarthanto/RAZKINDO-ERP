'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

import { Separator } from '@/components/ui/separator';
import {
  Activity,
  Database,
  HardDrive,
  AlertTriangle,
  Server,
  Clock,
  Zap,
  Radio,
  Shield,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { useState } from 'react';

interface InfrastructureData {
  system: {
    uptime: number;
    uptimeHuman: string;
    nodeVersion: string;
    stbMode: boolean;
    environment: string;
    platform: string;
    pid: number;
    totalRamMB: number;
    memoryBudget: {
      maxHeapMB: number;
      currentHeapUsedMB: number;
      currentHeapTotalMB: number;
      currentRssMB: number;
      heapUtilization: number;
      rssOfTotalPercent: number;
    };
  };
  stbConfig: Record<string, unknown> | { stbMode: false };
  pools: {
    transaction: PoolStats | null;
    session: PoolStats | null;
  };
  memory: {
    used: number;
    total: number;
    percent: number;
    rss: number;
    heapUsedMB: number;
    heapTotalMB: number;
    underPressure: boolean;
    stbMode: boolean;
    budgetMaxHeapMB: number;
  } | null;
  performance: {
    summary: { healthy: boolean; issues: string[] };
    activeAlerts: Array<{ severity: string; message: string; metricName: string }>;
  } | null;
  circuitBreakers: Array<{ name: string; state: string; failures: number }>;
  eventQueue: {
    queueSize: number;
    deadLetterSize: number;
    maxQueueSize: number;
    connectedClients: number;
    health: { eventsPerSecond: number; successRate: number; avgLatencyMs: number };
  } | null;
}

interface PoolStats {
  name: string;
  url: string;
  mode: string;
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
  activeConnections: number;
  isHealthy: boolean;
}

function formatBytes(mb: number): string {
  if (mb < 1) return `${Math.round(mb * 1024)}KB`;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

function getHeapColor(percent: number): string {
  if (percent < 70) return 'text-emerald-600';
  if (percent < 85) return 'text-amber-600';
  return 'text-red-600';
}

function getProgressColor(percent: number): string {
  if (percent < 70) return '[&>div]:bg-emerald-500';
  if (percent < 85) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

function CircularGauge({ value, size = 80, strokeWidth = 6, label }: { value: number; size?: number; strokeWidth?: number; label: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;
  const color = value > 85 ? '#ef4444' : value > 70 ? '#f59e0b' : '#10b981';

  return (
    <div className="flex flex-col items-center gap-1 relative">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-muted/30" />
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size, top: 0 }}>
        <span className="text-sm font-bold" style={{ color }}>{Math.round(value)}%</span>
      </div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}

function LiveIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
      <span className="text-red-600 dark:text-red-400">LIVE</span>
    </span>
  );
}

export default function SystemInfrastructureDashboard() {
  const [lastUpdated] = useState<Date>(new Date());

  const { data, isLoading, error, refetch } = useQuery<InfrastructureData>({
    queryKey: ['infrastructure'],
    queryFn: async () => {
      const res = await fetch('/api/system/infrastructure');
      if (!res.ok) throw new Error('Gagal memuat data');
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 1_000, // Auto-refresh every 1s for real-time gauges
  });

  // Update last-updated timestamp when data changes (synchronous sync pattern)
  const displayTime = data ? new Date().toLocaleTimeString('id-ID') : lastUpdated.toLocaleTimeString('id-ID');

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Memuat data infrastruktur...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-sm text-destructive">Data infrastruktur tidak tersedia</p>
          <button
            onClick={() => refetch()}
            className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          >
            Coba lagi
          </button>
        </CardContent>
      </Card>
    );
  }

  const { system, pools, memory, performance, circuitBreakers, eventQueue, stbConfig } = data;
  const isSTB = system.stbMode;
  const isHealthy = performance?.summary?.healthy ?? true;
  const issues = performance?.summary?.issues ?? [];
  const alerts = performance?.activeAlerts ?? [];

  return (
    <div className="space-y-4">
      {/* ===== TOP BAR: System Overview ===== */}
      <Card className={isSTB ? 'border-amber-500/50' : ''}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className={`h-5 w-5 ${isSTB ? 'text-amber-600' : 'text-blue-600'}`} />
              <div>
                <CardTitle className="text-base">System Infrastructure</CardTitle>
                <CardDescription className="text-xs">
                  Node.js {system.nodeVersion} · {system.environment} · {system.platform}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {isSTB && (
                <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs gap-1">
                  <Cpu className="h-3 w-3" /> STB Mode
                </Badge>
              )}
              <Badge variant={isHealthy ? 'default' : 'destructive'} className="text-xs gap-1">
                <Activity className="h-3 w-3" />
                {isHealthy ? 'Sehat' : 'Bermasalah'}
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1">
                <Clock className="h-3 w-3" />
                {system.uptimeHuman}
              </Badge>
              <button
                onClick={() => refetch()}
                className="p-1 hover:bg-muted rounded-md transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* ===== MEMORY MONITOR ===== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-violet-600" />
              <CardTitle className="text-sm">Memory Monitor</CardTitle>
              <LiveIndicator />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {memory && (
              <>
                {/* Heap Usage & RSS - Circular Gauges */}
                <div className="flex items-center justify-around py-2">
                  <CircularGauge
                    value={memory.percent}
                    size={76}
                    strokeWidth={6}
                    label="Heap Usage"
                  />
                  <CircularGauge
                    value={(memory.rss / system.totalRamMB) * 100}
                    size={76}
                    strokeWidth={6}
                    label="RSS (RAM)"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-center p-2 rounded-lg bg-muted/50 border">
                    <p className="text-muted-foreground">Heap</p>
                    <p className={`font-semibold ${getHeapColor(memory.percent)}`}>{memory.heapUsedMB}/{memory.heapTotalMB}MB</p>
                    {isSTB && memory.budgetMaxHeapMB > 0 && (
                      <p className="text-muted-foreground mt-0.5">Budget: {memory.budgetMaxHeapMB}MB</p>
                    )}
                  </div>
                  <div className="text-center p-2 rounded-lg bg-muted/50 border">
                    <p className="text-muted-foreground">RSS</p>
                    <p className="font-semibold">{memory.rss}MB / {system.totalRamMB}MB</p>
                    <p className="text-muted-foreground mt-0.5">{Math.round((memory.rss / system.totalRamMB) * 100)}%</p>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center gap-2 pt-1">
                  {memory.underPressure ? (
                    <Badge variant="destructive" className="text-xs gap-1">
                      <AlertTriangle className="h-3 w-3" /> Under Pressure
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 border-emerald-500 text-emerald-600">
                      <Shield className="h-3 w-3" /> Normal
                    </Badge>
                  )}
                </div>
              </>
            )}
            {!memory && (
              <p className="text-xs text-muted-foreground">Data tidak tersedia</p>
            )}
          </CardContent>
        </Card>

        {/* ===== DATABASE CONNECTION POOLS ===== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-600" />
              <CardTitle className="text-sm">Connection Pools</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pools.transaction && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Transaction Pool</span>
                  <Badge variant={pools.transaction.isHealthy ? 'outline' : 'destructive'} className="text-xs h-5">
                    {pools.transaction.isHealthy ? 'OK' : 'Error'}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Active</span>
                    <p className="font-medium text-blue-600">{pools.transaction.activeConnections}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Idle</span>
                    <p className="font-medium text-emerald-600">{pools.transaction.idleConnections}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Waiting</span>
                    <p className="font-medium">{pools.transaction.waitingRequests}</p>
                  </div>
                </div>
              </div>
            )}
            {pools.session && (
              <>
                <Separator />
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Session Pool</span>
                    <Badge variant={pools.session.isHealthy ? 'outline' : 'destructive'} className="text-xs h-5">
                      {pools.session.isHealthy ? 'OK' : 'Error'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Active</span>
                      <p className="font-medium text-blue-600">{pools.session.activeConnections}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Idle</span>
                      <p className="font-medium text-emerald-600">{pools.session.idleConnections}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Waiting</span>
                      <p className="font-medium">{pools.session.waitingRequests}</p>
                    </div>
                  </div>
                </div>
              </>
            )}
            {!pools.transaction && !pools.session && (
              <p className="text-xs text-muted-foreground">Pool data tidak tersedia</p>
            )}
          </CardContent>
        </Card>

        {/* ===== EVENT QUEUE ===== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-orange-600" />
              <CardTitle className="text-sm">Event Queue</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {eventQueue ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Queue Size</span>
                    <p className="font-medium">
                      {eventQueue.queueSize}
                      <span className="text-muted-foreground"> / {eventQueue.maxQueueSize}</span>
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Connected</span>
                    <p className="font-medium text-blue-600">{eventQueue.connectedClients}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Events/sec</span>
                    <p className="font-medium">{eventQueue.health.eventsPerSecond}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Success Rate</span>
                    <p className={`font-medium ${eventQueue.health.successRate > 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {eventQueue.health.successRate.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Avg Latency</span>
                    <p className="font-medium">{eventQueue.health.avgLatencyMs}ms</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Dead Letter</span>
                    <p className={`font-medium ${eventQueue.deadLetterSize > 0 ? 'text-red-600' : ''}`}>
                      {eventQueue.deadLetterSize}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Event queue tidak terhubung</p>
            )}
          </CardContent>
        </Card>

        {/* ===== CIRCUIT BREAKERS ===== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-600" />
              <CardTitle className="text-sm">Circuit Breakers</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {circuitBreakers.length > 0 ? (
              <div className="space-y-2">
                {circuitBreakers.map((cb) => (
                  <div key={cb.name} className="flex items-center justify-between">
                    <span className="text-xs">{cb.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">failures: {cb.failures}</span>
                      <Badge
                        variant={
                          cb.state === 'closed' ? 'outline' :
                          cb.state === 'open' ? 'destructive' :
                          'secondary'
                        }
                        className={`text-xs h-5 ${
                          cb.state === 'closed' ? 'border-emerald-500 text-emerald-600' :
                          cb.state === 'open' ? '' :
                          'text-amber-600'
                        }`}
                      >
                        {cb.state.toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Tidak ada circuit breaker aktif</p>
            )}
          </CardContent>
        </Card>

        {/* ===== ACTIVE ALERTS ===== */}
        <Card className={alerts.length > 0 ? 'border-amber-500/50' : ''}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                <CardTitle className="text-sm">Alerts</CardTitle>
              </div>
              {alerts.length > 0 && (
                <Badge variant="destructive" className="text-xs">{alerts.length}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {alerts.length > 0 ? (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {alerts.slice(-10).reverse().map((alert, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <Badge
                      variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}
                      className="text-xs h-5 shrink-0 mt-0.5"
                    >
                      {alert.severity === 'critical' ? 'CRIT' : 'WARN'}
                    </Badge>
                    <div>
                      <span className="font-medium">{alert.metricName}</span>
                      <p className="text-muted-foreground">{alert.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-600" />
                <span className="text-xs text-emerald-600">Tidak ada alert aktif</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== ISSUES / STB CONFIG ===== */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              {isSTB ? (
                <Cpu className="h-4 w-4 text-amber-600" />
              ) : (
                <Server className="h-4 w-4 text-slate-600" />
              )}
              <CardTitle className="text-sm">{isSTB ? 'STB Configuration' : 'System Issues'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {isSTB ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total RAM</span>
                  <span className="font-medium">{String((stbConfig as Record<string, unknown>)?.totalRamMB ?? '-')}MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Heap Budget</span>
                  <span className="font-medium">{((stbConfig as Record<string, any>)?.memoryBudget as Record<string, number>)?.maxHeapMB}MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DB Pool (Tx/Session)</span>
                  <span className="font-medium">{((stbConfig as Record<string, any>)?.dbPool as Record<string, number>)?.tx} / {((stbConfig as Record<string, any>)?.dbPool as Record<string, number>)?.session}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Event Queue Max</span>
                  <span className="font-medium">{((stbConfig as Record<string, any>)?.eventQueue as Record<string, number>)?.maxQueue}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Query Cache Max</span>
                  <span className="font-medium">{((stbConfig as Record<string, any>)?.queryCache as Record<string, number>)?.maxEntries} entries</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">React Query GC</span>
                  <span className="font-medium">{Math.round(((stbConfig as Record<string, any>)?.reactQuery as Record<string, number>)?.gcTimeMs / 1000)}s</span>
                </div>
              </div>
            ) : issues.length > 0 ? (
              <div className="space-y-1.5">
                {issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground">{issue}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-600" />
                <span className="text-xs text-emerald-600">Semua sistem berjalan normal</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== FOOTER ===== */}
      <div className="text-xs text-muted-foreground text-right flex items-center justify-end gap-2">
        <Clock className="h-3 w-3" />
        Update terakhir: {lastUpdated.toLocaleTimeString('id-ID')}
        <span className="text-muted-foreground/50">(auto-refresh 1s)</span>
      </div>
    </div>
  );
}

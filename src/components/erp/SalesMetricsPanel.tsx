'use client';

import { useQuery } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency } from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart3,
  Users,
  ShoppingCart,
  Repeat,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  UserPlus,
  Trophy,
  Target,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  Cell,
} from 'recharts';

// ===================== TYPES =====================
interface MetricsProps {
  dateRange: { startDate: string; endDate: string };
  unitId?: string;
}

interface MetricsData {
  revenue: {
    current: number; previous: number;
    trend: { date: string; revenue: number; profit: number }[];
    trendPrevious: { date: string; revenue: number; profit: number }[];
    byPaymentMethod: { current: Record<string, { count: number; total: number }>; previous: Record<string, { count: number; total: number }> };
  };
  growth: {
    revenueGrowth: number; transactionCountGrowth: number; newCustomerGrowth: number;
    monthlyTrend: { month: string; revenue: number; profit: number }[];
  };
  conversion: {
    uniqueBuyers: number; totalActiveCustomers: number; conversionRate: number;
    newCustomerConversion: number; newCustomersInPeriod: number;
  };
  aov: {
    current: number; previous: number; trend: number;
    byPaymentMethod: Record<string, number>;
  };
  repeatPurchase: {
    repeatBuyers: number; totalBuyers: number; repeatRate: number;
    topCustomers: { customerId: string; name: string; transactionCount: number; totalSpent: number }[];
  };
  performance: {
    score: number; label: string;
    components: Record<string, { value: number; score: number; weight: number }>;
  };
}

// ===================== HELPERS =====================
const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtShort = (v: number) => {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}Jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}Rb`;
  return v.toFixed(0);
};
const scoreColor = (s: number) =>
  s >= 80 ? 'text-emerald-600' : s >= 60 ? 'text-amber-600' : s >= 40 ? 'text-orange-500' : 'text-red-500';
const scoreBg = (s: number) =>
  s >= 80 ? 'from-emerald-500 to-teal-500' : s >= 60 ? 'from-amber-400 to-yellow-500' : s >= 40 ? 'from-orange-400 to-orange-500' : 'from-red-400 to-red-500';
const scoreRing = (s: number) =>
  s >= 80 ? 'stroke-emerald-500' : s >= 60 ? 'stroke-amber-500' : s >= 40 ? 'stroke-orange-500' : 'stroke-red-500';
const scoreLabelBg = (s: number) =>
  s >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
  : s >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
  : s >= 40 ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800'
  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800';

const COMPONENT_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  revenueGrowth: { label: 'Pertumbuhan Revenue', icon: TrendingUp },
  conversionRate: { label: 'Conversion Rate', icon: Users },
  aovTrend: { label: 'Tren AOV', icon: ShoppingCart },
  repeatPurchaseRate: { label: 'Repeat Purchase', icon: Repeat },
  profitMargin: { label: 'Margin Profit', icon: DollarSign },
};

const PM_LABELS: Record<string, string> = { cash: '💵 Cash', piutang: '📋 Piutang', tempo: '📅 Tempo' };
const PM_COLORS: Record<string, string> = { cash: '#10b981', piutang: '#f59e0b', tempo: '#8b5cf6' };

// ===================== SUB-COMPONENTS =====================

function TrendArrow({ value, className }: { value: number; className?: string }) {
  if (value > 0) return <ArrowUpRight className={cn('w-4 h-4 text-emerald-600', className)} />;
  if (value < 0) return <ArrowDownRight className={cn('w-4 h-4 text-red-500', className)} />;
  return <Minus className={cn('w-4 h-4 text-muted-foreground', className)} />;
}

function MetricCard({ icon: Icon, label, value, sub, trend, trendLabel }: {
  icon: React.ElementType; label: string; value: string;
  sub?: string; trend?: number; trendLabel?: string;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-lg font-bold mt-0.5 truncate">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        </div>
        {trend !== undefined && (
          <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', trend > 0 ? 'text-emerald-600' : trend < 0 ? 'text-red-500' : 'text-muted-foreground')}>
            <TrendArrow value={trend} />
            <span>{fmtPct(trend)}</span>
            {trendLabel && <span className="text-muted-foreground font-normal ml-1">{trendLabel}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-32 h-32 sm:w-36 sm:h-36">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={radius} fill="none" className="stroke-muted" strokeWidth="10" />
          <circle
            cx="60" cy="60" r={radius} fill="none"
            className={cn('transition-all duration-1000', scoreRing(score))}
            strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl sm:text-4xl font-bold', scoreColor(score))}>{score}</span>
          <span className="text-[10px] text-muted-foreground">dari 100</span>
        </div>
      </div>
      <Badge className={cn('text-xs font-semibold border px-3 py-1', scoreLabelBg(score))}>
        <Trophy className="w-3 h-3 mr-1" />
        {label}
      </Badge>
    </div>
  );
}

function ComponentScores({ components }: { components: MetricsData['performance']['components'] }) {
  return (
    <div className="space-y-2.5">
      {Object.entries(components).map(([key, c]) => {
        const cfg = COMPONENT_LABELS[key] || { label: key, icon: Activity };
        const Icon = cfg.icon;
        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{cfg.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('font-semibold', scoreColor(c.score))}>{c.score}</span>
                <span className="text-muted-foreground text-[10px]">{Math.round(c.weight * 100)}%</span>
              </div>
            </div>
            <Progress value={c.score} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground">{fmtPct(c.value)}</p>
          </div>
        );
      })}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}><CardContent className="p-4"><div className="animate-pulse h-20 bg-muted rounded" /></CardContent></Card>
        ))}
      </div>
      {[1, 2, 3].map(i => (
        <Card key={i}><CardContent className="p-4"><div className="animate-pulse h-48 bg-muted rounded" /></CardContent></Card>
      ))}
    </div>
  );
}

// ===================== MAIN COMPONENT =====================

export default function SalesMetricsPanel({ dateRange, unitId }: MetricsProps) {
  const isMobile = useIsMobile();
  const chartH = isMobile ? 180 : 240;

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-metrics', dateRange, unitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
      if (unitId) params.set('unitId', unitId);
      const res = await apiFetch<{ metrics: MetricsData }>(`/api/dashboard/metrics?${params.toString()}`);
      return res.metrics;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const m = data;

  if (isLoading) return <LoadingSkeleton />;
  if (error || !m) {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="p-6 text-center">
          <Activity className="w-8 h-8 mx-auto text-red-400 mb-2" />
          <p className="text-sm text-muted-foreground">Gagal memuat data metrics</p>
        </CardContent>
      </Card>
    );
  }

  // Merge current + previous daily trend for overlay chart
  const revenueChartData = m.revenue.trend.map((d) => {
    const prev = m.revenue.trendPrevious.find((p) => p.date === d.date);
    return { date: d.date, revenue: d.revenue, profit: d.profit, prevRevenue: prev?.revenue || 0 };
  });

  // Payment method chart data
  const pmEntries = Object.entries(m.revenue.byPaymentMethod.current || {});
  const pmChartData = pmEntries.map(([method, d]) => ({
    method: PM_LABELS[method] || method,
    count: d.count,
    total: d.total,
    fill: PM_COLORS[method] || '#6b7280',
  }));

  // Monthly trend data (merge current period into the 6-month trend for context)
  const growthChartData = m.growth.monthlyTrend.map((d) => ({
    month: d.month,
    revenue: d.revenue,
    profit: d.profit,
  }));

  // AOV comparison chart data
  const aovChartData = Object.entries(m.aov.byPaymentMethod || {}).map(([method, value]) => ({
    method: PM_LABELS[method] || method,
    aov: value,
    fill: PM_COLORS[method] || '#6b7280',
  }));

  // Format day label for chart
  const fmtDay = (v: string) => v.slice(8);
  const fmtMonth = (v: string) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const mNum = parseInt(v.slice(5, 7), 10) - 1;
    return months[mNum] || v;
  };

  return (
    <div className="space-y-4">
      {/* =========================================== */}
      {/* SECTION 1: PERFORMANCE SCORE + METRIC CARDS */}
      {/* =========================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Performance Score */}
        <Card className="lg:row-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Performa Perusahaan
            </CardTitle>
            <CardDescription className="text-[10px]">Skor komposit berdasarkan 5 metrik utama</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <ScoreGauge score={m.performance.score} label={m.performance.label} />
            <ComponentScores components={m.performance.components} />
          </CardContent>
        </Card>

        {/* Top Metric Cards */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MetricCard
            icon={DollarSign}
            label="Revenue Periode Ini"
            value={formatCurrency(m.revenue.current)}
            sub={`Sebelumnya: ${formatCurrency(m.revenue.previous)}`}
            trend={m.growth.revenueGrowth}
            trendLabel="vs periode lalu"
          />
          <MetricCard
            icon={TrendingUp}
            label="AOV (Rata-rata Order)"
            value={formatCurrency(m.aov.current)}
            sub={`Sebelumnya: ${formatCurrency(m.aov.previous)}`}
            trend={m.aov.trend}
            trendLabel="vs periode lalu"
          />
          <MetricCard
            icon={Users}
            label="Conversion Rate"
            value={`${m.conversion.conversionRate.toFixed(1)}%`}
            sub={`${m.conversion.uniqueBuyers} dari ${m.conversion.totalActiveCustomers} pelanggan aktif`}
          />
          <MetricCard
            icon={UserPlus}
            label="Pelanggan Baru"
            value={String(m.conversion.newCustomersInPeriod)}
            sub={`Konversi: ${m.conversion.newCustomerConversion.toFixed(1)}%`}
            trend={m.growth.newCustomerGrowth}
            trendLabel="vs periode lalu"
          />
          <MetricCard
            icon={Repeat}
            label="Repeat Purchase Rate"
            value={`${m.repeatPurchase.repeatRate.toFixed(1)}%`}
            sub={`${m.repeatPurchase.repeatBuyers} dari ${m.repeatPurchase.totalBuyers} pembeli`}
          />
          <MetricCard
            icon={ShoppingCart}
            label="Pertumbuhan Transaksi"
            value={`${m.growth.transactionCountGrowth >= 0 ? '+' : ''}${m.growth.transactionCountGrowth.toFixed(1)}%`}
            trend={m.growth.transactionCountGrowth}
            trendLabel="vs periode lalu"
          />
        </div>
      </div>

      {/* =========================================== */}
      {/* SECTION 2: REVENUE TREND CHART */}
      {/* =========================================== */}
      <Card>
        <CardHeader className="pb-2 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-500" />
              Revenue Harian
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Periode vs Sebelumnya
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-2 pb-3">
          <ResponsiveContainer width="100%" height={chartH}>
            <AreaChart data={revenueChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" tickFormatter={fmtDay} fontSize={10} tickLine={false} />
              <YAxis tickFormatter={fmtShort} fontSize={10} tickLine={false} />
              <RTooltip
                formatter={(value: number, name: string) => [
                  name === 'revenue' ? formatCurrency(value) : formatCurrency(value),
                  name === 'revenue' ? 'Revenue Saat Ini' : 'Revenue Sebelumnya',
                ]}
                labelFormatter={(label) => `Tanggal: ${label}`}
              />
              <Legend
                formatter={(v) => (v === 'revenue' ? 'Periode Ini' : 'Periode Lalu')}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Area
                type="monotone"
                dataKey="prevRevenue"
                stroke="#d1d5db"
                strokeDasharray="4 4"
                fill="none"
                strokeWidth={1.5}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#10b981"
                fill="url(#revenueGrad)"
                strokeWidth={2}
              />
              <defs>
                <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* =========================================== */}
      {/* SECTION 3: GROWTH + PAYMENT METHOD */}
      {/* =========================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monthly Growth Chart */}
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-amber-500" />
              Tren Revenue 6 Bulan
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={growthChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tickFormatter={fmtMonth} fontSize={10} tickLine={false} />
                <YAxis tickFormatter={fmtShort} fontSize={10} tickLine={false} />
                <RTooltip
                  formatter={(value: number, name: string) => [
                    formatCurrency(value),
                    name === 'revenue' ? 'Revenue' : 'Profit',
                  ]}
                />
                <Bar dataKey="revenue" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Payment Method */}
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-teal-500" />
              Revenue per Metode Pembayaran
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3 space-y-3">
            {pmChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={Math.min(chartH - 40, 140)}>
                <BarChart data={pmChartData} layout="vertical" barCategoryGap={4}>
                  <XAxis type="number" tickFormatter={fmtShort} fontSize={10} tickLine={false} />
                  <YAxis type="category" dataKey="method" width={70} fontSize={10} tickLine={false} />
                  <RTooltip formatter={(value: number) => [formatCurrency(value), 'Total']} />
                  <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                    {pmChartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground text-sm py-8">Belum ada data</p>
            )}
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2">
              {pmChartData.map((d) => (
                <Badge key={d.method} variant="secondary" className="text-[10px]">
                  {d.method}: {d.count} tx
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* =========================================== */}
      {/* SECTION 4: CONVERSION + AOV + REPEAT */}
      {/* =========================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Conversion Rate */}
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-500" />
              Conversion Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <p className={cn('text-3xl font-bold', m.conversion.conversionRate >= 30 ? 'text-emerald-600' : m.conversion.conversionRate >= 15 ? 'text-amber-600' : 'text-red-500')}>
                {m.conversion.conversionRate.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {m.conversion.uniqueBuyers} dari {m.conversion.totalActiveCustomers} pelanggan aktif membeli
              </p>
            </div>
            <Progress
              value={Math.min(m.conversion.conversionRate, 100)}
              className="h-2"
            />
            <div className="p-2 rounded-lg bg-muted/50 text-center">
              <p className="text-[10px] text-muted-foreground">Pelanggan Baru Konversi</p>
              <p className="text-sm font-semibold">{m.conversion.newCustomerConversion.toFixed(1)}%</p>
              <p className="text-[10px] text-muted-foreground">{m.conversion.newCustomersInPeriod} pelanggan baru</p>
            </div>
          </CardContent>
        </Card>

        {/* AOV by Payment Method */}
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-purple-500" />
              AOV per Metode
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <p className="text-2xl font-bold">{formatCurrency(m.aov.current)}</p>
              <div className={cn('flex items-center justify-center gap-1 text-xs mt-1', m.aov.trend >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                <TrendArrow value={m.aov.trend} />
                <span className="font-medium">{fmtPct(m.aov.trend)}</span>
                <span className="text-muted-foreground">vs lalu</span>
              </div>
            </div>
            {aovChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={aovChartData}>
                  <XAxis dataKey="method" fontSize={9} tickLine={false} />
                  <YAxis tickFormatter={fmtShort} fontSize={9} tickLine={false} />
                  <RTooltip formatter={(v: number) => [formatCurrency(v), 'AOV']} />
                  <Bar dataKey="aov" radius={[3, 3, 0, 0]}>
                    {aovChartData.map((e, i) => (
                      <Cell key={i} fill={e.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground text-sm py-4">Belum ada data</p>
            )}
            <p className="text-[10px] text-muted-foreground text-center">
              Sebelumnya: {formatCurrency(m.aov.previous)}
            </p>
          </CardContent>
        </Card>

        {/* Repeat Purchase Rate */}
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Repeat className="w-4 h-4 text-rose-500" />
              Repeat Purchase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-center">
              <p className={cn('text-3xl font-bold', m.repeatPurchase.repeatRate >= 30 ? 'text-emerald-600' : m.repeatPurchase.repeatRate >= 15 ? 'text-amber-600' : 'text-red-500')}>
                {m.repeatPurchase.repeatRate.toFixed(1)}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {m.repeatPurchase.repeatBuyers} dari {m.repeatPurchase.totalBuyers} pembeli belanja ulang
              </p>
            </div>
            <Progress value={Math.min(m.repeatPurchase.repeatRate, 100)} className="h-2" />
            {m.repeatPurchase.topCustomers.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-medium text-muted-foreground">Top Repeat Buyers</p>
                <div className="max-h-28 overflow-y-auto space-y-1">
                  {m.repeatPurchase.topCustomers.slice(0, 5).map((c, i) => (
                    <div key={c.customerId} className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold shrink-0">{i + 1}</span>
                        <span className="truncate">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">{c.transactionCount}x</Badge>
                        <span className="text-[10px] font-medium">{fmtShort(c.totalSpent)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* =========================================== */}
      {/* SECTION 5: TOP REPEAT CUSTOMERS TABLE */}
      {/* =========================================== */}
      {m.repeatPurchase.topCustomers.length > 0 && (
        <Card>
          <CardHeader className="pb-2 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              Top Repeat Customers
            </CardTitle>
            <CardDescription className="text-[10px]">Pelanggan dengan pembelian berulang tertinggi</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="text-left p-3">#</th>
                    <th className="text-left p-3">Nama</th>
                    <th className="text-center p-3">Transaksi</th>
                    <th className="text-right p-3">Total Belanja</th>
                  </tr>
                </thead>
                <tbody>
                  {m.repeatPurchase.topCustomers.map((c, i) => (
                    <tr key={c.customerId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <div className={cn(
                          'w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-[10px]',
                          i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-muted-foreground/30'
                        )}>
                          {i + 1}
                        </div>
                      </td>
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 text-center">
                        <Badge variant="secondary" className="text-xs">{c.transactionCount}x</Badge>
                      </td>
                      <td className="p-3 text-right font-semibold">{formatCurrency(c.totalSpent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}



import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin can access detailed metrics (contains sensitive profit/conversion data)
    if (authResult.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — hanya Super Admin yang dapat mengakses metrics' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get('unitId');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    // ── Compute current period date range ──
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filterStart = startDateParam
      ? new Date(new Date(startDateParam).setHours(0, 0, 0, 0))
      : monthStart;
    const filterEnd = endDateParam
      ? new Date(new Date(endDateParam).setHours(23, 59, 59, 999))
      : monthEnd;

    // ── Compute previous period (same length before current) ──
    const periodMs = filterEnd.getTime() - filterStart.getTime();
    const prevEnd = new Date(filterStart.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    // ── Last 6 months start ──
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // ── Helper: build base transaction query ──
    const buildTxQuery = (start: Date, end: Date) => {
      let q = db
        .from('transactions')
        .select('total, total_profit, payment_method, customer_id, transaction_date')
        .eq('type', 'sale')
        .in('status', ['approved', 'paid'])
        .gte('transaction_date', start.toISOString())
        .lte('transaction_date', end.toISOString());
      if (unitId) q = q.eq('unit_id', unitId);
      return q;
    };

    // ====================================================================
    // BATCH 1: All independent queries (6 parallel)
    // ====================================================================
    const [
      currentTxResult,
      prevTxResult,
      activeCustomersCount,
      newCustomersCurrentCount,
      newCustomersPrevCount,
      last6MonthsTxResult,
    ] = await Promise.all([
      // 1. Current period transactions
      buildTxQuery(filterStart, filterEnd),

      // 2. Previous period transactions
      buildTxQuery(prevStart, prevEnd),

      // 3. Total active customers (non-lost)
      (() => {
        let q = db
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'lost');
        if (unitId) q = q.eq('unit_id', unitId);
        return q;
      })(),

      // 4. New customers created in current period
      (() => {
        let q = db
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', filterStart.toISOString())
          .lte('created_at', filterEnd.toISOString());
        if (unitId) q = q.eq('unit_id', unitId);
        return q;
      })(),

      // 5. New customers created in previous period
      (() => {
        let q = db
          .from('customers')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', prevStart.toISOString())
          .lte('created_at', prevEnd.toISOString());
        if (unitId) q = q.eq('unit_id', unitId);
        return q;
      })(),

      // 6. Last 6 months transactions for monthly trend chart
      (() => {
        let q = db
          .from('transactions')
          .select('total, total_profit, transaction_date')
          .eq('type', 'sale')
          .in('status', ['approved', 'paid'])
          .gte('transaction_date', sixMonthsAgo.toISOString());
        if (unitId) q = q.eq('unit_id', unitId);
        return q;
      })(),
    ]);

    // ====================================================================
    // SYNCHRONOUS COMPUTATIONS from Batch 1 results
    // ====================================================================
    const currentTx = currentTxResult.data || [];
    const prevTx = prevTxResult.data || [];
    const last6MonthsTx = last6MonthsTxResult.data || [];

    // ── 1. REVENUE ──
    const currentRevenue = currentTx.reduce((s, t) => s + (t.total || 0), 0);
    const currentProfit = currentTx.reduce((s, t) => s + (t.total_profit || 0), 0);
    const prevRevenue = prevTx.reduce((s, t) => s + (t.total || 0), 0);
    const prevProfit = prevTx.reduce((s, t) => s + (t.total_profit || 0), 0);
    const currentTxCount = currentTx.length;
    const prevTxCount = prevTx.length;

    // Revenue by payment method (current & previous)
    const paymentMethodCurrent = aggregateByPaymentMethod(currentTx);
    const paymentMethodPrevious = aggregateByPaymentMethod(prevTx);

    // Daily trend for current and previous period (for chart)
    const dailyCurrent = buildDailyBreakdown(currentTx, filterStart, filterEnd);
    const dailyPrevious = buildDailyBreakdown(prevTx, prevStart, prevEnd);

    // ── 2. GROWTH ──
    const revenueGrowthPct = calcGrowth(currentRevenue, prevRevenue);
    const txCountGrowthPct = calcGrowth(currentTxCount, prevTxCount);
    const newCustomersCurrent = newCustomersCurrentCount.count || 0;
    const newCustomersPrev = newCustomersPrevCount.count || 0;
    const newCustomerGrowthPct = calcGrowth(newCustomersCurrent, newCustomersPrev);

    // Monthly revenue trend for last 6 months (for chart)
    const monthlyTrend = buildMonthlyBreakdown(last6MonthsTx, sixMonthsAgo, now);

    // ── 3. CONVERSION RATE ──
    const activeCustomers = activeCustomersCount.count || 0;
    const uniqueBuyersCurrent = new Set(
      currentTx.map((t) => t.customer_id).filter(Boolean)
    ).size;
    const conversionRate =
      activeCustomers > 0 ? (uniqueBuyersCurrent / activeCustomers) * 100 : 0;
    const newCustomerConversion =
      activeCustomers > 0 ? (newCustomersCurrent / activeCustomers) * 100 : 0;

    // ── 4. AOV (Average Order Value) ──
    const currentAov = currentTxCount > 0 ? currentRevenue / currentTxCount : 0;
    const prevAov = prevTxCount > 0 ? prevRevenue / prevTxCount : 0;
    const aovTrendPct = calcGrowth(currentAov, prevAov);

    // AOV by payment method (current period)
    const aovByPaymentMethod: Record<string, number> = {};
    for (const [method, data] of paymentMethodCurrent) {
      aovByPaymentMethod[method] = data.count > 0 ? data.total / data.count : 0;
    }

    // ── 5. REPEAT PURCHASE RATE ──
    const customerTxMap = new Map<string, { count: number; totalSpent: number }>();
    for (const t of currentTx) {
      if (!t.customer_id) continue;
      const entry = customerTxMap.get(t.customer_id) || { count: 0, totalSpent: 0 };
      entry.count++;
      entry.totalSpent += t.total || 0;
      customerTxMap.set(t.customer_id, entry);
    }

    const totalBuyers = customerTxMap.size;
    const repeatBuyers = Array.from(customerTxMap.values()).filter(
      (c) => c.count > 1
    ).length;
    const repeatRate = totalBuyers > 0 ? (repeatBuyers / totalBuyers) * 100 : 0;

    // Identify top repeat customer IDs for name resolution
    const topRepeatEntries = Array.from(customerTxMap.entries())
      .filter(([, data]) => data.count > 1)
      .sort((a, b) => b[1].totalSpent - a[1].totalSpent)
      .slice(0, 10);
    const topRepeatCustomerIds = topRepeatEntries.map(([id]) => id);

    // ====================================================================
    // BATCH 2: Resolve customer names (1 query, only if needed)
    // ====================================================================
    let topRepeatCustomers: Array<{
      customerId: string;
      name: string;
      transactionCount: number;
      totalSpent: number;
    }> = [];

    if (topRepeatCustomerIds.length > 0) {
      const { data: customerRows } = await db
        .from('customers')
        .select('id, name')
        .in('id', topRepeatCustomerIds);

      const nameMap = new Map(
        (customerRows || []).map((c: any) => [c.id, c.name])
      );

      topRepeatCustomers = topRepeatEntries.map(([id, data]) => ({
        customerId: id,
        name: nameMap.get(id) || 'Unknown',
        transactionCount: data.count,
        totalSpent: data.totalSpent,
      }));
    }

    // ── 6. PERFORMANCE SCORE (weighted composite 0–100) ──
    //    Revenue growth → 25%, Conversion rate → 20%, AOV trend → 20%,
    //    Repeat purchase rate → 15%, Profit margin → 20%
    const profitMargin =
      currentRevenue > 0 ? (currentProfit / currentRevenue) * 100 : 0;

    const revenueGrowthScore = clampScore(revenueGrowthPct, 20);
    const conversionScore = clampScore(conversionRate, 50);
    const aovTrendScore = clampScore(aovTrendPct, 20);
    const repeatRateScore = clampScore(repeatRate, 50);
    const profitMarginScore = clampScore(profitMargin, 30);

    const performanceScore = Math.round(
      revenueGrowthScore * 0.25 +
        conversionScore * 0.20 +
        aovTrendScore * 0.20 +
        repeatRateScore * 0.15 +
        profitMarginScore * 0.20
    );

    const performanceLabel =
      performanceScore >= 80
        ? 'Excellent'
        : performanceScore >= 60
          ? 'Good'
          : performanceScore >= 40
            ? 'Average'
            : 'Needs Improvement';

    // ====================================================================
    // RESPONSE
    // ====================================================================
    return NextResponse.json(
      {
        metrics: {
          revenue: {
            current: currentRevenue,
            previous: prevRevenue,
            trend: dailyCurrent,
            trendPrevious: dailyPrevious,
            byPaymentMethod: {
              current: Object.fromEntries(paymentMethodCurrent),
              previous: Object.fromEntries(paymentMethodPrevious),
            },
          },
          growth: {
            revenueGrowth: r2(revenueGrowthPct),
            transactionCountGrowth: r2(txCountGrowthPct),
            newCustomerGrowth: r2(newCustomerGrowthPct),
            monthlyTrend,
          },
          conversion: {
            uniqueBuyers: uniqueBuyersCurrent,
            totalActiveCustomers: activeCustomers,
            conversionRate: r2(conversionRate),
            newCustomerConversion: r2(newCustomerConversion),
            newCustomersInPeriod: newCustomersCurrent,
          },
          aov: {
            current: r2(currentAov),
            previous: r2(prevAov),
            trend: r2(aovTrendPct),
            byPaymentMethod: mapValues(aovByPaymentMethod, r2),
          },
          repeatPurchase: {
            repeatBuyers,
            totalBuyers,
            repeatRate: r2(repeatRate),
            topCustomers: topRepeatCustomers,
          },
          performance: {
            score: performanceScore,
            label: performanceLabel,
            components: {
              revenueGrowth: {
                value: r2(revenueGrowthPct),
                score: Math.round(revenueGrowthScore),
                weight: 0.25,
              },
              conversionRate: {
                value: r2(conversionRate),
                score: Math.round(conversionScore),
                weight: 0.2,
              },
              aovTrend: {
                value: r2(aovTrendPct),
                score: Math.round(aovTrendScore),
                weight: 0.2,
              },
              repeatPurchaseRate: {
                value: r2(repeatRate),
                score: Math.round(repeatRateScore),
                weight: 0.15,
              },
              profitMargin: {
                value: r2(profitMargin),
                score: Math.round(profitMarginScore),
                weight: 0.2,
              },
            },
          },
          period: {
            current: {
              start: filterStart.toISOString(),
              end: filterEnd.toISOString(),
            },
            previous: {
              start: prevStart.toISOString(),
              end: prevEnd.toISOString(),
            },
          },
        },
      },
      {
        headers: {
          'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=90',
        },
      }
    );
  } catch (error) {
    console.error('Get dashboard metrics error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

/**
 * Aggregate transaction totals by payment method.
 * Returns a Map<method, { count, total }>.
 */
function aggregateByPaymentMethod(
  txs: Array<{
    total: number;
    payment_method: string | null;
  }>
): Map<string, { count: number; total: number }> {
  const map = new Map<string, { count: number; total: number }>();
  for (const t of txs) {
    const method = t.payment_method || 'cash';
    const entry = map.get(method) || { count: 0, total: 0 };
    entry.count++;
    entry.total += t.total || 0;
    map.set(method, entry);
  }
  return map;
}

/**
 * Build daily revenue + profit breakdown for chart rendering.
 * Caps at 31 days to avoid oversized payloads.
 */
function buildDailyBreakdown(
  txs: Array<{
    total: number;
    total_profit: number;
    transaction_date: string;
  }>,
  start: Date,
  end: Date
): Array<{ date: string; revenue: number; profit: number }> {
  const result: Array<{ date: string; revenue: number; profit: number }> = [];
  const days = Math.min(
    Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1),
    31
  );

  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(end);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dateLabel = dayStart.toISOString().split('T')[0];
    let revenue = 0;
    let profit = 0;

    for (const t of txs) {
      const txDate = new Date(t.transaction_date);
      if (txDate >= dayStart && txDate < dayEnd) {
        revenue += t.total || 0;
        profit += t.total_profit || 0;
      }
    }

    result.push({ date: dateLabel, revenue, profit });
  }

  return result;
}

/**
 * Build monthly revenue + profit breakdown (up to 6 months).
 * Used for the growth trend chart.
 */
function buildMonthlyBreakdown(
  txs: Array<{
    total: number;
    total_profit: number;
    transaction_date: string;
  }>,
  start: Date,
  end: Date
): Array<{ month: string; revenue: number; profit: number }> {
  const result: Array<{ month: string; revenue: number; profit: number }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor <= end) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );
    const monthLabel = monthStart.toISOString().slice(0, 7); // YYYY-MM

    let revenue = 0;
    let profit = 0;

    for (const t of txs) {
      const txDate = new Date(t.transaction_date);
      if (txDate >= monthStart && txDate <= monthEnd) {
        revenue += t.total || 0;
        profit += t.total_profit || 0;
      }
    }

    result.push({ month: monthLabel, revenue, profit });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return result;
}

/**
 * Calculate growth percentage from current to previous value.
 * Returns 100 if previous is 0 but current > 0.
 * Returns 0 if both are 0.
 */
function calcGrowth(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

/**
 * Map a raw value to a 0–100 score using a linear scale.
 * The value that maps to 100 is `targetAt100`.
 * Negative values are clamped to 0; values above target are capped at 100.
 */
function clampScore(value: number, targetAt100: number): number {
  if (targetAt100 <= 0) return value >= 0 ? 100 : 0;
  const raw = (value / targetAt100) * 100;
  return Math.max(0, Math.min(100, raw));
}

/** Round to 2 decimal places */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Map all values of a Record through a transform function */
function mapValues<T>(
  obj: Record<string, T>,
  fn: (v: T) => T
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = fn(v);
  }
  return out;
}

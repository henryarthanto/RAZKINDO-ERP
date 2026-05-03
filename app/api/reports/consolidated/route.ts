import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';
import { cacheGet, cacheSet } from '@/lib/redis-cache';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const authUserId = await verifyAuthUser(authHeader);
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const endDate = searchParams.get('endDate') || new Date().toISOString().slice(0, 10);
    const unitId = searchParams.get('unitId') || ''; // empty = all units

    const cacheKey = `report:consolidated:${startDate}:${endDate}:${unitId}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return NextResponse.json(cached);

    // ─── Per-unit transaction summary ───
    const { data: unitData } = await db
      .from('units')
      .select('id, name')
      .order('name');

    const units = unitData || [];
    const unitSummaries: any[] = [];

    for (const unit of units) {
      if (unitId && unit.id !== unitId) continue;

      const { data: txData } = await db
        .from('transactions')
        .select('id, total, discount, payment_method, status, created_at')
        .eq('unit_id', unit.id)
        .gte('created_at', startDate)
        .lte('created_at', endDate + 'T23:59:59');

      const transactions = txData || [];
      const completed = transactions.filter((t: any) => t.status === 'completed' || t.status === 'paid');
      const totalRevenue = completed.reduce((sum: number, t: any) => sum + (t.total || 0), 0);
      const totalDiscount = completed.reduce((sum: number, t: any) => sum + (t.discount || 0), 0);
      const totalTransactions = transactions.length;
      const completedTransactions = completed.length;

      // Payment method breakdown
      const paymentBreakdown: Record<string, { count: number; total: number }> = {};
      for (const tx of completed) {
        const method = tx.payment_method || 'unknown';
        if (!paymentBreakdown[method]) paymentBreakdown[method] = { count: 0, total: 0 };
        paymentBreakdown[method].count++;
        paymentBreakdown[method].total += tx.total || 0;
      }

      // Daily revenue for chart
      const dailyRevenue: Record<string, number> = {};
      for (const tx of completed) {
        const day = (tx.created_at as string).slice(0, 10);
        dailyRevenue[day] = (dailyRevenue[day] || 0) + (tx.total || 0);
      }

      unitSummaries.push({
        unitId: unit.id,
        unitName: unit.name,
        totalRevenue,
        totalDiscount,
        netRevenue: totalRevenue - totalDiscount,
        totalTransactions,
        completedTransactions,
        completionRate: totalTransactions > 0 ? Math.round((completedTransactions / totalTransactions) * 100) : 0,
        paymentBreakdown,
        dailyRevenue,
      });
    }

    // ─── Overall summary ───
    const { data: allTx } = await db
      .from('transactions')
      .select('id, total, discount, status, payment_method, created_at, unit_id')
      .gte('created_at', startDate)
      .lte('created_at', endDate + 'T23:59:59');

    const allTransactions = allTx || [];
    const allCompleted = allTransactions.filter((t: any) => t.status === 'completed' || t.status === 'paid');
    const grandTotal = allCompleted.reduce((sum: number, t: any) => sum + (t.total || 0), 0);
    const grandDiscount = allCompleted.reduce((sum: number, t: any) => sum + (t.discount || 0), 0);

    // Top products
    const { data: topProducts } = await db
      .from('transaction_items')
      .select('product_id, product_name, qty, subtotal, transactions!inner(unit_id, created_at)')
      .gte('transactions.created_at', startDate)
      .lte('transactions.created_at', endDate + 'T23:59:59')
      .limit(20);

    const productAgg: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const item of (topProducts || [])) {
      const pid = item.product_id || 'unknown';
      if (!productAgg[pid]) productAgg[pid] = { name: item.product_name || 'Unknown', qty: 0, revenue: 0 };
      productAgg[pid].qty += item.qty || 0;
      productAgg[pid].revenue += item.subtotal || 0;
    }

    const topProductsList = Object.values(productAgg)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Overall payment breakdown
    const overallPayment: Record<string, { count: number; total: number }> = {};
    for (const tx of allCompleted) {
      const method = tx.payment_method || 'unknown';
      if (!overallPayment[method]) overallPayment[method] = { count: 0, total: 0 };
      overallPayment[method].count++;
      overallPayment[method].total += tx.total || 0;
    }

    const result = {
      period: { startDate, endDate },
      summary: {
        grandTotal,
        grandDiscount,
        netRevenue: grandTotal - grandDiscount,
        totalTransactions: allTransactions.length,
        completedTransactions: allCompleted.length,
        completionRate: allTransactions.length > 0 ? Math.round((allCompleted.length / allTransactions.length) * 100) : 0,
        avgTransactionValue: allCompleted.length > 0 ? Math.round(grandTotal / allCompleted.length) : 0,
      },
      unitSummaries,
      topProducts: topProductsList,
      overallPayment,
    };

    // Cache for 5 minutes
    await cacheSet(cacheKey, result, { ttlMs: 5 * 60 * 1000 });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Reports] Consolidated report error:', error);
    return NextResponse.json({ error: 'Gagal membuat laporan' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { rowsToCamelCase } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    // Determine if user is super_admin (to control HPP/profit visibility)
    const isSuperAdmin = authResult.user?.role === 'super_admin';

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'sales';
    const unitId = searchParams.get('unitId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    let report: any = {};

    switch (type) {
      case 'sales': {
        let query = db.from('transactions').select(`
          *, items:transaction_items(*), created_by:users!created_by_id(id, name, role), customer:customers(id, name, phone), unit:units(id, name)
        `).in('status', ['approved', 'paid']).eq('type', 'sale');
        if (unitId) query = query.eq('unit_id', unitId);
        if (startDate) query = query.gte('transaction_date', new Date(startDate).toISOString());
        if (endDate) query = query.lte('transaction_date', new Date(endDate).toISOString());
        query = query.order('transaction_date', { ascending: false }).limit(500);

        const { data: salesTransactions } = await query;
        const mapped = rowsToCamelCase(salesTransactions || []);
        const totalSales = mapped.reduce((sum: number, t: any) => sum + t.total, 0);
        const totalProfit = mapped.reduce((sum: number, t: any) => sum + (t.totalProfit || 0), 0);

        report = {
          type: 'sales', period: { startDate, endDate },
          summary: { totalTransactions: mapped.length, totalSales, totalProfit: isSuperAdmin ? totalProfit : undefined, avgTransaction: mapped.length > 0 ? totalSales / mapped.length : 0 },
          transactions: mapped.map((t: any) => ({ invoiceNo: t.invoiceNo, date: t.transactionDate, customer: t.customer?.name || 'Walk-in', sales: t.createdBy?.name || 'Unknown', total: t.total, ...(isSuperAdmin ? { profit: t.totalProfit } : {}), status: t.paymentStatus })),
        };
        break;
      }

      case 'profit': {
        if (!isSuperAdmin) {
          return NextResponse.json({ error: 'Forbidden — laporan profit hanya untuk Super Admin' }, { status: 403 });
        }
        let query = db.from('transactions').select('*, items:transaction_items(*), unit:units(id, name)').in('status', ['approved', 'paid']).eq('type', 'sale');
        if (unitId) query = query.eq('unit_id', unitId);
        if (startDate) query = query.gte('transaction_date', new Date(startDate).toISOString());
        if (endDate) query = query.lte('transaction_date', new Date(endDate).toISOString());
        query = query.limit(500);

        const { data: profitTransactions } = await query;
        const mapped = rowsToCamelCase(profitTransactions || []);
        const hppTotal = mapped.reduce((sum: number, t: any) => sum + (t.totalHpp || 0), 0);
        const profitTotal = mapped.reduce((sum: number, t: any) => sum + (t.totalProfit || 0), 0);
        const hppPaid = mapped.reduce((sum: number, t: any) => sum + (t.hppPaid || 0), 0);
        const profitPaid = mapped.reduce((sum: number, t: any) => sum + (t.profitPaid || 0), 0);
        const totalRevenue = mapped.reduce((s: number, t: any) => s + t.total, 0);

        report = {
          type: 'profit', period: { startDate, endDate },
          summary: { totalRevenue, totalHpp: hppTotal, totalProfit: profitTotal, profitMargin: totalRevenue > 0 ? (profitTotal / totalRevenue) * 100 : 0, hppPaid, profitPaid, hppUnpaid: hppTotal - hppPaid, profitUnpaid: profitTotal - profitPaid },
          transactions: mapped,
        };
        break;
      }

      case 'stock': {
        const { data: products } = await db.from('products').select('*, unit_products:unit_products(id, stock, unit:units(id, name))').eq('is_active', true).limit(500);
        const mapped = rowsToCamelCase(products || []);
        report = {
          type: 'stock',
          products: mapped.map((p: any) => ({
            name: p.name, sku: p.sku, globalStock: p.globalStock, avgHpp: p.avgHpp, minStock: p.minStock,
            status: p.globalStock <= p.minStock ? 'low' : 'ok',
            unitStocks: (p.unitProducts || []).map((up: any) => ({ unit: up.unit?.name, stock: up.stock })),
          })),
        };
        break;
      }

      case 'receivables': {
        let query = db.from('transactions').select('*, customer:customers(id, name), unit:units(id, name), payments:payments(*)').gt('remaining_amount', 0).in('status', ['approved', 'paid']).eq('type', 'sale');
        if (unitId) query = query.eq('unit_id', unitId);
        if (startDate) query = query.gte('transaction_date', new Date(startDate).toISOString());
        if (endDate) query = query.lte('transaction_date', new Date(endDate).toISOString());
        query = query.limit(500);

        const { data: receivables } = await query;
        const mapped = rowsToCamelCase(receivables || []);
        report = {
          type: 'receivables',
          summary: { totalReceivables: mapped.reduce((s: number, t: any) => s + t.remainingAmount, 0), count: mapped.length },
          transactions: mapped.map((t: any) => ({ invoiceNo: t.invoiceNo, date: t.transactionDate, dueDate: t.dueDate, customer: t.customer?.name || 'Unknown', total: t.total, paid: t.paidAmount, remaining: t.remainingAmount, unit: t.unit?.name })),
        };
        break;
      }

      case 'users': {
        const { data: users } = await db.from('users').select('*, unit:units(id, name)').eq('is_active', true).eq('status', 'approved');
        const userIds = (users || []).map((u: any) => u.id);
        const mapped = rowsToCamelCase(users || []);

        // Get transaction aggregates per user
        let query = db.from('transactions').select('created_by_id, total, total_profit').eq('type', 'sale').in('status', ['approved', 'paid']);
        if (unitId) query = query.eq('unit_id', unitId);
        if (startDate) query = query.gte('transaction_date', new Date(startDate).toISOString());
        if (endDate) query = query.lte('transaction_date', new Date(endDate).toISOString());
        const { data: allUserTx } = await query;

        const userTxMap = new Map<string, { totalSales: number; totalProfit: number; count: number }>();
        for (const t of (allUserTx || [])) {
          const key = t.created_by_id;
          const e = userTxMap.get(key) || { totalSales: 0, totalProfit: 0, count: 0 };
          e.totalSales += t.total || 0;
          e.totalProfit += t.total_profit || 0;
          e.count++;
          userTxMap.set(key, e);
        }

        const userStats = mapped.map((user: any) => {
          const agg = userTxMap.get(user.id);
          return { name: user.name, role: user.role, unit: user.unit?.name, transactionCount: agg?.count || 0, totalSales: agg?.totalSales || 0, ...(isSuperAdmin ? { totalProfit: agg?.totalProfit || 0 } : {}) };
        });

        report = { type: 'users', period: { startDate, endDate }, users: userStats.sort((a: any, b: any) => b.totalSales - a.totalSales) };
        break;
      }

      default:
        report = { type, message: 'Report type not found' };
    }

    return NextResponse.json({ report });
  } catch (error) {
    console.error('Get report error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const userId = await verifyAuthUser(authHeader);
    if (!userId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { data: user } = await db
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    if (!user || user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin' }, { status: 403 });
    }

    // Count all tables in parallel
    const tables = [
      'users', 'units', 'products', 'customers', 'suppliers', 'transactions',
      'transaction_items', 'payments', 'salary_payments', 'bank_accounts', 'cash_boxes',
      'finance_requests', 'fund_transfers', 'company_debts', 'receivables',
      'events', 'logs', 'sales_targets', 'settings', 'unit_products',
      'courier_cash', 'courier_handovers', 'receivable_follow_ups',
      'company_debt_payments', 'password_resets',
    ];

    const counts = await Promise.all(
      tables.map(async (table) => {
        const { count } = await db
          .from(table)
          .select('*', { count: 'exact', head: true });
        return { table, count: count || 0 };
      })
    );

    const tableMap: Record<string, number> = {};
    for (const { table, count } of counts) {
      tableMap[table] = count;
    }

    // Get total sales and profit from transactions
    const { data: salesTx } = await db
      .from('transactions')
      .select('total, total_profit')
      .eq('type', 'sale')
      .in('status', ['approved', 'paid']);
    const totalSales = (salesTx || []).reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalProfit = (salesTx || []).reduce((s: number, t: any) => s + (t.total_profit || 0), 0);

    // Total receivables outstanding
    const { data: unpaidTx } = await db
      .from('transactions')
      .select('remaining_amount')
      .gt('remaining_amount', 0);
    const totalReceivables = (unpaidTx || []).reduce((s: number, t: any) => s + (t.remaining_amount || 0), 0);

    return NextResponse.json({
      info: {
        database: 'Supabase (PostgreSQL)',
        tables: tableMap,
        summaries: {
          totalSales,
          totalProfit,
          totalReceivables,
        },
      },
    });
  } catch (error) {
    console.error('System info error:', error);
    return NextResponse.json({ error: 'Gagal mengambil info sistem' }, { status: 500 });
  }
}

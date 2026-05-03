import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { createLog } from '@/lib/supabase-helpers';
import { wsRefreshAll } from '@/lib/ws-dispatch';

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const { userId } = authResult;

    const data = await request.json();
    const { type } = data;

    if (!type || !['all', 'transactions', 'products', 'users'].includes(type)) {
      return NextResponse.json(
        { error: 'Tipe reset tidak valid. Pilih: all, transactions, products, users' },
        { status: 400 }
      );
    }

    // Log this destructive action
    createLog(db, {
      type: 'activity',
      userId,
      action: 'system_reset',
      message: `System reset: ${type}`
    });

    const results: { table: string; deleted: number }[] = [];

    // Delete in correct FK order
    if (type === 'all' || type === 'transactions') {
      const tables = [
        'customer_follow_ups', 'receivable_follow_ups', 'receivables',
        'transaction_items', 'payments', 'transactions'
      ];
      for (const table of tables) {
        const { count } = await db.from(table).delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
        results.push({ table, deleted: count || 0 });
      }
      // Reset customer stats
      await db.from('customers').update({ total_orders: 0, total_spent: 0, last_transaction_date: null }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    // Reset finance data when transactions are reset
    if (type === 'all' || type === 'transactions') {
      // Reset pool balances to 0 (HPP, Profit, Lain-lain)
      const poolKeys = ['pool_hpp_paid_balance', 'pool_profit_paid_balance', 'pool_investor_fund'];
      for (const key of poolKeys) {
        await db.from('settings').upsert({ key, value: '0' }, { onConflict: 'key' });
      }
      results.push({ table: 'pool_balances', deleted: 0 });

      // Reset bank account balances to 0
      const { count: bankCount } = await db
        .from('bank_accounts')
        .update({ balance: 0 })
        .gt('balance', 0);
      results.push({ table: 'bank_account_balances', deleted: bankCount || 0 });

      // Reset cash box balances to 0
      const { count: cashBoxCount } = await db
        .from('cash_boxes')
        .update({ balance: 0 })
        .gt('balance', 0);
      results.push({ table: 'cash_box_balances', deleted: cashBoxCount || 0 });

      // Delete finance requests that were linked to transactions (now orphaned)
      const { count: frCount } = await db
        .from('finance_requests')
        .delete({ count: 'exact' })
        .is('transaction_id', null);
      results.push({ table: 'orphaned_finance_requests', deleted: frCount || 0 });

      // Delete fund transfers
      const { count: ftCount } = await db
        .from('fund_transfers')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'fund_transfers', deleted: ftCount || 0 });

      // Delete company debt payments
      const { count: cdpCount } = await db
        .from('company_debt_payments')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'company_debt_payments', deleted: cdpCount || 0 });

      // Delete company debts
      const { count: cdCount } = await db
        .from('company_debts')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'company_debts', deleted: cdCount || 0 });

      // Reset courier cash
      await db.from('courier_cash').update({ balance: 0, total_collected: 0, total_handover: 0 });
      results.push({ table: 'courier_cash', deleted: 0 });

      // Delete courier handovers
      const { count: chCount } = await db
        .from('courier_handovers')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'courier_handovers', deleted: chCount || 0 });

      // Delete salary payments
      const { count: spCount } = await db
        .from('salary_payments')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'salary_payments', deleted: spCount || 0 });

      // Delete cashback logs
      const { count: clCount } = await db
        .from('cashback_log')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'cashback_logs', deleted: clCount || 0 });

      // Delete cashback withdrawals (except processed ones — keep audit trail)
      const { count: cwCount } = await db
        .from('cashback_withdrawal')
        .delete({ count: 'exact' })
        .in('status', ['pending', 'approved']);
      results.push({ table: 'pending_cashback_withdrawals', deleted: cwCount || 0 });

      // Clear finance ledger (audit trail — banking-grade reset)
      const { count: ledgerCount } = await db
        .from('finance_ledger')
        .delete({ count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'finance_ledger', deleted: ledgerCount || 0 });

      // Reset customer cashback balance to 0
      await db.from('customers').update({ cashback_balance: 0 }).gt('cashback_balance', 0);
      results.push({ table: 'customer_cashback_balances', deleted: 0 });
    }

    if (type === 'all' || type === 'products') {
      const { count: upCount } = await db.from('unit_products').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
      const { count: pCount } = await db.from('products').delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000');
      results.push({ table: 'unit_products', deleted: upCount || 0 });
      results.push({ table: 'products', deleted: pCount || 0 });
    }

    if (type === 'all' || type === 'users') {
      // Delete all non-super_admin users and related data
      const { data: nonAdminUsers } = await db
        .from('users')
        .select('id')
        .neq('role', 'super_admin');
      const nonAdminIds = (nonAdminUsers || []).map((u: any) => u.id);

      if (nonAdminIds.length > 0) {
        // Map each table to its correct FK column(s) referencing users
        const tableColumns: Record<string, string[]> = {
          'customer_follow_ups': ['created_by_id'],
          'receivable_follow_ups': ['created_by_id'],
          'company_debt_payments': ['created_by_id'],
          'company_debts': ['created_by_id'],
          'fund_transfers': ['created_by_id'],
          'bank_accounts': ['created_by_id'],
          'cash_boxes': ['created_by_id'],
          'salary_payments': ['user_id'],
          'finance_requests': ['request_by_id', 'processed_by_id'],
          'courier_handovers': ['processed_by_id'],
          'courier_cash': ['courier_id'],
          'events': ['user_id'],
          'logs': ['user_id'],
          'sales_targets': ['user_id'],
          'password_resets': ['user_id'],
        };
        for (const [table, columns] of Object.entries(tableColumns)) {
          for (const col of columns) {
            const { count } = await db.from(table).delete({ count: 'exact' }).in(col, nonAdminIds);
            if (count && count > 0) results.push({ table: `${table}(${col})`, deleted: count });
          }
        }
        const { count } = await db.from('users').delete({ count: 'exact' }).in('id', nonAdminIds);
        results.push({ table: 'users', deleted: count || 0 });
      }
    }

    // Force all connected clients to refresh — critical for cross-session consistency
    wsRefreshAll(`System reset: ${type}`).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Reset ${type} berhasil dilakukan`,
      details: results
    });
  } catch (error) {
    console.error('System reset error:', error);
    return NextResponse.json(
      { error: 'Gagal melakukan reset' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

// =====================================================================
// Cashback Withdrawals — Super Admin & Keuangan (Finance)
// GET /api/cashback/withdrawals — List all withdrawals
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authUserId || !['super_admin', 'keuangan'].includes(authUserId.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = db
      .from('cashback_withdrawal')
      .select(`
        *,
        customer:customers(id, name, phone, code),
        processed_by:users!processed_by_id(id, name),
        bank_account:bank_accounts(id, name, bank_name, account_no),
        cash_box:cash_boxes(id, name)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: withdrawals } = await query;

    // Summary stats
    const { data: allWithdrawals } = await db
      .from('cashback_withdrawal')
      .select('status, amount');

    const stats = {
      total: (allWithdrawals || []).length,
      totalPending: (allWithdrawals || []).filter((w: any) => w.status === 'pending').length,
      totalApproved: (allWithdrawals || []).filter((w: any) => w.status === 'approved').length,
      processedCount: (allWithdrawals || []).filter((w: any) => w.status === 'processed').length,
      rejectedCount: (allWithdrawals || []).filter((w: any) => w.status === 'rejected').length,
      totalPendingAmount: (allWithdrawals || []).filter((w: any) => w.status === 'pending').reduce((s: number, w: any) => s + w.amount, 0),
      totalProcessedAmount: (allWithdrawals || []).filter((w: any) => w.status === 'processed').reduce((s: number, w: any) => s + w.amount, 0),
    };

    return NextResponse.json({
      withdrawals: (withdrawals || []).map(w => ({
        ...toCamelCase(w),
        customer: toCamelCase(w.customer || null),
        processedBy: toCamelCase(w.processedBy || null),
        bankAccount: toCamelCase(w.bank_account || null),
        cashBox: toCamelCase(w.cash_box || null),
      })),
      stats,
    });
  } catch (error) {
    console.error('Cashback withdrawals GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

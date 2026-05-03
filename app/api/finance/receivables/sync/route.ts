import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toSnakeCase, generateId } from '@/lib/supabase-helpers';

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // FIX: Only finance role or super_admin can trigger sync
    const { data: authUser } = await db.from('users').select('role').eq('id', authUserId).single();
    if (!authUser || !['super_admin', 'keuangan'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Akses ditolak — hanya Super Admin atau Keuangan' }, { status: 403 });
    }

    // Find all sale transactions that are unpaid or partial without a receivable
    const { data: unpaidSales, error: txError } = await db.from('transactions').select('id, total, paid_amount, remaining_amount, due_date, created_by_id, customer_id').eq('type', 'sale').in('payment_status', ['unpaid', 'partial']).neq('status', 'cancelled').limit(2000);
    if (txError) throw txError;

    // FIX: Batch-fetch ALL customers needed (eliminate N+1)
    const customerIds = [...new Set((unpaidSales || []).map(t => t.customer_id).filter(Boolean))];
    let customerMap = new Map<string, { name: string; phone: string }>();
    if (customerIds.length > 0) {
      const { data: customers } = await db.from('customers').select('id, name, phone').in('id', customerIds);
      for (const c of (customers || [])) customerMap.set(c.id, { name: c.name, phone: c.phone || '' });
    }

    // Get existing receivable transaction IDs
    const { data: existingReceivables } = await db.from('receivables').select('transaction_id');
    const existingTxIds = new Set((existingReceivables || []).map((r: any) => r.transaction_id));

    let created = 0;
    for (const tx of unpaidSales) {
      if (existingTxIds.has(tx.id)) continue;
      const remaining = tx.total - tx.paid_amount;
      if (remaining <= 0) continue;

      // FIX: Use batch-fetched customer map instead of N+1 query
      const customer = customerMap.get(tx.customer_id);

      const insertData = toSnakeCase({
        id: generateId(),
        transactionId: tx.id,
        customerName: customer?.name || 'Walk-in',
        customerPhone: customer?.phone || '',
        totalAmount: tx.total,
        paidAmount: tx.paid_amount,
        remainingAmount: remaining,
        assignedToId: tx.created_by_id,
        priority: tx.due_date && new Date(tx.due_date) < new Date() ? 'high' : 'normal',
        status: 'active',
        overdueDays: 0,
        reminderCount: 0,
        version: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });

      const { error: insertError } = await db.from('receivables').insert(insertData);
      if (insertError) {
        // If unique constraint violation, update instead
        if (insertError.code === '23505') {
          await db.from('receivables').update({ paid_amount: tx.paid_amount, remaining_amount: remaining }).eq('transaction_id', tx.id);
        }
      } else {
        created++;
      }
    }

    // Sync existing receivables
    const { data: activeReceivables, error: arError } = await db.from('receivables').select('id, paid_amount, status, transaction_id').eq('status', 'active').limit(2000);
    if (arError) throw arError;

    // FIX: Batch-fetch transactions for sync (eliminate N+1)
    const syncTxIds = (activeReceivables || []).map(r => r.transaction_id).filter(Boolean);
    let txMap = new Map<string, { total: number; paid_amount: number }>();
    if (syncTxIds.length > 0) {
      const { data: txData } = await db.from('transactions').select('id, total, paid_amount, payment_status').in('id', syncTxIds);
      for (const tx of (txData || [])) txMap.set(tx.id, { total: tx.total, paid_amount: tx.paid_amount });
    }

    let synced = 0;
    for (const r of activeReceivables) {
      // FIX: Use batch-fetched tx map instead of N+1 query
      const tx = txMap.get(r.transaction_id);
      if (!tx) continue;

      if (tx.paid_amount >= tx.total && r.status === 'active') {
        await db.from('receivables').update({ paid_amount: tx.total, remaining_amount: 0, status: 'paid' }).eq('id', r.id);
        synced++;
      } else if (tx.paid_amount !== r.paid_amount) {
        await db.from('receivables').update({ paid_amount: tx.paid_amount, remaining_amount: tx.total - tx.paid_amount }).eq('id', r.id);
        synced++;
      }
    }

    return NextResponse.json({ created, synced, message: `${created} piutang baru dibuat, ${synced} diperbarui` });
  } catch (error) {
    console.error('Sync receivables error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

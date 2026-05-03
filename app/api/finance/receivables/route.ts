import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { rowsToCamelCase, toCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const assignedToId = searchParams.get('assignedToId');
    const overdueOnly = searchParams.get('overdue') === 'true';

    let query = db.from('receivables').select(`
      *,
      transaction:transactions(
        id, invoice_no, type, total, paid_amount, remaining_amount, payment_status, payment_method, due_date, transaction_date, status,
        customer:customers(id, name, phone, address),
        created_by:users!created_by_id(id, name, role),
        unit:units(id, name),
        items:transaction_items(*),
        payments:payments(*)
      ),
      assigned_to:users!assigned_to_id(id, name, role),
      follow_ups:receivable_follow_ups(*)
    `);

    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (assignedToId) query = query.eq('assigned_to_id', assignedToId);

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data: receivables, error } = await query;
    if (error) throw error;

    // Compute overdue days in real-time
    const now = new Date();
    const enrichedReceivables = rowsToCamelCase(receivables || []).map((r: any) => {
      const dueDate = r.transaction?.dueDate ? new Date(r.transaction.dueDate) : null;
      let overdueDays = 0;
      if (dueDate && r.status === 'active') {
        const diffMs = now.getTime() - dueDate.getTime();
        overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }
      return { ...r, overdueDays };
    });

    // Sort in-memory
    enrichedReceivables.sort((a: any, b: any) => {
      const priorityOrder: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
      const pDiff = (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
      if (pDiff !== 0) return pDiff;
      const dDiff = b.overdueDays - a.overdueDays;
      if (dDiff !== 0) return dDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const filtered = overdueOnly ? enrichedReceivables.filter((r: any) => r.overdueDays > 0) : enrichedReceivables;

    const allActive = enrichedReceivables.filter((r: any) => r.status === 'active');
    const totalReceivable = allActive.reduce((sum: number, r: any) => sum + r.remainingAmount, 0);
    const overdueItems = allActive.filter((r: any) => r.overdueDays > 0);
    const totalOverdue = overdueItems.reduce((sum: number, r: any) => sum + r.remainingAmount, 0);
    const unassigned = allActive.filter((r: any) => !r.assignedToId);

    return NextResponse.json({
      receivables: filtered,
      stats: { totalReceivable, totalOverdue, activeCount: allActive.length, overdueCount: overdueItems.length, unassignedCount: unassigned.length },
    });
  } catch (error) {
    console.error('Get receivables error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const authUserId = authResult.userId;

    const data = await request.json();

    if (data.transactionId) {
      const { data: existing } = await db.from('receivables').select('id').eq('transaction_id', data.transactionId).maybeSingle();
      if (existing) {
        return NextResponse.json({ error: 'Piutang untuk invoice ini sudah ada' }, { status: 400 });
      }

      const { data: transaction } = await db.from('transactions').select('*, customer:customers(id, name, phone)').eq('id', data.transactionId).single();
      if (!transaction) {
        return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
      }

      const now = new Date().toISOString();
      const insertData = toSnakeCase({
        id: generateId(),
        transactionId: data.transactionId,
        customerName: transaction.customer?.name || 'Walk-in',
        customerPhone: transaction.customer?.phone || '',
        totalAmount: transaction.total,
        paidAmount: transaction.paid_amount,
        remainingAmount: transaction.remaining_amount,
        assignedToId: data.assignedToId || null,
        priority: data.priority || 'normal',
        notes: data.notes || '',
        createdById: authUserId,
        createdAt: now, updatedAt: now,
      });

      const { data: receivable, error } = await db.from('receivables').insert(insertData).select(`
        *,
        transaction:transactions(id, invoice_no, customer:customers(id, name), created_by:users!created_by_id(id, name, role), unit:units(id, name)),
        assigned_to:users!assigned_to_id(id, name, role)
      `).single();
      if (error) throw error;

      return NextResponse.json({ receivable: toCamelCase(receivable) });
    }

    return NextResponse.json({ error: 'ID transaksi wajib diisi untuk membuat piutang' }, { status: 400 });
  } catch (error) {
    console.error('Create receivable error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

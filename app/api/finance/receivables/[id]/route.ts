import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, toSnakeCase, createLog } from '@/lib/supabase-helpers';
import { enforceFinanceRole } from '@/lib/require-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data: receivable, error } = await db.from('receivables').select(`
      *,
      transaction:transactions(
        id, invoice_no, type, total, paid_amount, remaining_amount, payment_status, payment_method, due_date, transaction_date, status,
        customer:customers(id, name, phone, address),
        created_by:users!created_by_id(id, name, role),
        unit:units(id, name),
        items:transaction_items(*),
        payments:payments(*, received_by:users!received_by_id(id, name))
      ),
      assigned_to:users!assigned_to_id(id, name, role),
      follow_ups:receivable_follow_ups(*)
    `).eq('id', id).single();

    if (error || !receivable) {
      return NextResponse.json({ error: 'Piutang tidak ditemukan' }, { status: 404 });
    }

    const now = new Date();
    const dueDate = (receivable as any).transaction?.due_date
      ? new Date((receivable as any).transaction.due_date)
      : null;
    let overdueDays = 0;
    if (dueDate && receivable.status === 'active') {
      const diffMs = now.getTime() - dueDate.getTime();
      overdueDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }

    const mapped = toCamelCase(receivable) as any;
    mapped.overdueDays = overdueDays;

    return NextResponse.json({ receivable: mapped });
  } catch (error: any) {
    console.error('Get receivable error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const authUserId = authResult.userId;

    const { id } = await params;
    const data = await request.json();

    const { data: existing, error: fetchError } = await db.from('receivables').select('*, transaction:transactions(id, invoice_no, total, paid_amount, remaining_amount)').eq('id', id).single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Piutang tidak ditemukan' }, { status: 404 });
    }

    const updateData: Record<string, any> = {};

    if (data.assignedToId !== undefined) updateData.assigned_to_id = data.assignedToId;
    if (data.priority !== undefined) updateData.priority = data.priority;
    if (data.status !== undefined) {
      const VALID_STATUSES = ['active', 'paid', 'cancelled', 'bad_debt'];
      if (!VALID_STATUSES.includes(data.status)) {
        return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
      }
      updateData.status = data.status;
    }
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.nextFollowUpDate !== undefined) {
      updateData.next_follow_up_date = data.nextFollowUpDate ? new Date(data.nextFollowUpDate).toISOString() : null;
    }

    // Sync amounts from transaction
    if (data.syncAmounts && existing.transaction) {
      const tx = existing.transaction;
      updateData.paid_amount = tx.paid_amount;
      updateData.remaining_amount = tx.remaining_amount;
      if (tx.paid_amount >= tx.total) {
        updateData.status = 'paid';
      } else if (tx.paid_amount > 0) {
        updateData.status = 'active';
      }
    }

    const { data: receivable, error } = await db.from('receivables').update(updateData).eq('id', id).select(`
      *,
      transaction:transactions(id, invoice_no, customer:customers(id, name), created_by:users!created_by_id(id, name, role), unit:units(id, name)),
      assigned_to:users!assigned_to_id(id, name, role)
    `).single();
    if (error) throw error;

    createLog(db, {
      type: 'activity',
      userId: authUserId,  // Use authenticated user, not user-supplied data.updatedById
      action: 'receivable_updated',
      entity: 'receivable',
      entityId: id,
      message: `Piutang ${existing.transaction?.invoice_no} diupdate: ${Object.keys(updateData).join(', ')}`,
    });

    return NextResponse.json({ receivable: toCamelCase(receivable) });
  } catch (error: any) {
    console.error('Update receivable error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const authUserId = authResult.userId;

    const { id } = await params;

    const { data: existing } = await db.from('receivables').select('id').eq('id', id).maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: 'Piutang tidak ditemukan' }, { status: 404 });
    }

    await db.from('receivable_follow_ups').delete().eq('receivable_id', id);
    const { error } = await db.from('receivables').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete receivable error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

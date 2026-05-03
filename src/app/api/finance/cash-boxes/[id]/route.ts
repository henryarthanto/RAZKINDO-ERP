import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase } from '@/lib/supabase-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    const data = await request.json();

    const { data: cashBox, error: fetchError } = await db.from('cash_boxes').select('*').eq('id', id).single();
    if (fetchError || !cashBox) {
      return NextResponse.json({ error: 'Brankas tidak ditemukan' }, { status: 404 });
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.unitId !== undefined) updateData.unit_id = data.unitId || null;
    if (data.balance !== undefined) {
      if (authResult.user.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden - Hanya Super Admin yang dapat mengubah saldo brankas' }, { status: 403 });
      }
      updateData.balance = Math.max(0, data.balance);
    }
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    const { data: updated, error } = await db.from('cash_boxes').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ cashBox: toCamelCase(updated) });
  } catch (error: any) {
    console.error('Update cash box error:', error);
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

    const { id } = await params;

    const { data: cashBox, error: fetchError } = await db.from('cash_boxes').select('*').eq('id', id).single();
    if (fetchError || !cashBox) {
      return NextResponse.json({ error: 'Brankas tidak ditemukan' }, { status: 404 });
    }

    if (cashBox.balance > 0) {
      return NextResponse.json(
        { error: 'Tidak dapat menghapus brankas yang masih memiliki saldo. Saldo saat ini: Rp ' + cashBox.balance.toLocaleString('id-ID') },
        { status: 400 }
      );
    }

    const { count: activeRequests } = await db.from('finance_requests').select('*', { count: 'exact', head: true }).eq('cash_box_id', id).in('status', ['pending', 'approved']);
    const { count: activeSalaries } = await db.from('salary_payments').select('*', { count: 'exact', head: true }).eq('cash_box_id', id).in('status', ['pending', 'approved']);
    const { count: activeTransfers } = await db.from('fund_transfers').select('*', { count: 'exact', head: true }).eq('from_cash_box_id', id).eq('status', 'pending');

    if ((activeRequests || 0) > 0 || (activeSalaries || 0) > 0 || (activeTransfers || 0) > 0) {
      return NextResponse.json(
        { error: 'Tidak dapat menghapus brankas yang masih digunakan dalam request aktif' },
        { status: 400 }
      );
    }

    const { error } = await db.from('cash_boxes').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete cash box error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

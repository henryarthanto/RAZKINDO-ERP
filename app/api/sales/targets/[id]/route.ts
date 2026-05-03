import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { toCamelCase } from '@/lib/supabase-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const { id } = await params;
    const data = await request.json();

    const { data: existing, error: fetchError } = await db.from('sales_targets').select(`
      *, user:users!user_id(name, email)
    `).eq('id', id).single();

    if (fetchError || !existing) return NextResponse.json({ error: 'Target penjualan tidak ditemukan' }, { status: 404 });
    if (existing.status === 'expired') return NextResponse.json({ error: 'Target yang sudah expired tidak dapat diubah' }, { status: 400 });

    const updateData: Record<string, any> = {};
    if (data.targetAmount !== undefined) {
      if (typeof data.targetAmount !== 'number' || data.targetAmount <= 0) return NextResponse.json({ error: 'targetAmount harus berupa angka dan lebih dari 0' }, { status: 400 });
      updateData.target_amount = data.targetAmount;
    }
    if (data.status !== undefined) {
      const validStatuses = ['active', 'completed', 'expired'];
      if (!validStatuses.includes(data.status)) return NextResponse.json({ error: 'Status harus salah satu dari: active, completed, expired' }, { status: 400 });
      updateData.status = data.status;
    }
    if (data.achievedAmount !== undefined) {
      if (typeof data.achievedAmount !== 'number' || data.achievedAmount < 0) return NextResponse.json({ error: 'achievedAmount harus berupa angka dan tidak kurang dari 0' }, { status: 400 });
      updateData.achieved_amount = data.achievedAmount;
    }
    if (data.notes !== undefined) updateData.notes = data.notes;

    const { data: target, error } = await db.from('sales_targets').update(updateData).eq('id', id).select(`
      *, user:users!user_id(name, email)
    `).single();
    if (error) throw error;

    return NextResponse.json({ target: toCamelCase(target) });
  } catch (error) {
    console.error('Update sales target error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const { id } = await params;

    const { data: existing } = await db.from('sales_targets').select('status').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Target penjualan tidak ditemukan' }, { status: 404 });
    if (existing.status !== 'active') return NextResponse.json({ error: 'Hanya target dengan status active yang dapat dihapus' }, { status: 400 });

    const { error } = await db.from('sales_targets').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete sales target error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

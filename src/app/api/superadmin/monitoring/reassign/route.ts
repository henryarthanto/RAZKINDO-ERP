import { db } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAndGetAuthUser } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';

/**
 * POST /api/superadmin/monitoring/reassign
 * Superadmin endpoint to reassign a customer to a different sales person.
 */
export async function POST(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (result.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — only super admin' }, { status: 403 });
    }

    const body = await request.json();
    const { customerId, newAssignedToId, reason } = body;

    if (!customerId) {
      return NextResponse.json({ error: 'customerId wajib diisi' }, { status: 400 });
    }
    if (reason && reason.length > 1000) {
      return NextResponse.json({ error: 'Alasan terlalu panjang (maks 1000 karakter)' }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await db.from('customers').select(`
      id, name, assigned_to_id, assigned_to:users!assigned_to_id(id, name)
    `).eq('id', customerId).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) {
      return NextResponse.json({ error: 'Pelanggan tidak ditemukan' }, { status: 404 });
    }

    let newSalesName = 'Tidak ada';
    if (newAssignedToId) {
      const { data: newSales } = await db.from('users').select('id, name, role').eq('id', newAssignedToId).maybeSingle();
      if (!newSales) {
        return NextResponse.json({ error: 'Sales tujuan tidak ditemukan' }, { status: 404 });
      }
      if (newSales.role !== 'sales' && newSales.role !== 'super_admin') {
        return NextResponse.json({ error: 'Target user bukan sales' }, { status: 400 });
      }
      newSalesName = newSales.name;
    }

    const oldSalesName = (existing as any).assigned_to?.name || 'Tidak ada';

    const { data: customer, error: updateError } = await db.from('customers').update({
      assigned_to_id: newAssignedToId || null,
    }).eq('id', customerId).select(`
      *, unit:units(id, name), assigned_to:users!assigned_to_id(id, name, email)
    `).single();

    if (updateError) throw updateError;

    createLog(db, {
      type: 'audit',
      userId: result.userId,
      action: 'customer_reassigned_by_superadmin',
      entity: 'Customer',
      entityId: customerId,
      payload: JSON.stringify({
        oldAssignedToId: existing.assigned_to_id,
        newAssignedToId: newAssignedToId || null,
        oldSalesName, newSalesName, reason: reason || ''
      }),
      message: `SUPERADMIN: Pelanggan ${customer.name} dialihkan dari ${oldSalesName} ke ${newSalesName}${reason ? `. Alasan: ${reason}` : ''}`
    });

    return NextResponse.json({
      success: true, customer: toCamelCase(customer),
      message: `Pelanggan berhasil dialihkan dari ${oldSalesName} ke ${newSalesName}`
    });
  } catch (error: any) {
    console.error('[REASSIGN_CUSTOMER] Error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

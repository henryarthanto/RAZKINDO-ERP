import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { wsCustomerUpdate } from '@/lib/ws-dispatch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check: only super_admin or sales (own customers) can mark as lost
    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authUserCamel.role !== 'super_admin' && authUserCamel.role !== 'sales') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { reason } = body;

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json(
        { error: 'Alasan kehilangan pelanggan wajib diisi' },
        { status: 400 }
      );
    }

    // Verify customer exists
    const { data: existingCustomer } = await db
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (!existingCustomer) {
      return NextResponse.json(
        { error: 'Pelanggan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Mark customer as lost
    const { data: customer } = await db
      .from('customers')
      .update({
        status: 'lost',
        lost_at: new Date().toISOString(),
        lost_reason: reason.trim()
      })
      .eq('id', id)
      .select(`
        *,
        unit:units(*),
        assigned_to:users!assigned_to_id(id, name, email)
      `)
      .single();

    const customerCamel = toCamelCase(customer);

    // Log the lost action (fire-and-forget)
    createLog(db, {
      type: 'activity',
      action: 'customer_marked_lost',
      entity: 'Customer',
      entityId: id,
      payload: JSON.stringify({ reason: reason.trim() }),
      message: `Pelanggan ${customerCamel.name} ditandai sebagai lost. Alasan: ${reason.trim()}`
    });

    wsCustomerUpdate({ unitId: customerCamel.unitId });
    return NextResponse.json({
      success: true,
      customer: { ...customerCamel, assignedTo: customerCamel.assignedTo || null }
    });
  } catch (error: any) {
    console.error('Customer mark lost error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

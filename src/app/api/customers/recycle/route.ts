import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { wsCustomerUpdate } from '@/lib/ws-dispatch';

export async function POST(request: NextRequest) {
  try {
    // Auth check - only super_admin can recycle customers
    const auth = await enforceSuperAdmin(request);
    if (!auth.success) return auth.response;
    const authUserId = auth.userId;

    const body = await request.json();
    const { customerId } = body;

    if (!customerId || typeof customerId !== 'string') {
      return NextResponse.json(
        { error: 'ID pelanggan wajib diisi' },
        { status: 400 }
      );
    }

    // Verify customer exists and is currently lost
    const { data: existingCustomer } = await db
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (!existingCustomer) {
      return NextResponse.json(
        { error: 'Pelanggan tidak ditemukan' },
        { status: 404 }
      );
    }
    const existingCustomerCamel = toCamelCase(existingCustomer);

    if (existingCustomerCamel.status !== 'lost') {
      return NextResponse.json(
        { error: 'Hanya pelanggan dengan status lost yang dapat di-recycle' },
        { status: 400 }
      );
    }

    // Recycle customer back to active
    const { data: customer } = await db
      .from('customers')
      .update({
        status: 'active',
        lost_at: null,
        lost_reason: null
      })
      .eq('id', customerId)
      .select(`
        *,
        unit:units(*),
        assigned_to:users!assigned_to_id(id, name, email)
      `)
      .single();

    const customerCamel = toCamelCase(customer);

    // Log the recycle action (fire-and-forget)
    createLog(db, {
      type: 'activity',
      action: 'customer_recycled',
      entity: 'Customer',
      entityId: customerId,
      payload: JSON.stringify({
        previousLostReason: existingCustomerCamel.lostReason,
        previousLostAt: existingCustomerCamel.lostAt
      }),
      message: `Pelanggan ${customerCamel.name} di-recycle kembali menjadi active`
    });

    wsCustomerUpdate({ unitId: customerCamel.unitId });
    return NextResponse.json({
      success: true,
      customer: { ...customerCamel, assignedTo: customerCamel.assignedTo || null }
    });
  } catch (error: any) {
    console.error('Customer recycle error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

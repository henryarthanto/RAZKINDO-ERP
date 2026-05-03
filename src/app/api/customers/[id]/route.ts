import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { wsCustomerUpdate } from '@/lib/ws-dispatch';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Single query: verify token + get user with role
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true, id: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user: authUser } = result;
    const { id } = await params;
    const data = await request.json();

    const { data: existing } = await db
      .from('customers')
      .select(`
        *,
        assigned_to:users!assigned_to_id(id, name)
      `)
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Pelanggan tidak ditemukan' }, { status: 404 });
    }
    const existingCamel = toCamelCase(existing);

    // Role-based edit restrictions
    // - super_admin: can edit everything
    // - sales: can only edit their own assigned customers (basic fields only)
    // - keuangan: can edit basic fields
    if (authUser.role === 'kurir') {
      return NextResponse.json({ error: 'Kurir tidak memiliki akses edit pelanggan' }, { status: 403 });
    }
    if (authUser.role === 'sales' && existingCamel.assignedToId !== authUser.id) {
      return NextResponse.json({ error: 'Sales hanya bisa edit pelanggan yang ditugaskan' }, { status: 403 });
    }

    // Authorization: only super_admin can change status or cashback settings, or reassign customers
    if (data.assignedToId !== undefined && data.assignedToId !== existingCamel.assignedToId) {
      if (authUser.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden — hanya super admin yang bisa mengalihkan pelanggan' }, { status: 403 });
      }
    }
    if (data.status !== undefined && authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — hanya super admin yang bisa mengubah status pelanggan' }, { status: 403 });
    }
    if ((data.cashbackType !== undefined || data.cashbackValue !== undefined) && authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — hanya super admin yang bisa mengubah cashback' }, { status: 403 });
    }

    if (data.status !== undefined) {
      const validStatuses = ['active', 'lost', 'inactive'];
      if (!validStatuses.includes(data.status)) {
        return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
      }
    }

    // Single query: validate target user role AND get name for logging
    let targetUser: { role: string; name: string } | null = null;
    if (data.assignedToId && data.assignedToId !== '') {
      const { data: target } = await db
        .from('users')
        .select('role, name')
        .eq('id', data.assignedToId)
        .single();
      targetUser = toCamelCase(target);
      if (!targetUser || (targetUser.role !== 'sales' && targetUser.role !== 'super_admin')) {
        return NextResponse.json({ error: 'Target user bukan sales' }, { status: 400 });
      }
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.distance !== undefined) updateData.distance = data.distance;
    if (data.assignedToId !== undefined) updateData.assigned_to_id = data.assignedToId === '' ? null : data.assignedToId;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.cashbackType !== undefined) updateData.cashback_type = data.cashbackType;
    if (data.cashbackValue !== undefined) updateData.cashback_value = data.cashbackValue;

    const { data: customer } = await db
      .from('customers')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        unit:units(*),
        assigned_to:users!assigned_to_id(id, name, email)
      `)
      .single();

    const customerCamel = toCamelCase(customer);

    // Log reassignment if assignedToId changed
    if (data.assignedToId !== undefined && existingCamel.assignedToId !== updateData.assigned_to_id) {
      const oldSalesName = existingCamel.assignedTo?.name || 'Tidak ada';
      const newSalesName = targetUser?.name || 'Tidak ada';

      createLog(db, {
        type: 'audit',
        action: 'customer_reassigned',
        entity: 'Customer',
        entityId: id,
        payload: JSON.stringify({
          oldAssignedToId: existingCamel.assignedToId,
          newAssignedToId: data.assignedToId === '' ? null : data.assignedToId,
          oldSalesName, newSalesName
        }),
        message: `Pelanggan ${customerCamel.name} dialihkan dari ${oldSalesName} ke ${newSalesName}`
      });
    }

    wsCustomerUpdate({ unitId: customerCamel.unitId });
    return NextResponse.json({ customer: { ...customerCamel, assignedTo: customerCamel.assignedTo || null } });
  } catch (error: any) {
    console.error('Update customer error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin can delete/deactivate customers
    if (result.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya super admin yang bisa menghapus pelanggan' }, { status: 403 });
    }

    const { id } = await params;

    const { data: existing } = await db
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Pelanggan tidak ditemukan' }, { status: 404 });
    }

    await db
      .from('customers')
      .update({
        status: 'inactive',
        lost_at: new Date().toISOString(),
        lost_reason: 'Dihapus oleh pengguna'
      })
      .eq('id', id);

    wsCustomerUpdate({ unitId: existing.unit_id });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete customer error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

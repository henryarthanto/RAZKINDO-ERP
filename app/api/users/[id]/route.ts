import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, generateId } from '@/lib/supabase-helpers';
import bcrypt from 'bcryptjs';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { invalidateUserAuthCache } from '@/lib/token';

const VALID_ROLES = ['super_admin', 'sales', 'kurir', 'keuangan', 'gudang'];
const VALID_STATUSES = ['pending', 'approved', 'rejected'];

// ============ HELPER: Reassign sales data to super_admin ============
async function reassignSalesData(salesId: string): Promise<{ reassignedCustomers: number; reassignedOrders: number }> {
  // Find an active super_admin to take over
  const { data: superAdmins } = await db
    .from('users')
    .select('id')
    .eq('role', 'super_admin')
    .eq('is_active', true)
    .limit(1);
  const superAdminId = superAdmins?.[0]?.id;
  if (!superAdminId) return { reassignedCustomers: 0, reassignedOrders: 0 };

  // Reassign all customers from this sales to super_admin
  const { count: customerCount } = await db
    .from('customers')
    .update({ assigned_to_id: superAdminId })
    .eq('assigned_to_id', salesId);

  // Reassign pending PWA orders (not yet approved) from this sales to super_admin
  const { count: orderCount } = await db
    .from('transactions')
    .update({ created_by_id: superAdminId })
    .eq('created_by_id', salesId)
    .eq('status', 'pending');

  return {
    reassignedCustomers: customerCount || 0,
    reassignedOrders: orderCount || 0,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    const data = await request.json();

    const { data: existing } = await db
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
    }
    const existingCamel = toCamelCase(existing);

    const updateData: Record<string, any> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.role !== undefined) {
      if (!VALID_ROLES.includes(data.role)) {
        return NextResponse.json({ error: 'Role tidak valid' }, { status: 400 });
      }
      updateData.role = data.role;
    }
    if (data.unitId !== undefined) updateData.unit_id = data.unitId || null;
    if (data.status !== undefined) {
      if (!VALID_STATUSES.includes(data.status)) {
        return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
      }
      updateData.status = data.status;
    }
    if (data.nearCommission !== undefined) {
      const val = Number(data.nearCommission);
      if (isNaN(val)) return NextResponse.json({ error: 'nearCommission harus berupa angka' }, { status: 400 });
      updateData.near_commission = val;
    }
    if (data.farCommission !== undefined) {
      const val = Number(data.farCommission);
      if (isNaN(val)) return NextResponse.json({ error: 'farCommission harus berupa angka' }, { status: 400 });
      updateData.far_commission = val;
    }
    if (data.isActive !== undefined) {
      if (data.isActive === false && existingCamel.role === 'super_admin') {
        const { count } = await db
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'super_admin')
          .eq('is_active', true)
          .neq('id', id);
        if (count === 0) {
          return NextResponse.json(
            { error: 'Tidak dapat menonaktifkan Super Admin terakhir' },
            { status: 400 }
          );
        }
      }
      updateData.is_active = data.isActive;
    }

    // When deactivating a sales user, reassign their customers to super_admin
    let reassignResult: { reassignedCustomers: number; reassignedOrders: number } | null = null;
    if (data.isActive === false && existingCamel.role === 'sales' && existingCamel.isActive) {
      reassignResult = await reassignSalesData(id);
    }

    if (data.password !== undefined) {
      if (typeof data.password !== 'string' || data.password.length < 6) {
        return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(data.password, 12);
    }

    const { data: user } = await db
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select('*, unit:units(*)')
      .single();

    const userCamel = toCamelCase(user);

    // Handle multi-unit assignment (unitIds)
    if (data.unitIds !== undefined) {
      const selectedUnitIds: string[] = Array.isArray(data.unitIds)
        ? data.unitIds.filter((uid: string) => uid && uid.trim())
        : [];

      try {
        // Delete existing user_units for this user
        await db.from('user_units').delete().eq('user_id', id);

        // Insert new ones
        if (selectedUnitIds.length > 0) {
          const now = new Date().toISOString();
          const rows = selectedUnitIds.map((unitId: string) => ({
            user_id: id,
            unit_id: unitId,
          }));
          await db.from('user_units').insert(rows.map((r: any) => ({ id: generateId(), ...r, created_at: now })));

          // Also update primary unit_id to first unit for backward compat
          await db.from('users').update({ unit_id: selectedUnitIds[0] }).eq('id', id);
        } else {
          // Clear primary unit_id if no units selected
          await db.from('users').update({ unit_id: null }).eq('id', id);
        }
      } catch (uuErr: any) {
        console.warn('[UpdateUser] user_units update failed:', uuErr.message);
      }
    }

    // Invalidate auth cache when status or isActive changes
    if (data.status !== undefined || data.isActive !== undefined) {
      invalidateUserAuthCache(id);
    }

    // Fetch user units for response
    let userUnits: any[] = [];
    try {
      const { data: uuData } = await db
        .from('user_units')
        .select('*, unit:units(*)')
        .eq('user_id', id);
      if (uuData) {
        userUnits = rowsToCamelCase(uuData).map((uu: any) => uu.unit);
      }
    } catch {}

    const { password: _, ...userWithoutPassword } = userCamel!;

    return NextResponse.json({
      user: {
        ...userWithoutPassword,
        userUnits,
      },
      ...(reassignResult ? { reassigned: reassignResult } : {}),
    });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
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

    const { data: existing } = await db
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
    }
    const existingCamel = toCamelCase(existing);

    // Cannot delete active super_admin (must be the last one check)
    if (existingCamel.role === 'super_admin' && existingCamel.isActive) {
      const { count } = await db
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true)
        .neq('id', id);
      if (count === 0) {
        return NextResponse.json(
          { error: 'Tidak dapat menghapus Super Admin terakhir' },
          { status: 400 }
        );
      }
    }

    // Reassign sales data (customers + pending orders) to super_admin
    let reassigned: { reassignedCustomers: number; reassignedOrders: number } | null = null;
    if (existingCamel.role === 'sales') {
      reassigned = await reassignSalesData(id);
    }

    // Cancel active sales tasks assigned to this user
    await db
      .from('sales_tasks')
      .update({ status: 'cancelled' })
      .eq('assigned_to_id', id)
      .in('status', ['pending', 'in_progress']);

    // Delete user_units
    await db.from('user_units').delete().eq('user_id', id);

    // Hard delete the user
    await db.from('users').delete().eq('id', id);

    invalidateUserAuthCache(id);

    return NextResponse.json({
      success: true,
      deletedUser: existingCamel.name,
      ...(reassigned ? { reassigned } : {}),
    });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

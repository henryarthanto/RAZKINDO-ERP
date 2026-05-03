import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';

// Helper: enforce super_admin or keuangan role (mirrors /api/suppliers POST)
async function enforceSupplierRole(authUserId: string): Promise<{ authorized: boolean; response?: NextResponse }> {
  const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
  if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
    return { authorized: false, response: NextResponse.json({ error: 'Akses ditolak' }, { status: 403 }) };
  }
  if (!['super_admin', 'keuangan'].includes(authUser.role)) {
    return { authorized: false, response: NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat mengubah supplier' }, { status: 403 }) };
  }
  return { authorized: true };
}

// Get single supplier
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
    const { data: supplier } = await db
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (!supplier) {
      return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
    }
    
    return NextResponse.json({ supplier: toCamelCase(supplier) });
  } catch (error: any) {
    console.error('Get supplier error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// Update supplier
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = await enforceSupplierRole(authUserId);
    if (!roleCheck.authorized) return roleCheck.response!;

    const { id } = await params;
    const data = await request.json();

    const { data: existing } = await db
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
    }

    const updateData: Record<string, any> = {
      name: data.name !== undefined ? data.name : existing.name,
      phone: data.phone !== undefined ? data.phone : existing.phone,
      email: data.email !== undefined ? data.email : existing.email,
      address: data.address !== undefined ? data.address : existing.address,
      bank_name: data.bankName !== undefined ? data.bankName : existing.bank_name,
      bank_account: data.bankAccount !== undefined ? data.bankAccount : existing.bank_account,
      notes: data.notes !== undefined ? data.notes : existing.notes,
      is_active: data.isActive !== undefined ? data.isActive : existing.is_active,
    };

    const { data: supplier } = await db
      .from('suppliers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    const supplierCamel = toCamelCase(supplier);

    createLog(db, {
      type: 'activity',
      action: 'supplier_updated',
      entity: 'supplier',
      entityId: id,
      message: `Supplier ${supplierCamel.name} diupdate`
    });

    return NextResponse.json({ supplier: supplierCamel });
  } catch (error: any) {
    console.error('Update supplier error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// Delete supplier (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleCheck = await enforceSupplierRole(authUserId);
    if (!roleCheck.authorized) return roleCheck.response!;

    const { id } = await params;

    const { data: existing } = await db
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 404 });
    }

    // Check if supplier has active purchases
    const { count: activePurchases } = await db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('supplier_id', id)
      .in('payment_status', ['unpaid', 'partial']);

    if (activePurchases && activePurchases > 0) {
      return NextResponse.json(
        { error: `Supplier tidak bisa dihapus karena masih memiliki ${activePurchases} pembelian yang belum lunas` },
        { status: 400 }
      );
    }

    // Soft delete
    const { data: supplier } = await db
      .from('suppliers')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single();

    const supplierCamel = toCamelCase(supplier);

    createLog(db, {
      type: 'activity',
      action: 'supplier_deleted',
      entity: 'supplier',
      entityId: id,
      message: `Supplier ${supplierCamel.name} dihapus`
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete supplier error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, createLog, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { validateBody, validateQuery, supplierSchemas, commonSchemas } from '@/lib/validators';

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryValidation = validateQuery(commonSchemas.pagination, searchParams);
    if (!queryValidation.success) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }

    const { data: suppliers } = await db
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(500);

    return NextResponse.json({ suppliers: rowsToCamelCase(suppliers || []) });
  } catch (error: any) {
    console.error('Get suppliers error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin or keuangan can create suppliers
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat menambahkan supplier' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validation = validateBody(supplierSchemas.create, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    const { data: supplier } = await db
      .from('suppliers')
      .insert({
        id: generateId(),
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        bank_name: data.bankName,
        bank_account: data.bankAccount,
        notes: data.notes,
        total_purchase: 0,
        total_paid: 0,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    const supplierCamel = toCamelCase(supplier);

    // Create log (fire-and-forget)
    createLog(db, {
      type: 'activity',
      action: 'supplier_created',
      entity: 'supplier',
      entityId: supplierCamel.id,
      message: `Supplier ${supplierCamel.name} created`
    });

    return NextResponse.json({ supplier: supplierCamel });
  } catch (error: any) {
    console.error('Create supplier error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

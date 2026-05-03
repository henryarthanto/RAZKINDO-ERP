import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, generateId, generateCustomerCode } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { wsCustomerUpdate } from '@/lib/ws-dispatch';
import { validateBody, validateQuery, customerSchemas, commonSchemas } from '@/lib/validators';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId: authUserId, user: authUser } = authResult;

    const { searchParams } = new URL(request.url);
    const queryValidation = validateQuery(commonSchemas.pagination, searchParams);
    if (!queryValidation.success) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }
    const unitId = searchParams.get('unitId');
    const assignedToId = searchParams.get('assignedToId');
    const status = searchParams.get('status');

    let query = db
      .from('customers')
      .select(`
        *,
        unit:units(*),
        assigned_to:users!assigned_to_id(id, name, email)
      `);

    if (unitId) query = query.eq('unit_id', unitId);
    // Sales users see all customers in their unit, but sensitive fields are stripped for non-owned ones
    if (authUser?.role === 'sales') {
      // No filter — sales see all customers; restriction happens below
    } else {
      if (assignedToId) query = query.eq('assigned_to_id', assignedToId);
    }
    if (status) {
      query = query.eq('status', status);
    } else {
      // By default, exclude lost/inactive customers unless specifically requested
      query = query.neq('status', 'lost');
    }

    const { data: customers } = await query
      .order('name', { ascending: true })
      .limit(100);

    // Map snake_case to camelCase and remap the assigned_to key to assignedTo
    const isSalesUser = authUser?.role === 'sales';
    const customersCamel = (customers || []).map((c: any) => {
      const camel = toCamelCase(c);
      const isOwnCustomer = isSalesUser ? (camel.assignedToId === authUserId) : true;

      if (!isOwnCustomer) {
        // Non-owned customer: only expose name + assigned sales
        return {
          id: camel.id,
          name: camel.name,
          status: camel.status,
          distance: camel.distance,
          assignedToId: camel.assignedToId,
          assignedTo: camel.assignedTo || null,
          restricted: true,
        };
      }

      return {
        ...camel,
        assignedTo: camel.assignedTo || null,
        restricted: false,
      };
    });

    return NextResponse.json({ customers: customersCamel });
  } catch (error) {
    console.error('Get customers error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { userId: authUserId, user: authUser } = authResult;
    // Role check: only super_admin and sales can create customers
    if (authUser.role !== 'super_admin' && authUser.role !== 'sales') {
      return NextResponse.json({ error: 'Hanya super admin dan sales yang bisa menambah pelanggan' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validation = validateBody(customerSchemas.create, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    // ========== DUPLICATE CHECK ==========
    // Check by name within same unit
    let dupQuery = db
      .from('customers')
      .select('id, name, phone, assigned_to:users!assigned_to_id(id, name)')
      .eq('unit_id', data.unitId)
      .eq('name', data.name.trim())
      .neq('status', 'inactive');

    // If phone provided, also match by phone
    if (data.phone && data.phone.trim()) {
      // Check name OR phone match
      const { data: dupByName } = await dupQuery;
      const { data: dupByPhone } = await db
        .from('customers')
        .select('id, name, phone, assigned_to:users!assigned_to_id(id, name)')
        .eq('unit_id', data.unitId)
        .eq('phone', data.phone.trim())
        .neq('status', 'inactive');

      const dups = [...(dupByName || []), ...(dupByPhone || [])];
      // Deduplicate by id
      const seen = new Set<string>();
      const uniqueDups = dups.filter((d: any) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      if (uniqueDups.length > 0) {
        const dup = toCamelCase(uniqueDups[0]);
        const salesName = dup.assignedTo?.name || 'Tidak ada sales';
        return NextResponse.json(
          {
            error: `Pelanggan "${data.name.trim()}" sudah diinput oleh ${salesName}`,
            duplicate: {
              id: dup.id,
              name: dup.name,
              phone: dup.phone,
              assignedTo: dup.assignedTo || null
            }
          },
          { status: 409 }
        );
      }
    } else {
      // No phone — check name only
      const { data: dupByName } = await dupQuery;
      if (dupByName && dupByName.length > 0) {
        const dup = toCamelCase(dupByName[0]);
        const salesName = dup.assignedTo?.name || 'Tidak ada sales';
        return NextResponse.json(
          {
            error: `Pelanggan "${data.name.trim()}" sudah diinput oleh ${salesName}`,
            duplicate: {
              id: dup.id,
              name: dup.name,
              phone: dup.phone,
              assignedTo: dup.assignedTo || null
            }
          },
          { status: 409 }
        );
      }
    }
    // ========== END DUPLICATE CHECK ==========

    const insertResult = await db
      .from('customers')
      .insert({
        id: generateId(),
        code: generateCustomerCode(),
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
        unit_id: data.unitId,
        notes: data.notes,
        distance: data.distance || 'near',
        total_orders: 0,
        total_spent: 0,
        cashback_balance: 0,
        status: 'active',
        assigned_to_id: data.assignedToId || null,
        cashback_type: data.cashbackType || 'percentage',
        cashback_value: data.cashbackValue || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(`
        *,
        unit:units(*),
        assigned_to:users!assigned_to_id(id, name, email)
      `)
      .maybeSingle();

    if (insertResult.error) {
      console.error('Insert customer DB error:', insertResult.error);
      return NextResponse.json(
        { error: `Gagal menyimpan pelanggan: ${insertResult.error.message}` },
        { status: 400 }
      );
    }

    if (!insertResult.data) {
      console.error('Insert customer returned no data');
      return NextResponse.json(
        { error: 'Gagal menyimpan pelanggan: data tidak tersimpan' },
        { status: 500 }
      );
    }

    const customerCamel = toCamelCase(insertResult.data);
    wsCustomerUpdate({ unitId: data.unitId });
    return NextResponse.json({ customer: { ...customerCamel, assignedTo: customerCamel.assignedTo || null } });
  } catch (error: any) {
    console.error('Create customer error:', error);
    const message = error?.message || 'Terjadi kesalahan server';
    return NextResponse.json(
      { error: `Gagal membuat pelanggan: ${message}` },
      { status: 500 }
    );
  }
}

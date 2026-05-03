import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

// =====================================================================
// PWA Pending Orders
// GET /api/pwa-orders/pending — List pending PWA orders for approval
//   Query: ?unitId=xxx
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true, id: true, unitId: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user: authUser } = result;
    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get('unitId');

    let query = db
      .from('transactions')
      .select(`
        *,
        unit:units(id, name),
        customer:customers(id, name, phone, assigned_to_id, distance),
        created_by:users!created_by_id(id, name, phone),
        items:transaction_items(*, product:products(id, name, avg_hpp, unit, sub_unit, conversion_rate, selling_price, sell_price_per_sub_unit))
      `)
      .eq('type', 'sale')
      .eq('status', 'pending');

    // Super admin can see all, others only their unit
    if (authUser.role !== 'super_admin') {
      if (authUser.unitId) {
        query = query.eq('unit_id', authUser.unitId);
      }
    } else if (unitId) {
      query = query.eq('unit_id', unitId);
    }

    const { data: pwaOrders } = await query
      .ilike('notes', '%Order dari PWA%')
      .order('created_at', { ascending: false });

    // Sales hanya melihat order dari pelanggan yang ditugaskan ke mereka
    let filteredOrders = pwaOrders || [];
    if (authUser.role === 'sales') {
      filteredOrders = filteredOrders.filter((t: any) =>
        t.customer?.assigned_to_id === authUser.id
      );
    }

    const ordersCamel = filteredOrders.map((t: any) => {
      const camel = toCamelCase(t);
      return {
        ...camel,
        createdBy: camel.createdBy || null,
        customer: camel.customer || null,
        unit: camel.unit || null,
        items: (camel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null,
        })),
      };
    });

    return NextResponse.json({ orders: ordersCamel });
  } catch (error) {
    console.error('PWA pending orders GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

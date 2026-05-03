import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase, toCamelCase } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unitId = searchParams.get('unitId');

    let query = db
      .from('customers')
      .select(`
        *,
        unit:units(id, name),
        assigned_to:users!assigned_to_id(id, name, email)
      `)
      .eq('status', 'lost');

    if (unitId) {
      query = query.eq('unit_id', unitId);
    }

    const { data: customers } = await query
      .order('lost_at', { ascending: false })
      .limit(1000);

    const customersCamel = (customers || []).map((c: any) => {
      const camel = toCamelCase(c);
      return {
        ...camel,
        assignedTo: camel.assignedTo || null
      };
    });

    return NextResponse.json({ customers: customersCamel });
  } catch (error: any) {
    console.error('Get lost customers error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { verifyAuthUser } from '@/lib/token';
import { rowsToCamelCase } from '@/lib/supabase-helpers';

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { customerName, items } = await request.json();

    let isSuperAdmin = false;
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', userId).single();
    isSuperAdmin = authUser?.role === 'super_admin' && authUser?.is_active && authUser?.status === 'approved';

    // Get company settings
    const { data: settings } = await db.from('settings').select('*');
    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((s: any) => {
      try { settingsMap[s.key] = JSON.parse(s.value); } catch { settingsMap[s.key] = s.value; }
    });

    const company = {
      name: settingsMap.company_name || 'Razkindo',
      phone: settingsMap.company_phone || '',
      address: settingsMap.company_address || '',
      email: settingsMap.company_email || '',
      logo: settingsMap.company_logo || '',
    };

    // Find customer
    let customer: any = null;
    if (customerName) {
      const { data: cust } = await db
        .from('customers')
        .select('*')
        .ilike('name', `%${customerName}%`)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (cust) customer = rowsToCamelCase([cust])[0];
    }

    // Get active products
    const { data: products } = await db.from('products').select('*').eq('is_active', true).order('name').limit(500);

    return NextResponse.json({
      success: true,
      company,
      customer: customer ? {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        email: customer.email,
      } : null,
      products: (products || []).map((p: any) => {
        const item: Record<string, unknown> = {
          id: p.id,
          name: p.name,
          unit: p.unit || 'pcs',
          price: p.selling_price,
          stock: p.global_stock,
        };
        if (isSuperAdmin) item.hpp = p.avg_hpp;
        return item;
      }),
      quotationNo: `QUO-${format(new Date(), 'yyyyMMdd')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      date: format(new Date(), 'dd MMMM yyyy', { locale: id }),
      items: items || [],
    });
  } catch (error) {
    return NextResponse.json({ error: 'Gagal memproses quotation' }, { status: 500 });
  }
}

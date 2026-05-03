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

    const { partnerName, mouType, duration, scope } = await request.json();

    // Get company settings
    const { data: settings } = await db.from('settings').select('*');
    const settingsMap: Record<string, any> = {};
    (settings || []).forEach((s: any) => {
      try { settingsMap[s.key] = JSON.parse(s.value); } catch { settingsMap[s.key] = s.value; }
    });

    const company = {
      name: settingsMap.company_name || 'Razkindo Group',
      phone: settingsMap.company_phone || '',
      address: settingsMap.company_address || '',
      email: settingsMap.company_email || '',
      logo: settingsMap.company_logo || '',
    };

    // Find customer/partner by name
    let partner: any = null;
    if (partnerName) {
      const { data: cust } = await db
        .from('customers')
        .select('*')
        .ilike('name', `%${partnerName}%`)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (cust) partner = rowsToCamelCase([cust])[0];
    }

    // Generate MOU number
    const now = new Date();
    const mouNo = `MOU-${format(now, 'yyyyMMdd')}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
    const mouDate = format(now, 'dd MMMM yyyy', { locale: id });

    return NextResponse.json({
      success: true,
      company,
      partner: partner ? {
        id: partner.id,
        name: partner.name,
        phone: partner.phone,
        address: partner.address,
        email: partner.email,
      } : null,
      mouNo,
      date: mouDate,
      mouType: mouType || 'Distribusi',
      duration: duration || '1 Tahun',
      scope: scope || '',
    });
  } catch (error) {
    return NextResponse.json({ error: 'Gagal memproses MOU' }, { status: 500 });
  }
}

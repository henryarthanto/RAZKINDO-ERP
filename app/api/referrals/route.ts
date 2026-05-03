import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

// =====================================================================
// Referrals — Super Admin only
// GET /api/referrals — List all referrals
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authUserId || authUserId.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    let query = db
      .from('customer_referral')
      .select(`
        *,
        customer:customers!customer_referral_customer_id_fkey(id, name, phone, code),
        referral_customer:customers!referral_customer_id(id, name, phone, code, status)
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: referrals } = await query;

    const stats = {
      total: (referrals || []).length,
      new: (referrals || []).filter((r: any) => r.status === 'new').length,
      contacted: (referrals || []).filter((r: any) => r.status === 'contacted').length,
      converted: (referrals || []).filter((r: any) => r.status === 'converted').length,
      lost: (referrals || []).filter((r: any) => r.status === 'lost').length,
    };

    return NextResponse.json({
      referrals: (referrals || []).map(r => ({
        ...toCamelCase(r),
        customer: toCamelCase(r.customer || null),
        referralCustomer: toCamelCase(r.referral_customer || null),
      })),
      stats,
    });
  } catch (error) {
    console.error('Referrals GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    // Auth check - only kurir, super_admin, keuangan can access courier cash summary
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    const allowedRoles = ['kurir', 'super_admin', 'keuangan'];
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved' || !allowedRoles.includes(authUserCamel.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // OPTIMIZATION: Use RPC instead of fetching all records and summing in JS
    const { data: totalsData, error: totalsError } = await db.rpc('get_courier_cash_totals');
    if (totalsError) {
      console.error('[COURIER_CASH_SUMMARY] RPC failed, falling back to direct query:', totalsError.message);
      // Fallback
      const { data: allRecords } = await db.from('courier_cash').select('balance, total_collected, total_handover');
      const totalWithCouriers = (allRecords || []).reduce((sum: number, r: any) => sum + (r.balance || 0), 0);
      const totalCollected = (allRecords || []).reduce((sum: number, r: any) => sum + (r.total_collected || 0), 0);
      const totalHandedOver = (allRecords || []).reduce((sum: number, r: any) => sum + (r.total_handover || 0), 0);
      return NextResponse.json({ totalWithCouriers, totalCollected, totalHandedOver });
    }
    return NextResponse.json({
      totalWithCouriers: totalsData?.total_balance || 0,
      totalCollected: totalsData?.total_collected || 0,
      totalHandedOver: totalsData?.total_handover || 0,
    });
  } catch (error) {
    console.error('Courier cash summary error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Customer Cashback — Public (no auth required, identified by code)
// GET /api/pwa/[code]/cashback — Returns cashback balance + history
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.trim().length === 0) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    const { data: customer } = await db
      .from('customers')
      .select('id, name, cashback_balance, cashback_type, cashback_value')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Fetch recent cashback logs
    const { data: logs } = await db
      .from('cashback_log')
      .select('*')
      .eq('customer_id', customer.id)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch total earned and total withdrawn
    const { data: stats } = await db
      .from('cashback_log')
      .select('type, amount')
      .eq('customer_id', customer.id);

    let totalEarned = 0;
    let totalWithdrawn = 0;
    let totalReferralBonus = 0;
    for (const s of (stats || [])) {
      if (s.type === 'earned') totalEarned += s.amount;
      else if (s.type === 'withdrawn') totalWithdrawn += s.amount;
      else if (s.type === 'referral_bonus') totalReferralBonus += s.amount;
    }

    return NextResponse.json({
      balance: customer.cashback_balance || 0,
      totalEarned,
      totalWithdrawn,
      totalReferralBonus,
      cashbackType: customer.cashback_type || 'percentage',
      cashbackValue: customer.cashback_value || 0,
      logs: (logs || []).map(l => toCamelCase(l)),
    });
  } catch (error) {
    console.error('PWA cashback GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

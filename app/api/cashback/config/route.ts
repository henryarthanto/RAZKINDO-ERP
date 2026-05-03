import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser, verifyAndGetAuthUser } from '@/lib/token';

// =====================================================================
// Cashback Config — Super Admin only
// GET /api/cashback/config — Get current config
// PUT /api/cashback/config — Update config
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authUserId || authUserId.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: config } = await db
      .from('cashback_config')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    // Also get all configs for reference
    const { data: allConfigs } = await db
      .from('cashback_config')
      .select('*')
      .order('created_at', { ascending: false });

    // Get summary stats
    const { data: customers } = await db
      .from('customers')
      .select('cashback_balance')
      .not('cashback_balance', 'is', null);

    const totalCashbackOutstanding = (customers || []).reduce((sum: number, c: any) => sum + (c.cashback_balance || 0), 0);

    // Get pending withdrawals
    const { count: pendingWithdrawals } = await db
      .from('cashback_withdrawal')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { data: pendingTotal } = await db
      .from('cashback_withdrawal')
      .select('amount')
      .eq('status', 'pending');

    const totalPendingAmount = (pendingTotal || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    return NextResponse.json({
      config: config ? toCamelCase(config) : null,
      allConfigs: (allConfigs || []).map(c => toCamelCase(c)),
      stats: {
        totalCashbackOutstanding,
        pendingWithdrawals: pendingWithdrawals || 0,
        totalPendingAmount,
      },
    });
  } catch (error: any) {
    console.error('Cashback config GET error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authUserId = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authUserId || authUserId.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();

    // Validate
    if (!['percentage', 'nominal'].includes(data.type)) {
      return NextResponse.json({ error: 'Tipe harus percentage atau nominal' }, { status: 400 });
    }
    if (data.value === undefined || data.value < 0) {
      return NextResponse.json({ error: 'Value harus >= 0' }, { status: 400 });
    }

    // Deactivate existing configs
    await db
      .from('cashback_config')
      .update({ is_active: false })
      .eq('is_active', true);

    // Insert new config
    const { data: newConfig, error } = await db
      .from('cashback_config')
      .insert({
        id: generateId(),
        type: data.type,
        value: data.value,
        max_cashback: data.maxCashback || 0,
        min_order: data.minOrder || 0,
        referral_bonus_type: data.referralBonusType || 'percentage',
        referral_bonus_value: data.referralBonusValue || 0,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Cashback config update error:', error);
      return NextResponse.json({ error: 'Gagal menyimpan konfigurasi' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      config: toCamelCase(newConfig),
      message: 'Konfigurasi cashback berhasil diperbarui',
    });
  } catch (error: any) {
    console.error('Cashback config PUT error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

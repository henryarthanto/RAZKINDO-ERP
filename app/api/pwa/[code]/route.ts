import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Customer Lookup - Public (no auth required)
// GET /api/pwa/[code] — Customer accesses their PWA page
// Returns: customer info + cashback balance + total referrals count
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.trim().length === 0) {
      return NextResponse.json(
        { error: 'Kode pelanggan diperlukan' },
        { status: 400 }
      );
    }

    // Look up customer by code (customers table uses 'status' not 'is_active')
    const { data: customer, error } = await db
      .from('customers')
      .select('id, name, phone, address, code, cashback_balance, unit_id, status')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (error || !customer) {
      // Log the actual error for debugging
      if (error) console.error('PWA customer lookup DB error:', error.message, error.code);
      return NextResponse.json(
        { error: 'Kode pelanggan tidak ditemukan' },
        { status: 404 }
      );
    }

    // Get total referrals count for this customer
    const { count: referralCount } = await db
      .from('customer_referral')
      .select('*', { count: 'exact', head: true })
      .eq('customer_id', customer.id);

    // Get cashback config from the correct table
    let cashbackType = 'percentage';
    let cashbackValue = 0;
    try {
      const { data: cashbackConfig } = await db
        .from('cashback_config')
        .select('type, value')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (cashbackConfig) {
        cashbackType = cashbackConfig.type || 'percentage';
        cashbackValue = cashbackConfig.value || 0;
      }
    } catch {
      // cashback_config table may not exist yet; use defaults
    }

    const camel = toCamelCase(customer);

    return NextResponse.json({
      customer: {
        id: camel.id,
        name: camel.name,
        phone: camel.phone,
        address: camel.address,
        code: camel.code,
        cashbackBalance: camel.cashbackBalance || 0,
        cashbackType,
        cashbackValue,
        unitId: camel.unitId,
        referralCount: referralCount || 0,
      },
    });
  } catch (error) {
    console.error('PWA customer lookup error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { generateCustomerCode } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

/**
 * POST /api/customers/generate-codes
 *
 * Generate member codes for existing customers that don't have one.
 * Super admin only. Can also regenerate a code for a single customer.
 *
 * Body (optional):
 *   { customerId: "..." } — regenerate code for a specific customer
 *
 * Without body: backfill ALL customers missing a code.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authResult.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya super admin' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    if (body.customerId) {
      // ── Single customer: regenerate code ──
      const { data: existing } = await db
        .from('customers')
        .select('id, name, code')
        .eq('id', body.customerId)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: 'Pelanggan tidak ditemukan' }, { status: 404 });
      }

      let code = generateCustomerCode();
      let attempts = 0;
      while (attempts < 10) {
        const { data: dup } = await db
          .from('customers')
          .select('id')
          .eq('code', code)
          .maybeSingle();
        if (!dup) break;
        code = generateCustomerCode();
        attempts++;
      }

      const { error: updateError } = await db
        .from('customers')
        .update({ code })
        .eq('id', body.customerId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        customer: { id: existing.id, name: existing.name, code },
        message: `Link member untuk ${existing.name}: /c/${code}`,
      });
    }

    // ── Batch: backfill all customers without a code ──
    const { data: customers } = await db
      .from('customers')
      .select('id, name')
      .is('code', null)
      .limit(5000);

    if (!customers || customers.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Semua pelanggan sudah memiliki link member',
        updated: 0,
      });
    }

    let updated = 0;
    let failed = 0;

    for (const customer of customers) {
      let code = generateCustomerCode();
      let attempts = 0;
      let success = false;

      while (attempts < 10 && !success) {
        const { data: dup } = await db
          .from('customers')
          .select('id')
          .eq('code', code)
          .maybeSingle();

        if (!dup) {
          const { error: updateError } = await db
            .from('customers')
            .update({ code })
            .eq('id', customer.id);

          if (!updateError) {
            updated++;
            success = true;
          } else {
            failed++;
            break;
          }
        } else {
          code = generateCustomerCode();
          attempts++;
        }
      }

      if (!success && attempts >= 10) {
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `${updated} pelanggan berhasil diberi link member${failed > 0 ? `, ${failed} gagal` : ''}`,
      updated,
      failed,
      total: customers.length,
    });
  } catch (error: any) {
    console.error('Generate customer codes error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

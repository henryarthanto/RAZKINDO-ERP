import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

// =====================================================================
// PATCH /api/referrals/[id] — Update referral status (Super Admin)
// When converted, give referrer bonus cashback
// =====================================================================
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authUserId = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authUserId || authUserId.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();

    if (!['new', 'contacted', 'converted', 'lost'].includes(data.status)) {
      return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
    }

    // Fetch referral with customer info
    const { data: referral } = await db
      .from('customer_referral')
      .select('*, customer:customers!customer_referral_customer_id_fkey(id, name, cashback_balance), referral_customer:customers!referral_customer_id(id, name, status)')
      .eq('id', id)
      .single();

    if (!referral) {
      return NextResponse.json({ error: 'Referensi tidak ditemukan' }, { status: 404 });
    }

    // Update referral
    const updateData: any = {
      status: data.status,
      notes: data.notes || null,
    };

    if (data.followUpDate) {
      updateData.follow_up_date = new Date(data.followUpDate).toISOString();
    }

    const { data: updated, error } = await db
      .from('customer_referral')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        customer:customers!customer_referral_customer_id_fkey(id, name, phone, code),
        referral_customer:customers!referral_customer_id(id, name, phone, code, status)
      `)
      .single();

    if (error) {
      console.error('Referral update error:', error);
      return NextResponse.json({ error: 'Gagal memperbarui referensi' }, { status: 500 });
    }

    // If converted, give referrer bonus cashback AND activate the referral customer
    if (data.status === 'converted' && referral.customer_id) {
      try {
        // Activate the referral customer (change status from inactive to active)
        if (referral.referral_customer_id) {
          const { error: activateError } = await db
            .from('customers')
            .update({ status: 'active' })
            .eq('id', referral.referral_customer_id);

          if (activateError) {
            console.error('[Referral] Failed to activate referral customer:', activateError.message);
          }
        }

        // Give referrer bonus cashback
        const { data: config } = await db
          .from('cashback_config')
          .select('referral_bonus_type, referral_bonus_value')
          .eq('is_active', true)
          .maybeSingle();

        if (config) {
          const cfg = toCamelCase(config);
          let bonusAmount = 0;
          if (cfg.referralBonusType === 'percentage') {
            bonusAmount = 50000 * (cfg.referralBonusValue / 100);
          } else {
            bonusAmount = cfg.referralBonusValue;
          }
          bonusAmount = Math.round(Math.max(0, bonusAmount));

          if (bonusAmount > 0) {
            // Use atomic RPC for race-safe cashback credit
            const { data: rpcResult, error: rpcError } = await db.rpc('atomic_add_cashback', {
              p_customer_id: referral.customer_id,
              p_delta: bonusAmount,
            });

            if (rpcError) {
              console.error('[Referral] Atomic cashback credit failed:', rpcError.message);
            }

            // Get the updated balance for logging
            const { data: updatedCustomer } = await db
              .from('customers')
              .select('cashback_balance')
              .eq('id', referral.customer_id)
              .single();

            const balanceBefore = (updatedCustomer?.cashback_balance || 0) - bonusAmount;
            const balanceAfter = updatedCustomer?.cashback_balance || 0;

            await db.from('cashback_log').insert({
              id: generateId(),
              customer_id: referral.customer_id,
              type: 'referral_bonus',
              amount: bonusAmount,
              description: `Bonus referensi - ${referral.business_name} (${referral.pic_name})`,
              created_at: new Date().toISOString(),
            });
          }
        }
      } catch (bonusErr) {
        console.error('Referral conversion error (non-blocking):', bonusErr);
      }
    }

    // Create event
    createEvent(db, 'referral_status_updated', {
      referralId: id,
      customerName: referral.customer?.name,
      businessName: referral.business_name,
      status: data.status,
      updatedBy: authUserId.user.name,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      referral: {
        ...toCamelCase(updated),
        customer: toCamelCase(updated?.customer || null),
      },
    });
  } catch (error) {
    console.error('Referral PATCH error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

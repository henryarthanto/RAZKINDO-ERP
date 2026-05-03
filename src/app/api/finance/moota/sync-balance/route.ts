import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAndGetAuthUser } from '@/lib/token';
import { getMootaBanks, isMootaConfigured } from '@/lib/moota';

// =====================================================================
// Sync Bank Balances from Moota
// POST /api/finance/moota/sync-balance
//
// Fetches current balances from Moota API and updates bank_accounts.
// Only super_admin can trigger this (server-side, no client-controlled source).
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult || authResult.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Unauthorized — hanya Super Admin' }, { status: 401 });
    }

    if (!isMootaConfigured()) {
      return NextResponse.json({ error: 'Moota API belum dikonfigurasi' }, { status: 400 });
    }

    // Fetch all banks from Moota
    const mootaBanks = await getMootaBanks();
    if (!mootaBanks || mootaBanks.length === 0) {
      return NextResponse.json({ error: 'Tidak ada rekening bank di Moota' }, { status: 400 });
    }

    // Fetch all system bank accounts
    const { data: sysBanks, error: fetchError } = await db
      .from('bank_accounts')
      .select('id, account_no, balance, label')
      .eq('is_active', true);

    if (fetchError || !sysBanks) {
      return NextResponse.json({ error: 'Gagal memuat data rekening' }, { status: 500 });
    }

    // Match and update balances
    let synced = 0;
    let skipped = 0;
    const details: Array<{ label: string; before: number; after: number; mootaBalance: number }> = [];

    for (const mootaBank of mootaBanks) {
      const mootaBal = Number(mootaBank.balance) || 0;
      const sysBank = sysBanks.find(sb => sb.account_no === mootaBank.account_number);

      if (!sysBank) {
        skipped++;
        continue;
      }

      const sysBal = Number(sysBank.balance) || 0;
      if (Math.abs(mootaBal - sysBal) <= 1) {
        skipped++;
        continue;
      }

      // Update the balance
      const { error: updateError } = await db
        .from('bank_accounts')
        .update({ balance: mootaBal })
        .eq('id', sysBank.id);

      if (updateError) {
        console.error(`[SYNC-BALANCE] Failed to update ${sysBank.id}:`, updateError);
        continue;
      }

      details.push({
        label: sysBank.label || sysBank.account_no,
        before: sysBal,
        after: mootaBal,
        mootaBalance: mootaBal,
      });
      synced++;
    }

    return NextResponse.json({
      success: true,
      synced,
      skipped,
      totalMootaBanks: mootaBanks.length,
      details,
    });
  } catch (error) {
    console.error('[Moota] Error syncing balances:', error);
    return NextResponse.json({ error: 'Gagal sinkronisasi saldo dari Moota' }, { status: 500 });
  }
}

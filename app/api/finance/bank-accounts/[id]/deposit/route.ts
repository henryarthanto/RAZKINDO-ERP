import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import { atomicUpdateBalance } from '@/lib/atomic-ops';
import { financeEngine } from '@/lib/finance-engine';
import { generateId } from '@/lib/supabase-helpers';

// POST /api/finance/bank-accounts/[id]/deposit
// Tambah dana ke rekening bank → otomatis masuk ke Dana Lain-lain di pool
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const userId = authResult.userId;

    const { id } = await params;
    const { amount, description } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Jumlah harus lebih dari 0' }, { status: 400 });
    }

    const roundedAmount = Math.round(Number(amount));
    const journalId = generateId();

    // Fetch current bank (for name/log only)
    const { data: bank, error: fetchError } = await db
      .from('bank_accounts')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !bank) {
      return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
    }

    if (!bank.is_active) {
      return NextResponse.json({ error: 'Rekening sudah tidak aktif' }, { status: 400 });
    }

    const currentBalance = Number(bank.balance) || 0;

    // Credit bank balance + write ledger entry (financeEngine handles both atomically)
    const newBalance = await financeEngine.creditPhysical('bank_accounts', id, roundedAmount, journalId, 'deposit', id, `Setor dana ke ${bank.name}`, userId);

    // Credit Dana Lain-lain pool + write ledger entry
    let newInvestorFund: number;
    try {
      newInvestorFund = await financeEngine.creditPool('pool_investor_fund', roundedAmount, journalId, 'deposit', id, `Dana Lain-lain dari setor ke ${bank.name}`, userId);
    } catch (poolError) {
      // Compensating rollback: reverse the bank balance update with retry
      console.error('[BANK DEPOSIT] Pool update failed, rolling back bank balance:', poolError);
      let rollbackSuccess = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await atomicUpdateBalance('bank_accounts', id, -roundedAmount);
          rollbackSuccess = true;
          console.error(`[BANK DEPOSIT] Rollback succeeded on attempt ${attempt}`);
          break;
        } catch (rollbackError) {
          console.error(`[BANK DEPOSIT] Rollback attempt ${attempt}/3 failed:`, rollbackError);
          if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt)); // exponential backoff
        }
      }
      if (!rollbackSuccess) {
        console.error('[BANK DEPOSIT] CRITICAL: All rollback attempts failed — manual intervention required! Bank:', id, 'Amount:', roundedAmount);
      }
      throw new Error('Gagal memperbarui Dana Lain-lain.' + (rollbackSuccess ? ' Saldo bank dikembalikan.' : ' ROLLBACK GAGAL — hubungi admin.') + ' Silakan coba lagi.');
    }

    // Log
    try {
      createLog(db, {
        type: 'audit',
        action: 'bank_deposit',
        entity: 'bank_accounts',
        entityId: id,
        userId,
        message: `Dana ditambahkan ke ${bank.name} (${bank.bank_name}): Rp ${roundedAmount.toLocaleString('id-ID')}. Saldo: ${currentBalance.toLocaleString('id-ID')} → ${newBalance.toLocaleString('id-ID')}. Dana Lain-lain: ${(newInvestorFund - roundedAmount).toLocaleString('id-ID')} → ${newInvestorFund.toLocaleString('id-ID')}${description ? `. Keterangan: ${description}` : ''}`
      });
    } catch { /* ignore */ }

    return NextResponse.json({
      bankAccount: toCamelCase({ ...bank, balance: newBalance }),
      investorFund: newInvestorFund,
      message: `Dana berhasil ditambahkan ke ${bank.name}. Saldo baru: Rp ${newBalance.toLocaleString('id-ID')}`
    });
  } catch (error) {
    console.error('Bank deposit error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

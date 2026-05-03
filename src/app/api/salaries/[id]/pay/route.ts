import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, createLog, createEvent } from '@/lib/supabase-helpers';
import { wsSalaryUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const { id } = await params;
    const data = await request.json();

    let eventPayload: { salaryId: string; userId: string; amount: number } | null = null;

    // Fetch salary fresh
    const { data: salary, error: fetchError } = await db.from('salary_payments').select(`
      *, user:users!user_id(id, name), finance_request:finance_requests(id)
    `).eq('id', id).single();

    if (fetchError || !salary) {
      throw new Error('Data gaji tidak ditemukan');
    }

    if (salary.status === 'paid') {
      throw new Error('Gaji sudah dibayarkan');
    }
    if (salary.status === 'pending') {
      throw new Error('Gaji harus disetujui oleh Finance terlebih dahulu');
    }
    if (salary.status === 'rejected') {
      throw new Error('Gaji sudah ditolak');
    }

    // ========== 2-STEP WORKFLOW VALIDATION ==========
    // Step 1: Fund source (HPP or Profit pool) must be specified
    const validFundSources = ['hpp_paid', 'profit_paid'];
    // fund_source is stored in finance_requests, not salary_payments
    const fundSource = data.fundSource || salary.finance_request?.fund_source;
    if (!fundSource || !validFundSources.includes(fundSource)) {
      throw new Error('Step 1: Komposisi dana (HPP Sudah Terbayar / Profit Sudah Terbayar) wajib dipilih');
    }

    // RACE CONDITION FIX: Removed pre-flight pool balance check.
    // Pool balance is read-then-validated here, but can go stale between read and deduction.
    // The atomicUpdatePoolBalance() call below will fail if balance is insufficient,
    // and its error is caught for a user-friendly message. This prevents double-spending.
    const poolKey = fundSource === 'hpp_paid' ? 'pool_hpp_paid_balance' : 'pool_profit_paid_balance';

    // Step 2: Physical account (bank/cashbox) must be specified
    const sourceType = data.sourceType || salary.source_type;
    const bankAccountId = data.bankAccountId || salary.bank_account_id;
    const cashBoxId = data.cashBoxId || salary.cash_box_id;

    const hasBankSource = sourceType === 'bank' && bankAccountId;
    const hasCashboxSource = sourceType === 'cashbox' && cashBoxId;
    if (!hasBankSource && !hasCashboxSource) {
      throw new Error('Step 2: Sumber pembayaran fisik (Rekening Bank / Brankas) wajib dipilih');
    }

    // Validate physical account exists and has balance before touching anything
    if (hasBankSource) {
      const { data: bank } = await db.from('bank_accounts').select('balance').eq('id', bankAccountId).single();
      if (!bank) throw new Error('Rekening bank tidak ditemukan');
      if (bank.balance < salary.total_amount) throw new Error('Saldo rekening bank tidak cukup');
    }
    if (hasCashboxSource) {
      const { data: cashBox } = await db.from('cash_boxes').select('balance').eq('id', cashBoxId).single();
      if (!cashBox) throw new Error('Brankas/kas tidak ditemukan');
      if (cashBox.balance < salary.total_amount) throw new Error('Saldo brankas/kas tidak cukup');
    }

    // CRITICAL: Deduct balances BEFORE committing status.
    // If any deduction fails, salary status stays unchanged (no partial state).
    // Pool deduction first
    try {
      await atomicUpdatePoolBalance(poolKey, -salary.total_amount);
    } catch (poolErr) {
        const poolLabel = fundSource === 'hpp_paid' ? 'HPP Sudah Terbayar' : 'Profit Sudah Terbayar';
        throw new Error(`Saldo pool ${poolLabel} tidak mencukupi. Mungkin saldo telah berubah, coba lagi.`);
    }

    // Physical account deduction second
    try {
      if (hasBankSource) {
        await atomicUpdateBalance('bank_accounts', bankAccountId!, -salary.total_amount);
      }
      if (hasCashboxSource) {
        await atomicUpdateBalance('cash_boxes', cashBoxId!, -salary.total_amount);
      }
    } catch (physicalErr) {
      // Compensate pool deduction if physical account deduction fails
      try {
        await atomicUpdatePoolBalance(poolKey, salary.total_amount);
      } catch (compensateErr) {
        console.error('CRITICAL: Failed to compensate pool deduction after physical account failure:', compensateErr);
      }
      throw new Error('Gagal mengurangi saldo akun fisik: ' + (physicalErr instanceof Error ? physicalErr.message : String(physicalErr)));
    }

    // All deductions succeeded — NOW commit the salary status via optimistic lock
    // NOTE: salary_payments table does NOT have fund_source column — only update columns that exist
    const salaryUpdateData: Record<string, unknown> = {
      source_type: sourceType,
      bank_account_id: hasBankSource ? bankAccountId : null,
      cash_box_id: hasCashboxSource ? cashBoxId : null,
      status: 'paid',
      approved_by_id: salary.approved_by_id || auth.userId,
      approved_at: salary.approved_at || new Date().toISOString(),
      paid_at: new Date().toISOString(),
    };

    const { data: updatedSalary, error: updateError } = await db.from('salary_payments').update(salaryUpdateData).eq('id', id).eq('status', 'approved').select(`
      *, user:users!user_id(id, name), finance_request:finance_requests(id, type, amount, status)
    `).single();

    if (updateError || !updatedSalary) {
      // Optimistic lock failed (status changed concurrently) — compensate the deductions
      console.error('[Salary Pay] Status update FAILED:', JSON.stringify({
        message: updateError?.message,
        code: updateError?.code,
        details: (updateError as any)?.details,
        hint: (updateError as any)?.hint,
      }));
      try {
        await atomicUpdatePoolBalance(poolKey, salary.total_amount);
        if (hasBankSource) await atomicUpdateBalance('bank_accounts', bankAccountId!, salary.total_amount);
        if (hasCashboxSource) await atomicUpdateBalance('cash_boxes', cashBoxId!, salary.total_amount);
      } catch (compensateErr) {
        console.error('CRITICAL: Failed to compensate salary deductions after optimistic lock failure:', compensateErr);
      }
      throw new Error('Gaji sudah dibayarkan atau status telah berubah');
    }

    // Update linked FinanceRequest status with full 2-step info
    if (salary.finance_request_id) {
      await db.from('finance_requests').update({
        status: 'processed',
        processed_by_id: auth.userId,
        processed_at: new Date().toISOString(),
        fund_source: fundSource,
        source_type: sourceType,
        bank_account_id: hasBankSource ? bankAccountId : null,
        cash_box_id: hasCashboxSource ? cashBoxId : null,
        payment_type: 'pay_now',
      }).eq('id', salary.finance_request_id);
    }

    eventPayload = { salaryId: id, userId: salary.user_id, amount: salary.total_amount };

    createLog(db, { type: 'audit', action: 'salary_paid', entity: 'salary', entityId: id, userId: auth.userId, message: `Gaji dibayarkan ke ${(salary as any).user?.name}: ${salary.total_amount} (Step 1: ${fundSource === 'hpp_paid' ? 'HPP Sudah Terbayar' : 'Profit Sudah Terbayar'}, Step 2: ${hasBankSource ? 'Rekening Bank' : 'Brankas'})` });

    // Create event outside
    if (eventPayload) {
      createEvent(db, 'salary_paid', eventPayload);
    }

    wsSalaryUpdate({ salaryId: id, userId: salary.user_id });

    return NextResponse.json({ salary: toCamelCase(updatedSalary) });
  } catch (error) {
    console.error('Pay salary error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    let status = 500;
    if (message.includes('tidak ditemukan')) status = 404;
    else if (message.includes('tidak cukup') || message.includes('sudah dibayarkan') || message.includes('harus disetujui') || message.includes('sudah ditolak') || message.includes('belum dipilih') || message.includes('harus berupa') || message.includes('telah berubah') || message.includes('wajib dipilih') || message.includes('Step 1') || message.includes('Step 2')) status = 400;
    return NextResponse.json({ error: message }, { status });
  }
}

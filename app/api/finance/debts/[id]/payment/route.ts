import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, rowsToCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { financeEngine } from '@/lib/finance-engine';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';
import { runInTransaction, createStep, type TransactionStep } from '@/lib/db-transaction';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const { id } = await params;
    const { amount, paymentSource, bankAccountId, cashBoxId, referenceNo, notes, paidById, fundSource, refundSource } = await request.json();

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Jumlah pembayaran harus lebih dari 0' }, { status: 400 });
    }

    // ========== 2-STEP WORKFLOW VALIDATION ==========
    // Step 1: Fund source (HPP or Profit pool) must be specified
    const validFundSources = ['hpp_paid', 'profit_paid'];
    if (!fundSource || !validFundSources.includes(fundSource)) {
      return NextResponse.json({ error: 'Step 1: Komposisi dana (HPP Sudah Terbayar / Profit Sudah Terbayar) wajib dipilih' }, { status: 400 });
    }

    // Step 2: Physical account (bank/cashbox) must be specified
    const validSources = ['bank', 'cashbox'];
    if (!paymentSource || !validSources.includes(paymentSource)) {
      return NextResponse.json({ error: 'Step 2: Sumber pembayaran fisik (Rekening Bank / Brankas) wajib dipilih' }, { status: 400 });
    }

    if (paymentSource === 'bank' && !bankAccountId) {
      return NextResponse.json({ error: 'Rekening bank wajib diisi untuk pembayaran bank' }, { status: 400 });
    }
    if (paymentSource === 'cashbox' && !cashBoxId) {
      return NextResponse.json({ error: 'Brankas wajib diisi untuk pembayaran brankas' }, { status: 400 });
    }

    const poolKey = fundSource === 'hpp_paid' ? 'pool_hpp_paid_balance' : 'pool_profit_paid_balance';
    const poolLabel = fundSource === 'hpp_paid' ? 'HPP Sudah Terbayar' : 'Profit Sudah Terbayar';

    // Shared context for cross-step data (validate populates, later steps consume)
    const ctx: {
      debt: any;
      currentPaid: number;
      remaining: number;
      newPaidAmount: number;
      newRemainingAmount: number;
      newStatus: string;
    } = {} as any;

    // Execute payment in a transactional pipeline with compensating rollback
    const journalId = generateId();
    const results = await runInTransaction<unknown>([
      // Step 1: Validate all inputs and check debt status/balance
      createStep('validate', async () => {
        const { data: debt, error } = await db.from('company_debts').select('*, company_debt_payments(*)').eq('id', id).single();
        if (error || !debt) throw new Error('Hutang tidak ditemukan');
        if (debt.status !== 'active') throw new Error('Hutang sudah ditutup atau dibatalkan');

        const currentPaid = (debt.company_debt_payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
        const remaining = debt.total_amount - currentPaid;

        if (amount > remaining) {
          throw new Error(`Jumlah melebihi sisa hutang. Sisa: Rp ${remaining.toLocaleString('id-ID')}`);
        }

        ctx.debt = debt;
        ctx.currentPaid = currentPaid;
        ctx.remaining = remaining;
        return true;
      }),

      // Step 2: Atomically deduct from pool balance (throws if insufficient)
      createStep('deduct-pool', async () => {
        await financeEngine.debitPool(poolKey, amount, journalId, 'debt_payment', id, `Pembayaran hutang dari ${poolLabel}`, auth.userId);
        return true;
      }, async () => {
        try { await atomicUpdatePoolBalance(poolKey, amount); } catch { /* best effort rollback */ }
      }),

      // Step 3: Atomically deduct from physical account (bank/cashbox)
      createStep('deduct-physical', async () => {
        if (paymentSource === 'bank' && bankAccountId) {
          await financeEngine.debitPhysical('bank_accounts', bankAccountId, amount, journalId, 'debt_payment', id, `Pembayaran hutang dari bank`, auth.userId);
        } else if (paymentSource === 'cashbox' && cashBoxId) {
          await financeEngine.debitPhysical('cash_boxes', cashBoxId, amount, journalId, 'debt_payment', id, `Pembayaran hutang dari brankas`, auth.userId);
        }
        return true;
      }, async () => {
        try {
          if (paymentSource === 'bank' && bankAccountId) {
            await atomicUpdateBalance('bank_accounts', bankAccountId, amount);
          } else if (paymentSource === 'cashbox' && cashBoxId) {
            await atomicUpdateBalance('cash_boxes', cashBoxId, amount);
          }
        } catch { /* best effort rollback */ }
      }),

      // Step 4: Create the CompanyDebtPayment record
      createStep('create-payment', async () => {
        const now = new Date().toISOString();
        const paymentData = toSnakeCase({
          id: generateId(),
          debtId: id,
          amount,
          paymentSource,
          bankAccountId: bankAccountId || null,
          cashBoxId: cashBoxId || null,
          referenceNo: referenceNo || null,
          notes: notes || null,
          paidById: auth.userId,
          createdAt: new Date().toISOString(),
          paidAt: new Date().toISOString(),
          ...(refundSource != null ? { refundSource } : {}),
        });

        const { data: payment, error } = await db.from('company_debt_payments').insert(paymentData).select().single();
        if (error) throw error;
        return payment;
      }, async (payment: any) => {
        try { await db.from('company_debt_payments').delete().eq('id', payment.id); } catch { /* best effort rollback */ }
      }),

      // Step 5: Update debt totals
      createStep('update-debt', async () => {
        const newPaidAmount = ctx.currentPaid + amount;
        const newRemainingAmount = ctx.debt.total_amount - newPaidAmount;
        const newStatus = newRemainingAmount <= 0 ? 'paid' : 'active';

        const { error } = await db.from('company_debts').update({
          paid_amount: newPaidAmount,
          remaining_amount: newRemainingAmount,
          status: newStatus,
        }).eq('id', id);
        if (error) throw error;

        ctx.newPaidAmount = newPaidAmount;
        ctx.newRemainingAmount = newRemainingAmount;
        ctx.newStatus = newStatus;
        return true;
      }, async () => {
        try {
          await db.from('company_debts').update({
            paid_amount: ctx.currentPaid,
            remaining_amount: ctx.remaining,
            status: ctx.debt.status,
          }).eq('id', id);
        } catch { /* best effort rollback */ }
      }),
    ]);

    const payment = results[3];

    // Log with 2-step info
    const fundLabel = fundSource === 'hpp_paid' ? 'HPP Sudah Terbayar' : 'Profit Sudah Terbayar';
    const physLabel = paymentSource === 'bank' ? 'Rekening Bank' : 'Brankas';
    createLog(db, {
      type: 'activity',
      userId: auth.userId,
      action: 'company_debt_payment',
      entity: 'company_debt',
      entityId: id,
      payload: JSON.stringify({ amount, fundSource, fundLabel, paymentSource, physLabel, bankAccountId, cashBoxId, newPaidAmount: ctx.newPaidAmount, newRemainingAmount: ctx.newRemainingAmount, newStatus: ctx.newStatus }),
    });

    wsFinanceUpdate({ type: 'debt_payment', debtId: id });

    return NextResponse.json({
      payment: toCamelCase(payment),
      debt: {
        ...toCamelCase(ctx.debt),
        paidAmount: ctx.newPaidAmount,
        remainingAmount: ctx.newRemainingAmount,
        status: ctx.newStatus,
      },
    });
  } catch (error) {
    console.error('Create debt payment error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    const status = error instanceof Error && (
      message.includes('tidak mencukupi') ||
      message.includes('tidak ditemukan') ||
      message.includes('melebihi') ||
      message.includes('ditutup') ||
      message.includes('wajib dipilih') ||
      message.includes('Step 1') ||
      message.includes('Step 2')
    ) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

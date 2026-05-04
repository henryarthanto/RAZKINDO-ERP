import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toSnakeCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { atomicUpdatePoolBalance, atomicUpdateBalance } from '@/lib/atomic-ops';
import { financeEngine } from '@/lib/finance-engine';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';
import { runInTransaction, createStep, type TransactionStep } from '@/lib/db-transaction';
import { validateBody } from '@/lib/validators';

const expenseCreateSchema = z.object({
  description: z.string().min(1, 'Deskripsi pengeluaran wajib diisi'),
  amount: z.number().positive('Jumlah harus lebih dari 0'),
  fundSource: z.enum(['hpp_paid', 'profit_paid', 'lain_lain'], { error: 'Sumber dana (HPP/Profit/Lain-lain) wajib dipilih' }),
  destinationType: z.enum(['bank', 'cashbox'], { error: 'Sumber pembayaran (Rekening/Brankas) wajib dipilih' }),
  destinationId: z.string().min(1, 'Detail akun pembayaran wajib dipilih'),
  unitId: z.string().optional(),
  notes: z.string().optional(),
});

// =====================================================================
// EXPENSE DIRECT CREATION — Create + Process in one step
// POST /api/finance/expenses
//
// Creates a finance request + expense transaction atomically:
// 1. Deduct from pool balance (HPP/Profit/Lain-lain)
// 2. Deduct from bank account or cash box
// 3. Create expense transaction record
// 4. Create finance request record (status: processed)
// =====================================================================

async function generateInvoiceNo(prefix: string): Promise<string> {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  const prefixStr = `${prefix}-${year}${month}`;

  const { data: lastTx } = await db
    .from('transactions')
    .select('invoice_no')
    .like('invoice_no', `${prefixStr}%`)
    .order('invoice_no', { ascending: false })
    .limit(1)
    .maybeSingle();

  let seq = 1;
  if (lastTx?.invoice_no) {
    const numStr = lastTx.invoice_no.replace(prefixStr, '');
    seq = parseInt(numStr, 10) + 1;
  }

  return `${prefixStr}${String(seq).padStart(4, '0')}`;
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user role
    const { data: authUserData } = await db
      .from('users')
      .select('role, is_active, status')
      .eq('id', authUserId)
      .single();
    if (!authUserData?.is_active || authUserData.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan'].includes(authUserData.role)) {
      return NextResponse.json({ error: 'Hanya super_admin dan keuangan yang dapat mencatat pengeluaran' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validation = validateBody(expenseCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { description, amount, notes, fundSource, destinationType, destinationId, unitId } = validation.data;

    // Validate pool balance
    const poolKeyMap: Record<string, string> = {
      hpp_paid: 'pool_hpp_paid_balance',
      profit_paid: 'pool_profit_paid_balance',
      lain_lain: 'pool_investor_fund',
    };
    const poolLabelMap: Record<string, string> = {
      hpp_paid: 'HPP Sudah Terbayar',
      profit_paid: 'Profit Sudah Terbayar',
      lain_lain: 'Dana Lain-lain',
    };

    const poolKey = poolKeyMap[fundSource];
    const poolLabel = poolLabelMap[fundSource];

    // RACE CONDITION FIX: Removed pre-flight pool balance check.
    // Pool balance read here can go stale before the atomic deduction inside txSteps.
    // The financeEngine.debitPool() inside the transaction step will fail atomically
    // if balance is insufficient, and its error is caught for a user-friendly message.

    // Validate destination balance
    const destTable = destinationType === 'bank' ? 'bank_accounts' as const : 'cash_boxes' as const;
    const destLabel = destinationType === 'bank' ? 'rekening bank' : 'brankas/kas';

    const { data: destAccount } = await db
      .from(destTable)
      .select('id, name, balance')
      .eq('id', destinationId)
      .single();

    if (!destAccount) {
      return NextResponse.json({ error: `${destLabel} tidak ditemukan` }, { status: 404 });
    }

    if (destAccount.balance < amount) {
      return NextResponse.json({
        error: `Saldo ${destLabel} "${destAccount.name}" (${formatRp(destAccount.balance)}) tidak mencukupi`
      }, { status: 400 });
    }

    // Build atomic transaction steps
    const journalId = generateId();
    const txSteps: TransactionStep<any>[] = [];
    let _expenseTxResult: any;

    // Step 1: Deduct from pool balance (+ ledger entry)
    txSteps.push(createStep('deduct-pool', async () => {
      try {
        await financeEngine.debitPool(poolKey, amount, journalId, 'expense', journalId, `Pengeluaran: ${description.trim()} dari ${poolLabel}`, authUserId);
      } catch {
        throw new Error(`Saldo ${poolLabel} tidak mencukupi`);
      }
      return { key: poolKey, amount };
    }, async (result) => {
      try { await atomicUpdatePoolBalance(result.key, result.amount); } catch { /* best effort */ }
    }));

    // Step 2: Deduct from destination (bank/brankas) (+ ledger entry)
    txSteps.push(createStep('deduct-destination', async () => {
      try {
        await financeEngine.debitPhysical(destTable, destinationId, amount, journalId, 'expense', journalId, `Pengeluaran: ${description.trim()} dari ${destLabel}`, authUserId);
      } catch {
        throw new Error(`Saldo ${destLabel} tidak mencukupi`);
      }
      return true;
    }, async () => {
      try { await atomicUpdateBalance(destTable, destinationId, amount); } catch { /* best effort */ }
    }));

    // Step 3: Create expense transaction
    txSteps.push(createStep('create-expense-tx', async () => {
      const invoiceNo = await generateInvoiceNo('EXP');
      const txData = toSnakeCase({
        id: generateId(),
        type: 'expense',
        invoiceNo,
        unitId: unitId || undefined,
        createdById: authUserId,
        total: amount,
        paidAmount: amount,
        remainingAmount: 0,
        totalHpp: 0,
        totalProfit: 0,
        hppPaid: 0,
        profitPaid: 0,
        hppUnpaid: 0,
        profitUnpaid: 0,
        paymentMethod: destinationType === 'bank' ? 'transfer' : 'cash',
        status: 'approved',
        paymentStatus: 'paid',
        notes: description + (notes ? ` — ${notes}` : ''),
        transactionDate: new Date().toISOString(),
        courierCommission: 0,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const { data: tx, error } = await db.from('transactions').insert(txData).select('id, invoice_no').single();
      if (error) throw error;
      _expenseTxResult = tx;
      return tx;
    }, async (tx: any) => {
      try {
        if (tx?.id) {
          await db.from('transactions').delete().eq('id', tx.id);
        }
      } catch { /* best effort */ }
    }));

    // Step 4: Create finance request (status: processed)
    txSteps.push(createStep('create-finance-request', async () => {
      const txResult = _expenseTxResult;
      const now = new Date().toISOString();
      const reqData = toSnakeCase({
        id: generateId(),
        type: 'expense',
        requestById: authUserId,
        unitId: unitId || undefined,
        amount,
        description: description.trim(),
        notes: notes?.trim() || null,
        goodsStatus: 'pending',
        version: 1,
        status: 'processed',
        sourceType: destinationType,
        fundSource,
        bankAccountId: destinationType === 'bank' ? destinationId : null,
        cashBoxId: destinationType === 'cashbox' ? destinationId : null,
        paymentType: 'pay_now',
        processedById: authUserId,
        processedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const { data: req, error } = await db.from('finance_requests').insert(reqData).select('id').single();
      if (error) throw error;
      return { requestId: req.id, invoiceNo: txResult?.invoice_no };
    }, async (result: any) => {
      try {
        if (result?.requestId) {
          await db.from('finance_requests').delete().eq('id', result.requestId);
        }
      } catch { /* best effort */ }
    }));

    // Execute all steps atomically
    const results = await runInTransaction(txSteps);

    // Logging
    const finalResult = results[3] as { requestId?: string; invoiceNo?: string } | undefined;
    createEvent(db, 'expense_created', {
      requestId: finalResult?.requestId,
      amount,
      fundSource,
      destinationType,
      destinationId,
      description: description.trim(),
    }).catch(() => {});

    createLog(db, {
      type: 'activity',
      userId: authUserId,
      action: 'expense_created',
      entity: 'transaction',
      entityId: finalResult?.requestId,
      message: `Pengeluaran ${formatRp(amount)} dari ${poolLabel} — ${destAccount.name}`,
      payload: JSON.stringify({ amount, fundSource, destinationType, description: description.trim() }),
    }).catch(() => {});

    // Broadcast to all finance clients
    wsFinanceUpdate({ action: 'expense_created', amount, description: description.trim(), fundSource, destinationType });

    return NextResponse.json({
      success: true,
      message: `Pengeluaran ${formatRp(amount)} berhasil dicatat`,
      invoiceNo: finalResult?.invoiceNo,
    });
  } catch (error) {
    console.error('[Expenses API] Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

function formatRp(n: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

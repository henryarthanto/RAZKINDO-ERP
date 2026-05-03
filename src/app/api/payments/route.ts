import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { wsPaymentUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { runInTransaction, createStep, type TransactionStep } from '@/lib/db-transaction';
import { financeEngine } from '@/lib/finance-engine';
import { concurrencyManager } from '@/lib/concurrency-queue';
// withGracefulDegradation intentionally NOT used for critical financial operations
// Payment processing must fail with actual error messages, not generic 503

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');

    let query = db
      .from('payments')
      .select(`
        *,
        transaction:transactions(*, unit:units(*)),
        received_by:users!received_by_id(*),
        cash_box:cash_boxes(id, name),
        bank_account:bank_accounts(id, name, bank_name, account_no)
      `);

    if (transactionId) {
      query = query.eq('transaction_id', transactionId);
    }

    const { data: payments } = await query
      .order('paid_at', { ascending: false })
      .limit(500);

    const paymentsCamel = (payments || []).map((p: any) => {
      const camel = toCamelCase(p);
      return {
        ...camel,
        transaction: camel.transaction ? {
          ...camel.transaction,
          unit: camel.transaction.unit || null
        } : null,
        receivedBy: camel.receivedBy || null,
        cashBox: camel.cashBox || null,
        bankAccount: camel.bankAccount || null
      };
    });

    return NextResponse.json({ payments: paymentsCamel });
  } catch (error) {
    console.error('Get payments error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();

    if (!data.transactionId || !data.amount || !data.paymentMethod) {
      return NextResponse.json(
        { error: 'transactionId, amount, dan paymentMethod diperlukan' },
        { status: 400 }
      );
    }
    if (typeof data.amount !== 'number' || data.amount <= 0) {
      return NextResponse.json(
        { error: 'Amount harus berupa angka positif' },
        { status: 400 }
      );
    }

    // BUG-01 FIX: Acquire per-transaction resource lock to prevent double-payment race conditions
    const paymentLockId = `payment:${data.transactionId}`;
    const releaseLock = await concurrencyManager.resourceLock.acquire(
      paymentLockId,
      `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      15_000
    );

    const journalId = generateId();

    try {
    // Sequential operations (no transactions in Supabase JS)

    // Lock the transaction row by reading it
    const { data: transaction } = await db
      .from('transactions')
      .select('*')
      .eq('id', data.transactionId)
      .single();

    if (!transaction) {
      const error = new Error('Transaksi tidak ditemukan');
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    const txCamel = toCamelCase(transaction);

    if (txCamel.status === 'pending') {
      return NextResponse.json(
        { error: 'Transaksi belum disetujui. Approve transaksi terlebih dahulu sebelum menerima pembayaran.' },
        { status: 400 }
      );
    }

    if (txCamel.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Tidak dapat menambah pembayaran pada transaksi yang sudah dibatalkan.' },
        { status: 400 }
      );
    }

    if (data.amount > txCamel.remainingAmount) {
      return NextResponse.json(
        { error: 'Jumlah pembayaran melebihi sisa tagihan' },
        { status: 400 }
      );
    }

    if (txCamel.paymentStatus === 'paid') {
      return NextResponse.json(
        { error: 'Transaksi sudah lunas. Tidak dapat menambah pembayaran.' },
        { status: 400 }
      );
    }

    // Calculate proportional HPP and Profit
    const hppPortion = txCamel.total > 0 
      ? (txCamel.totalHpp / txCamel.total) * data.amount 
      : 0;
    const profitPortion = txCamel.total > 0 
      ? (txCamel.totalProfit / txCamel.total) * data.amount 
      : 0;

    // For sale transactions: validate destination account
    const isSale = txCamel.type === 'sale';
    if (isSale) {
      if (data.paymentMethod === 'cash' && !data.cashBoxId) {
        return NextResponse.json({ error: 'Pilih brankas tujuan untuk pembayaran tunai' }, { status: 400 });
      }
      if ((data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') && !data.bankAccountId) {
        return NextResponse.json({ error: 'Pilih akun bank tujuan untuk pembayaran transfer/giro' }, { status: 400 });
      }

      if (data.paymentMethod === 'cash' && data.cashBoxId) {
        const { data: cashBox } = await db.from('cash_boxes').select('*').eq('id', data.cashBoxId).single();
        if (!cashBox) return NextResponse.json({ error: 'Brankas tidak ditemukan' }, { status: 404 });
        if (!cashBox.is_active) return NextResponse.json({ error: 'Brankas tidak aktif' }, { status: 400 });
      }
      if ((data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') && data.bankAccountId) {
        const { data: bankAccount } = await db.from('bank_accounts').select('*').eq('id', data.bankAccountId).single();
        if (!bankAccount) return NextResponse.json({ error: 'Akun bank tidak ditemukan' }, { status: 404 });
        if (!bankAccount.is_active) return NextResponse.json({ error: 'Akun bank tidak aktif' }, { status: 400 });
      }
    }

    // Pre-compute values for transaction steps
    const expectedPaidAmount = txCamel.paidAmount; // For optimistic concurrency check
    const newPaidAmount = txCamel.paidAmount + data.amount;
    const newRemaining = txCamel.total - newPaidAmount;
    const newHppPaid = txCamel.hppPaid + hppPortion;
    const newProfitPaid = txCamel.profitPaid + profitPortion;
    const paymentStatus = newRemaining <= 0 ? 'paid' : newPaidAmount > 0 ? 'partial' : 'unpaid';
    const allowedUpgrade = ['approved'];
    const txStatus = paymentStatus === 'paid' && allowedUpgrade.includes(txCamel.status) ? 'paid' : txCamel.status;

    // Build compensating transaction steps
    const paymentId = generateId();
    const txSteps: TransactionStep<any>[] = [];

    // Step 1: Create payment record
    txSteps.push(createStep('create-payment', async () => {
      const { data: payment, error: paymentError } = await db
        .from('payments')
        .insert({
          id: paymentId,
          transaction_id: data.transactionId,
          received_by_id: authUserId,
          amount: data.amount,
          payment_method: data.paymentMethod,
          cash_box_id: data.paymentMethod === 'cash' ? data.cashBoxId : null,
          bank_account_id: (data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') ? data.bankAccountId : null,
          bank_name: data.bankName,
          account_no: data.accountNo,
          reference_no: data.referenceNo,
          notes: data.notes,
          hpp_portion: hppPortion,
          profit_portion: profitPortion,
          version: 1,
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        })
        .select(`*, cash_box:cash_boxes(*), bank_account:bank_accounts(*)`)
        .single();
      if (paymentError) throw paymentError;
      return payment;
    }, async () => {
      try { await db.from('payments').delete().eq('id', paymentId); } catch { /* best effort */ }
    }));

    // Step 2: Update transaction amounts and status (with race condition guard)
    txSteps.push(createStep('update-transaction', async () => {
      const { data: updatedTx, error } = await db
        .from('transactions')
        .update({
          paid_amount: newPaidAmount,
          remaining_amount: Math.max(0, newRemaining),
          hpp_paid: newHppPaid,
          profit_paid: newProfitPaid,
          hpp_unpaid: txCamel.totalHpp - newHppPaid,
          profit_unpaid: txCamel.totalProfit - newProfitPaid,
          payment_status: paymentStatus,
          status: txStatus
        })
        .eq('id', data.transactionId)
        .neq('payment_status', 'paid')
        .eq('paid_amount', expectedPaidAmount)
        .select('payment_status, remaining_amount')
        .maybeSingle();
      if (error) throw error;
      if (!updatedTx) {
        throw new Error('CONCURRENT_MODIFICATION: Transaksi diubah oleh pembayaran lain secara bersamaan. Silakan refresh dan coba lagi.');
      }
      // Validate remaining amount after update (double-payment guard)
      if (updatedTx.remaining_amount < 0) {
        throw new Error('Jumlah pembayaran melebihi sisa tagihan. Transaksi mungkin sudah dibayar oleh pembayaran lain.');
      }
      return updatedTx;
    }, async () => {
      try {
        await db
          .from('transactions')
          .update({
            paid_amount: txCamel.paidAmount,
            remaining_amount: txCamel.remainingAmount,
            hpp_paid: txCamel.hppPaid,
            profit_paid: txCamel.profitPaid,
            hpp_unpaid: txCamel.hppUnpaid,
            profit_unpaid: txCamel.profitUnpaid,
            payment_status: txCamel.paymentStatus,
            status: txCamel.status
          })
          .eq('id', data.transactionId);
      } catch { /* best effort */ }
    }));

    // Step 3: Update linked receivable
    txSteps.push(createStep('update-receivable', async () => {
      const { data: receivable } = await db
        .from('receivables')
        .select('*')
        .eq('transaction_id', data.transactionId)
        .maybeSingle();
      if (receivable && receivable.status !== 'paid') {
        const { error } = await db
          .from('receivables')
          .update({
            paid_amount: newPaidAmount,
            remaining_amount: Math.max(0, newRemaining),
            status: paymentStatus === 'paid' ? 'paid' : 'active'
          })
          .eq('id', receivable.id);
        if (error) throw error;
      }
      return true;
    }, async () => {
      try {
        const { data: receivable } = await db
          .from('receivables')
          .select('id, status, paid_amount, remaining_amount')
          .eq('transaction_id', data.transactionId)
          .maybeSingle();
        if (receivable) {
          await db
            .from('receivables')
            .update({
              paid_amount: txCamel.paidAmount,
              remaining_amount: txCamel.remainingAmount,
              status: 'active'
            })
            .eq('id', receivable.id);
        }
      } catch { /* best effort */ }
    }));

    // Step 4: Credit destination account balance for sales (atomic)
    if (isSale) {
      if (data.paymentMethod === 'cash' && data.cashBoxId) {
        txSteps.push(createStep('credit-cashbox-sale', async () => {
          await financeEngine.creditPhysical('cash_boxes', data.cashBoxId, data.amount, journalId, 'payment', paymentId, 'Pembayaran tunai dari pelanggan', authUserId);
          return { table: 'cash_boxes' as const, id: data.cashBoxId, amount: data.amount };
        }, async (r) => {
          try { await atomicUpdateBalance(r.table, r.id, -r.amount); } catch { /* best effort */ }
        }));
      }
      if ((data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') && data.bankAccountId) {
        txSteps.push(createStep('credit-bank-sale', async () => {
          await financeEngine.creditPhysical('bank_accounts', data.bankAccountId, data.amount, journalId, 'payment', paymentId, 'Pembayaran transfer dari pelanggan', authUserId);
          return { table: 'bank_accounts' as const, id: data.bankAccountId, amount: data.amount };
        }, async (r) => {
          try { await atomicUpdateBalance(r.table, r.id, -r.amount); } catch { /* best effort */ }
        }));
      }

      // Step 5: Feed pool balances for sale transactions (atomic)
      if (hppPortion > 0) {
        txSteps.push(createStep('credit-pool-hpp-paid', async () => {
          await financeEngine.creditPool('pool_hpp_paid_balance', hppPortion, journalId, 'payment', paymentId, 'Porsi HPP dari pembayaran', authUserId);
          return { key: 'pool_hpp_paid_balance', amount: hppPortion };
        }, async (r) => {
          try { await atomicUpdatePoolBalance(r.key, -r.amount); } catch { /* best effort */ }
        }));
      }
      if (profitPortion > 0) {
        txSteps.push(createStep('credit-pool-profit-paid', async () => {
          await financeEngine.creditPool('pool_profit_paid_balance', profitPortion, journalId, 'payment', paymentId, 'Porsi Profit dari pembayaran', authUserId);
          return { key: 'pool_profit_paid_balance', amount: profitPortion };
        }, async (r) => {
          try { await atomicUpdatePoolBalance(r.key, -r.amount); } catch { /* best effort */ }
        }));
      }
    }

    // Step 6: Debit source account for purchase transactions (atomic)
    if (txCamel.type === 'purchase') {
      // Validation (before any mutations)
      const fundSource = data.fundSource;
      const validFundSources = ['hpp_paid', 'profit_unpaid'];
      if (!fundSource || !validFundSources.includes(fundSource)) {
        throw new Error('Sumber dana (HPP Sudah Terbayar / Profit Sudah Terbayar) wajib dipilih untuk pembelian');
      }

      const purchasePoolKey = fundSource === 'hpp_paid' ? 'pool_hpp_paid_balance' : 'pool_profit_paid_balance';

      // Deduct from pool balance
      txSteps.push(createStep('debit-purchase-pool', async () => {
        await financeEngine.debitPool(purchasePoolKey, data.amount, journalId, 'payment', paymentId, `Pembayaran hutang dari ${fundSource === 'hpp_paid' ? 'HPP' : 'Profit'}`, authUserId);
        return { key: purchasePoolKey, amount: data.amount };
      }, async (r) => {
        try { await atomicUpdatePoolBalance(r.key, r.amount); } catch { /* best effort */ }
      }));

      // Debit from physical account
      if (data.paymentMethod === 'cash' && data.cashBoxId) {
        txSteps.push(createStep('debit-cashbox-purchase', async () => {
          await financeEngine.debitPhysical('cash_boxes', data.cashBoxId, data.amount, journalId, 'payment', paymentId, 'Pembayaran hutang dari brankas', authUserId);
          return { table: 'cash_boxes' as const, id: data.cashBoxId, amount: data.amount };
        }, async (r) => {
          try { await atomicUpdateBalance(r.table, r.id, r.amount); } catch { /* best effort */ }
        }));
      }
      if ((data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') && data.bankAccountId) {
        txSteps.push(createStep('debit-bank-purchase', async () => {
          await financeEngine.debitPhysical('bank_accounts', data.bankAccountId, data.amount, journalId, 'payment', paymentId, 'Pembayaran hutang dari bank', authUserId);
          return { table: 'bank_accounts' as const, id: data.bankAccountId, amount: data.amount };
        }, async (r) => {
          try { await atomicUpdateBalance(r.table, r.id, r.amount); } catch { /* best effort */ }
        }));
      }
    }

    // Execute all steps with compensating rollback
    const [createdPayment] = await runInTransaction(txSteps);
    const payment = createdPayment;

    // Fire-and-forget operations (outside transaction)
    createLog(db, {
      type: 'activity',
      userId: authUserId,
      action: 'payment_created',
      entity: 'transaction',
      entityId: data.transactionId,
      payload: JSON.stringify({ amount: data.amount, method: data.paymentMethod })
    });

    createEvent(db, 'payment_received', {
      transactionId: data.transactionId,
      invoiceNo: txCamel.invoiceNo,
      amount: data.amount
    });

    // Log for fund destination (only for sales)
    if (isSale && (data.cashBoxId || data.bankAccountId)) {
      const paymentCamel = toCamelCase(payment);
      const destLabel = data.paymentMethod === 'cash'
        ? (paymentCamel.cashBox?.name || 'Brankas')
        : (paymentCamel.bankAccount?.name || 'Akun Bank');
      createLog(db, {
        type: 'activity',
        userId: authUserId,
        action: 'payment_deposited',
        entity: data.paymentMethod === 'cash' ? 'cashbox' : 'bankaccount',
        entityId: data.paymentMethod === 'cash' ? data.cashBoxId : data.bankAccountId,
        payload: JSON.stringify({
          amount: data.amount,
          method: data.paymentMethod,
          destination: destLabel,
          transactionId: data.transactionId,
          invoiceNo: txCamel.invoiceNo
        })
      });
    }

    wsPaymentUpdate({ transactionId: data.transactionId, amount: data.amount });

    return NextResponse.json({ payment: toCamelCase(payment) });
    } finally {
      releaseLock();
    }
  } catch (error) {
    console.error('Create payment error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    const status = error instanceof Error && error.message.includes('tidak ditemukan') ? 404 : 
          error instanceof Error && (error.message.includes('melebihi') || error.message.includes('belum disetujui') || error.message.includes('dibatalkan') || error.message.includes('wajib') || error.message.includes('non_negative') || error.message.includes('constraint') || error.message.includes('Stok') || error.message.includes('stok') || error.message.includes('Saldo tidak mencukupi') || error.message.includes('sudah lunas')) ? 400 :
          error instanceof Error && error.message.includes('CONCURRENT_MODIFICATION') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

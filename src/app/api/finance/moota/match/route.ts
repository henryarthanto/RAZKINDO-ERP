import { NextRequest, NextResponse } from 'next/server';
import { verifyAndGetAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';
import { generateId } from '@/lib/supabase-helpers';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { toCamelCase } from '@/lib/supabase-helpers';
import { wsTransactionUpdate, wsFinanceUpdate } from '@/lib/ws-dispatch';

/**
 * POST /api/finance/moota/match
 * 
 * Match a bank mutation to an action:
 * - type: "lunas" — Mark an invoice as paid (create payment, update pools, update receivable)
 * - type: "pool" — Add funds to pool dana (creates finance_ledger for cash flow)
 * - type: "expense" — Record as expense (creates finance_request for cash flow integration)
 * - type: "salary" — Record as salary payment (creates finance_request)
 * - type: "purchase" — Record as purchase/debt payment (creates finance_request)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult || !['super_admin', 'keuangan'].includes(authResult.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { type, mutationId, mutationAmount, mutationDate, mutationDescription, bankAccountId, bankId } = body;

    if (!type || !mutationAmount) {
      return NextResponse.json({ error: 'type dan mutationAmount diperlukan' }, { status: 400 });
    }

    // Support explicit amount from frontend (mutation amount minus admin fee)
    const rawAmount = body.amount ? Number(body.amount) : Math.abs(Number(mutationAmount));
    const amount = Math.abs(rawAmount);
    const adminFee = Math.abs(Number(body.adminFee) || 0);
    const userId = authResult.userId;

    switch (type) {
      case 'lunas': {
        // Mark invoice as lunas — full flow: payment + pools + receivables + cash flow
        const { transactionId } = body;
        if (!transactionId) {
          return NextResponse.json({ error: 'transactionId diperlukan' }, { status: 400 });
        }

        // Get transaction with customer and items
        const { data: tx, error: txError } = await db
          .from('transactions')
          .select(`
            *,
            customer:customers(id, name, phone, cashback_balance, cashback_type, cashback_value),
            items:transaction_items(*, product:products(id, name, avg_hpp, sell_price_per_sub_unit, sub_unit, conversion_rate))
          `)
          .eq('id', transactionId)
          .single();

        if (txError || !tx) {
          return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
        }

        // Validate: must be a sale, approved, not already paid
        if (tx.type !== 'sale') {
          return NextResponse.json({ error: 'Hanya transaksi penjualan yang bisa ditandai lunas' }, { status: 400 });
        }
        if (tx.status !== 'approved') {
          return NextResponse.json({ error: 'Transaksi belum disetujui' }, { status: 400 });
        }
        if (tx.payment_status === 'paid') {
          return NextResponse.json({ error: 'Transaksi sudah lunas' }, { status: 400 });
        }

        const remaining = Math.max(0, Number(tx.remaining_amount) - amount);
        const newPaid = Number(tx.paid_amount) + amount;
        const isLunas = remaining <= 0;

        // Update transaction payment status
        const { error: updateError } = await db
          .from('transactions')
          .update({
            paid_amount: newPaid,
            remaining_amount: remaining,
            payment_status: isLunas ? 'paid' : 'partial',
            updated_at: new Date().toISOString(),
          })
          .eq('id', transactionId);

        if (updateError) throw updateError;

        // Create payment record
        const paymentId = generateId();
        const { error: paymentError } = await db.from('payments').insert({
          id: paymentId,
          transaction_id: transactionId,
          received_by_id: userId,
          amount,
          payment_method: 'transfer',
          bank_account_id: bankAccountId || null,
          notes: `Dari mutasi bank Moota${adminFee > 0 ? ` (Admin: ${adminFee.toLocaleString('id-ID')})` : ''} — ${mutationDescription || mutationDate || ''}`,
          version: 1,
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        });

        if (paymentError) {
          console.error('[Moota Match] Error creating payment:', paymentError);
        }

        // Update bank account balance if bankAccountId provided
        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, amount);
          } catch (err) {
            console.error('[Moota Match] Error updating bank balance:', err);
          }
        }

        // Update receivable status if exists
        try {
          const { data: receivable } = await db
            .from('receivables')
            .select('id')
            .eq('transaction_id', transactionId)
            .eq('status', 'active')
            .maybeSingle();

          if (receivable) {
            await db.from('receivables').update({
              status: isLunas ? 'paid' : 'active',
              paid_amount: newPaid,
              remaining_amount: remaining,
              updated_at: new Date().toISOString(),
            }).eq('id', receivable.id);
          }
        } catch (err) {
          console.error('[Moota Match] Error updating receivable:', err);
        }

        // Update pool balances (HPP paid + Profit paid) — only if fully paid
        if (isLunas && Number(tx.hpp_unpaid) > 0) {
          try {
            const hppUnpaid = Number(tx.hpp_unpaid);
            const profitUnpaid = Number(tx.profit_unpaid);
            const totalUnpaid = hppUnpaid + profitUnpaid;
            const totalPaid = amount;

            if (totalUnpaid > 0 && totalPaid > 0) {
              const hppPortion = Math.round((hppUnpaid / totalUnpaid) * totalPaid);
              const profitPortion = totalPaid - hppPortion;

              // Update pool balances atomically
              if (hppPortion > 0) {
                await atomicUpdatePoolBalance('pool_hpp_paid_balance', hppPortion);
              }
              if (profitPortion > 0) {
                await atomicUpdatePoolBalance('pool_profit_paid_balance', profitPortion);
              }

              // Update transaction hpp/profit paid tracking
              const newHppPaid = Math.min(Number(tx.total_hpp), Number(tx.hpp_paid) + hppPortion);
              const newProfitPaid = Math.min(Number(tx.total_profit), Number(tx.profit_paid) + profitPortion);
              const newHppUnpaid = Math.max(0, Number(tx.total_hpp) - newHppPaid);
              const newProfitUnpaid = Math.max(0, Number(tx.total_profit) - newProfitPaid);

              await db.from('transactions').update({
                hpp_paid: newHppPaid,
                profit_paid: newProfitPaid,
                hpp_unpaid: newHppUnpaid,
                profit_unpaid: newProfitUnpaid,
              }).eq('id', transactionId);

              // Update payment with hpp/profit portions
              await db.from('payments').update({
                hpp_portion: hppPortion,
                profit_portion: profitPortion,
              }).eq('id', paymentId);
            }
          } catch (err) {
            console.error('[Moota Match] Error updating pool balances:', err);
          }
        }

        // Emit WebSocket events
        wsTransactionUpdate({ transactionId, type: 'payment', amount });
        wsFinanceUpdate({ type: 'payment', amount });

        return NextResponse.json({
          success: true,
          message: isLunas ? 'Invoice berhasil ditandai LUNAS!' : `Pembayaran tercatat. Sisa: ${remaining.toLocaleString('id-ID')}`,
          isLunas,
          remaining,
        });
      }

      case 'pool': {
        // Add to pool dana — create finance ledger entry for cash flow integration
        const { poolKey } = body;
        if (!poolKey) {
          return NextResponse.json({ error: 'poolKey diperlukan (pool_hpp_paid_balance / pool_profit_paid_balance)' }, { status: 400 });
        }

        // Update bank balance
        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, amount);
          } catch (err) {
            console.error('[Moota Match] Error updating bank balance:', err);
          }
        }

        // Update pool via atomic setting balance
        const { error: poolError } = await db.rpc('atomic_update_setting_balance', {
          p_key: poolKey,
          p_delta: amount,
          p_min: 0,
        });

        if (poolError) throw poolError;

        // Create a finance_request record so this appears in cash flow (arus kas)
        const poolLabel = poolKey.includes('hpp') ? 'Pool HPP' : poolKey.includes('profit') ? 'Pool Profit' : 'Dana Lain-lain';
        const requestId = generateId();
        const { error: reqError } = await db.from('finance_requests').insert({
          id: requestId,
          type: 'pool_deposit', // Custom type for pool deposits from bank mutations
          amount,
          description: `Setor mutasi ke ${poolLabel} — ${mutationDescription || ''}`,
          source_type: 'bank',
          bank_account_id: bankAccountId || null,
          status: 'processed',
          processed_by_id: userId,
          created_by_id: userId,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          notes: `mutation_id: ${mutationId} | pool: ${poolKey}`,
        });

        if (reqError) {
          console.error('[Moota Match] Error creating pool deposit finance_request:', reqError);
        }

        wsFinanceUpdate({ type: 'pool_deposit', poolKey, amount });

        return NextResponse.json({
          success: true,
          message: `Dana ${poolKey.includes('hpp') ? 'HPP' : poolKey.includes('profit') ? 'Profit' : 'Lain-lain'} berhasil ditambah ${amount.toLocaleString('id-ID')}`,
        });
      }

      case 'expense': {
        // Record as expense — create finance_request so it appears in cash flow (arus kas)
        const { description, categoryId } = body;

        // Deduct from bank account
        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, -amount);
          } catch (err) {
            return NextResponse.json({ error: `Saldo bank tidak mencukupi: ${err}` }, { status: 400 });
          }
        }

        // Create a finance_request with type 'expense' so it appears in cash flow
        const requestId = generateId();
        const { error: reqError } = await db.from('finance_requests').insert({
          id: requestId,
          type: 'expense',
          amount,
          description: description || `Pengeluaran dari mutasi bank — ${mutationDescription || ''}`,
          source_type: 'bank',
          bank_account_id: bankAccountId || null,
          status: 'processed',
          payment_type: 'pay_now',
          processed_by_id: userId,
          created_by_id: userId,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          notes: `mutation_id: ${mutationId}${categoryId ? ` | category_id: ${categoryId}` : ''}`,
        });

        if (reqError) {
          console.error('[Moota Match] Error creating expense finance_request:', reqError);
        }

        wsFinanceUpdate({ type: 'expense', amount });

        return NextResponse.json({
          success: true,
          message: `Pengeluaran Rp ${amount.toLocaleString('id-ID')} berhasil dicatat`,
        });
      }

      case 'salary': {
        // Record as salary payment — create finance_request
        const { targetUserId } = body;

        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, -amount);
          } catch (err) {
            return NextResponse.json({ error: `Saldo bank tidak mencukupi: ${err}` }, { status: 400 });
          }
        }

        // Create a finance request with type 'salary'
        const requestId = generateId();
        const { error: reqError } = await db.from('finance_requests').insert({
          id: requestId,
          type: 'salary',
          amount,
          description: `Pembayaran gaji dari mutasi bank — ${mutationDescription || ''}`,
          target_user_id: targetUserId || null,
          source_type: 'bank',
          bank_account_id: bankAccountId || null,
          status: 'processed',
          payment_type: 'pay_now',
          processed_by_id: userId,
          created_by_id: userId,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          notes: `mutation_id: ${mutationId}`,
        });

        if (reqError) {
          console.error('[Moota Match] Error creating salary request:', reqError);
        }

        wsFinanceUpdate({ type: 'salary', amount });

        return NextResponse.json({
          success: true,
          message: `Pembayaran gaji Rp ${amount.toLocaleString('id-ID')} berhasil dicatat`,
        });
      }

      case 'purchase': {
        // Record as purchase/debt payment — create finance_request
        const { description } = body;

        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, -amount);
          } catch (err) {
            return NextResponse.json({ error: `Saldo bank tidak mencukupi: ${err}` }, { status: 400 });
          }
        }

        const requestId = generateId();
        const { error: reqError } = await db.from('finance_requests').insert({
          id: requestId,
          type: 'purchase',
          amount,
          description: description || `Pembelian dari mutasi bank — ${mutationDescription || ''}`,
          source_type: 'bank',
          bank_account_id: bankAccountId || null,
          status: 'processed',
          payment_type: 'pay_now',
          processed_by_id: userId,
          created_by_id: userId,
          processed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          notes: `mutation_id: ${mutationId}`,
        });

        if (reqError) {
          console.error('[Moota Match] Error creating purchase request:', reqError);
        }

        wsFinanceUpdate({ type: 'purchase', amount });

        return NextResponse.json({
          success: true,
          message: `Pembelian Rp ${amount.toLocaleString('id-ID')} berhasil dicatat`,
        });
      }

      default:
        return NextResponse.json({ error: `Tipe action tidak dikenali: ${type}` }, { status: 400 });
    }
  } catch (error) {
    console.error('[Moota Match] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

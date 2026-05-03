import { NextRequest, NextResponse } from 'next/server';
import { verifyAndGetAuthUser } from '@/lib/token';
import { db } from '@/lib/supabase';
import { generateId } from '@/lib/supabase-helpers';
import { atomicUpdateBalance } from '@/lib/atomic-ops';
import { toCamelCase } from '@/lib/supabase-helpers';
import { wsTransactionUpdate, wsFinanceUpdate } from '@/lib/ws-dispatch';

/**
 * POST /api/finance/moota/match
 * 
 * Match a bank mutation to an action:
 * - type: "lunas" — Mark an invoice as paid (create payment)
 * - type: "pool" — Add funds to pool dana
 * - type: "expense" — Record as expense
 * - type: "salary" — Record as salary payment
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

    const amount = Math.abs(Number(mutationAmount));
    const userId = authResult.userId;

    switch (type) {
      case 'lunas': {
        // Mark invoice as lunas
        const { transactionId } = body;
        if (!transactionId) {
          return NextResponse.json({ error: 'transactionId diperlukan' }, { status: 400 });
        }

        // Get transaction
        const { data: tx, error: txError } = await db
          .from('transactions')
          .select('*')
          .eq('id', transactionId)
          .single();

        if (txError || !tx) {
          return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
        }

        const remaining = Math.max(0, Number(tx.remaining_amount) - amount);
        const newPaid = Number(tx.paid_amount) + amount;
        const isLunas = remaining <= 0;

        // Update transaction
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
          notes: `Dari mutasi bank Moota — ${mutationDescription || mutationDate || ''}`,
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
        // Add to pool dana
        const { poolKey } = body; // e.g., 'pool_hpp_paid_balance', 'pool_profit_paid_balance'
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

        wsFinanceUpdate({ type: 'pool_deposit', poolKey, amount });

        return NextResponse.json({
          success: true,
          message: `Dana ${poolKey.includes('hpp') ? 'HPP' : 'Profit'} berhasil ditambah ${amount.toLocaleString('id-ID')}`,
        });
      }

      case 'expense': {
        // Record as expense
        const { description, categoryId } = body;

        // Deduct from bank account
        if (bankAccountId) {
          try {
            await atomicUpdateBalance('bank_accounts', bankAccountId, -amount);
          } catch (err) {
            return NextResponse.json({ error: `Saldo bank tidak mencukupi: ${err}` }, { status: 400 });
          }
        }

        // Create expense record
        const expenseId = generateId();
        const { error: expError } = await db.from('expenses').insert({
          id: expenseId,
          amount,
          description: description || `Pengeluaran dari mutasi bank — ${mutationDescription || ''}`,
          category_id: categoryId || null,
          created_by_id: userId,
          bank_account_id: bankAccountId || null,
          expense_date: mutationDate ? new Date(mutationDate).toISOString() : new Date().toISOString(),
          created_at: new Date().toISOString(),
        });

        if (expError) {
          console.error('[Moota Match] Error creating expense:', expError);
        }

        wsFinanceUpdate({ type: 'expense', amount });

        return NextResponse.json({
          success: true,
          message: `Pengeluaran Rp ${amount.toLocaleString('id-ID')} berhasil dicatat`,
        });
      }

      case 'salary': {
        // Record as salary payment
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
          processed_by_id: userId,
          created_by_id: userId,
          created_at: new Date().toISOString(),
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

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { wsTransactionUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { runInTransaction } from '@/lib/db-transaction';

const CANCEL_MIN_BALANCE = -999999999999999;

/**
 * POST /api/transactions/[id]/cancel
 *
 * Cancel a transaction using SAGA pattern with compensating transactions.
 * Each step has a rollback to ensure data consistency on failure.
 *
 * Flow:
 *   Step 1: Fetch transaction + validate
 *   Step 2: Reverse stock (sale: restore, purchase: reverse HPP)
 *   Step 3: Cancel receivable
 *   Step 4: Reverse payment balances
 *   Step 5: Reverse pool balances
 *   Step 6: Reverse courier cash
 *   Step 7: Delete payments
 *   Step 8: Reverse customer stats + cashback
 *   Step 9: Set transaction status to cancelled
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;

    // ── Fetch transaction ──
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (txError) {
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }

    if (!transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    const txCamel = toCamelCase(transaction);

    if (txCamel.status === 'cancelled') {
      return NextResponse.json({ error: 'Transaksi sudah dibatalkan' }, { status: 400 });
    }

    // Track rollback data
    let reversedStockItems: Array<{ productId: string; qty: number; unitProductId?: string; type: 'sale' | 'purchase'; originalHpp?: number }> = [];
    let reversedPayments: Array<{ cashBoxId?: string; bankAccountId?: string; amount: number; delta: number }> = [];
    let reversedPoolHpp = 0;
    let reversedPoolProfit = 0;
    let reversedCourierCash = 0;
    let courierCashId = '';
    let deletedPaymentIds: string[] = [];
    let receivableId = '';

    // Only approved/paid transactions need full reversal
    if (txCamel.status === 'approved' || txCamel.status === 'paid') {

      await runInTransaction([

        // Step 1: Fetch items + batch products
        {
          name: 'fetch-items-and-products',
          execute: async () => {
            const { data: items } = await db.from('transaction_items').select('*').eq('transaction_id', id);

            const allProductIds = [...new Set((items || []).map((i: any) => (toCamelCase(i) || {}).productId).filter(Boolean))];
            const { data: productsBatch } = await db
              .from('products')
              .select('*, unit_products:unit_products(*)')
              .in('id', allProductIds);

            // Fetch unit_products for per_unit products
            const perUnitProductIds = (productsBatch || [])
              .filter((p: any) => p.stock_type === 'per_unit')
              .map((p: any) => p.id);
            let unitProductLookup = new Map<string, any>();
            if (perUnitProductIds.length > 0) {
              const { data: unitProductsBatch } = await db
                .from('unit_products')
                .select('*')
                .eq('unit_id', txCamel.unitId)
                .in('product_id', perUnitProductIds);
              unitProductLookup = new Map((unitProductsBatch || []).map((up: any) => [up.product_id, up]));
            }

            return { items: items || [], productLookup: new Map((productsBatch || []).map((p: any) => [p.id, p])), unitProductLookup };
          },
        },

        // Step 2: Reverse stock
        {
          name: 'reverse-stock',
          execute: async (fetchResult) => {
            const { items, productLookup, unitProductLookup } = fetchResult as any;

            for (const item of items) {
              const itemCamel = toCamelCase(item);
              const stockQty = itemCamel.qtyInSubUnit ?? itemCamel.qty;
              const product = productLookup.get(itemCamel.productId);
              if (!product) continue;

              if (txCamel.type === 'sale') {
                // RESTORE stock for sale
                if (product.stock_type === 'per_unit') {
                  const unitProduct = unitProductLookup.get(itemCamel.productId);
                  if (unitProduct) {
                    await db.rpc('increment_unit_stock', { p_unit_product_id: unitProduct.id, p_qty: stockQty });
                    reversedStockItems.push({ productId: itemCamel.productId, qty: stockQty, unitProductId: unitProduct.id, type: 'sale' });
                  } else {
                    await db.rpc('increment_stock', { p_product_id: itemCamel.productId, p_qty: stockQty });
                    reversedStockItems.push({ productId: itemCamel.productId, qty: stockQty, type: 'sale' });
                  }
                } else {
                  await db.rpc('increment_stock', { p_product_id: itemCamel.productId, p_qty: stockQty });
                  reversedStockItems.push({ productId: itemCamel.productId, qty: stockQty, type: 'sale' });
                }
              } else if (txCamel.type === 'purchase') {
                // REVERSE stock for purchase (remove stock + HPP)
                const unitProductId = product.stock_type === 'per_unit'
                  ? (unitProductLookup.get(itemCamel.productId)?.id || null)
                  : null;

                const { error: reverseError } = await db.rpc('reverse_purchase_stock_with_hpp', {
                  p_product_id: itemCamel.productId,
                  p_qty: stockQty,
                  p_original_hpp: Number(itemCamel.hpp) || 0,
                  p_unit_product_id: unitProductId,
                });
                if (reverseError) {
                  throw new Error(`Gagal membatalkan stok pembelian untuk produk ${itemCamel.productId}`);
                }
                reversedStockItems.push({ productId: itemCamel.productId, qty: stockQty, type: 'purchase', unitProductId: unitProductId || undefined, originalHpp: Number(itemCamel.hpp) || 0 });
              }
            }

            // Batch recalc global stock for per_unit sale products
            if (txCamel.type === 'sale') {
              const perUnitIds = [...new Set(
                reversedStockItems.filter(i => i.unitProductId).map(i => i.productId)
              )];
              await Promise.all(perUnitIds.map(pid =>
                db.rpc('recalc_global_stock', { p_product_id: pid }).catch((err: any) =>
                  console.error('[CANCEL] recalc_global_stock failed for', pid, err.message)
                )
              ));
            }

            return true;
          },
          rollback: async () => {
            // Reverse the stock reversal (re-deduct for sale, re-add for purchase)
            for (const item of reversedStockItems.reverse()) {
              try {
                if (item.type === 'sale') {
                  if (item.unitProductId) {
                    await db.rpc('decrement_unit_stock', { p_unit_product_id: item.unitProductId, p_qty: item.qty });
                  } else {
                    await db.rpc('decrement_stock', { p_product_id: item.productId, p_qty: item.qty });
                  }
                } else if (item.type === 'purchase') {
                  await db.rpc('increment_stock_with_hpp', {
                    p_product_id: item.productId,
                    p_qty: item.qty,
                    p_new_hpp: item.originalHpp || 0,
                  });
                }
              } catch (e) {
                console.error('[SAGA] Rollback stock reverse failed:', e);
              }
            }
          },
        },

        // Step 3: Cancel receivable
        {
          name: 'cancel-receivable',
          execute: async () => {
            const { data: receivable } = await db
              .from('receivables')
              .select('*')
              .eq('transaction_id', id)
              .maybeSingle();

            if (receivable && receivable.status !== 'cancelled' && receivable.status !== 'paid') {
              receivableId = receivable.id;
              await db.from('receivables').update({ status: 'cancelled' }).eq('id', receivable.id);
            }
            return true;
          },
          rollback: async () => {
            if (receivableId) {
              await db.from('receivables').update({ status: 'pending' }).eq('id', receivableId).catch(() => {});
            }
          },
        },

        // Step 4: Reverse payment balances
        {
          name: 'reverse-payments',
          execute: async () => {
            const { data: payments } = await db.from('payments').select('*').eq('transaction_id', id);

            for (const payment of (payments || [])) {
              deletedPaymentIds.push(payment.id);
              const delta = txCamel.type === 'sale' ? -(Number(payment.amount) || 0) : (Number(payment.amount) || 0);

              if (payment.cash_box_id) {
                try {
                  await atomicUpdateBalance('cash_boxes', payment.cash_box_id, delta, CANCEL_MIN_BALANCE);
                  reversedPayments.push({ cashBoxId: payment.cash_box_id, amount: Number(payment.amount), delta });
                } catch { /* best effort */ }
              }
              if (payment.bank_account_id) {
                try {
                  await atomicUpdateBalance('bank_accounts', payment.bank_account_id, delta, CANCEL_MIN_BALANCE);
                  reversedPayments.push({ bankAccountId: payment.bank_account_id, amount: Number(payment.amount), delta });
                } catch { /* best effort */ }
              }
            }
            return payments || [];
          },
          rollback: async (payments) => {
            // Re-apply the reversed deltas
            for (const rp of reversedPayments.reverse()) {
              try {
                if (rp.cashBoxId) {
                  await atomicUpdateBalance('cash_boxes', rp.cashBoxId, -rp.delta, CANCEL_MIN_BALANCE);
                }
                if (rp.bankAccountId) {
                  await atomicUpdateBalance('bank_accounts', rp.bankAccountId, -rp.delta, CANCEL_MIN_BALANCE);
                }
              } catch { /* best effort rollback */ }
            }
          },
        },

        // Step 5: Reverse pool balances
        {
          name: 'reverse-pool-balances',
          execute: async (payments) => {
            if (txCamel.type !== 'sale') return true;

            for (const payment of (payments || [])) {
              reversedPoolHpp += Number(payment.hpp_portion) || 0;
              reversedPoolProfit += Number(payment.profit_portion) || 0;
            }

            if (reversedPoolHpp > 0) {
              try { await atomicUpdatePoolBalance('pool_hpp_paid_balance', -reversedPoolHpp, CANCEL_MIN_BALANCE); } catch { /* best effort */ }
            }
            if (reversedPoolProfit > 0) {
              try { await atomicUpdatePoolBalance('pool_profit_paid_balance', -reversedPoolProfit, CANCEL_MIN_BALANCE); } catch { /* best effort */ }
            }
            return true;
          },
          rollback: async () => {
            // Re-add pool balances
            if (reversedPoolHpp > 0) {
              try { await atomicUpdatePoolBalance('pool_hpp_paid_balance', reversedPoolHpp, CANCEL_MIN_BALANCE); } catch { /* best effort */ }
            }
            if (reversedPoolProfit > 0) {
              try { await atomicUpdatePoolBalance('pool_profit_paid_balance', reversedPoolProfit, CANCEL_MIN_BALANCE); } catch { /* best effort */ }
            }
          },
        },

        // Step 6: Reverse courier cash
        {
          name: 'reverse-courier-cash',
          execute: async () => {
            if (!txCamel.deliveredAt || !txCamel.courierId || txCamel.paymentMethod !== 'cash' || txCamel.type !== 'sale') {
              return true;
            }

            const { data: courierCash } = await db
              .from('courier_cash')
              .select('*')
              .eq('courier_id', txCamel.courierId)
              .eq('unit_id', txCamel.unitId)
              .maybeSingle();

            if (courierCash) {
              courierCashId = courierCash.id;
              reversedCourierCash = Math.min(txCamel.paidAmount || 0, courierCash.balance);
              await db.from('courier_cash').update({
                balance: courierCash.balance - reversedCourierCash,
                total_collected: courierCash.total_collected - reversedCourierCash,
              }).eq('id', courierCash.id);
            }
            return true;
          },
          rollback: async () => {
            if (courierCashId && reversedCourierCash > 0) {
              await db.from('courier_cash').update({
                balance: db.raw('balance + ?' as any, [reversedCourierCash]),
                total_collected: db.raw('total_collected + ?' as any, [reversedCourierCash]),
              }).eq('id', courierCashId).catch(() => {});
            }
          },
        },

        // Step 7: Delete payment records
        {
          name: 'delete-payments',
          execute: async () => {
            if (deletedPaymentIds.length > 0) {
              await db.from('payments').delete().in('id', deletedPaymentIds);
            }
            return true;
          },
          rollback: async () => {
            // Cannot easily rollback deleted payments — this is best-effort
            console.warn('[SAGA] Cannot rollback deleted payment records. Manual intervention may be needed.');
          },
        },

        // Step 8: Reverse customer stats + cashback
        {
          name: 'reverse-customer-stats',
          execute: async () => {
            if (!txCamel.customerId || txCamel.type !== 'sale') return true;

            try {
              await db.rpc('atomic_increment_customer_stats', {
                p_customer_id: txCamel.customerId,
                p_order_delta: -1,
                p_spent_delta: -(txCamel.total || 0),
              });
            } catch (statsErr) {
              console.error('[CANCEL] atomic_increment_customer_stats RPC failed (non-blocking):', statsErr);
            }

            // Reverse cashback
            try {
              const { data: cbLog } = await db
                .from('cashback_log')
                .select('id, amount, customer_id')
                .eq('transaction_id', id)
                .eq('type', 'earned')
                .maybeSingle();
              if (cbLog && cbLog.amount > 0) {
                try {
                  await db.rpc('atomic_deduct_cashback', {
                    p_customer_id: cbLog.customer_id,
                    p_delta: cbLog.amount,
                  });
                } catch {
                  const { data: cbCustomer } = await db
                    .from('customers')
                    .select('cashback_balance')
                    .eq('id', cbLog.customer_id)
                    .maybeSingle();
                  if (cbCustomer) {
                    await db.from('customers').update({
                      cashback_balance: Math.max(0, (cbCustomer.cashback_balance || 0) - cbLog.amount),
                    }).eq('id', cbLog.customer_id);
                  }
                }
                await db.from('cashback_log').update({
                  type: 'reversed',
                  description: `Dibatalkan — Rp ${cbLog.amount.toLocaleString('id-ID')} dikembalikan dari cashback (pembatalan invoice)`,
                }).eq('id', cbLog.id);
              }
            } catch (cbErr) {
              console.error('[CANCEL] Failed to reverse cashback (non-blocking):', cbErr);
            }

            return true;
          },
          rollback: async () => {
            if (!txCamel.customerId || txCamel.type !== 'sale') return;
            try {
              await db.rpc('atomic_increment_customer_stats', {
                p_customer_id: txCamel.customerId,
                p_order_delta: 1,
                p_spent_delta: txCamel.total || 0,
              });
            } catch { /* best effort */ }
          },
        },
      ]);

    } else {
      // Pending transactions — cancel receivable + reverse stats only
      const { data: pendingReceivable } = await db
        .from('receivables')
        .select('*')
        .eq('transaction_id', id)
        .maybeSingle();
      if (pendingReceivable && pendingReceivable.status !== 'cancelled' && pendingReceivable.status !== 'paid') {
        await db.from('receivables').update({ status: 'cancelled' }).eq('id', pendingReceivable.id);
      }

      if (txCamel.customerId && txCamel.type === 'sale') {
        try {
          await db.rpc('atomic_increment_customer_stats', {
            p_customer_id: txCamel.customerId,
            p_order_delta: -1,
            p_spent_delta: -(txCamel.total || 0),
          });
        } catch (statsErr) {
          console.error('[CANCEL] atomic_increment_customer_stats failed for pending tx (non-blocking):', statsErr);
        }
      }
    }

    // ── Final: Set transaction status to cancelled (optimistic lock) ──
    const { data: cancelledTx, error: cancelUpdateError } = await db
      .from('transactions')
      .update({
        status: 'cancelled',
        paid_amount: 0,
        remaining_amount: txCamel.total,
        payment_status: 'unpaid',
        hpp_paid: 0,
        profit_paid: 0,
        hpp_unpaid: txCamel.totalHpp,
        profit_unpaid: txCamel.totalProfit,
      })
      .eq('id', id)
      .neq('status', 'cancelled');

    if (cancelUpdateError) {
      console.error('[CANCEL] Failed to update transaction status:', cancelUpdateError);
      return NextResponse.json({ error: 'Gagal membatalkan transaksi — kemungkinan dibatalkan secara bersamaan' }, { status: 409 });
    }
    if (!cancelledTx) {
      return NextResponse.json({ error: 'Transaksi sudah dibatalkan atau status berubah secara bersamaan' }, { status: 409 });
    }

    // ── Logging & Events ──
    createLog(db, {
      type: 'audit',
      action: 'transaction_cancelled',
      entity: 'transaction',
      entityId: id,
      message: 'Transaction ' + txCamel.invoiceNo + ' cancelled',
    });

    createEvent(db, 'transaction_cancelled', {
      transactionId: id,
      invoiceNo: txCamel.invoiceNo,
    });

    const { data: updatedTransaction, error: refetchError } = await db
      .from('transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (refetchError) {
      console.error('Refetch after cancel failed:', refetchError);
    }

    wsTransactionUpdate({ invoiceNo: txCamel.invoiceNo, type: txCamel.type, status: 'cancelled', unitId: txCamel.unitId });

    return NextResponse.json({ transaction: toCamelCase(updatedTransaction || cancelledTx) });
  } catch (error) {
    console.error('Cancel transaction error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

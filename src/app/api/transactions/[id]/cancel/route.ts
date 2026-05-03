import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { wsTransactionUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';

const CANCEL_MIN_BALANCE = -999999999999999;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Only super_admin can cancel/delete transactions
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (txError) {
      return NextResponse.json({ error: txError.message }, { status: 500 });
    }

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    const txCamel = toCamelCase(transaction);

    if (txCamel.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Transaksi sudah dibatalkan' },
        { status: 400 }
      );
    }

    // Sequential operations (no transactions in Supabase JS)
    if (txCamel.status === 'approved' || txCamel.status === 'paid') {
      // Get transaction items
      const { data: items } = await db
        .from('transaction_items')
        .select('*')
        .eq('transaction_id', id);

      // Restore stock for sale/cancel stock for purchase
      // OPTIMIZATION: Batch-fetch all products before the loop (eliminates N+1)
      const allItemProductIds = [...new Set((items || []).map((i: any) => (toCamelCase(i) || {}).productId).filter(Boolean))];
      const { data: cancelProductsBatch } = await db
        .from('products')
        .select('*, unit_products:unit_products(*)')
        .in('id', allItemProductIds);
      const cancelProductLookup = new Map((cancelProductsBatch || []).map((p: any) => [p.id, p]));

      // OPTIMIZATION: Batch-fetch all unit_products for this unit (eliminates N+1 per-item queries)
      const perUnitProductIds = (cancelProductsBatch || [])
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

      for (const item of (items || [])) {
        const itemCamel = toCamelCase(item);
        const stockQty = itemCamel.qtyInSubUnit ?? itemCamel.qty;
        
        if (txCamel.type === 'sale') {
          const product = cancelProductLookup.get(itemCamel.productId);
          if (!product) continue;
          
          if (product.stock_type === 'per_unit') {
            const unitProduct = unitProductLookup.get(itemCamel.productId);
            
            if (unitProduct) {
              // Use atomic RPC for stock restoration
              const { error: rpcError } = await db.rpc('increment_unit_stock', {
                p_unit_product_id: unitProduct.id,
                p_qty: stockQty,
              });
              if (rpcError) {
                console.error('[CANCEL] Failed to increment unit stock via RPC, falling back:', rpcError.message);
                await db
                  .from('unit_products')
                  .update({ stock: unitProduct.stock + stockQty })
                  .eq('id', unitProduct.id);
              }
              // Note: recalc_global_stock deferred to after the loop
            } else {
              const { error: rpcError } = await db.rpc('increment_stock', {
                p_product_id: itemCamel.productId,
                p_qty: stockQty,
              });
              if (rpcError) {
                await db
                  .from('products')
                  .update({ global_stock: product.global_stock + stockQty })
                  .eq('id', itemCamel.productId);
              }
            }
          } else {
            // Use atomic RPC for centralized stock restoration
            const { error: rpcError } = await db.rpc('increment_stock', {
              p_product_id: itemCamel.productId,
              p_qty: stockQty,
            });
            if (rpcError) {
              await db
                .from('products')
                .update({ global_stock: product.global_stock + stockQty })
                .eq('id', itemCamel.productId);
            }
          }
        } else if (txCamel.type === 'purchase') {
          // RACE FIX #1: Use atomic RPC to reverse stock + HPP in a single locked operation
          const product = cancelProductLookup.get(itemCamel.productId);
          if (product) {
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
              console.error('[CANCEL] reverse_purchase_stock_with_hpp RPC failed:', reverseError.message);
              throw new Error(`Gagal membatalkan stok pembelian untuk produk ${itemCamel.productId}: ${reverseError.message}`);
            }
          }
        }
      }

      // OPTIMIZATION: Batch recalc global stock for all per_unit products affected
      // (deferred from the per-item loop above to avoid N+1 RPC calls)
      if (perUnitProductIds.length > 0 && txCamel.type === 'sale') {
        const affectedProductIds = [...new Set((items || [])
          .map((i: any) => toCamelCase(i))
          .filter((ic: any) => {
            const p = cancelProductLookup.get(ic.productId);
            return p && p.stock_type === 'per_unit';
          })
          .map((ic: any) => ic.productId))];
        await Promise.all(affectedProductIds.map(pid =>
          db.rpc('recalc_global_stock', { p_product_id: pid }).catch((err: any) =>
            console.error('[CANCEL] recalc_global_stock failed for', pid, err.message)
          )
        ));
      }

      // Cancel linked receivable
      const { data: receivable } = await db
        .from('receivables')
        .select('*')
        .eq('transaction_id', id)
        .maybeSingle();
      if (receivable && receivable.status !== 'cancelled' && receivable.status !== 'paid') {
        await db
          .from('receivables')
          .update({ status: 'cancelled' })
          .eq('id', receivable.id);
      }

      // Reverse all financial balances from linked payments
      const { data: payments } = await db
        .from('payments')
        .select('*')
        .eq('transaction_id', id);

      for (const payment of (payments || [])) {
        // Sale: money was credited → decrement to reverse
        // Purchase: money was debited → increment to reverse
        if (payment.cash_box_id) {
          const delta = txCamel.type === 'sale' ? -(Number(payment.amount) || 0) : (Number(payment.amount) || 0);
          try {
            await atomicUpdateBalance('cash_boxes', payment.cash_box_id, delta, CANCEL_MIN_BALANCE);
          } catch { /* best effort on cancellation rollback */ }
        }
        if (payment.bank_account_id) {
          const delta = txCamel.type === 'sale' ? -(Number(payment.amount) || 0) : (Number(payment.amount) || 0);
          try {
            await atomicUpdateBalance('bank_accounts', payment.bank_account_id, delta, CANCEL_MIN_BALANCE);
          } catch { /* best effort on cancellation rollback */ }
        }
      }

      // Reverse pool balances from payments (only for sale transactions)
      if (txCamel.type === 'sale') {
        let totalHppToReverse = 0;
        let totalProfitToReverse = 0;
        for (const payment of (payments || [])) {
          totalHppToReverse += Number(payment.hpp_portion) || 0;
          totalProfitToReverse += Number(payment.profit_portion) || 0;
        }

        if (totalHppToReverse > 0) {
          try {
            await atomicUpdatePoolBalance('pool_hpp_paid_balance', -totalHppToReverse, CANCEL_MIN_BALANCE);
          } catch { /* best effort on cancellation rollback */ }
        }
        if (totalProfitToReverse > 0) {
          try {
            await atomicUpdatePoolBalance('pool_profit_paid_balance', -totalProfitToReverse, CANCEL_MIN_BALANCE);
          } catch { /* best effort on cancellation rollback */ }
        }
      }

      // Reverse CourierCash if this was a cash delivery
      if (txCamel.deliveredAt && txCamel.courierId && txCamel.paymentMethod === 'cash' && txCamel.type === 'sale') {
        const { data: courierCash } = await db
          .from('courier_cash')
          .select('*')
          .eq('courier_id', txCamel.courierId)
          .eq('unit_id', txCamel.unitId)
          .maybeSingle();
        if (courierCash) {
          const reverseAmount = Math.min(txCamel.paidAmount || 0, courierCash.balance);
          await db
            .from('courier_cash')
            .update({
              balance: courierCash.balance - reverseAmount,
              total_collected: courierCash.total_collected - reverseAmount
            })
            .eq('id', courierCash.id);
        }
      }

      // Delete all payment records
      await db
        .from('payments')
        .delete()
        .eq('transaction_id', id);

      // RACE FIX #2: Reverse customer stats atomically for sale transactions
      if (txCamel.customerId && txCamel.type === 'sale') {
        try {
          await db.rpc('atomic_increment_customer_stats', {
            p_customer_id: txCamel.customerId,
            p_order_delta: -1,
            p_spent_delta: -(txCamel.total || 0),
          });
        } catch (statsErr) {
          console.error('[CANCEL] atomic_increment_customer_stats RPC failed (non-blocking):', statsErr);
        }

        // Reverse cashback if any was given for this transaction
        try {
          const { data: cbLog } = await db
            .from('cashback_log')
            .select('id, amount, customer_id')
            .eq('transaction_id', id)
            .eq('type', 'earned')
            .maybeSingle();
          if (cbLog && cbLog.amount > 0) {
            // Deduct cashback balance (use RPC if available, fallback to read-then-write)
            try {
              // BUG FIX #5: Changed p_amount → p_delta to match RPC signature
              await db.rpc('atomic_deduct_cashback', {
                p_customer_id: cbLog.customer_id,
                p_delta: cbLog.amount,
              });
            } catch {
              // RPC may not exist — fallback to read-then-write
              const { data: cbCustomer, error: cbError } = await db
                .from('customers')
                .select('cashback_balance')
                .eq('id', cbLog.customer_id)
                .maybeSingle();
              if (cbError) {
                console.error('[CANCEL] Failed to fetch customer for cashback reverse:', cbError);
              } else if (cbCustomer) {
                await db
                  .from('customers')
                  .update({ cashback_balance: Math.max(0, (cbCustomer.cashback_balance || 0) - cbLog.amount) })
                  .eq('id', cbLog.customer_id);
              }
            }
            // Archive the cashback log entry
            await db
              .from('cashback_log')
              .update({
                type: 'reversed',
                description: `Dibatalkan — Rp ${cbLog.amount.toLocaleString('id-ID')} dikembalikan dari cashback (pembatalan invoice)`,
              })
              .eq('id', cbLog.id);
          }
        } catch (cbReverseErr) {
          console.error('[CANCEL] Failed to reverse cashback (non-blocking):', cbReverseErr);
        }
      }
    } else {
      // Pending transactions — cancel linked receivable
      const { data: pendingReceivable } = await db
        .from('receivables')
        .select('*')
        .eq('transaction_id', id)
        .maybeSingle();
      if (pendingReceivable && pendingReceivable.status !== 'cancelled' && pendingReceivable.status !== 'paid') {
        await db
          .from('receivables')
          .update({ status: 'cancelled' })
          .eq('id', pendingReceivable.id);
      }

      // RACE FIX #2: Reverse customer stats atomically for pending sale transactions
      if (txCamel.customerId && txCamel.type === 'sale') {
        try {
          await db.rpc('atomic_increment_customer_stats', {
            p_customer_id: txCamel.customerId,
            p_order_delta: -1,
            p_spent_delta: -(txCamel.total || 0),
          });
        } catch (statsErr) {
          console.error('[CANCEL] atomic_increment_customer_stats RPC failed for pending tx (non-blocking):', statsErr);
        }
      }
    }

    // Update transaction status + reset payment fields
    // SECURITY: Add optimistic lock to prevent TOCTOU race with concurrent payments
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

    // Log
    createLog(db, {
      type: 'audit',
      action: 'transaction_cancelled',
      entity: 'transaction',
      entityId: id,
      message: 'Transaction ' + txCamel.invoiceNo + ' cancelled'
    });

    createEvent(db, 'transaction_cancelled', {
      transactionId: id,
      invoiceNo: txCamel.invoiceNo
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

    // BUG FIX: Use cancelledTx as fallback if refetch fails
    return NextResponse.json({ transaction: toCamelCase(updatedTransaction || cancelledTx) });
  } catch (error) {
    console.error('Cancel transaction error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

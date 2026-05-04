import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { wsTransactionUpdate, wsNotifyAll } from '@/lib/ws-dispatch';
import { runInTransaction } from '@/lib/db-transaction';

/**
 * POST /api/transactions/[id]/approve
 *
 * Approve a pending transaction using SAGA pattern:
 *   Step 1: Acquire optimistic lock (pending → approved)
 *   Step 2: Deduct stock (sales) / Add stock (purchases) per item
 *   Step 3: Sync unit_products for per_unit items
 *   Rollback on failure: reverse status + reverse stock changes
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Auth & RBAC ──
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authUserId = authResult.userId;
    const authUser = authResult.user;

    const { fetchEffectiveRolesFromDB } = await import('@/lib/role-permissions');
    const effectiveRoles = await fetchEffectiveRolesFromDB(db, authUserId);
    if (!effectiveRoles.includes('super_admin') && !effectiveRoles.includes('keuangan')) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat menyetujui transaksi' }, { status: 403 });
    }

    const { id } = await params;

    // ── Fetch transaction ──
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select(`
        *,
        items:transaction_items(*),
        unit:units(*),
        created_by:users!created_by_id(*),
        customer:customers(*)
      `)
      .eq('id', id)
      .maybeSingle();

    if (txError) {
      console.error('Approve tx DB error:', txError);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }

    if (!transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    const txCamel = toCamelCase(transaction);

    // ── SAGA: Compensating Transaction Pattern ──
    // Track which items had stock deducted for rollback
    const deductedItems: Array<{ productId: string; qty: number; unitProductId?: string; type: 'sale' | 'purchase'; originalHpp?: number }> = [];

    await runInTransaction([
      // Step 1: Optimistic lock — atomically set pending → approved
      {
        name: 'acquire-optimistic-lock',
        execute: async () => {
          const { data: lockResult, error: lockError } = await db
            .from('transactions')
            .update({ status: 'approved' })
            .eq('id', id)
            .neq('status', 'approved')
            .neq('status', 'cancelled')
            .select('id')
            .maybeSingle();

          if (lockError) throw new Error('Gagal mengunci transaksi');
          if (!lockResult) throw new Error('Transaksi sudah diproses');
          return true;
        },
        rollback: async () => {
          // Revert status back to pending
          await db.from('transactions').update({ status: 'pending' }).eq('id', id);
        },
      },

      // Step 2: Batch fetch products (eliminates N+1)
      {
        name: 'fetch-products',
        execute: async () => {
          const allItemProductIds = [...new Set<string>((txCamel.items || []).map((i: any) => i.productId).filter(Boolean))];
          const { data: productsBatch } = await db
            .from('products')
            .select('*, unit_products:unit_products(*)')
            .in('id', allItemProductIds);
          return new Map((productsBatch || []).map((p: any) => [p.id, p]));
        },
      },

      // Step 3: Process stock changes for each item
      {
        name: 'process-stock-changes',
        execute: async (productLookupMap) => {
          const productLookup = productLookupMap as Map<string, any>;

          for (const item of txCamel.items || []) {
            const product = productLookup.get(item.productId);
            if (!product || product.track_stock === false) continue;

            const stockQty = item.qtyInSubUnit ?? item.qty;

            if (txCamel.type === 'sale') {
              // ── SALE: Deduct stock ──
              if (product.stock_type === 'per_unit') {
                const { data: unitProduct } = await db
                  .from('unit_products')
                  .select('*')
                  .eq('unit_id', txCamel.unitId)
                  .eq('product_id', item.productId)
                  .maybeSingle();

                if (unitProduct) {
                  const { error: rpcError } = await db.rpc('decrement_unit_stock', {
                    p_unit_product_id: unitProduct.id,
                    p_qty: stockQty,
                  });
                  if (rpcError) {
                    throw new Error(`Stok unit tidak cukup untuk ${product.name} saat approve. ${rpcError.message}`);
                  }
                  deductedItems.push({ productId: item.productId, qty: stockQty, unitProductId: unitProduct.id, type: 'sale' });
                }
                // Recalculate global stock
                await db.rpc('recalc_global_stock', { p_product_id: item.productId }).catch(
                  (err: any) => console.warn('recalc_global_stock warning:', err.message)
                );
              } else {
                const { error: rpcError } = await db.rpc('decrement_stock', {
                  p_product_id: item.productId,
                  p_qty: stockQty,
                });
                if (rpcError) {
                  throw new Error(`Stok tidak cukup untuk ${product.name} saat approve. ${rpcError.message}`);
                }
                deductedItems.push({ productId: item.productId, qty: stockQty, type: 'sale' });
              }
            } else if (txCamel.type === 'purchase') {
              // ── PURCHASE: Add stock with HPP ──
              const { error: rpcError } = await db.rpc('increment_stock_with_hpp', {
                p_product_id: item.productId,
                p_qty: stockQty,
                p_new_hpp: item.hpp || 0,
              });
              if (rpcError) {
                throw new Error(`Gagal menambahkan stok+HPP untuk ${product.name}: ${rpcError.message}`);
              }

              deductedItems.push({ productId: item.productId, qty: stockQty, type: 'purchase', originalHpp: item.hpp || 0 });

              // Sync unit_products for per_unit products
              const { data: unitProduct } = await db
                .from('unit_products')
                .select('*')
                .eq('unit_id', txCamel.unitId)
                .eq('product_id', item.productId)
                .maybeSingle();

              if (unitProduct) {
                await db.from('unit_products').update({ stock: unitProduct.stock + stockQty }).eq('id', unitProduct.id);
              } else {
                await db.from('unit_products').insert({
                  id: crypto.randomUUID(),
                  unit_id: txCamel.unitId,
                  product_id: item.productId,
                  stock: stockQty,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              }

              if (product.stock_type === 'per_unit') {
                await db.rpc('recalc_global_stock', { p_product_id: item.productId }).catch(
                  (err: any) => console.warn('recalc_global_stock (purchase):', err.message)
                );
              }
            }
          }
          return deductedItems;
        },
        rollback: async (items) => {
          // Reverse stock changes in reverse order
          const itemsToReverse = (items || []) as typeof deductedItems;
          for (let i = itemsToReverse.length - 1; i >= 0; i--) {
            const item = itemsToReverse[i];
            try {
              if (item.type === 'sale') {
                // Reverse: add stock back
                if (item.unitProductId) {
                  await db.rpc('increment_unit_stock', { p_unit_product_id: item.unitProductId, p_qty: item.qty });
                } else {
                  await db.rpc('increment_stock', { p_product_id: item.productId, p_qty: item.qty });
                }
              } else if (item.type === 'purchase') {
                // Reverse: remove stock + HPP
                const unitProductId = item.unitProductId || null;
                await db.rpc('reverse_purchase_stock_with_hpp', {
                  p_product_id: item.productId,
                  p_qty: item.qty,
                  p_original_hpp: item.originalHpp || 0,
                  p_unit_product_id: unitProductId,
                });
              }
            } catch (rollbackErr) {
              console.error(`[SAGA] Rollback failed for item ${item.productId}:`, rollbackErr);
            }
          }
        },
      },
    ]);

    // ── Post-transaction: Logging, Events, Notifications (fire-and-forget) ──

    createLog(db, {
      type: 'audit',
      action: 'transaction_approved',
      entity: 'transaction',
      entityId: id,
      message: 'Transaction ' + txCamel.invoiceNo + ' approved',
      payload: JSON.stringify({
        invoiceNo: txCamel.invoiceNo,
        type: txCamel.type,
        total: txCamel.total,
      }),
    });

    createEvent(db, 'transaction_approved', {
      transactionId: id,
      invoiceNo: txCamel.invoiceNo,
      type: txCamel.type,
      total: txCamel.total,
      profit: txCamel.totalProfit,
    });

    // Low stock alerts (use already-fetched productLookup from step 2)
    // Re-fetch products to get current stock after deduction
    for (const item of txCamel.items || []) {
      const { data: product } = await db
        .from('products')
        .select('id, name, global_stock, min_stock')
        .eq('id', item.productId)
        .maybeSingle();
      if (product && Number(product.global_stock) <= Number(product.min_stock)) {
        createEvent(db, 'stock_low', {
          productId: product.id,
          productName: product.name,
          currentStock: product.global_stock,
          minStock: product.min_stock,
        });
      }
    }

    const { data: updatedTransaction, error: refetchError } = await db
      .from('transactions')
      .select(`
        *,
        items:transaction_items(*),
        unit:units(*),
        created_by:users!created_by_id(*),
        customer:customers(*)
      `)
      .eq('id', id)
      .maybeSingle();

    if (refetchError || !updatedTransaction) {
      console.error('Refetch after approve failed:', refetchError);
    }

    const updatedCamel = toCamelCase(updatedTransaction);
    wsTransactionUpdate({ invoiceNo: txCamel.invoiceNo, type: txCamel.type, status: 'approved', unitId: txCamel.unitId });
    wsNotifyAll({ type: 'transaction_approved', invoiceNo: txCamel.invoiceNo, transactionId: id });

    return NextResponse.json({
      transaction: {
        ...updatedCamel,
        createdBy: updatedCamel.createdBy || null,
        customer: updatedCamel.customer || null,
        unit: updatedCamel.unit || null,
      },
    });
  } catch (error) {
    console.error('Approve transaction error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    let status = 500;
    if (message.includes('tidak ditemukan')) status = 404;
    else if (message.includes('tidak cukup') || message.includes('sudah diproses') || message.includes('constraint') || message.includes('non_negative') || message.includes('Stok') || message.includes('stok') || message.includes('Invalid') || message.includes('missing')) status = 400;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { wsTransactionUpdate, wsNotifyAll } from '@/lib/ws-dispatch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authUserId = authResult.userId;
    const authUser = authResult.user;

    // BUG FIX: Use effective roles to support custom roles
    const { fetchEffectiveRolesFromDB } = await import('@/lib/role-permissions');
    const effectiveRoles = await fetchEffectiveRolesFromDB(db, authUserId);
    if (!effectiveRoles.includes('super_admin') && !effectiveRoles.includes('keuangan')) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat menyetujui transaksi' }, { status: 403 });
    }

    const { id } = await params;
    
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
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    const txCamel = toCamelCase(transaction);

    // Step 1: OPTIMISTIC LOCK FIRST — update status from pending → approved atomically
    const { data: lockResult, error: lockError } = await db
      .from('transactions')
      .update({ status: 'approved' })
      .eq('id', id)
      .neq('status', 'approved')
      .neq('status', 'cancelled')
      .select('id')
      .maybeSingle();

    if (lockError) throw lockError;
    if (!lockResult) {
      return NextResponse.json(
        { error: 'Transaksi sudah diproses' },
        { status: 400 }
      );
    }

    // Step 2: STOCK DEDUCTION — only after lock acquired
    // OPTIMIZATION: Batch-fetch all products before the loop (eliminates N+1)
    const allItemProductIds = [...new Set<string>((txCamel.items || []).map((i: any) => i.productId).filter(Boolean))];
    const { data: productsBatch } = await db
      .from('products')
      .select('*, unit_products:unit_products(*)')
      .in('id', allItemProductIds);
    const productLookup = new Map((productsBatch || []).map((p: any) => [p.id, p]));

    try {
      for (const item of txCamel.items || []) {
        const product = productLookup.get(item.productId);
        if (!product) continue;

        // Skip stock deduction if trackStock is disabled
        if (product.track_stock === false) continue;

        if (txCamel.type === 'sale') {
          const stockQty = item.qtyInSubUnit ?? item.qty;
          
          if (product.stock_type === 'per_unit') {
            const { data: unitProduct } = await db
              .from('unit_products')
              .select('*')
              .eq('unit_id', txCamel.unitId)
              .eq('product_id', item.productId)
              .maybeSingle();

            if (unitProduct) {
              // Use atomic decrement_unit_stock RPC
              const { error: rpcError } = await db.rpc('decrement_unit_stock', {
                p_unit_product_id: unitProduct.id,
                p_qty: stockQty
              });
              if (rpcError) {
                throw new Error(`Stok unit tidak cukup untuk ${product.name} saat approve. ${rpcError.message}`);
              }
            }
            // Recalculate global stock atomically
            const { error: recalcError } = await db.rpc('recalc_global_stock', { p_product_id: item.productId });
            if (recalcError) console.warn('recalc_global_stock warning (non-blocking):', recalcError.message);
          } else {
            // BUG FIX #3: Use atomic decrement_stock RPC to prevent race condition
            const { error: rpcError } = await db.rpc('decrement_stock', {
              p_product_id: item.productId,
              p_qty: stockQty
            });
            if (rpcError) {
              throw new Error(`Stok tidak cukup untuk ${product.name} saat approve. ${rpcError.message}`);
            }
          }
        } else if (txCamel.type === 'purchase') {
          const stockQty = item.qtyInSubUnit ?? item.qty;
          // Use atomic increment RPC to prevent race condition on stock + HPP
          // BUG FIX #1: Changed p_cost_per_unit → p_new_hpp to match RPC signature
          const { data: rpcResult, error: rpcError } = await db.rpc('increment_stock_with_hpp', {
            p_product_id: item.productId,
            p_qty: stockQty,
            p_new_hpp: item.hpp || 0
          });
          if (rpcError) {
            // RACE FIX #4: No fallback — if RPC fails, the operation must fail entirely
            // The fallback used stale product data and produced incorrect global_stock/avg_hpp
            throw new Error(`Gagal menambahkan stok+HPP untuk ${product.name}: ${rpcError.message}`);
          }

          // BUG FIX #7: For per_unit products, recalc global_stock from unit_products
          const { data: unitProduct } = await db
            .from('unit_products')
            .select('*')
            .eq('unit_id', txCamel.unitId)
            .eq('product_id', item.productId)
            .maybeSingle();

          if (unitProduct) {
            await db
              .from('unit_products')
              .update({ stock: unitProduct.stock + stockQty })
              .eq('id', unitProduct.id);
          } else {
            await db
              .from('unit_products')
              .insert({
                id: crypto.randomUUID(),
                unit_id: txCamel.unitId,
                product_id: item.productId,
                stock: stockQty,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              });
          }

          // BUG FIX #7: Recalculate global_stock from sum of unit_products for per_unit products
          if (product.stock_type === 'per_unit') {
            const { error: recalcErr } = await db.rpc('recalc_global_stock', { p_product_id: item.productId });
            if (recalcErr) console.warn('recalc_global_stock warning (purchase per_unit):', recalcErr.message);
          }
        }
      }
    } catch (stockErr) {
      // Rollback: revert status back to pending since stock deduction failed
      await db.from('transactions').update({ status: 'pending' }).eq('id', id);
      throw stockErr;
    }

    // Log
    createLog(db, {
      type: 'audit',
      action: 'transaction_approved',
      entity: 'transaction',
      entityId: id,
      message: 'Transaction ' + txCamel.invoiceNo + ' approved',
      payload: JSON.stringify({
        invoiceNo: txCamel.invoiceNo,
        type: txCamel.type,
        total: txCamel.total
      })
    });

    // Events outside (fire and forget)
    createEvent(db, 'transaction_approved', {
      transactionId: id,
      invoiceNo: txCamel.invoiceNo,
      type: txCamel.type,
      total: txCamel.total,
      profit: txCamel.totalProfit
    });

    // Check for low stock alerts — reuse already-fetched productLookup (fix N+1)
    for (const item of txCamel.items || []) {
      const product = productLookup.get(item.productId);
      if (!product) continue;
      if (Number(product.global_stock) <= Number(product.min_stock)) {
        createEvent(db, 'stock_low', {
          productId: product.id,
          productName: product.name,
          currentStock: product.global_stock,
          minStock: product.min_stock
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
        unit: updatedCamel.unit || null
      }
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

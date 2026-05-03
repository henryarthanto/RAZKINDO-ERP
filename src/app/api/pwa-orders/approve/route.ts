import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { wsTransactionUpdate, wsNotifyAll } from '@/lib/ws-dispatch';
import { calculateSmartHpp, fetchPurchaseHistoryHpp, type SmartProduct } from '@/lib/smart-hpp';

// =====================================================================
// Approve PWA Order
// POST /api/pwa-orders/approve — Approve and finalize a pending PWA order
//   Body: {
//     transactionId,
//     items: [{ itemId, price }],
//     courierId?: string,          // optional: assign to kurir
//     deliveryType: 'self' | 'courier', // self = antar sendiri, courier = assign ke kurir
//     reject?: boolean,
//     rejectReason?: string
//   }
//   - Sales/Admin sets price per item
//   - Sales/Admin assigns delivery: self-delivery or assign to kurir
//   - System calculates total, HPP, profit, courier commission
//   - Customer stats updated
//   - WhatsApp notification sent to customer (and to kurir if assigned)
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true, id: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user: authUser } = result;
    const body = await request.json();
    const { transactionId, items, courierId, deliveryType, reject, rejectReason, paymentMethod: reqPaymentMethod } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID wajib diisi' }, { status: 400 });
    }

    // Validate payment method if provided
    if (reqPaymentMethod && !['cash', 'transfer', 'tempo'].includes(reqPaymentMethod)) {
      return NextResponse.json({ error: 'Metode pembayaran hanya: cash, transfer, atau tempo' }, { status: 400 });
    }

    // Validate deliveryType if provided
    if (deliveryType && !['self', 'courier'].includes(deliveryType)) {
      return NextResponse.json({ error: 'deliveryType hanya: self atau courier' }, { status: 400 });
    }

    // Validate courierId if deliveryType is courier
    if (deliveryType === 'courier' && !courierId) {
      return NextResponse.json({ error: 'courierId wajib diisi jika mengirim lewat kurir' }, { status: 400 });
    }

    // Fetch the transaction
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select(`
        *,
        customer:customers(id, name, phone, unit_id, assigned_to_id, distance, cashback_balance, cashback_type, cashback_value, total_orders, total_spent),
        unit:units(id, name),
        items:transaction_items(*, product:products(id, name, avg_hpp, purchase_price, unit, sub_unit, conversion_rate, selling_price, sell_price_per_sub_unit))
        `)
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    const txCamel = toCamelCase(transaction);

    // Only process pending PWA orders
    if (txCamel.status !== 'pending') {
      return NextResponse.json({ error: 'Transaksi bukan status pending' }, { status: 400 });
    }

    // Check if the notes indicate PWA origin
    const isPwaOrder = (txCamel.notes || '').includes('Order dari PWA');
    if (!isPwaOrder) {
      return NextResponse.json({ error: 'Bukan order dari PWA' }, { status: 400 });
    }

    // Authorization: only super_admin, sales assigned to customer, or sales in same unit
    if (authUser.role !== 'super_admin') {
      const customerSalesId = txCamel.customer?.assignedToId;
      if (customerSalesId && customerSalesId !== authUser.id) {
        return NextResponse.json({ error: 'Forbidden — bukan sales yang menangani pelanggan ini' }, { status: 403 });
      }
    }

    // ========== REJECT ==========
    if (reject) {
      await db
        .from('transactions')
        .update({
          status: 'cancelled',
          notes: `${txCamel.notes || ''}\n[DITOLAK: ${rejectReason || 'Tanpa alasan'}]`,
        })
        .eq('id', transactionId);

      wsTransactionUpdate({ invoiceNo: txCamel.invoiceNo, type: 'sale', status: 'cancelled', unitId: txCamel.unitId });

      // Send WA to customer about rejection
      try {
        const config = await getWhatsAppConfig();
        if (config.enabled && config.token && txCamel.customer?.phone) {
          const customerPhone = txCamel.customer.phone;
          const target = customerPhone.replace(/^0/, '62');
          const message = `❌ *ORDER DITOLAK*\n\n` +
            `📄 Invoice: ${txCamel.invoiceNo}\n` +
            `📋 Alasan: ${rejectReason || 'Tidak disebutkan'}\n\n` +
            `Hubungi sales untuk informasi lebih lanjut.`;
          const waResult = await sendMessage(config.token, target, message);
          if (!waResult.success && waResult.tokenInvalid) {
            await disableWhatsAppOnInvalidToken();
          }
        }
      } catch (waErr) {
        console.error('WA reject notification error:', waErr);
      }

      return NextResponse.json({ success: true, message: 'Order ditolak' });
    }

    // ========== APPROVE ==========
    // Validate items with prices
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Items dengan harga wajib diisi' }, { status: 400 });
    }

    const customer = txCamel.customer;
    const txItems = txCamel.items || [];

    // Build price map
    const priceMap = new Map<string, number>();
    for (const item of items) {
      if (!item.itemId || item.price === undefined || item.price < 0) {
        return NextResponse.json({ error: 'Setiap item harus memiliki itemId dan price' }, { status: 400 });
      }
      priceMap.set(item.itemId, item.price);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SMART HPP/PROFIT CALCULATION — server-side, zero trust on client
    // ═══════════════════════════════════════════════════════════════════

    // Build product map from transaction items' product data (already fetched with avgHpp + purchasePrice)
    const productMap = new Map<string, SmartProduct>();
    for (const txItem of txItems) {
      const prod = txItem.product;
      if (prod) {
        productMap.set(txItem.productId, {
          id: prod.id,
          avgHpp: prod.avgHpp || 0,
          purchasePrice: prod.purchasePrice || 0,
          conversionRate: prod.conversionRate || 1,
          sellingPrice: prod.sellingPrice || 0,
          sellPricePerSubUnit: prod.sellPricePerSubUnit || 0,
          trackStock: true, // not relevant here
          stockType: 'centralized', // not relevant here
          unit: prod.unit || null,
          subUnit: prod.subUnit || null,
          name: prod.name || '',
        });
      }
    }

    // Check for products with zero avgHpp and purchasePrice — need Tier 3 fallback
    let fallbackHppMap: Map<string, number> | undefined;
    const allProductIds: string[] = [...new Set((txItems as any[]).map((ti: any) => ti.productId as string))];
    const zeroHppProductIds = allProductIds.filter(pid => {
      const p = productMap.get(pid);
      return p && (p.avgHpp || 0) <= 0 && (p.purchasePrice || 0) <= 0;
    });
    if (zeroHppProductIds.length > 0) {
      fallbackHppMap = await fetchPurchaseHistoryHpp(zeroHppProductIds, db);
    }

    // Build client items from txItems + priceMap for smart calculation
    // Include txItemId so we can match calc results back to the correct txItem
    // (calculateSmartHpp may skip items whose product is not found in productMap)
    const clientItems = txItems.map((txItem: any) => ({
      txItemId: txItem.id,  // track original txItem ID for safe mapping
      productId: txItem.productId,
      productName: txItem.productName,
      qty: txItem.qty,
      price: priceMap.get(txItem.id) || 0,
      qtyInSubUnit: txItem.qtyInSubUnit || txItem.qty,
      qtyUnitType: txItem.qtyUnitType || 'main',
      hpp: txItem.hpp, // stored value (may be stale)
    }));

    const calcResult = calculateSmartHpp(clientItems, productMap, fallbackHppMap);
    const { total, totalHpp, totalProfit } = calcResult;

    // Log warnings (loss, zero HPP, etc.)
    if (calcResult.warnings.length > 0) {
      console.warn(`[SMART-HPP] PWA Approve ${txCamel.invoiceNo}:`, calcResult.warnings.join(' | '));
    }

    // Map calc results back to txItems by txItemId (NOT by index — prevents data corruption
    // when calculateSmartHpp skips items whose product is missing from productMap)
    const updatedItems = calcResult.items.map((calc) => {
      const txItem = txItems.find((ti: any) => ti.id === calc.txItemId);
      if (!txItem) return null;
      return {
        id: txItem.id,
        transaction_id: transactionId,
        product_id: txItem.productId,
        product_name: txItem.productName,
        qty: txItem.qty,
        qty_in_sub_unit: calc.serverQtyInSubUnit,
        qty_unit_type: txItem.qtyUnitType || 'main',
        price: calc.price,
        hpp: calc.serverHppPerSubUnit,
        subtotal: calc.subtotal,
        profit: calc.profit,
      };
    }).filter((item): item is NonNullable<typeof item> => item != null);

    const paymentMethod = body.paymentMethod || txCamel.paymentMethod || 'tempo';

    // ALL orders start as PIUTANG (unpaid) — regardless of cash/transfer
    const paidAmount = 0;
    const remainingAmount = total;
    const paymentStatus = 'unpaid';

    // ========== COURIER ASSIGNMENT ==========
    let assignedCourier: any = null;
    let courierCommission = 0;
    const deliveryDistance = customer?.distance || 'near';

    if (deliveryType === 'courier' && courierId) {
      // Fetch courier info
      const { data: courierData, error: courierError } = await db
        .from('users')
        .select('id, name, phone, near_commission, far_commission, unit_id, status, is_active, role')
        .eq('id', courierId)
        .maybeSingle();

      if (courierError) {
        console.error('Courier lookup error:', courierError);
      }

      if (!courierData) {
        return NextResponse.json({ error: 'Kurir tidak ditemukan' }, { status: 400 });
      }
      if (courierData.role !== 'kurir') {
        return NextResponse.json({ error: 'User yang dipilih bukan kurir' }, { status: 400 });
      }
      if (courierData.status !== 'approved' || !courierData.is_active) {
        return NextResponse.json({ error: 'Kurir tidak aktif' }, { status: 400 });
      }

      assignedCourier = toCamelCase(courierData);

      // Calculate commission based on customer distance
      courierCommission = deliveryDistance === 'far'
        ? (assignedCourier.farCommission || 0)
        : (assignedCourier.nearCommission || 0);
    }

    // Build notes with delivery info
    const deliveryLabel = deliveryType === 'courier'
      ? `Dikirim oleh kurir: ${assignedCourier?.name || '-'}`
      : 'Antar sendiri oleh Sales/Admin';

    // Update transaction with courier assignment (with optimistic lock to prevent double approval)
    const { data: updatedTx, error: approveError } = await db
      .from('transactions')
      .update({
        total,
        paid_amount: paidAmount,
        remaining_amount: remainingAmount,
        total_hpp: totalHpp,
        total_profit: totalProfit,
        hpp_paid: 0,
        profit_paid: 0,
        hpp_unpaid: totalHpp,
        profit_unpaid: totalProfit,
        payment_method: paymentMethod,
        status: 'approved',
        payment_status: paymentStatus,
        courier_id: deliveryType === 'courier' ? courierId : null,
        courier_commission: courierCommission,
        delivery_distance: deliveryDistance,
        notes: `${txCamel.notes || ''}\n[Di-approve oleh ${authUser.role} pada ${new Date().toLocaleString('id-ID')} | ${deliveryLabel}]`,
      })
      .eq('id', transactionId)
      .neq('status', 'approved')
      .neq('status', 'cancelled')
      .select('id')
      .maybeSingle();

    if (approveError || !updatedTx) {
      if (!updatedTx && !approveError) {
        return NextResponse.json({ error: 'Transaksi sudah di-approve atau dibatalkan' }, { status: 400 });
      }
      throw approveError;
    }

    wsTransactionUpdate({ invoiceNo: txCamel.invoiceNo, type: 'sale', status: 'approved', unitId: txCamel.unitId });
    wsNotifyAll({ type: 'pwa_order_approved', invoiceNo: txCamel.invoiceNo, transactionId });

    // Update transaction items with prices
    for (const item of updatedItems) {
      await db
        .from('transaction_items')
        .update({
          price: item.price,
          hpp: item.hpp,
          subtotal: item.subtotal,
          profit: item.profit,
        })
        .eq('id', item.id);
    }

    // ─── Deduct stock for each product (atomic, prevents overselling) ───
    const deductedStocks: Array<{ productId: string; qty: number; stockType: string; unitProductId?: string }> = [];
    try {
      for (const item of updatedItems) {
        if (!item.product_id) continue;

        // Calculate qty in sub-unit for stock deduction
        const rawConvRate = (txItems.find((ti: any) => ti.productId === item.product_id)?.product as any)?.conversionRate;
        if (!rawConvRate || rawConvRate <= 0) {
          console.warn(`[PWA APPROVE] Product ${item.product_id} has invalid conversionRate (${rawConvRate}), using 1`);
        }
        const convRate = (rawConvRate && rawConvRate > 0) ? rawConvRate : 1;
        const qtyToDeduct = item.qty * convRate;

        const { data: product, error: prodError } = await db
          .from('products')
          .select('id, name, stock_type, global_stock, track_stock')
          .eq('id', item.product_id)
          .maybeSingle();
        if (prodError) {
          console.error('[PWA APPROVE] Product lookup error:', prodError);
          continue;
        }
        if (!product) continue;

        // Skip stock deduction if trackStock is disabled
        if (product.track_stock === false) continue;

        if (product.stock_type === 'centralized') {
          const { error: rpcError } = await db.rpc('decrement_stock', {
          p_product_id: item.product_id,
          p_qty: qtyToDeduct,
        });
        if (rpcError) {
          throw new Error(`Stok tidak cukup untuk ${product.name}. ${rpcError.message}`);
        }
          deductedStocks.push({ productId: item.product_id, qty: qtyToDeduct, stockType: 'centralized' });
        } else if (product.stock_type === 'per_unit' && txCamel.unitId) {
        const { data: unitProduct } = await db
          .from('unit_products')
          .select('id, stock')
          .eq('unit_id', txCamel.unitId)
          .eq('product_id', item.product_id)
          .maybeSingle();
        if (unitProduct) {
          const { error: rpcError } = await db.rpc('decrement_unit_stock', {
            p_unit_product_id: unitProduct.id,
            p_qty: qtyToDeduct,
          });
          if (rpcError) {
            throw new Error(`Stok unit tidak cukup untuk ${product.name}. ${rpcError.message}`);
          }
          deductedStocks.push({ productId: item.product_id, qty: qtyToDeduct, stockType: 'per_unit', unitProductId: unitProduct.id });
        }
      }
      }
    } catch (stockErr: any) {
      // FIX: Rollback stock deductions if any failed (partial stock deducted)
      console.error('[PWA APPROVE] Stock deduction failed, rolling back:', stockErr.message);
      for (const ds of deductedStocks) {
        try {
          if (ds.stockType === 'per_unit' && ds.unitProductId) {
            await db.rpc('increment_unit_stock', { p_unit_product_id: ds.unitProductId, p_qty: ds.qty });
          } else {
            await db.rpc('increment_stock', { p_product_id: ds.productId, p_qty: ds.qty });
          }
        } catch (rollbackErr) {
          console.error(`[PWA APPROVE] Failed to rollback stock for ${ds.productId}:`, rollbackErr);
        }
      }
      // Also revert transaction status back to pending
      await db.from('transactions').update({ status: 'pending' }).eq('id', transactionId);
      return NextResponse.json({ error: stockErr.message || 'Gagal mengurangi stok — transaksi dikembalikan ke pending' }, { status: 500 });
    }

    // ─── Create receivable for piutang/tempo/cash-with-courier orders ───
    if (paymentMethod === 'piutang' || paymentMethod === 'tempo' || (paymentMethod === 'cash' && (deliveryType === 'courier' || !!courierId))) {
      try {
        await db.from('receivables').insert({
          id: generateId(),
          transaction_id: transactionId,
          customer_name: customer?.name || 'Customer PWA',
          customer_phone: customer?.phone || '',
          total_amount: total,
          paid_amount: 0,
          remaining_amount: total,
          assigned_to_id: txCamel.createdById,
          priority: 'normal',
          status: 'active',
          overdue_days: 0,
          reminder_count: 0,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (recvErr) {
        console.error('[PWA APPROVE] Failed to create receivable (non-blocking):', recvErr);
      }
    }

    // RACE FIX #6: Update customer stats atomically (total_orders only, total_spent updated when lunas)
    try {
      await db.rpc('atomic_increment_customer_stats', {
        p_customer_id: customer.id,
        p_order_delta: 1,
        p_spent_delta: 0,
      });
    } catch (statsErr) {
      console.error('[PWA APPROVE] atomic_increment_customer_stats RPC failed (non-blocking):', statsErr);
      // Fallback to direct update if RPC not available
      await db
        .from('customers')
        .update({
          total_orders: (customer.totalOrders || 0) + 1,
          last_transaction_date: new Date().toISOString(),
        })
        .eq('id', customer.id);
    }

    // ─── Save deal prices for customer (auto-update on every approval) ───
    // When sales approves an order, the price set per item becomes the "deal price"
    // for that customer-product combination. This allows the customer to see their
    // negotiated price in the PWA for future orders.
    try {
      // Collect all product IDs that need deal price saving
      const priceItems = updatedItems.filter(i => i.product_id && i.price && i.price > 0);
      const priceProductIds = priceItems.map(i => i.product_id);

      // Batch fetch existing customer_prices for this customer + products
      let existingPrices: Array<{ id: string; product_id: string }> = [];
      if (priceProductIds.length > 0) {
        const { data: existingData } = await db
          .from('customer_prices')
          .select('id, product_id')
          .eq('customer_id', customer.id)
          .in('product_id', priceProductIds);
        if (Array.isArray(existingData)) {
          existingPrices = existingData;
        }
      }

      // Build map of product_id → existing record id
      const existingMap = new Map<string, string>();
      for (const ep of existingPrices) {
        existingMap.set(ep.product_id, ep.id);
      }

      // Now insert or update each item's deal price
      for (const item of priceItems) {
        const existingId = existingMap.get(item.product_id);

        if (existingId) {
          // Update existing record
          const { error: updateErr } = await db
            .from('customer_prices')
            .update({
              deal_price: item.price,
              sub_unit_price: 0, // will be recalculated below
              approved_by_id: authUser.id,
              transaction_id: transactionId,
              is_active: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingId);
          if (updateErr) {
            console.error(`[PWA APPROVE] Failed to UPDATE deal price for ${item.product_id}:`, updateErr);
          }
        } else {
          // Insert new record
          const { error: insertErr } = await db
            .from('customer_prices')
            .insert({
              id: generateId(),
              customer_id: customer.id,
              product_id: item.product_id,
              deal_price: item.price,
              sub_unit_price: 0,
              approved_by_id: authUser.id,
              transaction_id: transactionId,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          if (insertErr) {
            console.error(`[PWA APPROVE] Failed to INSERT deal price for ${item.product_id}:`, insertErr);
          }
        }
      }

      // Also calculate sub-unit prices based on conversion rates
      if (priceProductIds.length > 0) {
        const { data: productData } = await db
          .from('products')
          .select('id, conversion_rate, sell_price_per_sub_unit')
          .in('id', priceProductIds);

        if (productData) {
          for (const prod of productData) {
            const item = updatedItems.find(i => i.product_id === prod.id);
            if (!item || !item.price || item.price <= 0) continue;

            const convRate = (prod.conversion_rate && prod.conversion_rate > 0) ? prod.conversion_rate : 1;
            let subUnitPrice = convRate > 1 ? item.price / convRate : 0;
            // If product has explicit sellPricePerSubUnit, use proportional calculation
            if (prod.sell_price_per_sub_unit && prod.sell_price_per_sub_unit > 0 && convRate > 1) {
              const denominator = prod.sell_price_per_sub_unit * convRate;
              if (denominator > 0 && Number.isFinite(denominator)) {
                const ratio = item.price / denominator;
                if (Number.isFinite(ratio)) {
                  subUnitPrice = prod.sell_price_per_sub_unit * ratio;
                }
              }
            }

            if (!Number.isFinite(subUnitPrice)) subUnitPrice = 0;

            await db
              .from('customer_prices')
              .update({
                sub_unit_price: Math.round(subUnitPrice),
                updated_at: new Date().toISOString(),
              })
              .eq('customer_id', customer.id)
              .eq('product_id', prod.id);
          }
        }
      }
    } catch (dealPriceErr) {
      console.error('[PWA APPROVE] Failed to save deal prices (non-blocking):', dealPriceErr);
    }

    // NOTE: Cashback is NOT calculated here.
    // Cashback is calculated when the order is marked as LUNAS (fully paid).
    const cashbackEarned = 0;

    // Create event
    createEvent(db, 'pwa_order_approved', {
      transactionId,
      invoiceNo: txCamel.invoiceNo,
      type: 'sale',
      unitId: txCamel.unitId,
      customerId: customer.id,
      customerName: customer.name,
      total,
      approvedBy: authUser.id,
      source: 'pwa',
      courierId: deliveryType === 'courier' ? courierId : null,
      courierName: assignedCourier?.name || null,
      deliveryType: deliveryType || 'self',
    }).catch(() => {});

    // Send WhatsApp notification to customer
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && customer.phone) {
        const customerPhone = customer.phone.replace(/^0/, '62');
        const itemsList = updatedItems.map(i => {
          const subtotalStr = `Rp ${i.subtotal.toLocaleString('id-ID')}`;
          return `• ${i.product_name} x${i.qty} = ${subtotalStr}`;
        }).join('\n');
        const totalStr = `Rp ${total.toLocaleString('id-ID')}`;
        const payLabel = paymentMethod === 'cash'
          ? 'Cash (menunggu pelunasan)'
          : paymentMethod === 'transfer'
            ? 'Transfer (menunggu pembayaran)'
            : 'Tempo (menunggu pelunasan)';

        let deliveryInfo = '';
        if (deliveryType === 'courier' && assignedCourier) {
          deliveryInfo = `\n🚚 Pengiriman: Kurir (${assignedCourier.name})`;
        } else {
          deliveryInfo = '\n🚚 Pengiriman: Antar sendiri';
        }

        const message = `✅ *ORDER DITERIMA*\n\n` +
          `📄 Invoice: ${txCamel.invoiceNo}\n` +
          `📦 *Detail Pesanan:*\n${itemsList}\n\n` +
          `💰 *Total: ${totalStr}*\n` +
          `💳 Bayar: ${payLabel}` +
          `\n📋 Status: Menunggu Pelunasan` +
          deliveryInfo +
          `\n\n` +
          `Terima kasih telah berbelanja! 🙏`;

        const waResult = await sendMessage(config.token, customerPhone, message);
        if (!waResult.success && waResult.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('WA approve notification error (non-blocking):', waErr);
    }

    // Send WhatsApp notification to courier if assigned
    if (deliveryType === 'courier' && assignedCourier?.phone) {
      try {
        const config = await getWhatsAppConfig();
        if (config.enabled && config.token) {
          const courierPhone = assignedCourier.phone.replace(/^0/, '62');
          const itemsList = updatedItems.map(i =>
            `• ${i.product_name} x${i.qty}`
          ).join('\n');
          const totalStr = `Rp ${total.toLocaleString('id-ID')}`;

          const message = `🚚 *TUGASAN PENGIRIMAN BARU*\n\n` +
            `📄 Invoice: ${txCamel.invoiceNo}\n` +
            `👤 Pelanggan: ${customer.name}\n` +
            `📱 Telp: ${customer.phone || '-'}\n` +
            `📍 Jarak: ${deliveryDistance === 'far' ? 'Jauh' : 'Dekat'}\n` +
            `💳 Bayar: ${paymentMethod === 'cash' ? 'Cash' : paymentMethod === 'transfer' ? 'Transfer' : 'Tempo'}\n\n` +
            `📦 *Item:*\n${itemsList}\n\n` +
            `💰 *Total: ${totalStr}*\n` +
            `💵 Komisi: Rp ${courierCommission.toLocaleString('id-ID')}\n\n` +
            `Harap segera memproses pengiriman.\n` +
            `Login ke ERP untuk melihat detail.`;

          const waResult = await sendMessage(config.token, courierPhone, message);
          if (!waResult.success && waResult.tokenInvalid) {
            await disableWhatsAppOnInvalidToken();
          }
        }
      } catch (courierWaErr) {
        console.error('WA courier notification error (non-blocking):', courierWaErr);
      }
    }

    // Also send transfer reminder if payment method is transfer
    if (paymentMethod === 'transfer') {
      createEvent(db, 'payment_proof_needed', {
        transactionId,
        invoiceNo: txCamel.invoiceNo,
        customerName: customer.name,
        customerPhone: customer.phone,
        amount: total,
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'Order berhasil di-approve',
      data: {
        transactionId,
        invoiceNo: txCamel.invoiceNo,
        total,
        cashbackEarned,
        paymentStatus,
        courierId: deliveryType === 'courier' ? courierId : null,
        courierName: assignedCourier?.name || null,
        courierCommission,
        deliveryType: deliveryType || 'self',
      },
    });

  } catch (error: any) {
    console.error('PWA order approve error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

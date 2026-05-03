import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent, generateId, generateInvoiceNo } from '@/lib/supabase-helpers';
import { getWhatsAppConfig, sendMessage, renderMessageTemplate, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { verifyAndGetAuthUser } from '@/lib/token';
import { wsTransactionUpdate, wsStockUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { validateBody, validateQuery, transactionSchemas } from '@/lib/validators';
import { runInTransaction, createStep, type TransactionStep } from '@/lib/db-transaction';
import { perfMonitor } from '@/lib/performance-monitor';
import { concurrencyManager } from '@/lib/concurrency-queue';
import { batchOptimizer } from '@/lib/batch-optimizer';
import { calculateSmartHpp, fetchPurchaseHistoryHpp, PRODUCT_FINANCIAL_SELECT, type SmartProduct } from '@/lib/smart-hpp';
// withGracefulDegradation intentionally NOT used for critical financial operations
// Transaction processing must fail with actual error messages, not generic 503

// WhatsApp notification helper - uses configurable template from settings
async function sendWhatsAppNotification(transaction: any, createdBy: any, customer: any, unit: any, isSelfDelivered: boolean = false) {
  try {
    const config = await getWhatsAppConfig();
    if (!config.enabled || !config.token || !config.target_id) return;

    const customTemplate = config.message_template || null;

    const items = transaction.items?.map((i: any) =>
      `${i.productName} x${i.qty}`
    ).join(', ') || '-';

    const paymentLabel = transaction.paymentMethod === 'tempo' ? 'TEMPO' :
                         transaction.paymentMethod === 'piutang' ? 'PIUTANG' : 'CASH';

    let message: string;
    if (customTemplate) {
      message = renderMessageTemplate(customTemplate, {
        sales_name: createdBy?.name || '-',
        customer_name: customer?.name || 'Walk-in',
        customer_phone: customer?.phone || '-',
        unit_name: unit?.name || '-',
        items,
        total: transaction.total.toLocaleString('id-ID'),
        paid: transaction.paidAmount.toLocaleString('id-ID'),
        remaining: transaction.remainingAmount.toLocaleString('id-ID'),
        payment_method: paymentLabel,
        invoice_no: transaction.invoiceNo,
        date: new Date(transaction.transactionDate).toLocaleDateString('id-ID'),
        due_date: transaction.dueDate ? new Date(transaction.dueDate).toLocaleDateString('id-ID') : '',
        delivery_address: transaction.deliveryAddress || ''
      });
    } else {
      message = `*🔔 NOTIFIKASI ORDER BARU - RAZKINDO*
-------------------------------------------
Invoice: ${transaction.invoiceNo}
Tanggal: ${new Date(transaction.transactionDate).toLocaleDateString('id-ID')}

👤 *Sales:* ${createdBy?.name || '-'}
🏢 *Customer:* ${customer?.name || 'Walk-in'}
📱 No. HP: ${customer?.phone || '-'}
📍 Cabang: ${unit?.name || '-'}
📦 Item: ${items}

💰 *TOTAL:* *Rp ${transaction.total.toLocaleString('id-ID')}*
💵 Bayar: Rp ${transaction.paidAmount.toLocaleString('id-ID')}
💳 Sisa: Rp ${transaction.remainingAmount.toLocaleString('id-ID')}
🏷️ Metode: ${paymentLabel}
${transaction.dueDate ? `📅 Jatuh Tempo: ${new Date(transaction.dueDate).toLocaleDateString('id-ID')}` : ''}
-------------------------------------------
${isSelfDelivered ? '📦 *Sales mengantarkan sendiri (tanpa kurir)*' : '_Mohon tim kurir segera memproses pesanan ini._'}`;
    }

    const result = await sendMessage(config.token, config.target_id, message);

    // If token is invalid, auto-disable WhatsApp to prevent repeated failures
    if (!result.success && result.tokenInvalid) {
      await disableWhatsAppOnInvalidToken();
      console.error('[WhatsApp] Token tidak valid — notifikasi WA dinonaktifkan otomatis. Perbarui token di Settings.');
    } else if (!result.success) {
      console.error('[WhatsApp] Gagal mengirim notifikasi:', result.error);
    }
  } catch (error) {
    console.error('WhatsApp notification error:', error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryValidation = validateQuery(transactionSchemas.query, searchParams);
    if (!queryValidation.success) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }
    const unitId = searchParams.get('unitId');
    const customerId = searchParams.get('customerId');
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = searchParams.get('limit');

    // Auth check — single DB query for verification + role
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authUserId = authResult.userId;
    const authUserRole = authResult.user.role;

    // Build query
    let query = db
      .from('transactions')
      .select(`
        *,
        unit:units(*),
        created_by:users!created_by_id(*),
        courier:users!courier_id(*),
        customer:customers(*),
        supplier:suppliers(*),
        items:transaction_items(*, product:products(unit, subUnit, conversionRate)),
        payments:payments(*, received_by:users!received_by_id(*))
      `);

    if (unitId) query = query.eq('unit_id', unitId);
    if (customerId) query = query.eq('customer_id', customerId);
    if (type) query = query.eq('type', type);
    if (status) query = query.eq('status', status);
    // Server-side enforcement: sales users can only see their own transactions
    if (authUserRole === 'sales') {
      query = query.eq('created_by_id', authUserId);
    } else if (searchParams.get('createdById')) {
      query = query.eq('created_by_id', searchParams.get('createdById'));
    }
    if (startDate) {
      query = query.gte('transaction_date', new Date(startDate).toISOString());
    }
    if (endDate) {
      query = query.lte('transaction_date', new Date(endDate).toISOString());
    }

    const { data: transactions } = await query
      .order('created_at', { ascending: false })
      .limit(limit ? (parseInt(limit) || 500) : 500);

    const transactionsCamel = (transactions || []).map((t: any) => {
      const camel = toCamelCase(t);
      return {
        ...camel,
        createdBy: camel.createdBy || null,
        courier: camel.courier || null,
        customer: camel.customer || null,
        supplier: camel.supplier || null,
        items: (camel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null
        })),
        payments: (camel.payments || []).map((p: any) => ({
          ...p,
          receivedBy: p.receivedBy || null
        }))
      };
    });

    // Strip sensitive financial data for non-admin roles
    if (authUserRole && !['super_admin', 'keuangan'].includes(authUserRole)) {
      for (const tx of transactionsCamel) {
        delete (tx as any).totalHpp;
        delete (tx as any).hppPaid;
        delete (tx as any).hppUnpaid;
        delete (tx as any).totalProfit;
        delete (tx as any).profitPaid;
        delete (tx as any).profitUnpaid;
        // Also strip from items
        if (tx.items) {
          for (const item of tx.items) {
            delete (item as any).hpp;
            delete (item as any).profit;
          }
        }
      }
    }

    return NextResponse.json({ transactions: transactionsCamel });
  } catch (error) {
    console.error('Get transactions error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const txTimer = perfMonitor.timer('transaction.create_total');
  perfMonitor.incrementCounter('transactions.create_requested');
  try {
    // Auth check — single DB query for verification + role
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authUserId = authResult.userId;
    const authUserData = authResult.user;

    const rawBody = await request.json();

    // Pre-process: convert empty strings to undefined for optional UUID fields
    const preProcessed = {
      ...rawBody,
      customerId: rawBody.customerId || undefined,
      supplierId: rawBody.supplierId || undefined,
      courierId: rawBody.courierId || undefined,
    };
    const validation = validateBody(transactionSchemas.create, preProcessed);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = { ...validation.data, createdById: authUserId };

    // Role-based access: restrict which transaction types each role can create
    const allowedTypesByRole: Record<string, string[]> = {
      super_admin: ['sale', 'purchase', 'expense', 'salary'],
      keuangan: ['sale', 'purchase', 'expense', 'salary'],
      sales: ['sale'],
      kurir: [],
    };
    const allowedForRole = allowedTypesByRole[authUserData.role] || [];
    if (!allowedForRole.includes(data.type)) {
      return NextResponse.json(
        { error: `Role ${authUserData.role} tidak memiliki akses untuk membuat transaksi ${data.type}` },
        { status: 403 }
      );
    }

    // Idempotency check — prevent duplicate transaction creation
    const idempotencyKey = request.headers.get('X-Idempotency-Key');
    if (idempotencyKey) {
      // Check if a transaction was already created with this key
      const { data: existingTx } = await db
        .from('logs')
        .select('entity_id, payload')
        .eq('action', 'transaction_created_idempotent')
        .eq('entity_id', idempotencyKey)
        .maybeSingle();

      if (existingTx) {
        const payload = JSON.parse(existingTx.payload || '{}');
        // Return the previously created transaction
        const { data: prevTx } = await db
          .from('transactions')
          .select(`*, items:transaction_items(*), unit:units(*), created_by:users!created_by_id(*), customer:customers(*)`)
          .eq('id', payload.transactionId)
          .maybeSingle();

        if (prevTx) {
          // Bug 8 fix: txTimer.stop() removed here — let the finally block handle it
          // to avoid double-stop which causes inaccurate performance metrics
          perfMonitor.incrementCounter('transactions.create_success');
          return NextResponse.json({
            transaction: toCamelCase(prevTx),
            idempotent: true
          });
        }
      }
    }

    // Generate invoice number based on transaction date
    const txDate = data.transactionDate ? new Date(data.transactionDate) : new Date();

    // Clean up empty string IDs
    const cleanCustomerId = validation.data.customerId || null;
    const cleanCourierId = (data.courierId && data.courierId !== 'none') ? data.courierId : null;
    const cleanSupplierId = validation.data.supplierId || null;
    const isSelfDelivered = !cleanCourierId;

    // Items from validated body
    const items = data.items || [];

    // Pre-compute product IDs for FK validation
    const productIds = [...new Set<string>(items.map((item: any) => item.productId as string))];

    // Invalidate product cache to get fresh data before FK validation
    batchOptimizer.invalidateCache('products');

    // FK validation — batch all independent reads in a single Promise.all
    // IMPORTANT: Fetch product data server-side — NEVER trust client-sent HPP, conversion, etc.
    const fkChecks = await Promise.all([
      db.from('units').select('id').eq('id', data.unitId).maybeSingle(),
      // Skip customer/courier/supplier/products if IDs are empty — use resolved placeholder
      cleanCustomerId
        ? db.from('customers').select('id').eq('id', cleanCustomerId).maybeSingle()
        : Promise.resolve({ data: null }),
      cleanCourierId
        ? db.from('users').select('id').eq('id', cleanCourierId).maybeSingle()
        : Promise.resolve({ data: null }),
      cleanSupplierId
        ? db.from('suppliers').select('id').eq('id', cleanSupplierId).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('products').select(PRODUCT_FINANCIAL_SELECT).in('id', productIds),
    ]);

    const [unitRow, customerRow, courierRow, supplierRow, productsRow] = fkChecks;

    // Build product lookup map (server-side source of truth for HPP, conversion, etc.)
    const productMap = new Map<string, SmartProduct>();
    for (const p of (productsRow.data || [])) {
      productMap.set(p.id, toCamelCase(p) as SmartProduct);
    }
    if (!unitRow.data) {
      return NextResponse.json({ error: 'Unit/Cabang tidak ditemukan' }, { status: 400 });
    }
    if (cleanCustomerId && !customerRow.data) {
      return NextResponse.json({ error: 'Pelanggan tidak ditemukan' }, { status: 400 });
    }
    if (cleanCourierId && !courierRow.data) {
      return NextResponse.json({ error: 'Kurir tidak ditemukan' }, { status: 400 });
    }
    if (cleanSupplierId && !supplierRow.data) {
      return NextResponse.json({ error: 'Supplier tidak ditemukan' }, { status: 400 });
    }
    const products = productsRow.data;
    if (!products || products.length !== productIds.length) {
      const foundIds = new Set((products || []).map((p: any) => p.id));
      const missingIds = productIds.filter(id => !foundIds.has(id));
      return NextResponse.json({ error: `Beberapa produk tidak ditemukan: ${missingIds.join(', ')}` }, { status: 400 });
    }

    // ═══════════════════════════════════════════════════════════════════
    // SMART HPP/PROFIT CALCULATION — server-side, zero trust on client
    // ═══════════════════════════════════════════════════════════════════

    // Check for products with zero avgHpp and purchasePrice — need Tier 3 fallback
    let fallbackHppMap: Map<string, number> | undefined;
    const zeroHppProductIds = productIds.filter(pid => {
      const p = productMap.get(pid);
      return p && (p.avgHpp || 0) <= 0 && (p.purchasePrice || 0) <= 0;
    });
    if (zeroHppProductIds.length > 0) {
      fallbackHppMap = await fetchPurchaseHistoryHpp(zeroHppProductIds, db);
    }

    const calcResult = calculateSmartHpp(items as any[], productMap, fallbackHppMap);
    const { total, totalHpp, totalProfit } = calcResult;

    // Log any warnings (loss detection, zero HPP, conversion mismatches)
    if (calcResult.warnings.length > 0) {
      console.warn(`[SMART-HPP] Invoice ${data.type}:`, calcResult.warnings.join(' | '));
    }
    // Override client items with server-calculated values
    for (let i = 0; i < items.length; i++) {
      const calc = calcResult.items[i];
      if (!calc) continue;
      items[i].hpp = calc.serverHppPerSubUnit;
      items[i].qtyInSubUnit = calc.serverQtyInSubUnit;
    }

    // Determine payment status and amounts
    let paymentStatus = 'unpaid';
    let status = data.type === 'sale' ? 'approved' : 'pending';
    let paidAmount: number;
    let remainingAmount: number;

    // BUG FIX: hasCourier must be computed BEFORE the payment logic below
    const hasCourier = !!cleanCourierId;

    if (data.paymentMethod === 'cash') {
      // Cash with courier: money is collected by courier during delivery, NOT at invoice creation
      // Only self-delivered (no courier) sales get immediate payment
      if (data.type === 'sale' && hasCourier) {
        paidAmount = 0;
        remainingAmount = total;
        paymentStatus = 'unpaid';
      } else {
        paidAmount = data.paidAmount > 0 ? data.paidAmount : total;
        remainingAmount = Math.max(0, total - paidAmount);
        paymentStatus = paidAmount >= total ? 'paid' : 'partial';
      }
    } else {
      paidAmount = Math.max(0, data.paidAmount || 0);
      remainingAmount = Math.max(0, total - paidAmount);
      paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';
    }

    // Financial snapshot
    const hppPaid = total > 0 ? (totalHpp / total) * paidAmount : 0;
    const profitPaid = total > 0 ? (totalProfit / total) * paidAmount : 0;
    const hppUnpaid = totalHpp - hppPaid;
    const profitUnpaid = totalProfit - profitPaid;

    // Pre-compute auto-payment condition (used for transaction steps and pool balance update)
    const shouldAutoPay = (data.type === 'sale' || data.type === 'purchase') && paymentStatus === 'paid' && paidAmount > 0 && (data.paymentMethod === 'cash' || data.paymentMethod === 'transfer' || data.paymentMethod === 'giro') && !(data.type === 'sale' && data.paymentMethod === 'cash' && hasCourier);

    // === SEQUENTIAL OPERATIONS (compensating transaction pattern) ===

    // Acquire resource locks for all products in this transaction
    const productResourceIds = productIds.map(id => `product:stock:${id}`);
    let releaseLocks: Array<() => void> = [];

    try {
      // Acquire locks for each product (with timeout)
      for (const resourceId of productResourceIds) {
        const release = await concurrencyManager.resourceLock.acquire(
          resourceId,
          `tx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          15_000 // 15s timeout
        );
        releaseLocks.push(release);
      }
    } catch {
      // If we can't get a lock, release any already-acquired locks before returning
      for (const release of releaseLocks) {
        try { release(); } catch { /* ignore release errors */ }
      }
      releaseLocks = [];
      return NextResponse.json(
        { error: 'Terlalu banyak operasi pada produk yang sama. Coba lagi beberapa saat.' },
        { status: 429 }
      );
    }

    perfMonitor.incrementCounter('transactions.concurrency_lock_acquired');

    // Retry loop for invoice number uniqueness
    let transaction: any;
    let invoiceNo: string = '';
    const stockDeductionLogs: any[] = [];

    try {

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Count existing transactions for this type/month
        const monthStart = new Date(txDate.getFullYear(), txDate.getMonth(), 1);
        const monthEnd = new Date(txDate.getFullYear(), txDate.getMonth() + 1, 1);
        const { count: txCount } = await db
          .from('transactions')
          .select('*', { count: 'exact', head: true })
          .eq('type', data.type)
          .gte('transaction_date', monthStart.toISOString())
          .lt('transaction_date', monthEnd.toISOString());

        // RESOLVED: UNIQUE constraint on (invoice_no) exists via Prisma schema @unique directive.
        // Race condition mitigation: append millisecond timestamp as tiebreaker suffix.
        invoiceNo = generateInvoiceNo(data.type, txCount || 0) + `-${Date.now().toString(36)}`;

        const transactionId = generateId();

        // Create transaction items — all values from SMART calculation (server-side)
        // IMPORTANT: product_name must come from server-side productMap, NOT from client
        const txItems = items.map((item: any, idx: number) => {
          const calc = calcResult.items[idx];
          const serverProduct = productMap.get(item.productId);
          return {
            id: generateId(),
            transaction_id: transactionId,
            product_id: item.productId,
            product_name: serverProduct?.name || item.productName || 'Unknown Product',
            qty: item.qty,
            qty_in_sub_unit: calc?.serverQtyInSubUnit ?? (item.qtyInSubUnit ?? item.qty),
            qty_unit_type: item.qtyUnitType || 'sub',
            price: item.price,
            hpp: calc?.serverHppPerSubUnit ?? item.hpp,
            subtotal: calc?.subtotal ?? (item.qty * item.price),
            profit: calc?.profit ?? (item.qty * item.price),
          };
        });

        // ============================================================
        // Build compensating transaction steps
        // ============================================================
        const txSteps: TransactionStep<any>[] = [];

        // Step 1: Insert transaction
        txSteps.push(createStep('insert-transaction', async () => {
          const { data: created, error: insertError } = await db
            .from('transactions')
            .insert({
              id: transactionId,
              type: data.type,
              invoice_no: invoiceNo,
              unit_id: data.unitId,
              created_by_id: data.createdById,
              customer_id: cleanCustomerId,
              courier_id: cleanCourierId,
              supplier_id: cleanSupplierId,
              total,
              paid_amount: paidAmount,
              remaining_amount: remainingAmount,
              total_hpp: totalHpp,
              total_profit: totalProfit,
              hpp_paid: hppPaid,
              profit_paid: profitPaid,
              hpp_unpaid: hppUnpaid,
              profit_unpaid: profitUnpaid,
              payment_method: data.paymentMethod || 'cash',
              status,
              payment_status: paymentStatus,
              due_date: data.dueDate ? new Date(data.dueDate).toISOString() : null,
              notes: data.notes,
              delivery_address: data.deliveryAddress,
              delivered_at: isSelfDelivered ? new Date().toISOString() : null,
              transaction_date: txDate.toISOString(),
              courier_commission: 0,
              version: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select(`
              *,
              items:transaction_items(*, product:products(unit, subUnit, conversionRate)),
              unit:units(*),
              created_by:users!created_by_id(*),
              customer:customers(*)
            `)
            .single();

          if (insertError) throw insertError;
          return created;
        }, async (created) => {
          try {
            await db.from('transaction_items').delete().eq('transaction_id', created.id);
            await db.from('transactions').delete().eq('id', created.id);
          } catch { /* best effort */ }
        }));

        // Step 2: Insert transaction items
        txSteps.push(createStep('insert-transaction-items', async () => {
          const { error: itemsError } = await db
            .from('transaction_items')
            .insert(txItems);

          if (itemsError) {
            console.error('[TRANSACTION] Failed to insert items:', itemsError);
            throw itemsError;
          }
          return true;
        }, async () => {
          try { await db.from('transaction_items').delete().eq('transaction_id', transactionId); } catch { /* best effort */ }
        }));

        // Step 3: Update customer stats if sale (atomic — prevents race condition)
        if (cleanCustomerId && data.type === 'sale') {
          txSteps.push(createStep('update-customer-stats', async () => {
            const statsTimer = perfMonitor.timer('transaction.customer_stats');
            const { error: rpcError } = await db.rpc('atomic_increment_customer_stats', {
              p_customer_id: cleanCustomerId,
              p_order_delta: 1,
              p_spent_delta: total,
            });
            if (rpcError) {
              // Graceful fallback: try read-then-write (non-atomic but functional)
              console.warn('[TRANSACTION] atomic_increment_customer_stats RPC failed, falling back:', rpcError.message);
              const { data: customer } = await db
                .from('customers')
                .select('total_orders, total_spent')
                .eq('id', cleanCustomerId)
                .single();
              if (customer) {
                await db
                  .from('customers')
                  .update({
                    total_orders: (customer.total_orders || 0) + 1,
                    total_spent: (customer.total_spent || 0) + total,
                    last_transaction_date: new Date().toISOString()
                  })
                  .eq('id', cleanCustomerId);
                statsTimer.stop();
                return { fallback: true, prevOrders: customer.total_orders, prevSpent: customer.total_spent };
              }
              statsTimer.stop();
              return null;
            }
            statsTimer.stop();
            return { fallback: false };
          }, async (result) => {
            try {
              if (result?.fallback) {
                // Fallback path: restore exact previous values
                await db
                  .from('customers')
                  .update({
                    total_orders: result.prevOrders,
                    total_spent: result.prevSpent,
                  })
                  .eq('id', cleanCustomerId);
              } else {
                // Atomic path: just reverse the delta
                await db.rpc('atomic_increment_customer_stats', {
                  p_customer_id: cleanCustomerId,
                  p_order_delta: -1,
                  p_spent_delta: -total,
                });
              }
            } catch { /* best effort */ }
          }));
        }

        // Step 4: Deduct stock for sale transactions
        if (data.type === 'sale') {
          txSteps.push(createStep('deduct-stock', async () => {
            const stockTimer = perfMonitor.timer('transaction.stock_deduction');
            const saleProductIds = [...new Set<string>(items.map((item: any) => item.productId as string))];
            const { data: productsBatch } = await db
              .from('products')
              .select('*, unit_products:unit_products(*)')
              .in('id', saleProductIds);
            const stockProductMap = new Map((productsBatch || []).map((p: any) => [p.id, p]));

            // OPTIMIZATION: Batch centralized stock deductions via single RPC call
            const centralizedItems: Array<{ productId: string; qty: number }> = [];

            const deductedItems: Array<{ productId: string; qty: number; unitProductId?: string; stockType: string }> = [];

            for (const item of items) {
              const qtyToDeduct = item.qtyInSubUnit ?? item.qty;
              const product = stockProductMap.get(item.productId);

              if (!product) {
                console.error('Produk tidak ditemukan: ' + item.productId);
                continue;
              }

              // Skip stock deduction if trackStock is disabled for this product
              if (product.track_stock === false) {
                continue;
              }

              if (product.stock_type === 'centralized') {
                // Collect centralized deductions for batch RPC later
                centralizedItems.push({ productId: item.productId, qty: qtyToDeduct });
                deductedItems.push({ productId: item.productId, qty: qtyToDeduct, stockType: 'centralized' });
              } else if (product.stock_type === 'per_unit') {
                const { data: unitProduct } = await db
                  .from('unit_products')
                  .select('*')
                  .eq('unit_id', data.unitId)
                  .eq('product_id', item.productId)
                  .maybeSingle();

                if (unitProduct) {
                  if (unitProduct.stock < qtyToDeduct) {
                    throw new Error(`Stok unit tidak cukup untuk ${product.name}. Tersedia: ${unitProduct.stock}, Dibutuhkan: ${qtyToDeduct}`);
                  }
                  // Use combined RPC: decrement_unit_stock + recalc_global_stock in one call
                  const { error: rpcError } = await db.rpc('decrement_unit_stock_recalc', {
                    p_unit_product_id: unitProduct.id,
                    p_qty: qtyToDeduct
                  });
                  if (rpcError) {
                    // Fallback: try the old 2-call approach
                    console.warn('[TRANSACTION] decrement_unit_stock_recalc RPC failed, falling back:', rpcError.message);
                    const { error: decErr } = await db.rpc('decrement_unit_stock', {
                      p_unit_product_id: unitProduct.id,
                      p_qty: qtyToDeduct
                    });
                    if (decErr) {
                      throw new Error(`Stok unit tidak cukup untuk ${product.name}. ${decErr.message}`);
                    }
                    const { error: recalcErr } = await db.rpc('recalc_global_stock', { p_product_id: item.productId });
                    if (recalcErr) console.warn('recalc_global_stock warning (non-blocking):', recalcErr.message);
                  }
                  deductedItems.push({ productId: item.productId, qty: qtyToDeduct, unitProductId: unitProduct.id, stockType: 'per_unit' });
                }
              }

              stockDeductionLogs.push({
                type: 'activity',
                userId: data.createdById,
                action: 'stock_deducted_sale',
                entity: 'product',
                entityId: item.productId,
                payload: JSON.stringify({
                  transactionId,
                  invoiceNo,
                  qtyToDeduct,
                  qty: item.qty,
                  qtyUnitType: item.qtyUnitType || 'sub'
                })
              });
            }

            // Apply batch centralized stock deduction (all-or-nothing)
            if (centralizedItems.length > 0) {
              const { error: batchError } = await db.rpc('batch_decrement_centralized_stock', {
                p_product_ids: JSON.stringify(centralizedItems.map(i => i.productId)),
                p_quantities: JSON.stringify(centralizedItems.map(i => i.qty)),
              });
              if (batchError) {
                // Fallback: decrement one-by-one
                console.warn('[TRANSACTION] batch_decrement_centralized_stock RPC failed, falling back:', batchError.message);
                for (const ci of centralizedItems) {
                  const { error: rpcError } = await db.rpc('decrement_stock', {
                    p_product_id: ci.productId,
                    p_qty: ci.qty
                  });
                  if (rpcError) {
                    throw new Error(`Stok tidak cukup untuk ${ci.productId}. ${rpcError.message}`);
                  }
                }
              }
            }

            stockTimer.stop();
            return deductedItems;
          }, async (deductedItems) => {
            // Best-effort: increment stock back for all deducted items
            for (const di of deductedItems) {
              try {
                if (di.stockType === 'centralized') {
                  const { error: rpcError } = await db.rpc('increment_stock', {
                    p_product_id: di.productId,
                    p_qty: di.qty
                  });
                  if (rpcError) throw rpcError;
                } else if (di.stockType === 'per_unit' && di.unitProductId) {
                  const { error: rpcError } = await db.rpc('increment_unit_stock', {
                    p_unit_product_id: di.unitProductId,
                    p_qty: di.qty
                  });
                  if (rpcError) throw rpcError;
                  await db.rpc('recalc_global_stock', { p_product_id: di.productId });
                }
              } catch {
                // Fallback: direct update for centralized stock
                try {
                  if (di.stockType === 'centralized') {
                    const { data: product } = await db.from('products').select('global_stock').eq('id', di.productId).maybeSingle();
                    if (product) {
                      await db.from('products').update({ global_stock: (product.global_stock || 0) + di.qty }).eq('id', di.productId);
                    }
                  }
                } catch { /* best effort fallback */ }
              }
            }
          }));
        }

        // Step 5: Auto-create Payment record for paid cash/transfer sales
        // IMPORTANT: Skip auto-deposit when a courier is assigned
        if (shouldAutoPay) {
          txSteps.push(createStep('auto-payment-deposit', async () => {
            const paymentTimer = perfMonitor.timer('transaction.auto_payment');
            let targetCashBoxId: string | null = null;
            let targetBankAccountId: string | null = null;
            let balanceAccountTable: 'cash_boxes' | 'bank_accounts' | null = null;
            let balanceAccountId: string | null = null;
            let balanceDelta: number = 0;

            if (data.paymentMethod === 'cash') {
              const { data: activeCashBox } = await db
                .from('cash_boxes')
                .select('*')
                .eq('unit_id', data.unitId)
                .eq('is_active', true)
                .maybeSingle();
              if (activeCashBox) {
                if (data.type === 'purchase' && activeCashBox.balance < paidAmount) {
                  throw new Error('Saldo brankas tidak mencukupi untuk pembayaran tunai');
                }
                targetCashBoxId = activeCashBox.id;
                balanceAccountTable = 'cash_boxes';
                balanceAccountId = activeCashBox.id;
                balanceDelta = data.type === 'sale' ? paidAmount : -paidAmount;
                await atomicUpdateBalance('cash_boxes', activeCashBox.id, balanceDelta);
              } else {
                const { data: anyCashBox } = await db
                  .from('cash_boxes')
                  .select('*')
                  .eq('is_active', true)
                  .limit(1)
                  .maybeSingle();
                if (anyCashBox) {
                  if (data.type === 'purchase' && anyCashBox.balance < paidAmount) {
                    throw new Error('Saldo brankas tidak mencukupi untuk pembayaran tunai');
                  }
                  targetCashBoxId = anyCashBox.id;
                  balanceAccountTable = 'cash_boxes';
                  balanceAccountId = anyCashBox.id;
                  balanceDelta = data.type === 'sale' ? paidAmount : -paidAmount;
                  await atomicUpdateBalance('cash_boxes', anyCashBox.id, balanceDelta);
                }
              }
            } else {
              const { data: activeBankAccount } = await db
                .from('bank_accounts')
                .select('*')
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
              if (activeBankAccount) {
                targetBankAccountId = activeBankAccount.id;
                balanceAccountTable = 'bank_accounts';
                balanceAccountId = activeBankAccount.id;
                balanceDelta = data.type === 'sale' ? paidAmount : -paidAmount;
                await atomicUpdateBalance('bank_accounts', activeBankAccount.id, balanceDelta);
              }
            }

            const paymentId = generateId();
            if (targetCashBoxId || targetBankAccountId) {
              await db.from('payments').insert({
                id: paymentId,
                transaction_id: transactionId,
                received_by_id: authUserId,
                amount: paidAmount,
                payment_method: data.paymentMethod,
                cash_box_id: targetCashBoxId,
                bank_account_id: targetBankAccountId,
                hpp_portion: hppPaid,
                profit_portion: profitPaid,
                version: 1,
                paid_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              });
            } else {
              // FIX: No cash box or bank account found — don't create phantom paid transaction
              // Throw error so compensating rollback reverses the transaction's payment status
              console.error('[TRANSACTION] No active cash box or bank account found for auto-payment');
              throw new Error('Tidak ditemukan brankas atau rekening aktif. Silakan buat brankas/rekening terlebih dahulu di menu Keuangan.');
            }

            paymentTimer.stop();
            return { paymentId, balanceAccountTable, balanceAccountId, balanceDelta, hadPayment: !!(targetCashBoxId || targetBankAccountId) };
          }, async (result) => {
            // Rollback: reverse balance update and delete payment
            if (result.balanceAccountTable && result.balanceAccountId && result.hadPayment) {
              try { await atomicUpdateBalance(result.balanceAccountTable, result.balanceAccountId, -result.balanceDelta); } catch { /* best effort */ }
            }
            if (result.hadPayment) {
              try { await db.from('payments').delete().eq('id', result.paymentId); } catch { /* best effort */ }
            }
          }));
        }

        // Step 6: Update pool balances for sale auto-payments (inside transaction for rollback)
        if (shouldAutoPay && data.type === 'sale') {
          const poolDeltas: Array<{ key: string; delta: number }> = [];
          if (hppPaid > 0) poolDeltas.push({ key: 'pool_hpp_paid_balance', delta: hppPaid });
          if (profitPaid > 0) poolDeltas.push({ key: 'pool_profit_paid_balance', delta: profitPaid });

          if (poolDeltas.length > 0) {
            txSteps.push(createStep('update-pool-balances', async () => {
              for (const pd of poolDeltas) {
                await atomicUpdatePoolBalance(pd.key, pd.delta);
              }
              return poolDeltas;
            }, async (deltas) => {
              // Rollback: reverse each pool balance delta
              for (const pd of deltas) {
                try {
                  await atomicUpdatePoolBalance(pd.key, -pd.delta, -Infinity);
                } catch { /* best effort — pool balance rollback is best-effort */ }
              }
            }));
          }
        }

        // Execute all steps with compensating rollback
        await runInTransaction(txSteps);

        // ============================================================
        // Fire-and-forget operations (outside transaction)
        // ============================================================

        // Create log
        createLog(db, {
          type: 'activity',
          userId: data.createdById,
          action: 'transaction_created',
          entity: 'transaction',
          entityId: transactionId,
          payload: JSON.stringify({ type: data.type, total, invoiceNo, paymentMethod: data.paymentMethod })
        });

        // Create receivable for piutang/tempo sales AND cash sales with courier (courier collects payment)
        if (data.type === 'sale' && (paymentStatus === 'unpaid' || paymentStatus === 'partial') && (data.paymentMethod === 'piutang' || data.paymentMethod === 'tempo' || (data.paymentMethod === 'cash' && hasCourier))) {
          try {
            let customerName = 'Walk-in';
            let customerPhone = '';
            if (cleanCustomerId) {
              const { data: customer } = await db
                .from('customers')
                .select('name, phone')
                .eq('id', cleanCustomerId)
                .single();
              customerName = customer?.name || 'Walk-in';
              customerPhone = customer?.phone || '';
            }
            await db.from('receivables').insert({
              id: generateId(),
              transaction_id: transactionId,
              customer_name: customerName,
              customer_phone: customerPhone,
              total_amount: total,
              paid_amount: paidAmount,
              remaining_amount: remainingAmount,
              assigned_to_id: data.createdById,
              priority: data.dueDate && new Date(data.dueDate) < new Date() ? 'high' : 'normal',
              status: 'active',
              overdue_days: 0,
              reminder_count: 0,
              version: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          } catch (receivableError) {
            console.error('[RECEIVABLE] Auto-create error (non-blocking):', receivableError);
          }
        }

        // Fetch complete transaction with all relations
        const { data: fullTx } = await db
          .from('transactions')
          .select(`
            *,
            items:transaction_items(*, product:products(unit, subUnit, conversionRate)),
            unit:units(*),
            created_by:users!created_by_id(*),
            customer:customers(*)
          `)
          .eq('id', transactionId)
          .single();

        transaction = {
          ...toCamelCase(fullTx),
          createdBy: toCamelCase(fullTx?.created_by || null),
          customer: toCamelCase(fullTx?.customer || null),
          items: (fullTx?.items || []).map((i: any) => ({
            ...toCamelCase(i),
            product: toCamelCase(i.product || null)
          }))
        };
        break;
      } catch (error: any) {
        // Retry on unique constraint violation (duplicate invoice number)
        const isDuplicateKey = error.code === '23505' ||
          error.message?.includes('duplicate key') ||
          error.message?.includes('23505') ||
          error.message?.includes('unique constraint');
        if (isDuplicateKey && attempt < 2) continue;
        throw error;
      }
    }

    // Create stock deduction logs (fire-and-forget)
    Promise.all(stockDeductionLogs.map(logData => createLog(db, logData))).catch(console.error);

    // Create event (fire-and-forget)
    createEvent(db, 'transaction_created', {
      transactionId: transaction.id,
      invoiceNo,
      type: data.type,
      unitId: data.unitId,
      total,
      createdBy: transaction.createdBy?.name,
      courierId: cleanCourierId || null,
    });

    // Create courier-specific event so courier dashboard picks up new assignment
    if (cleanCourierId) {
      createEvent(db, 'courier_assigned', {
        transactionId: transaction.id,
        invoiceNo,
        courierId: cleanCourierId,
        customerName: transaction.customer?.name || 'Walk-in',
        total,
        paymentMethod: data.paymentMethod,
      });
    }

    // Low stock alerts (fire-and-forget)
    if (data.type === 'sale' && items.length > 0) {
      const productIds = items.map((item: any) => item.productId);
      const { data: productsAfterDeduction } = await db
        .from('products')
        .select('id, name, global_stock, min_stock')
        .in('id', productIds);
      for (const product of (productsAfterDeduction || [])) {
        if (product.global_stock <= product.min_stock) {
          createEvent(db, 'stock_low', {
            productId: product.id,
            productName: product.name,
            currentStock: product.global_stock,
            minStock: product.min_stock
          });
        }
      }
    }

    // Send WhatsApp notification for sales
    if (data.type === 'sale') {
      sendWhatsAppNotification(
        transaction,
        transaction.createdBy,
        transaction.customer,
        transaction.unit,
        !cleanCourierId
      ).catch(console.error);
    }

    wsTransactionUpdate({ invoiceNo: transaction.invoiceNo, type: transaction.type, status: transaction.status, unitId: transaction.unitId, courierId: cleanCourierId || undefined });
    wsStockUpdate({ unitId: transaction.unitId });

    perfMonitor.incrementCounter('transactions.create_success');

    // Log idempotency key after successful transaction creation
    if (idempotencyKey) {
      createLog(db, {
        type: 'activity',
        userId: authUserId,
        action: 'transaction_created_idempotent',
        entityId: idempotencyKey,
        payload: JSON.stringify({ transactionId: transaction.id, invoiceNo })
      });
    }

    // Add queue stats to response headers (non-breaking, informational)
    const headers = new Headers();
    const queueStats = concurrencyManager.getStats();
    headers.set('X-Queue-Pending', String(queueStats.pending));
    headers.set('X-Queue-Processing', String(queueStats.processing));
    return NextResponse.json({ transaction }, { headers });
    } finally {
      // Always stop timer and release all product locks (even on early returns)
      txTimer.stop();
      for (const release of releaseLocks) {
        try { release(); } catch {}
      }
    }
  } catch (error) {
    // Note: txTimer.stop() is already called in the finally block above,
    // no need to call it again here (was causing double-stop bug)
    perfMonitor.incrementCounter('transactions.create_failed');
    console.error('Create transaction error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    let status = 500;
    if (message.includes('tidak ditemukan')) status = 404;
    else if (message.includes('tidak cukup') || message.includes('wajib') || message.includes('tidak memiliki') || message.includes('Invalid') || message.includes('missing')) status = 400;
    else if (message.includes('Terlalu banyak')) status = 429;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId, generateInvoiceNo } from '@/lib/supabase-helpers';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { wsTransactionUpdate } from '@/lib/ws-dispatch';
import { pwaOrderLimiter } from '@/lib/rate-limiter';

// =====================================================================
// PWA Customer Orders
// GET /api/pwa/[code]/orders — Returns customer's transaction history
// POST /api/pwa/[code]/orders — Creates new order from customer PWA
// =====================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.trim().length === 0) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // Look up customer (only active)
    const { data: customer } = await db
      .from('customers')
      .select('id, unit_id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Fetch transactions for this customer (sale type only, with items and payment proofs)
    const { data: transactions } = await db
      .from('transactions')
      .select(`
        *,
        unit:units(id, name),
        created_by:users!created_by_id(id, name),
        items:transaction_items(*, product:products(unit, sub_unit))
      `)
      .eq('customer_id', customer.id)
      .eq('type', 'sale')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(100);

    // Fetch payment proofs for these transactions
    const txIds = (transactions || []).map((t: any) => t.id);
    let proofs: any[] = [];
    if (txIds.length > 0) {
      const { data: proofData } = await db
        .from('payment_proofs')
        .select('id, transaction_id, invoice_no, file_url, file_name, uploaded_at')
        .in('transaction_id', txIds)
        .order('uploaded_at', { ascending: false });
      proofs = proofData || [];
    }

    // Fetch cashback logs for this customer (earned from orders)
    const { data: cashbackLogs } = await db
      .from('cashback_log')
      .select('id, transaction_id, type, amount, created_at')
      .eq('customer_id', customer.id)
      .eq('type', 'earned')
      .order('created_at', { ascending: false });

    // Group proofs by transaction_id
    const proofsByTx = new Map<string, any[]>();
    for (const p of proofs) {
      const txId = p.transaction_id;
      if (!proofsByTx.has(txId)) proofsByTx.set(txId, []);
      proofsByTx.get(txId)!.push(toCamelCase(p));
    }

    // Map cashback by transaction_id
    const cashbackByTx = new Map<string, number>();
    for (const cl of (cashbackLogs || [])) {
      if (cl.transaction_id) {
        cashbackByTx.set(cl.transaction_id, (cashbackByTx.get(cl.transaction_id) || 0) + cl.amount);
      }
    }

    const transactionsCamel = (transactions || []).map((t: any) => {
      const camel = toCamelCase(t);
      return {
        ...camel,
        createdBy: camel.createdBy || null,
        unit: camel.unit || null,
        items: (camel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null,
        })),
        paymentProofs: proofsByTx.get(t.id) || [],
        cashbackEarned: cashbackByTx.get(t.id) || 0,
      };
    });

    return NextResponse.json({ orders: transactionsCamel });
  } catch (error) {
    console.error('PWA orders GET error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.trim().length === 0) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // FIX: Rate limiting per customer code
    const rateResult = pwaOrderLimiter(code.trim().toUpperCase());
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Terlalu banyak pesanan. Coba lagi nanti.' }, { status: 429 });
    }

    const data = await request.json();

    // Look up customer (only active)
    const { data: customer } = await db
      .from('customers')
      .select('id, name, phone, unit_id, assigned_to_id, cashback_balance, cashback_type, cashback_value')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    // Validate items — only need productId, productName, qty (NO price needed from customer)
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return NextResponse.json({ error: 'Item pesanan wajib diisi' }, { status: 400 });
    }

    for (const item of data.items) {
      if (!item.productId || !item.productName || !item.qty || item.qty <= 0) {
        return NextResponse.json({ error: 'Setiap item harus memiliki productId, productName, dan qty' }, { status: 400 });
      }
      // FIX: Validate qty is a number (not string)
      if (typeof item.qty !== 'number' || !Number.isFinite(item.qty)) {
        return NextResponse.json({ error: 'Jumlah item harus berupa angka' }, { status: 400 });
      }
    }

    // FIX: Verify all productIds exist in the database
    const productIds = data.items.map((item: any) => item.productId);
    const { data: existingProducts } = await db
      .from('products')
      .select('id')
      .in('id', productIds);
    const existingIds = new Set((existingProducts || []).map((p: any) => p.id));
    const missingIds = productIds.filter((id: string) => !existingIds.has(id));
    if (missingIds.length > 0) {
      return NextResponse.json({ error: 'Produk tidak ditemukan' }, { status: 400 });
    }

    // Payment method: default 'tempo' — sales/admin will set the actual method when approving
    const paymentMethod = 'tempo';

    // Generate invoice number
    // FIX: Add retry logic for race condition — concurrent orders may generate same invoice number
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let invoiceNo = '';
    let invoiceRetries = 0;
    const maxInvoiceRetries = 3;
    while (invoiceRetries < maxInvoiceRetries) {
      const { count: txCount } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'sale')
        .gte('created_at', monthStart.toISOString());
      // RESOLVED: UNIQUE constraint on (invoice_no) exists via Prisma schema @unique directive.
      // Race condition mitigation: append millisecond timestamp as tiebreaker suffix.
      const candidateInvoiceNo = generateInvoiceNo('sale', (txCount || 0) + invoiceRetries) + `-${Date.now().toString(36)}`;
      // Check if this invoice already exists (race condition guard)
      const { count: existingCount } = await db
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('invoice_no', candidateInvoiceNo);
      if (!existingCount || existingCount === 0) {
        invoiceNo = candidateInvoiceNo;
        break;
      }
      invoiceRetries++;
      console.warn(`[PWA ORDER] Invoice collision on ${candidateInvoiceNo}, retry ${invoiceRetries}/${maxInvoiceRetries}`);
    }
    if (!invoiceNo) {
      return NextResponse.json({ error: 'Gagal membuat nomor invoice. Coba lagi.' }, { status: 500 });
    }
    const transactionId = generateId();

    // Find the assigned sales user (or any sales in unit as fallback)
    let createdById = customer.assigned_to_id;
    if (!createdById) {
      const { data: salesUser } = await db
        .from('users')
        .select('id, name, phone')
        .eq('unit_id', customer.unit_id)
        .eq('role', 'sales')
        .eq('status', 'approved')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      createdById = salesUser?.id;
    }

    // Fallback to super_admin if no sales found
    if (!createdById) {
      const { data: anyAdmin } = await db
        .from('users')
        .select('id, name, phone')
        .eq('role', 'super_admin')
        .eq('status', 'approved')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      createdById = anyAdmin?.id;
    }

    if (!createdById) {
      return NextResponse.json({ error: 'Tidak ada user yang tersedia untuk menerima pesanan' }, { status: 400 });
    }

    // Build items list — explicitly extract only needed fields (no spreading)
    const items = data.items.map((item: any) => ({
      productId: item.productId,
      productName: item.productName,
      qty: item.qty,
      price: 0,
      hpp: 0,
      subtotal: 0,
      qtyInSubUnit: item.qty,
      qtyUnitType: 'main',
      profit: 0,
    }));

    // Create transaction — STATUS: PENDING (needs approval from sales/admin)
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .insert({
        id: transactionId,
        type: 'sale',
        invoice_no: invoiceNo,
        unit_id: customer.unit_id,
        created_by_id: createdById,
        customer_id: customer.id,
        total: 0,
        paid_amount: 0,
        remaining_amount: 0,
        total_hpp: 0,
        total_profit: 0,
        hpp_paid: 0,
        profit_paid: 0,
        hpp_unpaid: 0,
        profit_unpaid: 0,
        payment_method: paymentMethod,
        status: 'pending', // ← PENDING — menunggu approval sales/admin
        payment_status: 'unpaid',
        notes: `Order dari PWA (${customer.name})` + (data.notes ? ` — ${data.notes}` : ''),
        transaction_date: now.toISOString(),
        courier_commission: 0,
        version: 1,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .select(`
        *,
        unit:units(*),
        created_by:users!created_by_id(id, name, phone),
        customer:customers(*)
      `)
      .single();

    if (txError) {
      console.error('PWA order create error:', txError);
      return NextResponse.json({ error: 'Gagal membuat pesanan' }, { status: 500 });
    }

    // Insert transaction items with price=0 (sales will update later)
    const txItems = items.map((item: any) => ({
      id: generateId(),
      transaction_id: transactionId,
      product_id: item.productId,
      product_name: item.productName,
      qty: item.qty,
      qty_in_sub_unit: item.qty,
      qty_unit_type: item.qtyUnitType || 'main',
      price: 0,
      hpp: 0,
      subtotal: 0,
      profit: 0,
    }));

    const { error: itemsError } = await db.from('transaction_items').insert(txItems);

    if (itemsError) {
      // Rollback: delete the transaction since items insert failed
      console.error('PWA order items insert error:', itemsError);
      await db.from('transactions').delete().eq('id', transactionId);
      return NextResponse.json({ error: 'Gagal membuat item pesanan' }, { status: 500 });
    }

    // Create event for notification
    createEvent(db, 'pwa_order_pending', {
      transactionId,
      invoiceNo,
      type: 'sale',
      unitId: customer.unit_id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      salesId: createdById,
      source: 'pwa',
    }).catch(() => {});

    // Dispatch WebSocket update for real-time notification
    wsTransactionUpdate({ invoiceNo, type: 'sale', status: 'pending', unitId: customer.unit_id });

    // Send WhatsApp notification to sales
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && config.target_id) {
        const sales = (transaction as any).created_by;
        const itemsList = data.items.map((i: any) => `• ${i.productName} x${i.qty}`).join('\n');
        const payMethod = 'Tempo (ditentukan Sales/Admin)';
        const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const message = `🛒 *ORDER BARU DARI PWA*\n\n` +
          `📄 Invoice: ${invoiceNo}\n` +
          `👤 Pelanggan: ${customer.name}\n` +
          `📱 Telp: ${customer.phone || '-'}\n` +
          `📅 Tanggal: ${dateStr}\n` +
          `💰 Bayar: ${payMethod}\n\n` +
          `📦 *Daftar Item:*\n${itemsList}\n\n` +
          `⚠️ *Menunggu Persetujuan*\n` +
          `Order ini perlu di-set harga & metode bayar (Cash/Transfer/Tempo) dan di-approve oleh Sales/Admin.\n` +
          `Login ke ERP untuk memproses.`;

        const result = await sendMessage(config.token, config.target_id, message);
        if (!result.success && result.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('PWA WhatsApp notification error (non-blocking):', waErr);
    }

    const txCamel = toCamelCase(transaction);
    return NextResponse.json({
      order: {
        ...txCamel,
        createdBy: toCamelCase(txCamel.createdBy || null),
        customer: toCamelCase(txCamel.customer || null),
        unit: toCamelCase(txCamel.unit || null),
        items: items.map((i: any) => ({
          id: i.productId,
          productName: i.productName,
          qty: i.qty,
        })),
        cashbackEarned: 0,
        status: 'pending',
      },
    });
  } catch (error) {
    console.error('PWA orders POST error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

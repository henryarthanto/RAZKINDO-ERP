import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

// FIX: Add rate limiting to payment page endpoint
import { paymentPageLimiter } from '@/lib/rate-limiter';

/**
 * GET /api/payment/[invoiceNo]
 * PUBLIC — No authentication required
 * Returns transaction details for the customer-facing payment page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceNo: string }> }
) {
  try {
    const { invoiceNo } = await params;

    // FIX: Rate limiting — prevent brute-force invoice enumeration
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateResult = paymentPageLimiter(clientIp);
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, { status: 429 });
    }

    // Look up transaction by invoice_no with related data
    const { data: transaction, error } = await db
      .from('transactions')
      .select(`
        id, type, invoice_no, total, paid_amount, remaining_amount,
        payment_method, status, payment_status, due_date,
        transaction_date, deliveryAddress, notes,
        courier_commission, delivery_distance,
        customer:customers(id, name, phone, address),
        created_by:users!created_by_id(name),
        unit:units(name),
        items:transaction_items(id, product_id, product_name, qty, price, subtotal, qty_in_sub_unit, qty_unit_type, product:products(name))
      `)
      .eq('invoice_no', invoiceNo)
      .single();

    if (error || !transaction) {
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    // Check if transaction is cancelled
    if (transaction.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Transaksi sudah dibatalkan' },
        { status: 400 }
      );
    }

    // Fetch existing payment proofs for this transaction
    const { data: proofs } = await db
      .from('payment_proofs')
      .select('*')
      .eq('transaction_id', transaction.id)
      .order('uploaded_at', { ascending: false });

    // Mark all proofs as viewed (fire-and-forget)
    (async () => {
      try {
        await db.from('payment_proofs')
          .update({ viewed: true })
          .eq('transaction_id', transaction.id);
      } catch (err: any) {
        console.error('[Payment] Failed to mark proofs as viewed:', err);
      }
    })();

    const transactionCamel = toCamelCase(transaction);
    const proofsCamel = proofs ? proofs.map((p) => toCamelCase(p)) : [];

    // Check if already paid
    const alreadyPaid = transaction.payment_status === 'paid';

    return NextResponse.json({
      transaction: {
        ...transactionCamel,
        createdBy: transactionCamel.createdBy || null,
        customer: transactionCamel.customer || null,
        unit: transactionCamel.unit || null,
        items: (transactionCamel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null,
        })),
      },
      proofs: proofsCamel,
      ...(alreadyPaid ? { alreadyPaid: true } : {}),
    });
  } catch (error) {
    console.error('Get payment transaction error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

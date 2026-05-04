import { NextRequest, NextResponse } from 'next/server';
import { verifyAndGetAuthUser } from '@/lib/token';
import { createQrisPayment, isQrisConfigured } from '@/lib/qris-service';
import { db } from '@/lib/supabase';
import { createLog } from '@/lib/supabase-helpers';

/**
 * POST /api/payments/qris/create
 * Create a QRIS payment for a transaction.
 *
 * Body: {
 *   transactionId: string,
 *   expiresInMinutes?: number (default: 1440 = 24h)
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isQrisConfigured()) {
      return NextResponse.json({
        error: 'Pembayaran QRIS belum dikonfigurasi. Set TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, dan TRIPAY_MERCHANT_CODE di .env',
      }, { status: 503 });
    }

    const body = await request.json();
    const { transactionId, expiresInMinutes } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID diperlukan' }, { status: 400 });
    }

    // Fetch transaction details
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select(`
        *,
        customer:customers(*)
      `)
      .eq('id', transactionId)
      .maybeSingle();

    if (txError || !transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    const tx = transaction as any;
    const remaining = Number(tx.remaining_amount) || Number(tx.total);

    if (remaining <= 0) {
      return NextResponse.json({ error: 'Transaksi sudah lunas' }, { status: 400 });
    }

    // Build callback and return URLs
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const callbackUrl = `${baseUrl}/api/payments/qris/callback`;
    const returnUrl = `${baseUrl}/?qris_callback=1`;

    // Create QRIS payment via Tripay
    const qrisResult = await createQrisPayment({
      invoiceNo: tx.invoice_no,
      amount: remaining,
      customerName: tx.customer?.name || '',
      customerEmail: tx.customer?.email || '',
      customerPhone: tx.customer?.phone || '',
      callbackUrl,
      returnUrl,
      expiresInMinutes: expiresInMinutes || 1440,
    });

    // Save payment reference to database for tracking
    await db.from('qris_payments').upsert({
      id: crypto.randomUUID(),
      transaction_id: transactionId,
      reference: qrisResult.reference,
      merchant_ref: qrisResult.merchant_ref,
      amount: qrisResult.amount,
      status: 'pending',
      qr_url: qrisResult.qr_url || qrisResult.pay_url,
      checkout_url: qrisResult.checkout_url,
      expired_time: new Date(qrisResult.expired_time * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'transaction_id' });

    createLog(db, {
      type: 'audit',
      action: 'qris_payment_created',
      entity: 'transaction',
      entityId: transactionId,
      message: `QRIS payment created for ${tx.invoice_no} — Rp ${remaining.toLocaleString('id-ID')}`,
    });

    return NextResponse.json({
      success: true,
      reference: qrisResult.reference,
      qrUrl: qrisResult.qr_url || qrisResult.pay_url,
      checkoutUrl: qrisResult.checkout_url,
      expiresIn: qrisResult.expired_time,
      amount: qrisResult.amount,
      fee: qrisResult.fee_customer,
      totalAmount: qrisResult.amount + qrisResult.fee_customer,
    });
  } catch (error) {
    console.error('[QRIS] Create payment error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

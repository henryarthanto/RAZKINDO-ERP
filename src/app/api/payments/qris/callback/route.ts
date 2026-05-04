import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyTripaySignature, mapTripayStatus, getQrisStatus } from '@/lib/qris-service';
import { createLog, createEvent } from '@/lib/supabase-helpers';
import { toCamelCase } from '@/lib/supabase-helpers';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';

/**
 * POST /api/payments/qris/callback
 * Webhook endpoint for Tripay payment callbacks.
 *
 * This endpoint is called by Tripay when a QRIS payment status changes.
 * It verifies the signature and updates the transaction accordingly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Verify callback signature
    const isValid = await verifyTripaySignature(body);
    if (!isValid) {
      console.error('[QRIS] Invalid callback signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const { reference, merchant_ref, status, paid_amount, paid_at } = body;
    const internalStatus = mapTripayStatus(status);

    // Find the QRIS payment record
    const { data: qrisPayment, error: qrisError } = await db
      .from('qris_payments')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    if (qrisError || !qrisPayment) {
      console.error('[QRIS] Payment record not found for reference:', reference);
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const qris = toCamelCase(qrisPayment);

    // Skip if already processed
    if (qris.status === 'paid' || qris.status === internalStatus) {
      return NextResponse.json({ success: true, message: 'Already processed' });
    }

    // Update QRIS payment status
    await db
      .from('qris_payments')
      .update({
        status: internalStatus,
        paid_at: paid_at ? new Date(paid_at).toISOString() : null,
        paid_amount: paid_amount || qris.amount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', qris.id);

    // If paid, process the payment for the transaction
    if (internalStatus === 'paid') {
      const transactionId = qris.transactionId;
      const paymentAmount = Number(paid_amount) || qris.amount;

      // Fetch transaction
      const { data: transaction } = await db
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();

      if (!transaction) {
        console.error('[QRIS] Transaction not found:', transactionId);
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
      }

      const tx = toCamelCase(transaction);
      const remaining = Number(tx.remainingAmount) || Number(tx.total);
      const actualPaid = Math.min(paymentAmount, remaining);

      // Create payment record
      const paymentId = crypto.randomUUID();
      await db.from('payments').insert({
        id: paymentId,
        transaction_id: transactionId,
        amount: actualPaid,
        method: 'qris',
        reference: reference,
        status: 'confirmed',
        paid_at: paid_at ? new Date(paid_at).toISOString() : new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

      // Update pool balances (HPP + profit portion)
      const hppPortion = Math.round(actualPaid * ((tx.totalHpp || 0) / (tx.total || 1)) * 100) / 100;
      const profitPortion = Math.round((actualPaid - hppPortion) * 100) / 100;

      try {
        await atomicUpdatePoolBalance('pool_hpp_paid_balance', hppPortion, 0);
      } catch (e) {
        console.error('[QRIS] Failed to update HPP pool:', e);
      }
      try {
        await atomicUpdatePoolBalance('pool_profit_paid_balance', profitPortion, 0);
      } catch (e) {
        console.error('[QRIS] Failed to update profit pool:', e);
      }

      // Update transaction payment status
      const newPaidAmount = Number(tx.paidAmount || 0) + actualPaid;
      const newRemaining = Number(tx.total || 0) - newPaidAmount;
      const paymentStatus = newRemaining <= 0 ? 'paid' : 'partial';

      await db
        .from('transactions')
        .update({
          paid_amount: newPaidAmount,
          remaining_amount: Math.max(0, newRemaining),
          payment_status: paymentStatus,
          hpp_paid: Number(tx.hppPaid || 0) + hppPortion,
          profit_paid: Number(tx.profitPaid || 0) + profitPortion,
          hpp_unpaid: Math.max(0, Number(tx.totalHpp || 0) - Number(tx.hppPaid || 0) - hppPortion),
          profit_unpaid: Math.max(0, Number(tx.totalProfit || 0) - Number(tx.profitPaid || 0) - profitPortion),
          updated_at: new Date().toISOString(),
        })
        .eq('id', transactionId);

      // Update receivable status if fully paid
      if (paymentStatus === 'paid') {
        await db
          .from('receivables')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('transaction_id', transactionId)
          .neq('status', 'cancelled');
      }

      // Log and events
      createLog(db, {
        type: 'audit',
        action: 'qris_payment_received',
        entity: 'transaction',
        entityId: transactionId,
        message: `QRIS payment received for ${tx.invoiceNo} — Rp ${actualPaid.toLocaleString('id-ID')}`,
      });

      createEvent(db, 'payment_received', {
        transactionId,
        invoiceNo: tx.invoiceNo,
        amount: actualPaid,
        method: 'QRIS',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[QRIS] Callback error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

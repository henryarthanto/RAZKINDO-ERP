import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, toSnakeCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { wsDeliveryUpdate } from '@/lib/ws-dispatch';
import { atomicUpdatePoolBalance } from '@/lib/atomic-ops';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export async function PATCH(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const data = await request.json();
    const { transactionId, courierId, paymentMethod, amount, referenceNo } = data;

    if (!transactionId || !courierId) return NextResponse.json({ error: 'transactionId dan courierId diperlukan' }, { status: 400 });

    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    if (authUser.role !== 'kurir' && authUser.role !== 'super_admin') return NextResponse.json({ error: 'Hanya kurir atau Super Admin yang dapat menyelesaikan pengiriman' }, { status: 403 });
    if (authUser.role === 'kurir' && authUserId !== courierId) return NextResponse.json({ error: 'Kurir hanya bisa menyelesaikan pengiriman miliknya sendiri' }, { status: 403 });

    const VALID_METHODS = ['cash', 'transfer', 'giro', 'piutang', 'tempo'];
    if (paymentMethod && !VALID_METHODS.includes(paymentMethod)) return NextResponse.json({ error: 'Metode pembayaran tidak valid' }, { status: 400 });
    if (paymentMethod && (typeof amount !== 'number' || amount <= 0)) return NextResponse.json({ error: 'Jumlah pembayaran harus berupa angka positif' }, { status: 400 });

    // Get transaction
    const { data: transaction, error: txError } = await db.from('transactions').select(`
      *, customer:customers(id, name, distance, phone), courier:users!courier_id(id, name, near_commission, far_commission, unit_id)
    `).eq('id', transactionId).single();
    if (txError || !transaction) {
      // Re-check without courier join to give better error message
      const { data: txOnly } = await db.from('transactions').select('id, courier_id').eq('id', transactionId).maybeSingle();
      if (txOnly && txOnly.courier_id) {
        console.error('[COURIER DELIVER] Transaction exists but courier user not found:', { transactionId, courierId: txOnly.courier_id });
        throw new Error('Data kurir tidak ditemukan — hubungi admin');
      }
      console.error('[COURIER DELIVER] Transaction not found:', { transactionId, txError: txError?.message, courierId });
      throw new Error('Transaksi tidak ditemukan');
    }
    if (transaction.courier_id !== courierId) throw new Error('Transaksi bukan milik kurir ini');
    if (transaction.delivered_at) throw new Error('Transaksi sudah dikirim');
    if (transaction.status === 'cancelled') throw new Error('Transaksi sudah dibatalkan');
    if (transaction.type !== 'sale') throw new Error('Hanya transaksi penjualan yang dapat dikirim');
    if (transaction.payment_status === 'paid') {
      throw new Error('Transaksi sudah lunas');
    }

    // Get courier info
    const { data: courier } = await db.from('users').select('name, near_commission, far_commission, unit_id').eq('id', courierId).single();
    if (!courier) throw new Error('Kurir tidak ditemukan');

    const distance = (transaction.customer as any)?.distance || 'near';
    const commission = distance === 'far' ? (courier.far_commission || 0) : (courier.near_commission || 0);

    const updateData: Record<string, any> = {
      delivered_at: new Date().toISOString(),
      courier_commission: commission,
      delivery_distance: distance,
    };

    let paymentRecord: any = null;

    if (paymentMethod && amount && amount > 0) {
      if (amount > transaction.remaining_amount) throw new Error(`Jumlah pembayaran melebihi sisa tagihan (${formatCurrency(transaction.remaining_amount)})`);

      const hppPortion = transaction.total > 0 ? (transaction.total_hpp / transaction.total) * amount : 0;
      const profitPortion = transaction.total > 0 ? (transaction.total_profit / transaction.total) * amount : 0;

      const payData = toSnakeCase({
        id: generateId(),
        transactionId, receivedById: courierId, amount,
        // paymentMethod intentionally excluded from toSnakeCase — DB column is camelCase
        referenceNo: referenceNo || null, notes: `Pembayaran saat pengiriman oleh ${courier.name}`,
        hppPortion, profitPortion,
        version: 1,
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      // Payment.paymentMethod has NO @map — DB column is camelCase, not snake_case
      payData.paymentMethod = paymentMethod;
      const { data: payment, error: payError } = await db.from('payments').insert(payData).select().single();
      if (payError) throw payError;
      paymentRecord = payment;

      // Update pool balances for sale delivery payments (best-effort)
      try {
        if (hppPortion > 0) {
          await atomicUpdatePoolBalance('pool_hpp_paid_balance', hppPortion);
        }
        if (profitPortion > 0) {
          await atomicUpdatePoolBalance('pool_profit_paid_balance', profitPortion);
        }
      } catch (poolError) {
        console.error('[COURIER DELIVER] Failed to update pool balance (non-blocking):', poolError);
      }

      const newPaid = transaction.paid_amount + amount;
      const newRemaining = Math.max(0, transaction.remaining_amount - amount);
      updateData.paid_amount = newPaid;
      updateData.remaining_amount = newRemaining;
      updateData.hpp_paid = (transaction.hpp_paid || 0) + hppPortion;
      updateData.profit_paid = (transaction.profit_paid || 0) + profitPortion;
      updateData.hpp_unpaid = Math.max(0, (transaction.hpp_unpaid || 0) - hppPortion);
      updateData.profit_unpaid = Math.max(0, (transaction.profit_unpaid || 0) - profitPortion);
      updateData.payment_status = newRemaining <= 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
      if (newRemaining <= 0 && transaction.status === 'approved') updateData.status = 'paid';
    }

    // ── Step 1: Always update delivery fields (delivered_at, courier_commission, delivery_distance) ──
    const deliveryUpdateData: Record<string, any> = {
      delivered_at: updateData.delivered_at,
      courier_commission: updateData.courier_commission,
      delivery_distance: updateData.delivery_distance,
    };
    const { data: deliveredTx, error: deliveryError } = await db
      .from('transactions')
      .update(deliveryUpdateData)
      .eq('id', transactionId)
      .is('delivered_at', null) // optimistic lock: prevent double delivery
      .select('id, payment_status')
      .maybeSingle();
    if (deliveryError) throw deliveryError;
    if (!deliveredTx) {
      // Delivery already completed, clean up orphaned payment if any
      if (paymentRecord) {
        try { await db.from('payments').delete().eq('id', paymentRecord.id); } catch {}
      }
      return NextResponse.json({ error: 'Transaksi sudah dikirim' }, { status: 400 });
    }

    // ── Step 2: Update payment fields only if a payment was collected ──
    if (paymentMethod && amount && amount > 0) {
      const paymentUpdateData: Record<string, any> = {
        paid_amount: updateData.paid_amount,
        remaining_amount: updateData.remaining_amount,
        hpp_paid: updateData.hpp_paid,
        profit_paid: updateData.profit_paid,
        hpp_unpaid: updateData.hpp_unpaid,
        profit_unpaid: updateData.profit_unpaid,
        payment_status: updateData.payment_status,
        status: updateData.status,
      };
      const { error: payUpdateError } = await db
        .from('transactions')
        .update(paymentUpdateData)
        .eq('id', transactionId)
        .neq('payment_status', 'paid')
        .eq('paid_amount', updateData.paid_amount - data.amount); // FIX: Additional optimistic lock — prevent concurrent double-credit
      if (payUpdateError) throw payUpdateError;
    }

    // Update linked receivable
    if (paymentMethod && amount && amount > 0) {
      const { data: receivable } = await db.from('receivables').select('*').eq('transaction_id', transactionId).maybeSingle();
      if (receivable && receivable.status !== 'paid') {
        const newRemaining = Math.max(0, (receivable.remaining_amount || 0) - amount);
        const rStatus = updateData.payment_status === 'paid' ? 'paid' : 'active';
        await db.from('receivables').update({ paid_amount: (receivable.paid_amount || 0) + amount, remaining_amount: newRemaining, status: rStatus }).eq('id', receivable.id);
      }
    }

    // Update courier cash balance for cash payments (atomic to prevent race condition)
    const cashUnitId = courier.unit_id || transaction.unit_id;
    if (paymentMethod === 'cash' && amount && amount > 0 && cashUnitId) {
      let ccSuccess = false;
      let ccNewBalance = 0;
      let lastError = '';
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { data: newBalance, error: ccError } = await db.rpc('atomic_add_courier_cash', {
          p_courier_id: courierId,
          p_unit_id: cashUnitId,
          p_delta: amount,
        });
        if (!ccError) {
          ccNewBalance = Number(newBalance) || 0;
          ccSuccess = true;
          break;
        }
        lastError = ccError.message || 'Unknown RPC error';
        console.error(`[COURIER DELIVER] Courier cash credit attempt ${attempt}/3 failed:`, lastError);
        if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt)); // backoff
      }
      if (!ccSuccess) {
        // CRITICAL: Courier cash was NOT credited. The delivery still succeeds, but the
        // courier won't see this cash in their balance, making subsequent handovers fail.
        // Log detailed info for debugging.
        console.error(`[COURIER DELIVER] CRITICAL: All 3 attempts to credit courier cash failed. Details:`, {
          courierId, cashUnitId, amount, transactionId, invoiceNo: transaction.invoice_no,
          rpcError: lastError,
        });
      }
      createLog(db, { type: 'activity', userId: courierId, action: 'courier_cash_collected', entity: 'transaction', entityId: transactionId, payload: JSON.stringify({ amount, invoiceNo: transaction.invoice_no, unitId: cashUnitId, newBalance: ccNewBalance, success: ccSuccess, lastError: ccSuccess ? undefined : lastError }), message: `Kurir ${courier.name} mengumpulkan ${formatCurrency(amount)} dari ${transaction.invoice_no}${ccSuccess ? '' : ` [GAGAL: ${lastError}]`}` });
    } else if (paymentMethod === 'cash' && amount && amount > 0 && !cashUnitId) {
      // Cash payment collected but no unit ID available — cannot credit courier cash
      console.error(`[COURIER DELIVER] WARNING: Cash payment collected but no unitId to credit courier cash. courier.unit_id=${courier.unit_id}, transaction.unit_id=${transaction.unit_id}`);
      createLog(db, { type: 'activity', userId: courierId, action: 'courier_cash_collected_skip', entity: 'transaction', entityId: transactionId, payload: JSON.stringify({ amount, invoiceNo: transaction.invoice_no, courierUnitId: courier.unit_id, txUnitId: transaction.unit_id }), message: `Kurir ${courier.name} mengumpulkan ${formatCurrency(amount)} dari ${transaction.invoice_no} [DILEWATI: tidak ada unitId]` });
    }

    createLog(db, { type: 'activity', userId: courierId, action: 'delivery_completed', entity: 'transaction', entityId: transactionId, payload: JSON.stringify({ invoiceNo: transaction.invoice_no, customerName: (transaction.customer as any)?.name, paymentMethod, amount, commission }), message: `Pengiriman ${transaction.invoice_no} selesai oleh ${courier.name}` });
    createEvent(db, 'transaction_delivered', { transactionId, invoiceNo: transaction.invoice_no, courierId, courierName: courier.name, customerName: (transaction.customer as any)?.name, paymentMethod, amount });

    wsDeliveryUpdate({ transactionId, courierId, status: 'delivered' });

    return NextResponse.json({ transaction: toCamelCase({ ...transaction, ...updateData }), payment: paymentRecord ? toCamelCase(paymentRecord) : null, commission });
  } catch (error) {
    console.error('Courier deliver error:', error);
    const message = error instanceof Error ? error.message : '';
    if (message.includes('tidak ditemukan') || message.includes('bukan milik') || message.includes('sudah dikirim') || message.includes('sudah dibatalkan') || message.includes('melebihi') || message.includes('tidak valid')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

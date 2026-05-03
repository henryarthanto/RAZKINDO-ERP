import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createEvent, generateId, createLog } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { atomicUpdateBalance, atomicUpdatePoolBalance } from '@/lib/atomic-ops';
import { wsTransactionUpdate, wsPaymentUpdate, wsReceivableUpdate } from '@/lib/ws-dispatch';
import { recalculateTransactionHpp, type SmartProduct } from '@/lib/smart-hpp';

// =====================================================================
// Mark Transaction as LUNAS (Fully Paid)
// POST /api/transactions/mark-lunas
//   Body: { transactionId, cashBoxId?, bankAccountId? }
//   Roles allowed: super_admin, sales, kurir, keuangan
//   - Sets payment_status = 'paid', paid_amount = total
//   - Creates payment record (deposits to brankas/bank)
//   - Updates pool balances (hpp_paid, profit_paid)
//   - Calculates cashback (only if order is lunas)
//   - Updates customer total_spent
//   - Sends WhatsApp notification to customer
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true, id: true, name: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { user: authUser } = result;
    const body = await request.json();
    const { transactionId, cashBoxId, bankAccountId } = body;

    if (!transactionId) {
      return NextResponse.json({ error: 'Transaction ID wajib diisi' }, { status: 400 });
    }

    // Role check: only super_admin, sales, kurir, keuangan can mark lunas
    const allowedRoles = ['super_admin', 'sales', 'kurir', 'keuangan'];
    if (!allowedRoles.includes(authUser.role)) {
      return NextResponse.json(
        { error: 'Hanya kurir, sales, super admin, atau keuangan yang bisa menandai lunas' },
        { status: 403 }
      );
    }

    // Fetch the transaction with full details
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select(`
        *,
        customer:customers(id, name, phone, unit_id, assigned_to_id, cashback_balance, cashback_type, cashback_value, total_orders, total_spent),
        unit:units(id, name),
        items:transaction_items(*, product:products(id, name, avg_hpp, purchase_price, unit, sub_unit, conversion_rate, selling_price, sell_price_per_sub_unit))
      `)
      .eq('id', transactionId)
      .single();

    if (txError || !transaction) {
      console.error('[MARK_LUNAS] Transaction not found:', { transactionId, txError: txError?.message });
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }

    const txCamel = toCamelCase(transaction);

    // Only mark approved sale transactions
    if (txCamel.status !== 'approved') {
      return NextResponse.json({ error: 'Transaksi belum di-approve' }, { status: 400 });
    }

    if (txCamel.type !== 'sale') {
      return NextResponse.json({ error: 'Hanya transaksi penjualan yang bisa ditandai lunas' }, { status: 400 });
    }

    if (txCamel.paymentStatus === 'paid') {
      return NextResponse.json({ error: 'Transaksi sudah lunas' }, { status: 400 });
    }

    // ─── SMART HPP RECALCULATION — verify stored HPP against current product data ───
    // This catches cases where HPP was stored incorrectly (e.g., sales user with HPP hidden)
    const productMap = new Map<string, SmartProduct>();
    const productIdsWithZeroHpp: string[] = [];
    if (txCamel.items) {
      for (const item of txCamel.items) {
        const prod = (item as any).product;
        if (prod) {
          productMap.set(item.productId, {
            id: prod.id,
            avgHpp: prod.avgHpp || 0,
            purchasePrice: (prod as any).purchasePrice || 0,
            conversionRate: prod.conversionRate || 1,
            sellingPrice: prod.sellingPrice || 0,
            sellPricePerSubUnit: prod.sellPricePerSubUnit || 0,
            trackStock: true,
            stockType: 'centralized',
            unit: prod.unit || null,
            subUnit: prod.subUnit || null,
            name: prod.name || '',
          });
          // Track products with zero HPP for Tier 3 fallback
          if ((!prod.avgHpp || prod.avgHpp === 0) && (!(prod as any).purchasePrice || (prod as any).purchasePrice === 0)) {
            productIdsWithZeroHpp.push(item.productId);
          }
        }
      }
    }

    // FIX: Fetch Tier 3 HPP fallback for products with zero avgHpp AND purchasePrice
    // Without this, zero-HPP products inflate profit_paid (entire selling price becomes "profit")
    let fallbackHppMap: Map<string, number> | undefined;
    if (productIdsWithZeroHpp.length > 0) {
      try {
        const { fetchPurchaseHistoryHpp } = await import('@/lib/smart-hpp');
        fallbackHppMap = await fetchPurchaseHistoryHpp(productIdsWithZeroHpp, db);
      } catch (err) {
        console.error('[MARK_LUNAS] Failed to fetch Tier 3 HPP fallback:', err);
      }
    }

    const recalcResult = recalculateTransactionHpp(txCamel.items || [], productMap, fallbackHppMap);
    if (recalcResult.warnings.length > 0) {
      console.warn(`[SMART-HPP] Mark Lunas ${txCamel.invoiceNo}:`, recalcResult.warnings.join(' | '));
    }

    // Use recalculated values if they differ from stored (auto-correct stale HPP)
    let hppPortion = recalcResult.correctTotalHpp;
    let profitPortion = recalcResult.correctTotalProfit;
    const needsHppCorrection = recalcResult.staleItems.length > 0;

    // If stored HPP was wrong, also correct the transaction items and transaction totals
    if (needsHppCorrection) {
      console.log(`[SMART-HPP] Auto-correcting HPP for ${txCamel.invoiceNo}: ${recalcResult.staleItems.length} item(s) affected`);
      // Update each stale transaction item
      for (const stale of recalcResult.staleItems) {
        try {
          await db.from('transaction_items').update({
            hpp: stale.currentHpp,
            profit: stale.correctProfit,
          }).eq('id', stale.itemId);
        } catch (err) {
          console.error(`[SMART-HPP] Failed to correct item ${stale.itemId}:`, err);
        }
      }
      // Update transaction totals
      try {
        await db.from('transactions').update({
          total_hpp: recalcResult.correctTotalHpp,
          total_profit: recalcResult.correctTotalProfit,
          hpp_unpaid: recalcResult.correctTotalHpp - (txCamel.hppPaid || 0),
          profit_unpaid: recalcResult.correctTotalProfit - (txCamel.profitPaid || 0),
        }).eq('id', transactionId);
      } catch (err) {
        console.error(`[SMART-HPP] Failed to correct transaction ${txCamel.invoiceNo}:`, err);
      }
    }

    const total = txCamel.total;
    const customer = txCamel.customer;
    const paymentMethod = txCamel.paymentMethod;

    // Customer is optional — walk-in sales may have no customer
    // Skip cashback logic if no customer is linked
    if (!customer) {
      console.log('[MARK-LUNAS] Proceeding without customer (walk-in sale):', transactionId);
    }

    // ─── HPP/Profit portions already calculated above via smart recalculation ───

    // ─── Determine cash flow: courier-assigned cash → courier balance; otherwise → brankas/bank ───
    const hasCourier = !!txCamel.courierId;
    const isCashWithCourier = paymentMethod === 'cash' && hasCourier;
    // For tempo orders with courier, treat like cash-with-courier
    const isTempoWithCourier = paymentMethod === 'tempo' && hasCourier;

    let targetCashBoxId: string | null = null;
    let targetBankAccountId: string | null = null;
    let targetCashBoxName: string | null = null;
    let targetBankAccountName: string | null = null;

    if (isCashWithCourier || isTempoWithCourier) {
      // Cash/tempo with courier: money goes to courier's cash balance, NOT directly to brankas.
      // Courier will deposit to brankas later via "Setor ke Brankas" (handover).
      // No cashBoxId required.
    } else if (paymentMethod === 'cash') {
      // Cash without courier (self-delivered): deposit directly to brankas
      if (!cashBoxId) {
        return NextResponse.json({ error: 'Pilih brankas tujuan untuk pembayaran tunai' }, { status: 400 });
      }
      const { data: cashBox, error: cbError } = await db.from('cash_boxes').select('*').eq('id', cashBoxId).maybeSingle();
      if (cbError) {
        return NextResponse.json({ error: cbError.message }, { status: 500 });
      }
      if (!cashBox) return NextResponse.json({ error: 'Brankas tidak ditemukan' }, { status: 404 });
      if (!cashBox.is_active) return NextResponse.json({ error: 'Brankas tidak aktif' }, { status: 400 });
      targetCashBoxId = cashBoxId;
      targetCashBoxName = cashBox.name;
    } else if (paymentMethod === 'transfer' || paymentMethod === 'giro') {
      if (!bankAccountId) {
        return NextResponse.json({ error: 'Pilih akun bank tujuan untuk pembayaran transfer/giro' }, { status: 400 });
      }
      const { data: bankAccount, error: baError } = await db.from('bank_accounts').select('*').eq('id', bankAccountId).maybeSingle();
      if (baError) {
        return NextResponse.json({ error: baError.message }, { status: 500 });
      }
      if (!bankAccount) return NextResponse.json({ error: 'Akun bank tidak ditemukan' }, { status: 404 });
      if (!bankAccount.is_active) return NextResponse.json({ error: 'Akun bank tidak aktif' }, { status: 400 });
      targetBankAccountId = bankAccountId;
      targetBankAccountName = bankAccount.name;
    }

    // ─── RACE FIX #3: Financial operations BEFORE status change ───
    // 1. Create payment record FIRST
    // 2. Update balance
    // 3. THEN set status to 'paid' last
    // This ensures financial consistency: if status is 'paid', the financial records exist.

    // Step 1: Create payment record
    const paymentId = generateId();
    const { error: paymentError } = await db.from('payments').insert({
      id: paymentId,
      transaction_id: transactionId,
      received_by_id: authUser.id,
      amount: total,
      payment_method: paymentMethod,
      cash_box_id: targetCashBoxId,
      bank_account_id: targetBankAccountId,
      hpp_portion: hppPortion,
      profit_portion: profitPortion,
      notes: `Pelunasan invoice ${txCamel.invoiceNo} oleh ${authUser.name} (${authUser.role})`,
      version: 1,
      paid_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    if (paymentError) {
      console.error('Failed to create payment record:', paymentError);
      return NextResponse.json({ error: 'Gagal membuat catatan pembayaran' }, { status: 500 });
    }

    // Step 2: Credit destination account balance (atomic)
    try {
      if (targetCashBoxId) {
        await atomicUpdateBalance('cash_boxes', targetCashBoxId, total);
      }
      if (targetBankAccountId) {
        await atomicUpdateBalance('bank_accounts', targetBankAccountId, total);
      }
    } catch (balanceErr: any) {
      console.error('Failed to update destination balance, rolling back payment record:', balanceErr);
      // Compensating rollback: delete the payment record since balance update failed
      await db.from('payments').delete().eq('id', paymentId);
      return NextResponse.json({ error: 'Gagal memperbarui saldo tujuan' }, { status: 500 });
    }

    // Step 2b: Credit courier cash balance (non-blocking — failure doesn't prevent lunas)
    if ((isCashWithCourier || isTempoWithCourier) && txCamel.courierId) {
      try {
        const { data: courierData, error: courierError } = await db.from('users').select('name, unit_id').eq('id', txCamel.courierId).maybeSingle();
        if (courierError) {
          console.error('[MARK_LUNAS] Courier lookup error:', courierError);
        }
        const courierUnitId = courierData?.unit_id || txCamel.unitId;
        if (courierUnitId) {
          const alreadyCollected = txCamel.paidAmount || 0;
          const remainingToCollect = Math.max(0, total - alreadyCollected);

          if (remainingToCollect > 0) {
            const { data: newBalance, error: ccError } = await db.rpc('atomic_add_courier_cash', {
              p_courier_id: txCamel.courierId,
              p_unit_id: courierUnitId,
              p_delta: remainingToCollect,
            });
            if (ccError) {
              console.error('[MARK_LUNAS] Failed to add courier cash (non-blocking):', ccError.message);
            } else {
              console.log(`[MARK_LUNAS] Cash Rp ${remainingToCollect.toLocaleString('id-ID')} from ${txCamel.invoiceNo} added to courier ${courierData?.name || txCamel.courierId} balance (new: ${newBalance})`);
            }
          } else {
            console.log(`[MARK_LUNAS] Skipping courier cash credit for ${txCamel.invoiceNo} — courier already collected full amount (Rp ${alreadyCollected.toLocaleString('id-ID')})`);
          }
        }
      } catch (ccErr) {
        console.error('[MARK_LUNAS] Courier cash credit error (non-blocking):', ccErr);
      }
    }

    // Step 3: NOW set status to 'paid' — AFTER financial records are in place
    // Use conditional update for optimistic concurrency
    const expectedPaidAmount = txCamel.paidAmount;
    const lunasUpdate: Record<string, any> = {
      paid_amount: total,
      remaining_amount: 0,
      payment_status: 'paid',
      status: 'paid',
      hpp_paid: hppPortion,
      profit_paid: profitPortion,
      hpp_unpaid: 0,
      profit_unpaid: 0,
      notes: `${txCamel.notes || ''}\n[Ditandai LUNAS oleh ${authUser.role} (${authUser.name}) pada ${new Date().toLocaleString('id-ID')}${isCashWithCourier || isTempoWithCourier ? ' — Cash diterima kurir' : ` — Masuk ke ${paymentMethod === 'cash' ? 'brankas' : 'bank'}`}]`,
    };

    if ((isCashWithCourier || isTempoWithCourier) && !txCamel.deliveredAt) {
      lunasUpdate.delivered_at = new Date().toISOString();
    }

    const { data: updatedTx, error: updateError } = await db
      .from('transactions')
      .update(lunasUpdate)
      .eq('id', transactionId)
      .neq('payment_status', 'paid')
      .eq('paid_amount', expectedPaidAmount)
      .select('id')
      .maybeSingle();

    if (updateError || !updatedTx) {
      // Compensating rollback: reverse the balance and payment record since status change failed
      console.error('[MARK_LUNAS] Status update failed, rolling back financial records:', updateError?.message);
      try {
        if (targetCashBoxId) {
          await atomicUpdateBalance('cash_boxes', targetCashBoxId, -total, -999999999999999);
        }
        if (targetBankAccountId) {
          await atomicUpdateBalance('bank_accounts', targetBankAccountId, -total, -999999999999999);
        }
      } catch (rollbackErr) {
        console.error('[MARK_LUNAS] CRITICAL: Failed to rollback balance after status update failure:', rollbackErr);
      }
      try { await db.from('payments').delete().eq('id', paymentId); } catch { /* best effort rollback */ }

      if (!updatedTx && !updateError) {
        return NextResponse.json({ error: 'Transaksi diubah secara bersamaan. Silakan refresh dan coba lagi.' }, { status: 409 });
      }
      throw updateError;
    }

    // ─── Transaction is now marked as LUNAS atomically ───

    // Emit WebSocket events for real-time sync
    wsTransactionUpdate({ invoiceNo: txCamel.invoiceNo, type: 'sale', status: 'paid', unitId: txCamel.unitId });
    wsPaymentUpdate({ transactionId, amount: total, unitId: txCamel.unitId });
    wsReceivableUpdate({ transactionId, status: 'paid' });

    // ─── Feed pool balances (atomic, non-blocking) ───
    // CRITICAL: Only credit the REMAINING portion (what hasn't been credited yet).
    // If the transaction was partially paid before, hppPaid/profitPaid already contain
    // some value from earlier payments — we must not double-count those.
    try {
      const prevHppPaid = txCamel.hppPaid || 0;
      const prevProfitPaid = txCamel.profitPaid || 0;
      const hppDelta = hppPortion - prevHppPaid;
      const profitDelta = profitPortion - prevProfitPaid;
      if (hppDelta > 0) {
        await atomicUpdatePoolBalance('pool_hpp_paid_balance', hppDelta);
      }
      if (profitDelta > 0) {
        await atomicUpdatePoolBalance('pool_profit_paid_balance', profitDelta);
      }
    } catch (poolErr) {
      console.error('Failed to update pool balance (non-blocking):', poolErr);
    }

    // ─── Update receivables if exists ───
    try {
      const { data: receivable } = await db
        .from('receivables')
        .select('*')
        .eq('transaction_id', transactionId)
        .maybeSingle();
      if (receivable && receivable.status !== 'paid') {
        await db
          .from('receivables')
          .update({
            paid_amount: total,
            remaining_amount: 0,
            status: 'paid',
          })
          .eq('id', receivable.id);
      }
    } catch (receivableErr) {
      console.error('Failed to update receivable (non-blocking):', receivableErr);
    }

    // ─── Update customer last_transaction_date ───
    if (customer) {
      await db
        .from('customers')
        .update({
          last_transaction_date: new Date().toISOString(),
        })
        .eq('id', customer.id);
    }

    // ─── Calculate Cashback (only when lunas and customer exists) ───
    let cashbackEarned = 0;
    if (customer) {
    try {
      const cbType = customer.cashbackType || 'percentage';
      const cbValue = customer.cashbackValue || 0;

      if (cbValue > 0) {
        let cbAmount = 0;
        if (cbType === 'percentage') {
          cbAmount = total * (cbValue / 100);
        } else {
          cbAmount = cbValue;
        }
        cbAmount = Math.round(cbAmount);

        if (cbAmount > 0) {
          cashbackEarned = cbAmount;
          const balanceBefore = customer.cashbackBalance || 0;

          // Use RPC for atomic balance update (prevents race condition on concurrent mark-lunas)
          const { error: rpcError } = await db.rpc('atomic_add_cashback', {
            p_customer_id: customer.id,
            p_delta: cbAmount,
          });
          if (rpcError) {
            console.error('[MARK_LUNAS] atomic_add_cashback RPC failed:', rpcError.message);
            // RACE FIX #5: Do NOT record cashback_log if balance update failed
            // to avoid showing cashback earned that was never actually credited
          } else {
            // Only insert log if the balance update succeeded
            await db.from('cashback_log').insert({
              id: generateId(),
              customer_id: customer.id,
              transaction_id: transactionId,
              type: 'earned',
              amount: cbAmount,
              description: `Cashback dari order ${txCamel.invoiceNo} (${cbType === 'percentage' ? `${cbValue}%` : `Rp ${cbAmount.toLocaleString('id-ID')}`}) — invoice lunas`,
              created_at: new Date().toISOString(),
            });
          }
        }
      }
    } catch (cbErr) {
      console.error('Cashback calculation error (non-blocking):', cbErr);
    }
    } // end if(customer) cashback block

    // ─── Create logs ───
    createLog(db, {
      type: 'activity',
      userId: authUser.id,
      action: 'payment_created',
      entity: 'transaction',
      entityId: transactionId,
      payload: JSON.stringify({
        amount: total,
        method: paymentMethod,
        source: 'mark_lunas',
        cashBoxName: targetCashBoxName,
        bankAccountName: targetBankAccountName,
      }),
    });

    if (targetCashBoxId) {
      createLog(db, {
        type: 'activity',
        userId: authUser.id,
        action: 'payment_deposited',
        entity: 'cashbox',
        entityId: targetCashBoxId,
        payload: JSON.stringify({
          amount: total,
          method: paymentMethod,
          destination: targetCashBoxName,
          transactionId,
          invoiceNo: txCamel.invoiceNo,
        }),
      });
    }
    if (targetBankAccountId) {
      createLog(db, {
        type: 'activity',
        userId: authUser.id,
        action: 'payment_deposited',
        entity: 'bankaccount',
        entityId: targetBankAccountId,
        payload: JSON.stringify({
          amount: total,
          method: paymentMethod,
          destination: targetBankAccountName,
          transactionId,
          invoiceNo: txCamel.invoiceNo,
        }),
      });
    }

    // ─── Create event ───
    createEvent(db, 'transaction_marked_lunas', {
      transactionId,
      invoiceNo: txCamel.invoiceNo,
      type: 'sale',
      unitId: txCamel.unitId,
      customerId: customer?.id,
      customerName: customer?.name,
      total,
      cashbackEarned,
      markedBy: authUser.id,
      markedByRole: authUser.role,
    }).catch(() => {});

    // ─── Send WhatsApp notification to customer ───
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && customer?.phone) {
        const customerPhone = customer!.phone.replace(/^0/, '62');
        const totalStr = `Rp ${total.toLocaleString('id-ID')}`;
        const paymentMethodLabel = paymentMethod === 'cash' ? 'Cash' : 'Transfer';

        const message = `✅ *PEMBAYARAN LUNAS*\n\n` +
          `📄 Invoice: ${txCamel.invoiceNo}\n` +
          `💰 Total: ${totalStr}\n` +
          `💳 Metode: ${paymentMethodLabel}\n` +
          (cashbackEarned > 0 ? `🎁 Cashback: +Rp ${cashbackEarned.toLocaleString('id-ID')}\n` : '') +
          `\n` +
          `Pembayaran telah dikonfirmasi lunas. Terima kasih! 🙏\n` +
          `Invoice dapat diunduh di aplikasi pelanggan.`;

        const waResult = await sendMessage(config.token, customerPhone, message);
        if (!waResult.success && waResult.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('WA lunas notification error (non-blocking):', waErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Transaksi berhasil ditandai lunas',
      data: {
        transactionId,
        invoiceNo: txCamel.invoiceNo,
        total,
        cashbackEarned,
        destination: (isCashWithCourier || isTempoWithCourier) ? `Kurir (${txCamel.courierId})` : (paymentMethod === 'cash' ? targetCashBoxName : targetBankAccountName),
      },
    });
  } catch (error) {
    console.error('Mark lunas error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

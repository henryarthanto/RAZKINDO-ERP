import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, toSnakeCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { wsFinanceUpdate, wsStockUpdate } from '@/lib/ws-dispatch';
import { atomicUpdateBalance, atomicUpdatePoolBalance, getPoolBalance } from '@/lib/atomic-ops';
import { financeEngine } from '@/lib/finance-engine';
import { validateBody, financeRequestSchemas } from '@/lib/validators';
import { runInTransaction, createStep, type TransactionStep } from '@/lib/db-transaction';
import { optimisticUpdate } from '@/lib/optimistic-lock';
// withGracefulDegradation intentionally NOT used for critical financial operations
// Finance request processing must fail with actual error messages, not generic 503

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data: financeRequest, error } = await db.from('finance_requests').select(`
      *,
      supplier:suppliers(id, name, phone),
      transaction:transactions(
        id, invoice_no, type, total, paid_amount, remaining_amount, payment_status, payment_method, due_date, transaction_date, status, notes, unit_id, supplier_id, created_by_id,
        customer:customers(id, name),
        unit:units(id, name),
        items:transaction_items(*)
      ),
      bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name, account_no),
      cash_box:cash_boxes!finance_requests_cash_box_id_fkey(id, name),
      salary_payment:salary_payments(id, user_id, user:users!user_id(id, name))
    `).eq('id', id).single();

    if (error || !financeRequest) {
      return NextResponse.json({ error: 'Request tidak ditemukan' }, { status: 404 });
    }

    return NextResponse.json({ request: toCamelCase(financeRequest) });
  } catch (error: any) {
    console.error('Get finance request error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();

    // Pre-process: convert empty strings/null to undefined for optional fields
    const preProcessed = {
      ...rawBody,
      bankAccountId: rawBody.bankAccountId || undefined,
      cashBoxId: rawBody.cashBoxId || undefined,
      fundSource: rawBody.fundSource || undefined,
      sourceType: rawBody.sourceType || undefined,
    };
    const validation = validateBody(financeRequestSchemas.process, preProcessed);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = { ...validation.data, processedById: authUserId } as typeof validation.data & { processedById: string };

    const { data: existingRequest, error: fetchError } = await db.from('finance_requests').select('*').eq('id', id).single();
    if (fetchError || !existingRequest) {
      return NextResponse.json({ error: 'Request tidak ditemukan' }, { status: 404 });
    }

    // Authorization: all status changes require finance role, EXCEPT
    // the request creator may reject their own request.
    const isCreatorSelfRejecting = data.status === 'rejected' && existingRequest.request_by_id === authUserId;
    if (!isCreatorSelfRejecting) {
      const financeAuth = await enforceFinanceRole(request);
      if (!financeAuth.success) return financeAuth.response;
    }

    if (data.goodsStatus) {
      const result = await updateGoodsStatus(existingRequest, data);
      wsFinanceUpdate({ requestId: existingRequest.id, goodsStatus: data.goodsStatus, type: existingRequest.type });
      return NextResponse.json({ request: result });
    }

    // Handle approved
    if (data.status === 'approved') {
      const updateData: Record<string, any> = {
        status: 'approved',
        notes: data.notes,
        payment_type: data.processType,
      };
      if (!existingRequest.approved_by_id) {
        updateData.approved_by_id = data.processedById;
        updateData.approved_at = new Date().toISOString();
      }
      updateData.source_type = data.sourceType;
      updateData.bank_account_id = data.bankAccountId;
      updateData.cash_box_id = data.cashBoxId;

      // Update salary payment if linked
      if (existingRequest.type === 'salary') {
        const { data: salaryPayment } = await db.from('salary_payments').select('*').eq('finance_request_id', id).maybeSingle();
        if (salaryPayment && salaryPayment.status === 'pending') {
          await db.from('salary_payments').update({
            status: 'approved',
            approved_by_id: salaryPayment.approved_by_id || data.processedById,
            approved_at: salaryPayment.approved_at || new Date().toISOString(),
          }).eq('id', salaryPayment.id);
        }
      }

      const { error } = await db.from('finance_requests').update(updateData).eq('id', id);
      if (error) throw error;

      createEvent(db, `finance_request_${data.status}`, { requestId: id, type: existingRequest.type, amount: existingRequest.amount });
      createLog(db, { type: 'activity', userId: data.processedById, action: `finance_request_${data.status}`, entity: 'finance_request', entityId: id, message: `Request ${existingRequest.type} di-${data.status}` });

      const { data: updatedRequest, error: refetchError } = await db.from('finance_requests').select(`
        *, supplier:suppliers(id, name), transaction:transactions(id, invoice_no, customer:customers(id, name), unit:units(id, name), items:transaction_items(*)), bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name), cash_box:cash_boxes!finance_requests_cash_box_id_fkey(id, name), salary_payment:salary_payments(id, user_id, user:users!user_id(id, name))
      `).eq('id', id).maybeSingle();
      if (!updatedRequest || refetchError) throw new Error('Gagal mengambil data terbaru');
      wsFinanceUpdate({ requestId: id, status: 'approved', type: existingRequest.type, amount: existingRequest.amount });
      return NextResponse.json({ request: toCamelCase(updatedRequest) });
    }

    // Handle rejected
    if (data.status === 'rejected') {
      const updateData: Record<string, any> = { status: 'rejected', notes: data.notes, rejection_reason: data.rejectionReason };
      const { error } = await db.from('finance_requests').update(updateData).eq('id', id);
      if (error) throw error;
      createEvent(db, `finance_request_${data.status}`, { requestId: id, type: existingRequest.type, amount: existingRequest.amount });
      createLog(db, { type: 'activity', userId: data.processedById, action: `finance_request_${data.status}`, entity: 'finance_request', entityId: id, message: `Request ${existingRequest.type} di-${data.status}` });
      const { data: updatedRequest, error: refetchError2 } = await db.from('finance_requests').select(`
        *, supplier:suppliers(id, name), transaction:transactions(id, invoice_no, customer:customers(id, name), unit:units(id, name), items:transaction_items(*)), bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name), cash_box:cash_boxes!finance_requests_cash_box_id_fkey(id, name), salary_payment:salary_payments(id, user_id, user:users!user_id(id, name))
      `).eq('id', id).maybeSingle();
      if (!updatedRequest || refetchError2) throw new Error('Gagal mengambil data terbaru');
      wsFinanceUpdate({ requestId: id, status: 'rejected', type: existingRequest.type, amount: existingRequest.amount });
      return NextResponse.json({ request: toCamelCase(updatedRequest) });
    }

    // Handle processed
    if (data.status === 'processed') {
      const { data: freshResult, error: freshError } = await db.from('finance_requests').select('*').eq('id', id).single();
      if (freshError || !freshResult) {
        throw new Error('Request tidak ditemukan');
      }
      if (freshResult.status === 'processed') {
        throw new Error('Request sudah diproses');
      }
      if (freshResult.status !== 'approved') {
        throw new Error('Request harus disetujui terlebih dahulu sebelum diproses');
      }

      const updateData: Record<string, any> = {
        status: 'processed',
        processed_by_id: data.processedById,
        processed_at: new Date().toISOString(),
        source_type: data.sourceType,
        fund_source: data.fundSource || null,
        bank_account_id: data.bankAccountId,
        cash_box_id: data.cashBoxId,
        payment_type: data.processType,
      };

      // courier_deposit requests created by the RPC are already processed atomically.
      // Block any attempt to manually process them to prevent double-crediting brankas.
      if (freshResult.type === 'courier_deposit') {
        throw new Error('Setoran kurir sudah diproses secara otomatis oleh sistem');
      }

      const isPayNow = data.processType === 'pay_now';
      const journalId = generateId();
      const hasBankSource = !!data.bankAccountId && data.sourceType === 'bank';
      const hasCashboxSource = !!data.cashBoxId && data.sourceType === 'cashbox';

      if (isPayNow) {
        // PHYSICAL SOURCE VALIDATION
        if (!hasBankSource && !hasCashboxSource) {
          throw new Error('Sumber pembayaran fisik (Bank/Brankas) wajib dipilih');
        }

        // PAYMENT SOURCE (fundSource) — must be explicitly provided by user
        // Options: hpp_paid, profit_paid, lain_lain
        const validFundSources = ['hpp_paid', 'profit_paid', 'lain_lain'];
        if (!data.fundSource || !validFundSources.includes(data.fundSource)) {
          throw new Error('Sumber dana (HPP/Profit/Lain-lain) wajib dipilih');
        }

        // Validate selected pool has sufficient balance
        const poolKeyMap: Record<string, string> = {
          hpp_paid: 'pool_hpp_paid_balance',
          profit_paid: 'pool_profit_paid_balance',
          lain_lain: 'pool_investor_fund',
        };
        const poolLabelMap: Record<string, string> = {
          hpp_paid: 'HPP Sudah Terbayar',
          profit_paid: 'Profit Sudah Terbayar',
          lain_lain: 'Dana Lain-lain',
        };
        const poolKey = poolKeyMap[data.fundSource];
        const poolBalance = await getPoolBalance(poolKey);

        if (poolBalance < freshResult.amount) {
          throw new Error(`Saldo ${poolLabelMap[data.fundSource]} (Rp ${poolBalance.toLocaleString('id-ID')}) tidak mencukupi untuk pembayaran Rp ${freshResult.amount.toLocaleString('id-ID')}`);
        }
      }

      // Calculate pool deduction — only from user-selected source (not automatic split)
      const poolDeductions: Array<{ key: string; amount: number }> = [];
      if (isPayNow) {
        const poolKeyMap: Record<string, string> = {
          hpp_paid: 'pool_hpp_paid_balance',
          profit_paid: 'pool_profit_paid_balance',
          lain_lain: 'pool_investor_fund',
        };
        const poolKey = poolKeyMap[data.fundSource!];
        poolDeductions.push({ key: poolKey, amount: freshResult.amount });
      }

      // Build compensating transaction steps
      const txSteps: TransactionStep<any>[] = [];

      if (isPayNow) {
        // Step: Atomically deduct from pool balance(s) — user-selected source only
        for (const deduction of poolDeductions) {
          const poolLabel = deduction.key === 'pool_hpp_paid_balance' ? 'HPP Sudah Terbayar'
            : deduction.key === 'pool_profit_paid_balance' ? 'Profit Sudah Terbayar'
            : 'Dana Lain-lain';
          txSteps.push(createStep(`deduct-pool-${poolLabel}`, async () => {
            try {
              await financeEngine.debitPool(deduction.key, deduction.amount, journalId, 'finance_request', id, `Request ${freshResult.type}: ${freshResult.description || freshResult.type} — ${poolLabel}`, data.processedById);
            } catch {
              throw new Error(`Saldo pool ${poolLabel} tidak mencukupi`);
            }
            return { key: deduction.key, amount: deduction.amount };
          }, async (result) => {
            try { await atomicUpdatePoolBalance(result.key, result.amount); } catch { /* best effort */ }
          }));
        }

        // Step: Atomically deduct from physical account (throws if insufficient)
        if (hasBankSource) {
          txSteps.push(createStep('deduct-bank-balance', async () => {
            try {
              await financeEngine.debitPhysical('bank_accounts', data.bankAccountId!, freshResult.amount, journalId, 'finance_request', id, `Request ${freshResult.type}: ${freshResult.description || freshResult.type} — Bank`, data.processedById);
            } catch {
              throw new Error('Saldo rekening bank tidak cukup');
            }
            return true;
          }, async () => {
            try { await atomicUpdateBalance('bank_accounts', data.bankAccountId!, freshResult.amount); } catch { /* best effort */ }
          }));
        }
        if (hasCashboxSource) {
          txSteps.push(createStep('deduct-cashbox-balance', async () => {
            try {
              await financeEngine.debitPhysical('cash_boxes', data.cashBoxId!, freshResult.amount, journalId, 'finance_request', id, `Request ${freshResult.type}: ${freshResult.description || freshResult.type} — Brankas`, data.processedById);
            } catch {
              throw new Error('Saldo brankas/kas tidak cukup');
            }
            return true;
          }, async () => {
            try { await atomicUpdateBalance('cash_boxes', data.cashBoxId!, freshResult.amount); } catch { /* best effort */ }
          }));
        }
      }

      if (freshResult.type === 'purchase') {
        if (!freshResult.unit_id) {
          throw new Error('Request ini tidak memiliki Unit/Cabang.');
        }
        txSteps.push(createStep('create-purchase-transaction', async () => {
          return await createPurchaseTransaction(freshResult, data);
        }, async (txId: string) => {
          try {
            await db.from('transaction_items').delete().eq('transaction_id', txId);
            await db.from('transactions').delete().eq('id', txId);
          } catch { /* best effort */ }
        }));
      }

      if (freshResult.type === 'expense') {
        if (!freshResult.unit_id) {
          throw new Error('Request ini tidak memiliki Unit/Cabang.');
        }
        txSteps.push(createStep('create-expense-transaction', async () => {
          return await createExpenseTransaction(freshResult, data);
        }, async (txId: string) => {
          try { await db.from('transactions').delete().eq('id', txId); } catch { /* best effort */ }
        }));
      }

      if (freshResult.type === 'salary') {
        txSteps.push(createStep('update-salary-payment', async () => {
          const { data: salaryPayment } = await db.from('salary_payments').select('*').eq('finance_request_id', id).maybeSingle();
          if (salaryPayment && (salaryPayment.status === 'pending' || salaryPayment.status === 'approved')) {
            const isPayingNow = data.processType === 'pay_now';
            await db.from('salary_payments').update({
              status: isPayingNow ? 'paid' : 'approved',
              approved_by_id: salaryPayment.approved_by_id || data.processedById,
              approved_at: salaryPayment.approved_at || new Date().toISOString(),
              paid_at: isPayingNow ? new Date().toISOString() : undefined,
              source_type: isPayingNow ? (data.sourceType || salaryPayment.source_type) : salaryPayment.source_type,
              bank_account_id: isPayingNow ? (data.bankAccountId || salaryPayment.bank_account_id) : salaryPayment.bank_account_id,
              cash_box_id: isPayingNow ? (data.cashBoxId || salaryPayment.cash_box_id) : salaryPayment.cash_box_id,
            }).eq('id', salaryPayment.id);
            return salaryPayment;
          }
          return null;
        }, async (prevSalaryPayment) => {
          if (!prevSalaryPayment) return;
          try {
            await db.from('salary_payments').update({
              status: prevSalaryPayment.status,
              paid_at: null,
            }).eq('id', prevSalaryPayment.id);
          } catch { /* best effort */ }
        }));
      }

      // Final step: update finance request status to processed (with optimistic lock)
      const expectedVersion = (freshResult as any).version ?? 1;
      txSteps.push(createStep('update-finance-request-status', async () => {
        const lockResult = await optimisticUpdate('finance_requests', id, expectedVersion, updateData);
        if (!lockResult.success) {
          const err = new Error(lockResult.error || 'Konflik data');
          (err as any).statusCode = 409;
          (err as any).currentVersion = lockResult.currentVersion;
          throw err;
        }
        return true;
      }));

      // Execute all steps with compensating rollback
      await runInTransaction(txSteps);

      // Fire-and-forget operations (outside transaction)
      createEvent(db, `finance_request_${data.status}`, { requestId: id, type: freshResult.type, amount: freshResult.amount });
      createLog(db, { type: 'activity', userId: data.processedById, action: `finance_request_${data.status}`, entity: 'finance_request', entityId: id, message: `Request ${freshResult.type} di-${data.status}` });

      const { data: updatedRequest, error: refetchError3 } = await db.from('finance_requests').select(`
        *, supplier:suppliers(id, name), transaction:transactions(id, invoice_no, customer:customers(id, name), unit:units(id, name), items:transaction_items(*)), bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name), cash_box:cash_boxes!finance_requests_cash_box_id_fkey(id, name), salary_payment:salary_payments(id, user_id, user:users!user_id(id, name))
      `).eq('id', id).maybeSingle();
      if (!updatedRequest || refetchError3) throw new Error('Gagal mengambil data terbaru');
      wsFinanceUpdate({ requestId: id, status: 'processed', type: freshResult.type, amount: freshResult.amount });
      return NextResponse.json({ request: toCamelCase(updatedRequest) });
    }

    // Fallback
    const updateData = toSnakeCase({ status: data.status, notes: data.notes, paymentType: data.processType });
    const { data: updatedRequest, error } = await db.from('finance_requests').update(updateData).eq('id', id).select().single();
    if (error) throw error;
    createEvent(db, `finance_request_${data.status}`, { requestId: id, type: existingRequest.type, amount: existingRequest.amount });
    createLog(db, { type: 'activity', userId: data.processedById, action: `finance_request_${data.status}`, entity: 'finance_request', entityId: id, message: `Request ${existingRequest.type} di-${data.status}` });
    wsFinanceUpdate({ requestId: id, status: data.status, type: existingRequest.type, amount: existingRequest.amount });
    return NextResponse.json({ request: toCamelCase(updatedRequest) });
  } catch (error) {
    console.error('Update finance request error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    let userMessage = message;

    // Optimistic lock conflict → 409
    if (error instanceof Error && (error as any).statusCode === 409) {
      return NextResponse.json({
        error: 'Konflik data: Data telah diubah oleh pengguna lain. Silakan refresh halaman dan coba lagi.',
        code: 'CONFLICT',
        currentVersion: (error as any).currentVersion,
      }, { status: 409 });
    }

    if (message.includes('Foreign key constraint')) {
      userMessage = 'Gagal memproses: data referensi tidak ditemukan.';
    }
    const status = error instanceof Error && (
      message.includes('tidak cukup') || message.includes('wajib') || message.includes('tidak ditemukan') || message.includes('tidak memiliki') || message.includes('sudah diproses') || message.includes('Foreign key') || message.includes('tidak valid') || message.includes('constraint') || message.includes('non_negative')
    ) ? 400 : 500;
    return NextResponse.json({ error: userMessage }, { status });
  }
}

async function updateGoodsStatus(existingRequest: any, data: any) {
  const previousStatus = existingRequest.goods_status;
  const newStatus = data.goodsStatus;

  if (newStatus === 'received' && previousStatus !== 'received' && existingRequest.type === 'purchase') {
    let items: any[] = [];
    try { items = existingRequest.purchase_items ? JSON.parse(existingRequest.purchase_items) : []; } catch { items = []; }

    for (const item of items) {
      const stockQty = item.qtyInSubUnit ?? item.qty;
      const purchaseHpp = item.hpp || item.price || 0;

      // Use atomic RPC to prevent race condition on stock + HPP
      const { error: rpcError } = await db.rpc('increment_stock_with_hpp', {
        p_product_id: item.productId,
        p_qty: stockQty,
        p_new_hpp: purchaseHpp
      });
      if (rpcError) {
        // Fallback to non-atomic if RPC fails
        const { data: product } = await db.from('products').select('global_stock, avg_hpp').eq('id', item.productId).maybeSingle();
        if (!product) continue;
        const oldStock = product.global_stock || 0;
        const oldHpp = product.avg_hpp || 0;
        let newAvgHpp = purchaseHpp;
        if (oldStock > 0 && purchaseHpp > 0) {
          newAvgHpp = Math.round(((oldStock * oldHpp) + (stockQty * purchaseHpp)) / (oldStock + stockQty));
        }
        await db.from('products').update({ global_stock: oldStock + stockQty, avg_hpp: newAvgHpp }).eq('id', item.productId);
      }

      if (existingRequest.unit_id) {
        const { data: unitProduct } = await db.from('unit_products').select('id, stock').eq('unit_id', existingRequest.unit_id).eq('product_id', item.productId).maybeSingle();
        if (unitProduct) {
          await db.from('unit_products').update({ stock: (unitProduct.stock || 0) + stockQty }).eq('id', unitProduct.id);
        } else {
          await db.from('unit_products').insert({ id: generateId(), unit_id: existingRequest.unit_id, product_id: item.productId, stock: stockQty, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        }
      }
    }

    createLog(db, { type: 'activity', userId: existingRequest.processed_by_id || existingRequest.request_by_id, action: 'stock_updated_from_purchase', entity: 'finance_request', entityId: existingRequest.id, message: `Stok diupdate dari penerimaan barang: ${items.length} produk` });

    // Dispatch WebSocket stock updates for all incremented products
    for (const item of items) {
      const productName = item.productName || item.name || '';
      wsStockUpdate({ productId: item.productId, productName });
    }

    const { data: updated } = await db.from('finance_requests').update({ goods_status: newStatus, notes: data.notes || existingRequest.notes }).eq('id', existingRequest.id).select(`
      *, supplier:suppliers(id, name), transaction:transactions(id, invoice_no, customer:customers(id, name), unit:units(id, name), items:transaction_items(*)), bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name), salary_payment:salary_payments(id, user_id, user:users!user_id(id, name))
    `).single();
    return toCamelCase(updated);
  }

  const { data: updated } = await db.from('finance_requests').update({ goods_status: newStatus, notes: data.notes || existingRequest.notes }).eq('id', existingRequest.id).select().single();
  return toCamelCase(updated);
}

// Local invoice number generator with custom prefix support
// (differs from supabase-helpers.generateInvoiceNo which uses type-based prefix)
async function generateLocalInvoiceNo(type: string, prefix: string): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { count } = await db.from('transactions').select('*', { count: 'exact', head: true }).eq('type', type).gte('created_at', monthStart);
  const invoiceNo = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String((count || 0) + 1).padStart(4, '0')}`;
  return invoiceNo;
}

async function createPurchaseTransaction(existingRequest: any, data: any): Promise<string> {
  const invoiceNo = await generateLocalInvoiceNo('purchase', 'PO');
  let items: any[] = [];
  try { items = existingRequest.purchase_items ? JSON.parse(existingRequest.purchase_items) : []; } catch { items = []; }
  const total = items.reduce((sum: number, item: any) => sum + (item.qty * (item.price ?? item.hpp ?? 0)), 0) || existingRequest.amount;
  const isPaid = data.processType === 'pay_now';

  const transactionData = toSnakeCase({
    id: generateId(),
    type: 'purchase',
    invoiceNo,
    unitId: existingRequest.unit_id,
    createdById: data.processedById,
    supplierId: existingRequest.supplier_id,
    total, paidAmount: isPaid ? total : 0, remainingAmount: isPaid ? 0 : total,
    totalHpp: total, totalProfit: 0, hppPaid: isPaid ? total : 0, profitPaid: 0, hppUnpaid: isPaid ? 0 : total, profitUnpaid: 0,
    paymentMethod: isPaid ? 'cash' : 'tempo', status: 'approved', paymentStatus: isPaid ? 'paid' : 'unpaid',
    notes: existingRequest.description, transactionDate: new Date().toISOString(), courierCommission: 0, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const { data: transaction, error } = await db.from('transactions').insert(transactionData).select().single();
  if (error) throw error;

  for (const item of items) {
    const stockQty = item.qtyInSubUnit ?? item.qty;
    await db.from('transaction_items').insert(toSnakeCase({
      id: generateId(),
      transactionId: transaction.id, productId: item.productId, productName: item.productName,
      qty: item.qty, qtyInSubUnit: stockQty, qtyUnitType: item.qtyUnitType || 'sub',
      price: item.price || item.hpp || 0, hpp: item.hpp || item.price || 0,
      subtotal: item.qty * (item.price || item.hpp || 0), profit: 0,
    }));
  }

  if (existingRequest.supplier_id) {
    const { data: supplier } = await db.from('suppliers').select('total_purchase, total_paid').eq('id', existingRequest.supplier_id).single();
    if (supplier) {
      await db.from('suppliers').update({
        total_purchase: (supplier.total_purchase || 0) + total,
        total_paid: isPaid ? (supplier.total_paid || 0) + total : undefined,
      }).eq('id', existingRequest.supplier_id);
    }
  }

  return transaction.id;
}

async function createExpenseTransaction(existingRequest: any, data: any): Promise<string> {
  const invoiceNo = await generateLocalInvoiceNo('expense', 'EXP');
  const transactionData = toSnakeCase({
    id: generateId(),
    type: 'expense', invoiceNo, unitId: existingRequest.unit_id, createdById: data.processedById,
    total: existingRequest.amount, paidAmount: existingRequest.amount, remainingAmount: 0,
    totalHpp: 0, totalProfit: 0, hppPaid: 0, profitPaid: 0, hppUnpaid: 0, profitUnpaid: 0,
    paymentMethod: 'cash', status: 'approved', paymentStatus: 'paid',
    notes: existingRequest.description, transactionDate: new Date().toISOString(), courierCommission: 0, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const { data: expTx, error } = await db.from('transactions').insert(transactionData).select('id').single();
  if (error || !expTx) throw new Error('Gagal membuat transaksi pengeluaran');
  return expTx.id;
}

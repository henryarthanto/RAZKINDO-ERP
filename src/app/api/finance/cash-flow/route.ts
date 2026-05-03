import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';

// GET /api/finance/cash-flow
// Unified cash flow history — aggregates all money movements across the system
// Query params: startDate, endDate, type (all|inflow|outflow|transfer), category, page, limit
export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const typeFilter = searchParams.get('type') || 'all'; // all, inflow, outflow, transfer
    const category = searchParams.get('category') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build date filter
    const dateFilter: Record<string, string> = {};
    if (startDate) dateFilter['start'] = startDate;
    if (endDate) dateFilter['end'] = endDate;

    // Fetch all money movements in parallel
    const [
      paymentsResult,
      processedRequestsResult,
      courierHandoversResult,
      fundTransfersResult,
      cashbackWithdrawalsResult,
      poolDepositsResult,
      // Server-side aggregated totals (accurate regardless of pagination limit)
      inflowTotal,
      outflowTotal,
      transferTotal,
    ] = await Promise.all([
      // 1. PAYMENTS — Money IN from customer sales (lunas)
      fetchPayments(dateFilter),
      // 2. FINANCE REQUESTS PROCESSED — Money OUT (purchases, expenses, salaries, cash_to_bank)
      fetchProcessedRequests(dateFilter),
      // 3. COURIER HANDOVERS — Internal movement (courier → brankas)
      fetchCourierHandovers(dateFilter),
      // 4. FUND TRANSFERS — Between bank/cashbox
      fetchFundTransfers(dateFilter),
      // 5. CASHBACK WITHDRAWALS — Money OUT to customers
      fetchCashbackWithdrawals(dateFilter),
      // 6. POOL DEPOSITS — Money IN from bank mutations (pool dana deposits)
      fetchPoolDeposits(dateFilter),
      // Server-side aggregated totals — sum all amounts directly from DB (no 500-record limit)
      // Inflow: Sum of payments for SALE-type transactions + pool deposits from mutations
      Promise.all([
        (() => {
          let q = db.from('payments')
            .select('amount, transaction:transactions!transaction_id(type)')
            .eq('transaction:type', 'sale');
          if (dateFilter.start) q = q.gte('created_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('created_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0));
        })(),
        (() => {
          let q = db.from('finance_requests')
            .select('amount')
            .eq('status', 'processed')
            .eq('type', 'pool_deposit');
          if (dateFilter.start) q = q.gte('processed_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('processed_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0));
        })(),
      ]).then(([payTotal, poolTotal]) => payTotal + poolTotal),
      // Outflow: Sum of processed finance_requests (pay_now) excluding courier_deposit and pool_deposit
      // + processed cashback_withdrawals
      Promise.all([
        (() => {
          let q = db.from('finance_requests')
            .select('amount')
            .eq('status', 'processed')
            .eq('payment_type', 'pay_now')
            .neq('type', 'courier_deposit')
            .neq('type', 'pool_deposit');
          if (dateFilter.start) q = q.gte('processed_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('processed_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0));
        })(),
        (() => {
          let q = db.from('cashback_withdrawal')
            .select('amount')
            .eq('status', 'processed');
          if (dateFilter.start) q = q.gte('created_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('created_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, w: any) => sum + (Number(w.amount) || 0), 0));
        })(),
      ]).then(([reqTotal, cbTotal]) => reqTotal + cbTotal),
      // Transfer: Sum of processed courier_handovers + completed fund_transfers
      Promise.all([
        (() => {
          let q = db.from('courier_handovers')
            .select('amount')
            .eq('status', 'processed');
          if (dateFilter.start) q = q.gte('created_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('created_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, h: any) => sum + (Number(h.amount) || 0), 0));
        })(),
        (() => {
          let q = db.from('fund_transfers')
            .select('amount')
            .eq('status', 'completed');
          if (dateFilter.start) q = q.gte('created_at', dateFilter.start);
          if (dateFilter.end) q = q.lte('created_at', dateFilter.end + 'T23:59:59');
          return q.then(({ data }) => (data || []).reduce((sum: number, t: any) => sum + (Number(t.amount) || 0), 0));
        })(),
      ]).then(([hoTotal, ftTotal]) => hoTotal + ftTotal),
    ]);

    // Merge all entries into unified format
    const allEntries: CashFlowEntry[] = [
      ...paymentsResult,
      ...poolDepositsResult,
      ...processedRequestsResult,
      ...courierHandoversResult,
      ...fundTransfersResult,
      ...cashbackWithdrawalsResult,
    ];

    // Sort by date descending (newest first)
    allEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Filter by type
    let filtered = allEntries;
    if (typeFilter === 'inflow') {
      filtered = filtered.filter(e => e.direction === 'in');
    } else if (typeFilter === 'outflow') {
      filtered = filtered.filter(e => e.direction === 'out');
    } else if (typeFilter === 'transfer') {
      filtered = filtered.filter(e => e.direction === 'transfer');
    }

    // Filter by category
    if (category) {
      filtered = filtered.filter(e => e.category === category);
    }

    // Summary stats from server-side aggregation (accurate regardless of pagination limit)
    const summary = {
      totalInflow: inflowTotal,
      totalOutflow: outflowTotal,
      totalTransfer: transferTotal,
      netFlow: inflowTotal - outflowTotal,
      count: allEntries.length,
    };

    // Paginate
    const totalFiltered = filtered.length;
    const totalPages = Math.ceil(totalFiltered / limit);
    const paginated = filtered.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      entries: paginated,
      summary,
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Get cash flow error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// ========================
// TYPES
// ========================

interface CashFlowEntry {
  id: string;
  date: string;
  direction: 'in' | 'out' | 'transfer';
  category: string;
  categoryLabel: string;
  description: string;
  amount: number;
  source: string;
  destination: string;
  referenceId: string;
  referenceNo?: string;
  createdBy?: string;
  metadata?: Record<string, any>;
}

// ========================
// DATA FETCHERS
// ========================

async function fetchPayments(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('payments')
    .select(`
      id,
      amount,
      paymentMethod,
      hpp_portion,
      profit_portion,
      notes,
      paid_at,
      created_at,
      transaction:transactions(id, invoice_no, type, courier_id, customer:customers(id, name), unit:units(id, name)),
      received_by:users!received_by_id(id, name),
      cash_box:cash_boxes(id, name),
      bank_account:bank_accounts(id, name, bank_name)
    `)
    .order('created_at', { ascending: false })
    .limit(500);

  if (dateFilter.start) query = query.gte('created_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('created_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  return (data || []).map((p: any) => {
    const tx = p.transaction;
    const customerName = tx?.customer?.name || 'Pelanggan';
    const invoiceNo = tx?.invoice_no || '-';
    const paymentMethod = p.payment_method || 'cash';
    const receivedBy = (p.received_by as any)?.name || 'Sistem';

    let destination = '-';
    let source = customerName;

    if (paymentMethod === 'cash') {
      if ((p.cash_box as any)?.name) {
        destination = `Brankas: ${(p.cash_box as any).name}`;
      } else if (tx?.courier_id) {
        // Cash was received by courier
        const courierName = 'Kurir'; // We don't join courier here for perf
        destination = `Dana Kurir (menunggu setoran)`;
      } else {
        destination = 'Brankas';
      }
    } else if (paymentMethod === 'transfer' || paymentMethod === 'giro') {
      destination = (p.bank_account as any)
        ? `Bank: ${(p.bank_account as any).name} (${(p.bank_account as any).bank_name})`
        : 'Rekening Bank';
    }

    // Determine direction based on transaction type
    const txType = tx?.type;
    let direction: 'in' | 'out' | 'transfer' = 'in';
    let catLabel = 'Penjualan';
    let cat = 'sale';

    if (txType === 'purchase') {
      direction = 'out';
      catLabel = 'Pembelian';
      cat = 'purchase';
    } else if (txType === 'expense') {
      direction = 'out';
      catLabel = 'Pengeluaran';
      cat = 'expense';
    } else if (txType === 'salary') {
      direction = 'out';
      catLabel = 'Gaji';
      cat = 'salary';
    }

    return {
      id: `pay-${p.id}`,
      date: p.paid_at || p.created_at,
      direction,
      category: cat,
      categoryLabel: catLabel,
      description: `Pembayaran ${invoiceNo} — ${customerName}`,
      amount: Number(p.amount) || 0,
      source,
      destination,
      referenceId: p.id,
      referenceNo: invoiceNo,
      createdBy: receivedBy,
      metadata: {
        paymentMethod,
        hppPortion: Number(p.hpp_portion) || 0,
        profitPortion: Number(p.profit_portion) || 0,
      },
    };
  });
}

async function fetchProcessedRequests(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('finance_requests')
    .select(`
      id,
      type,
      amount,
      description,
      status,
      payment_type,
      fund_source,
      processed_at,
      created_at,
      supplier:suppliers(id, name),
      transaction:transactions(id, invoice_no, customer:customers(id, name)),
      bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name),
      cash_box:cash_boxes!finance_requests_cash_box_id_fkey(id, name),
      salary_payment:salary_payments(id, user:users!user_id(id, name)),
      processed_by_id
    `)
    .eq('status', 'processed')
    .eq('payment_type', 'pay_now')
    .order('processed_at', { ascending: false })
    .limit(500);

  if (dateFilter.start) query = query.gte('processed_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('processed_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  return (data || []).map((r: any) => {
    const req = toCamelCase(r);
    const processedBy = 'Sistem';

    let catLabel = getRequestTypeLabel(req.type);
    let cat = req.type;
    let destination = '-';
    let description = req.description || catLabel;

    if (req.type === 'purchase') {
      const supplierName = (r.supplier as any)?.name || 'Supplier';
      destination = `Pembelian dari ${supplierName}`;
      description = req.description || `Pembelian — ${supplierName}`;
    } else if (req.type === 'salary') {
      const userName = (r.salary_payment as any)?.user?.name || 'Karyawan';
      destination = `Gaji: ${userName}`;
      description = `Pembayaran gaji ${userName}`;
    } else if (req.type === 'expense') {
      destination = `Pengeluaran`;
      description = req.description || catLabel;
    } else if (req.type === 'cash_to_bank') {
      destination = `Transfer ke Bank: ${(r.bank_account as any)?.name || '-'}`;
      description = `Setor ke Bank: ${(r.bank_account as any)?.name || '-'}`;
    } else if (req.type === 'courier_deposit') {
      // This is courier deposit to brankas — already counted in handover, skip here
      return null;
    }

    let source = '-';
    const fundSource = req.fundSource === 'hpp_paid' ? 'Pool HPP' :
                       req.fundSource === 'profit_unpaid' ? 'Pool Profit' : '-';
    const physicalSource = (r.bank_account as any)
      ? `Bank: ${(r.bank_account as any).name}`
      : (r.cash_box as any)
        ? `Brankas: ${(r.cash_box as any).name}`
        : '-';

    if (req.type !== 'courier_deposit') {
      source = `${fundSource} → ${physicalSource}`;
    }

    return {
      id: `freq-${req.id}`,
      date: req.processedAt || req.createdAt,
      direction: 'out' as const,
      category: cat,
      categoryLabel: catLabel,
      description,
      amount: Number(req.amount) || 0,
      source,
      destination,
      referenceId: req.id,
      createdBy: processedBy,
      metadata: {
        fundSource: req.fundSource,
        sourceType: req.sourceType,
      },
    };
  }).filter(Boolean) as CashFlowEntry[];
}

async function fetchCourierHandovers(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('courier_handovers')
    .select(`
      id,
      amount,
      notes,
      status,
      processed_at,
      created_at,
      courier_cash_id
    `)
    .eq('status', 'processed')
    .order('created_at', { ascending: false })
    .limit(500);

  if (dateFilter.start) query = query.gte('created_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('created_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  // Fetch courier names from courier_cash records
  const courierCashIds = [...new Set((data || []).map((h: any) => h.courier_cash_id).filter(Boolean))];
  let courierNameMap: Record<string, string> = {};
  if (courierCashIds.length > 0) {
    const { data: ccData } = await db
      .from('courier_cash')
      .select('id, courier_id, courier:users!courier_id(id, name), unit:units(id, name)')
      .in('id', courierCashIds);
    if (ccData) {
      (ccData || []).forEach((cc: any) => {
        const courierName = (cc.courier as any)?.name || 'Kurir';
        const unitName = (cc.unit as any)?.name || '';
        courierNameMap[cc.id] = `${courierName}${unitName ? ` (${unitName})` : ''}`;
      });
    }
  }

  return (data || []).map((h: any) => {
    const courierLabel = courierNameMap[h.courier_cash_id] || 'Kurir';
    return {
      id: `ho-${h.id}`,
      date: h.created_at,
      direction: 'transfer' as const,
      category: 'courier_handover',
      categoryLabel: 'Setoran Kurir',
      description: `Setoran ${courierLabel}`,
      amount: Number(h.amount) || 0,
      source: `Kurir: ${courierLabel}`,
      destination: 'Brankas',
      referenceId: h.id,
      metadata: {
        courierCashId: h.courier_cash_id,
      },
    };
  });
}

async function fetchFundTransfers(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('fund_transfers')
    .select(`
      id,
      type,
      amount,
      description,
      reference_no,
      status,
      processed_at,
      created_at,
      from_bank_account_id,
      to_bank_account_id,
      from_cash_box_id,
      to_cash_box_id,
      processed_by_id
    `)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(500);

  if (dateFilter.start) query = query.gte('created_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('created_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  return (data || []).map((t: any) => {
    return {
      id: `ft-${t.id}`,
      date: t.processed_at || t.created_at,
      direction: 'transfer' as const,
      category: 'fund_transfer',
      categoryLabel: 'Transfer Dana',
      description: t.description || `Transfer ${t.type}`,
      amount: Number(t.amount) || 0,
      source: t.type.includes('bank') ? 'Rekening Bank' : 'Brankas',
      destination: t.type.includes('cash') ? 'Brankas' : 'Rekening Bank',
      referenceId: t.id,
      referenceNo: t.reference_no,
      metadata: {
        transferType: t.type,
      },
    };
  });
}

async function fetchCashbackWithdrawals(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('cashback_withdrawal')
    .select(`
      id,
      amount,
      status,
      bank_name,
      account_no,
      processed_at,
      created_at,
      customer:customers(id, name)
    `)
    .eq('status', 'processed')
    .order('created_at', { ascending: false })
    .limit(200);

  if (dateFilter.start) query = query.gte('created_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('created_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  return (data || []).map((w: any) => {
    const customerName = (w.customer as any)?.name || 'Pelanggan';

    return {
      id: `cbw-${w.id}`,
      date: w.processed_at || w.created_at,
      direction: 'out' as const,
      category: 'cashback_withdrawal',
      categoryLabel: 'Pencairan Cashback',
      description: `Pencairan cashback ${customerName}`,
      amount: Number(w.amount) || 0,
      source: 'Pool (HPP/Profit)',
      destination: `${w.bank_name} - ${w.account_no} (${customerName})`,
      referenceId: w.id,
      metadata: {
        customerId: (w.customer as any)?.id,
        bankName: w.bank_name,
      },
    };
  });
}

function getRequestTypeLabel(type: string): string {
  switch (type) {
    case 'purchase': return 'Pembelian';
    case 'salary': return 'Gaji';
    case 'expense': return 'Pengeluaran';
    case 'courier_deposit': return 'Setoran Kurir';
    case 'cash_to_bank': return 'Setor ke Bank';
    case 'pool_deposit': return 'Setor Pool Dana';
    default: return type;
  }
}

// ========================
// POOL DEPOSITS FETCHER
// ========================

async function fetchPoolDeposits(dateFilter: Record<string, string>): Promise<CashFlowEntry[]> {
  let query = db
    .from('finance_requests')
    .select(`
      id,
      type,
      amount,
      description,
      status,
      processed_at,
      created_at,
      bank_account:bank_accounts!finance_requests_bank_account_id_fkey(id, name, bank_name),
      notes
    `)
    .eq('status', 'processed')
    .eq('type', 'pool_deposit')
    .order('processed_at', { ascending: false })
    .limit(500);

  if (dateFilter.start) query = query.gte('processed_at', dateFilter.start);
  if (dateFilter.end) query = query.lte('processed_at', dateFilter.end + 'T23:59:59');

  const { data } = await query;
  if (!data) return [];

  return (data || []).map((r: any) => {
    const req = toCamelCase(r);
    const bankName = (r.bank_account as any)?.name || 'Bank';
    const bankLabel = (r.bank_account as any)?.bank_name || '';
    const poolType = (req.notes || '').includes('pool_hpp') ? 'HPP'
      : (req.notes || '').includes('pool_profit') ? 'Profit'
      : 'Lain-lain';

    return {
      id: `pool-${req.id}`,
      date: req.processedAt || req.createdAt,
      direction: 'in' as const,
      category: 'pool_deposit',
      categoryLabel: `Setor Pool ${poolType}`,
      description: req.description || `Setor ke Pool ${poolType} dari mutasi bank`,
      amount: Number(req.amount) || 0,
      source: `Bank: ${bankName}${bankLabel ? ` (${bankLabel})` : ''}`,
      destination: `Pool ${poolType}`,
      referenceId: req.id,
      createdBy: 'Sistem',
      metadata: {
        poolType,
        sourceType: 'bank',
      },
    };
  });
}

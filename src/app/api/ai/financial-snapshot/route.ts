// =====================================================================
// FINANCIAL SNAPSHOT API — AI Chatbox Data Source
// Endpoint: GET /api/ai/financial-snapshot
// 
// Menyediakan snapshot keuangan komprehensif untuk AI chatbox.
// Semua query dijalankan paralel (Promise.all) untuk performa optimal.
// Hanya super_admin yang bisa mengakses.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAndGetAuthUser } from '@/lib/token';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

/** Hitung persentase pertumbuhan (growth rate) */
function growthPct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100; // 2 desimal
}

/** Bulatkan ke 2 desimal */
function r2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

/** Dapatkan tanggal awal bulan (WIB/UTC+7) */
function getMonthStart(year: number, month: number): Date {
  return new Date(year, month, 1);
}

/** Dapatkan tanggal akhir bulan (WIB/UTC+7) */
function getMonthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0, 23, 59, 59, 999);
}

/** Hitung jumlah hari antara dua tanggal */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.ceil((b.getTime() - a.getTime()) / 86_400_000));
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    // ── 1. AUTH: Verifikasi user harus super_admin ──
    const authResult = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authResult.user.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Forbidden — hanya Super Admin yang dapat mengakses financial snapshot' },
        { status: 403 }
      );
    }

    // ── 2. Siapkan tanggal bulan (WIB/UTC+7) ──
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // 4 bulan terakhir untuk tren penjualan
    const months = [
      { label: 'thisMonth', year: currentYear, month: currentMonth },
      { label: 'lastMonth', year: currentMonth === 0 ? currentYear - 1 : currentYear, month: currentMonth === 0 ? 11 : currentMonth - 1 },
      { label: 'twoMonthsAgo', year: currentMonth <= 1 ? currentYear - 1 : currentYear, month: currentMonth <= 1 ? currentMonth + 10 : currentMonth - 2 },
      { label: 'threeMonthsAgo', year: currentMonth <= 2 ? currentYear - 1 : currentYear, month: currentMonth <= 2 ? currentMonth + 9 : currentMonth - 3 },
    ];

    // Tanggal 90 hari lalu (untuk top products)
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Tanggal 180 hari lalu (untuk customer patterns)
    const oneEightyDaysAgo = new Date(now);
    oneEightyDaysAgo.setDate(oneEightyDaysAgo.getDate() - 180);

    // Tanggal 7 & 30 hari lalu (untuk cash flow summary)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ====================================================================
    // BATCH 1: Semua query independen dijalankan paralel
    // ====================================================================

    const [
      // 1. Cash Pools — agregat dari semua transaksi penjualan
      cashPoolsResult,

      // 2a. Saldo rekening bank
      bankAccountsResult,

      // 2b. Saldo brankas (kas)
      cashBoxesResult,

      // 3. Penjualan per bulan (4 bulan terakhir)
      salesThisMonth,
      salesLastMonth,
      salesTwoMonthsAgo,
      salesThreeMonthsAgo,

      // 4. Transaction items 90 hari terakhir (untuk top products)
      transactionItemsResult,

      // 5. Transaksi penjualan 180 hari terakhir (untuk customer patterns)
      customerTransactionsResult,

      // 6. Semua produk aktif (untuk purchase recommendations & asset value)
      allProductsResult,

      // 7a. Transaksi belum lunas (discrepancy)
      unpaidTransactionsResult,

      // 7b. Transaksi dengan ketidaksesuaian data (discrepancy)
      allSaleTransactionsResult,

      // 8a. Pembayaran 7 hari terakhir
      payments7dResult,
      // 8b. Pembayaran 30 hari terakhir
      payments30dResult,
      // 8c. Finance requests (processed) 7 hari terakhir
      finReqs7dResult,
      // 8d. Finance requests (processed) 30 hari terakhir
      finReqs30dResult,
      // 8e. Fund transfers (completed) 7 hari terakhir
      fundTransfers7dResult,
      // 8f. Fund transfers (completed) 30 hari terakhir
      fundTransfers30dResult,

      // 9. Hutang perusahaan aktif
      companyDebtsResult,
    ] = await Promise.all([

      // ── 1. CASH POOLS: Agregat semua penjualan ──
      db
        .from('transactions')
        .select('total, paid_amount, remaining_amount, total_hpp, total_profit, hpp_paid, hpp_unpaid, profit_paid, profit_unpaid')
        .eq('type', 'sale')
        .in('status', ['approved', 'paid']),

      // ── 2a. REKENING BANK ──
      db
        .from('bank_accounts')
        .select('id, name, bank_name, balance, is_active')
        .order('name'),

      // ── 2b. BRANKAS (CASH BOXES) ──
      db
        .from('cash_boxes')
        .select('id, name, unit:units(name), balance, is_active')
        .order('name'),

      // ── 3. PENJUALAN 4 BULAN TERAKHIR ──
      // Bulan ini
      (() => {
        const start = getMonthStart(months[0].year, months[0].month);
        const end = getMonthEnd(months[0].year, months[0].month);
        return db
          .from('transactions')
          .select('total, total_profit, transaction_date')
          .eq('type', 'sale')
          .in('status', ['approved', 'paid'])
          .gte('transaction_date', start.toISOString())
          .lte('transaction_date', end.toISOString());
      })(),

      // Bulan lalu
      (() => {
        const start = getMonthStart(months[1].year, months[1].month);
        const end = getMonthEnd(months[1].year, months[1].month);
        return db
          .from('transactions')
          .select('total, total_profit, transaction_date')
          .eq('type', 'sale')
          .in('status', ['approved', 'paid'])
          .gte('transaction_date', start.toISOString())
          .lte('transaction_date', end.toISOString());
      })(),

      // 2 bulan lalu
      (() => {
        const start = getMonthStart(months[2].year, months[2].month);
        const end = getMonthEnd(months[2].year, months[2].month);
        return db
          .from('transactions')
          .select('total, total_profit, transaction_date')
          .eq('type', 'sale')
          .in('status', ['approved', 'paid'])
          .gte('transaction_date', start.toISOString())
          .lte('transaction_date', end.toISOString());
      })(),

      // 3 bulan lalu
      (() => {
        const start = getMonthStart(months[3].year, months[3].month);
        const end = getMonthEnd(months[3].year, months[3].month);
        return db
          .from('transactions')
          .select('total, total_profit, transaction_date')
          .eq('type', 'sale')
          .in('status', ['approved', 'paid'])
          .gte('transaction_date', start.toISOString())
          .lte('transaction_date', end.toISOString());
      })(),

      // ── 4. TRANSACTION ITEMS (90 hari terakhir, untuk top products) ──
      db
        .from('transaction_items')
        .select(`
          product_id,
          product_name,
          qty,
          subtotal,
          transaction:transactions!transaction_id(
            id, type, status, transaction_date,
            customer:customers(id, name)
          )
        `)
        .gte('created_at', ninetyDaysAgo.toISOString()),

      // ── 5. TRANSAKSI PENJUALAN 180 HARI (untuk customer patterns) ──
      db
        .from('transactions')
        .select(`
          id, total, transaction_date, customer_id,
          customer:customers(id, name, is_active)
        `)
        .eq('type', 'sale')
        .in('status', ['approved', 'paid'])
        .gte('transaction_date', oneEightyDaysAgo.toISOString())
        .order('transaction_date', { ascending: false })
        .limit(2000),

      // ── 6. SEMUA PRODUK AKTIF ──
      db
        .from('products')
        .select('id, name, global_stock, avg_hpp, conversion_rate, selling_price, sell_price_per_sub_unit, min_stock, is_active, category, unit, sub_unit')
        .eq('is_active', true)
        .limit(500),

      // ── 7a. TRANSAKSI BELUM LUNAS (discrepancy detection) ──
      db
        .from('transactions')
        .select('id, invoice_no, total, paid_amount, remaining_amount, payment_status, customer:customers(id, name), transaction_date')
        .eq('type', 'sale')
        .in('status', ['approved', 'paid'])
        .neq('payment_status', 'paid')
        .gt('remaining_amount', 0)
        .order('transaction_date', { ascending: false })
        .limit(200),

      // ── 7b. SEMUA TRANSAKSI PENJUALAN (untuk cek inkonsistensi total vs paid+remaining) ──
      db
        .from('transactions')
        .select('id, invoice_no, total, paid_amount, remaining_amount, payment_status, transaction_date')
        .eq('type', 'sale')
        .in('status', ['approved', 'paid'])
        .limit(3000),

      // ── 8a. PEMBAYARAN 7 HARI TERAKHIR ──
      (() => {
        let q = db.from('payments').select('amount, paymentMethod, created_at, transaction:transactions(type)');
        q = q.gte('created_at', sevenDaysAgo.toISOString());
        return q;
      })(),

      // ── 8b. PEMBAYARAN 30 HARI TERAKHIR ──
      (() => {
        let q = db.from('payments').select('amount, paymentMethod, created_at, transaction:transactions(type)');
        q = q.gte('created_at', thirtyDaysAgo.toISOString());
        return q;
      })(),

      // ── 8c. FINANCE REQUESTS (processed) 7 HARI ──
      (() => {
        let q = db
          .from('finance_requests')
          .select('amount, type, processed_at')
          .eq('status', 'processed')
          .eq('payment_type', 'pay_now')
          .neq('type', 'courier_deposit');
        q = q.gte('processed_at', sevenDaysAgo.toISOString());
        return q;
      })(),

      // ── 8d. FINANCE REQUESTS (processed) 30 HARI ──
      (() => {
        let q = db
          .from('finance_requests')
          .select('amount, type, processed_at')
          .eq('status', 'processed')
          .eq('payment_type', 'pay_now')
          .neq('type', 'courier_deposit');
        q = q.gte('processed_at', thirtyDaysAgo.toISOString());
        return q;
      })(),

      // ── 8e. FUND TRANSFERS (completed) 7 HARI ──
      (() => {
        let q = db
          .from('fund_transfers')
          .select('amount, type, processed_at')
          .eq('status', 'completed');
        q = q.gte('processed_at', sevenDaysAgo.toISOString());
        return q;
      })(),

      // ── 8f. FUND TRANSFERS (completed) 30 HARI ──
      (() => {
        let q = db
          .from('fund_transfers')
          .select('amount, type, processed_at')
          .eq('status', 'completed');
        q = q.gte('processed_at', thirtyDaysAgo.toISOString());
        return q;
      })(),

      // ── 9. HUTANG PERUSAHAAN AKTIF ──
      db
        .from('company_debts')
        .select('id, creditor_name, debt_type, total_amount, paid_amount, remaining_amount, due_date, status, description')
        .eq('is_active', true)
        .order('remaining_amount', { ascending: false })
        .limit(100),
    ]);

    // ====================================================================
    // BATCH 2: Query dependen — pembayaran per transaksi (untuk discrepancy)
    // ====================================================================

    // Ambil ID transaksi yang belum lunas untuk cross-check dengan payments
    const unpaidTxIds = (cashPoolsResult.data || [])
      ? (unpaidTransactionsResult.data || []).map((t: any) => t.id)
      : [];

    let paymentSumByTx: Record<string, number> = {};
    if (unpaidTxIds.length > 0) {
      // Ambil dalam batch (Supabase max 200 IN clause)
      const batchSize = 200;
      for (let i = 0; i < unpaidTxIds.length; i += batchSize) {
        const batch = unpaidTxIds.slice(i, i + batchSize);
        const { data: txPayments } = await db
          .from('payments')
          .select('transaction_id, amount')
          .in('transaction_id', batch);
        if (txPayments) {
          for (const p of txPayments) {
            paymentSumByTx[p.transaction_id] = (paymentSumByTx[p.transaction_id] || 0) + (Number(p.amount) || 0);
          }
        }
      }
    }

    // ====================================================================
    // PROSES DATA — Cash Pools (Section 1)
    // ====================================================================

    const allSales = cashPoolsResult.data || [];
    const cashPools = {
      hppInHand: r2(allSales.reduce((s: number, t: any) => s + (Number(t.hpp_paid) || 0), 0)),
      hppUnpaid: r2(allSales.reduce((s: number, t: any) => s + (Number(t.hpp_unpaid) || 0), 0)),
      profitInHand: r2(allSales.reduce((s: number, t: any) => s + (Number(t.profit_paid) || 0), 0)),
      profitUnpaid: r2(allSales.reduce((s: number, t: any) => s + (Number(t.profit_unpaid) || 0), 0)),
      totalSales: r2(allSales.reduce((s: number, t: any) => s + (Number(t.total) || 0), 0)),
      totalPaid: r2(allSales.reduce((s: number, t: any) => s + (Number(t.paid_amount) || 0), 0)),
      totalReceivables: r2(allSales.reduce((s: number, t: any) => s + (Number(t.remaining_amount) || 0), 0)),
      totalHpp: r2(allSales.reduce((s: number, t: any) => s + (Number(t.total_hpp) || 0), 0)),
      totalProfit: r2(allSales.reduce((s: number, t: any) => s + (Number(t.total_profit) || 0), 0)),
      totalTransactions: allSales.length,
    };

    // ====================================================================
    // PROSES DATA — Account Balances (Section 2)
    // ====================================================================

    const bankAccounts = rowsToCamelCase(bankAccountsResult.data || []).map((b: any) => ({
      id: b.id,
      name: b.name,
      bankName: b.bankName,
      balance: Number(b.balance) || 0,
      isActive: b.isActive,
    }));

    const cashBoxes = (cashBoxesResult.data || []).map((cb: any) => {
      const camel = toCamelCase(cb) as any;
      return {
        id: camel.id,
        name: camel.name,
        unit: camel.unit || null,
        balance: Number(camel.balance) || 0,
        isActive: camel.isActive,
      };
    });

    const totalBankBalance = bankAccounts.reduce((s: number, b: any) => s + b.balance, 0);
    const totalCashBoxBalance = cashBoxes.reduce((s: number, cb: any) => s + cb.balance, 0);

    const accountBalances = {
      bankAccounts,
      cashBoxes,
      totalBankBalance: r2(totalBankBalance),
      totalCashBoxBalance: r2(totalCashBoxBalance),
      totalBalance: r2(totalBankBalance + totalCashBoxBalance),
    };

    // ====================================================================
    // PROSES DATA — Sales Trend Analysis (Section 3)
    // ====================================================================

    const monthlySalesData = [
      { ...months[0], data: salesThisMonth.data || [] },
      { ...months[1], data: salesLastMonth.data || [] },
      { ...months[2], data: salesTwoMonthsAgo.data || [] },
      { ...months[3], data: salesThreeMonthsAgo.data || [] },
    ];

    const salesTrend = monthlySalesData.map((m) => {
      const txs = m.data;
      const totalSales = r2(txs.reduce((s: number, t: any) => s + (Number(t.total) || 0), 0));
      const totalProfit = r2(txs.reduce((s: number, t: any) => s + (Number(t.total_profit) || 0), 0));
      const txCount = txs.length;
      const avgOrderValue = txCount > 0 ? r2(totalSales / txCount) : 0;
      const monthLabel = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
      return {
        label: m.label,
        month: monthLabel,
        year: m.year,
        monthIndex: m.month,
        totalSales,
        totalProfit,
        txCount,
        avgOrderValue,
      };
    });

    // Hitung pertumbuhan bulan-ke-bulan
    const enrichedTrend = salesTrend.map((m, i) => {
      const prev = i < salesTrend.length - 1 ? salesTrend[i + 1] : null;
      return {
        ...m,
        salesGrowthPct: prev ? growthPct(m.totalSales, prev.totalSales) : null,
        profitGrowthPct: prev ? growthPct(m.totalProfit, prev.totalProfit) : null,
        txCountGrowthPct: prev ? growthPct(m.txCount, prev.txCount) : null,
      };
    });

    // ====================================================================
    // PROSES DATA — Top Products (Section 4)
    // ====================================================================

    // Filter hanya item dari transaksi penjualan (sale, status approved/paid)
    const allItems = transactionItemsResult.data || [];
    const saleItems = allItems.filter((item: any) => {
      const tx = item.transaction;
      return tx && tx.type === 'sale' && (tx.status === 'approved' || tx.status === 'paid');
    });

    // Group by product
    const productMap = new Map<string, {
      productId: string;
      productName: string;
      totalQty: number;
      totalRevenue: number;
      frequency: number;
    }>();

    for (const item of saleItems) {
      const pid = item.product_id || item.product_name || 'unknown';
      const entry = productMap.get(pid) || {
        productId: item.product_id,
        productName: item.product_name || 'Tanpa Nama',
        totalQty: 0,
        totalRevenue: 0,
        frequency: 0,
      };
      entry.totalQty += Number(item.qty) || 0;
      entry.totalRevenue += Number(item.subtotal) || 0;
      entry.frequency += 1;
      productMap.set(pid, entry);
    }

    // Urutkan berdasarkan revenue, ambil top 10
    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 10)
      .map((p) => ({
        ...p,
        totalRevenue: r2(p.totalRevenue),
        // Velocity = qty terjual per hari (dalam 90 hari)
        velocity: r2(p.totalQty / 90),
        avgRevenuePerOrder: p.frequency > 0 ? r2(p.totalRevenue / p.frequency) : 0,
      }));

    // Buat velocity map untuk cross-reference dengan purchase recommendations
    const velocityMap = new Map<string, number>();
    for (const [pid, entry] of productMap.entries()) {
      velocityMap.set(pid, entry.totalQty / 90);
    }

    // ====================================================================
    // PROSES DATA — Customer Purchase Patterns (Section 5)
    // ====================================================================

    const custTxs = customerTransactionsResult.data || [];

    // Group transaksi per customer
    interface CustomerEntry {
      customerId: string;
      customerName: string;
      isActive: boolean;
      transactions: Array<{ date: Date; total: number; productId?: string; productName?: string }>;
      totalSpent: number;
      totalOrders: number;
    }

    const customerMap = new Map<string, CustomerEntry>();

    for (const tx of custTxs) {
      const cid = tx.customer_id;
      if (!cid) continue;

      const cust = tx.customer as any;
      let entry = customerMap.get(cid);
      if (!entry) {
        entry = {
          customerId: cid,
          customerName: cust?.name || 'Unknown',
          isActive: cust?.is_active !== false,
          transactions: [],
          totalSpent: 0,
          totalOrders: 0,
        };
        customerMap.set(cid, entry);
      }
      entry.transactions.push({
        date: new Date(tx.transaction_date),
        total: Number(tx.total) || 0,
      });
      entry.totalSpent += Number(tx.total) || 0;
      entry.totalOrders += 1;
      customerMap.set(cid, entry);
    }

    // Fetch transaction items untuk mendapatkan typical products per customer
    const activeCustomerIds = Array.from(customerMap.keys());
    const customerProductFreq = new Map<string, Map<string, { name: string; count: number }>>();

    if (activeCustomerIds.length > 0) {
      // Ambil transaction items dari transaksi 180 hari terakhir untuk customer patterns
      const saleTxIds = custTxs.map((t: any) => t.id).filter(Boolean);
      const txItemsBatchSize = 200;

      for (let i = 0; i < saleTxIds.length; i += txItemsBatchSize) {
        const batchIds = saleTxIds.slice(i, i + txItemsBatchSize);
        const { data: custTxItems } = await db
          .from('transaction_items')
          .select('transaction_id, product_id, product_name, qty')
          .in('transaction_id', batchIds);

        if (custTxItems) {
          for (const item of custTxItems) {
            const txId = item.transaction_id;
            // Cari customer_id untuk transaction ini
            const tx = custTxs.find((t: any) => t.id === txId);
            if (!tx?.customer_id) continue;

            const cid = tx.customer_id;
            const pid = item.product_id || item.product_name || 'unknown';
            const pName = item.product_name || 'Unknown Product';

            if (!customerProductFreq.has(cid)) {
              customerProductFreq.set(cid, new Map());
            }
            const prodMap = customerProductFreq.get(cid)!;
            const existing = prodMap.get(pid) || { name: pName, count: 0 };
            existing.count += Number(item.qty) || 1;
            prodMap.set(pid, existing);
          }
        }
      }
    }

    // Proses setiap customer
    const customerPatterns = Array.from(customerMap.values())
      .map((c) => {
        // Urutkan transaksi berdasarkan tanggal
        const sortedTxs = [...c.transactions].sort((a, b) => a.date.getTime() - b.date.getTime());

        // Hitung rata-rata hari antar order
        let avgDaysBetween = 0;
        if (sortedTxs.length >= 2) {
          const gaps: number[] = [];
          for (let i = 1; i < sortedTxs.length; i++) {
            gaps.push(daysBetween(sortedTxs[i - 1].date, sortedTxs[i].date));
          }
          avgDaysBetween = gaps.reduce((s, g) => s + g, 0) / gaps.length;
        }

        const lastOrderDate = sortedTxs.length > 0 ? sortedTxs[sortedTxs.length - 1].date : null;
        const daysSinceLastOrder = lastOrderDate ? daysBetween(lastOrderDate, now) : null;

        // Typical products — top 3 yang paling sering dibeli
        const prodFreq = customerProductFreq.get(c.customerId);
        let typicalProducts: Array<{ productName: string; frequency: number }> = [];
        if (prodFreq && prodFreq.size > 0) {
          typicalProducts = Array.from(prodFreq.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
            .map((p) => ({ productName: p.name, frequency: p.count }));
        }

        // Prediksi order berikutnya
        let predictedNextOrder: string | null = null;
        if (lastOrderDate && avgDaysBetween > 0) {
          const predicted = new Date(lastOrderDate);
          predicted.setDate(predicted.getDate() + Math.round(avgDaysBetween));
          predictedNextOrder = predicted.toISOString();
        }

        // Apakah overdue?
        const isOverdue = daysSinceLastOrder !== null && avgDaysBetween > 0
          ? daysSinceLastOrder > avgDaysBetween * 1.5
          : false;

        return {
          customerId: c.customerId,
          customerName: c.customerName,
          isActive: c.isActive,
          totalOrders: c.totalOrders,
          totalSpent: r2(c.totalSpent),
          avgOrderValue: c.totalOrders > 0 ? r2(c.totalSpent / c.totalOrders) : 0,
          avgDaysBetweenOrders: r2(avgDaysBetween),
          lastOrderDate: lastOrderDate?.toISOString() || null,
          daysSinceLastOrder,
          typicalProducts,
          predictedNextOrder,
          isOverdue,
        };
      })
      .filter((c) => c.isActive !== false) // Hanya customer aktif
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 20);

    // ====================================================================
    // PROSES DATA — Purchase Recommendations (Section 6)
    // ====================================================================

    const allProducts = allProductsResult.data || [];
    const purchaseRecommendations: Array<{
      productId: string;
      productName: string;
      currentStock: number;
      velocity: number;
      daysOfStock: number;
      suggestedQty: number;
      avgHpp: number;
      estimatedCost: number;
      conversionRate: number;
      unit: string;
    }> = [];

    for (const p of allProducts) {
      const camel = toCamelCase(p) as any;
      const pid = camel.id;
      const currentStock = Number(camel.globalStock) || 0;
      const conversionRate = Number(camel.conversionRate) || 1;
      const avgHpp = Number(camel.avgHpp) || 0;

      // Cari velocity dari top products (90 hari terakhir)
      const velocity = velocityMap.get(pid) || 0;

      if (velocity <= 0) continue; // Tidak ada penjualan, skip

      // Stok dalam hari = stok saat ini / velocity per hari
      // velocity sudah dalam unit/hari, sesuai dengan global_stock
      const daysOfStock = currentStock / velocity;

      // Kebutuhan untuk 30 hari ke depan
      const neededFor30Days = velocity * 30;
      const suggestedQty = Math.max(0, neededFor30Days - currentStock);

      if (suggestedQty <= 0) continue; // Stok masih cukup, skip

      // Estimasi biaya = suggestedQty * avgHpp (dalam satuan utama)
      const estimatedCost = suggestedQty * avgHpp;

      purchaseRecommendations.push({
        productId: pid,
        productName: camel.name,
        currentStock,
        velocity: r2(velocity),
        daysOfStock: r2(daysOfStock),
        suggestedQty: Math.ceil(suggestedQty),
        avgHpp: r2(avgHpp),
        estimatedCost: r2(estimatedCost),
        conversionRate,
        unit: camel.unit || 'pcs',
      });
    }

    // Urutkan berdasarkan estimated cost descending, ambil top 10
    purchaseRecommendations.sort((a, b) => b.estimatedCost - a.estimatedCost);
    const topRecommendations = purchaseRecommendations.slice(0, 10);

    // ====================================================================
    // PROSES DATA — Discrepancy Detection (Section 7)
    // ====================================================================

    const unpaidList = unpaidTransactionsResult.data || [];
    const allSaleTxs = allSaleTransactionsResult.data || [];

    // 7a. Transaksi belum lunas dengan piutang
    const unpaidReceivables = unpaidList.map((t: any) => ({
      id: t.id,
      invoiceNo: t.invoice_no,
      total: Number(t.total) || 0,
      paidAmount: Number(t.paid_amount) || 0,
      remainingAmount: Number(t.remaining_amount) || 0,
      paymentStatus: t.payment_status,
      customerName: t.customer?.name || null,
      transactionDate: t.transaction_date,
      daysOverdue: t.transaction_date
        ? daysBetween(new Date(t.transaction_date), now)
        : null,
    }));

    // 7b. Inkonsistensi: total !== paid_amount + remaining_amount
    const dataInconsistencies = allSaleTxs
      .filter((t: any) => {
        const total = Number(t.total) || 0;
        const paid = Number(t.paid_amount) || 0;
        const remaining = Number(t.remaining_amount) || 0;
        // Toleransi 1 rupiah untuk floating point
        return Math.abs(total - (paid + remaining)) > 1;
      })
      .map((t: any) => {
        const total = Number(t.total) || 0;
        const paid = Number(t.paid_amount) || 0;
        const remaining = Number(t.remaining_amount) || 0;
        return {
          id: t.id,
          invoiceNo: t.invoice_no,
          total,
          paidAmount: paid,
          remainingAmount: remaining,
          expectedTotal: r2(paid + remaining),
          discrepancy: r2(total - (paid + remaining)),
          transactionDate: t.transaction_date,
          paymentStatus: t.payment_status,
        };
      });

    // 7c. Pembayaran tidak sesuai dengan paid_amount transaksi
    const paymentMismatches: Array<{
      transactionId: string;
      invoiceNo?: string;
      transactionPaidAmount: number;
      actualPaymentSum: number;
      discrepancy: number;
    }> = [];

    // Cross-check semua transaksi (tidak hanya yang unpaid)
    const allSaleTxMap = new Map<string, any>();
    for (const t of allSaleTxs) {
      allSaleTxMap.set(t.id, t);
    }

    // Untuk efisiensi, fetch payment sums untuk semua transaksi penjualan
    const allSaleTxIds = allSaleTxs.map((t: any) => t.id);
    if (allSaleTxIds.length > 0) {
      const txPaymentSumMap: Record<string, number> = {};
      for (let i = 0; i < allSaleTxIds.length; i += 200) {
        const batch = allSaleTxIds.slice(i, i + 200);
        const { data: txPays } = await db
          .from('payments')
          .select('transaction_id, amount')
          .in('transaction_id', batch);
        if (txPays) {
          for (const p of txPays) {
            txPaymentSumMap[p.transaction_id] = (txPaymentSumMap[p.transaction_id] || 0) + (Number(p.amount) || 0);
          }
        }
      }

      for (const [txId, sum] of Object.entries(txPaymentSumMap)) {
        const tx = allSaleTxMap.get(txId);
        if (!tx) continue;
        const paidAmount = Number(tx.paid_amount) || 0;
        // Toleransi 1 rupiah
        if (Math.abs(paidAmount - sum) > 1) {
          paymentMismatches.push({
            transactionId: txId,
            invoiceNo: tx.invoice_no,
            transactionPaidAmount: r2(paidAmount),
            actualPaymentSum: r2(sum),
            discrepancy: r2(paidAmount - sum),
          });
        }
      }
    }

    // Ambil hanya 50 mismatches teratas (bisa banyak)
    paymentMismatches.sort((a, b) => Math.abs(b.discrepancy) - Math.abs(a.discrepancy));

    const discrepancies = {
      unpaidReceivables: unpaidReceivables.slice(0, 50),
      totalUnpaidReceivables: unpaidReceivables.reduce((s: number, r: any) => s + r.remainingAmount, 0),
      unpaidCount: unpaidReceivables.length,
      dataInconsistencies: dataInconsistencies.slice(0, 50),
      inconsistencyCount: dataInconsistencies.length,
      paymentMismatches: paymentMismatches.slice(0, 50),
      paymentMismatchCount: paymentMismatches.length,
    };

    // ====================================================================
    // PROSES DATA — Cash Flow Summary (Section 8)
    // ====================================================================

    // Inflow = pembayaran dari transaksi PENJUALAN
    // Outflow = finance requests yang sudah diproses (purchase, expense, salary)
    // Transfer = fund transfers
    function calcCashFlow(
      payments: any[],
      finReqs: any[],
      transfers: any[]
    ) {
      const inflow = payments
        .filter((p: any) => p.transaction?.type === 'sale')
        .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);

      const outflow = finReqs.reduce((s: number, r: any) => s + (Number(r.amount) || 0), 0);

      const transferTotal = transfers.reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);

      return {
        inflow: r2(inflow),
        outflow: r2(outflow),
        transferTotal: r2(transferTotal),
        net: r2(inflow - outflow),
      };
    }

    const cashFlow7d = calcCashFlow(
      payments7dResult.data || [],
      finReqs7dResult.data || [],
      fundTransfers7dResult.data || [],
    );

    const cashFlow30d = calcCashFlow(
      payments30dResult.data || [],
      finReqs30dResult.data || [],
      fundTransfers30dResult.data || [],
    );

    const cashFlowSummary = {
      last7Days: cashFlow7d,
      last30Days: cashFlow30d,
    };

    // ====================================================================
    // PROSES DATA — Company Debts (Section 9)
    // ====================================================================

    const debts = rowsToCamelCase(companyDebtsResult.data || []).map((d: any) => ({
      id: d.id,
      creditorName: d.creditorName,
      debtType: d.debtType,
      totalAmount: Number(d.totalAmount) || 0,
      paidAmount: Number(d.paidAmount) || 0,
      remainingAmount: Number(d.remainingAmount) || 0,
      dueDate: d.dueDate,
      status: d.status,
      description: d.description,
      // Hitung hari tersisa (atau hari terlambat)
      daysUntilDue: d.dueDate
        ? Math.ceil((new Date(d.dueDate).getTime() - now.getTime()) / 86_400_000)
        : null,
      isOverdue: d.dueDate ? new Date(d.dueDate) < now : false,
    }));

    const totalDebtRemaining = debts.reduce((s: number, d: any) => s + d.remainingAmount, 0);
    const overdueDebts = debts.filter((d: any) => d.isOverdue);
    const totalOverdue = overdueDebts.reduce((s: number, d: any) => s + d.remainingAmount, 0);

    const companyDebts = {
      debts,
      totalDebtRemaining: r2(totalDebtRemaining),
      totalDebtCount: debts.length,
      overdueDebtCount: overdueDebts.length,
      totalOverdueAmount: r2(totalOverdue),
    };

    // ====================================================================
    // PROSES DATA — Product Asset Value (Section 10)
    // ====================================================================

    let totalAssetValue = 0;
    const productAssetValues: Array<{
      productId: string;
      productName: string;
      category: string;
      stock: number;
      avgHpp: number;
      assetValue: number;
      unit: string;
    }> = [];

    for (const p of allProducts) {
      const camel = toCamelCase(p) as any;
      const stock = Number(camel.globalStock) || 0;
      const avgHpp = Number(camel.avgHpp) || 0;
      const assetValue = stock * avgHpp;
      totalAssetValue += assetValue;

      productAssetValues.push({
        productId: camel.id,
        productName: camel.name,
        category: camel.category || 'Uncategorized',
        stock,
        avgHpp: r2(avgHpp),
        assetValue: r2(assetValue),
        unit: camel.unit || 'pcs',
      });
    }

    // Urutkan berdasarkan asset value descending
    productAssetValues.sort((a, b) => b.assetValue - a.assetValue);

    // Category breakdown
    const categoryMap = new Map<string, { assetValue: number; productCount: number }>();
    for (const pav of productAssetValues) {
      const cat = pav.category;
      const entry = categoryMap.get(cat) || { assetValue: 0, productCount: 0 };
      entry.assetValue += pav.assetValue;
      entry.productCount += 1;
      categoryMap.set(cat, entry);
    }

    const categoryBreakdown = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        assetValue: r2(data.assetValue),
        productCount: data.productCount,
      }))
      .sort((a, b) => b.assetValue - a.assetValue);

    const productAssetValue = {
      totalAssetValue: r2(totalAssetValue),
      totalProducts: allProducts.length,
      topProductsByValue: productAssetValues.slice(0, 10),
      categoryBreakdown,
    };

    // ====================================================================
    // RESPONSE
    // ====================================================================

    return NextResponse.json({
      timestamp: now.toISOString(),
      generatedAt: new Date().toISOString(),
      data: {
        cashPools,
        accountBalances,
        salesTrend: enrichedTrend,
        topProducts,
        customerPatterns,
        purchaseRecommendations: topRecommendations,
        discrepancies,
        cashFlowSummary,
        companyDebts,
        productAssetValue,
      },
    }, {
      headers: {
        'Cache-Control': 'private, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('[FINANCIAL SNAPSHOT] Error:', error);
    return NextResponse.json(
      { error: 'Gagal mengambil snapshot keuangan', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { verifyAuthUser } from '@/lib/token';
import { rowsToCamelCase, toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================

function rp(n: number) {
  return 'Rp ' + Math.round(n).toLocaleString('id-ID');
}

function r2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

function dateRange(period: string) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'hari': case 'today': case 'hari ini':
      return today.toISOString();
    case 'minggu': case 'week': case 'minggu ini': {
      const day = today.getDay();
      const start = new Date(today);
      start.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
      return start.toISOString();
    }
    case 'bulan': case 'month': case 'bulan ini':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    default:
      return undefined;
  }
}

function growthPct(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 10000) / 100;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.ceil((b.getTime() - a.getTime()) / 86_400_000));
}

function scoreColor(score: number): string {
  if (score >= 70) return '🟢';
  if (score >= 40) return '🟡';
  return '🔴';
}

function scoreLabel(score: number): string {
  if (score >= 70) return 'SEHAT';
  if (score >= 40) return 'PERLU PERHATIAN';
  return 'KRITIS';
}

// =====================================================================
// DATA QUERY FUNCTIONS (Existing - KEPT AS-IS)
// =====================================================================

async function handleSalesToday(isSuperAdmin: boolean) {
  const dr = dateRange('hari ini');
  let query = db.from('transactions').select(`
    *, items:transaction_items(*), created_by:users!created_by_id(name, role), customer:customers(name)
  `).eq('type', 'sale').in('status', ['approved', 'paid']);
  if (dr) query = query.gte('transaction_date', dr);
  const { data: sales } = await query.order('transaction_date', { ascending: false }).limit(50);
  const list = sales || [];
  const total = list.reduce((s, t: any) => s + (t.total || 0), 0);
  const paid = list.reduce((s, t: any) => s + (t.paid_amount || 0), 0);

  let text = `📊 **Penjualan Hari Ini**\n`;
  text += `📅 ${format(new Date(), 'EEEE, dd MMMM yyyy', { locale: id })}\n\n`;
  text += `💰 Total: **${rp(total)}**\n`;
  if (isSuperAdmin) {
    const profit = list.reduce((s, t: any) => s + (t.total_profit || 0), 0);
    text += `📈 Profit: **${rp(profit)}**\n`;
  }
  text += `💵 Dibayar: **${rp(paid)}**\n`;
  text += `📝 Transaksi: **${list.length}**\n`;
  if (list.length > 0) {
    text += `\n---\n📝 **Detail:**\n`;
    list.slice(0, 10).forEach((t: any, i: number) => {
      const c = t.customer?.name || 'Umum';
      const ps = t.payment_status === 'paid' ? '✅' : '⏳';
      text += `\n${i + 1}. **${t.invoice_no}** — ${c} | ${rp(t.total)} | ${ps}\n`;
    });
  } else {
    text += `\n_Belum ada transaksi hari ini._`;
  }
  return text;
}

async function handleSalesWeek(isSuperAdmin: boolean) {
  const dr = dateRange('minggu ini');
  let query = db.from('transactions').select('total, total_profit').eq('type', 'sale').in('status', ['approved', 'paid']);
  if (dr) query = query.gte('transaction_date', dr);
  const { data: sales } = await query;
  const list = sales || [];
  const total = list.reduce((s, t: any) => s + (t.total || 0), 0);
  const profit = list.reduce((s, t: any) => s + (t.total_profit || 0), 0);

  let text = `📊 **Penjualan Minggu Ini**\n\n`;
  text += `💰 Total: **${rp(total)}**\n`;
  if (isSuperAdmin) text += `📈 Profit: **${rp(profit)}**\n`;
  text += `📝 Transaksi: **${list.length}**\n`;
  return text;
}

async function handleSalesMonth(isSuperAdmin: boolean) {
  const dr = dateRange('bulan ini');
  let query = db.from('transactions').select('total, total_profit').eq('type', 'sale').in('status', ['approved', 'paid']);
  if (dr) query = query.gte('transaction_date', dr);
  const { data: sales } = await query;
  const list = sales || [];
  const total = list.reduce((s, t: any) => s + (t.total || 0), 0);
  const profit = list.reduce((s, t: any) => s + (t.total_profit || 0), 0);

  let text = `📊 **Penjualan Bulan Ini**\n`;
  text += `📅 ${format(new Date(), 'MMMM yyyy', { locale: id })}\n\n`;
  text += `💰 Total: **${rp(total)}**\n`;
  if (isSuperAdmin) {
    text += `📈 Profit: **${rp(profit)}**\n`;
    text += `📊 Margin: **${total > 0 ? ((profit / total) * 100).toFixed(1) : 0}%**\n`;
  }
  text += `📝 Transaksi: **${list.length}**\n`;
  return text;
}

async function handleSalesPerSales(isSuperAdmin: boolean) {
  const { data: sales } = await db.from('transactions').select(`
    *, created_by:users!created_by_id(name, role)
  `).eq('type', 'sale').in('status', ['approved', 'paid']).order('transaction_date', { ascending: false }).limit(500);

  const bySales = new Map<string, { name: string; total: number; count: number; profit: number }>();
  (sales || []).forEach((t: any) => {
    const cb = t.created_by;
    if (cb?.role === 'sales') {
      const e = bySales.get(t.created_by_id) || { name: cb.name, total: 0, count: 0, profit: 0 };
      e.total += (t.total || 0);
      e.count += 1;
      e.profit += (t.total_profit || 0);
      bySales.set(t.created_by_id, e);
    }
  });
  const ranked = Array.from(bySales.values()).sort((a, b) => b.total - a.total);
  let text = `👥 **Penjualan Per Sales**\n\n`;
  if (ranked.length === 0) return text + '_Tidak ada data._';
  ranked.forEach((s, i) => {
    text += `${i + 1}. **${s.name}**\n`;
    text += `   💰 ${rp(s.total)} | 📝 ${s.count} trx`;
    if (isSuperAdmin) text += ` | 📈 ${rp(s.profit)}`;
    text += `\n\n`;
  });
  return text;
}

async function handleStockAll(isSuperAdmin: boolean) {
  const { data: products } = await db.from('products').select('*').eq('is_active', true).order('name').limit(100);
  const list = products || [];
  let text = `📦 **Stok Produk**\n`;
  text += `📋 Total: **${list.length} produk**\n\n`;
  list.forEach((p: any) => {
    const status = p.global_stock === 0 ? '🚫' : p.global_stock <= p.min_stock ? '⚠️' : '✅';
    text += `${status} **${p.name}** — Stok: ${p.global_stock} ${p.unit || 'pcs'} | Jual: ${rp(p.selling_price)}\n`;
  });
  return text;
}

async function handleStockLow() {
  const { data: products } = await db.from('products').select('*').eq('is_active', true).gt('global_stock', 0).limit(500);
  const low = (products || []).filter((p: any) => p.global_stock > 0 && p.global_stock <= (p.min_stock || 0));
  let text = `⚠️ **Stok Rendah**\n\n`;
  if (low.length === 0) return text + '_Semua stok aman!_ ✅\n';
  low.forEach((p: any) => text += `⚠️ **${p.name}** — Stok: **${p.global_stock}** (Min: ${p.min_stock})\n`);
  return text;
}

async function handleCustomersUnpaid() {
  const { data: receivables } = await db.from('receivables').select('*').eq('status', 'active').order('remaining_amount', { ascending: false }).limit(100);
  let text = `📋 **Piutang Aktif**\n`;
  text += `📋 Total: **${(receivables || []).length} piutang**\n\n`;
  if ((receivables || []).length === 0) return text + '_Semua lunas!_ ✅\n';
  (receivables || []).forEach((r: any, i: number) => {
    const overdue = r.overdue_days > 0 ? `🔴 ${r.overdue_days} hari` : '🟢';
    text += `${i + 1}. **${r.customer_name || '-'}** — ${rp(r.remaining_amount)} / ${rp(r.total_amount)} | ${overdue}\n\n`;
  });
  return text;
}

async function handleCustomersSummary() {
  const { count: total } = await db.from('customers').select('*', { count: 'exact', head: true });
  const { data: topCustomers } = await db.from('customers').select('*').order('total_spent', { ascending: false }).limit(10);
  const totalSpent = (topCustomers || []).reduce((s: number, c: any) => s + (c.total_spent || 0), 0);
  let text = `👥 **Konsumen**\n\n`;
  text += `📋 Total: **${total}**\n💰 Total Belanja: **${rp(totalSpent)}**\n\n🏆 **Top:**\n`;
  (topCustomers || []).forEach((c: any, i: number) => {
    text += `${i + 1}. **${c.name}** — ${rp(c.total_spent || 0)} (${c.total_orders || 0} order)\n`;
  });
  return text;
}

// =====================================================================
// FINANCIAL SNAPSHOT DATA FETCHER (Existing - KEPT AS-IS)
// =====================================================================

async function fetchFinancialSnapshot(authHeader: string | null, origin: string): Promise<any | null> {
  try {
    const url = `${origin}/api/ai/financial-snapshot`;
    const res = await fetch(url, {
      headers: {
        'Authorization': authHeader || '',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('[AI Chat] Financial snapshot fetch failed:', res.status);
      return null;
    }
    const json = await res.json();
    return json.data || null;
  } catch (err) {
    console.error('[AI Chat] Financial snapshot fetch error:', err);
    return null;
  }
}

// =====================================================================
// ANALYSIS TYPE DETECTION
// =====================================================================

type AnalysisType =
  | 'hpp_profit'
  | 'restock'
  | 'sales_trend'
  | 'customer_prediction'
  | 'cash_flow_audit'
  | 'financial_health'
  | 'business_analysis'
  | 'variance_analysis'
  | 'performance_analysis'
  | 'system_health'
  | 'debt_analysis'
  | 'asset_valuation'
  | 'receivables_analysis'
  | 'comprehensive_report'
  | 'general';

function detectAnalysisType(msg: string): AnalysisType {
  const q = msg.toLowerCase();

  // A. HPP & Profit Analysis
  if (q.match(/hpp|harga\s*pokok|biaya\s*produksi/)) return 'hpp_profit';
  if (q.match(/profit\s*(di\s*tangan|terkumpul|sudah|yang)/)) return 'hpp_profit';
  if (q.match(/laba\s*(di\s*tangan|terkumpul)/)) return 'hpp_profit';
  if (q.match(/uang\s*(yang|sudah)\s*(di\s*tangan|terkumpul|tersedia)/)) return 'hpp_profit';

  // B. Restock Recommendations
  if (q.match(/saran\s*(beli|restock|pengadaan)/)) return 'restock';
  if (q.match(/rekomendasi\s*(beli|restock|stok|pengadaan)/)) return 'restock';
  if (q.match(/apa\s*(yang|saja)\s*(harus|perlu|sebaiknya)\s*di\s*(beli|restock|adakan)/)) return 'restock';

  // C. Sales Trend Analysis
  if (q.match(/tren\s*(penjualan|sales|omset)/)) return 'sales_trend';
  if (q.match(/pola\s*(penjualan|beli)/)) return 'sales_trend';
  if (q.match(/analisa\s*(penjualan|sales)/)) return 'sales_trend';
  if (q.match(/analisis\s*(penjualan|sales)/)) return 'sales_trend';
  if (q.match(/growth|pertumbuhan/)) return 'sales_trend';
  if (q.match(/penjualan.*(per\s*(bulan|2\s*bulan|3\s*bulan|minggu|kuartal))/)) return 'sales_trend';

  // D. Customer Prediction
  if (q.match(/prediksi|predict|forecast/)) return 'customer_prediction';
  if (q.match(/kemungkinan.*(konsumen|customer|pelanggan).*(beli|order|pesan)/)) return 'customer_prediction';
  if (q.match(/konsumen\s*(mana|yang).*(akan\s*beli|bakal|next)/)) return 'customer_prediction';

  // E. Cash Flow Audit
  if (q.match(/uang\s*masuk|arus\s*kas|cash\s*flow/)) return 'cash_flow_audit';
  if (q.match(/audit\s*(arus|kas|keuangan)/)) return 'cash_flow_audit';

  // F. Financial Health Check
  if (q.match(/kesehatan\s*(keuangan|bisnis|financial)/)) return 'financial_health';
  if (q.match(/financial\s*(health|status)/)) return 'financial_health';
  if (q.match(/keuangan.*(sehat|baik|buruk|kondisi)/)) return 'financial_health';
  if (q.match(/review\s*(keuangan|financial)/)) return 'financial_health';
  if (q.match(/laporan\s*(keuangan|financial|lengkap|komprehensif|report)/)) return 'comprehensive_report';

  // G. Business Analysis
  if (q.match(/analisa\s*(bisnis|business)/)) return 'business_analysis';
  if (q.match(/analisis\s*(bisnis|business)/)) return 'business_analysis';
  if (q.match(/laporan\s*bisnis/)) return 'business_analysis';
  if (q.match(/ringkasan\s*bisnis/)) return 'business_analysis';
  if (q.match(/business\s*analysis/)) return 'business_analysis';
  if (q.match(/overview\s*bisnis/)) return 'business_analysis';

  // H. Variance Analysis
  if (q.match(/selisih|discrepancy|ketidaksesuaian/)) return 'variance_analysis';
  if (q.match(/inkonsistensi|cek\s*(kecocokan|kebenaran)/)) return 'variance_analysis';
  if (q.match(/variance/)) return 'variance_analysis';

  // I. Performance Analysis
  if (q.match(/performa|kinerja/)) return 'performance_analysis';
  if (q.match(/achievement|pencapaian/)) return 'performance_analysis';
  if (q.match(/target\s*(vs|versus)\s*aktual/)) return 'performance_analysis';
  if (q.match(/target\s*penjualan/)) return 'performance_analysis';

  // J. System Health
  if (q.match(/kesehatan\s*sistem|system\s*health/)) return 'system_health';
  if (q.match(/status\s*sistem/)) return 'system_health';
  if (q.match(/cek\s*sistem/)) return 'system_health';
  if (q.match(/infrastructure/)) return 'system_health';

  // L. Company Debt Analysis
  if (q.match(/hutang|utang\s*perusahaan/)) return 'debt_analysis';
  if (q.match(/debt/)) return 'debt_analysis';

  // M. Asset Valuation
  if (q.match(/aset|asset/)) return 'asset_valuation';
  if (q.match(/nilai\s*(inventori|stok)/)) return 'asset_valuation';

  // N. Receivables Analysis
  if (q.match(/piutang|receivable|tagihan|kredit/)) return 'receivables_analysis';

  return 'general';
}

// =====================================================================
// A. HPP & PROFIT ANALYSIS
// =====================================================================

function handleHPPProfit(data: any): string {
  if (!data?.cashPools) {
    return '⚠️ Data HPP & Profit tidak tersedia saat ini. Coba lagi nanti.';
  }
  const cp = data.cashPools;
  const now = new Date();

  const totalHppAll = cp.hppInHand + cp.hppUnpaid;
  const totalProfitAll = cp.profitInHand + cp.profitUnpaid;
  const hppRecoveryRate = totalHppAll > 0 ? r2((cp.hppInHand / totalHppAll) * 100) : 0;
  const profitRealizationRate = totalProfitAll > 0 ? r2((cp.profitInHand / totalProfitAll) * 100) : 0;

  let text = `📊 **Analisis HPP & Profit**\n\n`;
  text += `📅 Analisis per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  text += `**💰 Akumulasi Dana:**\n`;
  text += `• HPP di tangan: **${rp(cp.hppInHand)}**\n`;
  text += `• Profit di tangan: **${rp(cp.profitInHand)}**\n`;
  text += `• HPP tertahan (piutang): **${rp(cp.hppUnpaid)}**\n`;
  text += `• Profit tertahan (piutang): **${rp(cp.profitUnpaid)}**\n`;
  text += `• Total HPP keseluruhan: **${rp(totalHppAll)}**\n`;
  text += `• Total Profit keseluruhan: **${rp(totalProfitAll)}**\n\n`;

  text += `**📈 Rasio:**\n`;
  text += `• HPP Recovery Rate: **${hppRecoveryRate}%** ${hppRecoveryRate >= 80 ? '✅' : '⚠️'} (target: >80%)\n`;
  text += `• Profit Realization Rate: **${profitRealizationRate}%** ${profitRealizationRate >= 75 ? '✅' : '⚠️'} (target: >75%)\n`;
  text += `• Total penjualan: **${rp(cp.totalSales)}** (${cp.totalTransactions} transaksi)\n`;
  text += `• Total uang masuk: **${rp(cp.totalPaid)}**\n\n`;

  text += `**💡 Rekomendasi:**\n`;
  if (hppRecoveryRate < 80) {
    text += `• ⚠️ HPP Recovery Rate di bawah target (${hppRecoveryRate}%). Prioritaskan penagihan piutang untuk mengembalikan modal.\n`;
  } else {
    text += `• ✅ HPP Recovery Rate sudah baik (${hppRecoveryRate}%).\n`;
  }
  if (profitRealizationRate < 75) {
    text += `• ⚠️ Profit Realization Rate rendah (${profitRealizationRate}%). Percepat penagihan piutang atas transaksi profit.\n`;
  } else {
    text += `• ✅ Profit Realization Rate sudah baik (${profitRealizationRate}%).\n`;
  }
  if (cp.totalReceivables > 0) {
    text += `• 📋 Sisa piutang: **${rp(cp.totalReceivables)}** — segera lakukan follow-up penagihan.\n`;
  }

  return text;
}

// =====================================================================
// B. RESTOCK RECOMMENDATIONS
// =====================================================================

function handleRestock(data: any): string {
  if (!data?.purchaseRecommendations) {
    return '⚠️ Data rekomendasi restock tidak tersedia saat ini.';
  }
  const recs = data.purchaseRecommendations;
  if (recs.length === 0) {
    return `📦 **Rekomendasi Restock**\n\n✅ Semua produk memiliki stok yang mencukupi untuk 30 hari ke depan. Tidak ada produk yang perlu di-restock saat ini.\n`;
  }

  // Sort by days remaining (ascending = most urgent first)
  const sorted = [...recs].sort((a: any, b: any) => (a.daysOfStock || 999) - (b.daysOfStock || 999));
  const totalInvestment = sorted.reduce((s: number, r: any) => s + (r.estimatedCost || 0), 0);

  let text = `📦 **Rekomendasi Restock**\n\n`;
  text += `📅 ${format(new Date(), 'dd MMMM yyyy', { locale: id })}\n`;
  text += `📋 ${sorted.length} produk perlu di-restock\n\n`;

  sorted.forEach((r: any, i: number) => {
    const urgency = r.daysOfStock <= 5 ? '🔴 URGENT' : r.daysOfStock <= 15 ? '🟡 Segera' : '🟢';
    text += `${i + 1}. **${r.productName}** ${urgency}\n`;
    text += `   Stok: ${r.currentStock} ${r.unit} | Velocity: ${r.velocity}/${r.unit}/hari | Sisa: ~${Math.round(r.daysOfStock)} hari\n`;
    text += `   → Saran beli: **${r.suggestedQty} ${r.unit}** (est. biaya ${rp(r.estimatedCost)})\n\n`;
  });

  text += `---\n`;
  text += `💰 **Total estimasi investasi: ${rp(totalInvestment)}**\n\n`;

  const urgentCount = sorted.filter((r: any) => r.daysOfStock <= 5).length;
  if (urgentCount > 0) {
    text += `🔴 **${urgentCount} produk dalam status URGENT!** Segera lakukan pemesanan.\n`;
  }

  return text;
}

// =====================================================================
// C. SALES TREND ANALYSIS
// =====================================================================

function handleSalesTrend(data: any): string {
  if (!data?.salesTrend || data.salesTrend.length === 0) {
    return '⚠️ Data tren penjualan tidak tersedia.';
  }
  const trend = data.salesTrend;
  const now = new Date();

  let text = `📈 **Analisis Tren Penjualan**\n\n`;
  text += `📅 Data 4 bulan terakhir per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  // Find best and worst months
  let bestMonth = trend[0];
  let worstMonth = trend[0];
  let totalSales = 0;
  let totalProfit = 0;
  let totalTx = 0;
  let positiveMonths = 0;

  trend.forEach((m: any) => {
    if (m.totalSales > bestMonth.totalSales) bestMonth = m;
    if (m.totalSales < worstMonth.totalSales) worstMonth = m;
    totalSales += m.totalSales;
    totalProfit += m.totalProfit;
    totalTx += m.txCount;
    if (m.salesGrowthPct !== null && m.salesGrowthPct > 0) positiveMonths++;
  });

  // Monthly detail
  text += `**📊 Detail Per Bulan:**\n`;
  trend.forEach((m: any) => {
    const growthIcon = m.salesGrowthPct === null ? '—' : m.salesGrowthPct >= 0 ? '▲' : '▼';
    const growthStr = m.salesGrowthPct !== null ? `${growthIcon} ${Math.abs(m.salesGrowthPct)}%` : '(baseline)';
    const profitMargin = m.totalSales > 0 ? r2((m.totalProfit / m.totalSales) * 100) : 0;
    text += `• **${m.month}**: Sales ${rp(m.totalSales)} | Profit ${rp(m.totalProfit)} (${profitMargin}%) | ${m.txCount} trx | Avg ${rp(m.avgOrderValue)}/order | ${growthStr}\n`;
  });

  text += `\n**🏆 Highlight:**\n`;
  text += `• Bulan terbaik: **${bestMonth.month}** — ${rp(bestMonth.totalSales)}\n`;
  text += `• Bulan terendah: **${worstMonth.month}** — ${rp(worstMonth.totalSales)}\n`;
  text += `• Rata-rata penjualan/bulan: **${rp(r2(totalSales / trend.length))}**\n`;
  text += `• Rata-rata profit/bulan: **${rp(r2(totalProfit / trend.length))}**\n`;
  text += `• Total transaksi: **${totalTx}**\n\n`;

  // Trend direction
  const latest = trend[0];
  const prev = trend[1];
  if (latest.salesGrowthPct !== null) {
    text += `**📉 Arah Tren:**\n`;
    if (latest.salesGrowthPct > 5) {
      text += `📈 Tren **NAIK** (+${latest.salesGrowthPct}% vs bulan lalu). Pertumbuhan positif!\n`;
    } else if (latest.salesGrowthPct < -5) {
      text += `📉 Tren **TURUN** (${latest.salesGrowthPct}% vs bulan lalu). Perlu evaluasi strategi penjualan.\n`;
    } else {
      text += `📊 Tren **STABIL** (${latest.salesGrowthPct}% vs bulan lalu).\n`;
    }
    text += `\n`;
  }

  text += `**💡 Rekomendasi:**\n`;
  if (latest.salesGrowthPct !== null && latest.salesGrowthPct < -5) {
    text += `• ⚠️ Penjualan menurun bulan ini. Pertimbangkan promosi atau follow-up aktif ke pelanggan.\n`;
    text += `• 📋 Analisa produk mana yang turun dan tingkatkan upaya penjualan.\n`;
  } else {
    text += `• ✅ Pertahankan momentum penjualan saat ini.\n`;
  }
  if (positiveMonths >= 3) {
    text += `• 🎉 Tren pertumbuhan konsisten dalam 3 bulan terakhir. Pertahankan!\n`;
  }

  return text;
}

// =====================================================================
// D. CUSTOMER PREDICTION
// =====================================================================

function handleCustomerPrediction(data: any): string {
  if (!data?.customerPatterns || data.customerPatterns.length === 0) {
    return '⚠️ Data pola pelanggan tidak tersedia.';
  }
  const patterns = data.customerPatterns;
  const now = new Date();

  // Sort: overdue first, then by days since last order
  const sorted = [...patterns].sort((a: any, b: any) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return (a.daysSinceLastOrder || 999) - (b.daysSinceLastOrder || 999);
  });

  const overdueCount = sorted.filter((c: any) => c.isOverdue).length;

  let text = `🔮 **Prediksi Pelanggan**\n\n`;
  text += `📅 Analisis per ${format(now, 'dd MMMM yyyy', { locale: id })}\n`;
  text += `📋 ${sorted.length} pelanggan aktif dianalisis\n`;

  if (overdueCount > 0) {
    text += `⚠️ **${overdueCount} pelanggan overdue** — kemungkinan besar akan order segera!\n\n`;
  }

  text += `**🔴 Perlu Dihubungi Segera:**\n`;
  let shownUrgent = 0;
  for (const c of sorted) {
    if (!c.isOverdue || shownUrgent >= 8) continue;
    const nextDate = c.predictedNextOrder
      ? format(new Date(c.predictedNextOrder), 'dd MMM yyyy', { locale: id })
      : 'N/A';
    const products = c.typicalProducts?.length > 0
      ? c.typicalProducts.map((tp: any) => `${tp.productName}`).join(', ')
      : '-';
    text += `\n🔔 **${c.customerName}** — ${c.daysSinceLastOrder} hari sejak order terakhir\n`;
    text += `   Order rata-rata setiap ${c.avgDaysBetweenOrders} hari | Total: ${c.totalOrders} order (${rp(c.totalSpent)})\n`;
    text += `   Produk biasa: ${products}\n`;
    text += `   📅 Prediksi order: **${nextDate}**\n`;
    shownUrgent++;
  }

  if (shownUrgent === 0) {
    text += `\n✅ Tidak ada pelanggan overdue saat ini.\n`;
  }

  text += `\n**📊 Pelanggan Aktif Lainnya:**\n`;
  let shownOther = 0;
  for (const c of sorted) {
    if (c.isOverdue || shownOther >= 5) continue;
    const nextDate = c.predictedNextOrder
      ? format(new Date(c.predictedNextOrder), 'dd MMM yyyy', { locale: id })
      : 'N/A';
    text += `• **${c.customerName}** — ${c.daysSinceLastOrder} hari sejak order terakhir | Prediksi: ${nextDate}\n`;
    shownOther++;
  }

  text += `\n**💡 Rekomendasi:**\n`;
  if (overdueCount > 0) {
    text += `• 📞 Hubungi ${overdueCount} pelanggan overdue untuk menawarkan produk mereka.\n`;
  }
  text += `• 📋 Siapkan stok untuk produk yang biasa dipesan pelanggan yang akan order.\n`;

  return text;
}

// =====================================================================
// E. CASH FLOW AUDIT
// =====================================================================

function handleCashFlowAudit(data: any): string {
  if (!data) {
    return '⚠️ Data arus kas tidak tersedia.';
  }
  const now = new Date();

  let text = `🔍 **Audit Arus Kas**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  // Cash Flow Summary
  if (data.cashFlowSummary) {
    const cf = data.cashFlowSummary;
    text += `**📊 Arus Kas 7 Hari Terakhir:**\n`;
    text += `• 💵 Uang masuk: **${rp(cf.last7Days.inflow)}**\n`;
    text += `• 💸 Uang keluar: **${rp(cf.last7Days.outflow)}**\n`;
    text += `• 📈 Bersih: **${rp(cf.last7Days.net)}** ${cf.last7Days.net >= 0 ? '✅' : '🔴'}\n\n`;

    text += `**📊 Arus Kas 30 Hari Terakhir:**\n`;
    text += `• 💵 Uang masuk: **${rp(cf.last30Days.inflow)}**\n`;
    text += `• 💸 Uang keluar: **${rp(cf.last30Days.outflow)}**\n`;
    text += `• 📈 Bersih: **${rp(cf.last30Days.net)}** ${cf.last30Days.net >= 0 ? '✅' : '🔴'}\n\n`;

    // Cash flow health
    const avgDailyNet = cf.last30Days.net / 30;
    text += `**🏥 Cash Flow Health:**\n`;
    text += `• Rata-rata bersih/hari (30 hari): **${rp(r2(avgDailyNet))}** ${avgDailyNet >= 0 ? '✅ Positif' : '⚠️ Negatif'}\n`;
    if (avgDailyNet < 0) {
      text += `• ⚠️ Arus kas 30 hari NEGATIF. Perlu evaluasi pengeluaran dan percepat penagihan.\n`;
    }
    text += `\n`;
  }

  // Account Balances
  if (data.accountBalances) {
    const ab = data.accountBalances;
    text += `**🏦 Saldo Rekening:**\n`;
    if (ab.bankAccounts?.length > 0) {
      ab.bankAccounts.filter((b: any) => b.isActive).forEach((b: any) => {
        text += `• Bank ${b.bankName} (${b.name}): **${rp(b.balance)}**\n`;
      });
    }
    if (ab.cashBoxes?.length > 0) {
      ab.cashBoxes.filter((cb: any) => cb.isActive).forEach((cb: any) => {
        const unit = cb.unit?.name || '';
        text += `• Brankas ${cb.name}${unit ? ` [${unit}]` : ''}: **${rp(cb.balance)}**\n`;
      });
    }
    text += `• 💰 Total saldo: **${rp(ab.totalBalance)}**\n\n`;
  }

  // Discrepancies
  if (data.discrepancies) {
    const d = data.discrepancies;
    text += `**🔎 Deteksi Masalah:**\n`;

    if (d.inconsistencyCount > 0) {
      text += `⚠️ **${d.inconsistencyCount} inkonsistensi data** (total ≠ paid + remaining):\n`;
      (d.dataInconsistencies || []).slice(0, 5).forEach((inc: any) => {
        text += `   • ${inc.invoiceNo}: selisih ${rp(Math.abs(inc.discrepancy))}\n`;
      });
      text += `\n`;
    }

    if (d.paymentMismatchCount > 0) {
      text += `⚠️ **${d.paymentMismatchCount} payment mismatch** (paid_amount ≠ sum payments):\n`;
      (d.paymentMismatches || []).slice(0, 5).forEach((pm: any) => {
        text += `   • ${pm.invoiceNo}: selisih ${rp(Math.abs(pm.discrepancy))}\n`;
      });
      text += `\n`;
    }

    if (d.inconsistencyCount === 0 && d.paymentMismatchCount === 0) {
      text += `✅ Tidak ditemukan inkonsistensi data atau payment mismatch.\n\n`;
    }
  }

  text += `**💡 Rekomendasi:**\n`;
  if (data.cashFlowSummary?.last30Days.net < 0) {
    text += `• 🔴 Arus kas 30 hari negatif. Tindakan: percepat penagihan piutang, tunda pengeluaran non-esensial.\n`;
  }
  if (data.discrepancies?.inconsistencyCount > 0 || data.discrepancies?.paymentMismatchCount > 0) {
    text += `• 🔎 Investigasi data inkonsisten segera untuk mencegah kesalahan akuntansi.\n`;
  }
  text += `• 📋 Rutin monitor arus kas setiap minggu untuk deteksi dini masalah.\n`;

  return text;
}

// =====================================================================
// F. FINANCIAL HEALTH CHECK
// =====================================================================

function handleFinancialHealth(data: any): string {
  if (!data) {
    return '⚠️ Data kesehatan keuangan tidak tersedia.';
  }
  const now = new Date();

  // --- Calculate scores ---
  let liquidityScore = 50;
  let profitabilityScore = 50;
  let solvencyScore = 50;
  let efficiencyScore = 50;
  let growthScore = 50;

  // 1. Liquidity (0-100) — based on account balances vs receivables
  if (data.accountBalances && data.cashPools) {
    const totalBalance = data.accountBalances.totalBalance || 0;
    const totalReceivables = data.cashPools.totalReceivables || 0;
    const totalMonthlyBurn = (data.cashFlowSummary?.last30Days?.outflow || 0);
    const monthsRunway = totalMonthlyBurn > 0 ? totalBalance / totalMonthlyBurn : 99;

    if (monthsRunway >= 3) liquidityScore = 90;
    else if (monthsRunway >= 2) liquidityScore = 75;
    else if (monthsRunway >= 1) liquidityScore = 55;
    else liquidityScore = 30;

    // Penalty if receivables ratio too high
    const totalSales = data.cashPools.totalSales || 1;
    const receivableRatio = totalReceivables / totalSales;
    if (receivableRatio > 0.5) liquidityScore = Math.min(liquidityScore, 40);
    else if (receivableRatio > 0.3) liquidityScore = Math.min(liquidityScore, 60);
  }

  // 2. Profitability (0-100) — based on profit margins
  if (data.cashPools) {
    const totalSales = data.cashPools.totalSales || 1;
    const totalProfit = data.cashPools.totalProfit || 0;
    const margin = (totalProfit / totalSales) * 100;

    if (margin >= 20) profitabilityScore = 90;
    else if (margin >= 15) profitabilityScore = 78;
    else if (margin >= 10) profitabilityScore = 65;
    else if (margin >= 5) profitabilityScore = 50;
    else profitabilityScore = 35;
  }

  // 3. Solvency (0-100) — based on debts vs assets
  if (data.companyDebts && data.productAssetValue) {
    const totalDebt = data.companyDebts.totalDebtRemaining || 0;
    const totalAssets = data.productAssetValue.totalAssetValue + (data.accountBalances?.totalBalance || 0);
    const debtRatio = totalAssets > 0 ? totalDebt / totalAssets : 0;

    if (debtRatio <= 0.1) solvencyScore = 90;
    else if (debtRatio <= 0.3) solvencyScore = 75;
    else if (debtRatio <= 0.5) solvencyScore = 55;
    else solvencyScore = 30;

    // Bonus for no overdue debts
    if (data.companyDebts.overdueDebtCount === 0 && data.companyDebts.totalDebtCount > 0) {
      solvencyScore = Math.min(100, solvencyScore + 10);
    }
    if (data.companyDebts.totalDebtCount === 0) {
      solvencyScore = 95;
    }
  }

  // 4. Efficiency (0-100) — based on receivables collection
  if (data.cashPools) {
    const hppInHand = data.cashPools.hppInHand || 0;
    const totalHpp = data.cashPools.hppInHand + data.cashPools.hppUnpaid || 1;
    const hppRecovery = (hppInHand / totalHpp) * 100;

    if (hppRecovery >= 85) efficiencyScore = 88;
    else if (hppRecovery >= 75) efficiencyScore = 72;
    else if (hppRecovery >= 60) efficiencyScore = 55;
    else efficiencyScore = 35;
  }

  // 5. Growth (0-100) — based on sales trend
  if (data.salesTrend && data.salesTrend.length >= 2) {
    const latest = data.salesTrend[0];
    const prev = data.salesTrend[1];
    if (latest.salesGrowthPct !== null) {
      if (latest.salesGrowthPct >= 15) growthScore = 90;
      else if (latest.salesGrowthPct >= 5) growthScore = 75;
      else if (latest.salesGrowthPct >= -5) growthScore = 60;
      else if (latest.salesGrowthPct >= -15) growthScore = 40;
      else growthScore = 25;
    }
  }

  const overallScore = r2((liquidityScore + profitabilityScore + solvencyScore + efficiencyScore + growthScore) / 5);

  let text = `🏥 **Cek Kesehatan Keuangan Razkindo**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;
  text += `**Skor Keseluruhan: ${overallScore}/100 ${scoreColor(overallScore)} ${scoreLabel(overallScore)}**\n\n`;

  text += `| Kategori | Skor | Status |\n|----------|------|--------|\n`;
  text += `| 💧 Likuiditas | ${liquidityScore}/100 | ${scoreColor(liquidityScore)} ${scoreLabel(liquidityScore)} |\n`;
  text += `| 📈 Profitabilitas | ${profitabilityScore}/100 | ${scoreColor(profitabilityScore)} ${scoreLabel(profitabilityScore)} |\n`;
  text += `| 🏦 Solvabilitas | ${solvencyScore}/100 | ${scoreColor(solvencyScore)} ${scoreLabel(solvencyScore)} |\n`;
  text += `| ⚡ Efisiensi | ${efficiencyScore}/100 | ${scoreColor(efficiencyScore)} ${scoreLabel(efficiencyScore)} |\n`;
  text += `| 📊 Pertumbuhan | ${growthScore}/100 | ${scoreColor(growthScore)} ${scoreLabel(growthScore)} |\n\n`;

  text += `**📋 Detail & Rekomendasi:**\n\n`;

  text += `**💧 Likuiditas (${liquidityScore}/100):**\n`;
  if (data.accountBalances) {
    text += `   Total saldo rekening: ${rp(data.accountBalances.totalBalance)}\n`;
  }
  if (data.cashPools) {
    text += `   Total piutang: ${rp(data.cashPools.totalReceivables)}\n`;
  }
  if (liquidityScore < 50) {
    text += `   ⚠️ Likuiditas rendah. Pastikan cukup kas untuk operasional.\n`;
  } else {
    text += `   ✅ Likuiditas dalam kondisi baik.\n`;
  }

  text += `\n**📈 Profitabilitas (${profitabilityScore}/100):**\n`;
  if (data.cashPools) {
    const margin = data.cashPools.totalSales > 0 ? r2((data.cashPools.totalProfit / data.cashPools.totalSales) * 100) : 0;
    text += `   Margin profit: ${margin}%\n`;
    text += `   Profit di tangan: ${rp(data.cashPools.profitInHand)} / ${rp(data.cashPools.totalProfit)}\n`;
  }
  if (profitabilityScore < 50) {
    text += `   ⚠️ Margin profit rendah. Evaluasi harga jual atau efisiensi biaya.\n`;
  } else {
    text += `   ✅ Profitabilitas baik.\n`;
  }

  text += `\n**🏦 Solvabilitas (${solvencyScore}/100):**\n`;
  if (data.companyDebts) {
    text += `   Total hutang: ${rp(data.companyDebts.totalDebtRemaining)} (${data.companyDebts.totalDebtCount} hutang)\n`;
    if (data.companyDebts.overdueDebtCount > 0) {
      text += `   🔴 ${data.companyDebts.overdueDebtCount} hutang overdue (${rp(data.companyDebts.totalOverdueAmount)})\n`;
    }
  }
  if (solvencyScore < 50) {
    text += `   ⚠️ Beban hutang tinggi. Prioritaskan pembayaran hutang overdue.\n`;
  } else {
    text += `   ✅ Beban hutang terkendali.\n`;
  }

  text += `\n**⚡ Efisiensi (${efficiencyScore}/100):**\n`;
  if (data.cashPools) {
    const hppRec = data.cashPools.totalHpp > 0 ? r2((data.cashPools.hppInHand / (data.cashPools.hppInHand + data.cashPools.hppUnpaid)) * 100) : 0;
    text += `   HPP Recovery Rate: ${hppRec}%\n`;
  }
  if (efficiencyScore < 50) {
    text += `   ⚠️ Efisiensi penagihan perlu ditingkatkan.\n`;
  } else {
    text += `   ✅ Penagihan berjalan efisien.\n`;
  }

  text += `\n**📊 Pertumbuhan (${growthScore}/100):**\n`;
  if (data.salesTrend?.length > 0) {
    const latest = data.salesTrend[0];
    const g = latest.salesGrowthPct;
    text += `   Growth bulan ini: ${g !== null ? `${g >= 0 ? '+' : ''}${g}%` : 'N/A'}\n`;
  }
  if (growthScore < 50) {
    text += `   ⚠️ Tren penjualan menurun. Perlu strategi promosi atau ekspansi pasar.\n`;
  } else {
    text += `   ✅ Tren penjualan positif.\n`;
  }

  return text;
}

// =====================================================================
// G. BUSINESS ANALYSIS
// =====================================================================

async function handleBusinessAnalysis(): Promise<string> {
  const now = new Date();
  let text = `🏢 **Analisa Bisnis Razkindo**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  try {
    // 1. Total revenue, profit, costs
    const { data: salesData } = await db.from('transactions')
      .select('total, total_profit, total_hpp, type, status')
      .in('type', ['sale', 'expense', 'salary', 'purchase'])
      .in('status', ['approved', 'paid']);

    const sales = (salesData || []).filter((t: any) => t.type === 'sale');
    const expenses = (salesData || []).filter((t: any) => t.type === 'expense');
    const salaries = (salesData || []).filter((t: any) => t.type === 'salary');
    const purchases = (salesData || []).filter((t: any) => t.type === 'purchase');

    const totalRevenue = sales.reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalProfit = sales.reduce((s: number, t: any) => s + (t.total_profit || 0), 0);
    const totalHpp = sales.reduce((s: number, t: any) => s + (t.total_hpp || 0), 0);
    const totalExpense = expenses.reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalSalary = salaries.reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalPurchase = purchases.reduce((s: number, t: any) => s + (t.total || 0), 0);
    const totalTransactions = sales.length;

    const profitMargin = totalRevenue > 0 ? r2((totalProfit / totalRevenue) * 100) : 0;
    const avgTransaction = totalTransactions > 0 ? r2(totalRevenue / totalTransactions) : 0;

    text += `**💰 Ringkasan Keuangan:**\n`;
    text += `• Total Revenue (Penjualan): **${rp(totalRevenue)}**\n`;
    text += `• Total HPP (Biaya Produk): **${rp(totalHpp)}**\n`;
    text += `• Total Profit: **${rp(totalProfit)}** (Margin: **${profitMargin}%**)\n`;
    text += `• Total Pengeluaran: **${rp(totalExpense)}**\n`;
    text += `• Total Gaji: **${rp(totalSalary)}**\n`;
    text += `• Total Pembelian Stok: **${rp(totalPurchase)}**\n`;
    text += `• Total Transaksi Penjualan: **${totalTransactions}**\n`;
    text += `• Rata-rata Nilai Transaksi: **${rp(avgTransaction)}**\n\n`;

    // 2. Top 5 customers
    const { data: topCustomers } = await db.from('customers')
      .select('name, total_spent, total_orders')
      .eq('status', 'active')
      .order('total_spent', { ascending: false })
      .limit(5);

    text += `**👥 Top 5 Pelanggan:**\n`;
    (topCustomers || []).forEach((c: any, i: number) => {
      text += `${i + 1}. **${c.name}** — ${rp(c.total_spent || 0)} (${c.total_orders || 0} order)\n`;
    });
    text += `\n`;

    // 3. Top 5 products by revenue
    const { data: topProducts } = await db.from('transaction_items')
      .select('product_name, subtotal, qty')
      .limit(5000);
    const productMap = new Map<string, { name: string; revenue: number; qty: number }>();
    (topProducts || []).forEach((item: any) => {
      const pName = item.product_name || 'Unknown';
      const entry = productMap.get(pName) || { name: pName, revenue: 0, qty: 0 };
      entry.revenue += (item.subtotal || 0);
      entry.qty += (item.qty || 0);
      productMap.set(pName, entry);
    });
    const topProds = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    text += `**🏆 Top 5 Produk:**\n`;
    topProds.forEach((p, i) => {
      text += `${i + 1}. **${p.name}** — ${rp(p.revenue)} (${p.qty} unit terjual)\n`;
    });
    text += `\n`;

    // 4. Net position
    const netPosition = totalProfit - totalExpense - totalSalary;
    text += `**📊 Posisi Bersih:**\n`;
    text += `• Profit - Pengeluaran - Gaji = **${rp(netPosition)}** ${netPosition >= 0 ? '✅' : '🔴'}\n\n`;

    text += `**💡 Insight:**\n`;
    if (profitMargin >= 15) {
      text += `• ✅ Margin profit ${profitMargin}% sudah bagus. Pertahankan harga dan kontrol HPP.\n`;
    } else if (profitMargin >= 8) {
      text += `• 🟡 Margin profit ${profitMargin}% cukup. Coba tingkatkan dengan negosiasi harga beli.\n`;
    } else {
      text += `• ⚠️ Margin profit ${profitMargin}% rendah. Evaluasi harga jual dan biaya operasional.\n`;
    }
    if (netPosition < 0) {
      text += `• 🔴 Posisi bersih negatif. Perlu efisiensi pengeluaran.\n`;
    }

  } catch (err) {
    console.error('[Business Analysis] Error:', err);
    text += `⚠️ Gagal memuat beberapa data analisa bisnis.\n`;
  }

  return text;
}

// =====================================================================
// H. VARIANCE ANALYSIS
// =====================================================================

function handleVarianceAnalysis(data: any): string {
  if (!data) {
    return '⚠️ Data variance tidak tersedia.';
  }
  const now = new Date();

  let text = `🔎 **Analisis Variance & Inkonsistensi Data**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  const disc = data.discrepancies;
  if (!disc) {
    return text + '⚠️ Data discrepancy tidak tersedia.';
  }

  let totalVariance = 0;

  // 1. Data Inconsistencies
  text += `**📊 Inkonsistensi Data (total ≠ paid + remaining):**\n`;
  if (disc.inconsistencyCount === 0) {
    text += `✅ Tidak ada inkonsistensi data.\n\n`;
  } else {
    text += `⚠️ Ditemukan **${disc.inconsistencyCount}** inkonsistensi:\n\n`;
    (disc.dataInconsistencies || []).forEach((inc: any) => {
      totalVariance += Math.abs(inc.discrepancy);
      text += `• **${inc.invoiceNo}**\n`;
      text += `  Total: ${rp(inc.total)} | Paid+Remaining: ${rp(inc.expectedTotal)}\n`;
      text += `  Selisih: **${rp(Math.abs(inc.discrepancy))}**\n\n`;
    });
  }

  // 2. Payment Mismatches
  text += `**💳 Payment Mismatch (paid_amount ≠ sum payments):**\n`;
  if (disc.paymentMismatchCount === 0) {
    text += `✅ Tidak ada payment mismatch.\n\n`;
  } else {
    text += `⚠️ Ditemukan **${disc.paymentMismatchCount}** mismatch:\n\n`;
    (disc.paymentMismatches || []).forEach((pm: any) => {
      totalVariance += Math.abs(pm.discrepancy);
      text += `• **${pm.invoiceNo || pm.transactionId}**\n`;
      text += `  paid_amount: ${rp(pm.transactionPaidAmount)} | Actual payments: ${rp(pm.actualPaymentSum)}\n`;
      text += `  Selisih: **${rp(Math.abs(pm.discrepancy))}**\n\n`;
    });
  }

  // Summary
  text += `---\n`;
  text += `**📋 Ringkasan:**\n`;
  text += `• Total inkonsistensi: **${disc.inconsistencyCount}** transaksi\n`;
  text += `• Total payment mismatch: **${disc.paymentMismatchCount}** transaksi\n`;
  text += `• Total variance amount: **${rp(totalVariance)}**\n\n`;

  text += `**💡 Rekomendasi:**\n`;
  if (disc.inconsistencyCount > 0) {
    text += `• 🔎 Investigasi inkonsistensi data untuk memastikan keakuratan laporan keuangan.\n`;
  }
  if (disc.paymentMismatchCount > 0) {
    text += `• 💳 Cross-check payment records dengan actual payments di bank/kas.\n`;
  }
  if (disc.inconsistencyCount === 0 && disc.paymentMismatchCount === 0) {
    text += `• ✅ Data keuangan konsisten. Pertahankan akurasi pencatatan.\n`;
  }

  return text;
}

// =====================================================================
// I. PERFORMANCE ANALYSIS
// =====================================================================

async function handlePerformanceAnalysis(): Promise<string> {
  const now = new Date();
  let text = `📊 **Analisa Performa Penjualan**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  try {
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthStart = new Date(currentYear, currentMonth, 1).toISOString();

    // Fetch all sales transactions this month with creator info
    const { data: salesThisMonth } = await db.from('transactions')
      .select(`
        total, total_profit, created_by_id,
        created_by:users!created_by_id(name, role)
      `)
      .eq('type', 'sale')
      .in('status', ['approved', 'paid'])
      .gte('transaction_date', monthStart);

    // Fetch all sales targets for current month
    const { data: targets } = await db.from('sales_targets')
      .select(`
        target_amount, achieved_amount, period, month, year,
        user:users(name, role)
      `)
      .eq('period', 'monthly')
      .eq('year', currentYear)
      .eq('month', currentMonth + 1)
      .in('status', ['active']);

    // Build sales performance per sales person
    const salesMap = new Map<string, { name: string; total: number; profit: number; count: number }>();
    (salesThisMonth || []).forEach((t: any) => {
      if (t.created_by?.role === 'sales') {
        const e = salesMap.get(t.created_by_id) || { name: t.created_by.name, total: 0, profit: 0, count: 0 };
        e.total += (t.total || 0);
        e.profit += (t.total_profit || 0);
        e.count += 1;
        salesMap.set(t.created_by_id, e);
      }
    });

    // Merge with targets
    const performanceList: Array<{
      name: string;
      total: number;
      profit: number;
      count: number;
      target: number;
      achievement: number;
    }> = [];

    salesMap.forEach((s, userId) => {
      const target = (targets || []).find((t: any) => t.user?.id === userId);
      const targetAmount = target?.target_amount || 0;
      const achieved = target?.achieved_amount || s.total;
      performanceList.push({
        ...s,
        target: targetAmount,
        achievement: targetAmount > 0 ? r2((achieved / targetAmount) * 100) : 0,
      });
    });

    // Add targets that have no sales yet
    (targets || []).forEach((t: any) => {
      if (t.user?.role === 'sales' && !salesMap.has(t.user.id)) {
        performanceList.push({
          name: t.user.name,
          total: 0,
          profit: 0,
          count: 0,
          target: t.target_amount || 0,
          achievement: 0,
        });
      }
    });

    // Sort by total sales
    performanceList.sort((a, b) => b.total - a.total);

    if (performanceList.length === 0) {
      return text + '📝 Belum ada data performa penjualan bulan ini.\n';
    }

    // Header
    const monthLabel = format(now, 'MMMM yyyy', { locale: id });
    text += `**Bulan: ${monthLabel}**\n\n`;

    // Rankings
    performanceList.forEach((p, i) => {
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const targetInfo = p.target > 0
        ? `Target: ${rp(p.target)} | Achievement: **${p.achievement}%** ${p.achievement >= 100 ? '✅' : '⏳'}`
        : 'Tanpa target';
      text += `${rank} **${p.name}**\n`;
      text += `   💰 ${rp(p.total)} | 📈 ${rp(p.profit)} | 📝 ${p.count} trx\n`;
      text += `   ${targetInfo}\n\n`;
    });

    // Top & Bottom performers
    if (performanceList.length >= 2) {
      const top = performanceList[0];
      const bottom = performanceList[performanceList.length - 1];
      text += `**🏆 Top Performer:** ${top.name} (${rp(top.total)})\n`;
      text += `**📊 Perlu Dukungan:** ${bottom.name} (${rp(bottom.total)})\n\n`;
    }

    text += `**💡 Rekomendasi:**\n`;
    const underperformers = performanceList.filter(p => p.target > 0 && p.achievement < 50);
    if (underperformers.length > 0) {
      text += `• 📋 ${underperformers.length} sales di bawah 50% target. Berikan coaching dan support.\n`;
    }
    const overachievers = performanceList.filter(p => p.target > 0 && p.achievement >= 100);
    if (overachievers.length > 0) {
      text += `• 🎉 ${overachievers.length} sales sudah mencapai target! Berikan apresiasi.\n`;
    }

  } catch (err) {
    console.error('[Performance Analysis] Error:', err);
    text += `⚠️ Gagal memuat data performa.\n`;
  }

  return text;
}

// =====================================================================
// J. SYSTEM HEALTH
// =====================================================================

async function handleSystemHealth(): Promise<string> {
  const now = new Date();
  let text = `🖥️ **Cek Kesehatan Sistem**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy HH:mm', { locale: id })}\n\n`;

  let checks = 0;
  let passed = 0;

  // 1. Database connection
  try {
    const start = Date.now();
    await db.from('users').select('id').limit(1);
    const latency = Date.now() - start;
    checks++;
    passed++;
    text += `**🗄️ Database:** ${latency < 500 ? '🟢' : '🟡'} Online (${latency}ms)\n`;
  } catch {
    checks++;
    text += `**🗄️ Database:** 🔴 Tidak dapat terhubung\n`;
  }

  // 2. Active users
  try {
    const { count: activeUsers } = await db.from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('status', 'approved');
    text += `**👥 Pengguna Aktif:** 🟢 ${activeUsers || 0} users\n`;
    checks++;
    passed++;
  } catch {
    checks++;
    text += `**👥 Pengguna Aktif:** 🔴 Gagal mengambil data\n`;
  }

  // 3. Recent activity (logs last 24h)
  try {
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const { count: recentLogs } = await db.from('logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo.toISOString());
    text += `**📋 Aktivitas (24 jam):** 🟢 ${recentLogs || 0} log entries\n`;
    checks++;
    passed++;
  } catch {
    checks++;
    text += `**📋 Aktivitas (24 jam):** 🟡 Data tidak tersedia\n`;
  }

  // 4. Overdue tasks
  try {
    const { count: overdueTasks } = await db.from('sales_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('due_date', now.toISOString());
    if (overdueTasks && overdueTasks > 0) {
      text += `**📝 Tugas Overdue:** 🟡 ${overdueTasks} tugas melewati deadline\n`;
    } else {
      text += `**📝 Tugas Overdue:** 🟢 Tidak ada tugas overdue\n`;
      passed++;
    }
    checks++;
  } catch {
    checks++;
    text += `**📝 Tugas Overdue:** 🟡 Data tidak tersedia\n`;
  }

  // 5. Unpaid receivables
  try {
    const { count: activeReceivables } = await db.from('receivables')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    text += `**💰 Piutang Aktif:** ${activeReceivables && activeReceivables > 10 ? '🟡' : '🟢'} ${activeReceivables || 0} piutang\n`;
    if (activeReceivables !== null) passed++;
    checks++;
  } catch {
    checks++;
    text += `**💰 Piutang Aktif:** 🔴 Gagal mengambil data\n`;
  }

  // 6. Low stock products
  try {
    const { data: lowStockProducts } = await db.from('products')
      .select('id')
      .eq('is_active', true)
      .gt('global_stock', 0)
      .limit(500);
    const lowCount = (lowStockProducts || []).filter((p: any) => p.global_stock <= (p.min_stock || 0)).length;
    text += `**📦 Stok Rendah:** ${lowCount > 5 ? '🟡' : '🟢'} ${lowCount} produk\n`;
    passed++;
    checks++;
  } catch {
    checks++;
    text += `**📦 Stok Rendah:** 🟡 Data tidak tersedia\n`;
  }

  text += `\n---\n`;
  const healthPct = checks > 0 ? Math.round((passed / checks) * 100) : 0;
  text += `**Skor Sistem: ${healthPct}% (${passed}/${checks} checks passed)** ${healthPct >= 80 ? '🟢' : healthPct >= 50 ? '🟡' : '🔴'}\n`;

  return text;
}

// =====================================================================
// L. COMPANY DEBT ANALYSIS
// =====================================================================

function handleDebtAnalysis(data: any): string {
  if (!data?.companyDebts) {
    return '⚠️ Data hutang perusahaan tidak tersedia.';
  }
  const cd = data.companyDebts;
  const now = new Date();

  let text = `💳 **Analisis Hutang Perusahaan**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  text += `**📊 Ringkasan:**\n`;
  text += `• Total hutang tersisa: **${rp(cd.totalDebtRemaining)}** (${cd.totalDebtCount} hutang)\n`;
  text += `• Hutang overdue: **${rp(cd.totalOverdueAmount)}** (${cd.overdueDebtCount} hutang) 🔴\n`;

  if (cd.totalDebtCount > 0) {
    const paidPortion = cd.debts.reduce((s: number, d: any) => s + (d.paidAmount || 0), 0);
    const totalOriginal = cd.debts.reduce((s: number, d: any) => s + (d.totalAmount || 0), 0);
    const paymentProgress = totalOriginal > 0 ? r2((paidPortion / totalOriginal) * 100) : 0;
    text += `• Progres pembayaran: **${paymentProgress}%**\n`;
  }
  text += `\n`;

  // Sort by urgency: overdue first, then by days until due
  const sorted = [...(cd.debts || [])].sort((a: any, b: any) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    const aDays = a.daysUntilDue !== null ? a.daysUntilDue : 999;
    const bDays = b.daysUntilDue !== null ? b.daysUntilDue : 999;
    return aDays - bDays;
  });

  // Overdue debts
  const overdueDebts = sorted.filter((d: any) => d.isOverdue);
  if (overdueDebts.length > 0) {
    text += `**🔴 Hutang Overdue (Prioritas Tinggi):**\n`;
    overdueDebts.forEach((d: any, i: number) => {
      text += `${i + 1}. **${d.creditorName}** — ${rp(d.remainingAmount)} / ${rp(d.totalAmount)}\n`;
      text += `   Tipe: ${d.debtType} | Terlambat: ${Math.abs(d.daysUntilDue)} hari\n\n`;
    });
  }

  // Upcoming debts
  const upcomingDebts = sorted.filter((d: any) => !d.isOverdue && d.daysUntilDue !== null && d.daysUntilDue <= 30);
  if (upcomingDebts.length > 0) {
    text += `**🟡 Hutang Jatuh Tempo (30 Hari Ke Depan):**\n`;
    upcomingDebts.forEach((d: any, i: number) => {
      text += `${i + 1}. **${d.creditorName}** — ${rp(d.remainingAmount)} / ${rp(d.totalAmount)}\n`;
      text += `   Tipe: ${d.debtType} | Jatuh tempo: ${d.daysUntilDue} hari lagi\n\n`;
    });
  }

  // Other debts
  const otherDebts = sorted.filter((d: any) => !d.isOverdue && (d.daysUntilDue === null || d.daysUntilDue > 30));
  if (otherDebts.length > 0) {
    text += `**🟢 Hutang Lainnya:**\n`;
    otherDebts.forEach((d: any, i: number) => {
      const dueInfo = d.daysUntilDue !== null ? `${d.daysUntilDue} hari lagi` : 'Tanpa tanggal jatuh tempo';
      text += `${i + 1}. **${d.creditorName}** — ${rp(d.remainingAmount)} | ${dueInfo}\n`;
    });
    text += `\n`;
  }

  text += `**💡 Rekomendasi:**\n`;
  if (cd.overdueDebtCount > 0) {
    text += `• 🔴 ${cd.overdueDebtCount} hutang overdue! Bayar segera untuk menjaga hubungan dengan kreditor.\n`;
  }
  if (upcomingDebts.length > 0) {
    text += `• 🟡 ${upcomingDebts.length} hutang akan jatuh tempo dalam 30 hari. Siapkan dana pembayaran.\n`;
    const upcomingTotal = upcomingDebts.reduce((s: number, d: any) => s + d.remainingAmount, 0);
    text += `• 💰 Siapkan minimal **${rp(upcomingTotal)}** untuk pembayaran mendatang.\n`;
  }
  if (cd.overdueDebtCount === 0 && upcomingDebts.length === 0) {
    text += `• ✅ Semua hutang dalam kondisi baik. Tidak ada yang overdue.\n`;
  }

  return text;
}

// =====================================================================
// M. ASSET VALUATION
// =====================================================================

function handleAssetValuation(data: any): string {
  if (!data?.productAssetValue) {
    return '⚠️ Data aset tidak tersedia.';
  }
  const pa = data.productAssetValue;
  const now = new Date();

  let text = `🏢 **Valuasi Aset Inventori**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  text += `**📊 Ringkasan Aset:**\n`;
  text += `• Total nilai aset (stok × HPP): **${rp(pa.totalAssetValue)}**\n`;
  text += `• Total produk: **${pa.totalProducts}**\n\n`;

  // Top products by asset value
  if (pa.topProductsByValue?.length > 0) {
    text += `**🏆 Top 10 Produk by Nilai Aset:**\n`;
    pa.topProductsByValue.slice(0, 10).forEach((p: any, i: number) => {
      text += `${i + 1}. **${p.productName}** — ${rp(p.assetValue)} (stok ${p.stock} × HPP ${rp(p.avgHpp)})\n`;
    });
    text += `\n`;
  }

  // Category breakdown
  if (pa.categoryBreakdown?.length > 0) {
    text += `**📁 Per Kategori:**\n`;
    pa.categoryBreakdown.forEach((c: any) => {
      const pct = pa.totalAssetValue > 0 ? r2((c.assetValue / pa.totalAssetValue) * 100) : 0;
      text += `• **${c.category}**: ${rp(c.assetValue)} (${pct}% dari total, ${c.productCount} produk)\n`;
    });
    text += `\n`;
  }

  // Optimization recommendations
  text += `**💡 Rekomendasi Optimasi:**\n`;

  // Find category with highest concentration
  if (pa.categoryBreakdown?.length > 1) {
    const topCat = pa.categoryBreakdown[0];
    const topPct = pa.totalAssetValue > 0 ? r2((topCat.assetValue / pa.totalAssetValue) * 100) : 0;
    if (topPct > 60) {
      text += `• ⚠️ ${topPct}% aset terkonsentrasi di kategori "${topCat.category}". Pertimbangkan diversifikasi.\n`;
    }
  }

  if (pa.topProductsByValue?.length > 0) {
    const topProduct = pa.topProductsByValue[0];
    const topPct = pa.totalAssetValue > 0 ? r2((topProduct.assetValue / pa.totalAssetValue) * 100) : 0;
    if (topPct > 30) {
      text += `• ⚠️ ${topPct}% aset tertahan di 1 produk (${topProduct.productName}). Risiko konsentrasi tinggi.\n`;
    }
  }

  if (data.accountBalances) {
    text += `• 💰 Total saldo rekening: ${rp(data.accountBalances.totalBalance)}\n`;
    const totalLiquidity = pa.totalAssetValue + data.accountBalances.totalBalance;
    text += `• 🏦 Total aset likuid (inventori + kas): **${rp(totalLiquidity)}**\n`;
  }

  return text;
}

// =====================================================================
// N. RECEIVABLES ANALYSIS
// =====================================================================

function handleReceivablesAnalysis(data: any): string {
  if (!data) {
    return '⚠️ Data piutang tidak tersedia.';
  }
  const now = new Date();

  let text = `📋 **Analisis Piutang**\n\n`;
  text += `📅 Per ${format(now, 'dd MMMM yyyy', { locale: id })}\n\n`;

  // Use receivables from snapshot
  const unpaidReceivables = data.discrepancies?.unpaidReceivables || [];
  const totalUnpaid = data.discrepancies?.totalUnpaidReceivables || 0;

  if (unpaidReceivables.length === 0) {
    return text + `✅ Semua transaksi sudah lunas! Tidak ada piutang aktif.\n`;
  }

  // Aging analysis
  const aging = {
    current: 0,       // 0-30 days
    overdue31: 0,     // 31-60 days
    overdue61: 0,     // 61-90 days
    overdue90: 0,     // 90+ days
  };
  const currentItems: any[] = [];
  const overdue31Items: any[] = [];
  const overdue61Items: any[] = [];
  const overdue90Items: any[] = [];

  unpaidReceivables.forEach((r: any) => {
    const days = r.daysOverdue || 0;
    if (days <= 0) {
      aging.current += r.remainingAmount;
      currentItems.push(r);
    } else if (days <= 30) {
      aging.current += r.remainingAmount;
      currentItems.push(r);
    } else if (days <= 60) {
      aging.overdue31 += r.remainingAmount;
      overdue31Items.push(r);
    } else if (days <= 90) {
      aging.overdue61 += r.remainingAmount;
      overdue61Items.push(r);
    } else {
      aging.overdue90 += r.remainingAmount;
      overdue90Items.push(r);
    }
  });

  text += `**📊 Aging Analysis:**\n\n`;
  text += `| Umur Piutang | Jumlah | Status |\n|-------------|--------|--------|\n`;
  text += `| 0-30 hari | ${rp(aging.current)} (${currentItems.length}) | 🟢 |\n`;
  text += `| 31-60 hari | ${rp(aging.overdue31)} (${overdue31Items.length}) | 🟡 |\n`;
  text += `| 61-90 hari | ${rp(aging.overdue61)} (${overdue61Items.length}) | 🟠 |\n`;
  text += `| 90+ hari | ${rp(aging.overdue90)} (${overdue90Items.length}) | 🔴 |\n`;
  text += `| **Total** | **${rp(totalUnpaid)}** (${unpaidReceivables.length}) | **—** |\n\n`;

  // Overdue receivables detail
  const overdueItems = [...overdue31Items, ...overdue61Items, ...overdue90Items];
  if (overdueItems.length > 0) {
    text += `**🔴 Piutang Overdue (${overdueItems.length} transaksi):**\n`;
    overdueItems.sort((a: any, b: any) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    overdueItems.slice(0, 10).forEach((r: any, i: number) => {
      text += `${i + 1}. **${r.customerName || '-'}** — ${rp(r.remainingAmount)} | ${r.daysOverdue || 0} hari overdue\n`;
    });
    text += `\n`;
  }

  text += `**💡 Rekomendasi:**\n`;
  if (aging.overdue90 > 0) {
    text += `• 🔴 **${rp(aging.overdue90)}** piutang >90 hari. Pertimbangkan penanganan khusus atau bad debt.\n`;
  }
  if (aging.overdue61 > 0) {
    text += `• 🟠 **${rp(aging.overdue61)}** piutang 61-90 hari. Intensifkan penagihan.\n`;
  }
  if (aging.overdue31 > 0) {
    text += `• 🟡 **${rp(aging.overdue31)}** piutang 31-60 hari. Follow-up penagihan rutin.\n`;
  }
  text += `• 📋 Prioritaskan penagihan piutang tertua terlebih dahulu.\n`;

  return text;
}

// =====================================================================
// O. COMPREHENSIVE REPORT
// =====================================================================

function handleComprehensiveReport(data: any): string {
  const now = new Date();
  let text = `📊 **Laporan Keuangan Komprehensif Razkindo**\n\n`;
  text += `📅 Per ${format(now, 'EEEE, dd MMMM yyyy', { locale: id })}\n`;
  text += `🕐 Dibuat otomatis oleh Sistem Analisis Keuangan\n\n`;
  text += `================================================\n\n`;

  // Financial Health Summary
  text += `**1. 🏥 SKOR KESEHATAN KEUANGAN**\n\n`;

  let liquidityScore = 50;
  let profitabilityScore = 50;
  let solvencyScore = 50;
  let efficiencyScore = 50;
  let growthScore = 50;

  if (data.accountBalances && data.cashPools) {
    const totalBalance = data.accountBalances.totalBalance || 0;
    const totalMonthlyBurn = (data.cashFlowSummary?.last30Days?.outflow || 0);
    const monthsRunway = totalMonthlyBurn > 0 ? totalBalance / totalMonthlyBurn : 99;
    liquidityScore = monthsRunway >= 3 ? 90 : monthsRunway >= 2 ? 75 : monthsRunway >= 1 ? 55 : 30;
  }
  if (data.cashPools) {
    const margin = data.cashPools.totalSales > 0 ? (data.cashPools.totalProfit / data.cashPools.totalSales) * 100 : 0;
    profitabilityScore = margin >= 20 ? 90 : margin >= 15 ? 78 : margin >= 10 ? 65 : margin >= 5 ? 50 : 35;
  }
  if (data.companyDebts && data.productAssetValue) {
    const totalDebt = data.companyDebts.totalDebtRemaining || 0;
    const totalAssets = data.productAssetValue.totalAssetValue + (data.accountBalances?.totalBalance || 0);
    const debtRatio = totalAssets > 0 ? totalDebt / totalAssets : 0;
    solvencyScore = debtRatio <= 0.1 ? 90 : debtRatio <= 0.3 ? 75 : debtRatio <= 0.5 ? 55 : 30;
    if (data.companyDebts.overdueDebtCount === 0) solvencyScore = Math.min(100, solvencyScore + 5);
  }
  if (data.cashPools) {
    const totalHpp = data.cashPools.hppInHand + data.cashPools.hppUnpaid || 1;
    const hppRec = (data.cashPools.hppInHand / totalHpp) * 100;
    efficiencyScore = hppRec >= 85 ? 88 : hppRec >= 75 ? 72 : hppRec >= 60 ? 55 : 35;
  }
  if (data.salesTrend?.length >= 2) {
    const g = data.salesTrend[0].salesGrowthPct;
    growthScore = g !== null ? (g >= 15 ? 90 : g >= 5 ? 75 : g >= -5 ? 60 : g >= -15 ? 40 : 25) : 50;
  }

  const overallScore = r2((liquidityScore + profitabilityScore + solvencyScore + efficiencyScore + growthScore) / 5);

  text += `**Skor Keseluruhan: ${overallScore}/100 ${scoreColor(overallScore)} ${scoreLabel(overallScore)}**\n\n`;
  text += `| Kategori | Skor | Status |\n|----------|------|--------|\n`;
  text += `| 💧 Likuiditas | ${liquidityScore}/100 | ${scoreColor(liquidityScore)} |\n`;
  text += `| 📈 Profitabilitas | ${profitabilityScore}/100 | ${scoreColor(profitabilityScore)} |\n`;
  text += `| 🏦 Solvabilitas | ${solvencyScore}/100 | ${scoreColor(solvencyScore)} |\n`;
  text += `| ⚡ Efisiensi | ${efficiencyScore}/100 | ${scoreColor(efficiencyScore)} |\n`;
  text += `| 📊 Pertumbuhan | ${growthScore}/100 | ${scoreColor(growthScore)} |\n\n`;

  // HPP & Profit
  text += `**2. 💰 HPP & PROFIT**\n\n`;
  if (data.cashPools) {
    const cp = data.cashPools;
    text += `• HPP di tangan: **${rp(cp.hppInHand)}** | Tertahan: ${rp(cp.hppUnpaid)}\n`;
    text += `• Profit di tangan: **${rp(cp.profitInHand)}** | Tertahan: ${rp(cp.profitUnpaid)}\n`;
    text += `• Total penjualan: **${rp(cp.totalSales)}** (${cp.totalTransactions} transaksi)\n`;
    text += `• Total piutang: **${rp(cp.totalReceivables)}**\n\n`;
  }

  // Cash Flow
  text += `**3. 📊 ARUS KAS**\n\n`;
  if (data.cashFlowSummary) {
    const cf = data.cashFlowSummary;
    text += `• 7 hari: Masuk ${rp(cf.last7Days.inflow)} | Keluar ${rp(cf.last7Days.outflow)} | Bersih ${rp(cf.last7Days.net)} ${cf.last7Days.net >= 0 ? '✅' : '🔴'}\n`;
    text += `• 30 hari: Masuk ${rp(cf.last30Days.inflow)} | Keluar ${rp(cf.last30Days.outflow)} | Bersih ${rp(cf.last30Days.net)} ${cf.last30Days.net >= 0 ? '✅' : '🔴'}\n`;
    if (data.accountBalances) {
      text += `• Total saldo: **${rp(data.accountBalances.totalBalance)}**\n`;
    }
    text += `\n`;
  }

  // Debts
  text += `**4. 💳 HUTANG PERUSAHAAN**\n\n`;
  if (data.companyDebts) {
    const cd = data.companyDebts;
    text += `• Total hutang: **${rp(cd.totalDebtRemaining)}** (${cd.totalDebtCount} hutang)\n`;
    text += `• Overdue: **${rp(cd.totalOverdueAmount)}** (${cd.overdueDebtCount} hutang) ${cd.overdueDebtCount > 0 ? '🔴' : '✅'}\n\n`;
  }

  // Receivables
  text += `**5. 📋 PIUTANG**\n\n`;
  if (data.discrepancies) {
    text += `• Total piutang aktif: **${rp(data.discrepancies.totalUnpaidReceivables)}** (${data.discrepancies.unpaidCount} transaksi)\n\n`;
  }

  // Sales Trend
  text += `**6. 📈 TREN PENJUALAN**\n\n`;
  if (data.salesTrend?.length > 0) {
    data.salesTrend.forEach((m: any) => {
      const g = m.salesGrowthPct !== null ? `(${m.salesGrowthPct >= 0 ? '▲' : '▼'}${Math.abs(m.salesGrowthPct)}%)` : '';
      text += `• **${m.month}**: ${rp(m.totalSales)} | Profit ${rp(m.totalProfit)} | ${m.txCount} trx ${g}\n`;
    });
    text += `\n`;
  }

  // Data Issues
  text += `**7. 🔎 KONSISTENSI DATA**\n\n`;
  if (data.discrepancies) {
    const d = data.discrepancies;
    text += `• Inkonsistensi data: ${d.inconsistencyCount > 0 ? `⚠️ ${d.inconsistencyCount} ditemukan` : '✅ Tidak ada'}\n`;
    text += `• Payment mismatch: ${d.paymentMismatchCount > 0 ? `⚠️ ${d.paymentMismatchCount} ditemukan` : '✅ Tidak ada'}\n\n`;
  }

  // Action Items
  text += `================================================\n\n`;
  text += `**🎯 ACTION ITEMS (Prioritas):**\n\n`;

  let actionCount = 0;
  if (data.companyDebts?.overdueDebtCount > 0) {
    text += `${++actionCount}. 🔴 Bayar ${data.companyDebts.overdueDebtCount} hutang overdue (${rp(data.companyDebts.totalOverdueAmount)})\n`;
  }
  if (data.cashFlowSummary?.last30Days?.net < 0) {
    text += `${++actionCount}. 🔴 Evaluasi pengeluaran — arus kas 30 hari negatif (${rp(data.cashFlowSummary.last30Days.net)})\n`;
  }
  if (data.cashPools) {
    const hppRec = (data.cashPools.hppInHand / (data.cashPools.hppInHand + data.cashPools.hppUnpaid || 1)) * 100;
    if (hppRec < 75) {
      text += `${++actionCount}. 🟡 Percepat penagihan piutang — HPP Recovery Rate ${r2(hppRec)}%\n`;
    }
  }
  if (data.discrepancies?.inconsistencyCount > 0) {
    text += `${++actionCount}. 🟡 Investigasi ${data.discrepancies.inconsistencyCount} inkonsistensi data\n`;
  }
  if (data.purchaseRecommendations?.length > 0) {
    const totalCost = data.purchaseRecommendations.reduce((s: number, r: any) => s + r.estimatedCost, 0);
    const urgent = data.purchaseRecommendations.filter((r: any) => r.daysOfStock <= 5).length;
    if (urgent > 0) {
      text += `${++actionCount}. 🔴 Restock ${urgent} produk urgent (est. ${rp(totalCost)})\n`;
    }
  }
  if (actionCount === 0) {
    text += `✅ Tidak ada action item mendesak. Kondisi keuangan baik!\n`;
  }

  text += `\n================================================\n`;
  text += `_Laporan ini dihasilkan otomatis dan bersifat informatif._\n`;

  return text;
}

// =====================================================================
// FALLBACK: GENERAL CHAT
// =====================================================================

function handleGeneralChat(): string {
  let text = `👋 **Halo! Saya Asisten Keuangan Razkindo**\n\n`;
  text += `Saya siap membantu analisis keuangan bisnis Anda. Berikut perintah yang tersedia:\n\n`;

  text += `**📊 Data Penjualan:**\n`;
  text += `• "penjualan hari ini" — Lihat penjualan hari ini\n`;
  text += `• "penjualan minggu ini" — Lihat penjualan minggu ini\n`;
  text += `• "penjualan bulan ini" — Lihat penjualan bulan ini\n`;
  text += `• "penjualan per sales" — Lihat performa per sales\n\n`;

  text += `**📦 Inventori:**\n`;
  text += `• "cek stok" — Lihat semua stok produk\n`;
  text += `• "stok rendah" — Lihat produk stok menipis\n`;
  text += `• "saran beli" — Rekomendasi restock\n\n`;

  text += `**👥 Pelanggan:**\n`;
  text += `• "piutang" — Lihat piutang aktif\n`;
  text += `• "konsumen" — Ringkasan pelanggan\n`;
  text += `• "prediksi pelanggan" — Prediksi order berikutnya\n\n`;

  text += `**💰 Analisis Keuangan:**\n`;
  text += `• "hpp" — Analisis HPP & Profit\n`;
  text += `• "arus kas" / "cash flow" — Audit arus kas\n`;
  text += `• "kesehatan keuangan" — Cek kesehatan keuangan\n`;
  text += `• "hutang" — Analisis hutang perusahaan\n`;
  text += `• "aset" — Valuasi aset inventori\n`;
  text += `• "variance" — Cek inkonsistensi data\n\n`;

  text += `**📈 Analisis Bisnis:**\n`;
  text += `• "analisa bisnis" — Overview bisnis\n`;
  text += `• "tren penjualan" — Analisis tren\n`;
  text += `• "performa" — Performa sales\n`;
  text += `• "laporan keuangan" — Laporan komprehensif\n\n`;

  text += `**🛠️ Lainnya:**\n`;
  text += `• "cek sistem" — Kesehatan sistem\n`;
  text += `• "kontrak kerja" — Buat kontrak kerja\n`;
  text += `• "penawaran" — Buat quotation\n`;
  text += `• "mou" — Buat MOU\n\n`;

  text += `Ketik perintah di atas untuk memulai analisis! 🚀`;

  return text;
}

// =====================================================================
// NATIVE ANALYZE — Main analysis router (replaces askLLM)
// =====================================================================

async function nativeAnalyze(
  message: string,
  authHeader: string | null,
  origin: string,
): Promise<{ reply: string; isFinancial: boolean }> {
  const analysisType = detectAnalysisType(message);

  // For snapshot-dependent analyses, fetch data
  const snapshotTypes: AnalysisType[] = [
    'hpp_profit', 'restock', 'sales_trend', 'customer_prediction',
    'cash_flow_audit', 'financial_health', 'debt_analysis',
    'asset_valuation', 'receivables_analysis', 'comprehensive_report',
    'variance_analysis',
  ];

  let snapshotData: any = null;
  if (snapshotTypes.includes(analysisType)) {
    snapshotData = await fetchFinancialSnapshot(authHeader, origin);
    if (!snapshotData) {
      return {
        reply: '⚠️ Gagal mengambil data keuangan. Pastikan Anda memiliki akses Super Admin dan coba lagi.',
        isFinancial: true,
      };
    }
  }

  let reply: string;

  switch (analysisType) {
    case 'hpp_profit':
      reply = handleHPPProfit(snapshotData);
      break;
    case 'restock':
      reply = handleRestock(snapshotData);
      break;
    case 'sales_trend':
      reply = handleSalesTrend(snapshotData);
      break;
    case 'customer_prediction':
      reply = handleCustomerPrediction(snapshotData);
      break;
    case 'cash_flow_audit':
      reply = handleCashFlowAudit(snapshotData);
      break;
    case 'financial_health':
      reply = handleFinancialHealth(snapshotData);
      break;
    case 'business_analysis':
      reply = await handleBusinessAnalysis();
      break;
    case 'variance_analysis':
      reply = handleVarianceAnalysis(snapshotData);
      break;
    case 'performance_analysis':
      reply = await handlePerformanceAnalysis();
      break;
    case 'system_health':
      reply = await handleSystemHealth();
      break;
    case 'debt_analysis':
      reply = handleDebtAnalysis(snapshotData);
      break;
    case 'asset_valuation':
      reply = handleAssetValuation(snapshotData);
      break;
    case 'receivables_analysis':
      reply = handleReceivablesAnalysis(snapshotData);
      break;
    case 'comprehensive_report':
      reply = handleComprehensiveReport(snapshotData);
      break;
    default:
      reply = handleGeneralChat();
      return { reply, isFinancial: false };
  }

  return { reply, isFinancial: true };
}

// =====================================================================
// INTENT DETECTION (Enhanced)
// =====================================================================

/**
 * Detect if a message is a financial analysis request that needs the full snapshot data.
 */
function isFinancialAnalysis(msg: string): boolean {
  const q = msg.toLowerCase();

  // HPP & Profit analysis
  if (q.match(/hpp|harga\s*pokok|biaya\s*produksi/)) return true;
  if (q.match(/profit\s*(di\s*tangan|terkumpul|sudah|yang)|laba\s*(di\s*tangan|terkumpul)/)) return true;
  if (q.match(/uang\s*(yang|sudah)\s*(di\s*tangan|terkumpul|tersedia)/)) return true;
  if (q.match(/margin\s*(keuntungan|profit)/)) return true;

  // Restock & Purchase suggestions
  if (q.match(/saran\s*(beli|restock|pengadaan)/)) return true;
  if (q.match(/rekomendasi\s*(beli|restock|stok|pengadaan)/)) return true;
  if (q.match(/apa\s*(yang|saja)\s*(harus|perlu|sebaiknya)\s*di\s*(beli|restock|adakan)/)) return true;
  if (q.match(/what\s*(to|should)\s*buy/)) return true;
  if (q.match(/stok.*(kurang|habis|menipis|perlu)/)) return true;

  // Sales pattern analysis
  if (q.match(/pattern|pola\s*(penjualan|beli)/)) return true;
  if (q.match(/tren\s*(penjualan|sales|omset)/)) return true;
  if (q.match(/analisa\s*(penjualan|keuangan|bisnis|financial|sales)/)) return true;
  if (q.match(/analisis\s*(penjualan|keuangan|bisnis|financial|sales)/)) return true;
  if (q.match(/growth|pertumbuhan/)) return true;
  if (q.match(/penjualan.*(per\s*(bulan|2\s*bulan|3\s*bulan|minggu|kuartal))/)) return true;

  // Customer prediction
  if (q.match(/prediksi|predict|forecast/)) return true;
  if (q.match(/kemungkinan.*(konsumen|customer|pelanggan).*(beli|order|pesan)/)) return true;
  if (q.match(/konsumen\s*(mana|yang).*(akan\s*beli|bakal|next)/)) return true;
  if (q.match(/customer.*(next|akan|will)/)) return true;

  // Money flow & Discrepancy
  if (q.match(/uang\s*masuk|arus\s*kas|cash\s*flow/)) return true;
  if (q.match(/selisih|discrepancy|ketidaksesuaian|inkonsistensi|variance/)) return true;
  if (q.match(/audit|telusuri|investigasi|cek\s*(kecocokan|kebenaran)/)) return true;
  if (q.match(/masalah\s*(keuangan|finansial|kas)/)) return true;

  // General financial health
  if (q.match(/keuangan\s*(sehat|baik|buruk|how|kondisi)/)) return true;
  if (q.match(/financial\s*(health|status|review)/)) return true;
  if (q.match(/kesehatan\s*(keuangan|bisnis|financial)/)) return true;
  if (q.match(/review\s*(keuangan|financial|bisnis)/)) return true;
  if (q.match(/laporan\s*(keuangan|financial|lengkap|komprehensif|report)/)) return true;
  if (q.match(/report\s*(keuangan|financial)/)) return true;

  // Asset & Debt
  if (q.match(/aset|asset\s*(value|nilai)/)) return true;
  if (q.match(/nilai\s*(inventori|stok)/)) return true;
  if (q.match(/hutang|debt|utang\s*perusahaan/)) return true;
  if (q.match(/piutang|receivable|tagihan/)) return true;

  // Performance
  if (q.match(/performa|kinerja/)) return true;
  if (q.match(/achievement|pencapaian/)) return true;
  if (q.match(/target\s*(vs|versus)\s*aktual/)) return true;

  // System health
  if (q.match(/kesehatan\s*sistem|system\s*health|status\s*sistem|cek\s*sistem|infrastructure/)) return true;

  // Business analysis
  if (q.match(/analisa\s*bisnis|analisis\s*bisnis|business\s*analysis|overview\s*bisnis/)) return true;

  return false;
}

function isDataQuery(msg: string, isSuperAdmin: boolean): string | null {
  const q = msg.toLowerCase().trim();
  if (!isSuperAdmin && q.match(/penjualan.*(profit|laba|untung|hpp|margin|keuntungan)/)) return 'restricted';
  if (q.match(/penjualan.*(hari|today|hari ini)/) || q.match(/omset.*(hari|today)/)) return 'sales_today';
  if (q.match(/penjualan.*(minggu|week)/)) return 'sales_week';
  if (q.match(/penjualan.*(bulan|month)/)) return 'sales_month';
  if (q.match(/penjualan.*(sales|per sales)/)) return 'sales_per_sales';
  if (q.match(/sales.*(terbaik|top|terlaris)/)) return 'sales_per_sales';
  if (q.match(/penjualan.*(profit|laba|untung)/)) return 'sales_month';
  if (q.match(/stok.*(rendah|menipis|low)/)) return 'stock_low';
  if (q.match(/stok.*(habis|kosong)/)) return null;
  if (q.match(/stok|stock/)) return 'stock_all';
  if (q.match(/belum bayar|piutang/) && q.match(/konsumen|customer|siapa/)) return 'customers_unpaid';
  if (q.match(/total piutang|jumlah piutang/)) return 'customers_unpaid';
  if (q.match(/konsumen|customer|pelanggan/) && q.match(/ringkasan|summary|jumlah/)) return 'customers_summary';
  if (q.match(/penawaran|quotation|quote/)) return 'quotation';
  if (q.match(/mou|perjanjian|kerjasama|nota kesepahaman/)) return 'mou';
  if (q.match(/kontrak\s*kerja|pkwt|perjanjian\s*kerja|contract\s*karyawan|buat\s*kontrak/)) return 'employee_contract';
  return null;
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, history } = body;

    let isSuperAdmin = false;
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (userId) {
      const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', userId).single();
      isSuperAdmin = authUser?.role === 'super_admin' && authUser?.is_active && authUser?.status === 'approved';
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Pesan wajib diisi' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');

    // 1. Check for data query intents first (quick responses)
    const dataIntent = isDataQuery(message, isSuperAdmin);
    let reply: string;
    let isQuotation = false;

    switch (dataIntent) {
      case 'restricted':
        reply = '🔒 Info HPP/profit hanya untuk Super Admin.';
        return NextResponse.json({ success: true, reply });
      case 'sales_today':
        reply = await handleSalesToday(isSuperAdmin);
        return NextResponse.json({ success: true, reply });
      case 'sales_week':
        reply = await handleSalesWeek(isSuperAdmin);
        return NextResponse.json({ success: true, reply });
      case 'sales_month':
        reply = await handleSalesMonth(isSuperAdmin);
        return NextResponse.json({ success: true, reply });
      case 'sales_per_sales':
        reply = await handleSalesPerSales(isSuperAdmin);
        return NextResponse.json({ success: true, reply });
      case 'stock_all':
        reply = await handleStockAll(isSuperAdmin);
        return NextResponse.json({ success: true, reply });
      case 'stock_low':
        reply = await handleStockLow();
        return NextResponse.json({ success: true, reply });
      case 'customers_unpaid':
        reply = await handleCustomersUnpaid();
        return NextResponse.json({ success: true, reply });
      case 'customers_summary':
        reply = await handleCustomersSummary();
        return NextResponse.json({ success: true, reply });
      case 'quotation': {
        const custName = message.replace(/.*penawaran\s+(untuk|kepada)?\s*/i, '').trim();
        reply = JSON.stringify({ action: 'open_quotation', customerName: custName || '' });
        return NextResponse.json({ success: true, reply, isQuotation: true });
      }
      case 'mou': {
        const partnerName = message.replace(/.*(mou|perjanjian|kerjasama|nota kesepahaman)\s+(dengan|untuk|kepada)?\s*/i, '').trim();
        reply = JSON.stringify({ action: 'open_mou', partnerName: partnerName || '' });
        return NextResponse.json({ success: true, reply, isMou: true });
      }
      case 'employee_contract': {
        const empName = message.replace(/.*(kontrak\s*kerja|pkwt|perjanjian\s*kerja|contract\s*karyawan|buat\s*kontrak)\s+(untuk|kepada)?\s*/i, '').trim();
        reply = JSON.stringify({ action: 'open_contract', employeeName: empName || '' });
        return NextResponse.json({ success: true, reply, isContract: true });
      }
    }

    // 2. Require auth for analysis features
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized — login untuk menggunakan AI chat' }, { status: 401 });
    }

    // 3. Check if this is a financial analysis query
    if (isSuperAdmin && isFinancialAnalysis(message)) {
      const origin = new URL(request.url).origin;
      const result = await nativeAnalyze(message, authHeader, origin);
      return NextResponse.json({
        success: true,
        reply: result.reply,
        isFinancial: result.isFinancial,
      });
    }

    // 4. For non-superadmin or non-financial messages, show general help
    const origin = new URL(request.url).origin;
    const result = await nativeAnalyze(message, authHeader, origin);
    return NextResponse.json({
      success: true,
      reply: result.reply,
      isFinancial: result.isFinancial,
    });
  } catch (error) {
    console.error('AI Chat error:', error);
    return NextResponse.json({ error: 'Gagal menganalisis data' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await verifyAuthUser(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true });
}

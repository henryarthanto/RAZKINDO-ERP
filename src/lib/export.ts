import * as XLSX from 'xlsx';
import { db } from './supabase';

interface ExportRow {
  [key: string]: string | number | boolean | null | undefined;
}

interface ExportOptions {
  format: 'csv' | 'xlsx';
  sheetName?: string;
  filename?: string;
}

/**
 * Convert data rows to CSV string
 */
function toCSV(rows: ExportRow[], headers?: string[]): string {
  if (rows.length === 0) return '';

  const keys = headers || Object.keys(rows[0]);
  const escapeCSV = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = keys.map(escapeCSV).join(',');
  const dataLines = rows.map(row => keys.map(k => escapeCSV(row[k])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * Convert data rows to Excel buffer
 */
function toXLSX(rows: ExportRow[], sheetName: string = 'Data'): ArrayBuffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Auto-size columns
  const colWidths = Object.keys(rows[0] || {}).map(key => {
    const maxLen = Math.max(
      key.length,
      ...rows.slice(0, 100).map(row => String(row[key] || '').length)
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

/**
 * Format a date value for export
 */
export function fmtDate(val: string | null | undefined): string {
  if (!val) return '-';
  try {
    return new Date(val).toLocaleDateString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return val;
  }
}

/**
 * Format currency
 */
export function fmtCurrency(val: number | null | undefined): string {
  if (val === null || val === undefined) return '0';
  return new Intl.NumberFormat('id-ID').format(val);
}

/**
 * Export helper — creates the file content and sets response headers
 */
export function exportToFile(rows: ExportRow[], options: ExportOptions): {
  content: string | ArrayBuffer;
  contentType: string;
  filename: string;
} {
  const timestamp = new Date().toISOString().slice(0, 10);
  const ext = options.format === 'csv' ? 'csv' : 'xlsx';
  const filename = options.filename || `export_${timestamp}.${ext}`;

  if (options.format === 'csv') {
    return {
      content: '\ufeff' + toCSV(rows), // BOM for Excel UTF-8
      contentType: 'text/csv; charset=utf-8',
      filename,
    };
  }

  return {
    content: toXLSX(rows, options.sheetName || 'Data'),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename,
  };
}

/**
 * Export transactions data
 */
export async function exportTransactions(filters: {
  startDate?: string;
  endDate?: string;
  status?: string;
  unitId?: string;
  paymentMethod?: string;
  format: 'csv' | 'xlsx';
}) {
  let query = db
    .from('transactions')
    .select('id, invoice_no, status, payment_method, total, discount, notes, customer_name, customer_phone, created_at, created_by, unit_id')
    .order('created_at', { ascending: false })
    .limit(10000);

  if (filters.startDate) query = query.gte('created_at', filters.startDate);
  if (filters.endDate) query = query.lte('created_at', filters.endDate);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.unitId) query = query.eq('unit_id', filters.unitId);
  if (filters.paymentMethod) query = query.eq('payment_method', filters.paymentMethod);

  const { data } = await query;

  const rows: ExportRow[] = (data || []).map((t: any) => ({
    'No Invoice': t.invoice_no,
    'Tanggal': fmtDate(t.created_at),
    'Pelanggan': t.customer_name || '-',
    'Telepon': t.customer_phone || '-',
    'Status': t.status,
    'Metode Pembayaran': t.payment_method,
    'Total': fmtCurrency(t.total),
    'Diskon': fmtCurrency(t.discount),
    'Catatan': t.notes || '',
  }));

  return exportToFile(rows, {
    format: filters.format,
    sheetName: 'Transaksi',
    filename: `transaksi_${new Date().toISOString().slice(0, 10)}.${filters.format}`,
  });
}

/**
 * Export customers data
 */
export async function exportCustomers(filters: {
  search?: string;
  assignedTo?: string;
  format: 'csv' | 'xlsx';
}) {
  let query = db
    .from('customers')
    .select('id, name, phone, email, address, customer_code, referral_code, assigned_to_id, cashback_balance, total_spent, order_count, created_at')
    .order('name', { ascending: true })
    .limit(10000);

  if (filters.search) query = query.ilike('name', `%${filters.search}%`);
  if (filters.assignedTo) query = query.eq('assigned_to_id', filters.assignedTo);

  const { data } = await query;

  const rows: ExportRow[] = (data || []).map((c: any) => ({
    'Kode': c.customer_code || '-',
    'Nama': c.name,
    'Telepon': c.phone || '-',
    'Email': c.email || '-',
    'Alamat': c.address || '-',
    'Kode Referral': c.referral_code || '-',
    'Cashback': fmtCurrency(c.cashback_balance),
    'Total Belanja': fmtCurrency(c.total_spent),
    'Jumlah Order': c.order_count || 0,
    'Terdaftar': fmtDate(c.created_at),
  }));

  return exportToFile(rows, {
    format: filters.format,
    sheetName: 'Pelanggan',
    filename: `pelanggan_${new Date().toISOString().slice(0, 10)}.${filters.format}`,
  });
}

/**
 * Export products data
 */
export async function exportProducts(filters: {
  search?: string;
  categoryId?: string;
  format: 'csv' | 'xlsx';
}) {
  let query = db
    .from('products')
    .select('id, name, sku, barcode, selling_price, purchase_price, global_stock, unit, category_id, stock_type, track_stock, created_at')
    .order('name', { ascending: true })
    .limit(10000);

  if (filters.search) query = query.ilike('name', `%${filters.search}%`);
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId);

  const { data } = await query;

  const rows: ExportRow[] = (data || []).map((p: any) => ({
    'Nama Produk': p.name,
    'SKU': p.sku || '-',
    'Barcode': p.barcode || '-',
    'Harga Jual': fmtCurrency(p.selling_price),
    'Harga Beli': fmtCurrency(p.purchase_price),
    'Stok': p.global_stock || 0,
    'Satuan': p.unit || '-',
    'Tipe Stok': p.stock_type || 'centralized',
    'Tracking Stok': p.track_stock ? 'Ya' : 'Tidak',
  }));

  return exportToFile(rows, {
    format: filters.format,
    sheetName: 'Produk',
    filename: `produk_${new Date().toISOString().slice(0, 10)}.${filters.format}`,
  });
}

import { format } from 'date-fns';
import { id } from 'date-fns/locale';

// Constants
export const ROLES = [
  { value: 'super_admin', label: 'Super Admin', description: 'Full akses sistem' },
  { value: 'sales', label: 'Sales', description: 'Input penjualan' },
  { value: 'kurir', label: 'Kurir', description: 'Pengiriman barang' },
  { value: 'keuangan', label: 'Keuangan Unit', description: 'Kelola keuangan unit' }
];

const TRANSACTION_TYPES = [
  { value: 'sale', label: 'Penjualan', color: 'bg-green-500' },
  { value: 'purchase', label: 'Pembelian', color: 'bg-blue-500' },
  { value: 'expense', label: 'Pengeluaran', color: 'bg-red-500' },
  { value: 'salary', label: 'Gaji', color: 'bg-purple-500' }
];

export const PAYMENT_METHODS = [
  { value: 'cash', label: '💵 Cash' },
  { value: 'piutang', label: '📋 Piutang' },
  { value: 'tempo', label: '📅 Tempo' }
];

// Transaction payment method label helper
export const getTransactionPaymentLabel = (method?: string | null): string => {
  if (method === 'cash') return 'CASH';
  if (method === 'piutang') return 'PIUTANG';
  if (method === 'tempo') return 'TEMPO';
  return method || '-';
};

// Payment record methods (how money was physically received - separate from transaction type)
export const PAYMENT_RECORD_METHODS = [
  { value: 'cash', label: '💵 Tunai' },
  { value: 'transfer', label: '🏦 Transfer Bank' },
  { value: 'giro', label: '📄 Giro' }
];

// Payment record method label helper
export const getPaymentRecordLabel = (method?: string | null): string => {
  if (method === 'cash') return '💵 Tunai';
  if (method === 'transfer') return '🏦 Transfer Bank';
  if (method === 'giro') return '📄 Giro';
  return method || '-';
};

const SALARY_SOURCES = [
  { value: 'bank', label: 'Rekening Bank' },
  { value: 'cashbox', label: 'Brankas / Kas' }
];

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

// Utility functions
export const formatCurrency = (amount: number) => {
  if (typeof amount === 'object') return 'Rp0';
  if (!Number.isFinite(amount) || Number.isNaN(amount)) return 'Rp0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
};

export const formatDate = (date: Date | string) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return format(d, 'dd MMM yyyy', { locale: id });
};

export const formatDateTime = (date: Date | string) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  return format(d, 'dd MMM yyyy HH:mm', { locale: id });
};

/**
 * Format a Date to 'YYYY-MM-DD' string using LOCAL timezone (not UTC).
 * Fixes the bug where toISOString() shifts the date at night in UTC+7.
 */
export const toLocalDateStr = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Get today's date as 'YYYY-MM-DD' in local timezone.
 */
export const todayLocal = (): string => toLocalDateStr(new Date());

/**
 * Get first day of current month as 'YYYY-MM-DD' in local timezone.
 */
export const monthStartLocal = (): string => {
  const d = new Date();
  d.setDate(1);
  return toLocalDateStr(d);
};

/**
 * Get last day of current month as 'YYYY-MM-DD' in local timezone.
 */
export const monthEndLocal = (): string => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return toLocalDateStr(d);
};

/**
 * Get Monday of the current week as 'YYYY-MM-DD' in local timezone.
 * Week starts on Monday (ISO standard).
 */
export const weekStartLocal = (): string => {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toLocalDateStr(d);
};

export const getInitials = (name: string) => {
  if (!name) return 'U';
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

export const escapeHtml = (str: string) => {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// ================================
// TERBILANG - Convert number to Indonesian words
// ================================
const _sat = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
const _bel = ['', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas', 'enam belas', 'tujuh belas', 'delapan belas', 'sembilan belas'];

// Convert a number 0-999 to Indonesian words (no trailing space)
function _terbilang3(n: number): string {
  if (n === 0) return '';
  const ratus = Math.floor(n / 100);
  const sisa = n % 100;
  const puluh = Math.floor(sisa / 10);
  const sat = sisa % 10;
  let result = '';
  if (ratus > 0) result += ratus === 1 ? 'seratus' : `${_sat[ratus]} ratus`;
  if (sisa === 0) return result;
  if (puluh === 1) {
    if (sat === 0) {
      result += (result ? ' ' : '') + 'sepuluh';
    } else {
      result += (result ? ' ' : '') + _bel[sat];
    }
  } else if (puluh > 1) {
    result += (result ? ' ' : '') + `${_sat[puluh]} puluh`;
    if (sat > 0) result += ` ${_sat[sat]}`;
  } else if (sat > 0) {
    result += (result ? ' ' : '') + _sat[sat];
  }
  return result;
}

export function terbilang(n: number): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return 'nol rupiah';
  if (n === 0) return 'nol rupiah';
  const isNegatif = n < 0;
  n = Math.abs(Math.floor(n));

  const parts: string[] = [];

  // Triliun (trillions)
  const triliun = Math.floor(n / 1_000_000_000_000);
  if (triliun > 0) {
    const w = _terbilang3(Math.min(triliun, 999));
    parts.push(w ? `${w} triliun` : 'triliun');
    n %= 1_000_000_000_000;
  }

  // Miliaran (billions)
  const miliar = Math.floor(n / 1_000_000_000);
  if (miliar > 0) {
    const w = _terbilang3(miliar);
    parts.push(w ? `${w} miliar` : 'miliar');
    n %= 1_000_000_000;
  }

  // Jutaan (millions)
  const juta = Math.floor(n / 1_000_000);
  if (juta > 0) {
    const w = _terbilang3(juta);
    parts.push(w ? `${w} juta` : 'juta');
    n %= 1_000_000;
  }

  // Ribuan (thousands) — special case: "seribu" not "satu ribu"
  const ribu = Math.floor(n / 1000);
  if (ribu > 0) {
    const sisa = n % 1000;
    const w = _terbilang3(ribu);
    const suffix = ribu === 1 ? 'seribu' : `${w} ribu`;
    if (sisa > 0) {
      parts.push(`${suffix} ${_terbilang3(sisa)}`);
    } else {
      parts.push(suffix);
    }
    n = 0;
  }

  // Ratusan (hundreds) — remaining < 1000
  if (n > 0) {
    const w = _terbilang3(n);
    if (w) parts.push(w);
  }

  const result = parts.join(' ');
  if (!result) return 'nol rupiah';
  return isNegatif ? `minus ${result}` : result;
}// Online status calculation
export const getOnlineStatus = (lastSeenAt: Date | string | null): 'online' | 'idle' | 'offline' => {
  if (!lastSeenAt) return 'offline';
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (diff <= 10000) return 'online';
  if (diff <= 30000) return 'idle';
  return 'offline';
};

// Unit conversion helpers
export const formatStock = (stockInSubUnits: number, mainUnit?: string, subUnit?: string, conversionRate?: number): string => {
  const rate = conversionRate && conversionRate > 1 ? conversionRate : 1;
  if (rate <= 1 || !subUnit) {
    return `${stockInSubUnits} ${mainUnit || 'pcs'}`;
  }
  const mainQty = Math.floor(stockInSubUnits / rate);
  const subQty = stockInSubUnits % rate;
  if (subQty === 0) return `${mainQty} ${mainUnit || 'pcs'}`;
  if (mainQty === 0) return `${subQty} ${subUnit}`;
  return `${mainQty} ${mainUnit || ''} ${subQty} ${subUnit}`;
};

// BUG FIX: Added division-by-zero protection
export const toSubUnits = (qty: number, unitType: 'main' | 'sub', conversionRate: number): number => {
  const rate = Math.max(1, conversionRate || 1);
  if (unitType === 'main') return qty * rate;
  return qty;
};

// BUG FIX: Added division-by-zero protection
export const getPricePerSubUnit = (unitType: 'main' | 'sub', pricePerMain: number, pricePerSub: number, conversionRate: number): number => {
  const rate = Math.max(1, conversionRate || 1);
  if (unitType === 'main') return rate > 0 ? pricePerMain / rate : 0;
  return pricePerSub || (rate > 0 ? pricePerMain / rate : 0);
};

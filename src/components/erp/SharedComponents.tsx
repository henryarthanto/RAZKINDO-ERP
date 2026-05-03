// Shared status badge components and helpers used across multiple modules

import { Badge } from '@/components/ui/badge';

// ================================
// PAYMENT STATUS HELPERS & BADGE
// ================================

export function getPaymentStatusLabel(status?: string | null): string {
  if (status === 'paid') return 'Lunas';
  if (status === 'partial') return 'Sebagian';
  return 'Belum Bayar';
}

export function getPaymentStatusColor(status?: string | null): string {
  if (status === 'paid') return 'bg-green-500';
  if (status === 'partial') return 'bg-purple-500';
  return 'bg-red-500';
}

export function PaymentStatusBadge({ status }: { status?: string | null }) {
  return (
    <span className={`text-white text-xs px-2 py-0.5 rounded-full ${getPaymentStatusColor(status)}`}>
      {getPaymentStatusLabel(status)}
    </span>
  );
}

// ================================
// TRANSACTION STATUS HELPERS & BADGE
// ================================

export function getTransactionStatusLabel(status?: string | null): string {
  const labels: Record<string, string> = {
    pending: 'Menunggu',
    approved: 'Disetujui',
    paid: 'Lunas',
    cancelled: 'Dibatalkan',
    processing: 'Diproses',
    shipped: 'Dikirim',
    delivered: 'Selesai',
  };
  return status ? (labels[status] || status) : '-';
}

export function TransactionStatusBadge({ status }: { status?: string | null }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-500',
    approved: 'bg-blue-500',
    paid: 'bg-green-500',
    cancelled: 'bg-red-500',
    processing: 'bg-orange-500',
    shipped: 'bg-indigo-500',
    delivered: 'bg-emerald-500',
  };
  return (
    <span className={`text-white text-xs px-2 py-0.5 rounded-full ${status ? (colors[status] || 'bg-gray-500') : 'bg-gray-500'}`}>
      {getTransactionStatusLabel(status)}
    </span>
  );
}

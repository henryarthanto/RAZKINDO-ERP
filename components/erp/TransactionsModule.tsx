'use client';

import React, { useState } from 'react';
import { Plus, Check, X, ChevronRight, Smartphone, Loader2, Pencil, Banknote, Truck, UserCheck, UserX, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { formatCurrency, formatDate, formatDateTime, getTransactionPaymentLabel } from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import { apiFetch } from '@/lib/api-client';
import { getTransactionStatusLabel } from './SharedComponents';
import { LoadingFallback } from '@/components/error-boundary';
import type { Transaction, User } from '@/types';
import { SaleForm } from './SaleForm';
import { TransactionDetail } from './TransactionDetail';
import { TransactionActions } from './TransactionActions';

// Check if transaction is a PWA order (needs price setting before approve)
function isPwaOrder(t: Transaction): boolean {
  return (t.notes || '').includes('Order dari PWA');
}

type DeliveryType = 'self' | 'courier';

// ============== PWA ORDER APPROVAL DIALOG ==============
function PWAOrderApprovalDialog({
  transaction,
  open,
  onClose,
  allProducts,
  couriers,
}: {
  transaction: Transaction;
  open: boolean;
  onClose: () => void;
  allProducts: any[];
  couriers: any[];
}) {
  const { user } = useAuthStore();
  const showHpp = user?.role === 'super_admin';
  const queryClient = useQueryClient();
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({});
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('self');
  const [selectedCourierId, setSelectedCourierId] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(transaction.paymentMethod || 'cash');

  const items = transaction.items || [];

  // Filter couriers by same unit as the transaction (check primary unit + userUnits junction)
  const txUnitId = transaction.unitId;
  const unitCouriers = couriers.filter((c: any) =>
    c.unitId === txUnitId ||
    c.unit?.id === txUnitId ||
    (c.userUnits || []).some((u: any) => u.id === txUnitId)
  );

  // Compute default prices from product selling_price (memoized)
  const defaultPrices: Record<string, string> = React.useMemo(() => {
    const initial: Record<string, string> = {};
    items.forEach((item: any) => {
      const product = allProducts.find((p: any) => p.id === item.productId);
      initial[item.id] = product?.sellingPrice ? String(product.sellingPrice) : '';
    });
    return initial;
  }, [allProducts, items]);

  // Effective prices: user overrides take precedence over defaults
  const prices: Record<string, string> = React.useMemo(() => {
    const merged = { ...defaultPrices };
    for (const [key, val] of Object.entries(priceOverrides)) {
      merged[key] = val;
    }
    return merged;
  }, [defaultPrices, priceOverrides]);

  const handlePriceChange = (itemId: string, value: string) => {
    setPriceOverrides(prev => ({ ...prev, [itemId]: value }));
  };

  // PWA Approve mutation (with courier support)
  const approveMutation = useMutation({
    mutationFn: async () => {
      const itemsWithPrice = items.map((item: any) => ({
        itemId: item.id,
        price: parseFloat(prices[item.id]) || 0,
      }));
      return apiFetch('/api/pwa-orders/approve', {
        method: 'POST',
        body: JSON.stringify({
          transactionId: transaction.id,
          items: itemsWithPrice,
          deliveryType,
          courierId: deliveryType === 'courier' ? selectedCourierId : undefined,
          paymentMethod: selectedPaymentMethod,
        }),
      });
    },
    onSuccess: (data: any) => {
      const courierInfo = data?.data?.courierName
        ? ` — Kurir: ${data.data.courierName}`
        : data?.data?.deliveryType === 'self'
          ? ' — Antar Sendiri'
          : '';
      toast.success(`Order PWA berhasil di-approve! Pesanan masuk ke daftar piutang.${courierInfo}`);
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['pwa-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['pwa-approved-unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Gagal approve order'),
  });

  // PWA Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/pwa-orders/approve', {
        method: 'POST',
        body: JSON.stringify({ transactionId: transaction.id, reject: true, rejectReason }),
      });
    },
    onSuccess: () => {
      toast.success('Order PWA ditolak');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['pwa-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setRejectDialogOpen(false);
      setRejectReason('');
      onClose();
    },
    onError: (err: any) => toast.error(err.message || 'Gagal menolak order'),
  });

  const total = items.reduce((sum: number, item: any) => {
    return sum + (parseFloat(prices[item.id]) || 0) * item.qty;
  }, 0);

  const allPricesFilled = items.every((item: any) => parseFloat(prices[item.id]) > 0);
  const canApprove = allPricesFilled && (deliveryType !== 'courier' || !!selectedCourierId);

  // Get selected courier info for commission preview
  const selectedCourier = couriers.find((c: any) => c.id === selectedCourierId);
  const customerDistance = transaction.customer?.distance || 'near';
  const previewCommission = selectedCourier
    ? (customerDistance === 'far' ? (selectedCourier.farCommission || 0) : (selectedCourier.nearCommission || 0))
    : 0;

  const handleApprove = () => {
    if (!allPricesFilled) {
      toast.error('Semua item harus memiliki harga');
      return;
    }
    if (deliveryType === 'courier' && !selectedCourierId) {
      toast.error('Pilih kurir terlebih dahulu');
      return;
    }
    approveMutation.mutate();
  };

  const paymentMethodLabel = selectedPaymentMethod === 'cash' ? 'Cash' : selectedPaymentMethod === 'transfer' ? 'Transfer' : selectedPaymentMethod === 'tempo' ? 'Tempo' : selectedPaymentMethod || '-';

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="w-[calc(100%-2rem)] sm:max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-orange-500" />
              Set Harga Order PWA
            </DialogTitle>
            <DialogDescription>
              {transaction.invoiceNo} — {transaction.customer?.name || '-'}
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 space-y-4 py-2">
            {/* Info banner */}
            <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 p-3">
              <div className="flex items-start gap-2">
                <Smartphone className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" />
                <div className="text-xs text-orange-700 dark:text-orange-300">
                  <p className="font-medium">Order dari pelanggan via PWA</p>
                  <p className="mt-1">Tentukan harga per item lalu klik &quot;Set Harga &amp; Approve&quot;. Order akan masuk piutang.</p>
                </div>
              </div>
            </div>

            {/* Customer info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground text-xs">Pelanggan</span>
                <p className="font-medium">{transaction.customer?.name || '-'}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Metode Bayar</span>
                <p className="font-medium">{paymentMethodLabel}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Tanggal</span>
                <p className="font-medium">{formatDateTime(transaction.createdAt)}</p>
              </div>
              <div>
                <span className="text-muted-foreground text-xs">Catatan</span>
                <p className="font-medium text-xs truncate">{transaction.notes?.replace(/Order dari PWA.*?—\s*/g, '').trim() || '-'}</p>
              </div>
            </div>

            <Separator />

            {/* Items with price inputs */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Banknote className="w-4 h-4" />
                Set Harga Per Item
              </Label>
              <div className="space-y-2">
                {items.map((item: any) => {
                  const product = allProducts.find((p: any) => p.id === item.productId);
                  const priceVal = parseFloat(prices[item.id]) || 0;
                  const subtotal = priceVal * item.qty;
                  const unitLabel = product?.unit || item.product?.unit || 'pcs';

                  return (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.qty} {unitLabel}
                          {showHpp && product?.avgHpp > 0 && (
                            <span className="ml-2 text-orange-600">HPP: {formatCurrency(product.avgHpp)}/{product.subUnit || 'unit'}</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground hidden sm:inline">Rp</span>
                        <Input
                          type="number"
                          min="0"
                          step="1000"
                          value={prices[item.id] || ''}
                          onChange={(e) => handlePriceChange(item.id, e.target.value)}
                          className="w-32 h-8 text-sm text-right"
                          placeholder="0"
                        />
                      </div>
                      <div className="w-28 text-right">
                        <p className={cn("text-sm font-semibold", subtotal > 0 ? "text-foreground" : "text-muted-foreground")}>
                          {formatCurrency(subtotal)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <Separator />

            {/* Total */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-primary/5 border">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-bold">{formatCurrency(total)}</span>
            </div>

            <Separator />

            {/* Payment Method Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Metode Pembayaran
              </Label>
              <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih metode pembayaran" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">💰 Cash</SelectItem>
                  <SelectItem value="transfer">🏦 Transfer Bank</SelectItem>
                  <SelectItem value="tempo">📋 Tempo (Piutang)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Delivery Assignment */}
            <div className="space-y-3">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Pengiriman
              </Label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryType('self')}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left',
                    deliveryType === 'self'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
                      : 'border-muted bg-muted/20 hover:border-muted-foreground/30'
                  )}
                >
                  <UserCheck className={cn(
                    'w-5 h-5 shrink-0',
                    deliveryType === 'self' ? 'text-emerald-600' : 'text-muted-foreground'
                  )} />
                  <div>
                    <p className={cn('text-sm font-medium', deliveryType === 'self' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                      Antar Sendiri
                    </p>
                    <p className="text-[10px] text-muted-foreground">Sales/Admin mengirim</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeliveryType('courier')}
                  className={cn(
                    'flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-left',
                    deliveryType === 'courier'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                      : 'border-muted bg-muted/20 hover:border-muted-foreground/30'
                  )}
                >
                  <UserX className={cn(
                    'w-5 h-5 shrink-0',
                    deliveryType === 'courier' ? 'text-blue-600' : 'text-muted-foreground'
                  )} />
                  <div>
                    <p className={cn('text-sm font-medium', deliveryType === 'courier' ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground')}>
                      Assign ke Kurir
                    </p>
                    <p className="text-[10px] text-muted-foreground">Kurir bertugas</p>
                  </div>
                </button>
              </div>

              {deliveryType === 'courier' && (
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Pilih Kurir</Label>
                  {unitCouriers.length === 0 ? (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Tidak ada kurir aktif di unit ini. Silakan pilih &quot;Antar Sendiri&quot; atau tambahkan kurir.
                      </p>
                    </div>
                  ) : (
                    <Select value={selectedCourierId} onValueChange={setSelectedCourierId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pilih kurir..." />
                      </SelectTrigger>
                      <SelectContent>
                        {unitCouriers.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name || c.email || 'Tanpa Nama'}{c.phone ? ` (${c.phone})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {selectedCourier && (
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50/50 dark:bg-blue-950/10 text-xs">
                      <Truck className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-muted-foreground">
                        Jarak: <span className="font-medium">{customerDistance === 'far' ? 'Jauh' : 'Dekat'}</span>
                      </span>
                      <span className="text-muted-foreground">•</span>
                      <span className="text-muted-foreground">
                        Komisi: <span className="font-medium text-blue-600">{formatCurrency(previewCommission)}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="destructive" size="sm" onClick={() => setRejectDialogOpen(true)} className="gap-1">
              <X className="w-4 h-4" />
              Tolak Order
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={!canApprove || approveMutation.isPending}
              className="gap-1 flex-1 sm:flex-none"
            >
              {approveMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {approveMutation.isPending ? 'Memproses...' : 'Set Harga & Approve'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak Order PWA</DialogTitle>
            <DialogDescription>
              {transaction.invoiceNo} — {transaction.customer?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-sm font-medium">Alasan Penolakan</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Contoh: Stok tidak tersedia..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialogOpen(false); setRejectReason(''); }}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Menolak...' : 'Tolak Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============== TRANSACTIONS MODULE ==============
export default function TransactionsModule() {
  const { user } = useAuthStore();
  const { selectedUnitId, units } = useUnitStore();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState({ status: 'all', unitId: 'all' });
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [pwaOrderForApproval, setPwaOrderForApproval] = useState<Transaction | null>(null);

  const queryUnitId = selectedUnitId || '';

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', { ...filters, unitId: queryUnitId }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('type', 'sale');
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (queryUnitId) params.set('unitId', queryUnitId);
      if (user?.role === 'sales' && user?.id) params.set('createdById', user.id);
      return apiFetch<any>(`/api/transactions?${params.toString()}`);
    },
    ...POLLING_CONFIG
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<any>('/api/products'),
    enabled: showSaleForm,
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers', user?.unitId, user?.id, queryUnitId],
    queryFn: async () => {
      const params = new URLSearchParams();
      const unitId = user?.role === 'super_admin' ? queryUnitId : user?.unitId;
      if (unitId) params.set('unitId', unitId);
      if (user?.role === 'sales' && user?.id) params.set('assignedToId', user.id);
      return apiFetch<any>(`/api/customers?${params.toString()}`);
    },
    enabled: showSaleForm,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<any>('/api/users'),
    enabled: showSaleForm,
  });

  // Fetch kurir list independently (always available for PWA approval dialog)
  const { data: couriersData } = useQuery({
    queryKey: ['users-kurir-approval'],
    queryFn: () => apiFetch<{ users: any[] }>('/api/users?role=kurir&status=approved'),
    });

  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const products = Array.isArray(productsData?.products) ? productsData.products : [];
  const customers = Array.isArray(customersData?.customers) ? customersData.customers : [];
  const allCouriers = (Array.isArray(couriersData?.users) ? couriersData.users : []).filter((u: any) =>
    u.role === 'kurir' && u.status === 'approved' && u.isActive
  );

  // Filter couriers by unit context:
  // - Super admin: filter by selectedUnitId (or show all if no unit selected)
  // - Sales: only show couriers from their own unit(s)
  const couriers = React.useMemo(() => {
    if (user?.role === 'super_admin') {
      if (!selectedUnitId) return allCouriers; // "Semua Unit" — show all
      return allCouriers.filter((c: any) =>
        c.unitId === selectedUnitId ||
        c.unit?.id === selectedUnitId ||
        (c.userUnits || []).some((u: any) => u.id === selectedUnitId)
      );
    }
    // Sales (or other non-super_admin roles)
    const userUnitIds = new Set<string>();
    if (user?.unitId) userUnitIds.add(user.unitId);
    if (user?.userUnits) user.userUnits.forEach((u: any) => { if (u?.id) userUnitIds.add(u.id); });
    if (userUnitIds.size === 0) return allCouriers;
    return allCouriers.filter((c: any) =>
      c.unitId && userUnitIds.has(c.unitId) ||
      c.unit?.id && userUnitIds.has(c.unit.id) ||
      (c.userUnits || []).some((u: any) => u?.id && userUnitIds.has(u.id))
    );
  }, [allCouriers, user, selectedUnitId]);

  const approveMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/transactions/${id}/approve`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Transaksi disetujui');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/transactions/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Transaksi dibatalkan');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  const canApprove = user?.role === 'super_admin';
  const canCancel = user?.role === 'super_admin';
  const canApprovePwa = user?.role === 'super_admin' || user?.role === 'sales';

  const handleSaleSuccess = () => {
    setShowSaleForm(false);
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['receivables'] });
    queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] });
  };

  const handleCustomerCreated = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
    queryClient.invalidateQueries({ queryKey: ['customers-lost'] });
  };

  return (
    <div className="space-y-4">
      {isLoading && <LoadingFallback message="Memuat data transaksi..." />}

      {/* Filters + Create Button */}
      <Card>
        <CardContent className="p-2 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-3">
            <Select value={filters.status} onValueChange={v => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-full sm:w-32"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Disetujui</SelectItem>
                <SelectItem value="paid">Lunas</SelectItem>
                <SelectItem value="partial">Sebagian</SelectItem>
              </SelectContent>
            </Select>

            {user?.role === 'super_admin' && (
              <Select value={filters.unitId} onValueChange={v => setFilters({ ...filters, unitId: v })}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Unit</SelectItem>
                  {units.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            <div className="hidden sm:block flex-1" />

            {(user?.role === 'sales' || user?.role === 'super_admin') && (
              <Button className="w-full sm:w-auto h-11 sm:h-10" onClick={() => setShowSaleForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Penjualan Baru
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      <Card>
        <CardContent className="p-0">
          {/* Desktop Table */}
          <div className="hidden md:block">
            <ScrollArea className="max-h-[600px]">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Invoice</TableHead>
                      <TableHead className="whitespace-nowrap">Tanggal</TableHead>
                      <TableHead className="whitespace-nowrap">Customer</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Total</TableHead>
                      <TableHead className="whitespace-nowrap">Status</TableHead>
                      <TableHead className="whitespace-nowrap text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((t: Transaction) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-sm">
                          <div className="flex items-center gap-1.5">
                            {isPwaOrder(t) && t.status === 'pending' && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-600 shrink-0">
                                <Smartphone className="w-2.5 h-2.5 mr-0.5" />PWA
                              </Badge>
                            )}
                            {t.invoiceNo}
                          </div>
                        </TableCell>
                        <TableCell>{formatDate(t.transactionDate)}</TableCell>
                        <TableCell>{t.customer?.name || '-'}</TableCell>
                        <TableCell className="text-right font-medium">
                          {isPwaOrder(t) && t.status === 'pending' ? (
                            <span className="text-orange-500 text-xs">Belum ditentukan</span>
                          ) : formatCurrency(t.total)}
                        </TableCell>
                        <TableCell>
                          <Badge className={cn(
                            t.status === 'pending' && "bg-amber-500", t.status === 'approved' && "bg-blue-500",
                            t.status === 'paid' && "bg-green-500", t.paymentStatus === 'partial' && "bg-purple-500",
                            t.status === 'cancelled' && "bg-red-500"
                          )}>{getTransactionStatusLabel(t.status)}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <TransactionActions transaction={t} onView={() => setSelectedTransaction(t)}
                            canApprove={canApprove} canCancel={canCancel}
                            onApprove={(id) => approveMutation.mutate(id)} onCancel={(id) => cancelMutation.mutate(id)}
                            onSetPwaPrice={isPwaOrder(t) && t.status === 'pending' && canApprovePwa ? () => setPwaOrderForApproval(t) : undefined}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                    {transactions.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Tidak ada transaksi</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </ScrollArea>
          </div>

          {/* Mobile Cards */}
          <div className="block md:hidden">
            <div className="p-2 space-y-2">
              {transactions.map((t: Transaction) => {
                const paymentLabel = getTransactionPaymentLabel(t.paymentMethod);
                const pwaPending = isPwaOrder(t) && t.status === 'pending';
                return (
                  <div key={t.id} className="bg-card border rounded-lg p-3 space-y-2 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {pwaPending && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-orange-300 text-orange-600 shrink-0">
                              <Smartphone className="w-2.5 h-2.5 mr-0.5" />PWA
                            </Badge>
                          )}
                          <p className="font-mono font-bold text-xs tracking-tight truncate">{t.invoiceNo}</p>
                        </div>
                      </div>
                      <Badge className={cn(
                        "shrink-0 text-[10px] px-1.5 py-0",
                        t.status === 'pending' && "bg-amber-100 text-amber-700 border border-amber-200",
                        t.status === 'approved' && "bg-blue-100 text-blue-700 border border-blue-200",
                        t.status === 'paid' && "bg-green-100 text-green-700 border border-green-200",
                        t.paymentStatus === 'partial' && "bg-purple-100 text-purple-700 border border-purple-200",
                        t.status === 'cancelled' && "bg-red-100 text-red-700 border border-red-200"
                      )}>{getTransactionStatusLabel(t.status)}</Badge>
                    </div>
                    <p className="font-medium text-xs truncate">{t.customer?.name || 'Walk-in'}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(t.transactionDate)}</span>
                      {paymentLabel && (<><span className="w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" /><span>{paymentLabel}</span></>)}
                    </div>
                    <div className="border-t border-dashed" />
                    <div className="flex items-end justify-between gap-2">
                      <p className={cn("text-base font-bold tabular-nums min-w-0 truncate", pwaPending && "text-orange-500")}>
                        {pwaPending ? 'Belum ditentukan' : formatCurrency(t.total)}
                      </p>
                      {(t.status === 'pending' || t.status === 'approved') && t.remainingAmount > 0 && !pwaPending && (
                        <p className="text-xs text-red-500 shrink-0">Sisa {formatCurrency(t.remainingAmount)}</p>
                      )}
                    </div>
                    {/* PWA Pending Order: Show Set Harga button */}
                    {pwaPending && canApprovePwa && (
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 h-9 text-xs font-medium bg-orange-500 hover:bg-orange-600" onClick={() => setPwaOrderForApproval(t)}>
                          <Pencil className="w-4 h-4 mr-1" /> Set Harga & Approve
                        </Button>
                      </div>
                    )}
                    {/* Regular Pending Order: Show Setujui/Batalkan */}
                    {canApprove && t.status === 'pending' && !pwaPending && (
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1 h-9 text-xs font-medium bg-green-600 hover:bg-green-700" onClick={() => approveMutation.mutate(t.id)} disabled={approveMutation.isPending}>
                          <Check className="w-4 h-4 mr-1" /> {approveMutation.isPending ? 'Memproses...' : 'Setujui'}
                        </Button>
                        <Button size="sm" variant="outline" className="flex-1 h-9 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => cancelMutation.mutate(t.id)} disabled={cancelMutation.isPending}>
                          <X className="w-4 h-4 mr-1" /> {cancelMutation.isPending ? 'Memproses...' : 'Batalkan'}
                        </Button>
                      </div>
                    )}
                    <Button variant="outline" className="w-full h-9 justify-between px-3 font-medium" onClick={() => setSelectedTransaction(t)}>
                      <span>Lihat Detail</span><ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
              {transactions.length === 0 && (
                <div className="text-center py-8 text-muted-foreground"><p className="text-sm">Tidak ada transaksi</p></div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction Detail Dialog */}
      <Dialog open={!!selectedTransaction} onOpenChange={(open) => !open && setSelectedTransaction(null)}>
        <DialogContent aria-describedby={undefined} className="w-[calc(100%-2rem)] sm:w-full sm:max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden rounded-xl p-0">
          {selectedTransaction && (
            <div className="overflow-y-auto flex-1 px-4 pt-4 pb-6 sm:px-6 sm:-mx-6 sm:px-6">
              <TransactionDetail transaction={selectedTransaction} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PWA Order Approval Dialog */}
      {pwaOrderForApproval && (
        <PWAOrderApprovalDialog
          transaction={pwaOrderForApproval}
          open={!!pwaOrderForApproval}
          onClose={() => setPwaOrderForApproval(null)}
          allProducts={products}
          couriers={couriers}
        />
      )}

      {/* Sale Form (floating popup) */}
      {showSaleForm && (
        <SaleForm
          products={products}
          customers={customers}
          couriers={couriers}
          units={units}
          userId={user?.id || ''}
          unitId={user?.role === 'super_admin' ? selectedUnitId || undefined : user?.unitId || undefined}
          onClose={() => setShowSaleForm(false)}
          onSuccess={handleSaleSuccess}
          onCustomerCreated={handleCustomerCreated}
        />
      )}
    </div>
  );
}

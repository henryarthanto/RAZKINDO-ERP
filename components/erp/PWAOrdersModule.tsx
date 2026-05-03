'use client';

import { useState } from 'react';
import {
  Smartphone, Clock, CheckCircle2, XCircle, Loader2,
  ChevronDown, ChevronUp, AlertCircle, User, Phone,
  Banknote, Truck, MessageSquare, CircleDollarSign,
  ImageIcon, CreditCard, UserCheck, UserX, Wallet,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateTime } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingFallback } from '@/components/error-boundary';

type DeliveryType = 'self' | 'courier';

type TabKey = 'pending' | 'piutang';

export default function PWAOrdersModule() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('pending');
  const [rejectDialog, setRejectDialog] = useState<{ id: string; invoiceNo: string; customerName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [lunasDialog, setLunasDialog] = useState<{ id: string; invoiceNo: string; customerName: string; total: number; paymentMethod: string; unitId?: string; hasCourier?: boolean; courierName?: string } | null>(null);
  const [lunasCashBoxId, setLunasCashBoxId] = useState<string>('');
  const [lunasBankAccountId, setLunasBankAccountId] = useState<string>('');

  // Fetch pending PWA orders
  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['pwa-pending-orders'],
    queryFn: async (): Promise<any[]> => {
      const res = await apiFetch<{ orders: any[] }>('/api/pwa-orders/pending');
      return Array.isArray((res as any)?.orders) ? (res as any).orders : [];
    },
    refetchInterval: 30000,
  });

  // Fetch approved-unpaid (piutang) PWA orders
  const { data: piutangData, isLoading: piutangLoading } = useQuery({
    queryKey: ['pwa-approved-unpaid-orders'],
    queryFn: async (): Promise<any[]> => {
      const res = await apiFetch<{ orders: any[] }>('/api/pwa-orders/approved-unpaid');
      return Array.isArray((res as any)?.orders) ? (res as any).orders : [];
    },
    refetchInterval: 30000,
    enabled: activeTab === 'piutang',
  });

  // Fetch kurir list for courier assignment
  const { data: usersData } = useQuery({
    queryKey: ['users-kurir'],
    queryFn: () => apiFetch<{ users: any[] }>('/api/users?role=kurir&status=approved'),
  });
  const couriers = (Array.isArray(usersData?.users) ? usersData.users : []).filter((u: any) =>
    u.role === 'kurir' && u.status === 'approved' && u.isActive
  );

  // Fetch cash boxes for lunas dialog
  const { data: cashBoxesData } = useQuery({
    queryKey: ['cash-boxes'],
    queryFn: () => apiFetch<{ cashBoxes: any[] }>('/api/finance/cash-boxes'),
    staleTime: 60000,
  });
  const cashBoxes = Array.isArray(cashBoxesData?.cashBoxes) ? cashBoxesData.cashBoxes : [];

  // Fetch bank accounts for lunas dialog
  const { data: bankAccountsData } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => apiFetch<{ bankAccounts: any[] }>('/api/finance/bank-accounts'),
    staleTime: 60000,
  });
  const bankAccounts = Array.isArray(bankAccountsData?.bankAccounts) ? bankAccountsData.bankAccounts : [];

  const pendingOrders = pendingData || [];
  const piutangOrders = piutangData || [];

  // Approve mutation (with courier + payment method support)
  const approveMutation = useMutation({
    mutationFn: async ({
      transactionId,
      items,
      deliveryType,
      courierId,
      paymentMethod,
    }: {
      transactionId: string;
      items: { itemId: string; price: number }[];
      deliveryType: DeliveryType;
      courierId?: string;
      paymentMethod: string;
    }) => {
      return apiFetch('/api/pwa-orders/approve', {
        method: 'POST',
        body: JSON.stringify({ transactionId, items, deliveryType, courierId, paymentMethod }),
      });
    },
    onSuccess: (data: any) => {
      const courierInfo = data?.data?.courierName
        ? ` — Kurir: ${data.data.courierName}`
        : data?.data?.deliveryType === 'self'
          ? ' — Antar Sendiri'
          : '';
      toast.success(`Order berhasil di-approve! Pesanan masuk ke daftar piutang.${courierInfo}`);
      queryClient.invalidateQueries({ queryKey: ['pwa-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['pwa-approved-unpaid-orders'] });
    },
    onError: (err: any) => toast.error(err.message || 'Gagal approve order'),
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ transactionId, rejectReason }: { transactionId: string; rejectReason: string }) => {
      return apiFetch('/api/pwa-orders/approve', {
        method: 'POST',
        body: JSON.stringify({ transactionId, reject: true, rejectReason }),
      });
    },
    onSuccess: () => {
      toast.success('Order ditolak');
      queryClient.invalidateQueries({ queryKey: ['pwa-pending-orders'] });
      setRejectDialog(null);
      setRejectReason('');
    },
    onError: (err: any) => toast.error(err.message || 'Gagal menolak order'),
  });

  // Mark lunas mutation
  const lunasMutation = useMutation({
    mutationFn: async ({
      transactionId,
      cashBoxId,
      bankAccountId,
    }: {
      transactionId: string;
      cashBoxId?: string;
      bankAccountId?: string;
    }) => {
      return apiFetch('/api/transactions/mark-lunas', {
        method: 'POST',
        body: JSON.stringify({ transactionId, cashBoxId, bankAccountId }),
      });
    },
    onSuccess: (data: any) => {
      const cashbackMsg = data?.data?.cashbackEarned > 0
        ? ` Cashback +${formatCurrency(data.data.cashbackEarned)} telah diberikan.`
        : '';
      const destMsg = data?.data?.destination
        ? ` Uang masuk ke ${data.data.destination}.`
        : '';
      toast.success(`Pesanan ditandai lunas!${cashbackMsg}${destMsg}`);
      queryClient.invalidateQueries({ queryKey: ['pwa-approved-unpaid-orders'] });
      queryClient.invalidateQueries({ queryKey: ['pwa-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      setLunasDialog(null);
      setLunasCashBoxId('');
      setLunasBankAccountId('');
    },
    onError: (err: any) => toast.error(err.message || 'Gagal menandai lunas'),
  });

  const isLoading = activeTab === 'pending' ? pendingLoading : piutangLoading;

  if (isLoading && (activeTab === 'pending' ? pendingOrders.length === 0 : piutangOrders.length === 0)) {
    return <LoadingFallback />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center shrink-0">
          <Smartphone className="w-4 h-4 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Order PWA</h2>
          <p className="text-xs text-muted-foreground">Pesanan dari pelanggan via PWA</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {pendingOrders.length} pending
          </Badge>
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50">
            {piutangOrders.length} piutang
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList className="w-full">
          <TabsTrigger value="pending" className="flex-1 gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            Menunggu Approval
            {pendingOrders.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {pendingOrders.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="piutang" className="flex-1 gap-1.5">
            <CircleDollarSign className="w-3.5 h-3.5" />
            Menunggu Pelunasan
            {piutangOrders.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {piutangOrders.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Pending Tab */}
        <TabsContent value="pending" className="mt-4 space-y-4">
          <Card className="border-dashed bg-amber-50/50 dark:bg-amber-950/20">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Pesanan menunggu persetujuan
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                    Set harga per item, pilih pengiriman (antar sendiri / kurir), lalu approve. Semua order masuk piutang.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {pendingOrders.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">Semua order PWA sudah diproses</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Tidak ada order yang menunggu approval</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {pendingOrders.map((order: any) => (
                <PWAOrderCard
                  key={order.id}
                  order={order}
                  couriers={couriers}
                  onApprove={(items, deliveryType, courierId, paymentMethod) => approveMutation.mutate({
                    transactionId: order.id, items, deliveryType, courierId, paymentMethod: paymentMethod || '',
                  })}
                  onReject={() => setRejectDialog({ id: order.id, invoiceNo: order.invoiceNo, customerName: order.customer?.name })}
                  isApproving={approveMutation.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Piutang Tab */}
        <TabsContent value="piutang" className="mt-4 space-y-4">
          <Card className="border-dashed bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <CreditCard className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    Piutang — Menunggu Pelunasan
                  </p>
                  <p className="text-xs text-blue-700/80 dark:text-blue-400/80 mt-1">
                    Order sudah di-approve dengan harga. Tandai lunas setelah pembayaran diterima.
                    Cashback baru diberikan saat invoice lunas.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {piutangLoading ? (
            <LoadingFallback />
          ) : piutangOrders.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-300 mx-auto mb-3" />
                <p className="font-medium text-muted-foreground">Tidak ada piutang PWA</p>
                <p className="text-xs text-muted-foreground/70 mt-1">Semua order sudah lunas</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {piutangOrders.map((order: any) => (
                <PiutangOrderCard
                  key={order.id}
                  order={order}
                  onMarkLunas={() => {
                    const hasCourier = !!order.courier?.id || !!order.courierId;
                    setLunasDialog({
                      id: order.id,
                      invoiceNo: order.invoiceNo,
                      customerName: order.customer?.name,
                      total: order.total,
                      paymentMethod: order.paymentMethod,
                      unitId: order.unitId,
                      hasCourier,
                      courierName: order.courier?.name || null,
                    });
                    // Auto-select first matching account (only for non-courier or non-cash)
                    if (order.paymentMethod === 'cash' && !hasCourier && cashBoxes.length > 0) {
                      const unitBox = cashBoxes.find((b: any) => b.unitId === order.unitId);
                      setLunasCashBoxId(unitBox?.id || cashBoxes[0].id);
                      setLunasBankAccountId('');
                    } else if (order.paymentMethod !== 'cash' && bankAccounts.length > 0) {
                      setLunasBankAccountId(bankAccounts[0].id);
                      setLunasCashBoxId('');
                    } else {
                      setLunasCashBoxId('');
                      setLunasBankAccountId('');
                    }
                  }}
                  isMarkingLunas={lunasMutation.isPending}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(open) => !open && setRejectDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak Order</DialogTitle>
            <DialogDescription>
              {rejectDialog?.invoiceNo} — {rejectDialog?.customerName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label className="text-sm font-medium">Alasan Penolakan</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Contoh: Stok tidak tersedia, maksimum order tercapai..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(''); }}>Batal</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate({ transactionId: rejectDialog!.id, rejectReason })}
              disabled={!rejectReason.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Menolak...' : 'Tolak Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Lunas Confirmation Dialog */}
      <Dialog open={!!lunasDialog} onOpenChange={(open) => { if (!open) { setLunasDialog(null); setLunasCashBoxId(''); setLunasBankAccountId(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Tandai Lunas
            </DialogTitle>
            <DialogDescription>
              {lunasDialog?.invoiceNo} — {lunasDialog?.customerName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Invoice</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                  {formatCurrency(lunasDialog?.total || 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Metode Bayar</span>
                <span className="font-medium">
                  {lunasDialog?.paymentMethod === 'cash' ? 'Cash' : lunasDialog?.paymentMethod === 'transfer' ? 'Transfer' : 'Tempo'}
                </span>
              </div>
            </div>

            {/* Destination account selector — only for non-courier cash or transfer/giro */}
            {lunasDialog?.paymentMethod === 'cash' && !lunasDialog?.hasCourier && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  Pilih Brankas Tujuan
                </Label>
                {cashBoxes.length === 0 ? (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Tidak ada brankas aktif. Tambahkan brankas di menu Keuangan terlebih dahulu.
                    </p>
                  </div>
                ) : (
                  <Select value={lunasCashBoxId} onValueChange={setLunasCashBoxId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih brankas..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cashBoxes.map((box: any) => (
                        <SelectItem key={box.id} value={box.id}>
                          <div className="flex items-center justify-between gap-4">
                            <span>{box.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatCurrency(box.balance || 0)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            {lunasDialog?.paymentMethod === 'cash' && lunasDialog?.hasCourier && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                <div className="flex items-start gap-2">
                  <Truck className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Cash akan diterima oleh Kurir
                    </p>
                    <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1">
                      {lunasDialog?.courierName
                        ? `Uang cash sebesar ${formatCurrency(lunasDialog?.total || 0)} akan masuk ke saldo ${lunasDialog.courierName}. Kurir yang akan menyetorkan ke brankas.`
                        : `Uang cash akan masuk ke saldo kurir. Kurir yang akan menyetorkan ke brankas.`
                      }
                    </p>
                  </div>
                </div>
              </div>
            )}
            {lunasDialog?.paymentMethod === 'transfer' && (
              <div className="space-y-2">
                <Label className="text-sm font-medium flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Pilih Akun Bank Tujuan
                </Label>
                {bankAccounts.length === 0 ? (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Tidak ada akun bank aktif. Tambahkan akun bank di menu Keuangan terlebih dahulu.
                    </p>
                  </div>
                ) : (
                  <Select value={lunasBankAccountId} onValueChange={setLunasBankAccountId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih akun bank..." />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((acc: any) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          <div className="flex items-center justify-between gap-4">
                            <span>{acc.name} — {acc.bankName}</span>
                            <span className="text-xs text-muted-foreground">
                              {formatCurrency(acc.balance || 0)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Pastikan pembayaran sudah diterima sebelum menandai lunas.
              Cashback akan otomatis dihitung dan ditambahkan ke saldo pelanggan.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLunasDialog(null); setLunasCashBoxId(''); setLunasBankAccountId(''); }}>Batal</Button>
            <Button
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                const isCashWithCourier = lunasDialog!.paymentMethod === 'cash' && lunasDialog!.hasCourier;
                if (lunasDialog!.paymentMethod === 'cash' && !isCashWithCourier && !lunasCashBoxId) {
                  toast.error('Pilih brankas tujuan terlebih dahulu');
                  return;
                }
                if (lunasDialog!.paymentMethod === 'transfer' && !lunasBankAccountId) {
                  toast.error('Pilih akun bank tujuan terlebih dahulu');
                  return;
                }
                lunasMutation.mutate({
                  transactionId: lunasDialog!.id,
                  cashBoxId: (lunasDialog!.paymentMethod === 'cash' && !isCashWithCourier) ? lunasCashBoxId : undefined,
                  bankAccountId: lunasDialog!.paymentMethod === 'transfer' ? lunasBankAccountId : undefined,
                });
              }}
              disabled={lunasMutation.isPending || (
                lunasDialog?.paymentMethod === 'cash'
                  ? (lunasDialog?.hasCourier ? false : !lunasCashBoxId)
                  : lunasDialog?.paymentMethod === 'transfer' ? !lunasBankAccountId : false
              )}
            >
              {lunasMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {lunasMutation.isPending ? 'Memproses...' : 'Konfirmasi Lunas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ PENDING ORDER CARD ============
function PWAOrderCard({
  order,
  couriers,
  onApprove,
  onReject,
  isApproving,
}: {
  order: any;
  couriers: any[];
  onApprove: (items: { itemId: string; price: number }[], deliveryType: DeliveryType, courierId?: string, paymentMethod?: string) => void;
  onReject: () => void;
  isApproving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    (order.items || []).forEach((item: any) => {
      if (item.product?.sellingPrice) {
        initial[item.id] = String(item.product.sellingPrice);
      } else {
        initial[item.id] = '';
      }
    });
    return initial;
  });
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('self');
  const [selectedCourierId, setSelectedCourierId] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(order.paymentMethod || 'tempo');
  const { user } = useAuthStore();
  const showHpp = user?.role === 'super_admin';

  const items = order.items || [];
  const paymentMethodLabel = selectedPaymentMethod === 'cash' ? 'Cash' : selectedPaymentMethod === 'transfer' ? 'Transfer' : 'Tempo';
  const paymentMethodIcon = selectedPaymentMethod === 'cash' ? '💰' : selectedPaymentMethod === 'transfer' ? '🏦' : '📋';

  // Filter couriers by same unit as the order (check primary unit + userUnits junction)
  const orderUnitId = order.unitId || order.customer?.unitId;
  const unitCouriers = couriers.filter((c: any) =>
    c.unitId === orderUnitId ||
    c.unit?.id === orderUnitId ||
    (c.userUnits || []).some((u: any) => u.id === orderUnitId)
  );

  const handlePriceChange = (itemId: string, value: string) => {
    setPrices(prev => ({ ...prev, [itemId]: value }));
  };

  const handleApprove = () => {
    const itemsWithPrice = items.map((item: any) => ({
      itemId: item.id,
      price: parseFloat(prices[item.id]) || 0,
    }));

    const hasEmpty = itemsWithPrice.some(i => i.price <= 0);
    if (hasEmpty) {
      toast.error('Semua item harus memiliki harga');
      return;
    }

    if (deliveryType === 'courier' && !selectedCourierId) {
      toast.error('Pilih kurir terlebih dahulu');
      return;
    }

    onApprove(
      itemsWithPrice,
      deliveryType,
      deliveryType === 'courier' ? selectedCourierId : undefined,
      selectedPaymentMethod,
    );
  };

  const total = items.reduce((sum: number, item: any) => {
    return sum + (parseFloat(prices[item.id]) || 0) * item.qty;
  }, 0);

  const allPricesFilled = items.every((item: any) => parseFloat(prices[item.id]) > 0);

  // Get selected courier info for commission preview
  const selectedCourier = couriers.find((c: any) => c.id === selectedCourierId);
  const customerDistance = order.customer?.distance || 'near';
  const previewCommission = selectedCourier
    ? (customerDistance === 'far' ? (selectedCourier.farCommission || 0) : (selectedCourier.nearCommission || 0))
    : 0;

  // Item summary text for collapsed view
  const itemSummary = items.length === 0
    ? 'Tidak ada item'
    : items.length === 1
      ? `${items[0].productName} x${items[0].qty}`
      : `${items[0].productName} x${items[0].qty} +${items.length - 1} lainnya`;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="w-full">
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                  <Smartphone className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{order.invoiceNo}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {paymentMethodIcon} {paymentMethodLabel}
                    </Badge>
                    <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px] shrink-0">
                      Pending
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {order.customer?.name} &middot; {itemSummary}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">
                    {formatDateTime(order.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ChevronDown className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform duration-200',
                  expanded && 'rotate-180'
                )} />
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
      </CardHeader>

      <CollapsibleContent>
        <CardContent className="pt-0 space-y-3">
          <Separator />

          {/* Customer Info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Pelanggan:</span>
              <span className="font-medium">{order.customer?.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-medium">{order.customer?.phone || '-'}</span>
            </div>
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Catatan:</span>
              <span className="font-medium truncate">{order.notes?.replace(/Order dari PWA.*?—\s*/g, '').trim() || '-'}</span>
            </div>
          </div>

          {/* Items with Price Input */}
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Banknote className="w-4 h-4" />
              Set Harga Per Item
            </p>
            <div className="space-y-2">
              {items.map((item: any) => {
                const unitLabel = item.qtyUnitType === 'sub'
                  ? (item.product?.subUnit || 'pcs')
                  : (item.product?.unit || 'pcs');
                const priceVal = parseFloat(prices[item.id]) || 0;
                const subtotal = priceVal * item.qty;

                return (
                  <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.productName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.qty} {unitLabel}
                        {showHpp && item.product?.avgHpp > 0 && (
                          <span className="ml-2 text-orange-600">HPP: {formatCurrency(item.product.avgHpp)}/{item.product?.subUnit || 'unit'}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground hidden sm:inline">Rp</span>
                      <Input
                        type="number"
                        min="0"
                        step="1000"
                        value={prices[item.id]}
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

          {/* Total */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5 border">
            <span className="text-sm font-medium">Total</span>
            <span className="text-lg font-bold">{formatCurrency(total)}</span>
          </div>

          <Separator />

          {/* Payment Method Selection — Sales/Admin chooses */}
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Metode Pembayaran
            </p>
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
            {selectedPaymentMethod === 'transfer' && (
              <p className="text-xs text-muted-foreground">Pelanggan akan diminta upload bukti transfer.</p>
            )}
          </div>

          <Separator />

          {/* Delivery Assignment */}
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Truck className="w-4 h-4" />
              Pengiriman
            </p>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDeliveryType('self')}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border-2 transition-all text-left',
                  deliveryType === 'self'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20'
                    : 'border-muted bg-muted/20 hover:border-muted-foreground/30'
                )}
              >
                <UserCheck className={cn(
                  'w-4 h-4 shrink-0',
                  deliveryType === 'self' ? 'text-emerald-600' : 'text-muted-foreground'
                )} />
                <div>
                  <p className={cn('text-sm font-medium', deliveryType === 'self' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground')}>
                    Antar Sendiri
                  </p>
                  <p className="text-[10px] text-muted-foreground">Sales/Admin yang mengirim</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDeliveryType('courier')}
                className={cn(
                  'flex items-center gap-2 p-2 rounded-lg border-2 transition-all text-left',
                  deliveryType === 'courier'
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                    : 'border-muted bg-muted/20 hover:border-muted-foreground/30'
                )}
              >
                <UserX className={cn(
                  'w-4 h-4 shrink-0',
                  deliveryType === 'courier' ? 'text-blue-600' : 'text-muted-foreground'
                )} />
                <div>
                  <p className={cn('text-sm font-medium', deliveryType === 'courier' ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground')}>
                    Assign ke Kurir
                  </p>
                  <p className="text-[10px] text-muted-foreground">Kurir yang bertugas</p>
                </div>
              </button>
            </div>

            {deliveryType === 'courier' && (
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Pilih Kurir</Label>
                {unitCouriers.length === 0 ? (
                  <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Tidak ada kurir aktif di unit ini. Silakan pilih &quot;Antar Sendiri&quot; atau tambahkan kurir terlebih dahulu.
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
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5" />
                            <span>{c.name || c.email || 'Tanpa Nama'}</span>
                            {c.phone && <span className="text-xs text-muted-foreground">({c.phone})</span>}
                          </div>
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

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={onReject}
              className="gap-1"
            >
              <XCircle className="w-4 h-4" />
              Tolak
            </Button>
            <Button
              size="sm"
              onClick={handleApprove}
              disabled={!allPricesFilled || isApproving || (deliveryType === 'courier' && !selectedCourierId)}
              className="gap-1 flex-1"
            >
              {isApproving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {isApproving ? 'Memproses...' : 'Set Harga & Approve'}
            </Button>
          </div>
        </CardContent>
        </CollapsibleContent>
    </Card>
    </Collapsible>
  );
}

// ============ PIUTANG ORDER CARD ============
function PiutangOrderCard({
  order,
  onMarkLunas,
  isMarkingLunas,
}: {
  order: any;
  onMarkLunas: () => void;
  isMarkingLunas: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const items = order.items || [];
  const paymentMethod = order.paymentMethod === 'cash' ? 'Cash' : order.paymentMethod === 'transfer' ? 'Transfer' : order.paymentMethod === 'tempo' ? 'Tempo' : order.paymentMethod || '-';
  const paymentMethodIcon = order.paymentMethod === 'cash' ? '💰' : order.paymentMethod === 'transfer' ? '🏦' : '📋';
  const hasProofs = (order.paymentProofs || []).length > 0;

  // Delivery info
  const hasCourier = !!order.courier?.id;
  const deliveryLabel = hasCourier
    ? `Kurir: ${order.courier?.name}`
    : 'Antar Sendiri';

  // Item summary text for collapsed view
  const itemSummary = items.length === 0
    ? 'Tidak ada item'
    : items.length === 1
      ? `${items[0].productName} x${items[0].qty}`
      : `${items[0].productName} x${items[0].qty} +${items.length - 1} lainnya`;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="w-full">
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                  <CircleDollarSign className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{order.invoiceNo}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {paymentMethodIcon} {paymentMethod}
                    </Badge>
                    <Badge className="bg-blue-100 text-blue-700 border-0 text-[10px] shrink-0">
                      Piutang
                    </Badge>
                    {hasProofs && (
                      <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[10px] shrink-0 gap-0.5">
                        <ImageIcon className="w-2.5 h-2.5" />
                        Bukti
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {order.customer?.name} &middot; {itemSummary}
                  </p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[10px] text-muted-foreground/70">
                      {formatDateTime(order.createdAt)} &middot; <Truck className="w-3 h-3 inline" /> {deliveryLabel}
                    </p>
                    <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatCurrency(order.total)}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <ChevronDown className={cn(
                  'w-4 h-4 text-muted-foreground transition-transform duration-200',
                  expanded && 'rotate-180'
                )} />
              </div>
            </div>
          </button>
        </CollapsibleTrigger>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Quick action bar (always visible) */}
        <div className="flex items-center justify-end gap-2 mb-2">
          <Button
            size="sm"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={onMarkLunas}
            disabled={isMarkingLunas}
          >
            {isMarkingLunas ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            Tandai Lunas
          </Button>
        </div>

        <CollapsibleContent>
          <div className="space-y-3">
            <Separator />

            {/* Customer Info */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Pelanggan:</span>
                <span className="font-medium">{order.customer?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="font-medium">{order.customer?.phone || '-'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Truck className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Pengiriman:</span>
                <span className="font-medium">{deliveryLabel}</span>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-1">
              <p className="text-sm font-medium">Detail Item:</p>
              <div className="rounded-lg bg-muted/30 p-2 space-y-1">
                {items.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{item.productName} x{item.qty}</span>
                    <span className="font-medium">{formatCurrency(item.subtotal)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Proofs */}
            {hasProofs && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Bukti Bayar ({(order.paymentProofs || []).length}):</p>
                <div className="flex flex-wrap gap-2">
                  {(order.paymentProofs || []).map((proof: any) => (
                    <a
                      key={proof.id}
                      href={proof.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 underline"
                    >
                      <ImageIcon className="w-3 h-3" />
                      {proof.fileName || 'Lihat bukti'}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {order.notes && (
              <div className="text-xs text-muted-foreground rounded-lg bg-muted/20 p-2">
                {order.notes.split('\n').map((line: string, i: number) => (
                  <span key={i}>{line}<br /></span>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </CardContent>
    </Card>
    </Collapsible>
  );
}

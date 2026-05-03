'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Truck,
  RefreshCw,
  Route,
  TrendingUp,
  Banknote,
  BadgeCheck,
  HandCoins,
  Wallet,
  Check,
  Receipt,
  Building2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/erp-helpers';
import type { Transaction, User } from '@/types';
import type { QueryClient } from '@tanstack/react-query';

export default function CourierDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [handoverAmount, setHandoverAmount] = useState('');
  const [handoverNotes, setHandoverNotes] = useState('');
  const [selectedHandoverUnit, setSelectedHandoverUnit] = useState<string>('');

  // Resolve available units for handover: primary unitId or from userUnits
  const courierUnits = user?.userUnits || (user?.unit ? [user.unit] : []);
  const primaryUnitId = user?.unitId || courierUnits[0]?.id || '';
  // Effective unit for handover: prefer explicitly selected, then primary, then first available
  const effectiveHandoverUnitId = selectedHandoverUnit || primaryUnitId;

  // Fetch courier dashboard data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['courier-dashboard', user?.id, period],
    queryFn: () => apiFetch<any>(`/api/courier/dashboard?courierId=${user?.id}&period=${period}`),
    enabled: !!user?.id,
    ...POLLING_CONFIG
  });

  const dashboard = data?.dashboard;
  const stats = dashboard?.stats;
  const cashBalance = dashboard?.cashBalance;
  const todayStats = dashboard?.todayStats;
  const pendingDeliveries = dashboard?.pendingDeliveries || [];
  const chartData = dashboard?.chartData || [];
  const handoverHistory = dashboard?.handoverHistory || [];

  // Get per-unit balance from dashboard data (must be after cashBalance is defined)
  const unitBalances = cashBalance?.unitBalances || {};

  // Get balance for the selected/effective handover unit (not total)
  const handoverUnitBalance = effectiveHandoverUnitId && unitBalances[effectiveHandoverUnitId]
    ? unitBalances[effectiveHandoverUnitId].balance
    : 0;

  // Only show handover button if the target unit has actual balance
  const canHandover = handoverUnitBalance > 0;

  // Handover mutation
  const handoverMutation = useMutation({
    mutationFn: async () => {
      if (!handoverAmount || Number(handoverAmount) <= 0) {
        throw new Error('Masukkan jumlah yang valid');
      }
      // Validate against the PER-UNIT balance (not total)
      if (Number(handoverAmount) > handoverUnitBalance) {
        const unitName = unitBalances[effectiveHandoverUnitId]?.unitName || 'unit ini';
        throw new Error(`Jumlah melebihi saldo cash di ${unitName} (Rp ${formatCurrency(handoverUnitBalance)})`);
      }
      if (!effectiveHandoverUnitId) {
        throw new Error('Unit belum ditentukan. Hubungi admin untuk assignment unit.');
      }
      return apiFetch('/api/courier/handover', {
        method: 'POST',
        body: JSON.stringify({
          courierId: user?.id,
          unitId: effectiveHandoverUnitId,
          amount: Number(handoverAmount),
          notes: handoverNotes
        })
      });
    },
    onSuccess: () => {
      toast.success(`Berhasil menyetor ${formatCurrency(Number(handoverAmount))} ke brankas`);
      setHandoverOpen(false);
      setHandoverAmount('');
      setHandoverNotes('');
      setSelectedHandoverUnit('');
      queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['courier-cash-summary'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  if (isLoading || !dashboard) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse h-24 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Check if courier has cash in multiple units (show warning)
  const unitKeys = Object.keys(unitBalances);
  const hasMultipleUnits = unitKeys.length > 1;
  const unitsWithBalance = unitKeys.filter(k => unitBalances[k].balance > 0);

  return (
    <div className="space-y-4">
      {/* Header & Period Filter */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold">Performa Pengiriman</h2>
          <p className="text-sm text-muted-foreground">Selamat datang, {user?.name}!</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['day', 'week', 'month'] as const).map(p => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? 'default' : 'outline'}
              onClick={() => setPeriod(p)}
            >
              {p === 'day' ? 'Hari Ini' : p === 'week' ? 'Minggu Ini' : 'Bulan Ini'}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} className="h-9 w-9 sm:h-auto sm:w-auto p-0 sm:p-auto">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Today Quick Stats */}
      <Card className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="min-w-0">
              <p className="text-emerald-100 text-sm">Hari Ini</p>
              <div className="grid grid-cols-3 gap-1 mt-1">
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-bold truncate">{todayStats?.deliveries || 0}</p>
                  <p className="text-emerald-100 text-xs truncate">Pengiriman</p>
                </div>
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-bold truncate">{formatCurrency(todayStats?.cashCollected || 0)}</p>
                  <p className="text-emerald-100 text-xs truncate">Cash Dikumpulkan</p>
                </div>
                <div className="min-w-0">
                  <p className="text-lg sm:text-2xl font-bold truncate">{pendingDeliveries.length}</p>
                  <p className="text-emerald-100 text-xs truncate">Pending</p>
                </div>
              </div>
            </div>
            <Truck className="w-12 h-12 text-white/30 self-end sm:self-auto hidden sm:block" />
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <Route className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Pengiriman</p>
                <p className="text-sm sm:text-lg font-bold">{stats?.totalDeliveries || 0}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2 text-xs flex-wrap">
              <span className="text-emerald-600">📍 {stats?.nearDeliveries || 0} Dekat</span>
              <span className="text-orange-600">🗺️ {stats?.farDeliveries || 0} Jauh</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Komisi</p>
                <p className="text-sm sm:text-lg font-bold text-emerald-700">{formatCurrency(stats?.totalCommission || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                <Banknote className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Cash di Tangan</p>
                <p className="text-sm sm:text-lg font-bold text-amber-700">{formatCurrency(cashBalance?.current || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <BadgeCheck className="w-5 h-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Dikumpulkan</p>
                <p className="text-sm sm:text-lg font-bold">{formatCurrency(stats?.cashCollected || 0)}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2 text-xs flex-wrap">
              <span className="text-green-600">💵 {formatCurrency(stats?.cashCollected || 0)} Cash</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                <Receipt className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Piutang</p>
                <p className="text-sm sm:text-lg font-bold text-red-700">{formatCurrency(stats?.piutangRemaining || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cash Summary & Handover Button */}
      <Card className="border-amber-200 dark:border-amber-900">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                <HandCoins className="w-6 h-6 text-amber-600" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">Cash di Tangan</h3>
                <p className="text-2xl font-bold text-amber-700 min-w-0 truncate">{formatCurrency(cashBalance?.current || 0)}</p>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">Terkumpul: {formatCurrency(cashBalance?.totalCollected || 0)}</span>
                  <span>&bull;</span>
                  <span className="min-w-0 truncate">Disetor: {formatCurrency(cashBalance?.totalHandover || 0)}</span>
                  {cashBalance?.pendingHandover > 0 && (
                    <>
                      <span>&bull;</span>
                      <span className="text-amber-600">Pending: {formatCurrency(cashBalance.pendingHandover)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <Button
              onClick={() => {
                // Pre-select the unit with the highest balance
                if (hasMultipleUnits && unitsWithBalance.length > 0) {
                  const highestUnit = unitsWithBalance.reduce((best, k) =>
                    unitBalances[k].balance > (unitBalances[best]?.balance || 0) ? k : best, unitsWithBalance[0]);
                  setSelectedHandoverUnit(highestUnit);
                } else {
                  setSelectedHandoverUnit(primaryUnitId);
                }
                setHandoverOpen(true);
              }}
              disabled={!canHandover}
              className="bg-amber-600 hover:bg-amber-700 w-full sm:w-auto"
            >
              <Wallet className="w-4 h-4 mr-2" />
              Setor ke Brankas
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Chart - Deliveries per Day */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Grafik Pengiriman</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="min-h-[180px] h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <RechartsTooltip 
                    labelFormatter={(v) => new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                    formatter={(value: any, name: string) => {
                      if (name === 'cash') return [formatCurrency(value), 'Cash'];
                      if (name === 'commission') return [formatCurrency(value), 'Komisi'];
                      return [value, 'Pengiriman'];
                    }}
                  />
                  <Legend 
                    formatter={(value) => {
                      if (value === 'deliveries') return 'Pengiriman';
                      if (value === 'cash') return 'Cash';
                      if (value === 'commission') return 'Komisi';
                      return value;
                    }}
                  />
                  <Bar dataKey="deliveries" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cash" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="pending" className="space-y-3">
        <TabsList className="overflow-x-auto flex scrollbar-hide">
          <TabsTrigger value="pending">
            Pengiriman Pending ({pendingDeliveries.length})
          </TabsTrigger>
          <TabsTrigger value="handovers">
            Riwayat Setor ({handoverHistory.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-3">
          {user && pendingDeliveries.map((t: any) => {
            const dist = t.deliveryDistance || t.customer?.distance || 'near';
            const isFar = dist === 'far';
            return (
              <PendingDeliveryCard 
                key={t.id} 
                transaction={t} 
                courier={user!} 
                queryClient={queryClient}
              />
            );
          })}
          {pendingDeliveries.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Tidak ada pengiriman pending
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="handovers" className="space-y-3">
          {handoverHistory.map((h: any) => (
            <Card key={h.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium">{formatCurrency(h.amount)}</p>
                      <Badge variant={h.status === 'processed' ? 'default' : h.status === 'rejected' ? 'destructive' : 'outline'}>
                        {h.status === 'processed' ? '✅ Diproses' : h.status === 'rejected' ? '❌ Ditolak' : '⏳ Pending'}
                      </Badge>
                    </div>
                    {h.notes && <p className="text-xs text-muted-foreground mt-1">{h.notes}</p>}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(h.createdAt)}
                      {h.processedAt && ` • Diproses: ${formatDateTime(h.processedAt)}`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {handoverHistory.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Belum ada riwayat setor
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Handover Dialog */}
      <Dialog open={handoverOpen} onOpenChange={setHandoverOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Setor Cash ke Brankas</DialogTitle>
            <DialogDescription>
              Serahkan uang cash yang Anda kumpulkan dari pengiriman ke brankas perusahaan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Unit-specific balance info */}
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
              <p className="text-sm text-muted-foreground">Saldo Cash di Tangan</p>
              <p className="text-2xl font-bold text-amber-700">{formatCurrency(cashBalance?.current || 0)}</p>

              {/* Show per-unit breakdown when multiple units have balance */}
              {hasMultipleUnits && unitsWithBalance.length > 1 && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-muted-foreground">Saldo per unit:</p>
                  {unitsWithBalance.map(unitId => (
                    <div key={unitId} className="flex justify-between text-xs">
                      <span className={cn(
                        unitId === effectiveHandoverUnitId ? 'font-semibold text-amber-700' : 'text-muted-foreground'
                      )}>
                        {unitBalances[unitId]?.unitName || unitId}
                        {unitId === effectiveHandoverUnitId && ' ← dipilih'}
                      </span>
                      <span className={cn(
                        'font-medium',
                        unitId === effectiveHandoverUnitId ? 'text-amber-700' : ''
                      )}>
                        {formatCurrency(unitBalances[unitId]?.balance || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unit selector — only show when courier has multiple units */}
            {courierUnits.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="handover-unit">Unit Brankas</Label>
                <Select value={selectedHandoverUnit} onValueChange={setSelectedHandoverUnit}>
                  <SelectTrigger id="handover-unit">
                    <Building2 className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Pilih unit brankas" />
                  </SelectTrigger>
                  <SelectContent>
                    {courierUnits.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                        {unitBalances[u.id]?.balance > 0 && ` (${formatCurrency(unitBalances[u.id].balance)})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Show selected unit's specific balance */}
                {effectiveHandoverUnitId && unitBalances[effectiveHandoverUnitId] && (
                  <p className="text-xs text-muted-foreground">
                    Saldo di unit ini: <span className="font-medium text-amber-700">{formatCurrency(handoverUnitBalance)}</span>
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="handover-amount">Jumlah Setor</Label>
              <Input
                id="handover-amount"
                type="number"
                placeholder="0"
                value={handoverAmount}
                onChange={e => setHandoverAmount(e.target.value)}
                max={handoverUnitBalance}
              />
              <Button 
                type="button" 
                variant="outline" 
                size="sm"
                className="w-full"
                onClick={() => setHandoverAmount(String(handoverUnitBalance))}
              >
                Setor Semua ({formatCurrency(handoverUnitBalance)})
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="handover-notes">Catatan (opsional)</Label>
              <Textarea
                id="handover-notes"
                placeholder="Catatan tambahan..."
                value={handoverNotes}
                onChange={e => setHandoverNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHandoverOpen(false)}>
              Batal
            </Button>
            <Button 
              onClick={() => handoverMutation.mutate()} 
              disabled={handoverMutation.isPending || !handoverAmount || Number(handoverAmount) <= 0 || Number(handoverAmount) > handoverUnitBalance}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {handoverMutation.isPending ? 'Memproses...' : 'Setor ke Brankas'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== PENDING DELIVERY CARD (with payment collection) ==============
export function PendingDeliveryCard({ transaction, courier, queryClient }: { transaction: Transaction; courier: User; queryClient: QueryClient }) {
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'piutang' | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');

  const remaining = transaction.remainingAmount || transaction.total;
  const dist = transaction.deliveryDistance || transaction.customer?.distance || 'near';
  const isFar = dist === 'far';
  const commission = isFar ? (courier.farCommission || 0) : (courier.nearCommission || 0);

  // Deliver mutation
  const deliverMutation = useMutation({
    mutationFn: async (collectPayment: boolean) => {
      const isCash = paymentMethod === 'cash';
      const amount = isCash && paymentAmount ? Number(paymentAmount) : null;
      const body: any = {
        transactionId: transaction.id,
        courierId: courier.id,
      };
      if (collectPayment && paymentMethod && amount && amount > 0) {
        body.paymentMethod = isCash ? 'cash' : 'piutang';
        body.amount = amount;
      }
      return apiFetch<{ commission?: number }>('/api/courier/deliver', {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    },
    onSuccess: (result) => {
      toast.success(`Pengiriman ${transaction.invoiceNo} selesai! + Komisi ${formatCurrency(result.commission || commission)}`);
      setDeliverOpen(false);
      setPaymentMethod(null);
      setPaymentAmount('');
      queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h3 className="font-medium text-sm sm:text-base">{transaction.invoiceNo}</h3>
                <Badge variant="outline">{formatDate(transaction.transactionDate)}</Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    isFar
                      ? "border-orange-300 text-orange-600 bg-orange-50"
                      : "border-emerald-300 text-emerald-600 bg-emerald-50"
                  )}
                >
                  {isFar ? '🗺️ Jauh' : '📍 Dekat'}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    transaction.paymentMethod === 'piutang'
                      ? "border-amber-300 text-amber-600 bg-amber-50"
                      : transaction.paymentMethod === 'tempo'
                      ? "border-purple-300 text-purple-600 bg-purple-50"
                      : "border-gray-300 text-gray-600 bg-gray-50"
                  )}
                >
                  {transaction.paymentMethod === 'piutang' ? '💵 Piutang' : transaction.paymentMethod === 'tempo' ? '📋 Tempo' : `💳 ${transaction.paymentMethod || '?'}`}
                </Badge>
                {remaining > 0 && (
                  <Badge variant="outline" className="border-red-300 text-red-600 bg-red-50 text-xs">
                    💰 {formatCurrency(remaining)}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{transaction.customer?.name || 'Walk-in'}</p>
              {transaction.customer?.phone && (
                <p className="text-xs text-muted-foreground truncate">{transaction.customer.phone}</p>
              )}
              {transaction.deliveryAddress && (
                <p className="text-xs mt-1 truncate">{transaction.deliveryAddress}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className="font-medium">{formatCurrency(transaction.total)}</span>
                {transaction.paidAmount > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Terbayar: {formatCurrency(transaction.paidAmount)}
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-600 mt-1">
                Komisi: +{formatCurrency(commission)}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setDeliverOpen(true)}
              className="shrink-0"
            >
              <Check className="w-4 h-4 mr-1" />
              Selesai
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delivery Completion Dialog */}
      <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
        <DialogContent className="max-w-md w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Konfirmasi Pengiriman</DialogTitle>
            <DialogDescription>
              {transaction.invoiceNo} — {transaction.customer?.name || 'Walk-in'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Delivery Info */}
            <div className="bg-muted rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-sm">
                <span>Total</span>
                <span className="font-medium">{formatCurrency(transaction.total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Sudah Dibayar</span>
                <span className="text-green-600">{formatCurrency(transaction.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium border-t pt-1">
                <span>Sisa</span>
                <span className="text-red-600">{formatCurrency(remaining)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Komisi</span>
                <span className="text-emerald-600">+{formatCurrency(commission)}</span>
              </div>
            </div>

            {remaining > 0 && !paymentMethod ? (
              <>
                <p className="text-sm font-medium">Metode pembayaran dari konsumen?</p>
                <div className="flex gap-2">
                  <Button 
                    className="flex-1" 
                    onClick={() => { setPaymentMethod('cash'); setPaymentAmount(String(remaining)); }}
                    variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                  >
                    <Banknote className="w-4 h-4 mr-2" />
                    Cash
                  </Button>
                  <Button 
                    className="flex-1" 
                    onClick={() => { setPaymentMethod('piutang'); setPaymentAmount(String(remaining)); }}
                    variant={paymentMethod === 'piutang' ? 'default' : 'outline'}
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    Piutang
                  </Button>
                </div>
              </>
            ) : paymentMethod === 'cash' ? (
              <>
                <Alert className="border-amber-300 bg-amber-50">
                  <Banknote className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 text-sm">
                    Konsumen membayar <strong>{formatCurrency(remaining)}</strong> secara cash. Uang akan masuk ke saldo cash Anda.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label>Jumlah Cash Diterima</Label>
                  <Input
                    type="number"
                    value={paymentAmount}
                    onChange={e => setPaymentAmount(e.target.value)}
                    max={remaining}
                    placeholder={String(remaining)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sisa tagihan: {formatCurrency(remaining)}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setPaymentMethod(null)}
                  >
                    Kembali
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => deliverMutation.mutate(true)}
                    disabled={deliverMutation.isPending || !paymentAmount || Number(paymentAmount) <= 0}
                  >
                    {deliverMutation.isPending ? 'Memproses...' : 'Cash & Selesai'}
                  </Button>
                </div>
              </>
            ) : paymentMethod === 'piutang' ? (
              <>
                <Alert className="border-red-300 bg-red-50">
                  <Receipt className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-800 text-sm">
                    Konsumen belum membayar. <strong>{formatCurrency(remaining)}</strong> akan dicatat sebagai <strong>piutang</strong> dan perlu ditagih nanti.
                  </AlertDescription>
                </Alert>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setPaymentMethod(null)}
                  >
                    Kembali
                  </Button>
                  <Button
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => deliverMutation.mutate(true)}
                    disabled={deliverMutation.isPending}
                  >
                    {deliverMutation.isPending ? 'Memproses...' : 'Piutang & Selesai'}
                  </Button>
                </div>
              </>
            ) : null}

            {remaining <= 0 && (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={() => deliverMutation.mutate(false)}
                  disabled={deliverMutation.isPending}
                >
                  {deliverMutation.isPending ? 'Memproses...' : 'Selesai Pengiriman'}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

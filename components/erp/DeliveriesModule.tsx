'use client';

import { useState, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LoadingFallback } from '@/components/error-boundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatCurrency, formatDate, formatDateTime, getTransactionPaymentLabel, getPaymentRecordLabel, toLocalDateStr, todayLocal } from '@/lib/erp-helpers';
import type { Transaction, Payment, User } from '@/types';
import { PendingDeliveryCard } from './CourierDashboard';
import { RefreshCw, Truck, Wallet, MapPin, Calendar, TrendingUp, Users, Banknote, BadgeCheck, ArrowUpRight } from 'lucide-react';

export default function DeliveriesModule() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === 'super_admin';

  // Date filter state
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30); // default: last 30 days
    return toLocalDateStr(d);
  });
  const [endDate, setEndDate] = useState(() => 
    todayLocal()
  );
  const [courierFilter, setCourierFilter] = useState<string>('all');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['transactions-deliveries', { type: 'sale', startDate, endDate }],
    queryFn: async () => {
      const params = new URLSearchParams({ type: 'sale' });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      return apiFetch<{ transactions: any[] }>(`/api/transactions?${params.toString()}`);
    },
    ...POLLING_CONFIG
  });

  // Fetch couriers for filter dropdown (super admin only)
  const { data: couriersData } = useQuery({
    queryKey: ['couriers-list'],
    queryFn: () => apiFetch<{ users: any[] }>('/api/users?role=kurir&status=approved'),
    enabled: isSuperAdmin,
  });
  const couriers = (Array.isArray(couriersData?.users) ? couriersData.users : []) as User[];

  // Filter deliveries based on user role
  const deliveries = useMemo(() => {
    let list = (Array.isArray(data?.transactions) ? data.transactions : []).filter((t: Transaction) => {
      // Exclude self-delivered transactions (no courier = sales delivered themselves)
      if (!t.courierId) return false;
      if (user?.role === 'kurir') {
        return t.courierId === user.id;
      }
      return true;
    });

    // Apply courier filter for super admin
    if (isSuperAdmin && courierFilter !== 'all') {
      list = list.filter((t: Transaction) => t.courierId === courierFilter);
    }

    return list;
  }, [data?.transactions, user, isSuperAdmin, courierFilter]);

  // Date filter helper
  const inDateRange = (dateStr: string) => {
    if (!startDate && !endDate) return true;
    const d = new Date(dateStr);
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    if (s && d < s) return false;
    if (e) { e.setHours(23, 59, 59, 999); if (d > e) return false; }
    return true;
  };

  const pendingDeliveries = deliveries.filter((t: Transaction) =>
    t.status === 'approved' && t.paymentStatus === 'unpaid' && !t.deliveredAt && inDateRange(t.transactionDate.toString())
  );

  const completedDeliveries = deliveries.filter((t: Transaction) =>
    t.deliveredAt && inDateRange(t.deliveredAt.toString())
  );

  // Commission summary for super admin
  const commissionSummary = useMemo(() => {
    if (!isSuperAdmin || completedDeliveries.length === 0) return null;

    const byCourier = new Map<string, {
      name: string;
      totalDeliveries: number;
      totalCommission: number;
      nearDeliveries: number;
      farDeliveries: number;
      cashCollected: number;
      piutang: number;
    }>();

    for (const t of completedDeliveries) {
      const cId = t.courierId || 'unassigned';
      const cName = t.courier?.name || 'Belum ditugaskan';
      const existing = byCourier.get(cId) || {
        name: cName,
        totalDeliveries: 0,
        totalCommission: 0,
        nearDeliveries: 0,
        farDeliveries: 0,
        cashCollected: 0,
        piutang: 0,
      };

      const dist = t.deliveryDistance || t.customer?.distance || 'near';
      const commission = t.courierCommission || 0;
      const deliveryPayment = t.payments?.find((p: Payment) => p.receivedById === t.courierId);

      existing.totalDeliveries++;
      existing.totalCommission += commission;
      if (dist === 'far') existing.farDeliveries++;
      else existing.nearDeliveries++;
      if (deliveryPayment) existing.cashCollected += deliveryPayment.amount;
      if ((t.paymentMethod === 'piutang' || t.paymentMethod === 'tempo') && t.remainingAmount > 0) {
        existing.piutang += t.remainingAmount;
      }

      byCourier.set(cId, existing);
    }

    const totalCommission = Array.from(byCourier.values()).reduce((s, c) => s + c.totalCommission, 0);
    const totalDeliveries = Array.from(byCourier.values()).reduce((s, c) => s + c.totalDeliveries, 0);

    return {
      byCourier: Array.from(byCourier.entries())
        .sort((a, b) => b[1].totalCommission - a[1].totalCommission),
      totalCommission,
      totalDeliveries,
    };
  }, [completedDeliveries, isSuperAdmin]);

  return (
    <div className="space-y-4">
      {isLoading && <LoadingFallback message="Memuat data pengiriman..." />}

      {/* Date & Courier Filter Bar - Super Admin Only */}
      {isSuperAdmin && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Dari Tanggal</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="w-full sm:w-36"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Sampai Tanggal</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="w-full sm:w-36"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kurir</Label>
                <Select value={courierFilter} onValueChange={v => setCourierFilter(v)}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder="Semua Kurir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kurir</SelectItem>
                    {couriers.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => refetch()} variant="outline" size="sm">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commission Summary - Super Admin Only */}
      {isSuperAdmin && commissionSummary && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-white dark:from-emerald-950/20 dark:to-background">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BadgeCheck className="w-5 h-5 text-emerald-600" />
              Pendapatan Komisi Kurir
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Total Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Total Kirim</p>
                <p className="text-base sm:text-lg font-bold">{commissionSummary.totalDeliveries}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-700">
                <p className="text-xs text-muted-foreground">Total Komisi</p>
                <p className="text-base sm:text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(commissionSummary.totalCommission)}</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Kurir Aktif</p>
                <p className="text-base sm:text-lg font-bold">{commissionSummary.byCourier.length}</p>
              </div>
            </div>

            {/* Per-Courier Breakdown */}
            <ScrollArea className="max-h-80">
              <div className="space-y-2">
                {commissionSummary.byCourier.map(([cId, c]) => {
                  const pct = commissionSummary.totalCommission > 0
                    ? Math.round((c.totalCommission / commissionSummary.totalCommission) * 100)
                    : 0;
                  return (
                    <div key={cId} className="p-3 rounded-lg border bg-card">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                            <Truck className="w-4 h-4 text-emerald-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{c.name}</p>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                              <span>{c.totalDeliveries} kirim</span>
                              <span>•</span>
                              <span className="text-emerald-600">📍 {c.nearDeliveries} dekat</span>
                              <span>•</span>
                              <span className="text-orange-600">🗺️ {c.farDeliveries} jauh</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-emerald-600">{formatCurrency(c.totalCommission)}</p>
                          <div className="flex items-center gap-1 justify-end">
                            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                            <span className="text-xs text-emerald-500">{pct}%</span>
                          </div>
                        </div>
                      </div>
                      {/* Detail row */}
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t text-xs">
                        <div className="flex items-center gap-1">
                          <Banknote className="w-3 h-3 text-amber-500" />
                          <span className="text-muted-foreground">Cash terkumpul:</span>
                          <span className="font-medium">{formatCurrency(c.cashCollected)}</span>
                        </div>
                        {c.piutang > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-red-400">📋</span>
                            <span className="text-muted-foreground">Piutang:</span>
                            <span className="font-medium text-red-500">{formatCurrency(c.piutang)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="pending">
        <TabsList className="overflow-x-auto flex scrollbar-hide">
          <TabsTrigger value="pending">
            Pending ({pendingDeliveries.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Selesai ({completedDeliveries.length})
          </TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="commission">
              Komisi
            </TabsTrigger>
          )}
        </TabsList>
        
        {/* Pending Tab */}
        <TabsContent value="pending" className="space-y-3">
          {pendingDeliveries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Tidak ada pengiriman pending</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
                <span>{pendingDeliveries.length} pengiriman pending</span>
                <span>•</span>
                <span>Total: <strong className="text-foreground">{formatCurrency(pendingDeliveries.reduce((s, t) => s + t.total, 0))}</strong></span>
              </div>
              {pendingDeliveries.map((t: Transaction) => {
                if (user?.role === 'kurir') {
                  return (
                    <PendingDeliveryCard 
                      key={t.id} 
                      transaction={t} 
                      courier={user} 
                      queryClient={queryClient}
                    />
                  );
                }
                const dist = t.deliveryDistance || t.customer?.distance || 'near';
                const isFar = dist === 'far';
                return (
                  <Card key={t.id}>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <h3 className="font-medium text-sm">{t.invoiceNo}</h3>
                            <Badge variant="outline" className="text-xs">{formatDate(t.transactionDate)}</Badge>
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
                            {t.remainingAmount > 0 && (
                              <Badge variant="outline" className="border-red-300 text-red-600 bg-red-50 text-xs">
                                💰 {formatCurrency(t.remainingAmount)}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground min-w-0 truncate">{t.customer?.name || 'Walk-in'}</p>
                          {t.customer?.phone && (
                            <p className="text-xs text-muted-foreground truncate">{t.customer.phone}</p>
                          )}
                          {t.deliveryAddress && (
                            <p className="text-xs mt-1 text-muted-foreground min-w-0 truncate">{t.deliveryAddress}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-sm">
                            <span className="font-medium">{formatCurrency(t.total)}</span>
                            {t.paymentMethod && (
                              <Badge variant="secondary" className="text-xs">
                                {getTransactionPaymentLabel(t.paymentMethod)}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground">Kurir:</span>
                            <span className="text-xs font-medium">{t.courier?.name || 'Belum ditugaskan'}</span>
                            {t.courier && (
                              <Badge variant="outline" className="text-xs">
                                <Wallet className="w-3 h-3 mr-1" />
                                Komisi: {formatCurrency(
                                  isFar
                                    ? (t.courier.farCommission || 0)
                                    : (t.courier.nearCommission || 0)
                                )}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </TabsContent>
        
        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-3">
          {completedDeliveries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Truck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Tidak ada pengiriman selesai</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-sm text-muted-foreground px-1">
                <span>{completedDeliveries.length} pengiriman selesai</span>
                <span>•</span>
                <span>Total: <strong className="text-foreground">{formatCurrency(completedDeliveries.reduce((s, t) => s + t.total, 0))}</strong></span>
                <span>•</span>
                <span>Komisi: <strong className="text-emerald-600">{formatCurrency(completedDeliveries.reduce((s, t) => s + (t.courierCommission || 0), 0))}</strong></span>
              </div>

              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3">
                  {completedDeliveries.map((t: Transaction) => {
                    const dist = t.deliveryDistance || t.customer?.distance || 'near';
                    const isFar = dist === 'far';
                    const commission = t.courierCommission || 0;
                    // Find delivery payment (received by courier)
                    const deliveryPayment = t.payments?.find((p: Payment) => p.receivedById === t.courierId);
                    return (
                      <Card key={t.id}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2 flex-wrap">
                                <h3 className="font-medium text-sm">{t.invoiceNo}</h3>
                                <Badge variant="outline" className="bg-green-500/10 text-green-500 text-xs">
                                  Selesai
                                </Badge>
                                <Badge variant="outline" className="text-xs">{formatDate(t.deliveredAt ? new Date(t.deliveredAt) : t.transactionDate)}</Badge>
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
                                {deliveryPayment && (
                                  <Badge variant="outline" className={cn(
                                    "text-xs",
                                    deliveryPayment.paymentMethod === 'cash'
                                      ? "border-amber-300 text-amber-600 bg-amber-50"
                                      : "border-blue-300 text-blue-600 bg-blue-50"
                                  )}>
                                    {getPaymentRecordLabel(deliveryPayment.paymentMethod)}
                                  </Badge>
                                )}
                                {!deliveryPayment && t.paymentStatus !== 'paid' && (
                                  <Badge variant="outline" className="border-red-300 text-red-600 bg-red-50 text-xs">
                                    📋 {getTransactionPaymentLabel(t.paymentMethod)}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground min-w-0 truncate">{t.customer?.name || 'Walk-in'}</p>
                              <div className="flex items-center gap-4 mt-1 text-sm">
                                <span>Total: <strong>{formatCurrency(t.total)}</strong></span>
                                {t.paymentStatus !== 'paid' && (
                                  <span className="text-red-600 text-xs">Sisa: {formatCurrency(t.remainingAmount)}</span>
                                )}
                              </div>
                              {deliveryPayment && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Dibayar saat kirim: {formatCurrency(deliveryPayment.amount)}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">Kurir:</span>
                                <span className="text-xs font-medium">{t.courier?.name || '-'}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              {user?.role === 'kurir' && commission > 0 && (
                                <p className="text-xs text-emerald-600 font-medium">
                                  + Komisi
                                </p>
                              )}
                              <p className="text-sm font-bold text-emerald-600">{formatCurrency(commission)}</p>
                              <p className="text-xs text-muted-foreground">
                                {t.deliveredAt ? formatDateTime(t.deliveredAt) : '-'}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </TabsContent>
        {/* Commission Tab - Super Admin Only */}
        {isSuperAdmin && (
          <TabsContent value="commission" className="space-y-4">
            {commissionSummary && commissionSummary.byCourier.length > 0 ? (
              <>
                {/* Top Summary Cards */}
                <div className="grid grid-cols-2 gap-3">
                  <Card className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                    <CardContent className="p-4">
                      <p className="text-emerald-100 text-xs">Total Komisi</p>
                      <p className="text-xl font-bold">{formatCurrency(commissionSummary.totalCommission)}</p>
                      <p className="text-emerald-200 text-xs mt-1">dari {commissionSummary.totalDeliveries} pengiriman</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                    <CardContent className="p-4">
                      <p className="text-amber-100 text-xs">Total Cash Terkumpul</p>
                      <p className="text-xl font-bold">{formatCurrency(
                        commissionSummary.byCourier.reduce((s, [, c]) => s + c.cashCollected, 0)
                      )}</p>
                      <p className="text-amber-200 text-xs mt-1">belum disetor ke brankas</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Detailed Per-Courier Table */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Detail Pendapatan per Kurir</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="max-h-[500px]">
                      <div className="space-y-3">
                        {commissionSummary.byCourier.map(([cId, c]) => (
                          <div key={cId} className="border rounded-xl p-4 space-y-3">
                            {/* Courier Header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                                  <Truck className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                  <p className="font-bold text-sm">{c.name}</p>
                                  <p className="text-xs text-muted-foreground">{c.totalDeliveries} pengiriman selesai</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-lg font-bold text-emerald-600">{formatCurrency(c.totalCommission)}</p>
                                <p className="text-xs text-muted-foreground">Total Komisi</p>
                              </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              <div className="p-2 rounded-lg bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">📍 Dekat</p>
                                <p className="text-sm font-bold">{c.nearDeliveries}</p>
                              </div>
                              <div className="p-2 rounded-lg bg-muted/50 text-center">
                                <p className="text-xs text-muted-foreground">🗺️ Jauh</p>
                                <p className="text-sm font-bold">{c.farDeliveries}</p>
                              </div>
                              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-center">
                                <p className="text-xs text-muted-foreground">💵 Cash</p>
                                <p className="text-sm font-bold text-amber-600">{formatCurrency(c.cashCollected)}</p>
                              </div>
                              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/20 text-center">
                                <p className="text-xs text-muted-foreground">📋 Piutang</p>
                                <p className="text-sm font-bold text-red-500">{formatCurrency(c.piutang)}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <BadgeCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Belum ada data komisi kurir</p>
                  <p className="text-xs mt-1">Komisi akan muncul setelah kurir menyelesaikan pengiriman</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

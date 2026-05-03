'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DollarSign,
  ShoppingCart,
  CircleDollarSign,
  Receipt,
  Target,
  Check,
  AlertOctagon,
  PhoneCall,
  UserMinus,
  MessageSquare,
  MapPin,
  Mail,
  RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/erp-helpers';
import { getPaymentStatusLabel } from './SharedComponents';

export default function SalesDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('month');
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'customers' | 'unpaid'>('transactions');
  const [followUpOpen, setFollowUpOpen] = useState<any>(null);
  const [followUpType, setFollowUpType] = useState('whatsapp');
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpOutcome, setFollowUpOutcome] = useState('');
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpHistoryOpen, setFollowUpHistoryOpen] = useState<any>(null);
  const [lostOpen, setLostOpen] = useState<any>(null);
  const [lostReason, setLostReason] = useState('');
  const [lostLoading, setLostLoading] = useState(false);

  // Fetch sales dashboard data
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sales-dashboard', user?.id, period],
    queryFn: () => apiFetch<any>(`/api/sales/dashboard?salesId=${user?.id}&period=${period}&unitId=${user?.unitId || ''}`),
    enabled: !!user?.id,
    ...POLLING_CONFIG
  });

  const personalStats = data?.personalStats || {};
  const companyStats = data?.companyStats || {};
  const target = data?.target;
  const inactiveCustomers = data?.inactiveCustomers || [];
  const recentTransactions = data?.recentTransactions || [];
  const unpaidTransactions = data?.unpaidTransactions || [];
  const chartData = data?.chartData || [];

  const achievedPercent = target && target.targetAmount > 0 ? Math.min(100, Math.round((target.achievedAmount / target.targetAmount) * 100)) : 0;
  const targetColor = achievedPercent >= 100 ? 'text-green-600' : achievedPercent >= 70 ? 'text-amber-600' : 'text-red-600';

  // Follow-up handler
  const handleFollowUp = async () => {
    if (!followUpOpen || !followUpNote.trim()) {
      toast.error('Catatan follow-up wajib diisi');
      return;
    }
    setFollowUpLoading(true);
    try {
      await apiFetch(`/api/customers/${followUpOpen.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({ type: followUpType, note: followUpNote, outcome: followUpOutcome || undefined, createdById: user?.id })
      });
      toast.success(`Follow-up ${followUpOpen.name} berhasil dicatat`);
      setFollowUpOpen(null);
      setFollowUpNote('');
      setFollowUpOutcome('');
      queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFollowUpLoading(false);
    }
  };

  // Lost handler
  const handleLost = async () => {
    if (!lostOpen || !lostReason.trim()) {
      toast.error('Alasan lost wajib diisi');
      return;
    }
    setLostLoading(true);
    try {
      await apiFetch(`/api/customers/${lostOpen.id}/lost`, {
        method: 'POST',
        body: JSON.stringify({ reason: lostReason })
      });
      toast.success(`${lostOpen.name} ditandai sebagai lost`);
      setLostOpen(null);
      setLostReason('');
      queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLostLoading(false);
    }
  };

  if (isLoading || !data) {
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

  return (
    <div className="space-y-3 sm:space-y-4 min-w-0 overflow-x-hidden">
      {/* Header & Period Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Dashboard Sales</h2>
          <p className="text-sm text-muted-foreground">Selamat datang, {user?.name}!</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['day', 'week', 'month'] as const).map(p => (
            <Button key={p} size="sm" variant={period === p ? 'default' : 'outline'} onClick={() => setPeriod(p)} className="shrink-0">
              {p === 'day' ? 'Hari Ini' : p === 'week' ? 'Minggu Ini' : 'Bulan Ini'}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => refetch()} className="shrink-0">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                <DollarSign className="w-4 h-4 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Penjualan Saya</p>
                <p className="text-sm sm:text-lg font-bold text-green-700 dark:text-green-300 truncate">{formatCurrency(personalStats.totalSales || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <ShoppingCart className="w-4 h-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Transaksi</p>
                <p className="text-sm sm:text-lg font-bold text-blue-700 dark:text-blue-300">{personalStats.totalTransactions || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <CircleDollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Sudah Dibayar</p>
                <p className="text-sm sm:text-lg font-bold text-emerald-700 dark:text-emerald-300 truncate">{formatCurrency(personalStats.totalPaid || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
          <CardContent className="p-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Belum Dibayar</p>
                <p className="text-sm sm:text-lg font-bold text-red-700 dark:text-red-300 truncate">{formatCurrency(personalStats.totalReceivables || 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Target Progress */}
      {target && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Target className="w-5 h-5 text-primary" />
                <CardTitle className="text-base">Target Penjualan</CardTitle>
                <Badge variant="outline">{target.period === 'monthly' ? 'Bulanan' : target.period === 'quarterly' ? 'Triwulan' : 'Tahunan'}</Badge>
              </div>
              <span className={cn('text-xl sm:text-2xl font-bold', targetColor)}>{achievedPercent}%</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={achievedPercent} className="h-3" />
            <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Target</p>
                <p className="font-semibold text-xs sm:text-sm">{formatCurrency(target.targetAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Tercapai</p>
                <p className="font-semibold text-green-600 text-xs sm:text-sm">{formatCurrency(target.achievedAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Sisa</p>
                <p className="font-semibold text-red-600 text-xs sm:text-sm">{formatCurrency(Math.max(0, target.targetAmount - target.achievedAmount))}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No target notice */}
      {!target && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-center">
            <Target className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Belum ada target penjualan untuk periode ini</p>
          </CardContent>
        </Card>
      )}

      {/* Company-wide stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Penjualan Perusahaan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:gap-4">
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Total Penjualan</p>
              <p className="text-sm sm:text-lg font-bold">{formatCurrency(companyStats.totalCompanySales || 0)}</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground">Total Transaksi</p>
              <p className="text-sm sm:text-lg font-bold">{companyStats.totalCompanyTransactions || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Transactions, Chart, Inactive Customers & Unpaid */}
      <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as typeof activeTab)}>
        {/* Mobile: Dropdown selector */}
        <div className="sm:hidden mb-1">
          <Select value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <SelectTrigger className="w-full h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transactions">
                Penjualan{recentTransactions.length > 0 ? ` (${recentTransactions.length})` : ''}
              </SelectItem>
              <SelectItem value="overview">Grafik</SelectItem>
              <SelectItem value="customers">
                Follow Up{inactiveCustomers.length > 0 ? ` (${inactiveCustomers.length})` : ''}
              </SelectItem>
              <SelectItem value="unpaid">
                Belum Bayar{unpaidTransactions.length > 0 ? ` (${unpaidTransactions.length})` : ''}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden sm:flex w-full overflow-x-auto scrollbar-hide">
          <TabsTrigger value="transactions" className="shrink-0 whitespace-nowrap text-xs sm:text-sm relative">
            Penjualan
            {recentTransactions.length > 0 && (
              <Badge className="ml-2 bg-green-500 text-white text-xs px-1.5">{recentTransactions.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="overview" className="shrink-0 whitespace-nowrap text-xs sm:text-sm">
            Grafik
          </TabsTrigger>
          <TabsTrigger value="customers" className="shrink-0 whitespace-nowrap text-xs sm:text-sm relative">
            Follow Up
            {inactiveCustomers.length > 0 && (
              <Badge className="ml-2 bg-red-500 text-white text-xs px-1.5">{inactiveCustomers.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="unpaid" className="shrink-0 whitespace-nowrap text-xs sm:text-sm relative">
            Belum Bayar
            {unpaidTransactions.length > 0 && (
              <Badge className="ml-2 bg-amber-500 text-white text-xs px-1.5">{unpaidTransactions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Transactions Tab (Detail Penjualan) */}
        <TabsContent value="transactions">
          <div className="space-y-2">
            {recentTransactions.length === 0 ? (
              <Card>
                <CardContent className="p-4 sm:p-6 text-center">
                  <ShoppingCart className="w-6 h-6 sm:w-8 sm:h-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-xs sm:text-sm text-muted-foreground">Belum ada transaksi penjualan untuk periode ini</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary bar */}
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground px-1 flex-wrap">
                  <span>{recentTransactions.length} transaksi</span>
                  <span>•</span>
                  <span>Total: <strong className="text-foreground">{formatCurrency(recentTransactions.reduce((sum: number, t: any) => sum + (t.total || 0), 0))}</strong></span>
                </div>
                {recentTransactions.map((t: any) => (
                  <Card key={t.id} className="hover:shadow-md transition-shadow overflow-hidden">
                    <CardContent className="p-2.5 sm:p-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium text-xs">{t.invoiceNo}</h3>
                          <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 py-0">{formatDate(t.transactionDate)}</Badge>
                          <Badge
                            variant={t.paymentStatus === 'paid' ? 'default' : t.paymentStatus === 'partial' ? 'outline' : 'destructive'}
                            className="text-[10px] sm:text-xs px-1.5 py-0"
                          >
                            {getPaymentStatusLabel(t.paymentStatus)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t.customer?.name || 'Walk-in'}{t.paymentMethod ? (
                            <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 py-0 ml-1.5">{t.paymentMethod === 'cash' ? '💵 Cash' : t.paymentMethod === 'piutang' ? '📋 Piutang' : '📅 Tempo'}</Badge>
                          ) : ''}
                        </p>
                        <div className="flex items-center gap-3 mt-1 text-xs sm:text-sm">
                          <span>Total: <strong>{formatCurrency(t.total)}</strong></span>
                          {t.paymentStatus !== 'unpaid' && (
                            <span className="text-green-600">✓ Paid: {formatCurrency(t.paidAmount)}</span>
                          )}
                          {t.paymentStatus !== 'paid' && (
                            <span className="text-red-600">Sisa: {formatCurrency(t.remainingAmount)}</span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            )}
          </div>
        </TabsContent>

        {/* Chart Tab */}
        <TabsContent value="overview">
          <Card>
            <CardContent className="p-2 sm:p-4">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}jt`} />
                    <RechartsTooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="sales" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  Belum ada data penjualan untuk periode ini
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inactive Customers Tab */}
        <TabsContent value="customers">
          <div className="space-y-2">
            {inactiveCustomers.length === 0 ? (
              <Card>
                <CardContent className="p-4 sm:p-6 text-center">
                  <Check className="w-6 h-6 sm:w-8 sm:h-8 mx-auto text-green-500 mb-2" />
                  <p className="text-xs sm:text-sm text-muted-foreground">Semua pelanggan aktif! Tidak ada yang perlu di-follow up.</p>
                </CardContent>
              </Card>
            ) : (
              inactiveCustomers.map((c: any) => (
                <Card key={c.id} className="border-amber-200 dark:border-amber-900 overflow-hidden">
                  <CardContent className="p-2.5 sm:p-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-medium text-xs">{c.name}</h3>
                          <Badge variant="outline" className="border-amber-300 text-amber-600 bg-amber-50 text-xs">
                            <AlertOctagon className="w-3 h-3 mr-1" />
                            {c.daysSinceLastTransaction} hari
                          </Badge>
                        </div>
                        {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        <p className="text-xs text-muted-foreground mt-1">
                          Transaksi terakhir: {c.lastTransactionDate ? formatDate(c.lastTransactionDate) : 'Belum pernah'}
                        </p>
                      </div>
                      <div className="flex gap-1 self-end">
                        <Button size="sm" variant="outline" className="h-8 text-xs sm:text-sm" onClick={() => setFollowUpOpen(c)}>
                          <PhoneCall className="w-3 h-3 mr-1" />
                          Follow Up
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs sm:text-sm text-red-500 hover:text-red-600 border-red-200" onClick={() => setLostOpen(c)}>
                          <UserMinus className="w-3 h-3 mr-1" />
                          Lost
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Unpaid Transactions Tab */}
        <TabsContent value="unpaid">
          <div className="space-y-2">
            {unpaidTransactions.length === 0 ? (
              <Card>
                <CardContent className="p-4 sm:p-6 text-center">
                  <Check className="w-6 h-6 sm:w-8 sm:h-8 mx-auto text-green-500 mb-2" />
                  <p className="text-xs sm:text-sm text-muted-foreground">Semua transaksi sudah lunas!</p>
                </CardContent>
              </Card>
            ) : (
              unpaidTransactions.map((t: any) => (
                <Card key={t.id} className="overflow-hidden">
                  <CardContent className="p-2.5 sm:p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-medium text-xs">{t.invoiceNo}</h3>
                        <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 py-0">{formatDate(t.transactionDate)}</Badge>
                        <Badge variant={t.paymentStatus === 'partial' ? 'outline' : 'destructive'} className="text-[10px] sm:text-xs px-1.5 py-0">
                          {getPaymentStatusLabel(t.paymentStatus)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t.customer?.name || 'Walk-in'}{t.paymentMethod ? (
                          <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 py-0 ml-1.5">{t.paymentMethod === 'cash' ? '💵 Cash' : t.paymentMethod === 'piutang' ? '📋 Piutang' : '📅 Tempo'}</Badge>
                        ) : ''}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs sm:text-sm">
                        <span>Total: <strong>{formatCurrency(t.total)}</strong></span>
                        <span className="text-green-600">✓ Paid: {formatCurrency(t.paidAmount)}</span>
                        <span className="text-red-600">Sisa: {formatCurrency(t.remainingAmount)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Follow-up Dialog */}
      <Dialog open={!!followUpOpen} onOpenChange={(open) => { if (!open) setFollowUpOpen(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Follow Up Pelanggan</DialogTitle>
            <DialogDescription>{followUpOpen?.name} — {followUpOpen?.phone || 'No phone'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Jenis Follow Up</Label>
              <Select value={followUpType} onValueChange={setFollowUpType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">
                    <span className="inline-flex items-center gap-2"><MessageSquare className="w-3 h-3" /> WhatsApp</span>
                  </SelectItem>
                  <SelectItem value="call">
                    <span className="inline-flex items-center gap-2"><PhoneCall className="w-3 h-3" /> Telepon</span>
                  </SelectItem>
                  <SelectItem value="visit">
                    <span className="inline-flex items-center gap-2"><MapPin className="w-3 h-3" /> Kunjungan</span>
                  </SelectItem>
                  <SelectItem value="email">
                    <span className="inline-flex items-center gap-2"><Mail className="w-3 h-3" /> Email</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hasil Follow Up</Label>
              <Select value={followUpOutcome} onValueChange={setFollowUpOutcome}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih hasil..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interested">Tertarik</SelectItem>
                  <SelectItem value="promised_to_order">Janji Order</SelectItem>
                  <SelectItem value="not_interested">Tidak Tertarik</SelectItem>
                  <SelectItem value="no_response">Tidak Merespons</SelectItem>
                  <SelectItem value="rescheduled">Dijadwalkan Ulang</SelectItem>
                  <SelectItem value="other">Lainnya</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} placeholder="Tulis catatan follow-up..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpOpen(null)}>Batal</Button>
            <Button onClick={handleFollowUp} disabled={followUpLoading || !followUpNote.trim()}>
              {followUpLoading ? 'Menyimpan...' : 'Simpan Follow Up'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lost Dialog */}
      <Dialog open={!!lostOpen} onOpenChange={(open) => { if (!open) setLostOpen(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Tandai Pelanggan Lost</DialogTitle>
            <DialogDescription>{lostOpen?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Alert className="border-red-300 bg-red-50">
              <UserMinus className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-800 text-sm">
                Pelanggan akan ditandai sebagai <strong>Lost</strong> dan tidak akan muncul di daftar pelanggan aktif. Super admin dapat me-recycle pelanggan ini nanti.
              </AlertDescription>
            </Alert>
            <div className="space-y-2">
              <Label>Alasan Lost *</Label>
              <Textarea value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Contoh: Tidak merespons, pindah supplier, dll..." rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostOpen(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleLost} disabled={lostLoading || !lostReason.trim()}>
              {lostLoading ? 'Menyimpan...' : 'Tandai Lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, Settings, ArrowDownCircle, Users, Link2,
  Copy, Check, RefreshCw, AlertCircle, Calculator,
  Search, CheckCircle2, XCircle, Clock, Eye,
  ChevronDown, ExternalLink, Pencil, Gift,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/erp-helpers';
import { api, apiFetch } from '@/lib/api-client';
import { LoadingFallback } from '@/components/error-boundary';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CashbackWithdrawalsTab from '@/components/erp/CashbackWithdrawalsTab';

// ============ STATUS BADGE HELPERS ============
function WithdrawalStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200',
    approved: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200',
    processed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200',
    rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200',
  };
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', variants[status] || '')}>
      {status === 'pending' && <Clock className="w-3 h-3 mr-1" />}
      {status === 'approved' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === 'processed' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {status === 'rejected' && <XCircle className="w-3 h-3 mr-1" />}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function ReferralStatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    new: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200',
    contacted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200',
    converted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200',
    lost: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200',
  };
  return (
    <Badge variant="outline" className={cn('text-xs font-medium', variants[status] || '')}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// ============ MAIN COMPONENT ============
export default function CashbackManagementModule() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('config');

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
          <Wallet className="w-5 h-5 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-lg truncate">Cashback Management</h2>
          <p className="text-sm text-muted-foreground break-words">Kelola cashback, pencairan, referral, dan link PWA pelanggan</p>
        </div>
      </div>

      {/* Mobile: Dropdown selector */}
      <div className="sm:hidden">
        <Select value={activeTab} onValueChange={setActiveTab}>
          <SelectTrigger className="w-full h-12 text-sm font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="config">
              <span className="inline-flex items-center gap-2"><Settings className="w-4 h-4" /><span>Konfigurasi</span></span>
            </SelectItem>
            <SelectItem value="withdrawals">
              <span className="inline-flex items-center gap-2"><ArrowDownCircle className="w-4 h-4" /><span>Pencairan</span></span>
            </SelectItem>
            <SelectItem value="referrals">
              <span className="inline-flex items-center gap-2"><Users className="w-4 h-4" /><span>Referensi</span></span>
            </SelectItem>
            <SelectItem value="pwa-links">
              <span className="inline-flex items-center gap-2"><Link2 className="w-4 h-4" /><span>Link PWA</span></span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: Tab buttons */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="hidden sm:flex w-full overflow-x-auto scrollbar-hide">
          <TabsTrigger value="config" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Settings className="w-3 h-3 sm:w-4 sm:h-4" />Konfigurasi
          </TabsTrigger>
          <TabsTrigger value="withdrawals" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <ArrowDownCircle className="w-3 h-3 sm:w-4 sm:h-4" />Pencairan
          </TabsTrigger>
          <TabsTrigger value="referrals" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Users className="w-3 h-3 sm:w-4 sm:h-4" />Referensi
          </TabsTrigger>
          <TabsTrigger value="pwa-links" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Link2 className="w-3 h-3 sm:w-4 sm:h-4" />Link PWA
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: KONFIGURASI ===== */}
        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>

        {/* ===== TAB 2: PENCAIRAN ===== */}
        <TabsContent value="withdrawals">
          <CashbackWithdrawalsWrapper />
        </TabsContent>

        {/* ===== TAB 3: REFERENSI ===== */}
        <TabsContent value="referrals">
          <ReferralsTab />
        </TabsContent>

        {/* ===== TAB 4: LINK PWA ===== */}
        <TabsContent value="pwa-links">
          <PWALinksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============ TAB 1: KONFIGURASI ============
function ConfigTab() {
  const queryClient = useQueryClient();
  const [migrationNeeded, setMigrationNeeded] = useState<boolean | null>(null);
  const [dbUrl, setDbUrl] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [editType, setEditType] = useState('percentage');
  const [editValue, setEditValue] = useState('');

  // Referral bonus config state
  const [refBonusType, setRefBonusType] = useState('nominal');
  const [refBonusValue, setRefBonusValue] = useState('0');
  const [savingRefBonus, setSavingRefBonus] = useState(false);

  // Check migration status
  const { data: migrationStatus } = useQuery({
    queryKey: ['pwa-migration-status'],
    queryFn: () => apiFetch<{ ready: boolean; tables: Record<string, boolean> }>('/api/migrate-customer-pwa'),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (migrationStatus) {
      setMigrationNeeded(!migrationStatus.ready);
    }
  }, [migrationStatus]);

  const runMigration = useCallback(async () => {
    if (!dbUrl.trim()) {
      toast.error('Database URL wajib diisi');
      return;
    }
    setMigrating(true);
    try {
      const res = await apiFetch<{ success: boolean; message: string }>('/api/migrate-customer-pwa', {
        method: 'POST',
        body: JSON.stringify({ databaseUrl: dbUrl.trim() }),
      });
      if (res.success) {
        toast.success(res.message || 'Migrasi berhasil!');
        queryClient.invalidateQueries({ queryKey: ['pwa-migration-status'] });
        queryClient.invalidateQueries({ queryKey: ['cashback-config'] });
        setMigrationNeeded(false);
      } else {
        toast.error(res.message || 'Migrasi gagal');
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal menjalankan migrasi');
    } finally {
      setMigrating(false);
    }
  }, [dbUrl, queryClient]);

  const { data: configData, isLoading } = useQuery({
    queryKey: ['cashback-config'],
    queryFn: () => api.cashback.getConfig(),
    enabled: migrationNeeded === false,
  });

  const stats = configData?.stats;
  const config = configData?.config;

  // Sync referral bonus config from server
  useEffect(() => {
    if (config) {
      setRefBonusType(config.referralBonusType || 'nominal');
      setRefBonusValue(String(config.referralBonusValue || 0));
    }
  }, [config]);

  // Save referral bonus config
  const handleSaveRefBonus = useCallback(async () => {
    const val = parseFloat(refBonusValue);
    if (isNaN(val) || val < 0) {
      toast.error('Nilai bonus referensi tidak valid');
      return;
    }
    setSavingRefBonus(true);
    try {
      await api.cashback.updateConfig({
        type: config?.type || 'percentage',
        value: config?.value || 0,
        maxCashback: config?.maxCashback || 0,
        minOrder: config?.minOrder || 0,
        referralBonusType: refBonusType,
        referralBonusValue: val,
      });
      toast.success('Konfigurasi bonus referensi berhasil disimpan');
      queryClient.invalidateQueries({ queryKey: ['cashback-config'] });
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan bonus referensi');
    } finally {
      setSavingRefBonus(false);
    }
  }, [refBonusType, refBonusValue, config, queryClient]);

  // Fetch customers with their cashback settings
  const { data: customersData, isLoading: isLoadingCustomers } = useQuery({
    queryKey: ['cashback-customers'],
    queryFn: async () => {
      const response = await apiFetch<{ customers: any[] }>('/api/customers');
      return Array.isArray(response?.customers) ? response.customers : [];
    },
    enabled: migrationNeeded === false,
  });

  const customers = customersData || [];

  // Filter customers by search
  const filteredCustomers = customers.filter((c: any) =>
    !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone?.includes(searchQuery)
  );

  // Quick update customer cashback
  const updateMutation = useMutation({
    mutationFn: ({ id, cashbackType, cashbackValue }: { id: string; cashbackType: string; cashbackValue: number }) =>
      apiFetch(`/api/customers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cashbackType, cashbackValue }),
      }),
    onSuccess: () => {
      toast.success('Cashback pelanggan berhasil diperbarui');
      queryClient.invalidateQueries({ queryKey: ['cashback-customers'] });
      queryClient.invalidateQueries({ queryKey: ['cashback-config'] });
      setEditCustomer(null);
    },
    onError: (err: any) => toast.error(err.message || 'Gagal update'),
  });

  const openEditDialog = (customer: any) => {
    setEditCustomer(customer);
    setEditType(customer.cashbackType || 'percentage');
    setEditValue(String(customer.cashbackValue || 0));
  };

  const handleSaveCashback = () => {
    if (!editCustomer) return;
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) {
      toast.error('Nilai cashback tidak valid');
      return;
    }
    updateMutation.mutate({
      id: editCustomer.id,
      cashbackType: editType,
      cashbackValue: val,
    });
  };

  if (migrationNeeded === null || (migrationNeeded && !configData)) {
    if (migrationNeeded) {
      return (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-5 h-5" />
              Migrasi Database Diperlukan
            </CardTitle>
            <CardDescription>
              Tabel cashback belum dibuat di database. Jalankan migrasi terlebih dahulu untuk menggunakan fitur Cashback Management.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Database Connection String (URI)</Label>
              <Input
                type="password"
                value={dbUrl}
                onChange={(e) => setDbUrl(e.target.value)}
                placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
                className="text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Dapatkan dari: Supabase Dashboard &rarr; Settings &rarr; Database &rarr; Connection string (URI)
              </p>
            </div>
            <Button onClick={runMigration} disabled={migrating || !dbUrl.trim()}>
              {migrating ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Menjalankan Migrasi...</>
              ) : (
                <><Settings className="w-4 h-4 mr-2" />Jalankan Migrasi</>
              )}
            </Button>
            {migrationStatus?.tables && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(migrationStatus.tables).map(([name, exists]) => (
                  <Badge key={name} variant={exists ? 'default' : 'destructive'} className="text-xs">
                    {name}: {exists ? '✓' : '✗'}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      );
    }
    return <LoadingFallback message="Memeriksa database..." />;
  }

  if (isLoading || isLoadingCustomers) {
    return <LoadingFallback message="Memuat konfigurasi cashback..." />;
  }

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 min-w-0">
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Saldo Cashback</p>
              <p className="text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-300">
                {formatCurrency(stats.totalCashbackOutstanding || 0)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Pelanggan Aktif</p>
              <p className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-300">
                {customers.length}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Total Dicairkan</p>
              <p className="text-lg sm:text-xl font-bold text-orange-700 dark:text-orange-300">
                {formatCurrency(stats.totalPendingAmount || 0)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
            <CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">Pencairan Pending</p>
              <p className="text-lg sm:text-xl font-bold text-purple-700 dark:text-purple-300">
                {stats.pendingWithdrawals || 0}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Info Card */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <Calculator className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Cashback Per Pelanggan</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Setiap pelanggan memiliki pengaturan cashback sendiri. Cashback akan diberikan otomatis pada setiap order
                sesuai tipe (persentase/nominal) yang sudah ditentukan. Atur cashback di halaman detail pelanggan masing-masing.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Customer Cashback Settings Table */}
      <Card className="min-w-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 shrink-0" />
            <span className="truncate">Cashback Per Pelanggan</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 min-w-0">
          {/* Search */}
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Cari pelanggan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto max-w-full">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b">
                  <th className="text-left p-3 font-medium text-xs text-muted-foreground">Pelanggan</th>
                  <th className="text-center p-3 font-medium text-xs text-muted-foreground">Tipe</th>
                  <th className="text-center p-3 font-medium text-xs text-muted-foreground">Nilai</th>
                  <th className="text-right p-3 font-medium text-xs text-muted-foreground">Saldo Cashback</th>
                  <th className="text-center p-3 font-medium text-xs text-muted-foreground w-16">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground text-xs">
                      Tidak ada data pelanggan
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c: any) => (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <p className="font-medium text-xs truncate max-w-[150px]">{c.name}</p>
                        <p className="text-[10px] text-muted-foreground">{c.phone || '-'}</p>
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className="text-xs">
                          {c.cashbackType === 'nominal' ? 'Rp Nominal' : '% Persentase'}
                        </Badge>
                      </td>
                      <td className="p-3 text-center font-medium text-xs">
                        {c.cashbackType === 'nominal'
                          ? formatCurrency(c.cashbackValue || 0)
                          : `${c.cashbackValue || 0}%`}
                      </td>
                      <td className="p-3 text-right font-medium text-emerald-600 dark:text-emerald-400 text-xs">
                        {formatCurrency(c.cashbackBalance || 0)}
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                          onClick={() => openEditDialog(c)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Referral Bonus Config Card */}
      <Card className="min-w-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Gift className="w-4 h-4 shrink-0" />
            <span className="truncate">Bonus Referensi</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Atur bonus cashback yang diberikan kepada pelanggan ketika referral berhasil dikonversi.
          </p>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Tipe Bonus</Label>
              <RadioGroup
                value={refBonusType}
                onValueChange={setRefBonusType}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="percentage" id="ref-pct" />
                  <Label htmlFor="ref-pct" className="text-sm cursor-pointer">Persentase (%)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="nominal" id="ref-nom" />
                  <Label htmlFor="ref-nom" className="text-sm cursor-pointer">Nominal (Rp)</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Nilai Bonus {refBonusType === 'percentage' ? '(%)' : '(Rp)'}
              </Label>
              <Input
                type="number"
                min="0"
                step={refBonusType === 'percentage' ? '0.1' : '500'}
                value={refBonusValue}
                onChange={(e) => setRefBonusValue(e.target.value)}
                placeholder={refBonusType === 'percentage' ? 'Contoh: 1' : 'Contoh: 10000'}
              />
            </div>
            {/* Preview */}
            {parseFloat(refBonusValue) > 0 && (
              <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 p-3">
                <p className="text-xs text-purple-700 dark:text-purple-300">
                  💡 Bonus per referral berhasil dikonversi:{' '}
                  <strong>
                    {refBonusType === 'percentage'
                      ? formatCurrency(Math.round(50000 * (parseFloat(refBonusValue) / 100)))
                      : formatCurrency(parseFloat(refBonusValue))}
                  </strong>
                  {refBonusType === 'percentage' && (
                    <span className="text-[10px] opacity-70"> (dari asumsi order Rp 50.000)</span>
                  )}
                </p>
              </div>
            )}
          </div>
          <Button onClick={handleSaveRefBonus} disabled={savingRefBonus}>
            {savingRefBonus ? 'Menyimpan...' : 'Simpan Bonus Referensi'}
          </Button>
        </CardContent>
      </Card>

      {/* Edit Cashback Dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(open) => !open && setEditCustomer(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Atur Cashback Pelanggan</DialogTitle>
            <DialogDescription>
              {editCustomer?.name} — Atur tipe dan nilai cashback yang akan diberikan pada setiap order.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Tipe Cashback</Label>
              <RadioGroup
                value={editType}
                onValueChange={setEditType}
                className="flex gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="percentage" id="cb-pct" />
                  <Label htmlFor="cb-pct" className="text-sm cursor-pointer">Persentase (%)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="nominal" id="cb-nom" />
                  <Label htmlFor="cb-nom" className="text-sm cursor-pointer">Nominal (Rp)</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Nilai Cashback {editType === 'percentage' ? '(%)' : '(Rp)'}
              </Label>
              <Input
                type="number"
                min="0"
                step={editType === 'percentage' ? '0.1' : '500'}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={editType === 'percentage' ? 'Contoh: 2' : 'Contoh: 5000'}
              />
            </div>
            {editType === 'percentage' && parseFloat(editValue) > 0 && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  💡 Contoh: Order Rp 1.000.000 → Cashback <strong>{formatCurrency(parseFloat(editValue) / 100 * 1000000)}</strong>
                </p>
              </div>
            )}
            {editType === 'nominal' && parseFloat(editValue) > 0 && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-3">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  💡 Setiap order akan mendapat cashback <strong>{formatCurrency(parseFloat(editValue))}</strong>
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomer(null)}>Batal</Button>
            <Button
              onClick={handleSaveCashback}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Menyimpan...' : 'Simpan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ TAB 2: PENCAIRAN (WITHDRAWALS) ============
// Wrapper yang fetch data finance (rekening, brankas, pool) lalu render CashbackWithdrawalsTab
// CashbackWithdrawalsTab sudah lengkap: pilih pool (HPP/Profit) + tujuan bayar (Rekening/Brankas)
function CashbackWithdrawalsWrapper() {
  // Fetch bank accounts untuk proses pencairan
  // API returns { bankAccounts: [...] }, so extract the array
  const { data: bankAccountsRaw, isError: isBankError, error: bankError } = useQuery({
    queryKey: ['bank-accounts-cashback'],
    queryFn: () => apiFetch<any>('/api/finance/bank-accounts'),
    staleTime: 30_000,
  });

  // Fetch cash boxes (brankas) untuk proses pencairan
  // API returns { cashBoxes: [...] }, so extract the array
  const { data: cashBoxesRaw, isError: isCashBoxError, error: cashBoxError } = useQuery({
    queryKey: ['cash-boxes-cashback'],
    queryFn: () => apiFetch<any>('/api/finance/cash-boxes'),
    staleTime: 30_000,
  });

  // Fetch pool balances (HPP & Profit paid)
  const { data: poolData, isError: isPoolError, error: poolError } = useQuery({
    queryKey: ['finance-pool-balances-cashback'],
    queryFn: () => apiFetch<any>('/api/finance/pools'),
    staleTime: 30_000,
  });

  // Collect any finance data errors to pass to the tab component
  const financeErrors: string[] = [];
  if (isBankError) financeErrors.push(`Rekening bank: ${(bankError as any)?.message || 'Gagal memuat'}`);
  if (isCashBoxError) financeErrors.push(`Brankas: ${(cashBoxError as any)?.message || 'Gagal memuat'}`);
  if (isPoolError) financeErrors.push(`Pool: ${(poolError as any)?.message || 'Gagal memuat'}`);
  const financeError = financeErrors.length > 0 ? financeErrors.join('; ') : null;

  // Bulletproof extraction: ensure we always get arrays regardless of API response shape
  // API returns { bankAccounts: [...] } or { cashBoxes: [...] }
  // Use Array.isArray to guarantee we have arrays before mapping
  const rawBankAccounts = bankAccountsRaw?.bankAccounts ?? bankAccountsRaw;
  const rawCashBoxes = cashBoxesRaw?.cashBoxes ?? cashBoxesRaw;
  const bankAccounts: any[] = Array.isArray(rawBankAccounts) ? rawBankAccounts : [];
  const cashBoxes: any[] = Array.isArray(rawCashBoxes) ? rawCashBoxes : [];

  const mappedBankAccounts = bankAccounts.map((ba: any) => ({
    id: ba.id,
    name: ba.name,
    bankName: ba.bankName || ba.bank_name,
    accountNo: ba.accountNo || ba.account_no,
    balance: ba.balance ?? 0,
  }));

  const mappedCashBoxes = cashBoxes.map((cb: any) => ({
    id: cb.id,
    name: cb.name,
    balance: cb.balance ?? 0,
  }));

  return (
    <CashbackWithdrawalsTab
      bankAccounts={mappedBankAccounts}
      cashBoxes={mappedCashBoxes}
      poolBalances={{
        hppPaidBalance: poolData?.hppPaidBalance ?? 0,
        profitPaidBalance: poolData?.profitPaidBalance ?? 0,
      }}
      financeError={financeError}
    />
  );
}

// ============ TAB 3: REFERENSI (REFERRALS) ============
function ReferralsTab() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [updateDialog, setUpdateDialog] = useState<{
    id: string;
    currentStatus: string;
    businessName: string;
    currentNotes?: string;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateNotes, setUpdateNotes] = useState('');

  const { data: referralsData, isLoading, refetch } = useQuery({
    queryKey: ['cashback-referrals', statusFilter],
    queryFn: () => api.cashback.getReferrals(statusFilter !== 'all' ? statusFilter : undefined),
  });

  const referrals = Array.isArray(referralsData?.referrals) ? referralsData.referrals : [];
  const rStats = referralsData?.stats || {};

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.cashback.updateReferral>[1] }) =>
      api.cashback.updateReferral(id, data),
    onSuccess: () => {
      toast.success('Status referral berhasil diupdate');
      queryClient.invalidateQueries({ queryKey: ['cashback-referrals'] });
      setUpdateDialog(null);
      setUpdateNotes('');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal update referral');
    },
  });

  const handleUpdateStatus = () => {
    if (!updateDialog || !updateStatus) return;
    updateMutation.mutate({
      id: updateDialog.id,
      data: { status: updateStatus, notes: updateNotes || undefined },
    });
  };

  const openUpdateDialog = (referral: any) => {
    setUpdateDialog({
      id: referral.id,
      currentStatus: referral.status,
      businessName: referral.businessName,
      currentNotes: referral.notes,
    });
    setUpdateStatus('');
    setUpdateNotes(referral.notes || '');
  };

  if (isLoading) {
    return <LoadingFallback message="Memuat data referral..." />;
  }

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 min-w-0">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg sm:text-xl font-bold text-slate-700 dark:text-slate-300">
              {rStats.total || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Baru</p>
            <p className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-300">
              {rStats.new || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Dihubungi</p>
            <p className="text-lg sm:text-xl font-bold text-amber-700 dark:text-amber-300">
              {rStats.contacted || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Konversi</p>
            <p className="text-lg sm:text-xl font-bold text-green-700 dark:text-green-300">
              {rStats.converted || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 col-span-2 sm:col-span-1">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Lost</p>
            <p className="text-lg sm:text-xl font-bold text-red-700 dark:text-red-300">
              {rStats.lost || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="new">Baru</SelectItem>
            <SelectItem value="contacted">Dihubungi</SelectItem>
            <SelectItem value="converted">Konversi</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3 mr-1" />
          Refresh
        </Button>
      </div>

      {/* Table */}
      <Card className="min-w-0">
        <CardContent className="p-0 min-w-0">
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Tanggal</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Pelanggan</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Bisnis</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">PIC</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Telepon</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Pelanggan Baru</th>
                  <th className="text-center p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap w-16 shrink-0">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-muted-foreground">
                      <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>Tidak ada data referral</p>
                    </td>
                  </tr>
                ) : (
                  referrals.map((r: any) => (
                    <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 whitespace-nowrap text-xs">
                        {formatDate(r.createdAt)}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <p className="font-medium truncate max-w-[120px]">{r.customer?.name || '-'}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <p className="truncate max-w-[120px]">{r.businessName || '-'}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <p className="text-xs">{r.picName || '-'}</p>
                      </td>
                      <td className="p-3 whitespace-nowrap text-xs">
                        {r.phone || '-'}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <ReferralStatusBadge status={r.status} />
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {r.referralCustomer ? (
                          <div>
                            <p className="text-xs font-medium truncate max-w-[120px]">{r.referralCustomer.name}</p>
                            <p className="text-[10px] text-muted-foreground">{r.referralCustomer.code}</p>
                            {r.referralCustomer.status === 'active' ? (
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 mt-0.5">Aktif</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5 bg-amber-50 text-amber-700 border-amber-200 mt-0.5">Prospect</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center justify-center">
                          {r.status === 'new' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openUpdateDialog(r)}
                            >
                              <ChevronDown className="w-3 h-3 mr-1" />
                              Update
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Update Status Dialog */}
      <Dialog open={!!updateDialog} onOpenChange={(open) => { if (!open) setUpdateDialog(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Update Status Referral</DialogTitle>
            <DialogDescription>
              {updateDialog?.businessName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Status Baru *</Label>
              <Select value={updateStatus} onValueChange={setUpdateStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contacted">Dihubungi</SelectItem>
                  <SelectItem value="converted">Konversi</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Catatan</Label>
              <Textarea
                value={updateNotes}
                onChange={(e) => setUpdateNotes(e.target.value)}
                placeholder="Tambah catatan (opsional)..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setUpdateDialog(null)}>Batal</Button>
            <Button onClick={handleUpdateStatus} disabled={!updateStatus || updateMutation.isPending}>
              {updateMutation.isPending ? 'Menyimpan...' : 'Update Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ TAB 4: LINK PWA ============
function PWALinksTab() {
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: customersData, isLoading } = useQuery({
    queryKey: ['customers-pwa-links'],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('limit', '100');
      return apiFetch<{ customers: any[] }>(`/api/customers?${params.toString()}`);
    },
  });

  const customers = (Array.isArray(customersData?.customers) ? customersData.customers : [])
    .filter((c: any) => c.code)
    .filter((c: any) =>
      !search.trim() ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.code && c.code.toLowerCase().includes(search.toLowerCase()))
    );

  const handleCopyLink = (code: string, customerId: string) => {
    const link = `${window.location.origin}/c/${code}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(customerId);
      toast.success('Link PWA berhasil disalin');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      toast.error('Gagal menyalin link');
    });
  };

  if (isLoading) {
    return <LoadingFallback message="Memuat data pelanggan..." />;
  }

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Info */}
      <Card className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20 min-w-0">
        <CardContent className="p-4 min-w-0">
          <div className="flex gap-3 min-w-0">
            <Link2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Link PWA Pelanggan</p>
              <p className="text-xs text-muted-foreground mt-1">
                Setiap pelanggan memiliki kode unik untuk mengakses PWA (Progressive Web App) mereka.
                Salin link dan bagikan ke pelanggan agar mereka bisa melihat cashback balance dan riwayat transaksi.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama pelanggan atau kode..."
          className="pl-9"
        />
      </div>

      {/* Table */}
      <Card className="min-w-0">
        <CardContent className="p-0 min-w-0">
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Pelanggan</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Kode</th>
                  <th className="text-right p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Saldo</th>
                  <th className="text-left p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Link PWA</th>
                  <th className="text-center p-2.5 sm:p-3 font-medium text-xs text-muted-foreground whitespace-nowrap w-16 shrink-0">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-muted-foreground">
                      <Link2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>Belum ada pelanggan dengan kode PWA</p>
                    </td>
                  </tr>
                ) : (
                  customers.map((c: any) => {
                    const pwaLink = `${window.location.origin}/c/${c.code}`;
                    return (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 whitespace-nowrap">
                          <p className="font-medium truncate max-w-[150px]">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone || ''}</p>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <Badge variant="outline" className="font-mono text-xs">
                            {c.code}
                          </Badge>
                        </td>
                        <td className="p-3 text-right whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(c.cashbackBalance || 0)}
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <a
                            href={pwaLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1 max-w-[200px] truncate"
                          >
                            {pwaLink}
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <div className="flex items-center justify-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleCopyLink(c.code, c.id)}
                            >
                              {copiedId === c.id ? (
                                <>
                                  <Check className="w-3 h-3 mr-1 text-green-600" />
                                  <span className="text-green-600">Disalin</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 mr-1" />
                                  Salin
                                </>
                              )}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}



'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Download,
  FileSpreadsheet,
  DollarSign,
  TrendingUp,
  ShoppingCart,
  Wallet,
  PackageIcon,
  Clock,
  Calendar,
  CalendarDays,
  Users,
  BarChart3,
  AlertTriangle,
  TrendingDown,
  Target,
  Zap,
  Plus,
  Pencil,
  Trash2,
  Activity,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import {
  formatCurrency,
  formatDate,
  formatStock,
  getInitials,
  toLocalDateStr,
  todayLocal,
  weekStartLocal,
  monthStartLocal,
} from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import type { Transaction, Product } from '@/types';
import { api, apiFetch } from '@/lib/api-client';
import { getPaymentStatusLabel } from './SharedComponents';
import SalesMetricsPanel from './SalesMetricsPanel';

export default function DashboardModule() {
  const { user } = useAuthStore();
  const { selectedUnitId, units } = useUnitStore();
  const queryClient = useQueryClient();
  
  const [dateRange, setDateRange] = useState({
    startDate: monthStartLocal(),
    endDate: todayLocal()
  });
  const [presetFilter, setPresetFilter] = useState<string>('bulan_ini');
  const [localUnitId, setLocalUnitId] = useState('');
  const [activeTab, setActiveTab] = useState('metrics');
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<any>(null);
  
  // Target form state
  const [targetUserId, setTargetUserId] = useState('');
  const [targetPeriod, setTargetPeriod] = useState('monthly');
  const [targetMonth, setTargetMonth] = useState(String(new Date().getMonth() + 1));
  const [targetYear, setTargetYear] = useState(String(new Date().getFullYear()));
  const [targetAmount, setTargetAmount] = useState('');
  const [targetNotes, setTargetNotes] = useState('');
  const [targetQuarter, setTargetQuarter] = useState('1');
  
  // Use local unit if set, otherwise use global selector
  const filterUnitId = localUnitId || selectedUnitId || '';
  
  const showProfit = user?.role === 'super_admin';
  
  // Fetch dashboard data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', filterUnitId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterUnitId) params.set('unitId', filterUnitId);
      params.set('startDate', dateRange.startDate);
      params.set('endDate', dateRange.endDate);
      const url = `/api/dashboard?${params.toString()}`;
      return apiFetch<{ dashboard: any }>(url);
    },
    ...POLLING_CONFIG
  });
  
  // Fetch transactions for report (only when transactions or overview tab is active)
  const { data: transactionsData } = useQuery({
    queryKey: ['transactions-report', dateRange, filterUnitId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      if (filterUnitId) params.set('unitId', filterUnitId);
      return apiFetch<{ transactions: any[] }>(`/api/transactions?${params.toString()}`);
    },
    enabled: activeTab === 'transactions' || activeTab === 'overview',
    ...POLLING_CONFIG
  });
  
  // Fetch products for report (only when products or overview tab is active)
  const { data: productsData } = useQuery({
    queryKey: ['products-report'],
    queryFn: () => apiFetch<{ products: any[] }>('/api/products'),
    enabled: activeTab === 'products' || activeTab === 'overview',
  });
  
  // Fetch sales users for target dialog
  const { data: usersData } = useQuery({
    queryKey: ['users-sales'],
    queryFn: () => api.users.getAll(),
    enabled: targetDialogOpen,
  });
  const salesUsers = useMemo(() =>
    (Array.isArray(usersData?.users) ? usersData.users : []).filter(
      (u: any) => u.role === 'sales' && u.isActive && u.status === 'approved'
    ),
    [usersData?.users]
  );
  
  // Fetch existing targets for target dialog
  const { data: targetsData } = useQuery({
    queryKey: ['sales-targets', targetYear, targetPeriod],
    queryFn: () => api.salesTargets.getAll({ year: Number(targetYear), period: targetPeriod }),
    enabled: targetDialogOpen,
  });
  const existingTargets = Array.isArray(targetsData?.targets) ? targetsData.targets : [];
  
  const dashboard = data?.dashboard;
  const transactions = Array.isArray(transactionsData?.transactions) ? transactionsData.transactions : [];
  const products = Array.isArray(productsData?.products) ? productsData.products : [];
  
  // Reset & open target dialog
  const openTargetDialog = (target?: any) => {
    if (target) {
      setEditingTarget(target);
      setTargetUserId(target.userId);
      setTargetPeriod(target.period);
      setTargetYear(String(target.year));
      setTargetMonth(target.month ? String(target.month) : '1');
      setTargetAmount(String(target.targetAmount));
      setTargetNotes(target.notes || '');
      setTargetQuarter(target.quarter ? String(target.quarter) : '1');
    } else {
      setEditingTarget(null);
      setTargetUserId('');
      setTargetPeriod('monthly');
      setTargetYear(String(new Date().getFullYear()));
      setTargetMonth(String(new Date().getMonth() + 1));
      setTargetQuarter('1');
      setTargetAmount('');
      setTargetNotes('');
    }
    setTargetDialogOpen(true);
  };
  
  // Create/Update target mutation
  const saveTargetMutation = useMutation({
    mutationFn: async (form: any) => {
      if (editingTarget) {
        return api.salesTargets.update(editingTarget.id, {
          targetAmount: Number(form.targetAmount),
          notes: form.notes || undefined,
        });
      }
      return api.salesTargets.create({
        userId: form.userId,
        period: form.period,
        year: Number(form.year),
        month: form.period === 'monthly' ? Number(form.month) : 0,
        quarter: form.period === 'quarterly' ? Number(form.quarter) : 0,
        targetAmount: Number(form.targetAmount),
        notes: form.notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales-targets'] });
      setTargetDialogOpen(false);
      toast.success(editingTarget ? 'Target berhasil diperbarui' : 'Target berhasil ditambahkan');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal menyimpan target');
    },
  });
  
  // Delete target mutation
  const deleteTargetMutation = useMutation({
    mutationFn: (id: string) => api.salesTargets.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['sales-targets'] });
      setTargetDialogOpen(false);
      toast.success('Target berhasil dihapus');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal menghapus target');
    },
  });
  
  const handleSaveTarget = () => {
    if (!editingTarget && !targetUserId) {
      toast.error('Pilih sales terlebih dahulu');
      return;
    }
    if (!targetAmount || Number(targetAmount) <= 0) {
      toast.error('Target amount harus lebih dari 0');
      return;
    }
    saveTargetMutation.mutate({
      userId: targetUserId,
      period: targetPeriod,
      year: targetYear,
      month: targetMonth,
      quarter: targetQuarter,
      targetAmount,
      notes: targetNotes,
    });
  };
  
  // Quick date filter helper
  const applyPreset = useCallback((preset: string) => {
    const todayStr = todayLocal();
    let startDate = todayStr;
    let endDate = todayStr;

    if (preset === 'hari_ini') {
      startDate = todayStr;
      endDate = todayStr;
    } else if (preset === 'minggu_ini') {
      startDate = weekStartLocal();
      endDate = todayStr;
    } else if (preset === 'bulan_ini') {
      startDate = monthStartLocal();
      endDate = todayStr;
    }

    setDateRange({ startDate, endDate });
    setPresetFilter(preset);
  }, []);

  // Calculate filtered statistics
  const filteredStats = useMemo(() => {
    const filtered = transactions.filter((t: Transaction) => {
      const tDate = new Date(t.transactionDate);
      const start = new Date(dateRange.startDate);
      const end = new Date(dateRange.endDate);
      end.setHours(23, 59, 59, 999);
      return tDate >= start && tDate <= end && t.status !== 'cancelled';
    });
    
    const salesFiltered = filtered.filter((t: Transaction) => t.type === 'sale');
    
    const totalSales = salesFiltered.reduce((sum: number, t: Transaction) => sum + t.total, 0);
    const totalProfit = salesFiltered.reduce((sum: number, t: Transaction) => sum + t.totalProfit, 0);
    const totalHpp = salesFiltered.reduce((sum: number, t: Transaction) => sum + t.totalHpp, 0);
    const totalTransactions = filtered.length;
    const totalPaid = filtered.reduce((sum: number, t: Transaction) => sum + t.paidAmount, 0);
    const totalReceivables = filtered.reduce((sum: number, t: Transaction) => sum + t.remainingAmount, 0);
    
    // HPP & Profit breakdown
    const hppInHand = salesFiltered.reduce((sum: number, t: Transaction) => sum + (t.hppPaid || 0), 0);
    const hppUnpaid = salesFiltered.reduce((sum: number, t: Transaction) => sum + (t.hppUnpaid || 0), 0);
    const profitInHand = salesFiltered.reduce((sum: number, t: Transaction) => sum + (t.profitPaid || 0), 0);
    const profitUnpaid = salesFiltered.reduce((sum: number, t: Transaction) => sum + (t.profitUnpaid || 0), 0);
    
    return { 
      totalSales, 
      totalProfit, 
      totalHpp,
      totalTransactions, 
      totalPaid, 
      totalReceivables, 
      hppInHand,
      hppUnpaid,
      profitInHand,
      profitUnpaid,
      filtered 
    };
  }, [transactions, dateRange]);
  
  // CSV Export functions
  const exportToCSV = useCallback((data: any[], filename: string) => {
    if (data.length === 0) {
      toast.error('Tidak ada data untuk diexport');
      return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(h => {
          const val = row[h];
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) return `"${val.replace(/"/g, '""')}"`;
          return val ?? '';
        }).join(',')
        )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${dateRange.startDate}_${dateRange.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success('CSV berhasil didownload');
  }, [dateRange]);
  
  const exportTransactionsCSV = useCallback(() => {
    const exportData = filteredStats.filtered.map((t: Transaction) => ({
      Invoice: t.invoiceNo,
      Tanggal: format(new Date(t.transactionDate), 'dd/MM/yyyy'),
      Tipe: t.type,
      Customer: t.customer?.name || '-',
      Unit: t.unit?.name || '-',
      Total: t.total,
      Terbayar: t.paidAmount,
      Sisa: t.remainingAmount,
      Profit: t.totalProfit,
      Status: t.status
    }));
    exportToCSV(exportData, 'transaksi');
  }, [filteredStats, exportToCSV]);
  
  const exportProductsCSV = useCallback(() => {
    const exportData = products.map((p: Product) => ({
      Nama: p.name,
      SKU: p.sku || '-',
      Kategori: p.category || '-',
      Stok: formatStock(p.globalStock, p.unit, p.subUnit, p.conversionRate),
      'Stok Min': p.minStock,
      'HPP/Satuan': (p.avgHpp || 0) * (p.conversionRate || 1),
      Status: p.globalStock <= p.minStock ? 'Rendah' : 'Normal'
    }));
    exportToCSV(exportData, 'produk');
  }, [products, exportToCSV]);
  
  const exportSummaryCSV = useCallback(() => {
    const exportData = [
      { Metrik: 'Total Penjualan', Nilai: filteredStats.totalSales },
      { Metrik: 'Total Profit', Nilai: filteredStats.totalProfit },
      { Metrik: 'Total HPP', Nilai: filteredStats.totalHpp },
      { Metrik: 'Total Transaksi', Nilai: filteredStats.totalTransactions },
      { Metrik: 'Total Terbayar', Nilai: filteredStats.totalPaid },
      { Metrik: 'Total Piutang', Nilai: filteredStats.totalReceivables },
      { Metrik: 'Total HPP Dibayar', Nilai: filteredStats.hppInHand },
      { Metrik: 'HPP Belum Terbayar', Nilai: filteredStats.hppUnpaid },
      { Metrik: 'Total Profit Dibayar', Nilai: filteredStats.profitInHand },
      { Metrik: 'Profit Belum Terbayar', Nilai: filteredStats.profitUnpaid }
    ];
    exportToCSV(exportData, 'ringkasan');
  }, [filteredStats, exportToCSV]);
  
  const exportHppProfitCSV = useCallback(() => {
    const exportData = [
      { Kategori: 'Total HPP Dibayar', Jumlah: filteredStats.hppInHand, Keterangan: 'Modal sudah dibayar customer' },
      { Kategori: 'HPP Belum Terbayar', Jumlah: filteredStats.hppUnpaid, Keterangan: 'Modal belum diterima dari piutang' },
      { Kategori: 'Total Profit Dibayar', Jumlah: filteredStats.profitInHand, Keterangan: 'Keuntungan sudah diterima' },
      { Kategori: 'Profit Belum Terbayar', Jumlah: filteredStats.profitUnpaid, Keterangan: 'Keuntungan belum diterima' },
      { Kategori: 'Total HPP', Jumlah: filteredStats.hppInHand + filteredStats.hppUnpaid, Keterangan: 'Total modal' },
      { Kategori: 'Total Profit', Jumlah: filteredStats.profitInHand + filteredStats.profitUnpaid, Keterangan: 'Total keuntungan' }
    ];
    exportToCSV(exportData, 'hpp_profit');
  }, [filteredStats, exportToCSV]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse h-20 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>Gagal memuat data dashboard</AlertDescription>
      </Alert>
    );
  }
  
  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card>
        <CardContent className="p-2">
          <div className="flex flex-wrap gap-2 items-end">
            {/* Period Dropdown (Hari Ini / Minggu Ini / Bulan Ini / Custom) */}
            <div className="space-y-0.5">
              <Label className="text-[10px]">Periode</Label>
              <Select
                value={presetFilter || 'custom'}
                onValueChange={v => {
                  if (v === 'custom') {
                    setPresetFilter('');
                  } else {
                    applyPreset(v);
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-36 h-7 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hari_ini">
                    <span className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Hari Ini</span>
                  </SelectItem>
                  <SelectItem value="minggu_ini">
                    <span className="flex items-center gap-1.5"><CalendarDays className="w-3 h-3" /> Minggu Ini</span>
                  </SelectItem>
                  <SelectItem value="bulan_ini">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Bulan Ini</span>
                  </SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(!presetFilter) && (
              <>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Tanggal</Label>
                  <Input
                    type="date"
                    value={dateRange.startDate}
                    onChange={e => { setDateRange({ ...dateRange, startDate: e.target.value }); setPresetFilter(''); }}
                    className="w-full sm:w-32 h-7 text-[10px]"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Sampai</Label>
                  <Input
                    type="date"
                    value={dateRange.endDate}
                    onChange={e => { setDateRange({ ...dateRange, endDate: e.target.value }); setPresetFilter(''); }}
                    className="w-full sm:w-32 h-7 text-[10px]"
                  />
                </div>
              </>
            )}
            
            <div className="flex-1" />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-[10px] px-2">
                  <Download className="w-3 h-3 mr-1" />
                  Export CSV
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={exportSummaryCSV}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Ringkasan
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportTransactionsCSV}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Transaksi
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportProductsCSV}>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Produk & Stok
                </DropdownMenuItem>
                {showProfit && (
                  <DropdownMenuItem onClick={exportHppProfitCSV}>
                    <DollarSign className="w-4 h-4 mr-2" />
                    HPP & Profit
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
      
      {/* Stats Grid - Filtered (equal width columns) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
              <DollarSign className="w-4 h-4 text-green-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Penjualan (Periode)</p>
              <p className="text-sm sm:text-lg font-bold text-green-700 dark:text-green-300 truncate">{formatCurrency(dashboard?.totalSales || 0)}</p>
            </div>
          </CardContent>
        </Card>
        
        {showProfit && (
          <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
            <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
              <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground truncate">Profit (Periode)</p>
                <p className="text-sm sm:text-lg font-bold text-emerald-700 dark:text-emerald-300 truncate">{formatCurrency(dashboard?.totalProfit || 0)}</p>
              </div>
            </CardContent>
          </Card>
        )}
        
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
              <ShoppingCart className="w-4 h-4 text-blue-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Transaksi (Periode)</p>
              <p className="text-sm sm:text-lg font-bold text-blue-700 dark:text-blue-300">{Number(dashboard?.totalTransactions) || 0}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-950 dark:to-rose-900">
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 text-rose-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Piutang (Periode)</p>
              <p className="text-sm sm:text-lg font-bold text-rose-700 dark:text-rose-300 truncate">{formatCurrency(dashboard?.totalReceivables || 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Quick Stats Row (equal width columns) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card>
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
              <PackageIcon className="w-4 h-4 text-purple-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Stok Rendah</p>
              <p className="text-sm sm:text-lg font-bold">{Number(dashboard?.lowStockProducts) || 0}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-amber-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Pending Approval</p>
              <p className="text-sm sm:text-lg font-bold">{Number(dashboard?.pendingApprovals) || 0}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-teal-500/10 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-teal-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">User Online</p>
              <p className="text-sm sm:text-lg font-bold">{Number(dashboard?.onlineUsers) || 0}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 flex items-center gap-2 min-h-[60px]">
            <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground truncate">Bulan Ini</p>
              <p className="text-sm sm:text-lg font-bold truncate">{formatCurrency(dashboard?.monthlySales || 0)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* HPP & Profit Breakdown - Super Admin Only */}
      {showProfit && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-500" />
              Laporan HPP & Profit
            </CardTitle>
            <CardDescription>Breakdown modal dan keuntungan berdasarkan pembayaran</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              {/* Total HPP Dibayar */}
              <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center">
                    <DollarSign className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <span className="text-xs text-muted-foreground">Total HPP Dibayar</span>
                </div>
                <p className="text-base sm:text-xl font-bold text-green-700 dark:text-green-300">{formatCurrency(dashboard?.hppInHand || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Modal sudah dibayar</p>
              </div>
              
              {/* HPP Unpaid */}
              <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-orange-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
                  </div>
                  <span className="text-xs text-muted-foreground">HPP Belum Terbayar</span>
                </div>
                <p className="text-base sm:text-xl font-bold text-orange-700 dark:text-orange-300">{formatCurrency(dashboard?.hppUnpaid || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Modal belum diterima</p>
              </div>
              
              {/* Total Profit Dibayar */}
              <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  </div>
                  <span className="text-xs text-muted-foreground">Total Profit Dibayar</span>
                </div>
                <p className="text-base sm:text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(dashboard?.profitInHand || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Profit sudah diterima</p>
              </div>
              
              {/* Profit Unpaid */}
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950 border border-rose-200 dark:border-rose-800">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-rose-500/20 flex items-center justify-center">
                    <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
                  </div>
                  <span className="text-xs text-muted-foreground">Profit Belum Terbayar</span>
                </div>
                <p className="text-base sm:text-xl font-bold text-rose-700 dark:text-rose-300">{formatCurrency(dashboard?.profitUnpaid || 0)}</p>
                <p className="text-xs text-muted-foreground mt-1">Profit belum diterima</p>
              </div>
            </div>
            
            {/* Summary Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total HPP</p>
                <p className="font-bold text-xs sm:text-sm">{formatCurrency((dashboard?.hppInHand || 0) + (dashboard?.hppUnpaid || 0))}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Total Profit</p>
                <p className="font-bold text-emerald-600 text-xs sm:text-sm">{formatCurrency((dashboard?.profitInHand || 0) + (dashboard?.profitUnpaid || 0))}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Rasio HPP Terbayar</p>
                <p className="font-bold text-xs sm:text-sm">
                  {(dashboard?.hppInHand || 0) + (dashboard?.hppUnpaid || 0) > 0 
                    ? (((dashboard?.hppInHand || 0) / ((dashboard?.hppInHand || 0) + (dashboard?.hppUnpaid || 0))) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Rasio Profit Diterima</p>
                <p className="font-bold text-emerald-600 text-xs sm:text-sm">
                  {(dashboard?.profitInHand || 0) + (dashboard?.profitUnpaid || 0) > 0 
                    ? (((dashboard?.profitInHand || 0) / ((dashboard?.profitInHand || 0) + (dashboard?.profitUnpaid || 0))) * 100).toFixed(1)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Sales Target - Super Admin Only */}
      {showProfit && (dashboard?.salesTargets || []).length > 0 && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-5 h-5 text-primary" />
                  Target Penjualan Bulan Ini
                </CardTitle>
                <CardDescription className="mt-0.5">Pencapaian target sales tim bulan {new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</CardDescription>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => openTargetDialog()}>
                <Plus className="w-4 h-4" />
                Atur Target
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Total Team Progress */}
            <div className="p-3 rounded-lg bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Total Pencapaian Tim</span>
                  {dashboard.superAdminContribution > 0 && (
                    <Badge className="bg-violet-500 hover:bg-violet-600 text-xs">
                      <Zap className="w-3 h-3 mr-1" />
                      +{formatCurrency(dashboard.superAdminContribution)} Admin
                    </Badge>
                  )}
                </div>
                <span className={cn(
                  "text-xl sm:text-2xl font-bold",
                  dashboard.totalPercent >= 100 ? "text-green-600" : dashboard.totalPercent >= 70 ? "text-amber-600" : "text-red-600"
                )}>
                  {dashboard.totalPercent}%
                </span>
              </div>
              <Progress value={Math.min(dashboard.totalPercent, 100)} className="h-3" />
              <div className="flex flex-wrap gap-1 justify-between mt-2 text-xs sm:text-sm">
                <span className="text-muted-foreground">
                  {formatCurrency(dashboard.totalWithAdmin)} dari {formatCurrency(dashboard.totalTarget)}
                </span>
                <span className="text-muted-foreground">
                  Sisa: {formatCurrency(Math.max(0, dashboard.totalTarget - dashboard.totalWithAdmin))}
                </span>
              </div>
            </div>

            {/* Individual Sales Targets */}
            <div className="space-y-3">
              {(dashboard.salesTargets || []).map((t: any) => (
                <div key={t.id} className="p-2 rounded-lg border bg-card">
                  <div className="flex items-center justify-between mb-1.5 min-w-0">
                    <span className="font-medium text-sm truncate">{t.userName}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openTargetDialog(t)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <span className={cn(
                        "text-sm font-semibold",
                        t.percent >= 100 ? "text-green-600" : t.percent >= 70 ? "text-amber-600" : "text-red-600"
                      )}>
                        {t.percent}%
                      </span>
                    </div>
                  </div>
                  <Progress value={Math.min(t.percent, 100)} className="h-2" />
                  <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                    <span>Achieved: {formatCurrency(t.achievedAmount)}</span>
                    <span>Target: {formatCurrency(t.targetAmount)}</span>
                  </div>
                  {t.remaining > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      Kurang {formatCurrency(t.remaining)} lagi
                    </p>
                  )}
                  {t.percent >= 100 && (
                    <p className="text-xs text-green-600 mt-1">
                      ✅ Target tercapai!
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Super Admin Contribution Note */}
            {dashboard.superAdminContribution > 0 && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800">
                <Zap className="w-4 h-4 text-violet-600 shrink-0" />
                <p className="text-xs text-violet-700 dark:text-violet-300">
                  <span className="font-medium">Super Admin</span> juga berkontribusi penjualan sebesar {formatCurrency(dashboard.superAdminContribution)} bulan ini, membantu mendongkrak pencapaian tim!
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* No Target Notice - Super Admin Only */}
      {showProfit && (!dashboard?.salesTargets || dashboard.salesTargets.length === 0) && (
        <Card className="border-dashed border-muted-foreground/25">
          <CardContent className="py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Target className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Target Penjualan Belum Diatur</p>
                <p className="text-xs text-muted-foreground">Klik tombol untuk mengatur target penjualan sales.</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={() => openTargetDialog()}>
              <Plus className="w-4 h-4" />
              Atur Target
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Tabs for detailed data */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Mobile: Dropdown selector */}
        <div className="sm:hidden mb-2">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih menu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="metrics">Metrics Penjualan</SelectItem>
              <SelectItem value="overview">Grafik</SelectItem>
              <SelectItem value="transactions">Transaksi</SelectItem>
              <SelectItem value="products">Produk</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: Tab buttons */}
        <TabsList className="hidden sm:grid w-full grid-cols-5">
          <TabsTrigger value="metrics" className="text-xs sm:text-sm">Metrics</TabsTrigger>
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Grafik</TabsTrigger>
          <TabsTrigger value="transactions" className="text-xs sm:text-sm">Transaksi</TabsTrigger>
          <TabsTrigger value="products" className="text-xs sm:text-sm">Produk</TabsTrigger>
          <TabsTrigger value="sales" className="text-xs sm:text-sm">Sales</TabsTrigger>
        </TabsList>
        
        {/* Metrics Tab — Sales Analytics */}
        <TabsContent value="metrics">
          {showProfit && <SalesMetricsPanel dateRange={dateRange} unitId={filterUnitId} />}
          {!showProfit && (
            <Card>
              <CardContent className="p-6 text-center">
                <Activity className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Metrics hanya tersedia untuk Super Admin</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs sm:text-base">Grafik Penjualan (7 Hari)</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3 min-h-[100px] sm:min-h-[200px]">
                <ResponsiveContainer width="100%" height={100}>
                  <BarChart data={dashboard?.chartData || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={v => v.slice(5)} fontSize={10} />
                    <YAxis tickFormatter={v => `${(v/1000).toFixed(0)}k`} fontSize={10} />
                    <RechartsTooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="sales" fill="#10b981" name="Penjualan" />
                    {showProfit && <Bar dataKey="profit" fill="#3b82f6" name="Profit" />}
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs sm:text-base">Top 5 Produk</CardTitle>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <div className="space-y-1.5">
                  {(dashboard?.topProducts || []).map((p: any, i: number) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <div className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0",
                        i === 0 ? "bg-amber-500" : i === 1 ? "bg-slate-400" : i === 2 ? "bg-amber-700" : "bg-muted"
                      )}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs sm:text-sm truncate">{p.name}</p>
                      </div>
                      <p className="font-semibold text-xs min-w-0 truncate">{formatCurrency(p.revenue)}</p>
                    </div>
                  ))}
                  {(!dashboard?.topProducts || dashboard.topProducts.length === 0) && (
                    <p className="text-center text-muted-foreground py-3 text-xs">Belum ada data</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
          
          {/* Realisasi Penjualan — Tunai vs Piutang */}
          <Card>
            <CardHeader className="py-2 px-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-base">Realisasi Penjualan</CardTitle>
                <Wallet className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Tunai vs Piutang dari total penjualan</p>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-3">
              {/* Total */}
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total Penjualan</p>
                <p className="text-base sm:text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(dashboard?.totalSales || 0)}</p>
              </div>
              {/* Progress bar */}
              {(dashboard?.totalSales || 0) > 0 && (
                <div>
                  <div className="h-3 rounded-full overflow-hidden bg-muted flex">
                    <div
                      className="bg-emerald-500 transition-all duration-500"
                      style={{ width: `${((dashboard?.totalPaid || 0) / (dashboard?.totalSales || 0)) * 100}%` }}
                    />
                    <div
                      className="bg-amber-500 transition-all duration-500"
                      style={{ width: `${((dashboard?.totalReceivables || 0) / (dashboard?.totalSales || 0)) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                    <span>Tunai {(((dashboard?.totalPaid || 0) / (dashboard?.totalSales || 0)) * 100).toFixed(0)}%</span>
                    <span>Piutang {(((dashboard?.totalReceivables || 0) / (dashboard?.totalSales || 0)) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
              {/* Detail rows */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Tunai Diterima</p>
                  <p className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(dashboard?.totalPaid || 0)}</p>
                  <p className="text-[10px] text-muted-foreground">{Number(dashboard?.totalTransactions || 0) > 0 ? `${Number(dashboard?.totalTransactions)} transaksi` : '-'}</p>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Piutang Belum</p>
                  <p className="text-xs sm:text-sm font-bold text-amber-700 dark:text-amber-300">{formatCurrency(dashboard?.totalReceivables || 0)}</p>
                  <p className="text-[10px] text-muted-foreground">{(dashboard?.totalReceivables || 0) > 0 ? 'Belum ditagih' : 'Lunas semua'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Komposisi Laba — HPP vs Profit — Super Admin Only */}
          {showProfit && (
          <Card>
            <CardHeader className="py-2 px-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs sm:text-base">Komposisi Laba</CardTitle>
                <TrendingUp className="w-4 h-4 text-purple-500" />
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground">HPP vs Profit dari penjualan</p>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-3">
              {/* Total */}
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground">Total Laba Kotor</p>
                <p className="text-base sm:text-xl font-bold text-purple-700 dark:text-purple-300">{formatCurrency(dashboard?.totalProfit || 0)}</p>
              </div>
              {/* Progress bar */}
              {(dashboard?.totalHpp || 0) > 0 && (
                <div>
                  <div className="h-3 rounded-full overflow-hidden bg-muted flex">
                    <div
                      className="bg-purple-500 transition-all duration-500"
                      style={{ width: `${((dashboard?.totalHpp || 0) / ((dashboard?.totalHpp || 0) + (dashboard?.totalProfit || 0))) * 100}%` }}
                    />
                    <div
                      className="bg-teal-500 transition-all duration-500"
                      style={{ width: `${((dashboard?.totalProfit || 0) / ((dashboard?.totalHpp || 0) + (dashboard?.totalProfit || 0))) * 100}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                    <span>HPP {(((dashboard?.totalHpp || 0) / ((dashboard?.totalHpp || 0) + (dashboard?.totalProfit || 0))) * 100).toFixed(0)}%</span>
                    <span>Profit {(((dashboard?.totalProfit || 0) / ((dashboard?.totalHpp || 0) + (dashboard?.totalProfit || 0))) * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
              {/* Detail rows */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg bg-purple-50 dark:bg-purple-950/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Total HPP</p>
                  <p className="text-xs sm:text-sm font-bold text-purple-700 dark:text-purple-300">{formatCurrency(dashboard?.totalHpp || 0)}</p>
                  <p className="text-[10px] text-muted-foreground">Modal produk</p>
                </div>
                <div className="rounded-lg bg-teal-50 dark:bg-teal-950/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Total Profit</p>
                  <p className="text-xs sm:text-sm font-bold text-teal-700 dark:text-teal-300">{formatCurrency(dashboard?.totalProfit || 0)}</p>
                  <p className="text-[10px] text-muted-foreground">Keuntungan</p>
                </div>
              </div>
              {/* Margin */}
              {(dashboard?.totalSales || 0) > 0 && (
                <div className="rounded-lg bg-muted/50 p-2 text-center">
                  <p className="text-[10px] text-muted-foreground">Margin Profit</p>
                  <p className="text-sm sm:text-base font-bold text-teal-600 dark:text-teal-400">{(((dashboard?.totalProfit || 0) / (dashboard?.totalSales || 0)) * 100).toFixed(1)}%</p>
                </div>
              )}
            </CardContent>
          </Card>
          )}
        </TabsContent>
        
        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Daftar Transaksi ({filteredStats.filtered.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={exportTransactionsCSV}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
                {/* Mobile card view */}
                <div className="block md:hidden p-2 space-y-1.5">
                  {filteredStats.filtered.map((t: Transaction) => (
                    <div key={t.id} className="p-2 border rounded-lg space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-medium min-w-0 truncate">{t.invoiceNo}</span>
                        <Badge className={cn(
                          'shrink-0',
                          t.status === 'pending' && "bg-amber-500",
                          t.status === 'approved' && "bg-blue-500",
                          t.status === 'paid' && "bg-green-500",
                          t.status === 'cancelled' && "bg-gray-500",
                          t.paymentStatus === 'partial' && "bg-purple-500"
                        )}>
                          {t.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{t.customer?.name || '-'}</div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">{formatDate(t.transactionDate)}</span>
                        <span className="font-semibold text-xs">{formatCurrency(t.total)}</span>
                      </div>
                      {t.paymentStatus && t.paymentStatus !== 'unpaid' && (
                        <div className="text-xs text-muted-foreground">{'Pembayaran ' + getPaymentStatusLabel(t.paymentStatus)}</div>
                      )}
                    </div>
                  ))}
                  {filteredStats.filtered.length === 0 && (
                    <p className="text-center text-muted-foreground py-8 text-sm">Tidak ada transaksi pada periode ini</p>
                  )}
                </div>
                {/* Desktop table view */}
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
                        {showProfit && <TableHead className="whitespace-nowrap text-right">Profit</TableHead>}
                        <TableHead className="whitespace-nowrap">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStats.filtered.map((t: Transaction) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-sm">{t.invoiceNo}</TableCell>
                          <TableCell>{formatDate(t.transactionDate)}</TableCell>
                          <TableCell>{t.customer?.name || '-'}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(t.total)}</TableCell>
                          {showProfit && <TableCell className="text-right text-emerald-600">{formatCurrency(t.totalProfit)}</TableCell>}
                          <TableCell>
                            <Badge className={cn(
                              t.status === 'pending' && "bg-amber-500",
                              t.status === 'approved' && "bg-blue-500",
                              t.status === 'paid' && "bg-green-500",
                              t.status === 'cancelled' && "bg-gray-500",
                              t.paymentStatus === 'partial' && "bg-purple-500"
                            )}>
                              {t.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {filteredStats.filtered.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={showProfit ? 6 : 5} className="text-center py-8 text-muted-foreground">
                            Tidak ada transaksi pada periode ini
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </ScrollArea>
                </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Products Tab */}
        <TabsContent value="products">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Stok Produk ({products.length})</CardTitle>
              <Button variant="outline" size="sm" onClick={exportProductsCSV}>
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </CardHeader>
            <CardContent className="p-0">
                {/* Mobile card view */}
                <div className="block md:hidden p-2 space-y-1.5">
                  {products.map((p: Product) => (
                    <div key={p.id} className="p-2 border rounded-lg space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-xs min-w-0 truncate">{p.name}</span>
                        <Badge variant={p.globalStock <= p.minStock ? "destructive" : "secondary"} className="shrink-0">
                          {p.globalStock <= p.minStock ? 'Rendah' : 'Normal'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {p.sku && <span className="text-xs text-muted-foreground">{p.sku}</span>}
                        {p.category && <Badge variant="outline" className="text-xs px-1.5 py-0">{p.category}</Badge>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs">{formatStock(p.globalStock, p.unit, p.subUnit, p.conversionRate)}</span>
                        {showProfit && <span className="font-semibold text-xs">{formatCurrency((p.avgHpp || 0) * (p.conversionRate || 1))}/{p.unit || 'pcs'}</span>}
                      </div>
                    </div>
                  ))}
                  {products.length === 0 && (
                    <p className="text-center text-muted-foreground py-8 text-sm">Belum ada data produk</p>
                  )}
                </div>
                {/* Desktop table view */}
                <div className="hidden md:block">
                <ScrollArea className="max-h-[600px]">
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Produk</TableHead>
                        <TableHead className="whitespace-nowrap hidden lg:table-cell">SKU</TableHead>
                        <TableHead className="whitespace-nowrap hidden lg:table-cell">Kategori</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Stok</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Min Stok</TableHead>
                        {showProfit && <TableHead className="whitespace-nowrap text-right">HPP/Satuan</TableHead>}
                        <TableHead className="whitespace-nowrap">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((p: Product) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-muted-foreground hidden lg:table-cell">{p.sku || '-'}</TableCell>
                          <TableCell className="hidden lg:table-cell">{p.category || '-'}</TableCell>
                          <TableCell className="text-right">{formatStock(p.globalStock, p.unit, p.subUnit, p.conversionRate)}</TableCell>
                          <TableCell className="text-right">{p.minStock}</TableCell>
                          {showProfit && <TableCell className="text-right">{formatCurrency((p.avgHpp || 0) * (p.conversionRate || 1))}</TableCell>}
                          <TableCell>
                            <Badge variant={p.globalStock <= p.minStock ? "destructive" : "secondary"}>
                              {p.globalStock <= p.minStock ? 'Rendah' : 'Normal'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </ScrollArea>
                </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Sales Tab */}
        <TabsContent value="sales">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 5 Sales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(dashboard?.topSales || []).map((s: any, i: number) => (
                  <div key={s.id} className="text-center p-3 rounded-lg bg-muted/50">
                    <div className={cn(
                      "w-10 h-10 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold text-sm",
                      i === 0 ? "bg-amber-500" : i === 1 ? "bg-slate-400" : i === 2 ? "bg-amber-700" : "bg-muted-foreground"
                    )}>
                      {getInitials(s.name)}
                    </div>
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.transactions} transaksi</p>
                    <p className="text-sm font-semibold text-primary mt-1">{formatCurrency(s.revenue)}</p>
                  </div>
                ))}
              </div>
              {(!dashboard?.topSales || dashboard.topSales.length === 0) && (
                <p className="text-center text-muted-foreground py-8">Belum ada data sales</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sales Target Dialog */}
      <Dialog open={targetDialogOpen} onOpenChange={(open) => { if (!open) setTargetDialogOpen(false); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              {editingTarget ? 'Edit Target Penjualan' : 'Atur Target Penjualan'}
            </DialogTitle>
            <DialogDescription>
              {editingTarget 
                ? 'Ubah target penjualan untuk sales' 
                : 'Tetapkan target penjualan bulanan untuk sales tim'
              }
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-2">
            {/* Select Sales User - only for new target */}
            {!editingTarget && (
              <div className="space-y-2">
                <Label className="text-sm">Sales</Label>
                <Select value={targetUserId} onValueChange={setTargetUserId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih sales" />
                  </SelectTrigger>
                  <SelectContent>
                    {salesUsers.length === 0 ? (
                      <SelectItem value="__none" disabled>Tidak ada sales aktif</SelectItem>
                    ) : (
                      salesUsers.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Period (only for new target) */}
            {!editingTarget && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-sm">Tahun</Label>
                  <Select value={targetYear} onValueChange={setTargetYear}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[2024, 2025, 2026].map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm">Periode</Label>
                  <Select value={targetPeriod} onValueChange={setTargetPeriod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Bulanan</SelectItem>
                      <SelectItem value="quarterly">Triwulan</SelectItem>
                      <SelectItem value="yearly">Tahunan</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Quarter selector for quarterly period */}
            {!editingTarget && targetPeriod === 'quarterly' && (
              <div className="space-y-2">
                <Label className="text-sm">Triwulan</Label>
                <Select value={targetQuarter} onValueChange={setTargetQuarter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Q1 (Jan-Mar)</SelectItem>
                    <SelectItem value="2">Q2 (Apr-Jun)</SelectItem>
                    <SelectItem value="3">Q3 (Jul-Sep)</SelectItem>
                    <SelectItem value="4">Q4 (Okt-Des)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Month selector for monthly period */}
            {!editingTarget && targetPeriod === 'monthly' && (
              <div className="space-y-2">
                <Label className="text-sm">Bulan</Label>
                <Select value={targetMonth} onValueChange={setTargetMonth}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'].map((m, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Target Amount */}
            <div className="space-y-2">
              <Label className="text-sm">Target Penjualan (Rp)</Label>
              <Input
                type="number"
                min="0"
                placeholder="Contoh: 50000000"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
              />
              {targetAmount && Number(targetAmount) > 0 && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(Number(targetAmount))}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-sm">Catatan (opsional)</Label>
              <Input
                placeholder="Catatan tambahan..."
                value={targetNotes}
                onChange={(e) => setTargetNotes(e.target.value)}
              />
            </div>

            {/* Existing targets preview (for new target only) */}
            {!editingTarget && existingTargets.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Target yang sudah ada untuk periode ini:</Label>
                <div className="space-y-1.5">
                  {existingTargets.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs">
                      <span className="font-medium truncate">{t.user?.name || '-'}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{formatCurrency(t.targetAmount)}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openTargetDialog(t)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" 
                          onClick={() => { if (confirm('Hapus target ini?')) deleteTargetMutation.mutate(t.id); }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            {editingTarget && (
              <Button variant="destructive" size="sm" className="mr-auto"
                onClick={() => { if (confirm('Hapus target ini?')) deleteTargetMutation.mutate(editingTarget.id); }}
                disabled={deleteTargetMutation.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button variant="outline" onClick={() => setTargetDialogOpen(false)}>Batal</Button>
            <Button 
              onClick={handleSaveTarget} 
              disabled={saveTargetMutation.isPending || (!editingTarget && !targetUserId) || !targetAmount}
            >
              {saveTargetMutation.isPending ? 'Menyimpan...' : editingTarget ? 'Simpan' : 'Tambah Target'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

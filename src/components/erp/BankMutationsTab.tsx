'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/erp-helpers';

import {
  RefreshCw,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  CheckCircle2,
  DollarSign,
  Receipt,
  Wallet,
  CreditCard,
  Users,
  X,
  Search,
  CalendarDays,
  Banknote,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

// ─── Types ──────────────────────────────────────────────────────────

interface MootaBank {
  bank_id: string;
  bank_type: string;
  label?: string;
  account_number: string;
  atas_nama: string;
  balance: string;
  is_active?: boolean;
}

interface MootaMutation {
  mutation_id: string;
  bank_id: string;
  date: string;
  note: string;
  description: string;
  amount: string;
  type: 'CR' | 'DB';
  balance: string;
}

interface PiutangItem {
  id: string;
  transactionId: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  priority: string;
  overdueDays: number;
  createdAt: string;
  transaction?: {
    id: string;
    invoiceNo: string;
    type: string;
    dueDate: string;
    unit?: { id: string; name: string };
  };
}

// ─── Bank Logo Helper ───────────────────────────────────────────────

const getBankLogo = (bankType: string) => {
  const logos: Record<string, string> = {
    bca: '🏦',
    bni: '🏛️',
    bri: '🏛️',
    mandiri: '🏛️',
    cimb: '🏦',
    danamon: '🏦',
    permata: '🏦',
    bsi: '🕌',
  };
  return logos[bankType?.toLowerCase()] || '🏦';
};

// ─── Component ──────────────────────────────────────────────────────

interface BankMutationsTabProps {
  bankAccounts: any[];
}

export default function BankMutationsTab({ bankAccounts }: BankMutationsTabProps) {
  const queryClient = useQueryClient();

  // State
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Popup state
  const [selectedMutation, setSelectedMutation] = useState<MootaMutation | null>(null);
  const [showActionPopup, setShowActionPopup] = useState(false);
  const [actionMode, setActionMode] = useState<'credit' | 'debit'>('credit');

  // Piutang dialog state (new: show all piutang instead of auto-match)
  const [showLunasDialog, setShowLunasDialog] = useState(false);
  const [piutangSearch, setPiutangSearch] = useState('');
  const [selectedPiutang, setSelectedPiutang] = useState<PiutangItem | null>(null);
  const [adminFee, setAdminFee] = useState('');
  const [isProcessingLunas, setIsProcessingLunas] = useState(false);

  // Debit action dialog
  const [showDebitDialog, setShowDebitDialog] = useState(false);
  const [debitAction, setDebitAction] = useState<string>('');
  const [debitDescription, setDebitDescription] = useState('');
  const [isProcessingDebit, setIsProcessingDebit] = useState(false);

  // Pool dialog
  const [showPoolDialog, setShowPoolDialog] = useState(false);
  const [poolKey, setPoolKey] = useState('pool_hpp_paid_balance');
  const [isProcessingPool, setIsProcessingPool] = useState(false);

  // Match Moota bank with system bank account
  const getSystemBankAccount = useCallback((mootaBank: MootaBank | undefined) => {
    if (!mootaBank) return null;
    return bankAccounts.find(
      (ba: any) => ba.accountNo === mootaBank.account_number
    ) || null;
  }, [bankAccounts]);

  // Fetch Moota banks
  const { data: mootaBanksData, isLoading: banksLoading, refetch: refetchBanks, error: banksError } = useQuery({
    queryKey: ['moota-banks'],
    queryFn: () => apiFetch<{ banks: MootaBank[] }>('/api/finance/moota/banks'),
    retry: 1,
    staleTime: 60000,
  });
  const mootaBanks = Array.isArray(mootaBanksData?.banks) ? mootaBanksData.banks : [];

  // Auto-sync bank balances from Moota when banks first load
  const hasAutoSynced = useRef(false);
  const bankAccountsData = queryClient.getQueryData<{ bankAccounts: any[] }>(['bank-accounts']);
  const syncBankBalanceSilent = useMutation({
    mutationFn: async (params: { bankAccountId: string; mootaBalance: number }) => {
      return apiFetch(`/api/finance/bank-accounts/${params.bankAccountId}`, {
        method: 'PATCH',
        body: JSON.stringify({ balance: params.mootaBalance, source: 'moota_sync' }),
      });
    },
  });

  useEffect(() => {
    if (hasAutoSynced.current || mootaBanks.length === 0 || !bankAccountsData?.bankAccounts) return;
    hasAutoSynced.current = true;

    const allAccounts = bankAccountsData.bankAccounts;
    let syncCount = 0;
    const promises = mootaBanks.map(bank => {
      const sysBank = allAccounts.find((ba: any) => ba.accountNo === bank.account_number);
      if (!sysBank) return Promise.resolve();
      const mootaBal = Number(bank.balance) || 0;
      const sysBal = Number(sysBank.balance) || 0;
      if (Math.abs(mootaBal - sysBal) <= 1) return Promise.resolve();
      syncCount++;
      return syncBankBalanceSilent.mutateAsync({ bankAccountId: sysBank.id, mootaBalance: mootaBal }).catch(() => {});
    });

    Promise.all(promises).then(() => {
      if (syncCount > 0) {
        queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      }
    });
  }, [mootaBanks.length > 0]);

  // Auto-select first bank
  if (mootaBanks.length > 0 && !selectedBankId) {
    setSelectedBankId(mootaBanks[0].bank_id);
  }

  // Fetch mutations
  const { data: mutationsData, isLoading: mutationsLoading } = useQuery({
    queryKey: ['moota-mutations', selectedBankId, page, typeFilter, dateFrom, dateTo],
    queryFn: () => apiFetch<{
      data: MootaMutation[];
      current_page: number;
      last_page: number;
      total: number;
    }>(`/api/finance/moota/mutations?bankId=${selectedBankId}&page=${page}&perPage=30${typeFilter !== 'all' ? `&type=${typeFilter}` : ''}${dateFrom ? `&startDate=${dateFrom}` : ''}${dateTo ? `&endDate=${dateTo}` : ''}`),
    enabled: !!selectedBankId,
  });

  const mutations = mutationsData?.data || [];
  const totalPages = mutationsData?.last_page || 1;
  const totalMutations = mutationsData?.total || 0;

  // Sync receivables mutation — auto-sync before fetching piutang list
  const syncReceivables = useMutation({
    mutationFn: () => apiFetch('/api/finance/receivables/sync', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['piutang-for-mutation'] });
    },
  });

  // Sync bank balance from Moota
  const syncBankBalance = useMutation({
    mutationFn: async (params: { bankAccountId: string; mootaBalance: number }) => {
      return apiFetch(`/api/finance/bank-accounts/${params.bankAccountId}`, {
        method: 'PATCH',
        body: JSON.stringify({ balance: params.mootaBalance, source: 'moota_sync' }),
      });
    },
    onSuccess: () => {
      toast.success('Saldo rekening berhasil disinkronkan dari Moota');
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Fetch ALL active piutang for lunas dialog (only when dialog is open)
  const { data: piutangData, isLoading: piutangLoading } = useQuery({
    queryKey: ['piutang-for-mutation'],
    queryFn: async () => {
      // First sync receivables to ensure all unpaid tx are in the list
      try { await syncReceivables.mutateAsync(); } catch { /* best effort */ }
      return apiFetch<{ receivables: any[] }>('/api/finance/receivables?status=active');
    },
    enabled: showLunasDialog,
    staleTime: 30000,
  });

  // Process piutang data
  const piutangList: PiutangItem[] = useMemo(() => {
    const raw = piutangData?.receivables || [];
    return raw.map((r: any) => ({
      id: r.id,
      transactionId: r.transactionId || r.transaction?.id,
      customerName: r.customerName || r.transaction?.customer?.name || 'Walk-in',
      customerPhone: r.customerPhone || r.transaction?.customer?.phone || '',
      totalAmount: Number(r.totalAmount) || 0,
      paidAmount: Number(r.paidAmount) || 0,
      remainingAmount: Number(r.remainingAmount) || 0,
      status: r.status,
      priority: r.priority || 'normal',
      overdueDays: r.overdueDays || 0,
      createdAt: r.createdAt,
      transaction: r.transaction ? {
        id: r.transaction.id,
        invoiceNo: r.transaction.invoiceNo || r.transaction.invoice_no,
        type: r.transaction.type,
        dueDate: r.transaction.dueDate || r.transaction.due_date,
        unit: r.transaction.unit,
      } : undefined,
    }));
  }, [piutangData]);

  // Filtered piutang by search
  const filteredPiutang = useMemo(() => {
    if (!piutangSearch.trim()) return piutangList;
    const q = piutangSearch.toLowerCase().trim();
    return piutangList.filter(p =>
      p.customerName.toLowerCase().includes(q) ||
      (p.transaction?.invoiceNo || '').toLowerCase().includes(q) ||
      p.customerPhone.includes(q)
    );
  }, [piutangList, piutangSearch]);

  // Mutation amount helpers
  const mutationAmount = Math.abs(Number(selectedMutation?.amount) || 0);
  const adminFeeAmount = Math.abs(Number(adminFee) || 0);
  const availablePaymentAmount = Math.max(0, mutationAmount - adminFeeAmount);

  // Refresh mutation
  const refreshMutation = useMutation({
    mutationFn: () => apiFetch('/api/finance/moota/refresh', {
      method: 'POST',
      body: JSON.stringify({ bankId: selectedBankId }),
    }),
    onSuccess: (data: any) => {
      toast.success(data.message || 'Refresh berhasil!');
      queryClient.invalidateQueries({ queryKey: ['moota-mutations'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Match mutation to lunas (updated to support admin fee)
  const matchMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/finance/moota/match', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: (data: any) => {
      toast.success(data.message);
      setShowLunasDialog(false);
      setShowActionPopup(false);
      setSelectedPiutang(null);
      setAdminFee('');
      setPiutangSearch('');
      queryClient.invalidateQueries({ queryKey: ['moota-mutations'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Click Mutation Handler ──────────────────────────────────────

  const handleMutationClick = (mutation: MootaMutation) => {
    setSelectedMutation(mutation);
    const isCredit = mutation.type === 'CR';
    setActionMode(isCredit ? 'credit' : 'debit');
    setShowActionPopup(true);
    // Don't pre-fetch matching transactions anymore — user will see piutang list on demand
  };

  // ─── Open Lunas Dialog ───────────────────────────────────────────

  const handleOpenLunasDialog = () => {
    setSelectedPiutang(null);
    setAdminFee('');
    setPiutangSearch('');
    setShowLunasDialog(true);
  };

  // ─── Process Lunas ────────────────────────────────────────────────

  const handleLunas = () => {
    if (!selectedPiutang || !selectedMutation) return;
    setIsProcessingLunas(true);

    const mootaBank = mootaBanks.find(b => b.bank_id === selectedMutation.bank_id);
    const bankAccount = getSystemBankAccount(mootaBank);

    // Use available payment amount (mutation amount - admin fee)
    const payAmount = Math.min(availablePaymentAmount, selectedPiutang.remainingAmount);

    matchMutation.mutate({
      type: 'lunas',
      mutationId: selectedMutation.mutation_id,
      mutationAmount: selectedMutation.amount,
      mutationDate: selectedMutation.date,
      mutationDescription: selectedMutation.description,
      bankAccountId: bankAccount?.id || null,
      bankId: selectedMutation.bank_id,
      transactionId: selectedPiutang.transactionId,
      amount: payAmount,
      adminFee: adminFeeAmount,
    }, {
      onSettled: () => setIsProcessingLunas(false),
    });
  };

  // ─── Process Pool Deposit ────────────────────────────────────────

  const handlePoolDeposit = () => {
    if (!selectedMutation) return;
    setIsProcessingPool(true);

    const mootaBank = mootaBanks.find(b => b.bank_id === selectedMutation.bank_id);
    const bankAccount = getSystemBankAccount(mootaBank);

    matchMutation.mutate({
      type: 'pool',
      mutationId: selectedMutation.mutation_id,
      mutationAmount: selectedMutation.amount,
      mutationDate: selectedMutation.date,
      mutationDescription: selectedMutation.description,
      bankAccountId: bankAccount?.id || null,
      bankId: selectedMutation.bank_id,
      poolKey,
    }, {
      onSettled: () => setIsProcessingPool(false),
    });
  };

  // ─── Process Debit Action ─────────────────────────────────────────

  const handleDebitAction = () => {
    if (!selectedMutation || !debitAction) return;
    setIsProcessingDebit(true);

    const mootaBank = mootaBanks.find(b => b.bank_id === selectedMutation.bank_id);
    const bankAccount = getSystemBankAccount(mootaBank);

    matchMutation.mutate({
      type: debitAction,
      mutationId: selectedMutation.mutation_id,
      mutationAmount: selectedMutation.amount,
      mutationDate: selectedMutation.date,
      mutationDescription: selectedMutation.description,
      bankAccountId: bankAccount?.id || null,
      bankId: selectedMutation.bank_id,
      description: debitDescription,
    }, {
      onSettled: () => setIsProcessingDebit(false),
      onSuccess: () => {
        setShowDebitDialog(false);
        setShowActionPopup(false);
        setDebitAction('');
        setDebitDescription('');
      },
    });
  };

  const handleSyncBankBalance = (mootaBank: MootaBank) => {
    const sysBank = bankAccounts.find((ba: any) => ba.accountNo === mootaBank.account_number);
    if (!sysBank) {
      toast.error('Rekening belum terdaftar di sistem. Tambahkan di Pengaturan → Rekening Bank.');
      return;
    }
    const mootaBal = Number(mootaBank.balance) || 0;
    syncBankBalance.mutate({ bankAccountId: sysBank.id, mootaBalance: mootaBal });
  };

  const selectedBank = mootaBanks.find(b => b.bank_id === selectedBankId);

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Receipt className="w-4 h-4 text-green-600" />
                Mutasi Bank
                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Moota</span>
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Mutasi rekening bank real-time — klik mutasi untuk aksi
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => refetchBanks()}
                disabled={banksLoading}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${banksLoading ? 'animate-spin' : ''}`} />
              </Button>
              {selectedBankId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-green-200 text-green-700"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pt-0 space-y-3">
          {/* Error State */}
          {banksError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium">Gagal memuat data bank dari Moota</p>
              <p className="text-xs text-red-500 dark:text-red-500 mt-1">
                {banksError instanceof Error ? banksError.message : 'Pastikan token Moota valid dan coba lagi.'}
              </p>
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => refetchBanks()}>
                <RefreshCw className="w-3 h-3 mr-1" /> Coba Lagi
              </Button>
            </div>
          )}

          {/* Loading state */}
          {banksLoading && (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
              <span className="text-sm text-muted-foreground">Menghubungkan ke Moota...</span>
            </div>
          )}

          {/* No banks found */}
          {!banksLoading && !banksError && mootaBanks.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              Belum ada bank terdaftar di Moota. Tambahkan bank di dashboard Moota.
            </p>
          )}

          {/* Bank selector — with system balance sync */}
          {mootaBanks.length > 0 && (
            <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
            {mootaBanks.map((bank) => {
              const sysBank = bankAccounts.find(
                (ba: any) => ba.accountNo === bank.account_number
              );
              const mootaBal = Number(bank.balance) || 0;
              const sysBal = sysBank ? Number(sysBank.balance) : 0;
              const hasDiff = sysBank && Math.abs(mootaBal - sysBal) > 1;

              return (
                <button
                  key={bank.bank_id}
                  onClick={() => { setSelectedBankId(bank.bank_id); setPage(1); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    selectedBankId === bank.bank_id
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span>{getBankLogo(bank.bank_type)}</span>
                  <div className="flex flex-col items-start min-w-0">
                    <span className="truncate max-w-[140px] font-semibold">{bank.label || bank.bank_type.toUpperCase()}</span>
                    <span className="text-[10px] opacity-70">{bank.account_number}</span>
                  </div>
                  <div className="flex flex-col items-end ml-1 shrink-0">
                    {sysBank ? (
                      <>
                        <span className={`text-[10px] font-bold ${hasDiff ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-300'}`}>
                          {formatCurrency(sysBal)}
                        </span>
                        {hasDiff && (
                          <span className="text-[9px] opacity-50 line-through">
                            Moota: {formatCurrency(mootaBal)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] opacity-50">
                        {formatCurrency(mootaBal)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            </div>
            {/* Sync button if any bank has balance mismatch */}
            {mootaBanks.some(bank => {
              const sysBank = bankAccounts.find((ba: any) => ba.accountNo === bank.account_number);
              return sysBank && Math.abs(Number(bank.balance) - Number(sysBank.balance)) > 1;
            }) && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] gap-1 border-amber-200 text-amber-700 hover:bg-amber-50"
                onClick={() => {
                  const selectedMootaBank = mootaBanks.find(b => b.bank_id === selectedBankId);
                  if (selectedMootaBank) handleSyncBankBalance(selectedMootaBank);
                }}
                disabled={syncBankBalance.isPending}
              >
                {syncBankBalance.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Building2 className="w-3 h-3" />
                )}
                Sync Saldo dari Moota
              </Button>
            )}
            </div>
          )}

          {/* Filters */}
          {selectedBankId && (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="CR">🟢 Masuk (CR)</SelectItem>
                  <SelectItem value="DB">🔴 Keluar (DB)</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="h-8 w-[130px] text-xs"
                  placeholder="Dari"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">→</span>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="h-8 w-[130px] text-xs"
                  placeholder="Sampai"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mutations List */}
      {selectedBankId && (
        <Card>
          <CardContent className="p-0">
            {mutationsLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Memuat mutasi...</span>
              </div>
            ) : mutations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Receipt className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">Tidak ada mutasi ditemukan</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px] h-8">Tanggal</TableHead>
                      <TableHead className="text-[11px] h-8">Keterangan</TableHead>
                      <TableHead className="text-[11px] h-8 text-right">Jumlah</TableHead>
                      <TableHead className="text-[11px] h-8 text-right">Saldo</TableHead>
                      <TableHead className="text-[11px] h-8 text-center">Tipe</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mutations.map((mutation) => (
                      <TableRow
                        key={mutation.mutation_id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleMutationClick(mutation)}
                      >
                        <TableCell className="text-xs py-2.5 whitespace-nowrap">
                          {mutation.date ? formatDate(mutation.date.split(' ')[0]) : '-'}
                        </TableCell>
                        <TableCell className="text-xs py-2.5 max-w-[200px]">
                          <div className="truncate">{mutation.description || mutation.note || '-'}</div>
                        </TableCell>
                        <TableCell className={`text-xs py-2.5 text-right font-semibold whitespace-nowrap ${
                          mutation.type === 'CR' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {mutation.type === 'CR' ? '+' : '-'}{formatCurrency(Math.abs(Number(mutation.amount) || 0))}
                        </TableCell>
                        <TableCell className="text-xs py-2.5 text-right whitespace-nowrap">
                          {formatCurrency(Number(mutation.balance) || 0)}
                        </TableCell>
                        <TableCell className="text-center py-2.5">
                          <Badge variant={mutation.type === 'CR' ? 'default' : 'destructive'} className="text-[10px] h-5 px-1.5">
                            {mutation.type === 'CR' ? (
                              <span className="inline-flex items-center gap-0.5">
                                <ArrowDownCircle className="w-2.5 h-2.5" /> Masuk
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5">
                                <ArrowUpCircle className="w-2.5 h-2.5" /> Keluar
                              </span>
                            )}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t">
                <span className="text-[11px] text-muted-foreground">
                  Total: {totalMutations} mutasi • Hal {page}/{totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ACTION POPUP — Clicked on Mutation */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <Dialog open={showActionPopup} onOpenChange={setShowActionPopup}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionMode === 'credit' ? (
                <>
                  <ArrowDownCircle className="w-5 h-5 text-green-600" />
                  Uang Masuk
                </>
              ) : (
                <>
                  <ArrowUpCircle className="w-5 h-5 text-red-600" />
                  Uang Keluar
                </>
              )}
            </DialogTitle>
            <DialogDescription className="space-y-1">
              <span className="font-bold text-base">
                {actionMode === 'credit' ? '+' : '-'}{formatCurrency(Math.abs(Number(selectedMutation?.amount) || 0))}
              </span>
              <br />
              <span className="text-xs text-muted-foreground">
                {selectedMutation?.date && formatDate(selectedMutation.date.split(' ')[0])}
                {selectedMutation?.description && ` — ${selectedMutation.description}`}
              </span>
            </DialogDescription>
          </DialogHeader>

          {actionMode === 'credit' ? (
            /* ─── CREDIT ACTIONS ─────────────────────────── */
            <div className="space-y-3 py-2">
              {/* Match to Invoice — now shows piutang list */}
              <button
                onClick={handleOpenLunasDialog}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">Tandai Lunas Invoice</p>
                  <p className="text-[11px] text-muted-foreground">
                    Pilih piutang pelanggan yang akan dibayar
                  </p>
                </div>
              </button>

              {/* Add to Pool Dana */}
              <button
                onClick={() => setShowPoolDialog(true)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                  <DollarSign className="w-5 h-5 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-purple-800 dark:text-purple-200">Masuk ke Pool Dana</p>
                  <p className="text-[11px] text-muted-foreground">Alokasikan ke HPP Dibayar atau Profit Dibayar</p>
                </div>
              </button>

              {/* Deposit to Bank Account */}
              <button
                onClick={() => {
                  toast.info('Fitur deposit langsung ke rekening - segera hadir');
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors text-left opacity-60"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Deposit ke Rekening</p>
                  <p className="text-[11px] text-muted-foreground">Catat sebagai dana masuk rekening bank</p>
                </div>
              </button>
            </div>
          ) : (
            /* ─── DEBIT ACTIONS ──────────────────────────── */
            <div className="space-y-3 py-2">
              <button
                onClick={() => { setDebitAction('expense'); setShowDebitDialog(true); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                  <Receipt className="w-5 h-5 text-red-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">Pengeluaran</p>
                  <p className="text-[11px] text-muted-foreground">Catat sebagai pengeluaran operasional</p>
                </div>
              </button>

              <button
                onClick={() => { setDebitAction('salary'); setShowDebitDialog(true); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Pembayaran Gaji</p>
                  <p className="text-[11px] text-muted-foreground">Catat sebagai pembayaran gaji karyawan</p>
                </div>
              </button>

              <button
                onClick={() => { setDebitAction('purchase'); setShowDebitDialog(true); }}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0">
                  <CreditCard className="w-5 h-5 text-blue-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">Pembelian / Hutang</p>
                  <p className="text-[11px] text-muted-foreground">Bayar pembelian atau cicilan hutang</p>
                </div>
              </button>

              <button
                onClick={() => toast.info('Fitur lainnya segera hadir')}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-500/20 flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-gray-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lainnya</p>
                  <p className="text-[11px] text-muted-foreground">Transfer antar rekening, dll</p>
                </div>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* LUNAS DIALOG — Show ALL Piutang (Receivables) List */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <Sheet open={showLunasDialog} onOpenChange={setShowLunasDialog}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-hidden p-0">
          <SheetHeader className="shrink-0 px-4 sm:px-6 pt-4 sm:pt-6 pb-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Tandai Lunas Invoice
            </SheetTitle>
            <SheetDescription className="text-xs">
              Pilih piutang yang akan dibayar dari mutasi{' '}
              <span className="font-bold text-green-700 dark:text-green-400">
                {formatCurrency(mutationAmount)}
              </span>
            </SheetDescription>
          </SheetHeader>

          <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain px-4 sm:px-6 pb-4 space-y-3">
            {/* Admin Fee Input */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <Banknote className="w-4 h-4 text-amber-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <Label className="text-xs font-medium text-amber-800 dark:text-amber-200">Biaya Admin (opsional)</Label>
                <Input
                  type="number"
                  value={adminFee}
                  onChange={(e) => setAdminFee(e.target.value)}
                  placeholder="0"
                  className="h-7 text-xs mt-1"
                />
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-muted-foreground">Sisa bayar</p>
                <p className="text-sm font-bold text-green-700 dark:text-green-400">
                  {formatCurrency(availablePaymentAmount)}
                </p>
              </div>
            </div>

            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={piutangSearch}
                onChange={(e) => setPiutangSearch(e.target.value)}
                placeholder="Cari nama pelanggan, invoice, atau no. HP..."
                className="h-9 text-xs pl-9"
              />
            </div>

            {/* Piutang List */}
            {piutangLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground mr-2" />
                <span className="text-sm text-muted-foreground">Sinkronisasi piutang & memuat data...</span>
              </div>
            ) : filteredPiutang.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">
                  {piutangList.length === 0
                    ? 'Tidak ada piutang aktif'
                    : 'Tidak ada piutang yang cocok'}
                </p>
                {piutangList.length === 0 && (
                  <p className="text-xs mt-1">Semua invoice sudah lunas</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {filteredPiutang.length} piutang ditemukan
                  </span>
                </div>
                {filteredPiutang.map((piutang) => {
                  const isSelected = selectedPiutang?.id === piutang.id;
                  const isOverdue = piutang.overdueDays > 0;
                  const canPayFull = availablePaymentAmount >= piutang.remainingAmount;

                  return (
                    <button
                      key={piutang.id}
                      onClick={() => setSelectedPiutang(isSelected ? null : piutang)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? 'border-green-500 bg-green-50 dark:bg-green-950/30 ring-1 ring-green-300 dark:ring-green-700'
                          : 'border-border hover:border-green-300 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold truncate">
                            {piutang.customerName || 'Walk-in'}
                          </span>
                          {isOverdue && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1 shrink-0">
                              {piutang.overdueDays} hari
                            </Badge>
                          )}
                          {piutang.priority === 'urgent' && (
                            <Badge className="text-[9px] h-4 px-1 bg-red-500 shrink-0">
                              Urgent
                            </Badge>
                          )}
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        )}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">
                          {piutang.transaction?.invoiceNo || '-'}
                          {piutang.transaction?.unit?.name && ` • ${piutang.transaction.unit.name}`}
                        </span>
                        <span className="font-medium shrink-0 ml-2">
                          Sisa: {formatCurrency(piutang.remainingAmount)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-0.5">
                        <span>
                          Total: {formatCurrency(piutang.totalAmount)} • Sudah bayar: {formatCurrency(piutang.paidAmount)}
                        </span>
                        {!canPayFull && (
                          <span className="text-amber-600 text-[10px] shrink-0">
                            Partial
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Akan dibayar:</span>
                            <span className="font-bold text-green-700 dark:text-green-400">
                              {formatCurrency(Math.min(availablePaymentAmount, piutang.remainingAmount))}
                            </span>
                          </div>
                          {!canPayFull && (
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              ⚠ Pembayaran partial — sisa piutang: {formatCurrency(piutang.remainingAmount - Math.min(availablePaymentAmount, piutang.remainingAmount))}
                            </p>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 px-4 sm:px-6 py-3 border-t bg-background">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {selectedPiutang ? (
                  <>
                    <span className="font-medium">{selectedPiutang.customerName}</span> — {selectedPiutang.transaction?.invoiceNo}
                    {adminFeeAmount > 0 && (
                      <span className="text-amber-600 ml-1">(Admin: {formatCurrency(adminFeeAmount)})</span>
                    )}
                  </>
                ) : (
                  'Pilih piutang di atas untuk melanjutkan'
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowLunasDialog(false)} className="h-8 text-xs">
                  Batal
                </Button>
                <Button
                  onClick={handleLunas}
                  disabled={!selectedPiutang || isProcessingLunas || matchMutation.isPending}
                  className="h-8 text-xs bg-green-600 hover:bg-green-700"
                >
                  {isProcessingLunas ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Tandai Lunas
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* POOL DANA DIALOG — Select Pool for Credit */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <Dialog open={showPoolDialog} onOpenChange={setShowPoolDialog}>
        <DialogContent className="sm:max-w-sm w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-purple-600" />
              Masuk ke Pool Dana
            </DialogTitle>
            <DialogDescription>
              Alokasikan <span className="font-bold">{formatCurrency(Math.abs(Number(selectedMutation?.amount) || 0))}</span> ke pool dana
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Pilih Pool Dana</Label>
              <Select value={poolKey} onValueChange={setPoolKey}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pool_hpp_paid_balance">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-purple-500" />
                      HPP Sudah Dibayar
                    </span>
                  </SelectItem>
                  <SelectItem value="pool_profit_paid_balance">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-teal-500" />
                      Profit Sudah Dibayar
                    </span>
                  </SelectItem>
                  <SelectItem value="pool_investor_fund">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      Dana Lain-lain / Investor
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowPoolDialog(false)} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button
              onClick={handlePoolDeposit}
              disabled={isProcessingPool || matchMutation.isPending}
              className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
            >
              {isProcessingPool ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> Memproses...</>
              ) : (
                <><DollarSign className="w-3.5 h-3.5 mr-1" /> Masukkan ke Pool</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* DEBIT ACTION DIALOG — Expense / Salary / Purchase */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <Dialog open={showDebitDialog} onOpenChange={(open) => {
        setShowDebitDialog(open);
        if (!open) { setDebitAction(''); setDebitDescription(''); }
      }}>
        <DialogContent className="sm:max-w-sm w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="w-5 h-5 text-red-600" />
              {debitAction === 'expense' && 'Catat Pengeluaran'}
              {debitAction === 'salary' && 'Catat Pembayaran Gaji'}
              {debitAction === 'purchase' && 'Catat Pembelian / Hutang'}
            </DialogTitle>
            <DialogDescription>
              Keluar <span className="font-bold">{formatCurrency(Math.abs(Number(selectedMutation?.amount) || 0))}</span> —{' '}
              {selectedMutation?.date && formatDate(selectedMutation.date.split(' ')[0])}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Keterangan / Catatan</Label>
              <Input
                value={debitDescription}
                onChange={(e) => setDebitDescription(e.target.value)}
                placeholder={debitAction === 'expense' ? 'Contoh: Bayar listrik, beli ATK...' : debitAction === 'salary' ? 'Contoh: Gaji bulan April...' : 'Contoh: Bayar supplier XYZ...'}
                className="text-sm"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saldo rekening bank akan otomatis dikurangi.
            </p>
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => { setShowDebitDialog(false); setDebitAction(''); setDebitDescription(''); }} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button
              onClick={handleDebitAction}
              disabled={isProcessingDebit || matchMutation.isPending}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700"
            >
              {isProcessingDebit ? (
                <><RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> Memproses...</>
              ) : (
                <><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Catat</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

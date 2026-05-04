'use client';

import { useState } from 'react';
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
  Eye,
  CheckCircle2,
  DollarSign,
  Receipt,
  Wallet,
  CreditCard,
  Users,
  X,
  Search,
  CalendarDays,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

interface MatchedTransaction {
  id: string;
  invoiceNo: string;
  type: string;
  customerName: string;
  unitName: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: string;
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

  // Lunas dialog
  const [showLunasDialog, setShowLunasDialog] = useState(false);
  const [matchedTransactions, setMatchedTransactions] = useState<MatchedTransaction[]>([]);
  const [selectedTx, setSelectedTx] = useState<MatchedTransaction | null>(null);
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

  // Find matching bank account ID
  const matchedBankAccount = bankAccounts.find(
    (ba: any) => selectedBankId && ba.accountNo && false // Will match by moota bank
  );

  // Fetch Moota banks
  const { data: mootaBanksData, isLoading: banksLoading, refetch: refetchBanks, error: banksError } = useQuery({
    queryKey: ['moota-banks'],
    queryFn: () => apiFetch<{ banks: MootaBank[] }>('/api/finance/moota/banks'),
    retry: 1,
    staleTime: 60000,
  });
  const mootaBanks = Array.isArray(mootaBanksData?.banks) ? mootaBanksData.banks : [];

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

  // Match mutation to lunas
  const matchMutation = useMutation({
    mutationFn: (data: any) => apiFetch('/api/finance/moota/match', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: (data: any) => {
      toast.success(data.message);
      setShowLunasDialog(false);
      setShowActionPopup(false);
      setSelectedTx(null);
      queryClient.invalidateQueries({ queryKey: ['moota-mutations'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ─── Click Mutation Handler ──────────────────────────────────────

  const handleMutationClick = (mutation: MootaMutation) => {
    setSelectedMutation(mutation);
    const isCredit = mutation.type === 'CR';
    setActionMode(isCredit ? 'credit' : 'debit');

    if (isCredit) {
      // Uang masuk — search for matching unpaid transactions
      const absAmount = Math.abs(Number(mutation.amount) || 0);
      apiFetch<{ transactions: MatchedTransaction[] }>(
        `/api/transactions?type=sale&status=approved`
      ).then((res) => {
        // Filter to find potential matches (amount matches within a tolerance)
        const candidates = (res.transactions || []).filter(
          (tx: MatchedTransaction) =>
            tx.paymentStatus !== 'paid' &&
            Math.abs(tx.remainingAmount - absAmount) < 500 // Within 500 IDR tolerance
        ).slice(0, 10);
        setMatchedTransactions(candidates);
        setShowActionPopup(true);
      }).catch(() => {
        setMatchedTransactions([]);
        setShowActionPopup(true);
      });
    } else {
      // Uang keluar
      setShowActionPopup(true);
    }
  };

  // ─── Process Lunas ────────────────────────────────────────────────

  const handleLunas = () => {
    if (!selectedTx || !selectedMutation) return;
    setIsProcessingLunas(true);

    // Find bank account ID by matching account number
    const mootaBank = mootaBanks.find(b => b.bank_id === selectedMutation.bank_id);
    const bankAccount = bankAccounts.find(
      (ba: any) => mootaBank && ba.accountNo === mootaBank.account_number
    );

    matchMutation.mutate({
      type: 'lunas',
      mutationId: selectedMutation.mutation_id,
      mutationAmount: selectedMutation.amount,
      mutationDate: selectedMutation.date,
      mutationDescription: selectedMutation.description,
      bankAccountId: bankAccount?.id || null,
      bankId: selectedMutation.bank_id,
      transactionId: selectedTx.id,
    }, {
      onSettled: () => setIsProcessingLunas(false),
    });
  };

  // ─── Process Pool Deposit ────────────────────────────────────────

  const handlePoolDeposit = () => {
    if (!selectedMutation) return;
    setIsProcessingPool(true);

    const mootaBank = mootaBanks.find(b => b.bank_id === selectedMutation.bank_id);
    const bankAccount = bankAccounts.find(
      (ba: any) => mootaBank && ba.accountNo === mootaBank.account_number
    );

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
    const bankAccount = bankAccounts.find(
      (ba: any) => mootaBank && ba.accountNo === mootaBank.account_number
    );

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

          {/* Bank selector */}
          {mootaBanks.length > 0 && (
            <div className="flex flex-wrap gap-2">
            {mootaBanks.map((bank) => (
              <button
                key={bank.bank_id}
                onClick={() => { setSelectedBankId(bank.bank_id); setPage(1); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedBankId === bank.bank_id
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border border-green-300 dark:border-green-700'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-transparent hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <span>{getBankLogo(bank.bank_type)}</span>
                <span className="truncate max-w-[120px]">{bank.label || bank.bank_type.toUpperCase()}</span>
                <span className="text-[10px] opacity-60">{bank.account_number}</span>
              </button>
            ))}
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
              {/* Match to Invoice */}
              <button
                onClick={() => setShowLunasDialog(true)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200">Tandai Lunas Invoice</p>
                  <p className="text-[11px] text-muted-foreground">
                    {matchedTransactions.length > 0
                      ? `${matchedTransactions.length} invoice cocok ditemukan`
                      : 'Cari invoice yang belum lunas'}
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
                  // Just record as deposit (do nothing extra for now, could expand)
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
      {/* LUNAS DIALOG — Select Invoice to Mark as Paid */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <Dialog open={showLunasDialog} onOpenChange={setShowLunasDialog}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[80dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Pilih Invoice untuk Lunas
            </DialogTitle>
            <DialogDescription>
              Invoice yang belum lunas dengan nominal mendekati{' '}
              <span className="font-bold">{formatCurrency(Math.abs(Number(selectedMutation?.amount) || 0))}</span>
            </DialogDescription>
          </DialogHeader>

          {matchedTransactions.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Tidak ada invoice yang cocok</p>
              <p className="text-xs mt-1">Invoice mungkin sudah lunas atau nominal tidak sesuai</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {matchedTransactions.map((tx) => (
                <button
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selectedTx?.id === tx.id
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/30'
                      : 'border-border hover:border-green-300 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-semibold">{tx.invoiceNo}</span>
                    <Badge variant={tx.paymentStatus === 'unpaid' ? 'destructive' : 'secondary'} className="text-[10px] h-5">
                      {tx.paymentStatus === 'unpaid' ? 'Belum Bayar' : 'Sebagian'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{tx.customerName || 'Walk-in'} — {tx.unitName || '-'}</span>
                    <span className="font-medium">Sisa: {formatCurrency(tx.remainingAmount)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Total: {formatCurrency(tx.total)} • Sudah bayar: {formatCurrency(tx.paidAmount)}
                  </div>
                </button>
              ))}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowLunasDialog(false)} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button
              onClick={handleLunas}
              disabled={!selectedTx || isProcessingLunas || matchMutation.isPending}
              className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
            >
              {isProcessingLunas ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                  Memproses...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Tandai Lunas
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

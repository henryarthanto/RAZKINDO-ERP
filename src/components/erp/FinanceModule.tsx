'use client';

import { useState, useMemo } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDateTime, getInitials } from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import type {
  BankAccount,
  CashBox,
  CompanyDebt,
  FinanceRequest,
  FundTransfer,
  Transaction,
  Payment,
} from '@/types';

import {
  DollarSign,
  TrendingUp,
  Wallet,
  Building2,
  BarChart3,
  AlertTriangle,
  Plus,
  Edit,
  Trash2,
  ArrowLeftRight,
  CircleDollarSign,
  Building,
  Warehouse,
  ArrowRight,
  PencilRuler,
  RefreshCw,
  CheckCircle2,
  Info,
  Gift,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  Landmark,
  Receipt,
  Banknote,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';


import PiutangTab from './PiutangTab';
import CompanyDebtsTab, { ProcessRequestDialog, TransferForm, BankAccountForm, CashBoxForm } from './CompanyDebtsTab';
import { PoolAdjustForm } from './PoolAdjustForm';
import { DepositDialog } from './DepositDialog';
import CashbackWithdrawalsTab from './CashbackWithdrawalsTab';
import { ExpenseDialog } from './ExpenseDialog';
import BankMutationsTab from './BankMutationsTab';

// ================================
// HELPER FUNCTIONS (outside component to avoid recreation)
// ================================

// fundSource values 'hpp_paid' and 'profit_unpaid' are enum keys stored in DB (finance_requests.fund_source).
// Despite the confusing name, 'profit_unpaid' refers to pool_profit_paid_balance (the PROFIT PAID pool).
// Both values represent PAID pools — the source of funds for finance operations.
// DO NOT change these labels without also updating all API endpoints that check these values.
const getFundSourceLabel = (fundSource?: string) => {
  if (fundSource === 'hpp_paid') return 'HPP Sudah Terbayar';
  if (fundSource === 'profit_unpaid') return 'Profit Sudah Terbayar';
  return null;
};

const getFundSourceColor = (fundSource?: string) => {
  if (fundSource === 'hpp_paid') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300';
  if (fundSource === 'profit_unpaid') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
  return '';
};

const getRequestTypeLabel = (type: string) => {
  switch (type) {
    case 'purchase': return 'Pembelian';
    case 'salary': return 'Gaji';
    case 'expense': return 'Pengeluaran';
    case 'courier_deposit': return 'Setoran Kurir';
    case 'cash_to_bank': return 'Setor ke Bank';
    default: return type;
  }
};

const getRequestTypeColor = (type: string) => {
  switch (type) {
    case 'purchase': return 'bg-blue-500';
    case 'salary': return 'bg-purple-500';
    case 'expense': return 'bg-red-500';
    case 'courier_deposit': return 'bg-green-500';
    case 'cash_to_bank': return 'bg-amber-500';
    default: return 'bg-gray-500';
  }
};

const WorkflowInfo = ({ req }: { req: FinanceRequest }) => {
  if (req.status !== 'processed') return null;
  const fundLabel = getFundSourceLabel(req.fundSource);
  const isDebt = req.paymentType === 'debt';

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1 text-[10px]">
      {isDebt ? (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
          <Wallet className="w-2.5 h-2.5" /> Dicatat sebagai Hutang
        </span>
      ) : (
        <>
          {fundLabel && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded ${getFundSourceColor(req.fundSource)}`}>
              <span className="font-bold">1</span> {fundLabel}
            </span>
          )}
          {(fundLabel) && (req.sourceType === 'bank' || req.sourceType === 'cashbox') && (
            <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
          )}
          {req.sourceType === 'bank' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
              <span className="font-bold">2</span> <Building className="w-2.5 h-2.5" /> {req.bankAccount?.name || 'Rekening Bank'}
            </span>
          )}
          {req.sourceType === 'cashbox' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <span className="font-bold">2</span> <Warehouse className="w-2.5 h-2.5" /> {req.cashBox?.name || 'Brankas'}
            </span>
          )}
        </>
      )}
    </div>
  );
};

// ================================
// CASH FLOW TYPES
// ================================

interface CashFlowEntry {
  id: string;
  date: string;
  direction: 'in' | 'out' | 'transfer';
  category: string;
  categoryLabel: string;
  description: string;
  amount: number;
  source: string;
  destination: string;
  referenceId: string;
  referenceNo?: string;
  createdBy?: string;
  metadata?: Record<string, any>;
}

const CASHFLOW_CATEGORY_COLORS: Record<string, string> = {
  sale: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  purchase: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  expense: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  salary: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  courier_handover: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  fund_transfer: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  cashback_withdrawal: 'bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300',
  pool_deposit: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
};

// ================================
// FINANCE DASHBOARD SKELETON
// ================================
function FinanceDashboardSkeleton() {
  return (
    <div className="space-y-4 safe-bottom w-full min-w-0 overflow-x-hidden">
      {/* Summary cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Chart / Pool area skeleton */}
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

// ================================
// FINANCE MODULE (MAIN)
// ================================

export default function FinanceModule() {
  const { user } = useAuthStore();
  const { selectedUnitId, units } = useUnitStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('requests');
  const [showBankForm, setShowBankForm] = useState(false);
  const [showCashBoxForm, setShowCashBoxForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [processingRequest, setProcessingRequest] = useState<string | null>(null);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [editingCashBox, setEditingCashBox] = useState<CashBox | null>(null);
  const [depositingBank, setDepositingBank] = useState<BankAccount | null>(null);
  const [depositingCashBox, setDepositingCashBox] = useState<CashBox | null>(null);
  const [pendingDeleteBank, setPendingDeleteBank] = useState<{ id: string; name: string } | null>(null);
  const [pendingDeleteCashBox, setPendingDeleteCashBox] = useState<{ id: string; name: string } | null>(null);
  // Keys to force form remount when dialog opens (resets stale form state)
  const [cashBoxFormKey, setCashBoxFormKey] = useState(0);
  const [transferFormKey, setTransferFormKey] = useState(0);
  const [bankFormKey, setBankFormKey] = useState(0);
  const [poolFormKey, setPoolFormKey] = useState(0);
  const [showPoolDialog, setShowPoolDialog] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDestType, setTransferDestType] = useState<'cashbox' | 'bank'>('bank');
  const [transferDestId, setTransferDestId] = useState('');
  // Pool-to-pool transfer state
  const [transferMode, setTransferMode] = useState<'pool_to_pool' | 'pool_to_physical'>('pool_to_pool');
  const [transferFromPool, setTransferFromPool] = useState<'hpp' | 'profit' | 'lain_lain'>('profit');
  const [transferToPool, setTransferToPool] = useState<'hpp' | 'profit' | 'lain_lain'>('hpp');
  
  // Fetch bank accounts
  const { data: bankAccountsData } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => apiFetch<{ bankAccounts: any[] }>('/api/finance/bank-accounts'),
    ...POLLING_CONFIG
  });
  
  // Fetch cash boxes
  const { data: cashBoxesData } = useQuery({
    queryKey: ['cash-boxes'],
    queryFn: () => apiFetch<{ cashBoxes: any[] }>('/api/finance/cash-boxes'),
    ...POLLING_CONFIG
  });
  
  // Fetch finance requests (only when requests tab is active)
  const { data: financeRequestsData } = useQuery({
    queryKey: ['finance-requests'],
    queryFn: () => apiFetch<{ requests: any[] }>('/api/finance/requests'),
    enabled: activeTab === 'requests',
    ...POLLING_CONFIG
  });
  
  // Fetch fund transfers (only when transfers tab is active)
  const { data: transfersData } = useQuery({
    queryKey: ['fund-transfers'],
    queryFn: () => apiFetch<{ transfers: any[] }>('/api/finance/transfers'),
    enabled: activeTab === 'transfers',
    ...POLLING_CONFIG
  });
  
  // Cash flow history state
  const [cashflowType, setCashflowType] = useState('all');
  const [cashflowPage, setCashflowPage] = useState(1);
  const cashflowLimit = 30;

  // Fetch cash flow history (only when cashflow tab is active)
  const { data: cashflowData, isLoading: cashflowLoading } = useQuery({
    queryKey: ['cash-flow', cashflowType, cashflowPage],
    queryFn: () => apiFetch<{
      entries: CashFlowEntry[];
      summary: { totalInflow: number; totalOutflow: number; totalTransfer: number; netFlow: number; count: number };
      pagination: { page: number; limit: number; total: number; totalPages: number };
    }>(`/api/finance/cash-flow?type=${cashflowType}&page=${cashflowPage}&limit=${cashflowLimit}`),
    enabled: activeTab === 'cashflow',
  });

  // Fetch courier cash summary (money still with couriers)
  const { data: courierCashSummary } = useQuery({
    queryKey: ['courier-cash-summary'],
    queryFn: () => apiFetch<{ totalWithCouriers: number }>('/api/courier/cash-summary'),
    ...POLLING_CONFIG
  });

  // Fetch payments (used in various tabs - e.g. creating new payments from transactions)
  // Note: HPP/Profit totals now use actualHppSum/actualProfitSum from pools API (RPC-based, no limit)
  const { data: paymentsData } = useQuery({
    queryKey: ['payments'],
    queryFn: () => apiFetch<{ payments: Payment[] }>('/api/payments'),
    ...POLLING_CONFIG
  });
  
  // Fetch pool balances from settings (tracked pool balance for 2-step workflow)
  const { data: poolBalancesData } = useQuery({
    queryKey: ['finance-pools'],
    queryFn: () => apiFetch<{ hppPaidBalance: number; profitPaidBalance: number; investorFund: number; totalPool: number; totalPhysical?: number; derivedHpp?: number; derivedProfit?: number; hppDiff?: number; profitDiff?: number; poolDiff?: number; isHealthy?: boolean }>('/api/finance/pools'),
    ...POLLING_CONFIG
  });
  
  // Fetch company debts (only when debts tab is active)
  const { data: debtsData } = useQuery({
    queryKey: ['company-debts'],
    queryFn: () => apiFetch<{ debts: any[] }>('/api/finance/debts'),
    enabled: activeTab === 'debts',
    ...POLLING_CONFIG
  });
  
  const bankAccounts = Array.isArray(bankAccountsData?.bankAccounts) ? bankAccountsData.bankAccounts : [];
  const cashBoxes = Array.isArray(cashBoxesData?.cashBoxes) ? cashBoxesData.cashBoxes : [];
  const financeRequests = Array.isArray(financeRequestsData?.requests) ? financeRequestsData.requests : [];
  const transfers = Array.isArray(transfersData?.transfers) ? transfersData.transfers : [];
  const payments = Array.isArray(paymentsData?.payments) ? paymentsData.payments : [];
  const debts = Array.isArray(debtsData?.debts) ? debtsData.debts : [];
  
  // Fetch unpaid purchase transactions (only when debts tab is active)
  const { data: purchaseDebtsData } = useQuery({
    queryKey: ['purchase-debts'],
    queryFn: () => apiFetch<{ transactions: any[] }>('/api/transactions?type=purchase&status=approved'),
    enabled: activeTab === 'debts',
    ...POLLING_CONFIG
  });
  
  const purchaseDebts = (Array.isArray(purchaseDebtsData?.transactions) ? purchaseDebtsData.transactions : []).filter(
    (t: Transaction) => t.paymentStatus === 'unpaid' || t.paymentStatus === 'partial'
  );
  
  // Fetch receivables (only when piutang tab is active)
  const { data: receivablesData, isLoading: receivablesLoading } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => apiFetch<{ receivables: any[]; stats: any }>('/api/finance/receivables'),
    enabled: activeTab === 'piutang',
    ...POLLING_CONFIG
  });
  
  const receivables = Array.isArray(receivablesData?.receivables) ? receivablesData.receivables : [];
  const receivableStats = receivablesData?.stats || { totalReceivable: 0, totalOverdue: 0, activeCount: 0, overdueCount: 0, unassignedCount: 0 };
  
  // Calculate fund balances
  // Pool dana uses STORED values from settings as primary.
  // Derived values from transactions shown as reference only.
  const fundBalances = useMemo(() => {
    const totalCashInBoxes = cashBoxes.reduce((sum: number, c: CashBox) => sum + c.balance, 0);
    const totalInBanks = bankAccounts.reduce((sum: number, b: BankAccount) => sum + b.balance, 0);
    const totalWithCouriers = Number(courierCashSummary?.totalWithCouriers) || 0;

    // Stored pool values (source of truth)
    const hppPaidBalance = Math.max(0, Number(poolBalancesData?.hppPaidBalance) || 0);
    const profitPaidBalance = Math.max(0, Number(poolBalancesData?.profitPaidBalance) || 0);
    const investorFund = Math.max(0, Number(poolBalancesData?.investorFund) || 0);
    const totalPhysical = Math.max(0, Number(poolBalancesData?.totalPhysical) || (totalCashInBoxes + totalInBanks));
    const totalPool = hppPaidBalance + profitPaidBalance + investorFund;
    const poolDiff = Number(poolBalancesData?.poolDiff) ?? ((Number(poolBalancesData?.totalPhysical) || 0) - totalPool);

    // Derived reference (from sale transactions)
    const derivedHpp = Number(poolBalancesData?.derivedHpp) || 0;
    const derivedProfit = Number(poolBalancesData?.derivedProfit) || 0;

    // Health & diff from RPC
    const hppDiff = Number(poolBalancesData?.hppDiff) || 0;
    const profitDiff = Number(poolBalancesData?.profitDiff) || 0;
    const isHealthy = poolBalancesData?.isHealthy !== false;

    const totalFunds = totalCashInBoxes + totalInBanks + totalWithCouriers;

    return {
      totalCashInBoxes,
      totalInBanks,
      totalWithCouriers,
      totalFunds,
      hppPaidBalance,
      profitPaidBalance,
      investorFund,
      totalPool,
      totalPhysical,
      poolDiff,
      derivedHpp,
      derivedProfit,
      hppDiff,
      profitDiff,
      isHealthy,
    };
  }, [cashBoxes, bankAccounts, courierCashSummary, poolBalancesData]);
  
  // Show skeleton during initial data load
  const isInitialLoading = !poolBalancesData && !bankAccountsData;
  
  // Separate requests by status
  const pendingRequests = financeRequests.filter((r: FinanceRequest) => r.status === 'pending');
  
  // Process request mutation
  const processMutation = useMutation({
    mutationFn: async (data: { id: string; status: string; processType?: string; sourceType?: string; fundSource?: string; bankAccountId?: string; cashBoxId?: string; notes?: string }) => {
      return apiFetch(`/api/finance/requests/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: data.status,
          processType: data.processType,
          sourceType: data.sourceType,
          fundSource: data.fundSource,
          bankAccountId: data.bankAccountId,
          cashBoxId: data.cashBoxId,
          notes: data.notes,
          processedById: user?.id || ''
        })
      });
    },
    onSuccess: () => {
      toast.success('Request berhasil diproses');
      setProcessingRequest(null);
      queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['salaries'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
      queryClient.invalidateQueries({ queryKey: ['company-debts'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  // Create bank account mutation
  const createBankMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/bank-accounts', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Rekening bank berhasil ditambahkan');
      setShowBankForm(false);
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  // Create cash box mutation
  const createCashBoxMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/cash-boxes', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Cash box berhasil ditambahkan');
      setShowCashBoxForm(false);
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  // Create transfer mutation
  const createTransferMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/transfers', {
        method: 'POST',
        body: JSON.stringify({ ...data, processedById: user?.id || '' })
      });
    },
    onSuccess: () => {
      toast.success('Transfer berhasil dibuat');
      setShowTransferForm(false);
      queryClient.invalidateQueries({ queryKey: ['fund-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  // Process transfer mutation
  const processTransferMutation = useMutation({
    mutationFn: async (data: { id: string; status: string }) => {
      return apiFetch(`/api/finance/transfers/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: data.status, processedById: user?.id || '' })
      });
    },
    onSuccess: () => {
      toast.success('Transfer berhasil diproses');
      queryClient.invalidateQueries({ queryKey: ['fund-transfers'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Update bank account mutation
  const updateBankMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch(`/api/finance/bank-accounts/${data.id}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Rekening bank berhasil diperbarui');
      setEditingBank(null);
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Delete bank account mutation
  const deleteBankMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/finance/bank-accounts/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Rekening bank berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Update cash box mutation
  const updateCashBoxMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch(`/api/finance/cash-boxes/${data.id}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Brankas/kas berhasil diperbarui');
      setEditingCashBox(null);
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Delete cash box mutation
  const deleteCashBoxMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/finance/cash-boxes/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Brankas/kas berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Update pool balances mutation (manual adjustment)
  const updatePoolsMutation = useMutation({
    mutationFn: async (data: { hppPaidBalance?: number; profitPaidBalance?: number; investorFund?: number; totalPhysical: number }) => {
      return apiFetch('/api/finance/pools', {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Pool dana berhasil diperbarui');
      setShowPoolDialog(false);
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  const syncPoolsMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/finance/pools', {
        method: 'POST',
        body: JSON.stringify({ action: 'sync_from_payments' })
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Pool dana berhasil disinkronkan');
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Banking-grade reconciliation
  const reconcileMutation = useMutation({
    mutationFn: async (autoFix: boolean) => {
      return apiFetch<{ is_healthy: boolean; issues_count: number; issues: any[]; auto_fixed: boolean }>('/api/finance/pools', {
        method: 'POST',
        body: JSON.stringify({ action: 'reconcile', autoFix })
      });
    },
    onSuccess: (data) => {
      if (data.is_healthy) {
        toast.success('Semua data keuangan konsisten');
      } else if (data.auto_fixed) {
        toast.success(`${data.issues_count} masalah diperbaiki otomatis`);
      } else {
        toast.warning(`${data.issues_count} ketidaksesuaian terdeteksi — gunakan "Perbaiki Otomatis"`);
      }
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Transfer Dana Lain-lain mutation (pool-to-physical)
  const transferLainLainMutation = useMutation({
    mutationFn: async ({ amount, destinationType, destinationId }: { amount: number; destinationType: 'cashbox' | 'bank'; destinationId: string }) => {
      return apiFetch('/api/finance/pools', {
        method: 'POST',
        body: JSON.stringify({ action: 'transfer_lain_lain', amount, destinationType, destinationId })
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Transfer berhasil');
      closeTransferDialog();
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Pool-to-pool transfer mutation
  const poolTransferMutation = useMutation({
    mutationFn: async ({ fromPool, toPool, amount }: { fromPool: string; toPool: string; amount: number }) => {
      return apiFetch('/api/finance/pools', {
        method: 'POST',
        body: JSON.stringify({ action: 'pool_transfer', fromPool, toPool, amount })
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Transfer pool berhasil');
      closeTransferDialog();
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  function closeTransferDialog() {
    setShowTransferDialog(false);
    setTransferAmount('');
    setTransferDestId('');
    setTransferFromPool('profit');
    setTransferToPool('hpp');
    setTransferMode('pool_to_pool');
  }

  // Deposit to bank account mutation
  const bankDepositMutation = useMutation({
    mutationFn: async ({ id, amount, description }: { id: string; amount: number; description?: string }) => {
      return apiFetch(`/api/finance/bank-accounts/${id}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ amount, description })
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Dana berhasil ditambahkan');
      setDepositingBank(null);
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // Deposit to cash box mutation
  const cashBoxDepositMutation = useMutation({
    mutationFn: async ({ id, amount, description }: { id: string; amount: number; description?: string }) => {
      return apiFetch(`/api/finance/cash-boxes/${id}/deposit`, {
        method: 'POST',
        body: JSON.stringify({ amount, description })
      });
    },
    onSuccess: (data: any) => {
      toast.success(data.message || 'Dana berhasil ditambahkan');
      setDepositingCashBox(null);
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
      queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  // getRequestTypeLabel and getRequestTypeColor are defined outside the component

  if (isInitialLoading) return <FinanceDashboardSkeleton />;

  return (
    <div className="space-y-4 safe-bottom w-full min-w-0 overflow-x-hidden">
      {/* Fund Balances Summary — 1 column x 6 rows on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-1.5 sm:gap-2">
        <Card className="min-w-0 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">HPP Dibayar</p>
              <p className="text-xs sm:text-lg font-bold text-purple-700 dark:text-purple-300 truncate">{formatCurrency(fundBalances.hppPaidBalance)}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-0 bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-950 dark:to-teal-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-teal-500/20 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Profit Dibayar</p>
              <p className="text-xs sm:text-lg font-bold text-teal-700 dark:text-teal-300 truncate">{formatCurrency(fundBalances.profitPaidBalance)}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-0 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Brankas</p>
              <p className="text-xs sm:text-lg font-bold text-amber-700 dark:text-amber-300 truncate">{formatCurrency(fundBalances.totalCashInBoxes)}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-0 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Bank</p>
              <p className="text-xs sm:text-lg font-bold text-green-700 dark:text-green-300 truncate">{formatCurrency(fundBalances.totalInBanks)}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-0 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-orange-500/20 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Dana Kurir</p>
              <p className="text-xs sm:text-lg font-bold text-orange-700 dark:text-orange-300 truncate">{formatCurrency(fundBalances.totalWithCouriers)}</p>
            </div>
          </CardContent>
        </Card>
        
        <Card className="min-w-0 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
          <CardContent className="p-2.5 sm:p-4 flex items-center gap-2.5 sm:gap-2">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">Total Dana</p>
              <p className="text-xs sm:text-lg font-bold text-emerald-700 dark:text-emerald-300 truncate">{formatCurrency(fundBalances.totalFunds)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pool Dana — Komposisi Dana: Always synced with Brankas & Rekening */}
      <Card className="min-w-0 border-dashed border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-r from-purple-50/50 to-teal-50/50 dark:from-purple-950/50 dark:to-teal-950/50">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3 gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                <CircleDollarSign className="w-4 h-4 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">Pool Dana — Komposisi Dana</p>
                <p className="text-[10px] text-muted-foreground truncate">Kelola alokasi dana perusahaan</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => setShowTransferDialog(true)}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Transfer</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={() => syncPoolsMutation.mutate()}
                disabled={syncPoolsMutation.isPending}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncPoolsMutation.isPending ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Sinkron</span>
              </Button>
              <Dialog open={showPoolDialog} onOpenChange={(open) => { setShowPoolDialog(open); if (open) setPoolFormKey(k => k + 1); }}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    <PencilRuler className="w-3.5 h-3.5" />
                    Update
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <PencilRuler className="w-5 h-5" />
                      Update Komposisi Dana
                    </DialogTitle>
                    <DialogDescription>
                      Atur HPP, Profit, atau Dana Lain-lain secara manual.
                    </DialogDescription>
                  </DialogHeader>
                  <PoolAdjustForm
                    key={poolFormKey}
                    totalPhysical={fundBalances.totalPhysical}
                    currentHpp={fundBalances.hppPaidBalance}
                    currentProfit={fundBalances.profitPaidBalance}
                    currentInvestorFund={fundBalances.investorFund}
                    onSave={(data) => updatePoolsMutation.mutate(data)}
                    isSaving={updatePoolsMutation.isPending}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Brankas & Rekening Detail */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Brankas Section */}
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Warehouse className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Brankas</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{cashBoxes.length} akun</span>
              </div>
              {cashBoxes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic py-2 text-center">Belum ada brankas</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {cashBoxes.map((cb: CashBox) => (
                    <div key={cb.id} className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-amber-800 dark:text-amber-200">{cb.name}</span>
                      <span className="font-semibold text-amber-700 dark:text-amber-300 ml-2 shrink-0">{formatCurrency(cb.balance)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 pt-1.5 border-t border-amber-200 dark:border-amber-700 flex items-center justify-between">
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Subtotal Brankas</span>
                <span className="text-xs font-bold text-amber-800 dark:text-amber-200">{formatCurrency(fundBalances.totalCashInBoxes)}</span>
              </div>
            </div>

            {/* Rekening Section */}
            <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/40 dark:bg-green-950/20 p-2.5">
              <div className="flex items-center gap-1.5 mb-2">
                <Building2 className="w-3.5 h-3.5 text-green-600" />
                <span className="text-xs font-semibold text-green-700 dark:text-green-300">Rekening Bank</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{bankAccounts.length} akun</span>
              </div>
              {bankAccounts.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic py-2 text-center">Belum ada rekening</p>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {bankAccounts.map((ba: BankAccount) => (
                    <div key={ba.id} className="flex items-center justify-between text-[11px]">
                      <span className="truncate text-green-800 dark:text-green-200">{ba.name} — {ba.accountNo}</span>
                      <span className="font-semibold text-green-700 dark:text-green-300 ml-2 shrink-0">{formatCurrency(ba.balance)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 pt-1.5 border-t border-green-200 dark:border-green-700 flex items-center justify-between">
                <span className="text-[11px] font-medium text-green-700 dark:text-green-300">Subtotal Rekening</span>
                <span className="text-xs font-bold text-green-800 dark:text-green-200">{formatCurrency(fundBalances.totalInBanks)}</span>
              </div>
            </div>
          </div>

          {/* Total Dana Fisik = Brankas + Rekening */}
          <div className="rounded-lg bg-emerald-100/60 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 px-3 py-2 mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">Total Dana Fisik (Brankas + Rekening)</span>
            <span className="text-sm font-bold text-emerald-800 dark:text-emerald-200">{formatCurrency(fundBalances.totalPhysical)}</span>
          </div>

          {/* Komposisi: HPP + Profit + Lain-lain = Total Fisik */}
          <div className="space-y-2 mb-3">
            {(() => {
              const total = fundBalances.totalPhysical || 1;
              const hppPct = (fundBalances.hppPaidBalance / total) * 100;
              const profitPct = (fundBalances.profitPaidBalance / total) * 100;
              const lainPct = (fundBalances.investorFund / total) * 100;

              return (
                <>
                  {/* HPP Terbayar */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-purple-700 dark:text-purple-300 font-medium">HPP Sudah Terbayar</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{hppPct.toFixed(1)}%</span>
                        <span className="font-bold text-purple-700 dark:text-purple-300">{formatCurrency(fundBalances.hppPaidBalance)}</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full bg-purple-500 transition-all duration-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, hppPct))}%` }} />
                    </div>
                  </div>

                  {/* Profit Terbayar */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-teal-700 dark:text-teal-300 font-medium">Profit Sudah Terbayar</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{profitPct.toFixed(1)}%</span>
                        <span className="font-bold text-teal-700 dark:text-teal-300">{formatCurrency(fundBalances.profitPaidBalance)}</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full bg-teal-500 transition-all duration-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, profitPct))}%` }} />
                    </div>
                  </div>

                  {/* Dana Lain-lain */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] mb-0.5">
                      <span className="text-amber-700 dark:text-amber-300 font-medium">Dana Lain-lain</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{lainPct.toFixed(1)}%</span>
                        <span className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(fundBalances.investorFund)}</span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-muted">
                      <div className="h-full bg-amber-400 transition-all duration-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, lainPct))}%` }} />
                    </div>
                  </div>

                  {/* Combined visual bar */}
                  <div className="mt-1">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> HPP</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-teal-500 inline-block" /> Profit</span>
                      <div className="flex-1" />
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Lain-lain</span>
                    </div>
                    <div className="h-2.5 rounded-full overflow-hidden bg-muted flex">
                      <div className="bg-purple-500 transition-all duration-500" style={{ width: `${Math.max(0, hppPct)}%` }} />
                      <div className="bg-teal-500 transition-all duration-500" style={{ width: `${Math.max(0, profitPct)}%` }} />
                      <div className="bg-amber-400 transition-all duration-500" style={{ width: `${Math.max(0, lainPct)}%` }} />
                    </div>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Summary: Pool vs Fisik + Banking-grade Health Check */}
          <div className={`p-2.5 rounded-lg border text-xs ${fundBalances.isHealthy && fundBalances.poolDiff === 0 ? 'bg-green-50 border-green-200 dark:bg-green-950/40 dark:border-green-800' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-800'}`}>
            {fundBalances.isHealthy && fundBalances.poolDiff === 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-medium text-green-700 dark:text-green-300">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Data Keuangan Konsisten
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-green-600 hover:text-green-800 dark:text-green-400 px-1.5"
                    onClick={() => reconcileMutation.mutate(false)} disabled={reconcileMutation.isPending}>
                    <RefreshCw className={`w-3 h-3 mr-0.5 ${reconcileMutation.isPending ? 'animate-spin' : ''}`} />
                    Cek Ulang
                  </Button>
                </div>
                <div className="text-[10px] text-green-600 dark:text-green-400 mt-0.5">
                  Pool {formatCurrency(fundBalances.totalPool)} = Fisik {formatCurrency(fundBalances.totalPhysical)}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Ketidaksesuaian Terdeteksi
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-amber-600 hover:text-amber-800 dark:text-amber-400 px-1.5"
                      onClick={() => reconcileMutation.mutate(true)} disabled={reconcileMutation.isPending}>
                      <History className="w-3 h-3 mr-0.5" />
                      Perbaiki
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px] text-muted-foreground hover:text-foreground px-1.5"
                      onClick={() => reconcileMutation.mutate(false)} disabled={reconcileMutation.isPending}>
                      <Info className="w-3 h-3 mr-0.5" />
                      Detail
                    </Button>
                  </div>
                </div>
                <div className="text-[10px] text-amber-600 dark:text-amber-400 space-y-0.5">
                  {fundBalances.poolDiff !== 0 && (
                    <div>Pool {formatCurrency(fundBalances.totalPool)} {fundBalances.poolDiff > 0 ? '<' : '>'} Fisik {formatCurrency(fundBalances.totalPhysical)} (selisih {formatCurrency(Math.abs(fundBalances.poolDiff))})</div>
                  )}
                  {fundBalances.hppDiff !== 0 && (
                    <div>HPP tersimpan {formatCurrency(fundBalances.hppPaidBalance)} vs derived {formatCurrency(fundBalances.derivedHpp)} (selisih {formatCurrency(Math.abs(fundBalances.hppDiff))})</div>
                  )}
                  {fundBalances.profitDiff !== 0 && (
                    <div>Profit tersimpan {formatCurrency(fundBalances.profitPaidBalance)} vs derived {formatCurrency(fundBalances.derivedProfit)} (selisih {formatCurrency(Math.abs(fundBalances.profitDiff))})</div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Gunakan "Perbaiki" untuk auto-sync dari data transaksi
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transfer Dana Dialog — Pool-to-Pool & Pool-to-Physical */}
      <Dialog open={showTransferDialog} onOpenChange={(open) => { if (!open) closeTransferDialog(); else setShowTransferDialog(true); }}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5" />
              Transfer Dana Pool
            </DialogTitle>
            <DialogDescription>
              Pindahkan dana antar pool (HPP/Profit/Lain-lain) atau dari pool ke rekening/brankas
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Mode Selector */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Tipe Transfer</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={transferMode === 'pool_to_pool' ? 'default' : 'outline'}
                  className="h-9 text-xs"
                  onClick={() => setTransferMode('pool_to_pool')}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
                  Pool → Pool
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={transferMode === 'pool_to_physical' ? 'default' : 'outline'}
                  className="h-9 text-xs"
                  onClick={() => setTransferMode('pool_to_physical')}
                >
                  <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
                  Pool → Rekening/Brankas
                </Button>
              </div>
            </div>

            {transferMode === 'pool_to_pool' ? (
              <>
                {/* Pool balances overview */}
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'hpp' as const, label: 'HPP', balance: fundBalances.hppPaidBalance, color: 'purple' },
                    { key: 'profit' as const, label: 'Profit', balance: fundBalances.profitPaidBalance, color: 'teal' },
                    { key: 'lain_lain' as const, label: 'Lain-lain', balance: fundBalances.investorFund, color: 'amber' },
                  ]).map((pool) => (
                    <div
                      key={pool.key}
                      className={cn(
                        'p-2 rounded-lg border-2 text-center transition-all cursor-pointer',
                        transferFromPool === pool.key
                          ? pool.color === 'purple' ? 'border-purple-400 bg-purple-50 dark:bg-purple-950/30' : pool.color === 'teal' ? 'border-teal-400 bg-teal-50 dark:bg-teal-950/30' : 'border-amber-400 bg-amber-50 dark:bg-amber-950/30'
                          : 'border-muted',
                      )}
                    >
                      <p className="text-[10px] text-muted-foreground">{pool.label}</p>
                      <p className={cn(
                        'text-xs font-bold',
                        pool.color === 'purple' ? 'text-purple-700 dark:text-purple-300' : pool.color === 'teal' ? 'text-teal-700 dark:text-teal-300' : 'text-amber-700 dark:text-amber-300'
                      )}>
                        {formatCurrency(pool.balance)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* From Pool */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Dari Pool</Label>
                  <Select value={transferFromPool} onValueChange={(v: any) => { setTransferFromPool(v); if (v === transferToPool) { const others: any[] = ['hpp','profit','lain_lain'].filter(x => x !== v); setTransferToPool(others[0]); } }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hpp">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-purple-500" />
                          HPP Sudah Terbayar — {formatCurrency(fundBalances.hppPaidBalance)}
                        </span>
                      </SelectItem>
                      <SelectItem value="profit">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-teal-500" />
                          Profit Sudah Terbayar — {formatCurrency(fundBalances.profitPaidBalance)}
                        </span>
                      </SelectItem>
                      <SelectItem value="lain_lain">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                          Dana Lain-lain — {formatCurrency(fundBalances.investorFund)}
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Arrow indicator */}
                <div className="flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>

                {/* To Pool */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Ke Pool</Label>
                  <Select value={transferToPool} onValueChange={(v: any) => setTransferToPool(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['hpp','profit','lain_lain'] as const).filter(k => k !== transferFromPool).map((key) => {
                        const label = key === 'hpp' ? 'HPP Sudah Terbayar' : key === 'profit' ? 'Profit Sudah Terbayar' : 'Dana Lain-lain';
                        const balance = key === 'hpp' ? fundBalances.hppPaidBalance : key === 'profit' ? fundBalances.profitPaidBalance : fundBalances.investorFund;
                        const color = key === 'hpp' ? 'bg-purple-500' : key === 'profit' ? 'bg-teal-500' : 'bg-amber-400';
                        return (
                          <SelectItem key={key} value={key}>
                            <span className="flex items-center gap-2">
                              <span className={cn('w-2 h-2 rounded-full', color)} />
                              {label} — {formatCurrency(balance)}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Jumlah Transfer (Rp)</Label>
                  <Input
                    type="number"
                    min="0"
                    max={transferFromPool === 'hpp' ? fundBalances.hppPaidBalance : transferFromPool === 'profit' ? fundBalances.profitPaidBalance : fundBalances.investorFund}
                    placeholder="Masukkan jumlah"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                  />
                  {transferAmount && Number(transferAmount) > 0 && (
                    <p className="text-xs text-muted-foreground">{formatCurrency(Number(transferAmount))}</p>
                  )}
                </div>

                {/* Preview */}
                {transferAmount && Number(transferAmount) > 0 && (
                  <div className="p-3 rounded-lg border bg-muted/30 space-y-1.5 text-xs">
                    <p className="font-medium text-sm mb-2">Preview Transfer</p>
                    {(() => {
                      const amt = Number(transferAmount);
                      const fromBal = transferFromPool === 'hpp' ? fundBalances.hppPaidBalance : transferFromPool === 'profit' ? fundBalances.profitPaidBalance : fundBalances.investorFund;
                      const fromLabel = transferFromPool === 'hpp' ? 'HPP' : transferFromPool === 'profit' ? 'Profit' : 'Lain-lain';
                      const toLabel = transferToPool === 'hpp' ? 'HPP' : transferToPool === 'profit' ? 'Profit' : 'Lain-lain';
                      const toBal = transferToPool === 'hpp' ? fundBalances.hppPaidBalance : transferToPool === 'profit' ? fundBalances.profitPaidBalance : fundBalances.investorFund;
                      const insufficient = fromBal < amt;
                      return (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{fromLabel} sebelum</span>
                            <span className={cn('font-medium', insufficient && 'text-red-500')}>{formatCurrency(fromBal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{fromLabel} sesudah</span>
                            <span className={cn('font-medium', fromBal - amt < 0 && 'text-red-500')}>{formatCurrency(fromBal - amt)}</span>
                          </div>
                          <div className="border-t my-1" />
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{toLabel} sebelum</span>
                            <span className="font-medium">{formatCurrency(toBal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">{toLabel} sesudah</span>
                            <span className="font-medium text-emerald-600">{formatCurrency(toBal + amt)}</span>
                          </div>
                          {insufficient && (
                            <p className="text-red-500 text-[11px] mt-1">⚠ Saldo {fromLabel} tidak mencukupi!</p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Pool-to-Physical mode: Dana Lain-lain → Brankas/Rekening */}
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800">
                  <p className="text-xs text-amber-600 dark:text-amber-400">Saldo Dana Lain-lain tersedia</p>
                  <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{formatCurrency(fundBalances.investorFund)}</p>
                </div>

                {/* Amount */}
                <div className="space-y-2">
                  <Label className="text-sm">Jumlah Transfer (Rp)</Label>
                  <Input
                    type="number"
                    min="0"
                    max={fundBalances.investorFund}
                    placeholder="Masukkan jumlah"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                  />
                  {transferAmount && Number(transferAmount) > 0 && (
                    <p className="text-xs text-muted-foreground">{formatCurrency(Number(transferAmount))}</p>
                  )}
                </div>

                {/* Destination Type */}
                <div className="space-y-2">
                  <Label className="text-sm">Tujuan Transfer</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={transferDestType === 'bank' ? 'default' : 'outline'}
                      className="h-9 text-xs"
                      onClick={() => { setTransferDestType('bank'); setTransferDestId(''); }}
                    >
                      🏦 Rekening Bank
                    </Button>
                    <Button
                      type="button"
                      variant={transferDestType === 'cashbox' ? 'default' : 'outline'}
                      className="h-9 text-xs"
                      onClick={() => { setTransferDestType('cashbox'); setTransferDestId(''); }}
                    >
                      🏪 Brankas/Kas
                    </Button>
                  </div>
                </div>

                {/* Destination Account */}
                <div className="space-y-2">
                  <Label className="text-sm">Pilih {transferDestType === 'bank' ? 'Rekening' : 'Brankas'}</Label>
                  <Select value={transferDestId} onValueChange={setTransferDestId}>
                    <SelectTrigger>
                      <SelectValue placeholder={`Pilih ${transferDestType === 'bank' ? 'rekening' : 'brankas'}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {(transferDestType === 'bank' ? bankAccounts : cashBoxes).map((acc: any) => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name} — {formatCurrency(acc.balance)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeTransferDialog}>Batal</Button>
            <Button
              onClick={() => {
                if (transferMode === 'pool_to_pool') {
                  if (transferFromPool === transferToPool) {
                    toast.error('Pool asal dan tujuan tidak boleh sama');
                    return;
                  }
                  const amount = Number(transferAmount);
                  const fromPoolBalance = transferFromPool === 'hpp' ? fundBalances.hppPaidBalance : transferFromPool === 'profit' ? fundBalances.profitPaidBalance : fundBalances.investorFund;
                  if (amount > fromPoolBalance) {
                    toast.error('Jumlah melebihi saldo pool sumber');
                    return;
                  }
                  poolTransferMutation.mutate({
                    fromPool: transferFromPool,
                    toPool: transferToPool,
                    amount,
                  });
                } else {
                  transferLainLainMutation.mutate({
                    amount: Number(transferAmount),
                    destinationType: transferDestType,
                    destinationId: transferDestId,
                  });
                }
              }}
              disabled={
                poolTransferMutation.isPending || transferLainLainMutation.isPending
                || !transferAmount || Number(transferAmount) <= 0
                || (transferMode === 'pool_to_pool' && transferFromPool === transferToPool)
                || (transferMode === 'pool_to_physical' && !transferDestId)
              }
            >
              {poolTransferMutation.isPending || transferLainLainMutation.isPending ? 'Memproses...' : 'Transfer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Pending Requests Alert */}
      {pendingRequests.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm sm:text-base text-amber-800 dark:text-amber-200 truncate">
                  {pendingRequests.length} request menunggu persetujuan
                </p>
                <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400 truncate">
                  Total: {formatCurrency(pendingRequests.reduce((sum: number, r: FinanceRequest) => sum + r.amount, 0))}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Mobile: Dropdown selector */}
        <div className="sm:hidden">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih menu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="requests">
                <span className="inline-flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  <span>Request</span>
                  {pendingRequests.length > 0 && (
                    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">{pendingRequests.length}</span>
                  )}
                </span>
              </SelectItem>
              <SelectItem value="mutations">
                <span className="inline-flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-green-600" />
                  <span>Mutasi Bank</span>
                </span>
              </SelectItem>
              <SelectItem value="transfers">
                <span className="inline-flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4" />
                  <span>Transfer</span>
                </span>
              </SelectItem>
              <SelectItem value="banks">
                <span className="inline-flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  <span>Rekening</span>
                </span>
              </SelectItem>
              <SelectItem value="cashbox">
                <span className="inline-flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  <span>Brankas</span>
                </span>
              </SelectItem>
              <SelectItem value="piutang">
                <span className="inline-flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  <span>Piutang</span>
                  {receivableStats.overdueCount > 0 && (
                    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">{receivableStats.overdueCount}</span>
                  )}
                </span>
              </SelectItem>
              <SelectItem value="cashback">
                <span className="inline-flex items-center gap-2">
                  <Gift className="w-4 h-4" />
                  <span>Pencairan</span>
                </span>
              </SelectItem>
              <SelectItem value="cashflow">
                <span className="inline-flex items-center gap-2">
                  <History className="w-4 h-4" />
                  <span>Arus Kas</span>
                </span>
              </SelectItem>
                  <SelectItem value="debts">
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Hutang</span>
                  {(debts.filter((d: CompanyDebt) => d.status === 'active').length + purchaseDebts.length) > 0 && (
                    <span className="ml-auto w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">{debts.filter((d: CompanyDebt) => d.status === 'active').length + purchaseDebts.length}</span>
                  )}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: Tab buttons */}
        <TabsList className="hidden sm:flex overflow-x-auto scrollbar-hide">
          <TabsTrigger value="requests" className="relative shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Request
            {pendingRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {pendingRequests.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="mutations" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400">
            <Receipt className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="hidden sm:inline">Mutasi</span>
            <span className="sm:hidden">Mutasi</span>
          </TabsTrigger>
          <TabsTrigger value="transfers" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <ArrowLeftRight className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Transfer
          </TabsTrigger>
          <TabsTrigger value="banks" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Rekening
          </TabsTrigger>
          <TabsTrigger value="cashbox" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Brankas
          </TabsTrigger>
          <TabsTrigger value="cashback" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <Gift className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Pencairan
          </TabsTrigger>
          <TabsTrigger value="cashflow" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <History className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Arus Kas
          </TabsTrigger>
          <TabsTrigger value="piutang" className="relative shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <TrendingUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Piutang
            {receivableStats.overdueCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {receivableStats.overdueCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="debts" className="relative shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1">
            <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            Hutang
            {(debts.filter((d: CompanyDebt) => d.status === 'active').length + purchaseDebts.length) > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {debts.filter((d: CompanyDebt) => d.status === 'active').length + purchaseDebts.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        
        {/* Requests Tab */}
        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader className="px-4 sm:px-6 pt-4 sm:pt-6">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="text-sm sm:text-base">Request Keuangan</CardTitle>
                  <CardDescription className="text-xs sm:text-sm">Daftar request yang memerlukan persetujuan Finance</CardDescription>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 gap-1 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950" onClick={() => setShowExpenseDialog(true)}>
                  <Plus className="w-3.5 h-3.5" />
                  Pengeluaran
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-hidden min-w-0">
              <div className="max-h-[600px] overflow-y-auto overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap w-[90px] min-w-[90px]">Tipe</TableHead>
                      <TableHead className="whitespace-nowrap min-w-0">Deskripsi</TableHead>
                      <TableHead className="whitespace-nowrap text-right w-[130px] min-w-[130px]">Jumlah</TableHead>
                      <TableHead className="whitespace-nowrap w-[100px] min-w-[100px]">Status</TableHead>
                      <TableHead className="whitespace-nowrap w-[110px] min-w-[110px]">Tanggal</TableHead>
                      <TableHead className="whitespace-nowrap text-center w-[90px] min-w-[90px]">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {financeRequests.map((req: FinanceRequest) => (
                      <TableRow key={req.id}>
                        <TableCell>
                          <Badge className={getRequestTypeColor(req.type)}>
                            {getRequestTypeLabel(req.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-0">
                          <div className="max-w-[200px] truncate">
                            <p className="font-medium truncate">{req.description}</p>
                            {req.supplier && (
                              <p className="text-xs text-muted-foreground truncate">Supplier: {req.supplier.name}</p>
                            )}
                            {req.type === 'salary' && req.salaryPayment && (
                              <div className="flex items-center gap-1 mt-1">
                                <Avatar className="h-5 w-5">
                                  <AvatarFallback className="text-[10px]">{getInitials(req.salaryPayment.user?.name || '?')}</AvatarFallback>
                                </Avatar>
                                <p className="text-xs text-muted-foreground truncate">
                                  {req.salaryPayment.user?.name} • {req.salaryPayment.user?.role}
                                </p>
                              </div>
                            )}
                            <WorkflowInfo req={req} />
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-bold whitespace-nowrap">{formatCurrency(req.amount)}</TableCell>
                        <TableCell>
                          <Badge variant={
                            req.status === 'pending' ? 'secondary' :
                            req.status === 'approved' ? 'default' :
                            req.status === 'processed' ? 'default' : 'destructive'
                          }>
                            {req.status === 'pending' ? 'Menunggu' :
                             req.status === 'approved' ? 'Disetujui' :
                             req.status === 'processed' ? 'Selesai Diproses' : 'Ditolak'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDateTime(req.createdAt)}</TableCell>
                        <TableCell className="shrink-0">
                          {req.status === 'pending' && (
                            <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <Edit className="w-4 h-4 mr-1" />
                                  Proses
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Proses Request - {getRequestTypeLabel(req.type)}</DialogTitle>
                                  <DialogDescription>
                                    {req.description}
                                  </DialogDescription>
                                </DialogHeader>
                                <ProcessRequestDialog
                                  request={req}
                                  bankAccounts={bankAccounts}
                                  cashBoxes={cashBoxes}
                                  fundBalances={fundBalances}
                                  onProcess={(data) => processMutation.mutate(data)}
                                  isProcessing={processMutation.isPending}
                                />
                              </DialogContent>
                            </Dialog>
                          )}
                          {req.status === 'approved' && req.type === 'salary' && (
                            <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="bg-green-50 border-green-300 text-green-700 hover:bg-green-100">
                                  <DollarSign className="w-4 h-4 mr-1" />
                                  Bayar Gaji
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Bayar Gaji - {req.salaryPayment?.user?.name}</DialogTitle>
                                  <DialogDescription>
                                    Gaji sudah disetujui. Pilih komposisi dana untuk pembayaran.
                                  </DialogDescription>
                                </DialogHeader>
                                <ProcessRequestDialog
                                  request={{ ...req, forcePayNow: true }}
                                  bankAccounts={bankAccounts}
                                  cashBoxes={cashBoxes}
                                  fundBalances={fundBalances}
                                  onProcess={(data) => processMutation.mutate(data)}
                                  isProcessing={processMutation.isPending}
                                />
                              </DialogContent>
                            </Dialog>
                          )}
                          {req.status === 'approved' && req.type === 'purchase' && (
                            <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                              <DialogTrigger asChild>
                                <Button size="sm" variant="outline" className="bg-green-50 border-green-300 text-green-700 hover:bg-green-100">
                                  <DollarSign className="w-4 h-4 mr-1" />
                                  Bayar
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                                <DialogHeader>
                                  <DialogTitle>Bayar Pembelian - {req.supplier?.name || 'Supplier'}</DialogTitle>
                                  <DialogDescription>
                                    Pembelian sudah disetujui. Pilih sumber dana untuk pembayaran.
                                  </DialogDescription>
                                </DialogHeader>
                                <ProcessRequestDialog
                                  request={{ ...req, forcePayNow: true }}
                                  bankAccounts={bankAccounts}
                                  cashBoxes={cashBoxes}
                                  fundBalances={fundBalances}
                                  onProcess={(data) => processMutation.mutate(data)}
                                  isProcessing={processMutation.isPending}
                                />
                              </DialogContent>
                            </Dialog>
                          )}
                          {req.status === 'processed' && (
                            <Badge className="bg-green-500">Selesai</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {financeRequests.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Belum ada request
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              </div>

                {/* Mobile Card View */}
                <div className="block md:hidden p-3 space-y-2">
                  {financeRequests.map((req: FinanceRequest) => (
                    <div key={req.id} className="p-3 border rounded-lg space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge className={`shrink-0 ${getRequestTypeColor(req.type)}`}>
                            {getRequestTypeLabel(req.type)}
                          </Badge>
                          <span className="font-medium text-sm min-w-0 truncate">{req.description}</span>
                        </div>
                        <Badge variant={
                          req.status === 'pending' ? 'secondary' :
                          req.status === 'approved' ? 'default' :
                          req.status === 'processed' ? 'default' : 'destructive'
                        } className="shrink-0 text-xs">
                          {req.status === 'pending' ? 'Menunggu' :
                           req.status === 'approved' ? 'Disetujui' :
                           req.status === 'processed' ? 'Selesai Diproses' : 'Ditolak'}
                        </Badge>
                      </div>
                      {(req.supplier || (req.type === 'salary' && req.salaryPayment)) && (
                        <div className="text-xs text-muted-foreground min-w-0">
                          {req.supplier && <span className="truncate block">{req.supplier.name}</span>}
                          {req.type === 'salary' && req.salaryPayment && (
                            <span>{req.supplier ? ' • ' : ''}{req.salaryPayment.user?.name} • {req.salaryPayment.user?.role}</span>
                          )}
                        </div>
                      )}
                      <WorkflowInfo req={req} />
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{formatCurrency(req.amount)}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(req.createdAt)}</span>
                      </div>
                      <div className="flex justify-end gap-1">
                        {req.status === 'pending' && (
                          <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs">
                                <Edit className="w-3 h-3 mr-1" />
                                Proses
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Proses Request - {getRequestTypeLabel(req.type)}</DialogTitle>
                                <DialogDescription>{req.description}</DialogDescription>
                              </DialogHeader>
                              <ProcessRequestDialog
                                request={req}
                                bankAccounts={bankAccounts}
                                cashBoxes={cashBoxes}
                                fundBalances={fundBalances}
                                onProcess={(data) => processMutation.mutate(data)}
                                isProcessing={processMutation.isPending}
                              />
                            </DialogContent>
                          </Dialog>
                        )}
                        {req.status === 'approved' && req.type === 'salary' && (
                          <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs bg-green-50 border-green-300 text-green-700 hover:bg-green-100">
                                <DollarSign className="w-3 h-3 mr-1" />
                                Bayar
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Bayar Gaji - {req.salaryPayment?.user?.name}</DialogTitle>
                                <DialogDescription>Gaji sudah disetujui. Pilih komposisi dana untuk pembayaran.</DialogDescription>
                              </DialogHeader>
                              <ProcessRequestDialog
                                request={{ ...req, forcePayNow: true }}
                                bankAccounts={bankAccounts}
                                cashBoxes={cashBoxes}
                                fundBalances={fundBalances}
                                onProcess={(data) => processMutation.mutate(data)}
                                isProcessing={processMutation.isPending}
                              />
                            </DialogContent>
                          </Dialog>
                        )}
                        {req.status === 'approved' && req.type === 'purchase' && (
                          <Dialog open={processingRequest === req.id} onOpenChange={(open) => setProcessingRequest(open ? req.id : null)}>
                            <DialogTrigger asChild>
                              <Button size="sm" variant="outline" className="h-7 text-xs bg-green-50 border-green-300 text-green-700 hover:bg-green-100">
                                <DollarSign className="w-3 h-3 mr-1" />
                                Bayar
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                              <DialogHeader>
                                <DialogTitle>Bayar Pembelian - {req.supplier?.name || 'Supplier'}</DialogTitle>
                                <DialogDescription>Pembelian sudah disetujui. Pilih sumber dana untuk pembayaran.</DialogDescription>
                              </DialogHeader>
                              <ProcessRequestDialog
                                request={{ ...req, forcePayNow: true }}
                                bankAccounts={bankAccounts}
                                cashBoxes={cashBoxes}
                                fundBalances={fundBalances}
                                onProcess={(data) => processMutation.mutate(data)}
                                isProcessing={processMutation.isPending}
                              />
                            </DialogContent>
                          </Dialog>
                        )}
                        {req.status === 'processed' && (
                          <Badge className="bg-green-500 text-xs">Selesai</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  {financeRequests.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      Belum ada request
                    </div>
                  )}
                </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Transfers Tab */}
        <TabsContent value="transfers" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
            <h3 className="font-semibold text-sm sm:text-base">Transfer Dana</h3>
            <Dialog open={showTransferForm} onOpenChange={(open) => { setShowTransferForm(open); if (open) setTransferFormKey(k => k + 1); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Transfer Baru
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Transfer Dana</DialogTitle>
                  <DialogDescription>Pindahkan dana antar rekening atau dari brankas ke bank</DialogDescription>
                </DialogHeader>
                <TransferForm
                  key={transferFormKey}
                  bankAccounts={bankAccounts}
                  cashBoxes={cashBoxes}
                  onSubmit={(data) => createTransferMutation.mutate(data)}
                  isLoading={createTransferMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
          
          <Card>
            <CardContent className="p-0 overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-hidden min-w-0">
              <div className="overflow-x-auto min-w-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap w-[110px] min-w-[110px]">Tipe</TableHead>
                    <TableHead className="whitespace-nowrap min-w-0">Dari</TableHead>
                    <TableHead className="whitespace-nowrap min-w-0">Ke</TableHead>
                    <TableHead className="whitespace-nowrap text-right w-[130px] min-w-[130px]">Jumlah</TableHead>
                    <TableHead className="whitespace-nowrap w-[90px] min-w-[90px]">Status</TableHead>
                    <TableHead className="whitespace-nowrap text-center w-[80px] min-w-[80px]">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t: FundTransfer) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Badge variant="outline">
                          {t.type === 'cash_to_bank' ? 'Brankas → Bank' :
                           t.type === 'bank_to_bank' ? 'Bank → Bank' : 'Bank → Brankas'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.fromBankAccount?.name || t.fromCashBox?.name || '-'}
                      </TableCell>
                      <TableCell>
                        {t.toBankAccount?.name || t.toCashBox?.name || '-'}
                      </TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(t.amount)}</TableCell>
                      <TableCell>
                        <Badge className={
                          t.status === 'completed' ? 'bg-green-500' :
                          t.status === 'pending' ? 'bg-amber-500' : 'bg-red-500'
                        }>
                          {t.status === 'completed' ? 'Selesai' :
                           t.status === 'pending' ? 'Pending' : 'Batal'}
                        </Badge>
                      </TableCell>
                      <TableCell className="shrink-0">
                        {t.status === 'pending' && (
                          <Button 
                            size="sm"
                            onClick={() => processTransferMutation.mutate({ id: t.id, status: 'completed' })}
                            disabled={processTransferMutation.isPending}
                          >
                            Proses
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {transfers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        Belum ada transfer
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              </div>
              </div>

              {/* Mobile Card View */}
              <div className="block md:hidden p-3 space-y-2">
                {transfers.map((t: FundTransfer) => (
                  <div key={t.id} className="p-3 border rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-xs shrink-0">
                        {t.type === 'cash_to_bank' ? 'Brankas → Bank' :
                         t.type === 'bank_to_bank' ? 'Bank → Bank' : 'Bank → Brankas'}
                      </Badge>
                      <Badge className={`shrink-0 text-xs ${
                        t.status === 'completed' ? 'bg-green-500' :
                        t.status === 'pending' ? 'bg-amber-500' : 'bg-red-500'
                      }`}>
                        {t.status === 'completed' ? 'Selesai' :
                         t.status === 'pending' ? 'Pending' : 'Batal'}
                      </Badge>
                    </div>
                    <div className="text-sm min-w-0">
                      <span className="text-muted-foreground truncate">{t.fromBankAccount?.name || t.fromCashBox?.name || '-'}</span>
                      <span className="mx-1.5">→</span>
                      <span className="font-medium truncate">{t.toBankAccount?.name || t.toCashBox?.name || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="font-semibold text-sm truncate">{formatCurrency(t.amount)}</span>
                      {t.status === 'pending' && (
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => processTransferMutation.mutate({ id: t.id, status: 'completed' })}
                          disabled={processTransferMutation.isPending}
                        >
                          Proses
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {transfers.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Belum ada transfer
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Bank Accounts Tab */}
        <TabsContent value="banks" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
            <h3 className="font-semibold text-sm sm:text-base">Rekening Bank</h3>
            <Dialog open={showBankForm} onOpenChange={(open) => { setShowBankForm(open); if (open) setBankFormKey(k => k + 1); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Tambah Rekening
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Tambah Rekening Bank</DialogTitle>
                  <DialogDescription className="sr-only">Form untuk menambah rekening bank</DialogDescription>
                </DialogHeader>
                <BankAccountForm
                  key={bankFormKey}
                  onSubmit={(data) => createBankMutation.mutate(data)}
                  isLoading={createBankMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-2">
            {bankAccounts.map((b: BankAccount) => (
              <Card key={b.id}>
                <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm sm:text-base truncate">{b.name}</CardTitle>
                      <CardDescription className="text-xs sm:text-sm truncate">{b.bankName}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                        onClick={() => setDepositingBank(b)}
                        title="Tambah Dana"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7"
                        onClick={() => setEditingBank(b)}
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7 text-red-500 hover:text-red-600"
                        onClick={() => setPendingDeleteBank({ id: b.id, name: `${b.name} (${b.bankName})` })}
                        disabled={deleteBankMutation.isPending}
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Pemilik Rekening</p>
                        <p className="font-medium text-sm sm:text-base truncate">{b.accountHolder}</p>
                      </div>
                      <div className="sm:text-right shrink-0 min-w-0">
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Saldo</p>
                        <p className="text-base sm:text-xl font-bold text-green-600 truncate">{formatCurrency(b.balance)}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] sm:text-xs text-muted-foreground">
                      <span className="truncate">No. {b.accountNo}</span>
                      {b.branch && <span className="truncate">{b.branch}</span>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {bankAccounts.length === 0 && (
              <Card className="col-span-2">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Belum ada rekening bank. Tambahkan rekening untuk memulai.
                </CardContent>
              </Card>
            )}
          </div>

        </TabsContent>

        {/* Edit Bank Account Dialog */}
        <Dialog open={!!editingBank} onOpenChange={(open) => { if (!open) setEditingBank(null); }}>
          <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit Rekening Bank
              </DialogTitle>
              <DialogDescription className="sr-only">Form untuk mengedit rekening bank</DialogDescription>
            </DialogHeader>
            {editingBank && (
              <BankAccountForm
                onSubmit={(data) => updateBankMutation.mutate({ ...data, id: editingBank.id })}
                isLoading={updateBankMutation.isPending}
                initialData={editingBank}
              />
            )}
          </DialogContent>
        </Dialog>
        
        {/* Mutasi Bank Tab (Moota) */}
        <TabsContent value="mutations" className="space-y-4">
          <BankMutationsTab bankAccounts={bankAccounts} />
        </TabsContent>

        {/* Cash Boxes Tab */}
        <TabsContent value="cashbox" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center">
            <h3 className="font-semibold text-sm sm:text-base">Brankas / Kas</h3>
            <Dialog open={showCashBoxForm} onOpenChange={(open) => { setShowCashBoxForm(open); if (open) setCashBoxFormKey(k => k + 1); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-2" />
                  Tambah Brankas
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Tambah Brankas/Kas</DialogTitle>
                  <DialogDescription className="sr-only">Form untuk menambah brankas atau kas</DialogDescription>
                </DialogHeader>
                <CashBoxForm
                  key={cashBoxFormKey}
                  units={units}
                  onSubmit={(data) => createCashBoxMutation.mutate(data)}
                  isLoading={createCashBoxMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-2">
            {cashBoxes.map((c: CashBox) => (
              <Card key={c.id}>
                <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-6">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-sm sm:text-base truncate">{c.name}</CardTitle>
                      <CardDescription className="text-xs sm:text-sm truncate">{c.unit?.name || 'Kantor Pusat'}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                        onClick={() => setDepositingCashBox(c)}
                        title="Tambah Dana"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7"
                        onClick={() => setEditingCashBox(c)}
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 sm:h-7 sm:w-7 text-red-500 hover:text-red-600"
                        onClick={() => setPendingDeleteCashBox({ id: c.id, name: c.name })}
                        disabled={deleteCashBoxMutation.isPending}
                        title="Hapus"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 sm:px-6 pb-3 sm:pb-6">
                  <div className="flex items-center justify-between min-w-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Tipe</p>
                      <p className="font-medium text-sm sm:text-base truncate">Cash Box</p>
                    </div>
                    <div className="text-right shrink-0 ml-3 min-w-0">
                      <p className="text-[10px] sm:text-xs text-muted-foreground">Saldo</p>
                      <p className="text-lg sm:text-xl font-bold text-amber-600 truncate">{formatCurrency(c.balance)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {cashBoxes.length === 0 && (
              <Card className="col-span-2">
                <CardContent className="py-8 text-center text-muted-foreground">
                  Belum ada brankas/kas. Tambahkan brankas untuk menyimpan uang tunai.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Edit Cash Box Dialog */}
        <Dialog open={!!editingCashBox} onOpenChange={(open) => { if (!open) setEditingCashBox(null); }}>
          <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit className="w-5 h-5" />
                Edit Brankas/Kas
              </DialogTitle>
              <DialogDescription className="sr-only">Form untuk mengedit brankas atau kas</DialogDescription>
            </DialogHeader>
            {editingCashBox && (
              <CashBoxForm
                units={units}
                onSubmit={(data) => updateCashBoxMutation.mutate({ ...data, id: editingCashBox.id })}
                isLoading={updateCashBoxMutation.isPending}
                initialData={editingCashBox}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Deposit to Bank Dialog */}
        <DepositDialog
          open={!!depositingBank}
          onOpenChange={(open) => { if (!open) setDepositingBank(null); }}
          targetName={depositingBank ? `${depositingBank.name} (${depositingBank.bankName})` : ''}
          currentBalance={depositingBank?.balance ?? 0}
          onDeposit={(amount, description) => depositingBank && bankDepositMutation.mutate({ id: depositingBank.id, amount, description })}
          isSaving={bankDepositMutation.isPending}
        />

        {/* Deposit to Cash Box Dialog */}
        <DepositDialog
          open={!!depositingCashBox}
          onOpenChange={(open) => { if (!open) setDepositingCashBox(null); }}
          targetName={depositingCashBox ? `Brankas ${depositingCashBox.name}` : ''}
          currentBalance={depositingCashBox?.balance ?? 0}
          onDeposit={(amount, description) => depositingCashBox && cashBoxDepositMutation.mutate({ id: depositingCashBox.id, amount, description })}
          isSaving={cashBoxDepositMutation.isPending}
        />
        
        {/* Piutang Tab */}
        <TabsContent value="cashback" className="space-y-4">
          <CashbackWithdrawalsTab
            bankAccounts={bankAccounts}
            cashBoxes={cashBoxes}
            poolBalances={{ hppPaidBalance: fundBalances.hppPaidBalance, profitPaidBalance: fundBalances.profitPaidBalance }}
          />
        </TabsContent>

        {/* Arus Kas (Cash Flow History) Tab */}
        <TabsContent value="cashflow" className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
            <Card className="min-w-0 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
              <CardContent className="p-2.5 sm:p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Uang Masuk</p>
                </div>
                <p className="text-xs sm:text-base font-bold text-emerald-700 dark:text-emerald-300">
                  {formatCurrency(Number(cashflowData?.summary?.totalInflow) || 0)}
                </p>
              </CardContent>
            </Card>
            <Card className="min-w-0 bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
              <CardContent className="p-2.5 sm:p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <ArrowDownLeft className="w-3.5 h-3.5 text-red-600" />
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Uang Keluar</p>
                </div>
                <p className="text-xs sm:text-base font-bold text-red-700 dark:text-red-300">
                  {formatCurrency(Number(cashflowData?.summary?.totalOutflow) || 0)}
                </p>
              </CardContent>
            </Card>
            <Card className="min-w-0 bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-950 dark:to-cyan-900">
              <CardContent className="p-2.5 sm:p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-600" />
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Transfer</p>
                </div>
                <p className="text-xs sm:text-base font-bold text-cyan-700 dark:text-cyan-300">
                  {formatCurrency(Number(cashflowData?.summary?.totalTransfer) || 0)}
                </p>
              </CardContent>
            </Card>
            <Card className={`min-w-0 bg-gradient-to-br ${(Number(cashflowData?.summary?.netFlow) || 0) >= 0 ? 'from-teal-50 to-teal-100 dark:from-teal-950 dark:to-teal-900' : 'from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900'}`}>
              <CardContent className="p-2.5 sm:p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <BarChart3 className={`w-3.5 h-3.5 ${(Number(cashflowData?.summary?.netFlow) || 0) >= 0 ? 'text-teal-600' : 'text-orange-600'}`} />
                  <p className="text-[10px] sm:text-xs text-muted-foreground">Arus Bersih</p>
                </div>
                <p className={`text-xs sm:text-base font-bold ${(Number(cashflowData?.summary?.netFlow) || 0) >= 0 ? 'text-teal-700 dark:text-teal-300' : 'text-orange-700 dark:text-orange-300'}`}>
                  {(Number(cashflowData?.summary?.netFlow) || 0) >= 0 ? '+' : ''}{formatCurrency(Number(cashflowData?.summary?.netFlow) || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Filter + Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={cashflowType} onValueChange={(v) => { setCashflowType(v); setCashflowPage(1); }}>
              <SelectTrigger className="w-auto min-w-[140px] h-8 text-xs">
                <SelectValue placeholder="Filter tipe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Arus</SelectItem>
                <SelectItem value="inflow">Uang Masuk</SelectItem>
                <SelectItem value="outflow">Uang Keluar</SelectItem>
                <SelectItem value="transfer">Transfer Internal</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground ml-auto">
              {cashflowData?.pagination?.total || 0} transaksi
            </div>
          </div>

          {/* Cash Flow Table */}
          <Card>
            <CardContent className="p-0 overflow-hidden">
              {cashflowLoading ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !cashflowData?.entries?.length ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <History className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">Belum ada riwayat arus kas</p>
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden md:block overflow-hidden min-w-0">
                    <div className="max-h-[600px] overflow-y-auto overflow-x-auto min-w-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap text-[11px] w-[95px] min-w-[95px]">Tanggal</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] w-[60px] min-w-[60px]">Arah</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] w-[90px] min-w-[90px]">Kategori</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] min-w-0">Deskripsi</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] min-w-0">Asal</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] min-w-0">Tujuan</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] text-right w-[120px] min-w-[120px]">Jumlah</TableHead>
                            <TableHead className="whitespace-nowrap text-[11px] w-[80px] min-w-[80px]">Oleh</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(cashflowData.entries || []).map((entry: CashFlowEntry) => (
                            <TableRow key={entry.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatDateTime(entry.date)}
                              </TableCell>
                              <TableCell>
                                {entry.direction === 'in' && (
                                  <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                                )}
                                {entry.direction === 'out' && (
                                  <ArrowDownLeft className="w-4 h-4 text-red-600" />
                                )}
                                {entry.direction === 'transfer' && (
                                  <ArrowLeftRight className="w-4 h-4 text-cyan-600" />
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge className={`text-[10px] ${CASHFLOW_CATEGORY_COLORS[entry.category] || 'bg-gray-100 text-gray-700'}`}>
                                  {entry.categoryLabel}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs max-w-[200px]">
                                <p className="font-medium truncate">{entry.description}</p>
                                {entry.referenceNo && (
                                  <p className="text-[10px] text-muted-foreground">{entry.referenceNo}</p>
                                )}
                              </TableCell>
                              <TableCell className="text-[11px] text-muted-foreground max-w-[150px] truncate">
                                {entry.source}
                              </TableCell>
                              <TableCell className="text-[11px] text-muted-foreground max-w-[150px] truncate">
                                {entry.destination}
                              </TableCell>
                              <TableCell className={`text-right font-semibold text-xs ${entry.direction === 'in' ? 'text-emerald-700' : entry.direction === 'out' ? 'text-red-700' : 'text-cyan-700'}`}>
                                {entry.direction === 'in' ? '+' : entry.direction === 'out' ? '-' : ''}
                                {formatCurrency(entry.amount)}
                              </TableCell>
                              <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">
                                {entry.createdBy || '-'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Mobile Card View */}
                  <div className="block md:hidden p-3 space-y-2">
                    {(cashflowData.entries || []).map((entry: CashFlowEntry) => (
                      <div key={entry.id} className="p-3 border rounded-lg space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {entry.direction === 'in' && (
                              <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
                                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
                              </div>
                            )}
                            {entry.direction === 'out' && (
                              <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center shrink-0">
                                <ArrowDownLeft className="w-3.5 h-3.5 text-red-600" />
                              </div>
                            )}
                            {entry.direction === 'transfer' && (
                              <div className="w-7 h-7 rounded-full bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center shrink-0">
                                <ArrowLeftRight className="w-3.5 h-3.5 text-cyan-600" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{entry.description}</p>
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <Badge className={`text-[9px] px-1.5 py-0 ${CASHFLOW_CATEGORY_COLORS[entry.category] || ''}`}>
                                  {entry.categoryLabel}
                                </Badge>
                                <span>{formatDateTime(entry.date)}</span>
                              </div>
                            </div>
                          </div>
                          <span className={`font-bold text-sm shrink-0 ${entry.direction === 'in' ? 'text-emerald-700' : entry.direction === 'out' ? 'text-red-700' : 'text-cyan-700'}`}>
                            {entry.direction === 'in' ? '+' : entry.direction === 'out' ? '-' : ''}
                            {formatCurrency(entry.amount)}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <span>{entry.source}</span>
                          <ArrowRight className="w-2.5 h-2.5" />
                          <span>{entry.destination}</span>
                          {entry.createdBy && (
                            <>·<span>{entry.createdBy}</span></>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {cashflowData.pagination && cashflowData.pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={cashflowPage <= 1}
                        onClick={() => setCashflowPage(p => p - 1)}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Sebelumnya
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {cashflowData.pagination.page} / {cashflowData.pagination.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={cashflowPage >= cashflowData.pagination.totalPages}
                        onClick={() => setCashflowPage(p => p + 1)}
                      >
                        Selanjutnya
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="piutang" className="space-y-4">
          <PiutangTab
            receivables={receivables}
            stats={receivableStats}
            userId={user?.id || ''}
            queryClient={queryClient}
            isLoading={receivablesLoading}
          />
        </TabsContent>
        
        {/* Hutang Perusahaan Tab */}
        <TabsContent value="debts" className="space-y-4">
          <CompanyDebtsTab
            debts={debts}
            purchaseDebts={purchaseDebts}
            bankAccounts={bankAccounts}
            cashBoxes={cashBoxes}
            hppInHand={fundBalances.hppPaidBalance}
            profitInHand={fundBalances.profitPaidBalance}
            userId={user?.id || ''}
            queryClient={queryClient}
          />
        </TabsContent>
      </Tabs>

      {/* Delete Bank Account Confirmation Dialog */}
      <AlertDialog open={!!pendingDeleteBank} onOpenChange={(open) => { if (!open) setPendingDeleteBank(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Rekening Bank</AlertDialogTitle>
            <AlertDialogDescription>
              Yakin ingin menghapus <strong>{pendingDeleteBank?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => {
                if (pendingDeleteBank) {
                  deleteBankMutation.mutate(pendingDeleteBank.id);
                  setPendingDeleteBank(null);
                }
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Cash Box Confirmation Dialog */}
      <AlertDialog open={!!pendingDeleteCashBox} onOpenChange={(open) => { if (!open) setPendingDeleteCashBox(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Brankas/Kas</AlertDialogTitle>
            <AlertDialogDescription>
              Yakin ingin menghapus <strong>{pendingDeleteCashBox?.name}</strong>? Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => {
                if (pendingDeleteCashBox) {
                  deleteCashBoxMutation.mutate(pendingDeleteCashBox.id);
                  setPendingDeleteCashBox(null);
                }
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Expense Dialog — Tambah Pengeluaran */}
      <Dialog open={showExpenseDialog} onOpenChange={(open) => setShowExpenseDialog(open)}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <ExpenseDialog
            bankAccounts={bankAccounts}
            cashBoxes={cashBoxes}
            fundBalances={fundBalances}
            onClose={() => setShowExpenseDialog(false)}
            onSuccess={() => {
              setShowExpenseDialog(false);
              queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
              queryClient.invalidateQueries({ queryKey: ['finance-pools'] });
              queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
              queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
              queryClient.invalidateQueries({ queryKey: ['cash-flow'] });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}



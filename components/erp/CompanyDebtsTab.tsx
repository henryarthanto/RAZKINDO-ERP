'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/erp-helpers';
import { getPaymentStatusLabel, getPaymentStatusColor } from './SharedComponents';
import type {
  BankAccount,
  CashBox,
  CompanyDebt,
  Transaction,
} from '@/types';
import type { QueryClient } from '@tanstack/react-query';

import {
  Wallet,
  ShoppingCart,
  CreditCard,
  Trash2,
  AlertTriangle,
  Check,
  Plus,
  CircleDollarSign,
  Building,
  Warehouse,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// ================================
// COMPANY DEBTS TAB (HUTANG PERUSAHAAN)
// ================================

export default function CompanyDebtsTab({ debts, purchaseDebts, bankAccounts, cashBoxes, hppInHand, profitInHand, userId, queryClient }: {
  debts: CompanyDebt[];
  purchaseDebts: Transaction[];
  bankAccounts: BankAccount[];
  cashBoxes: CashBox[];
  hppInHand: number;
  profitInHand: number;
  userId: string;
  queryClient: QueryClient;
}) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [payingDebt, setPayingDebt] = useState<CompanyDebt | null>(null);
  const [payingPurchaseDebt, setPayingPurchaseDebt] = useState<Transaction | null>(null);

  const activeDebts = debts.filter((d: CompanyDebt) => d.status === 'active');
  const paidDebts = debts.filter((d: CompanyDebt) => d.status === 'paid');

  // Combined totals
  const totalPurchaseDebt = purchaseDebts.reduce((sum: number, t: Transaction) => sum + t.remainingAmount, 0);
  const totalManualDebt = activeDebts.reduce((sum: number, d: CompanyDebt) => sum + d.remainingAmount, 0);
  const totalAllDebt = totalPurchaseDebt + totalManualDebt;
  const totalAllPaid = purchaseDebts.reduce((sum: number, t: Transaction) => sum + t.paidAmount, 0) +
    debts.reduce((sum: number, d: CompanyDebt) => sum + d.paidAmount, 0);

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/debts', {
        method: 'POST',
        body: JSON.stringify({ ...data, createdById: userId })
      });
    },
    onSuccess: () => {
      toast.success('Hutang berhasil ditambahkan');
      setShowCreateForm(false);
      queryClient.invalidateQueries({ queryKey: ['company-debts'] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/finance/debts/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Hutang berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['company-debts'] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 min-w-0">
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Hutang</p>
            <p className="text-xl font-bold text-red-600">{formatCurrency(totalAllDebt)}</p>
            <p className="text-xs text-muted-foreground mt-1">{activeDebts.length + purchaseDebts.length} hutang aktif</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Hutang Supplier (PO)</p>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(totalPurchaseDebt)}</p>
            <p className="text-xs text-muted-foreground mt-1">{purchaseDebts.length} PO belum lunas</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Dibayar</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalAllPaid)}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 col-span-2 md:col-span-1">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Komposisi Dana Tersedia</p>
            <div className="space-y-1 mt-1">
              <p className="text-xs text-muted-foreground">Total HPP Dibayar: <span className="font-medium text-purple-700">{formatCurrency(hppInHand)}</span></p>
              <p className="text-xs text-muted-foreground">Total Profit Dibayar: <span className="font-medium text-teal-700">{formatCurrency(profitInHand)}</span></p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ========== SECTION 1: Hutang Supplier dari PO ========== */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" />
                Hutang Supplier dari PO
              </CardTitle>
              <CardDescription>Pembelian dari supplier yang belum dilunasi</CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {purchaseDebts.length} PO
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[400px]">
            {purchaseDebts.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                <Check className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>Semua pembelian supplier sudah lunas</p>
              </div>
            ) : (
              <div className="divide-y">
                {purchaseDebts.map((t: Transaction) => {
                  const progress = t.total > 0 ? (t.paidAmount / t.total) * 100 : 0;
                  return (
                    <div key={t.id} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-sm font-semibold">{t.invoiceNo}</span>
                            <Badge className={cn(
                              getPaymentStatusColor(t.paymentStatus)
                            )}>
                              {getPaymentStatusLabel(t.paymentStatus)}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
                            <span className="text-muted-foreground">
                              Supplier: <span className="text-foreground font-medium">{t.supplier?.name || '-'}</span>
                            </span>
                            <span className="text-muted-foreground">
                              Tanggal: <span className="text-foreground">{formatDate(new Date(t.transactionDate))}</span>
                            </span>
                          </div>
                          {t.notes && (
                            <p className="text-xs text-muted-foreground mb-2 truncate">{t.notes}</p>
                          )}
                          {/* Items preview */}
                          {t.items && t.items.length > 0 && (
                            <p className="text-xs text-muted-foreground mb-2">
                              {t.items.length} item: {t.items.slice(0, 3).map((i: any) => i.productName).join(', ')}{t.items.length > 3 ? '...' : ''}
                            </p>
                          )}
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-xs text-muted-foreground">Total PO</p>
                              <p className="font-medium">{formatCurrency(t.total)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Sisa Hutang</p>
                              <p className="font-bold text-red-600">{formatCurrency(t.remainingAmount)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Progress</p>
                              <div className="flex items-center gap-2">
                                <Progress value={progress} className="h-2 flex-1" />
                                <span className="text-xs font-medium">{Math.round(progress)}%</span>
                              </div>
                            </div>
                          </div>
                          {/* Payments history */}
                          {t.payments && t.payments.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {t.payments.length}x pembayaran ({formatCurrency(t.paidAmount)})
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="sm" variant="outline" onClick={() => setPayingPurchaseDebt(t)}>
                            <CreditCard className="w-3 h-3 mr-1" />
                            Bayar
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* ========== SECTION 2: Hutang Manual / Lainnya ========== */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="w-4 h-4" />
                Hutang Lainnya
              </CardTitle>
              <CardDescription>Hutang perusahaan yang dicatat manual (investor, dll)</CardDescription>
            </div>
            <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Tambah
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Tambah Hutang Perusahaan</DialogTitle>
                  <DialogDescription>Catat hutang ke supplier, investor, atau pihak lain</DialogDescription>
                </DialogHeader>
                <CompanyDebtForm
                  bankAccounts={bankAccounts}
                  cashBoxes={cashBoxes}
                  hppInHand={hppInHand}
                  profitInHand={profitInHand}
                  onSubmit={(data) => createMutation.mutate(data)}
                  isLoading={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[300px]">
            {activeDebts.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                Belum ada hutang manual
              </div>
            ) : (
              <div className="divide-y">
                {activeDebts.map((debt: CompanyDebt) => (
                  <div key={debt.id} className="p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium truncate">{debt.creditorName}</h4>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {debt.debtType === 'supplier' ? 'Supplier' : debt.debtType === 'investor' ? 'Investor' : 'Lainnya'}
                          </Badge>
                        </div>
                        {debt.description && (
                          <p className="text-xs text-muted-foreground mb-2 truncate">{debt.description}</p>
                        )}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Total</p>
                            <p className="font-medium">{formatCurrency(debt.totalAmount)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Sisa</p>
                            <p className="font-bold text-red-600">{formatCurrency(debt.remainingAmount)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Progress</p>
                            <div className="flex items-center gap-2">
                              <Progress value={(debt.paidAmount / (debt.totalAmount || 1)) * 100} className="h-2 flex-1" />
                              <span className="text-xs font-medium">{Math.round((debt.paidAmount / (debt.totalAmount || 1)) * 100)}%</span>
                            </div>
                          </div>
                        </div>
                        {debt.dueDate && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Jatuh tempo: {formatDate(debt.dueDate)}
                          </p>
                        )}
                        {debt.payments && debt.payments.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {debt.payments.length}x pembayaran tercatat
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => setPayingDebt(debt)}>
                          <CreditCard className="w-3 h-3 mr-1" />
                          Bayar
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600" onClick={() => {
                          if (confirm('Hapus hutang ini?')) deleteMutation.mutate(debt.id);
                        }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Paid Debts (collapsed) */}
      {(paidDebts.length > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-muted-foreground">Riwayat Lunas ({paidDebts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="max-h-48">
              {paidDebts.map((debt: CompanyDebt) => (
                <div key={debt.id} className="p-3 flex justify-between items-center border-b last:border-0 opacity-60">
                  <div>
                    <span className="text-sm font-medium">{debt.creditorName}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px]">Lunas</Badge>
                  </div>
                  <span className="text-sm">{formatCurrency(debt.totalAmount)}</span>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Payment Dialog for Manual Debt */}
      {payingDebt && (
        <CompanyDebtPaymentDialog
          debt={payingDebt}
          bankAccounts={bankAccounts}
          cashBoxes={cashBoxes}
          hppInHand={hppInHand}
          profitInHand={profitInHand}
          userId={userId}
          onClose={() => setPayingDebt(null)}
          onSuccess={() => {
            setPayingDebt(null);
            queryClient.invalidateQueries({ queryKey: ['company-debts'] });
            queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
            queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
          }}
        />
      )}

      {/* Payment Dialog for Supplier PO Debt */}
      {payingPurchaseDebt && (
        <PurchaseDebtPaymentDialog
          transaction={payingPurchaseDebt}
          bankAccounts={bankAccounts}
          cashBoxes={cashBoxes}
          hppInHand={hppInHand}
          profitInHand={profitInHand}
          userId={userId}
          onClose={() => setPayingPurchaseDebt(null)}
          onSuccess={() => {
            setPayingPurchaseDebt(null);
            queryClient.invalidateQueries({ queryKey: ['purchase-debts'] });
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['receivables'] });
            queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
            queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
          }}
        />
      )}
    </div>
  );
}

// Purchase Debt Payment Dialog - Pay unpaid supplier PO
function PurchaseDebtPaymentDialog({ transaction, bankAccounts, cashBoxes, hppInHand, profitInHand, userId, onClose, onSuccess }: {
  transaction: Transaction;
  bankAccounts: BankAccount[];
  cashBoxes: CashBox[];
  hppInHand: number;
  profitInHand: number;
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(transaction.remainingAmount > 0 ? transaction.remainingAmount : 0);
  const [fundSource, setFundSource] = useState<'hpp_paid' | 'profit_paid' | ''>('');
  const [sourceType, setSourceType] = useState<'bank' | 'cashbox'>('bank');
  const [selectedBankId, setSelectedBankId] = useState(bankAccounts[0]?.id || '');
  const [selectedCashBoxId, setSelectedCashBoxId] = useState(cashBoxes[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [isPaying, setIsPaying] = useState(false);

  const remaining = transaction.remainingAmount;

  const getSourceBalance = () => {
    switch (sourceType) {
      case 'bank': {
        const bank = bankAccounts.find(b => b.id === selectedBankId);
        return bank?.balance || 0;
      }
      case 'cashbox': {
        const box = cashBoxes.find(c => c.id === selectedCashBoxId);
        return box?.balance || 0;
      }
      default: return 0;
    }
  };

  const sufficientFunds = getSourceBalance() >= amount;
  const canPay = fundSource && amount > 0 && amount <= remaining && sufficientFunds;

  const handlePay = async () => {
    if (!fundSource) {
      toast.error('Step 1: Pilih komposisi dana (HPP / Profit) terlebih dahulu');
      return;
    }
    if (amount <= 0 || amount > remaining) {
      toast.error('Jumlah pembayaran tidak valid');
      return;
    }
    if (!sufficientFunds) {
      toast.error('Saldo komposisi dana tidak mencukupi');
      return;
    }

    setIsPaying(true);
    try {
      const res = await apiFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          transactionId: transaction.id,
          amount: amount,
          paymentMethod: sourceType === 'bank' ? 'transfer' : 'cash',
          bankAccountId: sourceType === 'bank' ? selectedBankId : undefined,
          cashBoxId: sourceType === 'cashbox' ? selectedCashBoxId : undefined,
          bankName: sourceType === 'bank' ? bankAccounts.find(b => b.id === selectedBankId)?.bankName : undefined,
          accountNo: sourceType === 'bank' ? bankAccounts.find(b => b.id === selectedBankId)?.accountNo : undefined,
          receivedById: userId,
          fundSource: fundSource,
          notes: notes || `Pelunasan hutang PO ${transaction.invoiceNo} dari ${transaction.supplier?.name || 'supplier'}`,
        })
      });

      toast.success(`Berhasil membayar ${formatCurrency(amount)} untuk ${transaction.invoiceNo}`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pelunasan Hutang PO</DialogTitle>
          <DialogDescription>
            {transaction.invoiceNo} - {transaction.supplier?.name || 'Supplier'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-4 bg-orange-50 dark:bg-orange-950 rounded-lg border border-orange-200 dark:border-orange-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-orange-800 dark:text-orange-200 font-medium">Pelunasan Hutang PO</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">{transaction.invoiceNo} - {transaction.supplier?.name || 'Supplier'}</span>
              <span className="font-bold text-red-600">{formatCurrency(remaining)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Jumlah Pembayaran</Label>
            <div className="flex gap-2 flex-wrap">
              <Input
                type="number"
                value={amount || ''}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                min="1"
                max={remaining}
                className="flex-1 min-w-[120px]"
              />
              <Button variant="outline" size="sm" onClick={() => setAmount(remaining)}>Lunasi Semua</Button>
              <Button variant="outline" size="sm" onClick={() => setAmount(Math.ceil(remaining * 0.5))}>50%</Button>
              <Button variant="outline" size="sm" onClick={() => setAmount(Math.ceil(remaining * 0.25))}>25%</Button>
            </div>
            <p className="text-xs text-muted-foreground">Sisa hutang: {formatCurrency(remaining)}</p>
          </div>

          {/* STEP 1: Fund Source */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
              <Label className="text-xs font-semibold">KOMPOSISI DANA</Label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFundSource('hpp_paid')}
                className={cn(
                  "flex flex-col items-start p-2 rounded-lg border-2 text-left transition-all",
                  fundSource === 'hpp_paid'
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                    : "border-muted hover:border-emerald-300"
                )}
              >
                {fundSource === 'hpp_paid' && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                <div className="flex items-center gap-1.5">
                  <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-xs font-semibold">HPP Sudah Terbayar</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{formatCurrency(hppInHand)}</p>
              </button>
              <button
                type="button"
                onClick={() => setFundSource('profit_paid')}
                className={cn(
                  "flex flex-col items-start p-2 rounded-lg border-2 text-left transition-all",
                  fundSource === 'profit_paid'
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                    : "border-muted hover:border-blue-300"
                )}
              >
                {fundSource === 'profit_paid' && <Check className="w-3 h-3 text-blue-500 ml-auto" />}
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                  <span className="text-xs font-semibold">Profit Sudah Terbayar</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{formatCurrency(profitInHand)}</p>
              </button>
            </div>
            {!fundSource && <p className="text-[10px] text-amber-600">Pilih komposisi dana untuk melanjutkan</p>}
          </div>

          <div className="flex justify-center">
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </div>

          {/* STEP 2: Physical Account */}
          <div className={cn("border rounded-lg p-3 space-y-2 transition-opacity", !fundSource && "opacity-50 pointer-events-none")}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
              <Label className="text-xs font-semibold">KELUARKAN DARI</Label>
            </div>
            <Select value={sourceType} onValueChange={(v: any) => setSourceType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank">
                  <span className="inline-flex justify-between w-full items-center">
                    <span>Rekening Bank</span>
                    <span className="text-muted-foreground ml-2">({formatCurrency(bankAccounts.reduce((s, b) => s + b.balance, 0))})</span>
                  </span>
                </SelectItem>
                <SelectItem value="cashbox">
                  <span className="inline-flex justify-between w-full items-center">
                    <span>Brankas/Kas</span>
                    <span className="text-muted-foreground ml-2">({formatCurrency(cashBoxes.reduce((s, c) => s + c.balance, 0))})</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>

            {sourceType === 'bank' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pilih Rekening Bank</Label>
                <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih rekening" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map((b: BankAccount) => (
                      <SelectItem key={b.id} value={b.id}>
                        <span className="inline-flex justify-between w-full items-center">
                          <span className="min-w-0 truncate">{b.name} ({b.bankName})</span>
                          <span className="text-muted-foreground ml-2">({formatCurrency(b.balance)})</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {sourceType === 'cashbox' && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Pilih Brankas/Kas</Label>
                <Select value={selectedCashBoxId} onValueChange={setSelectedCashBoxId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih brankas" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashBoxes.map((c: CashBox) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="inline-flex justify-between w-full items-center">
                          <span className="min-w-0 truncate">{c.name}</span>
                          <span className="text-muted-foreground ml-2">({formatCurrency(c.balance)})</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {!sufficientFunds && fundSource && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Saldo Tidak Mencukupi</AlertTitle>
                <AlertDescription>Komposisi dana yang dipilih tidak cukup. Pilih komposisi lain.</AlertDescription>
              </Alert>
            )}
          </div>

          <div className="space-y-2">
            <Label>Catatan</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Catatan pembayaran..."
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Batal</Button>
            <Button onClick={handlePay} disabled={isPaying || !canPay}>
              {isPaying ? 'Memproses...' : `Bayar ${formatCurrency(amount)}`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Company Debt Form (Create)
function CompanyDebtForm({ bankAccounts, cashBoxes, hppInHand, profitInHand, onSubmit, isLoading }: {
  bankAccounts: BankAccount[];
  cashBoxes: CashBox[];
  hppInHand: number;
  profitInHand: number;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    creditorName: '',
    debtType: 'supplier' as string,
    description: '',
    totalAmount: 0,
    dueDate: '',
    notes: ''
  });

  const debtTypes = [
    { value: 'supplier', label: 'Supplier', icon: '📦' },
    { value: 'investor', label: 'Investor', icon: '💰' },
    { value: 'other', label: 'Lainnya', icon: '📄' }
  ];

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      <div className="space-y-2">
        <Label>Nama Kreditor / Pihak Berhutang</Label>
        <Input
          value={form.creditorName}
          onChange={e => setForm({ ...form, creditorName: e.target.value })}
          placeholder="Nama supplier, investor, dll"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Jenis Hutang</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {debtTypes.map(dt => (
            <button
              key={dt.value}
              type="button"
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border-2 p-3 text-center transition-colors",
                form.debtType === dt.value
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30"
              )}
              onClick={() => setForm({ ...form, debtType: dt.value })}
            >
              <span className="text-lg">{dt.icon}</span>
              <span className="text-xs font-medium">{dt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Total Hutang</Label>
        <Input
          type="number"
          value={form.totalAmount || ''}
          onChange={e => setForm({ ...form, totalAmount: parseFloat(e.target.value) || 0 })}
          placeholder="0"
          required
          min="1"
        />
      </div>

      <div className="space-y-2">
        <Label>Deskripsi (Opsional)</Label>
        <Input
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Deskripsi hutang..."
        />
      </div>

      <div className="space-y-2">
        <Label>Jatuh Tempo (Opsional)</Label>
        <Input
          type="date"
          value={form.dueDate}
          onChange={e => setForm({ ...form, dueDate: e.target.value })}
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isLoading || !form.creditorName || form.totalAmount <= 0} className="w-full">
          {isLoading ? 'Menyimpan...' : 'Simpan Hutang'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Company Debt Payment Dialog
function CompanyDebtPaymentDialog({ debt, bankAccounts, cashBoxes, hppInHand, profitInHand, userId, onClose, onSuccess }: {
  debt: CompanyDebt;
  bankAccounts: BankAccount[];
  cashBoxes: CashBox[];
  hppInHand: number;
  profitInHand: number;
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [fundSource, setFundSource] = useState<'hpp_paid' | 'profit_paid' | ''>('');
  const [paymentSource, setPaymentSource] = useState('bank');
  const [amount, setAmount] = useState(0);
  const [bankAccountId, setBankAccountId] = useState('');
  const [cashBoxId, setCashBoxId] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'select' | 'confirm'>('select');

  const selectedBank = bankAccounts.find(b => b.id === bankAccountId);
  const selectedCashBox = cashBoxes.find(c => c.id === cashBoxId);

  const maxPayable = debt.remainingAmount;

  const getSourceBalance = () => {
    switch (paymentSource) {
      case 'bank': return selectedBank?.balance || 0;
      case 'cashbox': return selectedCashBox?.balance || 0;
      default: return 0;
    }
  };

  const getSourceLabel = () => {
    switch (paymentSource) {
      case 'bank': return selectedBank?.name || 'Rekening Bank';
      case 'cashbox': return selectedCashBox?.name || 'Brankas';
      default: return '';
    }
  };

  const canPay = fundSource && amount > 0 && amount <= maxPayable && amount <= getSourceBalance();

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ success: boolean }>(`/api/finance/debts/${debt.id}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          amount,
          fundSource,
          paymentSource,
          bankAccountId: paymentSource === 'bank' ? (bankAccountId || undefined) : undefined,
          cashBoxId: paymentSource === 'cashbox' ? (cashBoxId || undefined) : undefined,
          referenceNo: referenceNo || undefined,
          notes: notes || undefined,
          paidById: userId
        })
      });

      toast.success(`Pembayaran ${formatCurrency(amount)} berhasil!`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bayar Hutang</DialogTitle>
          <DialogDescription>
            {debt.creditorName} — Sisa: {formatCurrency(debt.remainingAmount)}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' ? (
          <div className="space-y-4">
            {/* Debt info */}
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Total Hutang</span>
                <span className="font-medium">{formatCurrency(debt.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Sudah Dibayar</span>
                <span className="font-medium text-green-600">{formatCurrency(debt.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Sisa</span>
                <span className="font-bold text-red-600">{formatCurrency(debt.remainingAmount)}</span>
              </div>
              <Progress value={(debt.paidAmount / (debt.totalAmount || 1)) * 100} className="h-1.5 mt-2" />
            </div>

            {/* STEP 1: Fund Source */}
            <div className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shrink-0">1</div>
                <Label className="text-xs font-semibold">KOMPOSISI DANA</Label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFundSource('hpp_paid')}
                  className={cn(
                    "flex flex-col items-start p-2 rounded-lg border-2 text-left transition-all",
                    fundSource === 'hpp_paid'
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                      : "border-muted hover:border-emerald-300"
                  )}
                >
                  {fundSource === 'hpp_paid' && <Check className="w-3 h-3 text-emerald-500 ml-auto" />}
                  <div className="flex items-center gap-1.5">
                    <CircleDollarSign className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-xs font-semibold">HPP Sudah Terbayar</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{formatCurrency(hppInHand)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFundSource('profit_paid')}
                  className={cn(
                    "flex flex-col items-start p-2 rounded-lg border-2 text-left transition-all",
                    fundSource === 'profit_paid'
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                      : "border-muted hover:border-blue-300"
                  )}
                >
                  {fundSource === 'profit_paid' && <Check className="w-3 h-3 text-blue-500 ml-auto" />}
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-semibold">Profit Sudah Terbayar</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{formatCurrency(profitInHand)}</p>
                </button>
              </div>
              {!fundSource && <p className="text-[10px] text-amber-600">Pilih komposisi dana untuk melanjutkan</p>}
            </div>

            <div className="flex justify-center">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* STEP 2: Physical Account */}
            <div className={cn("border rounded-lg p-3 space-y-2 transition-opacity", !fundSource && "opacity-50 pointer-events-none")}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0">2</div>
                <Label className="text-xs font-semibold">KELUARKAN DARI</Label>
              </div>
              {bankAccounts.length > 0 && (
                <Select value={paymentSource === 'bank' ? 'bank' : '__'} onValueChange={v => { if (v === 'bank') setPaymentSource('bank'); }}>
                  <SelectTrigger className={paymentSource !== 'bank' ? 'opacity-60' : ''}>
                    <SelectValue placeholder="Bayar via Rekening Bank" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">
                      <span className="inline-flex justify-between w-full">
                        <span>Rekening Bank</span>
                        <span className="text-green-600 text-xs">{formatCurrency(bankAccounts.reduce((s, b) => s + b.balance, 0))}</span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {paymentSource === 'bank' && (
                <Select value={bankAccountId} onValueChange={setBankAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih rekening" />
                  </SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.bankName}) — Saldo: {formatCurrency(b.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {cashBoxes.length > 0 && (
                <Select value={paymentSource === 'cashbox' ? 'cashbox' : '__'} onValueChange={v => { if (v === 'cashbox') setPaymentSource('cashbox'); }}>
                  <SelectTrigger className={paymentSource !== 'cashbox' ? 'opacity-60' : ''}>
                    <SelectValue placeholder="Bayar via Brankas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cashbox">
                      <span className="inline-flex justify-between w-full">
                        <span>Brankas</span>
                        <span className="text-green-600 text-xs">{formatCurrency(cashBoxes.reduce((s, c) => s + c.balance, 0))}</span>
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
              {paymentSource === 'cashbox' && (
                <Select value={cashBoxId} onValueChange={setCashBoxId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih brankas" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashBoxes.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} — Saldo: {formatCurrency(c.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label>Jumlah Bayar</Label>
                <span className="text-xs text-muted-foreground">
                  Tersedia: {formatCurrency(getSourceBalance())}
                </span>
              </div>
              <Input
                type="number"
                value={amount || ''}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                placeholder="0"
                min="1"
                max={Math.min(maxPayable, getSourceBalance())}
              />
              {amount > maxPayable && (
                <p className="text-xs text-red-500">Melebihi sisa hutang ({formatCurrency(maxPayable)})</p>
              )}
              {amount > getSourceBalance() && (
                <p className="text-xs text-red-500">Melebihi saldo {getSourceLabel()} ({formatCurrency(getSourceBalance())})</p>
              )}
              <div className="flex gap-2">
                {[0.25, 0.5, 0.75, 1].map(pct => (
                  <Button
                    key={pct}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={() => setAmount(Math.floor(maxPayable * pct))}
                  >
                    {pct * 100}%
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs"
                  onClick={() => setAmount(maxPayable)}
                >
                  Lunas
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>No. Referensi (Opsional)</Label>
              <Input
                value={referenceNo}
                onChange={e => setReferenceNo(e.target.value)}
                placeholder="No. bukti transfer, dll"
              />
            </div>

            <div className="space-y-2">
              <Label>Catatan (Opsional)</Label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Catatan pembayaran..."
              />
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={onClose}>Batal</Button>
              <Button
                disabled={!canPay || loading || (paymentSource === 'bank' && !bankAccountId) || (paymentSource === 'cashbox' && !cashBoxId)}
                onClick={() => setStep('confirm')}
              >
                {loading ? 'Memproses...' : 'Lanjut Bayar'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg text-center space-y-2">
              <p className="text-sm text-muted-foreground">Konfirmasi Pembayaran</p>
              <p className="text-3xl font-bold">{formatCurrency(amount)}</p>
              <p className="text-sm">ke <span className="font-medium">{debt.creditorName}</span></p>
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground">Via: <span className="font-medium">{getSourceLabel()}</span></p>
                {referenceNo && <p className="text-xs text-muted-foreground">Ref: {referenceNo}</p>}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setStep('select')}>Kembali</Button>
              <Button
                disabled={loading}
                className="bg-red-600 hover:bg-red-700"
                onClick={handleSubmit}
              >
                {loading ? 'Memproses...' : `Bayar ${formatCurrency(amount)}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}


export { TransferForm, BankAccountForm, CashBoxForm } from './FinanceForms';
export { ProcessRequestDialog } from './ProcessRequestDialog';

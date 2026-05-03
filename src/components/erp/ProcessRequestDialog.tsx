'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/erp-helpers';
import { toast } from 'sonner';
import type {
  BankAccount,
  CashBox,
  FinanceRequest,
} from '@/types';

import {
  DollarSign,
  Wallet,
  Receipt,
  AlertTriangle,
  Check,
  CircleDollarSign,
  Building,
  Warehouse,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Process Request Dialog Component — For Finance to process requests
// User manually selects both: Sumber Dana (HPP/Profit/Lain-lain) and Sumber Fisik (Brankas/Rekening).
export function ProcessRequestDialog({ 
  request, 
  bankAccounts, 
  cashBoxes, 
  fundBalances, 
  onProcess, 
  isProcessing 
}: { 
  request: FinanceRequest; 
  bankAccounts: BankAccount[]; 
  cashBoxes: CashBox[]; 
  fundBalances: { 
    totalCashInBoxes: number; 
    totalInBanks: number; 
    hppPaidBalance?: number;
    profitPaidBalance?: number;
    investorFund?: number;
    totalPool?: number;
  };
  onProcess: (data: any) => void; 
  isProcessing: boolean;
}) {
  const [processType, setProcessType] = useState<'approve' | 'debt' | 'pay_now'>(
    request.status === 'approved' || request.forcePayNow ? 'pay_now' : 'debt'
  );
  const [sourceType, setSourceType] = useState<'bank' | 'cashbox'>(
    bankAccounts.length > 0 && bankAccounts[0]?.balance >= request.amount ? 'bank' : 'cashbox'
  );
  const [selectedBankId, setSelectedBankId] = useState(
    bankAccounts.find(b => b.balance >= request.amount)?.id || bankAccounts[0]?.id || ''
  );
  const [selectedCashBoxId, setSelectedCashBoxId] = useState(
    cashBoxes.find(c => c.balance >= request.amount)?.id || cashBoxes[0]?.id || ''
  );
  const [fundSource, setFundSource] = useState<'hpp_paid' | 'profit_paid' | 'lain_lain' | ''>('');
  const [notes, setNotes] = useState('');

  // Pool balances
  const hppPaidBalance = fundBalances.hppPaidBalance ?? 0;
  const profitPaidBalance = fundBalances.profitPaidBalance ?? 0;
  const lainLainBalance = fundBalances.investorFund ?? 0;

  // Selected fund source balance
  const selectedFundBalance = fundSource === 'hpp_paid' ? hppPaidBalance
    : fundSource === 'profit_paid' ? profitPaidBalance
    : fundSource === 'lain_lain' ? lainLainBalance
    : 0;

  const fundSufficient = selectedFundBalance >= request.amount && !!fundSource;

  let items: any[] = [];
  try { items = request.purchaseItems ? JSON.parse(request.purchaseItems) : []; } catch { items = []; }

  // Selected physical account balance
  const selectedAccountBalance = useMemo(() => {
    if (sourceType === 'bank') {
      return bankAccounts.find(b => b.id === selectedBankId)?.balance || 0;
    }
    return cashBoxes.find(c => c.id === selectedCashBoxId)?.balance || 0;
  }, [sourceType, selectedBankId, selectedCashBoxId, bankAccounts, cashBoxes]);

  const physicalSufficient = selectedAccountBalance >= request.amount && selectedAccountBalance > 0;
  const hasSelectedAccount = sourceType === 'bank' ? !!selectedBankId : !!selectedCashBoxId;
  const canPayNow = fundSufficient && physicalSufficient && hasSelectedAccount;

  const handleProcess = () => {
    if (processType === 'approve') {
      // Approve only (no payment yet) — for purchase & other types
      onProcess({
        id: request.id,
        status: 'approved',
        processType: 'approve',
        sourceType: null,
        fundSource: null,
        bankAccountId: null,
        cashBoxId: null,
        notes: notes || 'Request disetujui',
      });
    } else if (processType === 'debt' && request.type !== 'salary') {
      onProcess({
        id: request.id,
        status: 'processed',
        processType: 'debt',
        sourceType: null,
        fundSource: null,
        bankAccountId: null,
        notes: notes || 'Dijadikan hutang ke supplier',
      });
    } else if (processType === 'debt' && request.type === 'salary') {
      onProcess({
        id: request.id,
        status: 'approved',
        processType: 'debt',
        sourceType: null,
        fundSource: null,
        bankAccountId: null,
        cashBoxId: null,
        notes: notes || 'Gaji disetujui',
      });
    } else {
      // Pay now — user manually selected fund source
      if (!fundSource) {
        toast.error('Pilih sumber dana (HPP/Profit/Lain-lain) terlebih dahulu');
        return;
      }
      onProcess({
        id: request.id,
        status: 'processed',
        processType: 'pay_now',
        fundSource: fundSource,
        sourceType: sourceType,
        bankAccountId: sourceType === 'bank' ? selectedBankId : null,
        cashBoxId: sourceType === 'cashbox' ? selectedCashBoxId : null,
        notes: notes || (request.type === 'salary' ? 'Gaji dibayarkan' : 'Dibayar langsung'),
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Request Summary */}
      <div className="p-4 bg-muted rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Jumlah Request</span>
          <span className="text-2xl font-bold">{formatCurrency(request.amount)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{request.type === 'salary' ? 'Karyawan' : 'Supplier'}</span>
          <span className="font-medium">
            {request.type === 'salary' && request.salaryPayment 
              ? request.salaryPayment.user?.name 
              : (request.supplier?.name || '-')}
          </span>
        </div>
      </div>

      {/* Salary Payslip Preview */}
      {request.type === 'salary' && request.salaryPayment && (
        <div className="border rounded-lg p-4 space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <Receipt className="w-4 h-4" /> Detail Slip Gaji
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Gaji Pokok</p>
              <p className="font-medium">{formatCurrency(request.salaryPayment.baseSalary)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Tambahan</p>
              <p className="font-medium text-green-600">+{formatCurrency(request.salaryPayment.totalAllowance)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Potongan</p>
              <p className="font-medium text-red-500">-{formatCurrency(request.salaryPayment.totalDeduction)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Gaji Bersih</p>
              <p className="font-bold text-primary">{formatCurrency(request.salaryPayment.totalAmount)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Items List if available */}
      {items.length > 0 && (
        <>
          <div className="block md:hidden space-y-2">
            {items.map((item: any, i: number) => (
              <div key={i} className="p-3 border rounded-lg space-y-1">
                <span className="font-medium text-sm min-w-0 truncate block">{item.productName}</span>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Qty: {item.qty} x {formatCurrency(item.price)}</span>
                  <span className="font-medium">{formatCurrency(item.subtotal)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.qty * item.price)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Process Type Selection */}
      {request.type === 'salary' && request.status !== 'approved' && !request.forcePayNow ? (
        <div className="space-y-2">
          <Label className="text-base font-semibold">Persetujuan Gaji</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              type="button"
              variant={processType === 'debt' ? 'default' : 'outline'}
              className={cn(
                "h-auto py-4 flex flex-col items-start px-4",
                processType === 'debt' && "bg-blue-500 hover:bg-blue-600"
              )}
              onClick={() => setProcessType('debt')}
            >
              <div className="flex items-center gap-2 w-full">
                <Check className="w-5 h-5" />
                <span className="font-semibold">Setujui Dulu</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Setujui request gaji, bayar nanti
              </span>
            </Button>
            <Button
              type="button"
              variant={processType === 'pay_now' ? 'default' : 'outline'}
              className={cn(
                "h-auto py-4 flex flex-col items-start px-4",
                processType === 'pay_now' && "bg-green-500 hover:bg-green-600"
              )}
              onClick={() => setProcessType('pay_now')}
            >
              <div className="flex items-center gap-2 w-full">
                <DollarSign className="w-5 h-5" />
                <span className="font-semibold">Setujui & Bayar</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Setujui dan bayar langsung dari Bank/Brankas
              </span>
            </Button>
          </div>
        </div>
      ) : request.type === 'salary' && (request.status === 'approved' || request.forcePayNow) ? (
        <div className="space-y-2">
          <Label className="text-base font-semibold">Pembayaran Gaji</Label>
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            Gaji sudah disetujui. Pilih sumber dana untuk membayar gaji <strong>{request.salaryPayment?.user?.name}</strong>.
          </div>
          <Button
            type="button"
            variant={processType === 'pay_now' ? 'default' : 'outline'}
            className={cn(
              "w-full h-auto py-4 flex flex-col items-start px-4",
              processType === 'pay_now' && "bg-green-500 hover:bg-green-600"
            )}
            onClick={() => setProcessType('pay_now')}
          >
            <div className="flex items-center gap-2 w-full">
              <DollarSign className="w-5 h-5" />
              <span className="font-semibold">Bayar Sekarang</span>
            </div>
            <span className="text-xs opacity-80 mt-2 text-left w-full">
              Bayar langsung dari Bank/Brankas
            </span>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-base font-semibold">Persetujuan Pembelian</Label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button
              type="button"
              variant={processType === 'approve' ? 'default' : 'outline'}
              className={cn(
                "h-auto py-4 flex flex-col items-start px-4",
                processType === 'approve' && "bg-blue-500 hover:bg-blue-600"
              )}
              onClick={() => setProcessType('approve')}
            >
              <div className="flex items-center gap-2 w-full">
                <Check className="w-5 h-5" />
                <span className="font-semibold">Setujui</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Setujui dulu, bayar nanti
              </span>
            </Button>
            <Button
              type="button"
              variant={processType === 'debt' ? 'default' : 'outline'}
              className={cn(
                "h-auto py-4 flex flex-col items-start px-4",
                processType === 'debt' && "bg-amber-500 hover:bg-amber-600"
              )}
              onClick={() => setProcessType('debt')}
            >
              <div className="flex items-center gap-2 w-full">
                <Wallet className="w-5 h-5" />
                <span className="font-semibold">Hutang</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Catat sebagai hutang supplier
              </span>
            </Button>
            <Button
              type="button"
              variant={processType === 'pay_now' ? 'default' : 'outline'}
              className={cn(
                "h-auto py-4 flex flex-col items-start px-4",
                processType === 'pay_now' && "bg-green-500 hover:bg-green-600"
              )}
              onClick={() => setProcessType('pay_now')}
            >
              <div className="flex items-center gap-2 w-full">
                <DollarSign className="w-5 h-5" />
                <span className="font-semibold">Lunasi</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Bayar dari Bank/Brankas
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* Payment Source — Only show for pay_now */}
      {processType === 'pay_now' && (
        <>
          {/* SUMBER DANA — Manual Selection */}
          <div className="border rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0">
                <CircleDollarSign className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <Label className="text-xs font-semibold">SUMBER DANA</Label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Pilih dari mana dana diambil: HPP, Profit, atau Dana Lain-lain
            </p>

            {/* Fund source selector - 3 options */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFundSource('hpp_paid')}
                className={cn(
                  "relative flex flex-col items-center p-2.5 rounded-lg border-2 text-center transition-all",
                  fundSource === 'hpp_paid'
                    ? "border-purple-500 bg-purple-50 dark:bg-purple-950"
                    : "border-muted hover:border-purple-300 dark:hover:border-purple-700"
                )}
              >
                {fundSource === 'hpp_paid' && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-purple-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <span className="text-[10px] font-medium text-purple-700 dark:text-purple-300">HPP</span>
                <span className="text-[10px] text-muted-foreground">Terbayar</span>
                <span className={cn("text-xs font-bold mt-0.5", fundSource === 'hpp_paid' ? "text-purple-700" : "text-muted-foreground")}>
                  {formatCurrency(hppPaidBalance)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFundSource('profit_paid')}
                className={cn(
                  "relative flex flex-col items-center p-2.5 rounded-lg border-2 text-center transition-all",
                  fundSource === 'profit_paid'
                    ? "border-teal-500 bg-teal-50 dark:bg-teal-950"
                    : "border-muted hover:border-teal-300 dark:hover:border-teal-700"
                )}
              >
                {fundSource === 'profit_paid' && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-teal-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <span className="text-[10px] font-medium text-teal-700 dark:text-teal-300">Profit</span>
                <span className="text-[10px] text-muted-foreground">Terbayar</span>
                <span className={cn("text-xs font-bold mt-0.5", fundSource === 'profit_paid' ? "text-teal-700" : "text-muted-foreground")}>
                  {formatCurrency(profitPaidBalance)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFundSource('lain_lain')}
                className={cn(
                  "relative flex flex-col items-center p-2.5 rounded-lg border-2 text-center transition-all",
                  fundSource === 'lain_lain'
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                    : "border-muted hover:border-amber-300 dark:hover:border-amber-700"
                )}
              >
                {fundSource === 'lain_lain' && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
                <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">Lain-lain</span>
                <span className="text-[10px] text-muted-foreground">Dana</span>
                <span className={cn("text-xs font-bold mt-0.5", fundSource === 'lain_lain' ? "text-amber-700" : "text-muted-foreground")}>
                  {formatCurrency(lainLainBalance)}
                </span>
              </button>
            </div>

            {/* Fund source validation */}
            {!fundSource && (
              <div className="flex items-center gap-1.5 p-2 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <p className="text-[10px] text-amber-600 dark:text-amber-400">Pilih sumber dana terlebih dahulu</p>
              </div>
            )}
            {fundSource && !fundSufficient && (
              <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <p className="text-[10px] text-red-600 dark:text-red-400">
                  Saldo ({formatCurrency(selectedFundBalance)}) tidak mencukupi untuk {formatCurrency(request.amount)}
                </p>
              </div>
            )}
            {fundSource && fundSufficient && (
              <div className="p-2 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800">
                <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  ✓ {formatCurrency(request.amount)} dari {fundSource === 'hpp_paid' ? 'HPP Terbayar' : fundSource === 'profit_paid' ? 'Profit Terbayar' : 'Dana Lain-lain'} (sisa: {formatCurrency(selectedFundBalance - request.amount)})
                </p>
              </div>
            )}
          </div>

          {/* Arrow */}
          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
          </div>

          {/* BAYAR DARI — Pick specific Brankas or Rekening */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
                <Warehouse className="w-3.5 h-3.5" />
              </div>
              <Label className="text-sm font-semibold">BAYAR DARI</Label>
            </div>
            <p className="text-xs text-muted-foreground">Pilih rekening bank atau brankas untuk menarik dana</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Bank */}
              <button
                type="button"
                onClick={() => setSourceType('bank')}
                className={cn(
                  "relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all",
                  sourceType === 'bank'
                    ? "border-green-500 bg-green-50 dark:bg-green-950"
                    : "border-muted hover:border-green-300 dark:hover:border-green-700"
                )}
              >
                {sourceType === 'bank' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center">
                    <Building className="w-4 h-4 text-green-600" />
                  </div>
                  <span className="font-semibold text-sm">Rekening Bank</span>
                </div>
                <p className="text-xs text-muted-foreground">{bankAccounts.length} rekening aktif</p>
                <p className="text-sm font-bold text-green-700 dark:text-green-300 mt-1">
                  {formatCurrency(fundBalances.totalInBanks)}
                </p>
              </button>

              {/* Brankas/Kas */}
              <button
                type="button"
                onClick={() => setSourceType('cashbox')}
                className={cn(
                  "relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all",
                  sourceType === 'cashbox'
                    ? "border-amber-500 bg-amber-50 dark:bg-amber-950"
                    : "border-muted hover:border-amber-300 dark:hover:border-amber-700"
                )}
              >
                {sourceType === 'cashbox' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900 flex items-center justify-center">
                    <Warehouse className="w-4 h-4 text-amber-600" />
                  </div>
                  <span className="font-semibold text-sm">Brankas/Kas</span>
                </div>
                <p className="text-xs text-muted-foreground">{cashBoxes.length} brankas aktif</p>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mt-1">
                  {formatCurrency(fundBalances.totalCashInBoxes)}
                </p>
              </button>
            </div>

            {/* Bank account selector */}
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
                          <span className={cn(
                            "ml-2 min-w-0 truncate",
                            b.balance >= request.amount ? "text-green-600" : "text-red-500"
                          )}>
                            {formatCurrency(b.balance)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedBankId && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Saldo rekening:</span>
                    <span className={cn("font-semibold", physicalSufficient ? "text-green-600" : "text-red-500")}>
                      {formatCurrency(selectedAccountBalance)}
                      {selectedAccountBalance < request.amount && (
                        <span className="text-red-400 ml-1">(-{formatCurrency(request.amount - selectedAccountBalance)})</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* CashBox selector */}
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
                          <span className={cn(
                            "ml-2 min-w-0 truncate",
                            c.balance >= request.amount ? "text-green-600" : "text-red-500"
                          )}>
                            {formatCurrency(c.balance)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCashBoxId && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Saldo brankas:</span>
                    <span className={cn("font-semibold", physicalSufficient ? "text-green-600" : "text-red-500")}>
                      {formatCurrency(selectedAccountBalance)}
                      {selectedAccountBalance < request.amount && (
                        <span className="text-red-400 ml-1">(-{formatCurrency(request.amount - selectedAccountBalance)})</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Insufficient warning */}
            {selectedAccountBalance > 0 && !physicalSufficient && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Saldo Tidak Mencukupi</AlertTitle>
                <AlertDescription>
                  Saldo akun ({formatCurrency(selectedAccountBalance)}) kurang dari {formatCurrency(request.amount)}.
                  Kurang {formatCurrency(request.amount - selectedAccountBalance)}.
                </AlertDescription>
              </Alert>
            )}

            {selectedAccountBalance === 0 && (
              <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                <p className="text-[10px] text-red-600 dark:text-red-400">
                  Tidak ada akun yang tersedia. Tambahkan rekening bank atau brankas terlebih dahulu.
                </p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label>Catatan</Label>
        <Textarea 
          value={notes} 
          onChange={e => setNotes(e.target.value)}
          placeholder="Catatan tambahan..."
        />
      </div>

      {/* Action Buttons */}
      <DialogFooter className="gap-2 flex-col sm:flex-row">
        <Button 
          variant="destructive"
          onClick={() => onProcess({
            id: request.id,
            status: 'rejected',
            notes: notes || 'Ditolak oleh Finance',
          })}
          className="w-full sm:w-auto"
        >
          Tolak
        </Button>
        <Button 
          onClick={() => {
            if (processType === 'pay_now' && !canPayNow) {
              if (!fundSource) {
                toast.warning('Pilih sumber dana (HPP/Profit/Lain-lain)');
              } else if (!fundSufficient) {
                toast.warning('Saldo sumber dana tidak mencukupi');
              } else if (!physicalSufficient) {
                toast.warning('Saldo akun fisik yang dipilih tidak mencukupi');
              } else if (!hasSelectedAccount) {
                toast.warning('Pilih akun sumber dana');
              }
              return;
            }
            handleProcess();
          }}
          disabled={isProcessing || (processType === 'pay_now' && !canPayNow)}
          className={cn(
            "w-full sm:w-auto",
            processType === 'approve' && "bg-blue-500 hover:bg-blue-600",
            processType === 'debt' && "bg-amber-500 hover:bg-amber-600",
            processType === 'pay_now' && "bg-green-500 hover:bg-green-600"
          )}
        >
          {isProcessing ? 'Memproses...' : processType === 'approve' ? 'Setujui' : processType === 'pay_now' ? 'Bayar Sekarang' : (request.type === 'salary' ? 'Setujui' : 'Jadikan Hutang')}
        </Button>
      </DialogFooter>
    </div>
  );
}

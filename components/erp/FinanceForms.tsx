'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/erp-helpers';
import { toast } from 'sonner';
import type {
  BankAccount,
  CashBox,
  FinanceRequest,
  Unit,
} from '@/types';

import {
  DollarSign,
  Wallet,
  Receipt,
  AlertTriangle,
  Check,
  Clock,
  CircleDollarSign,
  Building,
  Warehouse,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Bank Account Form Component
export function BankAccountForm({ onSubmit, isLoading, initialData }: { onSubmit: (data: any) => void; isLoading: boolean; initialData?: any }) {
  const [form, setForm] = useState({
    name: initialData?.name || '',
    bankName: initialData?.bankName || '',
    accountNo: initialData?.accountNo || '',
    accountHolder: initialData?.accountHolder || '',
    branch: initialData?.branch || '',
    balance: initialData ? String(initialData.balance) : '',
    notes: initialData?.notes || ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Nama rekening wajib diisi';
    if (!form.bankName) newErrors.bankName = 'Pilih bank';
    if (!form.accountNo.trim()) newErrors.accountNo = 'Nomor rekening wajib diisi';
    if (!form.accountHolder.trim()) newErrors.accountHolder = 'Nama pemilik wajib diisi';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({
      ...form,
      balance: parseFloat(form.balance) || 0
    });
  };
  
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nama Rekening <span className="text-red-500">*</span></Label>
          <Input 
            value={form.name} 
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="e.g., BCA Utama"
          />
          {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
        </div>
        <div className="space-y-2">
          <Label>Nama Bank <span className="text-red-500">*</span></Label>
          {initialData && !['BCA', 'Mandiri', 'BRI', 'BNI', 'CIMB', 'Lainnya'].includes(form.bankName) ? (
            <Input
              value={form.bankName}
              onChange={e => setForm({ ...form, bankName: e.target.value })}
              placeholder="Nama bank"
            />
          ) : (
            <Select value={form.bankName} onValueChange={v => setForm({ ...form, bankName: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih bank" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BCA">BCA</SelectItem>
                <SelectItem value="Mandiri">Mandiri</SelectItem>
                <SelectItem value="BRI">BRI</SelectItem>
                <SelectItem value="BNI">BNI</SelectItem>
                <SelectItem value="CIMB">CIMB Niaga</SelectItem>
                <SelectItem value="Lainnya">Lainnya</SelectItem>
              </SelectContent>
            </Select>
          )}
          {errors.bankName && <p className="text-xs text-red-500">{errors.bankName}</p>}
        </div>
      </div>
      
      <div className="space-y-2">
        <Label>No. Rekening <span className="text-red-500">*</span></Label>
        <Input 
          value={form.accountNo} 
          onChange={e => setForm({ ...form, accountNo: e.target.value })}
          placeholder="1234567890"
        />
        {errors.accountNo && <p className="text-xs text-red-500">{errors.accountNo}</p>}
      </div>
      
      <div className="space-y-2">
        <Label>Nama Pemilik <span className="text-red-500">*</span></Label>
        <Input 
          value={form.accountHolder} 
          onChange={e => setForm({ ...form, accountHolder: e.target.value })}
          placeholder="PT Razkindo Group"
        />
        {errors.accountHolder && <p className="text-xs text-red-500">{errors.accountHolder}</p>}
      </div>
      
      <div className="space-y-2">
        <Label>Saldo Awal</Label>
        <Input 
          type="number"
          value={form.balance}
          onChange={e => setForm({ ...form, balance: e.target.value })}
          placeholder="0"
          min="0"
        />
      </div>
      
      <DialogFooter>
        <Button type="button" onClick={handleSubmit} disabled={isLoading} className="w-full">
          {isLoading ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Cash Box Form Component
export function CashBoxForm({ units, onSubmit, isLoading, initialData }: { units: Unit[]; onSubmit: (data: any) => void; isLoading: boolean; initialData?: any }) {
  const [form, setForm] = useState({
    name: initialData?.name || '',
    unitId: initialData?.unitId || '',
    balance: initialData ? String(initialData.balance) : '',
    notes: initialData?.notes || ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = 'Nama brankas wajib diisi';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nama Brankas/Kas <span className="text-red-500">*</span></Label>
        <Input 
          value={form.name} 
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="e.g., Brankas Kantor"
        />
        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
      </div>
      
      <div className="space-y-2">
        <Label>Unit (Opsional)</Label>
        <Select value={form.unitId} onValueChange={v => setForm({ ...form, unitId: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Pilih unit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Kantor Pusat</SelectItem>
            {units.map(u => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="space-y-2">
        <Label>Saldo Awal</Label>
        <Input 
          type="number"
          value={form.balance}
          onChange={e => setForm({ ...form, balance: e.target.value })}
          placeholder="0"
          min="0"
        />
      </div>
      
      <DialogFooter>
        <Button type="button" onClick={() => {
          if (!validate()) return;
          onSubmit({ ...form, unitId: form.unitId === '__none__' ? '' : form.unitId, balance: parseFloat(form.balance) || 0 });
        }} disabled={isLoading} className="w-full">
          {isLoading ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Process Request Dialog Component - For Finance to process requests
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
    hppInHand: number; 
    profitInHand: number; 
    totalCashInBoxes: number; 
    totalInBanks: number; 
    totalWithCouriers: number;
    hppPaidBalance?: number;
    profitPaidBalance?: number;
  };
  onProcess: (data: any) => void; 
  isProcessing: boolean;
}) {
  const [processType, setProcessType] = useState<'debt' | 'pay_now'>(request.status === 'approved' || request.forcePayNow ? 'pay_now' : 'debt');
  const [fundSource, setFundSource] = useState<'hpp_paid' | 'profit_unpaid' | ''>('');
  const [sourceType, setSourceType] = useState<'bank' | 'cashbox'>('bank');
  const [selectedBankId, setSelectedBankId] = useState(bankAccounts[0]?.id || '');
  const [selectedCashBoxId, setSelectedCashBoxId] = useState(cashBoxes[0]?.id || '');
  const [notes, setNotes] = useState('');
  
  // Pool balances from the API (tracked in settings table)
  const hppPaidBalance = fundBalances.hppPaidBalance ?? 0;
  const profitPaidBalance = fundBalances.profitPaidBalance ?? 0;
  
  let items: any[] = [];
  try { items = request.purchaseItems ? JSON.parse(request.purchaseItems) : []; } catch { items = []; }
  
  // Step 1: Check if selected pool has sufficient balance
  const poolSufficient = fundSource 
    ? (fundSource === 'hpp_paid' ? hppPaidBalance >= request.amount : profitPaidBalance >= request.amount)
    : false;
  
  // Step 2: Check if physical account has sufficient balance
  const checkPhysicalSufficient = () => {
    if (sourceType === 'bank') {
      const selectedBank = bankAccounts.find(b => b.id === selectedBankId);
      return selectedBank ? selectedBank.balance >= request.amount : false;
    }
    if (sourceType === 'cashbox') {
      const selectedCashBox = cashBoxes.find(c => c.id === selectedCashBoxId);
      return selectedCashBox ? selectedCashBox.balance >= request.amount : false;
    }
    return true;
  };
  
  const physicalSufficient = checkPhysicalSufficient();
  
  // Both steps must be completed and sufficient
  const canPayNow = fundSource && poolSufficient && physicalSufficient;
  
  const handleProcess = () => {
    if (processType === 'debt' && request.type !== 'salary') {
      // Create as debt (hutang) - bypasses 2-step flow
      onProcess({
        id: request.id,
        status: 'processed',
        processType: 'debt',
        sourceType: null,
        fundSource: null,
        bankAccountId: null,
        notes: notes || 'Dijadikan hutang ke supplier'
      });
    } else if (processType === 'debt' && request.type === 'salary') {
      // Salary: approve only, payment will be done separately via pay_now
      onProcess({
        id: request.id,
        status: 'approved',
        processType: 'debt',
        sourceType: null,
        fundSource: null,
        bankAccountId: null,
        cashBoxId: null,
        notes: notes || 'Gaji disetujui'
      });
    } else {
      // Pay now with 2-step workflow
      onProcess({
        id: request.id,
        status: 'processed',
        processType: 'pay_now',
        fundSource: fundSource,
        sourceType: sourceType,
        bankAccountId: sourceType === 'bank' ? selectedBankId : null,
        cashBoxId: sourceType === 'cashbox' ? selectedCashBoxId : null,
        notes: notes || (request.type === 'salary' ? 'Gaji dibayarkan' : 'Dibayar langsung')
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
          <span className="font-medium">{request.type === 'salary' && request.salaryPayment ? request.salaryPayment.user?.name : (request.supplier?.name || '-')}</span>
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
          {/* Mobile card view */}
          <div className="block md:hidden space-y-2">
            {items.map((item: any, i: number) => (
              <div key={i} className="p-3 border rounded-lg space-y-1">
                <span className="font-medium text-sm min-w-0 truncate block">{item.productName}</span>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Qty: {item.qty} × {formatCurrency(item.price)}</span>
                  <span className="font-medium">{formatCurrency(item.subtotal)}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table view */}
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
                Setujui dan bayar langsung dari dana tersedia
              </span>
            </Button>
          </div>
        </div>
      ) : request.type === 'salary' && (request.status === 'approved' || request.forcePayNow) ? (
        <div className="space-y-2">
          <Label className="text-base font-semibold">Pembayaran Gaji</Label>
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg text-sm text-blue-700 dark:text-blue-300">
            Gaji sudah disetujui. Pilih komposisi dana untuk membayar gaji <strong>{request.salaryPayment?.user?.name}</strong>.
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
              Bayar langsung dari dana tersedia (Bank/Brankas)
            </span>
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-base font-semibold">Pilihan Pembayaran</Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <span className="font-semibold">Hutang ke Supplier</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Catat sebagai hutang, bayar nanti
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
                <span className="font-semibold">Lunasi Langsung</span>
              </div>
              <span className="text-xs opacity-80 mt-2 text-left w-full">
                Bayar sekarang dari dana tersedia
              </span>
            </Button>
          </div>
        </div>
      )}
      
      {/* 2-Step Workflow - Only show for pay_now */}
      {processType === 'pay_now' && (
        <>
          {/* STEP 1: Komposisi Dana */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</div>
              <Label className="text-sm font-semibold">KOMPOSISI DANA</Label>
            </div>
            <p className="text-xs text-muted-foreground">Pilih dari pool dana mana uang akan diambil</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* HPP Sudah Terbayar */}
              <button
                type="button"
                onClick={() => setFundSource('hpp_paid')}
                className={cn(
                  "relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all",
                  fundSource === 'hpp_paid'
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950"
                    : "border-muted hover:border-emerald-300 dark:hover:border-emerald-700"
                )}
              >
                {fundSource === 'hpp_paid' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                    <CircleDollarSign className="w-4 h-4 text-emerald-600" />
                  </div>
                  <span className="font-semibold text-sm">HPP Sudah Terbayar</span>
                </div>
                <p className="text-xs text-muted-foreground">Dana pemulihan biaya yang sudah dibayar pelanggan</p>
                <p className={cn(
                  "text-sm font-bold mt-1",
                  fundSource === 'hpp_paid' ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"
                )}>
                  {formatCurrency(hppPaidBalance)}
                </p>
                {fundSource === 'hpp_paid' && hppPaidBalance < request.amount && (
                  <div className="flex items-center gap-1 mt-1.5 text-red-500 text-xs">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Saldo Tidak Mencukupi</span>
                  </div>
                )}
              </button>
              
              {/* Profit Sudah Terbayar */}
              <button
                type="button"
                onClick={() => setFundSource('profit_unpaid')}
                className={cn(
                  "relative flex flex-col items-start p-3 rounded-lg border-2 text-left transition-all",
                  fundSource === 'profit_unpaid'
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
                    : "border-muted hover:border-blue-300 dark:hover:border-blue-700"
                )}
              >
                {fundSource === 'profit_unpaid' && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                  </div>
                  <span className="font-semibold text-sm">Profit Sudah Terbayar</span>
                </div>
                <p className="text-xs text-muted-foreground">Dana keuntungan yang tersedia untuk dibelanjakan</p>
                <p className={cn(
                  "text-sm font-bold mt-1",
                  fundSource === 'profit_unpaid' ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"
                )}>
                  {formatCurrency(profitPaidBalance)}
                </p>
                {fundSource === 'profit_unpaid' && profitPaidBalance < request.amount && (
                  <div className="flex items-center gap-1 mt-1.5 text-red-500 text-xs">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Saldo Tidak Mencukupi</span>
                  </div>
                )}
              </button>
            </div>
            
            {!fundSource && (
              <p className="text-xs text-amber-600 dark:text-amber-400">⚠️ Pilih salah satu komposisi dana untuk melanjutkan</p>
            )}
          </div>
          
          {/* Arrow indicator between steps */}
          <div className="flex justify-center">
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
          </div>
          
          {/* STEP 2: Physical Account (Keluarkan Dari) */}
          <div className={cn(
            "border rounded-lg p-4 space-y-3 transition-opacity",
            !fundSource ? "opacity-50 pointer-events-none" : ""
          )}>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</div>
              <Label className="text-sm font-semibold">KELUARKAN DARI</Label>
            </div>
            <p className="text-xs text-muted-foreground">Pilih akun fisik untuk menarik uang</p>
            
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
                <p className="text-xs text-muted-foreground">Total di semua rekening bank</p>
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
                <p className="text-xs text-muted-foreground">Total di semua brankas/kas</p>
                <p className="text-sm font-bold text-amber-700 dark:text-amber-300 mt-1">
                  {formatCurrency(fundBalances.totalCashInBoxes)}
                </p>
              </button>
            </div>
            
            {/* Account selector */}
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
                          <span className="text-muted-foreground ml-2 min-w-0 truncate">({formatCurrency(b.balance)})</span>
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
                          <span className="text-muted-foreground ml-2 min-w-0 truncate">({formatCurrency(c.balance)})</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* Physical account insufficient warning */}
            {fundSource && !physicalSufficient && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Saldo Tidak Mencukupi</AlertTitle>
                <AlertDescription>
                  Saldo akun fisik yang dipilih tidak mencukupi. Pilih akun lain.
                </AlertDescription>
              </Alert>
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
            notes: notes || 'Ditolak oleh Finance'
          })}
          className="w-full sm:w-auto"
        >
          Tolak
        </Button>
        <Button 
          onClick={() => {
            if (processType === 'pay_now' && !canPayNow) {
              if (!fundSource) {
                toast.warning('Pilih komposisi dana terlebih dahulu (Langkah 1)');
              } else if (!poolSufficient) {
                toast.warning('Saldo pool dana tidak mencukupi');
              } else if (!physicalSufficient) {
                toast.warning('Saldo akun fisik yang dipilih tidak mencukupi');
              }
              return;
            }
            handleProcess();
          }}
          disabled={isProcessing || (processType === 'pay_now' && !canPayNow)}
          className={cn(
            "w-full sm:w-auto",
            processType === 'debt' && "bg-amber-500 hover:bg-amber-600",
            processType === 'pay_now' && "bg-green-500 hover:bg-green-600"
          )}
        >
          {isProcessing ? 'Memproses...' : processType === 'pay_now' ? 'Bayar Sekarang' : (request.type === 'salary' ? 'Setujui' : 'Jadikan Hutang')}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Transfer Form Component
export function TransferForm({ bankAccounts, cashBoxes, onSubmit, isLoading }: { 
  bankAccounts: BankAccount[]; 
  cashBoxes: CashBox[]; 
  onSubmit: (data: any) => void; 
  isLoading: boolean 
}) {
  const [form, setForm] = useState({
    type: 'cash_to_bank' as string,
    fromCashBoxId: '',
    fromBankAccountId: '',
    toBankAccountId: '',
    toCashBoxId: '',
    amount: 0,
    description: ''
  });

  // BUG FIX: Reset all source/destination IDs when transfer type changes
  // to prevent stale IDs from causing double debit/credit
  const handleTypeChange = (newType: string) => {
    setForm(prev => ({
      ...prev,
      type: newType,
      fromCashBoxId: '',
      fromBankAccountId: '',
      toBankAccountId: '',
      toCashBoxId: '',
      amount: 0
    }));
  };

  // Get source balance for sufficiency check
  const getSourceBalance = () => {
    if (form.type === 'cash_to_bank' || form.type === 'cash_to_cash') {
      const box = cashBoxes.find(c => c.id === form.fromCashBoxId);
      return box?.balance || 0;
    }
    if (form.type === 'bank_to_bank' || form.type === 'bank_to_cash') {
      const bank = bankAccounts.find(b => b.id === form.fromBankAccountId);
      return bank?.balance || 0;
    }
    return 0;
  };

  const sufficientBalance = form.amount > 0 && form.amount <= getSourceBalance();
  
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Tipe Transfer</Label>
        <Select value={form.type} onValueChange={handleTypeChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash_to_bank">Brankas → Bank</SelectItem>
            <SelectItem value="bank_to_cash">Bank → Brankas</SelectItem>
            <SelectItem value="bank_to_bank">Bank → Bank</SelectItem>
            <SelectItem value="cash_to_cash">Brankas → Brankas</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* Source selector */}
      {(form.type === 'cash_to_bank' || form.type === 'cash_to_cash') && (
        <div className="space-y-2">
          <Label>Dari Brankas</Label>
          <Select value={form.fromCashBoxId} onValueChange={v => setForm({ ...form, fromCashBoxId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih brankas" />
            </SelectTrigger>
            <SelectContent>
              {cashBoxes.map(c => (
                <SelectItem key={c.id} value={c.id} className="min-w-0">
                  <span className="min-w-0 truncate">{c.name} ({formatCurrency(c.balance)})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(form.type === 'bank_to_bank' || form.type === 'bank_to_cash') && (
        <div className="space-y-2">
          <Label>Dari Rekening Bank</Label>
          <Select value={form.fromBankAccountId} onValueChange={v => setForm({ ...form, fromBankAccountId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih rekening sumber" />
            </SelectTrigger>
            <SelectContent>
              {bankAccounts.map(b => (
                <SelectItem key={b.id} value={b.id} className="min-w-0">
                  <span className="min-w-0 truncate">{b.name} - {b.bankName} ({formatCurrency(b.balance)})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Destination selector */}
      {(form.type === 'cash_to_bank' || form.type === 'bank_to_bank') && (
        <div className="space-y-2">
          <Label>Ke Rekening Bank</Label>
          <Select value={form.toBankAccountId} onValueChange={v => setForm({ ...form, toBankAccountId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih rekening tujuan" />
            </SelectTrigger>
            <SelectContent>
              {bankAccounts.map(b => (
                <SelectItem key={b.id} value={b.id} className="min-w-0">
                  <span className="min-w-0 truncate">{b.name} - {b.bankName} ({formatCurrency(b.balance)})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {(form.type === 'bank_to_cash' || form.type === 'cash_to_cash') && (
        <div className="space-y-2">
          <Label>Ke Brankas</Label>
          <Select value={form.toCashBoxId} onValueChange={v => setForm({ ...form, toCashBoxId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih brankas tujuan" />
            </SelectTrigger>
            <SelectContent>
              {cashBoxes.map(c => (
                <SelectItem key={c.id} value={c.id} className="min-w-0">
                  <span className="min-w-0 truncate">{c.name} ({formatCurrency(c.balance)})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      
      <div className="space-y-2">
        <Label>Jumlah</Label>
        <Input 
          type="number"
          value={form.amount || ''} 
          onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
          placeholder="0"
        />
        {form.amount > 0 && (
          <p className="text-xs text-muted-foreground">
            Saldo sumber: {formatCurrency(getSourceBalance())}
          </p>
        )}
      </div>

      {/* Balance warning */}
      {form.amount > 0 && !sufficientBalance && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Saldo Tidak Mencukupi</AlertTitle>
          <AlertDescription>
            Komposisi dana hanya memiliki {formatCurrency(getSourceBalance())}.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="space-y-2">
        <Label>Keterangan</Label>
        <Textarea 
          value={form.description} 
          onChange={e => setForm({ ...form, description: e.target.value })}
          placeholder="Keterangan transfer..."
        />
      </div>
      
      <DialogFooter>
        <Button onClick={() => {
          // Validation
          if (!form.amount || form.amount <= 0) {
            toast.error('Jumlah transfer harus lebih dari 0');
            return;
          }
          if (form.type === 'cash_to_bank') {
            if (!form.fromCashBoxId) {
              toast.error('Pilih brankas sumber');
              return;
            }
            if (!form.toBankAccountId) {
              toast.error('Pilih rekening bank tujuan');
              return;
            }
          } else if (form.type === 'bank_to_bank') {
            if (!form.fromBankAccountId) {
              toast.error('Pilih rekening bank sumber');
              return;
            }
            if (!form.toBankAccountId) {
              toast.error('Pilih rekening bank tujuan');
              return;
            }
            if (form.fromBankAccountId === form.toBankAccountId) {
              toast.error('Rekening sumber dan tujuan tidak boleh sama');
              return;
            }
          } else if (form.type === 'bank_to_cash') {
            if (!form.fromBankAccountId) {
              toast.error('Pilih rekening bank sumber');
              return;
            }
            if (!form.toCashBoxId) {
              toast.error('Pilih brankas tujuan');
              return;
            }
          } else if (form.type === 'cash_to_cash') {
            if (!form.fromCashBoxId) {
              toast.error('Pilih brankas sumber');
              return;
            }
            if (!form.toCashBoxId) {
              toast.error('Pilih brankas tujuan');
              return;
            }
            if (form.fromCashBoxId === form.toCashBoxId) {
              toast.error('Brankas sumber dan tujuan tidak boleh sama');
              return;
            }
          }
          if (!sufficientBalance) {
            toast.error('Saldo sumber tidak mencukupi');
            return;
          }
          // Only send fields relevant to the selected type
          const payload: Record<string, any> = {
            type: form.type,
            amount: form.amount,
            description: form.description || undefined
          };
          if (form.type === 'cash_to_bank' || form.type === 'cash_to_cash') {
            payload.fromCashBoxId = form.fromCashBoxId;
          } else {
            payload.fromBankAccountId = form.fromBankAccountId;
          }
          if (form.type === 'bank_to_cash' || form.type === 'cash_to_cash') {
            payload.toCashBoxId = form.toCashBoxId;
          } else {
            payload.toBankAccountId = form.toBankAccountId;
          }
          onSubmit(payload);
        }} disabled={isLoading} className="w-full">
          {isLoading ? 'Menyimpan...' : 'Buat Transfer'}
        </Button>
      </DialogFooter>
    </div>
  );
}

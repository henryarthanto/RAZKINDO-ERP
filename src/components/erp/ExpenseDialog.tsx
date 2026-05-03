'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency } from '@/lib/erp-helpers';

import {
  DollarSign,
  TrendingUp,
  Wallet,
  Building2,
  Warehouse,
  Receipt,
  ArrowRight,
  Info,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';

interface ExpenseDialogProps {
  bankAccounts: any[];
  cashBoxes: any[];
  fundBalances: {
    hppPaidBalance: number;
    profitPaidBalance: number;
    investorFund: number;
    totalPhysical: number;
  };
  onClose: () => void;
  onSuccess: () => void;
}

type FundSource = 'hpp_paid' | 'profit_paid' | 'lain_lain';
type DestinationType = 'bank' | 'cashbox' | 'direct';

export function ExpenseDialog({ bankAccounts, cashBoxes, fundBalances, onClose, onSuccess }: ExpenseDialogProps) {
  const { user } = useAuthStore();

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [fundSource, setFundSource] = useState<FundSource>('');
  const [destinationType, setDestinationType] = useState<DestinationType>('');
  const [destinationId, setDestinationId] = useState('');

  const amountNum = Number(amount) || 0;

  // Get pool balance for selected fund source
  const getPoolBalance = () => {
    switch (fundSource) {
      case 'hpp_paid': return fundBalances.hppPaidBalance;
      case 'profit_paid': return fundBalances.profitPaidBalance;
      case 'lain_lain': return fundBalances.investorFund;
      default: return 0;
    }
  };

  const getPoolLabel = () => {
    switch (fundSource) {
      case 'hpp_paid': return 'HPP Sudah Terbayar';
      case 'profit_paid': return 'Profit Sudah Terbayar';
      case 'lain_lain': return 'Dana Lain-lain';
      default: return '-';
    }
  };

  const getPoolColor = () => {
    switch (fundSource) {
      case 'hpp_paid': return 'text-purple-600 bg-purple-50 dark:text-purple-300 dark:bg-purple-950';
      case 'profit_paid': return 'text-teal-600 bg-teal-50 dark:text-teal-300 dark:bg-teal-950';
      case 'lain_lain': return 'text-amber-600 bg-amber-50 dark:text-amber-300 dark:bg-amber-950';
      default: return '';
    }
  };

  // Get destination label
  const getDestinationLabel = () => {
    if (destinationType === 'bank') {
      const acc = bankAccounts.find((b: any) => b.id === destinationId);
      return acc ? `${acc.name} — ${acc.bankName}` : '-';
    }
    if (destinationType === 'cashbox') {
      const cb = cashBoxes.find((c: any) => c.id === destinationId);
      return cb ? cb.name : '-';
    }
    return '-';
  };

  const getDestinationBalance = () => {
    if (destinationType === 'bank') {
      const acc = bankAccounts.find((b: any) => b.id === destinationId);
      return acc?.balance || 0;
    }
    if (destinationType === 'cashbox') {
      const cb = cashBoxes.find((c: any) => c.id === destinationId);
      return cb?.balance || 0;
    }
    return 0;
  };

  const isValid =
    description.trim().length > 0 &&
    amountNum > 0 &&
    fundSource !== '' &&
    amountNum <= getPoolBalance();

  const isDestinationValid =
    destinationType !== '' && destinationId !== '' &&
    amountNum <= getDestinationBalance();

  const canSubmit = isValid && isDestinationValid;

  const createMutation = useMutation({
    mutationFn: async () => {
      return apiFetch('/api/finance/expenses', {
        method: 'POST',
        body: JSON.stringify({
          description: description.trim(),
          amount: amountNum,
          notes: notes.trim() || undefined,
          fundSource,
          destinationType,
          destinationId,
          unitId: undefined,
        }),
      });
    },
    onSuccess: (data: any) => {
      toast.success(data?.message || 'Pengeluaran berhasil dicatat');
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Gagal membuat pengeluaran');
    },
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
          <Receipt className="w-5 h-5 text-red-500" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">Tambah Pengeluaran</h3>
          <p className="text-xs text-muted-foreground">Catat pengeluaran & potong dari saldo</p>
        </div>
      </div>

      <Separator />

      {/* Description */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Deskripsi Pengeluaran <span className="text-red-500">*</span></Label>
        <Input
          placeholder="Contoh: Beli ATK, Bayar listrik, Service kendaraan..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* Amount */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Jumlah (Rp) <span className="text-red-500">*</span></Label>
        <Input
          type="number"
          placeholder="0"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {amountNum > 0 && (
          <p className="text-xs text-muted-foreground">{formatCurrency(amountNum)}</p>
        )}
      </div>

      {/* Notes */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Catatan (opsional)</Label>
        <Input
          placeholder="Keterangan tambahan..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <Separator />

      {/* Step 1: Sumber Dana (Pool) */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">1</span>
          <Label className="text-xs font-semibold">Sumber Dana (Pool)</Label>
        </div>
        <p className="text-[10px] text-muted-foreground ml-7">Pilih pool dana yang akan dikurangi</p>

        <Select value={fundSource} onValueChange={(v) => { setFundSource(v as FundSource); setDestinationType(''); setDestinationId(''); }}>
          <SelectTrigger className="ml-7">
            <SelectValue placeholder="Pilih sumber dana..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hpp_paid">
              <div className="flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5 text-purple-500" />
                <span>HPP Sudah Terbayar</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{formatCurrency(fundBalances.hppPaidBalance)}</span>
              </div>
            </SelectItem>
            <SelectItem value="profit_paid">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-3.5 h-3.5 text-teal-500" />
                <span>Profit Sudah Terbayar</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{formatCurrency(fundBalances.profitPaidBalance)}</span>
              </div>
            </SelectItem>
            <SelectItem value="lain_lain">
              <div className="flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-amber-500" />
                <span>Dana Lain-lain</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{formatCurrency(fundBalances.investorFund)}</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>

        {/* Pool balance info */}
        {fundSource && (
          <div className={`ml-7 rounded-lg px-3 py-2 text-xs ${getPoolColor()}`}>
            <div className="flex items-center justify-between">
              <span>Saldo {getPoolLabel()}</span>
              <span className="font-bold">{formatCurrency(getPoolBalance())}</span>
            </div>
            {amountNum > 0 && amountNum > getPoolBalance() && (
              <p className="text-red-500 text-[10px] mt-1 flex items-center gap-1">
                <Info className="w-3 h-3" /> Saldo tidak mencukupi
              </p>
            )}
          </div>
        )}
      </div>

      {/* Step 2: Bayar Dari (Rekening/Brankas) */}
      {fundSource && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">2</span>
            <Label className="text-xs font-semibold">Bayar Dari</Label>
          </div>
          <p className="text-[10px] text-muted-foreground ml-7">Pilih rekening bank atau brankas</p>

          <Select value={destinationType} onValueChange={(v) => { setDestinationType(v as DestinationType); setDestinationId(''); }}>
            <SelectTrigger className="ml-7">
              <SelectValue placeholder="Pilih sumber pembayaran..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bank">
                <div className="flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5 text-green-500" />
                  <span>Rekening Bank</span>
                </div>
              </SelectItem>
              <SelectItem value="cashbox">
                <div className="flex items-center gap-2">
                  <Warehouse className="w-3.5 h-3.5 text-amber-500" />
                  <span>Brankas / Kas</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Destination selector */}
          {destinationType && (
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger className="ml-7">
                <SelectValue placeholder={destinationType === 'bank' ? 'Pilih rekening...' : 'Pilih brankas...'} />
              </SelectTrigger>
              <SelectContent>
                {destinationType === 'bank' && bankAccounts.map((acc: any) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate">{acc.name} — {acc.bankName}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatCurrency(acc.balance)}</span>
                    </div>
                  </SelectItem>
                ))}
                {destinationType === 'cashbox' && cashBoxes.map((cb: any) => (
                  <SelectItem key={cb.id} value={cb.id}>
                    <div className="flex items-center justify-between gap-4">
                      <span className="truncate">{cb.name}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatCurrency(cb.balance)}</span>
                    </div>
                  </SelectItem>
                ))}
                {((destinationType === 'bank' && bankAccounts.length === 0) ||
                  (destinationType === 'cashbox' && cashBoxes.length === 0)) && (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                    Belum ada data. Tambahkan di tab {destinationType === 'bank' ? 'Rekening' : 'Brankas'}.
                  </div>
                )}
              </SelectContent>
            </Select>
          )}

          {/* Destination balance info */}
          {destinationId && (
            <div className="ml-7 rounded-lg px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <span>Saldo {getDestinationLabel()}</span>
                <span className="font-bold">{formatCurrency(getDestinationBalance())}</span>
              </div>
              {amountNum > 0 && amountNum > getDestinationBalance() && (
                <p className="text-red-500 text-[10px] mt-1 flex items-center gap-1">
                  <Info className="w-3 h-3" /> Saldo tidak mencukupi
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      {fundSource && destinationId && amountNum > 0 && (
        <div className="rounded-lg border-2 border-dashed border-muted p-3 space-y-2">
          <p className="text-xs font-semibold text-center">Ringkasan Pengeluaran</p>
          <div className="flex items-center justify-between text-xs gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${getPoolColor()}`}>
              {getPoolLabel()}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-bold text-red-600">{formatCurrency(amountNum)}</span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">
              {destinationType === 'bank' ? <Building2 className="w-3 h-3" /> : <Warehouse className="w-3 h-3" />}
              {getDestinationLabel()}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onClose} disabled={createMutation.isPending}>
          Batal
        </Button>
        <Button
          className="flex-1 bg-red-500 hover:bg-red-600 text-white"
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? 'Memproses...' : `Bayar ${formatCurrency(amountNum)}`}
        </Button>
      </div>
    </div>
  );
}

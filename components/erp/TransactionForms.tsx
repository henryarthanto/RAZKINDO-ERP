'use client';

import React, { useState, useEffect } from 'react';
import { Wallet, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { formatCurrency, PAYMENT_RECORD_METHODS } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';

// Payment Form Component — used in TransactionDetail for recording payments
export function PaymentForm({ remaining, onSubmit, loading }: {
  remaining: number;
  onSubmit: (amount: number, method: string, destinationId: string) => void;
  loading: boolean;
}) {
  const [amount, setAmount] = useState(remaining);
  const [method, setMethod] = useState('cash');
  const [cashBoxId, setCashBoxId] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [cashBoxes, setCashBoxes] = useState<{ id: string; name: string; balance: number }[]>([]);
  const [bankAccounts, setBankAccounts] = useState<{ id: string; name: string; bankName: string; accountNo: string; balance: number }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function loadOptions() {
      try {
        const [cashRes, bankRes] = await Promise.all([
          apiFetch<{ cashBoxes: any[] }>('/api/finance/cash-boxes', { signal: controller.signal }),
          apiFetch<{ bankAccounts: any[] }>('/api/finance/bank-accounts', { signal: controller.signal })
        ]);
        if (controller.signal.aborted) return;
        setCashBoxes(cashRes.cashBoxes || []);
        setBankAccounts(bankRes.bankAccounts || []);
        // Auto-select first option
        if (cashRes.cashBoxes?.length > 0) setCashBoxId(cashRes.cashBoxes[0].id);
        if (bankRes.bankAccounts?.length > 0) setBankAccountId(bankRes.bankAccounts[0].id);
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('Failed to load payment destinations:', err);
      } finally {
        if (!controller.signal.aborted) setLoadingOptions(false);
      }
    }
    loadOptions();
    return () => controller.abort();
  }, []);

  const selectedDestination = method === 'cash' ? cashBoxId : bankAccountId;
  const canSubmit = amount > 0 && amount <= remaining && selectedDestination;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Jumlah</Label>
        <Input
          type="number"
          value={amount}
          onChange={e => setAmount(parseFloat(e.target.value) || 0)}
          max={remaining}
        />
        <p className="text-xs text-muted-foreground">Maks: {formatCurrency(remaining)}</p>
      </div>

      <div className="space-y-2">
        <Label>Metode Pembayaran</Label>
        <Select value={method} onValueChange={v => { setMethod(v); }}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_RECORD_METHODS.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cash → Brankas selector */}
      {method === 'cash' && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5" />
            Masuk ke Brankas
          </Label>
          {loadingOptions ? (
            <div className="h-9 rounded-md border bg-muted animate-pulse" />
          ) : cashBoxes.length === 0 ? (
            <p className="text-xs text-destructive">Belum ada brankas. Buat brankas di menu Keuangan terlebih dahulu.</p>
          ) : (
            <Select value={cashBoxId} onValueChange={setCashBoxId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih brankas" />
              </SelectTrigger>
              <SelectContent>
                {cashBoxes.map(cb => (
                  <SelectItem key={cb.id} value={cb.id}>
                    <span>{cb.name}</span>
                    <span className="ml-2 text-muted-foreground text-xs">({formatCurrency(cb.balance)})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      {/* Transfer/Giro → Bank Account selector */}
      {(method === 'transfer' || method === 'giro') && (
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5" />
            Masuk ke Akun Bank
          </Label>
          {loadingOptions ? (
            <div className="h-9 rounded-md border bg-muted animate-pulse" />
          ) : bankAccounts.length === 0 ? (
            <p className="text-xs text-destructive">Belum ada akun bank. Buat akun bank di menu Keuangan terlebih dahulu.</p>
          ) : (
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih akun bank" />
              </SelectTrigger>
              <SelectContent>
                {bankAccounts.map(ba => (
                  <SelectItem key={ba.id} value={ba.id}>
                    <span>{ba.name}</span>
                    <span className="ml-2 text-muted-foreground text-xs">({ba.bankName} {formatCurrency(ba.balance)})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <Button
        className="w-full"
        onClick={() => onSubmit(amount, method, selectedDestination)}
        disabled={loading || !canSubmit}
      >
        {loading ? 'Menyimpan...' : 'Simpan Pembayaran'}
      </Button>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { formatCurrency } from '@/lib/erp-helpers';
import { Wallet, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DepositDialog({
  open,
  onOpenChange,
  targetName,
  currentBalance,
  onDeposit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetName: string;
  currentBalance: number;
  onDeposit: (amount: number, description: string) => void;
  isSaving: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const numAmount = parseFloat(amount) || 0;
  const newBalance = currentBalance + numAmount;

  const handleSubmit = () => {
    if (numAmount <= 0) return;
    onDeposit(numAmount, description.trim());
    setAmount('');
    setDescription('');
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setAmount('');
      setDescription('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md w-[calc(100%-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-600" />
            Tambah Dana
          </DialogTitle>
          <DialogDescription>
            Tambahkan dana ke <strong>{targetName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current balance info */}
          <div className="p-3 rounded-lg bg-muted">
            <p className="text-xs text-muted-foreground">Saldo saat ini</p>
            <p className="text-lg font-bold">{formatCurrency(currentBalance)}</p>
          </div>

          {/* Amount input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Jumlah Dana</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rp</span>
              <Input
                type="number"
                className="pl-10 text-lg font-semibold"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={0}
                autoFocus
              />
            </div>
          </div>

          {/* Description input */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Keterangan <span className="text-muted-foreground font-normal">(opsional)</span></Label>
            <Input
              placeholder="Contoh: Dana dari investor, Pinjaman, dll"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Preview */}
          {numAmount > 0 && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
              <p className="text-xs text-muted-foreground mb-1">Saldo setelah menambah dana</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
                {formatCurrency(newBalance)}
              </p>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/30 p-2.5 rounded-lg border border-blue-200 dark:border-blue-800">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
            <p>Dana yang ditambahkan akan otomatis masuk ke <strong className="text-amber-600">Dana Lain-lain</strong> di Komposisi Dana.</p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isSaving}
          >
            Batal
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={numAmount <= 0 || isSaving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isSaving ? 'Menyimpan...' : `Tambah ${formatCurrency(numAmount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

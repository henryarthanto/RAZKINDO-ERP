'use client';

import React, { useState, useCallback } from 'react';
import {
  Calendar, Check, FileText, FileSpreadsheet, Send, Share2, RefreshCw, Wallet,
  Bluetooth, Printer, FileDown, Link2, Image as ImageIcon, Copy,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { formatCurrency, formatDate, formatDateTime, escapeHtml, getTransactionPaymentLabel, getPaymentRecordLabel } from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import type { Transaction, TransactionItem } from '@/types';
import { PaymentForm } from './TransactionForms';
import { generateReceiptText, generateReceiptHTML, wrapReceiptWithESCPOS, writeBLEChunks, requestBLEPrinter, connectBLEPrinter, downloadInvoicePDF } from '@/lib/generate-invoice-pdf';

// Transaction Detail Component
export function TransactionDetail({ transaction }: { transaction: Transaction }) {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [showPayment, setShowPayment] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedProof, setSelectedProof] = useState<any>(null);

  const showProfit = user?.role === 'super_admin';

  // Fetch settings for receipt/printer config
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Record<string, any> }>('/api/settings')
  });
  const appSettings = settingsData?.settings || {};
  const printerType = appSettings.printer_type || 'browser';
  const paperWidth = printerType === 'bluetooth_80' ? 80 : 57;

  // Copy payment link to clipboard
  const handleCopyLink = async () => {
    const link = `${window.location.origin}/payment/${transaction.invoiceNo}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link berhasil disalin');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      toast.success('Link berhasil disalin');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Fetch payment proofs from public endpoint
  const { data: proofsData } = useQuery({
    queryKey: ['payment-proofs', transaction.id],
    queryFn: () => fetch(`/api/payment/${transaction.invoiceNo}`).then(r => r.json()).then(d => d.proofs || []),
    enabled: !!transaction.invoiceNo,
  });
  const proofs = proofsData || [];

  // Shared receipt text generator
  const getReceiptText = useCallback(() => {
    return generateReceiptText(transaction, {
      company_name: appSettings.company_name,
      receipt_header: appSettings.receipt_header,
      receipt_footer: appSettings.receipt_footer,
      receipt_show_logo: appSettings.receipt_show_logo,
      company_logo: appSettings.company_logo,
    }, paperWidth);
  }, [transaction, appSettings, paperWidth]);

  // Print Receipt (Browser thermal)
  const handlePrintReceipt = useCallback(() => {
    setIsPrinting(true);
    const receiptHTML = generateReceiptHTML(transaction, {
      company_name: appSettings.company_name,
      receipt_header: appSettings.receipt_header,
      receipt_footer: appSettings.receipt_footer,
      receipt_show_logo: appSettings.receipt_show_logo,
      company_logo: appSettings.company_logo,
    }, paperWidth);
    const printWindow = window.open('', '_blank', 'width=400,height=700');
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setIsPrinting(false);
  }, [transaction, appSettings, paperWidth]);

  // Bluetooth Print
  const handleBluetoothPrint = useCallback(async () => {
    let device: BluetoothDevice | null = null;
    try {
      setIsPrinting(true);
      toast.info('Mencari printer Bluetooth...');
      device = await requestBLEPrinter();
      toast.info(`Menghubungkan ke ${device.name}...`);
      const { characteristic } = await connectBLEPrinter(device);
      const receiptText = getReceiptText();
      const data = wrapReceiptWithESCPOS(receiptText);
      await writeBLEChunks(characteristic, data);
      toast.success('Receipt berhasil di-print!');
    } catch (err: any) {
      console.error('Bluetooth print error:', err);
      if (err.name === 'NotFoundError') {
        toast.error('Printer tidak ditemukan. Pastikan printer menyala dan Bluetooth aktif.');
      } else if (err.name === 'SecurityError') {
        toast.error('Permission ditolak. Izinkan akses Bluetooth di browser.');
      } else if (err.name === 'NetworkError') {
        toast.error('Koneksi Bluetooth gagal. Coba dekatkan ke printer dan coba lagi.');
      } else {
        toast.error('Gagal print: ' + err.message);
      }
    } finally {
      if (device?.gatt?.connected) device.gatt.disconnect();
      setIsPrinting(false);
    }
  }, [getReceiptText]);

  // Download PDF Invoice
  const handleDownloadPDF = useCallback(async () => {
    try {
      setIsPrinting(true);
      await downloadInvoicePDF(transaction, {
        company_name: appSettings.company_name,
        company_logo: appSettings.company_logo,
        company_address: appSettings.company_address,
        company_phone: appSettings.company_phone,
        company_email: appSettings.company_email,
      });
      toast.success('PDF berhasil di-download!');
    } catch (err: any) {
      toast.error('Gagal download PDF: ' + err.message);
    } finally {
      setIsPrinting(false);
    }
  }, [transaction, appSettings.company_name, appSettings.company_logo, appSettings.company_address, appSettings.company_phone, appSettings.company_email]);

  const paymentMutation = useMutation({
    mutationFn: async (data: { amount: number; method: string; destinationId: string }) => {
      if (!user?.id) throw new Error('User belum login');
      const body: Record<string, any> = {
        transactionId: transaction.id,
        receivedById: user.id,
        amount: data.amount,
        paymentMethod: data.method
      };
      if (data.method === 'cash') {
        body.cashBoxId = data.destinationId;
      } else {
        body.bankAccountId = data.destinationId;
      }
      const res = await apiFetch('/api/payments', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      return res;
    },
    onSuccess: () => {
      toast.success('Pembayaran berhasil dicatat');
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['cash-boxes'] });
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      setShowPayment(false);
    },
    onError: (err: any) => toast.error(err.message)
  });

  const statusConfig: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800' },
    approved: { label: 'Disetujui', className: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800' },
    paid: { label: 'Lunas', className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800' },
    cancelled: { label: 'Batal', className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800' },
  };
  const status = statusConfig[transaction.status] || statusConfig.pending;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <DialogHeader>
            <DialogTitle className="text-base">{transaction.invoiceNo}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(transaction.transactionDate)}</p>
        </div>
        <Badge variant="outline" className={cn("text-[11px] font-semibold px-2.5 py-0.5 shrink-0 border", status.className)}>
          {status.label}
        </Badge>
      </div>

      {/* Info Grid - compact 2-column rows */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] text-muted-foreground">Customer</p>
          <p className="font-medium text-sm truncate">{transaction.customer?.name || 'Walk-in'}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Sales</p>
          <p className="font-medium text-sm truncate">{transaction.createdBy?.name || '-'}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Unit</p>
          <p className="font-medium text-sm truncate">{transaction.unit?.name || '-'}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Pembayaran</p>
          <p className="font-medium text-sm truncate">{getTransactionPaymentLabel(transaction.paymentMethod)}</p>
        </div>
      </div>

      {/* Payment Link — only for sales, not cancelled */}
      {transaction.type === 'sale' && transaction.status !== 'cancelled' && (
        <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-lg">
          <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-muted-foreground">Link Pembayaran</p>
            <p className="text-xs text-muted-foreground truncate font-mono">
              {`${window.location.origin}/payment/${transaction.invoiceNo}`}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 shrink-0"
            onClick={handleCopyLink}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      )}

      {transaction.notes && (
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <span className="font-medium">Catatan:</span> {transaction.notes}
        </div>
      )}

      {/* Items - unified compact list (works great on both mobile & desktop) */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="px-3 py-2 bg-muted/30 border-b">
            <p className="text-xs font-semibold text-muted-foreground">Item ({transaction.items?.length || 0})</p>
          </div>
          <div className="divide-y max-h-60 overflow-y-auto">
            {transaction.items?.map((item) => (
              <div key={item.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.productName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.qty} {item.qtyUnitType === 'main' ? 'box' : 'pcs'} × {formatCurrency(item.price)}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums shrink-0">{formatCurrency(item.subtotal)}</p>
              </div>
            ))}
            {(!transaction.items || transaction.items.length === 0) && (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Tidak ada item</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Total</span>
            <span className="font-bold text-lg tabular-nums">{formatCurrency(transaction.total)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Terbayar</span>
            <span className="text-green-600 dark:text-green-400 tabular-nums">{formatCurrency(transaction.paidAmount)}</span>
          </div>
          {transaction.remainingAmount > 0 && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Sisa</span>
              <span className="text-red-600 dark:text-red-400 font-medium tabular-nums">{formatCurrency(transaction.remainingAmount)}</span>
            </div>
          )}
          {showProfit && transaction.totalProfit != null && (
            <>
              <Separator />
              <div className="flex justify-between items-center text-sm">
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Profit</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold tabular-nums">{formatCurrency(transaction.totalProfit)}</span>
              </div>
            </>
          )}
          {transaction.paymentMethod === 'tempo' && transaction.dueDate && (
            <div className="flex items-center gap-2 p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-800">
              <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Jatuh Tempo: {formatDate(transaction.dueDate)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment History */}
      {transaction.payments && transaction.payments.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="px-3 py-2 bg-muted/30 border-b">
              <p className="text-xs font-semibold text-muted-foreground">Riwayat Pembayaran ({transaction.payments.length})</p>
            </div>
            <div className="divide-y max-h-48 overflow-y-auto">
              {transaction.payments.map(p => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums">{formatCurrency(p.amount)}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {formatDateTime(p.paidAt)} · {getPaymentRecordLabel(p.paymentMethod)}
                      {p.cashBox && <span className="ml-0.5">→ {p.cashBox.name}</span>}
                      {p.bankAccount && <span className="ml-0.5">→ {p.bankAccount.name}</span>}
                    </p>
                  </div>
                  <p className="text-[11px] text-muted-foreground shrink-0">oleh {p.receivedBy?.name}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Proofs from Customer */}
      {transaction.invoiceNo && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="px-3 py-2 bg-muted/30 border-b">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5" />
                Bukti Pembayaran Konsumen ({proofs.length})
              </p>
            </div>
            {proofs.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                Belum ada bukti pembayaran
              </div>
            ) : (
              <div className="p-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {proofs.map((proof: any) => {
                  const isPdf = proof.fileUrl?.endsWith('.pdf');
                  return (
                    <button
                      key={proof.id}
                      onClick={() => setSelectedProof(proof)}
                      className={`relative group rounded-lg overflow-hidden border bg-muted/30 hover:bg-muted/60 transition-colors text-left ${isPdf ? 'flex flex-col items-center justify-center p-2 aspect-[3/4]' : ''}`}
                    >
                      {isPdf ? (
                        <div className="flex flex-col items-center gap-1">
                          <FileText className="w-6 h-6 text-red-500" />
                          <span className="text-[10px] font-bold text-red-600 uppercase">PDF</span>
                        </div>
                      ) : (
                        <div className="aspect-square">
                          <img
                            src={proof.fileUrl}
                            alt={proof.fileName || 'Bukti bayar'}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                      <div className="px-1.5 py-1 w-full">
                        <p className="text-[10px] font-medium truncate">{proof.customerName || 'Konsumen'}</p>
                        <p className="text-[9px] text-muted-foreground">
                          {proof.uploadedAt ? new Date(proof.uploadedAt).toLocaleDateString('id-ID') : '-'}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Proof Image Dialog */}
      <Dialog open={!!selectedProof} onOpenChange={(open) => { if (!open) setSelectedProof(null); }}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)]">
          <DialogHeader>
            <DialogTitle>Bukti Pembayaran</DialogTitle>
            <DialogDescription>
              {selectedProof?.customerName || 'Konsumen'} — {selectedProof?.uploadedAt ? new Date(selectedProof.uploadedAt).toLocaleString('id-ID') : '-'}
            </DialogDescription>
          </DialogHeader>
          {selectedProof && (
            <div className="rounded-lg overflow-hidden border">
              {selectedProof.fileUrl?.endsWith('.pdf') ? (
                <iframe
                  src={selectedProof.fileUrl}
                  className="w-full h-[70dvh] border-0"
                  title={selectedProof.fileName || 'Bukti bayar'}
                />
              ) : (
                <img
                  src={selectedProof.fileUrl}
                  alt={selectedProof.fileName || 'Bukti bayar'}
                  className="w-full h-auto object-contain"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Print / Export Actions */}
      <div className="grid grid-cols-3 gap-2">
        <Button onClick={handleDownloadPDF} variant="outline" disabled={isPrinting} className="h-11 text-[11px] font-semibold gap-1.5 rounded-xl">
          <FileDown className="w-3.5 h-3.5" />
          PDF
        </Button>
        <Button onClick={handlePrintReceipt} variant="outline" disabled={isPrinting} className="h-11 text-[11px] font-semibold gap-1.5 rounded-xl">
          <Printer className="w-3.5 h-3.5" />
          Thermal
        </Button>
        <Button onClick={handleBluetoothPrint} variant="outline" disabled={isPrinting} className="h-11 text-[11px] font-semibold gap-1.5 rounded-xl">
          <Bluetooth className={cn("w-3.5 h-3.5", isPrinting && "animate-spin")} />
          Bluetooth
        </Button>
      </div>

      {/* Payment Dialog */}
      {transaction.remainingAmount > 0 && transaction.status !== 'cancelled' && user &&
        (user.role === 'super_admin' || user.role === 'keuangan' || user.role === 'sales') && (
        <Dialog open={showPayment} onOpenChange={setShowPayment}>
          <DialogTrigger asChild>
            <Button className="w-full h-12 text-sm font-semibold rounded-xl gap-2">
              <Wallet className="w-4 h-4" />
              Catat Pembayaran
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Catat Pembayaran</DialogTitle>
              <DialogDescription className="sr-only">Form pencatatan pembayaran untuk transaksi {transaction.invoiceNo}</DialogDescription>
            </DialogHeader>
            <PaymentForm
              remaining={transaction.remainingAmount}
              onSubmit={(amount, method, destinationId) => paymentMutation.mutate({ amount, method, destinationId })}
              loading={paymentMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Invoice Preview Component with Print, Share, and WhatsApp
export function InvoicePreview({ transaction, onClose }: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const [isPrinting, setIsPrinting] = useState(false);
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Record<string, any> }>('/api/settings')
  });
  const appSettings = settingsData?.settings || {};
  const companyName = appSettings.company_name || 'RAZKINDO GROUP';
  const companyLogo = appSettings.company_logo || '';
  const receiptHeader = appSettings.receipt_header || '';
  const receiptFooter = appSettings.receipt_footer || 'Terima Kasih Atas Kunjungan Anda!';
  const showLogo = appSettings.receipt_show_logo && companyLogo;
  const printerType = appSettings.printer_type || 'browser';
  const paperWidth = printerType === 'bluetooth_80' ? 80 : 57;

  const paymentMethodLabel = getTransactionPaymentLabel(transaction.paymentMethod);

  // Shared receipt text generator using settings
  const getReceiptText = useCallback(() => {
    return generateReceiptText(transaction, {
      company_name: companyName,
      receipt_header: receiptHeader,
      receipt_footer: receiptFooter,
      receipt_show_logo: showLogo,
      company_logo: companyLogo,
    }, paperWidth);
  }, [transaction, companyName, receiptHeader, receiptFooter, showLogo, companyLogo, paperWidth]);

  // Generate HTML Invoice for printing
  const generateInvoiceHTML = useCallback(() => {
    const logoHTML = showLogo && companyLogo ? `<img src="${escapeHtml(companyLogo)}" style="max-width:80px;max-height:80px;margin:0 auto 8px;display:block" />` : '';
    const companyAddress = appSettings.company_address || '';
    const companyPhone = appSettings.company_phone || '';
    const companyEmail = appSettings.company_email || '';
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Invoice ${transaction.invoiceNo}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 20px; margin-bottom: 20px; }
    .company-name { font-size: 24px; font-weight: bold; }
    .company-info { font-size: 12px; color: #666; margin-top: 4px; }
    .invoice-title { font-size: 18px; color: #666; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
    .info-box { padding: 10px; background: #f5f5f5; border-radius: 4px; }
    .info-label { font-size: 12px; color: #666; }
    .info-value { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .total-row { font-weight: bold; font-size: 18px; }
    .total-row td { border-top: 2px solid #000; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; }
    .payment-info { background: #e8f5e9; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    .tempo-alert { background: #fff3e0; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    ${logoHTML}
    <div class="company-name">${escapeHtml(companyName)}</div>
    <div class="company-info">
      ${companyAddress ? escapeHtml(companyAddress) : ''}${companyAddress && companyPhone ? ' | ' : ''}${companyPhone ? 'Tel: ' + escapeHtml(companyPhone) : ''}${(companyAddress || companyPhone) && companyEmail ? ' | ' : ''}${companyEmail ? 'Email: ' + escapeHtml(companyEmail) : ''}
    </div>
    ${receiptHeader ? `<div class="company-info" style="margin-top:4px">${escapeHtml(receiptHeader).replace(/\n/g, '<br/>')}</div>` : ''}
    <div class="invoice-title">INVOICE</div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-label">Nomor Invoice</div>
      <div class="info-value">${escapeHtml(transaction.invoiceNo)}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Tanggal</div>
      <div class="info-value">${formatDate(transaction.transactionDate)}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Customer</div>
      <div class="info-value">${escapeHtml(transaction.customer?.name || 'Walk-in')}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Sales</div>
      <div class="info-value">${escapeHtml(transaction.createdBy?.name || '-')}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Unit</div>
      <div class="info-value">${escapeHtml(transaction.unit?.name || '-')}</div>
    </div>
    <div class="info-box">
      <div class="info-label">Metode Pembayaran</div>
      <div class="info-value">${paymentMethodLabel}</div>
    </div>
  </div>

  ${transaction.paymentMethod === 'tempo' && transaction.dueDate ? `
  <div class="tempo-alert">
    <strong>📅 Jatuh Tempo: ${formatDate(transaction.dueDate)}</strong>
  </div>
  ` : ''}

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Qty</th>
        <th>Harga</th>
        <th>Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${transaction.items?.map((item: TransactionItem) => `
        <tr>
          <td>${item.productName}</td>
          <td>${item.qty} ${item.qtyUnitType === 'main' ? '/box' : '/pcs'}</td>
          <td>${formatCurrency(item.price)}</td>
          <td>${formatCurrency(item.subtotal)}</td>
        </tr>
      `).join('') || ''}
      <tr class="total-row">
        <td colspan="3">TOTAL</td>
        <td>${formatCurrency(transaction.total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="payment-info">
    <div class="info-grid">
      <div>
        <div class="info-label">Sudah Dibayar</div>
        <div class="info-value" style="color: green;">${formatCurrency(transaction.paidAmount)}</div>
      </div>
      <div>
        <div class="info-label">Sisa Pembayaran</div>
        <div class="info-value" style="color: ${transaction.remainingAmount > 0 ? 'red' : 'green'};">${formatCurrency(transaction.remainingAmount)}</div>
      </div>
    </div>
  </div>

  ${transaction.notes ? `<p><strong>Catatan:</strong> ${escapeHtml(transaction.notes)}</p>` : ''}

  <div class="footer">
    <p>${escapeHtml(receiptFooter)}</p>
    <p style="font-size: 12px; color: #666;">Invoice ini dibuat secara otomatis dan sah tanpa tanda tangan.</p>
  </div>
</body>
</html>`;
  }, [transaction, paymentMethodLabel, companyName, showLogo, companyLogo, receiptHeader, receiptFooter]);

  // Print Invoice
  const handlePrintInvoice = useCallback(() => {
    setIsPrinting(true);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }
    printWindow.document.write(generateInvoiceHTML());
    printWindow.document.close();
    printWindow.print();
    setIsPrinting(false);
  }, [generateInvoiceHTML]);

  // Print Receipt for Thermal Printer (57x30mm / 80mm)
  const handlePrintReceipt = useCallback(() => {
    setIsPrinting(true);
    const receiptHTML = generateReceiptHTML(transaction, {
      company_name: companyName,
      receipt_header: receiptHeader,
      receipt_footer: receiptFooter,
      receipt_show_logo: showLogo,
      company_logo: companyLogo,
    }, paperWidth);

    const printWindow = window.open('', '_blank', 'width=400,height=700');
    if (!printWindow) {
      setIsPrinting(false);
      return;
    }
    printWindow.document.write(receiptHTML);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    setIsPrinting(false);
  }, [transaction, companyName, receiptHeader, receiptFooter, showLogo, companyLogo, paperWidth]);

  // Share via Web Share API
  const handleWebShare = useCallback(async () => {
    const receiptText = getReceiptText();
    const shareData = {
      title: `Invoice ${transaction.invoiceNo}`,
      text: receiptText,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        toast.success('Berhasil di-share!');
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          toast.error('Gagal share: ' + err.message);
        }
      }
    } else {
      // Fallback: Copy to clipboard
      try {
        await navigator.clipboard.writeText(receiptText);
        toast.success('Receipt disalin ke clipboard!');
      } catch {
        toast.error('Browser tidak mendukung Web Share');
      }
    }
  }, [getReceiptText, transaction.invoiceNo]);

  // Share via WhatsApp
  const handleWhatsAppShare = useCallback(() => {
    const receiptText = getReceiptText();
    const phone = transaction.customer?.phone || '';
    const message = encodeURIComponent(receiptText);
    const whatsappUrl = phone
      ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${message}`
      : `https://wa.me/?text=${message}`;

    window.open(whatsappUrl, '_blank');
    toast.success('Membuka WhatsApp...');
  }, [getReceiptText, transaction.customer?.phone]);

  // Download PDF Invoice
  const handleDownloadPDF = useCallback(async () => {
    try {
      setIsPrinting(true);
      await downloadInvoicePDF(transaction, {
        company_name: appSettings.company_name,
        company_logo: appSettings.company_logo,
        company_address: appSettings.company_address,
        company_phone: appSettings.company_phone,
        company_email: appSettings.company_email,
      });
      toast.success('PDF berhasil di-download!');
    } catch (err: any) {
      toast.error('Gagal download PDF: ' + err.message);
    } finally {
      setIsPrinting(false);
    }
  }, [transaction, appSettings.company_name, appSettings.company_logo, appSettings.company_address, appSettings.company_phone, appSettings.company_email]);

  // Bluetooth Printer Support
  const handleBluetoothPrint = useCallback(async () => {
    let device: BluetoothDevice | null = null;
    try {
      setIsPrinting(true);
      toast.info('Mencari printer Bluetooth...');

      // Request and connect to BLE printer (tries multiple common UUIDs)
      device = await requestBLEPrinter();
      toast.info(`Menghubungkan ke ${device.name}...`);

      const { characteristic } = await connectBLEPrinter(device);

      // Generate receipt text with settings, wrap with ESC/POS, and write in chunks
      const receiptText = getReceiptText();
      const data = wrapReceiptWithESCPOS(receiptText);
      await writeBLEChunks(characteristic, data);

      toast.success('Receipt berhasil di-print!');

    } catch (err: any) {
      console.error('Bluetooth print error:', err);
      if (err.name === 'NotFoundError') {
        toast.error('Printer tidak ditemukan. Pastikan printer menyala dan Bluetooth aktif.');
      } else if (err.name === 'SecurityError') {
        toast.error('Permission ditolak. Izinkan akses Bluetooth di browser.');
      } else if (err.name === 'NetworkError') {
        toast.error('Koneksi Bluetooth gagal. Coba dekatkan ke printer dan coba lagi.');
      } else {
        toast.error('Gagal print: ' + err.message);
      }
    } finally {
      // Disconnect GATT after printing
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
      setIsPrinting(false);
    }
  }, [getReceiptText]);

  return (
    <div className="flex flex-col h-full">
      {/* Compact Header - sticky top */}
      <div className="flex-shrink-0 flex items-center gap-2.5 px-3 py-2.5 border-b bg-card">
        <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center shrink-0">
          <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold leading-tight">Transaksi Berhasil!</h3>
          <p className="text-xs text-muted-foreground truncate">{transaction.invoiceNo}</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs h-8 px-3 shrink-0" onClick={onClose}>
          Selesai
        </Button>
      </div>

      {/* Scrollable Invoice Content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3 space-y-3">
          {/* Compact Invoice Card */}
          <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
            <CardContent className="p-3 space-y-3">
              {/* Company header */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm leading-tight">{companyName}</h4>
                  <p className="text-[10px] text-muted-foreground">Invoice</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-xs text-muted-foreground">{transaction.invoiceNo}</p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(transaction.transactionDate)}</p>
                </div>
              </div>

              {/* Info row */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-medium">{transaction.customer?.name || 'Walk-in'}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Sales:</span>
                <span className="font-medium">{transaction.createdBy?.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Pembayaran:</span>
                <span className="font-medium">{paymentMethodLabel}</span>
              </div>

              {/* Items - compact list */}
              <div className="border-t pt-2">
                <div className="space-y-1">
                  {transaction.items?.map((item: TransactionItem) => (
                    <div key={item.id} className="flex justify-between items-baseline text-xs gap-2">
                      <span className="text-muted-foreground truncate">
                        {item.productName} <span className="text-[10px]">x{item.qty}{item.qtyUnitType === 'main' ? '/box' : '/pcs'}</span>
                      </span>
                      <span className="font-medium tabular-nums shrink-0">{formatCurrency(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between font-bold text-sm">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(transaction.total)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Bayar</span>
                  <span className="text-green-600 dark:text-green-400 tabular-nums">{formatCurrency(transaction.paidAmount)}</span>
                </div>
                {transaction.remainingAmount > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Sisa</span>
                    <span className="text-red-600 dark:text-red-400 font-medium tabular-nums">{formatCurrency(transaction.remainingAmount)}</span>
                  </div>
                )}
              </div>

              {/* Due date alert */}
              {transaction.paymentMethod === 'tempo' && transaction.dueDate && (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/50 rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Jatuh Tempo: {formatDate(transaction.dueDate)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        {/* Bottom spacing so content isn't hidden behind sticky buttons */}
        <div className="h-2" />
      </div>

      {/* Sticky Action Buttons - always visible at bottom */}
      <div className="flex-shrink-0 border-t bg-card safe-bottom">
        <div className="p-3 space-y-2">
          {/* Primary actions row */}
          <div className="grid grid-cols-3 gap-1.5">
            <Button onClick={handleWhatsAppShare} className="bg-green-600 hover:bg-green-700 h-11 text-[11px] font-semibold gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <Send className="w-3.5 h-3.5" />
              <span className="truncate">WhatsApp</span>
            </Button>
            <Button onClick={handleDownloadPDF} variant="outline" className="h-11 text-[11px] font-semibold gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <FileDown className="w-3.5 h-3.5" />
              <span className="truncate">PDF</span>
            </Button>
            <Button onClick={handlePrintInvoice} variant="outline" className="h-11 text-[11px] font-semibold gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <FileText className="w-3.5 h-3.5" />
              <span className="truncate">Invoice</span>
            </Button>
          </div>
          {/* Secondary actions row */}
          <div className="grid grid-cols-3 gap-1.5">
            <Button onClick={handlePrintReceipt} variant="outline" className="h-10 text-[11px] font-medium gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span className="truncate">Receipt</span>
            </Button>
            <Button onClick={handleWebShare} variant="outline" className="h-10 text-[11px] font-medium gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <Share2 className="w-3.5 h-3.5" />
              <span className="truncate">Share</span>
            </Button>
            <Button onClick={handleBluetoothPrint} variant="outline" className="h-10 text-[11px] font-medium gap-1.5 rounded-xl px-2" disabled={isPrinting}>
              <RefreshCw className={cn("w-3.5 h-3.5", isPrinting && "animate-spin")} />
              <span className="truncate">Bluetooth</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

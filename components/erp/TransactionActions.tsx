'use client';

import React, { useState, useCallback } from 'react';
import {
  Printer,
  FileDown,
  Share2,
  Bluetooth,
  Eye,
  Check,
  X,
  MoreVertical,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';
import type { Transaction } from '@/types';
import {
  downloadInvoicePDF,
  getInvoicePDFBlob,
  generateReceiptText,
  generateReceiptHTML,
  wrapReceiptWithESCPOS,
  writeBLEChunks,
  requestBLEPrinter,
  connectBLEPrinter,
} from '@/lib/generate-invoice-pdf';

// Check if transaction is a PWA order (needs price setting before approve)
function isPwaOrder(t: Transaction): boolean {
  return (t.notes || '').includes('Order dari PWA');
}

interface TransactionActionsProps {
  transaction: Transaction;
  onView: () => void;
  canApprove: boolean;
  canCancel: boolean;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onSetPwaPrice?: () => void;
}

export function TransactionActions({
  transaction,
  onView,
  canApprove,
  canCancel,
  onApprove,
  onCancel,
  onSetPwaPrice,
}: TransactionActionsProps) {
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Record<string, any> }>('/api/settings')
  });
  const appSettings = settingsData?.settings || {};
  const printerType = appSettings.printer_type || 'browser';
  const paperWidth = printerType === 'bluetooth_80' ? 80 : 57;

  const canBeCancelled = canCancel && transaction.status !== 'cancelled';

  // Shared receipt text generator using settings
  const getReceiptText = useCallback(() => {
    return generateReceiptText(transaction, {
      company_name: appSettings.company_name,
      receipt_header: appSettings.receipt_header,
      receipt_footer: appSettings.receipt_footer,
      receipt_show_logo: appSettings.receipt_show_logo,
      company_logo: appSettings.company_logo,
    }, paperWidth);
  }, [transaction, appSettings.company_name, appSettings.receipt_header, appSettings.receipt_footer, appSettings.receipt_show_logo, appSettings.company_logo, paperWidth]);

  // ---- Download PDF ----
  const handleDownloadPDF = useCallback(async () => {
    try {
      setIsDownloading(true);
      await downloadInvoicePDF(transaction, {
        company_name: appSettings.company_name,
        company_logo: appSettings.company_logo,
        company_address: appSettings.company_address,
        company_phone: appSettings.company_phone,
        company_email: appSettings.company_email,
      });
      toast.success('PDF berhasil di-download!');
    } catch (err: any) {
      console.error('Download PDF error:', err);
      toast.error('Gagal download PDF: ' + err.message);
    } finally {
      setIsDownloading(false);
    }
  }, [transaction, appSettings.company_name, appSettings.company_logo, appSettings.company_address, appSettings.company_phone, appSettings.company_email]);

  // ---- Print Bluetooth ----
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

      toast.success('Receipt berhasil di-print via Bluetooth!');
    } catch (err: any) {
      console.error('Bluetooth print error:', err);
      if (err.name === 'NotFoundError') {
        toast.error('Printer tidak ditemukan. Pastikan printer menyala dan Bluetooth aktif.');
      } else if (err.name === 'SecurityError') {
        toast.error('Permission ditolak. Izinkan akses Bluetooth di browser.');
      } else if (err.name === 'NetworkError') {
        toast.error('Koneksi Bluetooth gagal. Coba dekatkan ke printer dan coba lagi.');
      } else {
        toast.error('Gagal print Bluetooth: ' + err.message);
      }
    } finally {
      // Disconnect GATT after printing
      if (device?.gatt?.connected) {
        device.gatt.disconnect();
      }
      setIsPrinting(false);
    }
  }, [getReceiptText]);

  // ---- Print Thermal (Browser Print) ----
  const handleThermalPrint = useCallback(() => {
    setIsPrinting(true);
    const receiptHTML = generateReceiptHTML(transaction, {
      company_name: appSettings.company_name,
      receipt_header: appSettings.receipt_header,
      receipt_footer: appSettings.receipt_footer,
      receipt_show_logo: appSettings.receipt_show_logo,
      company_logo: appSettings.company_logo,
    }, paperWidth);

    const printWindow = window.open('', '_blank', 'width=400,height=700');
    if (printWindow) {
      printWindow.document.write(receiptHTML);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
    setIsPrinting(false);
  }, [transaction, appSettings.company_name, appSettings.receipt_header, appSettings.receipt_footer, appSettings.receipt_show_logo, appSettings.company_logo, paperWidth]);

  // ---- Share PDF ----
  const handleSharePDF = useCallback(async () => {
    try {
      setIsSharing(true);

      const blob = await getInvoicePDFBlob(transaction, {
        company_name: appSettings.company_name,
        company_logo: appSettings.company_logo,
        company_address: appSettings.company_address,
        company_phone: appSettings.company_phone,
        company_email: appSettings.company_email,
      });
      const file = new File(
        [blob],
        `Invoice_${transaction.invoiceNo}.pdf`,
        { type: 'application/pdf' }
      );

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: `Invoice ${transaction.invoiceNo}`,
          text: `Invoice ${transaction.invoiceNo} - ${transaction.customer?.name || 'Walk-in'} - Total: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(transaction.total)}`,
          files: [file],
        });
        toast.success('PDF berhasil di-share!');
      } else {
        // Fallback: download the PDF
        downloadInvoicePDF(transaction, {
          company_name: appSettings.company_name,
          company_logo: appSettings.company_logo,
          company_address: appSettings.company_address,
          company_phone: appSettings.company_phone,
          company_email: appSettings.company_email,
        });
        toast.success('PDF didownload (browser tidak mendukung share file).');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Share PDF error:', err);
        toast.error('Gagal share PDF: ' + err.message);
      }
    } finally {
      setIsSharing(false);
    }
  }, [transaction, appSettings.company_name, appSettings.company_logo, appSettings.company_address, appSettings.company_phone, appSettings.company_email]);

  // ---- Cancel Transaction ----
  const handleConfirmCancel = useCallback(() => {
    setShowCancelDialog(false);
    onCancel(transaction.id);
  }, [onCancel, transaction.id]);

  const isBusy = isPrinting || isDownloading || isSharing;

  return (
    <>
      <div className="flex justify-end items-center gap-1">
        {/* View Detail Button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onView}
          title="Lihat Detail"
        >
          <Eye className="w-4 h-4" />
        </Button>

        {/* PWA Order: Set Harga button (replaces regular approve) */}
        {canApprove && transaction.status === 'pending' && isPwaOrder(transaction) && (
          <Button
            variant="ghost"
            size="icon"
            className="text-orange-500 hover:text-orange-600"
            onClick={onSetPwaPrice}
            title="Set Harga & Approve"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pencil-line"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/><path d="m15 5 3 3"/></svg>
          </Button>
        )}
        {/* Approve button for super_admin on pending NON-PWA transactions */}
        {canApprove && transaction.status === 'pending' && !isPwaOrder(transaction) && (
          <Button
            variant="ghost"
            size="icon"
            className="text-green-500 hover:text-green-600"
            onClick={() => onApprove(transaction.id)}
            title="Setujui"
          >
            <Check className="w-4 h-4" />
          </Button>
        )}

        {/* Cancel button for super_admin on pending transactions (quick action) */}
        {canBeCancelled && transaction.status === 'pending' && (
          <Button
            variant="ghost"
            size="icon"
            className="text-red-500 hover:text-red-600"
            onClick={() => setShowCancelDialog(true)}
            title="Batalkan Transaksi"
          >
            <X className="w-4 h-4" />
          </Button>
        )}

        {/* More Actions Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={isBusy} title="More Actions">
              {isBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MoreVertical className="w-4 h-4" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {/* Download PDF */}
            <DropdownMenuItem onClick={handleDownloadPDF} disabled={isDownloading}>
              <FileDown className="w-4 h-4 mr-2" />
              {isDownloading ? 'Generating...' : 'Download PDF'}
            </DropdownMenuItem>

            {/* Print Bluetooth */}
            <DropdownMenuItem onClick={handleBluetoothPrint} disabled={isPrinting}>
              <Bluetooth className="w-4 h-4 mr-2" />
              {isPrinting ? 'Menghubungkan...' : 'Print Bluetooth'}
            </DropdownMenuItem>

            {/* Print Thermal (Browser) */}
            <DropdownMenuItem onClick={handleThermalPrint} disabled={isPrinting}>
              <Printer className="w-4 h-4 mr-2" />
              Print Thermal
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Share PDF */}
            <DropdownMenuItem onClick={handleSharePDF} disabled={isSharing}>
              <Share2 className="w-4 h-4 mr-2" />
              {isSharing ? 'Sharing...' : 'Share PDF'}
            </DropdownMenuItem>

            {/* Cancel/Delete Transaction (super_admin only, for approved/paid transactions) */}
            {canBeCancelled && transaction.status !== 'pending' && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600 focus:bg-red-50"
                  onClick={() => setShowCancelDialog(true)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Hapus Transaksi
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {transaction.status === 'pending' ? 'Batalkan Transaksi?' : 'Hapus Transaksi?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {transaction.status === 'pending'
                    ? 'Apakah Anda yakin ingin membatalkan transaksi ini?'
                    : 'Apakah Anda yakin ingin menghapus transaksi ini? Stok barang akan dikembalikan.'
                  }
                </p>
                <div className="bg-muted rounded-md p-3 space-y-1 text-sm">
                  <p className="font-medium">{transaction.invoiceNo}</p>
                  <p>{transaction.customer?.name || 'Walk-in Customer'}</p>
                  <p className="font-semibold">{formatCurrency(transaction.total)}</p>
                  <p>Status: {transaction.status}</p>
                </div>
                <p className="text-red-600 font-medium">
                  Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Ya, {transaction.status === 'pending' ? 'Batalkan' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

'use client';

import { useState, useEffect } from 'react';
import {
  Printer,
  Usb,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { usbPrinterManager } from '@/lib/usb-printer';
import type { PrinterStatus as USBPrinterStatus } from '@/lib/usb-printer';
import { generateReceiptText } from '@/lib/generate-invoice-pdf';
import type { Transaction } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PrintMode = 'none' | 'server' | 'web-serial';

interface ServerPrinterInfo {
  connected: boolean;
  device: string | null;
  devices: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSerialSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'serial' in navigator;
}

// ---------------------------------------------------------------------------
// Server-side print helper
// ---------------------------------------------------------------------------

async function serverPrintReceipt(text: string): Promise<void> {
  const res = await fetch('/api/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'receipt', text }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Gagal mencetak via server');
  }
}

async function checkServerPrinter(): Promise<ServerPrinterInfo | null> {
  try {
    const res = await fetch('/api/print', { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.stbMode && data.printer) {
      return data.printer as ServerPrinterInfo;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PrintStation() {
  // ---- Mode detection ----
  const [printMode, setPrintMode] = useState<PrintMode>('none');
  const [modeDetecting, setModeDetecting] = useState(true);

  // ---- Server printer state ----
  const [serverPrinter, setServerPrinter] = useState<ServerPrinterInfo | null>(null);
  const [serverPrinterChecking, setServerPrinterChecking] = useState(false);

  // ---- Web Serial printer state ----
  const [printerStatus, setPrinterStatus] = useState<USBPrinterStatus>('disconnected');
  const [portVendorId, setPortVendorId] = useState<number | undefined>();
  const [portProductId, setPortProductId] = useState<number | undefined>();
  const [lastError, setLastError] = useState<string | null>(null);

  // ---- UI loading states ----
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [isTestPrinting, setIsTestPrinting] = useState(false);

  // Derived states
  const isConnected = printMode === 'server'
    ? !!serverPrinter?.connected
    : printerStatus === 'connected';

  // ========================================================================
  // 1. Detect print mode on mount
  // ========================================================================

  useEffect(() => {
    const detectMode = async () => {
      setModeDetecting(true);

      // First, check if server-side printer is available (STB mode)
      const serverInfo = await checkServerPrinter();
      if (serverInfo) {
        setServerPrinter(serverInfo);
        setPrintMode('server');
        setModeDetecting(false);
        return;
      }

      // Fallback: check if Web Serial API is supported
      if (isSerialSupported()) {
        setPrintMode('web-serial');
        setModeDetecting(false);
        return;
      }

      // No print method available
      setPrintMode('none');
      setModeDetecting(false);
    };

    detectMode();
  }, []);

  // ========================================================================
  // 2. Subscribe to USB printer status changes (Web Serial mode only)
  // ========================================================================

  useEffect(() => {
    if (printMode !== 'web-serial') return;

    const unsubscribe = usbPrinterManager.onStatusChange((change) => {
      setPrinterStatus(change.status);
      setPortVendorId(change.portInfo?.usbVendorId);
      setPortProductId(change.portInfo?.usbProductId);
      if (change.error) {
        setLastError(change.error);
      } else {
        setLastError(null);
      }
    });

    // Sync initial state
    const state = usbPrinterManager.getStatus();
    setPrinterStatus(state.status);
    setPortVendorId(state.portInfo?.usbVendorId);
    setPortProductId(state.portInfo?.usbProductId);
    if (state.lastError) setLastError(state.lastError);

    return () => {
      unsubscribe();
    };
  }, [printMode]);

  // ========================================================================
  // Actions — Server Mode
  // ========================================================================

  const handleRefreshServerPrinter = async () => {
    setServerPrinterChecking(true);
    try {
      const info = await checkServerPrinter();
      setServerPrinter(info);
      if (info?.connected) {
        toast.success(`Printer terdeteksi: ${info.device}`);
      } else {
        toast.info('Tidak ada printer USB yang terdeteksi di server.');
      }
    } catch {
      toast.error('Gagal mengecek printer server');
    } finally {
      setServerPrinterChecking(false);
    }
  };

  // ========================================================================
  // Actions — Web Serial Mode
  // ========================================================================

  const handleAutoDetect = async () => {
    if (!isSerialSupported()) {
      toast.error('Web Serial API tidak didukung di browser ini.');
      return;
    }

    setIsAutoDetecting(true);
    try {
      const ports = await usbPrinterManager.autoDetect();
      if (ports.length > 0) {
        toast.success(`Ditemukan ${ports.length} printer USB yang tersimpan. Menghubungkan...`);
        await usbPrinterManager.connect(ports[0]);
      } else {
        toast.info('Tidak ditemukan printer USB yang tersimpan. Gunakan tombol "Hubungkan USB".');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Auto-detect gagal: ${message}`);
    } finally {
      setIsAutoDetecting(false);
    }
  };

  const handleConnect = async () => {
    if (!isSerialSupported()) {
      toast.error('Web Serial API tidak didukung di browser ini.');
      return;
    }

    setIsConnecting(true);
    try {
      await usbPrinterManager.requestPrinter();
      await usbPrinterManager.connect();
      toast.success('Printer berhasil terhubung!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('No port available') || message.includes('requestPort')) {
        toast.error('Pilih printer dibatalkan atau tidak ada port.');
      } else {
        toast.error(`Gagal menghubungkan printer: ${message}`);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await usbPrinterManager.disconnect();
      toast.info('Printer terputus.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Gagal memutuskan printer: ${message}`);
    }
  };

  // ========================================================================
  // Test Print (works for both modes)
  // ========================================================================

  const handleTestPrint = async () => {
    if (!isConnected) {
      toast.warning('Printer belum terhubung.');
      return;
    }

    setIsTestPrinting(true);
    try {
      // Create a minimal test transaction
      const now = new Date();
      const testTx: Transaction = {
        id: 'test-' + Date.now(),
        type: 'sale',
        invoiceNo: 'TEST-' + now.toISOString().slice(0, 10),
        unitId: '',
        createdById: '',
        total: 150000,
        paidAmount: 150000,
        remainingAmount: 0,
        totalHpp: 0,
        totalProfit: 0,
        hppPaid: 0,
        profitPaid: 0,
        hppUnpaid: 0,
        profitUnpaid: 0,
        paymentMethod: 'cash',
        status: 'approved',
        paymentStatus: 'paid',
        transactionDate: now,
        createdAt: now,
        updatedAt: now,
        createdBy: {
          id: 'system',
          name: 'Admin',
          role: 'super_admin',
        } as any,
        customer: undefined as any,
        items: [
          {
            id: 'test-item-1',
            transactionId: 'test',
            productId: '',
            productName: 'Test Product A',
            qty: 2,
            qtyInSubUnit: 2,
            qtyUnitType: 'main',
            price: 50000,
            hpp: 30000,
            subtotal: 100000,
            profit: 20000,
          },
          {
            id: 'test-item-2',
            transactionId: 'test',
            productId: '',
            productName: 'Test Product B',
            qty: 1,
            qtyInSubUnit: 1,
            qtyUnitType: 'main',
            price: 50000,
            hpp: 30000,
            subtotal: 50000,
            profit: 20000,
          },
        ],
        courierCommission: 0,
      };

      const receiptText = generateReceiptText(testTx, undefined, 57);

      if (printMode === 'server') {
        await serverPrintReceipt(receiptText);
      } else {
        await usbPrinterManager.printReceipt(receiptText);
      }

      toast.success('Test print berhasil dikirim!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Test print gagal: ${message}`);
    } finally {
      setIsTestPrinting(false);
    }
  };

  // ========================================================================
  // Render helpers
  // ========================================================================

  const statusDot = () => {
    if (printMode === 'server') {
      if (serverPrinter?.connected) return 'bg-green-500';
      return 'bg-gray-400';
    }
    switch (printerStatus) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500 animate-pulse';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-400';
    }
  };

  const statusLabel = () => {
    if (printMode === 'server') {
      return serverPrinter?.connected ? 'Terhubung (Server)' : 'Tidak Terhubung';
    }
    switch (printerStatus) {
      case 'connected': return 'Terhubung';
      case 'connecting': return 'Menghubungkan...';
      case 'error': return 'Error';
      default: return 'Tidak Terhubung';
    }
  };

  const statusColorClass = () => {
    if (printMode === 'server') {
      return serverPrinter?.connected
        ? 'text-green-600 bg-green-50 border-green-200'
        : 'text-gray-500 bg-gray-50 border-gray-200';
    }
    switch (printerStatus) {
      case 'connected': return 'text-green-600 bg-green-50 border-green-200';
      case 'connecting': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'error': return 'text-red-600 bg-red-50 border-red-200';
      default: return 'text-gray-500 bg-gray-50 border-gray-200';
    }
  };

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className="space-y-6">
      {/* ================================================================
          SECTION 1: Printer Connection
          ================================================================ */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Printer className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Koneksi Printer USB</CardTitle>
                <CardDescription>
                  {printMode === 'server'
                    ? 'Printer terhubung langsung ke server (STB)'
                    : printMode === 'web-serial'
                    ? 'Hubungkan printer thermal 57mm via Web Serial API'
                    : 'Mendeteksi metode koneksi printer...'}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {modeDetecting ? (
                <Badge variant="outline" className="text-gray-500 bg-gray-50 border-gray-200">
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                  Mendeteksi...
                </Badge>
              ) : (
                <>
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot()}`}
                  />
                  <Badge
                    variant="outline"
                    className={statusColorClass()}
                  >
                    {statusLabel()}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ---- SERVER MODE ---- */}
          {printMode === 'server' && (
            <>
              {serverPrinter?.connected ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                    <Server className="h-4 w-4" />
                    Printer Server Terhubung
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-green-700">Mode:</span>{' '}
                      <span className="font-mono font-medium text-green-900">STB (Server)</span>
                    </div>
                    <div>
                      <span className="text-green-700">Device:</span>{' '}
                      <span className="font-mono font-medium text-green-900">
                        {serverPrinter.device}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-800">
                    <AlertTriangle className="h-4 w-4" />
                    Printer USB Tidak Terdeteksi
                  </div>
                  <p className="mt-1 text-sm text-yellow-700">
                    Pastikan printer thermal USB sudah terhubung ke STB. Coba klik &quot;Refresh&quot; untuk mendeteksi ulang.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshServerPrinter}
                  disabled={serverPrinterChecking}
                >
                  <RefreshCw
                    className={`mr-2 h-4 w-4 ${serverPrinterChecking ? 'animate-spin' : ''}`}
                  />
                  {serverPrinterChecking ? 'Mendeteksi...' : 'Refresh'}
                </Button>
              </div>
            </>
          )}

          {/* ---- WEB SERIAL MODE ---- */}
          {printMode === 'web-serial' && (
            <>
              {/* Port info when connected */}
              {printerStatus === 'connected' && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Printer Terhubung
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-green-700">Vendor ID:</span>{' '}
                      <span className="font-mono font-medium text-green-900">
                        0x{(portVendorId ?? 0).toString(16).toUpperCase().padStart(4, '0')}
                      </span>
                    </div>
                    <div>
                      <span className="text-green-700">Product ID:</span>{' '}
                      <span className="font-mono font-medium text-green-900">
                        0x{(portProductId ?? 0).toString(16).toUpperCase().padStart(4, '0')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error display */}
              {lastError && printerStatus === 'error' && (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Printer Error</p>
                    <p className="mt-1 text-sm text-red-600">{lastError}</p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                {printerStatus === 'connected' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Putuskan
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAutoDetect}
                      disabled={isAutoDetecting}
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${isAutoDetecting ? 'animate-spin' : ''}`}
                      />
                      {isAutoDetecting ? 'Mendeteksi...' : 'Auto-Deteksi USB'}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleConnect}
                      disabled={isConnecting}
                    >
                      <Usb className="mr-2 h-4 w-4" />
                      {isConnecting ? 'Menghubungkan...' : 'Hubungkan USB Printer'}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          {/* ---- NO MODE AVAILABLE ---- */}
          {printMode === 'none' && !modeDetecting && (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-800">
                  Tidak Ada Metode Cetak yang Tersedia
                </p>
                <p className="text-sm text-red-600">
                  Browser Anda tidak mendukung Web Serial API, dan tidak ada printer server yang terdeteksi.
                </p>
                <div className="rounded-md bg-red-100 p-3 text-xs text-red-700 space-y-1">
                  <p className="font-medium">Solusi:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>
                      <strong>Mode STB:</strong> Jalankan ERP di STB dengan printer USB terhubung langsung ke perangkat.
                    </li>
                    <li>
                      <strong>Mode Browser:</strong> Gunakan Google Chrome 89+ atau Microsoft Edge 89+ di desktop.
                    </li>
                  </ul>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setModeDetecting(true);
                    const info = await checkServerPrinter();
                    if (info) {
                      setServerPrinter(info);
                      setPrintMode('server');
                    } else if (isSerialSupported()) {
                      setPrintMode('web-serial');
                    }
                    setModeDetecting(false);
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Coba Deteksi Ulang
                </Button>
              </div>
            </div>
          )}

          <Separator orientation="vertical" className="mx-1 h-auto hidden sm:block" />

          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestPrint}
            disabled={!isConnected || isTestPrinting}
          >
            <Printer className={`mr-2 h-4 w-4 ${isTestPrinting ? 'animate-pulse' : ''}`} />
            {isTestPrinting ? 'Mencetak...' : 'Test Print'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

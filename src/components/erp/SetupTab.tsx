'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Rocket,
  Database,
  Radio,
  HardDrive,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api-client';

interface SetupItem {
  label: string;
  description: string;
  ok: boolean;
  message: string;
  action?: string;
  actionEndpoint?: string;
  actionLabel?: string;
  warning?: string;
}

interface SetupStatus {
  schema: { ok: boolean; message: string };
  realtime: { ok: boolean; message: string };
  storage: { ok: boolean; message: string };
  tripay: { ok: boolean; mode: string | null; message: string };
  imageMigration: { totalBase64: number; totalBase64SizeMB: string; message: string };
}

export default function SetupTab() {
  const queryClient = useQueryClient();
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [migrateConfirm, setMigrateConfirm] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<SetupStatus>('/api/setup/status');
      setSetupStatus(data);
    } catch {
      toast.error('Gagal mengambil status setup');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleAction = async (endpoint: string, label: string) => {
    setLoading(label);
    try {
      const result = await apiFetch<{ success: boolean; message?: string; error?: string }>(endpoint, {
        method: 'POST',
      });
      if (result.success !== false) {
        toast.success(result.message || `${label} berhasil`);
        await fetchStatus();
        queryClient.invalidateQueries({ queryKey: ['settings'] });
      } else {
        const errMsg = result.error || result.message || `Gagal: ${label}`;
        toast.error(errMsg, {
          description: result.detail ? result.detail.substring(0, 200) : result.hint || undefined,
          duration: 8000,
        });
      }
    } catch (err: any) {
      toast.error(err.message || `Gagal: ${label}`);
    } finally {
      setLoading(null);
    }
  };

  const handleMigrateImages = async () => {
    setMigrateConfirm(false);
    setLoading('migrate');
    try {
      const result = await apiFetch<{ success: boolean; message?: string; error?: string; migrated?: number; failed?: number }>(
        '/api/products/migrate-images',
        { method: 'POST' }
      );
      if (result.success) {
        toast.success(result.message || 'Migrasi berhasil');
        await fetchStatus();
      } else {
        toast.error(result.error || 'Migrasi gagal');
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal migrasi gambar');
    } finally {
      setLoading(null);
    }
  };

  if (!setupStatus) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalChecks = 4;
  const passedChecks = [
    setupStatus.schema.ok,
    setupStatus.realtime.ok,
    setupStatus.storage.ok,
    setupStatus.tripay.ok,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="w-4 h-4" />
            Setup & Konfigurasi Sistem
          </CardTitle>
          <CardDescription>
            Status setup fitur-fitur lanjutan. Jalankan setup untuk mengaktifkan fitur baru.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="text-2xl font-bold">{passedChecks}/{totalChecks}</div>
            <div className="flex-1">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${(passedChecks / totalChecks) * 100}%` }}
                />
              </div>
            </div>
            <Badge variant={passedChecks === totalChecks ? 'default' : 'outline'}>
              {passedChecks === totalChecks ? 'Semua Siap' : `${totalChecks - passedChecks} lagi`}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Setup Items */}
      <div className="space-y-3">
        {/* 1. Schema */}
        <SetupItemCard
          icon={<Database className="w-4 h-4" />}
          label="Database Schema"
          description="Tabel qris_payments"
          ok={setupStatus.schema.ok}
          message={setupStatus.schema.message}
          actionEndpoint="/api/setup/db-push"
          actionLabel="Push Schema"
          loading={loading === 'schema'}
          onAction={() => handleAction('/api/setup/db-push', 'Push Schema')}
        />

        {/* 2. Realtime */}
        <SetupItemCard
          icon={<Radio className="w-4 h-4" />}
          label="Supabase Realtime"
          description="Update data real-time di semua perangkat"
          ok={setupStatus.realtime.ok}
          message={setupStatus.realtime.message}
          actionEndpoint="/api/setup/enable-realtime"
          actionLabel="Aktifkan Realtime"
          loading={loading === 'realtime'}
          onAction={() => handleAction('/api/setup/enable-realtime', 'Aktifkan Realtime')}
        />

        {/* 3. Storage */}
        <SetupItemCard
          icon={<HardDrive className="w-4 h-4" />}
          label="Storage Bucket"
          description="Penyimpanan gambar produk (Supabase Storage)"
          ok={setupStatus.storage.ok}
          message={setupStatus.storage.message}
          actionEndpoint="/api/setup/create-storage-bucket"
          actionLabel="Buat Bucket"
          loading={loading === 'storage'}
          onAction={() => handleAction('/api/setup/create-storage-bucket', 'Buat Bucket')}
        />

        {/* 4. Tripay / QRIS */}
        <SetupItemCard
          icon={
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
              <path d="M3 3h18v18H3V3zm2 2v14h14V5H5zm2 2h10v2H7V7zm0 4h7v2H7v-2z" />
            </svg>
          }
          label="QRIS Payment (Tripay)"
          description={`Pembayaran QRIS — ${setupStatus.tripay.mode === 'production' ? 'Production' : setupStatus.tripay.mode || 'Belum dikonfigurasi'}`}
          ok={setupStatus.tripay.ok}
          message={setupStatus.tripay.message}
          actionEndpoint={undefined}
          actionLabel="Buka Tab Integrasi"
          loading={false}
          onAction={() => {
            // Navigate to integrasi tab - find the parent tabs and switch
            const event = new CustomEvent('switch-settings-tab', { detail: 'integrasi' });
            window.dispatchEvent(event);
            toast.info('Buka tab Integrasi untuk mengatur Tripay');
          }}
          isInfo
        />
      </div>

      {/* Image Migration */}
      {setupStatus.imageMigration.totalBase64 > 0 && (
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <ImageIcon className="w-4 h-4" />
              Migrasi Gambar Produk
              <Badge variant="outline" className="text-amber-600">
                {setupStatus.imageMigration.totalBase64} gambar
              </Badge>
            </CardTitle>
            <CardDescription>
              Ditemukan {setupStatus.imageMigration.totalBase64} gambar base64 ({setupStatus.imageMigration.totalBase64SizeMB} MB).
              Migrasi ke Supabase Storage CDN untuk performa lebih baik.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const result = await apiFetch('/api/products/migrate-images?dryRun=true');
                    toast.info(`Dry run: ${result.totalBase64} gambar, ${result.totalBase64SizeMB} MB`);
                  } catch {
                    toast.error('Gagal mengecek gambar');
                  }
                }}
                className="w-full sm:w-auto"
              >
                <Eye className="w-3 h-3 mr-1" /> Dry Run
              </Button>
              <Button
                size="sm"
                onClick={() => setMigrateConfirm(true)}
                disabled={loading === 'migrate' || !setupStatus.storage.ok}
                className="w-full sm:w-auto"
              >
                {loading === 'migrate' ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Rocket className="w-3 h-3 mr-1" />
                )}
                Migrasi Sekarang
              </Button>
            </div>
            {!setupStatus.storage.ok && (
              <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Buat Storage Bucket terlebih dahulu sebelum migrasi
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={fetchStatus} disabled={loading !== null}>
          <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </Button>
      </div>

      {/* Migrate Confirm Dialog */}
      <Dialog open={migrateConfirm} onOpenChange={setMigrateConfirm}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>Migrasi Gambar Produk?</DialogTitle>
            <DialogDescription>
              {setupStatus.imageMigration.totalBase64} gambar base64 akan diupload ke Supabase Storage CDN.
              URL gambar di database akan otomatis diupdate. Proses ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setMigrateConfirm(false)} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button onClick={handleMigrateImages} className="w-full sm:w-auto">
              Ya, Migrasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Reusable setup item card
import { Label } from '@/components/ui/label';

function SetupItemCard({
  icon,
  label,
  description,
  ok,
  message,
  actionLabel,
  loading,
  onAction,
  isInfo,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  ok: boolean;
  message: string;
  actionLabel?: string;
  loading?: boolean;
  onAction?: () => void;
  isInfo?: boolean;
}) {
  return (
    <Card className={!ok ? 'border-dashed' : ''}>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`mt-0.5 shrink-0 ${ok ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-sm">{label}</p>
                {ok ? (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-200 text-xs">OK</Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600 border-amber-200 text-xs">Perlu Setup</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">{message}</p>
            </div>
          </div>
          {actionLabel && onAction && (
            <Button
              variant={isInfo ? 'outline' : 'default'}
              size="sm"
              onClick={onAction}
              disabled={loading}
              className="w-full sm:w-auto shrink-0"
            >
              {loading ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : isInfo ? (
                <ExternalLink className="w-3 h-3 mr-1" />
              ) : null}
              {actionLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

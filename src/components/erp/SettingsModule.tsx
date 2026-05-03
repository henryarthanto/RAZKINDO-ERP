'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  Settings,
  Building2,
  Printer,
  MessageSquare,
  HardDrive,
  Database,
  Plus,
  Trash2,
  Edit,
  X,
  Upload,
 Image as ImageIcon,
  Monitor,
  Wifi,
  WifiOff,
  Bluetooth,
  AlertTriangle,
 FileText,
 MapPin,
  Phone,
  Download,
  UploadCloud,
 RefreshCw,
 ShieldCheck,
 Activity,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LoadingFallback } from '@/components/error-boundary';
import WhatsAppSettingsTab from './WhatsAppSettingsTab';
import StorageTab from './StorageTab';
import { apiFetch } from '@/lib/api-client';
import { requestBLEPrinter, connectBLEPrinter, wrapReceiptWithESCPOS, writeBLEChunks } from '@/lib/generate-invoice-pdf';
import type { Unit } from '@/types';

export default function SettingsModule() {
  const { user, token } = useAuthStore();
  const queryClient = useQueryClient();
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  
  // Settings data
  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Record<string, any> }>('/api/settings')
  });
  
  const settings: Record<string, any> = settingsData?.settings || {};
  
  const updateSetting = async (key: string, value: any) => {
    try {
      await apiFetch(`/api/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value })
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to save setting ${key}:`, msg);
      return false;
    }
  };
  
  // Unit state
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [unitForm, setUnitForm] = useState({ name: '', address: '', phone: '' });
  const [unitLoading, setUnitLoading] = useState(false);
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  
  // General state
  const [companyName, setCompanyName] = useState('');
  const [companyLogo, setCompanyLogo] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [loginWarning, setLoginWarning] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState('');
  
  // Printer state
  const [printerType, setPrinterType] = useState('browser');
  const [connectedPrinter, setConnectedPrinter] = useState<{ name: string; id: string } | null>(null);
  const [receiptHeader, setReceiptHeader] = useState('');
  const [receiptFooter, setReceiptFooter] = useState('');
  const [showLogoOnReceipt, setShowLogoOnReceipt] = useState(false);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [printerConnecting, setPrinterConnecting] = useState(false);
  
  // Sync settings to local state
  useEffect(() => {
    if (settingsData?.settings) {
      setCompanyName(settings.company_name || 'RAZKINDO GROUP');
      setCompanyLogo(settings.company_logo || '');
      setPrinterType(settings.printer_type || 'browser');
      setConnectedPrinter(settings.printer_device ? { name: settings.printer_device.name, id: settings.printer_device.id } : null);
      setReceiptHeader(settings.receipt_header || '');
      setReceiptFooter(settings.receipt_footer || 'Terima Kasih Atas Kunjungan Anda!');
      setShowLogoOnReceipt(settings.receipt_show_logo || false);
      setLoginWarning(settings.login_warning || '');
    }
  }, [settingsData]);
  
  // Save General settings (logo is saved immediately on upload, not here)
  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    try {
      // Save each setting individually to detect which one fails
      const companyNameOk = await updateSetting('company_name', companyName);
      const loginWarningOk = await updateSetting('login_warning', loginWarning);

      const allOk = companyNameOk && loginWarningOk;

      // Optimistic update: immediately update cache
      queryClient.setQueryData(['settings'], (prev: any) => ({
        ...(prev || {}),
        settings: {
          ...(prev?.settings || {}),
          company_name: companyName,
          login_warning: loginWarning,
        },
      }));
      // Also update public settings cache (for login page)
      queryClient.setQueryData(['settings-public'], (prev: any) => ({
        ...(prev || {}),
        settings: {
          ...(prev?.settings || {}),
          company_name: companyName,
          login_warning: loginWarning,
        },
      }));
      // Background refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['settings-public'] });

      if (allOk) {
        toast.success('Pengaturan umum berhasil disimpan');
      } else {
        const failed: string[] = [];
        if (!companyNameOk) failed.push('Nama Perusahaan');
        if (!loginWarningOk) failed.push('Peringatan Login');
        toast.error(`Gagal menyimpan: ${failed.join(', ')}. Coba lagi.`);
      }
    } catch (err) {
      toast.error('Gagal menyimpan pengaturan. Coba lagi.');
    }
    setSavingGeneral(false);
  };
  
  // Compress image before upload to avoid exceeding Supabase payload limits
  const compressLogoImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Resize to max 256x256 for logo display
        const MAX_SIZE = 256;
        let { width, height } = img;
        if (width > MAX_SIZE || height > MAX_SIZE) {
          const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context failed')); return; }
        // White background for transparent PNGs
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        // Export as JPEG with 0.8 quality for smaller size (~50-100KB)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        URL.revokeObjectURL(img.src);
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Gagal memuat gambar')); };
      img.src = URL.createObjectURL(file);
    });
  };

  // Logo upload handler — saves to DB immediately
  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Ukuran logo maksimal 5MB');
      return;
    }
    setLogoError('');
    setLogoSaving(true);
    try {
      toast.info('Memproses logo...');
      const compressed = await compressLogoImage(file);

      // Save to DB immediately via dedicated endpoint
      const { apiFetch } = await import('@/lib/api-client');
      const result = await apiFetch<{ success: boolean; size?: number; error?: string }>('/api/settings/logo', {
        method: 'POST',
        body: JSON.stringify({ logo: compressed }),
      });

      if (result.success) {
        setCompanyLogo(compressed);
        // Optimistic update — immediately update all settings caches
        queryClient.setQueryData(['settings'], (prev: any) => ({
          ...(prev || {}),
          settings: { ...(prev?.settings || {}), company_logo: compressed },
        }));
        queryClient.setQueryData(['settings-public'], (prev: any) => ({
          ...(prev || {}),
          settings: { ...(prev?.settings || {}), company_logo: compressed },
        }));
        // Background refetch to ensure consistency
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        queryClient.invalidateQueries({ queryKey: ['settings-public'] });
        toast.success(`Logo berhasil disimpan (${result.size}KB)`);
      } else {
        throw new Error(result.error || 'Gagal menyimpan logo');
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogoError(msg);
      toast.error('Gagal menyimpan logo: ' + msg);
    } finally {
      setLogoSaving(false);
    }
    // Reset file input so same file can be re-selected
    e.target.value = '';
  };
  
  // Save Printer settings
  const handleSavePrinter = async () => {
    setSavingPrinter(true);
    const results = await Promise.all([
      updateSetting('printer_type', printerType),
      updateSetting('printer_device', connectedPrinter),
      updateSetting('receipt_header', receiptHeader),
      updateSetting('receipt_footer', receiptFooter),
      updateSetting('receipt_show_logo', showLogoOnReceipt)
    ]);
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    if (results.every(Boolean)) {
      toast.success('Pengaturan printer berhasil disimpan');
    } else {
      toast.error('Beberapa pengaturan printer gagal disimpan. Coba lagi.');
    }
    setSavingPrinter(false);
  };
  
  // Connect Bluetooth printer
  const handleConnectBluetooth = async () => {
    setPrinterConnecting(true);
    try {
      const device = await requestBLEPrinter();
      toast.info(`Menghubungkan ke ${device.name}...`);
      await connectBLEPrinter(device);
      setConnectedPrinter({ name: device.name || 'Unknown Printer', id: device.id });
      toast.success(`Printer "${device.name}" berhasil terhubung!`);
      // Disconnect after verifying connection (printer stays paired)
      if (device.gatt?.connected) {
        device.gatt.disconnect();
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError') toast.error('Printer tidak ditemukan');
      else if (err.name === 'SecurityError') toast.error('Permission ditolak');
      else if (err.name === 'NetworkError') toast.error('Koneksi gagal. Coba dekatkan ke printer.');
      else toast.error('Gagal: ' + err.message);
    } finally {
      setPrinterConnecting(false);
    }
  };
  
  // Disconnect printer
  const handleDisconnectPrinter = () => {
    setConnectedPrinter(null);
    toast.success('Printer terputus');
  };
  
  // Test print
  const handleTestPrint = async () => {
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const cName = companyName || 'RAZKINDO GROUP';
    const rFooter = receiptFooter || 'Terima Kasih!';
    const lines = [
      '================================',
      cName,
      receiptHeader ? receiptHeader.split('\n').join('\n') : 'Alamat Toko',
      '================================',
      `${dateStr}               ${timeStr}`,
      'No.       TEST-001',
      'Sales     Admin',
      'Customer  Walk-in',
      'Metode    CASH',
      '================================',
      'Produk A',
      ' 1 x 10.000',
      '                   10.000',
      'Produk B',
      ' 2 x 5.000',
      '                   10.000',
      '--------------------------------',
      'Total              20.000',
      'Tunai              20.000',
      'Kembali                0',
      '================================',
      `--${rFooter}--`,
      '================================',
    ];
    const receiptText = lines.join('\n');
    
    if (printerType === 'bluetooth_57' || printerType === 'bluetooth_80') {
      if (!connectedPrinter) {
        toast.error('Hubungkan printer Bluetooth terlebih dahulu');
        return;
      }
      try {
        const device = await requestBLEPrinter();
        toast.info(`Menghubungkan ke ${device.name}...`);
        const { characteristic } = await connectBLEPrinter(device);
        const data = wrapReceiptWithESCPOS(receiptText);
        await writeBLEChunks(characteristic, data);
        toast.success('Test print berhasil!');
        device.gatt?.disconnect();
      } catch (err: any) {
        if (err.name === 'NotFoundError') toast.error('Printer tidak ditemukan');
        else if (err.name === 'SecurityError') toast.error('Permission ditolak');
        else toast.error('Gagal test print: ' + (err.message || 'Unknown error'));
      }
    } else {
      const w = window.open('', '_blank', 'width=400,height=700');
      if (w) {
        w.document.write(`<html><head><style>@page{size:57mm auto;margin:2mm}body{font-family:'Courier New',monospace;font-size:10px;width:57mm;margin:0;padding:2mm;white-space:pre-wrap;line-height:1.3}</style></head><body>${receiptText}</body></html>`);
        w.document.close();
        w.print();
      }
    }
  };
  
  // Unit CRUD handlers
  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unitForm.name.trim()) { toast.error('Nama unit wajib diisi'); return; }
    setUnitLoading(true);
    try {
      if (editingUnit) {
        await apiFetch(`/api/units/${editingUnit.id}`, {
          method: 'PATCH',
          body: JSON.stringify(unitForm)
        });
        toast.success('Unit berhasil diupdate');
      } else {
        await apiFetch('/api/units', {
          method: 'POST',
          body: JSON.stringify(unitForm)
        });
        toast.success('Unit berhasil ditambahkan');
      }
      setShowUnitForm(false);
      setEditingUnit(null);
      setUnitForm({ name: '', address: '', phone: '' });
      queryClient.invalidateQueries({ queryKey: ['units'] });
    } catch {
      toast.error('Gagal menyimpan unit');
    } finally {
      setUnitLoading(false);
    }
  };
  
  const handleDeleteUnit = async () => {
    if (!deletingUnit) return;
    try {
      await apiFetch(`/api/units/${deletingUnit.id}`, { method: 'DELETE' });
      toast.success('Unit berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['units'] });
      setDeletingUnit(null);
    } catch {
      toast.error('Gagal menghapus unit');
    }
  };
  
  // Units query
  const { data: unitsData } = useQuery({
    queryKey: ['units', 'all'],
    queryFn: () => apiFetch<{ units: Unit[] }>('/api/units')
  });
  const allUnits = Array.isArray(unitsData?.units) ? unitsData.units : [];
  
  // Reset system state
  const [resetType, setResetType] = useState<'all' | 'transactions' | 'products' | 'users'>('transactions');
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Database management state
  const [dbInfo, setDbInfo] = useState<any>(null);
  const [dbInfoLoading, setDbInfoLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string; warnings?: string } | null>(null);

  // Fetch DB info
  const fetchDbInfo = async () => {
    setDbInfoLoading(true);
    try {
      const data = await apiFetch<{ info: any }>('/api/system/info');
      if (data.info) {
        setDbInfo(data.info);
      }
    } catch {
      toast.error('Gagal mengambil info database');
    } finally {
      setDbInfoLoading(false);
    }
  };

  useEffect(() => {
    if (activeSettingsTab === 'system' && !dbInfo) {
      fetchDbInfo();
    }
  }, [activeSettingsTab]);

  // Backup handler - uses raw fetch() because apiFetch always parses JSON,
  // but backup endpoint returns a binary SQL file blob.
  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch('/api/system/backup', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Gagal download backup' }));
        throw new Error(err.error || 'Gagal download backup');
      }
      // Get filename from content-disposition
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename=(.+)/);
      const filename = match ? match[1] : `razkindo-backup-${new Date().toISOString().slice(0,10)}.sql`;
      // Download file
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Backup berhasil diunduh!');
      // Refresh DB info
      fetchDbInfo();
    } catch (err: any) {
      toast.error(err.message || 'Gagal membuat backup');
    } finally {
      setBackupLoading(false);
    }
  };

  // Restore handler
  const handleRestore = async () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.sql';
    fileInput.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setRestoreLoading(true);
      setRestoreResult(null);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const data = await apiFetch<{ success: boolean; message?: string; warnings?: string; error?: string }>('/api/system/restore', {
          method: 'POST',
          body: formData,
        });
        if (data.success) {
          toast.success(data.message || 'Database berhasil di-restore!');
          setRestoreResult({ success: true, message: data.message || 'Database berhasil di-restore', warnings: data.warnings });
          fetchDbInfo();
          queryClient.invalidateQueries();
        } else {
          throw new Error(data.error || 'Gagal restore');
        }
      } catch (err: any) {
        toast.error(err.message || 'Gagal restore database');
      } finally {
        setRestoreLoading(false);
      }
    };
    fileInput.click();
  };
  
  const resetMutation = useMutation({
    mutationFn: () => apiFetch<{ success: boolean }>('/api/system/reset', {
      method: 'POST',
      body: JSON.stringify({ type: resetType })
    }),
    onSuccess: () => {
      toast.success('Sistem berhasil direset');
      queryClient.invalidateQueries();
      setShowResetConfirm(false);
    },
    onError: (err: any) => toast.error('Gagal reset: ' + err.message),
  });
  
  if (settingsLoading) {
    return <LoadingFallback message="Memuat pengaturan..." />;
  }
  
  return (
    <div className="space-y-4">
      <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab}>
        {/* Mobile: Dropdown selector */}
        <div className="sm:hidden mb-4">
          <Select value={activeSettingsTab} onValueChange={setActiveSettingsTab}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih menu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">
                <span className="inline-flex items-center gap-2"><Settings className="w-4 h-4" /><span>Umum</span></span>
              </SelectItem>
              <SelectItem value="units">
                <span className="inline-flex items-center gap-2"><Building2 className="w-4 h-4" /><span>Unit</span></span>
              </SelectItem>
              <SelectItem value="printer">
                <span className="inline-flex items-center gap-2"><Printer className="w-4 h-4" /><span>Printer</span></span>
              </SelectItem>
              <SelectItem value="whatsapp">
                <span className="inline-flex items-center gap-2"><MessageSquare className="w-4 h-4" /><span>WhatsApp</span></span>
              </SelectItem>
              <SelectItem value="storage">
                <span className="inline-flex items-center gap-2"><Activity className="w-4 h-4" /><span>Monitor</span></span>
              </SelectItem>
              <SelectItem value="system">
                <span className="inline-flex items-center gap-2"><Database className="w-4 h-4" /><span>Sistem</span></span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: Tab buttons */}
        <TabsList className="hidden sm:flex w-full overflow-x-auto scrollbar-hide">
          <TabsTrigger value="general" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><Settings className="w-3 h-3 sm:w-4 sm:h-4" />Umum</TabsTrigger>
          <TabsTrigger value="units" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><Building2 className="w-3 h-3 sm:w-4 sm:h-4" />Unit</TabsTrigger>
          <TabsTrigger value="printer" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><Printer className="w-3 h-3 sm:w-4 sm:h-4" />Printer</TabsTrigger>
          <TabsTrigger value="whatsapp" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><MessageSquare className="w-3 h-3 sm:w-4 sm:h-4" />WA</TabsTrigger>
          <TabsTrigger value="storage" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><Activity className="w-3 h-3 sm:w-4 sm:h-4" />Monitor</TabsTrigger>
          <TabsTrigger value="system" className="shrink-0 whitespace-nowrap text-xs sm:text-sm gap-1"><Database className="w-3 h-3 sm:w-4 sm:h-4" />Sistem</TabsTrigger>
        </TabsList>
        
        {/* ===== TAB: UMUM ===== */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Pengaturan Umum
              </CardTitle>
              <CardDescription>Nama perusahaan dan logo yang ditampilkan pada invoice dan struk</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nama Perusahaan</Label>
                <Input
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="Nama perusahaan"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Logo Perusahaan</Label>
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  {companyLogo ? (
                    <div className="relative">
                      <img
                        src={companyLogo}
                        alt="Company Logo"
                        className="w-20 h-20 object-contain border rounded-lg p-1 bg-white"
                        onError={() => setLogoError('Gagal memuat logo')}
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6"
                        onClick={async () => {
                          setLogoSaving(true);
                          try {
                            const { apiFetch } = await import('@/lib/api-client');
                            await apiFetch('/api/settings/logo', { method: 'DELETE' });
                            setCompanyLogo('');
                            setLogoError('');
                            queryClient.setQueryData(['settings'], (prev: any) => ({
                              ...(prev || {}),
                              settings: { ...(prev?.settings || {}), company_logo: '' },
                            }));
                            queryClient.setQueryData(['settings-public'], (prev: any) => ({
                              ...(prev || {}),
                              settings: { ...(prev?.settings || {}), company_logo: '' },
                            }));
                            queryClient.invalidateQueries({ queryKey: ['settings'] });
                            queryClient.invalidateQueries({ queryKey: ['settings-public'] });
                            toast.success('Logo dihapus');
                          } catch {
                            toast.error('Gagal menghapus logo');
                          } finally {
                            setLogoSaving(false);
                          }
                        }}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-muted-foreground">
                      {/* eslint-disable-next-line jsx-a11y/alt-text */}
                      <ImageIcon className="w-8 h-8 mb-1" aria-hidden="true" />
                      <span className="text-xs">Belum ada</span>
                    </div>
                  )}
                  <div className="w-full sm:w-auto">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoUpload}
                      className="hidden"
                      id="logo-upload"
                    />
                    <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={logoSaving} onClick={() => document.getElementById('logo-upload')?.click()}>
                      <Upload className="w-4 h-4 mr-2" />
                      {logoSaving ? 'Menyimpan...' : companyLogo ? 'Ganti Logo' : 'Upload Logo'}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">PNG/JPG/SVG, maks. 5MB (auto-compress & auto-save)</p>
                    {logoError && (
                      <p className="text-xs text-destructive mt-1">{logoError}</p>
                    )}
                  </div>
                </div>
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <Label>Peringatan di Halaman Login</Label>
                <Textarea
                  value={loginWarning}
                  onChange={e => setLoginWarning(e.target.value)}
                  placeholder="Teks peringatan yang ditampilkan di halaman login (opsional)"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">Contoh: Sistem hanya untuk karyawan. Dilarang membagikan akun.</p>
              </div>
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <div className="min-w-0">
                  <p className="font-medium">Versi Aplikasi</p>
                  <p className="text-sm text-muted-foreground">Razkindo ERP v1.0.0</p>
                </div>
                <Badge className="shrink-0 self-start">Production</Badge>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row justify-end border-t pt-4 gap-2">
              <Button onClick={handleSaveGeneral} disabled={savingGeneral} className="w-full sm:w-auto">
                {savingGeneral ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        
        {/* ===== TAB: UNIT/CABANG ===== */}
        <TabsContent value="units" className="space-y-4">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Unit / Cabang
                </CardTitle>
                <CardDescription>Kelola unit atau cabang perusahaan</CardDescription>
              </div>
              <Button className="w-full sm:w-auto mt-3" size="sm" onClick={() => { setEditingUnit(null); setUnitForm({ name: '', address: '', phone: '' }); setShowUnitForm(true); }}>
                <Plus className="w-4 h-4 mr-1" />
                Tambah Unit
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {allUnits.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                    <p>Belum ada unit/cabang</p>
                  </div>
                ) : (
                  allUnits.map((u: Unit) => (
                    <div key={u.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{u.name}</p>
                          <Badge variant="outline" className="text-xs shrink-0">ID: {u.id.slice(0, 8)}</Badge>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-0.5 sm:gap-4 text-sm text-muted-foreground mt-1">
                          {u.address && <span className="flex items-center gap-1 min-w-0 truncate"><MapPin className="w-3 h-3 shrink-0" />{u.address}</span>}
                          {u.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{u.phone}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0 self-end sm:self-center">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingUnit(u); setUnitForm({ name: u.name, address: u.address || '', phone: u.phone || '' }); setShowUnitForm(true); }}>
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => setDeletingUnit(u)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          
          {/* Unit Form Dialog */}
          <Dialog open={showUnitForm} onOpenChange={setShowUnitForm}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingUnit ? 'Edit Unit' : 'Tambah Unit Baru'}</DialogTitle>
                <DialogDescription>{editingUnit ? 'Ubah informasi unit/cabang' : 'Isi detail unit/cabang baru'}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSaveUnit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nama Unit *</Label>
                  <Input className="w-full" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="Contoh: Cabang Jakarta" required />
                </div>
                <div className="space-y-2">
                  <Label>Alamat</Label>
                  <Textarea className="w-full" value={unitForm.address} onChange={e => setUnitForm({ ...unitForm, address: e.target.value })} placeholder="Alamat lengkap" />
                </div>
                <div className="space-y-2">
                  <Label>Telepon</Label>
                  <Input className="w-full" value={unitForm.phone} onChange={e => setUnitForm({ ...unitForm, phone: e.target.value })} placeholder="Nomor telepon" />
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowUnitForm(false)}>Batal</Button>
                  <Button type="submit" className="w-full sm:w-auto" disabled={unitLoading}>{unitLoading ? 'Menyimpan...' : editingUnit ? 'Update' : 'Simpan'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          
          {/* Delete Confirm Dialog */}
          <Dialog open={!!deletingUnit} onOpenChange={(open) => { if (!open) setDeletingUnit(null); }}>
            <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
              <DialogHeader>
                <DialogTitle>Hapus Unit</DialogTitle>
                <DialogDescription>
                  Apakah Anda yakin ingin menonaktifkan unit &quot;{deletingUnit?.name}&quot;?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col sm:flex-row gap-2">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeletingUnit(null)}>Batal</Button>
                <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDeleteUnit}>Hapus</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>
        
        {/* ===== TAB: WHATSAPP ===== */}
        <TabsContent value="whatsapp" className="space-y-4">
          <WhatsAppSettingsTab />
        </TabsContent>

        {/* ===== TAB: PRINTER ===== */}
        <TabsContent value="printer" className="space-y-4">
          {/* Printer Type & Connection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Printer className="w-4 h-4" />
                Koneksi Printer
              </CardTitle>
              <CardDescription>Pilih jenis printer dan hubungkan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Jenis Printer</Label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    className={cn("p-4 border rounded-lg cursor-pointer transition-all hover:border-primary/50", printerType === 'browser' && "border-primary bg-primary/5 ring-2 ring-primary/20")}
                    onClick={() => setPrinterType('browser')}
                  >
                    <Monitor className="w-6 h-6 mb-2 text-blue-500" />
                    <p className="font-medium text-sm">Browser Print</p>
                    <p className="text-xs text-muted-foreground">Cetak via window browser</p>
                  </div>
                  <div
                    className={cn("p-4 border rounded-lg cursor-pointer transition-all hover:border-primary/50", printerType === 'bluetooth_57' && "border-primary bg-primary/5 ring-2 ring-primary/20")}
                    onClick={() => setPrinterType('bluetooth_57')}
                  >
                    <Printer className="w-6 h-6 mb-2 text-green-500" />
                    <p className="font-medium text-sm">Bluetooth 57x30</p>
                    <p className="text-xs text-muted-foreground">Struk thermal kecil</p>
                  </div>
                  <div
                    className={cn("p-4 border rounded-lg cursor-pointer transition-all hover:border-primary/50", printerType === 'bluetooth_80' && "border-primary bg-primary/5 ring-2 ring-primary/20")}
                    onClick={() => setPrinterType('bluetooth_80')}
                  >
                    <Printer className="w-6 h-6 mb-2 text-orange-500" />
                    <p className="font-medium text-sm">Bluetooth 80x80</p>
                    <p className="text-xs text-muted-foreground">Struk thermal besar</p>
                  </div>
                </div>
              </div>
              
              {(printerType === 'bluetooth_57' || printerType === 'bluetooth_80') && (
                <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">Printer Bluetooth</p>
                      {connectedPrinter ? (
                        <p className="text-sm text-green-600 flex items-center gap-1">
                          <Wifi className="w-3 h-3 shrink-0" />
                          <span className="truncate">Terhubung: {connectedPrinter.name}</span>
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Belum terhubung</p>
                      )}
                    </div>
                    {connectedPrinter ? (
                      <Button variant="outline" size="sm" className="w-full sm:w-auto shrink-0" onClick={handleDisconnectPrinter}>
                        <WifiOff className="w-3 h-3 mr-1" />
                        Putuskan
                      </Button>
                    ) : (
                      <Button size="sm" className="w-full sm:w-auto shrink-0" onClick={handleConnectBluetooth} disabled={printerConnecting}>
                        <Bluetooth className="w-3 h-3 mr-1" />
                        {printerConnecting ? 'Menghubungkan...' : 'Hubungkan'}
                      </Button>
                    )}
                  </div>
                  {!navigator.bluetooth && (
                    <p className="text-xs text-yellow-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      Browser ini tidak mendukung Bluetooth. Gunakan Chrome/Edge di desktop.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Receipt Template Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Template Struk / Invoice
              </CardTitle>
              <CardDescription>Atur header, footer, dan logo pada struk</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-lg gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm">Tampilkan Logo di Struk</p>
                  <p className="text-xs text-muted-foreground">{companyLogo ? 'Logo perusahaan akan ditampilkan' : 'Upload logo terlebih dahulu di tab Umum'}</p>
                </div>
                <Switch
                  checked={showLogoOnReceipt}
                  onCheckedChange={setShowLogoOnReceipt}
                  disabled={!companyLogo}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Header Struk</Label>
                <Textarea
                  value={receiptHeader}
                  onChange={e => setReceiptHeader(e.target.value)}
                  placeholder="Teks tambahan di bagian atas struk (opsional)"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">Maks. 3 baris. Kosongkan jika tidak perlu tambahan.</p>
              </div>
              
              <div className="space-y-2">
                <Label>Footer Struk</Label>
                <Textarea
                  value={receiptFooter}
                  onChange={e => setReceiptFooter(e.target.value)}
                  placeholder="Teks di bagian bawah struk"
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">Contoh: Terima Kasih Atas Kunjungan Anda!</p>
              </div>
              
              {/* Receipt Preview */}
              <div className="space-y-2">
                <Label>Preview Struk</Label>
                <div className={cn("border rounded-lg p-3 font-mono text-xs bg-white text-black w-full max-w-[280px] sm:max-w-sm mx-auto overflow-x-auto",
                  printerType === 'bluetooth_80' && "sm:!max-w-md"
                )}>
                  <pre className="whitespace-pre text-center leading-tight">
{`================================
${companyLogo && showLogoOnReceipt ? '[LOGO]' : ''}
${companyName}
${receiptHeader ? receiptHeader.split('\n').join('\n') : 'Alamat Toko'}
================================
${format(new Date(), 'dd/MM/yyyy')}          ${format(new Date(), 'HH:mm')}
No.       INV-001
Sales     Admin
Customer  Walk-in
Metode    CASH
================================
Produk A
 1 x 10.000
                   10.000
Produk B
 2 x 5.000
                   10.000
--------------------------------
Total              20.000
Tunai              20.000
Kembali                0
================================
--${(receiptFooter || 'Terima Kasih!')}--
================================`}
                  </pre>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col sm:flex-row justify-between border-t pt-4 gap-2">
              <Button variant="outline" className="w-full sm:w-auto" onClick={handleTestPrint}>
                <Printer className="w-4 h-4 mr-2" />
                Test Print
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleSavePrinter} disabled={savingPrinter}>
                {savingPrinter ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
        

        {/* ===== TAB: STORAGE Z.AI ===== */}
        <TabsContent value="storage" className="space-y-4">
          <StorageTab queryClient={queryClient} />
        </TabsContent>

        {/* ===== TAB: SISTEM ===== */}
        <TabsContent value="system" className="space-y-4">
          {/* Database Statistics */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Statistik Database
                  </CardTitle>
                  <CardDescription className="mt-1">Informasi database dan jumlah record</CardDescription>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" onClick={fetchDbInfo} disabled={dbInfoLoading}>
                  <RefreshCw className={cn("w-3 h-3 mr-1", dbInfoLoading && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {dbInfoLoading && !dbInfo ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                  Memuat...
                </div>
              ) : dbInfo ? (
                <div className="space-y-3">
                  {/* Summary Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-muted/50 text-center">
                      <p className="text-xs text-muted-foreground">Ukuran DB</p>
                      <p className="font-semibold text-sm">
                        {dbInfo.dbFileSize ? (dbInfo.dbFileSize / (1024 * 1024)).toFixed(2) + ' MB' : '-'}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-center">
                      <p className="text-xs text-muted-foreground">Total Penjualan</p>
                      <p className="font-semibold text-sm text-emerald-600 dark:text-emerald-400">
                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(dbInfo.summaries?.totalSales || 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-center">
                      <p className="text-xs text-muted-foreground">Total Profit</p>
                      <p className="font-semibold text-sm text-blue-600 dark:text-blue-400">
                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(dbInfo.summaries?.totalProfit || 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 text-center">
                      <p className="text-xs text-muted-foreground">Piutang</p>
                      <p className="font-semibold text-sm text-orange-600 dark:text-orange-400">
                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(dbInfo.summaries?.totalReceivables || 0)}
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {/* Table Counts */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2">
                    {[
                      { label: 'Pengguna', value: dbInfo.tables?.users },
                      { label: 'Unit', value: dbInfo.tables?.units },
                      { label: 'Produk', value: dbInfo.tables?.products },
                      { label: 'Pelanggan', value: dbInfo.tables?.customers },
                      { label: 'Supplier', value: dbInfo.tables?.suppliers },
                      { label: 'Transaksi', value: dbInfo.tables?.transactions },
                      { label: 'Item Transaksi', value: dbInfo.tables?.transactionItems },
                      { label: 'Pembayaran', value: dbInfo.tables?.payments },
                      { label: 'Gaji', value: dbInfo.tables?.salaryPayments },
                      { label: 'Transfer Dana', value: dbInfo.tables?.fundTransfers },
                      { label: 'Hutang', value: dbInfo.tables?.companyDebts },
                      { label: 'Piutang', value: dbInfo.tables?.receivables },
                      { label: 'Pengiriman', value: dbInfo.tables?.courierHandovers },
                      { label: 'Events', value: dbInfo.tables?.events },
                      { label: 'Logs', value: dbInfo.tables?.logs },
                    ]
                      .filter(item => item.value !== undefined)
                      .map(item => (
                        <div key={item.label} className="flex items-center justify-between py-1">
                          <span className="text-xs text-muted-foreground">{item.label}</span>
                          <Badge variant="secondary" className="text-xs font-mono">{(item.value as number).toLocaleString('id-ID')}</Badge>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-muted-foreground py-4">Gagal memuat info database</p>
              )}
            </CardContent>
          </Card>

          {/* Backup & Restore */}
          {user?.role === 'super_admin' && (
            <>
              {/* Backup Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Download className="w-4 h-4 text-emerald-500" />
                    Backup Database
                  </CardTitle>
                  <CardDescription>
                    Unduh seluruh data dalam format SQL. Gunakan sebelum update atau perubahan besar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/10">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">Download Backup SQL</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {dbInfo?.lastBackupDate
                          ? `Backup terakhir: ${new Date(dbInfo.lastBackupDate).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`
                          : 'Belum pernah backup'
                        }
                        {dbInfo?.backupCount ? ` • ${dbInfo.backupCount} file backup tersimpan` : ''}
                      </p>
                    </div>
                    <Button
                      onClick={handleBackup}
                      disabled={backupLoading}
                      className="w-full sm:w-auto shrink-0"
                    >
                      {backupLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Membuat Backup...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Backup Sekarang
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>💡 <strong>Tips:</strong></p>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      <li>Backup sebelum melakukan update aplikasi atau perubahan schema</li>
                      <li>Simpan file backup di tempat yang aman (Google Drive, dll)</li>
                      <li>File backup berisi seluruh data: transaksi, produk, pengguna, pengaturan</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Restore Card */}
              <Card className="border-amber-500/30">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UploadCloud className="w-4 h-4 text-amber-500" />
                    Restore Database
                  </CardTitle>
                  <CardDescription>
                    Kembalikan database dari file backup SQL yang sebelumnya diunduh.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/10">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <AlertDescription className="text-amber-700 dark:text-amber-400">
                      <strong>Perhatian!</strong> Restore akan menimpa semua data saat ini. Pastikan Anda sudah backup sebelum melanjutkan. Sistem akan otomatis membuat safety backup sebelum restore.
                    </AlertDescription>
                  </Alert>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 border rounded-lg bg-amber-50/30 dark:bg-amber-950/10">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">Upload File Backup (.sql)</p>
                      <p className="text-xs text-muted-foreground mt-0.5">File harus berformat .sql dari backup sebelumnya</p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleRestore}
                      disabled={restoreLoading}
                      className="w-full sm:w-auto shrink-0 border-amber-500/50 text-amber-600 hover:bg-amber-50 dark:text-amber-400"
                    >
                      {restoreLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Memulihkan...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Pilih File & Restore
                        </>
                      )}
                    </Button>
                  </div>

                  {/* Restore Result */}
                  {restoreResult && (
                    <Alert className={restoreResult.success ? 'border-green-500/50 bg-green-50/50 dark:bg-green-950/10' : 'border-red-500/50 bg-red-50/50 dark:bg-red-950/10'}>
                      <ShieldCheck className="h-4 w-4" />
                      <AlertDescription>
                        <p className={restoreResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                          {restoreResult.message}
                        </p>
                        {restoreResult.warnings && (
                          <pre className="mt-2 text-xs p-2 rounded bg-muted/50 overflow-x-auto max-h-32">
                            {restoreResult.warnings}
                          </pre>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>📋 <strong>Cara Restore:</strong></p>
                    <ol className="list-decimal list-inside space-y-0.5 ml-1">
                      <li>Klik &quot;Pilih File & Restore&quot; dan pilih file .sql dari backup sebelumnya</li>
                      <li>Sistem otomatis membuat safety backup dari database saat ini</li>
                      <li>Data akan ditimpa dengan data dari file backup</li>
                      <li>Jika gagal, safety backup akan dikembalikan otomatis</li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          
          {user?.role === 'super_admin' && (
            <Card className="border-red-500/50">
              <CardHeader>
                <CardTitle className="text-base text-red-500 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Zona Berbahaya
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">Reset Sistem</p>
                    <p className="text-sm text-muted-foreground break-words">Hapus data sesuai pilihan</p>
                  </div>
                  <Dialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
                    <DialogTrigger asChild>
                      <Button variant="destructive" size="sm" className="w-full sm:w-auto shrink-0">Reset</Button>
                    </DialogTrigger>
                    <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Konfirmasi Reset</DialogTitle>
                        <DialogDescription>Tindakan ini tidak dapat dibatalkan.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <Select value={resetType} onValueChange={v => setResetType(v as typeof resetType)}>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="transactions">Transaksi Saja</SelectItem>
                            <SelectItem value="products">Produk Saja</SelectItem>
                            <SelectItem value="users">User Non-Admin</SelectItem>
                            <SelectItem value="all">Semua Data</SelectItem>
                          </SelectContent>
                        </Select>
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>Akan menghapus: <strong>{resetType}</strong></AlertDescription>
                        </Alert>
                      </div>
                      <DialogFooter className="flex-col sm:flex-row gap-2">
                        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setShowResetConfirm(false)}>Batal</Button>
                        <Button variant="destructive" className="w-full sm:w-auto" onClick={() => resetMutation.mutate()} disabled={resetMutation.isPending}>
                          {resetMutation.isPending ? 'Menghapus...' : 'Ya, Reset'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

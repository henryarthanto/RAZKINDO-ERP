'use client';

import { useState, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiFetch, apiFetchNoAuth, ApiError } from '@/lib/api-client';
import {
  MessageSquare,
  RefreshCw,
  Wifi,
  BadgeCheck,
  AlertCircle,
  AlertTriangle,
  Users,
  Send
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

export default function WhatsAppSettingsTab() {
  const queryClient = useQueryClient();

  // WhatsApp config state
  const [waToken, setWaToken] = useState('');
  const [waTokenMasked, setWaTokenMasked] = useState(false);
  const [waEnabled, setWaEnabled] = useState(false);
  const [waTargetType, setWaTargetType] = useState<'group' | 'phone'>('group');
  const [waTargetId, setWaTargetId] = useState('');
  const [waSaving, setWaSaving] = useState(false);
  const [waTesting, setWaTesting] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [tokenInvalidAt, setTokenInvalidAt] = useState<string | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Message template state
  const [template, setTemplate] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [previewData, setPreviewData] = useState(true);

  // Test message state
  const [testMessage, setTestMessage] = useState('');
  const [sendTestLoading, setSendTestLoading] = useState(false);

  // Fetch current config — uses apiFetch which adds auth header automatically
  const { data: configData, error: configError } = useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: async () => {
      try {
        const result = await apiFetch<{ config: any }>('/api/whatsapp/config');
        return result;
      } catch (err) {
        // If config fetch fails, return empty defaults instead of throwing
        console.error('Failed to fetch WhatsApp config:', err);
        return { config: { token: '', tokenMasked: false, enabled: false, target_type: 'group', target_id: '', message_template: '' } };
      }
    },
  });

  // Fetch current template
  const { data: templateData, error: templateError } = useQuery({
    queryKey: ['whatsapp-template'],
    queryFn: async () => {
      try {
        return await apiFetch<{ template: string }>('/api/whatsapp/message-template');
      } catch (err) {
        console.error('Failed to fetch WhatsApp template:', err);
        return { template: '' };
      }
    },
  });

  // Sync config to local state
  useEffect(() => {
    if (configData?.config) {
      setWaToken(configData.config.token || '');
      setWaTokenMasked(configData.config.tokenMasked || false);
      setWaEnabled(configData.config.enabled || false);
      setWaTargetType(configData.config.target_type || 'group');
      setWaTargetId(configData.config.target_id || '');
      setTokenInvalid(configData.config.tokenInvalid || false);
      setTokenInvalidAt(configData.config.tokenInvalidAt || null);
    }
  }, [configData]);

  useEffect(() => {
    if (templateData?.template) {
      setTemplate(templateData.template);
    }
  }, [templateData]);

  const getDefaultTemplate = () => `*🔔 NOTIFIKASI ORDER BARU - RAZKINDO*
-------------------------------------------
Invoice: {invoice_no}
Tanggal: {date}

👤 *Sales:* {sales_name}
🏢 *Customer:* {customer_name}
📱 No. HP: {customer_phone}
📍 Cabang: {unit_name}
📦 Item: {items}

💰 *TOTAL:* *Rp {total}*
💵 Bayar: Rp {paid}
💳 Sisa: Rp {remaining}
🏷️ Metode: {payment_method}
{due_date ? 📅 Jatuh Tempo: {due_date} : ''}
-------------------------------------------
_Mohon tim kurir segera memproses pesanan ini._`;

  // Generate preview
  const previewText = previewData
    ? template
        .replace(/\{invoice_no\}/g, 'INV-2025030001')
        .replace(/\{date\}/g, new Date().toLocaleDateString('id-ID'))
        .replace(/\{sales_name\}/g, 'Ahmad Sales')
        .replace(/\{customer_name\}/g, 'PT Maju Jaya')
        .replace(/\{customer_phone\}/g, '081234567890')
        .replace(/\{unit_name\}/g, 'Solo')
        .replace(/\{items\}/g, 'Tepung 10kg x2, Gula 1kg x5')
        .replace(/\{total\}/g, '2.500.000')
        .replace(/\{paid\}/g, '1.500.000')
        .replace(/\{remaining\}/g, '1.000.000')
        .replace(/\{payment_method\}/g, 'CASH')
        .replace(/\{due_date\}/g, '15 April 2025')
        .replace(/\{delivery_address\}/g, 'Jl. Slamet Riyadi No. 123, Solo')
    : '';

  // Test connection — backend resolves masked token automatically
  const handleTestConnection = async () => {
    if (!waToken.trim()) {
      toast.error('Masukkan API Token terlebih dahulu');
      return;
    }
    setWaTesting(true);
    setTestResult(null);
    try {
      const data = await apiFetch<{ success: boolean; devices?: any[]; error?: string }>('/api/whatsapp/test', {
        method: 'POST',
        body: JSON.stringify({ token: waToken })
      });
      if (data.success) {
        const device = data.devices?.[0];
        const name = device?.name || 'Perangkat';
        const status = device?.status || 'connected';
        const msg = status === 'connected'
          ? `Terhubung! Device: ${name}`
          : `Token valid, tetapi device "${name}" belum terhubung. Buka fonnte.com dan pastikan WhatsApp sudah scan QR.`;
        setTestResult({ success: status === 'connected', message: msg });
        // Clear token invalid warning on successful test
        setTokenInvalid(false);
        setTokenInvalidAt(null);
        if (status === 'connected') toast.success('Koneksi berhasil!');
        else toast.warning(msg);
      } else {
        setTestResult({ success: false, message: data.error || 'Gagal terhubung' });
        toast.error(data.error || 'Gagal terhubung');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Gagal menghubungi server';
      setTestResult({ success: false, message: msg });
      toast.error(msg);
    } finally { setWaTesting(false); }
  };

  // Get groups — backend resolves masked token automatically
  const handleGetGroups = async () => {
    if (!waToken.trim()) {
      toast.error('Masukkan API Token terlebih dahulu');
      return;
    }
    setGroupsLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; groups?: any[]; error?: string }>('/api/whatsapp/groups', {
        method: 'POST',
        body: JSON.stringify({ token: waToken })
      });
      if (data.success) {
        setGroups(data.groups || []);
        toast.success(`${data.groups?.length || 0} grup ditemukan`);
      } else {
        toast.error(data.error || 'Gagal mengambil grup');
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengambil grup');
    } finally { setGroupsLoading(false); }
  };

  // Save config
  const handleSaveConfig = async () => {
    setWaSaving(true);
    try {
      await apiFetchNoAuth('/api/whatsapp/config', {
        method: 'PATCH',
        body: JSON.stringify({
          token: waToken,
          enabled: waEnabled,
          target_type: waTargetType,
          target_id: waTargetId
        })
      });
      toast.success('Pengaturan WhatsApp berhasil disimpan');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan pengaturan');
    } finally { setWaSaving(false); }
  };

  // Save template
  const handleSaveTemplate = async () => {
    setTemplateSaving(true);
    try {
      await apiFetchNoAuth('/api/whatsapp/message-template', {
        method: 'PATCH',
        body: JSON.stringify({ template })
      });
      toast.success('Template pesan berhasil disimpan');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-template'] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Gagal menyimpan template');
    } finally { setTemplateSaving(false); }
  };

  // Send test message — backend resolves masked token automatically
  const handleSendTest = async () => {
    if (!waTargetId.trim()) { toast.error('Target tujuan wajib diisi'); return; }
    if (!waToken.trim()) { toast.error('Simpan token API terlebih dahulu'); return; }
    const msg = testMessage || previewText;
    if (!msg.trim()) { toast.error('Pesan tidak boleh kosong'); return; }
    setSendTestLoading(true);
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>('/api/whatsapp/send', {
        method: 'POST',
        body: JSON.stringify({ token: waToken, target: waTargetId, message: msg })
      });
      if (data.success) { toast.success('Pesan test berhasil dikirim!'); }
      else { toast.error(data.error || 'Gagal mengirim pesan test'); }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Gagal mengirim pesan test');
    } finally { setSendTestLoading(false); }
  };

  // Reset template to default
  const handleResetTemplate = () => { setTemplate(getDefaultTemplate()); toast.info('Template direset ke default'); };

  return (
    <div className="space-y-4">
      {/* Token Invalid Warning */}
      {tokenInvalid && (
        <Alert className="border-red-300 bg-red-50 dark:bg-red-950/50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700 dark:text-red-300">
            <p className="font-medium text-sm">⚠️ Token WhatsApp Tidak Valid / Expired</p>
            <p className="text-xs mt-1">
              Notifikasi WhatsApp otomatis dinonaktifkan karena token tidak valid.
              {tokenInvalidAt && ` Terdeteksi: ${new Date(tokenInvalidAt).toLocaleString('id-ID')}.`}
              Silakan masukkan token baru dari <strong>fonnte.com</strong> lalu klik Test Koneksi.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* API Connection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-600" /> Koneksi Fonnte API
          </CardTitle>
          <CardDescription className="text-xs">Masukkan API Token Fonnte untuk mengaktifkan notifikasi WhatsApp otomatis saat order baru.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API Token Fonnte</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={waToken}
                onChange={e => {
                  setWaToken(e.target.value);
                  setWaTokenMasked(false);
                }}
                placeholder={waTokenMasked ? 'Token tersimpan — kosongkan jika tidak ingin mengubah' : 'Masukkan token Fonnte...'}
                className="font-mono text-sm"
              />
              <Button variant="outline" onClick={handleTestConnection} disabled={waTesting}>
                {waTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Dapatkan token di <span className="font-medium">fonnte.com</span> → Device → Copy API Key</p>
          </div>
          {testResult && (
            <Alert className={testResult.success ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}>
              {testResult.success ? <BadgeCheck className="h-4 w-4 text-green-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
              <AlertDescription className={testResult.success ? 'text-green-700' : 'text-red-700 text-sm'}>{testResult.message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Target Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Target Tujuan</CardTitle>
            <div className="flex items-center gap-2">
              <Label htmlFor="wa-enabled" className="text-sm">Aktifkan</Label>
              <Switch id="wa-enabled" checked={waEnabled} onCheckedChange={setWaEnabled} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jenis Target</Label>
              <Select value={waTargetType} onValueChange={v => setWaTargetType(v as 'group' | 'phone')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="group">Grup WhatsApp</SelectItem>
                  <SelectItem value="phone">Nomor WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{waTargetType === 'group' ? 'Group ID (JID)' : 'Nomor HP'}</Label>
              <div className="flex gap-2">
                <Input value={waTargetId} onChange={e => setWaTargetId(e.target.value)} placeholder={waTargetType === 'group' ? 'Contoh: 120363XXXXX@g.us' : 'Contoh: 628123456789'} className="font-mono text-sm" />
                {waTargetType === 'group' && (
                  <Button variant="outline" onClick={handleGetGroups} disabled={groupsLoading || !waToken}>
                    {groupsLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{waTargetType === 'group' ? 'Klik tombol untuk mengambil daftar grup otomatis' : 'Format: 628xxx (tanpa + atau 0 di depan)'}</p>
            </div>
          </div>

          {groups.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Pilih Grup:</Label>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {groups.map((g: any, i: number) => (
                  <button key={i} type="button" onClick={() => setWaTargetId(g.id || g.jid || '')}
                    className={cn("w-full text-left p-2 rounded-lg border text-sm hover:bg-muted transition-colors", waTargetId === (g.id || g.jid) && "border-primary bg-primary/5")}>
                    <p className="font-medium">{g.name || g.subject || 'Unnamed Group'}</p>
                    <p className="text-xs text-muted-foreground font-mono">{g.id || g.jid}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleSaveConfig} disabled={waSaving} className="w-full sm:w-auto">
            {waSaving ? 'Menyimpan...' : 'Simpan Pengaturan WhatsApp'}
          </Button>
        </CardContent>
      </Card>

      {/* Message Template */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Template Pesan Notifikasi</CardTitle>
              <CardDescription className="text-xs mt-1">Pesan otomatis saat transaksi baru. Gunakan variabel dalam kurung kurawal.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleResetTemplate}>Reset Default</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs font-medium mb-1">Variabel tersedia:</p>
            <div className="flex flex-wrap gap-1">
              {['{invoice_no}', '{date}', '{sales_name}', '{customer_name}', '{customer_phone}', '{unit_name}', '{items}', '{total}', '{paid}', '{remaining}', '{payment_method}', '{due_date}', '{delivery_address}'].map(v => (
                <Badge key={v} variant="outline" className="text-xs font-mono cursor-pointer hover:bg-primary/10" onClick={() => setTemplate(t => t + v)}>{v}</Badge>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Template Pesan</Label>
            <Textarea value={template} onChange={e => setTemplate(e.target.value)} rows={10} className="font-mono text-sm" placeholder="Tulis template pesan..." />
          </div>
          <Button onClick={handleSaveTemplate} disabled={templateSaving} className="w-full sm:w-auto">
            {templateSaving ? 'Menyimpan...' : 'Simpan Template'}
          </Button>
        </CardContent>
      </Card>

      {/* Preview & Test */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Preview & Kirim Test</CardTitle>
          <CardDescription className="text-xs">Preview dengan data contoh. Kirim test untuk memastikan format sudah benar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Preview Pesan</Label>
            <div className="flex items-center gap-2">
              <Label htmlFor="show-preview" className="text-xs text-muted-foreground">Tampilkan</Label>
              <Switch id="show-preview" checked={previewData} onCheckedChange={setPreviewData} />
            </div>
          </div>
          {previewData && (
            <div className="bg-[#dcf8c6] dark:bg-[#1a2e1a] rounded-xl p-4 max-h-60 overflow-y-auto">
              <pre className="text-sm whitespace-pre-wrap font-sans text-black/80 dark:text-green-100/80">{previewText}</pre>
            </div>
          )}
          <div className="space-y-2">
            <Label>Pesan Custom (opsional)</Label>
            <Textarea value={testMessage} onChange={e => setTestMessage(e.target.value)} rows={3} placeholder="Kosongkan untuk menggunakan template di atas..." className="text-sm" />
          </div>
          <Button onClick={handleSendTest} disabled={sendTestLoading || !waTargetId} variant="outline" className="bg-green-600 text-white hover:bg-green-700 border-green-600">
            {sendTestLoading ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Mengirim...</> : <><Send className="w-4 h-4 mr-2" />Kirim Pesan Test</>}
          </Button>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800">Cara Mendapatkan Group ID (JID)</p>
              <ol className="text-xs text-amber-700 space-y-1 list-decimal ml-4">
                <li>Pastikan WhatsApp Business / Fonnte device sudah join ke grup target</li>
                <li>Masukkan API Token, lalu klik tombol koneksi untuk test</li>
                <li>Pilih &quot;Grup WhatsApp&quot; sebagai jenis target</li>
                <li>Klik tombol untuk mengambil daftar grup</li>
                <li>Pilih grup dari daftar — Group ID akan otomatis terisi</li>
                <li>Simpan pengaturan dan kirim pesan test</li>
              </ol>
              <p className="text-xs text-amber-700 mt-2"><strong>Format Group ID:</strong> 120363XXXXX@g.us</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

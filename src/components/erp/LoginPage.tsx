'use client';

import { useState, useEffect } from 'react';
import { Package, AlertTriangle, KeyRound, ArrowLeft, Loader2, Smartphone, Building2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ROLES } from '@/lib/erp-helpers';
import { useDynamicFavicon } from '@/hooks/use-dynamic-favicon';
import { cn } from '@/lib/utils';

type LoginPageMode = 'login' | 'register' | 'forgot-password' | 'verify-code';

function LoginPage() {
  const [mode, setMode] = useState<LoginPageMode>('login');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    phone: '',
    role: 'sales',
    unitId: '',
    unitIds: [] as string[],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetPhone, setResetPhone] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [codeCountdown, setCodeCountdown] = useState(0);

  const { login } = useAuthStore();
  const { setUnits, units } = useUnitStore();

  // Check if database schema exists
  const { data: schemaCheck } = useQuery({
    queryKey: ['schema-check'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/setup-schema');
        if (!res.ok) return { tablesExist: true };
        return await res.json();
      } catch { return { tablesExist: true };
      }
    },
    retry: false,
    staleTime: 60_000,
  });
  const schemaMissing = schemaCheck?.tablesExist === false;

  // Fetch app settings
  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['settings-public'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/settings?public=true');
        if (!res.ok) return { settings: {} };
        return await res.json();
      } catch { return { settings: {} }; }
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const appSettings = schemaMissing ? {} : (settingsData?.settings || {});
  const companyName = appSettings.company_name || 'Razkindo ERP';
  const companyLogo = appSettings.company_logo || '';
  const loginWarning = schemaMissing
    ? 'Database belum di-setup. Jalankan SQL schema di Supabase Dashboard.'
    : (appSettings.login_warning || '');

  useDynamicFavicon(companyLogo || undefined);

  useEffect(() => {
    const onFocus = () => refetchSettings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchSettings]);

  // Check if super_admin already exists
  const { data: superAdminCheck } = useQuery({
    queryKey: ['check-superadmin'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/auth/check-superadmin');
        if (!res.ok) return { exists: false };
        return await res.json();
      } catch { return { exists: false };
      }
    }
  });
  const superAdminExists = superAdminCheck?.exists || false;

  const availableRoles = superAdminExists
    ? ROLES.filter(r => r.value !== 'super_admin')
    : ROLES;

  // Fetch units for registration
  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/units');
        if (!res.ok) return { units: [] };
        return await res.json();
      } catch { return { units: [] }; }
    }
  });

  useEffect(() => {
    if (unitsData?.units) {
      setUnits(unitsData.units);
    }
  }, [unitsData, setUnits]);

  // Countdown timer for forgot-password
  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = setInterval(() => {
      if (codeCountdown > 0) setCodeCountdown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [codeCountdown]);

  // Reset error when switching modes
  useEffect(() => {
    setError('');
  }, [mode]);

  // Toggle unit selection (multi-select)
  const toggleUnit = (unitId: string) => {
    setFormData(prev => {
      const current = prev.unitIds || [];
      const isSelected = current.includes(unitId);
      const newIds = isSelected
        ? current.filter(id => id !== unitId)
        : [...current, unitId];
      return {
        ...prev,
        unitIds: newIds,
        unitId: newIds.length > 0 ? newIds[0] : '',
      };
    });
  };

  // ─── LOGIN HANDLER ─────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const email = formData.email.trim().toLowerCase();
    const password = formData.password.trim();

    try {
      if (mode === 'login') {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login gagal');

        login(data.user, data.token);
        toast.success('Login berhasil!');
      } else if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...formData, email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registrasi gagal');
        if (data.user.status === 'approved') {
          const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
          });
          const loginData = await loginRes.json();
          if (loginRes.ok && loginData.token) {
            login(loginData.user, loginData.token);
            toast.success('Registrasi berhasil! Selamat datang.');
          } else {
            toast.success('Registrasi berhasil! Silakan login.');
            setMode('login');
          }
        } else {
          toast.success('Registrasi berhasil! Menunggu persetujuan admin.');
          setMode('login');
        }
      }
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── FORGOT PASSWORD ───────────────────────────────────
  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (!resetPhone || resetPhone.replace(/\D/g, '').length < 10) {
        setError('Masukkan nomor telepon yang valid (min. 10 digit)');
        return;
      }

      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: resetPhone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim kode');

      toast.success(data.message || 'Kode pemulihan dikirim via WhatsApp.');
      setMode('verify-code');
      setCodeCountdown(60);
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (recoveryCode.length !== 6) {
      setError('Masukkan 6 digit kode pemulihan');
      setLoading(false);
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('Password baru dan konfirmasi tidak cocok');
      setLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError('Password minimal 6 karakter');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: resetPhone,
          code: recoveryCode,
          newPassword
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mereset password');

      toast.success(data.message || 'Password berhasil diubah!');
      goBack();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (codeCountdown > 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: resetPhone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim ulang kode');
      toast.success(data.message || 'Kode baru dikirim via WhatsApp!');
      setCodeCountdown(60);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setError('');
    setMode('login');
    setResetPhone('');
    setRecoveryCode('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

  const getModeTitle = () => {
    switch (mode) {
      case 'login': return 'Masuk ke akun Anda';
      case 'register': return 'Daftar akun baru';
      case 'forgot-password': return 'Lupa Password';
      case 'verify-code': return 'Verifikasi Kode';
    }
  };

  const selectedCount = (formData.unitIds || []).length;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {companyLogo ? (
            <div className="mx-auto mb-4">
              <img src={companyLogo} alt={companyName} className="w-16 h-16 object-contain mx-auto rounded-xl" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          ) : (
            <div className="mx-auto mb-4 w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center">
              <Package className="w-6 h-6 text-white" />
            </div>
          )}
          <CardTitle className="text-2xl font-bold">{companyName}</CardTitle>
          <CardDescription>{getModeTitle()}</CardDescription>
        </CardHeader>

        {loginWarning && mode === 'login' && (
          <div className="px-6 -mt-2">
            <Alert className="border-yellow-500/50 bg-yellow-500/5">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-700 text-xs">{loginWarning}</AlertDescription>
            </Alert>
          </div>
        )}

        <CardContent>
          {/* ====== FORGOT PASSWORD ====== */}
          {mode === 'forgot-password' && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <div className="text-center mb-4">
                <div className="mx-auto mb-3 w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Masukkan nomor telepon yang terdaftar. Kode pemulihan akan dikirim via <strong>WhatsApp</strong>.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-phone">Nomor Telepon</Label>
                <Input
                  id="reset-phone"
                  type="tel"
                  inputMode="numeric"
                  value={resetPhone}
                  onChange={e => setResetPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  required
                  autoFocus
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Mengirim...</> : 'Kirim Kode via WhatsApp'}
              </Button>

              <Button type="button" variant="ghost" className="w-full" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Kembali ke Login
              </Button>
            </form>
          )}

          {/* ====== VERIFY CODE ====== */}
          {mode === 'verify-code' && (
            <form onSubmit={handleVerifyAndReset} className="space-y-4">
              <div className="text-center mb-4">
                <div className="mx-auto mb-3 w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center">
                  <KeyRound className="w-6 h-6 text-emerald-600" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Kode dikirim ke <strong>{resetPhone}</strong>
                </p>
              </div>

              <div className="flex justify-center">
                <InputOTP maxLength={6} value={recoveryCode} onChange={setRecoveryCode}>
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-password">Password Baru</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  required
                  minLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-new-password">Konfirmasi Password Baru</Label>
                <Input
                  id="confirm-new-password"
                  type="password"
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Memproses...</> : 'Reset Password'}
              </Button>

              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={handleResendCode}
                  disabled={codeCountdown > 0 || loading}
                >
                  {codeCountdown > 0
                    ? `Kirim ulang dalam ${codeCountdown}s`
                    : 'Kirim ulang kode'}
                </Button>
              </div>

              <Button type="button" variant="ghost" className="w-full" onClick={goBack}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Kembali ke Login
              </Button>
            </form>
          )}

          {/* ====== LOGIN & REGISTER ====== */}
          {(mode === 'login' || mode === 'register') && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Nama Lengkap</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Nama lengkap"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-phone">No. Telepon</Label>
                    <Input
                      id="reg-phone"
                      type="tel"
                      inputMode="numeric"
                      value={formData.phone}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="08xxxxxxxxxx"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role</Label>
                    <Select value={formData.role} onValueChange={v => {
                      setFormData({ ...formData, role: v, unitIds: [], unitId: '' });
                    }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRoles.map(r => (
                          <SelectItem key={r.value} value={r.value}>
                            <span>
                              <span className="font-medium">{r.label}</span>
                              <span className="text-xs text-muted-foreground">{r.description}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {superAdminExists && (
                      <p className="text-xs text-muted-foreground">
                        Role Super Admin sudah terdaftar dan tidak tersedia untuk pendaftaran baru.
                      </p>
                    )}
                  </div>

                  {/* ====== MULTI-UNIT SELECTION ====== */}
                  {formData.role !== 'super_admin' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />
                          Unit / Cabang
                        </Label>
                        {selectedCount > 0 && (
                          <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            {selectedCount} dipilih
                          </Badge>
                        )}
                      </div>

                      {units.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">Belum ada unit tersedia. Hubungi admin.</p>
                      ) : (
                        <ScrollArea className="max-h-40 rounded-md border p-2">
                          <div className="space-y-1.5">
                            {units.map((u: any) => {
                              const isSelected = (formData.unitIds || []).includes(u.id);
                              return (
                                <label
                                  key={u.id}
                                  className={cn(
                                    "flex items-center gap-2.5 rounded-md px-2.5 py-2 cursor-pointer transition-colors text-sm",
                                    isSelected
                                      ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100"
                                      : "hover:bg-muted"
                                  )}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleUnit(u.id)}
                                  />
                                  <span className="flex-1 truncate">{u.name}</span>
                                  {isSelected && (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </ScrollArea>
                      )}

                      <p className="text-xs text-muted-foreground">
                        {selectedCount === 0
                          ? 'Pilih minimal 1 unit'
                          : `${selectedCount} unit dipilih — kamu bisa mengakses data dari semua unit tersebut`
                        }
                      </p>
                    </div>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="email@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Memproses...' : mode === 'login' ? 'Masuk' : 'Daftar'}
              </Button>
            </form>
          )}

          {/* ====== BOTTOM LINKS ====== */}
          {(mode === 'login' || mode === 'register') && (
            <div className="mt-4 space-y-2">
              {mode === 'login' && (
                <div className="text-center">
                  <Button
                    variant="link"
                    className="text-muted-foreground hover:text-foreground text-sm"
                    onClick={() => setMode('forgot-password')}
                  >
                    Lupa Password?
                  </Button>
                </div>
              )}
              <div className="text-center">
                <Button
                  variant="link"
                  onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                >
                  {mode === 'login' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="absolute bottom-4 left-0 right-0 text-center">
        <p className="text-xs text-slate-500">
          made by <span className="font-semibold text-slate-400">HENRY ARTHANTO</span> with ❤️
        </p>
      </div>
    </div>
  );
}

export default LoginPage;

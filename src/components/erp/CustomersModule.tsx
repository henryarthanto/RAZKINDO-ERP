'use client';

import { useState } from 'react';
import { Search, Plus, Edit, Trash2, Phone, Mail, AlertOctagon, RotateCcw, X, ShoppingBag, Loader2, ChevronRight, Clock, Link2, Copy, Check, ShieldOff } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/erp-helpers';
import { Customer, Unit } from '@/types';
import { LoadingFallback } from '@/components/error-boundary';
import { apiFetch, ApiError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
  DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';

// Customer Form Component
function CustomerForm({ unitId, units, onSuccess, customer, salesUserId }: {
  unitId: string;
  units: Unit[];
  onSuccess: () => void;
  customer?: Customer;
  salesUserId?: string;
}) {
  const [formData, setFormData] = useState({
    name: customer?.name || '',
    phone: customer?.phone || '',
    email: customer?.email || '',
    address: customer?.address || '',
    notes: customer?.notes || '',
    unitId: customer?.unitId || unitId || '',
    distance: customer?.distance || 'near',
    cashbackType: (customer as any)?.cashbackType === 'fixed' ? 'fixed' : 'percentage',
    cashbackValue: String((customer as any)?.cashbackValue || 0),
  });
  const [loading, setLoading] = useState(false);
  const [dupWarning, setDupWarning] = useState<any>(null);
  const isEdit = !!customer?.id;
  
  // Always show unit selector when no unitId is pre-set (super_admin case)
  const needsUnitSelection = !unitId && !customer?.unitId;
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Nama pelanggan wajib diisi');
      return;
    }
    
    if (!formData.unitId) {
      toast.error('Pilih unit terlebih dahulu');
      return;
    }
    
    setLoading(true);
    
    try {
      const payload = {
        ...formData,
        cashbackValue: parseFloat(formData.cashbackValue) || 0,
      };
      if (isEdit) {
        await apiFetch(`/api/customers/${customer.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        toast.success('Pelanggan berhasil diupdate');
      } else {
        await apiFetch('/api/customers', {
          method: 'POST',
          body: JSON.stringify({ ...payload, assignedToId: salesUserId || null })
        });
        toast.success('Pelanggan berhasil ditambahkan');
      }
      onSuccess();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.details?.duplicate) {
        setDupWarning(err.details.duplicate);
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
      {needsUnitSelection && (
        <div className="space-y-2">
          <Label>Unit/Cabang *</Label>
          <Select value={formData.unitId} onValueChange={v => setFormData({ ...formData, unitId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih unit" />
            </SelectTrigger>
            <SelectContent>
              {units.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label>Nama</Label>
        <Input
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Telepon</Label>
          <Input
            value={formData.phone}
            onChange={e => setFormData({ ...formData, phone: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={e => setFormData({ ...formData, email: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Alamat</Label>
        <Textarea
          value={formData.address}
          onChange={e => setFormData({ ...formData, address: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Jarak Pengiriman</Label>
        <div className="grid grid-cols-2 gap-3">
          <div
            className={cn(
              'p-3 border-2 rounded-lg cursor-pointer text-center transition-all',
              formData.distance === 'near'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-muted hover:border-muted-foreground/30'
            )}
            onClick={() => setFormData({ ...formData, distance: 'near' })}
          >
            <p className="text-lg">📍</p>
            <p className="font-medium text-sm">Dekat</p>
            <p className="text-xs text-muted-foreground">Komisi kurir standar</p>
          </div>
          <div
            className={cn(
              'p-3 border-2 rounded-lg cursor-pointer text-center transition-all',
              formData.distance === 'far'
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30'
                : 'border-muted hover:border-muted-foreground/30'
            )}
            onClick={() => setFormData({ ...formData, distance: 'far' })}
          >
            <p className="text-lg">🗺️</p>
            <p className="font-medium text-sm">Jauh</p>
            <p className="text-xs text-muted-foreground">Komisi kurir lebih tinggi</p>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          💰 Pengaturan Cashback
        </Label>
        <p className="text-xs text-muted-foreground mb-2">
          Set cashback individual per pelanggan. Nilai cashback akan diberikan pada setiap order.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div
            className={cn(
              'p-3 border-2 rounded-lg cursor-pointer text-center transition-all',
              formData.cashbackType === 'percentage'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-muted hover:border-muted-foreground/30'
            )}
            onClick={() => setFormData({ ...formData, cashbackType: 'percentage' })}
          >
            <p className="text-lg">%</p>
            <p className="font-medium text-xs">Persentase</p>
            <p className="text-[10px] text-muted-foreground">dari total order</p>
          </div>
          <div
            className={cn(
              'p-3 border-2 rounded-lg cursor-pointer text-center transition-all',
              formData.cashbackType === 'fixed'
                ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                : 'border-muted hover:border-muted-foreground/30'
            )}
            onClick={() => setFormData({ ...formData, cashbackType: 'fixed' })}
          >
            <p className="text-lg">Rp</p>
            <p className="font-medium text-xs">Nominal</p>
            <p className="text-[10px] text-muted-foreground">tetap per order</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label>Nilai Cashback {formData.cashbackType === 'percentage' ? '(%)' : '(Rp)'}</Label>
          <Input
            type="number"
            value={formData.cashbackValue}
            onChange={e => setFormData({ ...formData, cashbackValue: e.target.value })}
            placeholder={formData.cashbackType === 'percentage' ? 'Contoh: 2' : 'Contoh: 5000'}
            min={0}
          />
          <p className="text-xs text-muted-foreground">
            {formData.cashbackType === 'percentage'
              ? `Contoh: 2% dari Rp500.000 = Rp${((2/100) * 500000).toLocaleString('id-ID')}`
              : `Contoh: Rp5.000 tetap setiap order`}
          </p>
        </div>
      </div>
      
      <DialogFooter className="shrink-0 pt-2">
        <Button type="submit" disabled={loading || (!formData.unitId && needsUnitSelection)}>
          {loading ? 'Menyimpan...' : isEdit ? 'Update' : 'Simpan'}
        </Button>
      </DialogFooter>

      {/* Duplicate Customer Warning Dialog */}
      <Dialog open={!!dupWarning} onOpenChange={(open) => { if (!open) setDupWarning(null); }}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertOctagon className="w-5 h-5" />
              Pelanggan Sudah Ada
            </DialogTitle>
            <DialogDescription>
              Data pelanggan ini sudah terdaftar di sistem
            </DialogDescription>
          </DialogHeader>
          {dupWarning && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Nama</span>
                  <span className="font-medium">{dupWarning.name}</span>
                </div>
                {dupWarning.phone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Telepon</span>
                    <span className="font-medium">{dupWarning.phone}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales</span>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {dupWarning.assignedTo?.name || 'Belum ada sales'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Pelanggan ini sudah diinput oleh <strong>{dupWarning.assignedTo?.name || 'Tidak ada sales'}</strong>.
                Hubungi super admin untuk mengalihkan pelanggan jika diperlukan.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupWarning(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

export default function CustomersModule() {
  const { user } = useAuthStore();
  const { units } = useUnitStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showLostCustomers, setShowLostCustomers] = useState(false);
  const [purchaseHistoryCustomer, setPurchaseHistoryCustomer] = useState<Customer | null>(null);

  const isSales = user?.role === 'sales';
  const isAdmin = user?.role === 'super_admin';
  const unitId = isSales ? user?.unitId : '';
  
  // Build query params
  // Sales see ALL customers in their unit; API returns restricted=true for non-owned
  const customerParams = new URLSearchParams();
  if (unitId) customerParams.set('unitId', unitId);
  if (statusFilter) customerParams.set('status', statusFilter);
  
  const { data, isLoading } = useQuery({
    queryKey: ['customers', unitId, user?.id, statusFilter],
    queryFn: async () => {
      return apiFetch<any>(`/api/customers?${customerParams.toString()}`);
    },
    ...POLLING_CONFIG
  });

  // Lost customers (super admin only)
  const { data: lostData } = useQuery({
    queryKey: ['customers-lost'],
    queryFn: async () => {
      return apiFetch<any>(`/api/customers/lost`);
    },
    enabled: isAdmin,
    ...POLLING_CONFIG,
    refetchInterval: 60000
  });
  const lostCustomers = isAdmin ? (Array.isArray(lostData?.customers) ? lostData.customers : []) : [];

  // Purchase History Query
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['customer-history', purchaseHistoryCustomer?.id],
    queryFn: () => apiFetch<any>(`/api/transactions?customerId=${purchaseHistoryCustomer!.id}&type=sale&limit=20`),
    enabled: !!purchaseHistoryCustomer,
  });
  const purchaseHistoryItems = Array.isArray(historyData?.transactions) ? historyData.transactions : [];

  const customers = (Array.isArray(data?.customers) ? data.customers : []).filter((c: Customer) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  
  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/customers/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Pelanggan berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeletingCustomer(null);
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });

  const handleDelete = () => {
    if (!deletingCustomer) return;
    deleteMutation.mutate(deletingCustomer.id);
  };

  // Recycle mutation
  const recycleMutation = useMutation({
    mutationFn: async (customerId: string) => {
      return apiFetch('/api/customers/recycle', {
        method: 'POST',
        body: JSON.stringify({ customerId })
      });
    },
    onSuccess: () => {
      toast.success('Pelanggan berhasil di-recycle');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-lost'] });
    },
    onError: (err: any) => {
      toast.error(err.message);
    }
  });
  
  if (isLoading) {
    return <LoadingFallback message="Memuat pelanggan..." />;
  }
  
  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* Lost Customers Banner (Super Admin) */}
      {isAdmin && lostCustomers.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 cursor-pointer" onClick={() => setShowLostCustomers(!showLostCustomers)}>
          <AlertOctagon className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">{lostCustomers.length} Pelanggan Lost</AlertTitle>
          <AlertDescription className="text-amber-700 text-xs">
            Klik untuk melihat dan me-recycle pelanggan lost
          </AlertDescription>
        </Alert>
      )}

      {/* Lost Customers Panel */}
      {showLostCustomers && isAdmin && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pelanggan Lost</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowLostCustomers(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {lostCustomers.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50 gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.assignedTo?.name ? `Sales: ${c.assignedTo.name}` : 'Tanpa sales'} • Lost: {c.lostAt ? formatDate(c.lostAt) : '-'}
                    </p>
                    {c.lostReason && <p className="text-xs text-red-500 mt-0.5">Alasan: {c.lostReason}</p>}
                  </div>
                  <Button size="sm" variant="outline" className="text-emerald-600" onClick={() => recycleMutation.mutate(c.id)} disabled={recycleMutation.isPending}>
                    <RotateCcw className="w-3 h-3 mr-1" />
                    {recycleMutation.isPending ? 'Memproses...' : 'Recycle'}
                  </Button>
                </div>
              ))}
              {lostCustomers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Tidak ada pelanggan lost</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[120px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cari pelanggan..."
            className="pl-9"
          />
        </div>


        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Pelanggan Baru
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-h-[90dvh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>Tambah Pelanggan</DialogTitle>
            </DialogHeader>
            <CustomerForm
              unitId={unitId || ''}
              units={units}
              salesUserId={isSales ? user?.id : undefined}
              onSuccess={() => {
                setShowCreate(false);
                queryClient.invalidateQueries({ queryKey: ['customers'] });
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3 px-2 sm:px-0 max-w-[85%] sm:max-w-full mx-auto sm:mx-0">
        {customers.map((c: any) => {
          const isRestricted = c.restricted === true;

          return (
          <Card key={c.id} className={cn("relative overflow-hidden", c.status === 'lost' && "opacity-60", isRestricted && "border-dashed border-muted-foreground/30")}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex justify-between items-start gap-1 mb-1.5">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                  {isRestricted && (
                    <ShieldOff className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                  )}
                  <h3 className="font-medium truncate min-w-0">{c.name}</h3>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs px-1.5 py-0 shrink-0",
                      c.distance === 'far'
                        ? "border-orange-300 text-orange-600 bg-orange-50"
                        : "border-emerald-300 text-emerald-600 bg-emerald-50"
                    )}
                  >
                    {c.distance === 'far' ? 'Jauh' : 'Dekat'}
                  </Badge>
                  {c.status === 'lost' && (
                    <Badge variant="destructive" className="text-xs shrink-0">Lost</Badge>
                  )}
                  {c.assignedTo && (
                    <Badge variant="outline" className={cn(
                      "text-xs shrink-0 max-w-[100px]",
                      isRestricted
                        ? "border-muted-foreground/40 text-muted-foreground bg-muted/50"
                        : "border-purple-200 text-purple-600 bg-purple-50"
                    )}>
                      <span className="truncate">{c.assignedTo.name}</span>
                    </Badge>
                  )}
                </div>
                {!isRestricted && (
                <div className="flex gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPurchaseHistoryCustomer(c)}>
                    <ShoppingBag className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingCustomer(c)}>
                    <Edit className="w-3 h-3" />
                  </Button>
                  {isAdmin && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => setDeletingCustomer(c)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                )}
              </div>

              {/* Restricted customer — only show sales name, hide all sensitive info */}
              {isRestricted ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                  <span className="shrink-0">Ditangani oleh</span>
                  <span className="font-medium truncate">{c.assignedTo?.name || '—'}</span>
                </div>
              ) : (
              <>
              <div className="space-y-1 text-sm">
                {c.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                    <Phone className="w-3 h-3 shrink-0" />
                    <span className="break-all">{c.phone}</span>
                  </div>
                )}
                {c.email && (
                  <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                    <Mail className="w-3 h-3 shrink-0" />
                    <span className="break-all">{c.email}</span>
                  </div>
                )}
              </div>
              <Separator className="my-3" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Order:</span>
                <span className="font-medium">{c.totalOrders}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Belanja:</span>
                <span className="font-medium">{formatCurrency(c.totalSpent)}</span>
              </div>
              {c.lastTransactionDate && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Transaksi Terakhir:</span>
                  <span className="font-medium text-xs">{formatDate(c.lastTransactionDate)}</span>
                </div>
              )}
              {/* Member Link */}
              {c.code && (
                <div className="mt-3 pt-2 border-t border-dashed">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                    <span className="text-muted-foreground shrink-0">Link:</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium overflow-hidden text-ellipsis whitespace-nowrap min-w-0">/c/{c.code}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => {
                        const link = `${window.location.origin}/c/${c.code}`;
                        navigator.clipboard.writeText(link).catch(() => {
                          toast.error('Gagal menyalin link');
                        });
                        setCopiedCode(c.code ?? null);
                        toast.success('Link member berhasil disalin!');
                        setTimeout(() => setCopiedCode(null), 2000);
                      }}
                    >
                      {copiedCode === c.code ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              )}
              </>
              )}
            </CardContent>
          </Card>
          );
        })}
      </div>
      
      {/* Edit Customer Dialog */}
      <Dialog open={!!editingCustomer} onOpenChange={(open) => { if (!open) setEditingCustomer(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full max-h-[90dvh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>Edit Pelanggan</DialogTitle>
          </DialogHeader>
          {editingCustomer && (
            <CustomerForm
              unitId={unitId || ''}
              units={units}
              customer={editingCustomer}
              salesUserId={isSales ? user?.id : undefined}
              onSuccess={() => {
                setEditingCustomer(null);
                queryClient.invalidateQueries({ queryKey: ['customers'] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      
      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingCustomer} onOpenChange={(open) => { if (!open) setDeletingCustomer(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Hapus Pelanggan</DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin menghapus pelanggan &quot;{deletingCustomer?.name}&quot;? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCustomer(null)} disabled={deleteMutation.isPending}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Purchase History Drawer */}
      <Drawer open={!!purchaseHistoryCustomer} onOpenChange={(open) => { if (!open) setPurchaseHistoryCustomer(null); }}>
        <DrawerContent className="max-h-[85dvh] rounded-t-3xl">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Riwayat Belanja</DrawerTitle>
            <DrawerDescription>{purchaseHistoryCustomer?.name} — riwayat transaksi penjualan</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pt-2 pb-3">
            <h3 className="text-base font-bold">Riwayat Belanja</h3>
            <p className="text-xs text-muted-foreground">{purchaseHistoryCustomer?.name} — hanya transaksi pelanggan ini</p>
          </div>
          <ScrollArea className="max-h-[60dvh] px-4">
            <div className="pb-4 space-y-2">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : purchaseHistoryItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ShoppingBag className="w-10 h-10 mb-3 opacity-20" />
                  <p className="text-sm">Belum ada transaksi</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-2">{purchaseHistoryItems.length} transaksi ditemukan</p>
                  {purchaseHistoryItems.map((tx: any) => (
                    <div key={tx.id} className="border rounded-xl p-3 bg-card space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{tx.invoiceNo}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge variant={tx.paymentStatus === 'paid' ? 'default' : tx.paymentStatus === 'partial' ? 'secondary' : 'outline'} className="text-[10px]">
                              {tx.paymentStatus === 'paid' ? 'Lunas' : tx.paymentStatus === 'partial' ? 'Sebagian' : 'Belum Bayar'}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              {formatDate(tx.transactionDate)}
                            </span>
                          </div>
                        </div>
                        <p className="font-bold text-sm tabular-nums shrink-0">{formatCurrency(tx.total)}</p>
                      </div>
                      {tx.items && tx.items.length > 0 && (
                        <p className="text-xs text-muted-foreground truncate">
                          {tx.items.map((it: any) => `${it.productName} x${it.qty}`).join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

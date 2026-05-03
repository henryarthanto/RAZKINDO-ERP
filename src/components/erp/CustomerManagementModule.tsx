'use client';

import { useState } from 'react';
import {
  Search, Plus, Edit, Trash2, Phone, Mail, AlertOctagon, RotateCcw, X,
  Eye, UserCheck, AlertTriangle,
  PhoneCall, MessageSquare, MapPin,
  ArrowRightLeft, Users, Clock,
  TrendingUp, RefreshCw,
  MessageCircle, Check, ShoppingBag, Loader2,
  Download,
  Link2, Copy,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/erp-helpers';
import { Customer, Unit } from '@/types';
import { LoadingFallback } from '@/components/error-boundary';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getTransactionStatusLabel, TransactionStatusBadge } from '@/components/erp/SharedComponents';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription
} from '@/components/ui/sheet';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
  DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';

// ============ TYPE DEFINITIONS ============
interface MonitoringCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  distance: string;
  totalOrders: number;
  totalSpent: number;
  assignedTo: { id: string; name: string; phone: string | null } | null;
  unit: { id: string; name: string } | null;
  lastTransactionDate: string | null;
  lastFollowUpDate: string | null;
  lostAt: string | null;
  lostReason: string | null;
  createdAt: string;
  daysSinceTransaction: number;
  daysSinceFollowUp: number | null;
  riskLevel: string;
  totalFollowUps: number;
  totalTransactions: number;
  recentFollowUps: {
    id: string;
    type: string;
    note: string;
    outcome: string | null;
    createdAt: string;
    createdBy: { id: string; name: string; role: string };
  }[];
}

interface SalesActivity {
  id: string;
  name: string;
  totalCustomers: number;
  totalFollowUps: number;
  monthlyFollowUps: number;
}

interface FollowUpActivity {
  id: string;
  type: string;
  note: string;
  outcome: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; role: string };
  customer: { id: string; name: string; assignedTo: { id: string; name: string } | null };
}

// ============ RISK BADGE ============
function RiskBadge({ level }: { level: string }) {
  switch (level) {
    case 'critical':
      return <Badge className="bg-red-600 text-white text-xs">Kritis (90d+)</Badge>;
    case 'high':
      return <Badge className="bg-orange-500 text-white text-xs">Tinggi (60d+)</Badge>;
    case 'medium':
      return <Badge className="bg-amber-500 text-white text-xs">Sedang (30d+)</Badge>;
    case 'low':
      return <Badge className="bg-green-500 text-white text-xs">Rendah</Badge>;
    case 'lost':
      return <Badge className="bg-gray-500 text-white text-xs">Lost</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{level}</Badge>;
  }
}

// ============ FOLLOW UP TYPE ICON ============
function FollowUpTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'call':
      return <PhoneCall className="w-3.5 h-3.5 text-blue-500" />;
    case 'whatsapp':
      return <MessageSquare className="w-3.5 h-3.5 text-green-500" />;
    case 'visit':
      return <MapPin className="w-3.5 h-3.5 text-orange-500" />;
    case 'email':
      return <Mail className="w-3.5 h-3.5 text-purple-500" />;
    default:
      return <MessageCircle className="w-3.5 h-3.5 text-gray-500" />;
  }
}

// ============ CUSTOMER FORM COMPONENT (from CustomersModule) ============
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
  const [takeOverLoading, setTakeOverLoading] = useState(false);
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
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
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

  // Take over handler — reassign duplicate customer to the target sales
  const handleTakeOver = async () => {
    if (!dupWarning) return;
    setTakeOverLoading(true);
    try {
      await apiFetch(`/api/customers/${dupWarning.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedToId: salesUserId || null })
      });
      toast.success(`Pelanggan "${dupWarning.name}" berhasil dialihkan`);
      setDupWarning(null);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setTakeOverLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={loading || (!formData.unitId && needsUnitSelection)}>
          {loading ? 'Menyimpan...' : isEdit ? 'Update' : 'Simpan'}
        </Button>
      </div>

      {/* Duplicate Customer Warning — with Take Over option for Super Admin */}
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
                  <span className="text-muted-foreground">Sales Saat Ini</span>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {dupWarning.assignedTo?.name || 'Belum ada sales'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Pelanggan ini sudah diinput oleh <strong>{dupWarning.assignedTo?.name || 'Tidak ada sales'}</strong>.
              </p>
            </div>
          )}
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="default"
              className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700"
              disabled={takeOverLoading}
              onClick={handleTakeOver}
            >
              {takeOverLoading ? 'Mengalihkan...' : 'Take Over Pelanggan'}
            </Button>
            <Button variant="outline" onClick={() => setDupWarning(null)}>
              Batal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

// ============ VIEW SELECT OPTIONS CONFIG ============
const viewOptions = [
  { value: 'pelanggan', label: 'Pelanggan', icon: Users },
  { value: 'ringkasan', label: 'Ringkasan Sales', icon: TrendingUp },
  { value: 'aktivitas', label: 'Aktivitas Follow Up', icon: Clock },
] as const;

// ============ FOLLOW UP OUTCOME OPTIONS ============
const followUpOutcomes = [
  { value: 'interested', label: 'Tertarik' },
  { value: 'not_interested', label: 'Tidak Tertarik' },
  { value: 'promised_to_order', label: 'Janji Order' },
  { value: 'no_response', label: 'Tidak Ada Respon' },
  { value: 'rescheduled', label: 'Dijadwalkan Ulang' },
  { value: 'other', label: 'Lainnya' },
] as const;

// ============ MAIN COMPONENT ============
export default function CustomerManagementModule() {
  const { user } = useAuthStore();
  const { units, selectedUnitId } = useUnitStore();
  const queryClient = useQueryClient();

  // ---- Pelanggan (Customer) Tab State ----
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [generatingCodeFor, setGeneratingCodeFor] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('active');
  const [showLostCustomers, setShowLostCustomers] = useState(false);

  // ---- Monitoring Tab State ----
  const [monitoringTab, setMonitoringTab] = useState<string>('overview');
  const [inactiveStatusFilter, setInactiveStatusFilter] = useState<string>('all');
  const [salesFilter, setSalesFilter] = useState<string>('all');
  const [monitoringSearch, setMonitoringSearch] = useState('');
  const [monitoringPage, setMonitoringPage] = useState(1);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);

  // Reassign dialog state
  const [reassignOpen, setReassignOpen] = useState<MonitoringCustomer | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignLoading, setReassignLoading] = useState(false);

  // Follow-up detail dialog state
  const [followUpDetailOpen, setFollowUpDetailOpen] = useState<MonitoringCustomer | null>(null);

  // ---- Main active tab ----
  const [activeTab, setActiveTab] = useState<string>('pelanggan');

  // ---- Purchase History Drawer state ----
  const [purchaseHistoryCustomer, setPurchaseHistoryCustomer] = useState<Customer | null>(null);

  // ---- Follow Up Drawer state ----
  const [followUpCustomer, setFollowUpCustomer] = useState<Customer | null>(null);
  const [followUpForm, setFollowUpForm] = useState({ type: 'whatsapp', note: '', outcome: '' });
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const isAdmin = user?.role === 'super_admin';
  // Validate selectedUnitId against actual units list (prevent stale ID from localStorage)
  const validUnitId = units.some(u => u.id === selectedUnitId) ? selectedUnitId : '';
  const unitId = validUnitId || ''; // Super admin can have empty unit

  // ========== CUSTOMER QUERY (from CustomersModule) ==========
  const customerParams = new URLSearchParams();
  if (statusFilter) customerParams.set('status', statusFilter);
  if (validUnitId) customerParams.set('unitId', validUnitId);

  const { data: customerData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', user?.id, statusFilter, validUnitId],
    queryFn: async () => {
      return apiFetch<any>(`/api/customers?${customerParams.toString()}`);
    },
    ...POLLING_CONFIG
  });

  // Lost customers
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

  const customers = (Array.isArray(customerData?.customers) ? customerData.customers : []).filter((c: Customer) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  // ========== EXPORT CUSTOMERS CSV ==========
  const exportCustomersCSV = () => {
    const allCustomers = Array.isArray(customerData?.customers) ? customerData.customers : [];
    if (allCustomers.length === 0) {
      toast.error('Tidak ada data pelanggan untuk diexport');
      return;
    }
    const headers = ['Nama', 'Telepon', 'Email', 'Alamat', 'Unit', 'Sales', 'Jarak', 'Total Order', 'Total Belanja', 'Status', 'Transaksi Terakhir', 'Dibuat'];
    const rows = allCustomers.map((c: Customer) => [
      c.name,
      c.phone || '-',
      c.email || '-',
      c.address || '-',
      c.unit?.name || '-',
      c.assignedTo?.name || '-',
      c.distance === 'far' ? 'Jauh' : 'Dekat',
      c.totalOrders,
      c.totalSpent,
      c.status === 'active' ? 'Aktif' : c.status === 'lost' ? 'Lost' : 'Tidak Aktif',
      c.lastTransactionDate ? formatDate(c.lastTransactionDate) : '-',
      c.createdAt ? formatDate(c.createdAt) : '-',
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map((r: any[]) => r.map((v: any) => {
        const s = String(v ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
        return s;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pelanggan_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success(`${allCustomers.length} pelanggan berhasil didownload`);
  };

  // ========== MONITORING QUERY (from CustomerMonitoringModule) ==========
  const { data: monitoringData, isLoading: monitoringLoading, error: monitoringError, refetch: refetchMonitoring } = useQuery({
    queryKey: ['customer-monitoring', validUnitId, inactiveStatusFilter, salesFilter, monitoringPage],
    queryFn: () => {
      const params = new URLSearchParams();
      if (validUnitId) params.set('unitId', validUnitId);
      if (inactiveStatusFilter !== 'all') params.set('status', inactiveStatusFilter);
      if (salesFilter !== 'all') params.set('salesId', salesFilter);
      params.set('page', monitoringPage.toString());
      params.set('limit', '50');
      return apiFetch<any>(`/api/superadmin/monitoring?${params.toString()}`);
    },
    enabled: isAdmin,
    retry: 1,
    staleTime: 0,
    refetchInterval: false
  });

  const summary = monitoringData?.summary || {};
  const salesActivity: SalesActivity[] = Array.isArray(monitoringData?.salesActivity) ? monitoringData.salesActivity : [];
  const inactiveCustomers: MonitoringCustomer[] = Array.isArray(monitoringData?.customers) ? monitoringData.customers : [];
  const pagination = monitoringData?.pagination || {};
  const recentActivity: FollowUpActivity[] = Array.isArray(monitoringData?.recentActivity) ? monitoringData.recentActivity : [];

  // ========== PURCHASE HISTORY QUERY ==========
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['customer-history', purchaseHistoryCustomer?.id],
    queryFn: () => apiFetch<any>(`/api/transactions?customerId=${purchaseHistoryCustomer!.id}&type=sale&limit=20`),
    enabled: !!purchaseHistoryCustomer,
  });
  const purchaseHistoryItems = Array.isArray(historyData?.transactions) ? historyData.transactions : Array.isArray(historyData?.data) ? historyData.data : [];

  // Filter inactive customers by search (client-side)
  const filteredInactiveCustomers = inactiveCustomers.filter(c => {
    if (!monitoringSearch.trim()) return true;
    const q = monitoringSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone && c.phone.includes(q)) ||
      (c.assignedTo?.name && c.assignedTo.name.toLowerCase().includes(q))
    );
  });

  // ========== HANDLERS ==========

  // Customer CRUD
  const handleDelete = async () => {
    if (!deletingCustomer) return;
    try {
      await apiFetch(`/api/customers/${deletingCustomer.id}`, { method: 'DELETE' });
      toast.success('Pelanggan berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeletingCustomer(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRecycle = async (customerId: string) => {
    try {
      await apiFetch('/api/customers/recycle', {
        method: 'POST',
        body: JSON.stringify({ customerId })
      });
      toast.success('Pelanggan berhasil di-recycle');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customers-lost'] });
      queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Reassign handler
  const handleReassign = async () => {
    if (!reassignOpen) return;
    setReassignLoading(true);
    try {
      await apiFetch('/api/superadmin/monitoring/reassign', {
        method: 'POST',
        body: JSON.stringify({
          customerId: reassignOpen.id,
          newAssignedToId: reassignTarget || null,
          reason: reassignReason
        })
      });
      toast.success(`${reassignOpen.name} berhasil dialihkan`);
      setReassignOpen(null);
      setReassignTarget('');
      setReassignReason('');
      queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengalihkan pelanggan');
    } finally {
      setReassignLoading(false);
    }
  };

  // Follow-up submit handler
  const handleFollowUpSubmit = async () => {
    if (!followUpCustomer) return;
    if (!followUpForm.outcome) {
      toast.error('Pilih hasil follow up');
      return;
    }
    setFollowUpLoading(true);
    try {
      await apiFetch(`/api/customers/${followUpCustomer.id}/follow-up`, {
        method: 'POST',
        body: JSON.stringify({
          type: followUpForm.type,
          note: followUpForm.note,
          outcome: followUpForm.outcome,
        }),
      });
      toast.success(`Follow up untuk ${followUpCustomer.name} berhasil dicatat`);
      setFollowUpCustomer(null);
      setFollowUpForm({ type: 'whatsapp', note: '', outcome: '' });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
      queryClient.invalidateQueries({ queryKey: ['customer-history'] });
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan follow up');
    } finally {
      setFollowUpLoading(false);
    }
  };

  // ========== LOADING STATE ==========
  // Show loading only if both queries are loading (first load for summary)
  const isInitialLoading = customersLoading && (activeTab === 'pelanggan');

  if (isInitialLoading) {
    return <LoadingFallback message="Memuat data pelanggan..." />;
  }

  // Current view icon helper
  const currentViewOption = viewOptions.find(v => v.value === activeTab);
  const CurrentViewIcon = currentViewOption?.icon || Users;

  return (
    <div className="space-y-3 overflow-x-hidden">
      {/* ============ SUMMARY CARDS (always visible) ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2 sm:gap-3">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Pelanggan</p>
            <p className="text-lg sm:text-xl font-bold text-slate-700 dark:text-slate-300">{summary.totalCustomers || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Aktif</p>
            <p className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-300">{summary.totalActive || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">30 Hari+</p>
            <p className="text-lg sm:text-xl font-bold text-amber-700 dark:text-amber-300">{summary.totalInactive30d || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950 dark:to-orange-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">60 Hari+</p>
            <p className="text-lg sm:text-xl font-bold text-orange-700 dark:text-orange-300">{summary.totalInactive60d || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">90 Hari+ (Kritis)</p>
            <p className="text-lg sm:text-xl font-bold text-red-700 dark:text-red-300">{summary.totalInactive90d || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Belum Follow Up</p>
            <p className="text-lg sm:text-xl font-bold text-purple-700 dark:text-purple-300">{summary.totalNoFollowUp || 0}</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Lost</p>
            <p className="text-lg sm:text-xl font-bold text-gray-700 dark:text-gray-300">{summary.totalLost || 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* ============ LOST CUSTOMERS BANNER ============ */}
      {isAdmin && lostCustomers.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50 cursor-pointer" onClick={() => setShowLostCustomers(!showLostCustomers)}>
          <AlertOctagon className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-800">{lostCustomers.length} Pelanggan Lost</AlertTitle>
          <AlertDescription className="text-amber-700 text-xs">
            Klik untuk melihat dan me-recycle pelanggan lost
          </AlertDescription>
        </Alert>
      )}

      {/* ============ LOST CUSTOMERS PANEL ============ */}
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
                  <Button size="sm" variant="outline" className="text-emerald-600 shrink-0" onClick={() => handleRecycle(c.id)}>
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Recycle
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

      {/* ============ VIEW SELECT DROPDOWN ============ */}
      <Select value={activeTab} onValueChange={(v) => { setActiveTab(v); }}>
        <SelectTrigger className="w-full h-12 text-sm font-medium">
          <div className="flex items-center gap-2">
            <CurrentViewIcon className="w-4 h-4 shrink-0" />
            <SelectValue />
          </div>
        </SelectTrigger>
        <SelectContent>
          {viewOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* ============ TAB CONTENT: CONDITIONAL RENDERING ============ */}

      {/* ============ VIEW 1: PELANGGAN (Customer List + CRUD) ============ */}
      {activeTab === 'pelanggan' && (
        <div className="space-y-4">
          {/* Customer Search + Filter + Create */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 relative min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari pelanggan..."
                className="pl-9"
              />
            </div>

            <Button variant="outline" size="sm" onClick={exportCustomersCSV} className="gap-1.5">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Download CSV</span>
            </Button>

            {isAdmin && (
              <Button variant="outline" size="sm" className="gap-1.5 text-blue-600 border-blue-200"
                disabled={generatingCodeFor === 'all'}
                onClick={async () => {
                  if (!confirm('Buat link member untuk semua pelanggan yang belum punya?')) return;
                  setGeneratingCodeFor('all');
                  try {
                    const res = await apiFetch<any>('/api/customers/generate-codes', { method: 'POST' });
                    toast.success(res.message || `${res.updated || 0} pelanggan berhasil`);
                    queryClient.invalidateQueries({ queryKey: ['customers'] });
                  } catch (err: any) {
                    toast.error(err.message);
                  } finally {
                    setGeneratingCodeFor(null);
                  }
                }}
              >
                {generatingCodeFor === 'all' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                <span className="hidden sm:inline">Generate Semua Link</span>
              </Button>
            )}

            <Sheet open={showCreate} onOpenChange={setShowCreate}>
              <SheetTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Pelanggan Baru
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-hidden">
                <SheetHeader className="shrink-0">
                  <SheetTitle>Tambah Pelanggan</SheetTitle>
                  <SheetDescription>Isi data pelanggan baru</SheetDescription>
                </SheetHeader>
                <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain px-4 pb-4">
                  <CustomerForm
                    unitId={unitId || ''}
                    units={units}
                    salesUserId={undefined}
                    onSuccess={() => {
                      setShowCreate(false);
                      queryClient.invalidateQueries({ queryKey: ['customers'] });
                      queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
                    }}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Customer Cards Grid */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
            {customers.map((c: Customer) => (
              <Card key={c.id} className={cn("relative", c.status === 'lost' && "opacity-60")}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex justify-between items-start mb-1.5 gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                      <h3 className="font-medium truncate text-sm">{c.name}</h3>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs px-1.5 py-0",
                          c.distance === 'far'
                            ? "border-orange-300 text-orange-600 bg-orange-50"
                            : "border-emerald-300 text-emerald-600 bg-emerald-50"
                        )}
                      >
                        {c.distance === 'far' ? 'Jauh' : 'Dekat'}
                      </Badge>
                      {c.status === 'lost' && (
                        <Badge variant="destructive" className="text-xs">Lost</Badge>
                      )}
                      {c.assignedTo && (
                        <Badge variant="outline" className="text-xs border-purple-200 text-purple-600 bg-purple-50">
                          {c.assignedTo.name}
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-0.5 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPurchaseHistoryCustomer(c)}>
                        <ShoppingBag className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600" onClick={() => { setFollowUpCustomer(c); setFollowUpForm({ type: 'whatsapp', note: '', outcome: '' }); }}>
                        <PhoneCall className="w-3 h-3" />
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
                  </div>
                  <div className="space-y-0.5 text-xs sm:text-sm">
                    {c.phone && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.phone}</span>
                      </div>
                    )}
                    {c.email && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <Mail className="w-3 h-3 shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </div>
                    )}
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-muted-foreground">Total Order:</span>
                    <span className="font-medium">{c.totalOrders}</span>
                  </div>
                  <div className="flex justify-between text-xs sm:text-sm">
                    <span className="text-muted-foreground">Total Belanja:</span>
                    <span className="font-medium">{formatCurrency(c.totalSpent)}</span>
                  </div>
                  {c.lastTransactionDate && (
                    <div className="flex justify-between text-xs sm:text-sm">
                      <span className="text-muted-foreground">Transaksi Terakhir:</span>
                      <span className="font-medium text-[11px]">{formatDate(c.lastTransactionDate)}</span>
                    </div>
                  )}
                  {/* Member Link */}
                  {c.code ? (
                    <div className="mt-2 pt-1.5 border-t border-dashed">
                      <div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
                        <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="text-muted-foreground shrink-0">Link Member:</span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium truncate">/c/{c.code}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 shrink-0"
                          onClick={() => {
                            const link = `${window.location.origin}/c/${c.code}`;
                            navigator.clipboard.writeText(link);
                            setCopiedCode(c.code ?? null);
                            toast.success('Link member berhasil disalin!');
                            setTimeout(() => setCopiedCode(null), 2000);
                          }}
                        >
                          {copiedCode === c.code ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  ) : isAdmin ? (
                    <div className="mt-2 pt-1.5 border-t border-dashed">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] gap-1 text-blue-600 hover:text-blue-700"
                        disabled={generatingCodeFor === c.id}
                        onClick={async () => {
                          setGeneratingCodeFor(c.id);
                          try {
                            await apiFetch('/api/customers/generate-codes', {
                              method: 'POST',
                              body: JSON.stringify({ customerId: c.id })
                            });
                            toast.success(`Link member untuk ${c.name} berhasil dibuat`);
                            queryClient.invalidateQueries({ queryKey: ['customers'] });
                          } catch (err: any) {
                            toast.error(err.message);
                          } finally {
                            setGeneratingCodeFor(null);
                          }
                        }}
                      >
                        {generatingCodeFor === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                        Buat Link Member
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ============ VIEW 2: RINGKASAN SALES (Sales Overview) ============ */}
      {activeTab === 'ringkasan' && (
        <div className="space-y-3">
          {monitoringLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="animate-pulse h-32 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : monitoringError ? (
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="p-6 text-center">
                <AlertTriangle className="w-8 h-8 mx-auto text-red-500 mb-2" />
                <p className="text-sm text-red-600 font-medium">Gagal memuat data monitoring</p>
                <p className="text-xs text-muted-foreground mt-1">{monitoringError instanceof Error ? monitoringError.message : 'Terjadi kesalahan'}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => refetchMonitoring()}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Coba Lagi
                </Button>
              </CardContent>
            </Card>
          ) : salesActivity.length === 0 && (summary.totalCustomers || 0) === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada data</p>
                <p className="text-xs text-muted-foreground mt-1">Tambahkan pelanggan dan user sales melalui menu masing-masing untuk mulai monitoring.</p>
              </CardContent>
            </Card>
          ) : salesActivity.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada data sales</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {salesActivity.map((s) => (
                <Card key={s.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <UserCheck className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-medium text-sm">{s.name}</h3>
                          <p className="text-xs text-muted-foreground">{s.totalCustomers} pelanggan</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => { setSalesFilter(s.id); setMonitoringPage(1); }}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        Lihat
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center p-2 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Total Follow Up</p>
                        <p className="font-bold text-sm">{s.totalFollowUps}</p>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Bulan Ini</p>
                        <p className={cn('font-bold text-sm', s.monthlyFollowUps > 0 ? 'text-green-600' : 'text-red-500')}>
                          {s.monthlyFollowUps}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}



      {/* ============ VIEW 4: AKTIVITAS (Follow-up Activity) ============ */}
      {activeTab === 'aktivitas' && (
        <div className="space-y-3">
          {monitoringLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="animate-pulse h-20 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : monitoringError ? (
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="p-6 text-center">
                <AlertTriangle className="w-8 h-8 mx-auto text-red-500 mb-2" />
                <p className="text-sm text-red-600 font-medium">Gagal memuat data monitoring</p>
                <p className="text-xs text-muted-foreground mt-1">{monitoringError instanceof Error ? monitoringError.message : 'Terjadi kesalahan'}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => refetchMonitoring()}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Coba Lagi
                </Button>
              </CardContent>
            </Card>
          ) : recentActivity.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center">
                <Clock className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada aktivitas follow-up dalam 7 hari terakhir</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                <span>{recentActivity.length} aktivitas follow-up dalam 7 hari terakhir</span>
              </div>
              <div className="space-y-2">
                {recentActivity.map((a) => (
                  <Card key={a.id} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <FollowUpTypeIcon type={a.type} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{a.createdBy.name}</span>
                            <Badge variant="outline" className="text-xs">{a.type}</Badge>
                            {a.outcome && (
                              <Badge variant="secondary" className="text-xs">{followUpOutcomes.find(o => o.value === a.outcome)?.label || a.outcome.replace(/_/g, ' ')}</Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1">{a.note}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                            <span>Pelanggan: <strong className="text-foreground">{a.customer.name}</strong></span>
                            {a.customer.assignedTo && (
                              <span>• Sales: {a.customer.assignedTo.name}</span>
                            )}
                            <span>• {formatDateTime(a.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ============ EDIT CUSTOMER SHEET ============ */}
      <Sheet open={!!editingCustomer} onOpenChange={(open) => { if (!open) setEditingCustomer(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92dvh] overflow-hidden">
          <SheetHeader className="shrink-0">
            <SheetTitle>Edit Pelanggan</SheetTitle>
            <SheetDescription>Ubah data pelanggan</SheetDescription>
          </SheetHeader>
          <div className="overflow-y-auto flex-1 min-h-0 overscroll-contain px-4 pb-4">
            {editingCustomer && (
              <CustomerForm
                unitId={unitId || ''}
                units={units}
                customer={editingCustomer}
                salesUserId={undefined}
                onSuccess={() => {
                  setEditingCustomer(null);
                  queryClient.invalidateQueries({ queryKey: ['customers'] });
                  queryClient.invalidateQueries({ queryKey: ['customer-monitoring'] });
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ============ DELETE CONFIRMATION DIALOG ============ */}
      <Dialog open={!!deletingCustomer} onOpenChange={(open) => { if (!open) setDeletingCustomer(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Hapus Pelanggan</DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin menghapus pelanggan &quot;{deletingCustomer?.name}&quot;? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingCustomer(null)}>Batal</Button>
            <Button variant="destructive" onClick={handleDelete}>Hapus</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ REASSIGN DIALOG ============ */}
      <Dialog open={!!reassignOpen} onOpenChange={(open) => { if (!open) { setReassignOpen(null); setReassignTarget(''); setReassignReason(''); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5" />
              Alihkan Pelanggan
            </DialogTitle>
            <DialogDescription>
              {reassignOpen?.name} — saat ini: {reassignOpen?.assignedTo?.name || 'Tanpa sales'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Warning if critical */}
            {reassignOpen && reassignOpen.riskLevel === 'critical' && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
                <AlertOctagon className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Pelanggan ini sudah <strong>{reassignOpen.daysSinceTransaction} hari</strong> tidak bertransaksi. Pertimbangkan untuk menindaklanjuti segera.</span>
              </div>
            )}

            <div className="space-y-2">
              <Label>Pindah ke Sales</Label>
              <Select value={reassignTarget} onValueChange={setReassignTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih sales..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Tanpa Sales —</SelectItem>
                  {salesActivity.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.totalCustomers} pelanggan)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Alasan Pengalihan (opsional)</Label>
              <Textarea
                value={reassignReason}
                onChange={(e) => setReassignReason(e.target.value)}
                placeholder="Contoh: Sales lama tidak aktif, pelanggan request ganti sales..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReassignOpen(null); setReassignTarget(''); setReassignReason(''); }}>
              Batal
            </Button>
            <Button onClick={handleReassign} disabled={reassignLoading}>
              {reassignLoading ? 'Mengalihkan...' : 'Alihkan Pelanggan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ FOLLOW-UP HISTORY DIALOG ============ */}
      <Dialog open={!!followUpDetailOpen} onOpenChange={(open) => { if (!open) setFollowUpDetailOpen(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[80dvh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Riwayat Follow Up
            </DialogTitle>
            <DialogDescription>
              {followUpDetailOpen?.name} — {followUpDetailOpen?.totalFollowUps}x follow up
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {followUpDetailOpen && followUpDetailOpen.totalFollowUps === 0 ? (
              <div className="text-center py-8">
                <PhoneCall className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada riwayat follow up untuk pelanggan ini</p>
              </div>
            ) : (
              <ScrollArea className="h-72">
                <div className="space-y-2 pr-2">
                  {followUpDetailOpen?.recentFollowUps.map((fu) => (
                    <div key={fu.id} className="p-3 rounded-lg border">
                      <div className="flex items-start gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <FollowUpTypeIcon type={fu.type} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{fu.createdBy.name}</span>
                            <Badge variant="outline" className="text-xs">{fu.type}</Badge>
                            {fu.outcome && (
                              <Badge variant="secondary" className="text-xs">{followUpOutcomes.find(o => o.value === fu.outcome)?.label || fu.outcome.replace(/_/g, ' ')}</Badge>
                            )}
                          </div>
                          <p className="text-sm mt-1">{fu.note}</p>
                          <p className="text-xs text-muted-foreground mt-1">{formatDateTime(fu.createdAt)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpDetailOpen(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ PURCHASE HISTORY DRAWER ============ */}
      <Drawer open={!!purchaseHistoryCustomer} onOpenChange={(open) => { if (!open) setPurchaseHistoryCustomer(null); }}>
        <DrawerContent>
          <DrawerHeader className="border-b">
            <DrawerTitle className="flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" />
              Riwayat Belanja
            </DrawerTitle>
            <DrawerDescription>
              {purchaseHistoryCustomer?.name} — riwayat transaksi penjualan
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 py-3 overflow-y-auto" style={{ maxHeight: '60dvh' }}>
            {historyLoading ? (
              <div className="space-y-3 py-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="animate-pulse h-20 bg-muted rounded-lg" />
                ))}
              </div>
            ) : purchaseHistoryItems.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingBag className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Belum ada riwayat transaksi untuk pelanggan ini</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-2">{purchaseHistoryItems.length} transaksi ditemukan</p>
                {purchaseHistoryItems.map((tx: any) => (
                  <div key={tx.id} className="p-3 rounded-lg border">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{tx.invoiceNumber || tx.id}</span>
                          <TransactionStatusBadge status={tx.status} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDate(tx.date || tx.createdAt)}
                        </p>
                        {tx.paymentMethod && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Pembayaran: {getTransactionStatusLabel(tx.paymentMethod) || tx.paymentMethod}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm">{formatCurrency(tx.total || tx.finalTotal || 0)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DrawerFooter className="border-t">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Tutup</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* ============ FOLLOW UP DRAWER ============ */}
      <Drawer open={!!followUpCustomer} onOpenChange={(open) => { if (!open) { setFollowUpCustomer(null); setFollowUpForm({ type: 'whatsapp', note: '', outcome: '' }); } }}>
        <DrawerContent>
          <DrawerHeader className="border-b">
            <DrawerTitle className="flex items-center gap-2">
              <PhoneCall className="w-5 h-5" />
              Follow Up Pelanggan
            </DrawerTitle>
            <DrawerDescription>
              {followUpCustomer?.name} {followUpCustomer?.phone ? `— ${followUpCustomer.phone}` : ''}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 py-4 space-y-4">
            {/* Contact Type Buttons */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Metode Follow Up</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { type: 'call', icon: PhoneCall, label: 'Call', color: 'blue', activeClass: 'bg-blue-100 dark:bg-blue-950/40 border-blue-400 text-blue-700 dark:text-blue-300' },
                  { type: 'whatsapp', icon: MessageSquare, label: 'WA', color: 'green', activeClass: 'bg-green-100 dark:bg-green-950/40 border-green-400 text-green-700 dark:text-green-300' },
                  { type: 'visit', icon: MapPin, label: 'Visit', color: 'orange', activeClass: 'bg-orange-100 dark:bg-orange-950/40 border-orange-400 text-orange-700 dark:text-orange-300' },
                  { type: 'email', icon: Mail, label: 'Email', color: 'purple', activeClass: 'bg-purple-100 dark:bg-purple-950/40 border-purple-400 text-purple-700 dark:text-purple-300' },
                ].map(({ type, icon: Icon, label, activeClass }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFollowUpForm({ ...followUpForm, type })}
                    className={cn(
                      'flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium',
                      followUpForm.type === type
                        ? activeClass
                        : 'border-muted hover:border-muted-foreground/30 text-muted-foreground'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Catatan</Label>
              <Textarea
                value={followUpForm.note}
                onChange={(e) => setFollowUpForm({ ...followUpForm, note: e.target.value })}
                placeholder="Tuliskan catatan follow up..."
                rows={3}
              />
            </div>

            {/* Outcome */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Hasil Follow Up</Label>
              <Select value={followUpForm.outcome} onValueChange={(v) => setFollowUpForm({ ...followUpForm, outcome: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih hasil..." />
                </SelectTrigger>
                <SelectContent>
                  {followUpOutcomes.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DrawerFooter className="border-t">
            <Button
              onClick={handleFollowUpSubmit}
              disabled={followUpLoading || !followUpForm.outcome}
              className="w-full"
            >
              {followUpLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Simpan Follow Up
                </>
              )}
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Batal</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

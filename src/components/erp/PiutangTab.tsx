'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, toLocalDateStr } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';
import { LoadingFallback } from '@/components/error-boundary';

import {
  FileText,
  AlertCircle,
  Clock,
  Check,
  RefreshCw,
  Search,
  Eye,
  Phone,
  UserRound,
  Calendar,
  ArrowRight,
  Timer,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

// ================================
// PIUTANG TAB (ACCOUNTS RECEIVABLE)
// ================================

export default function PiutangTab({ receivables, stats, userId, queryClient, isLoading }: {
  receivables: any[];
  stats: { totalReceivable: number; totalOverdue: number; activeCount: number; overdueCount: number; unassignedCount: number };
  userId: string;
  queryClient: QueryClient;
  isLoading: boolean;
}) {
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedReceivable, setSelectedReceivable] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);


  // Fetch staff/users for assignment
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: any[] }>('/api/users')
  });
  const staffList = (usersData?.users || []).filter((u: any) => u.status === 'approved' && u.isActive);

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: async () => {
      setSyncing(true);
      return apiFetch<{ message: string }>('/api/finance/receivables/sync', { method: 'POST' });
    },
    onSuccess: (data: any) => {
      toast.success(data.message);
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setSyncing(false)
  });

  // Update mutation (assign, priority, status)
  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch(`/api/finance/receivables/${data.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, updatedById: userId })
      });
    },
    onSuccess: () => {
      toast.success('Piutang berhasil diupdate');
      setShowAssignDialog(false);
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  // Follow-up mutation
  const followUpMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch(`/api/finance/receivables/${data.receivableId}/follow-up`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Follow-up berhasil ditambahkan');
      setShowFollowUpDialog(false);
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  // Manual create from transaction
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch('/api/finance/receivables', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast.success('Piutang berhasil dibuat');
      queryClient.invalidateQueries({ queryKey: ['receivables'] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  // Filter logic
  const filteredReceivables = receivables.filter((r: any) => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterPriority !== 'all' && r.priority !== filterPriority) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        (r.customerName || '').toLowerCase().includes(q) ||
        (r.transaction?.invoiceNo || '').toLowerCase().includes(q) ||
        (r.assignedTo?.name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Priority helpers
  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent': return <Badge className="bg-red-500 hover:bg-red-600">Urgent</Badge>;
      case 'high': return <Badge className="bg-orange-500 hover:bg-orange-600">Tinggi</Badge>;
      case 'low': return <Badge variant="secondary">Rendah</Badge>;
      default: return <Badge variant="outline">Normal</Badge>;
    }
  };

  const getOverdueColor = (days: number, status: string) => {
    if (status === 'paid') return '';
    if (days > 30) return 'border-red-400 bg-red-50 dark:bg-red-950/30';
    if (days > 14) return 'border-orange-300 bg-orange-50 dark:bg-orange-950/30';
    if (days > 0) return 'border-amber-200 bg-amber-50 dark:bg-amber-950/20';
    return '';
  };

  const getOutcomeLabel = (outcome: string) => {
    switch (outcome) {
      case 'promised_to_pay': return 'Janji Bayar';
      case 'no_response': return 'Tidak Ada Respon';
      case 'dispute': return 'Sengketa';
      case 'partial_payment': return 'Bayar Sebagian';
      case 'rescheduled': return 'Dijadwalkan Ulang';
      default: return outcome;
    }
  };

  if (isLoading) {
    return <LoadingFallback message="Memuat data piutang..." />;
  }

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 min-w-0">
        <Card className="min-w-0">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <FileText className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Piutang</p>
                <p className="text-sm sm:text-lg font-bold truncate">{formatCurrency(stats.totalReceivable)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="min-w-0 border-red-200 dark:border-red-800">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Jatuh Tempo</p>
                <p className="text-sm sm:text-lg font-bold text-red-600 truncate">{formatCurrency(stats.totalOverdue)}</p>
                <p className="text-[10px] text-red-500">{stats.overdueCount} invoice</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
                <Clock className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Belum Ditagih</p>
                <p className="text-sm sm:text-lg font-bold text-amber-600">{stats.unassignedCount}</p>
                <p className="text-[10px] text-muted-foreground">belum ada pic</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
                <Check className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Aktif</p>
                <p className="text-sm sm:text-lg font-bold">{stats.activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-4">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => syncMutation.mutate()}
              disabled={syncing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sinkronisasi...' : 'Refresh & Sync'}
            </Button>
            <p className="text-[10px] text-muted-foreground mt-1 text-center">
              Piutang otomatis dibuat dari invoice belum bayar
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari nama, invoice, sales..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="paid">Lunas</SelectItem>
            <SelectItem value="bad_debt">Macet</SelectItem>
            <SelectItem value="cancelled">Batal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-full sm:w-[130px]">
            <SelectValue placeholder="Prioritas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">Tinggi</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="low">Rendah</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Receivables List */}
        <div className="space-y-3">
          {filteredReceivables.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Belum ada data piutang</p>
                <p className="text-sm mt-1">Piutang otomatis muncul saat ada transaksi yang belum dibayar</p>
              </CardContent>
            </Card>
          ) : (
            filteredReceivables.map((r: any) => (
              <Card key={r.id} className={cn(
                'border transition-colors',
                r.status === 'paid' && 'opacity-60',
                r.status === 'cancelled' && 'opacity-40',
                getOverdueColor(r.overdueDays, r.status)
              )}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start gap-3 min-w-0">
                    <div className="flex-1 min-w-0">
                      {/* Header: Invoice & Customer */}
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{r.transaction?.invoiceNo || '-'}</span>
                        {getPriorityBadge(r.priority)}
                        {r.overdueDays > 0 && r.status === 'active' && (
                          <Badge className={cn(
                            'text-[10px]',
                            r.overdueDays > 30 ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                            r.overdueDays > 14 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                            'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                          )}>
                            <Timer className="w-3 h-3 mr-1" />
                            {r.overdueDays} hari
                          </Badge>
                        )}
                        {r.status === 'paid' && <Badge className="bg-green-500">Lunas</Badge>}
                        {r.status === 'bad_debt' && <Badge variant="destructive">Macet</Badge>}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
                        <span className="text-muted-foreground">
                          Customer: <span className="text-foreground font-medium">{r.customerName || '-'}</span>
                        </span>
                        {r.customerPhone && (
                          <span className="text-muted-foreground">
                            <Phone className="w-3 h-3 inline mr-1" />{r.customerPhone}
                          </span>
                        )}
                      </div>

                      {/* Assigned & Due */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-2">
                        {r.assignedTo ? (
                          <span className="flex items-center gap-1">
                            <UserRound className="w-3 h-3" />
                            {r.assignedTo.name}
                            <span className="text-[10px]">({r.assignedTo.role})</span>
                          </span>
                        ) : (
                          <span className="text-amber-600 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> Belum ada PIC
                          </span>
                        )}
                        {r.transaction?.dueDate && (
                          <span className={cn(
                            'flex items-center gap-1',
                            r.overdueDays > 0 && 'text-red-600 font-medium'
                          )}>
                            <Calendar className="w-3 h-3" />
                            JT: {formatDate(new Date(r.transaction.dueDate))}
                          </span>
                        )}
                        {r.nextFollowUpDate && (
                          <span className="flex items-center gap-1 text-blue-600">
                            <ArrowRight className="w-3 h-3" />
                            Follow-up: {formatDate(new Date(r.nextFollowUpDate))}
                          </span>
                        )}
                        <span>Sales: {r.transaction?.createdBy?.name || '-'}</span>
                      </div>

                      {/* Amounts */}
                      <div className="flex items-center gap-1.5 text-sm flex-wrap min-w-0">
                        <div>
                          <span className="text-muted-foreground text-xs">Total: </span>
                          <span className="font-medium">{formatCurrency(r.totalAmount)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Sisa: </span>
                          <span className="font-bold text-red-600">{formatCurrency(r.remainingAmount)}</span>
                        </div>
                        <div className="flex-1" />
                        <div className="w-16 sm:w-24 bg-muted rounded-full h-2 shrink-0">
                          <div
                            className="bg-green-500 rounded-full h-2 transition-all"
                            style={{ width: `${r.totalAmount ? Math.min(100, (r.paidAmount / r.totalAmount) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {r.totalAmount ? Math.round((r.paidAmount / r.totalAmount) * 100) : 0}%
                        </span>
                      </div>

                      {/* Latest follow-up */}
                      {r.lastFollowUpNote && (
                        <p className="text-xs text-muted-foreground mt-2 bg-muted/50 rounded px-2 py-1 truncate">
                          Terakhir: {r.lastFollowUpNote}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button size="sm" variant="outline" onClick={() => { setSelectedReceivable(r); setShowDetailDialog(true); }}>
                        <Eye className="w-3 h-3" />
                      </Button>
                      {r.status === 'active' && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => { setSelectedReceivable(r); setShowAssignDialog(true); }}>
                            <UserRound className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setSelectedReceivable(r); setShowFollowUpDialog(true); }}>
                            <Phone className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

      {/* Assign Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Assign Piutang ke Karyawan</DialogTitle>
            <DialogDescription>Pilih karyawan/sales yang bertanggung jawab</DialogDescription>
          </DialogHeader>
          {selectedReceivable && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium">{selectedReceivable.transaction?.invoiceNo}</p>
                <p className="text-sm">{selectedReceivable.customerName} - <span className="text-red-600 font-semibold">{formatCurrency(selectedReceivable.remainingAmount)}</span></p>
              </div>
              <div className="space-y-2">
                <Label>Assign ke</Label>
                <Select
                  value={selectedReceivable.assignedToId || 'none'}
                  onValueChange={(v) => setSelectedReceivable({ ...selectedReceivable, assignedToId: v === 'none' ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih karyawan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-- Belum Assign --</SelectItem>
                    {staffList.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prioritas</Label>
                <Select
                  value={selectedReceivable.priority || 'normal'}
                  onValueChange={(v: any) => setSelectedReceivable({ ...selectedReceivable, priority: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Rendah</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">Tinggi</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tanggal Follow-up Berikutnya</Label>
                <Input
                  type="date"
                  value={selectedReceivable.nextFollowUpDate ? toLocalDateStr(new Date(selectedReceivable.nextFollowUpDate)) : ''}
                  onChange={e => setSelectedReceivable({ ...selectedReceivable, nextFollowUpDate: e.target.value || null })}
                />
              </div>
              <div className="space-y-2">
                <Label>Catatan</Label>
                <Input
                  value={selectedReceivable.notes || ''}
                  onChange={e => setSelectedReceivable({ ...selectedReceivable, notes: e.target.value })}
                  placeholder="Catatan tambahan..."
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Batal</Button>
                <Button
                  onClick={() => updateMutation.mutate({
                    id: selectedReceivable.id,
                    assignedToId: selectedReceivable.assignedToId,
                    priority: selectedReceivable.priority,
                    nextFollowUpDate: selectedReceivable.nextFollowUpDate,
                    notes: selectedReceivable.notes
                  })}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? 'Menyimpan...' : 'Simpan'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Follow-up Dialog */}
      <Dialog open={showFollowUpDialog} onOpenChange={setShowFollowUpDialog}>
        <DialogContent className="sm:max-w-md w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Catatan Follow-up</DialogTitle>
            <DialogDescription>Rekam hasil follow-up penagihan piutang</DialogDescription>
          </DialogHeader>
          {selectedReceivable && (
            <FollowUpForm
              receivable={selectedReceivable}
              userId={userId}
              onSubmit={(data) => followUpMutation.mutate(data)}
              isLoading={followUpMutation.isPending}
              onClose={() => setShowFollowUpDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detail Piutang</DialogTitle>
          </DialogHeader>
          {selectedReceivable && (
            <ReceivableDetail
              receivable={selectedReceivable}
              onAssign={() => { setShowDetailDialog(false); setShowAssignDialog(true); }}
              onFollowUp={() => { setShowDetailDialog(false); setShowFollowUpDialog(true); }}
              onMarkPaid={() => {
                updateMutation.mutate({ id: selectedReceivable.id, status: 'paid', syncAmounts: true });
                setShowDetailDialog(false);
              }}
              onMarkBadDebt={() => {
                updateMutation.mutate({ id: selectedReceivable.id, status: 'bad_debt' });
                setShowDetailDialog(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Follow-up Form Component
function FollowUpForm({ receivable, userId, onSubmit, isLoading, onClose }: {
  receivable: any;
  userId: string;
  onSubmit: (data: any) => void;
  isLoading: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    type: 'whatsapp' as string,
    note: '',
    outcome: '' as string,
    promisedDate: '',
  });

  const followUpTypes = [
    { value: 'call', label: '📞 Telepon' },
    { value: 'whatsapp', label: '💬 WhatsApp' },
    { value: 'visit', label: '🚗 Kunjungan' },
    { value: 'email', label: '📧 Email' },
    { value: 'other', label: '📋 Lainnya' },
  ];

  const outcomes = [
    { value: 'promised_to_pay', label: '✅ Janji Bayar' },
    { value: 'no_response', label: '❌ Tidak Ada Respon' },
    { value: 'dispute', label: '⚠️ Sengketa' },
    { value: 'partial_payment', label: '💰 Bayar Sebagian' },
    { value: 'rescheduled', label: '📅 Dijadwalkan Ulang' },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden min-w-0">
      <div className="p-3 bg-muted rounded-lg min-w-0">
        <p className="text-sm font-medium">{receivable.transaction?.invoiceNo} - {receivable.customerName}</p>
        <p className="text-sm text-red-600 font-semibold">Sisa: {formatCurrency(receivable.remainingAmount)}</p>
      </div>

      <div className="space-y-2">
        <Label>Jenis Follow-up</Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {followUpTypes.map(t => (
            <Button
              key={t.value}
              type="button"
              variant={form.type === t.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setForm({ ...form, type: t.value })}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Catatan *</Label>
        <Textarea
          value={form.note}
          onChange={e => setForm({ ...form, note: e.target.value })}
          placeholder="Hasil pembicaraan, tanggapan customer..."
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Hasil</Label>
        <Select value={form.outcome} onValueChange={v => setForm({ ...form, outcome: v })}>
          <SelectTrigger>
            <SelectValue placeholder="Pilih hasil" />
          </SelectTrigger>
          <SelectContent>
            {outcomes.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {form.outcome === 'promised_to_pay' && (
        <div className="space-y-2">
          <Label>Tanggal Janji Bayar</Label>
          <Input
            type="date"
            value={form.promisedDate}
            onChange={e => setForm({ ...form, promisedDate: e.target.value })}
          />
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Batal</Button>
        <Button
          onClick={() => onSubmit({
            receivableId: receivable.id,
            type: form.type,
            note: form.note,
            outcome: form.outcome || undefined,
            promisedDate: form.promisedDate || undefined,
            createdById: userId,
          })}
          disabled={isLoading || !form.note.trim()}
        >
          {isLoading ? 'Menyimpan...' : 'Simpan Follow-up'}
        </Button>
      </DialogFooter>
    </div>
  );
}

// Receivable Detail Component
function ReceivableDetail({ receivable, onAssign, onFollowUp, onMarkPaid, onMarkBadDebt }: {
  receivable: any;
  onAssign: () => void;
  onFollowUp: () => void;
  onMarkPaid: () => void;
  onMarkBadDebt: () => void;
}) {
  const r = receivable;
  const tx = r.transaction;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Invoice</p>
          <p className="font-mono font-semibold">{tx?.invoiceNo || '-'}</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Tanggal</p>
          <p className="font-medium">{tx ? formatDate(new Date(tx.transactionDate)) : '-'}</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Customer</p>
          <p className="font-medium">{r.customerName || '-'}</p>
          {r.customerPhone && <p className="text-xs text-muted-foreground">{r.customerPhone}</p>}
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Sales</p>
          <p className="font-medium">{tx?.createdBy?.name || '-'}</p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Jatuh Tempo</p>
          <p className={cn('font-medium', r.overdueDays > 0 ? 'text-red-600' : '')}>
            {tx?.dueDate ? formatDate(new Date(tx.dueDate)) : '-'}
            {r.overdueDays > 0 && ` (${r.overdueDays} hari)`}
          </p>
        </div>
        <div className="p-3 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground">Ditugaskan ke</p>
          <p className="font-medium">{r.assignedTo?.name || <span className="text-amber-600">Belum ada</span>}</p>
        </div>
      </div>

      {/* Amounts */}
      <div className="p-4 border rounded-lg space-y-2">
        <div className="flex justify-between">
          <span>Total Invoice</span>
          <span className="font-bold">{formatCurrency(r.totalAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span>Sudah Dibayar</span>
          <span className="font-medium text-green-600">{formatCurrency(r.paidAmount)}</span>
        </div>
        <Separator />
        <div className="flex justify-between">
          <span className="font-semibold">Sisa Piutang</span>
          <span className="font-bold text-red-600 text-lg">{formatCurrency(r.remainingAmount)}</span>
        </div>
      </div>

      {/* Items */}
      {tx?.items && tx.items.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-2">Item Pesanan</h4>
          {/* Mobile Card Layout */}
          <div className="block md:hidden space-y-2">
            {tx.items.map((item: any, i: number) => (
              <div key={item.id || i} className="flex items-center justify-between p-2 border rounded-lg text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{item.productName}</p>
                  <p className="text-xs text-muted-foreground">Qty: {item.qty} × {formatCurrency(item.price)}</p>
                </div>
                <p className="font-medium shrink-0 ml-2">{formatCurrency(item.subtotal)}</p>
              </div>
            ))}
          </div>
          {/* Desktop Table Layout */}
          <div className="hidden md:block border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Produk</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Qty</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Harga</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tx.items.map((item: any, i: number) => (
                  <TableRow key={item.id || i}>
                    <TableCell>{item.productName}</TableCell>
                    <TableCell className="text-right">{item.qty}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.price)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.subtotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up History */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Riwayat Follow-up ({r.followUps?.length || 0})</h4>
        {(!r.followUps || r.followUps.length === 0) ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Belum ada follow-up</p>
        ) : (
          <ScrollArea className="max-h-60">
            <div className="space-y-2">
              {r.followUps.map((fu: any, i: number) => (
                <div key={fu.id} className="p-3 border rounded-lg text-sm">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {fu.type === 'call' ? '📞' : fu.type === 'whatsapp' ? '💬' : fu.type === 'visit' ? '🚗' : fu.type === 'email' ? '📧' : '📋'} {fu.type}
                      </Badge>
                      {fu.outcome && (
                        <Badge variant="secondary" className="text-[10px]">{fu.outcome.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {fu.createdBy?.name} • {formatDateTime(new Date(fu.createdAt))}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{fu.note}</p>
                  {fu.promisedDate && (
                    <p className="text-xs text-blue-600 mt-1">
                      📅 Janji bayar: {formatDate(new Date(fu.promisedDate))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Actions */}
      {r.status === 'active' && (
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" onClick={onAssign}>
            <UserRound className="w-4 h-4 mr-2" /> Assign / Ubah PIC
          </Button>
          <Button variant="outline" onClick={onFollowUp}>
            <Phone className="w-4 h-4 mr-2" /> Tambah Follow-up
          </Button>
          <Button variant="default" className="bg-green-600 hover:bg-green-700" onClick={onMarkPaid}>
            <Check className="w-4 h-4 mr-2" /> Tandai Lunas
          </Button>
          <Button variant="outline" className="text-red-600 border-red-300 hover:bg-red-50" onClick={onMarkBadDebt}>
            <AlertCircle className="w-4 h-4 mr-2" /> Tandai Macet
          </Button>
        </div>
      )}
    </div>
  );
}

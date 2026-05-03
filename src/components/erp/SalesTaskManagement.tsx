'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDate, formatDateTime } from '@/lib/erp-helpers';
import {
  Plus,
  ClipboardList,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Eye,
  Filter,
  Trash2,
  Calendar,
  UserCheck,
  CheckCircle2,
  XCircle,
  PlayCircle,
  AlertOctagon,
  MessageSquare,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

// ============ TYPE DEFINITIONS ============
interface SalesTask {
  id: string;
  title: string;
  description: string | null;
  type: string;
  priority: string;
  assignedToId: string;
  assignedById: string;
  status: string;
  dueDate: string | null;
  completedAt: string | null;
  completionNote: string | null;
  createdAt: string;
  updatedAt: string;
  assignedTo: { id: string; name: string } | null;
  assignedBy: { id: string; name: string } | null;
  latestReport?: {
    id: string;
    note: string;
    status: string;
    createdAt: string;
    reportedBy: { id: string; name: string };
  } | null;
}

interface SalesTaskDetail extends SalesTask {
  reports: {
    id: string;
    reportedById: string;
    status: string;
    note: string;
    evidence: string | null;
    createdAt: string;
    reportedBy: { id: string; name: string };
  }[];
}

interface SalesUser {
  id: string;
  name: string;
  role: string;
  status: string;
  isActive: boolean;
}

// ============ CONSTANTS ============
const TASK_TYPES: { value: string; label: string }[] = [
  { value: 'general', label: 'Kunjungan' },
  { value: 'followup', label: 'Follow Up' },
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'collection', label: 'Collection' },
  { value: 'other', label: 'Lainnya' },
];

const TASK_PRIORITIES: { value: string; label: string }[] = [
  { value: 'low', label: 'Rendah' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Tinggi' },
  { value: 'urgent', label: 'Urgent' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'Sedang Dikerjakan' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
];

// ============ HELPER FUNCTIONS ============
function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate) return false;
  if (status === 'completed' || status === 'cancelled') return false;
  const now = new Date();
  const due = new Date(dueDate);
  // Set due to end of day
  due.setHours(23, 59, 59, 999);
  return now > due;
}

// ============ SUB-COMPONENTS ============
function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <Badge className="bg-amber-500 text-white text-xs">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge className="bg-blue-500 text-white text-xs">
          <PlayCircle className="w-3 h-3 mr-1" />
          Dikerjakan
        </Badge>
      );
    case 'completed':
      return (
        <Badge className="bg-green-500 text-white text-xs">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Selesai
        </Badge>
      );
    case 'cancelled':
      return (
        <Badge className="bg-gray-500 text-white text-xs">
          <XCircle className="w-3 h-3 mr-1" />
          Dibatalkan
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case 'low':
      return (
        <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs border-0">
          Rendah
        </Badge>
      );
    case 'normal':
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs border-0">
          Normal
        </Badge>
      );
    case 'high':
      return (
        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 text-xs border-0">
          Tinggi
        </Badge>
      );
    case 'urgent':
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 text-xs border-0">
          Urgent
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-xs">{priority}</Badge>;
  }
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    general: 'Kunjungan',
    followup: 'Follow Up',
    prospecting: 'Prospecting',
    collection: 'Collection',
    other: 'Lainnya',
  };
  return (
    <Badge variant="secondary" className="text-xs">
      {labels[type] || type}
    </Badge>
  );
}

// ============ MAIN COMPONENT ============
export default function SalesTaskManagement() {
  const queryClient = useQueryClient();

  // Filter states
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [salesFilter, setSalesFilter] = useState<string>('all');

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<SalesTaskDetail | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<SalesTask | null>(null);

  // Create form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formType, setFormType] = useState('general');
  const [formPriority, setFormPriority] = useState('normal');
  const [formAssignedToId, setFormAssignedToId] = useState('');
  const [formDueDate, setFormDueDate] = useState('');

  // ============ DATA FETCHING ============
  // Fetch tasks
  const { data: tasksData, isLoading, error, refetch } = useQuery({
    queryKey: ['sales-tasks', statusFilter, priorityFilter, salesFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (salesFilter !== 'all') params.set('assignedToId', salesFilter);
      return apiFetch<{ tasks: SalesTask[]; summary: Record<string, number> }>(
        `/api/sales-tasks?${params.toString()}`
      );
    },
    staleTime: 15000,
    retry: 1,
  });

  // Fetch sales users for assignment
  const { data: usersData } = useQuery({
    queryKey: ['users', 'sales-list'],
    queryFn: () => apiFetch<{ users: SalesUser[] }>('/api/users'),
    staleTime: 60000,
    select: (data) => ({
      ...data,
      users: (data.users || []).filter(
        (u) => u.role === 'sales' && u.status === 'approved' && u.isActive
      ),
    }),
  });

  const tasks: SalesTask[] = tasksData?.tasks || [];
  const summary = tasksData?.summary || {};
  const salesUsers: SalesUser[] = usersData?.users || [];

  // ============ CREATE MUTATION ============
  const createMutation = useMutation({
    mutationFn: (data: {
      title: string;
      description: string;
      type: string;
      priority: string;
      assignedToId: string;
      dueDate: string;
    }) => apiFetch<{ task: SalesTask }>('/api/sales-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      toast.success('Tugas berhasil dibuat');
      resetForm();
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ['sales-tasks'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal membuat tugas');
    },
  });

  // ============ DELETE MUTATION ============
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sales-tasks/${id}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      toast.success('Tugas berhasil dihapus');
      setDeleteConfirmOpen(null);
      if (detailOpen) setDetailOpen(null);
      queryClient.invalidateQueries({ queryKey: ['sales-tasks'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal menghapus tugas');
    },
  });

  // ============ HELPERS ============
  function resetForm() {
    setFormTitle('');
    setFormDescription('');
    setFormType('general');
    setFormPriority('normal');
    setFormAssignedToId('');
    setFormDueDate('');
  }

  function handleCreate() {
    if (!formTitle.trim()) {
      toast.error('Judul tugas wajib diisi');
      return;
    }
    if (!formAssignedToId) {
      toast.error('Pilih sales terlebih dahulu');
      return;
    }
    createMutation.mutate({
      title: formTitle.trim(),
      description: formDescription.trim(),
      type: formType,
      priority: formPriority,
      assignedToId: formAssignedToId,
      dueDate: formDueDate,
    });
  }

  function handleViewDetail(task: SalesTask) {
    // Fetch full task detail with reports
    apiFetch<{ task: SalesTaskDetail }>(`/api/sales-tasks/${task.id}`)
      .then((data) => {
        setDetailOpen(data.task);
      })
      .catch((err: any) => {
        toast.error(err.message || 'Gagal memuat detail tugas');
      });
  }

  // ============ ERROR STATE ============
  if (error) {
    return (
      <div className="space-y-4">
        <Card className="border-red-200 dark:border-red-800">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto text-red-500 mb-2" />
            <p className="text-sm text-red-600 font-medium">Gagal memuat data tugas</p>
            <p className="text-xs text-muted-foreground mt-1">
              {error instanceof Error ? error.message : 'Terjadi kesalahan'}
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Coba Lagi
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============ LOADING STATE ============
  if (isLoading || !tasksData) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse h-32 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ============ COMPUTED ============
  const totalTasks = summary.total || 0;
  const pendingTasks = summary.pending || 0;
  const inProgressTasks = summary.in_progress || 0;
  const completedTasks = summary.completed || 0;
  const overdueTasks = summary.overdue || 0;

  // ============ RENDER ============
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" />
            Manajemen Tugas Sales
          </h2>
          <p className="text-sm text-muted-foreground">
            Buat dan kelola penugasan untuk tim sales
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Buat Tugas Baru
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Total Tugas</p>
            <p className="text-lg sm:text-xl font-bold text-slate-700 dark:text-slate-300">
              {totalTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Pending</p>
            <p className="text-lg sm:text-xl font-bold text-amber-700 dark:text-amber-300">
              {pendingTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Sedang Dikerjakan</p>
            <p className="text-lg sm:text-xl font-bold text-blue-700 dark:text-blue-300">
              {inProgressTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Selesai</p>
            <p className="text-lg sm:text-xl font-bold text-green-700 dark:text-green-300">
              {completedTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-950 dark:to-red-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-lg sm:text-xl font-bold text-red-700 dark:text-red-300">
              {overdueTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900">
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground">Dibatalkan</p>
            <p className="text-lg sm:text-xl font-bold text-purple-700 dark:text-purple-300">
              {summary.cancelled || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-48 h-9 text-sm">
              <Filter className="w-3.5 h-3.5 mr-1" />
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-40 h-9 text-sm">
            <SelectValue placeholder="Prioritas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Prioritas</SelectItem>
            {TASK_PRIORITIES.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={salesFilter} onValueChange={setSalesFilter}>
          <SelectTrigger className="w-full sm:w-48 h-9 text-sm">
            <UserCheck className="w-3.5 h-3.5 mr-1" />
            <SelectValue placeholder="Semua Sales" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Sales</SelectItem>
            {salesUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter !== 'all' || priorityFilter !== 'all' || salesFilter !== 'all') && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 text-xs shrink-0"
            onClick={() => {
              setStatusFilter('all');
              setPriorityFilter('all');
              setSalesFilter('all');
            }}
          >
            Reset Filter
          </Button>
        )}
      </div>

      {/* Task List */}
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <ClipboardList className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium text-muted-foreground">Belum ada tugas</p>
            <p className="text-xs text-muted-foreground mt-1">
              {statusFilter !== 'all' || priorityFilter !== 'all' || salesFilter !== 'all'
                ? 'Coba ubah filter untuk melihat tugas lainnya'
                : 'Klik "Buat Tugas Baru" untuk mulai memberikan tugas ke sales'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span>{tasks.length} tugas</span>
          </div>

          <div className="space-y-2">
            {tasks.map((task) => {
              const overdue = isOverdue(task.dueDate, task.status);
              return (
                <Card
                  key={task.id}
                  className={cn(
                    'hover:shadow-md transition-shadow',
                    overdue && 'border-red-300 dark:border-red-800',
                    task.priority === 'urgent' && task.status !== 'completed' && task.status !== 'cancelled' && 'border-orange-300 dark:border-orange-800'
                  )}
                >
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col gap-2">
                      {/* Row 1: Title + actions */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-sm">{task.title}</h3>
                            <TypeBadge type={task.type} />
                            <PriorityBadge priority={task.priority} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => handleViewDetail(task)}
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            Detail
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                            onClick={() => setDeleteConfirmOpen(task)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Row 2: Meta info */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserCheck className="w-3 h-3" />
                          {task.assignedTo?.name || 'Tidak ada sales'}
                        </span>
                        {task.dueDate && (
                          <span
                            className={cn(
                              'flex items-center gap-1',
                              overdue && 'text-red-500 font-medium'
                            )}
                          >
                            <Calendar className="w-3 h-3" />
                            {formatDate(task.dueDate)}
                            {overdue && (
                              <Badge className="bg-red-500 text-white text-xs px-1.5 py-0 ml-1">
                                <AlertOctagon className="w-2.5 h-2.5 mr-0.5" />
                                Overdue
                              </Badge>
                            )}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(task.createdAt)}
                        </span>
                      </div>

                      {/* Row 3: Status + Latest report */}
                      <div className="flex items-center justify-between gap-2 pt-1 border-t">
                        <StatusBadge status={task.status} />
                        {task.latestReport && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                            <MessageSquare className="w-3 h-3 shrink-0" />
                            <span className="truncate max-w-[200px] sm:max-w-[300px]">
                              {task.latestReport.reportedBy?.name || 'Unknown'}: {task.latestReport.note}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ CREATE TASK DIALOG ============ */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            resetForm();
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Buat Tugas Baru
            </DialogTitle>
            <DialogDescription>
              Berikan tugas baru kepada sales tim
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-2">
              <Label>
                Judul Tugas <span className="text-red-500">*</span>
              </Label>
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Contoh: Kunjungi PT Maju Jaya"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Deskripsi</Label>
              <Textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Detail tugas (opsional)..."
                rows={3}
              />
            </div>

            {/* Type + Priority in 2 columns */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Tipe Tugas</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih tipe..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prioritas</Label>
                <Select value={formPriority} onValueChange={setFormPriority}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih prioritas..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Assigned Sales */}
            <div className="space-y-2">
              <Label>
                Assign ke Sales <span className="text-red-500">*</span>
              </Label>
              <Select value={formAssignedToId} onValueChange={setFormAssignedToId}>
                <SelectTrigger>
                  <UserCheck className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Pilih sales..." />
                </SelectTrigger>
                <SelectContent>
                  {salesUsers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Tidak ada sales aktif
                    </div>
                  ) : (
                    salesUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Due Date */}
            <div className="space-y-2">
              <Label>Deadline</Label>
              <Input
                type="date"
                value={formDueDate}
                onChange={(e) => setFormDueDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetForm();
              }}
              disabled={createMutation.isPending}
            >
              Batal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                createMutation.isPending ||
                !formTitle.trim() ||
                !formAssignedToId
              }
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1" />
                  Buat Tugas
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DETAIL DIALOG ============ */}
      <Dialog
        open={!!detailOpen}
        onOpenChange={(open) => {
          if (!open) setDetailOpen(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85dvh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Detail Tugas
            </DialogTitle>
            <DialogDescription>
              {detailOpen?.title}
            </DialogDescription>
          </DialogHeader>

          {detailOpen && (
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full max-h-[calc(85vh-160px)]">
                <div className="space-y-4 pr-2">
                  {/* Task Info */}
                  <div className="space-y-3">
                    {/* Badges row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeBadge type={detailOpen.type} />
                      <PriorityBadge priority={detailOpen.priority} />
                      <StatusBadge status={detailOpen.status} />
                    </div>

                    {/* Info grid */}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="p-2 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Assign ke</p>
                        <p className="font-medium flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5" />
                          {detailOpen.assignedTo?.name || '-'}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Dibuat oleh</p>
                        <p className="font-medium">{detailOpen.assignedBy?.name || '-'}</p>
                      </div>
                      <div
                        className={cn(
                          'p-2 rounded-lg bg-muted/50',
                          isOverdue(detailOpen.dueDate, detailOpen.status) && 'bg-red-50 dark:bg-red-950/30'
                        )}
                      >
                        <p className="text-xs text-muted-foreground">Deadline</p>
                        <p
                          className={cn(
                            'font-medium flex items-center gap-1',
                            isOverdue(detailOpen.dueDate, detailOpen.status) && 'text-red-500'
                          )}
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          {detailOpen.dueDate ? formatDate(detailOpen.dueDate) : '-'}
                          {isOverdue(detailOpen.dueDate, detailOpen.status) && (
                            <Badge className="bg-red-500 text-white text-xs px-1.5 py-0">
                              Overdue
                            </Badge>
                          )}
                        </p>
                      </div>
                      <div className="p-2 rounded-lg bg-muted/50">
                        <p className="text-xs text-muted-foreground">Dibuat</p>
                        <p className="font-medium text-sm">{formatDateTime(detailOpen.createdAt)}</p>
                      </div>
                    </div>

                    {/* Description */}
                    {detailOpen.description && (
                      <div className="p-3 rounded-lg border text-sm">
                        <p className="font-medium text-xs text-muted-foreground mb-1">Deskripsi</p>
                        <p className="whitespace-pre-wrap">{detailOpen.description}</p>
                      </div>
                    )}

                    {/* Completion note */}
                    {detailOpen.status === 'completed' && detailOpen.completionNote && (
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-sm">
                        <p className="font-medium text-xs text-green-600 mb-1">Catatan Penyelesaian</p>
                        <p className="whitespace-pre-wrap">{detailOpen.completionNote}</p>
                      </div>
                    )}
                  </div>

                  {/* Report Timeline */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm">Riwayat Laporan</h4>
                      <Badge variant="outline" className="text-xs">
                        {detailOpen.reports?.length ?? 0}
                      </Badge>
                    </div>

                    {(detailOpen.reports?.length ?? 0) === 0 ? (
                      <div className="text-center py-6">
                        <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">Belum ada laporan</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(detailOpen.reports || []).map((report, idx) => (
                          <div
                            key={report.id}
                            className={cn(
                              'p-3 rounded-lg border relative',
                              idx === 0 && 'border-primary/30 bg-primary/5 dark:bg-primary/10'
                            )}
                          >
                            {idx === 0 && (
                              <Badge className="absolute -top-2 left-3 bg-primary text-primary-foreground text-xs">
                                Terbaru
                              </Badge>
                            )}
                            <div className="flex items-start gap-2">
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-medium text-sm">
                                    {report.reportedBy?.name || 'Unknown'}
                                  </span>
                                  <StatusBadge status={report.status} />
                                </div>
                                {report.note && (
                                  <p className="text-sm mt-1 whitespace-pre-wrap">{report.note}</p>
                                )}
                                <p className="text-xs text-muted-foreground mt-1">
                                  {formatDateTime(report.createdAt)}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Delete button */}
                  <div className="pt-2 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => {
                        setDeleteConfirmOpen(detailOpen);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Hapus Tugas
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setDetailOpen(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ DELETE CONFIRM DIALOG ============ */}
      <Dialog
        open={!!deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmOpen(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-500">
              <AlertTriangle className="w-5 h-5" />
              Hapus Tugas
            </DialogTitle>
            <DialogDescription>
              Apakah Anda yakin ingin menghapus tugas &quot;{deleteConfirmOpen?.title}&quot;? Tindakan ini tidak dapat dibatalkan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(null)} disabled={deleteMutation.isPending}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirmOpen) deleteMutation.mutate(deleteConfirmOpen.id);
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                  Menghapus...
                </>
              ) : (
                'Hapus'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

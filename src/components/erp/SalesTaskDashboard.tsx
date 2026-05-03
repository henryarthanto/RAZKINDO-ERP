'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  PlayCircle,
  Send,
  Eye,
  RefreshCw,
  CalendarClock,
  FileText,
  User,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/erp-helpers';

// ================================
// TYPE HELPERS
// ================================

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
type TaskType = 'general' | 'visit' | 'followup' | 'prospecting' | 'collection' | 'other';

interface SalesTask {
  id: string;
  title: string;
  description?: string | null;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string | null;
  completedAt?: string | null;
  completionNote?: string | null;
  createdAt: string;
  updatedAt: string;
  assignedToId: string;
  assignedById: string;
  assignedTo?: { id: string; name: string };
  assignedBy?: { id: string; name: string };
  reports?: SalesTaskReport[];
}

interface SalesTaskReport {
  id: string;
  taskId: string;
  reportedById: string;
  status: TaskStatus;
  note: string;
  evidence?: string | null;
  createdAt: string;
  reportedBy?: { id: string; name: string };
}

// ================================
// DISPLAY HELPERS
// ================================

const TYPE_CONFIG: Record<TaskType, { label: string; className: string }> = {
  general: { label: 'Umum', className: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  visit: { label: 'Kunjungan', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  followup: { label: 'Follow Up', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300' },
  prospecting: { label: 'Prospecting', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
  collection: { label: 'Collection', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' },
  other: { label: 'Lainnya', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: 'Rendah', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  normal: { label: 'Normal', className: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' },
  high: { label: 'Tinggi', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  in_progress: { label: 'Sedang Dikerjakan', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  completed: { label: 'Selesai', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  cancelled: { label: 'Dibatalkan', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

const isOverdue = (dueDate?: string | null, status?: TaskStatus): boolean => {
  if (!dueDate || status === 'completed' || status === 'cancelled') return false;
  return new Date(dueDate) < new Date();
};

// Tab options config for mobile dropdown
const TAB_OPTIONS = [
  { value: 'semua', label: 'Semua', icon: ClipboardList, color: 'text-slate-600' },
  { value: 'pending', label: 'Pending', icon: Clock, color: 'text-yellow-500' },
  { value: 'in_progress', label: 'Sedang Dikerjakan', icon: Loader2, color: 'text-blue-500' },
  { value: 'completed', label: 'Selesai', icon: CheckCircle2, color: 'text-green-500' },
  { value: 'cancelled', label: 'Dibatalkan', icon: XCircle, color: 'text-gray-400' },
] as const;

// ================================
// TASK CARD COMPONENT
// ================================

function TaskCard({
  task,
  loadingTaskId,
  onStartTask,
  onReportDialog,
  onDetailOpen,
}: {
  task: SalesTask;
  loadingTaskId: string | null;
  onStartTask: (task: SalesTask) => void;
  onReportDialog: (task: SalesTask, status: string) => void;
  onDetailOpen: (task: SalesTask) => void;
}) {
  const overdue = isOverdue(task.dueDate, task.status);

  return (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow",
        overdue && "border-red-300 dark:border-red-800"
      )}
    >
      <CardContent className="p-4 space-y-3">
        {/* Top row: title + overdue badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm leading-tight">{task.title}</h3>
          </div>
          {overdue && (
            <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0">
              <AlertTriangle className="w-3 h-3 mr-0.5" />
              Terlambat!
            </Badge>
          )}
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className={cn("text-[10px]", TYPE_CONFIG[task.type]?.className)}>
            {TYPE_CONFIG[task.type]?.label}
          </Badge>
          <Badge variant="secondary" className={cn("text-[10px]", PRIORITY_CONFIG[task.priority]?.className)}>
            {PRIORITY_CONFIG[task.priority]?.label}
          </Badge>
          <Badge variant="secondary" className={cn("text-[10px]", STATUS_CONFIG[task.status]?.className)}>
            {STATUS_CONFIG[task.status]?.label}
          </Badge>
        </div>

        {/* Info row */}
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          {task.dueDate && (
            <div className={cn("flex items-center gap-1.5", overdue && "text-red-600 dark:text-red-400")}>
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Deadline: {formatDate(task.dueDate)}</span>
            </div>
          )}
          {task.assignedBy && (
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              <span>Ditugaskan oleh: {task.assignedBy?.name || '-'}</span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 pt-1">
          {task.status === 'pending' && (
            <Button
              size="sm"
              className="flex-1 h-9 text-xs"
              onClick={() => onStartTask(task)}
              disabled={loadingTaskId === task.id}
            >
              {loadingTaskId === task.id ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <PlayCircle className="w-3.5 h-3.5 mr-1.5" />
              )}
              Mulai Kerjakan
            </Button>
          )}
          {task.status === 'in_progress' && (
            <>
              <Button
                size="sm"
                className="flex-1 h-9 text-xs bg-green-600 hover:bg-green-700"
                onClick={() => onReportDialog(task, 'completed')}
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                Selesai
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => onReportDialog(task, 'in_progress')}
              >
                <Send className="w-3.5 h-3.5 mr-1.5" />
                Update Progress
              </Button>
            </>
          )}
          {(task.status === 'completed' || task.status === 'cancelled') && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs"
              onClick={() => onDetailOpen(task)}
            >
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              Lihat Detail
            </Button>
          )}
          {(task.status === 'pending' || task.status === 'in_progress') && task.description && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-xs"
              onClick={() => onDetailOpen(task)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ================================
// EMPTY STATE COMPONENT
// ================================

function EmptyState({ activeTab }: { activeTab: string }) {
  return (
    <Card>
      <CardContent className="p-6 text-center">
        <ClipboardList className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">
          {activeTab === 'semua'
            ? 'Belum ada tugas yang diberikan'
            : `Tidak ada tugas dengan status ${STATUS_CONFIG[activeTab as TaskStatus]?.label || activeTab}`}
        </p>
      </CardContent>
    </Card>
  );
}

// ================================
// MAIN COMPONENT
// ================================

export default function SalesTaskDashboard() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<string>('semua');

  // Dialog states
  const [reportOpen, setReportOpen] = useState<SalesTask | null>(null);
  const [detailOpen, setDetailOpen] = useState<SalesTask | null>(null);

  // Report form
  const [reportStatus, setReportStatus] = useState<string>('');
  const [reportNote, setReportNote] = useState('');
  const [reportEvidence, setReportEvidence] = useState('');
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  // Fetch tasks
  const { data: tasksData, isLoading } = useQuery({
    queryKey: ['my-tasks', user?.id],
    queryFn: () => apiFetch<{ tasks: SalesTask[] }>('/api/sales-tasks'),
    enabled: !!user?.id,
  });

  const tasks = tasksData?.tasks || [];

  // Fetch detail when detail dialog is open
  const { data: detailData } = useQuery({
    queryKey: ['task-detail', detailOpen?.id],
    queryFn: () => apiFetch<{ task: SalesTask & { reports: SalesTaskReport[] } }>(`/api/sales-tasks/${detailOpen!.id}`),
    enabled: !!detailOpen?.id,
  });

  const detailTask = detailData?.task || null;

  // Summary calculations
  const totalCount = tasks.length;
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const pendingCount = pendingTasks.length;
  const overdueCount = pendingTasks.filter(t => isOverdue(t.dueDate, t.status)).length +
    tasks.filter(t => t.status === 'in_progress' && isOverdue(t.dueDate, t.status)).length;
  const inProgressCount = tasks.filter(t => t.status === 'in_progress').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const cancelledCount = tasks.filter(t => t.status === 'cancelled').length;

  // Filter tasks by tab
  const filteredTasks = tasks.filter(t => {
    if (activeTab === 'semua') return true;
    if (activeTab === 'pending') return t.status === 'pending';
    if (activeTab === 'in_progress') return t.status === 'in_progress';
    if (activeTab === 'completed') return t.status === 'completed';
    if (activeTab === 'cancelled') return t.status === 'cancelled';
    return true;
  });

  // ================================
  // HANDLERS
  // ================================

  const handleStartTask = async (task: SalesTask) => {
    setLoadingTaskId(task.id);
    try {
      await apiFetch(`/api/sales-tasks/${task.id}/report`, {
        method: 'POST',
        body: JSON.stringify({
          status: 'in_progress',
          note: 'Tugas dimulai oleh sales.',
        }),
      });
      toast.success(`Tugas "${task.title}" dimulai`);
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    } catch (err: any) {
      toast.error(err.message || 'Gagal memulai tugas');
    } finally {
      setLoadingTaskId(null);
    }
  };

  const openReportDialog = (task: SalesTask, targetStatus: string) => {
    setReportOpen(task);
    setReportStatus(targetStatus);
    setReportNote('');
    setReportEvidence('');
  };

  const handleSubmitReport = async () => {
    if (!reportOpen || !reportNote.trim()) {
      toast.error('Catatan/Laporan wajib diisi');
      return;
    }
    setLoadingTaskId(reportOpen.id);
    try {
      await apiFetch(`/api/sales-tasks/${reportOpen.id}/report`, {
        method: 'POST',
        body: JSON.stringify({
          status: reportStatus,
          note: reportNote.trim(),
          evidence: reportEvidence.trim() || undefined,
        }),
      });
      const statusLabel = reportStatus === 'completed' ? 'selesai' : 'diperbarui';
      toast.success(`Tugas berhasil ${statusLabel}`);
      setReportOpen(null);
      setReportNote('');
      setReportEvidence('');
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengirim laporan');
    } finally {
      setLoadingTaskId(null);
    }
  };

  // ================================
  // LOADING SKELETON
  // ================================

  if (isLoading) {
    return (
      <div className="space-y-4">
        {/* Summary skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="animate-pulse h-20 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
        {/* Task list skeleton */}
        {[1, 2, 3].map(i => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="animate-pulse h-28 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ================================
  // RENDER
  // ================================

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Tugas Saya</h2>
          <p className="text-sm text-muted-foreground">Kelola tugas yang diberikan ke Anda</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['my-tasks'] })}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-500/20 flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Tugas</p>
                <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{totalCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={cn(
          "bg-gradient-to-br dark:to-red-900",
          overdueCount > 0
            ? "from-red-50 to-red-100 dark:from-red-950"
            : "from-yellow-50 to-yellow-100 dark:from-yellow-950"
        )}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                overdueCount > 0 ? "bg-red-500/20" : "bg-yellow-500/20"
              )}>
                <Clock className={cn(
                  "w-5 h-5",
                  overdueCount > 0 ? "text-red-600" : "text-yellow-600"
                )} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">Pending</p>
                  {overdueCount > 0 && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                      {overdueCount} terlambat
                    </Badge>
                  )}
                </div>
                <p className={cn(
                  "text-lg font-bold",
                  overdueCount > 0 ? "text-red-700 dark:text-red-300" : "text-yellow-700 dark:text-yellow-300"
                )}>
                  {pendingCount}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                <Loader2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Sedang Dikerjakan</p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{inProgressCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950 dark:to-green-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Selesai</p>
                <p className="text-lg font-bold text-green-700 dark:text-green-300">{completedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ================================ */}
      {/* FILTER: Mobile Dropdown / Desktop Tabs */}
      {/* ================================ */}
      {isMobile ? (
        /* ===== MOBILE: Dropdown filter ===== */
        <div className="space-y-3">
          <Select value={activeTab} onValueChange={setActiveTab}>
            <SelectTrigger className="w-full h-10 text-sm">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Filter tugas..." />
            </SelectTrigger>
            <SelectContent>
              {TAB_OPTIONS.map(opt => {
                const count = opt.value === 'semua' ? totalCount
                  : opt.value === 'pending' ? pendingCount
                  : opt.value === 'in_progress' ? inProgressCount
                  : opt.value === 'completed' ? completedCount
                  : cancelledCount;
                const Icon = opt.icon;
                return (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-2">
                      <Icon className={cn("w-4 h-4 shrink-0", opt.color)} />
                      <span>{opt.label}</span>
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">{count}</Badge>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Task list for mobile */}
          <div className="space-y-3">
            {filteredTasks.length === 0 ? (
              <EmptyState activeTab={activeTab} />
            ) : (
              filteredTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  loadingTaskId={loadingTaskId}
                  onStartTask={handleStartTask}
                  onReportDialog={openReportDialog}
                  onDetailOpen={setDetailOpen}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        /* ===== DESKTOP: Tabs filter ===== */
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="semua" className="text-sm relative">
              Semua
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">{totalCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value="pending" className="text-sm relative">
              Pending
              {pendingCount > 0 && (
                <Badge className="ml-1.5 bg-yellow-500 text-white text-[10px] px-1.5">{pendingCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="in_progress" className="text-sm relative">
              Sedang Dikerjakan
              {inProgressCount > 0 && (
                <Badge className="ml-1.5 bg-blue-500 text-white text-[10px] px-1.5">{inProgressCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="completed" className="text-sm relative">
              Selesai
              {completedCount > 0 && (
                <Badge className="ml-1.5 bg-green-500 text-white text-[10px] px-1.5">{completedCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="cancelled" className="text-sm">
              Dibatalkan
              {cancelledCount > 0 && (
                <Badge className="ml-1.5 bg-gray-400 text-white text-[10px] px-1.5">{cancelledCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Task List — reused for every tab */}
          {['semua', 'pending', 'in_progress', 'completed', 'cancelled'].map(tabKey => (
            <TabsContent key={tabKey} value={tabKey}>
              <div className="space-y-3">
                {filteredTasks.length === 0 ? (
                  <EmptyState activeTab={activeTab} />
                ) : (
                  filteredTasks.map(task => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      loadingTaskId={loadingTaskId}
                      onStartTask={handleStartTask}
                      onReportDialog={openReportDialog}
                      onDetailOpen={setDetailOpen}
                    />
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* ================================ */}
      {/* REPORT DIALOG                    */}
      {/* ================================ */}
      <Dialog open={!!reportOpen} onOpenChange={(open) => { if (!open) setReportOpen(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reportStatus === 'completed' ? 'Tandai Selesai' : 'Update Progress'}
            </DialogTitle>
            <DialogDescription>
              {reportOpen?.title}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Status indicator */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={reportStatus} onValueChange={setReportStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {reportOpen?.status === 'in_progress' && (
                    <SelectItem value="in_progress">Sedang Dikerjakan</SelectItem>
                  )}
                  <SelectItem value="completed">Selesai</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Note — required */}
            <div className="space-y-2">
              <Label>
                Catatan / Laporan <span className="text-red-500">*</span>
              </Label>
              <Textarea
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder={
                  reportStatus === 'completed'
                    ? 'Deskripsikan hasil penyelesaian tugas...'
                    : 'Tulis progress terbaru...'
                }
                rows={4}
              />
            </div>

            {/* Evidence — optional */}
            <div className="space-y-2">
              <Label>
                Bukti / Evidence{' '}
                <span className="text-muted-foreground text-xs font-normal">(opsional)</span>
              </Label>
              <Textarea
                value={reportEvidence}
                onChange={(e) => setReportEvidence(e.target.value)}
                placeholder="Deskripsi bukti kerja, link foto, atau keterangan pendukung..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(null)}>
              Batal
            </Button>
            <Button
              onClick={handleSubmitReport}
              disabled={loadingTaskId !== null || !reportNote.trim()}
            >
              {loadingTaskId !== null ? (
                <>
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  Mengirim...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-1.5" />
                  Kirim Laporan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================ */}
      {/* DETAIL DIALOG                    */}
      {/* ================================ */}
      <Dialog open={!!detailOpen} onOpenChange={(open) => { if (!open) { setDetailOpen(null); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base leading-tight">{detailOpen?.title}</DialogTitle>
            <DialogDescription>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <Badge variant="secondary" className={cn("text-[10px]", TYPE_CONFIG[detailOpen?.type || 'general']?.className)}>
                  {TYPE_CONFIG[detailOpen?.type || 'general']?.label}
                </Badge>
                <Badge variant="secondary" className={cn("text-[10px]", PRIORITY_CONFIG[detailOpen?.priority || 'normal']?.className)}>
                  {PRIORITY_CONFIG[detailOpen?.priority || 'normal']?.label}
                </Badge>
                <Badge variant="secondary" className={cn("text-[10px]", STATUS_CONFIG[detailOpen?.status || 'pending']?.className)}>
                  {STATUS_CONFIG[detailOpen?.status || 'pending']?.label}
                </Badge>
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* Task details */}
          <div className="space-y-4 py-2">
            {/* Description */}
            {detailOpen?.description && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="w-3.5 h-3.5" />
                  Deskripsi
                </div>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                  {detailOpen.description}
                </p>
              </div>
            )}

            {/* Meta info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {detailOpen?.dueDate && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Deadline</p>
                  <div className="flex items-center gap-1">
                    <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className={cn(
                      isOverdue(detailOpen.dueDate, detailOpen.status) && "text-red-600 dark:text-red-400 font-medium"
                    )}>
                      {formatDate(detailOpen.dueDate)}
                    </span>
                  </div>
                </div>
              )}
              {detailOpen?.assignedBy && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Ditugaskan oleh</p>
                  <div className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>{detailOpen.assignedBy?.name || '-'}</span>
                  </div>
                </div>
              )}
              {detailOpen?.completedAt && (
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Diselesaikan</p>
                  <p className="text-green-600 dark:text-green-400">{formatDateTime(detailOpen.completedAt)}</p>
                </div>
              )}
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">Dibuat</p>
                <p>{formatDateTime(detailOpen?.createdAt || '')}</p>
              </div>
            </div>

            {/* Completion Note */}
            {detailOpen?.completionNote && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Catatan Penyelesaian</p>
                <p className="text-sm whitespace-pre-wrap bg-green-50 dark:bg-green-950/30 rounded-lg p-3">
                  {detailOpen.completionNote}
                </p>
              </div>
            )}

            {/* Reports Timeline */}
            {detailTask?.reports && detailTask.reports.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" />
                  Riwayat Laporan
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {detailTask.reports.map((report, idx) => (
                    <div
                      key={report.id}
                      className="relative pl-5 pb-3 border-l-2 border-muted last:border-l-0"
                    >
                      {/* Timeline dot */}
                      <div className={cn(
                        "absolute -left-[7px] top-0.5 w-3 h-3 rounded-full border-2 border-background",
                        idx === detailTask.reports.length - 1
                          ? "bg-primary"
                          : "bg-muted-foreground/30"
                      )} />
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="secondary" className={cn("text-[10px]", STATUS_CONFIG[report.status as TaskStatus]?.className)}>
                            {STATUS_CONFIG[report.status as TaskStatus]?.label}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDateTime(report.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{report.note}</p>
                        {report.evidence && (
                          <p className="text-xs text-muted-foreground italic">
                            Bukti: {report.evidence}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

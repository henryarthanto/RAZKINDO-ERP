'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  X,
  Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api-client';
import { formatDate } from '@/lib/erp-helpers';

// ================================
// TYPES
// ================================

interface TaskPreview {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate?: string | null;
}

type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; className: string }> = {
  low: { label: 'Rendah', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
  normal: { label: 'Normal', className: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' },
  high: { label: 'Tinggi', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' },
  urgent: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

const isOverdue = (dueDate?: string | null): boolean => {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
};

// ================================
// PROPS
// ================================

interface SalesTaskPopupProps {
  onNavigate: (moduleId: string) => void;
}

// ================================
// COMPONENT
// ================================

export default function SalesTaskPopup({ onNavigate }: SalesTaskPopupProps) {
  const { user } = useAuthStore();
  const hasShownRef = useRef(false);
  const [open, setOpen] = useState(false);

  // Fetch active tasks (pending + in_progress)
  const { data, isLoading } = useQuery({
    queryKey: ['my-tasks-popup', user?.id],
    queryFn: () => apiFetch<{ tasks: TaskPreview[] }>('/api/sales-tasks'),
    enabled: !!user?.id && user?.role === 'sales',
    staleTime: 0, // Always fresh for popup
  });

  const allTasks = data?.tasks || [];
  const activeTasks = allTasks.filter(
    (t: TaskPreview) => t.status === 'pending' || t.status === 'in_progress'
  );
  const overdueTasks = activeTasks.filter((t: TaskPreview) => isOverdue(t.dueDate));

  const hasActiveTasks = activeTasks.length > 0;
  const hasOverdue = overdueTasks.length > 0;

  // Auto-show once when active tasks are found
  useEffect(() => {
    if (
      !isLoading &&
      hasActiveTasks &&
      !hasShownRef.current
    ) {
      hasShownRef.current = true;
      // Small delay for smoother UX after page load
      const timer = setTimeout(() => {
        setOpen(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isLoading, hasActiveTasks]);

  // Handle navigate to tasks module
  const handleNavigate = useCallback(() => {
    setOpen(false);
    onNavigate('tugas');
  }, [onNavigate]);

  // Don't render if not sales or loading
  if (!user || user.role !== 'sales' || isLoading) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-0 gap-0 overflow-hidden">
        {/* Header with gradient */}
        <div className={cn(
          "px-5 pt-5 pb-4 bg-gradient-to-br",
          hasOverdue
            ? "from-orange-500 to-red-600"
            : "from-blue-500 to-indigo-600"
        )}>
          <DialogHeader>
            <DialogTitle className="text-white text-base flex items-center gap-2">
              <ClipboardList className="w-5 h-5" />
              Anda Memiliki Tugas Aktif!
            </DialogTitle>
            <DialogDescription className="text-white/80 text-sm mt-1.5">
              <span className="inline-flex items-center gap-1">
                <Badge className="bg-white/25 text-white border-0 text-xs px-2">
                  {activeTasks.length} tugas
                </Badge>
                menunggu perhatian Anda
              </span>
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* Overdue Warning */}
        {hasOverdue && (
          <div className="mx-5 mt-4 px-3 py-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
              <strong>{overdueTasks.length} tugas</strong> sudah melewati deadline! Segera selesaikan untuk menghindari penalti.
            </p>
          </div>
        )}

        {/* Task List */}
        <div className="px-5 py-4 space-y-2 max-h-64 overflow-y-auto">
          {activeTasks.map((task: TaskPreview) => {
            const overdue = isOverdue(task.dueDate);
            return (
              <div
                key={task.id}
                className={cn(
                  "flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors",
                  overdue
                    ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20"
                    : "border-muted bg-muted/30"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate leading-tight">{task.title}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        PRIORITY_CONFIG[task.priority as TaskPriority]?.className
                      )}
                    >
                      {PRIORITY_CONFIG[task.priority as TaskPriority]?.label}
                    </Badge>
                    {task.dueDate && (
                      <span className={cn(
                        "text-[10px] flex items-center gap-0.5",
                        overdue
                          ? "text-red-600 dark:text-red-400 font-medium"
                          : "text-muted-foreground"
                      )}>
                        <CalendarClock className="w-3 h-3" />
                        {formatDate(task.dueDate)}
                      </span>
                    )}
                  </div>
                </div>
                {overdue && (
                  <Badge variant="destructive" className="shrink-0 text-[10px] px-1.5 py-0">
                    <Flame className="w-3 h-3 mr-0.5" />
                    Terlambat
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 pb-5 pt-2 flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setOpen(false)}
          >
            <X className="w-4 h-4 mr-1.5" />
            Tutup
          </Button>
          <Button
            className="w-full sm:w-auto"
            onClick={handleNavigate}
          >
            <ClipboardList className="w-4 h-4 mr-1.5" />
            Lihat Semua Tugas
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

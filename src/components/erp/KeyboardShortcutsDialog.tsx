'use client';

import { useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Keyboard } from 'lucide-react';

interface ShortcutEntry {
  keys: string;
  description: string;
  group?: string;
}

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: ShortcutEntry[];
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 text-[11px] font-mono font-medium text-foreground bg-muted border border-border/60 rounded-md shadow-[0_1px_0_1px_rgba(0,0,0,0.05)]">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: KeyboardShortcutsDialogProps) {
  // Show a one-time toast hint about keyboard shortcuts
  useEffect(() => {
    const shown = sessionStorage.getItem('shortcuts-hint-shown');
    if (!shown) {
      const timer = setTimeout(() => {
        toast('Tip: Tekan ? untuk melihat shortcut keyboard', {
          duration: 4000,
          id: 'shortcuts-hint',
        });
        sessionStorage.setItem('shortcuts-hint-shown', '1');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Group shortcuts
  const groups: Record<string, ShortcutEntry[]> = {};
  for (const s of shortcuts) {
    const group = s.group || 'Umum';
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="w-5 h-5" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Navigasi cepat menggunakan keyboard
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2 space-y-4">
          {Object.entries(groups).map(([groupName, entries]) => (
            <div key={groupName}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {groupName}
              </p>
              <div className="space-y-1">
                {entries.map((entry, i) => (
                  <div
                    key={`${groupName}-${i}`}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm">{entry.description}</span>
                    <div className="flex items-center gap-1 ml-3 shrink-0">
                      {entry.keys.split('+').map((key, j) => (
                        <span key={j} className="flex items-center gap-1">
                          {j > 0 && (
                            <span className="text-muted-foreground text-[10px]">+</span>
                          )}
                          <Kbd>{key.trim()}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

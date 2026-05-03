'use client';

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Check if already dismissed (computed once to avoid lint warning)
  const isDismissed = (() => {
    try {
      const wasDismissed = localStorage.getItem('pwa-install-dismissed');
      if (wasDismissed) {
        const dismissedAt = parseInt(wasDismissed);
        if (!isNaN(dismissedAt) && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
          return true;
        }
      }
    } catch {}
    return false;
  })();

  const [dismissed, setDismissed] = useState(isDismissed);

  // Listen for browser install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Listen for successful install
  useEffect(() => {
    const handler = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } catch {
      // User cancelled
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  return (
    <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-4 left-4 right-4 z-50 sm:left-auto sm:right-4 sm:w-80 bg-card border rounded-xl shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
        <Download className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">Install Aplikasi</p>
        <p className="text-xs text-muted-foreground">Pasang Razkindo ERP di perangkat Anda untuk akses lebih cepat.</p>
        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={handleInstall} className="h-7 text-xs">
            Install
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 text-xs p-0 px-1">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

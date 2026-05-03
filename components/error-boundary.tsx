'use client';

import React, { ReactNode, useEffect, useState, createContext, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

// =====================================================================
// REACT ERROR BOUNDARY - Catches uncaught errors in component tree
// =====================================================================
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h2 className="text-xl font-semibold mb-2">Terjadi Kesalahan</h2>
          <p className="text-muted-foreground mb-4 max-w-md">
            {this.state.error?.message || 'Komponen mengalami error yang tidak terduga.'}
          </p>
          <Button onClick={this.handleReset} variant="outline">
            Muat Ulang Halaman
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// =====================================================================
// NETWORK STATUS INDICATOR - Shows offline/online status
// =====================================================================
export function NetworkStatusIndicator() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Set initial state based on navigator.onLine
    // Use a microtask to avoid calling setState synchronously in the effect body
    queueMicrotask(() => setIsOnline(navigator.onLine));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-destructive text-destructive-foreground text-center text-xs font-medium py-1 px-4">
      ⚠ Koneksi terputus — Beberapa fitur mungkin tidak tersedia
    </div>
  );
}

// =====================================================================
// GLOBAL ERROR HANDLER - Catches unhandled errors globally
// =====================================================================
export function GlobalErrorHandler() {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error);
      const msg = event.error?.message || '';
      // Skip transient JSON parse errors from fetch (e.g. during hot reload)
      if (msg.includes('is not valid JSON') || msg.includes('Unexpected token')) return;
      // Only show errors in development or for critical errors
      if (process.env.NODE_ENV === 'development') {
        setError(event.error);
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = event.reason?.message || String(event.reason);
      console.error('Unhandled promise rejection:', event.reason);
      // Skip transient fetch/network errors (e.g. during hot reload, aborted requests)
      if (msg.includes('is not valid JSON') || msg.includes('Unexpected token') || msg.includes('aborted') || msg.includes('Failed to fetch')) {
        event.preventDefault();
        return;
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  if (!error) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-sm bg-destructive/10 border border-destructive/20 rounded-lg p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-destructive">Error</p>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{error.message}</p>
        </div>
        <button
          onClick={() => setError(null)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// LOADING FALLBACK - Reusable loading spinner component
// =====================================================================
export function LoadingFallback({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">{message || 'Memuat data...'}</p>
      </div>
    </div>
  );
}

// =====================================================================
// DYNAMIC VIEW PROVIDER - Context for responsive view settings
// =====================================================================
interface DynamicViewContextType {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
}

const DynamicViewContext = createContext<DynamicViewContextType>({
  isMobile: false,
  isTablet: false,
  isDesktop: true,
});

export function useDynamicView() {
  return useContext(DynamicViewContext);
}

export function DynamicViewProvider({ children }: { children: ReactNode }) {
  const [viewState, setViewState] = useState<DynamicViewContextType>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateView = () => {
      const width = window.innerWidth;
      setViewState({
        isMobile: width < 768,
        isTablet: width >= 768 && width < 1024,
        isDesktop: width >= 1024,
      });
    };

    updateView();
    window.addEventListener('resize', updateView);

    return () => {
      window.removeEventListener('resize', updateView);
    };
  }, []);

  return (
    <DynamicViewContext.Provider value={viewState}>
      {children}
    </DynamicViewContext.Provider>
  );
}

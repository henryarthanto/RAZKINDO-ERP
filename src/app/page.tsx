'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { QueryProvider, POLLING_CONFIG, MODULE_POLLING } from '@/providers/query-provider';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useUIStore } from '@/stores/ui-store';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch } from '@/lib/api-client';
import { useDynamicFavicon } from '@/hooks/use-dynamic-favicon';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useSupabaseRealtime } from '@/hooks/use-supabase-realtime';
import { disconnectWebSocket } from '@/hooks/use-websocket';
import { cn } from '@/lib/utils';
import { formatDateTime, formatCurrency, getInitials } from '@/lib/erp-helpers';

// Error Handling & Dynamic View Components
import {
  GlobalErrorHandler,
  NetworkStatusIndicator,
  DynamicViewProvider,
} from '@/components/error-boundary';

// Icons (only for MainApp layout)
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  DollarSign,
  UserCheck,
  Users,
  Settings,
  LogOut,
  X,
  Bell,
  BarChart3,
  RefreshCw,
  KeyRound,
  ClipboardList,
  Wallet,
  Smartphone,
  Loader2,
} from 'lucide-react';

// UI Components (only for MainApp layout)
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from 'sonner';

// Types
import type { Event } from '@/types';

// Module Components
import LoginPage from '@/components/erp/LoginPage';
import DashboardModule from '@/components/erp/DashboardModule';
import TransactionsModule from '@/components/erp/TransactionsModule';
import ProductsModule from '@/components/erp/ProductsModule';
import CustomersModule from '@/components/erp/CustomersModule';
import SuppliersModule from '@/components/erp/SuppliersModule';
import SalesDashboard from '@/components/erp/SalesDashboard';
import CourierDashboard from '@/components/erp/CourierDashboard';
import DeliveriesModule from '@/components/erp/DeliveriesModule';
import FinanceModule from '@/components/erp/FinanceModule';
import SalariesModule from '@/components/erp/SalariesModule';
import UsersModule from '@/components/erp/UsersModule';
import SettingsModule from '@/components/erp/SettingsModule';
import CustomerManagementModule from '@/components/erp/CustomerManagementModule';
import SalesTaskManagement from '@/components/erp/SalesTaskManagement';
import SalesTaskDashboard from '@/components/erp/SalesTaskDashboard';
import SalesTaskPopup from '@/components/erp/SalesTaskPopup';
import AIChatPanel from '@/components/erp/AIChatPanel';
import CashbackManagementModule from '@/components/erp/CashbackManagementModule';
import PWAOrdersModule from '@/components/erp/PWAOrdersModule';
import { ChangePasswordDialog } from '@/components/erp/ChangePasswordDialog';
import { PWAInstallPrompt } from '@/components/PWAInstallPrompt';
import { KeyboardShortcutsDialog } from '@/components/erp/KeyboardShortcutsDialog';

// ============== MOBILE BOTTOM NAV ==============
function MobileBottomNav({
  activeModule,
  onNavigate,
  onOpenMore,
}: {
  activeModule: string;
  onNavigate: (id: string) => void;
  onOpenMore: () => void;
}) {
  const { user } = useAuthStore();

  const allModules = [
    { id: 'dashboard', label: 'Beranda', icon: LayoutDashboard, roles: ['super_admin', 'sales', 'kurir', 'keuangan'] },
    { id: 'transaksi', label: 'Transaksi', icon: ShoppingCart, roles: ['super_admin', 'sales', 'kurir', 'keuangan'] },
    { id: 'produk', label: 'Produk', icon: Package, roles: ['super_admin', 'keuangan'] },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, roles: ['super_admin', 'sales'] },
    { id: 'tugas', label: 'Tugas', icon: ClipboardList, roles: ['super_admin', 'sales'] },
    { id: 'supplier', label: 'Supplier', icon: Truck, roles: ['super_admin'] },
    { id: 'pengiriman', label: 'Kirim', icon: Truck, roles: ['super_admin', 'kurir'] },
    { id: 'finance', label: 'Keuangan', icon: DollarSign, roles: ['super_admin', 'keuangan'] },
    { id: 'gaji', label: 'Gaji', icon: UserCheck, roles: ['super_admin', 'keuangan'] },
    { id: 'pengguna', label: 'Pengguna', icon: Users, roles: ['super_admin'] },
    { id: 'pengaturan', label: 'Setting', icon: Settings, roles: ['super_admin'] },
  ];

  const visible = allModules.filter(m => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    const effectiveRoles = user.effectiveRoles || [];
    if (effectiveRoles.includes('super_admin')) return true;
    if (effectiveRoles.length > 0) return m.roles.some(r => effectiveRoles.includes(r));
    return m.roles.includes(user.role);
  });

  const seen = new Set<string>();
  const unique = visible.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const bottomItems = unique.slice(0, 4);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden pointer-events-none" style={{ bottom: 'max(-4px, calc(-4px - env(safe-area-inset-bottom, 0px)))' }}>
      <div className="mx-2 mb-1 pointer-events-auto">
        {/* Floating pill container */}
        <div className="relative flex items-center justify-around bg-card/90 backdrop-blur-2xl rounded-2xl border border-border/40 shadow-[0_-4px_24px_rgba(0,0,0,0.08),0_-1px_4px_rgba(0,0,0,0.04)]">
          {/* Active indicator glow */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div
              className="absolute top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/60 to-transparent transition-all duration-500 ease-out"
              style={{
                width: `${100 / (bottomItems.length + 1)}%`,
                left: `${(bottomItems.findIndex(m => activeModule === m.id) / (bottomItems.length + 1)) * 100}%`,
                opacity: bottomItems.some(m => activeModule === m.id) ? 1 : 0,
              }}
            />
          </div>
          <div className="flex items-center justify-around w-full px-1 py-1.5">
            {bottomItems.map(({ id, label, icon: Icon }) => {
              const isActive = activeModule === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  className={cn(
                    "relative flex flex-col items-center justify-center min-w-0 flex-1 py-1.5 rounded-xl transition-all duration-300 ease-out active:scale-90 group",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground/60"
                  )}
                >
                  {/* Active icon background pill */}
                  <div className={cn(
                    "relative flex items-center justify-center rounded-xl transition-all duration-300 ease-out",
                    isActive
                      ? "w-11 h-11 bg-primary/10 shadow-sm"
                      : "w-10 h-10 group-active:w-9 group-active:h-9"
                  )}>
                    <Icon
                      className={cn(
                        "transition-all duration-300 ease-out",
                        isActive ? "w-[22px] h-[22px]" : "w-5 h-5"
                      )}
                      strokeWidth={isActive ? 2.2 : 1.6}
                    />
                    {/* Active dot indicator */}
                    {isActive && (
                      <span className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-primary animate-in fade-in zoom-in duration-300" />
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] leading-[11px] font-semibold truncate max-w-full mt-1 transition-all duration-300",
                    isActive ? "opacity-100 scale-100" : "opacity-50 scale-95"
                  )}>
                    {label}
                  </span>
                </button>
              );
            })}
            {/* "Lainnya" button */}
            <button
              onClick={onOpenMore}
              className="relative flex flex-col items-center justify-center min-w-0 flex-1 py-1.5 rounded-xl text-muted-foreground/60 transition-all duration-300 ease-out active:scale-90 group"
            >
              <div className="relative flex items-center justify-center rounded-xl w-10 h-10 group-active:w-9 group-active:h-9 transition-all duration-300">
                <div className="grid grid-cols-2 gap-[2.5px] w-[14px] h-[14px]">
                  <span className="w-[5px] h-[5px] rounded-full bg-current" />
                  <span className="w-[5px] h-[5px] rounded-full bg-current" />
                  <span className="w-[5px] h-[5px] rounded-full bg-current" />
                  <span className="w-[5px] h-[5px] rounded-full bg-current" />
                </div>
              </div>
              <span className="text-[10px] leading-[11px] font-semibold truncate max-w-full mt-1 opacity-50 scale-95 transition-all duration-300">
                Lainnya
              </span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

// ============== NOTIFICATION HELPER ==============
function formatEventMessage(type: string, payload: any): { message: string; icon: string } {
  const p = payload || {};
  switch (type) {
    case 'transaction_created':
      return { message: `${p.createdBy || 'Sales'} membuat penjualan sebesar ${formatCurrency(p.total || 0)}`, icon: '🛒' };
    case 'transaction_approved':
      return { message: `Transaksi ${p.invoiceNo || '-'} disetujui (${formatCurrency(p.total || 0)})`, icon: '✅' };
    case 'transaction_cancelled':
      return { message: `Transaksi ${p.invoiceNo || '-'} dibatalkan`, icon: '❌' };
    case 'transaction_delivered':
      return { message: `${p.courierName || 'Kurir'} mengirim pesanan ${p.customerName || ''} (${formatCurrency(p.amount || 0)})`, icon: '🚚' };
    case 'payment_received':
      return { message: `Pembayaran ${formatCurrency(p.amount || 0)} diterima (${p.invoiceNo || '-'})`, icon: '💰' };
    case 'salary_request_created':
      return { message: `Request gaji ${p.userName || ''} sebesar ${formatCurrency(p.amount || 0)} (${p.period || '-'})`, icon: '📋' };
    case 'salary_paid':
      return { message: `Gaji ${p.userName || 'karyawan'} telah dibayar ${formatCurrency(p.amount || 0)}`, icon: '💵' };
    case 'finance_request_created':
      return { message: `Request ${p.type || ''} sebesar ${formatCurrency(p.amount || 0)} dibuat`, icon: '📝' };
    case 'finance_request_approved':
      return { message: `Request ${p.type || ''} ${formatCurrency(p.amount || 0)} disetujui`, icon: '✅' };
    case 'finance_request_rejected':
      return { message: `Request ${p.type || ''} ${formatCurrency(p.amount || 0)} ditolak`, icon: '🚫' };
    case 'finance_request_processed':
      return { message: `Pembayaran ${p.type || ''} ${formatCurrency(p.amount || 0)} selesai diproses`, icon: '💳' };
    case 'stock_low':
      return { message: `Stok ${p.productName || 'produk'} rendah (${p.currentStock || 0} / min ${p.minStock || 0})`, icon: '⚠️' };
    case 'product_created':
      return { message: `Produk baru "${p.name || '-'}" ditambahkan`, icon: '📦' };
    case 'user_approved':
      return { message: `User baru ${p.userName || ''} disetujui`, icon: '👤' };
    case 'payment_proof_uploaded':
      return { message: `${p.customerName || 'Konsumen'} mengirim bukti bayar untuk ${p.invoiceNo || '-'}`, icon: '📸' };
    default:
      return { message: type.replace(/_/g, ' '), icon: '🔔' };
  }
}

// ============== MAIN APP COMPONENT ==============
function MainApp() {
  const { user, logout } = useAuthStore();
  const { units, selectedUnitId, setSelectedUnit, setUnits } = useUnitStore();
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const [activeModule, setActiveModule] = useState('dashboard');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);
  const queryClient = useQueryClient();

  // When unit is switched, invalidate all data queries so modules re-fetch
  const handleUnitChange = (value: string) => {
    const newUnitId = value === '__all__' ? '' : value;
    setSelectedUnit(newUnitId);
    // Invalidate all cached queries (except auth/settings which are unit-independent)
    queryClient.invalidateQueries({ predicate: (q) => {
      const key = q.queryKey[0] as string;
      return !['settings', 'units', 'events'].includes(key);
    }});
  };

  // =================================================================
  // REALTIME SYNC - Supabase Realtime + auto invalidation
  // When any user makes changes, all connected clients automatically
  // refresh their relevant data via Supabase postgres_changes.
  // Falls back to polling intervals if Realtime is not enabled.
  // =================================================================
  useSupabaseRealtime();

  // Fetch app settings for sidebar branding
  const { data: mainSettingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<any>('/api/settings')
  });
  const mainAppSettings = mainSettingsData?.settings || {};
  const companyName = mainAppSettings.company_name || 'Razkindo ERP';
  const companyLogo = mainAppSettings.company_logo || '';

  // Update browser favicon when company logo changes
  useDynamicFavicon(companyLogo || undefined);

  // Fetch units
  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: () => apiFetch<any>('/api/units'),
    staleTime: 60_000, // Units rarely change, cache for 1 minute
  });

  useEffect(() => {
    if (unitsData?.units) {
      setUnits(unitsData.units);
      // Fix stale selectedUnitId if it no longer exists in the units list
      // (can happen after DB reset/reseed or unit deletion)
      // Instead of clearing to null (which breaks all operations), auto-select first unit
      const prevSelectedUnitId = useUnitStore.getState().selectedUnitId;
      if (prevSelectedUnitId) {
        const unitExists = unitsData.units.some((u: any) => u.id === prevSelectedUnitId);
        if (!unitExists) {
          const firstUnitId = unitsData.units.length > 0 ? (unitsData.units[0] as any).id : null;
          setSelectedUnit(firstUnitId);
          console.log('[UnitStore] Replaced stale selectedUnitId with first unit:', firstUnitId);
        }
      } else if (unitsData.units.length > 0 && !prevSelectedUnitId) {
        // No unit selected and units are available — auto-select first unit for super_admin
        // Sales/kurir users get their assigned unit from user profile
        const userRole = useAuthStore.getState().user?.role;
        const userUnitId = useAuthStore.getState().user?.unitId;
        if (userRole === 'super_admin' && !userUnitId) {
          setSelectedUnit((unitsData.units[0] as any).id);
        }
      }
    }
  }, [unitsData, setUnits, setSelectedUnit]);

  // Activity tracking (server-side debounced + client-side 120s interval)
  const activeModuleRef = useRef(activeModule);
  useEffect(() => { activeModuleRef.current = activeModule; }, [activeModule]);
  useEffect(() => {
    // Update user activity every 120 seconds (reduced to lower write load on SQLite with 100+ users)
    // 30s × 100 users = 200 writes/min; 120s × 100 users = 50 writes/min — 4× reduction
    const interval = setInterval(() => {
      api.auth.updateActivity(activeModuleRef.current, 'viewing').catch(() => {});
    }, 120_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch events/notifications
  const { data: eventsData } = useQuery({
    queryKey: ['events'],
    queryFn: () => apiFetch<{ events: any[] }>('/api/events'),
    refetchInterval: MODULE_POLLING.events,
    staleTime: 10_000, // Events can be 10s stale
  });
  const events = eventsData?.events || [];

  // Fetch dashboard stats
  const { data: dashData } = useQuery({
    queryKey: ['dashboard', selectedUnitId],
    queryFn: () => apiFetch<{ dashboard: any }>(`/api/dashboard${selectedUnitId ? `?unitId=${selectedUnitId}` : ''}`),
    refetchInterval: MODULE_POLLING.dashboard,
    staleTime: 30_000, // Dashboard stats are fine 30s stale
  });

  const dashStats = dashData?.dashboard || {};

  // Handle logout
  const handleLogout = async () => {
    disconnectWebSocket();
    await api.auth.logout();
    logout();
    queryClient.clear();
    toast.success('Berhasil logout');
  };

  // Module definitions
  const modules = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin', 'sales', 'kurir', 'keuangan'] },
    { id: 'transaksi', label: 'Transaksi', icon: ShoppingCart, roles: ['super_admin', 'sales', 'kurir', 'keuangan'] },
    { id: 'produk', label: 'Produk & Stok', icon: Package, roles: ['super_admin', 'keuangan'] },
    { id: 'pelanggan', label: 'Pelanggan', icon: Users, roles: ['super_admin', 'sales'] },
    { id: 'tugas', label: 'Penugasan', icon: ClipboardList, roles: ['super_admin', 'sales'] },
    { id: 'supplier', label: 'Supplier & Beli', icon: Truck, roles: ['super_admin'] },
    { id: 'pengiriman', label: 'Pengiriman', icon: Truck, roles: ['super_admin', 'kurir'] },
    { id: 'finance', label: 'Finance', icon: DollarSign, roles: ['super_admin', 'keuangan'] },
    { id: 'gaji', label: 'Gaji', icon: UserCheck, roles: ['super_admin', 'keuangan'] },
    { id: 'pengguna', label: 'Pengguna', icon: Users, roles: ['super_admin'] },
    { id: 'cashback', label: 'Cashback', icon: Wallet, roles: ['super_admin'] },
    { id: 'pwa-orders', label: 'Order PWA', icon: Smartphone, roles: ['super_admin', 'sales'] },
    { id: 'pengaturan', label: 'Pengaturan', icon: Settings, roles: ['super_admin'] },
  ];

  const visibleModules = modules.filter(m => {
    if (!user) return false;
    if (user.role === 'super_admin') return true;
    // For custom role users, check effectiveRoles
    const effectiveRoles = user.effectiveRoles || [];
    if (effectiveRoles.includes('super_admin')) return true;
    if (effectiveRoles.length > 0) return m.roles.some(r => effectiveRoles.includes(r));
    // Fallback: check built-in role directly
    return m.roles.includes(user.role);
  });

  // Handle navigation with prefetch
  const handleNav = (id: string) => {
    setActiveModule(id);
    setSidebarOpen(false);

    const prefetchMap: Record<string, string[]> = {
      'dashboard': ['transaksi', 'produk'],
      'transaksi': ['pelanggan', 'produk'],
      'pelanggan': ['tugas', 'transaksi'],
      'finance': ['transaksi'],
      'tugas': ['pelanggan'],
    };

    const toPrefetch = prefetchMap[id] || [];
    toPrefetch.forEach(moduleId => {
      if (moduleId === 'transaksi') {
        queryClient.prefetchQuery({
          queryKey: ['transactions'],
          queryFn: () => apiFetch('/api/transactions?limit=20'),
          staleTime: 30_000,
        });
      } else if (moduleId === 'produk') {
        queryClient.prefetchQuery({
          queryKey: ['products'],
          queryFn: () => apiFetch('/api/products?activeOnly=true'),
          staleTime: 120_000,
        });
      } else if (moduleId === 'pelanggan') {
        queryClient.prefetchQuery({
          queryKey: ['customers'],
          queryFn: () => apiFetch('/api/customers?limit=50'),
          staleTime: 60_000,
        });
      }
    });
  };

  // ============== KEYBOARD SHORTCUTS ==============
  function handleEscape() {
    if (showShortcutsDialog) {
      setShowShortcutsDialog(false);
    } else if (showChangePassword) {
      setShowChangePassword(false);
    } else if (sidebarOpen) {
      setSidebarOpen(false);
    }
  }

  const shortcuts = useMemo(() => {
    const list = [
      {
        key: '?',
        shift: true,
        handler: () => setShowShortcutsDialog(true),
        description: 'Tampilkan shortcut keyboard',
      },
      {
        key: 'Escape',
        handler: handleEscape,
        description: 'Tutup dialog / sidebar',
      },
      {
        key: 'n',
        ctrl: true,
        handler: () => handleNav('transaksi'),
        description: 'Buat transaksi baru',
      },
      {
        key: '/',
        ctrl: true,
        handler: () => {
          // Focus search input if one exists
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[placeholder*="Cari"], input[placeholder*="cari"], input[placeholder*="Search"], input[placeholder*="search"]'
          );
          searchInput?.focus();
        },
        description: 'Fokus ke pencarian',
      },
    ];

    // Number keys 1-9 for quick module switch
    for (let i = 0; i < Math.min(visibleModules.length, 9); i++) {
      const m = visibleModules[i];
      list.push({
        key: String(i + 1),
        handler: () => handleNav(m.id),
        description: `Module ${m.label}`,
      });
    }

    return list;
  }, [visibleModules, handleNav, handleEscape]);

  // Build display entries for the shortcuts dialog
  const shortcutDisplayEntries = useMemo(() => {
    const entries = [
      { keys: '?', description: 'Tampilkan shortcut keyboard', group: 'Umum' },
      { keys: 'Esc', description: 'Tutup dialog / sidebar', group: 'Umum' },
      { keys: 'Ctrl + N', description: 'Buat transaksi baru', group: 'Umum' },
      { keys: 'Ctrl + /', description: 'Fokus ke pencarian', group: 'Umum' },
    ];

    for (let i = 0; i < Math.min(visibleModules.length, 9); i++) {
      entries.push({
        keys: String(i + 1),
        description: visibleModules[i].label,
        group: 'Navigasi Module',
      });
    }

    return entries;
  }, [visibleModules]);

  useKeyboardShortcuts(shortcuts);

  // Render active module
  const renderModule = () => {
    if (!user) return null;
    switch (activeModule) {
      case 'dashboard': {
        const er = user.effectiveRoles || [];
        if (er.includes('sales') && !er.includes('keuangan')) return <SalesDashboard />;
        if (er.includes('kurir') && !er.includes('sales') && !er.includes('keuangan')) return <CourierDashboard />;
        return <DashboardModule />;
      }
      case 'transaksi': return <TransactionsModule />;
      case 'produk': return <ProductsModule />;
      case 'pelanggan': return user.role === 'super_admin' ? <CustomerManagementModule /> : <CustomersModule />;
      case 'tugas': return user.role === 'super_admin' ? <SalesTaskManagement /> : <SalesTaskDashboard />;
      case 'supplier': return <SuppliersModule />;
      case 'pengiriman': return <DeliveriesModule />;
      case 'finance': return <FinanceModule />;
      case 'gaji': return <SalariesModule />;
      case 'pengguna': return <UsersModule />;
      case 'cashback': return <CashbackManagementModule />;
      case 'pwa-orders': return <PWAOrdersModule />;
      case 'pengaturan': return <SettingsModule />;
      default: return <DashboardModule />;
    }
  };

  const unreadEvents = events.filter((e: Event) => !e.isRead).length;

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden">
      {/* DESKTOP SIDEBAR */}
      <nav className={cn(
        "hidden lg:flex flex-col fixed top-0 left-0 h-full z-50",
        "bg-card/80 backdrop-blur-xl border-r border-border/50",
        "w-[68px] hover:w-[220px]",
        "transition-all duration-300 ease-in-out overflow-x-hidden"
      )}>
        <div className="h-14 shrink-0 flex items-center px-3 border-b border-border/50 gap-3 overflow-hidden">
          {companyLogo ? (
            <img src={companyLogo} alt={companyName} className="w-8 h-8 rounded-lg object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
          )}
          <div className="min-w-0 whitespace-nowrap">
            <h2 className="font-semibold text-sm truncate">{companyName}</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {visibleModules.map(m => {
            const Icon = m.icon;
            const isActive = activeModule === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleNav(m.id)}
                title={m.label}
                className={cn(
                  "w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm transition-all duration-200 text-left",
                  "whitespace-nowrap overflow-hidden",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/80"
                )}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="truncate">{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="shrink-0 px-2 py-2 border-t border-border/50">
          <div className="flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-emerald-600">
                {(selectedUnitId
                  ? (units.find((u: any) => u.id === selectedUnitId)?.name || 'U')
                  : (user?.role === 'super_admin' ? 'AU' : (user?.userUnits?.[0]?.name || user?.unit?.name || 'U'))).slice(0, 2).toUpperCase()}
              </span>
            </div>
            <span className="truncate">
              {selectedUnitId
                ? (units.find((u: any) => u.id === selectedUnitId)?.name || 'Semua Unit')
                : (user?.role === 'super_admin' ? 'Semua Unit' : (user?.userUnits?.[0]?.name || user?.unit?.name || '-'))}
            </span>
          </div>
        </div>
      </nav>

      {/* MOBILE SIDEBAR */}
      <nav className={cn(
        "fixed top-0 left-0 h-full w-72 bg-card border-r border-border/50 flex flex-col z-50 lg:hidden",
        "transition-transform duration-300 ease-out",
        "safe-top",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between px-4 h-14 border-b border-border/50">
          <div className="flex items-center gap-3">
            {companyLogo ? (
              <img src={companyLogo} alt={companyName} className="w-8 h-8 rounded-lg object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-bold text-sm truncate">{companyName}</h2>
              <p className="text-[11px] text-muted-foreground truncate">{user?.name}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="shrink-0">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-3 px-3">
          <div className="space-y-1">
            {visibleModules.map(m => {
              const Icon = m.icon;
              const isActive = activeModule === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => handleNav(m.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 text-left",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/80 hover:text-foreground active:scale-[0.98]"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/60"
                  )}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span>{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="shrink-0 px-4 py-3 border-t border-border/50 safe-bottom">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-red-500 hover:bg-red-50 active:scale-[0.98] transition-all"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </nav>

      {/* MAIN AREA */}
      <div className="flex-1 lg:ml-[68px] flex flex-col min-h-0 min-w-0 h-[100dvh] overflow-hidden">
        {/* HEADER */}
        <header className="sticky top-0 z-30 bg-background/70 backdrop-blur-xl border-b border-border/40 shrink-0 safe-top">
          <div className="flex items-center justify-between h-12 px-3 sm:px-4 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-semibold truncate">
                {modules.find(m => m.id === activeModule)?.label || 'Dashboard'}
              </h1>
              <div className="hidden md:flex items-center gap-1.5 ml-2">
                {dashStats.totalSales !== undefined && (
                  <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 0 }).format(dashStats.totalSales || 0)}
                  </span>
                )}
                {dashStats.totalTransactions !== undefined && (
                  <span className="text-[11px] font-medium text-blue-600 bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded-full">
                    {(dashStats.totalTransactions || 0).toLocaleString('id-ID')} orders
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Popover onOpenChange={(open) => {
                if (open && unreadEvents > 0) {
                  const unreadIds = events.filter((e: Event) => !e.isRead).map((e: Event) => e.id);
                  if (unreadIds.length > 0) {
                    apiFetch('/api/events/read', {
                      method: 'POST',
                      body: JSON.stringify({ ids: unreadIds })
                    }).catch(() => {});
                    queryClient.invalidateQueries({ queryKey: ['events'] });
                  }
                }
              }}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative h-9 w-9">
                    <Bell className="w-[18px] h-[18px]" />
                    {unreadEvents > 0 && (
                      <span className="absolute top-1 right-1 w-[16px] h-[16px] bg-red-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center ring-2 ring-background">
                        {unreadEvents > 9 ? '9+' : unreadEvents}
                      </span>
                    )}

                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] p-0 overflow-hidden" align="end" sideOffset={8}>

                  <div className="px-3 py-2.5 border-b flex items-center justify-between">
                    <p className="font-semibold text-sm">Notifikasi</p>
                    <span className="text-xs text-muted-foreground">{events.length > 0 ? `${events.length} notifikasi` : ''}</span>
                  </div>
                  <ScrollArea className="h-64">
                    {events.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Bell className="w-8 h-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Tidak ada notifikasi</p>
                      </div>
                    ) : (
                      <div className="divide-y">
                        {events.slice(0, 30).map((e: Event) => {
                          const { message, icon } = formatEventMessage(e.type, e.payload);
                          return (
                            <div key={e.id} className="px-3 py-2.5 hover:bg-muted/50 transition-colors">
                              <div className="flex gap-2">
                                <span className="text-sm shrink-0 mt-0.5">{icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs leading-relaxed text-foreground">{message}</p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatDateTime(e.createdAt)}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>

                </PopoverContent>
              </Popover>

              {(user?.role === 'super_admin' || (user?.userUnits && user.userUnits.length > 1)) ? (
                <Select value={selectedUnitId || '__all__'} onValueChange={handleUnitChange}>
                  <SelectTrigger className="w-24 sm:w-32 h-8 text-xs border-border/50">
                    <SelectValue placeholder={user?.role === 'super_admin' ? 'Semua Unit' : 'Pilih Unit'} />
                  </SelectTrigger>
                  <SelectContent>
                    {user?.role === 'super_admin' && <SelectItem value="__all__">Semua Unit</SelectItem>}
                    {(user?.role === 'super_admin' ? units : (user?.userUnits || [])).map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries()} title="Refresh data" className="h-9 w-9">
                <RefreshCw className="w-4 h-4" />
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9">
                    <Avatar className="w-7 h-7">
                      <AvatarFallback className="text-xs">{getInitials(user?.name || 'U')}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="w-9 h-9">
                        <AvatarFallback>{getInitials(user?.name || 'U')}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{user?.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                      </div>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setShowChangePassword(true)}>
                    <KeyRound className="w-4 h-4 mr-2" />
                    Ubah Password
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-500 focus:text-red-500">
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* MAIN CONTENT */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 sm:p-4 pb-[88px] lg:pb-4 overscroll-y-contain" style={{ paddingBottom: 'max(88px, calc(88px + env(safe-area-inset-bottom, 0px)))' }}>
          {renderModule()}
        </main>
      </div>

      {/* SIDEBAR OVERLAY */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* MOBILE BOTTOM NAV */}
      <MobileBottomNav
        activeModule={activeModule}
        onNavigate={(id) => {
          setActiveModule(id);
          setSidebarOpen(false);
        }}
        onOpenMore={() => setSidebarOpen(true)}
      />

      <SalesTaskPopup onNavigate={(id) => handleNav(id)} />
      {activeModule === 'dashboard' && <AIChatPanel />}
      <ChangePasswordDialog
        open={showChangePassword}
        onOpenChange={setShowChangePassword}
      />
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
        shortcuts={shortcutDisplayEntries}
      />
      <PWAInstallPrompt />
    </div>
  );
}

// ============== APP CONTENT ==============
function AppContent() {
  const { user, isAuthenticated, isLoading, hydrated, setUser, setHydrated, logout } = useAuthStore();
  const queryClient = useQueryClient();

  // Handle zustand persist hydration — manually rehydrate all stores and
  // set hydrated flag once storage is read.  With skipHydration: true on
  // every persist store, rehydration is deferred to the React lifecycle
  // so it never runs during Turbopack module evaluation (avoids TDZ).
  useEffect(() => {
    // Kick off async rehydration for all three persist stores
    useAuthStore.persist.rehydrate();
    useUnitStore.persist.rehydrate();
    useUIStore.persist.rehydrate();

    // Listen for auth store to finish hydrating
    const unsubFinish = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });

    // Also check if already hydrated (synchronous case)
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }

    return () => {
      unsubFinish();
    };
  }, [setHydrated]);

  // Register service worker for PWA
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed - non-critical
      });
    }
  }, []);

  // Listen for auth-error events from api-client (token expired mid-session)
  useEffect(() => {
    const handleAuthError = () => {
      disconnectWebSocket();
      logout();
      queryClient.clear();
      toast.error('Sesi telah berakhir, silakan login kembali');
    };
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, [logout]);

  // Verify token on mount/refresh — only once after hydration
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;

    let cancelled = false;

    api.auth.me()
      .then(data => {
        if (cancelled) return;
        if (data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Token invalid — clear auth state and show login
        logout();
      });

    return () => { cancelled = true; };
  }, [hydrated, isAuthenticated, setUser, logout]);

  // Wait for hydration to complete
  if (!hydrated || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <MainApp />;
}

// ============== EXPORT DEFAULT ==============
export default function Home() {
  return (
    <QueryProvider>
      <TooltipProvider>
        <DynamicViewProvider>
          <NetworkStatusIndicator />
          <GlobalErrorHandler />
          <AppContent />
        </DynamicViewProvider>
      </TooltipProvider>
    </QueryProvider>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { use } from 'react';
import { toast } from 'sonner';
import {
  ShoppingCart,
  History,
  UserPlus,
  Wallet,
  Download,
  Plus,
  Minus,
  Upload,
  Camera,
  CheckCircle2,
  Store,
  Package,
  Receipt,
  Send,
  ChevronRight,
  ChevronDown,
  Banknote,
  X,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Filter,
  Clock,
  FileText,
  Info,
  Sun,
  TrendingUp,
  RefreshCw,
  Home,
  Truck,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from '@/components/ui/drawer';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

// ── Safe Error Parser (handles non-JSON error responses) ──
async function safeParseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.error || data.message || 'Terjadi kesalahan';
  } catch {
    return `Terjadi kesalahan (HTTP ${res.status})`;
  }
}

// ── Formatting Helpers ──
const formatCurrency = (n: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const formatDateTime = (d: string) =>
  new Date(d).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// ── Types ──
interface CustomerData {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  code: string;
  cashbackBalance: number;
  cashbackType: string;
  cashbackValue: number;
  referralCount: number;
}

interface ProductData {
  id: string;
  name: string;
  price: number;
  stock: number;
  unit: string | null;
  subUnit: string | null;
  conversionRate: number | null;
  imageUrl: string | null;
  purchaseCount: number;
  lastPurchased: string | null;
  dealPrice: number | null;      // Harga deal per main unit (negotiated price)
  dealSubUnitPrice: number | null; // Harga deal per sub unit
}

interface CartItem {
  productId: string;
  productName: string;
  qty: number;
  price: number;
}

interface OrderData {
  id: string;
  invoiceNo: string;
  transactionDate: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  notes: string | null;
  items: any[];
  paymentProofs: any[];
  cashbackEarned: number;
  deliveredAt: string | null;
  courierCommission: number;
  deliveryDistance: string | null;
  deliveryAddress: string | null;
}

interface ReferralData {
  id: string;
  businessName: string;
  picName: string;
  phone: string;
  status: string;
  createdAt: string;
  notes: string | null;
}

interface SettingsData {
  company_name?: string;
  company_logo?: string;
}

type TabType = 'beranda' | 'riwayat' | 'referensi';

// ── Status Badge Components ──
function OrderStatusBadge({ status }: { status: string }) {
  if (status === 'approved')
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[11px] font-medium shadow-sm">
        Diproses
      </Badge>
    );
  if (status === 'pending')
    return (
      <Badge className="bg-orange-100 text-orange-700 border-0 text-[11px] font-medium shadow-sm">
        Menunggu
      </Badge>
    );
  if (status === 'cancelled')
    return (
      <Badge className="bg-red-100 text-red-700 border-0 text-[11px] font-medium shadow-sm">
        Dibatalkan
      </Badge>
    );
  return (
    <Badge className="bg-gray-100 text-gray-700 border-0 text-[11px] font-medium shadow-sm">{status}</Badge>
  );
}

function PaymentStatusBadge({ status }: { status: string }) {
  if (status === 'paid')
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 text-[11px] font-medium shadow-sm">
        Lunas
      </Badge>
    );
  if (status === 'partial')
    return (
      <Badge className="bg-amber-100 text-amber-700 border-0 text-[11px] font-medium shadow-sm">
        Sebagian
      </Badge>
    );
  return (
    <Badge className="bg-amber-100 text-amber-700 border-0 text-[11px] font-medium shadow-sm">
      Belum Bayar
    </Badge>
  );
}

function ReferralStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    new: 'bg-sky-100 text-sky-700',
    contacted: 'bg-amber-100 text-amber-700',
    converted: 'bg-emerald-100 text-emerald-700',
    lost: 'bg-red-100 text-red-700',
  };
  const labelMap: Record<string, string> = {
    new: 'Baru',
    contacted: 'Dihubungi',
    converted: 'Berhasil',
    lost: 'Gagal',
  };
  return (
    <Badge
      className={`${map[status] || 'bg-gray-100 text-gray-700'} border-0 text-[11px] font-medium shadow-sm`}
    >
      {labelMap[status] || status}
    </Badge>
  );
}

// ── Product Card Sub-Component ──
function ProductCard({
  product,
  inCart,
  onAdd,
  onQtyChange,
  isFrequent,
}: {
  product: ProductData;
  inCart: CartItem | undefined;
  onAdd: (p: ProductData) => void;
  onQtyChange: (productId: string, delta: number) => void;
  isFrequent: boolean;
}) {
  return (
    <Card className="rounded-2xl border-0 shadow-sm overflow-hidden bg-white active:scale-[0.97] transition-all duration-150 hover:shadow-md">
      {/* Product image */}
      <div className="aspect-square bg-gray-50 relative">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <ImageIcon className="w-8 h-8 text-gray-300" />
          </div>
        )}
        {/* Frequent purchase badge */}
        {isFrequent && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-emerald-500 text-white border-0 text-[10px] px-1.5 py-0.5 shadow-sm font-medium">
              <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
              {product.purchaseCount}x
            </Badge>
          </div>
        )}
        {/* Out of stock overlay */}
        {product.stock <= 0 && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/30 to-black/10 flex items-center justify-center backdrop-blur-[1px]">
            <span className="text-white text-xs font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
              Habis
            </span>
          </div>
        )}
      </div>
      <CardContent className="p-2.5 space-y-1">
        {/* Product name */}
        <p className="text-[11px] font-medium text-gray-900 line-clamp-2 leading-snug min-h-[2rem]">
          {product.name}
        </p>
        {/* Unit text */}
        {product.unit && (
          <p className="text-[10px] text-gray-400 leading-none">per {product.unit}</p>
        )}
        {/* Price — show deal price if available, otherwise show pengajuan label */}
        {product.dealPrice && product.dealPrice > 0 ? (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <Tag className="w-2.5 h-2.5 text-emerald-600" />
              <p className="text-[10px] font-semibold text-emerald-700 leading-tight">
                {formatCurrency(product.dealPrice)}
              </p>
            </div>
            {product.dealSubUnitPrice && product.dealSubUnitPrice > 0 && product.subUnit && (
              <p className="text-[9px] text-emerald-500 leading-none pl-[18px]">
                /{product.subUnit} {formatCurrency(product.dealSubUnitPrice)}
              </p>
            )}
            <p className="text-[8px] text-emerald-500/70 leading-none pl-[18px]">
              Harga Deal
            </p>
          </div>
        ) : (
          <p className="text-[10px] font-medium text-amber-600 bg-amber-50 rounded-md px-2 py-0.5 leading-tight inline-block">
            Harga Pengajuan
          </p>
        )}
        {/* Cart controls or add button */}
        {inCart ? (
          <div className="flex items-center justify-center gap-1.5 pt-0.5">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-lg border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300"
              onClick={() => onQtyChange(product.id, -1)}
            >
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-sm font-bold w-7 text-center text-emerald-700">{inCart.qty}</span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7 rounded-lg border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:border-emerald-300"
              onClick={() => onQtyChange(product.id, 1)}
              disabled={inCart.qty >= product.stock}
            >
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="w-full h-8 rounded-xl text-[11px] font-medium bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-sm active:scale-[0.97] transition-all duration-150"
            onClick={() => onAdd(product)}
            disabled={product.stock <= 0}
          >
            <Plus className="w-3 h-3 mr-1" />
            Tambah
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Error Boundary ──
class PWAErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm text-center w-full border border-gray-100">
            <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-gray-900 mb-2">Terjadi Kesalahan</h2>
            <p className="text-sm text-gray-500 mb-4">Halaman mengalami error. Coba muat ulang.</p>
            <Button
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 text-sm font-semibold"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Muat Ulang
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main Page Component ──
export default function CustomerPWAPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);

  // Data state
  const [customer, setCustomer] = useState<CustomerData | null>(null);
  const [settings, setSettings] = useState<SettingsData>({});
  const [products, setProducts] = useState<ProductData[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [referrals, setReferrals] = useState<ReferralData[]>([]);
  const [referralStats, setReferralStats] = useState<any>(null);
  const [referralConfig, setReferralConfig] = useState<any>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabType>('beranda');
  const [loading, setLoading] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>('all');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

  // Order drawer
  const [orderDrawerOpen, setOrderDrawerOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Upload proof dialog
  const [proofDialogOpen, setProofDialogOpen] = useState(false);
  const [proofTransactionId, setProofTransactionId] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofSuccess, setProofSuccess] = useState(false);

  // Cashback withdrawal drawer
  const [withdrawDrawerOpen, setWithdrawDrawerOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBankName, setWithdrawBankName] = useState('');
  const [withdrawAccountNo, setWithdrawAccountNo] = useState('');
  const [withdrawAccountHolder, setWithdrawAccountHolder] = useState('');
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);

  // Referral form
  const [refBusinessName, setRefBusinessName] = useState('');
  const [refPicName, setRefPicName] = useState('');
  const [refPhone, setRefPhone] = useState('');
  const [submittingReferral, setSubmittingReferral] = useState(false);

  // Invoice download
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const ordersLoadedRef = useRef(false);
  const referralsLoadedRef = useRef(false);

  // ── Register Service Worker for PWA ──
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed - non-critical
      });
    }
  }, []);

  // ── Fetch initial data ──
  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const [custRes, settRes, prodRes] = await Promise.all([
          fetch(`/api/pwa/${code}`),
          fetch(`/api/settings?public=true`),
          fetch(`/api/pwa/${code}/products`),
        ]);

        if (!custRes.ok) {
          throw new Error(await safeParseError(custRes));
        }

        const custData = await custRes.json();
        setCustomer(custData.customer);

        if (settRes.ok) {
          const settData = await settRes.json();
          setSettings(settData.settings || {});
        }

        // Pre-load products so they appear instantly in the drawer
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProducts(prodData.products || []);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Terjadi kesalahan';
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };
    fetchInitial();
  }, [code]);

  // ── Fetch orders (when switching to riwayat tab) ──
  const fetchOrders = useCallback(async (force = false) => {
    if (!force && ordersLoadedRef.current) return;
    setLoadingOrders(true);
    try {
      const res = await fetch(`/api/pwa/${code}/orders`);
      if (!res.ok) throw new Error('Gagal memuat riwayat');
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      ordersLoadedRef.current = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal memuat riwayat';
      toast.error(message);
    } finally {
      setLoadingOrders(false);
    }
  }, [code]);

  // ── Force refresh orders ──
  const refreshOrders = useCallback(() => {
    ordersLoadedRef.current = false;
    return fetchOrders(true);
  }, [fetchOrders]);

  // ── Fetch referrals (when switching to referensi tab) ──
  const fetchReferrals = useCallback(async (force = false) => {
    if (!force && referralsLoadedRef.current) return;
    setLoadingReferrals(true);
    try {
      const res = await fetch(`/api/pwa/${code}/referrals`);
      if (!res.ok) throw new Error('Gagal memuat referensi');
      const data = await res.json();
      setReferrals(Array.isArray(data.referrals) ? data.referrals : []);
      setReferralStats(data.stats || null);
      setReferralConfig(data.referralConfig || null);
      referralsLoadedRef.current = true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal memuat referensi';
      toast.error(message);
    } finally {
      setLoadingReferrals(false);
    }
  }, [code]);

  // ── Force refresh referrals ──
  const refreshReferrals = useCallback(() => {
    referralsLoadedRef.current = false;
    return fetchReferrals(true);
  }, [fetchReferrals]);

  // ── Tab change handler ──
  const handleTabChange = (tab: string) => {
    const t = tab as TabType;
    setActiveTab(t);
    if (t === 'riwayat') refreshOrders();
    if (t === 'referensi') refreshReferrals();
  };

  // ── Product loading ──
  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch(`/api/pwa/${code}/products`);
      if (!res.ok) throw new Error('Gagal memuat produk');
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal memuat produk';
      toast.error(message);
    } finally {
      setLoadingProducts(false);
    }
  };

  // ── Open order drawer (products already pre-loaded) ──
  const openOrderDrawer = () => {
    setCart([]);
    setOrderNotes('');
    setPaymentMethod('cash');
    setProductSearch('');
    setOrderDrawerOpen(true);
    // Products are pre-fetched on page load, but refresh if empty
    if (products.length === 0) {
      loadProducts();
    }
  };

  // ── Cart operations ──
  const addToCart = (product: ProductData) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.productId === product.id);
      if (existing) {
        if (existing.qty >= product.stock) {
          toast.warning('Stok tidak mencukupi');
          return prev;
        }
        return prev.map((c) =>
          c.productId === product.id ? { ...c, qty: c.qty + 1 } : c
        );
      }
      return [
        ...prev,
        { productId: product.id, productName: product.name, qty: 1, price: product.dealPrice && product.dealPrice > 0 ? product.dealPrice : product.price },
      ];
    });
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.productId !== productId) return c;
          const newQty = c.qty + delta;
          if (newQty <= 0) return null;
          return { ...c, qty: newQty };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const cartTotal = cart.reduce((sum, c) => sum + c.qty * c.price, 0);
  const cartItemCount = cart.reduce((sum, c) => sum + c.qty, 0);

  // ── Submit order ──
  const submitOrder = async () => {
    if (cart.length === 0) {
      toast.error('Keranjang masih kosong');
      return;
    }
    setSubmittingOrder(true);
    try {
      const res = await fetch(`/api/pwa/${code}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((c) => ({
            productId: c.productId,
            productName: c.productName,
            qty: c.qty,
            price: c.price,
          })),
          notes: orderNotes || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(await safeParseError(res));
      }

      toast.success('Pesanan berhasil dikirim! Menunggu persetujuan Sales.');

      // Refresh customer data to update cashback balance
      const custRes = await fetch(`/api/pwa/${code}`);
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomer(custData.customer);
      }

      // Clear orders cache so next riwayat view fetches fresh data
      setOrders([]);

      setOrderDrawerOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal mengirim pesanan';
      toast.error(message);
    } finally {
      setSubmittingOrder(false);
    }
  };

  // ── Upload proof ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (videos max 50MB, images max 20MB, others max 15MB)
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (isVideo && file.size > 50 * 1024 * 1024) {
      toast.error('Ukuran video maksimal 50MB');
      return;
    }
    if (isImage && file.size > 20 * 1024 * 1024) {
      toast.error('Ukuran gambar maksimal 20MB (akan dikompres otomatis)');
      return;
    }
    if (!isVideo && !isImage && file.size > 15 * 1024 * 1024) {
      toast.error('Ukuran file maksimal 15MB');
      return;
    }

    setProofFile(file);

    // Preview for images and videos
    if (isImage || isVideo) {
      const reader = new FileReader();
      reader.onload = (ev) => setProofPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setProofPreview(null);
    }
  };

  const uploadProof = async () => {
    if (!proofFile) {
      toast.error('Pilih file bukti bayar');
      return;
    }
    setUploadingProof(true);
    try {
      const formData = new FormData();
      formData.append('file', proofFile);
      formData.append('transactionId', proofTransactionId);

      const res = await fetch(`/api/pwa/${code}/upload-proof`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await safeParseError(res));
      }

      setProofSuccess(true);
      toast.success('Bukti bayar berhasil diupload!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal upload bukti bayar';
      toast.error(message);
    } finally {
      setUploadingProof(false);
    }
  };

  // ── Cashback withdrawal ──
  const submitWithdrawal = async () => {
    const amount = parseInt(withdrawAmount);
    if (!amount || amount < 10000) {
      toast.error('Minimum pencairan Rp10.000');
      return;
    }
    if (!withdrawBankName || !withdrawAccountNo || !withdrawAccountHolder) {
      toast.error('Data bank wajib diisi');
      return;
    }

    if (amount > (customer?.cashbackBalance || 0)) {
      toast.error('Jumlah melebihi saldo cashback');
      return;
    }

    setSubmittingWithdraw(true);
    try {
      const res = await fetch(`/api/pwa/${code}/cashback/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          bankName: withdrawBankName,
          accountNo: withdrawAccountNo,
          accountHolder: withdrawAccountHolder,
        }),
      });

      if (!res.ok) {
        throw new Error(await safeParseError(res));
      }

      const data = await res.json();
      toast.success(data.message || 'Permintaan pencairan berhasil!');

      // Refresh customer data
      const custRes = await fetch(`/api/pwa/${code}`);
      if (custRes.ok) {
        const custData = await custRes.json();
        setCustomer(custData.customer);
      }

      setWithdrawAmount('');
      setWithdrawBankName('');
      setWithdrawAccountNo('');
      setWithdrawAccountHolder('');
      setWithdrawDrawerOpen(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal mengajukan pencairan';
      toast.error(message);
    } finally {
      setSubmittingWithdraw(false);
    }
  };

  // ── Submit referral ──
  const submitReferral = async () => {
    if (!refBusinessName || !refPicName || !refPhone) {
      toast.error('Semua field wajib diisi');
      return;
    }

    setSubmittingReferral(true);
    try {
      const res = await fetch(`/api/pwa/${code}/referrals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: refBusinessName,
          picName: refPicName,
          phone: refPhone,
        }),
      });

      if (!res.ok) {
        throw new Error(await safeParseError(res));
      }

      toast.success('Referensi berhasil dikirim!');
      setRefBusinessName('');
      setRefPicName('');
      setRefPhone('');
      setReferrals([]); // Clear cache to re-fetch
      fetchReferrals();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal mengirim referensi';
      toast.error(message);
    } finally {
      setSubmittingReferral(false);
    }
  };

  // ── Download Invoice PDF ──
  const downloadInvoice = async (invoiceNo: string) => {
    setDownloadingInvoice(invoiceNo);
    try {
      const res = await fetch(`/api/pwa/${code}/invoice/${invoiceNo}`);
      if (!res.ok) throw new Error('Gagal memuat invoice');
      const { transaction } = await res.json();

      // Map to Transaction type expected by downloadInvoicePDF
      const tx = {
        invoiceNo: transaction.invoiceNo,
        transactionDate: transaction.transactionDate,
        type: transaction.type,
        status: transaction.status,
        paymentStatus: transaction.paymentStatus,
        paymentMethod: transaction.paymentMethod,
        total: transaction.total,
        paidAmount: transaction.paidAmount,
        remainingAmount: transaction.remainingAmount,
        dueDate: transaction.dueDate,
        notes: transaction.notes,
        deliveryAddress: transaction.deliveryAddress,
        customer: transaction.customer
          ? {
              id: transaction.customer.id,
              name: transaction.customer.name,
              phone: transaction.customer.phone,
              address: transaction.customer.address,
            }
          : null,
        createdBy: transaction.createdBy ? { name: transaction.createdBy.name } : null,
        unit: transaction.unit ? { name: transaction.unit.name } : null,
        items: (transaction.items || []).map((i: any) => ({
          id: i.id,
          productName: i.productName,
          qty: i.qty,
          price: i.price,
          hpp: i.hpp || 0,
          subtotal: i.subtotal,
          profit: i.profit || 0,
          qtyUnitType: i.qtyUnitType || 'main',
          product: i.product
            ? {
                id: i.product.id,
                unit: i.product.unit,
                subUnit: i.product.subUnit,
              }
            : null,
        })),
      };

      const { downloadInvoicePDF } = await import('@/lib/generate-invoice-pdf');
      await downloadInvoicePDF(tx as any);
      toast.success('Invoice berhasil diunduh!');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Gagal mengunduh invoice';
      toast.error(message);
    } finally {
      setDownloadingInvoice(null);
    }
  };

  // ── Filtered orders ──
  const filteredOrders = orderStatusFilter === 'all'
    ? orders
    : orders.filter((order) => {
        if (orderStatusFilter === 'pending_approval') return order.status === 'pending';
        if (orderStatusFilter === 'pending_payment') return order.status === 'approved' && order.paymentStatus === 'unpaid';
        if (orderStatusFilter === 'partial_payment') return order.status === 'approved' && order.paymentStatus === 'partial';
        if (orderStatusFilter === 'paid') return order.status === 'approved' && order.paymentStatus === 'paid';
        if (orderStatusFilter === 'cancelled') return order.status === 'cancelled';
        return true;
      });

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  // ── Filtered products for search ──
  const filteredProducts = productSearch.trim()
    ? products.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase())
      )
    : products;

  const frequentProducts = filteredProducts.filter((p) => p.purchaseCount > 0);
  const otherProducts = filteredProducts.filter((p) => p.purchaseCount === 0);

  // ── Loading State ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 w-full">
        {/* Header skeleton */}
        <div className="bg-gradient-to-br from-teal-600 via-emerald-600 to-emerald-700 pt-[env(safe-area-inset-top)] px-5 pb-6 relative overflow-hidden">
          {/* Decorative blobs */}
          <div className="absolute top-2 right-4 w-24 h-24 bg-white/5 rounded-full" />
          <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-8 -translate-x-4" />
          <div className="flex items-center gap-3 mb-5 relative">
            <Skeleton className="h-11 w-11 rounded-full bg-white/20 animate-pulse" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32 bg-white/20 animate-pulse" />
              <Skeleton className="h-3 w-24 bg-white/20 animate-pulse" />
            </div>
          </div>
          <div className="relative">
            <Skeleton className="h-8 w-40 bg-white/10 rounded-2xl animate-pulse mb-2" />
            <Skeleton className="h-4 w-20 bg-white/10 animate-pulse" />
          </div>
          {/* Wave divider */}
          <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 400 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 20L400 20L400 8C340 0 260 16 200 10C140 4 60 18 0 12L0 20Z" fill="#F9FAFB" />
          </svg>
        </div>
        {/* Content skeleton */}
        <div className="p-4 space-y-4">
          <Skeleton className="h-16 w-full rounded-2xl animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Skeleton className="h-28 w-full rounded-2xl animate-pulse" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-28 w-full rounded-2xl animate-pulse" />
            </div>
          </div>
          <Skeleton className="h-24 w-full rounded-2xl animate-pulse" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-24 rounded animate-pulse" />
            <Skeleton className="h-20 w-full rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  // ── Error: customer not found ──
  if (!customer) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 p-8 max-w-sm text-center w-full border border-gray-100">
          <div className="w-20 h-20 bg-gradient-to-br from-red-100 to-red-50 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
            <X className="w-9 h-9 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Kode Tidak Ditemukan</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            Pastikan kode pelanggan yang Anda masukkan sudah benar. Hubungi admin jika masalah
            berlanjut.
          </p>
          <Button
            className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-sm font-semibold shadow-md shadow-emerald-500/20 active:scale-[0.98] transition-all duration-150"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════
  // ── RENDER ──
  // ══════════════════════════════════════
  return (
    <PWAErrorBoundary>
    <Tabs
      value={activeTab}
      onValueChange={handleTabChange}
      className="min-h-screen bg-gray-50 flex flex-col w-full overflow-x-hidden"
    >
      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-40 bg-gradient-to-br from-teal-600 via-emerald-600 to-emerald-700 text-white pt-[env(safe-area-inset-top)] relative overflow-hidden">
        {/* Decorative floating circles */}
        <div className="absolute top-1 right-6 w-28 h-28 bg-white/5 rounded-full" />
        <div className="absolute bottom-2 left-0 w-20 h-20 bg-white/5 rounded-full -translate-x-6" />
        <div className="absolute top-8 right-24 w-10 h-10 bg-white/5 rounded-full" />

        {/* Company + Customer info */}
        <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5 relative">
          {settings.company_logo ? (
            <img
              src={settings.company_logo}
              alt="Logo"
              className="w-10 h-10 rounded-xl object-cover border-2 border-white/30 shadow-md"
            />
          ) : (
            <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20 shadow-md">
              <Store className="w-4.5 h-4.5 text-white/90" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-xs truncate">
              {settings.company_name || 'Razkindo Group'}
            </p>
            <p className="text-[11px] text-white/60 truncate">
              {customer.name} &middot; {customer.code}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-full text-[11px] font-medium h-8 px-3 shadow-lg shadow-black/10 backdrop-blur-sm transition-all duration-200 hover:shadow-xl"
            onClick={() => setWithdrawDrawerOpen(true)}
          >
            <Wallet className="w-3.5 h-3.5 mr-1" />
            Tarik
          </Button>
        </div>

        {/* Cashback balance — glass-morphism card */}
        <div className="px-3.5 pb-5 relative">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 shadow-lg shadow-black/5">
            <p className="text-[10px] text-white/50 uppercase tracking-widest font-medium mb-1">
              Saldo Cashback
            </p>
            <div className="flex items-end justify-between">
              <p className="text-[22px] font-bold tracking-tight leading-none break-words">{
                formatCurrency(customer.cashbackBalance || 0)
              }</p>
              <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-200" />
              </div>
            </div>
          </div>
        </div>

        {/* Wave divider */}
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 400 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 20L400 20L400 8C340 0 260 16 200 10C140 4 60 18 0 12L0 20Z" fill="#F9FAFB" />
        </svg>
      </header>

      {/* ── Main Content Area ── */}
      <main className="flex-1 pb-[calc(100px+env(safe-area-inset-bottom))] overflow-x-hidden max-w-full">
        {/* ════════════════════════════════ */}
        {/* ── Beranda (Home) Tab ── */}
        {/* ════════════════════════════════ */}
        <TabsContent value="beranda" className="mt-0 overflow-x-hidden max-w-full">
          <div className="px-3 pt-3 pb-4 space-y-3">
            {/* Greeting Banner */}
            <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 rounded-2xl p-3.5 border border-amber-100/80">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center shadow-md shadow-amber-200/50">
                  <Sun className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">
                    {(() => {
                      const hour = new Date().getHours();
                      if (hour < 11) return 'Selamat Pagi';
                      if (hour < 15) return 'Selamat Siang';
                      if (hour < 18) return 'Selamat Sore';
                      return 'Selamat Malam';
                    })()}, {customer.name.split(' ')[0]}!
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">Yuk mulai belanja hari ini</p>
                </div>
              </div>
            </div>

            {/* CTA Button Card */}
            <button
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl p-4 text-left shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all duration-150 hover:shadow-xl hover:shadow-emerald-500/30 relative overflow-hidden group"
              onClick={openOrderDrawer}
            >
              {/* Decorative circles */}
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="absolute bottom-0 left-1/2 w-16 h-16 bg-white/5 rounded-full translate-y-8" />
              <div className="relative flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm animate-pulse">
                  <ShoppingCart className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Pesan Sekarang</p>
                  <p className="text-[11px] text-white/70 mt-0.5">Pilih produk & ajukan pesanan</p>
                </div>
                <ChevronRight className="w-5 h-5 text-white/60 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-gradient-to-br from-emerald-50/80 to-emerald-50/40 rounded-2xl p-3 border border-emerald-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-200/50">
                    <Receipt className="w-4 h-4 text-white" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 font-medium">Total Pesanan</p>
                <p className="text-2xl font-extrabold text-gray-900 mt-0.5 tracking-tight">
                  {orders.length > 0
                    ? orders.length
                    : customer.referralCount > 0
                      ? '-'
                      : '0'}
                </p>
              </div>
              <div className="bg-gradient-to-br from-amber-50/80 to-amber-50/40 rounded-2xl p-3 border border-amber-100/50">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-400 flex items-center justify-center shadow-sm shadow-amber-200/50">
                    <Banknote className="w-4 h-4 text-white" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 font-medium">Cashback</p>
                <p className="text-lg font-extrabold text-gray-900 mt-0.5 tracking-tight break-words">
                  {formatCurrency(customer.cashbackBalance || 0)}
                </p>
              </div>
            </div>

            {/* Cashback Promo Card */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 rounded-2xl p-3.5 text-white relative overflow-hidden shadow-lg shadow-emerald-500/15">
              <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="absolute bottom-0 left-0 w-16 h-16 bg-white/5 rounded-full translate-y-6 -translate-x-4" />
              <div className="relative flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0 backdrop-blur-sm mt-0.5">
                  <Sparkles className="w-4.5 h-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white">Belanja & Raih Cashback</p>
                  <p className="text-[11px] text-white/80 leading-relaxed mt-0.5">
                    {customer.cashbackValue > 0
                      ? `Dapatkan cashback ${customer.cashbackType === 'percentage' ? `${customer.cashbackValue}%` : formatCurrency(customer.cashbackValue)} setiap order!`
                      : 'Belanja dan kumpulkan cashback yang bisa dicairkan.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recent order card — show the most recent order if any */}
            {orders.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Pesanan Terakhir
                  </p>
                  <button
                    className="text-xs text-emerald-600 font-medium flex items-center gap-0.5 hover:text-emerald-700 transition-colors"
                    onClick={() => handleTabChange('riwayat')}
                  >
                    Lihat Semua
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className={`rounded-2xl border-0 shadow-sm bg-white overflow-hidden border-l-[3px] ${orders[0].status === 'approved' ? 'border-l-emerald-500' : orders[0].status === 'pending' ? 'border-l-orange-400' : 'border-l-red-400'}`}>
                  <div className="p-3">
                    <div className="flex items-start justify-between mb-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-xs text-gray-900 truncate">
                          {orders[0].invoiceNo}
                        </p>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {formatDateTime(orders[0].transactionDate)}
                        </p>
                      </div>
                      <OrderStatusBadge status={orders[0].status} />
                    </div>
                    {orders[0].status === 'approved' && orders[0].total > 0 && (
                      <p className="text-xs font-bold text-gray-900">
                        {formatCurrency(orders[0].total)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ════════════════════════════════ */}
        {/* ── Riwayat (History) Tab ── */}
        {/* ════════════════════════════════ */}
        <TabsContent value="riwayat" className="mt-0 overflow-x-hidden max-w-full">
          <div className="px-3 pt-3 pb-4 space-y-3">
            {loadingOrders ? (
              <div className="space-y-2.5">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              /* ── Empty State ── */
              <div className="text-center py-16 px-4">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-50 rounded-full flex items-center justify-center mx-auto mb-5 shadow-sm">
                  <History className="w-9 h-9 text-gray-300" />
                </div>
                <p className="text-gray-800 text-sm font-bold">Belum ada riwayat pesanan</p>
                <p className="text-gray-400 text-xs mt-1.5 leading-relaxed">
                  Pesan produk pertamamu dan dapatkan cashback!
                </p>
                <Button
                  className="mt-5 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-md shadow-emerald-500/20 text-xs px-6 font-semibold active:scale-[0.98] transition-all duration-150"
                  onClick={openOrderDrawer}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                  Pesan Sekarang
                </Button>
              </div>
            ) : (
              <>
                {/* ── Status Filter Dropdown ── */}
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400 shrink-0" />
                  <Select
                    value={orderStatusFilter}
                    onValueChange={setOrderStatusFilter}
                  >
                    <SelectTrigger className="h-9 rounded-xl text-xs bg-white border-gray-200 flex-1 min-w-0">
                      <SelectValue placeholder="Filter Status" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="all" className="text-xs">Semua Pesanan</SelectItem>
                      <SelectItem value="pending_approval" className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-orange-500" />
                          Menunggu Approval
                        </span>
                      </SelectItem>
                      <SelectItem value="pending_payment" className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <Banknote className="w-3 h-3 text-amber-500" />
                          Menunggu Pelunasan
                        </span>
                      </SelectItem>
                      <SelectItem value="partial_payment" className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <Banknote className="w-3 h-3 text-amber-400" />
                          Bayar Sebagian
                        </span>
                      </SelectItem>
                      <SelectItem value="paid" className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          Lunas
                        </span>
                      </SelectItem>
                      <SelectItem value="cancelled" className="text-xs">
                        <span className="flex items-center gap-1.5">
                          <X className="w-3 h-3 text-red-400" />
                          Dibatalkan
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* ── Order count ── */}
                <p className="text-[11px] text-gray-400 font-medium px-0.5">
                  {filteredOrders.length} pesanan
                </p>

                {/* ── Order List (Compact Collapsible Cards) ── */}
                <div className="space-y-2.5">
                  {filteredOrders.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 text-xs font-medium">
                        Tidak ada pesanan dengan filter ini
                      </p>
                    </div>
                  ) : (
                    filteredOrders.map((order) => {
                      const isDelivered = !!order.deliveredAt;
                      const isPiutang = order.status === 'approved' && (order.paymentMethod === 'piutang' || order.paymentMethod === 'tempo') && order.paymentStatus !== 'paid';
                      const needsUpload = order.status === 'approved' && order.paymentStatus !== 'paid' && (order.paymentMethod === 'transfer' || order.paymentMethod === 'piutang' || order.paymentMethod === 'tempo');
                      const hasProofs = (order.paymentProofs || []).length > 0;
                      return (
                        <Collapsible
                          key={order.id}
                          open={expandedOrders.has(order.id)}
                          onOpenChange={() => toggleOrderExpand(order.id)}
                        >
                          <Card className={`rounded-2xl border-0 shadow-sm overflow-hidden bg-white border-l-[3px] ${order.status === 'approved' ? (isDelivered ? 'border-l-emerald-500' : 'border-l-sky-400') : order.status === 'pending' ? 'border-l-orange-400' : order.status === 'cancelled' ? 'border-l-red-400' : 'border-l-gray-300'}`}>
                            {/* ── Persistent Warning: Piutang belum lunas ── */}
                            {isPiutang && (
                              <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-2 flex items-center gap-2">
                                <AlertTriangle className="w-3.5 h-3.5 text-white shrink-0" />
                                <span className="text-[10px] text-white font-semibold leading-relaxed flex-1">
                                  {hasProofs
                                    ? 'Bukti bayar sedang diverifikasi. Menunggu konfirmasi lunas.'
                                    : 'Harap upload bukti pembayaran sebelum pesanan dapat diverifikasi lunas.'}
                                </span>
                                {!hasProofs && (
                                  <Button
                                    size="sm"
                                    className="h-6 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[10px] px-2 font-bold border-0 shrink-0 active:scale-[0.97] transition-all"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setProofTransactionId(order.id);
                                      setProofFile(null);
                                      setProofPreview(null);
                                      setProofSuccess(false);
                                      setProofDialogOpen(true);
                                    }}
                                  >
                                    Upload
                                  </Button>
                                )}
                              </div>
                            )}

                            {/* ── Compact Header (always visible) ── */}
                            <CollapsibleTrigger className="w-full text-left">
                              <div className="p-3 space-y-2">
                                {/* Row 1: Invoice + Status badges */}
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-[13px] text-gray-900 truncate leading-tight">
                                      {order.invoiceNo}
                                    </p>
                                    <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                                      {formatDateTime(order.transactionDate)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                    <OrderStatusBadge status={order.status} />
                                    {order.status === 'approved' && (
                                      <PaymentStatusBadge status={order.paymentStatus} />
                                    )}
                                    {isDelivered && (
                                      <Badge className="bg-sky-100 text-sky-700 border-0 text-[10px] font-medium">
                                        Dikirim
                                      </Badge>
                                    )}
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                                        expandedOrders.has(order.id) ? 'rotate-180' : ''
                                      }`}
                                    />
                                  </div>
                                </div>

                                {/* Row 2: Summary info — compact */}
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    {order.status === 'approved' && order.total > 0 && (
                                      <>
                                        <Tag className="w-3 h-3 text-gray-400 shrink-0" />
                                        <span className="text-[10px] text-gray-500 font-medium capitalize">
                                          {order.paymentMethod === 'piutang' ? 'Piutang' : order.paymentMethod === 'tempo' ? 'Tempo' : order.paymentMethod === 'cash' ? 'Cash' : order.paymentMethod === 'transfer' ? 'Transfer' : order.paymentMethod || '-'}
                                        </span>
                                      </>
                                    )}
                                    {order.status === 'pending' && (
                                      <span className="text-[10px] text-orange-500 font-medium">
                                        {(order.items || []).length} item
                                      </span>
                                    )}
                                  </div>
                                  {order.status === 'approved' && order.total > 0 && (
                                    <span className="text-[13px] font-bold text-gray-900 shrink-0">
                                      {formatCurrency(order.total)}
                                    </span>
                                  )}
                                </div>

                                {/* Quick status indicators */}
                                {order.status === 'pending' && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5">
                                    <Clock className="w-3 h-3 text-orange-500 shrink-0" />
                                    <span className="text-[10px] text-orange-600 leading-relaxed">
                                      Menunggu persetujuan Sales
                                    </span>
                                  </div>
                                )}

                                {/* Delivery notification — barang sudah diserahkan */}
                                {isDelivered && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5">
                                    <Truck className="w-3 h-3 text-emerald-500 shrink-0" />
                                    <span className="text-[10px] text-emerald-600 leading-relaxed">
                                      Barang sudah diserahkan — {formatDateTime(order.deliveredAt!)}
                                    </span>
                                  </div>
                                )}

                                {/* Approved + not delivered yet */}
                                {order.status === 'approved' && !isDelivered && !isPiutang && order.paymentStatus === 'unpaid' && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5">
                                    <Package className="w-3 h-3 text-sky-500 shrink-0" />
                                    <span className="text-[10px] text-sky-600 leading-relaxed">
                                      Pesanan sedang diproses
                                    </span>
                                  </div>
                                )}

                                {/* Approved + not delivered + paid */}
                                {order.status === 'approved' && !isDelivered && order.paymentStatus === 'paid' && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-sky-50 px-2.5 py-1.5">
                                    <Truck className="w-3 h-3 text-sky-500 shrink-0" />
                                    <span className="text-[10px] text-sky-600 leading-relaxed">
                                      Lunas — menunggu pengiriman barang
                                    </span>
                                  </div>
                                )}

                                {/* Partial payment info */}
                                {order.status === 'approved' && order.paymentStatus === 'partial' && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5">
                                    <Banknote className="w-3 h-3 text-amber-500 shrink-0" />
                                    <span className="text-[10px] text-amber-600 leading-relaxed">
                                      Dibayar {formatCurrency(order.paidAmount || 0)} — kurang {formatCurrency(order.remainingAmount || 0)}
                                    </span>
                                  </div>
                                )}

                                {/* Already delivered + paid = complete */}
                                {isDelivered && order.paymentStatus === 'paid' && (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                                    <span className="text-[10px] text-emerald-600 font-semibold leading-relaxed">
                                      Pesanan selesai
                                    </span>
                                  </div>
                                )}

                                {/* Quick action buttons — ALWAYS visible on the card */}
                                <div className="flex gap-2 pt-0.5">
                                  {/* Upload Bukti Bayar — when needed */}
                                  {needsUpload && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 h-8 rounded-xl text-[10px] border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 font-semibold active:scale-[0.97] transition-all duration-150"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setProofTransactionId(order.id);
                                        setProofFile(null);
                                        setProofPreview(null);
                                        setProofSuccess(false);
                                        setProofDialogOpen(true);
                                      }}
                                    >
                                      <Upload className="w-3 h-3 mr-1" />
                                      Upload Bukti Bayar
                                    </Button>
                                  )}

                                  {/* Download Invoice — always for approved orders */}
                                  {order.status === 'approved' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className={`${needsUpload ? 'h-8 w-auto' : 'flex-1 h-8'} rounded-xl text-[10px] border-gray-200 text-gray-600 hover:bg-gray-50 font-medium active:scale-[0.97] transition-all duration-150`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        downloadInvoice(order.invoiceNo);
                                      }}
                                      disabled={downloadingInvoice === order.invoiceNo}
                                    >
                                      {downloadingInvoice === order.invoiceNo ? (
                                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                      ) : (
                                        <Download className="w-3 h-3 mr-1" />
                                      )}
                                      {downloadingInvoice === order.invoiceNo
                                        ? '...'
                                        : 'Invoice'}
                                    </Button>
                                  )}
                                </div>

                                {/* Proof uploaded indicator */}
                                {hasProofs && order.status === 'approved' && order.paymentStatus !== 'paid' && (
                                  <div className="flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                    <span className="text-[10px] text-emerald-600 font-medium">
                                      Bukti bayar terupload ({(order.paymentProofs || []).length}) — menunggu verifikasi
                                    </span>
                                  </div>
                                )}
                              </div>
                            </CollapsibleTrigger>

                            {/* ── Expanded Details (hidden by default) ── */}
                            <CollapsibleContent>
                              <div className="px-3 pb-3.5 space-y-3 border-t border-gray-100 pt-3">
                                {/* Delivery info */}
                                {isDelivered && (
                                  <div className="bg-emerald-50 rounded-xl p-2.5 space-y-1">
                                    <p className="text-[10px] text-emerald-700 font-semibold uppercase tracking-wider flex items-center gap-1">
                                      <Truck className="w-3 h-3" />
                                      Info Pengiriman
                                    </p>
                                    <p className="text-[11px] text-emerald-600">
                                      Diserahkan: {formatDateTime(order.deliveredAt!)}
                                    </p>
                                    {order.deliveryAddress && (
                                      <p className="text-[10px] text-emerald-500">
                                        Alamat: {order.deliveryAddress}
                                      </p>
                                    )}
                                  </div>
                                )}

                                {/* Payment info */}
                                {order.status === 'approved' && (
                                  <div className="bg-gray-50 rounded-xl p-2.5 space-y-1.5">
                                    <p className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider flex items-center gap-1">
                                      <Receipt className="w-3 h-3" />
                                      Info Pembayaran
                                    </p>
                                    <div className="flex justify-between text-[11px]">
                                      <span className="text-gray-500">Metode</span>
                                      <span className="text-gray-700 font-medium capitalize">
                                        {order.paymentMethod === 'piutang' ? 'Piutang' : order.paymentMethod === 'tempo' ? 'Tempo' : order.paymentMethod === 'cash' ? 'Cash' : order.paymentMethod === 'transfer' ? 'Transfer' : order.paymentMethod || '-'}
                                      </span>
                                    </div>
                                    {order.total > 0 && (
                                      <div className="flex justify-between text-[11px]">
                                        <span className="text-gray-500">Total</span>
                                        <span className="text-gray-700 font-medium">{formatCurrency(order.total)}</span>
                                      </div>
                                    )}
                                    {order.paidAmount > 0 && (
                                      <div className="flex justify-between text-[11px]">
                                        <span className="text-gray-500">Dibayar</span>
                                        <span className="text-emerald-600 font-medium">{formatCurrency(order.paidAmount)}</span>
                                      </div>
                                    )}
                                    {(order.remainingAmount || 0) > 0 && (
                                      <div className="flex justify-between text-[11px]">
                                        <span className="text-gray-500">Kurang</span>
                                        <span className="text-red-500 font-medium">{formatCurrency(order.remainingAmount)}</span>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Items list */}
                                {(order.items || []).length > 0 && (
                                  <div className="space-y-1.5">
                                    <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                                      <Package className="w-3 h-3" />
                                      Detail Item ({(order.items || []).length})
                                    </p>
                                    <div className="bg-gray-50 rounded-xl p-2.5 space-y-1.5">
                                      {(order.items || []).map((item: any, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex items-center justify-between gap-1 text-[11px]"
                                        >
                                          <span className="text-gray-600 truncate min-w-0 flex-1">
                                            {item.productName}{' '}
                                            <span className="text-gray-400 font-medium">x{item.qty}</span>
                                          </span>
                                          {order.status === 'approved' && item.price > 0 && (
                                            <span className="text-gray-500 font-medium shrink-0 text-[10px]">
                                              @Rp {item.price.toLocaleString('id-ID')} = {formatCurrency(item.subtotal || item.price * item.qty)}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Cashback badge — only when LUNAS */}
                                {order.status === 'approved' &&
                                  order.paymentStatus === 'paid' &&
                                  order.cashbackEarned > 0 && (
                                    <div className="bg-emerald-50 rounded-xl px-2.5 py-2 flex items-center gap-2">
                                      <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
                                      <span className="text-[11px] text-emerald-700 font-semibold">
                                        +{formatCurrency(order.cashbackEarned)} Cashback
                                      </span>
                                    </div>
                                  )}

                                {/* Notes */}
                                {order.notes && (
                                  <div className="text-[10px] text-gray-400 italic bg-gray-50 rounded-lg p-2">
                                    Catatan: {order.notes}
                                  </div>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Card>
                        </Collapsible>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </TabsContent>

        {/* ════════════════════════════════ */}
        {/* ── Referensi (Referral) Tab ── */}
        {/* ════════════════════════════════ */}
        <TabsContent value="referensi" className="mt-0 overflow-x-hidden max-w-full">
          <div className="px-3 pt-3 pb-4 space-y-3">
            {/* Purple gradient banner with more decorative elements */}
            <div className="bg-gradient-to-br from-violet-500 via-purple-500 to-purple-600 rounded-2xl p-4 text-white relative overflow-hidden shadow-lg shadow-purple-500/20">
              <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
              <div className="absolute bottom-0 left-0 w-20 h-20 bg-white/5 rounded-full translate-y-8 -translate-x-6" />
              <div className="absolute top-1/2 right-12 w-8 h-8 bg-white/5 rounded-full" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                    <UserPlus className="w-4.5 h-4.5" />
                  </div>
                  <h3 className="font-bold text-sm">Punya Kenalan Punya Usaha?</h3>
                </div>
                <p className="text-xs text-white/80 leading-relaxed">
                  Isi Referensi dan Dapatkan Tambahan Cashback!
                </p>
                {referralConfig && (referralConfig.referralBonusType === 'percentage'
                  ? Math.round(50000 * (referralConfig.referralBonusValue / 100)) > 0
                  : (referralConfig.referralBonusValue || 0) > 0
                ) && (
                  <p className="text-base font-extrabold text-white mt-2">
                    🎁 Bonus: {formatCurrency(
                      referralConfig.referralBonusType === 'percentage'
                        ? Math.round(50000 * (referralConfig.referralBonusValue / 100))
                        : referralConfig.referralBonusValue
                    )}{' '}
                    per referral berhasil dikonversi
                  </p>
                )}
                <p className="text-[10px] text-white/50 mt-2">
                  Setiap referensimu melakukan pembelian, cashback makin besar!
                </p>
              </div>
            </div>

            {/* Stats grid with gradient backgrounds */}
            {referralStats && (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gradient-to-br from-sky-50 to-sky-50/60 rounded-2xl p-2.5 text-center border border-sky-100/50">
                  <p className="text-lg font-extrabold text-sky-600">{referralStats.new}</p>
                  <p className="text-[9px] text-sky-500 font-medium mt-0.5">Baru</p>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-50/60 rounded-2xl p-2.5 text-center border border-amber-100/50">
                  <p className="text-lg font-extrabold text-amber-600">{referralStats.contacted}</p>
                  <p className="text-[9px] text-amber-500 font-medium mt-0.5">Dihubungi</p>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-50/60 rounded-2xl p-2.5 text-center border border-emerald-100/50">
                  <p className="text-lg font-extrabold text-emerald-600">
                    {referralStats.converted}
                  </p>
                  <p className="text-[9px] text-emerald-500 font-medium mt-0.5">Berhasil</p>
                </div>
              </div>
            )}

            {/* Referral Form */}
            <Card className="rounded-2xl border-0 shadow-sm bg-white hover:shadow-md transition-shadow">
              <CardContent className="p-3.5 space-y-3">
                <h4 className="font-bold text-xs text-gray-900">Kirim Referensi</h4>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block font-medium">
                    Nama Usaha
                  </label>
                  <Input
                    placeholder="Masukkan nama usaha"
                    value={refBusinessName}
                    onChange={(e) => setRefBusinessName(e.target.value)}
                    className="rounded-lg h-10 text-xs bg-gray-50 border-gray-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block font-medium">
                    Nama PIC
                  </label>
                  <Input
                    placeholder="Nama kontak person"
                    value={refPicName}
                    onChange={(e) => setRefPicName(e.target.value)}
                    className="rounded-lg h-10 text-xs bg-gray-50 border-gray-100"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 mb-1 block font-medium">
                    Nomor HP
                  </label>
                  <Input
                    placeholder="08xxxxxxxxxx"
                    value={refPhone}
                    onChange={(e) => setRefPhone(e.target.value)}
                    type="tel"
                    className="rounded-lg h-10 text-xs bg-gray-50 border-gray-100"
                  />
                </div>
                <Button
                  className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 font-semibold text-xs shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all duration-150"
                  onClick={submitReferral}
                  disabled={submittingReferral}
                >
                  {submittingReferral ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Kirim Referensi
                </Button>
              </CardContent>
            </Card>

            {/* Referral List */}
            {loadingReferrals ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : referrals.length === 0 ? (
              /* ── Empty State ── */
              <div className="text-center py-14">
                <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <UserPlus className="w-9 h-9 text-gray-300" />
                </div>
                <p className="text-gray-800 text-xs font-bold">Belum ada referensi</p>
                <p className="text-gray-400 text-[11px] mt-1 leading-relaxed">
                  Ajak teman usaha untuk bergabung!
                </p>
              </div>
            ) : (
              /* ── Referral List with ScrollArea ── */
              <ScrollArea className="max-h-[calc(100vh-520px)]">
                <div className="space-y-2 pr-1">
                  {referrals.map((ref) => (
                    <Card
                      key={ref.id}
                      className="rounded-2xl border-0 shadow-sm bg-white hover:shadow-md transition-shadow"
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between mb-1">
                          <p className="font-semibold text-xs text-gray-900 truncate pr-2">
                            {ref.businessName}
                          </p>
                          <ReferralStatusBadge status={ref.status} />
                        </div>
                        <p className="text-[11px] text-gray-500">
                          {ref.picName} &middot; {ref.phone}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {formatDate(ref.createdAt)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </TabsContent>
      </main>

      {/* ════════════════════════════════════════ */}
      {/* ── Bottom Navigation (Floating Pill) ── */}
      {/* ════════════════════════════════════════ */}
      <nav className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 pb-[env(safe-area-inset-bottom)]">
        <div className="bg-white/90 backdrop-blur-xl rounded-full shadow-xl shadow-black/10 border border-gray-200/50 px-2 py-1.5">
          <TabsList className="w-full h-auto bg-transparent rounded-full p-0 border-0 shadow-none gap-1">
            {(
              [
                { id: 'beranda', label: 'Beranda', icon: Home },
                { id: 'riwayat', label: 'Riwayat', icon: History },
                { id: 'referensi', label: 'Referensi', icon: UserPlus },
              ] as { id: TabType; label: string; icon: typeof Home }[]
            ).map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                className={`flex-1 flex flex-col items-center py-2 px-4 rounded-full bg-transparent data-[state=active]:bg-transparent data-[state=active]:shadow-none border-0 data-[state=active]:border-0 hover:bg-transparent relative group transition-all duration-200 ${activeTab === tab.id ? 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-md shadow-emerald-500/25' : ''}`}
              >
                <tab.icon
                  className={`w-5 h-5 transition-colors duration-200 ${
                    activeTab === tab.id ? 'text-white' : 'text-gray-400'
                  }`}
                />
                <span
                  className={`text-[10px] mt-0.5 font-medium transition-colors duration-200 ${
                    activeTab === tab.id ? 'text-white' : 'text-gray-400'
                  }`}
                >
                  {tab.label}
                </span>
                {/* Active indicator dot */}
                {activeTab === tab.id && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-emerald-600" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </nav>

      {/* ══════════════════════════════════════════════ */}
      {/* ── Order Drawer (replaces Sheet) ── */}
      {/* ══════════════════════════════════════════════ */}
      <Drawer
        open={orderDrawerOpen}
        onOpenChange={setOrderDrawerOpen}
        dismissible={!submittingOrder}
      >
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="px-4 pt-3 pb-0">
            <DrawerTitle className="text-left text-lg font-bold flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              Pesan Produk
            </DrawerTitle>
            <DrawerDescription className="text-left text-gray-500 text-xs pl-10">
              Pilih produk dan jumlah yang diinginkan
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 mt-3 space-y-4 pb-2">
            {/* Pengajuan info banner */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Ini adalah <strong>pengajuan pesanan</strong>. Harga akan dikonfirmasi oleh Sales setelah pesanan diajukan.
              </p>
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Cari produk..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="pl-9 rounded-xl h-10 text-sm bg-gray-50 border-gray-100 w-full focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-all"
              />
            </div>

            {/* Product List */}
            {loadingProducts ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div key={i} className="rounded-2xl border-0 shadow-sm overflow-hidden bg-white">
                      <Skeleton className="aspect-square w-full" />
                      <div className="p-2.5 space-y-1.5">
                        <Skeleton className="h-3 w-3/4 rounded" />
                        <Skeleton className="h-2.5 w-1/2 rounded" />
                        <Skeleton className="h-8 w-full rounded-xl mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-10">
                <Package className="w-8 h-8 mx-auto text-gray-300" />
                <p className="text-xs text-gray-400 mt-2">
                  {productSearch.trim()
                    ? `Produk tidak ditemukan untuk "${productSearch}"`
                    : 'Belum ada produk yang tersedia'}
                </p>
              </div>
            ) : (
              <>
                {/* ── Frequently Purchased Section ── */}
                {frequentProducts.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 px-1">
                      <RotateCcw className="w-4 h-4 text-emerald-500" />
                      <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                        Sering Dibeli
                      </h3>
                      <Badge className="bg-emerald-50 text-emerald-700 border-0 text-[10px] px-1.5 font-medium">
                        {frequentProducts.length}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {frequentProducts.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          inCart={cart.find((c) => c.productId === product.id)}
                          onAdd={addToCart}
                          onQtyChange={updateCartQty}
                          isFrequent
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Other Products Section ── */}
                {otherProducts.length > 0 && (
                  <div className="space-y-3">
                    {frequentProducts.length > 0 && (
                      <div className="flex items-center gap-2 px-1 pt-1">
                        <Package className="w-4 h-4 text-gray-400" />
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Produk Lainnya
                        </h3>
                        <Badge className="bg-gray-100 text-gray-500 border-0 text-[10px] px-1.5 font-medium">
                          {otherProducts.length}
                        </Badge>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {otherProducts.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          inCart={cart.find((c) => c.productId === product.id)}
                          onAdd={addToCart}
                          onQtyChange={updateCartQty}
                          isFrequent={false}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── Cart Summary with prices ── */}
            {cart.length > 0 && (
              <Card className="rounded-2xl border-0 shadow-sm bg-white overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-400" />
                <CardContent className="p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-xs text-gray-900">
                      Keranjang ({cartItemCount} item)
                    </h4>
                    {cart.some((item) => item.price <= 0) ? (
                      <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                        Pengajuan Harga
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                        Harga Deal
                      </span>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-1.5">
                  {cart.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-start justify-between gap-1 text-[11px]"
                    >
                      <span className="text-gray-600 truncate min-w-0 flex-1 leading-snug">
                        {item.productName}{' '}
                        <span className="text-gray-400 font-medium">x{item.qty}</span>
                      </span>
                      {item.price > 0 ? (
                        <span className="text-emerald-700 font-semibold text-[11px] shrink-0">
                          {formatCurrency(item.price * item.qty)}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-[10px] shrink-0">
                          Pengajuan
                        </span>
                      )}
                    </div>
                  ))}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-900">
                      {cartTotal > 0 ? 'Total' : 'Total Pengajuan'}
                    </span>
                    {cartTotal > 0 ? (
                      <span className="text-sm font-bold text-emerald-700">
                        {formatCurrency(cartTotal)}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
                        Menunggu Konfirmasi
                      </span>
                    )}
                  </div>
                  {/* Show note if mixed cart (some deal prices, some pengajuan) */}
                  {cart.some((item) => item.price > 0) && cart.some((item) => item.price <= 0) && (
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      * Produk dengan harga deal sudah termasuk di total. Produk pengajuan akan dikonfirmasi Sales.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Notes field */}
            <div>
              <label className="text-[11px] text-gray-500 mb-1.5 block font-medium">
                Catatan (opsional)
              </label>
              <Textarea
                placeholder="Tambahkan catatan untuk pesanan..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                rows={2}
                className="rounded-xl text-sm resize-none bg-gray-50 border-gray-100"
              />
            </div>

            {/* Payment info — method chosen by Sales/Admin later */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-blue-700 leading-relaxed">
                Metode pembayaran akan ditentukan oleh Sales/Admin setelah pesanan disetujui.
              </p>
            </div>
          </div>

          {/* Submit Button — fixed at bottom of drawer */}
          <DrawerFooter className="px-4 pt-0 pb-4">
            <Button
              className="w-full h-12 rounded-2xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all duration-150"
              onClick={submitOrder}
              disabled={cart.length === 0 || submittingOrder}
            >
              {submittingOrder ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              {submittingOrder
                ? 'Mengirim...'
                : cart.length > 0
                  ? 'Ajukan Pesanan'
                  : 'Kirim Pesanan'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* ══════════════════════════════════════════════ */}
      {/* ── Upload Proof Dialog ── */}
      {/* ══════════════════════════════════════════════ */}
      <Dialog
        open={proofDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setProofDialogOpen(false);
            setProofFile(null);
            setProofPreview(null);
            setProofSuccess(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md rounded-2xl mx-3 p-4 max-w-[calc(100vw-1.5rem)]">
          <DialogHeader>
            <DialogTitle className="text-base">
              {proofSuccess ? 'Berhasil!' : 'Upload Bukti Bayar'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {proofSuccess
                ? 'Bukti bayar berhasil diupload. Admin akan memverifikasi.'
                : 'Upload bukti transfer pembayaran Anda'}
            </DialogDescription>
          </DialogHeader>

          {proofSuccess ? (
            <div className="py-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-sm text-gray-600">Bukti pembayaran berhasil dikirim.</p>
              <Button
                className="mt-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-medium"
                onClick={() => {
                  setProofDialogOpen(false);
                  setProofSuccess(false);
                }}
              >
                Selesai
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Hidden file input — accepts any file type */}
              <input
                ref={fileInputRef}
                type="file"
                accept="*/*"
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* Preview or upload zone */}
              {proofPreview ? (
                <div className="relative">
                  {proofFile?.type?.startsWith('video/') ? (
                    <video
                      src={proofPreview}
                      controls
                      className="w-full h-48 object-contain rounded-xl bg-black/5"
                    />
                  ) : (
                    <img
                      src={proofPreview}
                      alt="Preview"
                      className="w-full h-48 object-cover rounded-xl"
                    />
                  )}
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8 rounded-full"
                    onClick={() => {
                      setProofFile(null);
                      setProofPreview(null);
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : proofFile ? (
                /* Non-previewable file (PDF, document, etc.) — show file info card */
                <div className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                    <FileText className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{proofFile.name}</p>
                    <p className="text-[11px] text-gray-400">
                      {(proofFile.size / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-500 shrink-0"
                    onClick={() => {
                      setProofFile(null);
                      setProofPreview(null);
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-emerald-400 hover:bg-emerald-50/50 transition-colors active:scale-[0.99]"
                >
                  <Camera className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 font-medium">Tap untuk pilih foto / file</p>
                  <p className="text-[11px] text-gray-400 mt-1">Gambar, Video, PDF, dll (maks 50MB)</p>
                </button>
              )}

              <Button
                className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-semibold"
                onClick={uploadProof}
                disabled={!proofFile || uploadingProof}
              >
                {uploadingProof ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                {uploadingProof ? 'Mengupload...' : 'Upload Bukti Bayar'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════ */}
      {/* ── Cashback Withdrawal Drawer ── */}
      {/* ══════════════════════════════════════════════ */}
      <Drawer
        open={withdrawDrawerOpen}
        onOpenChange={setWithdrawDrawerOpen}
        dismissible={!submittingWithdraw}
      >
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="px-4 pt-3 pb-0">
            <DrawerTitle className="text-left text-lg font-bold">Tarik Cashback</DrawerTitle>
            <DrawerDescription className="text-left text-gray-500 text-xs">
              Cairkan saldo cashback ke rekening bank Anda
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 mt-3 space-y-4 pb-2">
            {/* Balance display card */}
            <Card className="rounded-2xl border-0 shadow-sm bg-gradient-to-br from-emerald-500 to-emerald-700 text-white overflow-hidden">
              <CardContent className="p-5 text-center relative">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-12 translate-x-12" />
                <p className="text-[11px] text-white/60 uppercase tracking-wider font-medium relative">
                  Saldo Tersedia
                </p>
                <p className="text-3xl font-bold mt-2 relative tracking-tight">
                  {formatCurrency(customer.cashbackBalance || 0)}
                </p>
              </CardContent>
            </Card>

            {/* Amount input with presets */}
            <div>
              <label className="text-[11px] text-gray-500 mb-1.5 block font-medium">
                Jumlah Pencairan
              </label>
              <Input
                placeholder="Masukkan jumlah"
                value={withdrawAmount ? formatCurrency(parseInt(withdrawAmount)) : ''}
                onChange={(e) =>
                  setWithdrawAmount(e.target.value.replace(/[^\d]/g, ''))
                }
                type="text"
                inputMode="numeric"
                className="rounded-xl h-11 text-sm bg-gray-50 border-gray-100 font-medium"
              />
              {/* Preset buttons */}
              <div className="flex gap-2 mt-2.5">
                {[
                  { label: '25%', pct: 0.25 },
                  { label: '50%', pct: 0.5 },
                  { label: '100%', pct: 1 },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="outline"
                    size="sm"
                    className="flex-1 rounded-xl text-xs font-medium border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-600"
                    onClick={() =>
                      setWithdrawAmount(
                        String(Math.round((customer.cashbackBalance || 0) * preset.pct))
                      )
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Bank detail fields */}
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block font-medium">
                  Nama Bank
                </label>
                <Input
                  placeholder="BCA, BNI, Mandiri, dll"
                  value={withdrawBankName}
                  onChange={(e) => setWithdrawBankName(e.target.value)}
                  className="rounded-xl h-11 text-sm bg-gray-50 border-gray-100"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block font-medium">
                  Nomor Rekening
                </label>
                <Input
                  placeholder="Masukkan nomor rekening"
                  value={withdrawAccountNo}
                  onChange={(e) => setWithdrawAccountNo(e.target.value)}
                  className="rounded-xl h-11 text-sm bg-gray-50 border-gray-100"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1.5 block font-medium">
                  Nama Pemilik Rekening
                </label>
                <Input
                  placeholder="Sesuai buku rekening"
                  value={withdrawAccountHolder}
                  onChange={(e) => setWithdrawAccountHolder(e.target.value)}
                  className="rounded-xl h-11 text-sm bg-gray-50 border-gray-100"
                />
              </div>
            </div>

            {/* Info text */}
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              Proses 1-3 hari kerja. Minimum pencairan Rp10.000
            </p>
          </div>

          {/* Submit button */}
          <DrawerFooter className="px-4 pt-0 pb-4">
            <Button
              className="w-full h-12 rounded-2xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all duration-150"
              onClick={submitWithdrawal}
              disabled={submittingWithdraw}
            >
              {submittingWithdraw ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wallet className="w-4 h-4 mr-2" />
              )}
              {submittingWithdraw ? 'Mengajukan...' : 'Ajukan Pencairan'}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Floating Cart Button */}
      {cart.length > 0 && (
        <button
          className="fixed bottom-[calc(70px+env(safe-area-inset-bottom))] right-3 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center active:scale-[0.92] transition-all duration-150"
          onClick={openOrderDrawer}
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
            {cartItemCount > 9 ? '9+' : cartItemCount}
          </span>
        </button>
      )}
    </Tabs>
    </PWAErrorBoundary>
  );
}

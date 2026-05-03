'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, X, Plus, Minus, ShoppingCart, UserCircle, ChevronRight,
  Wallet, FileText, Calendar, Truck, StickyNote, Package, Check, Trash2,
  Clock, Users, Send, AlertCircle, AlertOctagon, Pencil
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose } from '@/components/ui/drawer';
import { toast } from 'sonner';
import { formatCurrency, formatStock, todayLocal } from '@/lib/erp-helpers';
import { cn } from '@/lib/utils';
import type { Product, Customer, Unit } from '@/types';
import { apiFetch, ApiError } from '@/lib/api-client';
import { InvoicePreview } from './TransactionDetail';

// ============ TYPES ============
interface CartItem {
  productId: string;
  productName: string;
  productImageUrl?: string;
  qty: number;
  price: number;
  hpp: number;
  qtyUnitType: 'main' | 'sub';
  pricePerMain: number;
  conversionRate: number;
  mainUnit: string;
  subUnit: string;
  sellPricePerSubUnit: number;
  globalStock: number;
  trackStock: boolean;
  category: string | null;
}

interface SaleFormProps {
  products: Product[];
  customers: Customer[];
  couriers: { id: string; name: string }[];
  units: Unit[];
  userId: string;
  unitId?: string;
  onClose: () => void;
  onSuccess: () => void;
  onCustomerCreated?: (customer: Customer) => void;
}

// ============ CART ITEM COMPONENT ============
function CartItemCard({ item, index, updateQty, updateCartItemPrice, changeCartItemUnit, removeFromCart }: {
  item: CartItem;
  index: number;
  updateQty: (index: number, delta: number) => void;
  updateCartItemPrice: (index: number, newPrice: number) => void;
  changeCartItemUnit: (index: number, newType: 'main' | 'sub') => void;
  removeFromCart: (index: number) => void;
}) {
  const [editingPrice, setEditingPrice] = useState(false);
  const [tempPrice, setTempPrice] = useState('');

  const startEditing = () => {
    setTempPrice(item.price.toString());
    setEditingPrice(true);
  };

  const hasSubUnit = item.subUnit && item.conversionRate > 1;
  const unitLabel = item.qtyUnitType === 'main' ? item.mainUnit : item.subUnit;
  const hasImage = !!item.productImageUrl;

  return (
    <div className="border rounded-2xl p-3 bg-card space-y-2.5">
      <div className="flex items-start gap-3">
        {/* Product thumbnail */}
        <div className="relative w-12 h-12 rounded-xl bg-muted/40 shrink-0 overflow-hidden">
          {hasImage ? (
            <img src={item.productImageUrl} alt={item.productName} className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} />
          ) : null}
          <div className={cn("absolute inset-0 flex items-center justify-center", hasImage ? "hidden" : "")}>
            <Package className="w-5 h-5 text-muted-foreground/20" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight">{item.productName}</p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <button type="button"
              className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold border-2 transition-all active:scale-95",
                item.qtyUnitType === 'main' ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
              )} onClick={() => { if (!editingPrice && item.qtyUnitType !== 'main') changeCartItemUnit(index, 'main'); }}>
              {item.mainUnit}
            </button>
            {hasSubUnit && (
              <button type="button"
                className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold border-2 transition-all active:scale-95",
                  item.qtyUnitType === 'sub' ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40"
                )} onClick={() => { if (!editingPrice && item.qtyUnitType !== 'sub') changeCartItemUnit(index, 'sub'); }}>
                {item.subUnit}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {editingPrice ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <Input type="number" value={tempPrice} onChange={e => setTempPrice(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { const val = parseFloat(tempPrice); if (!isNaN(val) && val >= 0) updateCartItemPrice(index, val); setEditingPrice(false); }
                    if (e.key === 'Escape') { setTempPrice(item.price.toString()); setEditingPrice(false); }
                  }} className="h-7 text-xs w-28 px-2 tabular-nums" autoFocus min={0} />
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-primary shrink-0"
                  onClick={() => { const val = parseFloat(tempPrice); if (!isNaN(val) && val >= 0) updateCartItemPrice(index, val); setEditingPrice(false); }}>
                  <Check className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors" onClick={startEditing}>
                <Pencil className="w-3 h-3" />
                <span className="tabular-nums font-medium">{formatCurrency(item.price)}</span>
                <span>/{unitLabel}</span>
              </button>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeFromCart(index)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl text-lg" onClick={() => updateQty(index, -1)}><Minus className="w-4 h-4" /></Button>
          <div className="w-14 text-center">
            <span className="font-bold text-xl tabular-nums">{item.qty}</span>
            <p className="text-[10px] text-muted-foreground">{unitLabel}</p>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl text-lg" onClick={() => updateQty(index, 1)}><Plus className="w-4 h-4" /></Button>
        </div>
        <p className="font-bold text-base tabular-nums">{formatCurrency(item.qty * item.price)}</p>
      </div>
    </div>
  );
}

// ============ MAIN SALE FORM COMPONENT ============
export function SaleForm({
  products, customers, couriers, units, userId, unitId, onClose, onSuccess, onCustomerCreated
}: SaleFormProps) {
  // ============ STATE ============
  const [activePanel, setActivePanel] = useState<'customer' | 'unit' | 'courier' | 'products' | 'cart' | null>('customer');
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '' });
  const [customerLoading, setCustomerLoading] = useState(false);
  const [dupWarning, setDupWarning] = useState<any>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'piutang' | 'tempo'>('cash');
  const [dueDate, setDueDate] = useState('');
  const [courierId, setCourierId] = useState('none');
  const [transactionDate, setTransactionDate] = useState(todayLocal());
  const [notes, setNotes] = useState('');
  const [paidAmount, setPaidAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [createdTransaction, setCreatedTransaction] = useState<any>(null);
  const [showCourierDrawer, setShowCourierDrawer] = useState(false);
  const [showDateDrawer, setShowDateDrawer] = useState(false);
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [posUnitId, setPosUnitId] = useState(unitId || '');
  const productInputRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  // ============ DERIVED ============

  // Filter couriers by active unit context (posUnitId or unitId)
  const activeUnitId = posUnitId || unitId || '';
  const unitCouriers = useMemo(() => {
    if (!activeUnitId) return couriers; // no unit selected — show all (super_admin "Semua Unit")
    return couriers.filter((c: any) =>
      c.unitId === activeUnitId ||
      c.unit?.id === activeUnitId ||
      (c.userUnits || []).some((u: any) => u.id === activeUnitId)
    );
  }, [couriers, activeUnitId]);

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean) as string[]);
    return ['all', ...Array.from(cats).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (selectedCategory !== 'all') list = list.filter(p => p.category === selectedCategory);
    if (productSearch.trim()) {
      const q = productSearch.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
    }
    return list;
  }, [products, selectedCategory, productSearch]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return customers.slice(0, 20);
    const q = customerSearch.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)) || (c.address && c.address.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [customers, customerSearch]);

  const total = cart.reduce((sum, i) => sum + (i.qty * i.price), 0);
  const totalItems = cart.reduce((sum, i) => sum + i.qty, 0);

  useEffect(() => { if (unitId) setPosUnitId(unitId); }, [unitId]);
  useEffect(() => { setPaidAmount(paymentMethod === 'cash' && courierId === 'none' ? total : 0); }, [paymentMethod, total, courierId]);

  // ============ PANEL NAVIGATION ============
  const openPanel = useCallback((panel: 'customer' | 'unit' | 'courier' | 'products' | 'cart') => {
    setActivePanel(panel);
  }, []);

  const goBackFromPanel = useCallback(() => {
    if (activePanel === 'customer') { setActivePanel(null); return; }
    if (activePanel === 'unit') { setActivePanel('customer'); return; }
    if (activePanel === 'courier') { setActivePanel(unitId ? 'customer' : 'unit'); return; }
    if (activePanel === 'cart') { setActivePanel('products'); return; }
    if (activePanel === 'products') { setActivePanel('courier'); return; }
    setActivePanel(null);
  }, [activePanel, unitId]);

  // ============ CLOSE HANDLER ============
  const handleClose = useCallback((open: boolean) => {
    if (!open) {
      if (cart.length > 0) {
        if (window.confirm('Yakin ingin keluar? Data yang belum disimpan akan hilang.')) {
          setIsClosing(true);
          onClose();
        }
      } else {
        setIsClosing(true);
        onClose();
      }
    }
  }, [cart.length, onClose]);

  // ============ CART ACTIONS ============
  const addToCart = useCallback((product: Product) => {
    // If trackStock is off, allow adding without stock check
    const isTracking = product.trackStock !== false;
    if (isTracking && product.globalStock <= 0) { toast.error('Stok habis!'); return; }
    let success = false;
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        if (isTracking) {
          const existingQtyInSub = existing.qtyUnitType === 'main' ? (existing.qty + 1) * existing.conversionRate : existing.qty + 1;
          if (existingQtyInSub > product.globalStock) { toast.error(`Stok tidak cukup! Tersedia: ${product.globalStock}`); return prev; }
        }
        success = true;
        return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      const hasSubUnit = product.subUnit && product.conversionRate > 1;
      const initialQtyInSub = hasSubUnit ? 1 : 1;
      if (isTracking && initialQtyInSub > product.globalStock) { toast.error(`Stok tidak cukup! Tersedia: ${product.globalStock}`); return prev; }
      success = true;
      return [...prev, {
        productId: product.id, productName: product.name, productImageUrl: product.imageUrl || undefined, qty: 1,
        qtyUnitType: (hasSubUnit ? 'sub' : 'main') as 'main' | 'sub',
        price: hasSubUnit && product.sellPricePerSubUnit ? product.sellPricePerSubUnit : (product.sellingPrice || 0) / (product.conversionRate || 1),
        pricePerMain: product.sellingPrice || 0, hpp: Number(product.avgHpp) || 0,
        conversionRate: product.conversionRate || 1,
        mainUnit: product.unit || 'pcs', subUnit: product.subUnit || '',
        sellPricePerSubUnit: product.sellPricePerSubUnit || 0,
        globalStock: product.globalStock, trackStock: product.trackStock !== false, category: product.category ?? null
      }];
    });
    if (success) toast.success(`${product.name} ditambahkan`);
  }, []);

  const updateQty = (index: number, delta: number) => {
    if (delta > 0) {
      setCart(prev => {
        const item = prev[index]; if (!item) return prev;
        const newQty = item.qty + delta;
        const newQtyInSub = item.qtyUnitType === 'main' ? newQty * item.conversionRate : newQty;
        // Only check stock limit when trackStock is enabled
        if (item.trackStock && newQtyInSub > item.globalStock) { toast.error(`Stok tidak cukup! Tersedia: ${item.globalStock}`); return prev; }
        return prev.map((it, i) => i !== index ? it : { ...it, qty: newQty });
      });
    } else {
      setCart(prev => prev.map((item, i) => { if (i !== index) return item; return { ...item, qty: Math.max(0, item.qty + delta) }; }).filter(i => i.qty > 0));
    }
  };

  const removeFromCart = (index: number) => setCart(prev => prev.filter((_, i) => i !== index));
  const clearCart = () => setCart([]);
  const updateCartItemPrice = (index: number, newPrice: number) => { if (isNaN(newPrice) || newPrice < 0) return; setCart(prev => prev.map((item, i) => i !== index ? item : { ...item, price: newPrice })); };
  const changeCartItemUnit = (index: number, newType: 'main' | 'sub') => {
    setCart(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const newPrice = newType === 'main' ? item.pricePerMain : (item.sellPricePerSubUnit || item.pricePerMain / (item.conversionRate || 1));
      return { ...item, qtyUnitType: newType, qty: 1, price: newPrice };
    }));
  };

  // ============ CUSTOMER ============
  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch('');
    // advance to next step
    if (!unitId && !posUnitId) { openPanel('unit'); } else { openPanel('courier'); }
  };

  const handleSkipCustomer = () => {
    setSelectedCustomer(null);
    if (!unitId && !posUnitId) { openPanel('unit'); } else { openPanel('courier'); }
  };

  const handleNewCustomer = async () => {
    if (!newCustomerForm.name.trim()) { toast.error('Nama wajib diisi'); return; }
    const effectiveUnitId = unitId || posUnitId;
    if (!effectiveUnitId) { toast.error('Unit tidak ditemukan'); return; }
    setCustomerLoading(true);
    try {
      const data: any = await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify({ ...newCustomerForm, unitId: effectiveUnitId }) });
      toast.success('Pelanggan berhasil ditambahkan');
      const customer = data.customer;
      setSelectedCustomer(customer);
      setShowNewCustomerForm(false);
      setNewCustomerForm({ name: '', phone: '', address: '' });
      onCustomerCreated?.(customer);
      if (!unitId && !posUnitId) { openPanel('unit'); } else { openPanel('courier'); }
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && err.details?.duplicate) {
        setDupWarning(err.details.duplicate);
      } else {
        toast.error(err.message);
      }
    } finally { setCustomerLoading(false); }
  };

  // ============ SUBMIT ============
  const handleSubmit = async () => {
    if (!posUnitId) { toast.error('Unit tidak ditemukan'); return; }
    if (cart.length === 0) { toast.error('Tambahkan produk terlebih dahulu'); return; }
    if ((paymentMethod === 'tempo' || paymentMethod === 'piutang') && !dueDate) { toast.error('Jatuh tempo wajib diisi untuk pembayaran tempo'); return; }
    setLoading(true);
    try {
      const data: any = await apiFetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sale', unitId: posUnitId, createdById: userId,
          customerId: selectedCustomer?.id || '', courierId: courierId === 'none' ? '' : courierId,
          paymentMethod, paidAmount,
          dueDate: paymentMethod === 'tempo' ? dueDate : (paymentMethod === 'piutang' ? dueDate : ''),
          transactionDate, deliveryAddress: selectedCustomer?.address || '', notes,
          items: cart.map(i => {
            const qtyInSubUnit = i.qtyUnitType === 'main' ? i.qty * i.conversionRate : i.qty;
            const hppPerItem = (Number(i.hpp) || 0) * qtyInSubUnit;
            return { productId: i.productId, productName: i.productName, qty: i.qty, qtyInSubUnit, qtyUnitType: i.qtyUnitType, price: i.price, hpp: i.hpp, subtotal: i.qty * i.price, profit: (i.qty * i.price) - hppPerItem, totalHpp: hppPerItem };
          })
        })
      });
      toast.success('Transaksi berhasil dibuat!');
      setCreatedTransaction(data.transaction);
    } catch (err: any) { toast.error(err.message || 'Gagal membuat transaksi'); } finally { setLoading(false); }
  };

  // ============ PANEL CONTENT RENDERERS ============

  // --- PANEL: Customer Selection ---
  const renderCustomerPanel = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-1 pb-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Cari nama, telepon..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
            className="pl-9 h-10 text-sm rounded-xl" autoFocus />
          {customerSearch && (
            <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setCustomerSearch('')}><X className="w-3.5 h-3.5" /></Button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        <div className="px-4 pb-2 space-y-1">
          <button type="button" onClick={handleSkipCustomer}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98] hover:bg-muted/80">
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0"><Users className="w-4 h-4 text-muted-foreground" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Walk-in</p>
              <p className="text-xs text-muted-foreground">Tanpa pelanggan</p>
            </div>
          </button>
          {filteredCustomers.map((c: Customer) => (
            <button key={c.id} type="button" onClick={() => handleSelectCustomer(c)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98] hover:bg-muted/80">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-primary">{(c.name || c.email || '?').charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{c.name || c.email || 'Tanpa Nama'}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.phone && <span>{c.phone}</span>}
                  {c.address && <span className="truncate max-w-[120px]">{c.address}</span>}
                </div>
              </div>
            </button>
          ))}
          {filteredCustomers.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <UserCircle className="w-8 h-8 mb-1 opacity-20" /><p className="text-sm">Pelanggan tidak ditemukan</p>
            </div>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 border-t px-4 pt-2 pb-3 space-y-1.5">
        <Button variant="outline" className="w-full h-10 rounded-xl text-sm font-medium gap-1.5" onClick={() => setShowNewCustomerForm(p => !p)}>
          <Plus className="w-4 h-4" /> {showNewCustomerForm ? 'Tutup Form' : 'Tambah Pelanggan Baru'}
        </Button>
        <Button variant="ghost" className="w-full h-8 rounded-xl text-xs text-muted-foreground" onClick={handleSkipCustomer}>
          Lewati — Walk-in
        </Button>
      </div>
      {/* New customer overlay inside panel */}
      {showNewCustomerForm && (
        <div className="absolute inset-0 bg-background z-20 flex flex-col rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0 border-b">
            <p className="text-sm font-bold">Pelanggan Baru</p>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowNewCustomerForm(false)}><X className="w-4 h-4" /></Button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 space-y-3">
            <div><Label className="text-xs text-muted-foreground mb-1 block">Nama *</Label>
              <Input value={newCustomerForm.name} onChange={e => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} placeholder="Nama pelanggan" className="h-10 text-sm rounded-xl" /></div>
            <div><Label className="text-xs text-muted-foreground mb-1 block">Telepon</Label>
              <Input value={newCustomerForm.phone} onChange={e => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} placeholder="Nomor telepon" className="h-10 text-sm rounded-xl" type="tel" /></div>
            <div><Label className="text-xs text-muted-foreground mb-1 block">Alamat</Label>
              <Textarea value={newCustomerForm.address} onChange={e => setNewCustomerForm({ ...newCustomerForm, address: e.target.value })} placeholder="Alamat" rows={2} className="rounded-xl text-sm" /></div>
          </div>
          <div className="px-4 pb-3 pt-2 border-t flex-shrink-0">
            <Button className="w-full h-11 rounded-xl text-sm font-semibold" disabled={customerLoading || !newCustomerForm.name.trim()} onClick={handleNewCustomer}>
              {customerLoading ? 'Menyimpan...' : 'Simpan & Lanjutkan'}
            </Button>
          </div>
        </div>
      )}

      {/* Duplicate Customer Warning Dialog */}
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
                  <span className="text-muted-foreground">Sales</span>
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {dupWarning.assignedTo?.name || 'Belum ada sales'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Pelanggan ini sudah diinput oleh <strong>{dupWarning.assignedTo?.name || 'Tidak ada sales'}</strong>.
                Hubungi super admin untuk mengalihkan pelanggan jika diperlukan.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDupWarning(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // --- PANEL: Unit Selection ---
  const renderUnitPanel = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        <div className="px-4 py-2 space-y-1">
          {units.map((u: Unit) => (
            <button key={u.id} type="button"
              onClick={() => { setPosUnitId(u.id); openPanel('courier'); }}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98] hover:bg-muted/80">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><Package className="w-4 h-4 text-primary" /></div>
              <p className="font-semibold text-sm flex-1 truncate">{u.name}</p>
              {posUnitId === u.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // --- PANEL: Courier Selection ---
  const renderCourierPanel = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        <div className="px-4 py-2 space-y-1">
          <button type="button" onClick={() => { setCourierId('none'); openPanel('products'); }}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98] hover:bg-muted/80">
            <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0"><Send className="w-4 h-4 text-muted-foreground" /></div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">Antar Sendiri</p>
              <p className="text-xs text-muted-foreground">Tanpa kurir</p>
            </div>
            {courierId === 'none' && <Check className="w-4 h-4 text-primary shrink-0" />}
          </button>
          {unitCouriers.map((c: { id: string; name: string }) => (
            <button key={c.id} type="button" onClick={() => { setCourierId(c.id); openPanel('products'); }}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98] hover:bg-muted/80">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0"><span className="text-xs font-bold text-primary">{c.name.charAt(0)}</span></div>
              <p className="font-semibold text-sm flex-1">{c.name}</p>
              {courierId === c.id && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
          ))}
          {unitCouriers.length === 0 && couriers.length > 0 && (
            <p className="px-4 py-3 text-xs text-muted-foreground text-center">Tidak ada kurir aktif di unit ini.</p>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 border-t px-4 pt-2 pb-3">
        <Button variant="ghost" className="w-full h-8 rounded-xl text-xs text-muted-foreground" onClick={() => { setCourierId('none'); openPanel('products'); }}>
          Lewati — Antar Sendiri
        </Button>
      </div>
    </div>
  );

  // --- PANEL: Product Grid ---
  const renderProductPanel = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Quick action pills */}
      <div className="flex-shrink-0 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto scrollbar-hide">
          <button type="button" onClick={() => openPanel('customer')}
            className={cn("flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all active:scale-95 border",
              selectedCustomer ? "bg-primary/10 border-primary/20 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30")}>
            <UserCircle className="w-3 h-3" /><span className="max-w-[70px] truncate">{selectedCustomer?.name || 'Pelanggan'}</span>
          </button>
          {!unitId && (
            <button type="button" onClick={() => openPanel('unit')}
              className={cn("flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all active:scale-95 border",
                posUnitId ? "bg-primary/10 border-primary/20 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30")}>
              <Package className="w-3 h-3" /><span className="max-w-[50px] truncate">{posUnitId ? units.find(u => u.id === posUnitId)?.name || 'Unit' : 'Unit'}</span>
            </button>
          )}
          <button type="button" onClick={() => openPanel('courier')}
            className={cn("relative flex items-center gap-2 shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 border",
              courierId !== 'none' ? "bg-primary/10 border-primary/20 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30")}>
            <Truck className="w-3.5 h-3.5" /><span className="max-w-[80px] truncate">
              {courierId === 'none' ? 'Kurir' : couriers.find(c => c.id === courierId)?.name || 'Kurir'}</span>
            {courierId !== 'none' && !unitCouriers.find(c => c.id === courierId) && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
            )}
          </button>
          <button type="button" onClick={() => setShowDateDrawer(true)}
            className="flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all active:scale-95 border bg-card border-border text-muted-foreground hover:border-primary/30">
            <Calendar className="w-3 h-3" /><span>{transactionDate.slice(5)}</span>
          </button>
          <button type="button" onClick={() => setShowNotesDrawer(true)}
            className={cn("flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all active:scale-95 border",
              notes ? "bg-primary/10 border-primary/20 text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/30")}>
            <StickyNote className="w-3 h-3" /><span>{notes ? 'Catatan ✓' : 'Catatan'}</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 px-3 py-2">
        <div className={cn("relative transition-all", searchFocused && "scale-[1.01]")}>
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input ref={productInputRef} placeholder="Cari produk..." value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
            className="pl-9 pr-9 h-9 text-sm bg-muted/50 rounded-xl" />
          {productSearch && <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setProductSearch('')}><X className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>

      {/* Category chips */}
      {categories.length > 2 && (
        <div className="flex-shrink-0 px-3 pb-1">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
            {categories.map(cat => (
              <button key={cat} type="button" onClick={() => setSelectedCategory(cat)}
                className={cn("rounded-full h-6 px-2.5 text-[11px] whitespace-nowrap shrink-0 transition-all active:scale-95",
                  selectedCategory === cat ? "bg-primary text-primary-foreground shadow-sm font-semibold" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                {cat === 'all' ? 'Semua' : cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Product grid */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Package className="w-10 h-10 mb-3 opacity-20" /><p className="text-sm">Produk tidak ditemukan</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-3 pb-2">
            {filteredProducts.map(product => {
              const inCart = cart.find(i => i.productId === product.id);
              const hasSubUnit = product.subUnit && product.conversionRate > 1;
              const stockLow = product.globalStock <= (product.minStock || 0);
              const displayPrice = hasSubUnit && product.sellPricePerSubUnit ? product.sellPricePerSubUnit : product.sellingPrice || 0;
              const unitLabel = hasSubUnit ? product.subUnit : (product.unit || 'pcs');
              const hasImage = !!product.imageUrl;
              return (
                <button key={product.id} type="button" onClick={() => addToCart(product)}
                  className={cn("relative rounded-2xl border text-left transition-all active:scale-[0.97] group overflow-hidden",
                    inCart ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:shadow-sm bg-card")}>
                  {inCart && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center shadow-md z-10">{inCart.qty}</div>}
                  {/* Product image */}
                  <div className="relative w-full aspect-square bg-muted/40 shrink-0">
                    {hasImage ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                      />
                    ) : null}
                    <div className={cn("absolute inset-0 flex items-center justify-center", hasImage ? "hidden" : "")}>
                      <Package className="w-8 h-8 text-muted-foreground/20" />
                    </div>
                    {stockLow && <div className="absolute bottom-1.5 left-1.5"><div className="w-2 h-2 rounded-full bg-red-500 animate-pulse ring-2 ring-card" /></div>}
                  </div>
                  <div className="p-2 space-y-0.5">
                    <p className="font-medium text-xs leading-snug line-clamp-2">{product.name}</p>
                    <div className="flex items-baseline justify-between gap-1">
                      <p className="font-bold text-sm text-primary truncate">{formatCurrency(displayPrice)}</p>
                      <p className="text-[10px] text-muted-foreground shrink-0">/{unitLabel}</p>
                    </div>
                    {hasSubUnit && <p className="text-[10px] text-muted-foreground">{formatStock(product.globalStock, product.unit, product.subUnit, product.conversionRate)}</p>}
                    {!hasSubUnit && <p className={cn("text-[10px]", stockLow ? "text-red-500 font-medium" : "text-muted-foreground")}>Stok: {product.globalStock} {product.unit || 'pcs'}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="h-16" />
      </div>

      {/* Floating cart bar */}
      {cart.length > 0 && (
        <div className="flex-shrink-0 bg-card border-t shadow-[0_-4px_20px_rgba(0,0,0,0.08)]" onClick={() => openPanel('cart')}>
          <div className="p-2.5 px-3 flex items-center justify-between gap-3 cursor-pointer active:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative">
                <ShoppingCart className="w-4 h-4 text-primary" />
                <div className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[8px] font-bold flex items-center justify-center">{totalItems}</div>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">{cart.length} produk</p>
                <p className="text-sm font-bold tabular-nums leading-tight truncate">{formatCurrency(total)}</p>
              </div>
            </div>
            <Button className="h-9 px-3 text-xs font-semibold rounded-lg gap-1.5 shrink-0" onClick={e => { e.stopPropagation(); openPanel('cart'); }}>
              Lihat <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // --- PANEL: Cart + Checkout ---
  const renderCartPanel = () => (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain">
        <div className="p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-30" /><p className="text-sm">Keranjang kosong</p>
            </div>
          ) : cart.map((item, i) => (
            <CartItemCard key={`${item.productId}-${i}`} item={item} index={i} updateQty={updateQty} updateCartItemPrice={updateCartItemPrice} changeCartItemUnit={changeCartItemUnit} removeFromCart={removeFromCart} />
          ))}
        </div>
      </div>
      {cart.length > 0 && (
        <div className="flex-shrink-0 border-t bg-card">
          <div className="px-3 pt-2.5">
            <div className="flex gap-1.5">
              {([
                { key: 'cash' as const, label: 'Cash', icon: Wallet, color: 'green' },
                { key: 'piutang' as const, label: 'Piutang', icon: FileText, color: 'blue' },
                { key: 'tempo' as const, label: 'Tempo', icon: Clock, color: 'amber' },
              ]).map(pm => (
                <button key={pm.key} type="button" onClick={() => setPaymentMethod(pm.key)}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl border-2 text-[11px] font-semibold transition-all active:scale-95"
                  style={paymentMethod === pm.key ? {
                    borderColor: pm.color === 'green' ? '#22c55e' : pm.color === 'blue' ? '#3b82f6' : '#f59e0b',
                    backgroundColor: pm.color === 'green' ? '#f0fdf4' : pm.color === 'blue' ? '#eff6ff' : '#fffbeb',
                    color: pm.color === 'green' ? '#15803d' : pm.color === 'blue' ? '#1d4ed8' : '#b45309',
                  } : { borderColor: undefined, backgroundColor: undefined, color: undefined }}>
                  <pm.icon className="w-3.5 h-3.5" /> {pm.label}
                </button>
              ))}
            </div>
          </div>
          {(paymentMethod === 'tempo' || paymentMethod === 'piutang') && (
            <div className="px-3 pt-2"><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 text-sm" /></div>
          )}
          <div className="px-3 pt-2">
            <Button variant="outline" size="sm" className="w-full justify-between h-11 text-sm" onClick={() => setShowCourierDrawer(true)}>
              <span className="flex items-center gap-2"><Truck className="w-4 h-4" />{courierId === 'none' ? 'Tanpa Kurir' : couriers.find(c => c.id === courierId)?.name || (couriers.find(c => c.id === courierId) as any)?.email || 'Pilih Kurir'}</span>
              {courierId !== 'none' && !unitCouriers.find(c => c.id === courierId) && (
                <span className="ml-1 text-[10px] text-amber-600">(beda unit)</span>
              )}
              <ChevronRight className="w-4 h-4 opacity-50" />
            </Button>
          </div>
          <div className="px-3 pt-2.5 pb-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{totalItems} item</span>
              <span className="font-bold text-base tabular-nums">{formatCurrency(total)}</span>
            </div>
            {(paymentMethod === 'piutang' || paymentMethod === 'tempo') && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {paymentMethod === 'piutang' ? 'Piutang — akan ditagih' : `Tempo — jatuh tempo ${dueDate || 'belum ditentukan'}`}
              </p>
            )}
            <Button className="w-full h-12 text-sm font-bold rounded-2xl gap-2 shadow-lg active:scale-[0.98] transition-transform"
              onClick={handleSubmit} disabled={loading || cart.length === 0}>
              {loading ? <span className="animate-pulse">Memproses...</span> : (
                <><Check className="w-4 h-4" />{paymentMethod === 'cash' ? `Bayar ${formatCurrency(total)}` : `Buat Faktur ${formatCurrency(total)}`}</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  // ============ PANEL TITLE & ICON ============
  const getPanelMeta = () => {
    switch (activePanel) {
      case 'customer': return { title: 'Pilih Pelanggan', icon: <UserCircle className="w-4 h-4 text-primary" />, showBack: false };
      case 'unit': return { title: 'Pilih Unit', icon: <Package className="w-4 h-4 text-primary" />, showBack: true };
      case 'courier': return { title: 'Pilih Pengiriman', icon: <Truck className="w-4 h-4 text-primary" />, showBack: true };
      case 'products': return { title: 'Pilih Produk', icon: <Package className="w-4 h-4 text-primary" />, showBack: false };
      case 'cart': return { title: 'Keranjang', icon: <ShoppingCart className="w-4 h-4 text-primary" />, showBack: true };
      default: return { title: 'Penjualan Baru', icon: null, showBack: false };
    }
  };

  // ============ INVOICE PREVIEW ============
  if (createdTransaction) {
    return (
      <Dialog open={!!createdTransaction} onOpenChange={(open) => { if (!open) { setCreatedTransaction(null); onSuccess(); onClose(); } }}>
        <DialogContent aria-describedby={undefined} className="w-[calc(100%-1rem)] sm:w-full sm:max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden rounded-2xl p-0">
          <div className="overflow-y-auto flex-1">
            <InvoicePreview transaction={createdTransaction} onClose={() => { setCreatedTransaction(null); onSuccess(); onClose(); }} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ============ MAIN RENDER: FLOATING DIALOG ============
  const meta = getPanelMeta();

  return (
    <Dialog open={!isClosing} onOpenChange={handleClose}>
      <DialogContent aria-describedby={undefined}
        className="!gap-0 w-[calc(100%-1rem)] sm:w-full sm:max-w-2xl h-[92dvh] max-h-[92dvh] flex flex-col overflow-hidden rounded-2xl p-0">
        {/* Dialog Header */}
        <div className="flex-shrink-0 border-b bg-card safe-top">
          <div className="flex items-center justify-between h-11 px-3 gap-2">
            {meta.showBack ? (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goBackFromPanel}>
                <X className="w-4 h-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleClose(false)}>
                <X className="w-4 h-4" />
              </Button>
            )}
            <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
              {meta.icon}
              <DialogTitle className="text-sm font-bold truncate">{meta.title}</DialogTitle>
            </div>
            {activePanel === 'products' && cart.length > 0 ? (
              <Button variant="ghost" size="sm" className="h-8 px-2 gap-1 text-xs font-semibold" onClick={() => openPanel('cart')}>
                <ShoppingCart className="w-3.5 h-3.5" />
                <Badge className="bg-primary text-primary-foreground text-[9px] px-1 min-w-[14px] h-3.5">{totalItems}</Badge>
              </Button>
            ) : activePanel === 'cart' && cart.length > 0 ? (
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={clearCart}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <div className="w-8 h-8" />
            )}
          </div>
        </div>

        {/* Step indicator (compact) */}
        {activePanel && activePanel !== 'products' && activePanel !== 'cart' && (
          <div className="flex-shrink-0 px-4 pt-2 pb-1">
            <div className="flex items-center gap-2">
              {unitId ? (
                <>
                  {['customer', 'courier', 'products'].map((s, i) => (
                    <React.Fragment key={s}>
                      {i > 0 && <div className={cn("flex-1 h-0.5 rounded-full transition-colors",
                        ['customer', 'courier', 'products'].indexOf(activePanel) >= i ? "bg-primary" : "bg-border")} />}
                      <div className={cn("w-2 h-2 rounded-full transition-colors",
                        activePanel === s ? "bg-primary ring-2 ring-primary/30" :
                        ['customer', 'courier', 'products'].indexOf(activePanel) > i ? "bg-primary" : "bg-border")} />
                    </React.Fragment>
                  ))}
                </>
              ) : (
                <>
                  {['customer', 'unit', 'courier', 'products'].map((s, i) => (
                    <React.Fragment key={s}>
                      {i > 0 && <div className={cn("flex-1 h-0.5 rounded-full transition-colors",
                        ['customer', 'unit', 'courier', 'products'].indexOf(activePanel) >= i ? "bg-primary" : "bg-border")} />}
                      <div className={cn("w-2 h-2 rounded-full transition-colors",
                        activePanel === s ? "bg-primary ring-2 ring-primary/30" :
                        ['customer', 'unit', 'courier', 'products'].indexOf(activePanel) > i ? "bg-primary" : "bg-border")} />
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        {/* Panel Content */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {activePanel === 'customer' && renderCustomerPanel()}
          {activePanel === 'unit' && renderUnitPanel()}
          {activePanel === 'courier' && renderCourierPanel()}
          {activePanel === 'products' && renderProductPanel()}
          {activePanel === 'cart' && renderCartPanel()}
        </div>

        {/* Bottom sheet drawers */}
        <CourierSelectDrawer open={showCourierDrawer} onOpenChange={setShowCourierDrawer}
          couriers={unitCouriers} selectedId={courierId} onSelect={id => { setCourierId(id); setShowCourierDrawer(false); }} />
        <DateSelectDrawer open={showDateDrawer} onOpenChange={setShowDateDrawer}
          value={transactionDate} onChange={d => { setTransactionDate(d); setShowDateDrawer(false); }} />
        <NotesEditDrawer open={showNotesDrawer} onOpenChange={setShowNotesDrawer} value={notes} onChange={n => setNotes(n)} />
      </DialogContent>
    </Dialog>
  );
}

// ============ HELPER DRAWER COMPONENTS ============
function CourierSelectDrawer({ open, onOpenChange, couriers, selectedId, onSelect }: any) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="sr-only"><DrawerTitle>Pilih Kurir</DrawerTitle></DrawerHeader>
        <div className="px-4 pt-2 pb-1"><p className="text-sm font-bold">Pilih Kurir</p></div>
        <ScrollArea className="max-h-[50dvh] px-4">
          <div className="space-y-1 pb-2">
            <button type="button" onClick={() => onSelect('none')} className={cn("w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98]", selectedId === 'none' ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/80")}>
              <Send className="w-4 h-4 text-muted-foreground" /><span className="text-sm font-medium flex-1">Antar Sendiri</span>
              {selectedId === 'none' && <Check className="w-4 h-4 text-primary" />}
            </button>
            {couriers.map((c: { id: string; name: string }) => (
              <button key={c.id} type="button" onClick={() => onSelect(c.id)} className={cn("w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors active:scale-[0.98]", selectedId === c.id ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/80")}>
                <span className="text-sm font-medium flex-1">{c.name || (c as any).email || 'Tanpa Nama'}</span>{selectedId === c.id && <Check className="w-4 h-4 text-primary" />}
              </button>
            ))}
            {couriers.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground text-center">Tidak ada kurir aktif di unit ini.</p>
            )}
          </div>
        </ScrollArea>
        <DrawerFooter className="safe-bottom"><DrawerClose asChild><Button variant="outline" className="w-full">Tutup</Button></DrawerClose></DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function DateSelectDrawer({ open, onOpenChange, value, onChange }: any) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="sr-only"><DrawerTitle>Tanggal Transaksi</DrawerTitle></DrawerHeader>
        <div className="px-4 pt-2 pb-1"><p className="text-sm font-bold">Tanggal Transaksi</p></div>
        <div className="px-4 pb-4"><Input type="date" value={value} onChange={e => onChange(e.target.value)} max={todayLocal()} className="h-12 text-base rounded-xl" /></div>
      </DrawerContent>
    </Drawer>
  );
}

function NotesEditDrawer({ open, onOpenChange, value, onChange }: any) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="sr-only"><DrawerTitle>Catatan</DrawerTitle></DrawerHeader>
        <div className="px-4 pt-2 pb-1"><p className="text-sm font-bold">Catatan</p></div>
        <div className="px-4 pb-4"><Textarea value={value} onChange={e => onChange(e.target.value)} placeholder="Tambahkan catatan..." rows={3} className="rounded-xl text-sm" /></div>
      </DrawerContent>
    </Drawer>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { Search, Plus, Edit, Package, MoreVertical, Trash2, AlertTriangle, Minus, Camera, X, Sparkles, Loader2, TrendingUp, TrendingDown, ArrowUpDown, Warehouse, Filter, ChevronLeft, ChevronRight, DollarSign, BarChart3, AlertCircle, PackageCheck, PackageX } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatStock, formatDateTime, todayLocal, monthStartLocal, monthEndLocal } from '@/lib/erp-helpers';
import { Product } from '@/types';
import { apiFetch } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { VirtualGrid } from '@/components/ui/virtual-list';

// Product Form Component — Single compact form
function ProductForm({ onSuccess, initialData, units, existingCategories }: {
  onSuccess: () => void;
  initialData?: any;
  units?: any[];
  existingCategories?: string[];
}) {
  const hasSubUnit = initialData?.subUnit && (initialData?.conversionRate || 1) > 1;
  const conversionRate = initialData?.conversionRate || 1;
  // HPP input is per main unit; internally avgHpp is per subUnit
  const hppPerMainUnit = hasSubUnit ? (initialData?.avgHpp || 0) * conversionRate : (initialData?.avgHpp || 0);

  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    sku: initialData?.sku || '',
    category: initialData?.category || '',
    unit: initialData?.unit || 'pcs',
    subUnit: initialData?.subUnit || '',
    conversionRate: conversionRate,
    minStock: initialData?.minStock || 0,
    hppPerMainUnit: hppPerMainUnit,
    sellingPrice: initialData?.sellingPrice || 0,
    sellPricePerSubUnit: initialData?.sellPricePerSubUnit || 0,
    stockType: initialData?.stockType || 'centralized',
    trackStock: initialData?.trackStock !== undefined ? initialData.trackStock : true,
    imageUrl: initialData?.imageUrl || ''
  });
  const [imagePreview, setImagePreview] = useState<string | null>(initialData?.imageUrl || null);
  const [assignedUnits, setAssignedUnits] = useState<string[]>(
    initialData?.unitProducts?.map((up: any) => up.unitId) || []
  );
  const [loading, setLoading] = useState(false);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [generatingImage, setGeneratingImage] = useState(false);
  
  const isPerUnit = formData.stockType === 'per_unit';
  const unitList = units || [];
  
  const toggleUnit = (unitId: string) => {
    setAssignedUnits(prev =>
      prev.includes(unitId)
        ? prev.filter(id => id !== unitId)
        : [...prev, unitId]
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Ukuran file maksimal 5MB'); return; }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) { toast.error('Format tidak didukung. Gunakan JPG, PNG, WebP, atau GIF.'); return; }

    // Show preview immediately
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);

    // Try uploading to Supabase Storage CDN first
    try {
      const formDataUpload = new FormData();
      formDataUpload.append('file', file);
      // Use existing product ID for new products, generate temp ID for new
      const pid = initialData?.id || crypto.randomUUID();
      formDataUpload.append('productId', pid);

      const res = await fetch('/api/products/upload-image', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formDataUpload,
      });
      const result = await res.json();

      if (res.ok && result.url) {
        setFormData(prev => ({ ...prev, imageUrl: result.url }));
        toast.success('Gambar berhasil diupload');
      } else if (result.fallback) {
        // Storage not configured — fall back to base64
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          setFormData(prev => ({ ...prev, imageUrl: dataUrl }));
        };
        reader.readAsDataURL(file);
      } else {
        throw new Error(result.error || 'Upload gagal');
      }
    } catch (err: any) {
      // Fallback to base64 on any error
      console.warn('[Image] Upload failed, falling back to base64:', err);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        setFormData(prev => ({ ...prev, imageUrl: dataUrl }));
      };
      reader.readAsDataURL(file);
    }
  };

  // Compute avgHpp per subUnit from main unit input
  const getAvgHpp = () => {
    if (!formData.subUnit || formData.conversionRate <= 1) return formData.hppPerMainUnit;
    return formData.conversionRate > 0 ? formData.hppPerMainUnit / formData.conversionRate : 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.sellingPrice <= 0) { toast.error('Harga jual harus lebih dari 0'); return; }
    setLoading(true);
    try {
      const url = initialData ? `/api/products/${initialData.id}` : '/api/products';
      const method = initialData ? 'PATCH' : 'POST';
      const body: any = { ...formData };
      // Convert HPP per main unit to per subUnit for storage
      body.avgHpp = getAvgHpp();
      delete body.hppPerMainUnit;
      if (isPerUnit) body.assignedUnits = assignedUnits;
      await apiFetch(url, { method, body: JSON.stringify(body) });
      toast.success(initialData ? 'Produk diperbarui' : 'Produk berhasil ditambahkan');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  const up = (patch: Partial<typeof formData>) => setFormData(prev => ({ ...prev, ...patch }));

  // Auto-generate SKU from product name
  const handleNameChange = (name: string) => {
    up({ name });
    if (!initialData?.sku) {
      const words = name.trim().split(/\s+/).filter(Boolean);
      const prefix = words.slice(0, 3).map(w => w.charAt(0).toUpperCase()).join('');
      const num = String(Math.floor(Math.random() * 900) + 100);
      up({ sku: `${prefix}${num}` });
    }
  };

  // Generate product image with AI
  const handleGenerateImage = async () => {
    if (!formData.name.trim()) {
      toast.error('Isi nama produk terlebih dahulu');
      return;
    }
    setGeneratingImage(true);
    try {
      const prompt = `professional product photography of ${formData.name}${formData.category ? `, ${formData.category}` : ''}, clean white background, studio lighting, commercial quality, detailed, high resolution`;
      const res = await apiFetch<{ imageUrl: string }>('/api/generate-image', {
        method: 'POST',
        body: JSON.stringify({ prompt }),
      });
      if (res.imageUrl) {
        setImagePreview(res.imageUrl);
        up({ imageUrl: res.imageUrl });
        toast.success('Gambar berhasil di-generate');
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal generate gambar');
    } finally {
      setGeneratingImage(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-3 max-h-[70dvh] overflow-y-auto pr-1">
      {/* Row 1: Foto + Nama */}
      <div className="flex gap-3">
        {/* Photo */}
        <div className="relative shrink-0">
          <label className="relative cursor-pointer">
            {imagePreview ? (
              <div className="relative group">
                <img src={imagePreview} alt="" className="w-20 h-20 rounded-lg object-cover border bg-muted" />
                <button type="button" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImagePreview(null); up({ imageUrl: '' }); }}>
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-lg border-2 border-dashed bg-muted/30 flex items-center justify-center hover:border-primary/40 transition-colors">
                <Camera className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <Input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageUpload} />
          </label>
          {/* AI Generate Button */}
          <button
            type="button"
            disabled={generatingImage}
            onClick={handleGenerateImage}
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground rounded-full p-1 shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            title="Generate gambar dengan AI"
          >
            {generatingImage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          </button>
        </div>

        {/* Name + SKU + Category */}
        <div className="flex-1 min-w-0 space-y-2">
          <Input value={formData.name} onChange={e => handleNameChange(e.target.value)} placeholder="Nama produk *" required autoFocus />
          <div className="flex gap-2 min-w-0 overflow-hidden">
            <Input value={formData.sku} onChange={e => up({ sku: e.target.value })} placeholder="SKU (otomatis)" className="flex-1" />
            <Select
              value={showNewCategory ? '__new__' : (formData.category || '__none__')}
              onValueChange={v => {
                if (v === '__new__') {
                  setShowNewCategory(true);
                  setNewCategory('');
                  up({ category: '' });
                } else {
                  setShowNewCategory(false);
                  up({ category: v });
                }
              }}
            >
              <SelectTrigger className="flex-1"><SelectValue placeholder="Pilih kategori" /></SelectTrigger>
              <SelectContent>
                {existingCategories && existingCategories.length > 0 && existingCategories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
                <SelectItem value="__new__" className="text-primary font-medium">
                  + Tambah Kategori Baru
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {showNewCategory && (
            <Input
              value={newCategory}
              onChange={e => { setNewCategory(e.target.value); up({ category: e.target.value }); }}
              placeholder="Nama kategori baru..."
              autoFocus
              className="text-sm"
            />
          )}
        </div>
      </div>

      {/* Row 2: Tipe Stok + Track Stock */}
      <div className="space-y-2">
        <Label className="text-xs font-medium text-muted-foreground">Tipe Stok</Label>
        <Select value={formData.stockType} onValueChange={v => up({ stockType: v as 'centralized' | 'per_unit' })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="centralized">Tersentral</SelectItem>
            <SelectItem value="per_unit">Per Unit / Cabang</SelectItem>
          </SelectContent>
        </Select>
        {isPerUnit && unitList.length > 0 && (
          <div className="border rounded-lg p-2 space-y-1 max-h-32 overflow-y-auto">
            {unitList.map((u: any) => (
              <label key={u.id} className={cn("flex items-center gap-2 p-1.5 rounded cursor-pointer text-sm", assignedUnits.includes(u.id) ? "bg-primary/5" : "hover:bg-muted/50")}>
                <input type="checkbox" checked={assignedUnits.includes(u.id)} onChange={() => toggleUnit(u.id)} className="rounded" />
                <span className="font-medium">{u.name}</span>
                {u.address && <span className="text-xs text-muted-foreground">— {u.address}</span>}
              </label>
            ))}
          </div>
        )}
        {isPerUnit && assignedUnits.length === 0 && <p className="text-[11px] text-amber-600">Pilih minimal 1 cabang</p>}

        {/* Track Stock Toggle */}
        <div className="flex items-center justify-between p-2.5 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2 min-w-0">
            {formData.trackStock ? (
              <PackageCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <PackageX className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <span className="text-sm font-medium">Lacak Stok</span>
              <p className="text-[11px] text-muted-foreground">
                {formData.trackStock ? 'Stok akan dilacak saat transaksi' : 'Stok tidak berubah saat transaksi'}
              </p>
            </div>
          </div>
          <Switch
            checked={formData.trackStock}
            onCheckedChange={(checked) => up({ trackStock: checked })}
          />
        </div>
      </div>

      {/* Row 3: Satuan & Harga */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Satuan</Label>
          <Select value={formData.unit} onValueChange={v => up({ unit: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pcs">Pcs</SelectItem>
              <SelectItem value="kg">Kg</SelectItem>
              <SelectItem value="box">Box</SelectItem>
              <SelectItem value="liter">Liter</SelectItem>
              <SelectItem value="meter">Meter</SelectItem>
              <SelectItem value="lusin">Lusin</SelectItem>
              <SelectItem value="karton">Karton</SelectItem>
              <SelectItem value="dus">Dus</SelectItem>
              <SelectItem value="rim">Rim</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Stok Min</Label>
          <Input type="number" value={formData.minStock} onChange={e => up({ minStock: parseFloat(e.target.value) || 0 })} placeholder="0" />
        </div>
      </div>

      {/* Sub unit row */}
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Satuan Kecil</Label>
          <Input value={formData.subUnit} onChange={e => up({ subUnit: e.target.value })} placeholder="pack, pcs, sachet" />
        </div>
        <div className="w-20 space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Isi</Label>
          <Input type="number" value={formData.conversionRate || ''} onChange={e => up({ conversionRate: Math.max(0.01, parseFloat(e.target.value) || 1) })} placeholder="1" min="1" />
        </div>
      </div>
      {formData.subUnit && formData.conversionRate > 1 && (
        <p className="text-[11px] text-muted-foreground">1 {formData.unit} = {formData.conversionRate} {formData.subUnit}</p>
      )}

      {/* Row 4: HPP + Harga Jual */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">HPP / {formData.unit}</Label>
          <Input type="number" value={formData.hppPerMainUnit} onChange={e => up({ hppPerMainUnit: parseFloat(e.target.value) || 0 })} placeholder="0" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Harga Jual / {formData.unit}</Label>
          <Input type="number" value={formData.sellingPrice} onChange={e => up({ sellingPrice: parseFloat(e.target.value) || 0 })} placeholder="0" required />
        </div>
      </div>

      {/* Auto-calculated sub-unit HPP */}
      {formData.subUnit && formData.conversionRate > 1 && formData.hppPerMainUnit > 0 && (
        <p className="text-[11px] text-muted-foreground">
          HPP per {formData.subUnit}: {formatCurrency(Math.round(formData.hppPerMainUnit / formData.conversionRate))}
          <span className="ml-1">(otomatis dari HPP / {formData.unit} ÷ {formData.conversionRate})</span>
        </p>
      )}

      {formData.subUnit && formData.conversionRate > 1 && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">Harga per {formData.subUnit} (opsional)</Label>
          <Input type="number" value={formData.sellPricePerSubUnit || ''} onChange={e => up({ sellPricePerSubUnit: parseFloat(e.target.value) || 0 })} placeholder={formData.sellingPrice ? `Otomatis: ${Math.round(formData.sellingPrice / formData.conversionRate)}` : 'Otomatis'} />
        </div>
      )}

      {/* Submit */}
      <DialogFooter>
        <Button type="submit" disabled={loading || !formData.name.trim() || (isPerUnit && assignedUnits.length === 0)} className="w-full">
          {loading ? 'Menyimpan...' : initialData ? 'Perbarui Produk' : 'Tambah Produk'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Stock Form Component — Single compact form
function StockForm({ product, onSuccess }: {
  product: any;
  onSuccess: () => void;
}) {
  const { selectedUnitId } = useUnitStore();
  const isPerUnit = product.stockType === 'per_unit';
  const currentStock = isPerUnit && selectedUnitId
    ? (product.unitProducts?.find((up: any) => up.unitId === selectedUnitId)?.stock || 0)
    : product.globalStock;
  
  const [adjustment, setAdjustment] = useState(0);
  const [selectedStockUnitId, setSelectedStockUnitId] = useState(selectedUnitId || '');
  const [stockUnitType, setStockUnitType] = useState<'main' | 'sub'>('sub');
  // HPP input is per main unit
  const hppPerMainUnit = product.avgHpp * (product.conversionRate || 1);
  const [hpp, setHpp] = useState(hppPerMainUnit);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const hasSubUnit = product.subUnit && product.conversionRate > 1;
  const selectedUnitName = product.unitProducts?.find((up: any) => up.unitId === selectedStockUnitId)?.unit?.name || '';
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (adjustment === 0) { toast.error('Masukkan jumlah penyesuaian'); return; }
    if (isPerUnit && !selectedStockUnitId) { toast.error('Pilih cabang'); return; }
    setLoading(true);
    try {
      await apiFetch(`/api/products/${product.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          quantity: Math.abs(adjustment), type: adjustment > 0 ? 'in' : 'out',
          unitId: isPerUnit ? selectedStockUnitId : undefined,
          // Convert HPP from main unit to subUnit for API
          hpp: adjustment > 0 ? (hpp / (product.conversionRate || 1)) : undefined,
          stockUnitType: hasSubUnit ? stockUnitType : 'sub'
        })
      });
      toast.success(`Stok berhasil ${adjustment > 0 ? 'ditambah' : 'dikurangi'}`);
      onSuccess();
    } catch (err: any) { toast.error(err.message); } finally { setLoading(false); }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Info bar */}
      <div className="flex items-center justify-between p-3 bg-muted rounded-lg gap-2 min-w-0 overflow-hidden">
        <div className="min-w-0 overflow-hidden">
          <p className="font-medium truncate">{product.name}</p>
          <p className="text-xs text-muted-foreground">Stok saat ini</p>
        </div>
        <p className="text-xl font-bold shrink-0 ml-2">{formatStock(currentStock, product.unit, product.subUnit, product.conversionRate)}</p>
      </div>

      {/* Per-unit branch selector */}
      {isPerUnit && (
        <Select value={selectedStockUnitId} onValueChange={setSelectedStockUnitId}>
          <SelectTrigger><SelectValue placeholder="Pilih cabang..." /></SelectTrigger>
          <SelectContent>
            {product.unitProducts?.map((up: any) => (
              <SelectItem key={up.unitId} value={up.unitId}>
                {up.unit?.name || up.unitId} — {formatStock(up.stock, product.unit, product.subUnit, product.conversionRate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Sub-unit type */}
      {hasSubUnit && (
        <div className="grid grid-cols-2 gap-2">
          {[['main', product.unit] as const, ['sub', product.subUnit] as const].map(([type, label]) => (
            <button key={type} type="button"
              className={cn("flex items-center justify-center gap-1 rounded-lg border-2 p-2.5 text-sm font-medium transition-colors min-h-[44px]",
                stockUnitType === type ? "border-primary bg-primary/5" : "border-muted hover:border-muted-foreground/30"
              )}
              onClick={() => setStockUnitType(type)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Amount */}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={adjustment > 0 ? "default" : "outline"} className="h-12" onClick={() => setAdjustment(Math.abs(adjustment) || 1)}>
          <Plus className="w-4 h-4 mr-1" /> Tambah
        </Button>
        <Button type="button" variant={adjustment < 0 ? "destructive" : "outline"} className="h-12" onClick={() => setAdjustment(-Math.abs(adjustment) || -1)}>
          <Minus className="w-4 h-4 mr-1" /> Kurang
        </Button>
      </div>
      <Input type="number" value={adjustment || ''} onChange={e => { const v = parseFloat(e.target.value) || 0; setAdjustment(adjustment >= 0 ? Math.abs(v) : -Math.abs(v)); }} placeholder="Jumlah" />

      {/* HPP */}
      {adjustment > 0 && (
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground">HPP / {product.unit} (untuk masuk)</Label>
          <Input type="number" value={hpp} onChange={e => setHpp(parseFloat(e.target.value) || 0)} placeholder="0" />
          {hasSubUnit && hpp > 0 && (
            <p className="text-[11px] text-muted-foreground">
              HPP per {product.subUnit}: {formatCurrency(Math.round(hpp / (product.conversionRate || 1)))} (otomatis)
            </p>
          )}
        </div>
      )}

      {/* Preview */}
      <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
        <span className="text-sm">Stok baru:</span>
        <span className="font-bold text-lg">
          {stockUnitType === 'main'
            ? currentStock + adjustment * (product.conversionRate || 1)
            : currentStock + adjustment} {product.unit || 'pcs'}
          {stockUnitType === 'main' && hasSubUnit && <span className="text-xs text-muted-foreground font-normal ml-1">({adjustment * (product.conversionRate || 1)} {product.subUnit})</span>}
        </span>
      </div>

      <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Keterangan (opsional)" className="min-h-[60px]" />

      <DialogFooter>
        <Button type="submit" disabled={loading || adjustment === 0 || (isPerUnit && !selectedStockUnitId)} className="w-full">
          {loading ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ═══════════════════════════════════════════
// NILAI ASET (Asset Value) Tab
// ═══════════════════════════════════════════
function AssetValueTab({ products }: { products: any[] }) {
  const { data: assetData, isLoading: assetLoading } = useQuery({
    queryKey: ['asset-value'],
    queryFn: () => apiFetch<any>('/api/products/asset-value'),
    staleTime: 60_000,
  });

  if (assetLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const d = assetData || {};
  const profitMargin = d.totalAssetValue > 0
    ? ((d.totalSellingValue - d.totalAssetValue) / d.totalAssetValue * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground font-medium">Nilai Aset (HPP)</span>
            </div>
            <p className="text-lg font-bold text-emerald-700">{formatCurrency(d.totalAssetValue || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Total modal stok</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-muted-foreground font-medium">Nilai Jual</span>
            </div>
            <p className="text-lg font-bold text-blue-700">{formatCurrency(d.totalSellingValue || 0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Potensi penjualan</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-muted-foreground font-medium">Margin</span>
            </div>
            <p className="text-lg font-bold text-amber-700">{profitMargin}%</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Potensi keuntungan</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-rose-500">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span className="text-xs text-muted-foreground font-medium">Stok Rendah</span>
            </div>
            <p className="text-lg font-bold text-rose-700">{d.lowStockCount || 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">dari {d.productCount || 0} produk</p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown & Top Products */}
      <div className="grid lg:grid-cols-2 gap-3">
        {/* Category Breakdown */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Warehouse className="w-4 h-4" />
              Per Kategori
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {d.categories && d.categories.length > 0 ? (
              <div className="space-y-3">
                {d.categories.map((cat: any, i: number) => {
                  const pct = d.totalAssetValue > 0 ? (cat.assetValue / d.totalAssetValue * 100) : 0;
                  return (
                    <div key={cat.name || cat.id || i} className="space-y-1">
                      <div className="flex items-center justify-between text-sm min-w-0">
                        <span className="font-medium truncate">{cat.name}</span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-muted-foreground text-xs">{cat.productCount} produk</span>
                          <span className="font-semibold">{formatCurrency(cat.assetValue)}</span>
                        </div>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Belum ada data kategori</p>
            )}
          </CardContent>
        </Card>

        {/* Top 5 Most Valuable Products */}
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Package className="w-4 h-4" />
              Top 5 Produk Paling Berharga
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {d.topProducts && d.topProducts.length > 0 ? (
              <div className="space-y-2">
                {d.topProducts.map((p: any, i: number) => (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">Stok: {formatStock(p.stock, p.unit, p.subUnit, p.conversionRate)}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0">{formatCurrency(p.assetValue)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">Belum ada produk</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// PERGERAKAN STOK (Stock Movement) Tab
// ═══════════════════════════════════════════
function StockMovementTab({ products }: { products: any[] }) {
  const [filterType, setFilterType] = useState<string>('__all__');
  const [filterProduct, setFilterProduct] = useState<string>('__all__');
  const [dateFrom, setDateFrom] = useState<string>(monthStartLocal());
  const [dateTo, setDateTo] = useState<string>(todayLocal());
  const [page, setPage] = useState(0);
  const limit = 30;

  const { data: movementData, isLoading } = useQuery({
    queryKey: ['stock-movements', filterType, filterProduct, dateFrom, dateTo, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
      if (filterType !== '__all__') params.set('type', filterType);
      if (filterProduct !== '__all__') params.set('productId', filterProduct);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      return apiFetch<any>(`/api/products/stock-movements?${params}`);
    },
    staleTime: 30_000,
  });

  const movements = Array.isArray(movementData?.movements) ? movementData.movements : [];
  const total = movementData?.total || 0;
  const totalPages = Math.ceil(total / limit);

  const formatMovementQty = (m: any) => {
    const qty = m.quantity ?? 0;
    const unit = m.stockUnitType === 'main' ? (m.unitName || '') : (m.subUnit || m.unitName || 'pcs');
    return `${qty} ${unit}`;
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">Filter</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Select value={filterType} onValueChange={v => { setFilterType(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Tipe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Tipe</SelectItem>
                <SelectItem value="in">Stok Masuk</SelectItem>
                <SelectItem value="out">Stok Keluar</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterProduct} onValueChange={v => { setFilterProduct(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Produk" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Semua Produk</SelectItem>
                {products.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setPage(0); }}
              className="text-sm"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setPage(0); }}
              className="text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Movement Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : movements.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <ArrowUpDown className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Belum ada pergerakan stok</p>
              <p className="text-xs mt-1">Pergerakan stok akan muncul saat stok ditambah atau dikurangi</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px] min-w-[140px]">Tanggal</TableHead>
                    <TableHead>Produk</TableHead>
                    <TableHead className="w-[90px] min-w-[90px]">Tipe</TableHead>
                    <TableHead className="w-[100px] min-w-[100px]">Jumlah</TableHead>
                    <TableHead className="w-[90px] min-w-[90px]">Stok Baru</TableHead>
                    <TableHead className="w-[90px] min-w-[90px]">Cabang</TableHead>
                    <TableHead className="hidden sm:table-cell w-[100px] min-w-[100px]">Oleh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{m.productName}</p>
                          {m.productSku && <p className="text-[11px] text-muted-foreground">{m.productSku}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.type === 'in' ? 'default' : 'destructive'} className="gap-1 text-xs">
                          {m.type === 'in' ? (
                            <><TrendingUp className="w-3 h-3" /> Masuk</>
                          ) : (
                            <><TrendingDown className="w-3 h-3" /> Keluar</>
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {formatMovementQty(m)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.newStock !== null ? formatStock(m.newStock, m.unitName, m.subUnit, m.conversionRate) : '-'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.unitLabel || (m.stockType === 'centralized' ? '-' : '-')}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {m.userName}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    {page * limit + 1}–{Math.min((page + 1) * limit, total)} dari {total}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline" size="icon" className="h-8 w-8"
                      disabled={page === 0}
                      onClick={() => setPage(p => p - 1)}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-xs px-2">{page + 1} / {totalPages}</span>
                    <Button
                      variant="outline" size="icon" className="h-8 w-8"
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage(p => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════
// INLINE STOCK UPDATE BUTTONS
// ═══════════════════════════════════════════
function InlineStockButtons({ product, isPerUnit, selectedUnitId, onAdjust }: {
  product: any;
  isPerUnit: boolean;
  selectedUnitId: string | null;
  onAdjust: (productId: string, qty: number, unitId?: string) => void;
}) {
  const [showInput, setShowInput] = useState(false);
  const [inputVal, setInputVal] = useState('');

  const getUnitId = () => {
    if (isPerUnit && selectedUnitId) return selectedUnitId;
    return undefined;
  };

  const handleQuickBtn = (delta: number) => {
    onAdjust(product.id, delta, getUnitId());
  };

  const handleInputSubmit = () => {
    const v = parseFloat(inputVal);
    if (isNaN(v) || v === 0) return;
    onAdjust(product.id, v, getUnitId());
    setInputVal('');
    setShowInput(false);
  };

  if (!product.trackStock && product.trackStock !== undefined) return null;

  return (
    <div className="flex items-center gap-0.5">
      {showInput ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleInputSubmit();
              if (e.key === 'Escape') { setShowInput(false); setInputVal(''); }
            }}
            placeholder="0"
            className="w-14 h-6 text-[11px] text-center border rounded px-1 bg-background"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleInputSubmit(); }}
            className="h-6 w-6 flex items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          >
            <span className="text-[10px] font-bold">✓</span>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowInput(false); setInputVal(''); }}
            className="h-6 w-6 flex items-center justify-center rounded bg-muted hover:bg-muted/80 shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleQuickBtn(-1); }}
            className="h-6 w-6 flex items-center justify-center rounded-md bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 shrink-0 transition-colors"
            title="Kurangi 1"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleQuickBtn(1); }}
            className="h-6 w-6 flex items-center justify-center rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 shrink-0 transition-colors"
            title="Tambah 1"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowInput(true); }}
            className="h-6 w-6 flex items-center justify-center rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/30 dark:hover:bg-blue-950/50 shrink-0 transition-colors"
            title="Input jumlah"
          >
            <Edit className="w-3 h-3" />
          </button>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// MAIN PRODUCTS MODULE
// ═══════════════════════════════════════════
export default function ProductsModule() {
  const { user } = useAuthStore();
  const { selectedUnitId } = useUnitStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showStock, setShowStock] = useState<Product | null>(null);
  
  const { data, isLoading } = useQuery({
    queryKey: ['products', selectedUnitId],
    queryFn: async () => {
      const params = selectedUnitId ? `?unitId=${selectedUnitId}` : '';
      return apiFetch<any>(`/api/products${params}`);
    },
    ...POLLING_CONFIG,
    staleTime: 120_000,
    placeholderData: (prev) => prev,
  });

  // Fetch units for product form
  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: async () => {
      return apiFetch<any>('/api/units');
    }
  });
  const units = Array.isArray(unitsData?.units) ? unitsData.units : [];
  
  const products = (Array.isArray(data?.products) ? data.products : []).filter((p: Product) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  // Extract unique categories from all products
  const allProducts = Array.isArray(data?.products) ? data.products : [];
  const existingCategories = useMemo(() => {
    const cats = new Set<string>();
    allProducts.forEach((p: any) => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [allProducts]);
  
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/products/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Produk berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: any) => toast.error(err.message)
  });

  // Toggle trackStock mutation — optimistically updates UI
  const toggleTrackStockMutation = useMutation({
    mutationFn: async ({ id, trackStock }: { id: string; trackStock: boolean }) => {
      return apiFetch(`/api/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ trackStock }),
        headers: { 'Content-Type': 'application/json' }
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.trackStock ? 'Lacak stok diaktifkan' : 'Lacak stok dinonaktifkan');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal mengubah pengaturan stok');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  });

  // Quick inline stock adjustment mutation
  const quickStockMutation = useMutation({
    mutationFn: async ({ productId, qty, type, unitId }: { productId: string; qty: number; type: 'in' | 'out'; unitId?: string }) => {
      return apiFetch(`/api/products/${productId}/stock`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Math.abs(qty), type, unitId, stockUnitType: 'sub', reason: 'Penyesuaian cepat' }),
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(`Stok berhasil ${variables.type === 'in' ? 'ditambah' : 'dikurangi'} (${variables.qty > 0 ? '+' : ''}${variables.qty})`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal update stok');
    },
  });

  if (isLoading && !data) {
    return (
      <div className="space-y-4 w-full overflow-hidden">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="overflow-hidden rounded-lg">
              <Skeleton className="h-40 w-full rounded-t-lg" />
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-5 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-4 w-full overflow-hidden min-w-0">
      <Tabs defaultValue="products" className="w-full">
        {/* Tab Header with search & create */}
        <div className="flex flex-col sm:flex-row gap-3 min-w-0 overflow-hidden">
          <TabsList className="shrink-0">
            <TabsTrigger value="products" className="gap-1.5">
              <Package className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Produk</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nilai Aset</span>
            </TabsTrigger>
            <TabsTrigger value="movements" className="gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Pergerakan Stok</span>
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 flex gap-2 min-w-0">
            {/* Search - only show on products tab content, but always render for UX */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari produk..."
                className="pl-9"
              />
            </div>
            
            {user?.role === 'super_admin' && (
              <Dialog open={showCreate} onOpenChange={setShowCreate}>
                <DialogTrigger asChild>
                  <Button className="w-auto shrink-0">
                    <Plus className="w-4 h-4 mr-2" />
                    <span className="hidden sm:inline">Produk Baru</span>
                    <Plus className="w-4 h-4 sm:hidden" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Tambah Produk</DialogTitle>
                    <DialogDescription className="sr-only">Form untuk menambah produk baru</DialogDescription>
                  </DialogHeader>
                  <ProductForm
                    units={units}
                    existingCategories={existingCategories}
                    onSuccess={() => {
                      setShowCreate(false);
                      queryClient.invalidateQueries({ queryKey: ['products'] });
                    }}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
        
        {/* ── Produk Tab ── */}
        <TabsContent value="products">
          {/* Products Grid — virtual scrolling for 50+ products, normal grid otherwise */}
          {products.length > 30 ? (
            <VirtualGrid
              items={products}
              columns={4}
              estimateSize={220}
              gap={12}
              className="min-w-0"
              containerClassName="min-w-0"
              getItemKey={(p: any) => p.id}
              renderItem={(p: any) => {
                const isPerUnit = (p as any).stockType === 'per_unit';
                const isTracking = (p as any).trackStock !== false;
                const displayStock = isTracking
                  ? (selectedUnitId && isPerUnit ? ((p as any).effectiveStock ?? (p as any).unitStock ?? 0) : (p as any).globalStock)
                  : 0;
                const displayStockStr = isTracking ? formatStock(displayStock, (p as any).unit, (p as any).subUnit, (p as any).conversionRate) : 'Tidak dilacak';
                const isLow = isTracking && displayStock <= (p as any).minStock;

                return (
                <Card className={cn(
                  isPerUnit && selectedUnitId && !(p as any).hasAccess && "opacity-60",
                  !isTracking && "opacity-80",
                  "overflow-hidden"
                )}>
                  <CardContent className="p-4 overflow-hidden">
                    {/* Track Stock Toggle */}
                    <div className="flex items-center justify-between mb-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                        {isTracking ? (
                          <PackageCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <PackageX className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">Lacak Stok</span>
                      </div>
                      {user?.role === 'super_admin' && (
                        <Switch
                          checked={isTracking}
                          onCheckedChange={(checked) => {
                            toggleTrackStockMutation.mutate({ id: (p as any).id, trackStock: checked });
                          }}
                          className="scale-90"
                        />
                      )}
                    </div>

                    <div className="flex gap-3 mb-2 min-w-0 overflow-hidden">
                      {(p as any).imageUrl ? (
                        <img src={(p as any).imageUrl} alt={(p as any).name} className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover shrink-0 bg-muted border" />
                      ) : (
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-muted border flex items-center justify-center shrink-0">
                          <Package className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 min-w-0 overflow-hidden">
                            <h3 className="font-medium truncate">{(p as any).name}</h3>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                              {isPerUnit ? 'Per Unit' : 'Tersentral'}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground min-w-0 truncate">{(p as any).sku || '-'}</p>
                        </div>
                        <div className="flex items-center gap-1 justify-end mt-1">
                          <Badge variant={isLow ? "destructive" : (isTracking ? "secondary" : "outline")}>
                            {isTracking ? displayStockStr : 'Nonaktif'}
                          </Badge>
                          {user?.role === 'super_admin' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
                                  <MoreVertical className="w-3 h-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setEditingProduct(p as any)}>
                                  <Edit className="w-4 h-4 mr-2" />
                                  Edit Produk
                                </DropdownMenuItem>
                                {isTracking && (
                                  <DropdownMenuItem onClick={() => setShowStock(p as any)}>
                                    <Package className="w-4 h-4 mr-2" />
                                    Kelola Stok
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-red-600"
                                  disabled={deleteMutation.isPending}
                                  onClick={() => {
                                    if (confirm('Hapus produk ini?')) {
                                      deleteMutation.mutate((p as any).id);
                                    }
                                  }}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </div>

                    {isTracking && isPerUnit && selectedUnitId && !(p as any).hasAccess && (
                      <p className="text-xs text-amber-600 mb-2">Produk belum tersedia di cabang ini</p>
                    )}

                    {/* Price display */}
                    {(p as any).avgHpp > 0 && (
                      <div className="flex justify-between text-sm min-w-0 overflow-hidden">
                        <span className="text-muted-foreground shrink-0">HPP:</span>
                        <span className="min-w-0 truncate text-right">{formatCurrency((p as any).avgHpp * ((p as any).conversionRate || 1))}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm min-w-0 overflow-hidden">
                      <span className="text-muted-foreground shrink-0">Harga Jual:</span>
                      <span className="font-medium text-primary min-w-0 truncate text-right">{formatCurrency((p as any).sellingPrice || 0)}</span>
                    </div>
                    {/* Inline stock update buttons */}
                    {isTracking && user?.role === 'super_admin' && (
                      <div className="flex items-center justify-between mt-2 pt-2 border-t">
                        <span className="text-[11px] text-muted-foreground">Update Stok:</span>
                        <InlineStockButtons
                          product={p as any}
                          isPerUnit={isPerUnit}
                          selectedUnitId={selectedUnitId}
                          onAdjust={(productId, qty, unitId) => {
                            quickStockMutation.mutate({ productId, qty, type: qty > 0 ? 'in' : 'out', unitId });
                          }}
                        />
                      </div>
                    )}
                    {isLow && (p as any).hasAccess !== false && (
                      <Alert variant="destructive" className="mt-3 py-2">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">Stok rendah!</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
                );
              }}
            />
          ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 min-w-0 overflow-hidden">
            {products.map((p: any) => {
              const isPerUnit = p.stockType === 'per_unit';
              const isTracking = p.trackStock !== false;
              const displayStock = isTracking
                ? (selectedUnitId && isPerUnit ? (p.effectiveStock ?? p.unitStock ?? 0) : p.globalStock)
                : 0;
              const displayStockStr = isTracking ? formatStock(displayStock, p.unit, p.subUnit, p.conversionRate) : 'Tidak dilacak';
              const isLow = isTracking && displayStock <= p.minStock;
              
              return (
              <Card key={p.id} className={cn(
                isPerUnit && selectedUnitId && !p.hasAccess && "opacity-60",
                !isTracking && "opacity-80",
                "overflow-hidden"
              )}>
                <CardContent className="p-4 overflow-hidden">
                  {/* Track Stock Toggle — top right of card */}
                  <div className="flex items-center justify-between mb-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                      {isTracking ? (
                        <PackageCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      ) : (
                        <PackageX className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">Lacak Stok</span>
                    </div>
                    {user?.role === 'super_admin' && (
                      <Switch
                        checked={isTracking}
                        onCheckedChange={(checked) => {
                          toggleTrackStockMutation.mutate({ id: p.id, trackStock: checked });
                        }}
                        className="scale-90"
                      />
                    )}
                  </div>

                  <div className="flex gap-3 mb-2 min-w-0 overflow-hidden">
                    {/* Product image thumbnail */}
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover shrink-0 bg-muted border"
                      />
                    ) : (
                      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg bg-muted border flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 min-w-0 overflow-hidden">
                          <h3 className="font-medium truncate">{p.name}</h3>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            {isPerUnit ? 'Per Unit' : 'Tersentral'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground min-w-0 truncate">{p.sku || '-'}</p>
                      </div>
                      <div className="flex items-center gap-1 justify-end mt-1">
                        <Badge variant={isLow ? "destructive" : (isTracking ? "secondary" : "outline")}>
                          {isTracking ? displayStockStr : 'Nonaktif'}
                        </Badge>
                        {user?.role === 'super_admin' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
                                <MoreVertical className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditingProduct(p)}>
                                <Edit className="w-4 h-4 mr-2" />
                                Edit Produk
                              </DropdownMenuItem>
                              {isTracking && (
                                <DropdownMenuItem onClick={() => setShowStock(p)}>
                                  <Package className="w-4 h-4 mr-2" />
                                  Kelola Stok
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-red-600"
                                disabled={deleteMutation.isPending}
                                onClick={() => {
                                  if (confirm('Hapus produk ini?')) {
                                    deleteMutation.mutate(p.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {/* Per-unit breakdown when filtered by unit — only when tracking */}
                  {isTracking && isPerUnit && selectedUnitId && !p.hasAccess && (
                    <p className="text-xs text-amber-600 mb-2">Produk belum tersedia di cabang ini</p>
                  )}
                  {isTracking && isPerUnit && selectedUnitId && p.hasAccess && p.unitProducts?.length > 0 && (
                    <div className="text-xs text-muted-foreground mb-2 min-w-0">
                      Stok cabang: <span className="font-medium text-foreground">{formatStock(p.unitStock ?? 0, p.unit, p.subUnit, p.conversionRate)}</span> / Total: <span className="font-medium text-foreground">{formatStock(p.globalStock, p.unit, p.subUnit, p.conversionRate)}</span>
                    </div>
                  )}
                  {isTracking && isPerUnit && !selectedUnitId && p.unitProducts?.length > 0 && (
                    <div className="text-xs text-muted-foreground mb-2 flex flex-wrap gap-y-1 min-w-0 overflow-hidden">
                      {p.unitProducts.map((up: any) => (
                        <span key={up.unitId} className="inline-flex items-center gap-1 mr-3">
                          {up.unit?.name || up.unitId}: <span className="font-medium text-foreground">{formatStock(up.stock, p.unit, p.subUnit, p.conversionRate)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {user?.role === 'super_admin' && isTracking && (
                  <div className="flex justify-between text-sm min-w-0 overflow-hidden">
                    <span className="text-muted-foreground shrink-0">HPP / {p.unit || 'pcs'}:</span>
                    <span className="min-w-0 truncate text-right">{formatCurrency((p.avgHpp || 0) * (p.conversionRate || 1))}</span>
                  </div>
                  )}
                  <div className="flex justify-between text-sm min-w-0 overflow-hidden">
                    <span className="text-muted-foreground shrink-0">Harga Jual:</span>
                    <span className="font-medium text-primary min-w-0 truncate text-right">{formatCurrency(p.sellingPrice || 0)}</span>
                  </div>
                  {/* Inline stock update buttons */}
                  {isTracking && user?.role === 'super_admin' && (
                    <div className="flex items-center justify-between mt-2 pt-2 border-t">
                      <span className="text-[11px] text-muted-foreground">Update Stok:</span>
                      <InlineStockButtons
                        product={p}
                        isPerUnit={isPerUnit}
                        selectedUnitId={selectedUnitId}
                        onAdjust={(productId, qty, unitId) => {
                          quickStockMutation.mutate({ productId, qty, type: qty > 0 ? 'in' : 'out', unitId });
                        }}
                      />
                    </div>
                  )}
                  {isLow && p.hasAccess !== false && (
                    <Alert variant="destructive" className="mt-3 py-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-xs">Stok rendah!</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
          )}
        </TabsContent>
        
        {/* ── Nilai Aset Tab ── */}
        <TabsContent value="assets">
          <AssetValueTab products={allProducts} />
        </TabsContent>

        {/* ── Pergerakan Stok Tab ── */}
        <TabsContent value="movements">
          <StockMovementTab products={allProducts} />
        </TabsContent>
      </Tabs>
      
      {/* Edit Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Produk</DialogTitle>
            <DialogDescription className="sr-only">Form untuk mengedit produk</DialogDescription>
          </DialogHeader>
          {editingProduct && (
            <ProductForm
              initialData={editingProduct}
              units={units}
              existingCategories={existingCategories}
              onSuccess={() => {
                setEditingProduct(null);
                queryClient.invalidateQueries({ queryKey: ['products'] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      
      {/* Stock Management Dialog */}
      <Dialog open={!!showStock} onOpenChange={() => setShowStock(null)}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Kelola Stok</DialogTitle>
            <DialogDescription className="sr-only">Form untuk mengelola stok produk</DialogDescription>
          </DialogHeader>
          {showStock && (
            <StockForm
              product={showStock}
              onSuccess={() => {
                setShowStock(null);
                queryClient.invalidateQueries({ queryKey: ['products'] });
                queryClient.invalidateQueries({ queryKey: ['asset-value'] });
                queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

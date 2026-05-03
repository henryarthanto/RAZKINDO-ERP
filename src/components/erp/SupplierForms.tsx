'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  Search,
  Package,
  Package as PackageIcon,
  Check,
  AlertTriangle,
  Send,
  X,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, todayLocal } from '@/lib/erp-helpers';
import { apiFetch } from '@/lib/api-client';
import { Supplier, FinanceRequest, Product } from '@/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DialogFooter } from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';

// Supplier Form Component
export function SupplierForm({ supplier, onSuccess }: {
  supplier?: Supplier;
  onSuccess: () => void;
}) {
  const isEdit = !!supplier;
  const [formData, setFormData] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    bankName: supplier?.bankName || '',
    bankAccount: supplier?.bankAccount || '',
    notes: supplier?.notes || ''
  });
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Nama supplier wajib diisi');
      return;
    }
    
    setLoading(true);
    
    try {
      const url = isEdit ? `/api/suppliers/${supplier!.id}` : '/api/suppliers';
      const method = isEdit ? 'PATCH' : 'POST';
      
      await apiFetch(url, {
        method,
        body: JSON.stringify({
          ...formData,
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
        })
      });
      
      toast.success(`Supplier berhasil ${isEdit ? 'diupdate' : 'ditambahkan'}`);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nama Supplier *</Label>
        <Input
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          required
          placeholder="Nama supplier"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Telepon</Label>
          <Input
            value={formData.phone}
            onChange={e => setFormData({ ...formData, phone: e.target.value })}
            placeholder="08xxxxxxxxxx"
          />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            value={formData.email}
            onChange={e => setFormData({ ...formData, email: e.target.value })}
            placeholder="email@supplier.com"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Alamat</Label>
        <Textarea
          value={formData.address}
          onChange={e => setFormData({ ...formData, address: e.target.value })}
          placeholder="Alamat lengkap supplier"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Nama Bank</Label>
          <Input
            value={formData.bankName}
            onChange={e => setFormData({ ...formData, bankName: e.target.value })}
            placeholder="BCA, Mandiri, dll"
          />
        </div>
        <div className="space-y-2">
          <Label>No. Rekening</Label>
          <Input
            value={formData.bankAccount}
            onChange={e => setFormData({ ...formData, bankAccount: e.target.value })}
            placeholder="Nomor rekening"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Catatan</Label>
        <Textarea
          value={formData.notes}
          onChange={e => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Catatan tambahan..."
        />
      </div>
      
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? 'Menyimpan...' : isEdit ? 'Update Supplier' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// Goods Status Form Component
export function GoodsStatusForm({ request, onUpdate, isLoading }: {
  request: FinanceRequest;
  onUpdate: (data: { id: string; goodsStatus: string; notes?: string }) => void;
  isLoading: boolean;
}) {
  const [goodsStatus, setGoodsStatus] = useState<'pending' | 'received' | 'partial'>(
    (request.goodsStatus as 'pending' | 'received' | 'partial') || 'pending'
  );
  const [notes, setNotes] = useState(request.notes || '');
  
  let items: any[] = [];
  try { items = request.purchaseItems ? JSON.parse(request.purchaseItems) : []; } catch { items = []; }
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate({
      id: request.id,
      goodsStatus,
      notes
    });
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Request Summary */}
      <div className="p-3 bg-muted rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Supplier</span>
          <span className="font-medium">{request.supplier?.name || '-'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Jumlah</span>
          <span className="font-bold">{formatCurrency(request.amount)}</span>
        </div>
      </div>
      
      {/* Items Preview */}
      {items.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead className="text-right">Qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell className="text-right">{item.qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      
      {/* Status Selection */}
      <div className="space-y-2">
        <Label>Status Penerimaan Barang</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Button
            type="button"
            variant={goodsStatus === 'pending' ? 'default' : 'outline'}
            className={cn(
              "h-auto py-3 flex flex-col",
              goodsStatus === 'pending' && "bg-amber-500 hover:bg-amber-600"
            )}
            onClick={() => setGoodsStatus('pending')}
          >
            <Clock className="w-4 h-4 mb-1" />
            <span className="text-xs">Belum Diterima</span>
          </Button>
          <Button
            type="button"
            variant={goodsStatus === 'partial' ? 'default' : 'outline'}
            className={cn(
              "h-auto py-3 flex flex-col",
              goodsStatus === 'partial' && "bg-blue-500 hover:bg-blue-600"
            )}
            onClick={() => setGoodsStatus('partial')}
          >
            <Package className="w-4 h-4 mb-1" />
            <span className="text-xs">Sebagian</span>
          </Button>
          <Button
            type="button"
            variant={goodsStatus === 'received' ? 'default' : 'outline'}
            className={cn(
              "h-auto py-3 flex flex-col",
              goodsStatus === 'received' && "bg-green-500 hover:bg-green-600"
            )}
            onClick={() => setGoodsStatus('received')}
          >
            <Check className="w-4 h-4 mb-1" />
            <span className="text-xs">Diterima</span>
          </Button>
        </div>
        {goodsStatus === 'received' && (
          <p className="text-xs text-green-600 mt-2">
            ✓ Stok produk akan otomatis bertambah saat status diubah ke &quot;Diterima&quot;
          </p>
        )}
      </div>
      
      {/* Notes */}
      <div className="space-y-2">
        <Label>Catatan</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Catatan penerimaan barang..."
        />
      </div>
      
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Menyimpan...' : 'Simpan Status'}
      </Button>
    </form>
  );
}

// Purchase Request Form Component - Request to Finance
export function PurchaseRequestForm({ suppliers, products, units, userId, unitId, initialSupplierId, onSuccess }: {
  suppliers: Supplier[];
  products: Product[];
  units: any[];
  userId: string;
  unitId?: string;
  initialSupplierId?: string;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    supplierId: initialSupplierId || '',
    unitId: '',
    transactionDate: todayLocal(),
    notes: '',
    items: [] as { 
      productId: string; productName: string; qty: number; 
      qtyUnitType: 'main' | 'sub'; mainUnit: string; subUnit: string; 
      conversionRate: number; price: number; hpp: number;
      isCustom?: boolean;
    }[]
  });
  const [loading, setLoading] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [showCustomProduct, setShowCustomProduct] = useState(false);
  const [customProduct, setCustomProduct] = useState({ name: '', unit: 'pcs', price: 0, qty: 1 });

  // Use prop unitId as default if available
  useEffect(() => {
    if (unitId && !formData.unitId) {
      setFormData(prev => ({ ...prev, unitId }));
    }
  }, [unitId]);

  // Sync initialSupplierId into form state when dialog opens
  useEffect(() => {
    if (initialSupplierId) {
      setFormData(prev => ({ ...prev, supplierId: initialSupplierId }));
    }
  }, [initialSupplierId]);
  
  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );
  
  const selectedSupplier = suppliers.find(s => s.id === formData.supplierId);
  
  // Helper: get qty in subUnits
  const getQtyInSubUnits = (item: typeof formData.items[0]) => {
    return item.qtyUnitType === 'main' ? item.qty * item.conversionRate : item.qty;
  };

  const addItem = (product: Product) => {
    const existing = formData.items.find(i => i.productId === product.id);
    const mainUnit = product.unit || 'pcs';
    const subUnit = product.subUnit || 'pcs';
    const hasMultipleUnits = product.conversionRate > 1 && subUnit !== mainUnit;
    const convRate = product.conversionRate > 1 ? product.conversionRate : 1;

    if (existing) {
      setFormData({
        ...formData,
        items: formData.items.map(i =>
          i.productId === product.id ? { ...i, qty: i.qty + 1 } : i
        )
      });
    } else {
      setFormData({
        ...formData,
        items: [...formData.items, {
          productId: product.id,
          productName: product.name,
          qty: 1,
          qtyUnitType: hasMultipleUnits ? 'main' as const : 'sub' as const,
          mainUnit,
          subUnit,
          conversionRate: convRate,
          price: product.avgHpp || 0,
          hpp: product.avgHpp || 0
        }]
      });
    }
    setProductSearch('');
  };

  // Add custom product (not in main inventory)
  const addCustomItem = () => {
    if (!customProduct.name.trim()) {
      toast.error('Nama produk wajib diisi');
      return;
    }
    const item = {
      productId: `__custom__${Date.now()}`,
      productName: customProduct.name.trim(),
      qty: customProduct.qty || 1,
      qtyUnitType: 'sub' as const,
      mainUnit: customProduct.unit,
      subUnit: customProduct.unit,
      conversionRate: 1,
      price: customProduct.price || 0,
      hpp: customProduct.price || 0,
      isCustom: true
    };
    setFormData({ ...formData, items: [...formData.items, item] });
    setCustomProduct({ name: '', unit: 'pcs', price: 0, qty: 1 });
    setShowCustomProduct(false);
    toast.success(`Produk "${item.productName}" ditambahkan`);
  };
  
  const updateItem = (index: number, field: string, value: any) => {
    const newItems = [...formData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    setFormData({ ...formData, items: newItems });
  };
  
  const removeItem = (index: number) => {
    setFormData({ ...formData, items: formData.items.filter((_, i) => i !== index) });
  };
  
  const total = formData.items.reduce((sum, item) => {
    return sum + (item.qty * item.price);
  }, 0);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.unitId) {
      toast.error('Pilih unit/cabang terlebih dahulu');
      return;
    }
    
    if (!formData.supplierId) {
      toast.error('Pilih supplier terlebih dahulu');
      return;
    }
    
    if (formData.items.length === 0) {
      toast.error('Tambahkan produk terlebih dahulu');
      return;
    }
    
    setLoading(true);
    
    try {
      await apiFetch('/api/finance/requests', {
        method: 'POST',
        body: JSON.stringify({
          type: 'purchase',
          requestById: userId,
          unitId: formData.unitId,
          supplierId: formData.supplierId,
          amount: total,
          description: `Permintaan pembelian ke ${selectedSupplier?.name}`,
          purchaseItems: JSON.stringify(formData.items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            qty: i.qty,
            qtyUnitType: i.qtyUnitType,
            qtyInSubUnit: getQtyInSubUnits(i),
            mainUnit: i.mainUnit,
            subUnit: i.subUnit,
            conversionRate: i.conversionRate,
            price: i.price,
            hpp: i.hpp,
            subtotal: i.qty * i.price,
            isCustom: i.isCustom || false
          }))),
          notes: formData.notes
        })
      });
      
      toast.success('Request pembelian berhasil dikirim ke Finance');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Info Banner */}
      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div>
            <p className="font-medium text-amber-800 dark:text-amber-200">Request ke Finance</p>
            <p className="text-sm text-amber-600 dark:text-amber-400">
              Permintaan pembelian akan dikirim ke Finance untuk diproses. 
              Finance akan menentukan apakah akan dijadikan hutang atau dibayar langsung.
            </p>
          </div>
        </div>
      </div>
      
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Unit/Cabang Tujuan *</Label>
          <Select value={formData.unitId} onValueChange={v => setFormData({ ...formData, unitId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih unit/cabang" />
            </SelectTrigger>
            <SelectContent>
              {units.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Pilih unit/cabang yang akan menerima stok barang</p>
        </div>
        <div className="space-y-2">
          <Label>Supplier *</Label>
          <Select value={formData.supplierId} onValueChange={v => setFormData({ ...formData, supplierId: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Pilih supplier" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label>Tanggal Permintaan</Label>
        <Input
          type="date"
          value={formData.transactionDate}
          onChange={e => setFormData({ ...formData, transactionDate: e.target.value })}
          max={todayLocal()}
          className="w-full sm:w-auto"
        />
      </div>
      
      {/* Products */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Produk</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-primary"
            onClick={() => setShowCustomProduct(!showCustomProduct)}
          >
            <Plus className="w-3 h-3 mr-1" />
            {showCustomProduct ? 'Tutup' : 'Produk Lainnya'}
          </Button>
        </div>

        {/* Custom Product Input */}
        {showCustomProduct && (
          <div className="border-2 border-dashed border-primary/30 rounded-lg p-3 bg-primary/5 space-y-2">
            <p className="text-xs text-muted-foreground">Tambahkan produk yang belum ada di katalog Produk & Stok</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2">
                <Input
                  value={customProduct.name}
                  onChange={e => setCustomProduct({ ...customProduct, name: e.target.value })}
                  placeholder="Nama produk *"
                  autoFocus
                />
              </div>
              <div>
                <Input
                  value={customProduct.qty || ''}
                  onChange={e => setCustomProduct({ ...customProduct, qty: parseFloat(e.target.value) || 1 })}
                  placeholder="Qty"
                  type="number"
                  min="1"
                />
              </div>
              <div>
                <Input
                  value={customProduct.unit}
                  onChange={e => setCustomProduct({ ...customProduct, unit: e.target.value })}
                  placeholder="Satuan (pcs, kg, dll)"
                />
              </div>
              <div className="col-span-2">
                <Input
                  value={customProduct.price || ''}
                  onChange={e => setCustomProduct({ ...customProduct, price: parseFloat(e.target.value) || 0 })}
                  placeholder="Harga per unit"
                  type="number"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={addCustomItem}
                disabled={!customProduct.name.trim()}
              >
                <Plus className="w-3 h-3 mr-1" />
                Tambah
              </Button>
            </div>
          </div>
        )}

        {/* Product Search from Catalog */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-start">
              <Search className="w-4 h-4 mr-2" />
              {productSearch || "Cari dari katalog produk..."}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput value={productSearch} onValueChange={setProductSearch} placeholder="Cari produk..." />
              <CommandList>
                <CommandEmpty>Tidak ditemukan</CommandEmpty>
                <CommandGroup>
                  {filteredProducts.slice(0, 10).map(p => {
                    const hasMultipleUnits = p.conversionRate > 1 && p.unit && p.subUnit && p.unit !== p.subUnit;
                    return (
                      <CommandItem key={p.id} onSelect={() => addItem(p)}>
                        <div className="flex justify-between w-full items-center">
                          <div>
                            <span>{p.name}</span>
                            <p className="text-xs text-muted-foreground">
                              {hasMultipleUnits 
                                ? `1 ${p.unit} = ${p.conversionRate} ${p.subUnit}`
                                : `HPP: ${formatCurrency((p.avgHpp || 0) * (p.conversionRate || 1))}/${p.unit || 'pcs'}`
                              }
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatCurrency((p.avgHpp || 0) * (p.conversionRate || 1))}/{hasMultipleUnits ? p.unit : (p.unit || 'pcs')}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        
        {formData.items.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produk</TableHead>
                  <TableHead className="w-28">Satuan</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="text-xs text-muted-foreground">Dlm {''}</TableHead>
                  <TableHead className="w-28">Harga/{''}</TableHead>
                  <TableHead className="w-28">Subtotal</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {formData.items.map((item, i) => {
                  const hasMultipleUnits = item.conversionRate > 1 && item.mainUnit !== item.subUnit;
                  const subQty = getQtyInSubUnits(item);
                  return (
                    <TableRow key={i} className={item.isCustom ? "bg-primary/5" : ""}>
                      <TableCell>
                        <p className="font-medium text-sm">{item.productName}</p>
                        {item.isCustom && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 mt-0.5">Lainnya</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasMultipleUnits ? (
                          <Select
                            value={item.qtyUnitType}
                            onValueChange={(v: 'main' | 'sub') => updateItem(i, 'qtyUnitType', v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="main">
                                <span className="flex items-center gap-1">
                                  <PackageIcon className="w-3 h-3" />
                                  {item.mainUnit}
                                </span>
                              </SelectItem>
                              <SelectItem value="sub">
                                <span className="flex items-center gap-1">
                                  <Package className="w-3 h-3" />
                                  {item.subUnit}
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-sm text-muted-foreground">{item.mainUnit || 'pcs'}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.qty || ''}
                          onChange={e => updateItem(i, 'qty', parseFloat(e.target.value) || 0)}
                          className="w-20"
                          min="0.01"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {hasMultipleUnits && (
                          <span>{subQty} {item.subUnit}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.price || ''}
                          onChange={e => updateItem(i, 'price', parseFloat(e.target.value) || 0)}
                          className="w-28"
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {formatCurrency(item.qty * item.price)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeItem(i)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      
      {/* Summary */}
      <div className="bg-muted rounded-lg p-4">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-muted-foreground">Total Permintaan:</span>
            <p className="text-xs text-muted-foreground">
              {formData.items.length} produk
              {formData.items.some(i => i.conversionRate > 1 && i.mainUnit !== i.subUnit) && ' • qty akan dikonversi ke satuan terkecil saat stok masuk'}
            </p>
          </div>
          <span className="text-2xl font-bold">{formatCurrency(total)}</span>
        </div>
      </div>
      
      <div className="space-y-2">
        <Label>Catatan</Label>
        <Textarea
          value={formData.notes}
          onChange={e => setFormData({ ...formData, notes: e.target.value })}
          placeholder="Catatan untuk Finance..."
        />
      </div>
      
      <DialogFooter className="flex-shrink-0 pt-2 border-t mt-2">
        <Button type="submit" disabled={loading || formData.items.length === 0} className="w-full">
          {loading ? 'Mengirim...' : (
            <>
              <Send className="w-4 h-4 mr-2" />
              Kirim Request ke Finance
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

'use client';

import { useState } from 'react';
import {
  Building2,
  ShoppingCart,
  Wallet,
  Clock,
  Search,
  Plus,
  Phone,
  MoreVertical,
  Edit,
  Trash2,
  Share2,
  Printer,
  Package,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDate, formatDateTime, escapeHtml } from '@/lib/erp-helpers';
import { Supplier, FinanceRequest, Transaction, Product } from '@/types';
import { LoadingFallback } from '@/components/error-boundary';
import { apiFetch } from '@/lib/api-client';
import { getPaymentStatusLabel, getPaymentStatusColor } from './SharedComponents';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

import { SupplierForm, GoodsStatusForm, PurchaseRequestForm } from './SupplierForms';

export default function SuppliersModule() {
  const { user } = useAuthStore();
  const { selectedUnitId, units } = useUnitStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showCreateSupplier, setShowCreateSupplier] = useState(false);
  const [showEditSupplier, setShowEditSupplier] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [showPurchase, setShowPurchase] = useState(false);
  const [showGoodsStatusDialog, setShowGoodsStatusDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<FinanceRequest | null>(null);
  const [activeTab, setActiveTab] = useState('suppliers');
  const [selectedPurchase, setSelectedPurchase] = useState<Transaction | null>(null);
  
  // Settings query for company name (used in PO/Request PDFs)
  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      return apiFetch<any>('/api/settings');
    }
  });
  const companyName = settingsData?.settings?.company_name || 'Razkindo ERP';
  
  const { data: suppliersData, isLoading: suppliersLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      return apiFetch<any>('/api/suppliers');
    },
    ...POLLING_CONFIG
  });
  
  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      return apiFetch<any>('/api/transactions?type=purchase');
    },
    ...POLLING_CONFIG
  });
  
  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      return apiFetch<any>('/api/products');
    }
  });
  
  const { data: financeRequestsData } = useQuery({
    queryKey: ['finance-requests'],
    queryFn: async () => {
      return apiFetch<any>('/api/finance/requests');
    },
    ...POLLING_CONFIG
  });
  
  const suppliers = (Array.isArray(suppliersData?.suppliers) ? suppliersData.suppliers : []).filter((s: Supplier) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );
  
  const purchases = Array.isArray(purchasesData?.transactions) ? purchasesData.transactions : [];
  const products = Array.isArray(productsData?.products) ? productsData.products : [];
  const financeRequests = Array.isArray(financeRequestsData?.requests) ? financeRequestsData.requests : [];
  
  // Stats
  const totalSuppliers = suppliers.length;
  const totalPurchase = purchases.reduce((sum: number, t: Transaction) => sum + t.total, 0);
  const totalUnpaid = purchases.reduce((sum: number, t: Transaction) => sum + t.remainingAmount, 0);
  const pendingPurchaseRequests = financeRequests.filter((r: FinanceRequest) => r.type === 'purchase' && r.status === 'pending');
  
  // Mutation for updating goods status
  const updateGoodsStatusMutation = useMutation({
    mutationFn: async (data: { id: string; goodsStatus: string; notes?: string }) => {
      return apiFetch(`/api/finance/requests/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          goodsStatus: data.goodsStatus,
          notes: data.notes,
          updatedById: user?.id
        })
      });
    },
    onSuccess: () => {
      toast.success('Status barang berhasil diupdate');
      setShowGoodsStatusDialog(false);
      setSelectedRequest(null);
      queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  // Delete supplier mutation
  const deleteSupplierMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/suppliers/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Supplier berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });
  
  if (suppliersLoading || purchasesLoading) {
    return <LoadingFallback message="Memuat data supplier..." />;
  }
  
  // Generate PO PDF content
  const getPOHTML = (purchase: Transaction) => {
    const items = purchase.items || [];
    const supplier = purchase.supplier;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Purchase Order - ${purchase.invoiceNo}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .logo { font-size: 24px; font-weight: bold; color: #10b981; }
          .company { font-size: 12px; color: #666; }
          .po-title { font-size: 20px; font-weight: bold; margin: 20px 0; text-align: center; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .info-box { padding: 15px; background: #f9fafb; border-radius: 8px; }
          .info-label { font-size: 12px; color: #666; margin-bottom: 5px; }
          .info-value { font-weight: 500; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f3f4f6; padding: 12px; text-align: left; font-size: 12px; }
          td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
          .text-right { text-align: right; }
          .total-row { font-weight: bold; background: #f9fafb; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; }
          .signature { margin-top: 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 100px; }
          .signature-box { text-align: center; }
          .signature-line { margin-top: 60px; border-top: 1px solid #333; }
          .actions { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 1000; }
          .btn { padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 8px; }
          .btn-primary { background: #10b981; color: white; }
          .btn-secondary { background: #6b7280; color: white; }
          .btn:hover { opacity: 0.9; }
          @media print { .actions { display: none; } body { padding: 40px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">${escapeHtml(companyName)}</div>
          <div class="company">Supplier & Distribution</div>
        </div>
        
        <div class="po-title">PURCHASE ORDER</div>
        
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">No. PO</div>
            <div class="info-value">${purchase.invoiceNo}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Tanggal</div>
            <div class="info-value">${formatDate(purchase.transactionDate)}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Supplier</div>
            <div class="info-value">${escapeHtml(supplier?.name || '-')}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Alamat Supplier</div>
            <div class="info-value">${escapeHtml(supplier?.address || '-')}</div>
          </div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Produk</th>
              <th class="text-right">Qty</th>
              <th class="text-right">Harga</th>
              <th class="text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${escapeHtml(item.productName)}</td>
                <td class="text-right">${item.qty}</td>
                <td class="text-right">${formatCurrency(item.price)}</td>
                <td class="text-right">${formatCurrency(item.subtotal)}</td>
              </tr>
            `).join('')}
            <tr class="total-row">
              <td colspan="4" class="text-right">TOTAL</td>
              <td class="text-right">${formatCurrency(purchase.total)}</td>
            </tr>
          </tbody>
        </table>
        
        ${purchase.notes ? `<p><strong>Catatan:</strong> ${escapeHtml(purchase.notes)}</p>` : ''}
        
        <div class="signature">
          <div class="signature-box">
            <div class="signature-line">Hormat Kami,</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">Supplier,</div>
          </div>
        </div>
        
        <div class="footer">
          <p>Dokumen ini dicetak secara otomatis dari sistem Razkindo ERP</p>
          <p>Tanggal cetak: ${formatDateTime(new Date())}</p>
        </div>
        
        <div class="actions">
          <button class="btn btn-primary" onclick="handleShare()">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
          </button>
          <button class="btn btn-secondary" onclick="window.print()">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </div>
        
        <script>
          async function handleShare() {
            const shareData = {
              title: 'Purchase Order - ${purchase.invoiceNo}',
              text: 'PO ${escapeHtml(purchase.invoiceNo)} - ${escapeHtml(supplier?.name || 'Supplier')} - Total: ${formatCurrency(purchase.total)}',
              url: window.location.href
            };
            
            if (navigator.share) {
              try {
                await navigator.share(shareData);
              } catch (err) {
                console.log('Share cancelled');
              }
            } else {
              // Fallback: copy to clipboard
              try {
                await navigator.clipboard.writeText(window.location.href);
                alert('Link disalin ke clipboard!');
              } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = shareData.text + '\\n' + window.location.href;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Info PO disalin ke clipboard!');
              }
            }
          }
        </script>
      </body>
      </html>
    `;
  };
  
  // Generate PO PDF with share
  const generatePOPDF = (purchase: Transaction) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup diblokir. Izinkan popup untuk melihat PO.');
      return;
    }
    
    printWindow.document.write(getPOHTML(purchase));
    printWindow.document.close();
  };
  
  // Share PO directly
  const sharePO = async (purchase: Transaction) => {
    const supplier = purchase.supplier;
    const shareText = `PO ${purchase.invoiceNo}\nSupplier: ${supplier?.name || '-'}\nTanggal: ${formatDate(purchase.transactionDate)}\nTotal: ${formatCurrency(purchase.total)}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Purchase Order - ${purchase.invoiceNo}`,
          text: shareText,
        });
        toast.success('PO berhasil dibagikan');
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          // Fallback to clipboard
          await copyToClipboard(shareText);
        }
      }
    } else {
      // Fallback: copy to clipboard
      await copyToClipboard(shareText);
    }
  };
  
  // Copy to clipboard helper
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Info PO disalin ke clipboard');
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      toast.success('Info PO disalin ke clipboard');
    }
  };
  
  // Generate Request PDF (for pending requests)
  const generateRequestPDF = (request: FinanceRequest, supplier: Supplier | undefined) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Popup diblokir. Izinkan popup untuk melihat dokumen.');
      return;
    }
    
    let items: any[] = [];
    try { items = request.purchaseItems ? JSON.parse(request.purchaseItems) : []; } catch { items = []; }
    const statusText = request.status === 'pending' ? 'Menunggu Persetujuan Finance' :
                       request.status === 'approved' ? 'Disetujui' :
                       request.status === 'processed' ? 'Diproses' : 'Ditolak';
    const statusClass = request.status === 'pending' ? 'status-pending' :
                        request.status === 'approved' ? 'status-approved' :
                        request.status === 'processed' ? 'status-processed' : 'status-rejected';
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Permintaan Pembelian - ${request.id.slice(0, 8).toUpperCase()}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
          .logo { font-size: 24px; font-weight: bold; color: #10b981; }
          .title { font-size: 20px; font-weight: bold; margin: 20px 0; text-align: center; background: #fef3c7; padding: 10px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .info-box { padding: 15px; background: #f9fafb; border-radius: 8px; }
          .info-label { font-size: 12px; color: #666; margin-bottom: 5px; }
          .info-value { font-weight: 500; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #f3f4f6; padding: 12px; text-align: left; font-size: 12px; }
          td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
          .text-right { text-align: right; }
          .total-row { font-weight: bold; background: #f9fafb; }
          .status-pending { background: #fef3c7; color: #92400e; padding: 5px 15px; border-radius: 4px; }
          .status-approved { background: #dbeafe; color: #1e40af; padding: 5px 15px; border-radius: 4px; }
          .status-processed { background: #d1fae5; color: #065f46; padding: 5px 15px; border-radius: 4px; }
          .status-rejected { background: #fee2e2; color: #991b1b; padding: 5px 15px; border-radius: 4px; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #666; }
          .actions { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px; z-index: 1000; }
          .btn { padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-weight: 500; display: flex; align-items: center; gap: 8px; }
          .btn-primary { background: #10b981; color: white; }
          .btn-secondary { background: #6b7280; color: white; }
          .btn:hover { opacity: 0.9; }
          @media print { .actions { display: none; } body { padding: 40px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="logo">${escapeHtml(companyName)}</div>
          <div>Permintaan Pembelian ke Finance</div>
        </div>
        
        <div class="title">PERMINTAAN PEMBELIAN</div>
        
        <div class="info-grid">
          <div class="info-box">
            <div class="info-label">No. Request</div>
            <div class="info-value">${request.id.slice(0, 8).toUpperCase()}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Tanggal Request</div>
            <div class="info-value">${formatDateTime(request.createdAt)}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Supplier</div>
            <div class="info-value">${escapeHtml(supplier?.name || '-')}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Status</div>
            <div class="info-value"><span class="${statusClass}">${statusText}</span></div>
          </div>
        </div>
        
        ${items.length > 0 ? `
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Produk</th>
                <th class="text-right">Qty</th>
                <th class="text-right">Harga</th>
                <th class="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item: any, i: number) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(item.productName)}</td>
                  <td class="text-right">${item.qty}</td>
                  <td class="text-right">${formatCurrency(item.price)}</td>
                  <td class="text-right">${formatCurrency(item.qty * item.price)}</td>
                </tr>
              `).join('')}
              <tr class="total-row">
                <td colspan="4" class="text-right">TOTAL</td>
                <td class="text-right">${formatCurrency(request.amount)}</td>
              </tr>
            </tbody>
          </table>
        ` : `
          <div class="info-box">
            <div class="info-label">Deskripsi</div>
            <div class="info-value">${escapeHtml(request.description || '-')}</div>
          </div>
          <div class="info-box">
            <div class="info-label">Jumlah</div>
            <div class="info-value" style="font-size: 20px;">${formatCurrency(request.amount)}</div>
          </div>
        `}
        
        ${request.notes ? `<p><strong>Catatan:</strong> ${escapeHtml(request.notes)}</p>` : ''}
        
        <div class="footer">
          <p>Dokumen ini dicetak secara otomatis dari sistem Razkindo ERP</p>
          <p>Tanggal cetak: ${formatDateTime(new Date())}</p>
        </div>
        
        <div class="actions">
          <button class="btn btn-primary" onclick="handleShare()">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
          </button>
          <button class="btn btn-secondary" onclick="window.print()">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print
          </button>
        </div>
        
        <script>
          async function handleShare() {
            const shareData = {
              title: 'Request Pembelian - ${request.id.slice(0, 8).toUpperCase()}',
              text: 'Request ${escapeHtml(request.id.slice(0, 8).toUpperCase())} - ${escapeHtml(supplier?.name || 'Supplier')} - Total: ${formatCurrency(request.amount)}',
              url: window.location.href
            };
            
            if (navigator.share) {
              try {
                await navigator.share(shareData);
              } catch (err) {
                console.log('Share cancelled');
              }
            } else {
              try {
                await navigator.clipboard.writeText(shareData.text);
                alert('Info disalin ke clipboard!');
              } catch (err) {
                const textArea = document.createElement('textarea');
                textArea.value = shareData.text;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                alert('Info disalin ke clipboard!');
              }
            }
          }
        </script>
      </body>
      </html>
    `;
    
    printWindow.document.write(html);
    printWindow.document.close();
  };
  
  // Share Request directly
  const shareRequest = async (request: FinanceRequest) => {
    const supplier = request.supplier;
    const shareText = `Request ${request.id.slice(0, 8).toUpperCase()}\nSupplier: ${supplier?.name || '-'}\nJumlah: ${formatCurrency(request.amount)}\nStatus: ${request.status}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Request Pembelian - ${request.id.slice(0, 8).toUpperCase()}`,
          text: shareText,
        });
        toast.success('Request berhasil dibagikan');
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          await copyToClipboard(shareText);
        }
      }
    } else {
      await copyToClipboard(shareText);
    }
  };
  
  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Supplier</p>
                <p className="text-sm sm:text-xl font-bold truncate">{totalSuppliers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
                <ShoppingCart className="w-5 h-5 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Total Pembelian</p>
                <p className="text-sm sm:text-xl font-bold truncate">{formatCurrency(totalPurchase)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
                <Wallet className="w-5 h-5 text-red-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Hutang</p>
                <p className="text-sm sm:text-xl font-bold text-red-600 truncate">{formatCurrency(totalUnpaid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className={pendingPurchaseRequests.length > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950" : ""}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900 rounded-lg">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Pending Finance</p>
                <p className="text-sm sm:text-xl font-bold text-amber-600 truncate">{pendingPurchaseRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="overflow-x-auto flex scrollbar-hide">
          <TabsTrigger value="suppliers" className="shrink-0 whitespace-nowrap text-xs sm:text-sm">Daftar Supplier</TabsTrigger>
          <TabsTrigger value="purchases" className="shrink-0 whitespace-nowrap text-xs sm:text-sm">PO Disetujui</TabsTrigger>
          <TabsTrigger value="requests" className="shrink-0 whitespace-nowrap text-xs sm:text-sm relative">
            Request ke Finance
            {pendingPurchaseRequests.length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                {pendingPurchaseRequests.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="suppliers" className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Cari supplier..."
                className="pl-9"
              />
            </div>
            <Dialog open={showCreateSupplier} onOpenChange={setShowCreateSupplier}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Supplier Baru
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Tambah Supplier</DialogTitle>
                </DialogHeader>
                <SupplierForm
                  onSuccess={() => {
                    setShowCreateSupplier(false);
                    queryClient.invalidateQueries({ queryKey: ['suppliers'] });
                  }}
                />
              </DialogContent>
            </Dialog>

            {/* Edit Supplier Dialog */}
            <Dialog open={showEditSupplier} onOpenChange={setShowEditSupplier}>
              <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Supplier</DialogTitle>
                </DialogHeader>
                {selectedSupplier && (
                  <SupplierForm
                    supplier={selectedSupplier}
                    onSuccess={() => {
                      setShowEditSupplier(false);
                      setSelectedSupplier(null);
                      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
                    }}
                  />
                )}
              </DialogContent>
            </Dialog>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {suppliers.map((s: Supplier) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0">
                      <h3 className="font-medium truncate">{s.name}</h3>
                      {s.phone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="w-3 h-3" />{s.phone}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => { setSelectedSupplier(s); setShowEditSupplier(true); }}>
                            <Edit className="w-4 h-4 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-red-600"
                            onClick={() => {
                              if (confirm(`Hapus supplier "${s.name}"?`)) {
                                deleteSupplierMutation.mutate(s.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Hapus
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  
                  {s.bankName && (
                    <div className="text-sm mb-2 min-w-0 truncate">
                      <span className="text-muted-foreground">Bank: </span>
                      <span>{s.bankName} {s.bankAccount}</span>
                    </div>
                  )}
                  
                  <Separator className="my-3" />
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Transaksi:</span>
                    <span className="font-medium">{formatCurrency(s.totalPurchase || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Sisa Hutang:</span>
                    <span className="font-medium text-red-600">{formatCurrency((s.totalPurchase || 0) - (s.totalPaid || 0))}</span>
                  </div>
                  
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="w-full mt-3"
                    onClick={() => {
                      setSelectedSupplier(s);
                      setShowPurchase(true);
                    }}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Buat Permintaan Pembelian
                  </Button>
                </CardContent>
              </Card>
            ))}
            {suppliers.length === 0 && (
              <div className="col-span-full text-center py-8 text-muted-foreground">
                Belum ada supplier
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="purchases" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Purchase Order yang Sudah Disetujui Finance</CardTitle>
              <CardDescription>Daftar PO yang sudah diproses oleh Finance</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-0">
              {/* Mobile Card Layout */}
              <div className="block md:hidden space-y-2">
                {purchases.map((t: Transaction) => (
                  <div key={t.id} className="p-3 border rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm min-w-0 truncate font-mono">{t.invoiceNo}</span>
                      <Badge className={cn(
                        "shrink-0",
                        getPaymentStatusColor(t.paymentStatus)
                      )}>
                        {getPaymentStatusLabel(t.paymentStatus)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(t.transactionDate)} · {t.supplier?.name || '-'}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{formatCurrency(t.total)}</span>
                      <div className="flex gap-1">
                        <Button variant="outline" size="sm" onClick={() => sharePO(t)}>
                          <Share2 className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => generatePOPDF(t)}>
                          <Printer className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {purchases.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Belum ada PO yang disetujui Finance
                  </div>
                )}
              </div>
              {/* Desktop Table Layout */}
              <ScrollArea className="hidden md:block max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. PO</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((t: Transaction) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-sm">{t.invoiceNo}</TableCell>
                        <TableCell>{formatDate(t.transactionDate)}</TableCell>
                        <TableCell>{t.supplier?.name || '-'}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(t.total)}</TableCell>
                        <TableCell>
                          <Badge className={cn(
                            getPaymentStatusColor(t.paymentStatus)
                          )}>
                            {getPaymentStatusLabel(t.paymentStatus)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => sharePO(t)}
                            >
                              <Share2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => generatePOPDF(t)}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {purchases.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          Belum ada PO yang disetujui Finance
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="requests" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Request Pembelian ke Finance</CardTitle>
              <CardDescription>Daftar permintaan pembelian yang dikirim ke Finance untuk diproses</CardDescription>
            </CardHeader>
            <CardContent className="p-4 md:p-0">
              {/* Mobile Card Layout */}
              <div className="block md:hidden space-y-2">
                {financeRequests
                  .filter((r: FinanceRequest) => r.type === 'purchase')
                  .map((r: FinanceRequest) => (
                  <div key={r.id} className="p-3 border rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm min-w-0 truncate font-mono">{r.id.slice(0, 8).toUpperCase()}</span>
                      <Badge className={cn(
                        "shrink-0",
                        r.status === 'pending' && "bg-amber-500",
                        r.status === 'approved' && "bg-blue-500",
                        r.status === 'processed' && "bg-green-500",
                        r.status === 'rejected' && "bg-red-500"
                      )}>
                        {r.status === 'pending' ? 'Menunggu' :
                         r.status === 'approved' ? 'Disetujui' :
                         r.status === 'processed' ? 'Diproses' : 'Ditolak'}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {r.supplier?.name || '-'}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{formatCurrency(r.amount)}</span>
                        <Badge variant="outline" className={cn(
                          "text-[10px] px-1.5 py-0",
                          r.goodsStatus === 'pending' && "border-amber-500 text-amber-600",
                          r.goodsStatus === 'received' && "border-green-500 text-green-600 bg-green-50",
                          r.goodsStatus === 'partial' && "border-blue-500 text-blue-600"
                        )}>
                          {r.goodsStatus === 'pending' ? 'Barang: Belum' :
                           r.goodsStatus === 'received' ? 'Barang: Diterima' : 'Barang: Sebagian'}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatDateTime(r.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      {(r.status === 'approved' || r.status === 'processed') && r.goodsStatus !== 'received' && (
                        <Button 
                          variant="default" 
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => {
                            setSelectedRequest(r);
                            setShowGoodsStatusDialog(true);
                          }}
                        >
                          <Package className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => shareRequest(r)}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => generateRequestPDF(r, r.supplier)}
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                {financeRequests.filter((r: FinanceRequest) => r.type === 'purchase').length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Belum ada request pembelian
                  </div>
                )}
              </div>
              {/* Desktop Table Layout */}
              <ScrollArea className="hidden md:block max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>No. Request</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Jumlah</TableHead>
                      <TableHead>Status Request</TableHead>
                      <TableHead>Status Barang</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead className="text-center">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {financeRequests
                      .filter((r: FinanceRequest) => r.type === 'purchase')
                      .map((r: FinanceRequest) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-sm">{r.id.slice(0, 8).toUpperCase()}</TableCell>
                        <TableCell>{r.supplier?.name || '-'}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.amount)}</TableCell>
                        <TableCell>
                          <Badge className={cn(
                            r.status === 'pending' && "bg-amber-500",
                            r.status === 'approved' && "bg-blue-500",
                            r.status === 'processed' && "bg-green-500",
                            r.status === 'rejected' && "bg-red-500"
                          )}>
                            {r.status === 'pending' ? 'Menunggu' :
                             r.status === 'approved' ? 'Disetujui' :
                             r.status === 'processed' ? 'Diproses' : 'Ditolak'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(
                            r.goodsStatus === 'pending' && "border-amber-500 text-amber-600",
                            r.goodsStatus === 'received' && "border-green-500 text-green-600 bg-green-50",
                            r.goodsStatus === 'partial' && "border-blue-500 text-blue-600"
                          )}>
                            {r.goodsStatus === 'pending' ? 'Belum Diterima' :
                             r.goodsStatus === 'received' ? 'Diterima' : 'Sebagian'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{formatDateTime(r.createdAt)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {(r.status === 'approved' || r.status === 'processed') && r.goodsStatus !== 'received' && (
                              <Button 
                                variant="default" 
                                size="sm"
                                onClick={() => {
                                  setSelectedRequest(r);
                                  setShowGoodsStatusDialog(true);
                                }}
                              >
                                <Package className="w-4 h-4" />
                              </Button>
                            )}
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => shareRequest(r)}
                            >
                              <Share2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => generateRequestPDF(r, r.supplier)}
                            >
                              <Printer className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {financeRequests.filter((r: FinanceRequest) => r.type === 'purchase').length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          Belum ada request pembelian
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      {/* Purchase Dialog */}
      <Dialog open={showPurchase} onOpenChange={setShowPurchase}>
        <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permintaan Pembelian ke Finance</DialogTitle>
            <DialogDescription>
              Buat permintaan pembelian yang akan dikirim ke Finance untuk diproses
            </DialogDescription>
          </DialogHeader>
          <PurchaseRequestForm
            suppliers={suppliers}
            products={products}
            units={units}
            userId={user?.id || ''}
            unitId={selectedUnitId || user?.unitId || undefined}
            initialSupplierId={selectedSupplier?.id}
            onSuccess={() => {
              setShowPurchase(false);
              setSelectedSupplier(null);
              queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
            }}
          />
        </DialogContent>
      </Dialog>
      
      {/* Goods Status Dialog */}
      <Dialog open={showGoodsStatusDialog} onOpenChange={setShowGoodsStatusDialog}>
        <DialogContent className="sm:max-w-lg w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Update Status Barang</DialogTitle>
            <DialogDescription>
              Update status penerimaan barang dari supplier
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <GoodsStatusForm
              request={selectedRequest}
              onUpdate={(data) => updateGoodsStatusMutation.mutate(data)}
              isLoading={updateGoodsStatusMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

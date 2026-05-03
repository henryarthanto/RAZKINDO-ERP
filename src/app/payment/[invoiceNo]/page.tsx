'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { use } from 'react';
import {
  Camera,
  Upload,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Truck,
  User,
  Phone,
  MapPin,
  Calendar,
  Clock,
  CreditCard,
  Image as ImageIcon,
  ChevronDown,
  Package,
} from 'lucide-react';

/* ─── Types ─── */
interface TransactionItem {
  id: string;
  productName: string;
  qty: number;
  price: number;
  subtotal: number;
}

interface Transaction {
  id: string;
  invoiceNo: string;
  transactionDate: string;
  type: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate: string | null;
  notes: string | null;
  deliveryAddress: string | null;
  customer: { id: string; name: string; phone: string | null; address: string | null } | null;
  createdBy: { name: string } | null;
  unit: { name: string } | null;
  items: TransactionItem[];
}

interface PaymentProof {
  id: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  customerName: string | null;
  notes: string | null;
  uploadedAt: string;
}

/* ─── Helpers ─── */
const isImageFile = (url: string) => !url.endsWith('.pdf');
const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const isOverdue = (dueDate: string | null, paymentStatus: string) => {
  if (!dueDate || paymentStatus === 'paid') return false;
  return new Date(dueDate) < new Date();
};

/* ─── Component ─── */
export default function PaymentPage({
  params,
}: {
  params: Promise<{ invoiceNo: string }>;
}) {
  const { invoiceNo } = use(params);

  // Data states
  const [settings, setSettings] = useState<{
    company_name: string;
    company_logo: string;
  }>({ company_name: 'Razkindo ERP', company_logo: '' });
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [proofs, setProofs] = useState<PaymentProof[]>([]);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  // UI states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(false);

  // Upload states
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageModal, setImageModal] = useState<string | null>(null);

  // Fetch settings
  useEffect(() => {
    fetch('/api/settings?public=true')
      .then((r) => r.json())
      .then((d) => setSettings(d.settings || {}))
      .catch(() => {});
  }, []);

  // Fetch transaction data
  useEffect(() => {
    setLoading(true);
    setError('');
    fetch(`/api/payment/${invoiceNo}`)
      .then(async (r) => {
        if (r.status === 404 || r.status === 400) {
          const d = await r.json();
          throw new Error(d.error || 'Transaksi tidak ditemukan');
        }
        if (!r.ok) throw new Error('Gagal memuat data');
        return r.json();
      })
      .then((d) => {
        setTransaction(d.transaction);
        setProofs(d.proofs || []);
        setAlreadyPaid(d.alreadyPaid || false);
        if (d.transaction?.customer?.name) {
          setCustomerName(d.transaction.customer.name);
        }
      })
      .catch((err) => {
        if (err.message === 'Transaksi sudah dibatalkan') {
          setCancelled(true);
        }
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [invoiceNo]);

  // Handle file selection — accepts any file type (same as PWA)
  // Videos max 50MB, images max 20MB, other files max 15MB
  const handleFile = useCallback((file: File) => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (isVideo && file.size > 50 * 1024 * 1024) {
      setUploadError('Ukuran video maksimal 50MB');
      return;
    }
    if (isImage && file.size > 20 * 1024 * 1024) {
      setUploadError('Ukuran gambar maksimal 20MB (akan dikompres otomatis)');
      return;
    }
    if (!isVideo && !isImage && file.size > 15 * 1024 * 1024) {
      setUploadError('Ukuran file maksimal 15MB');
      return;
    }

    setUploadFile(file);
    setUploadError('');
    setUploadSuccess(false);

    // Preview for images and videos
    if (isImage || isVideo) {
      const reader = new FileReader();
      reader.onload = (e) => setUploadPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setUploadPreview(null);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const clearUpload = useCallback(() => {
    setUploadFile(null);
    setUploadPreview(null);
    setUploadError('');
    setUploadSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Handle upload
  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (customerName.trim()) formData.append('customerName', customerName.trim());

    try {
      const res = await fetch(`/api/payment/${invoiceNo}/proof`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal mengunggah');

      setProofs((prev) => [
        {
          id: data.proof.id,
          fileUrl: data.proof.fileUrl,
          fileName: data.proof.fileName,
          fileSize: data.proof.fileSize,
          customerName: customerName.trim() || null,
          notes: null,
          uploadedAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setUploadSuccess(true);
      clearUpload();
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }, [uploadFile, customerName, invoiceNo, clearUpload]);

  // ─── Render: Loading ───
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-emerald-600 animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Memuat data transaksi...</p>
        </div>
      </div>
    );
  }

  // ─── Render: Error (not cancelled) ───
  if (error && !cancelled && !transaction) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Transaksi Tidak Ditemukan</h2>
          <p className="text-sm text-gray-500 mb-1">{error}</p>
          <p className="text-xs text-gray-400 mt-3">
            Pastikan nomor invoice sudah benar. Hubungi admin jika masalah berlanjut.
          </p>
        </div>
      </div>
    );
  }

  const t = transaction;
  if (!t) return null;

  const overdue = isOverdue(t.dueDate, t.paymentStatus);
  const showUpload = !alreadyPaid && t.remainingAmount > 0 && t.paymentStatus !== 'paid';

  // ─── Status badge ───
  const StatusBadge = ({ status }: { status: string }) => {
    const config: Record<string, { label: string; className: string }> = {
      paid: { label: 'LUNAS', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
      pending: { label: 'BELUM BAYAR', className: 'bg-amber-100 text-amber-700 border-amber-200' },
      partial: { label: 'SEBAGIAN', className: 'bg-blue-100 text-blue-700 border-blue-200' },
      cancelled: { label: 'DIBATALKAN', className: 'bg-red-100 text-red-700 border-red-200' },
    };
    const c = config[status] || config.pending;
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${c.className}`}>
        {c.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ─── Header ─── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {settings.company_logo ? (
            <img
              src={settings.company_logo}
              alt={settings.company_name || 'Company'}
              className="w-10 h-10 rounded-xl object-contain"
            />
          ) : (
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-gray-900 truncate">
              {settings.company_name || 'Razkindo ERP'}
            </h1>
            <p className="text-xs text-gray-500">Halaman Pembayaran</p>
          </div>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-4">
        {/* Cancelled banner */}
        {cancelled && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
            <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <X className="w-7 h-7 text-red-500" />
            </div>
            <h2 className="text-lg font-bold text-red-700">DIBATALKAN</h2>
            <p className="text-sm text-red-600 mt-1">{error || 'Transaksi ini telah dibatalkan'}</p>
          </div>
        )}

        {/* Already paid banner */}
        {alreadyPaid && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>
            <h2 className="text-lg font-bold text-emerald-700">LUNAS</h2>
            <p className="text-sm text-emerald-600 mt-1">Pembayaran untuk invoice ini sudah lengkap. Terima kasih!</p>
          </div>
        )}

        {/* Invoice Card */}
        {!cancelled && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Invoice header */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-gray-400" />
                    <h2 className="text-base font-bold text-gray-900">{t.invoiceNo}</h2>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDate(t.transactionDate)}</span>
                  </div>
                </div>
                <StatusBadge status={t.paymentStatus} />
              </div>
              {t.unit && (
                <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                  <Package className="w-3 h-3" />
                  Unit: {t.unit.name}
                </p>
              )}
            </div>

            {/* Customer info */}
            <div className="px-4 py-3 border-b border-gray-50 space-y-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Informasi Pelanggan</h3>
              {t.customer ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="font-medium text-gray-900">{t.customer.name}</span>
                  </div>
                  {t.customer.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span>{t.customer.phone}</span>
                    </div>
                  )}
                  {t.customer.address && (
                    <div className="flex items-start gap-2 text-sm text-gray-600">
                      <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                      <span>{t.customer.address}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Walk-in (tanpa pelanggan)</p>
              )}
            </div>

            {/* Payment method & due date */}
            <div className="px-4 py-3 border-b border-gray-50 flex flex-wrap gap-x-6 gap-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="w-4 h-4 text-gray-400" />
                <span className="text-gray-500">Metode:</span>
                <span className="font-medium text-gray-900 capitalize">
                  {t.paymentMethod === 'cash'
                    ? 'Tunai'
                    : t.paymentMethod === 'transfer'
                      ? 'Transfer'
                      : t.paymentMethod === 'giro'
                        ? 'Giro'
                        : t.paymentMethod || 'Tunai'}
                </span>
              </div>
              {t.dueDate && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className={`w-4 h-4 ${overdue ? 'text-red-500' : 'text-gray-400'}`} />
                  <span className="text-gray-500">Jatuh Tempo:</span>
                  <span className={`font-medium ${overdue ? 'text-red-600' : 'text-gray-900'}`}>
                    {formatDate(t.dueDate)}
                    {overdue && ' (Terlambat)'}
                  </span>
                </div>
              )}
            </div>

            {/* Order items table */}
            <div className="px-4 py-3 border-b border-gray-50">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Daftar Produk
              </h3>
              <div className="rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/70">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Produk</th>
                      <th className="text-center py-2 px-2 text-xs font-semibold text-gray-500">Qty</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Harga</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {t.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2.5 px-3 font-medium text-gray-900 max-w-[120px] truncate">
                          {item.productName}
                        </td>
                        <td className="py-2.5 px-2 text-center text-gray-600">{item.qty}</td>
                        <td className="py-2.5 px-3 text-right text-gray-600 text-xs whitespace-nowrap">
                          {formatCurrency(item.price)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-medium text-gray-900 text-xs whitespace-nowrap">
                          {formatCurrency(item.subtotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary */}
            <div className="px-4 py-4 space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Total</span>
                <span className="font-bold text-gray-900 text-base">{formatCurrency(t.total)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Terbayar</span>
                <span className="font-medium text-emerald-600">{formatCurrency(t.paidAmount)}</span>
              </div>
              {t.remainingAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Sisa</span>
                  <span className="font-bold text-red-600 text-base">{formatCurrency(t.remainingAmount)}</span>
                </div>
              )}
            </div>

            {/* Delivery address */}
            {t.deliveryAddress && (
              <div className="px-4 py-3 border-t border-gray-50">
                <div className="flex items-start gap-2 text-sm text-gray-600">
                  <Truck className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-gray-700">Alamat Pengiriman:</span>
                    <span className="ml-1">{t.deliveryAddress}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {t.notes && (
              <div className="px-4 py-3 border-t border-gray-50">
                <p className="text-xs text-gray-400 italic">Catatan: {t.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Overdue warning */}
        {!cancelled && overdue && !alreadyPaid && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-700">Pembayaran Terlambat!</p>
              <p className="text-xs text-red-600 mt-0.5">
                Jatuh tempo telah lewat ({formatDate(t.dueDate!)}). Segera lakukan pembayaran.
              </p>
            </div>
          </div>
        )}

        {/* Upload Section */}
        {showUpload && !cancelled && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-600" />
                Upload Bukti Pembayaran
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Kirim bukti transfer untuk mempercepat proses verifikasi
              </p>
            </div>

            <div className="px-4 pb-4 space-y-3">
              {/* Success message */}
              {uploadSuccess && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                  <p className="text-sm text-emerald-700 font-medium">Bukti berhasil dikirim!</p>
                </div>
              )}

              {/* Error message */}
              {uploadError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700">{uploadError}</p>
                </div>
              )}

              {/* Preview */}
              {uploadFile && uploadPreview ? (
                <div className="relative rounded-xl border border-gray-200 overflow-hidden">
                  {uploadFile?.type?.startsWith('video/') ? (
                    <video
                      src={uploadPreview}
                      controls
                      className="w-full max-h-60 object-contain bg-gray-50"
                    />
                  ) : (
                    <img
                      src={uploadPreview}
                      alt="Preview"
                      className="w-full max-h-60 object-contain bg-gray-50"
                    />
                  )}
                  <button
                    type="button"
                    onClick={clearUpload}
                    className="absolute top-2 right-2 w-8 h-8 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-sm border border-gray-200 hover:bg-red-50 transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-600" />
                  </button>
                  <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
                    <p className="text-xs text-gray-600 truncate">{uploadFile?.name}</p>
                    <p className="text-xs text-gray-400">{uploadFile ? formatFileSize(uploadFile.size) : ''}</p>
                  </div>
                </div>
              ) : uploadFile ? (
                // Non-previewable file (PDF, document, etc.) — show file info card
                <div className="relative rounded-xl border border-gray-200 overflow-hidden bg-emerald-50/50">
                  <div className="flex items-center gap-3 p-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{uploadFile.name}</p>
                      <p className="text-xs text-gray-400">{formatFileSize(uploadFile.size)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={clearUpload}
                      className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Drop zone */
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-gray-200 bg-gray-50/50 hover:border-emerald-300 hover:bg-emerald-50/30'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="*/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />
                  <div
                    className={`w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center transition-colors ${
                      isDragging ? 'bg-emerald-100' : 'bg-gray-100'
                    }`}
                  >
                    {isDragging ? (
                      <Upload className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <Camera className="w-6 h-6 text-gray-400" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-700">
                    {isDragging ? 'Lepaskan file di sini' : 'Tap untuk foto atau upload'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Gambar, Video, PDF, atau file lainnya &middot; Maks 15MB
                  </p>
                </div>
              )}

              {/* Customer name */}
              <div>
                <label
                  htmlFor="customerName"
                  className="block text-xs font-medium text-gray-500 mb-1"
                >
                  Nama Anda (opsional)
                </label>
                <input
                  id="customerName"
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nama pengirim"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-colors"
                />
              </div>

              {/* Upload button */}
              <button
                type="button"
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-[0.98] shadow-sm"
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Mengirim...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4" />
                    Kirim Bukti Pembayaran
                  </span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Existing proofs */}
        {!cancelled && proofs.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 pt-4 pb-2">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-blue-500" />
                Bukti Pembayaran
                <span className="ml-auto text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {proofs.length}
                </span>
              </h3>
            </div>
            <div className="px-4 pb-4 grid grid-cols-3 gap-2">
              {proofs.map((proof) => {
                const img = isImageFile(proof.fileUrl);
                return (
                  <button
                    key={proof.id}
                    type="button"
                    onClick={() => setImageModal(proof.fileUrl)}
                    className={`relative rounded-xl overflow-hidden border border-gray-100 group focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${img ? 'aspect-square' : 'aspect-[3/4] p-3 bg-gray-50 flex flex-col items-center justify-center gap-1.5'}`}
                  >
                    {img ? (
                      <>
                        <img
                          src={proof.fileUrl}
                          alt={proof.fileName || 'Bukti bayar'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                      </>
                    ) : (
                      <>
                        <FileText className="w-7 h-7 text-red-500" />
                        <span className="text-[10px] font-semibold text-red-600 uppercase">PDF</span>
                        <span className="text-[9px] text-gray-400 truncate max-w-full">{proof.fileName || 'dokumen'}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Spacer for footer */}
        <div className="h-16" />
      </main>

      {/* ─── Footer ─── */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-lg border-t border-gray-100 z-20">
        <div className="max-w-lg mx-auto px-4 py-3 text-center">
          <p className="text-xs text-gray-400">
            Powered by <span className="font-semibold text-gray-500">Razkindo ERP</span>
          </p>
        </div>
      </footer>

      {/* ─── Image Modal ─── */}
      {imageModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setImageModal(null)}
        >
          <div
            className="relative max-w-full max-h-[90dvh] animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setImageModal(null)}
              className="absolute -top-10 right-0 w-8 h-8 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-white hover:bg-white/40 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            {imageModal.endsWith('.pdf') ? (
              <iframe
                src={imageModal}
                className="w-[85vw] max-w-lg h-[80dvh] rounded-lg border-0 bg-white"
                title="Bukti Pembayaran"
              />
            ) : (
              <img
                src={imageModal}
                alt="Bukti bayar"
                className="max-w-full max-h-[85dvh] object-contain rounded-lg"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

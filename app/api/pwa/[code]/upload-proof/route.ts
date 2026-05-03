import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '@/lib/supabase';
import { toCamelCase, generateId, createEvent } from '@/lib/supabase-helpers';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { getUploadDir } from '@/lib/paths';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB raw (before compression)
const MAX_RAW_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB for raw images (will be compressed)
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/avif']);
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/avif']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/3gp', 'video/quicktime', 'video/webm']);
const MAX_RAW_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB for videos (user sees "too large" earlier)

/**
 * Compress image using sharp.
 * Converts to WebP for best compression ratio while keeping preview quality clear.
 * Max dimension: 1600px, quality: 80 (good balance of size vs clarity).
 */
async function compressImage(inputBuffer: Buffer, originalName: string): Promise<{ buffer: Buffer; ext: string }> {
  try {
    let pipeline = sharp(inputBuffer);
    const metadata = await pipeline.metadata();
    const width = metadata.width || 1600;
    const height = metadata.height || 1600;

    // Resize if larger than 1600px on longest side
    const maxDim = 1600;
    if (width > maxDim || height > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
    }

    // Convert to WebP for best compression (unless animated GIF)
    if (metadata.format !== 'gif' || !metadata.pages || metadata.pages <= 1) {
      const output = await pipeline
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      return { buffer: output, ext: 'webp' };
    }

    // Animated GIF — keep format, compress
    const output = await pipeline.gif({ effort: 2 }).toBuffer();
    return { buffer: output, ext: 'gif' };
  } catch (err) {
    console.error('[PWA Proof] Image compression failed, saving original:', err);
    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    return { buffer: inputBuffer, ext };
  }
}

/**
 * Get file extension from MIME type or filename
 */
function getFileExtension(file: File): string {
  // Try from filename first
  const nameExt = file.name.split('.').pop()?.toLowerCase() || '';
  if (nameExt && nameExt.length <= 5) return nameExt;
  // Fallback to MIME-based mapping
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
    'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4', 'video/3gp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'text/plain': 'txt', 'text/csv': 'csv',
  };
  return mimeMap[file.type] || 'bin';
}

// =====================================================================
// PWA Upload Payment Proof — Public (no auth, identified by customer code)
// POST /api/pwa/[code]/upload-proof — Upload payment proof for a transaction
// - Accepts ANY file type
// - Images are auto-compressed (WebP, 1600px, quality 80)
// - Videos max 50MB, other files max 15MB
// - Auto-cleanup of proofs older than 3 months
// =====================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code) {
      return NextResponse.json({ error: 'Kode pelanggan diperlukan' }, { status: 400 });
    }

    // Verify customer (only active)
    const { data: customer } = await db
      .from('customers')
      .select('id, name')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (!customer) {
      return NextResponse.json({ error: 'Kode pelanggan tidak ditemukan' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const transactionId = (formData.get('transactionId') as string) || '';

    if (!file) {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 });
    }
    if (!transactionId) {
      return NextResponse.json({ error: 'ID transaksi diperlukan' }, { status: 400 });
    }

    // SECURITY: Validate file MIME type — only allow safe file types
    const ALLOWED_MIME_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
      'video/mp4', 'video/webm', 'video/quicktime',
      'application/pdf',
    ];
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Tipe file tidak diizinkan. Hanya gambar, video, dan PDF yang diterima.' }, { status: 400 });
    }

    // Validate file size based on type
    const isImage = IMAGE_TYPES.has(file.type);
    const isVideo = VIDEO_TYPES.has(file.type);

    if (isVideo && file.size > MAX_RAW_VIDEO_SIZE) {
      return NextResponse.json({ error: 'Ukuran video maksimal 50MB' }, { status: 400 });
    }
    if (isImage && file.size > MAX_RAW_IMAGE_SIZE) {
      return NextResponse.json({ error: 'Ukuran gambar maksimal 20MB (akan dikompres otomatis)' }, { status: 400 });
    }
    if (!isImage && !isVideo && file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Ukuran file maksimal 15MB' }, { status: 400 });
    }

    // Verify transaction belongs to this customer
    const { data: transaction } = await db
      .from('transactions')
      .select('id, invoice_no, customer_id, status, total')
      .eq('id', transactionId)
      .eq('customer_id', customer.id)
      .single();

    if (!transaction) {
      return NextResponse.json({ error: 'Transaksi tidak ditemukan' }, { status: 404 });
    }
    if (transaction.status === 'cancelled') {
      return NextResponse.json({ error: 'Transaksi sudah dibatalkan' }, { status: 400 });
    }
    if (transaction.status === 'pending') {
      return NextResponse.json({ error: 'Transaksi belum di-approve, tidak dapat upload bukti pembayaran' }, { status: 400 });
    }

    // Save file
    const uploadDir = getUploadDir('payment-proofs');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    let finalBuffer: Buffer;
    let finalExt: string;
    let fileType: string;

    if (isImage && COMPRESSIBLE_TYPES.has(file.type)) {
      // Compress images to WebP
      fileType = 'image';
      const compressed = await compressImage(rawBuffer, file.name);
      finalBuffer = compressed.buffer;
      finalExt = compressed.ext;
    } else {
      // Non-compressible files (video, PDF, documents, etc.) — save as-is
      fileType = isVideo ? 'video' : file.type.split('/').pop() || 'document';
      finalBuffer = rawBuffer;
      finalExt = getFileExtension(file);
    }

    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${finalExt}`;
    await writeFile(path.join(uploadDir, filename), finalBuffer);
    const fileUrl = `/uploads/payment-proofs/${filename}`;

    // Insert payment proof record
    const proofId = generateId();
    console.log('[PWA Proof] Inserting with id:', proofId, 'transaction_id:', transaction.id, 'invoice_no:', transaction.invoice_no);

    const { data: proof, error: insertError } = await db
      .from('payment_proofs')
      .insert({
        id: proofId,
        transaction_id: transaction.id,
        invoice_no: transaction.invoice_no,
        file_url: fileUrl,
        file_name: file.name,
        file_size: finalBuffer.length,
        file_type: fileType,
        customer_name: customer.name,
        notes: null,
        uploaded_at: new Date().toISOString(),
        viewed: false,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[PWA Proof] Insert error:', insertError.message, insertError.code, '| payload id:', proofId, '| table: payment_proofs');
      // Clean up orphaned file
      try {
        await unlink(path.join(uploadDir, filename));
      } catch { /* ignore */ }
      return NextResponse.json({ error: 'Gagal menyimpan bukti pembayaran', detail: `id=${proofId}, code=${insertError.code}` }, { status: 500 });
    }

    // Create event notification
    createEvent(db, 'payment_proof_uploaded', {
      transactionId: transaction.id,
      invoiceNo: transaction.invoice_no,
      customerName: customer.name,
      fileUrl,
    }).catch(() => {});

    // Send WhatsApp notification to sales/admin group
    try {
      const config = await getWhatsAppConfig();
      if (config.enabled && config.token && config.target_id) {
        const totalStr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.total || 0);
        const dateStr = new Date().toLocaleString('id-ID');
        const message = `🔔 *BUKTI PEMBAYARAN BARU*\n\n` +
          `📌 ${customer.name} mengirimkan bukti bayar\n` +
          `📋 Invoice: ${transaction.invoice_no}\n` +
          `💰 Total: ${totalStr}\n` +
          `📅 ${dateStr}\n\n` +
          `Segera cek di sistem ERP.`;

        const result = await sendMessage(config.token, config.target_id, message);
        if (!result.success && result.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    } catch (waErr) {
      console.error('[PWA Proof] WhatsApp notification error (non-blocking):', waErr);
    }

    // Fire-and-forget: cleanup proofs older than 3 months
    cleanupOldProofs().catch(() => {});

    return NextResponse.json({
      success: true,
      proof: {
        id: proof.id,
        fileUrl: proof.file_url,
        fileName: proof.file_name,
        fileSize: proof.file_size,
        fileType: proof.file_type,
        uploadedAt: proof.uploaded_at,
      },
    });
  } catch (error) {
    console.error('PWA upload proof error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// =====================================================================
// AUTO-CLEANUP: Delete proofs + files older than 3 months
// =====================================================================
let _lastProofCleanup = 0;
const PROOF_CLEANUP_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes
const PROOF_RETENTION_DAYS = 90; // 3 months

async function cleanupOldProofs(): Promise<{ deletedRecords: number; deletedFiles: number }> {
  const now = Date.now();
  if (now - _lastProofCleanup < PROOF_CLEANUP_INTERVAL) {
    return { deletedRecords: 0, deletedFiles: 0 };
  }
  _lastProofCleanup = now;

  try {
    const cutoff = new Date(now - PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const uploadDir = getUploadDir('payment-proofs');

    // Fetch old proofs
    const { data: oldProofs, error: fetchError } = await db
      .from('payment_proofs')
      .select('id, file_url')
      .lt('uploaded_at', cutoff);

    if (fetchError || !oldProofs || oldProofs.length === 0) {
      return { deletedRecords: 0, deletedFiles: 0 };
    }

    let deletedFiles = 0;
    const proofIds = oldProofs.map(p => p.id);

    // Delete physical files
    for (const proof of oldProofs) {
      try {
        const filePath = getUploadDir(proof.file_url.replace(/^\/uploads\//, ''));
        if (existsSync(filePath)) {
          await unlink(filePath);
          deletedFiles++;
        }
      } catch {
        // File might already be deleted
      }
    }

    // Delete database records
    const { error: deleteError } = await db
      .from('payment_proofs')
      .delete({ count: 'exact' })
      .in('id', proofIds);

    const deletedRecords = oldProofs.length;
    if (deletedRecords > 0) {
      console.log(`[PWA Proof] Cleaned up ${deletedRecords} records (${deletedFiles} files) older than 3 months`);
    }

    return { deletedRecords, deletedFiles };
  } catch (err) {
    console.error('[PWA Proof] Cleanup failed:', err instanceof Error ? err.message : err);
    return { deletedRecords: 0, deletedFiles: 0 };
  }
}

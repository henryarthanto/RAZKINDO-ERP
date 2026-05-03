import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '@/lib/supabase';
import { toCamelCase, generateId, createEvent } from '@/lib/supabase-helpers';
import { formatCurrency } from '@/lib/erp-helpers';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { wsEmit } from '@/lib/ws-dispatch';
import { getUploadDir } from '@/lib/paths';
import { paymentProofLimiter } from '@/lib/rate-limiter';

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB raw for non-images
const MAX_RAW_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB for images (will be compressed)
const MAX_RAW_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB for videos
const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif', 'image/avif',
]);
const COMPRESSIBLE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff',
  'image/heic', 'image/heif', 'image/avif',
]);
const VIDEO_TYPES = new Set(['video/mp4', 'video/3gp', 'video/quicktime', 'video/webm']);

/**
 * Compress an image buffer using sharp.
 * Converts to WebP for max compression while keeping preview clear.
 * Max dimension: 1600px, quality: 80.
 */
async function compressImage(inputBuffer: Buffer, originalName: string): Promise<{ buffer: Buffer; ext: string }> {
  try {
    let pipeline = sharp(inputBuffer);

    // Get image metadata
    const metadata = await pipeline.metadata();
    const width = metadata.width || 1600;
    const height = metadata.height || 1600;

    // Resize if larger than 1600px on longest side
    const maxDim = 1600;
    if (width > maxDim || height > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
    }

    // Convert to WebP for best compression (unless it's GIF with animation)
    if (metadata.format !== 'gif' || !metadata.pages || metadata.pages <= 1) {
      const output = await pipeline
        .webp({ quality: 80, effort: 4 })
        .toBuffer();
      return { buffer: output, ext: 'webp' };
    }

    // Animated GIF — keep as-is but compress
    const output = await pipeline
      .gif({ effort: 2 })
      .toBuffer();
    return { buffer: output, ext: 'gif' };
  } catch (err) {
    console.error('[Payment Proof] Image compression failed, saving original:', err);
    const ext = originalName.split('.').pop()?.toLowerCase() || 'jpg';
    return { buffer: inputBuffer, ext };
  }
}

/**
 * Get file extension from MIME type or filename
 */
function getFileExtension(file: File): string {
  const nameExt = file.name.split('.').pop()?.toLowerCase() || '';
  if (nameExt && nameExt.length <= 5) return nameExt;
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
    'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4', 'video/3gp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  };
  return mimeMap[file.type] || 'bin';
}

/**
 * POST /api/payment/[invoiceNo]/proof
 * PUBLIC — No authentication required
 * Handles payment proof upload from customers (images + PDF).
 * Images are auto-compressed. Files older than 3 months are auto-deleted.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceNo: string }> }
) {
  try {
    const { invoiceNo } = await params;

    // FIX: Rate limiting — prevent brute-force proof uploads
    const clientIp = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const rateResult = paymentProofLimiter(clientIp);
    if (!rateResult.allowed) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, { status: 429 });
    }

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const customerName = (formData.get('customerName') as string) || '';

    // Validate file presence
    if (!file) {
      return NextResponse.json(
        { error: 'File tidak ditemukan' },
        { status: 400 }
      );
    }

    // Validate file size based on type
    const isImage = IMAGE_TYPES.has(file.type);
    const isVideo = VIDEO_TYPES.has(file.type);

    if (isVideo && file.size > MAX_RAW_VIDEO_SIZE) {
      return NextResponse.json(
        { error: 'Ukuran video maksimal 50MB' },
        { status: 400 }
      );
    }
    if (isImage && file.size > MAX_RAW_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Ukuran gambar maksimal 20MB (akan dikompres otomatis)' },
        { status: 400 }
      );
    }
    if (!isImage && !isVideo && file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'Ukuran file maksimal 15MB' },
        { status: 400 }
      );
    }

    // Look up transaction by invoice_no
    const { data: transaction } = await db
      .from('transactions')
      .select('*')
      .eq('invoice_no', invoiceNo)
      .single();

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    // BUG FIX #8: Reject payment proofs for cancelled transactions
    if (transaction.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Transaksi sudah dibatalkan, tidak dapat mengunggah bukti pembayaran' },
        { status: 400 }
      );
    }

    // Prepare upload directory
    const uploadDir = getUploadDir('payment-proofs');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer());
    let finalBuffer: Buffer;
    let finalExt: string;
    let fileType: string;
    const isImageType = IMAGE_TYPES.has(file.type);
    const isVideoType = VIDEO_TYPES.has(file.type);

    if (isImageType && COMPRESSIBLE_TYPES.has(file.type)) {
      // Compress images to WebP
      fileType = 'image';
      const compressed = await compressImage(rawBuffer, file.name);
      finalBuffer = compressed.buffer;
      finalExt = compressed.ext;
    } else {
      // Non-compressible files (video, PDF, documents, etc.) — save as-is
      fileType = isVideoType ? 'video' : file.type.split('/').pop() || 'document';
      finalBuffer = rawBuffer;
      finalExt = getFileExtension(file);
    }

    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${finalExt}`;
    await writeFile(path.join(uploadDir, filename), finalBuffer);

    const fileUrl = `/uploads/payment-proofs/${filename}`;

    // Generate ID and insert into payment_proofs table
    const proofId = generateId();
    console.log('[Payment Proof] Inserting with id:', proofId, 'invoice_no:', invoiceNo, 'transaction_id:', transaction.id);

    const { data: proof, error: insertError } = await db
      .from('payment_proofs')
      .insert({
        id: proofId,
        transaction_id: transaction.id,
        invoice_no: invoiceNo,
        file_url: fileUrl,
        file_name: file.name,
        file_size: finalBuffer.length,
        file_type: fileType,
        customer_name: customerName || null,
        notes: null,
        uploaded_at: new Date().toISOString(),
        viewed: false,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Payment Proof] Insert error:', insertError.message, insertError.code, '| payload id:', proofId, '| table: payment_proofs');
      // BUG FIX #9: Delete orphaned file on DB insert failure
      try {
        await unlink(path.join(uploadDir, filename));
        console.log('[Payment Proof] Cleaned up orphaned file:', filename);
      } catch (cleanupErr) {
        console.error('[Payment Proof] Failed to clean up orphaned file:', cleanupErr);
      }
      return NextResponse.json(
        { error: 'Gagal menyimpan bukti pembayaran', detail: `id=${proofId}, code=${insertError.code}` },
        { status: 500 }
      );
    }

    const proofCamel = toCamelCase(proof);

    // --- Fire-and-forget: WhatsApp notification ---
    (async () => {
      try {
        const config = await getWhatsAppConfig();
        if (config.enabled && config.token && config.target_id) {
          const message =
            `🔔 *BUKTI PEMBAYARAN BARU*\n\n` +
            `📌 ${customerName || 'Konsumen'} mengirimkan bukti bayar\n` +
            `📋 Invoice: ${invoiceNo}\n` +
            `💰 Total: ${formatCurrency(transaction.total || 0)}\n` +
            `📅 ${new Date().toLocaleString('id-ID')}\n\n` +
            `Segera cek di sistem ERP.`;

          const result = await sendMessage(config.token, config.target_id, message);
          if (!result.success && result.tokenInvalid) {
            await disableWhatsAppOnInvalidToken();
          }
        }
      } catch (err) {
        console.error('[Payment Proof] WhatsApp notification error:', err);
      }
    })();

    // --- Fire-and-forget: Create event ---
    createEvent(db, 'payment_proof_uploaded', {
      transactionId: transaction.id,
      invoiceNo,
      customerName: customerName || null,
      fileUrl,
    }).catch(() => {});

    // --- Fire-and-forget: WebSocket notification (specific event for proof refresh) ---
    wsEmit({ event: 'erp:payment_proof_update', data: { invoiceNo }, target: 'all' }).catch(() => {});

    return NextResponse.json({
      success: true,
      proof: {
        id: proofCamel.id,
        fileUrl: proofCamel.fileUrl,
        fileName: proofCamel.fileName,
        fileSize: proofCamel.fileSize,
        fileType: proofCamel.fileType,
        uploadedAt: proofCamel.uploadedAt,
      },
    });
  } catch (error) {
    console.error('Payment proof upload error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

// =====================================================================
// AUTO-CLEANUP: Delete proofs + files older than 3 months
// Called by the events cleanup mechanism and can be triggered manually
// =====================================================================
let _lastProofCleanup = 0;
const PROOF_CLEANUP_INTERVAL = 30 * 60 * 1000; // Check every 30 minutes
const PROOF_RETENTION_DAYS = 90; // 3 months

/**
 * Clean up payment proofs older than 3 months.
 * Deletes both the database records and the physical files.
 * This is called automatically by the proof-related API routes.
 */
export async function cleanupOldProofs(): Promise<{ deletedRecords: number; deletedFiles: number }> {
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
        // File might already be deleted — ignore
      }
    }

    // Delete database records
    const { error: deleteError } = await db
      .from('payment_proofs')
      .delete({ count: 'exact' })
      .in('id', proofIds);

    const deletedRecords = oldProofs.length;
    if (deletedRecords > 0) {
      console.log(`[Payment Proofs] Cleaned up ${deletedRecords} records (${deletedFiles} files) older than 3 months`);
    }

    return { deletedRecords, deletedFiles };
  } catch (err) {
    console.error('[Payment Proofs] Cleanup failed:', err instanceof Error ? err.message : err);
    return { deletedRecords: 0, deletedFiles: 0 };
  }
}

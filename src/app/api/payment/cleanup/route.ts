import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import path from 'path';
import { enforceSuperAdmin } from '@/lib/require-auth';

const PROOF_RETENTION_DAYS = 90; // 3 months

/**
 * POST /api/payment/cleanup
 * Deletes payment proofs older than 3 months.
 * Called by cron job automatically.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const cutoff = new Date(Date.now() - PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Fetch old proofs
    const { data: oldProofs, error: fetchError } = await db
      .from('payment_proofs')
      .select('id, file_url')
      .lt('uploaded_at', cutoff);

    if (fetchError || !oldProofs || oldProofs.length === 0) {
      return NextResponse.json({ deleted: 0, message: 'No old proofs to clean' });
    }

    let deletedFiles = 0;
    const proofIds = oldProofs.map(p => p.id);

    // Delete physical files
    for (const proof of oldProofs) {
      try {
        const filePath = path.join(process.cwd(), 'public', proof.file_url);
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
    console.log(`[Payment Cleanup] Deleted ${deletedRecords} records, ${deletedFiles} files (older than ${PROOF_RETENTION_DAYS} days)`);

    return NextResponse.json({
      deleted: deletedRecords,
      deletedFiles,
      message: `Cleaned ${deletedRecords} proofs older than 3 months`,
    });
  } catch (error) {
    console.error('[Payment Cleanup] Error:', error);
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}

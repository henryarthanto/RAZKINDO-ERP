import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { isBase64Image, getBase64Size } from '@/lib/image-upload';
import { getSessionPool } from '@/lib/connection-pool';

interface SetupStatus {
  schema: { ok: boolean; message: string };
  realtime: { ok: boolean; message: string };
  storage: { ok: boolean; message: string };
  imageMigration: { totalBase64: number; totalBase64SizeMB: string; message: string };
}

/**
 * GET /api/setup/status
 *
 * Check all setup items and return a comprehensive status object.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    // Run all checks in parallel for speed
    const [schema, realtime, storage, imageMigration] = await Promise.all([
      checkSchema(),
      checkRealtime(),
      checkStorage(),
      checkImageMigration(),
    ]);

    const status: SetupStatus = {
      schema,
      realtime,
      storage,
      imageMigration,
    };

    return NextResponse.json(status);
  } catch (error) {
    console.error('[Setup:Status] Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// SCHEMA CHECK — verify DB connection is working
// ─────────────────────────────────────────────────────────────────────

async function checkSchema(): Promise<SetupStatus['schema']> {
  try {
    const pool = await getSessionPool();
    const result = await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\' ORDER BY table_name');
    const tables = result.rows.map((r: any) => r.table_name);

    // Check critical tables exist
    const criticalTables = ['users', 'transactions', 'products', 'settings'];
    const missing = criticalTables.filter(t => !tables.includes(t));

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Tabel kritis belum ada: ${missing.join(', ')}. Push schema.`,
      };
    }

    return {
      ok: true,
      message: `Database terhubung. ${tables.length} tabel tersedia.`,
    };
  } catch (error: any) {
    return {
      ok: false,
      message: 'Gagal terhubung ke database',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// REALTIME CHECK — informational: Supabase URL configured?
// ─────────────────────────────────────────────────────────────────────

async function checkRealtime(): Promise<SetupStatus['realtime']> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ok = !!supabaseUrl;

  return {
    ok,
    message: ok
      ? 'Supabase terkonfigurasi. Klik "Aktifkan Realtime" untuk mengaktifkan.'
      : 'NEXT_PUBLIC_SUPABASE_URL belum dikonfigurasi',
  };
}

// ─────────────────────────────────────────────────────────────────────
// STORAGE CHECK — try to list product-images bucket
// ─────────────────────────────────────────────────────────────────────

async function checkStorage(): Promise<SetupStatus['storage']> {
  const bucketName = 'product-images';

  try {
    const { error } = await supabaseAdmin.storage.from(bucketName).list('', { limit: 1 });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('not found') || msg.includes('does not exist') || error.code === '404') {
        return {
          ok: false,
          message: `Bucket "${bucketName}" belum dibuat`,
        };
      }
      return {
        ok: false,
        message: `Storage error: ${msg}`,
      };
    }

    return {
      ok: true,
      message: `Bucket "${bucketName}" sudah tersedia`,
    };
  } catch {
    return {
      ok: false,
      message: 'Gagal memeriksa storage',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// IMAGE MIGRATION CHECK — count base64 images
// ─────────────────────────────────────────────────────────────────────

async function checkImageMigration(): Promise<SetupStatus['imageMigration']> {
  try {
    const { db } = await import('@/lib/supabase');
    const { data: products } = await db
      .from('products')
      .select('id, image_url, name')
      .not('image_url', 'is', null);

    const base64Products = (products || []).filter(
      (p: any) => p.image_url && isBase64Image(p.image_url)
    );

    const totalSize = base64Products.reduce(
      (sum: number, p: any) => sum + getBase64Size(p.image_url),
      0
    );

    return {
      totalBase64: base64Products.length,
      totalBase64SizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      message: base64Products.length === 0
        ? 'Semua gambar sudah menggunakan CDN'
        : `${base64Products.length} gambar base64 perlu dimigrasi (${(totalSize / (1024 * 1024)).toFixed(2)} MB)`,
    };
  } catch {
    return {
      totalBase64: 0,
      totalBase64SizeMB: '0.00',
      message: 'Gagal memeriksa status migrasi gambar',
    };
  }
}

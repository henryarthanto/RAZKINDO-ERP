import { NextRequest, NextResponse } from 'next/server';
import { db, supabaseAdmin } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { isBase64Image, getBase64Size } from '@/lib/image-upload';

interface SetupStatus {
  schema: { ok: boolean; tables: string[]; message: string };
  realtime: { ok: boolean; tables: string[]; message: string };
  storage: { ok: boolean; bucket: string | null; message: string };
  tripay: { ok: boolean; mode: string | null; message: string };
  imageMigration: { totalBase64: number; totalSizeMB: string; message: string };
}

const REALTIME_TABLES = [
  'events', 'transactions', 'products', 'payments',
  'finance_requests', 'users', 'customers',
];

/**
 * GET /api/setup/status
 *
 * Check all setup items and return a comprehensive status object.
 * Called by the admin panel to show which setup steps are done.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    // Run all checks in parallel for speed
    const [schema, realtime, storage, tripay, imageMigration] = await Promise.all([
      checkSchema(),
      checkRealtime(),
      checkStorage(),
      checkTripay(),
      checkImageMigration(),
    ]);

    const status: SetupStatus = {
      schema,
      realtime,
      storage,
      tripay,
      imageMigration,
    };

    return NextResponse.json(status);
  } catch (error) {
    console.error('[Setup:Status] Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────
// SCHEMA CHECK — verify qris_payments table exists
// ─────────────────────────────────────────────────────────────────────

async function checkSchema(): Promise<SetupStatus['schema']> {
  const tables: string[] = [];
  const requiredTables = ['qris_payments'];

  for (const table of requiredTables) {
    try {
      await db.from(table).select('id').limit(1);
      tables.push(table);
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('42P01')) {
        // Table doesn't exist — schema needs push
      } else {
        // Other error — might be auth/conn issue, but table likely doesn't exist
      }
    }
  }

  const ok = tables.length === requiredTables.length;

  return {
    ok,
    tables,
    message: ok
      ? 'Semua tabel sudah tersedia'
      : `Tabel yang belum ada: ${requiredTables.filter(t => !tables.includes(t)).join(', ')}`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// REALTIME CHECK — informational: Supabase URL configured?
// ─────────────────────────────────────────────────────────────────────

async function checkRealtime(): Promise<SetupStatus['realtime']> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ok = !!supabaseUrl;

  return {
    ok,
    tables: ok ? REALTIME_TABLES : [],
    message: ok
      ? 'Supabase terkonfigurasi. Aktifkan Realtime untuk tabel di Supabase Dashboard.'
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
          bucket: null,
          message: `Bucket "${bucketName}" belum dibuat`,
        };
      }
      // Other storage error — might be permissions, but bucket might exist
      return {
        ok: false,
        bucket: null,
        message: `Storage error: ${msg}`,
      };
    }

    return {
      ok: true,
      bucket: bucketName,
      message: `Bucket "${bucketName}" sudah tersedia`,
    };
  } catch (error: any) {
    return {
      ok: false,
      bucket: null,
      message: 'Gagal memeriksa storage',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// TRIPAY CHECK — read tripay_config from settings
// ─────────────────────────────────────────────────────────────────────

async function checkTripay(): Promise<SetupStatus['tripay']> {
  try {
    const { data: row } = await db
      .from('settings')
      .select('value')
      .eq('key', 'tripay_config')
      .maybeSingle();

    if (!row?.value) {
      return {
        ok: false,
        mode: null,
        message: 'Konfigurasi Tripay belum diatur',
      };
    }

    const config = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;

    if (config.apiKey && config.privateKey && config.merchantCode) {
      return {
        ok: true,
        mode: config.mode || config.isProduction ? 'production' : 'sandbox',
        message: 'Tripay terkonfigurasi',
      };
    }

    return {
      ok: false,
      mode: config.mode || null,
      message: 'Tripay tidak lengkap (apiKey, privateKey, atau merchantCode belum diisi)',
    };
  } catch (error) {
    return {
      ok: false,
      mode: null,
      message: 'Gagal memeriksa konfigurasi Tripay',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// IMAGE MIGRATION CHECK — count base64 images
// ─────────────────────────────────────────────────────────────────────

async function checkImageMigration(): Promise<SetupStatus['imageMigration']> {
  try {
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
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      message: base64Products.length === 0
        ? 'Semua gambar sudah menggunakan CDN'
        : `${base64Products.length} gambar base64 perlu dimigrasi (${(totalSize / (1024 * 1024)).toFixed(2)} MB)`,
    };
  } catch (error) {
    return {
      totalBase64: 0,
      totalSizeMB: '0.00',
      message: 'Gagal memeriksa status migrasi gambar',
    };
  }
}

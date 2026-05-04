import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { Pool } from 'pg';

const REALTIME_TABLES = [
  'events', 'transactions', 'products', 'payments',
  'finance_requests', 'users', 'customers',
];

/**
 * POST /api/setup/enable-realtime
 *
 * Enable Supabase Realtime for specific tables by adding them
 * to the `supabase_realtime` publication.
 *
 * Uses the session pool (direct DB connection) for DDL operations.
 * Skips tables already in the publication.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    // Use DIRECT_URL for ALTER PUBLICATION (PgBouncer doesn't support this DDL)
    const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!directUrl) {
      return NextResponse.json({
        success: false,
        error: 'DIRECT_URL atau DATABASE_URL belum dikonfigurasi',
      }, { status: 500 });
    }

    const pool = new Pool({ connectionString: directUrl, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();

    const successTables: string[] = [];
    const skippedTables: string[] = [];
    const errors: string[] = [];

    try {
      // Step 1: Ensure publication exists
      try {
        await client.query('CREATE PUBLICATION supabase_realtime;');
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes('already exists')) {
          // Publication exists — proceed to add tables
        } else {
          errors.push(`Gagal membuat publication: ${msg}`);
          return NextResponse.json({
            success: false,
            error: 'Terjadi kesalahan server',
            errors,
          }, { status: 500 });
        }
      }

      // Step 2: Add each table to the publication
      for (const table of REALTIME_TABLES) {
        try {
          await client.query(
            `ALTER PUBLICATION supabase_realtime ADD TABLE ${table};`
          );
          successTables.push(table);
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (msg.includes('already exists') || msg.includes('already a member')) {
            // Table already in publication — skip
            skippedTables.push(table);
          } else if (msg.includes('does not exist') || msg.includes('relation')) {
            errors.push(`Tabel "${table}" tidak ditemukan`);
          } else {
            errors.push(`${table}: ${msg}`);
          }
        }
      }
    } finally {
      client.release();
      await pool.end().catch(() => {});
    }

    const allTables = [...successTables, ...skippedTables];
    const message = errors.length > 0
      ? `Realtime: ${successTables.length} ditambahkan, ${skippedTables.length} sudah ada, ${errors.length} error`
      : `Realtime diaktifkan untuk ${allTables.length} tabel`;

    console.log('[Setup:EnableRealtime]', message, { successTables, skippedTables, errors });

    return NextResponse.json({
      success: errors.length === 0,
      message,
      tables: allTables,
      added: successTables,
      skipped: skippedTables,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    console.error('[Setup:EnableRealtime] Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

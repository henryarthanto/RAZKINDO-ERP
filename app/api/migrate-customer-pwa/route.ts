import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { readFileSync } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { getSessionPool } from '@/lib/connection-pool';

/**
 * Split SQL into statements, respecting $$ dollar-quoting (for PL/pgSQL functions).
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let i = 0;

  while (i < sql.length) {
    if (!inDollarQuote && sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = true;
      current += '$$';
      i += 2;
      continue;
    }
    if (inDollarQuote && sql[i] === '$' && sql[i + 1] === '$') {
      inDollarQuote = false;
      current += '$$';
      i += 2;
      continue;
    }
    if (!inDollarQuote && sql[i] === ';') {
      const trimmed = current.trim();
      // Remove comments
      const cleaned = trimmed
        .split('\n')
        .map(line => line.replace(/--.*$/, '').trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
      if (cleaned.length > 5) {
        statements.push(cleaned);
      }
      current = '';
      i += 1;
      continue;
    }
    current += sql[i];
    i += 1;
  }

  // Remaining
  const trimmed = current.trim();
  const cleaned = trimmed
    .split('\n')
    .map(line => line.replace(/--.*$/, '').trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
  if (cleaned.length > 5) {
    statements.push(cleaned);
  }

  return statements;
}

// POST /api/migrate-customer-pwa — Run customer PWA migration SQL
export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require super_admin authentication
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: authUser } = await db.from('users').select('role').eq('id', authUserId).single();
    if (!authUser || authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang dapat menjalankan migrasi' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const dbUrl = body.databaseUrl;

    if (!dbUrl) {
      return NextResponse.json({
        success: false,
        error: 'databaseUrl wajib diisi.',
        instructions: [
          '1. Buka Supabase Dashboard > Settings > Database',
          '2. Copy Connection string (URI)',
          '3. Kirim: POST /api/migrate-customer-pwa { "databaseUrl": "postgresql://..." }',
        ],
      }, { status: 400 });
    }

    // Try using env var SUPABASE_DB_URL if provided matches or is empty
    const migrationPath = join(process.cwd(), 'migrations', 'customer-pwa-system.sql');
    if (!existsSync(migrationPath)) {
      return NextResponse.json({ error: 'File migrasi tidak ditemukan' }, { status: 404 });
    }

    const sql = readFileSync(migrationPath, 'utf-8');

    // Use session pool for DDL migration
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
    });
    const client = await pool.connect();

    try {
      const statements = splitSqlStatements(sql);

      let executed = 0;
      const errors: string[] = [];

      for (const stmt of statements) {
        try {
          await client.query(stmt);
          executed++;
        } catch (err: any) {
          const msg = err.message || '';
          if (
            msg.includes('already exists') ||
            msg.includes('duplicate key') ||
            msg.includes('relation already exists')
          ) {
            executed++; // harmless
          } else {
            errors.push(`${stmt.substring(0, 80)}...: ${msg}`);
          }
        }
      }

      // Small delay for Supabase to reload schema
      await new Promise(r => setTimeout(r, 2000));

      // Verify tables exist via Supabase client
      const tableChecks = await Promise.all([
        db.from('cashback_config').select('id').limit(1),
        db.from('cashback_log').select('id').limit(1),
        db.from('cashback_withdrawal').select('id').limit(1),
        db.from('customer_referral').select('id').limit(1),
      ]);

      const tables = {
        cashback_config: !tableChecks[0].error,
        cashback_log: !tableChecks[1].error,
        cashback_withdrawal: !tableChecks[2].error,
        customer_referral: !tableChecks[3].error,
      };

      const allOk = Object.values(tables).every(Boolean);

      return NextResponse.json({
        success: allOk,
        message: allOk
          ? 'Migrasi customer PWA berhasil! Semua tabel sudah terbuat.'
          : 'Migrasi selesai dengan beberapa error. Cek detail.',
        executed,
        errors: errors.length > 0 ? errors : undefined,
        tables,
      });
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: `Gagal menjalankan migrasi: ${error.message}` },
      { status: 500 }
    );
  }
}

// GET /api/migrate-customer-pwa — Check if tables exist (super_admin only)
export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const checks = await Promise.all([
      db.from('cashback_config').select('id').limit(1),
      db.from('cashback_log').select('id').limit(1),
      db.from('cashback_withdrawal').select('id').limit(1),
      db.from('customer_referral').select('id').limit(1),
    ]);

    const tables = {
      cashback_config: !checks[0].error,
      cashback_log: !checks[1].error,
      cashback_withdrawal: !checks[2].error,
      customer_referral: !checks[3].error,
    };

    const allOk = Object.values(tables).every(Boolean);

    return NextResponse.json({
      ready: allOk,
      tables,
      message: allOk
        ? 'Semua tabel PWA sudah siap'
        : 'Beberapa tabel belum dibuat. Jalankan migrasi terlebih dahulu.',
    });
  } catch (error: any) {
    return NextResponse.json({
      ready: false,
      error: error.message,
      message: 'Gagal mengecek status tabel',
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { db } from '@/lib/supabase';
import { getSessionPool } from '@/lib/connection-pool';
import { getProjectFile } from '@/lib/paths';

// =====================================================================
// SETUP SCHEMA - Checks if Supabase tables exist (requires auth)
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require super_admin authentication
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ success: true, message: 'Supabase not configured, using local database', tablesExist: true });
    }
    
    const supabase = createClient(
      supabaseUrl,
      supabaseKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error: testError } = await supabase.from('settings').select('key').limit(1);

    if (!testError) {
      return NextResponse.json({ success: true, message: 'Database schema already exists', tablesExist: true });
    }

    return NextResponse.json({
      success: false,
      message: 'Database tables not found.',
      tablesExist: false,
      instructions: [
        '1. Buka Supabase Dashboard > SQL Editor',
        '2. Paste isi file supabase-schema.sql',
        '3. Klik Run (Ctrl+Enter)',
        '4. Refresh halaman ERP',
      ],
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require super_admin authentication
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;
    const { userId } = authResult;

    // SECURITY FIX: Only use environment variable for database URL.
    // Never accept databaseUrl from request body — prevents SSRF / arbitrary DB connection.
    const dbUrl = process.env.SUPABASE_DB_URL;

    if (!dbUrl) {
      return NextResponse.json({
        success: false,
        error: 'SUPABASE_DB_URL belum dikonfigurasi di environment variables.',
        instructions: [
          '1. Set env SUPABASE_DB_URL dengan connection string dari Supabase Dashboard.',
          '2. Restart server.',
          '3. Kirim ulang: POST /api/setup-schema',
        ],
      }, { status: 400 });
    }

    const { readFile } = await import('fs/promises');
    const schemaSql = await readFile(getProjectFile('supabase-schema.sql'), 'utf-8');

    // Use session pool for DDL + transaction support
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
      await client.query('BEGIN');
      const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 5)
        .map(s => s.replace(/--.*$/gm, '').trim())
        .filter(s => s.length > 5);

      for (const stmt of statements) {
        if (stmt) await client.query(stmt);
      }

      await client.query('COMMIT');

      // Let Supabase reload schema cache
      await new Promise(resolve => setTimeout(resolve, 3000));

      return NextResponse.json({ success: true, message: 'Schema berhasil dibuat!', statements: statements.length });
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

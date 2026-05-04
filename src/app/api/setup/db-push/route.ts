import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';

/**
 * POST /api/setup/db-push
 *
 * Push the Prisma schema to the database to create/align missing tables.
 * Uses DIRECT_URL for direct DB connection (bypasses PgBouncer which blocks DDL).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    let output = '';
    let prismaSuccess = false;
    let prismaError = '';

    // ── Step 1: Try prisma db push ──
    // Use DIRECT_URL for direct DB connection (bypasses PgBouncer which blocks DDL)
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const directUrl = process.env.DIRECT_URL;
    if (directUrl) {
      process.env.DATABASE_URL = directUrl;
    }

    try {
      const { execSync } = await import('child_process');

      // First run prisma generate to ensure client is up to date
      try {
        execSync('npx prisma generate 2>&1', {
          cwd: process.cwd(),
          timeout: 30_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch {
        // prisma generate failure is non-critical, continue with db push
      }

      output = execSync('npx prisma db push --accept-data-loss 2>&1', {
        cwd: process.cwd(),
        timeout: 90_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      prismaSuccess = true;
    } catch (execError: any) {
      const stderr = execError?.stderr || '';
      const stdout = execError?.stdout || '';
      output = stdout + stderr;
      prismaError = output.substring(0, 3000);
      console.error('[Setup:DbPush] Prisma error:', prismaError);
    } finally {
      // Restore original DATABASE_URL
      if (directUrl && originalDatabaseUrl) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else if (directUrl) {
        delete process.env.DATABASE_URL;
      }
    }

    // ── Step 2: Retry with DIRECT_URL if first attempt failed ──
    if (!prismaSuccess) {
      try {
        const { execSync } = await import('child_process');
        const directUrl = process.env.DIRECT_URL;
        if (directUrl) {
          process.env.DATABASE_URL = directUrl;
        }
        output = execSync('npx prisma db push --accept-data-loss 2>&1', {
          cwd: process.cwd(),
          timeout: 90_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        prismaSuccess = true;
      } catch (retryError: any) {
        output += '\n\n--- Retry failed ---\n' + (retryError?.stdout || '') + (retryError?.stderr || '');
        console.error('[Setup:DbPush] Retry also failed:', output.substring(0, 1000));
      }
    }

    if (prismaSuccess) {
      return NextResponse.json({
        success: true,
        message: 'Schema berhasil di-push ke database',
        output: output?.substring(0, 2000) || '',
      });
    }

    // ── Step 3: If still failing, return detailed error ──
    const errorDetail = output.substring(0, 3000);

    return NextResponse.json({
      success: false,
      error: 'Gagal mempush schema ke database',
      detail: errorDetail,
      hint: 'Pastikan env vars DATABASE_URL dan DIRECT_URL sudah dikonfigurasi di production.',
    }, { status: 500 });
  } catch (error) {
    console.error('[Setup:DbPush] Error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

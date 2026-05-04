import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { getSessionPool } from '@/lib/connection-pool';

/**
 * POST /api/setup/db-push
 *
 * Push the Prisma schema to the database to create missing tables
 * (e.g., qris_payments). Also drops tables that no longer exist in the schema.
 *
 * Uses `npx prisma db push --accept-data-loss` which connects via DATABASE_URL.
 * Falls back to direct SQL for dropping orphaned tables if prisma fails.
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

    // ── Step 2: Fallback — drop orphaned tables via direct SQL ──
    if (!prismaSuccess) {
      const droppedTables: string[] = [];
      const orphanedTables = [
        'push_subscriptions', // Removed in commit 8be855a
      ];

      try {
        const pool = await getSessionPool();
        const client = await pool.connect();

        try {
          for (const table of orphanedTables) {
            try {
              await client.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
              droppedTables.push(table);
            } catch {
              // Table might not exist, that's fine
            }
          }

          // Also clean up settings table entries for removed features
          const orphanedSettings = ['vapid_config'];
          for (const key of orphanedSettings) {
            try {
              await client.query(`DELETE FROM settings WHERE key = '${key}'`);
            } catch {
              // settings table might not exist, that's fine
            }
          }

          // Try prisma db push again after cleanup (already using DIRECT_URL from above)
          try {
            const { execSync } = await import('child_process');
            if (directUrl && !process.env.DATABASE_URL?.includes('db.')) {
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
            output += '\n\n--- Retry after cleanup ---\n' + (retryError?.stdout || '') + (retryError?.stderr || '');
            console.error('[Setup:DbPush] Retry also failed:', output.substring(0, 1000));
          }
        } finally {
          client.release();
        }
      } catch (poolError) {
        console.error('[Setup:DbPush] Direct SQL fallback error:', poolError);
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

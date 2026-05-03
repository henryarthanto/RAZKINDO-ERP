import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { toSnakeCase } from '@/lib/supabase-helpers';

/**
 * POST /api/system/restore
 * Restore database from uploaded JSON backup file (Supabase version)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'File tidak ditemukan' }, { status: 400 });
    }

    if (!file.name.endsWith('.json')) {
      return NextResponse.json(
        { error: 'File harus berformat .json' },
        { status: 400 }
      );
    }

    const MAX_RESTORE_SIZE = 100 * 1024 * 1024;
    if (file.size > MAX_RESTORE_SIZE) {
      return NextResponse.json(
        { error: 'File backup terlalu besar. Maksimal 100MB.' },
        { status: 400 }
      );
    }

    const content = await file.text();
    let backup: Record<string, any[]>;

    try {
      backup = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: 'File tidak valid (bukan JSON)' }, { status: 400 });
    }

    // Restore each table in correct FK dependency order
    const tables = [
      'units', 'users', 'suppliers', 'customers', 'products', 'unit_products',
      'transactions', 'transaction_items', 'payments', 'salary_payments',
      'bank_accounts', 'cash_boxes',
      'finance_requests', 'fund_transfers',
      'company_debts', 'company_debt_payments',
      'receivables', 'receivable_follow_ups', 'customer_follow_ups',
      'logs', 'events', 'sales_targets', 'sales_tasks', 'sales_task_reports',
      'courier_cash', 'courier_handovers', 'settings', 'password_resets'
    ];

    let totalRestored = 0;
    const errors: string[] = [];

    for (const table of tables) {
      const rows = backup[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      try {
        // Convert camelCase keys to snake_case for each row
        const snakeRows = rows.map(row => toSnakeCase(row));

        // Insert in batches of 500
        const batchSize = 500;
        for (let i = 0; i < snakeRows.length; i += batchSize) {
          const batch = snakeRows.slice(i, i + batchSize);
          const { error } = await db.from(table).upsert(batch, { onConflict: 'id', count: 'exact' });
          if (error) {
            // Try insert without upsert
            const { error: insertError } = await db.from(table).insert(batch);
            if (insertError) {
              errors.push(`${table}: ${insertError.message.slice(0, 100)}`);
            } else {
              totalRestored += batch.length;
            }
          } else {
            totalRestored += batch.length;
          }
        }
      } catch (err: any) {
        errors.push(`${table}: ${err.message?.slice(0, 100) || 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Restore selesai: ${totalRestored} record dipulihkan`,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error('Restore error:', error);
    return NextResponse.json({ error: 'Gagal restore database' }, { status: 500 });
  }
}

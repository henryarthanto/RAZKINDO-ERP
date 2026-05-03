// =====================================================================
// OPTIMISTIC LOCKING — Server-side utility for optimistic concurrency.
//
// Prevents lost updates when multiple users edit the same record.
// Uses a `version` column: each successful update increments it.
// If the version has changed since the client last read the row,
// the update returns a 409 Conflict.
//
// Tables that carry the `version` column:
//   transactions, payments, bank_accounts, cash_boxes,
//   salary_payments, finance_requests, company_debts, receivables
// =====================================================================

import { db } from '@/lib/supabase';

export interface OptimisticLockResult {
  success: boolean;
  error?: string;
  currentVersion?: number;
}

/**
 * Update a row with optimistic locking.
 * Only succeeds if the current `version` column matches `expectedVersion`.
 * On success, `version` is auto-incremented.
 *
 * @param table  - Supabase table name (snake_case)
 * @param id     - Row primary key
 * @param expectedVersion - The version the caller last observed
 * @param updateData - Fields to update (NOT including `version`)
 * @returns `{ success: true, currentVersion }` on match,
 *          `{ success: false, error, currentVersion }` on conflict
 */
export async function optimisticUpdate(
  table: string,
  id: string,
  expectedVersion: number,
  updateData: Record<string, any>,
): Promise<OptimisticLockResult> {
  const { data, error } = await db
    .from(table)
    .update({
      ...updateData,
      version: expectedVersion + 1,
    })
    .eq('id', id)
    .eq('version', expectedVersion) // ← atomic guard
    .select('id, version')
    .single();

  if (error) {
    // PostgrestError — likely the column doesn't exist yet, or other issue
    return { success: false, error: error.message };
  }

  if (!data) {
    // No rows returned → the WHERE clause didn't match → version conflict
    const { data: current } = await db
      .from(table)
      .select('version')
      .eq('id', id)
      .single();

    return {
      success: false,
      error:
        'Data telah diubah oleh pengguna lain. Silakan refresh dan coba lagi.',
      currentVersion: (current as any)?.version,
    };
  }

  return { success: true, currentVersion: data.version };
}

/**
 * Build a standard 409 Conflict response body for optimistic-lock failures.
 */
export function conflictResponse(currentVersion?: number) {
  return {
    status: 409,
    body: {
      error:
        'Konflik data: Data telah diubah oleh pengguna lain. Silakan refresh halaman dan coba lagi.',
      code: 'CONFLICT',
      currentVersion,
    },
  };
}

// =====================================================================
// REQUIRE AUTH - Auth enforcement helpers for API routes
//
// Migrated from Prisma to Supabase.
// Supabase uses snake_case columns (is_active), TypeScript types use camelCase (isActive).
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser, verifyAuthToken } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// AUTH HELPERS
// =====================================================================

/**
 * Verifies that the request is from an authenticated, active user.
 * Returns userId on success, or null on failure.
 */
export async function requireAuth(request: NextRequest): Promise<string | null> {
  return verifyAuthUser(request.headers.get('authorization'));
}

/**
 * Verifies that the request is from an authenticated super_admin.
 * Returns { userId, user } on success, or null on failure.
 */
async function requireSuperAdminInternal(request: NextRequest): Promise<{
  userId: string;
  user: any;
} | null> {
  const userId = await verifyAuthUser(request.headers.get('authorization'));
  if (!userId) return null;

  const { db } = await import('@/lib/supabase');
  const { data: row } = await db
    .from('users')
    .select('id, name, role, is_active, status')
    .eq('id', userId)
    .maybeSingle();

  // Map snake_case to camelCase (recursive — handles nested objects)
  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved' || user.role !== 'super_admin') {
    return null;
  }

  return { userId: user.id, user };
}

/**
 * Convenience: call at the top of a route handler.
 * Returns { success: true, userId, user } on success,
 * or { success: false, response } on failure.
 *
 * Uses verifyAuthToken (HMAC-only, no DB) + single DB query.
 */
export async function enforceSuperAdmin(request: NextRequest): Promise<{ success: true; userId: string; user: any } | { success: false; response: NextResponse }> {
  const token = request.headers.get('authorization');
  if (!token) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const userId = verifyAuthToken(token);
  if (!userId) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { db } = await import('@/lib/supabase');
  const { data: row } = await db
    .from('users')
    .select('id, name, role, is_active, status')
    .eq('id', userId)
    .maybeSingle();

  // Map snake_case to camelCase (recursive — handles nested objects)
  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved' || user.role !== 'super_admin') {
    return { success: false, response: NextResponse.json({ error: 'Forbidden - Super admin only' }, { status: 403 }) };
  }

  return { success: true, userId: user.id, user };
}

/**
 * Enforce that the caller has a finance-related role (super_admin or keuangan).
 * Uses verifyAuthToken (HMAC-only, no DB) + single DB query.
 */
export async function enforceFinanceRole(request: NextRequest): Promise<{ success: true; userId: string; user: any } | { success: false; response: NextResponse }> {
  const token = request.headers.get('authorization');
  if (!token) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const userId = verifyAuthToken(token);
  if (!userId) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { db } = await import('@/lib/supabase');
  const { data: row } = await db
    .from('users')
    .select('id, name, role, is_active, status')
    .eq('id', userId)
    .maybeSingle();

  // Map snake_case to camelCase (recursive — handles nested objects)
  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved') {
    return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (user.role !== 'super_admin' && user.role !== 'keuangan') {
    return { success: false, response: NextResponse.json({ error: 'Forbidden - Hanya Super Admin atau Keuangan' }, { status: 403 }) };
  }

  return { success: true, userId: user.id, user };
}

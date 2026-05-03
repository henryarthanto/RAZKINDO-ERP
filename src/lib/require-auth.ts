// =====================================================================
// REQUIRE AUTH - Auth enforcement helpers for API routes
//
// Migrated from Prisma to Supabase.
// Supabase uses snake_case columns (is_active), TypeScript types use camelCase (isActive).
//
// Supports custom role permissions via resolveEffectiveRoles().
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser, verifyAuthToken } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';
import { BUILT_IN_ROLES, fetchEffectiveRolesFromDB } from '@/lib/role-permissions';

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
 * Also allows custom roles that include 'keuangan' or 'super_admin' in their permissions.
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
    .select('id, name, role, is_active, status, custom_role_id')
    .eq('id', userId)
    .maybeSingle();

  // Map snake_case to camelCase (recursive — handles nested objects)
  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved') {
    return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Check built-in role
  if (user.role === 'super_admin' || user.role === 'keuangan') {
    return { success: true, userId: user.id, user };
  }

  // Check custom role permissions
  const effectiveRoles = await fetchEffectiveRolesFromDB(db, userId);
  if (effectiveRoles.includes('super_admin') || effectiveRoles.includes('keuangan')) {
    return { success: true, userId: user.id, user: { ...user, effectiveRoles } };
  }

  return { success: false, response: NextResponse.json({ error: 'Forbidden - Hanya Super Admin atau Keuangan' }, { status: 403 }) };
}

// =====================================================================
// AUTH USER WITH EFFECTIVE ROLES
// =====================================================================

/**
 * Verify the caller's auth token and return the user record
 * together with their effective roles (resolved from custom_role permissions).
 *
 * This is the recommended helper for API routes that need to check
 * role-based permissions for custom role users.
 */
export async function getAuthUserWithRoles(request: NextRequest): Promise<{
  success: true;
  userId: string;
  user: any;
  effectiveRoles: string[];
} | { success: false; response: NextResponse }> {
  const token = request.headers.get('authorization');
  if (!token) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const userId = verifyAuthToken(token);
  if (!userId) return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const { db } = await import('@/lib/supabase');
  const { data: row } = await db
    .from('users')
    .select('id, name, role, is_active, status, custom_role_id, unit_id')
    .eq('id', userId)
    .maybeSingle();

  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved') {
    return { success: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Resolve effective roles (handles custom roles with permissions)
  const effectiveRoles = await fetchEffectiveRolesFromDB(db, userId);

  return {
    success: true,
    userId: user.id,
    user: { ...user, effectiveRoles },
    effectiveRoles,
  };
}

/**
 * Check if the authenticated user has any of the given roles.
 * Uses effective roles (resolved from custom_role permissions).
 */
export async function hasEffectiveRoles(
  request: NextRequest,
  roles: string[],
): Promise<{ allowed: true; userId: string; effectiveRoles: string[] } | { allowed: false; response: NextResponse }> {
  const result = await getAuthUserWithRoles(request);
  if (!result.success) return { allowed: false, response: result.response };

  // super_admin bypasses everything
  if (result.effectiveRoles.includes('super_admin')) {
    return { allowed: true, userId: result.userId, effectiveRoles: result.effectiveRoles };
  }

  const hasAny = roles.some(r => result.effectiveRoles.includes(r));
  if (hasAny) {
    return { allowed: true, userId: result.userId, effectiveRoles: result.effectiveRoles };
  }

  return {
    allowed: false,
    response: NextResponse.json({ error: 'Forbidden - Role tidak memiliki akses' }, { status: 403 }),
  };
}

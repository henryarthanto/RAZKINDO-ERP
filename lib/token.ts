// =====================================================================
// TOKEN VERIFICATION - Centralized auth token utilities
// Moved from api/users/activity/route.ts for proper code organization
//
// Migrated from Prisma to Supabase.
// Supabase uses snake_case columns (is_active), TypeScript types use camelCase (isActive).
// =====================================================================

import crypto from 'crypto';
import { getAuthSecret } from '@/lib/auth-secret';
import { toCamelCase, camelToSnake } from '@/lib/supabase-helpers';

// Cache for verified active users (TTL = 60s)
// Avoids hitting the DB on every request for the same user
const _userCache = new Map<string, { active: boolean; expiresAt: number }>();
const USER_CACHE_TTL = 60_000; // 60 seconds
const USER_CACHE_MAX_SIZE = 1000; // Prevent unbounded memory growth

/** Periodic cleanup of expired entries */
function cleanupUserCache(): void {
  const now = Date.now();
  for (const [key, entry] of _userCache) {
    if (entry.expiresAt <= now) {
      _userCache.delete(key);
    }
  }
}

// =====================================================================
// HELPERS: camelCase ↔ snake_case column mapping
// =====================================================================

/**
 * Map Prisma-style camelCase select fields to a Supabase comma-separated select string.
 * { id: true, isActive: true, role: true } → "id, is_active, role"
 */
function mapSelectToSupabase(select: Record<string, boolean>): string {
  return Object.keys(select)
    .filter((key) => select[key])
    .map(camelToSnake)
    .join(', ');
}

// =====================================================================
// TOKEN VERIFICATION
// =====================================================================

/**
 * Verify auth token from Authorization header.
 * Returns userId if valid, null otherwise.
 * Does NOT check if user is still active (use verifyAuthUser for that).
 */
export function verifyAuthToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  // Guard against oversized tokens (DoS prevention)
  if (token.length < 30 || token.length > 500) return null;

  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [userId, timestamp, signature] = parts;
    if (!userId || !timestamp || !signature) return null;

    // Validate timestamp is numeric
    const ts = parseInt(timestamp);
    if (isNaN(ts)) return null;

    // Check expiry (7 days)
    const tokenAge = Date.now() - ts;
    if (tokenAge > 7 * 24 * 60 * 60 * 1000 || tokenAge < 0) return null;

    // Verify HMAC
    const payload = `${userId}:${timestamp}`;
    const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex');
    if (signature !== expectedSig) return null;

    return userId;
  } catch {
    return null;
  }
}

/**
 * Verify token AND check that user is still active and approved.
 * Returns userId if valid and active, null otherwise.
 * 
 * Uses an in-memory cache (60s TTL) to avoid DB hit on every request.
 * When a user is deactivated, the cache will reflect this within 60s max.
 */
export async function verifyAuthUser(authHeader: string | null): Promise<string | null> {
  const userId = verifyAuthToken(authHeader);
  if (!userId) return null;

  // Check in-memory cache first
  const cached = _userCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.active ? userId : null;
  }

  // Dynamic import to avoid circular dependency in serverless environment
  const { db } = await import('@/lib/supabase');
  const { data: user } = await db
    .from('users')
    .select('id, is_active, status')
    .eq('id', userId)
    .maybeSingle();

  const isActive = !!(user && user.is_active && user.status === 'approved');

  // Evict oldest entries if cache is too large (LRU-like)
  if (_userCache.size >= USER_CACHE_MAX_SIZE) {
    cleanupUserCache();
    // If still too large after cleanup, remove the first 100 entries
    if (_userCache.size >= USER_CACHE_MAX_SIZE) {
      let count = 0;
      for (const key of _userCache.keys()) {
        _userCache.delete(key);
        count++;
        if (count >= 100) break;
      }
    }
  }

  _userCache.set(userId, {
    active: isActive,
    expiresAt: Date.now() + USER_CACHE_TTL
  });

  return isActive ? userId : null;
}

/**
 * Invalidate user cache (e.g., after user deactivation or password change)
 */
export function invalidateUserAuthCache(userId?: string) {
  if (userId) {
    _userCache.delete(userId);
  } else {
    _userCache.clear();
  }
}

/**
 * Verify token + get full user in a single DB query.
 * Returns { userId, user } if valid and active, null otherwise.
 * 
 * Use this instead of calling verifyAuthUser() then db.user.findUnique()
 * separately — eliminates double DB queries.
 *
 * The `select` parameter uses camelCase field names (Prisma convention).
 * Results are automatically mapped back to camelCase.
 */
export async function verifyAndGetAuthUser(
  authHeader: string | null,
  select?: Record<string, boolean>
): Promise<{ userId: string; user: any } | null> {
  const userId = verifyAuthToken(authHeader);
  if (!userId) return null;

  const { db } = await import('@/lib/supabase');

  // CRITICAL: Always include auth-required fields (id, is_active, status) in addition
  // to any custom fields. Without these, the auth check below fails silently.
  const requiredFields: Record<string, boolean> = { id: true, isActive: true, status: true };
  const mergedFields = select ? { ...select, ...requiredFields } : { ...requiredFields, role: true };
  const supabaseSelect = mapSelectToSupabase(mergedFields);

  const { data: row } = await db
    .from('users')
    .select(supabaseSelect)
    .eq('id', userId)
    .single();

  // Map snake_case result back to camelCase (recursive — handles nested objects)
  const user = toCamelCase(row);

  if (!user || !user.isActive || user.status !== 'approved') return null;

  return { userId, user };
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getAuthSecret } from '@/lib/auth-secret';
import { invalidateUserAuthCache } from '@/lib/token';
import { validateBody, authSchemas } from '@/lib/validators';
import { resolveEffectiveRoles } from '@/lib/role-permissions';

// ================================
// RATE LIMITING - In-memory login attempt tracker
// ================================
interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const _loginAttempts = new Map<string, RateLimitEntry>();
const MAX_ATTEMPTS = 10;           // Max login attempts per window
const WINDOW_MS = 15 * 60 * 1000;  // 15 minute window
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minute lockout after max attempts
const MAX_RATE_LIMIT_ENTRIES = 1000; // Prevent unbounded memory growth

// Periodic cleanup to prevent memory leaks from abandoned entries
let _lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Clean every 5 minutes

function cleanExpiredEntries() {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS && _loginAttempts.size < MAX_RATE_LIMIT_ENTRIES) return;
  _lastCleanup = now;

  for (const [key, entry] of _loginAttempts) {
    if (now > entry.firstAttemptAt + WINDOW_MS && now > entry.lockedUntil) {
      _loginAttempts.delete(key);
    }
  }

  if (_loginAttempts.size > MAX_RATE_LIMIT_ENTRIES) {
    const entries = [..._loginAttempts.entries()]
      .sort((a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt);
    const toDelete = entries.slice(0, entries.length - MAX_RATE_LIMIT_ENTRIES);
    for (const [key] of toDelete) {
      _loginAttempts.delete(key);
    }
  }
}

function checkRateLimit(email: string): { allowed: boolean; retryAfter?: number } {
  cleanExpiredEntries();
  const entry = _loginAttempts.get(email);
  if (!entry) return { allowed: true };

  const now = Date.now();
  if (now < entry.lockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (now > entry.firstAttemptAt + WINDOW_MS) {
    _loginAttempts.delete(email);
    return { allowed: true };
  }

  return { allowed: entry.attempts < MAX_ATTEMPTS };
}

function recordFailedAttempt(email: string) {
  const now = Date.now();
  const entry = _loginAttempts.get(email);
  if (!entry || now > entry.firstAttemptAt + WINDOW_MS) {
    _loginAttempts.set(email, { attempts: 1, firstAttemptAt: now, lockedUntil: 0 });
  } else {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      entry.lockedUntil = now + LOCKOUT_MS;
    }
  }
}

function clearFailedAttempts(email: string) {
  _loginAttempts.delete(email);
}

// ================================
// TOKEN GENERATION
// ================================

function generateToken(userId: string): string {
  const payload = `${userId}:${Date.now()}`;
  const signature = crypto.createHmac('sha256', getAuthSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

// ================================
// LOGIN HANDLER
// ================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = validateBody(authSchemas.login, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { email, password } = validation.data;

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limit check
    const rateCheck = checkRateLimit(normalizedEmail);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan login. Coba lagi dalam ${rateCheck.retryAfter} detik.` },
        { status: 429 }
      );
    }

    const { data: user, error: dbError } = await db
      .from('users')
      .select('*, unit:units(*), custom_role:custom_roles(*)')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (dbError) {
      console.error('[Login] DB error:', dbError.message, dbError.code);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }

    const userCamel = toCamelCase(user);

    if (!userCamel || userCamel.status !== 'approved' || !userCamel.isActive || userCamel.canLogin === false) {
      recordFailedAttempt(normalizedEmail);
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
    }

    const isValidPassword = await bcrypt.compare(password, userCamel.password as string);
    if (!isValidPassword) {
      recordFailedAttempt(normalizedEmail);
      return NextResponse.json({ error: 'Email atau password salah' }, { status: 401 });
    }

    clearFailedAttempts(normalizedEmail);

    // ─── LOGIN SUCCESS ─────────────────────────────────
    // Update last seen
    await db.from('users').update({ last_seen_at: new Date().toISOString() }).eq('id', userCamel.id);

    // Create log
    createLog(db, {
      type: 'activity',
      userId: userCamel.id,
      action: 'login',
      message: `${userCamel.name} logged in`
    });

    const { password: _, ...userWithoutPassword } = userCamel!;
    const token = generateToken(userCamel.id);

    // Resolve effective roles for custom role users
    const effectiveRoles = resolveEffectiveRoles(userCamel as any);

    return NextResponse.json({ user: { ...userWithoutPassword, effectiveRoles }, token });
  } catch (error: any) {
    console.error('[Login] Server error:', error?.message || error);
    // Don't leak raw error messages to client — log to server only
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

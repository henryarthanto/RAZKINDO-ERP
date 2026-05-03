import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog } from '@/lib/supabase-helpers';
import bcrypt from 'bcryptjs';
import { validateBody } from '@/lib/validators';
import { z } from 'zod';

// ================================
// RATE LIMITING - In-memory attempt tracker
// ================================
interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const _resetAttempts = new Map<string, RateLimitEntry>();
const MAX_RESET_ATTEMPTS = 5;          // Max attempts per window
const RESET_WINDOW_MS = 15 * 60 * 1000;  // 15 minute window
const RESET_LOCKOUT_MS = 15 * 60 * 1000; // 15 minute lockout
const MAX_RATE_LIMIT_ENTRIES = 1000;

let _lastResetCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanExpiredResetEntries() {
  const now = Date.now();
  if (now - _lastResetCleanup < CLEANUP_INTERVAL_MS && _resetAttempts.size < MAX_RATE_LIMIT_ENTRIES) return;
  _lastResetCleanup = now;
  for (const [key, entry] of _resetAttempts) {
    if (now > entry.firstAttemptAt + RESET_WINDOW_MS && now > entry.lockedUntil) {
      _resetAttempts.delete(key);
    }
  }
  if (_resetAttempts.size > MAX_RATE_LIMIT_ENTRIES) {
    const entries = [..._resetAttempts.entries()].sort((a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt);
    const toDelete = entries.slice(0, entries.length - MAX_RATE_LIMIT_ENTRIES);
    for (const [key] of toDelete) _resetAttempts.delete(key);
  }
}

function checkResetRateLimit(phone: string): { allowed: boolean; retryAfter?: number } {
  cleanExpiredResetEntries();
  const entry = _resetAttempts.get(phone);
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (now < entry.lockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (now > entry.firstAttemptAt + RESET_WINDOW_MS) {
    _resetAttempts.delete(phone);
    return { allowed: true };
  }
  return { allowed: entry.attempts < MAX_RESET_ATTEMPTS };
}

function recordResetFailedAttempt(phone: string) {
  const now = Date.now();
  const entry = _resetAttempts.get(phone);
  if (!entry || now > entry.firstAttemptAt + RESET_WINDOW_MS) {
    _resetAttempts.set(phone, { attempts: 1, firstAttemptAt: now, lockedUntil: 0 });
  } else {
    entry.attempts += 1;
    if (entry.attempts >= MAX_RESET_ATTEMPTS) {
      entry.lockedUntil = now + RESET_LOCKOUT_MS;
    }
  }
}

// Zod schema for phone+code-based reset password (route uses phone/code, not token)
const resetPasswordSchema = z.object({
  phone: z.string().min(1, 'Nomor telepon diperlukan'),
  code: z.string().min(1, 'Kode pemulihan diperlukan'),
  newPassword: z.string().min(6, 'Password minimal 6 karakter'),
});

// POST /api/auth/reset-password
// Verifies recovery code and resets password (phone-based)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = validateBody(resetPasswordSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { phone, code, newPassword } = validation.data;

    // Normalize phone
    const cleanPhone = phone.replace(/\D/g, '');
    const normalizedPhone = cleanPhone.startsWith('0')
      ? '62' + cleanPhone.slice(1)
      : cleanPhone;

    // Rate limit check
    const rateCheck = checkResetRateLimit(normalizedPhone);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Terlalu banyak percobaan reset password. Coba lagi dalam ${rateCheck.retryAfter} detik.` },
        { status: 429 }
      );
    }

    // Find valid, unused recovery code
    const { data: reset, error: resetError } = await db
      .from('password_resets')
      .select('*')
      .eq('identifier', normalizedPhone)
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resetError) {
      console.error('Reset code lookup error:', resetError);
    }

    if (!reset) {
      recordResetFailedAttempt(normalizedPhone);
      return NextResponse.json(
        { error: 'Kode pemulihan tidak valid atau sudah expired' },
        { status: 400 }
      );
    }

    const resetCamel = toCamelCase(reset);

    // Find user by phone
    const { data: user, error: userError } = await db
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (userError) {
      console.error('Reset password user lookup error:', userError);
    }

    if (!user) {
      return NextResponse.json(
        { error: 'User tidak ditemukan' },
        { status: 404 }
      );
    }

    const userCamel = toCamelCase(user);

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Sequential operations (no transactions in Supabase JS)
    // 1. Update password
    await db
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userCamel.id);

    // 2. Mark code as used
    await db
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('id', resetCamel.id);

    // 3. Invalidate all other codes for this phone
    await db
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('identifier', normalizedPhone)
      .is('used_at', null)
      .neq('id', resetCamel.id);

    // 4. Create log
    createLog(db, {
      type: 'activity',
      userId: userCamel.id,
      action: 'password_reset',
      message: `Password reset via WhatsApp recovery code`
    });

    // Invalidate auth cache for this user
    const { invalidateUserAuthCache } = await import('@/lib/token');
    invalidateUserAuthCache(userCamel.id);

    return NextResponse.json({
      message: 'Password berhasil diubah! Silakan login dengan password baru.'
    });
  } catch (error: any) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import crypto from 'crypto';
import { getWhatsAppConfig, sendMessage, disableWhatsAppOnInvalidToken } from '@/lib/whatsapp';
import { validateBody } from '@/lib/validators';
import { z } from 'zod';

// ================================
// RATE LIMITING - In-memory attempt tracker
// ================================
interface ForgotRateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const _forgotAttempts = new Map<string, ForgotRateLimitEntry>();
const MAX_FORGOT_ATTEMPTS = 5;          // Max attempts per window
const FORGOT_WINDOW_MS = 15 * 60 * 1000;  // 15 minute window
const FORGOT_LOCKOUT_MS = 15 * 60 * 1000; // 15 minute lockout
const MAX_FORGOT_ENTRIES = 1000;

let _lastForgotCleanup = Date.now();
const FORGOT_CLEANUP_MS = 5 * 60 * 1000;

function cleanExpiredForgotEntries() {
  const now = Date.now();
  if (now - _lastForgotCleanup < FORGOT_CLEANUP_MS && _forgotAttempts.size < MAX_FORGOT_ENTRIES) return;
  _lastForgotCleanup = now;
  for (const [key, entry] of _forgotAttempts) {
    if (now > entry.firstAttemptAt + FORGOT_WINDOW_MS && now > entry.lockedUntil) {
      _forgotAttempts.delete(key);
    }
  }
  if (_forgotAttempts.size > MAX_FORGOT_ENTRIES) {
    const entries = [..._forgotAttempts.entries()].sort((a, b) => a[1].firstAttemptAt - b[1].firstAttemptAt);
    const toDelete = entries.slice(0, entries.length - MAX_FORGOT_ENTRIES);
    for (const [key] of toDelete) _forgotAttempts.delete(key);
  }
}

function checkForgotRateLimit(phone: string): { allowed: boolean; retryAfter?: number } {
  cleanExpiredForgotEntries();
  const entry = _forgotAttempts.get(phone);
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (now < entry.lockedUntil) {
    return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  if (now > entry.firstAttemptAt + FORGOT_WINDOW_MS) {
    _forgotAttempts.delete(phone);
    return { allowed: true };
  }
  return { allowed: entry.attempts < MAX_FORGOT_ATTEMPTS };
}

function recordForgotAttempt(phone: string) {
  const now = Date.now();
  const entry = _forgotAttempts.get(phone);
  if (!entry || now > entry.firstAttemptAt + FORGOT_WINDOW_MS) {
    _forgotAttempts.set(phone, { attempts: 1, firstAttemptAt: now, lockedUntil: 0 });
  } else {
    entry.attempts += 1;
    if (entry.attempts >= MAX_FORGOT_ATTEMPTS) {
      entry.lockedUntil = now + FORGOT_LOCKOUT_MS;
    }
  }
}

// Zod schema for phone-based forgot password (route uses phone, not email)
const forgotPasswordSchema = z.object({
  phone: z.string().min(1, 'Nomor telepon diperlukan'),
});

// POST /api/auth/forgot-password
// Sends a 6-digit recovery code via WhatsApp to the user's phone number
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = validateBody(forgotPasswordSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { phone } = validation.data;

    // Normalize phone: remove all non-digits, add 62 prefix if starting with 0
    const cleanPhone = phone.replace(/\D/g, '');
    const normalizedPhone = cleanPhone.startsWith('0')
      ? '62' + cleanPhone.slice(1)
      : cleanPhone;

    // Rate limit check
    const rateCheck = checkForgotRateLimit(normalizedPhone);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Terlalu banyak permintaan. Coba lagi dalam ${rateCheck.retryAfter} detik.` },
        { status: 429 }
      );
    }

    recordForgotAttempt(normalizedPhone);

    // Check if user exists with this phone number
    const { data: user, error: userError } = await db
      .from('users')
      .select('*')
      .eq('phone', normalizedPhone)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (userError) {
      console.error('Forgot password user lookup error:', userError);
    }

    if (!user) {
      // Don't reveal that phone doesn't exist (security best practice)
      return NextResponse.json({
        message: 'Jika nomor terdaftar, kode pemulihan akan dikirim via WhatsApp.',
        sent: false
      });
    }

    const userCamel = toCamelCase(user);

    // Generate 6-digit code
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalidate any previous unused codes for this phone
    await db
      .from('password_resets')
      .update({ used_at: new Date().toISOString() })
      .eq('identifier', normalizedPhone)
      .is('used_at', null);

    // Store the new code
    await db
      .from('password_resets')
      .insert({
        id: generateId(),
        identifier: normalizedPhone,
        code,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
      });

    // Send code via WhatsApp
    const companyName = await getSetting('company_name') || 'Razkindo ERP';
    let sent = false;

    const whatsappConfig = await getWhatsAppConfig();
    if (whatsappConfig.enabled && whatsappConfig.token) {
      const message = `*🔐 ${companyName} - Pemulihan Password*\n\nHalo *${userCamel.name}*,\n\nAnda meminta pemulihan password. Berikut kode pemulihan Anda:\n\n*${code}*\n\n⏱ Kode berlaku *15 menit*.\nJika Anda tidak meminta ini, abaikan pesan ini.`;

      const result = await sendMessage(whatsappConfig.token, normalizedPhone, message);
      sent = result.success;

      if (!sent) {
        console.error('[WHATSAPP] Failed to send recovery code:', result.error);
        if (result.tokenInvalid) {
          await disableWhatsAppOnInvalidToken();
        }
      }
    }

    // Don't store recovery code in event payload (security)
    createEvent(db, 'password_reset_requested', {
      phone: normalizedPhone,
      userName: userCamel.name,
      sent,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      message: sent
        ? 'Kode pemulihan dikirim via WhatsApp!'
        : 'WhatsApp belum dikonfigurasi. Hubungi admin untuk reset password.',
      sent
    });
  } catch (error: any) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

async function getSetting(key: string): Promise<string | null> {
  try {
    const { data: setting } = await db
      .from('settings')
      .select('*')
      .eq('key', key)
      .single();
    if (!setting) return null;
    try { return JSON.parse(setting.value); } catch { return setting.value; }
  } catch {
    return null;
  }
}

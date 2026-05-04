// =====================================================================
// MIDDLEWARE — Global auth guard, rate limiting, and security
//
// Runs on every /api/* request (Edge Runtime compatible).
// Handles: auth check, rate limiting, body size limit, security logging.
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';

// ─── Public paths that don't require authentication ─────────────────
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/check-superadmin',
  '/api/health',
  '/api/health/ready',
  '/api/pwa/',              // PWA customer public endpoints (icon, manifest, /[code]/*)
  '/api/payment/',          // Customer payment page
  '/api/pwa-orders/pending', // PWA public order submission
  '/api/pwa-orders/approve', // PWA order approval callback
  '/api/setup-schema',      // Initial setup
  '/api/generate-image',    // Image generation endpoint
  '/api/export/',           // Export endpoints (have own auth)
  '/api/settings',          // Public settings (company name, logo — route handles auth internally)
];

// ─── Rate limiting (in-memory, Edge compatible) ─────────────────────
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Separate stores for different rate limit tiers
const _globalStore = new Map<string, RateLimitEntry>();
const _authStore = new Map<string, RateLimitEntry>();
const _publicStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  const cleanup = (store: Map<string, RateLimitEntry>) => {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  };
  cleanup(_globalStore);
  cleanup(_authStore);
  cleanup(_publicStore);
}, 5 * 60 * 1000);
if (_cleanupTimer.unref) _cleanupTimer.unref();

// Max store size to prevent memory leaks (10K entries each)
const MAX_STORE_SIZE = 10_000;

function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  windowMs: number,
  maxRequests: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // Evict oldest entries if store is too large
    if (store.size >= MAX_STORE_SIZE) {
      let count = 0;
      for (const k of store.keys()) {
        store.delete(k);
        if (++count >= 1000) break;
      }
    }
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

// Rate limit configs
const GLOBAL_LIMIT = { windowMs: 60 * 1000, max: 300 };      // 300/min per IP
const AUTH_LIMIT = { windowMs: 60 * 1000, max: 20 };         // 20/min per IP (login, register, etc.)
const STRICT_AUTH_LIMIT = { windowMs: 15 * 60 * 1000, max: 5 }; // 5/15min (register, forgot-password)

// ─── Security constants ─────────────────────────────────────────────
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB — Next.js default is 1MB for body parser
const AUTH_TOKEN_MIN_LENGTH = 30;
const AUTH_TOKEN_MAX_LENGTH = 500;

// ─── Client IP extraction ───────────────────────────────────────────
function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

// ─── Security logging ───────────────────────────────────────────────
function logSecurityEvent(event: string, details: Record<string, string>) {
  // Only log in server context (not Edge preview)
  if (typeof console !== 'undefined') {
    console.warn(`[Security] ${event}`, JSON.stringify(details));
  }
}

// ====================================================================
// MAIN MIDDLEWARE
// ====================================================================

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Only apply to /api/ routes ──────────────────────────────────
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ─── Allow CORS preflight (OPTIONS) ──────────────────────────────
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Idempotency-Key',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const clientIp = getClientIp(request);

  // ─── Check body size from Content-Length header ───────────────────
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
    logSecurityEvent('BODY_TOO_LARGE', { ip: clientIp, path: pathname, size: contentLength });
    return NextResponse.json(
      { error: 'Request body terlalu besar' },
      { status: 413 }
    );
  }

  // ─── Allow public paths (with rate limiting) ─────────────────────
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));
  if (isPublic) {
    // Stricter rate limiting for auth-sensitive public endpoints
    const isStrictAuth = pathname.startsWith('/api/auth/register') ||
                          pathname.startsWith('/api/auth/forgot-password') ||
                          pathname.startsWith('/api/auth/reset-password');
    const isAuth = pathname.startsWith('/api/auth/');

    if (isStrictAuth) {
      const rl = checkRateLimit(_publicStore, `strict:${clientIp}`, STRICT_AUTH_LIMIT.windowMs, STRICT_AUTH_LIMIT.max);
      if (!rl.allowed) {
        logSecurityEvent('RATE_LIMITED_STRICT', { ip: clientIp, path: pathname, retryAfter: String(rl.retryAfter) });
        return NextResponse.json(
          { error: 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 900) } }
        );
      }
    } else if (isAuth) {
      const rl = checkRateLimit(_authStore, `auth:${clientIp}`, AUTH_LIMIT.windowMs, AUTH_LIMIT.max);
      if (!rl.allowed) {
        logSecurityEvent('RATE_LIMITED_AUTH', { ip: clientIp, path: pathname, retryAfter: String(rl.retryAfter) });
        return NextResponse.json(
          { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
        );
      }
    }

    return NextResponse.next();
  }

  // ─── Global rate limiting for all authenticated API routes ───────
  const globalRl = checkRateLimit(_globalStore, `global:${clientIp}`, GLOBAL_LIMIT.windowMs, GLOBAL_LIMIT.max);
  if (!globalRl.allowed) {
    logSecurityEvent('RATE_LIMITED_GLOBAL', { ip: clientIp, path: pathname, retryAfter: String(globalRl.retryAfter) });
    return NextResponse.json(
      { error: 'Terlalu banyak request. Coba lagi nanti.' },
      { status: 429, headers: { 'Retry-After': String(globalRl.retryAfter || 60) } }
    );
  }

  // ─── Check for Authorization header ──────────────────────────────
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    logSecurityEvent('MISSING_AUTH', { ip: clientIp, path: pathname });
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // ─── Basic token format validation ───────────────────────────────
  const token = authHeader.slice(7);
  if (token.length < AUTH_TOKEN_MIN_LENGTH || token.length > AUTH_TOKEN_MAX_LENGTH) {
    logSecurityEvent('INVALID_TOKEN_FORMAT', { ip: clientIp, path: pathname, tokenLen: String(token.length) });
    return NextResponse.json(
      { error: 'Token tidak valid' },
      { status: 401 }
    );
  }

  // ─── Block suspicious patterns in token ──────────────────────────
  // Tokens should be base64 of "userId:timestamp:hexSignature"
  // Reject tokens with obvious injection attempts
  if (/[<>'";\\{}]/.test(token)) {
    logSecurityEvent('SUSPICIOUS_TOKEN', { ip: clientIp, path: pathname });
    return NextResponse.json(
      { error: 'Token tidak valid' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

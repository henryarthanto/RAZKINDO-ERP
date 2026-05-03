// =====================================================================
// RATE LIMITER — In-memory rate limiting for API endpoints
// =====================================================================

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const _store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
const _rateLimitTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _store) {
    if (now > entry.resetAt) _store.delete(key);
  }
}, 5 * 60 * 1000);
if (_rateLimitTimer.unref) _rateLimitTimer.unref();

export function createRateLimiter(config: RateLimitConfig) {
  return function checkLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
    const key = `${config.keyPrefix}:${identifier}`;
    const now = Date.now();
    const entry = _store.get(key);

    if (!entry || now > entry.resetAt) {
      _store.set(key, { count: 1, resetAt: now + config.windowMs });
      return { allowed: true };
    }

    if (entry.count >= config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }

    entry.count++;
    return { allowed: true };
  };
}

// Preset limiters
export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'register',
});

export const forgotPasswordLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 3,
  keyPrefix: 'forgot_pw',
});

// FIX: Add rate limiters for public endpoints
// PWA endpoints — 60 requests per minute per customer code
export const pwaOrderLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyPrefix: 'pwa_order',
});

export const pwaCashbackLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyPrefix: 'pwa_cashback',
});

export const paymentProofLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'payment_proof',
});

// Payment page lookup — 120 requests per minute per IP
export const paymentPageLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
  keyPrefix: 'payment_page',
});

// =====================================================================
// API WRAPPER — Graceful Degradation wrapper for API route handlers
//
// Provides a higher-order function that wraps API route handlers with:
// - Feature flag check
// - Circuit breaker integration
// - Timeout protection
// - Degraded response on failure
//
// Usage:
//   import { withGracefulDegradation } from '@/lib/api-wrapper';
//
//   const handler = withGracefulDegradation(
//     async (request) => { /* ... */ },
//     { featureName: 'transactions', timeoutMs: 15000 }
//   );
//   export async function POST(request) { return handler(request); }
// =====================================================================

import { NextRequest, NextResponse } from 'next/server';
import { withFallback, getDegradationLevel, featureFlags } from './graceful-degradation';

type RouteHandler = (request: NextRequest, context?: Record<string, unknown>) => Promise<NextResponse>;
type AnyHandler = (...args: any[]) => Promise<NextResponse>;

interface ApiWrapperConfig {
  /** Feature name for circuit breaker and feature flag tracking */
  featureName: string;
  /** Timeout in milliseconds (default: 15000) */
  timeoutMs?: number;
  /** Custom fallback response. Defaults to 503 with generic message. */
  fallback?: NextResponse;
}

/**
 * Wrap an API route handler with graceful degradation.
 *
 * Behavior:
 * 1. Checks if the overall degradation level is 'minimal' → returns 503
 * 2. Checks if the specific feature is disabled → returns 503
 * 3. Executes the handler with timeout protection
 * 4. On failure, records the failure in the circuit breaker
 * 5. If circuit breaker opens, auto-disables the feature for 60s
 * 6. Returns fallback response on any failure
 */
export function withGracefulDegradation(
  handler: AnyHandler,
  config: ApiWrapperConfig
): AnyHandler {
  const { featureName, timeoutMs = 15000, fallback } = config;

  const defaultFallback = NextResponse.json(
    { error: 'Layanan sedang mengalami gangguan. Coba beberapa saat lagi.', code: 'SERVICE_DEGRADED' },
    { status: 503 }
  );

  return async (...args: any[]): Promise<NextResponse> => {
    const [request, context] = args as [NextRequest, Record<string, unknown>?];

    const level = getDegradationLevel();
    if (level === 'minimal') {
      return NextResponse.json(
        { error: 'Sistem dalam mode terbatas. Beberapa fitur tidak tersedia.', code: 'DEGRADED_MINIMAL' },
        { status: 503 }
      );
    }

    // Check if feature is explicitly disabled
    if (!featureFlags.isFeatureEnabled(featureName)) {
      return NextResponse.json(
        { error: 'Fitur sedang dinonaktifkan sementara.', code: 'FEATURE_DISABLED' },
        { status: 503 }
      );
    }

    // Execute with circuit breaker + timeout
    try {
      const result = await withFallback(
        {
          featureName,
          fallback: fallback || defaultFallback,
          timeoutMs,
        },
        () => handler(request, context)
      );

      return result;
    } catch (error) {
      console.error(`[GracefulDegradation] Unhandled error in "${featureName}":`, error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Terjadi kesalahan server' },
        { status: 500 }
      );
    }
  };
}

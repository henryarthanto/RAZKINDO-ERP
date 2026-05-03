// =====================================================================
// SUPABASE WRAPPER — Circuit-breaker-protected Supabase queries
//
// Provides `safeQuery<T>(fn)` which wraps any Supabase call through the
// `supabaseCircuit` circuit breaker.  When the circuit is open the call
// is rejected immediately with a `CircuitOpenError` instead of hanging
// or timing out.
//
// Usage:
//   import { safeQuery } from '@/lib/supabase-wrapper';
//
//   const { data } = await safeQuery(() =>
//     db.from('products').select('*').eq('id', productId)
//   );
// =====================================================================

import { db } from '@/lib/supabase';
import { supabaseCircuit, CircuitOpenError } from '@/lib/circuit-breaker';

/**
 * Execute a Supabase query protected by the circuit breaker.
 *
 * If the circuit is OPEN the promise rejects with a `CircuitOpenError`
 * immediately (no network call is made).
 *
 * @param fn — A function that returns a Supabase query promise.
 * @returns The resolved value of `fn()`.
 * @throws  CircuitOpenError if the circuit is open.
 * @throws  The original Supabase error on any other failure.
 */
export async function safeQuery<T>(fn: () => Promise<T>): Promise<T> {
  return supabaseCircuit.execute(fn);
}

/**
 * Variant of `safeQuery` that catches `CircuitOpenError` and returns
 * a fallback value instead of throwing.
 *
 * Useful in situations where you want graceful degradation:
 *
 *   const products = await safeQueryWithFallback(
 *     () => db.from('products').select('*'),
 *     [],            // fallback: empty array
 *     'Product listing unavailable — service temporarily degraded.',
 *   );
 */
export async function safeQueryWithFallback<T>(
  fn: () => Promise<T>,
  fallback: T,
  _reason?: string,
): Promise<T> {
  try {
    return await supabaseCircuit.execute(fn);
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      // Circuit is open — return the fallback gracefully
      if (_reason) {
        console.warn(`[CircuitBreaker:supabase] ${_reason}`);
      }
      return fallback;
    }
    // Re-throw non-circuit errors (e.g. actual DB errors)
    throw error;
  }
}

/**
 * Re-export the raw `db` client for callers that intentionally want to
 * bypass the circuit breaker.
 */
export { db as rawDb };

/**
 * Re-export the circuit breaker instance so callers can check its state.
 */
export { supabaseCircuit };

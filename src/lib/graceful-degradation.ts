// =====================================================================
// GRACEFUL DEGRADATION - Fallback & Circuit Breaker Pattern
//
// Provides utilities for API routes to gracefully handle failures:
// - withFallback: Execute function with fallback on failure/timeout
// - featureFlags: Simple in-memory feature flag management
// - getDegradationLevel: Check overall system health
// =====================================================================

interface DegradationConfig {
  featureName: string;
  fallback: unknown;
  timeoutMs?: number;
  circuitBreakerName?: string;
}

// ---------------------------------------------------------------------------
// Circuit Breaker (simple in-memory)
// ---------------------------------------------------------------------------

interface CircuitState {
  name: string;
  failures: number;
  lastFailureAt: Date | null;
  isOpen: boolean;
  openUntil: Date | null;
  halfOpenAttempts: number;
}

const MAX_FAILURES = 5;
const OPEN_DURATION_MS = 30_000; // 30 seconds before half-open

const circuitBreakers = new Map<string, CircuitState>();

function getCircuit(name: string): CircuitState {
  let c = circuitBreakers.get(name);
  if (!c) {
    c = {
      name,
      failures: 0,
      lastFailureAt: null,
      isOpen: false,
      openUntil: null,
      halfOpenAttempts: 0,
    };
    circuitBreakers.set(name, c);
  }
  return c;
}

function recordSuccess(name: string): void {
  const c = getCircuit(name);
  c.failures = 0;
  c.isOpen = false;
  c.openUntil = null;
  c.halfOpenAttempts = 0;
}

function recordFailure(name: string): void {
  const c = getCircuit(name);
  c.failures += 1;
  c.lastFailureAt = new Date();
  c.halfOpenAttempts += 1;

  if (c.failures >= MAX_FAILURES) {
    c.isOpen = true;
    c.openUntil = new Date(Date.now() + OPEN_DURATION_MS);
    console.warn(
      `[CircuitBreaker] "${name}" opened after ${c.failures} failures. Will retry at ${c.openUntil.toISOString()}`
    );
  }
}

function isCircuitOpen(name: string): boolean {
  const c = getCircuit(name);
  if (!c.isOpen) return false;
  // Check if we can transition to half-open
  if (c.openUntil && Date.now() >= c.openUntil.getTime()) {
    c.isOpen = false;
    c.halfOpenAttempts = 0;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Feature Flags (simple in-memory)
// ---------------------------------------------------------------------------

interface DisabledFeature {
  name: string;
  disabledAt: Date;
  reEnableAt: Date | null;
  reason?: string;
}

const disabledFeatures = new Map<string, DisabledFeature>();

export const featureFlags = {
  /**
   * Check if a feature is currently enabled.
   * Auto re-enables if the disable duration has expired.
   */
  isFeatureEnabled(name: string): boolean {
    const entry = disabledFeatures.get(name);
    if (!entry) return true;

    if (entry.reEnableAt && Date.now() >= entry.reEnableAt.getTime()) {
      disabledFeatures.delete(name);
      console.info(`[FeatureFlag] "${name}" auto re-enabled (duration expired)`);
      return true;
    }

    return false;
  },

  /**
   * Disable a feature. If durationMs is provided, it will auto re-enable.
   * Otherwise it stays disabled until explicitly re-enabled.
   */
  disableFeature(name: string, durationMs?: number, reason?: string): void {
    const reEnableAt = durationMs ? new Date(Date.now() + durationMs) : null;
    disabledFeatures.set(name, { name, disabledAt: new Date(), reEnableAt, reason });
    console.warn(
      `[FeatureFlag] "${name}" disabled${durationMs ? ` for ${durationMs}ms` : ''}${reason ? `: ${reason}` : ''}`
    );
  },

  /**
   * Re-enable a previously disabled feature.
   */
  enableFeature(name: string): void {
    if (disabledFeatures.has(name)) {
      disabledFeatures.delete(name);
      console.info(`[FeatureFlag] "${name}" re-enabled`);
    }
  },

  /**
   * Get list of all currently disabled feature names.
   */
  getDisabledFeatures(): string[] {
    // Clean up expired ones first
    const now = Date.now();
    for (const [name, entry] of disabledFeatures) {
      if (entry.reEnableAt && now >= entry.reEnableAt.getTime()) {
        disabledFeatures.delete(name);
      }
    }
    return Array.from(disabledFeatures.keys());
  },
};

// ---------------------------------------------------------------------------
// withFallback
// ---------------------------------------------------------------------------

/**
 * Execute an async function with graceful degradation:
 * 1. Check if feature is force-disabled via feature flags
 * 2. If circuit breaker is open, return fallback immediately
 * 3. Try executing with timeout
 * 4. On failure, return fallback + log warning
 */
export async function withFallback<T>(
  config: DegradationConfig,
  fn: () => Promise<T>
): Promise<T> {
  const { featureName, fallback, timeoutMs = 5000, circuitBreakerName } = config;
  const cbName = circuitBreakerName || featureName;

  // 1. Check if feature is force-disabled
  if (!featureFlags.isFeatureEnabled(featureName)) {
    console.warn(`[Degradation] "${featureName}" is disabled, returning fallback`);
    return fallback as T;
  }

  // 2. If circuit breaker is open, return fallback immediately
  if (isCircuitOpen(cbName)) {
    console.warn(`[Degradation] Circuit breaker "${cbName}" is open, returning fallback`);
    return fallback as T;
  }

  // 3. Try executing with timeout
  try {
    let timeoutId!: ReturnType<typeof setTimeout>;
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        timeoutId = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    // Clear timeout if fn() resolved first
    clearTimeout(timeoutId);

    // Success — record it for the circuit breaker
    recordSuccess(cbName);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Record failure for circuit breaker
    recordFailure(cbName);

    // Auto-disable feature if circuit breaker just opened
    if (isCircuitOpen(cbName)) {
      featureFlags.disableFeature(featureName, 60_000, `Circuit breaker opened: ${message}`);
    }

    console.warn(`[Degradation] "${featureName}" failed: ${message}. Returning fallback.`);
    return fallback as T;
  }
}

// ---------------------------------------------------------------------------
// Degradation Level
// ---------------------------------------------------------------------------

/** Core features that must always work — if these are disabled, level is 'minimal' */
const CORE_FEATURES = ['auth', 'db_read', 'api_health'];

/**
 * Get the current degradation level:
 * - 'full': everything works (no features disabled)
 * - 'partial': some non-critical features disabled
 * - 'minimal': only core features (auth, read) working
 */
export function getDegradationLevel(): 'full' | 'partial' | 'minimal' {
  const disabled = featureFlags.getDisabledFeatures();
  const disabledSet = new Set(disabled);

  // Check if any core feature is disabled
  const coreDisabled = CORE_FEATURES.some((f) => disabledSet.has(f));
  if (coreDisabled || disabled.length >= 5) {
    return 'minimal';
  }

  if (disabled.length > 0) {
    return 'partial';
  }

  return 'full';
}

// ---------------------------------------------------------------------------
// Exports for testing / advanced usage
// ---------------------------------------------------------------------------

export { recordSuccess as _cbSuccess, recordFailure as _cbFail, isCircuitOpen as _cbIsOpen };

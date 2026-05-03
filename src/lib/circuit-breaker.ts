// =====================================================================
// CIRCUIT BREAKER — Resilience pattern for protecting async operations
// against cascading failures (e.g. external services, database calls).
//
// States:
//   CLOSED   — Normal operation, requests pass through.
//   OPEN     — Failures exceeded threshold, requests are rejected fast.
//   HALF-OPEN — After resetTimeout, one probe request is allowed.
//               Success → CLOSED, Failure → OPEN.
// =====================================================================

import { CIRCUIT_BREAKER } from './stb-config';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens (default: 5) */
  failureThreshold: number;
  /** Milliseconds to wait before transitioning from open → half-open (default: 30000) */
  resetTimeout: number;
  /** Number of test requests allowed in half-open state (default: 1) */
  halfOpenMaxAttempts: number;
  /** Optional: milliseconds between automatic health-monitor intervals (default: 10000) */
  monitorInterval?: number;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  openedAt?: Date;
}

/** Thrown when the circuit is open and a request is rejected. */
export class CircuitOpenError extends Error {
  constructor(public readonly breakerName: string, public readonly openedAt: Date) {
    super(`Circuit breaker "${breakerName}" is OPEN since ${openedAt.toISOString()}. Requests are rejected.`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  // ----------------------------------------------------------------
  // Static registry — allows monitoring all circuit breakers at once
  // ----------------------------------------------------------------
  private static readonly instances = new Map<string, CircuitBreaker>();

  /**
   * Get an existing circuit breaker by name, or create a new one with the
   * provided config if it doesn't exist yet.
   */
  static get(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    let instance = CircuitBreaker.instances.get(name);
    if (!instance) {
      instance = new CircuitBreaker(name, config);
      CircuitBreaker.instances.set(name, instance);
    }
    return instance;
  }

  /** Return a snapshot of every registered circuit breaker's stats. */
  static getAllStats(): { name: string; state: CircuitState; failures: number }[] {
    return Array.from(CircuitBreaker.instances.values()).map((cb) => ({
      name: cb.name,
      state: cb.state,
      failures: cb.failures,
    }));
  }

  /** Remove a breaker from the registry and clear its monitor timer. */
  static dispose(name: string): void {
    const instance = CircuitBreaker.instances.get(name);
    if (instance) {
      instance.clearMonitor();
      CircuitBreaker.instances.delete(name);
    }
  }

  // ----------------------------------------------------------------
  // Instance fields
  // ----------------------------------------------------------------
  readonly name: string;
  readonly config: Required<CircuitBreakerConfig>;

  private _state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private openedAt?: Date;
  private halfOpenAttempts = 0;
  private monitorTimer?: ReturnType<typeof setInterval>;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeout: config?.resetTimeout ?? 30000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 1,
      monitorInterval: config?.monitorInterval ?? 10000,
    };

    // Register in the static map
    CircuitBreaker.instances.set(name, this);

    // Start the auto-monitor if an interval is configured
    if (this.config.monitorInterval > 0) {
      this.startMonitor();
    }
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  /** Execute an async function through the circuit breaker. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Fast-fail when the circuit is open
    if (this._state === 'open') {
      if (this.shouldTransitionToHalfOpen()) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitOpenError(this.name, this.openedAt!);
      }
    }

    // In half-open, limit concurrent probe requests
    if (this._state === 'half-open') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        throw new CircuitOpenError(this.name, this.openedAt!);
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /** Return a snapshot of the current circuit breaker state. */
  getStats(): CircuitStats {
    return {
      state: this._state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure ? new Date(this.lastFailure) : undefined,
      lastSuccess: this.lastSuccess ? new Date(this.lastSuccess) : undefined,
      openedAt: this.openedAt ? new Date(this.openedAt) : undefined,
    };
  }

  /** Manually reset the circuit breaker to closed state. */
  reset(): void {
    this._state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.lastFailure = undefined;
    this.lastSuccess = undefined;
    this.openedAt = undefined;
    this.halfOpenAttempts = 0;
  }

  /** Manually trip the breaker — forces it into the open state. */
  forceOpen(): void {
    this._state = 'open';
    this.openedAt = new Date();
    this.halfOpenAttempts = 0;
  }

  /** Current state of the breaker. */
  get state(): CircuitState {
    // Auto-transition check for monitoring purposes
    if (this._state === 'open' && this.shouldTransitionToHalfOpen()) {
      this.transitionTo('half-open');
    }
    return this._state;
  }

  /** Destroy this breaker — clears monitor timer and removes from registry. */
  dispose(): void {
    this.clearMonitor();
    CircuitBreaker.instances.delete(this.name);
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------

  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = new Date();

    if (this._state === 'half-open') {
      this.transitionTo('closed');
    }

    // In closed state, reset the failure counter on every success
    if (this._state === 'closed') {
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this._state === 'half-open') {
      // Probe failed → back to open
      this.transitionTo('open');
    } else if (this._state === 'closed') {
      if (this.failures >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  private shouldTransitionToHalfOpen(): boolean {
    if (!this.openedAt) return true;
    const elapsed = Date.now() - this.openedAt.getTime();
    return elapsed >= this.config.resetTimeout;
  }

  private transitionTo(newState: CircuitState): void {
    const prev = this._state;
    this._state = newState;

    if (newState === 'open') {
      this.openedAt = new Date();
      this.halfOpenAttempts = 0;
    } else if (newState === 'half-open') {
      this.halfOpenAttempts = 0;
    } else if (newState === 'closed') {
      this.failures = 0;
      this.halfOpenAttempts = 0;
    }
  }

  private startMonitor(): void {
    if (this.monitorTimer) return;
    this.monitorTimer = setInterval(() => {
      // Accessing .state triggers the auto-transition check
      void this.state;
    }, this.config.monitorInterval);

    // Allow the process to exit even if the timer is active
    if (this.monitorTimer.unref) {
      this.monitorTimer.unref();
    }
  }

  private clearMonitor(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }
  }
}

// =====================================================================
// Pre-configured instance for Supabase operations
// =====================================================================

export const supabaseCircuit = new CircuitBreaker('supabase', {
  failureThreshold: CIRCUIT_BREAKER.failureThreshold,
  resetTimeout: CIRCUIT_BREAKER.resetTimeoutMs,
});

// =====================================================================
// HOF — wrap any Next.js API route handler with circuit breaker protection
// =====================================================================

type NextApiHandler = (...args: any[]) => Promise<Response>;

/**
 * Higher-order function that wraps a Next.js Route Handler with a circuit breaker.
 *
 * @example
 * ```ts
 * const handler = withCircuitBreaker('my-api', async (req: Request) => {
 *   return NextResponse.json({ ok: true });
 * });
 * export { handler as GET, handler as POST };
 * ```
 */
export function withCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> | undefined,
  handler: NextApiHandler,
): NextApiHandler;
export function withCircuitBreaker(
  name: string,
  handler: NextApiHandler,
): NextApiHandler;
export function withCircuitBreaker(
  name: string,
  configOrHandler: Partial<CircuitBreakerConfig> | NextApiHandler | undefined,
  maybeHandler?: NextApiHandler,
): NextApiHandler {
  const breaker = CircuitBreaker.get(
    name,
    typeof configOrHandler === 'function' ? undefined : configOrHandler,
  );
  const handler = typeof configOrHandler === 'function' ? configOrHandler : maybeHandler!;

  return async (...args: any[]) => {
    try {
      return await breaker.execute(() => handler(...args));
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        return new Response(
          JSON.stringify({ error: 'Service temporarily unavailable', circuit: name }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw error;
    }
  };
}

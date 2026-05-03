// =====================================================================
// SUPABASE REST CLIENT — Real @supabase/supabase-js connection
//
// Creates a real Supabase client that connects to the remote Supabase
// PostgreSQL project via HTTPS REST API (no direct DB connection needed).
//
// This is the single source of truth for the Supabase connection config.
// All other modules that need the real Supabase client should import
// from here.
//
// LAZY INIT: Config is validated at first use (runtime), not at import
// time. This allows Docker builds to succeed without env vars present.
// The .env file provides the actual values at runtime.
//
// Exports:
//   supabaseRestClient — real Supabase client (lazy singleton)
//   getSupabaseConfig() — returns validated config (throws if missing)
// =====================================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────────────────────────────
// CONFIGURATION — Lazy (validated at first runtime use, not build time)
// ─────────────────────────────────────────────────────────────────────

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let _cachedConfig: SupabaseConfig | null = null;

/**
 * Get validated Supabase configuration.
 * Throws if required env vars are missing.
 * Results are cached after first successful call.
 */
export function getSupabaseConfig(): SupabaseConfig {
  if (_cachedConfig) return _cachedConfig;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required in .env');

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required in .env');

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in .env');

  _cachedConfig = { url, anonKey, serviceKey };
  return _cachedConfig;
}

// ─────────────────────────────────────────────────────────────────────
// BACKWARD-COMPATIBLE EXPORTS (lazy getters)
// ─────────────────────────────────────────────────────────────────────

/** Supabase project URL — lazy getter, validated at first access */
export let SUPABASE_URL = '';
/** Supabase anon key — lazy getter, validated at first access */
export let SUPABASE_ANON_KEY = '';
/** Supabase service role key — lazy getter, validated at first access */
export let SUPABASE_SERVICE_KEY = '';

/**
 * Ensure backward-compat exports are populated.
 * Called lazily before any access.
 */
function ensureConfig(): void {
  if (!SUPABASE_URL) {
    try {
      const config = getSupabaseConfig();
      SUPABASE_URL = config.url;
      SUPABASE_ANON_KEY = config.anonKey;
      SUPABASE_SERVICE_KEY = config.serviceKey;
    } catch {
      // Config not available yet (build time or env vars missing)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// CLIENT SINGLETON (lazy initialization)
// ─────────────────────────────────────────────────────────────────────

const globalForSupabase = globalThis as unknown as {
  supabaseRestClient: SupabaseClient | undefined;
};

function createSupabaseClient(): SupabaseClient {
  const config = getSupabaseConfig();
  return createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: {
      schema: 'public',
    },
    global: {
      fetch: (url: string, options: RequestInit = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s per-request timeout
        if (options.signal) {
          options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
      },
    },
  });
}

/**
 * Real Supabase client connected to the remote project.
 * Lazily created on first property access — allows Docker builds without env vars.
 */
export const supabaseRestClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    // Ensure config is populated for backward-compat string exports
    ensureConfig();

    // Create client lazily
    if (!globalForSupabase.supabaseRestClient) {
      globalForSupabase.supabaseRestClient = createSupabaseClient();
    }

    const client = globalForSupabase.supabaseRestClient!;
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') return value.bind(client);
    return value;
  },
  has(_target, prop) {
    return prop in (globalForSupabase.supabaseRestClient || {});
  },
  ownKeys() {
    return Object.keys(globalForSupabase.supabaseRestClient || {});
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (!globalForSupabase.supabaseRestClient) return undefined;
    return Object.getOwnPropertyDescriptor(globalForSupabase.supabaseRestClient, prop);
  },
});

// Persist singleton in development to survive HMR
if (process.env.NODE_ENV !== 'production') {
  try {
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      globalForSupabase.supabaseRestClient = createSupabaseClient();
    }
  } catch {
    // Env vars not set yet — lazy init will handle it
  }
}

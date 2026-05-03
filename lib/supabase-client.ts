// =====================================================================
// SUPABASE CLIENT - Client-side only
// Uses the anon key for browser-side access (respects RLS).
// Import this in 'use client' components only.
// =====================================================================

'use client';

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[Supabase Client] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Client-side Supabase features (realtime, subscriptions) will be unavailable. ' +
    'Server-side API routes will continue to work normally.'
  );
}

/**
 * Client-side browser Supabase instance.
 * - Respects Row Level Security (RLS) policies
 * - Supports cookie-based session persistence
 * - Auto-refreshes auth tokens
 *
 * Falls back to a dummy client if env vars are missing to prevent crashes.
 * API routes use the server-side supabaseAdmin client instead.
 */
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: !!supabaseUrl && !!supabaseAnonKey,
      detectSessionInUrl: !!supabaseUrl && !!supabaseAnonKey,
    },
    db: {
      schema: 'public',
    },
  }
);

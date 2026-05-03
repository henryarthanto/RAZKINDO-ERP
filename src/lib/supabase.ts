// =====================================================================
// SUPABASE CLIENT — Full Supabase PostgreSQL Backend
//
// All database operations go to Supabase PostgreSQL:
//   .from()  → Supabase PostgREST API (real-time queries)
//   .rpc()   → Prisma-backed handlers (connected to Supabase via PgBouncer)
//   .auth    → Supabase Auth
//   .storage → Supabase Storage
//
// Connection: PgBouncer (IPv4) → Supabase PostgreSQL (ap-southeast-1)
//
// Exports:
//   db             — main query client
//   supabaseAdmin  — alias for db
//   prisma         — raw Prisma Client for complex queries
// =====================================================================

import { PrismaClient } from '@prisma/client';
import { supabaseRestClient } from './supabase-rest';

// ─────────────────────────────────────────────────────────────────────
// PRISMA CLIENT (singleton) — connects to Supabase via PgBouncer
// ─────────────────────────────────────────────────────────────────────

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };
export const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────

export type PostgrestError = { message: string; code: string };
export type PostgrestResult<T = any> = { data: T | null; error: PostgrestError | null; count?: number; status?: number; statusText?: string };

// RPC IMPLEMENTATIONS
// ─────────────────────────────────────────────────────────────────────

type RpcFunction = (params: Record<string, any>) => Promise<PostgrestResult>;

// Local RPC handlers are disabled — all RPC calls go to real PostgreSQL functions
// deployed via ensure-rpc.ts on server startup. This ensures atomic operations
// use the actual DB-level functions instead of Prisma-based approximations.
// Previously, local Prisma handlers intercepted calls like decrement_stock,
// increment_stock, etc., but they failed due to DATABASE_URL pgbouncer params.
const rpcHandlers: Record<string, RpcFunction> = {};

// ─────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT OBJECT (real Supabase + real PostgreSQL RPC)
// ─────────────────────────────────────────────────────────────────────

/**
 * Main database client that uses the real Supabase REST API for queries,
 * with real PostgreSQL RPC functions for atomic operations.
 *
 * Usage:
 *   db.from('users').select('*')                    → real Supabase REST
 *   db.from('users').select('*').eq('id', '123')   → real Supabase REST
 *   db.from('users').insert(data).select()          → real Supabase REST
 *   db.rpc('decrement_stock', { ... })              → real PostgreSQL RPC
 *   db.rpc('get_supabase_stats')                    → real Supabase RPC
 */
const supabaseClient = {
  /**
   * Start a query on a table.
   * Delegates to the real Supabase REST API client.
   * Returns the native PostgREST query builder with full chaining support:
   *   .select().eq().neq().gt().gte().lt().lte().in().is().not()
   *   .ilike().like().or().order().limit().range().single().maybeSingle()
   *   .insert().update().delete().upsert()
   */
  from(tableName: string) {
    return supabaseRestClient.from(tableName);
  },

  /**
   * Call an RPC function.
   * First checks local Prisma-backed handlers (for stock ops, etc.).
   * Falls back to the real Supabase RPC for unregistered functions
   * (e.g., get_supabase_stats, database functions).
   */
  async rpc(fnName: string, params: Record<string, any> = {}): Promise<PostgrestResult> {
    // Try local Prisma-backed handler first
    const handler = rpcHandlers[fnName];
    if (handler) {
      try {
        return await handler(params);
      } catch (error) {
        console.error(`[SupabaseClient] Local RPC "${fnName}" error:`, error);
        const msg = error instanceof Error ? error.message : String(error);
        return { data: null, error: { message: msg, code: 'PGRST116' } };
      }
    }

    // Fallback: call real Supabase RPC function
    try {
      const result = await supabaseRestClient.rpc(fnName as any, params as any);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message, code: String(result.error.code) } : null,
        count: (result as any).count,
        status: result.status,
        statusText: result.statusText,
      };
    } catch (error) {
      console.error(`[SupabaseClient] RPC "${fnName}" error (remote):`, error);
      const msg = error instanceof Error ? error.message : String(error);
      return { data: null, error: { message: msg, code: 'PGRST116' } };
    }
  },

  // ─── Real Supabase Auth (lazy) ────────────────────────────────
  get auth() { return (supabaseRestClient as any).auth; },

  // ─── Real Supabase Storage (lazy) ────────────────────────────────
  get storage() { return (supabaseRestClient as any).storage; },

  // ─── Realtime ─────────────────────────────────────────────────────
  channel: (...args: any[]): any => (supabaseRestClient as any).channel(...(args as [any])),
  removeChannel: (...args: any[]): any => (supabaseRestClient as any).removeChannel(...(args as [any])),
  removeAllChannels: (): any => (supabaseRestClient as any).removeAllChannels(),

  // ─── Table name helper for testing ────────────────────────────────
  get tableNameMap() {
    return null; // Not needed externally
  },
};

/**
 * Server-side admin client with full access.
 * Identical to `db` — provided for backward compatibility.
 */
export const supabaseAdmin = supabaseClient;

/**
 * Main database client.
 * Import this in all API routes: `import { db } from '@/lib/supabase'`
 */
export const db = supabaseClient;

// ─────────────────────────────────────────────────────────────────────
// RE-EXPORT TYPES
// ─────────────────────────────────────────────────────────────────────

// prisma is exported above as const

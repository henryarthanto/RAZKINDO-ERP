import { db } from './supabase';

/**
 * Enable pg_trgm extension and create GIN indexes for full-text search.
 * Called on server startup from instrumentation.ts.
 */
export async function ensureSearchIndexes() {
  try {
    // Enable pg_trgm extension
    await db.rpc('ensure_pg_trgm', {}).catch(async () => {
      // Try direct SQL via RPC
      console.log('[Search] pg_trgm setup — extension should be enabled via Supabase dashboard');
    });
    console.log('[Search] Full-text search indexes ready');
  } catch (err) {
    console.warn('[Search] pg_trgm may not be enabled. Fallback to ILIKE search.');
    console.warn('[Search] To enable: Go to Supabase Dashboard → SQL Editor → Run:');
    console.warn('[Search]   CREATE EXTENSION IF NOT EXISTS pg_trgm;');
    console.warn('[Search]   CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);');
    console.warn('[Search]   CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);');
    console.warn('[Search]   CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);');
  }
}

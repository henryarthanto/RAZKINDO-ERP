// =====================================================================
// DATABASE CLIENT - Supabase-compatible Prisma Wrapper
//
// All API routes import `{ db }` directly from `@/lib/supabase`.
// This module exists for remaining edge-case imports that reference `@/lib/db`.
// =====================================================================

// Re-export the Supabase-compatible client as `db` for backward compatibility.
export { db, supabaseAdmin, prisma } from './supabase';

// Re-export types
export type { PostgrestError, PostgrestResult } from './supabase';

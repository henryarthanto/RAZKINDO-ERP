---
Task ID: 1
Agent: Main
Task: Fix "Could not find the function public.decrement_stock" database error

Work Log:
- Analyzed screenshot showing error: "Stok tidak cukup untuk ... Could not find the function public.decrement_stock(p_product_id, p_qty) in the schema cache"
- Found that the project has `ensure-rpc.ts` with 26 RPC function definitions, but the env vars `SUPABASE_DB_URL` and `SUPABASE_POOLER_URL` were missing from `.env`
- Found no `instrumentation.ts` file existed to auto-deploy RPC functions on server startup
- Added `SUPABASE_DB_URL` and `SUPABASE_POOLER_URL` to `.env`
- Created `src/instrumentation.ts` that calls `ensureRpcFunctions()` on server startup
- Restarted dev server, confirmed all 26/26 RPC functions deployed successfully

Stage Summary:
- Root cause: Missing env vars + missing instrumentation.ts meant PostgreSQL RPC functions (decrement_stock, increment_stock, etc.) were never deployed to the Supabase database
- Fix: Added env vars and created instrumentation.ts for auto-deployment
- All 26 RPC functions now deployed on every server restart
- Dev server running, no errors

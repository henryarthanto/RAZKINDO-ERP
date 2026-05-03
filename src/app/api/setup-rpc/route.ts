import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getSessionPool } from '@/lib/connection-pool';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { RPC_DEFINITIONS } from '@/lib/ensure-rpc';

// Additional index statements (not RPCs, executed separately)
const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_transactions_customer_status ON transactions(customer_id, type, status, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_type_status_date ON transactions(type, status, payment_method, transaction_date);`,
  `CREATE INDEX IF NOT EXISTS idx_receivables_transaction ON receivables(transaction_id);`,
  `CREATE INDEX IF NOT EXISTS idx_receivables_assigned_status ON receivables(assigned_to_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_tx_items_product_date ON transaction_items(product_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(code) WHERE code IS NOT NULL;`,
];

// POST /api/setup-rpc
// Deploys atomic RPC functions to Supabase using shared definitions from ensure-rpc.ts
// This ensures setup-rpc and auto-deploy (instrumentation.ts) always stay in sync
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const allStatements = [
      ...RPC_DEFINITIONS.map(r => r.sql),
      ...INDEX_STATEMENTS,
    ];

    const dbUrl = process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
      return NextResponse.json({
        success: false,
        error: 'SUPABASE_DB_URL tidak tersedia. Jalankan manual via SQL Editor.',
        sql: allStatements,
      }, { status: 400 });
    }

    // Use session pool for DDL (CREATE OR REPLACE FUNCTION) and NOTIFY
    const { Pool } = await import('pg');
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
    });
    const client = await pool.connect();

    const deployed: string[] = [];
    const failed: string[] = [];

    try {
      for (const sql of allStatements) {
        try {
          await client.query(sql);
          // Extract function name from first SQL for the response
          const funcMatch = sql.match(/FUNCTION\s+(\w+)/);
          if (funcMatch) deployed.push(funcMatch[1]);
          const idxMatch = sql.match(/INDEX\s+IF\s+NOT\s+EXISTS\s+(\w+)/);
          if (idxMatch) deployed.push(idxMatch[1]);
        } catch (err: any) {
          const funcMatch = sql.match(/FUNCTION\s+(\w+)/);
          const name = funcMatch ? funcMatch[1] : 'unknown';
          failed.push(name);
          console.error(`[setup-rpc] Failed to deploy ${name}:`, err.message);
        }
      }

      // Notify PostgREST to reload schema on same connection
      try {
        await client.query("NOTIFY pgrst, 'reload schema'");
      } catch {
        // Non-critical
      }

      return NextResponse.json({
        success: failed.length === 0,
        message: failed.length === 0
          ? `${deployed.length}/${RPC_DEFINITIONS.length} RPC functions + indexes deployed successfully`
          : `Deployed ${deployed.length}, failed ${failed.length}`,
        deployed,
        failed: failed.length > 0 ? failed : undefined,
      });
    } catch (error: any) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

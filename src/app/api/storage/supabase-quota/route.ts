import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthUser } from '@/lib/token';
import { db as supabaseAdmin } from '@/lib/supabase';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Tables to count
const ALL_TABLES = [
  'users', 'units', 'products', 'unit_products', 'customers', 'suppliers',
  'transactions', 'transaction_items', 'payments', 'salary_payments',
  'bank_accounts', 'cash_boxes', 'finance_requests', 'fund_transfers',
  'company_debts', 'company_debt_payments', 'receivables', 'receivable_follow_ups',
  'sales_targets', 'courier_cash', 'courier_handovers', 'logs', 'events', 'settings',
  'customer_referral', 'cashback_config', 'cashback_log', 'cashback_withdrawal',
  'customer_prices', 'customer_follow_ups', 'password_resets', 'finance_ledger', 'user_units',
];

// Estimated average row sizes (bytes) per table — rough estimates for public schema tables
const AVG_ROW_SIZES: Record<string, number> = {
  users: 350,
  units: 200,
  products: 500,
  unit_products: 300,
  customers: 400,
  suppliers: 400,
  transactions: 1200,
  transaction_items: 400,
  payments: 800,
  salary_payments: 900,
  bank_accounts: 350,
  cash_boxes: 300,
  finance_requests: 1000,
  fund_transfers: 900,
  company_debts: 800,
  company_debt_payments: 500,
  receivables: 1000,
  receivable_follow_ups: 400,
  sales_targets: 300,
  courier_cash: 700,
  courier_handovers: 900,
  logs: 300,
  events: 500,
  settings: 500,
  customer_referral: 400,
  cashback_config: 300,
  cashback_log: 400,
  cashback_withdrawal: 500,
  customer_prices: 350,
  customer_follow_ups: 400,
  password_resets: 300,
  finance_ledger: 600,
  user_units: 200,
};

// Index overhead multiplier (typical PostgreSQL index overhead is ~30-50% of data size)
const INDEX_MULTIPLIER = 0.4;

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // === Measure database latency ===
    let dbLatencyMs: number | null = null;
    try {
      const latencyStart = Date.now();
      await supabaseAdmin.rpc('get_supabase_stats');
      dbLatencyMs = Date.now() - latencyStart;
    } catch {
      try {
        const latencyStart = Date.now();
        await supabaseAdmin.from('settings').select('id', { count: 'exact', head: true });
        dbLatencyMs = Date.now() - latencyStart;
      } catch {
        dbLatencyMs = null;
      }
    }

    // === APPROACH 1: Try RPC function for exact DB stats ===
    let rpcData: any = null;
    let rpcAvailable = false;
    try {
      const { data, error } = await supabaseAdmin.rpc('get_supabase_stats');
      if (!error && data) {
        rpcData = data;
        rpcAvailable = true;
      }
    } catch {
      // RPC function doesn't exist yet, fall back to estimates
    }

    // Free tier limits
    const DB_FREE_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
    const STORAGE_FREE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB

    if (rpcAvailable && rpcData) {
      // === Use exact data from RPC ===
      const dbSizeBytes = parseInt(rpcData.db_size_bytes) || 0;
      const indexSizeBytes = parseInt(rpcData.index_size_bytes) || 0;
      const pgVersion = (rpcData.pg_version || '').split(',')[0] || '';
      const dbName = rpcData.db_name || 'postgres';
      const dbPercentUsed = Math.min(Math.round((dbSizeBytes / DB_FREE_LIMIT_BYTES) * 100), 100);

      // Get row counts and table sizes if RPC returned them
      const rowCounts = rpcData.table_sizes 
        ? Object.fromEntries((rpcData.table_sizes as any[]).map((t: any) => [t.table_name, t.row_count || 0]))
        : {};

      // Get top tables by size if RPC returned them
      const topTables = rpcData.top_tables || [];

      return NextResponse.json({
        success: true,
        data: {
          database: {
            sizeBytes: dbSizeBytes,
            sizePretty: formatBytes(dbSizeBytes),
            freeLimitBytes: DB_FREE_LIMIT_BYTES,
            freeLimitPretty: formatBytes(DB_FREE_LIMIT_BYTES),
            usedPercent: dbPercentUsed,
            remainingBytes: Math.max(DB_FREE_LIMIT_BYTES - dbSizeBytes, 0),
            remainingPretty: formatBytes(Math.max(DB_FREE_LIMIT_BYTES - dbSizeBytes, 0)),
            plan: 'Free Tier',
            planLimitLabel: '500 MB',
          },
          storage: {
            freeLimitBytes: STORAGE_FREE_LIMIT_BYTES,
            freeLimitPretty: formatBytes(STORAGE_FREE_LIMIT_BYTES),
            plan: 'Free Tier',
            planLimitLabel: '1 GB',
          },
          indexes: {
            sizeBytes: indexSizeBytes,
            sizePretty: formatBytes(indexSizeBytes),
          },
          topTables,
          rowCounts,
          serverInfo: { dbName, pgVersion },
          source: 'rpc', // Exact data from database function
          latency: { dbLatencyMs },
          cloudProvider: {
            provider: 'AWS',
            region: 'Asia Pacific (Singapore)',
            regionCode: 'ap-southeast-1',
          },
          realtime: {
            maxConnections: 200,
            estimatedUsage: 'N/A',
            plan: 'Free Tier',
          },
        },
      });
    }

    // === APPROACH 2: Fall back to REST API estimates ===
    // Count all tables in parallel for faster response
    const countResults = await Promise.all(
      ALL_TABLES.map(async (table) => {
        try {
          const { count } = await supabaseAdmin
            .from(table)
            .select('*', { count: 'exact', head: true });
          return { table, rowCount: count || 0, error: false };
        } catch {
          return { table, rowCount: 0, error: true };
        }
      })
    );

    const rowCountMap: Record<string, number> = {};
    const tableEstimates: { tableName: string; estimatedBytes: number; rowCount: number }[] = [];

    let totalEstimatedBytes = 0;
    let totalIndexBytes = 0;

    for (const { table, rowCount, error: _ } of countResults) {
      rowCountMap[table] = rowCount;

      const avgRowSize = AVG_ROW_SIZES[table] || 400;
      const estimatedDataBytes = rowCount * avgRowSize;
      const estimatedIndexBytes = Math.round(estimatedDataBytes * INDEX_MULTIPLIER);
      const estimatedTotalBytes = estimatedDataBytes + estimatedIndexBytes;

      totalEstimatedBytes += estimatedDataBytes;
      totalIndexBytes += estimatedIndexBytes;

      if (rowCount > 0) {
        tableEstimates.push({
          tableName: table,
          estimatedBytes: estimatedTotalBytes,
          rowCount,
        });
      }
    }

    const dbSizeBytes = totalEstimatedBytes + totalIndexBytes;
    const dbPercentUsed = Math.min(Math.round((dbSizeBytes / DB_FREE_LIMIT_BYTES) * 100), 100);

    // Sort tables by estimated size
    tableEstimates.sort((a, b) => b.estimatedBytes - a.estimatedBytes);

    // Take top 15
    const topTables = tableEstimates.slice(0, 15).map((t, index) => ({
      schema: 'public',
      tableName: t.tableName,
      sizePretty: formatBytes(t.estimatedBytes),
      sizeBytes: t.estimatedBytes,
      dataSizePretty: formatBytes(t.estimatedBytes - Math.round(t.estimatedBytes * (INDEX_MULTIPLIER / (1 + INDEX_MULTIPLIER)))),
      indexSizePretty: formatBytes(Math.round(t.estimatedBytes * (INDEX_MULTIPLIER / (1 + INDEX_MULTIPLIER)))),
      isEstimate: true,
    }));

    return NextResponse.json({
      success: true,
      data: {
        database: {
          sizeBytes: dbSizeBytes,
          sizePretty: formatBytes(dbSizeBytes),
          freeLimitBytes: DB_FREE_LIMIT_BYTES,
          freeLimitPretty: formatBytes(DB_FREE_LIMIT_BYTES),
          usedPercent: dbPercentUsed,
          remainingBytes: Math.max(DB_FREE_LIMIT_BYTES - dbSizeBytes, 0),
          remainingPretty: formatBytes(Math.max(DB_FREE_LIMIT_BYTES - dbSizeBytes, 0)),
          plan: 'Free Tier',
          planLimitLabel: '500 MB',
          isEstimate: true,
        },
        storage: {
          freeLimitBytes: STORAGE_FREE_LIMIT_BYTES,
          freeLimitPretty: formatBytes(STORAGE_FREE_LIMIT_BYTES),
          plan: 'Free Tier',
          planLimitLabel: '1 GB',
        },
        indexes: {
          sizeBytes: totalIndexBytes,
          sizePretty: formatBytes(totalIndexBytes),
        },
        topTables,
        rowCounts: rowCountMap,
        serverInfo: {
          dbName: 'postgres',
          pgVersion: 'PostgreSQL 15.x (Supabase)',
        },
        source: 'estimate', // Data is estimated
        latency: { dbLatencyMs },
        cloudProvider: {
          provider: 'AWS',
          region: 'Asia Pacific (Singapore)',
          regionCode: 'ap-southeast-1',
        },
        realtime: {
          maxConnections: 200,
          estimatedUsage: 'N/A',
          plan: 'Free Tier',
        },
      },
    });
  } catch (error: any) {
    console.error('Supabase quota API error:', error.message);
    return NextResponse.json(
      { success: false, error: 'Gagal mengambil info kuota Supabase: ' + (error.message || 'Unknown error') },
      { status: 500 }
    );
  }
}

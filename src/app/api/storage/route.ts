import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

function getDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let totalSize = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next') { totalSize += 0; continue; }
        totalSize += getDirectorySize(fullPath);
      } else {
        try { totalSize += statSync(fullPath).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return totalSize;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const projectRoot = process.cwd();

    let diskInfo: { total: number; used: number; available: number; percent: number } | null = null;
    try {
      const dfOutput = execSync("df -B1 / | tail -1", { encoding: 'utf-8' });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 5) {
        const totalBytes = parseInt(parts[1]) || 0;
        const usedBytes = parseInt(parts[2]) || 0;
        const availableBytes = parseInt(parts[3]) || 0;
        diskInfo = {
          total: totalBytes,
          used: usedBytes,
          available: availableBytes,
          percent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
        };
      }
    } catch { diskInfo = null; }

    const directories = [
      { name: 'Source Code (src)', path: join(projectRoot, 'src') },
      { name: 'Build Cache (.next)', path: join(projectRoot, '.next') },
      { name: 'Dependencies (node_modules)', path: join(projectRoot, 'node_modules') },
      { name: 'Mini Services', path: join(projectRoot, 'mini-services') },
      { name: 'Public Assets', path: join(projectRoot, 'public') },
    ];
    const dirSizes: { name: string; size: number; formatted: string }[] = [];
    let projectTotal = 0;
    for (const dir of directories) {
      const size = getDirectorySize(dir.path);
      projectTotal += size;
      dirSizes.push({ name: dir.name, size, formatted: formatBytes(size) });
    }
    dirSizes.sort((a, b) => b.size - a.size);

    // Database metadata from Supabase connection string
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseDbUrl = process.env.SUPABASE_DB_URL || '';
    // Parse host and region from connection URL
    let dbHost = '';
    let dbRegion = 'ap-southeast-1';
    if (supabaseDbUrl) {
      try {
        const urlMatch = supabaseDbUrl.match(/@([^.]+)\.([^.]+)\./);
        if (urlMatch) {
          dbHost = `${urlMatch[1]}.${urlMatch[2]}.supabase.co`;
          dbRegion = urlMatch[2].replace('pooler.', '').replace('aws-1-', '');
        }
      } catch { /* keep defaults */ }
    }

    // Table row counts
    const tables = ['users', 'units', 'products', 'unit_products', 'customers', 'suppliers', 'transactions', 'transaction_items', 'payments', 'salary_payments', 'bank_accounts', 'cash_boxes', 'finance_requests', 'fund_transfers', 'company_debts', 'company_debt_payments', 'receivables', 'receivable_follow_ups', 'sales_targets', 'courier_cash', 'courier_handovers', 'logs', 'events', 'settings'];
    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      const { count } = await db.from(table).select('*', { count: 'exact', head: true });
      tableCounts[table] = count || 0;
    }

    // Cleanable counts
    const cleanableCounts: Record<string, number> = {};
    const { count: oldLogs } = await db.from('logs').select('*', { count: 'exact', head: true }).lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    cleanableCounts['old_logs_30d'] = oldLogs || 0;
    const { count: oldReadEvents } = await db.from('events').select('*', { count: 'exact', head: true }).eq('is_read', true).lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    cleanableCounts['old_read_events_7d'] = oldReadEvents || 0;
    const { count: totalReadEvents } = await db.from('events').select('*', { count: 'exact', head: true }).eq('is_read', true);
    cleanableCounts['total_read_events'] = totalReadEvents || 0;
    const { count: rejectedFR } = await db.from('finance_requests').select('*', { count: 'exact', head: true }).eq('status', 'rejected');
    cleanableCounts['rejected_finance_requests'] = rejectedFR || 0;
    const { count: rejectedSalary } = await db.from('salary_payments').select('*', { count: 'exact', head: true }).eq('status', 'rejected');
    cleanableCounts['rejected_salary_payments'] = rejectedSalary || 0;
    const { count: cancelledReceivables } = await db.from('receivables').select('*', { count: 'exact', head: true }).eq('status', 'cancelled');
    cleanableCounts['cancelled_receivables'] = cancelledReceivables || 0;
    const { count: badDebtReceivables } = await db.from('receivables').select('*', { count: 'exact', head: true }).eq('status', 'bad_debt');
    cleanableCounts['bad_debt_receivables'] = badDebtReceivables || 0;
    const { count: totalLogs } = await db.from('logs').select('*', { count: 'exact', head: true });
    cleanableCounts['total_logs'] = totalLogs || 0;

    return NextResponse.json({ success: true, data: { disk: diskInfo ? { ...diskInfo, totalFormatted: formatBytes(diskInfo.total), usedFormatted: formatBytes(diskInfo.used), availableFormatted: formatBytes(diskInfo.available) } : null, project: { totalSize: projectTotal, totalFormatted: formatBytes(projectTotal), directories: dirSizes }, database: { type: 'Supabase (PostgreSQL)', host: dbHost, region: dbRegion, dbName: 'postgres', totalTables: tables.length, tableCounts }, cleanable: cleanableCounts } });
  } catch (error: any) {
    console.error('Storage API error:', error);
    return NextResponse.json({ success: false, error: 'Gagal mengambil info storage' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return NextResponse.json({ success: false, error: 'Akses ditolak' }, { status: authResult.response.status === 401 ? 401 : 403 });

    const body = await request.json();
    const { action, targets } = body;

    if (action === 'cleanup') {
      if (!targets || !Array.isArray(targets) || targets.length === 0) return NextResponse.json({ success: false, error: 'Pilih data yang ingin dibersihkan' }, { status: 400 });

      const results: Record<string, number> = {};
      for (const target of targets) {
        try {
          let count = 0;
          if (target === 'old_logs_30d') {
            const { error } = await db.from('logs').delete().lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
            count = error ? -1 : 0;
          } else if (target === 'rejected_finance_requests') {
            // First fetch salary_payment IDs that reference finance_requests, then exclude them
            const { data: linkedSalaryPayments } = await db.from('salary_payments').select('finance_request_id').not('finance_request_id', 'is', null);
            const excludeIds = (linkedSalaryPayments || []).map((r: any) => r.finance_request_id);
            let deleteQuery = db.from('finance_requests').delete().eq('status', 'rejected');
            if (excludeIds.length > 0) {
              deleteQuery = deleteQuery.not('id', 'in', excludeIds);
            }
            const { error } = await deleteQuery;
            count = error ? -1 : 0;
          } else if (target === 'rejected_salary_payments') {
            await db.from('salary_payments').update({ finance_request_id: null }).eq('status', 'rejected');
            const { error } = await db.from('salary_payments').delete().eq('status', 'rejected');
            count = error ? -1 : 0;
          } else if (target === 'cancelled_receivables') {
            const { data: cancelledIds } = await db.from('receivables').select('id').eq('status', 'cancelled');
            if (cancelledIds && cancelledIds.length > 0) {
              await db.from('receivable_follow_ups').delete().in('receivable_id', cancelledIds.map((r: any) => r.id));
            }
            const { error } = await db.from('receivables').delete().eq('status', 'cancelled');
            count = error ? -1 : 0;
          } else if (target === 'bad_debt_receivables') {
            const { data: badDebtIds } = await db.from('receivables').select('id').eq('status', 'bad_debt');
            if (badDebtIds && badDebtIds.length > 0) {
              await db.from('receivable_follow_ups').delete().in('receivable_id', badDebtIds.map((r: any) => r.id));
            }
            const { error } = await db.from('receivables').delete().eq('status', 'bad_debt');
            count = error ? -1 : 0;
          } else if (target === 'all_logs') {
            const { error } = await db.from('logs').delete().neq('id', '0');
            count = error ? -1 : 0;
          } else if (target === 'old_read_events_7d') {
            const { error } = await db.from('events').delete().eq('is_read', true).lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
            count = error ? -1 : 0;
          } else if (target === 'all_read_events') {
            const { error } = await db.from('events').delete().eq('is_read', true);
            count = error ? -1 : 0;
          }
          results[target] = count;
        } catch (err: any) { console.error(`Cleanup error for ${target}:`, err); results[target] = -1; }
      }

      return NextResponse.json({ success: true, message: 'Cleanup berhasil dilakukan', results });
    }

    if (action === 'backup') {
      // Backup all tables from Supabase
      const allTables = ['users', 'units', 'products', 'unit_products', 'customers', 'suppliers', 'transactions', 'transaction_items', 'payments', 'salary_payments', 'bank_accounts', 'cash_boxes', 'finance_requests', 'fund_transfers', 'company_debts', 'company_debt_payments', 'receivables', 'receivable_follow_ups', 'sales_targets', 'courier_cash', 'courier_handovers', 'logs', 'events', 'settings'];
      const backup: Record<string, any[]> = {};
      for (const table of allTables) {
        const { data } = await db.from(table).select('*');
        backup[table] = data || [];
      }
      return NextResponse.json({ success: true, data: backup, exportedAt: new Date().toISOString() });
    }

    return NextResponse.json({ success: false, error: 'Action tidak valid' }, { status: 400 });
  } catch (error: any) {
    console.error('Storage POST error:', error);
    return NextResponse.json({ success: false, error: 'Gagal memproses permintaan' }, { status: 500 });
  }
}

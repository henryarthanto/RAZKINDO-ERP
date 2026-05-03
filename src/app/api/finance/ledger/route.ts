import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { rowsToCamelCase, createLog } from '@/lib/supabase-helpers';
import { financeEngine } from '@/lib/finance-engine';

// GET /api/finance/ledger
// Banking-grade audit trail — immutable ledger of every financial balance change.
// Query params: startDate, endDate, accountType (pool|bank|cashbox), referenceType,
//                 journalId (exact match), referenceId, accountKey, page, limit
export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only finance/super_admin can view full ledger
    const { data: userData } = await db
      .from('users')
      .select('role')
      .eq('id', authUserId)
      .maybeSingle();
    if (!userData || !['super_admin', 'keuangan'].includes(userData.role)) {
      return NextResponse.json({ error: 'Akses ditolak. Hanya Super Admin dan Keuangan yang dapat melihat audit trail.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const accountType = searchParams.get('accountType'); // pool, bank, cashbox
    const referenceType = searchParams.get('referenceType');
    const journalId = searchParams.get('journalId');
    const referenceId = searchParams.get('referenceId');
    const accountKey = searchParams.get('accountKey');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '100')), 500);
    const offset = (page - 1) * limit;

    let query = db
      .from('finance_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate + 'T23:59:59');
    if (accountType) query = query.eq('account_type', accountType);
    if (referenceType) query = query.eq('reference_type', referenceType);
    if (journalId) query = query.eq('journal_id', journalId);
    if (referenceId) query = query.eq('reference_id', referenceId);
    if (accountKey) query = query.eq('account_key', accountKey);

    const { data: entries, error } = await query;
    if (error) throw error;

    // Also get total count (without limit) for pagination
    let countQuery = db.from('finance_ledger').select('id', { count: 'exact', head: true });
    if (startDate) countQuery = countQuery.gte('created_at', startDate);
    if (endDate) countQuery = countQuery.lte('created_at', endDate + 'T23:59:59');
    if (accountType) countQuery = countQuery.eq('account_type', accountType);
    if (referenceType) countQuery = countQuery.eq('reference_type', referenceType);
    if (journalId) countQuery = countQuery.eq('journal_id', journalId);
    if (referenceId) countQuery = countQuery.eq('reference_id', referenceId);
    if (accountKey) countQuery = countQuery.eq('account_key', accountKey);
    const { count } = await countQuery;

    // Compute summary statistics
    const allEntries = entries || [];
    const totalCredits = allEntries
      .filter((e: any) => (Number(e.delta) || 0) > 0)
      .reduce((sum: number, e: any) => sum + (Number(e.delta) || 0), 0);
    const totalDebits = allEntries
      .filter((e: any) => (Number(e.delta) || 0) < 0)
      .reduce((sum: number, e: any) => sum + Math.abs(Number(e.delta) || 0), 0);

    // Group by journalId for summary
    const journalIds = [...new Set(allEntries.map((e: any) => e.journal_id))];

    return NextResponse.json({
      entries: rowsToCamelCase(allEntries),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
      summary: {
        totalEntries: count || 0,
        uniqueJournals: journalIds.length,
        totalCredits: Math.round(totalCredits),
        totalDebits: Math.round(totalDebits),
        netFlow: Math.round(totalCredits - totalDebits),
      },
    });
  } catch (error) {
    console.error('Get finance ledger error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// POST /api/finance/ledger
// Actions: reconcile
export async function POST(request: NextRequest) {
  try {
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    const body = await request.json();
    const { action } = body;

    // === RECONCILE ===
    // Compare ledger-derived balances with actual stored balances.
    // Returns health status and any discrepancies found.
    if (action === 'reconcile') {
      const result = await financeEngine.reconcile();

      // Log the reconciliation
      try {
        createLog(db, {
          type: 'audit',
          action: 'ledger_reconciliation',
          entity: 'finance_ledger',
          userId: auth.userId,
          message: `Rekonsiliasi ledger: healthy=${result.isHealthy}, issues=${result.issues.length}`,
          payload: JSON.stringify(result),
        });
      } catch { /* ignore */ }

      return NextResponse.json({
        isHealthy: result.isHealthy,
        issues: result.issues,
        poolComparison: result.poolComparison,
        message: result.isHealthy
          ? 'Semua saldo konsisten dengan ledger.'
          : `${result.issues.length} ketidaksesuaian ditemukan. Periksa detail issues.`,
      });
    }

    return NextResponse.json({ error: 'Action tidak valid. Gunakan: reconcile' }, { status: 400 });
  } catch (error) {
    console.error('Finance ledger POST error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceSuperAdmin } from '@/lib/require-auth';

// Allowed tables for browsing (sensitive tables excluded)
const BROWSABLE_TABLES = [
  'logs',
  'events',
  'finance_requests',
  'salary_payments',
  'receivables',
  'receivable_follow_ups',
  'company_debts',
  'company_debt_payments',
  'fund_transfers',
  'transactions',
  'payments',
  'courier_cash',
  'courier_handovers',
];

// Status filter configs per table
const TABLE_STATUS_CONFIG: Record<string, { statusColumn: string; labelColumn?: string; statuses: { value: string; label: string }[] }> = {
  logs: { statusColumn: 'action', statuses: [] },
  events: { statusColumn: 'is_read', statuses: [{ value: 'true', label: 'Sudah Dibaca' }, { value: 'false', label: 'Belum Dibaca' }] },
  finance_requests: { statusColumn: 'status', labelColumn: 'description', statuses: [
    { value: 'pending', label: 'Menunggu' },
    { value: 'approved', label: 'Disetujui' },
    { value: 'processed', label: 'Selesai' },
    { value: 'rejected', label: 'Ditolak' },
  ]},
  salary_payments: { statusColumn: 'status', statuses: [
    { value: 'pending', label: 'Menunggu' },
    { value: 'approved', label: 'Disetujui' },
    { value: 'paid', label: 'Dibayar' },
    { value: 'rejected', label: 'Ditolak' },
  ]},
  receivables: { statusColumn: 'status', statuses: [
    { value: 'active', label: 'Aktif' },
    { value: 'paid', label: 'Lunas' },
    { value: 'cancelled', label: 'Dibatalkan' },
    { value: 'bad_debt', label: 'Macet' },
  ]},
  company_debts: { statusColumn: 'status', statuses: [
    { value: 'active', label: 'Aktif' },
    { value: 'paid', label: 'Lunas' },
  ]},
  fund_transfers: { statusColumn: 'status', statuses: [
    { value: 'pending', label: 'Menunggu' },
    { value: 'approved', label: 'Disetujui' },
    { value: 'completed', label: 'Selesai' },
    { value: 'rejected', label: 'Ditolak' },
  ]},
  transactions: { statusColumn: 'status', statuses: [
    { value: 'pending', label: 'Menunggu' },
    { value: 'approved', label: 'Disetujui' },
    { value: 'cancelled', label: 'Dibatalkan' },
  ]},
};

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Akses ditolak' }, { status: authResult.response.status === 401 ? 401 : 403 });
    }

    const { searchParams } = new URL(request.url);
    const table = searchParams.get('table');
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const search = searchParams.get('search') || '';

    if (!table || !BROWSABLE_TABLES.includes(table)) {
      return NextResponse.json(
        { success: false, error: 'Tabel tidak valid. Tabel yang tersedia: ' + BROWSABLE_TABLES.join(', ') },
        { status: 400 }
      );
    }

    let query = db.from(table).select('*', { count: 'exact' });

    // Apply status filter
    if (status && TABLE_STATUS_CONFIG[table]?.statuses.some(s => s.value === status)) {
      const config = TABLE_STATUS_CONFIG[table];
      if (config.statusColumn === 'is_read') {
        query = (query as any).eq(config.statusColumn, status === 'true');
      } else {
        query = (query as any).eq(config.statusColumn, status);
      }
    }

    // Apply search (on description or name columns)
    if (search) {
      const safeSearch = search.replace(/[%_().']/g, '');
      if (safeSearch) {
        const labelCol = TABLE_STATUS_CONFIG[table]?.labelColumn || 'description';
        query = (query as any).or(`${labelCol}.ilike.%${safeSearch}%`);
      }
    }

    // Apply date filter for logs/events (older than N days)
    const olderThanDays = searchParams.get('older_than_days');
    if (olderThanDays) {
      const days = parseInt(olderThanDays);
      if (days > 0) {
        const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        query = (query as any).lt('created_at', cutoffDate);
      }
    }

    // Pagination
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = (query as any).order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: 'Query error: ' + error.message }, { status: 500 });
    }

    // Get status counts for the table
    const statusCounts: Record<string, number> = {};
    const config = TABLE_STATUS_CONFIG[table];
    if (config && config.statuses.length > 0) {
      for (const s of config.statuses) {
        let countQuery = db.from(table).select('*', { count: 'exact', head: true });
        if (config.statusColumn === 'is_read') {
          countQuery = (countQuery as any).eq(config.statusColumn, s.value === 'true');
        } else {
          countQuery = (countQuery as any).eq(config.statusColumn, s.value);
        }
        const { count: c } = await countQuery;
        statusCounts[s.value] = c || 0;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        records: data || [],
        total: count || 0,
        page,
        limit,
        totalPages: Math.ceil((count || 0) / limit),
        statusCounts,
      },
    });
  } catch (error: any) {
    console.error('Table data API error:', error);
    return NextResponse.json({ success: false, error: 'Gagal mengambil data: ' + error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) {
      return NextResponse.json({ success: false, error: 'Akses ditolak' }, { status: authResult.response.status === 401 ? 401 : 403 });
    }

    const body = await request.json();
    const { table, ids, filter } = body;

    if (!table || !BROWSABLE_TABLES.includes(table)) {
      return NextResponse.json({ success: false, error: 'Tabel tidak valid' }, { status: 400 });
    }

    if (!ids && !filter) {
      return NextResponse.json({ success: false, error: 'Berikan IDs atau filter untuk dihapus' }, { status: 400 });
    }

    let deletedCount = 0;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      // Delete specific IDs
      // For tables with foreign key relations, clean up first
      if (table === 'receivables') {
        await db.from('receivable_follow_ups').delete().in('receivable_id', ids);
      }
      if (table === 'company_debts') {
        await db.from('company_debt_payments').delete().in('debt_id', ids);
      }

      const { error, count } = await db.from(table).delete().in('id', ids);
      if (error) throw new Error(error.message);
      deletedCount = ids.length;
    } else if (filter) {
      // Delete by filter (e.g., all rejected items)
      let query = db.from(table).delete();
      if (filter.status) {
        const config = TABLE_STATUS_CONFIG[table];
        if (config) {
          if (config.statusColumn === 'is_read') {
            query = (query as any).eq(config.statusColumn, filter.status === 'true');
          } else {
            query = (query as any).eq(config.statusColumn, filter.status);
          }
        }
      }
      if (filter.search) {
        const safeSearch = filter.search.replace(/[%_().']/g, '');
        if (safeSearch) {
          const labelCol = TABLE_STATUS_CONFIG[table]?.labelColumn || 'description';
          query = (query as any).or(`${labelCol}.ilike.%${safeSearch}%`);
        }
      }
      if (filter.older_than_days) {
        const days = parseInt(filter.older_than_days);
        if (days > 0) {
          const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
          query = (query as any).lt('created_at', cutoffDate);
        }
      }
      const { error } = await query;
      if (error) throw new Error(error.message);
      deletedCount = -1; // Unknown count for bulk delete
    }

    return NextResponse.json({
      success: true,
      message: `${deletedCount > 0 ? deletedCount + ' record' : 'Data'} berhasil dihapus`,
      deletedCount,
    });
  } catch (error: any) {
    console.error('Table data DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Gagal menghapus: ' + error.message }, { status: 500 });
  }
}

import { db } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAndGetAuthUser } from '@/lib/token';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';

/**
 * GET /api/superadmin/monitoring
 * Superadmin endpoint to monitor all inactive customers and follow-up activity across all sales.
 */
export async function GET(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (result.user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden — only super admin' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const unitId = searchParams.get('unitId') || undefined;
    const salesId = searchParams.get('salesId') || undefined;
    const statusFilter = searchParams.get('status') || undefined;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50') || 50));
    const offset = (page - 1) * limit;

    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    // ========== SUMMARY COUNTS ==========
    function baseCustomerQuery() {
      let q = db.from('customers').select('*', { count: 'exact', head: true });
      if (unitId) q = q.eq('unit_id', unitId);
      if (salesId) q = q.eq('assigned_to_id', salesId);
      return q;
    }

    // Split .or() into separate queries to avoid PostgREST filter chaining issues
    const [
      totalCustomersRes, totalActiveRes, totalLostRes,
      inactive30dLtRes, inactive60dLtRes, inactive90dLtRes,
      activeNullDateRes,
      noFollowUpLtRes, noFollowUpNullRes,
    ] = await Promise.all([
      baseCustomerQuery().neq('status', 'inactive'),
      baseCustomerQuery().eq('status', 'active'),
      baseCustomerQuery().eq('status', 'lost'),
      // Active customers with last transaction > 30/60/90 days ago
      baseCustomerQuery().eq('status', 'active').lt('last_transaction_date', thirtyDaysAgo.toISOString()),
      baseCustomerQuery().eq('status', 'active').lt('last_transaction_date', sixtyDaysAgo.toISOString()),
      baseCustomerQuery().eq('status', 'active').lt('last_transaction_date', ninetyDaysAgo.toISOString()),
      // Active customers with no transaction date at all (reused for all periods)
      baseCustomerQuery().eq('status', 'active').is('last_transaction_date', null),
      // Active customers with no follow-up AND (last transaction > 30d ago OR no transaction date)
      baseCustomerQuery().eq('status', 'active').is('last_follow_up_date', null).lt('last_transaction_date', thirtyDaysAgo.toISOString()),
      baseCustomerQuery().eq('status', 'active').is('last_follow_up_date', null).is('last_transaction_date', null),
    ]);

    const totalCustomers = totalCustomersRes.count || 0;
    const totalActive = totalActiveRes.count || 0;
    const totalLost = totalLostRes.count || 0;
    const totalInactive30d = (inactive30dLtRes.count || 0) + (activeNullDateRes.count || 0);
    const totalInactive60d = (inactive60dLtRes.count || 0) + (activeNullDateRes.count || 0);
    const totalInactive90d = (inactive90dLtRes.count || 0) + (activeNullDateRes.count || 0);
    const totalNoFollowUp = (noFollowUpLtRes.count || 0) + (noFollowUpNullRes.count || 0);

    // ========== SALES ACTIVITY ==========
    let salesQuery = db.from('users').select('id, name, role').eq('role', 'sales').eq('status', 'approved').eq('is_active', true);
    if (unitId) salesQuery = salesQuery.eq('unit_id', unitId);
    const { data: salesUsers } = await salesQuery.order('name', { ascending: true });

    // Get monthly follow-up counts
    const { data: salesFollowUpCounts } = await db.from('customer_follow_ups')
      .select('created_by_id')
      .gte('created_at', monthStart.toISOString());

    const followUpCountMap: Record<string, number> = {};
    for (const item of (salesFollowUpCounts || [])) {
      followUpCountMap[item.created_by_id] = (followUpCountMap[item.created_by_id] || 0) + 1;
    }

    // OPTIMIZATION: Replace N+1 queries with 2 batch aggregate queries
    const salesActivity: Array<{ id: string; name: string; totalCustomers: number; totalFollowUps: number; monthlyFollowUps: number }> = [];

    // Batch 1: Get assigned customer counts per sales user (single GROUP BY query)
    const { data: customerCounts } = await db
      .from('customers')
      .select('assigned_to_id')
      .neq('status', 'inactive');
    const customerCountMap: Record<string, number> = {};
    for (const c of (customerCounts || [])) {
      customerCountMap[c.assigned_to_id] = (customerCountMap[c.assigned_to_id] || 0) + 1;
    }

    // Batch 2: Get total follow-up counts per sales user (single GROUP BY query)
    const { data: totalFollowUps } = await db
      .from('customer_follow_ups')
      .select('created_by_id');
    const totalFUMap: Record<string, number> = {};
    for (const fu of (totalFollowUps || [])) {
      totalFUMap[fu.created_by_id] = (totalFUMap[fu.created_by_id] || 0) + 1;
    }

    // Build sales activity from pre-computed maps (O(n) instead of O(n) queries)
    for (const salesUser of (salesUsers || [])) {
      salesActivity.push({
        id: salesUser.id,
        name: salesUser.name,
        totalCustomers: customerCountMap[salesUser.id] || 0,
        totalFollowUps: totalFUMap[salesUser.id] || 0,
        monthlyFollowUps: followUpCountMap[salesUser.id] || 0,
      });
    }

    // ========== CUSTOMERS LIST (paginated) ==========
    let customerQuery = db.from('customers').select(`
      *,
      assigned_to:users!assigned_to_id(id, name, phone),
      unit:units(id, name),
      follow_ups:customer_follow_ups(*, created_by:users!created_by_id(id, name, role))
    `);

    if (unitId) customerQuery = customerQuery.eq('unit_id', unitId);
    if (salesId) customerQuery = customerQuery.eq('assigned_to_id', salesId);

    switch (statusFilter) {
      case 'inactive_30d':
        customerQuery = customerQuery.or(`and(status.eq.active,last_transaction_date.is.null),and(status.eq.active,last_transaction_date.lt.${thirtyDaysAgo.toISOString()})`);
        break;
      case 'inactive_60d':
        customerQuery = customerQuery.or(`and(status.eq.active,last_transaction_date.is.null),and(status.eq.active,last_transaction_date.lt.${sixtyDaysAgo.toISOString()})`);
        break;
      case 'inactive_90d':
        customerQuery = customerQuery.or(`and(status.eq.active,last_transaction_date.is.null),and(status.eq.active,last_transaction_date.lt.${ninetyDaysAgo.toISOString()})`);
        break;
      case 'lost':
        customerQuery = customerQuery.eq('status', 'lost');
        break;
      case 'active_no_followup':
        customerQuery = customerQuery.or(`and(status.eq.active,last_follow_up_date.is.null,last_transaction_date.is.null),and(status.eq.active,last_follow_up_date.is.null,last_transaction_date.lt.${thirtyDaysAgo.toISOString()})`);
        break;
      default:
        // Default: show inactive 30d OR lost
        customerQuery = customerQuery.or(`and(status.eq.active,last_transaction_date.is.null),and(status.eq.active,last_transaction_date.lt.${thirtyDaysAgo.toISOString()}),status.eq.lost`);
        break;
    }

    // Get total count
    const { count: totalCount } = await customerQuery.range(0, 0);

    // Fetch paginated
    const { data: customersRaw } = await customerQuery
      .order('last_follow_up_date', { ascending: true, nullsFirst: true })
      .order('last_transaction_date', { ascending: true, nullsFirst: true })
      .range(offset, offset + limit - 1);

    const customerList = (customersRaw || []).map((c: any) => {
      const cc = toCamelCase(c);
      const daysSinceTransaction = cc.lastTransactionDate
        ? Math.floor((now.getTime() - new Date(cc.lastTransactionDate).getTime()) / (1000 * 60 * 60 * 24))
        : Math.floor((now.getTime() - new Date(cc.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      const daysSinceFollowUp = cc.lastFollowUpDate
        ? Math.floor((now.getTime() - new Date(cc.lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      let riskLevel = 'low';
      if (cc.status === 'lost') riskLevel = 'lost';
      else if (daysSinceTransaction >= 90) riskLevel = 'critical';
      else if (daysSinceTransaction >= 60) riskLevel = 'high';
      else if (daysSinceTransaction >= 30) riskLevel = 'medium';

      const followUps = cc.followUps || [];
      const recentFollowUps = followUps
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 3)
        .map((fu: any) => {
          const mapped = toCamelCase(fu);
          mapped.createdBy = toCamelCase(fu.created_by);
          delete mapped.created_by;
          return mapped;
        });

      return {
        id: cc.id, name: cc.name, phone: cc.phone, email: cc.email, address: cc.address,
        status: cc.status, distance: cc.distance, totalOrders: cc.totalOrders, totalSpent: cc.totalSpent,
        assignedTo: cc.assignedTo, unit: cc.unit,
        lastTransactionDate: cc.lastTransactionDate, lastFollowUpDate: cc.lastFollowUpDate,
        lostAt: cc.lostAt, lostReason: cc.lostReason, createdAt: cc.createdAt,
        daysSinceTransaction, daysSinceFollowUp, riskLevel,
        totalFollowUps: followUps.length,
        recentFollowUps,
      };
    });

    // ========== RECENT FOLLOW-UP ACTIVITY (last 7 days) ==========
    const { data: recentActivityRaw } = await db.from('customer_follow_ups').select(`
      *, created_by:users!created_by_id(id, name, role), customer:customers(id, name, assigned_to:users!assigned_to_id(id, name))
    `).gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(50);

    const recentActivity = (recentActivityRaw || []).map((r: any) => {
      const mapped = toCamelCase(r);
      mapped.createdBy = toCamelCase(r.created_by);
      mapped.customer = toCamelCase(r.customer);
      if (mapped.customer) {
        mapped.customer.assignedTo = toCamelCase(r.customer.assigned_to);
        delete mapped.customer.assigned_to;
      }
      delete mapped.created_by;
      return mapped;
    });

    return NextResponse.json({
      summary: { totalCustomers, totalActive, totalLost, totalInactive30d, totalInactive60d, totalInactive90d, totalNoFollowUp },
      salesActivity, customers: customerList,
      pagination: { page, limit, total: totalCount || 0, totalPages: Math.ceil((totalCount || 0) / limit) },
      recentActivity
    });
  } catch (error: any) {
    console.error('[SUPERADMIN_MONITORING] Error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser } from '@/lib/token';

/**
 * GET /api/users
 * Returns user list with userUnits for admin view.
 */
export async function GET(request: NextRequest) {
  try {
    const result = await verifyAndGetAuthUser(request.headers.get('authorization'));
    if (!result) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { user: authUser } = result;
    const isAdmin = authUser.role === 'super_admin';

    // Parse query params
    const { searchParams } = new URL(request.url);
    const roleFilter = searchParams.get('role');
    const statusFilter = searchParams.get('status');
    const unitIdFilter = searchParams.get('unitId');

    // Build query — use FK hint to disambiguate dual relationship with custom_roles
    let query = db
      .from('users')
      .select('*, unit:units(*), custom_role:custom_roles!users_custom_role_id_fkey(*)');

    if (roleFilter) query = query.eq('role', roleFilter);
    if (statusFilter) query = query.eq('status', statusFilter);
    if (unitIdFilter) query = query.eq('unit_id', unitIdFilter);
    if (!isAdmin && !statusFilter) {
      query = query.eq('is_active', true).eq('status', 'approved');
    }

    const { data: users } = await query
      .order('created_at', { ascending: false })
      .limit(500);

    const usersCamel = rowsToCamelCase(users || []);

    // Fetch user_units for all users (batch)
    let userUnitsMap: Record<string, any[]> = {};
    try {
      const { data: allUserUnits } = await db
        .from('user_units')
        .select('user_id, unit:units(*)');

      if (allUserUnits && allUserUnits.length > 0) {
        const uuCamel = rowsToCamelCase(allUserUnits);
        for (const uu of uuCamel) {
          if (!userUnitsMap[uu.userId]) userUnitsMap[uu.userId] = [];
          if (uu.unit) userUnitsMap[uu.userId].push(uu.unit);
        }
      }
    } catch {
      // user_units table may not exist
    }

    // Remove password; add userUnits to each user
    const usersSafe = usersCamel.map(({ password, ...user }: any) => {
      const enriched = { ...user };
      // Only include userUnits for admin
      if (isAdmin) {
        enriched.userUnits = userUnitsMap[user.id] || [];
      }
      if (!isAdmin) {
        // Non-admin: strip sensitive fields
        return {
          id: enriched.id,
          name: enriched.name,
          email: enriched.email,
          phone: enriched.phone,
          role: enriched.role,
          status: enriched.status,
          isActive: enriched.isActive,
          unit: enriched.unit,
          unitId: enriched.unitId,
          userUnits: userUnitsMap[user.id] || [],
          nearCommission: enriched.role === 'kurir' ? enriched.nearCommission : undefined,
          farCommission: enriched.role === 'kurir' ? enriched.farCommission : undefined,
        };
      }
      return enriched;
    });

    return NextResponse.json({ users: usersSafe });
  } catch (error) {
    console.error('Get users error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';
import { exportCustomers } from '@/lib/export';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const authUserId = await verifyAuthUser(authHeader);
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check: only super_admin, keuangan, admin, manager can export
    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    const allowedRoles = ['super_admin', 'keuangan', 'admin', 'manager'];
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved' || !allowedRoles.includes(authUserCamel.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'csv') as 'csv' | 'xlsx';
    const search = searchParams.get('search') || undefined;
    const assignedTo = searchParams.get('assignedTo') || undefined;

    const result = await exportCustomers({ search, assignedTo, format });

    return new NextResponse(result.content, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.filename)}"`,
      },
    });
  } catch (error) {
    console.error('Export customers error:', error);
    return NextResponse.json({ error: 'Gagal mengekspor data' }, { status: 500 });
  }
}

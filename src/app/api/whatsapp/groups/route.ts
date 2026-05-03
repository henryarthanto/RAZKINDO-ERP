import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { getGroups } from '@/lib/whatsapp';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';

/**
 * POST /api/whatsapp/groups
 * Get WhatsApp groups list using provided token
 * Body: { token: string }
 * If token ends with ****, resolves the real token from database
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check - only authorized roles can fetch WhatsApp groups
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
    }

    // Role check: only super_admin, keuangan, admin, manager can fetch groups
    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    const allowedRoles = ['super_admin', 'keuangan', 'admin', 'manager'];
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved' || !allowedRoles.includes(authUserCamel.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { token } = body;

    let realToken = token?.trim() || '';

    // Resolve token — if masked (ends with ****), use real token from DB
    if (realToken && realToken.endsWith('****')) {
      const { data: setting } = await db.from('settings').select('value').eq('key', 'whatsapp_config').maybeSingle();
      if (setting) {
        try {
          const config = JSON.parse(setting.value);
          realToken = config.token || '';
        } catch {
          realToken = '';
        }
      } else {
        realToken = '';
      }
    }

    if (!realToken) {
      return NextResponse.json(
        { success: false, error: 'Token API tidak ditemukan. Simpan token terlebih dahulu.' },
        { status: 400 }
      );
    }

    const result = await getGroups(realToken);

    return NextResponse.json(result);
  } catch (error) {
    console.error('WhatsApp groups endpoint error:', error);
    return NextResponse.json(
      { success: false, error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

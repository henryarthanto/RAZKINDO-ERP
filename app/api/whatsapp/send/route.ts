import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { sendMessage } from '@/lib/whatsapp';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase } from '@/lib/supabase-helpers';

/**
 * POST /api/whatsapp/send
 * Send a test WhatsApp message
 * Body: { token: string, target: string, message: string }
 * If token ends with ****, resolves the real token from database
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check - only authorized roles can send WhatsApp messages
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
    }

    // Role check: only super_admin, keuangan, admin, manager can send messages
    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    const allowedRoles = ['super_admin', 'keuangan', 'admin', 'manager'];
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved' || !allowedRoles.includes(authUserCamel.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { token, target, message } = body;

    // Validate target
    if (!target || typeof target !== 'string' || target.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Target (nomor telepon atau grup) tidak boleh kosong' },
        { status: 400 }
      );
    }

    // Validate message
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Pesan tidak boleh kosong' },
        { status: 400 }
      );
    }

    // Resolve token — if masked (ends with ****), use real token from DB
    let realToken = token?.trim() || '';

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

    const result = await sendMessage(realToken, target.trim(), message.trim());

    return NextResponse.json(result);
  } catch (error) {
    console.error('WhatsApp send endpoint error:', error);
    return NextResponse.json(
      { success: false, error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

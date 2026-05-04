import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAndGetAuthUser } from '@/lib/token';
import { broadcastPushNotification, getVapidPublicKey } from '@/lib/push-notifications';
import { enforceSuperAdmin } from '@/lib/require-auth';

/**
 * POST /api/push/send
 * Send a push notification to users.
 * - super_admin can broadcast to all users or specific users
 * - Regular users can only send to themselves (for testing)
 */
export async function POST(request: NextRequest) {
  try {
    // Only super_admin can send push notifications to others
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const body = await request.json();
    const { title, body: message, data, tag, userId, unitId } = body;

    if (!title || !message) {
      return NextResponse.json({ error: 'Title dan body wajib diisi' }, { status: 400 });
    }

    const result = await broadcastPushNotification(db, {
      title,
      body: message,
      data,
      tag,
      filters: {
        userId,
        unitId,
      },
    });

    return NextResponse.json({
      success: true,
      sent: result.sent,
      failed: result.failed,
      expired: result.expired,
    });
  } catch (error) {
    console.error('[Push] Send error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * GET /api/push/send
 * Get VAPID public key for client-side push subscription.
 */
export async function GET() {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return NextResponse.json({
      configured: false,
      message: 'Push notifications belum dikonfigurasi. Hubungi admin.',
    });
  }

  return NextResponse.json({
    configured: true,
    publicKey,
  });
}

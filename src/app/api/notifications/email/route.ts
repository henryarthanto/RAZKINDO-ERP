import { NextRequest, NextResponse } from 'next/server';
import { enforceSuperAdmin } from '@/lib/require-auth';
import {
  sendEmail,
  isEmailConfigured,
  transactionApprovedTemplate,
  paymentReceivedTemplate,
  lowStockTemplate,
  newOrderTemplate,
} from '@/lib/email-service';

/**
 * POST /api/notifications/email
 * Send a notification email for a specific event type.
 *
 * Body: {
 *   type: 'transaction_approved' | 'payment_received' | 'low_stock' | 'new_order',
 *   to: string | string[],
 *   data: { ...event-specific data }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    if (!isEmailConfigured()) {
      return NextResponse.json({
        error: 'Layanan email belum dikonfigurasi. Set RESEND_API_KEY di .env',
      }, { status: 503 });
    }

    const body = await request.json();
    const { type, to, data } = body;

    if (!type || !to || !data) {
      return NextResponse.json({ error: 'Type, to, dan data wajib diisi' }, { status: 400 });
    }

    let template;
    switch (type) {
      case 'transaction_approved':
        template = transactionApprovedTemplate(data);
        break;
      case 'payment_received':
        template = paymentReceivedTemplate(data);
        break;
      case 'low_stock':
        template = lowStockTemplate(data);
        break;
      case 'new_order':
        template = newOrderTemplate(data);
        break;
      default:
        return NextResponse.json({ error: 'Tipe email tidak valid' }, { status: 400 });
    }

    const result = await sendEmail({
      to,
      subject: template.subject,
      html: template.html,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Gagal mengirim email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Email] Send error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * GET /api/notifications/email
 * Check if email service is configured.
 */
export async function GET() {
  return NextResponse.json({
    configured: isEmailConfigured(),
  });
}

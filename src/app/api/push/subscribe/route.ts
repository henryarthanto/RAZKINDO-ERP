import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAndGetAuthUser } from '@/lib/token';

/**
 * POST /api/push/subscribe
 * Save a push subscription for the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { subscription, unitId } = body;

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Subscription tidak valid' }, { status: 400 });
    }

    const userId = authResult.userId;

    // Check if subscription already exists (same endpoint + user)
    const { data: existing } = await db
      .from('push_subscriptions')
      .select('id')
      .eq('user_id', userId)
      .eq('endpoint', subscription.endpoint)
      .maybeSingle();

    if (existing) {
      // Update existing subscription
      const { error: updateError } = await db
        .from('push_subscriptions')
        .update({
          subscription: JSON.stringify(subscription),
          unit_id: unitId || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error('[Push] Update subscription error:', updateError);
      }
    } else {
      // Insert new subscription
      const { error: insertError } = await db
        .from('push_subscriptions')
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          unit_id: unitId || null,
          endpoint: subscription.endpoint,
          subscription: JSON.stringify(subscription),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (insertError) {
        console.error('[Push] Insert subscription error:', insertError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Push] Subscribe error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

/**
 * DELETE /api/push/subscribe
 * Remove a push subscription.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const endpoint = searchParams.get('endpoint');

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint diperlukan' }, { status: 400 });
    }

    await db
      .from('push_subscriptions')
      .delete()
      .eq('user_id', authResult.userId)
      .eq('endpoint', endpoint);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Push] Unsubscribe error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

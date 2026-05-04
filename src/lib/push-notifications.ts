// =====================================================================
// PUSH NOTIFICATION SERVICE — Web Push API integration
//
// Handles push subscription management and notification delivery
// using the Web Push protocol with VAPID authentication.
//
// REQUIREMENTS:
//   - VAPID keys: Generate via `npx web-push generate-vapid-keys`
//   - Set NEXT_PUBLIC_VAPID_PUBLIC_KEY in .env
//   - Set VAPID_PRIVATE_KEY in .env
//   - Enable Realtime for events table in Supabase Dashboard
// =====================================================================

import webpush from 'web-push';

// Configure VAPID keys
let _configured = false;

function ensureConfigured() {
  if (_configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@razkindo.com';

  if (!publicKey || !privateKey) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Push] VAPID keys not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in .env');
    }
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  _configured = true;
  return true;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushSubscriptionRecord {
  id?: string;
  user_id?: string;
  unit_id?: string;
  subscription: PushSubscription;
  created_at: string;
}

/**
 * Send a push notification to a single subscription.
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    data?: Record<string, unknown>;
    tag?: string;
    renotify?: boolean;
  }
): Promise<boolean> {
  if (!ensureConfigured()) return false;

  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/icon-192.png',
      data: payload.data,
      tag: payload.tag,
      renotify: payload.renotify || false,
    }), {
      TTL: 86400, // 24 hours
      urgency: 'normal',
    });
    return true;
  } catch (error: any) {
    // If subscription is expired/invalid, return false (caller should remove it)
    if (error.statusCode === 404 || error.statusCode === 410) {
      console.warn('[Push] Subscription expired or invalid:', error.message);
      return false;
    }
    console.error('[Push] Failed to send notification:', error.message);
    return false;
  }
}

/**
 * Send a push notification to all active subscriptions.
 * Optionally filter by user_id or unit_id.
 */
export async function broadcastPushNotification(
  db: any,
  payload: {
    title: string;
    body: string;
    icon?: string;
    data?: Record<string, unknown>;
    tag?: string;
    filters?: {
      userId?: string;
      unitId?: string;
    };
  }
): Promise<{ sent: number; failed: number; expired: number }> {
  if (!ensureConfigured()) {
    return { sent: 0, failed: 0, expired: 0 };
  }

  let query = db.from('push_subscriptions').select('*');

  if (payload.filters?.userId) {
    query = query.eq('user_id', payload.filters.userId);
  } else if (payload.filters?.unitId) {
    query = query.eq('unit_id', payload.filters.unitId);
  }

  const { data: subscriptions, error } = await query;

  if (error || !subscriptions?.length) {
    return { sent: 0, failed: 0, expired: 0 };
  }

  let sent = 0;
  let failed = 0;
  let expired = 0;

  // Send in parallel (batch of 10 at a time)
  const batchSize = 10;
  for (let i = 0; i < subscriptions.length; i += batchSize) {
    const batch = subscriptions.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (sub: any) => {
        const subscription = typeof sub.subscription === 'string'
          ? JSON.parse(sub.subscription)
          : sub.subscription;
        return sendPushNotification(subscription, payload);
      })
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled' && result.value === true) {
        sent++;
      } else if (result.status === 'fulfilled' && result.value === false) {
        expired++;
        // Remove expired subscription
        try {
          await db.from('push_subscriptions').delete().eq('id', batch[j].id);
        } catch { /* best effort */ }
      } else {
        failed++;
      }
    }
  }

  return { sent, failed, expired };
}

/**
 * Remove an expired subscription from the database.
 */
export async function removeExpiredSubscription(db: any, endpoint: string): Promise<void> {
  try {
    await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  } catch (error) {
    console.error('[Push] Failed to remove expired subscription:', error);
  }
}

/**
 * Get the VAPID public key (base64url encoded).
 * Used by the client to subscribe to push notifications.
 */
export function getVapidPublicKey(): string | null {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null;
}

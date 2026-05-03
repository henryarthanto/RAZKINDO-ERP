import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

// Re-export for backward compatibility (files that import from here)
export { verifyAuthToken, verifyAuthUser } from '@/lib/token';

// Server-side debounce: ignore updates more frequent than 60s per user
const _lastActivityWrite = new Map<string, number>();
const ACTIVITY_DEBOUNCE_MS = 60_000;

export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ success: true }); // Silent fail for activity
    }

    // Debounce: skip write if this user was updated < 60s ago
    const lastWrite = _lastActivityWrite.get(userId) ?? 0;
    const now = Date.now();
    if (now - lastWrite < ACTIVITY_DEBOUNCE_MS) {
      return NextResponse.json({ success: true }); // Silently skip
    }
    _lastActivityWrite.set(userId, now);

    // Evict stale entries to prevent unbounded Map growth
    if (_lastActivityWrite.size > 1000) {
      const cutoff = now - ACTIVITY_DEBOUNCE_MS * 2;
      for (const [uid, ts] of _lastActivityWrite) {
        if (ts < cutoff) _lastActivityWrite.delete(uid);
      }
    }

    const { page, action } = await request.json();

    await db
      .from('users')
      .update({
        last_seen_at: new Date().toISOString(),
        current_page: page || null,
        last_action: action || null
      })
      .eq('id', userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Activity] Error updating user activity:', error);
    return NextResponse.json({ success: true }); // Activity is non-critical
  }
}

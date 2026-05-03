import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';

// ================================
// EVENT CLEANUP - Prevent unbounded event table growth
// ================================
let _lastCleanup = 0;
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const EVENT_RETENTION_READ_DAYS = 7;     // Read events: delete after 7 days
const EVENT_RETENTION_MAX_DAYS = 30;     // All events (inc. unread): hard cap at 30 days

async function cleanupOldEvents() {
  const now = Date.now();
  if (now - _lastCleanup < CLEANUP_INTERVAL) return;
  _lastCleanup = now;

  try {
    const readCutoff = new Date(now - EVENT_RETENTION_READ_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const hardCutoff = new Date(now - EVENT_RETENTION_MAX_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Delete read events older than 7 days
    const { count: deletedRead } = await db
      .from('events')
      .delete({ count: 'exact' })
      .eq('is_read', true)
      .lt('created_at', readCutoff);

    // Delete ALL events older than 30 days
    const { count: deletedOld } = await db
      .from('events')
      .delete({ count: 'exact' })
      .lt('created_at', hardCutoff);

    const total = (deletedRead || 0) + (deletedOld || 0);
    if (total > 0) {
      console.log(`[Events] Cleaned up ${deletedRead} read + ${deletedOld} stale events`);
    }
  } catch (err) {
    console.warn('[Events] Cleanup failed:', err instanceof Error ? err.message : 'unknown');
  }
}

export async function GET(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Lazy cleanup of old read events
    cleanupOldEvents().catch(() => {});

    const { searchParams } = new URL(request.url);
    const lastCreatedAt = searchParams.get('lastCreatedAt');
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50') || 50, 500));

    let query = db
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (lastCreatedAt) {
      query = query.gt('created_at', new Date(lastCreatedAt).toISOString());
    }

    const { data: events } = await query;

    // Parse payload JSON
    const parsedEvents = (events || []).map(e => {
      const camel = rowsToCamelCase([e])[0];
      return {
        ...camel,
        payload: typeof camel.payload === 'string' ? (() => { try { return JSON.parse(camel.payload); } catch { return camel.payload; } })() : camel.payload
      };
    });

    return NextResponse.json({ events: parsedEvents });
  } catch (error) {
    console.error('Get events error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

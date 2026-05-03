import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ids } = await request.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ success: true });
    }

    // Event model has no userId field — all authenticated users share events.
    await db
      .from('events')
      .update({ is_read: true })
      .in('id', ids);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Mark events read error:', error);
    return NextResponse.json({ success: true });
  }
}

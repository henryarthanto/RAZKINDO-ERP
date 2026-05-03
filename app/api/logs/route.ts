import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase, toCamelCase, generateId } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '100') || 100, 500));

    let query = db
      .from('logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type) query = query.eq('type', type);

    const { data: logs } = await query;

    return NextResponse.json({ logs: rowsToCamelCase(logs || []) });
  } catch (error) {
    console.error('Get logs error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const data = await request.json();

    const { data: log } = await db
      .from('logs')
      .insert({
        id: generateId(),
        type: data.type || 'activity',
        user_id: data.userId,
        action: data.action,
        entity: data.entity,
        entity_id: data.entityId,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        message: data.message,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    return NextResponse.json({ log: toCamelCase(log) });
  } catch (error) {
    console.error('Create log error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

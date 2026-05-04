import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  let settingKey = '';
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { key } = await params;
    settingKey = key;
    const { value } = await request.json();
    const jsonValue = JSON.stringify(value);

    // Use update+insert (upsert can fail with large payloads via PostgREST)
    // Step 1: Try update first
    const { data: existing } = await db
      .from('settings')
      .select('id')
      .eq('key', key)
      .maybeSingle();

    let setting;
    if (existing) {
      // Update existing row
      const result = await db
        .from('settings')
        .update({ value: jsonValue, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select()
        .single();
      setting = result.data;
    } else {
      // Insert new row — explicitly generate an ID to avoid null constraint error
      // (PostgREST doesn't trigger DB defaults for missing columns in INSERT)
      const crypto = await import('crypto');
      const newId = crypto.randomUUID();
      const result = await db
        .from('settings')
        .insert({ id: newId, key, value: jsonValue, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select()
        .single();
      setting = result.data;
    }

    // Check for Supabase errors
    if ((setting as any)?.error) {
      console.error('[Settings] DB error for key:', key, (setting as any).error);
      return NextResponse.json(
        { error: 'Terjadi kesalahan server' },
        { status: 500 }
      );
    }

    console.log(`[Settings] Saved "${key}" (${jsonValue.length} bytes)`);

    // Invalidate related caches
    if (key === 'company_logo' || key === 'company_name') {
      try {
        const { cacheInvalidatePrefix } = await import('@/lib/redis-cache');
        await cacheInvalidatePrefix('settings');
      } catch { /* cache optional */ }
    }
    return NextResponse.json({ setting: toCamelCase(setting) });
  } catch (error: any) {
    console.error('[Settings] Update error for key:', settingKey, error?.message || error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

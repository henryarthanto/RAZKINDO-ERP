import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { requireAuth } from '@/lib/require-auth';

/**
 * Dedicated logo upload endpoint.
 * Saves the company logo immediately upon upload, bypassing the
 * general settings save flow. This avoids timeout and payload issues
 * when mixing large base64 data with other small settings.
 *
 * POST /api/settings/logo
 * Body: { logo: "data:image/jpeg;base64,..." }
 * Response: { success: true, size: number }
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check (any authenticated user can upload logo)
    const userId = await requireAuth(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const logo = body?.logo;

    // Validate input
    if (!logo || typeof logo !== 'string') {
      return NextResponse.json(
        { error: 'Logo harus berupa string base64' },
        { status: 400 }
      );
    }

    // Validate it's a data URL with an image mime type
    if (!logo.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'Format tidak didukung. Gunakan PNG, JPG, atau SVG.' },
        { status: 400 }
      );
    }

    // Limit size to 500KB of base64 data (~375KB actual image)
    const base64Data = logo.split(',')[1] || '';
    if (base64Data.length > 500_000) {
      return NextResponse.json(
        { error: 'Logo terlalu besar. Maksimal 375KB.' },
        { status: 400 }
      );
    }

    const jsonValue = JSON.stringify(logo);

    // Check if company_logo setting exists
    const { data: existing } = await db
      .from('settings')
      .select('id')
      .eq('key', 'company_logo')
      .maybeSingle();

    let result;
    if (existing) {
      // Update existing
      result = await db
        .from('settings')
        .update({ value: jsonValue, updated_at: new Date().toISOString() })
        .eq('key', 'company_logo')
        .select('id')
        .single();
    } else {
      // Insert new — explicitly generate an ID to avoid null constraint error
      const crypto = await import('crypto');
      const newId = crypto.randomUUID();
      result = await db
        .from('settings')
        .insert({ id: newId, key: 'company_logo', value: jsonValue, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select('id')
        .single();
    }

    if (result.error) {
      console.error('[Logo] DB error:', result.error.message, result.error.code);
      return NextResponse.json(
        { error: `Gagal menyimpan logo: ${result.error.message}` },
        { status: 500 }
      );
    }

    console.log(`[Logo] Saved by user ${userId} (${jsonValue.length} bytes, id=${result.data?.id})`);

    // Invalidate Redis cache
    try {
      const { cacheInvalidatePrefix } = await import('@/lib/redis-cache');
      await cacheInvalidatePrefix('settings');
    } catch { /* cache optional */ }

    return NextResponse.json({
      success: true,
      size: Math.round((base64Data.length * 3) / 4 / 1024), // approximate KB
    });
  } catch (error: any) {
    console.error('[Logo] Upload error:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/logo
 * Removes the company logo.
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireAuth(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Set logo to empty string
    const jsonValue = JSON.stringify('');
    const { error } = await db
      .from('settings')
      .update({ value: jsonValue, updated_at: new Date().toISOString() })
      .eq('key', 'company_logo');

    if (error) {
      console.error('[Logo] Delete error:', error.message);
      return NextResponse.json({ error: 'Gagal menghapus logo' }, { status: 500 });
    }

    console.log(`[Logo] Deleted by user ${userId}`);

    // Invalidate cache
    try {
      const { cacheInvalidatePrefix } = await import('@/lib/redis-cache');
      await cacheInvalidatePrefix('settings');
    } catch { /* cache optional */ }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Logo] Delete error:', error?.message || error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

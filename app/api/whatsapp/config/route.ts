import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { invalidateWhatsAppCache } from '@/lib/whatsapp';
import crypto from 'crypto';

/**
 * GET /api/whatsapp/config
 * Get current WhatsApp config from database settings
 * Token is returned masked for security (first 8 chars + ****)
 */
const EMPTY_CONFIG = {
  token: '',
  tokenMasked: false,
  enabled: false,
  target_type: 'group',
  target_id: '',
  message_template: ''
};

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    let setting: any = null;
    try {
      const result = await db.from('settings').select('*').eq('key', 'whatsapp_config').maybeSingle();
      setting = result.data;
      if (result.error) {
        console.error('[WhatsApp Config GET] DB error:', result.error.message, result.error.code);
        // Return empty config instead of 500 for DB errors
        return NextResponse.json({ config: EMPTY_CONFIG });
      }
    } catch (dbErr: any) {
      console.error('[WhatsApp Config GET] DB exception:', dbErr.message);
      return NextResponse.json({ config: EMPTY_CONFIG });
    }

    if (!setting) {
      return NextResponse.json({ config: EMPTY_CONFIG });
    }

    let config: any;
    try {
      config = JSON.parse(setting.value);
    } catch {
      return NextResponse.json({ config: EMPTY_CONFIG });
    }

    // Mask token in response to prevent API key exposure
    const maskedConfig = {
      ...config,
      token: config.token ? config.token.slice(0, 8) + '****' : '',
      tokenMasked: !!config.token,
      tokenInvalid: config._tokenInvalid || false,
      tokenInvalidAt: config._tokenInvalidAt || null
    };

    return NextResponse.json({ config: maskedConfig });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp Config GET] Error:', msg);
    // Return empty config instead of 500 to prevent UI from breaking
    return NextResponse.json({ config: EMPTY_CONFIG });
  }
}

/**
 * PATCH /api/whatsapp/config
 * Save WhatsApp config to database
 * If token ends with ****, preserve the existing token (user didn't change it)
 */
export async function PATCH(request: NextRequest) {
  try {
    // Auth check - only super_admin can modify WhatsApp config
    const auth = await enforceSuperAdmin(request);
    if (!auth.success) return auth.response;
    const authUserId = auth.userId;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body tidak valid' },
        { status: 400 }
      );
    }
    const { token, enabled, target_type, target_id, message_template } = body;

    // Check if token is masked (user didn't change it) — preserve existing token
    let finalToken = token?.trim() || '';

    if (finalToken && finalToken.endsWith('****')) {
      // User didn't change the token — keep the existing one from DB
      const { data: existing, error: fetchErr } = await db.from('settings').select('value').eq('key', 'whatsapp_config').maybeSingle();

      if (fetchErr) {
        console.error('[WhatsApp Config PATCH] Fetch existing error:', fetchErr.message);
        // Continue with empty token — don't block the save
      } else if (existing) {
        try {
          const existingConfig = JSON.parse(existing.value);
          finalToken = existingConfig.token || '';
        } catch {
          finalToken = '';
        }
      }
    }

    // Build config — no strict validation, just save what's provided
    const config = {
      token: finalToken,
      enabled: enabled || false,
      target_type: target_type || 'group',
      target_id: target_id?.trim() || '',
      message_template: message_template || ''
    };

    // Clear token invalid flags when user saves new token or config
    const configToStore = {
      ...config,
      _tokenInvalid: false,
      _tokenInvalidAt: null
    };

    const configValue = JSON.stringify(configToStore);
    const now = new Date().toISOString();

    // Upsert pattern: try UPDATE first, then INSERT if no row exists
    const { data: updatedRow, error: updateErr } = await db
      .from('settings')
      .update({ value: configValue, updated_at: now })
      .eq('key', 'whatsapp_config')
      .select('key')
      .maybeSingle();

    if (updateErr) {
      console.error('[WhatsApp Config PATCH] Update error:', updateErr.message, updateErr.code);
      throw new Error(`Update gagal: ${updateErr.message} (${updateErr.code})`);
    }

    if (!updatedRow) {
      // No existing row — do INSERT
      const { error: insertErr } = await db.from('settings').insert({
        id: crypto.randomUUID(),
        key: 'whatsapp_config',
        value: configValue,
        created_at: now,
        updated_at: now,
      });

      if (insertErr) {
        console.error('[WhatsApp Config PATCH] Insert error:', insertErr.message, insertErr.code);
        throw new Error(`Insert gagal: ${insertErr.message} (${insertErr.code})`);
      }
    }

    // Return success with masked token
    const maskedConfig = {
      ...config,
      token: config.token ? config.token.slice(0, 8) + '****' : '',
      tokenMasked: !!config.token
    };

    // Invalidate in-memory cache so subsequent reads get fresh config
    invalidateWhatsAppCache();

    return NextResponse.json({ config: maskedConfig });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp Config PATCH] Error:', msg);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

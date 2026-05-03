import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import crypto from 'crypto';

/**
 * GET /api/whatsapp/message-template
 * Get current message template from settings
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });
    }

    const { data: setting, error } = await db.from('settings').select('*').eq('key', 'whatsapp_message_template').maybeSingle();
    if (error) {
      console.error('[WhatsApp Template GET] DB error:', error.message, error.code);
      throw new Error(`Database error: ${error.message}`);
    }

    if (!setting) {
      return NextResponse.json({
        template: ''
      });
    }

    const template = setting.value;

    return NextResponse.json({ template });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp Template GET] Error:', msg);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server', detail: msg },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/whatsapp/message-template
 * Save message template
 * Body: { template: string }
 */
export async function PATCH(request: NextRequest) {
  try {
    // Auth check - only super_admin can modify message template
    const auth = await enforceSuperAdmin(request);
    if (!auth.success) return auth.response;
    const authUserId = auth.userId;

    const body = await request.json();
    const { template } = body;

    if (!template || typeof template !== 'string') {
      return NextResponse.json(
        { error: 'Template pesan tidak boleh kosong' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // Upsert pattern: try UPDATE first, then INSERT if no row exists
    const { data: updatedRow, error: updateErr } = await db
      .from('settings')
      .update({ value: template, updated_at: now })
      .eq('key', 'whatsapp_message_template')
      .select('key')
      .maybeSingle();

    if (updateErr) {
      console.error('[WhatsApp Template PATCH] Update error:', updateErr.message, updateErr.code);
      throw new Error(`Update gagal: ${updateErr.message} (${updateErr.code})`);
    }

    if (!updatedRow) {
      // No existing row — do INSERT
      const { error: insertErr } = await db.from('settings').insert({
        id: crypto.randomUUID(),
        key: 'whatsapp_message_template',
        value: template,
        created_at: now,
        updated_at: now,
      });

      if (insertErr) {
        console.error('[WhatsApp Template PATCH] Insert error:', insertErr.message, insertErr.code);
        throw new Error(`Insert gagal: ${insertErr.message} (${insertErr.code})`);
      }
    }

    return NextResponse.json({ template });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[WhatsApp Template PATCH] Error:', msg);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server', detail: msg },
      { status: 500 }
    );
  }
}

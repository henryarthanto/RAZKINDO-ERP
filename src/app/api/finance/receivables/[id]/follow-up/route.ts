import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const data = await request.json();

    const { data: receivable, error: fetchError } = await db.from('receivables').select('*').eq('id', id).single();
    if (fetchError || !receivable) {
      return NextResponse.json({ error: 'Piutang tidak ditemukan' }, { status: 404 });
    }

    const VALID_TYPES = ['call', 'whatsapp', 'visit', 'email', 'other'];
    const followUpType = data.type || 'call';
    if (!VALID_TYPES.includes(followUpType)) {
      return NextResponse.json({ error: 'Tipe follow-up tidak valid' }, { status: 400 });
    }

    // 1. Create follow-up
    const now = new Date().toISOString();
    const followUpData = toSnakeCase({
      id: generateId(),
      receivableId: id,
      type: followUpType,
      note: data.note,
      outcome: data.outcome || null,
      promisedDate: data.promisedDate ? new Date(data.promisedDate).toISOString() : null,
      createdById: authUserId,
    });

    const { data: followUp, error: fuError } = await db.from('receivable_follow_ups').insert(followUpData).select().single();
    if (fuError) throw fuError;

    // 2. Update receivable with latest follow-up info
    const currentReminderCount = receivable.reminder_count || 0;
    const updateData: Record<string, any> = {
      last_follow_up_at: new Date().toISOString(),
      last_follow_up_note: data.note,
      reminder_count: currentReminderCount + 1,
      last_reminder_at: new Date().toISOString(),
    };

    if (data.promisedDate) {
      updateData.next_follow_up_date = new Date(data.promisedDate).toISOString();
    }
    if (data.outcome === 'promised_to_pay' && data.promisedDate) {
      updateData.next_follow_up_date = new Date(data.promisedDate).toISOString();
    }

    await db.from('receivables').update(updateData).eq('id', id);

    // 3. Create log
    createLog(db, {
      type: 'activity',
      userId: authUserId,
      action: 'receivable_followup',
      entity: 'receivable',
      entityId: id,
      message: `Follow-up piutang: ${data.type} - ${data.note}`,
    });

    return NextResponse.json({ followUp: toCamelCase(followUp) });
  } catch (error: any) {
    console.error('Create follow-up error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, createLog, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { wsCustomerUpdate } from '@/lib/ws-dispatch';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;

    // Get follow-up history for a specific customer
    const { data: followUps } = await db
      .from('customer_follow_ups')
      .select(`
        *,
        created_by:users!created_by_id(id, name, role)
      `)
      .eq('customer_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    return NextResponse.json({ followUps: rowsToCamelCase(followUps || []).map((f: any) => ({
      ...f,
      createdBy: f.createdBy || null
    })) });
  } catch (error: any) {
    console.error('Get customer follow-ups error:', error);
    if (error?.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role check: only super_admin or sales can create follow-ups
    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).maybeSingle();
    const authUserCamel = toCamelCase(authUser);
    if (!authUserCamel || !authUserCamel.isActive || authUserCamel.status !== 'approved') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authUserCamel.role !== 'super_admin' && authUserCamel.role !== 'sales') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { type, note, outcome, nextFollowUpDate } = body;

    // Validate required fields
    const validTypes = ['call', 'whatsapp', 'visit', 'email', 'other'];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Tipe follow-up tidak valid. Pilih: call, whatsapp, visit, email, other' },
        { status: 400 }
      );
    }

    if (!note || typeof note !== 'string' || note.trim().length === 0) {
      return NextResponse.json(
        { error: 'Catatan follow-up wajib diisi' },
        { status: 400 }
      );
    }

    // Validate outcome if provided
    const validOutcomes = ['interested', 'not_interested', 'promised_to_order', 'no_response', 'rescheduled', 'other'];
    if (outcome && !validOutcomes.includes(outcome)) {
      return NextResponse.json(
        { error: 'Outcome tidak valid. Pilih: interested, not_interested, promised_to_order, no_response, rescheduled, other' },
        { status: 400 }
      );
    }

    // Verify customer exists
    const { data: existingCustomer } = await db
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    if (!existingCustomer) {
      return NextResponse.json(
        { error: 'Pelanggan tidak ditemukan' },
        { status: 404 }
      );
    }
    const existingCustomerCamel = toCamelCase(existingCustomer);

    // Create follow-up history record
    const followUpId = generateId();
    const insertPayload = {
      id: followUpId,
      customer_id: id,
      type,
      note: note.trim(),
      outcome: outcome || null,
      next_follow_up_date: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : null,
      created_by_id: authUserId,
      created_at: new Date().toISOString(),
    };
    console.log('[CustomerFollowUp] Inserting with id:', followUpId, 'customer_id:', id, 'type:', type);

    const { data: followUp, error: insertError } = await db
      .from('customer_follow_ups')
      .insert(insertPayload)
      .select(`
        *,
        created_by:users!created_by_id(id, name, role),
        customer:customers(id, name)
      `)
      .single();

    if (insertError) {
      console.error('[CustomerFollowUp] Insert error:', insertError.message, insertError.code, '| payload id:', followUpId, '| table: customer_follow_ups');
      return NextResponse.json({ error: insertError.message || 'Gagal menyimpan follow-up', detail: `id=${followUpId}, code=${insertError.code}` }, { status: 500 });
    }
    if (!followUp) {
      return NextResponse.json({ error: 'Gagal menyimpan follow-up' }, { status: 500 });
    }

    const followUpCamel = toCamelCase(followUp);

    // BUG FIX: Only reactivate lost customers on positive follow-up outcomes
    const positiveOutcomes = ['interested', 'promised_to_order', 'rescheduled'];
    const updateData: Record<string, any> = {
      last_follow_up_date: new Date().toISOString(),
    };

    if (existingCustomerCamel.status === 'lost' && positiveOutcomes.includes(outcome)) {
      updateData.status = 'active';
      updateData.lost_at = null;
      updateData.lost_reason = null;
    }

    await db
      .from('customers')
      .update(updateData)
      .eq('id', id);

    // Log the follow-up action (fire-and-forget)
    createLog(db, {
      type: 'activity',
      action: 'customer_follow_up',
      entity: 'Customer',
      entityId: id,
      payload: JSON.stringify({ type, note: note.trim(), outcome, nextFollowUpDate }),
      message: `Follow-up ${type} dicatat untuk pelanggan ${existingCustomerCamel.name}`
    });

    wsCustomerUpdate({ unitId: existingCustomer.unit_id });
    return NextResponse.json({
      success: true,
      followUp: {
        ...followUpCamel,
        createdBy: followUpCamel.createdBy || null,
        customer: followUpCamel.customer || null
      }
    });
  } catch (error: any) {
    console.error('Customer follow-up error:', error);
    if (error?.status === 401) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

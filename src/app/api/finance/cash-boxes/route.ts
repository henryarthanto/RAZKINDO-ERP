import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, rowsToCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';
import { validateBody } from '@/lib/validators';

const cashBoxCreateSchema = z.object({
  name: z.string().min(1, 'Nama brankas/kas wajib diisi'),
  unitId: z.string().nullable().optional(),
  balance: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: cashBoxes, error } = await db.from('cash_boxes').select('*, unit:units(id, name)').eq('is_active', true).order('name', { ascending: true });
    if (error) throw error;
    
    return NextResponse.json({ cashBoxes: rowsToCamelCase(cashBoxes || []) });
  } catch (error) {
    console.error('Get cash boxes error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const rawBody = await request.json();
    const validation = validateBody(cashBoxCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      name: data.name,
      unitId: data.unitId || null,
      balance: Math.max(0, data.balance || 0),
      isActive: true,
      version: 1,
      notes: data.notes || null,
      createdAt: now, updatedAt: now,
    });

    const { data: cashBox, error } = await db.from('cash_boxes').insert(insertData).select().single();
    if (error) throw error;
    
    createLog(db, {
      type: 'activity',
      userId: authResult.userId,
      action: 'cash_box_created',
      entity: 'cash_box',
      entityId: cashBox.id,
      message: `Cash box ${data.name} dibuat`
    });
    
    return NextResponse.json({ cashBox: toCamelCase(cashBox) });
  } catch (error) {
    console.error('Create cash box error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

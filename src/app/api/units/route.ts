import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { rowsToCamelCase, toCamelCase, createLog, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { validateBody } from '@/lib/validators';

const unitCreateSchema = z.object({
  name: z.string().min(1, 'Nama unit wajib diisi'),
  address: z.string().optional(),
  phone: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    // Publik: unit list bisa diakses tanpa auth (untuk halaman register)
    // POST tetap butuh auth untuk create unit
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      const authUserId = await verifyAuthUser(authHeader);
      if (!authUserId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { data: units } = await db
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name', { ascending: true });

    return NextResponse.json({ units: rowsToCamelCase(units || []) });
  } catch (error: any) {
    console.error('Get units error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin can create units
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Hanya Super Admin yang dapat menambahkan unit/cabang' }, { status: 403 });
    }

    const rawBody = await request.json();
    const validation = validateBody(unitCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { name, address, phone } = validation.data;

    const { data: unit } = await db
      .from('units')
      .insert({ id: generateId(), name, address, phone, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .select()
      .single();

    const unitCamel = toCamelCase(unit);

    // Create log (fire-and-forget)
    createLog(db, {
      type: 'activity',
      action: 'unit_created',
      entity: 'unit',
      entityId: unitCamel.id,
      message: `Unit ${name} created`
    });

    return NextResponse.json({ unit: unitCamel });
  } catch (error: any) {
    console.error('Create unit error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

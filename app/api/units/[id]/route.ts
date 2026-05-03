import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    const data = await request.json();

    const { data: existing } = await db
      .from('units')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 });
    }

    if (data.name !== undefined && !data.name) {
      return NextResponse.json({ error: 'Nama unit tidak boleh kosong' }, { status: 400 });
    }

    const { data: unit } = await db
      .from('units')
      .update({
        name: data.name,
        address: data.address,
        phone: data.phone
      })
      .eq('id', id)
      .select()
      .single();

    return NextResponse.json({ unit: toCamelCase(unit) });
  } catch (error) {
    console.error('Update unit error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;

    const { data: existing } = await db
      .from('units')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Unit tidak ditemukan' }, { status: 404 });
    }

    await db
      .from('units')
      .update({ is_active: false })
      .eq('id', id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete unit error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

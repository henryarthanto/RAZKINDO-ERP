import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

// NOTE: Database columns are camelCase (Prisma default, no @map used).

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
      .from('custom_roles')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Role tidak ditemukan' }, { status: 404 });
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) {
      const newName = String(data.name).trim();
      if (!newName) return NextResponse.json({ error: 'Nama role wajib diisi' }, { status: 400 });
      updateData.name = newName;
    }
    if (data.description !== undefined) {
      updateData.description = data.description || null;
    }

    const { data: updated, error } = await db
      .from('custom_roles')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('Custom roles update error:', error);
      return NextResponse.json({ error: error.message || 'Gagal memperbarui role' }, { status: 500 });
    }

    // If role name changed, update all users with this custom role
    if (data.name !== undefined && existing.name !== updateData.name) {
      await db
        .from('users')
        .update({ role: updateData.name })
        .eq('custom_role_id', id);
    }

    return NextResponse.json({ role: toCamelCase(updated) });
  } catch (error) {
    console.error('Custom roles PATCH error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
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

    // Check if any active users still use this role
    const { count } = await db
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('custom_role_id', id)
      .eq('is_active', true);
    if ((count || 0) > 0) {
      return NextResponse.json(
        { error: `Tidak dapat menghapus role yang masih digunakan oleh ${count} karyawan aktif. Nonaktifkan atau pindahkan karyawan terlebih dahulu.` },
        { status: 400 }
      );
    }

    // Delete inactive users with this role
    await db.from('users').delete().eq('custom_role_id', id).eq('is_active', false);

    // Delete the role
    await db.from('custom_roles').delete().eq('id', id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Custom roles DELETE error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

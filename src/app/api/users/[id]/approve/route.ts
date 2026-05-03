import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { createLog, createEvent } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { invalidateUserAuthCache } from '@/lib/token';
import { wsUserUpdate } from '@/lib/ws-dispatch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Auth check - must be super_admin to approve users
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;

    // BUG FIX: Check existence first (outside transaction is fine — just a read)
    const { data: existing } = await db
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'User tidak ditemukan' },
        { status: 404 }
      );
    }

    // Optimistic-lock update — only succeeds if status is still 'pending'.
    // If two concurrent approve requests race, only the first will match
    // `status: 'pending'` and succeed; the second will return null data.
    const { data: user, error: updateError } = await db
      .from('users')
      .update({ status: 'approved' })
      .eq('id', id)
      .eq('status', 'pending')
      .select('*, unit:units(*)')
      .single();

    if (updateError || !user) {
      return NextResponse.json(
        { error: 'User sudah di-approve' },
        { status: 409 }
      );
    }

    const userCamel = toCamelCase(user);

    // Create audit log
    createLog(db, {
      type: 'audit',
      action: 'user_approved',
      entity: 'user',
      entityId: id,
      message: `User ${userCamel.name} approved`,
    });

    // Create event
    createEvent(db, 'user_approved', { userId: id, userName: userCamel.name });

    // Invalidate auth cache so the approved user can now log in
    invalidateUserAuthCache(id);

    const { password: _, ...userWithoutPassword } = userCamel!;
    wsUserUpdate({ userId: id, userName: userCamel.name, status: 'approved' });

    return NextResponse.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Approve user error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

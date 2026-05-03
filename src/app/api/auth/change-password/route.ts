import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { createLog } from '@/lib/supabase-helpers';
import bcrypt from 'bcryptjs';
import { verifyAuthUser, invalidateUserAuthCache } from '@/lib/token';
import { validateBody, authSchemas } from '@/lib/validators';

// POST /api/auth/change-password
export async function POST(request: NextRequest) {
  try {
    const userId = await verifyAuthUser(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = validateBody(authSchemas.changePassword, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { currentPassword, newPassword } = validation.data;

    // Find user with password
    const { data: user, error: userError } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    if (!user) {
      return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
    }

    // Verify current password
    const isCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isCorrect) {
      return NextResponse.json(
        { error: 'Password lama salah' },
        { status: 400 }
      );
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await db
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', userId);

    // Invalidate auth cache so the old token is re-verified
    invalidateUserAuthCache(userId);

    // Create log (fire-and-forget)
    createLog(db, {
      type: 'activity',
      userId,
      action: 'password_changed',
      message: `User changed their password`
    });

    return NextResponse.json({ message: 'Password berhasil diubah!' });
  } catch (error: any) {
    console.error('Change password error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';

// =====================================================================
// AUTO-MIGRATE: Create user_units junction table if it doesn't exist
// Requires super_admin authentication
// =====================================================================

async function checkAuth(request: NextRequest): Promise<NextResponse | null> {
  const userId = await verifyAuthUser(request.headers.get('authorization'));
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: user, error } = await db.from('users').select('role, is_active, status').eq('id', userId).single();
  if (error || !user || user.role !== 'super_admin' || !user.is_active || user.status !== 'approved') {
    return NextResponse.json({ error: 'Forbidden — super admin only' }, { status: 403 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  const authError = await checkAuth(request);
  if (authError) return authError;

  try {
    // Check if user_units table already exists
    const { error: checkError } = await db
      .from('user_units')
      .select('id')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({ success: true, message: 'user_units table already exists' });
    }

    return NextResponse.json({
      success: false,
      error: 'Table does not exist. Please run the migration SQL from migrations/add-user-units.sql in Supabase Dashboard SQL Editor.',
    }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Check status
export async function GET(request: NextRequest) {
  const authError = await checkAuth(request);
  if (authError) return authError;

  try {
    const { error } = await db
      .from('user_units')
      .select('id')
      .limit(1);

    return NextResponse.json({ exists: !error });
  } catch {
    return NextResponse.json({ exists: false });
  }
}

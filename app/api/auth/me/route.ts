import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAuthToken } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    const userId = verifyAuthToken(request.headers.get('authorization'));
    if (!userId) {
      return NextResponse.json({ error: 'Token tidak valid' }, { status: 401 });
    }

    const { data: user, error: userError } = await db
      .from('users')
      .select('*, unit:units(*)')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    const userCamel = toCamelCase(user);

    if (!userCamel) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Reject inactive or non-approved users even with valid tokens
    if (!userCamel.isActive || userCamel.status !== 'approved') {
      return NextResponse.json({ error: 'Akun sudah tidak aktif, silakan hubungi admin' }, { status: 401 });
    }

    // Fetch user's assigned units from user_units junction table
    let userUnits: any[] = [];
    try {
      const { data: uuData } = await db
        .from('user_units')
        .select('*, unit:units(*)')
        .eq('user_id', userId);

      if (uuData && uuData.length > 0) {
        userUnits = rowsToCamelCase(uuData)
          .map((uu: any) => uu.unit)
          .filter(Boolean);
      } else if (userCamel.unitId) {
        // Fallback: if no user_units entries but user has unit_id, use that
        userUnits = [userCamel.unit];
      }
    } catch {
      // user_units table may not exist — fallback to single unit
      if (userCamel.unit) {
        userUnits = [userCamel.unit];
      }
    }

    const { password: _, ...userWithoutPassword } = userCamel!;

    return NextResponse.json({
      user: {
        ...userWithoutPassword,
        userUnits,
      }
    });
  } catch (error: any) {
    console.error('Get user error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

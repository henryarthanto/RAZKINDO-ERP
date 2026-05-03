import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, generateId } from '@/lib/supabase-helpers';
import { enforceSuperAdmin } from '@/lib/require-auth';

// =====================================================================
// Custom Roles CRUD — for non-ERP employees (OB, Sopir, Security, etc.)
//
// NOTE: Database columns are camelCase (Prisma default, no @map used).
// Supabase PostgREST accepts the actual column names.
// =====================================================================

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    // Use camelCase column names (actual DB column names)
    const { data } = await db
      .from('custom_roles')
      .select('*')
      .order('name', { ascending: true });

    const roles = (data || []).map((r: any) => ({
      ...toCamelCase(r),
      userCount: 0,
    }));

    // Count users per custom role
    if (roles.length > 0) {
      // users table uses snake_case columns
      const { data: users } = await db
        .from('users')
        .select('custom_role_id')
        .not('custom_role_id', 'is', null)
        .eq('is_active', true);

      const countMap: Record<string, number> = {};
      for (const u of (users || [])) {
        const rid = u.custom_role_id;
        if (rid) countMap[rid] = (countMap[rid] || 0) + 1;
      }
      for (const r of roles) {
        (r as any).userCount = countMap[(r as any).id] || 0;
      }
    }

    return NextResponse.json({ roles });
  } catch (error: any) {
    console.error('Custom roles GET error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return authResult.response;

    const { name, description } = await request.json();

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Nama role wajib diisi' }, { status: 400 });
    }

    const roleName = name.trim();

    // Check uniqueness
    const { data: existing } = await db
      .from('custom_roles')
      .select('id')
      .eq('name', roleName)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Nama role sudah ada' }, { status: 400 });
    }

    // Insert with camelCase column names (actual DB columns)
    const { data, error } = await db
      .from('custom_roles')
      .insert({
        id: generateId(),
        name: roleName,
        description: description || null,
        created_by_id: authResult.userId!,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      console.error('Custom roles insert error:', error);
      return NextResponse.json({ error: error.message || 'Gagal membuat role' }, { status: 500 });
    }

    return NextResponse.json({ role: toCamelCase(data) });
  } catch (error: any) {
    console.error('Custom roles POST error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

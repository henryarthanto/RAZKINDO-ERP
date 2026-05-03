import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { rowsToCamelCase, toCamelCase, toSnakeCase, generateId } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const { data: authUser } = await db.from('users').select('id, role').eq('id', authUserId).single();
    if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const year = searchParams.get('year');
    const period = searchParams.get('period');

    let query = db.from('sales_targets').select(`
      *, user:users!user_id(name, email)
    `).order('year', { ascending: false }).order('created_at', { ascending: false });

    if (authUser.role !== 'super_admin') query = query.eq('user_id', authUserId);
    if (userId) query = query.eq('user_id', userId);
    if (year) {
      const parsedYear = parseInt(year, 10);
      if (isNaN(parsedYear)) return NextResponse.json({ error: 'Year harus berupa angka' }, { status: 400 });
      query = query.eq('year', parsedYear);
    }
    if (period) query = query.eq('period', period);

    const { data: targets, error } = await query;
    if (error) throw error;

    return NextResponse.json({ targets: rowsToCamelCase(targets || []) });
  } catch (error: any) {
    console.error('Get sales targets error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth check - only super_admin can create sales targets
    const auth = await enforceSuperAdmin(request);
    if (!auth.success) return auth.response;
    const authUserId = auth.userId;

    const data = await request.json();
    const { userId, period, year, month, quarter, targetAmount, notes } = data;

    if (!userId || !period || !year || !targetAmount) {
      return NextResponse.json({ error: 'Field userId, period, year, dan targetAmount wajib diisi' }, { status: 400 });
    }
    const validPeriods = ['monthly', 'quarterly', 'yearly'];
    if (!validPeriods.includes(period)) return NextResponse.json({ error: 'Period harus salah satu dari: monthly, quarterly, yearly' }, { status: 400 });
    if (typeof targetAmount !== 'number' || targetAmount <= 0) return NextResponse.json({ error: 'targetAmount harus berupa angka dan lebih dari 0' }, { status: 400 });

    const { data: user } = await db.from('users').select('id, role').eq('id', userId).single();
    if (!user) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
    if (user.role !== 'sales') return NextResponse.json({ error: 'Target penjualan hanya dapat diberikan kepada user dengan role sales' }, { status: 400 });

    if (period === 'monthly' && (month === undefined || month === null)) return NextResponse.json({ error: 'Field month wajib diisi untuk period monthly' }, { status: 400 });
    if (period === 'quarterly' && (quarter === undefined || quarter === null)) return NextResponse.json({ error: 'Field quarter wajib diisi untuk period quarterly' }, { status: 400 });
    if (period === 'monthly' && (month < 1 || month > 12)) return NextResponse.json({ error: 'Field month harus bernilai 1-12' }, { status: 400 });
    if (period === 'quarterly' && (quarter < 1 || quarter > 4)) return NextResponse.json({ error: 'Field quarter harus bernilai 1-4' }, { status: 400 });

    const finalMonth = period === 'monthly' ? (month || 0) : 0;
    const finalQuarter = period === 'quarterly' ? (quarter || 0) : 0;

    // Check existing
    const { data: existing } = await db.from('sales_targets').select('id').eq('user_id', userId).eq('period', period).eq('year', year).eq('month', finalMonth).eq('quarter', finalQuarter).maybeSingle();

    if (existing) {
      const { data: target, error } = await db.from('sales_targets').update({
        target_amount: targetAmount, notes: notes ?? undefined, status: 'active',
      }).eq('id', existing.id).select(`
        *, user:users!user_id(name, email)
      `).single();
      if (error) throw error;
      return NextResponse.json({ target: toCamelCase(target) });
    }

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      userId, period, year, month: finalMonth, quarter: finalQuarter,
      targetAmount, notes: notes ?? null, achievedAmount: 0, status: 'active',
      createdAt: now, updatedAt: now,
    });
    const { data: target, error } = await db.from('sales_targets').insert(insertData).select(`
      *, user:users!user_id(name, email)
    `).single();
    if (error) throw error;

    return NextResponse.json({ target: toCamelCase(target) });
  } catch (error: any) {
    console.error('Create sales target error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

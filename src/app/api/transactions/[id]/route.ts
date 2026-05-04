import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';
import { verifyAndGetAuthUser, verifyAuthUser } from '@/lib/token';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await verifyAndGetAuthUser(
      request.headers.get('authorization'),
      { role: true, id: true }
    );
    if (!result) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const authUserRole = (result.user as any).role;
    const { id } = await params;
    
    const { data: transaction, error: txError } = await db
      .from('transactions')
      .select(`
        *,
        unit:units(*),
        created_by:users!created_by_id(*),
        courier:users!courier_id(*),
        customer:customers(*),
        supplier:suppliers(*),
        items:transaction_items(*, product:products(*)),
        payments:payments(*, received_by:users!received_by_id(*))
      `)
      .eq('id', id)
      .maybeSingle();

    if (txError) {
      console.error('Get tx DB error:', txError);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }

    if (!transaction) {
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    const txCamel = toCamelCase(transaction);
    
    // Strip sensitive financial data for non-admin/keuangan roles
    if (authUserRole && !['super_admin', 'keuangan'].includes(authUserRole)) {
      delete txCamel.totalHpp;
      delete txCamel.hppPaid;
      delete txCamel.hppUnpaid;
      delete txCamel.totalProfit;
      delete txCamel.profitPaid;
      delete txCamel.profitUnpaid;
      if (txCamel.items) {
        for (const item of txCamel.items) {
          delete item.hpp;
          delete item.profit;
        }
      }
      if (txCamel.payments) {
        for (const p of txCamel.payments) {
          delete p.hppPortion;
          delete p.profitPortion;
        }
      }
    }

    return NextResponse.json({
      transaction: {
        ...txCamel,
        createdBy: txCamel.createdBy || null,
        courier: txCamel.courier || null,
        customer: txCamel.customer || null,
        supplier: txCamel.supplier || null,
        items: (txCamel.items || []).map((i: any) => ({
          ...i,
          product: i.product || null
        })),
        payments: (txCamel.payments || []).map((p: any) => ({
          ...p,
          receivedBy: p.receivedBy || null
        }))
      }
    });
  } catch (error) {
    console.error('Get transaction error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const data = await request.json();

    // BUG FIX #4: Add role check for PATCH operations
    const { data: authUserData, error: authError } = await db
      .from('users')
      .select('role, is_active, status')
      .eq('id', authUserId)
      .maybeSingle();

    if (authError) {
      console.error('Auth user lookup error:', authError);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
    if (!authUserData || !authUserData.is_active || authUserData.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    // BUG FIX: Use effective roles to support custom roles
    const { fetchEffectiveRolesFromDB } = await import('@/lib/role-permissions');
    const effectiveRoles = await fetchEffectiveRolesFromDB(db, authUserId);
    const patchableRoles = ['super_admin', 'keuangan', 'sales'];
    if (!effectiveRoles.some((r: string) => patchableRoles.includes(r))) {
      return NextResponse.json({ error: 'Role tidak memiliki akses untuk mengubah transaksi' }, { status: 403 });
    }

    // Check existence first
    const { data: existing, error: existError } = await db
      .from('transactions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (existError) {
      console.error('Transaction lookup error:', existError);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'Transaksi tidak ditemukan' },
        { status: 404 }
      );
    }

    // BUG FIX #4: Prevent modifying cancelled transactions
    if (existing.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Transaksi yang sudah dibatalkan tidak dapat diubah' },
        { status: 400 }
      );
    }

    // BUG FIX #10: Validate dueDate BEFORE toISOString to prevent RangeError
    let dueDate: string | null = null;
    if (data.dueDate != null) {
      const parsedDate = new Date(data.dueDate);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: 'Format tanggal tidak valid' },
          { status: 400 }
        );
      }
      dueDate = parsedDate.toISOString();
    }

    const updateData: Record<string, any> = {
      courier_id: (data.courierId && data.courierId !== 'none') ? data.courierId : null,
      notes: data.notes,
      delivery_address: data.deliveryAddress,
      due_date: dueDate
    };

    const { data: transaction, error: updateError } = await db
      .from('transactions')
      .update(updateData)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Update tx error:', updateError);
      return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
    }

    return NextResponse.json({ transaction: toCamelCase(transaction) });
  } catch (error) {
    console.error('Update transaction error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

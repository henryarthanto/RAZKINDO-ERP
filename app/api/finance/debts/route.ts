import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { rowsToCamelCase, toCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const debtType = searchParams.get('debtType');

    let query = db.from('company_debts').select('*, company_debt_payments(*)').eq('is_active', true);
    if (status) query = query.eq('status', status);
    if (debtType) query = query.eq('debt_type', debtType);
    query = query.order('created_at', { ascending: false }).limit(500);

    const { data: debts, error } = await query;
    if (error) throw error;

    // Sort payments by paid_at desc
    const mapped = rowsToCamelCase(debts || []).map((d: any) => ({
      ...d,
      companyDebtPayments: (d.companyDebtPayments || []).sort((a: any, b: any) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime()),
      // Keep backwards-compatible alias
      payments: (d.companyDebtPayments || []).sort((a: any, b: any) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime()),
    }));

    return NextResponse.json({ debts: mapped });
  } catch (error) {
    console.error('Get debts error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const data = await request.json();

    if (!data.creditorName || !data.totalAmount) {
      return NextResponse.json(
        { error: 'Nama kreditor dan jumlah hutang wajib diisi' },
        { status: 400 }
      );
    }

    if (typeof data.totalAmount !== 'number' || data.totalAmount <= 0) {
      return NextResponse.json(
        { error: 'Jumlah hutang harus berupa angka positif' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      creditorName: data.creditorName,
      debtType: data.debtType || 'supplier',
      description: data.description || '',
      totalAmount: data.totalAmount,
      paidAmount: 0,
      remainingAmount: data.totalAmount,
      dueDate: data.dueDate ? new Date(data.dueDate).toISOString() : null,
      notes: data.notes || '',
      createdById: authResult.userId,
      status: 'active',
      isActive: true,
      version: 1,
      createdAt: now, updatedAt: now,
    });

    const { data: debt, error } = await db.from('company_debts').insert(insertData).select().single();
    if (error) throw error;

    createLog(db, {
      type: 'activity',
      userId: authResult.userId,
      action: 'company_debt_created',
      entity: 'company_debt',
      entityId: debt.id,
      payload: JSON.stringify({ creditorName: data.creditorName, amount: data.totalAmount, debtType: data.debtType || 'supplier' }),
    });

    return NextResponse.json({ debt: toCamelCase(debt) });
  } catch (error) {
    console.error('Create debt error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

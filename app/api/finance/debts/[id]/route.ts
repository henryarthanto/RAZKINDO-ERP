import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole, enforceSuperAdmin } from '@/lib/require-auth';
import { toCamelCase, rowsToCamelCase, toSnakeCase } from '@/lib/supabase-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data: debt, error } = await db.from('company_debts').select('*, company_debt_payments(*)').eq('id', id).single();
    if (error || !debt) {
      return NextResponse.json({ error: 'Hutang tidak ditemukan' }, { status: 404 });
    }

    const mapped = toCamelCase(debt) as any;
    const debtPayments = mapped.companyDebtPayments || mapped.payments || [];
    mapped.payments = debtPayments.sort((a: any, b: any) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime());

    return NextResponse.json({ debt: mapped });
  } catch (error: any) {
    console.error('Get debt error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    const data = await request.json();

    const { data: existing, error: fetchError } = await db.from('company_debts').select('*, company_debt_payments(*)').eq('id', id).single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Hutang tidak ditemukan' }, { status: 404 });
    }

    if (data.totalAmount !== undefined) {
      const totalPayments = (existing.company_debt_payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      if (data.totalAmount < totalPayments) {
        return NextResponse.json({ error: 'Total tidak boleh kurang dari yang sudah dibayar' }, { status: 400 });
      }
    }

    if (data.status !== undefined) {
      const VALID_STATUSES = ['active', 'paid', 'cancelled'];
      if (!VALID_STATUSES.includes(data.status)) {
        return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });
      }
    }

    // Build update data (only non-undefined fields)
    const updateData: Record<string, any> = {};
    if (data.creditorName !== undefined) updateData.creditor_name = data.creditorName;
    if (data.debtType !== undefined) updateData.debt_type = data.debtType;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.totalAmount !== undefined) updateData.total_amount = data.totalAmount;
    if (data.dueDate !== undefined) updateData.due_date = data.dueDate ? new Date(data.dueDate).toISOString() : null;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    // Calculate paid/remaining from payments
    const totalPayments = (existing.company_debt_payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const newTotal = data.totalAmount !== undefined ? data.totalAmount : existing.total_amount;
    const remaining = newTotal - totalPayments;
    const newStatus = remaining <= 0 ? 'paid' : (data.status || existing.status);
    
    updateData.paid_amount = totalPayments;
    updateData.remaining_amount = remaining;
    updateData.status = newStatus;

    const { data: updatedDebt, error } = await db.from('company_debts').update(updateData).eq('id', id).select('*, company_debt_payments(*)').single();
    if (error) throw error;

    const mapped = toCamelCase(updatedDebt) as any;
    const debtPayments = mapped.companyDebtPayments || mapped.payments || [];
    mapped.payments = debtPayments.sort((a: any, b: any) => new Date(b.paidAt || b.createdAt).getTime() - new Date(a.paidAt || a.createdAt).getTime());

    return NextResponse.json({ debt: mapped });
  } catch (error: any) {
    console.error('Update debt error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
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

    const { data: existing, error: fetchError } = await db.from('company_debts').select('id').eq('id', id).single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Hutang tidak ditemukan' }, { status: 404 });
    }

    const { error } = await db.from('company_debts').update({ is_active: false }).eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete debt error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

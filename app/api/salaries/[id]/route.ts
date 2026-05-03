import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, toSnakeCase, createLog } from '@/lib/supabase-helpers';

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // FIX: Only super_admin or keuangan can view salary details (or the user's own salary)
    const { data: authUser } = await db.from('users').select('role, id, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const { id } = await params;
    const { data: salary, error } = await db.from('salary_payments').select(`
      *, user:users!user_id(id, name, email, role), finance_request:finance_requests(id, type, amount, status)
    `).eq('id', id).single();

    if (error || !salary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }

    // FIX: Enforce role-based access — only super_admin/keuangan or the salary owner can view
    if (!['super_admin', 'keuangan'].includes(authUser.role) && salary.user_id !== authUser.id) {
      return NextResponse.json({ error: 'Akses ditolak — Anda hanya bisa melihat gaji sendiri' }, { status: 403 });
    }

    return NextResponse.json({ salary: toCamelCase(salary) });
  } catch (error: any) {
    console.error('Get salary error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
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

    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat mengubah gaji' }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    const { data: rawSalary, error: fetchError } = await db.from('salary_payments').select('*, user:users!user_id(id, name)').eq('id', id).single();
    if (fetchError || !rawSalary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }
    const salary = toCamelCase(rawSalary);

    if (salary.status !== 'pending') {
      return NextResponse.json({ error: 'Hanya gaji dengan status pending yang dapat diubah' }, { status: 400 });
    }

    const totalAllowance = (data.transportAllowance ?? salary.transportAllowance) + (data.mealAllowance ?? salary.mealAllowance) + (data.overtimePay ?? salary.overtimePay) + (data.incentive ?? salary.incentive) + (data.otherAllowance ?? salary.otherAllowance) + (data.bonus ?? salary.bonus);
    const totalDeduction = (data.bpjsTk ?? salary.bpjsTk) + (data.bpjsKs ?? salary.bpjsKs) + (data.pph21 ?? salary.pph21) + (data.loanDeduction ?? salary.loanDeduction) + (data.absenceDeduction ?? salary.absenceDeduction) + (data.lateDeduction ?? salary.lateDeduction) + (data.otherDeduction ?? salary.otherDeduction) + (data.deduction ?? salary.deduction);
    const totalAmount = Math.max(0, (data.baseSalary ?? salary.baseSalary) + totalAllowance - totalDeduction);

    const updateData = toSnakeCase({
      baseSalary: data.baseSalary ?? salary.baseSalary,
      transportAllowance: data.transportAllowance ?? salary.transportAllowance,
      mealAllowance: data.mealAllowance ?? salary.mealAllowance,
      overtimePay: data.overtimePay ?? salary.overtimePay,
      incentive: data.incentive ?? salary.incentive,
      otherAllowance: data.otherAllowance ?? salary.otherAllowance,
      bonus: data.bonus ?? salary.bonus,
      bpjsTk: data.bpjsTk ?? salary.bpjsTk,
      bpjsKs: data.bpjsKs ?? salary.bpjsKs,
      pph21: data.pph21 ?? salary.pph21,
      loanDeduction: data.loanDeduction ?? salary.loanDeduction,
      absenceDeduction: data.absenceDeduction ?? salary.absenceDeduction,
      lateDeduction: data.lateDeduction ?? salary.lateDeduction,
      otherDeduction: data.otherDeduction ?? salary.otherDeduction,
      deduction: data.deduction ?? salary.deduction,
      totalAllowance, totalDeduction, totalAmount,
      sourceType: data.sourceType ?? salary.sourceType,
      bankAccountId: data.bankAccountId ?? salary.bankAccountId,
      notes: data.notes ?? salary.notes,
    });

    const { data: updatedSalary, error } = await db.from('salary_payments').update(updateData).eq('id', id).select(`
      *, user:users!user_id(id, name), finance_request:finance_requests(id, type, amount, status)
    `).single();
    if (error) throw error;

    // Update linked FinanceRequest amount
    const updatedSalaryCamel = toCamelCase(updatedSalary);
    if (salary.financeRequestId) {
      const userData = (updatedSalaryCamel as any).user;
      const periodDesc = `Periode ${formatDate(updatedSalaryCamel.periodStart)} s/d ${formatDate(updatedSalaryCamel.periodEnd)}`;
      await db.from('finance_requests').update({
        amount: totalAmount,
        description: `Gaji ${userData?.name || 'Karyawan'} - ${periodDesc}`,
        source_type: data.sourceType ?? salary.sourceType,
        bank_account_id: data.bankAccountId ?? salary.bankAccountId,
      }).eq('id', salary.financeRequestId);
    }

    return NextResponse.json({ salary: updatedSalaryCamel });
  } catch (error: any) {
    console.error('Update salary error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin atau Keuangan yang dapat mengubah gaji' }, { status: 403 });
    }

    const { id } = await params;

    const { data: salary, error: fetchError } = await db.from('salary_payments').select('finance_request_id, status').eq('id', id).single();
    if (fetchError || !salary) {
      return NextResponse.json({ error: 'Data gaji tidak ditemukan' }, { status: 404 });
    }

    if (salary.status !== 'pending') {
      return NextResponse.json({ error: 'Hanya gaji dengan status pending yang dapat dihapus' }, { status: 400 });
    }

    if (salary.finance_request_id) {
      await db.from('finance_requests').delete().eq('id', salary.finance_request_id);
    }
    const { error } = await db.from('salary_payments').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete salary error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

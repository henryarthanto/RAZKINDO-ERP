import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, toSnakeCase } from '@/lib/supabase-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;
    const data = await request.json();

    const { data: bank, error: fetchError } = await db.from('bank_accounts').select('*').eq('id', id).single();
    if (fetchError || !bank) {
      return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
    }

    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.bankName !== undefined) updateData.bank_name = data.bankName;
    if (data.accountNo !== undefined) updateData.account_no = data.accountNo;
    if (data.accountHolder !== undefined) updateData.account_holder = data.accountHolder;
    if (data.branch !== undefined) updateData.branch = data.branch;
    if (data.balance !== undefined) {
      if (authResult.user.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden - Hanya Super Admin yang dapat mengubah saldo rekening' }, { status: 403 });
      }
      updateData.balance = Math.max(0, data.balance);
    }
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;

    const { data: updated, error } = await db.from('bank_accounts').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ bankAccount: toCamelCase(updated) });
  } catch (error: any) {
    console.error('Update bank account error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { id } = await params;

    const { data: bank, error: fetchError } = await db.from('bank_accounts').select('*').eq('id', id).single();
    if (fetchError || !bank) {
      return NextResponse.json({ error: 'Rekening tidak ditemukan' }, { status: 404 });
    }

    if (bank.balance > 0) {
      return NextResponse.json(
        { error: 'Tidak dapat menghapus rekening yang masih memiliki saldo. Saldo saat ini: Rp ' + bank.balance.toLocaleString('id-ID') },
        { status: 400 }
      );
    }

    const { count: activeRequests } = await db.from('finance_requests').select('*', { count: 'exact', head: true }).eq('bank_account_id', id).in('status', ['pending', 'approved']);
    const { count: activeSalaries } = await db.from('salary_payments').select('*', { count: 'exact', head: true }).eq('bank_account_id', id).in('status', ['pending', 'approved']);
    const { count: activeTransfers } = await db.from('fund_transfers').select('*', { count: 'exact', head: true }).eq('from_bank_account_id', id).eq('status', 'pending');

    if ((activeRequests || 0) > 0 || (activeSalaries || 0) > 0 || (activeTransfers || 0) > 0) {
      return NextResponse.json(
        { error: 'Tidak dapat menghapus rekening yang masih digunakan dalam request aktif' },
        { status: 400 }
      );
    }

    const { error } = await db.from('bank_accounts').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete bank account error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, rowsToCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: bankAccounts, error } = await db.from('bank_accounts').select('*').eq('is_active', true).order('name', { ascending: true });
    if (error) throw error;
    
    return NextResponse.json({ bankAccounts: rowsToCamelCase(bankAccounts || []) });
  } catch (error) {
    console.error('Get bank accounts error:', error);
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

    if (!data.name || !data.bankName || !data.accountNo || !data.accountHolder) {
      return NextResponse.json(
        { error: 'Nama, bank, nomor rekening, dan pemilik rekening wajib diisi' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      name: data.name,
      bankName: data.bankName,
      accountNo: data.accountNo,
      accountHolder: data.accountHolder,
      branch: data.branch,
      balance: Math.max(0, data.balance || 0),
      isActive: true,
      version: 1,
      notes: data.notes,
      createdAt: now, updatedAt: now,
    });

    const { data: bankAccount, error } = await db.from('bank_accounts').insert(insertData).select().single();
    if (error) throw error;
    
    createLog(db, {
      type: 'activity',
      userId: authResult.userId,
      action: 'bank_account_created',
      entity: 'bank_account',
      entityId: bankAccount.id,
      message: `Rekening bank ${data.name} dibuat`
    });
    
    return NextResponse.json({ bankAccount: toCamelCase(bankAccount) });
  } catch (error) {
    console.error('Create bank account error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

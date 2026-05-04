import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { toCamelCase, rowsToCamelCase, toSnakeCase, createLog, generateId } from '@/lib/supabase-helpers';
import { validateBody } from '@/lib/validators';

const bankAccountCreateSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  bankName: z.string().min(1, 'Nama bank wajib diisi'),
  accountNo: z.string().min(1, 'Nomor rekening wajib diisi'),
  accountHolder: z.string().min(1, 'Pemilik rekening wajib diisi'),
  branch: z.string().optional(),
  balance: z.number().min(0).optional(),
  notes: z.string().optional(),
});

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

    const rawBody = await request.json();
    const validation = validateBody(bankAccountCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

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

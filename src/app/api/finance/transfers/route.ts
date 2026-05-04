import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';
import { rowsToCamelCase, toSnakeCase, createLog, toCamelCase, generateId } from '@/lib/supabase-helpers';
import { wsFinanceUpdate } from '@/lib/ws-dispatch';
import { validateBody } from '@/lib/validators';

const transferCreateSchema = z.object({
  type: z.enum(['cash_to_bank', 'bank_to_cash', 'bank_to_bank', 'cash_to_cash'], {
    error: 'Tipe transfer tidak valid',
  }),
  amount: z.number().positive('Jumlah transfer harus lebih dari 0'),
  description: z.string().optional(),
  referenceNo: z.string().optional(),
  fromBankAccountId: z.string().nullable().optional(),
  toBankAccountId: z.string().nullable().optional(),
  fromCashBoxId: z.string().nullable().optional(),
  toCashBoxId: z.string().nullable().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: transfers, error } = await db.from('fund_transfers').select(`
      *,
      from_bank_account:bank_accounts!from_bank_account_id(id, name, bank_name, account_no, balance),
      to_bank_account:bank_accounts!to_bank_account_id(id, name, bank_name, account_no, balance),
      from_cash_box:cash_boxes!from_cash_box_id(id, name, balance),
      to_cash_box:cash_boxes!to_cash_box_id(id, name, balance)
    `).order('created_at', { ascending: false }).limit(500);
    if (error) throw error;

    return NextResponse.json({ transfers: rowsToCamelCase(transfers || []) });
  } catch (error) {
    console.error('Get fund transfers error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const rawBody = await request.json();
    const validation = validateBody(transferCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const data = validation.data;

    let fromBankAccountId: string | null = null;
    let toBankAccountId: string | null = null;
    let fromCashBoxId: string | null = null;
    let toCashBoxId: string | null = null;

    switch (data.type) {
      case 'cash_to_bank':
        fromCashBoxId = data.fromCashBoxId || null;
        toBankAccountId = data.toBankAccountId || null;
        if (!fromCashBoxId || !toBankAccountId) return NextResponse.json({ error: 'Brankas sumber dan bank tujuan wajib diisi' }, { status: 400 });
        break;
      case 'bank_to_cash':
        fromBankAccountId = data.fromBankAccountId || null;
        toCashBoxId = data.toCashBoxId || null;
        if (!fromBankAccountId || !toCashBoxId) return NextResponse.json({ error: 'Bank sumber dan brankas tujuan wajib diisi' }, { status: 400 });
        break;
      case 'bank_to_bank':
        fromBankAccountId = data.fromBankAccountId || null;
        toBankAccountId = data.toBankAccountId || null;
        if (!fromBankAccountId || !toBankAccountId) return NextResponse.json({ error: 'Bank sumber dan bank tujuan wajib diisi' }, { status: 400 });
        if (fromBankAccountId === toBankAccountId) return NextResponse.json({ error: 'Bank sumber dan tujuan tidak boleh sama' }, { status: 400 });
        break;
      case 'cash_to_cash':
        fromCashBoxId = data.fromCashBoxId || null;
        toCashBoxId = data.toCashBoxId || null;
        if (!fromCashBoxId || !toCashBoxId) return NextResponse.json({ error: 'Brankas sumber dan brankas tujuan wajib diisi' }, { status: 400 });
        if (fromCashBoxId === toCashBoxId) return NextResponse.json({ error: 'Brankas sumber dan tujuan tidak boleh sama' }, { status: 400 });
        break;
    }

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      type: data.type, fromBankAccountId, toBankAccountId, fromCashBoxId, toCashBoxId,
      amount: data.amount, description: data.description, referenceNo: data.referenceNo, status: 'pending',
      createdAt: now, updatedAt: now,
    });

    const { data: transfer, error } = await db.from('fund_transfers').insert(insertData).select().single();
    if (error) throw error;

    createLog(db, { type: 'activity', userId: authResult.userId, action: 'fund_transfer_created', entity: 'fund_transfer', entityId: transfer.id, message: `Transfer dana sebesar ${data.amount} dibuat` });

    wsFinanceUpdate({ transferId: transfer.id, amount: data.amount, type: data.type });

    return NextResponse.json({ transfer: toCamelCase(transfer) });
  } catch (error) {
    console.error('Create fund transfer error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

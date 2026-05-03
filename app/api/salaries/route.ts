import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { rowsToCamelCase, toSnakeCase, createLog, createEvent, toCamelCase, generateId } from '@/lib/supabase-helpers';
import { enforceFinanceRole } from '@/lib/require-auth';

export async function GET(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');
    const period = searchParams.get('period');

    let query = db.from('salary_payments').select(`
      *, user:users!user_id(id, name, email, role), finance_request:finance_requests(id, type, amount, status)
    `).order('created_at', { ascending: false }).limit(500);

    if (userId) query = query.eq('user_id', userId);
    if (status) query = query.eq('status', status);
    if (period) {
      const [start, end] = period.split(',');
      if (start && end) query = query.gte('period_start', new Date(start).toISOString()).lte('period_end', new Date(end).toISOString());
    }

    const { data: salaries, error } = await query;
    if (error) {
      console.error('[Salaries GET] Query error:', JSON.stringify({ message: error.message, code: error.code, details: (error as any).details }));
      throw error;
    }

    const mapped = rowsToCamelCase(salaries || []);
    const stats = {
      totalPaid: mapped.filter((s: any) => s.status === 'paid').reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0),
      totalPending: mapped.filter((s: any) => s.status === 'pending').reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0),
      totalApproved: mapped.filter((s: any) => s.status === 'approved').reduce((sum: number, s: any) => sum + (s.totalAmount || 0), 0),
      paidCount: mapped.filter((s: any) => s.status === 'paid').length,
      pendingCount: mapped.filter((s: any) => s.status === 'pending').length,
    };

    return NextResponse.json({ salaries: mapped, stats });
  } catch (error: any) {
    console.error('Get salaries error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceFinanceRole(request);
    if (!authResult.success) return authResult.response;
    const { userId: authUserId } = authResult;

    const data = await request.json();

    if (!data.userId) return NextResponse.json({ error: 'ID karyawan wajib diisi' }, { status: 400 });
    if (!data.baseSalary || data.baseSalary <= 0) return NextResponse.json({ error: 'Gaji pokok harus lebih dari 0' }, { status: 400 });
    if (!data.periodStart || !data.periodEnd) return NextResponse.json({ error: 'Periode gaji wajib diisi' }, { status: 400 });

    const totalAllowance = (data.transportAllowance || 0) + (data.mealAllowance || 0) + (data.overtimePay || 0) + (data.incentive || 0) + (data.otherAllowance || 0) + (data.bonus || 0);
    const totalDeduction = (data.bpjsTk || 0) + (data.bpjsKs || 0) + (data.pph21 || 0) + (data.loanDeduction || 0) + (data.absenceDeduction || 0) + (data.lateDeduction || 0) + (data.otherDeduction || 0) + (data.deduction || 0);
    const totalAmount = Math.max(0, data.baseSalary + totalAllowance - totalDeduction);

    const { data: userData } = await db.from('users').select('name').eq('id', data.userId).maybeSingle();
    const periodDesc = `Periode ${data.periodStart} s/d ${data.periodEnd}`;
    const description = `Gaji ${userData?.name || 'Karyawan'} - ${periodDesc}`;

    // Security: Use authenticated user ID for the finance request (prevent impersonation)
    const requestById = authUserId;

    // ── Check for duplicate salary for same user + period ──
    const periodStart = new Date(data.periodStart).toISOString();
    const periodEnd = new Date(data.periodEnd).toISOString();

    const { data: existingSalary } = await db
      .from('salary_payments')
      .select('id, status')
      .eq('user_id', data.userId)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .maybeSingle();

    if (existingSalary) {
      return NextResponse.json({
        error: `Slip gaji untuk karyawan ini dengan periode yang sama sudah ada (status: ${existingSalary.status})`,
      }, { status: 409 });
    }

    // ── Step 1: Create FinanceRequest ──
    const now = new Date().toISOString();
    const frData = toSnakeCase({
      id: generateId(),
      type: 'salary', requestById, unitId: data.unitId || null,
      amount: totalAmount, description, notes: data.notes || null, status: 'pending',
      goodsStatus: 'pending', version: 1,
      createdAt: now, updatedAt: now,
    });

    console.log('[Salary POST] Creating finance_request:', JSON.stringify({ ...frData, id: frData.id?.substring(0, 8) + '...' }));

    const { data: financeRequest, error: frError } = await db.from('finance_requests').insert(frData).select().single();
    if (frError || !financeRequest) {
      console.error('[Salary POST] FinanceRequest insert FAILED:', JSON.stringify({
        message: frError?.message,
        code: frError?.code,
        details: (frError as any)?.details,
        hint: (frError as any)?.hint,
      }));
      return NextResponse.json({ error: 'Gagal membuat request keuangan: ' + (frError?.message || 'Unknown error') }, { status: 500 });
    }

    // ── Step 2: Create SalaryPayment ──
    let salary: any;
    try {
      const salaryData = toSnakeCase({
        id: generateId(),
        userId: data.userId, periodStart, periodEnd,
        baseSalary: data.baseSalary, transportAllowance: data.transportAllowance || 0, mealAllowance: data.mealAllowance || 0,
        overtimePay: data.overtimePay || 0, incentive: data.incentive || 0, otherAllowance: data.otherAllowance || 0, bonus: data.bonus || 0,
        bpjsTk: data.bpjsTk || 0, bpjsKs: data.bpjsKs || 0, pph21: data.pph21 || 0,
        loanDeduction: data.loanDeduction || 0, absenceDeduction: data.absenceDeduction || 0, lateDeduction: data.lateDeduction || 0,
        otherDeduction: data.otherDeduction || 0, deduction: data.deduction || 0,
        totalAllowance, totalDeduction, totalAmount, financeRequestId: financeRequest.id, notes: data.notes || null,
        sourceType: 'cash', version: 1,
        status: 'pending',
        createdAt: now, updatedAt: now,
      });

      console.log('[Salary POST] Creating salary_payment:', JSON.stringify({ ...salaryData, id: salaryData.id?.substring(0, 8) + '...' }));

      const { data: s, error: sError } = await db.from('salary_payments').insert(salaryData).select(`
        *, user:users!user_id(id, name, email, role), finance_request:finance_requests(id, type, amount, status)
      `).single();

      if (sError || !s) {
        console.error('[Salary POST] SalaryPayment insert FAILED:', JSON.stringify({
          message: sError?.message,
          code: sError?.code,
          details: (sError as any)?.details,
          hint: (sError as any)?.hint,
        }));
        throw sError;
      }
      salary = s;
    } catch (salaryError: any) {
      // Compensating rollback: delete the orphaned FinanceRequest
      console.error('[Salary POST] Rolling back finance_request:', financeRequest.id);
      try {
        await db.from('finance_requests').delete().eq('id', financeRequest.id);
      } catch (rollbackErr) {
        console.error('[Salary POST] Rollback FAILED:', rollbackErr);
      }

      // Return specific error message
      const errMsg = salaryError?.message || String(salaryError);
      if (errMsg.includes('duplicate') || errMsg.includes('unique') || errMsg.includes('23505')) {
        return NextResponse.json({ error: 'Slip gaji untuk karyawan ini dengan periode yang sama sudah ada' }, { status: 409 });
      }
      if (errMsg.includes('foreign key') || errMsg.includes('23503')) {
        return NextResponse.json({ error: 'Data referensi tidak valid. Pastikan karyawan dan unit sudah benar.' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Gagal membuat slip gaji: ' + errMsg }, { status: 500 });
    }

    createEvent(db, 'salary_request_created', { salaryId: salary.id, requestId: financeRequest.id, userId: data.userId, userName: userData?.name, amount: totalAmount, period: periodDesc });
    createLog(db, { type: 'activity', userId: requestById, action: 'salary_created', entity: 'salary', entityId: salary.id, payload: JSON.stringify({ userId: data.userId, amount: totalAmount, financeRequestId: financeRequest.id }), message: `Slip gaji dibuat untuk ${userData?.name}: ${totalAmount}` });

    return NextResponse.json({ salary: toCamelCase(salary) });
  } catch (error: any) {
    console.error('[Salary POST] Unhandled error:', error);
    const errMsg = error?.message || 'Terjadi kesalahan server';
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

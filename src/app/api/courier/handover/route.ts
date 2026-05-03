import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { createLog, createEvent } from '@/lib/supabase-helpers';
import { wsFinanceUpdate, wsCourierUpdate } from '@/lib/ws-dispatch';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Authorization: only kurir (own), super_admin, and keuangan can view handovers
    const { data: authUser } = await db
      .from('users')
      .select('role, is_active, status')
      .eq('id', authUserId)
      .single();
    if (!authUser?.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (authUser.role !== 'kurir' && authUser.role !== 'super_admin' && authUser.role !== 'keuangan') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const courierId = searchParams.get('courierId');
    if (!courierId) return NextResponse.json({ error: 'courierId diperlukan' }, { status: 400 });

    // Kurir can only view their own handovers
    if (authUser.role === 'kurir' && authUserId !== courierId) {
      return NextResponse.json({ error: 'Kurir hanya bisa melihat handover sendiri' }, { status: 403 });
    }

    const { data: courierCashList, error } = await db.from('courier_cash').select(`
      *, unit:units(id, name), handovers:courier_handovers(*)
    `).eq('courier_id', courierId);
    if (error) throw error;

    const totalBalance = (courierCashList || []).reduce((sum: number, cc: any) => sum + cc.balance, 0);

    return NextResponse.json({
      courierCashList,
      totalBalance,
      totalCollected: (courierCashList || []).reduce((sum: number, cc: any) => sum + cc.total_collected, 0),
      totalHandover: (courierCashList || []).reduce((sum: number, cc: any) => sum + cc.total_handover, 0),
    });
  } catch (error) {
    console.error('Get courier cash error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const data = await request.json();
    let { courierId, unitId, amount, notes } = data;
    if (!courierId || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'courierId dan amount (angka positif) diperlukan' }, { status: 400 });
    }

    const roundedAmount = Math.round(amount);

    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser?.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akun tidak aktif. Hubungi admin.' }, { status: 401 });
    }
    if (authUser.role !== 'kurir' && authUser.role !== 'super_admin') {
      return NextResponse.json({ error: 'Akses ditolak - Hanya kurir atau super admin' }, { status: 403 });
    }

    // Courier can only handover for their own ID
    if (authUser.role === 'kurir' && authUserId !== courierId) {
      return NextResponse.json({ error: 'Kurir hanya bisa melakukan handover untuk diri sendiri' }, { status: 403 });
    }

    // ── Auto-detect unitId if not provided ──
    // Check users.unit_id first, then fall back to user_units junction table
    if (!unitId) {
      const { data: courierUser } = await db.from('users').select('unit_id').eq('id', courierId).single();
      unitId = courierUser?.unit_id || '';

      if (!unitId) {
        // Try user_units junction table (column names: user_id, unit_id per @map)
        const { data: userUnits } = await db.from('user_units').select('unit_id').eq('user_id', courierId).limit(1);
        if (userUnits && userUnits.length > 0) {
          unitId = userUnits[0].unit_id;
        }
      }

      if (!unitId) {
        return NextResponse.json({ error: 'Kurir belum di-assign ke unit manapun. Hubungi admin.' }, { status: 400 });
      }
    }

    // ── PRE-FLIGHT: Verify courier_cash balance for the target unit ──
    // This provides a clear error BEFORE calling the expensive RPC, and tells
    // the user exactly what went wrong (including per-unit breakdown).
    const { data: courierCashRecords } = await db
      .from('courier_cash')
      .select('id, unit_id, balance, total_collected, total_handover')
      .eq('courier_id', courierId);

    const targetUnitCash = (courierCashRecords || []).find((cc: any) => cc.unit_id === unitId);
    const targetUnitBalance = targetUnitCash ? (Number(targetUnitCash.balance) || 0) : 0;
    const totalAcrossUnits = (courierCashRecords || []).reduce((sum: number, cc: any) => sum + (Number(cc.balance) || 0), 0);

    if (targetUnitBalance < roundedAmount) {
      // Build a detailed error message with per-unit breakdown
      const unitNames: string[] = [];
      const otherUnits = (courierCashRecords || []).filter((cc: any) => cc.unit_id !== unitId && (Number(cc.balance) || 0) > 0);

      // Fetch unit names for error message
      if (otherUnits.length > 0) {
        const unitIds = otherUnits.map((cc: any) => cc.unit_id);
        const { data: unitData } = await db.from('units').select('id, name').in('id', unitIds);
        const unitNameMap: Record<string, string> = {};
        if (unitData) {
          (unitData as any[]).forEach((u: any) => { unitNameMap[u.id] = u.name; });
        }
        for (const cc of otherUnits) {
          unitNames.push(`${unitNameMap[cc.unit_id] || 'unit lain'}: ${formatCurrency(Number(cc.balance) || 0)}`);
        }
      }

      let errorMsg = `Saldo cash di unit ini tidak cukup. Tersedia: ${formatCurrency(targetUnitBalance)}, Diminta: ${formatCurrency(roundedAmount)}.`;
      if (otherUnits.length > 0) {
        errorMsg += ` Saldo di unit lain: ${unitNames.join(', ')}. Total semua unit: ${formatCurrency(totalAcrossUnits)}.`;
        errorMsg += ' Pilih unit yang benar di halaman dashboard.';
      } else if (totalAcrossUnits === 0) {
        errorMsg += ' Anda belum memiliki saldo cash. Kumpulkan cash dari pengiriman terlebih dahulu.';
      }

      console.warn('[HANDOVER] Pre-flight balance check failed:', {
        courierId, unitId, requested: roundedAmount,
        unitBalance: targetUnitBalance, totalBalance: totalAcrossUnits,
      });

      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    // ── ATOMIC HANDOVER: Single RPC call handles everything in one DB transaction ──
    // The RPC process_courier_handover atomically:
    // 1. Gets or creates courier_cash record
    // 2. Validates sufficient balance (FOR UPDATE lock)
    // 3. Deducts from courier_cash balance
    // 4. Gets or creates brankas (cash_box)
    // 5. Credits brankas balance
    // 6. Creates finance_request (type: courier_deposit)
    // 7. Creates courier_handover record
    // 8. Returns all results as JSONB
    const { data: result, error: rpcError } = await db.rpc('process_courier_handover', {
      p_courier_id: courierId,
      p_unit_id: unitId,
      p_amount: roundedAmount,
      p_processed_by_id: authUserId,
      p_notes: notes || null,
    });

    if (rpcError) {
      const errMsg = rpcError.message || 'Gagal memproses setor brankas';
      const errCode = (rpcError as any).code || '';
      const errHint = (rpcError as any).hint || '';
      console.error('[HANDOVER] RPC error:', { errMsg, errCode, errHint, courierId, unitId, amount: roundedAmount });

      if (errMsg.includes('tidak cukup') || errMsg.includes('insufficient')) {
        return NextResponse.json({
          error: `Saldo cash tidak cukup untuk melakukan handover sebesar ${formatCurrency(roundedAmount)}. Tersedia: ${formatCurrency(targetUnitBalance)}`
        }, { status: 400 });
      }
      if (errMsg.includes('does not exist') || errMsg.includes('relationship') || errCode === '23503') {
        return NextResponse.json({
          error: 'Data referensi tidak ditemukan. Pastikan unit dan kurir sudah terdaftar dengan benar.'
        }, { status: 400 });
      }
      if (errCode === '42501') {
        return NextResponse.json({
          error: 'Akses ditolak oleh database. Hubungi admin untuk memperbaiki permission fungsi process_courier_handover.'
        }, { status: 500 });
      }
      throw new Error(errMsg);
    }

    if (!result) {
      throw new Error('Gagal memproses setor brankas — tidak ada respons dari server');
    }

    const handoverId = result.handover_id;
    const financeRequestId = result.finance_request_id;
    const cashBoxId = result.cash_box_id;
    const newBalance = Number(result.new_balance) || 0;
    const brankasBalance = Number(result.cash_box_balance) || 0;

    // Get courier name for logging
    const { data: courier } = await db.from('users').select('name').eq('id', courierId).single();

    createLog(db, {
      type: 'activity', userId: courierId, action: 'courier_cash_handover', entity: 'courier_handover', entityId: handoverId,
      payload: JSON.stringify({ amount: roundedAmount, financeRequestId, cashBoxId, courierNewBalance: newBalance, brankasNewBalance: brankasBalance }),
      message: `Kurir ${courier?.name || 'Unknown'} menyetor ${formatCurrency(roundedAmount)} ke brankas`,
    });

    createEvent(db, 'courier_handover', {
      handoverId, courierId, courierName: courier?.name || 'Unknown',
      amount: roundedAmount, financeRequestId, cashBoxId, unitId,
      updatedBalance: newBalance, brankasBalance,
    });

    wsFinanceUpdate({ type: 'courier_handover', unitId });
    wsCourierUpdate({ courierId });

    return NextResponse.json({
      handoverId,
      financeRequestId,
      cashBoxId,
      updatedBalance: newBalance,
      brankasBalance,
    });
  } catch (error) {
    console.error('Create handover error:', error);
    const message = error instanceof Error ? error.message : 'Terjadi kesalahan server';
    const isValidationError = message.includes('tidak cukup') || message.includes('harus') || message.includes('wajib') || message.includes('valid') || message.includes('belum memiliki') || message.includes('belum di-assign');
    return NextResponse.json({ error: message }, { status: isValidationError ? 400 : 500 });
  }
}

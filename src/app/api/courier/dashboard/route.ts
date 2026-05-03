import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAndGetAuthUser } from '@/lib/token';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAndGetAuthUser(request.headers.get('authorization'), { role: true });
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const authUserId = authResult.userId;
    const authUser = authResult.user;

    const { searchParams } = new URL(request.url);
    const courierId = searchParams.get('courierId');
    const period = searchParams.get('period') || 'month';

    if (!courierId) return NextResponse.json({ error: 'courierId diperlukan' }, { status: 400 });

    // Authorization: only kurir (own dashboard), super_admin, and keuangan can access
    if (authUser.role !== 'kurir' && authUser.role !== 'super_admin' && authUser.role !== 'keuangan') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    // Kurir can only access their own dashboard
    if (authUser.role === 'kurir' && authUserId !== courierId) {
      return NextResponse.json({ error: 'Kurir hanya bisa melihat dashboard sendiri' }, { status: 403 });
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let startDate: Date;
    if (period === 'day') startDate = today;
    else if (period === 'week') { startDate = new Date(today); startDate.setDate(startDate.getDate() - startDate.getDay()); }
    else startDate = new Date(now.getFullYear(), now.getMonth(), 1);

    const { data: courier } = await db.from('users').select('id, near_commission, far_commission, unit_id, name').eq('id', courierId).single();
    if (!courier) return NextResponse.json({ error: 'Kurir tidak ditemukan' }, { status: 404 });

    const startISO = startDate.toISOString();
    const endISO = now.toISOString();

    // Courier cash — include per-unit breakdown for accurate handover UX
    const { data: allCourierCashRecords } = await db.from('courier_cash').select(`
      *, unit:units(id, name)
    `).eq('courier_id', courierId).limit(500);
    const totalBalance = (allCourierCashRecords || []).reduce((sum: number, c: any) => sum + (c.balance || 0), 0);
    const totalCollected = (allCourierCashRecords || []).reduce((sum: number, c: any) => sum + (c.total_collected || 0), 0);
    const totalHandedOver = (allCourierCashRecords || []).reduce((sum: number, c: any) => sum + (c.total_handover || 0), 0);

    // Per-unit balance map: { [unitId]: { balance, totalCollected, totalHandover, unitName } }
    const unitBalanceMap: Record<string, { balance: number; totalCollected: number; totalHandover: number; unitId: string; unitName: string }> = {};
    for (const cc of (allCourierCashRecords || [])) {
      unitBalanceMap[cc.unit_id] = {
        balance: cc.balance || 0,
        totalCollected: cc.total_collected || 0,
        totalHandover: cc.total_handover || 0,
        unitId: cc.unit_id,
        unitName: (cc.unit as any)?.name || 'Unknown Unit',
      };
    }

    const allCashIds = (allCourierCashRecords || []).map((c: any) => c.id);
    let pendingHandovers: any[] = [];
    if (allCashIds.length > 0) {
      const { data: ph } = await db.from('courier_handovers').select('*').in('courier_cash_id', allCashIds).eq('status', 'pending').order('created_at', { ascending: false }).limit(500);
      pendingHandovers = ph || [];
    }
    const totalPendingHandover = pendingHandovers.reduce((sum: number, h: any) => sum + h.amount, 0);

    let handoverHistory: any[] = [];
    if (allCashIds.length > 0) {
      const { data: hh } = await db.from('courier_handovers').select('*').in('courier_cash_id', allCashIds).order('created_at', { ascending: false }).limit(20);
      handoverHistory = hh || [];
    }

    // Deliveries
    const { data: deliveries } = await db.from('transactions').select(`
      *, customer:customers(id, name, distance, phone), unit:units(id, name), payments:payments(id, amount, paymentMethod, received_by_id)
    `).eq('courier_id', courierId).eq('type', 'sale').gte('delivered_at', startISO).lte('delivered_at', endISO).in('status', ['approved', 'paid']).order('delivered_at', { ascending: false }).limit(500);

    const totalDeliveries = (deliveries || []).length;
    const totalDeliveryAmount = (deliveries || []).reduce((s: number, d: any) => s + d.total, 0);

    let totalCommission = 0, nearDeliveries = 0, farDeliveries = 0, cashCollected = 0, transferCollected = 0, piutangRemaining = 0;
    for (const d of (deliveries || [])) {
      const distance = d.delivery_distance || (d.customer as any)?.distance || 'near';
      const isFar = distance === 'far';
      if (isFar) { farDeliveries++; totalCommission += courier.far_commission || 0; }
      else { nearDeliveries++; totalCommission += courier.near_commission || 0; }
      const deliveryPayments = ((d as any).payments || []).filter((p: any) => p.received_by_id === courierId);
      cashCollected += deliveryPayments.filter((p: any) => p.paymentMethod === 'cash').reduce((s: number, p: any) => s + p.amount, 0);
      transferCollected += deliveryPayments.filter((p: any) => p.paymentMethod === 'transfer').reduce((s: number, p: any) => s + p.amount, 0);
    }
    piutangRemaining = (deliveries || []).reduce((s: number, d: any) => s + (d.remaining_amount || 0), 0);

    // Chart data
    const chartData: { date: string; deliveries: number; cash: number; commission: number }[] = [];
    const chartStart = new Date(startDate);
    while (chartStart <= now) {
      const dayStart = new Date(chartStart);
      const dayEnd = new Date(chartStart); dayEnd.setHours(23, 59, 59, 999);
      const dayDeliveries = (deliveries || []).filter((d: any) => { if (!d.delivered_at) return false; const dd = new Date(d.delivered_at); return dd >= dayStart && dd <= dayEnd; });
      const dayCash = dayDeliveries.reduce((s: number, d: any) => { const dps = ((d as any).payments || []).filter((p: any) => p.received_by_id === courierId && p.paymentMethod === 'cash'); return s + dps.reduce((ss: number, p: any) => ss + p.amount, 0); }, 0);
      const dayCommission = dayDeliveries.reduce((s: number, d: any) => { const dist = d.delivery_distance || (d.customer as any)?.distance || 'near'; return s + (dist === 'far' ? (courier.far_commission || 0) : (courier.near_commission || 0)); }, 0);
      chartData.push({ date: dayStart.toISOString().split('T')[0], deliveries: dayDeliveries.length, cash: dayCash, commission: dayCommission });
      chartStart.setDate(chartStart.getDate() + 1);
    }

    const todayDeliveries = (deliveries || []).filter((d: any) => { if (!d.delivered_at) return false; return new Date(d.delivered_at) >= today; });
    const todayCash = todayDeliveries.reduce((s: number, d: any) => { const dps = ((d as any).payments || []).filter((p: any) => p.received_by_id === courierId && p.paymentMethod === 'cash'); return s + dps.reduce((ss: number, p: any) => ss + p.amount, 0); }, 0);

    const { data: pendingDeliveries } = await db.from('transactions').select(`
      id, invoice_no, total, paid_amount, remaining_amount, payment_method, payment_status,
      transaction_date, deliveryAddress, delivery_distance, courier_commission, notes,
      customer:customers(id, name, distance, phone), unit:units(id, name)
    `).eq('courier_id', courierId).eq('type', 'sale').eq('status', 'approved').eq('payment_status', 'unpaid').is('delivered_at', null).order('created_at', { ascending: false }).limit(10);

    return NextResponse.json({
      dashboard: {
        period, startDate: startDate.toISOString(), endDate: now.toISOString(),
        courier: { id: courierId, name: courier.name, nearCommission: courier.near_commission, farCommission: courier.far_commission },
        stats: { totalDeliveries, totalDeliveryAmount, totalCommission, nearDeliveries, farDeliveries, cashCollected, transferCollected, piutangRemaining },
        todayStats: { deliveries: todayDeliveries.length, cashCollected: todayCash },
        cashBalance: {
          current: totalBalance,
          totalCollected,
          totalHandover: totalHandedOver,
          pendingHandover: totalPendingHandover,
          unitBalances: unitBalanceMap,  // NEW: per-unit breakdown
        },
        pendingDeliveries: rowsToCamelCase(pendingDeliveries || []),
        chartData, handoverHistory: rowsToCamelCase(handoverHistory),
      },
    });
  } catch (error) {
    console.error('Courier dashboard error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

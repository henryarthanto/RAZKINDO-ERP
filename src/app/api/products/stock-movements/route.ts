import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';

export async function GET(request: NextRequest) {
  try {
    // ── Auth check ──
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Parse query params ──
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get('productId');
    const type = searchParams.get('type'); // "in" or "out"
    const dateFrom = searchParams.get('dateFrom'); // YYYY-MM-DD
    const dateTo = searchParams.get('dateTo'); // YYYY-MM-DD
    const rawLimit = parseInt(searchParams.get('limit') || '50');
    const rawOffset = parseInt(searchParams.get('offset') || '0');
    const limit = Math.max(1, Math.min(rawLimit || 50, 200));
    const offset = Math.max(0, rawOffset || 0);

    // ── Build base query ──
    let query = db
      .from('logs')
      .select('*', { count: 'exact' })
      .like('action', 'stock_updated%')
      .eq('entity', 'product')
      .order('created_at', { ascending: false });

    // ── Apply filters ──
    if (productId) {
      query = query.eq('entity_id', productId);
    }

    if (type === 'in' || type === 'out') {
      // Payload is a JSON string — filter with ilike pattern
      query = query.ilike('payload', `%"type":"${type}"%`);
    }

    if (dateFrom) {
      const startOfDay = `${dateFrom}T00:00:00.000Z`;
      query = query.gte('created_at', startOfDay);
    }

    if (dateTo) {
      const endOfDay = `${dateTo}T23:59:59.999Z`;
      query = query.lte('created_at', endOfDay);
    }

    // ── Execute paginated query ──
    const { data: logs, count, error } = await query
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Stock movements query error:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data pergerakan stok' },
        { status: 500 }
      );
    }

    if (!logs || logs.length === 0) {
      return NextResponse.json({
        movements: [],
        total: count || 0,
        limit,
        offset,
      });
    }

    // ── Resolve referenced entities in batch ──
    const productIds = [...new Set(logs.map((l: any) => l.entity_id).filter(Boolean))];
    const userIds = [...new Set(logs.map((l: any) => l.user_id).filter(Boolean))];

    // Parse payloads to extract unitIds for per_unit movements
    const unitIds: string[] = [];
    for (const log of logs) {
      try {
        const payload = typeof log.payload === 'string'
          ? JSON.parse(log.payload)
          : log.payload;
        if (payload?.unitId) {
          unitIds.push(payload.unitId);
        }
      } catch {
        // Skip malformed payloads
      }
    }
    const uniqueUnitIds = [...new Set(unitIds.filter(Boolean))];

    // Batch fetch products, users, and units in parallel
    const [productsResult, usersResult, unitsResult] = await Promise.all([
      productIds.length > 0
        ? db.from('products').select('id, name, sku, unit, sub_unit, conversion_rate').in('id', productIds)
        : Promise.resolve({ data: [] }),
      userIds.length > 0
        ? db.from('users').select('id, name').in('id', userIds)
        : Promise.resolve({ data: [] }),
      uniqueUnitIds.length > 0
        ? db.from('units').select('id, name').in('id', uniqueUnitIds)
        : Promise.resolve({ data: [] }),
    ]);

    // Build lookup maps
    const productMap = new Map<string, any>(
      (productsResult.data || []).map((p: any) => [p.id, toCamelCase(p)])
    );
    const userMap = new Map<string, string>(
      (usersResult.data || []).map((u: any) => [u.id, u.name])
    );
    const unitMap = new Map<string, string>(
      (unitsResult.data || []).map((u: any) => [u.id, u.name])
    );

    // ── Transform logs to movement records ──
    const movements = logs.map((log: any) => {
      const logCamel = toCamelCase(log);

      // Parse payload JSON
      let payload: Record<string, any> = {};
      try {
        payload = typeof log.payload === 'string'
          ? JSON.parse(log.payload)
          : (log.payload || {});
      } catch {
        payload = {};
      }

      const product: any = productMap.get(log.entity_id) || {};
      const userName = userMap.get(log.user_id as string) || 'Unknown';

      // For per_unit movements, resolve unit label
      let unitLabel: string | null = null;
      if (payload.stockType === 'per_unit' && payload.unitId) {
        unitLabel = unitMap.get(payload.unitId as string) || null;
      }

      return {
        id: logCamel.id,
        productId: log.entity_id,
        productName: product.name || 'Unknown',
        productSku: product.sku || null,
        type: payload.type || null,
        stockType: payload.stockType || null,
        quantity: payload.quantity ?? null,
        quantityInSubUnits: payload.quantityInSubUnits ?? null,
        stockUnitType: payload.stockUnitType || null,
        unitName: product.unit || null,
        subUnit: product.subUnit || null,
        conversionRate: product.conversionRate ?? null,
        newStock: payload.newStock ?? null,
        unitLabel,
        userName,
        createdAt: log.created_at,
      };
    });

    return NextResponse.json({
      movements,
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Get stock movements error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase } from '@/lib/supabase-helpers';

// =====================================================================
// PWA Products - Public (no auth required)
// GET /api/pwa/[code]/products — Returns active products for the customer
// Products the customer frequently purchases are shown first with badges
// =====================================================================

interface ProductInfo {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  subUnit: string | null;
  conversionRate: number | null;
  price: number;
  stock: number;
  imageUrl: string | null;
  purchaseCount: number;
  lastPurchased: string | null;
  dealPrice: number | null;      // Harga deal per main unit (negotiated price)
  dealSubUnitPrice: number | null; // Harga deal per sub unit
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    if (!code || code.trim().length === 0) {
      return NextResponse.json(
        { error: 'Kode pelanggan diperlukan' },
        { status: 400 }
      );
    }

    // Look up customer to get unit_id
    const { data: customer, error: customerError } = await db
      .from('customers')
      .select('id, unit_id')
      .eq('code', code.trim().toUpperCase())
      .eq('status', 'active')
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: 'Kode pelanggan tidak ditemukan' },
        { status: 404 }
      );
    }

    // ── Run all queries in parallel for maximum speed ──
    const [
      purchaseHistoryResult,
      unitProductsResult,
      productsResult,
      dealPricesResult,
      approvedPricesResult,
    ] = await Promise.all([
      // Purchase history: single nested query (no batching needed)
      db
        .from('transactions')
        .select('transaction_items(product_id, qty, price, created_at)')
        .eq('customer_id', customer.id)
        .eq('type', 'sale')
        .neq('status', 'cancelled'),

      // Per-unit stock mapping
      db
        .from('unit_products')
        .select('product_id, stock')
        .eq('unit_id', customer.unit_id),

      // All active products
      db
        .from('products')
        .select('id, name, sku, unit, sub_unit, conversion_rate, selling_price, global_stock, min_stock, is_active, stock_type, image_url')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(500),

      // Customer deal prices (negotiated prices from previous approvals)
      db
        .from('customer_prices')
        .select('product_id, deal_price, sub_unit_price, updated_at')
        .eq('customer_id', customer.id)
        .eq('is_active', true),

      // Fallback: fetch latest approved transaction item prices per product
      db
        .from('transactions')
        .select('id, transaction_items(product_id, price, created_at)')
        .eq('customer_id', customer.id)
        .eq('status', 'approved')
        .eq('type', 'sale')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    // ── Build purchase frequency map from nested results ──
    const purchaseMap = new Map<string, { count: number; totalQty: number; lastDate: string }>();
    const transactions = purchaseHistoryResult.data;
    if (Array.isArray(transactions)) {
      for (const tx of transactions) {
        const items = (tx as any).transaction_items;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const pid = item.product_id;
          if (!pid) continue;
          const existing = purchaseMap.get(pid);
          const itemDate = item.created_at || '';
          if (existing) {
            existing.count += 1;
            existing.totalQty += item.qty || 0;
            if (itemDate > existing.lastDate) existing.lastDate = itemDate;
          } else {
            purchaseMap.set(pid, { count: 1, totalQty: item.qty || 0, lastDate: itemDate });
          }
        }
      }
    }

    // ── Build unit product stock map ──
    const unitProductMap = new Map<string, { stock: number }>();
    const unitProducts = unitProductsResult.data;
    if (Array.isArray(unitProducts)) {
      for (const up of unitProducts) {
        unitProductMap.set(up.product_id, { stock: up.stock });
      }
    }

    // ── Build deal price map (customer-specific negotiated prices) ──
    const dealPriceMap = new Map<string, { dealPrice: number; subUnitPrice: number; updatedAt: string }>();
    const dealPrices = dealPricesResult.data;
    if (Array.isArray(dealPrices)) {
      for (const dp of dealPrices) {
        dealPriceMap.set(dp.product_id, {
          dealPrice: dp.deal_price || 0,
          subUnitPrice: dp.sub_unit_price || 0,
          updatedAt: dp.updated_at || '',
        });
      }
    }

    // ── Fallback: Build deal price from latest approved transaction items ──
    // If customer_prices has no entry for a product, use the price from
    // the customer's most recent approved transaction for that product
    const approvedTxs = approvedPricesResult.data;
    if (Array.isArray(approvedTxs)) {
      for (const tx of approvedTxs) {
        const items = (tx as any).transaction_items;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const pid = item.product_id;
          if (!pid) continue;
          // Only use as fallback if no deal price exists yet in customer_prices
          if (!dealPriceMap.has(pid) && item.price && item.price > 0) {
            dealPriceMap.set(pid, {
              dealPrice: item.price,
              subUnitPrice: 0,
              updatedAt: item.created_at || '',
            });
          }
        }
      }
    }

    // ── Build product list with purchase info ──
    const products = productsResult.data;
    if (productsResult.error) {
      console.error('PWA products fetch error:', productsResult.error);
      return NextResponse.json(
        { error: 'Gagal memuat produk' },
        { status: 500 }
      );
    }

    const productList: ProductInfo[] = [];

    for (const p of (products || [])) {
      const camel = toCamelCase(p);
      const productId = camel.id;

      // Determine effective stock based on stock_type
      let effectiveStock: number;
      if (camel.stockType === 'per_unit') {
        const up = unitProductMap.get(productId);
        if (!up) continue; // Skip products not assigned to this unit
        effectiveStock = up.stock;
      } else {
        // centralized or other
        effectiveStock = camel.globalStock || 0;
      }

      // Purchase history for this product
      const purchaseInfo = purchaseMap.get(productId);

      // Deal price for this customer-product combination
      const dealInfo = dealPriceMap.get(productId);

      productList.push({
        id: productId,
        name: camel.name,
        sku: camel.sku,
        unit: camel.unit,
        subUnit: camel.subUnit,
        conversionRate: camel.conversionRate,
        price: 0, // Base price hidden from customers — this is a pengajuan (price request)
        stock: effectiveStock,
        imageUrl: camel.imageUrl,
        purchaseCount: purchaseInfo?.count || 0,
        lastPurchased: purchaseInfo?.lastDate || null,
        dealPrice: dealInfo?.dealPrice && dealInfo.dealPrice > 0 ? dealInfo.dealPrice : null,
        dealSubUnitPrice: dealInfo?.subUnitPrice && dealInfo.subUnitPrice > 0 ? dealInfo.subUnitPrice : null,
      });
    }

    // ── Sort: deal price products first, then frequently purchased, then by name ──
    productList.sort((a, b) => {
      // Products with deal prices come first
      const aHasDeal = (a.dealPrice && a.dealPrice > 0) ? 1 : 0;
      const bHasDeal = (b.dealPrice && b.dealPrice > 0) ? 1 : 0;
      if (aHasDeal !== bHasDeal) return bHasDeal - aHasDeal;

      // Among deal price products, sort by frequency (desc)
      if (aHasDeal && bHasDeal) {
        if (a.purchaseCount !== b.purchaseCount) return b.purchaseCount - a.purchaseCount;
      }

      // Products with purchase history come next
      if (a.purchaseCount > 0 && b.purchaseCount === 0) return -1;
      if (a.purchaseCount === 0 && b.purchaseCount > 0) return 1;
      // Among purchased products, sort by frequency (desc) then last purchased (desc)
      if (a.purchaseCount > 0 && b.purchaseCount > 0) {
        if (a.purchaseCount !== b.purchaseCount) return b.purchaseCount - a.purchaseCount;
        const aLast = a.lastPurchased || '';
        const bLast = b.lastPurchased || '';
        if (aLast > bLast) return -1;
        if (aLast < bLast) return 1;
      }
      // No purchase history: sort alphabetically
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      products: productList,
    });
  } catch (error) {
    console.error('PWA products error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

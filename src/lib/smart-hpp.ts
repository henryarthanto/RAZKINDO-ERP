// =====================================================================
// Smart HPP / Profit Calculation Engine
// =====================================================================
// Server-side source of truth for all financial calculations.
// NEVER trust client-sent HPP — always recalculate from product data.
//
// Features:
//  - Server-side HPP from product data (never from client)
//  - 3-tier HPP fallback: avgHpp → purchasePrice → purchaseHistoryHppMap
//  - Server-side qtyInSubUnit recalculation using product.conversionRate
//  - Loss detection: warns when selling price < total HPP
//  - Zero HPP protection: flags products with no cost data at all tiers
//  - Works regardless of track_stock, user role, or source (PWA/ERP)
// =====================================================================

export interface SmartProduct {
  id: string;
  avgHpp: number;
  purchasePrice: number;
  conversionRate: number;
  sellingPrice: number;
  sellPricePerSubUnit: number;
  trackStock: boolean;
  stockType: string;
  unit: string | null;
  subUnit: string | null;
  name?: string;
}

export interface ClientItem {
  productId: string;
  productName: string;
  qty: number;
  price: number;
  qtyInSubUnit?: number;
  qtyUnitType?: 'main' | 'sub';
  hpp?: number; // client-sent (will be OVERRIDDEN)
  [key: string]: any;
}

export interface CalculatedItem extends ClientItem {
  /** Server-calculated qty in smallest unit (sub-unit) */
  serverQtyInSubUnit: number;
  /** Server-calculated HPP per sub-unit (from 3-tier fallback) */
  serverHppPerSubUnit: number;
  /** Which tier provided the HPP: 1=avgHpp, 2=purchasePrice, 3=purchaseHistory, 0=none */
  hppTier: number;
  /** Total HPP for this line item */
  itemTotalHpp: number;
  /** Subtotal (qty × price) */
  subtotal: number;
  /** Profit (subtotal - itemTotalHpp) */
  profit: number;
  /** Profit margin percentage */
  profitMargin: number;
  /** Whether this item is selling at a loss */
  isLoss: boolean;
  /** Whether product has zero HPP even after all fallback tiers */
  isZeroHpp: boolean;
  /** Reference to source product data */
  _product: SmartProduct;
}

export interface CalculationResult {
  /** Per-item calculations */
  items: CalculatedItem[];
  /** Total selling amount */
  total: number;
  /** Total HPP (cost) */
  totalHpp: number;
  /** Total profit */
  totalProfit: number;
  /** Overall profit margin % */
  profitMargin: number;
  /** Items selling at loss */
  lossItems: CalculatedItem[];
  /** Items with zero HPP (no cost data at all tiers) */
  zeroHppItems: CalculatedItem[];
  /** Audit warnings for logging */
  warnings: string[];
}

/**
 * Calculate HPP and profit for a list of items using server-side product data.
 *
 * Uses a 3-tier HPP fallback strategy:
 *   Tier 1: product.avgHpp (from stock movement calculations)
 *   Tier 2: product.purchasePrice (last known purchase price)
 *   Tier 3: fallbackHppMap (derived from recent purchase transaction items)
 *
 * @param clientItems - Items from the request body (client-sent)
 * @param productMap - Map<productId, SmartProduct> from server DB query
 * @param fallbackHppMap - Optional Map<productId, avgHpp> from purchase history
 * @returns Complete calculation result with per-item and aggregate data
 */
export function calculateSmartHpp(
  clientItems: ClientItem[],
  productMap: Map<string, SmartProduct>,
  fallbackHppMap?: Map<string, number>
): CalculationResult {
  const items: CalculatedItem[] = [];
  const warnings: string[] = [];
  let total = 0;
  let totalHpp = 0;

  for (const item of clientItems) {
    const product = productMap.get(item.productId as string);
    if (!product) {
      warnings.push(`Produk ${item.productId} tidak ditemukan di database — HPP dianggap 0`);
      // FIX: Don't skip items — include with zero HPP to maintain index alignment.
      // Previously, `continue` here caused calcResult.items to be shorter than
      // clientItems, breaking index-based mapping in callers.
      const subtotal = item.qty * item.price;
      items.push({
        ...item,
        serverQtyInSubUnit: item.qty,
        serverHppPerSubUnit: 0,
        hppTier: 0,
        itemTotalHpp: 0,
        subtotal,
        profit: subtotal,
        profitMargin: subtotal > 0 ? 100 : 0,
        isLoss: false,
        isZeroHpp: true,
        _product: {} as SmartProduct,
      });
      total += subtotal;
      continue;
    }

    // ─── Step 1: Recalculate qtyInSubUnit SERVER-SIDE ───
    // The client may send wrong conversion. We recalculate based on product data.
    const convRate = product.conversionRate || 1;
    const qtyUnitType = item.qtyUnitType || 'sub';
    const serverQtyInSubUnit = qtyUnitType === 'main'
      ? item.qty * convRate
      : item.qty;

    // ─── Step 2: 3-tier HPP fallback ───
    // Tier 1: avgHpp (from stock movement calculations)
    let hpp = product.avgHpp || 0;
    let hppTier = 1;

    // Tier 2: purchasePrice (last known purchase price per sub-unit)
    if (hpp <= 0) {
      hpp = product.purchasePrice || 0;
      hppTier = 2;
    }

    // Tier 3: purchase history fallback (average from recent purchase items)
    if (hpp <= 0 && fallbackHppMap) {
      hpp = fallbackHppMap.get(item.productId) || 0;
      hppTier = 3;
    }

    const serverHppPerSubUnit = hpp;
    const itemTotalHpp = serverQtyInSubUnit * serverHppPerSubUnit;

    // ─── Step 3: Calculate financials ───
    const subtotal = item.qty * item.price;
    const profit = subtotal - itemTotalHpp;
    const profitMargin = subtotal > 0 ? (profit / subtotal) * 100 : 0;
    const isLoss = profit < 0;
    const isZeroHpp = serverHppPerSubUnit === 0;

    // ─── Step 4: Generate warnings ───
    if (isLoss) {
      const lossAmount = Math.abs(profit);
      warnings.push(
        `RUGI: ${item.productName} — HPP Rp ${itemTotalHpp.toLocaleString('id-ID')} > Jual Rp ${subtotal.toLocaleString('id-ID')} (rugi Rp ${lossAmount.toLocaleString('id-ID')})`
      );
    }

    if (isZeroHpp && item.price > 0) {
      warnings.push(
        `HPP NOL: ${item.productName} — semua tier HPP kosong (avgHpp=0, purchasePrice=0, purchaseHistory=0), profit tidak terhitung (dijual Rp ${subtotal.toLocaleString('id-ID')})`
      );
    } else if (hppTier === 3 && !isZeroHpp) {
      warnings.push(
        `HPP FALLBACK: ${item.productName} — menggunakan HPP dari riwayat pembelian (tier 3) karena avgHpp dan purchasePrice kosong`
      );
    } else if (hppTier === 2 && !isZeroHpp) {
      warnings.push(
        `HPP FALLBACK: ${item.productName} — menggunakan purchasePrice (tier 2) karena avgHpp kosong`
      );
    }

    // Check if client-sent qtyInSubUnit differs from server calculation
    if (item.qtyInSubUnit !== undefined && item.qtyInSubUnit !== serverQtyInSubUnit) {
      warnings.push(
        `KONVERSI BEDA: ${item.productName} — client qtyInSubUnit=${item.qtyInSubUnit}, server=${serverQtyInSubUnit} (convRate=${convRate}, qtyUnitType=${qtyUnitType})`
      );
    }

    // Check if client-sent HPP differs from server HPP
    if (item.hpp !== undefined && item.hpp !== serverHppPerSubUnit && item.hpp !== 0) {
      warnings.push(
        `HPP BEDA: ${item.productName} — client hpp=${item.hpp}, server hpp=${serverHppPerSubUnit} (tier ${hppTier}) (menggunakan server value)`
      );
    }

    total += subtotal;
    totalHpp += itemTotalHpp;

    items.push({
      ...item,
      serverQtyInSubUnit,
      serverHppPerSubUnit,
      hppTier,
      itemTotalHpp,
      subtotal,
      profit,
      profitMargin,
      isLoss,
      isZeroHpp,
      _product: product,
    });
  }

  const totalProfit = total - totalHpp;
  const lossItems = items.filter(i => i.isLoss);
  const zeroHppItems = items.filter(i => i.isZeroHpp);
  const profitMargin = total > 0 ? (totalProfit / total) * 100 : 0;

  return {
    items,
    total,
    totalHpp,
    totalProfit,
    profitMargin,
    lossItems,
    zeroHppItems,
    warnings,
  };
}

/**
 * Recalculate HPP/profit for existing transaction items (for mark-lunas, corrections, etc.)
 * Uses 3-tier fallback: avgHpp → purchasePrice → fallbackHppMap.
 *
 * @param txItems - Existing transaction items from DB
 * @param productMap - Map<productId, SmartProduct> from server DB query
 * @param fallbackHppMap - Optional Map<productId, avgHpp> from purchase history
 * @returns Corrected calculation result + list of items that need updating
 */
export function recalculateTransactionHpp(
  txItems: Array<{
    id: string;
    productId: string;
    productName: string;
    qty: number;
    qtyInSubUnit: number;
    qtyUnitType: string;
    price: number;
    hpp: number;
    subtotal: number;
    profit: number;
  }>,
  productMap: Map<string, SmartProduct>,
  fallbackHppMap?: Map<string, number>
): {
  /** Recalculated totals */
  correctTotalHpp: number;
  correctTotalProfit: number;
  /** Items where stored HPP differs from current best-available HPP */
  staleItems: Array<{
    itemId: string;
    productName: string;
    storedHpp: number;
    currentHpp: number;
    storedProfit: number;
    correctProfit: number;
    storedTotalHpp: number;
    correctTotalHpp: number;
  }>;
  warnings: string[];
} {
  let correctTotalHpp = 0;
  const staleItems: Array<any> = [];
  const warnings: string[] = [];

  for (const txItem of txItems) {
    const product = productMap.get(txItem.productId);
    if (!product) continue;

    // 3-tier HPP fallback
    let currentHppPerSubUnit = product.avgHpp || 0;
    let hppTier = 1;

    if (currentHppPerSubUnit <= 0) {
      currentHppPerSubUnit = product.purchasePrice || 0;
      hppTier = 2;
    }

    if (currentHppPerSubUnit <= 0 && fallbackHppMap) {
      currentHppPerSubUnit = fallbackHppMap.get(txItem.productId) || 0;
      hppTier = 3;
    }

    const qtyInSub = txItem.qtyInSubUnit || txItem.qty;
    const correctItemTotalHpp = qtyInSub * currentHppPerSubUnit;
    const correctProfit = txItem.subtotal - correctItemTotalHpp;

    correctTotalHpp += correctItemTotalHpp;

    // Compare with stored values
    if (txItem.hpp !== currentHppPerSubUnit) {
      staleItems.push({
        itemId: txItem.id,
        productName: txItem.productName,
        storedHpp: txItem.hpp,
        currentHpp: currentHppPerSubUnit,
        storedProfit: txItem.profit,
        correctProfit,
        storedTotalHpp: (txItem.qtyInSubUnit || txItem.qty) * txItem.hpp,
        correctTotalHpp,
      });
      warnings.push(
        `HPP STALE: ${txItem.productName} — stored=${txItem.hpp}, current=${currentHppPerSubUnit} (tier ${hppTier}) (diff=${Math.abs(txItem.hpp - currentHppPerSubUnit).toFixed(2)})`
      );
    }
  }

  const correctTotalProfit = txItems.reduce((sum, i) => sum + i.subtotal, 0) - correctTotalHpp;

  return {
    correctTotalHpp,
    correctTotalProfit,
    staleItems,
    warnings,
  };
}

/**
 * Fetch average HPP per sub-unit from recent purchase transaction items.
 * This is Tier 3 of the HPP fallback — used when avgHpp and purchasePrice are both 0.
 *
 * Queries transaction_items joined with transactions where type = 'purchase',
 * gets the last 5 purchase items per product, and calculates the average hpp.
 *
 * @param productIds - Array of product IDs to fetch purchase history for
 * @param db - Supabase client (any typed as generic DB client)
 * @returns Map<productId, averageHpp> from recent purchases
 */
export async function fetchPurchaseHistoryHpp(
  productIds: string[],
  db: any
): Promise<Map<string, number>> {
  const resultMap = new Map<string, number>();

  if (!productIds || productIds.length === 0) return resultMap;

  try {
    // Query purchase transactions with their items
    const { data, error } = await db
      .from('transactions')
      .select(`
        id,
        created_at,
        items:transaction_items(product_id, hpp)
      `)
      .eq('type', 'purchase')
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !data) {
      console.warn('[SMART-HPP] fetchPurchaseHistoryHpp query error:', error);
      return resultMap;
    }

    const productIdSet = new Set(productIds);

    // Collect all purchase items for the requested products, ordered by recency
    // Group items per product, maintaining insertion order (most recent first)
    const itemsByProduct = new Map<string, number[]>();

    for (const tx of data) {
      const txItems = tx.items || [];
      for (const item of txItems) {
        const pid = item.product_id;
        if (!productIdSet.has(pid)) continue;
        if (!itemsByProduct.has(pid)) {
          itemsByProduct.set(pid, []);
        }
        itemsByProduct.get(pid)!.push(item.hpp);
      }
    }

    // Calculate average HPP from the last 5 purchase items per product
    for (const [productId, hppValues] of itemsByProduct) {
      // Take last 5 items (already ordered by most recent first)
      const recentHpps = hppValues.slice(0, 5);
      const avgHpp = recentHpps.reduce((sum, h) => sum + h, 0) / recentHpps.length;
      if (avgHpp > 0) {
        resultMap.set(productId, Math.round(avgHpp * 100) / 100); // round to 2 decimals
      }
    }
  } catch (err) {
    console.error('[SMART-HPP] fetchPurchaseHistoryHpp unexpected error:', err);
  }

  return resultMap;
}

/**
 * Build Supabase select fields for fetching product financial data.
 * Use this in .select() calls to ensure all needed fields are available.
 */
export const PRODUCT_FINANCIAL_SELECT = 'id, avg_hpp, purchase_price, conversionRate, track_stock, stock_type, unit, subUnit, sell_price_per_sub_unit, selling_price, name';

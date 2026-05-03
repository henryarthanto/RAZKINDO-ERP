import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { enforceFinanceRole } from '@/lib/require-auth';

export async function GET(request: NextRequest) {
  try {
    // ── Auth check - only super_admin or keuangan can access asset values ──
    const auth = await enforceFinanceRole(request);
    if (!auth.success) return auth.response;

    // ── Fetch all active products ──
    const { data: products, error } = await db
      .from('products')
      .select('id, name, category, global_stock, avg_hpp, selling_price, sell_price_per_sub_unit, conversion_rate, min_stock, is_active')
      .eq('is_active', true);

    if (error) {
      console.error('Asset value query error:', error);
      return NextResponse.json(
        { error: 'Gagal mengambil data nilai aset' },
        { status: 500 }
      );
    }

    const productList = rowsToCamelCase(products || []);

    // ── Calculate aggregate metrics ──
    let totalAssetValue = 0;
    let totalSellingValue = 0;
    let productCount = productList.length;
    let lowStockCount = 0;

    // Category breakdown map
    const categoryMap = new Map<string, { assetValue: number; productCount: number }>();

    // Array for top products (sorted later)
    const productValues: Array<{
      id: string;
      name: string;
      assetValue: number;
      stock: number;
      hpp: number;
    }> = [];

    for (const p of productList) {
      const stock = p.globalStock || 0;
      const hpp = p.avgHpp || 0;
      const conversionRate = p.conversionRate || 1;

      // Asset value = stock * avg_hpp
      const assetValue = stock * hpp;
      totalAssetValue += assetValue;

      // Selling value: prefer sell_price_per_sub_unit, otherwise selling_price / conversion_rate
      let sellingValue = 0;
      const sellPricePerSub = p.sellPricePerSubUnit || 0;
      const sellPrice = p.sellingPrice || 0;
      if (sellPricePerSub > 0) {
        sellingValue = stock * sellPricePerSub;
      } else if (sellPrice > 0) {
        sellingValue = (stock / conversionRate) * sellPrice;
      }
      totalSellingValue += sellingValue;

      // Low stock check
      const minStock = p.minStock || 0;
      if (stock <= minStock) {
        lowStockCount++;
      }

      // Category breakdown
      const category = p.category || 'Uncategorized';
      const catEntry = categoryMap.get(category) || { assetValue: 0, productCount: 0 };
      catEntry.assetValue += assetValue;
      catEntry.productCount += 1;
      categoryMap.set(category, catEntry);

      // Collect for top products
      productValues.push({
        id: p.id,
        name: p.name,
        assetValue,
        stock,
        hpp,
      });
    }

    // ── Build categories array sorted by asset value descending ──
    const categories = Array.from(categoryMap.entries())
      .map(([name, data]) => ({
        name,
        assetValue: data.assetValue,
        productCount: data.productCount,
      }))
      .sort((a, b) => b.assetValue - a.assetValue);

    // ── Top 5 most valuable products ──
    const topProducts = productValues
      .sort((a, b) => b.assetValue - a.assetValue)
      .slice(0, 5);

    return NextResponse.json({
      totalAssetValue,
      totalSellingValue,
      productCount,
      lowStockCount,
      categories,
      topProducts,
    });
  } catch (error) {
    console.error('Get asset value error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

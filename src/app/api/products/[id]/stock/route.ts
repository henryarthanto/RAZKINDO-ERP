import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, rowsToCamelCase, createLog, createEvent, generateId } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { wsStockUpdate } from '@/lib/ws-dispatch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin, keuangan, or gudang can modify stock
    const { data: authUser } = await db
      .from('users')
      .select('role, is_active, status')
      .eq('id', authUserId)
      .single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan', 'gudang'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin, Keuangan, atau Gudang yang dapat mengubah stok' }, { status: 403 });
    }

    const { id } = await params;
    const { quantity, type, unitId, hpp, stockUnitType } = await request.json();

    if (!quantity || quantity <= 0) {
      return NextResponse.json(
        { error: 'Jumlah tidak valid' },
        { status: 400 }
      );
    }

    if (type !== 'in' && type !== 'out') {
      return NextResponse.json({ error: 'Tipe harus in atau out' }, { status: 400 });
    }

    // Initial read for validation
    const { data: product } = await db
      .from('products')
      .select(`
        *,
        unit_products:unit_products(*)
      `)
      .eq('id', id)
      .single();

    if (!product) {
      return NextResponse.json(
        { error: 'Produk tidak ditemukan' },
        { status: 404 }
      );
    }

    const productCamel = toCamelCase(product);

    // Block stock operations if trackStock is disabled
    if (productCamel.trackStock === false) {
      return NextResponse.json(
        { error: 'Produk ini tidak melacak stok. Aktifkan "Lacak Stok" terlebih dahulu.' },
        { status: 400 }
      );
    }

    // Convert quantity to subUnits based on stockUnitType
    const conversionRate = productCamel.conversionRate || 1;
    const quantityInSubUnits = stockUnitType === 'main'
      ? quantity * conversionRate
      : quantity;

    // === CENTRALIZED PRODUCT ===
    if (productCamel.stockType === 'centralized') {
      if (type === 'in') {
        // Use atomic RPC for stock + HPP recalculation
        const { data: rpcResult, error: rpcError } = await db.rpc('increment_stock_with_hpp', {
          p_product_id: id,
          p_qty: quantityInSubUnits,
          p_new_hpp: hpp || 0
        });
        if (rpcError) throw new Error('Gagal update stok: ' + rpcError.message);

        const newGlobalStock = Number((rpcResult as any)?.new_stock) || 0;
        const newAvgHpp = Number((rpcResult as any)?.new_avg_hpp) || 0;

        createLog(db, {
          type: 'activity',
          action: 'stock_updated_centralized',
          entity: 'product',
          entityId: id,
          payload: JSON.stringify({ quantity, quantityInSubUnits, stockUnitType, type, stockType: 'centralized', newStock: newGlobalStock, newAvgHpp })
        });

        if (newGlobalStock <= productCamel.minStock) {
          createEvent(db, 'stock_low', { productId: id, productName: productCamel.name, currentStock: newGlobalStock, minStock: productCamel.minStock });
        }

        wsStockUpdate({ productId: id, productName: productCamel.name });

        return NextResponse.json({ product: { ...productCamel, globalStock: newGlobalStock, avgHpp: newAvgHpp } });
      } else {
        // Use atomic decrement
        const { error: rpcError } = await db.rpc('decrement_stock', {
          p_product_id: id,
          p_qty: quantityInSubUnits
        });
        if (rpcError) throw new Error('Stok tidak cukup: ' + rpcError.message);

        const { data: updatedProduct } = await db.from('products').select('global_stock, avg_hpp').eq('id', id).single();
        const newGlobalStock = updatedProduct?.global_stock || 0;
        const newAvgHpp = updatedProduct?.avg_hpp || 0;

        createLog(db, {
          type: 'activity',
          action: 'stock_updated_centralized',
          entity: 'product',
          entityId: id,
          payload: JSON.stringify({ quantity, quantityInSubUnits, stockUnitType, type, stockType: 'centralized', newStock: newGlobalStock })
        });

        wsStockUpdate({ productId: id, productName: productCamel.name });
        return NextResponse.json({ product: { ...productCamel, globalStock: newGlobalStock, avgHpp: newAvgHpp } });
      }
    }

    // === PER-UNIT PRODUCT ===
    if (productCamel.stockType === 'per_unit') {
      if (!unitId) {
        return NextResponse.json(
          { error: 'Produk per-unit memerlukan pemilihan cabang. Pilih cabang terlebih dahulu.' },
          { status: 400 }
        );
      }

      const freshProductData = await db
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      const freshProduct = freshProductData?.data;
      if (!freshProduct) throw new Error('Produk tidak ditemukan');

      if (type === 'in') {
        // Find or create unit_product record first
        const { data: unitProductRecord } = await db
          .from('unit_products')
          .select('id')
          .eq('unit_id', unitId)
          .eq('product_id', id)
          .maybeSingle();

        if (!unitProductRecord) {
          // Create record if not exists
          await db.from('unit_products').insert({
            id: generateId(),
            unit_id: unitId,
            product_id: id,
            stock: quantityInSubUnits,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } else {
          // Use atomic RPC for unit stock increment
          await db.rpc('increment_unit_stock', {
            p_unit_product_id: unitProductRecord.id,
            p_qty: quantityInSubUnits
          });
        }
        // Recalculate global stock atomically using RPC
        await db.rpc('recalc_global_stock', { p_product_id: id });
        const { data: updatedProduct } = await db.from('products').select('global_stock, avg_hpp').eq('id', id).single();
        const newGlobalStock = updatedProduct?.global_stock || 0;
        const newAvgHpp = updatedProduct?.avg_hpp || 0;

        createLog(db, {
          type: 'activity', action: 'stock_updated_per_unit', entity: 'product', entityId: id,
          payload: JSON.stringify({ quantity, quantityInSubUnits, stockUnitType, type, unitId, stockType: 'per_unit', newGlobalStock })
        });

        const { data: unit } = await db.from('units').select('*').eq('id', unitId).single();
        wsStockUpdate({ productId: id, productName: freshProduct.name || productCamel.name, unitId });
        // Get actual unit stock after update
        const { data: unitProductAfter } = await db.from('unit_products').select('stock').eq('unit_id', unitId).eq('product_id', id).maybeSingle();
        return NextResponse.json({ product: { ...productCamel, globalStock: newGlobalStock, avgHpp: newAvgHpp }, unitProduct: { stock: Number(unitProductAfter?.stock) || 0, unit: toCamelCase(unit) } });
      } else {
        // Use atomic RPC for unit stock decrement
        const { data: existingUnitProduct } = await db.from('unit_products').select('*').eq('unit_id', unitId).eq('product_id', id).maybeSingle();
        if (!existingUnitProduct) {
          return NextResponse.json({ error: 'Stok unit untuk produk ini belum ada di cabang ini' }, { status: 400 });
        }
        const { error: rpcError } = await db.rpc('decrement_unit_stock', {
          p_unit_product_id: existingUnitProduct.id,
          p_qty: quantityInSubUnits
        });
        if (rpcError) throw new Error('Stok unit tidak cukup: ' + rpcError.message);

        await db.rpc('recalc_global_stock', { p_product_id: id });
        const { data: updatedProduct } = await db.from('products').select('global_stock, avg_hpp').eq('id', id).single();

        createLog(db, {
          type: 'activity', action: 'stock_updated_per_unit', entity: 'product', entityId: id,
          payload: JSON.stringify({ quantity, quantityInSubUnits, stockUnitType, type, unitId, stockType: 'per_unit', newStock: updatedProduct?.global_stock })
        });

        const { data: unit } = await db.from('units').select('*').eq('id', unitId).single();
        // Fetch actual unit stock (not global stock)
        const { data: unitProductAfter } = await db.from('unit_products').select('stock').eq('unit_id', unitId).eq('product_id', id).maybeSingle();
        wsStockUpdate({ productId: id, productName: freshProduct.name || productCamel.name, unitId });
        return NextResponse.json({
          product: { ...productCamel, globalStock: updatedProduct?.global_stock || 0, avgHpp: updatedProduct?.avg_hpp || 0 },
          unitProduct: { stock: Number(unitProductAfter?.stock) || 0, unit: toCamelCase(unit) }
        });
      }
    }

    return NextResponse.json({ error: 'Tipe stok produk tidak dikenali' }, { status: 400 });
  } catch (error) {
    console.error('Update stock error:', error);
    return NextResponse.json(
      { error: 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

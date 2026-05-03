import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { toCamelCase, toSnakeCase, generateId, createEvent, createLog } from '@/lib/supabase-helpers';
import { verifyAuthUser } from '@/lib/token';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    
    const { data: product } = await db
      .from('products')
      .select(`
        *,
        unit_products:unit_products(*, unit:units(*))
      `)
      .eq('id', id)
      .single();

    if (!product) {
      return NextResponse.json(
        { error: 'Produk tidak ditemukan' },
        { status: 404 }
      );
    }

    // Strip HPP for non-admin/finance users
    const { data: authUser } = await db.from('users').select('role').eq('id', authUserId).single();
    const canSeeHpp = authUser && ['super_admin', 'keuangan'].includes(authUser.role);
    if (!canSeeHpp) {
      delete (product as any).avg_hpp;
      // Also strip from unit_products if present
      if ((product as any).unit_products) {
        for (const up of (product as any).unit_products) {
          delete up.avg_hpp;
        }
      }
    }

    return NextResponse.json({ product: toCamelCase(product) });
  } catch (error: any) {
    console.error('Get product error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin, keuangan, or gudang can update products
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    if (!['super_admin', 'keuangan', 'gudang'].includes(authUser.role)) {
      return NextResponse.json({ error: 'Hanya Super Admin, Keuangan, atau Gudang yang dapat mengubah produk' }, { status: 403 });
    }

    const { id } = await params;
    const data = await request.json();

    // Check existence first
    const { data: existing } = await db
      .from('products')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Produk tidak ditemukan' }, { status: 404 });
    }

    // Handle unit product assignments
    if (data.stockType === 'per_unit' && Array.isArray(data.assignedUnits)) {
      const { data: existingUnitProducts } = await db
        .from('unit_products')
        .select('unit_id')
        .eq('product_id', id);
      const existingUnitIds = (existingUnitProducts || []).map((up: any) => up.unit_id);

      // Create entries for newly assigned units
      const newUnitProducts = data.assignedUnits
        .filter((unitId: string) => !existingUnitIds.includes(unitId))
        .map((unitId: string) => ({
          id: generateId(),
          unit_id: unitId,
          product_id: id,
          stock: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

      if (newUnitProducts.length > 0) {
        await db.from('unit_products').insert(newUnitProducts);
      }
    }

    // Build update data (only include defined fields)
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.unit !== undefined) updateData.unit = data.unit;
    if (data.subUnit !== undefined) updateData.sub_unit = data.subUnit;
    if (data.conversionRate !== undefined) updateData.conversion_rate = data.conversionRate;
    if (data.avgHpp !== undefined) updateData.avg_hpp = data.avgHpp;
    if (data.sellingPrice !== undefined) updateData.selling_price = data.sellingPrice;
    if (data.sellPricePerSubUnit !== undefined) updateData.sell_price_per_sub_unit = data.sellPricePerSubUnit;
    if (data.minStock !== undefined) updateData.min_stock = data.minStock;
    if (data.stockType !== undefined) updateData.stock_type = data.stockType;
    if (data.trackStock !== undefined) updateData.track_stock = data.trackStock;
    if (data.imageUrl !== undefined) updateData.image_url = data.imageUrl;

    const { data: product } = await db
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        unit_products:unit_products(*, unit:units(*))
      `)
      .single();

    createEvent(db, 'product_updated', { productId: id, productName: data.name || toCamelCase(product).name });
    createLog(db, { type: 'activity', userId: authUserId, action: 'product_updated', entity: 'product', entityId: id });

    return NextResponse.json({ product: toCamelCase(product) });
  } catch (error: any) {
    console.error('Update product error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only super_admin can deactivate products
    const { data: authUser } = await db.from('users').select('role, is_active, status').eq('id', authUserId).single();
    // FIX: Also check is_active and status — deactivated users should not be able to delete products
    if (!authUser || authUser.role !== 'super_admin' || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Hanya Super Admin yang dapat menghapus produk' }, { status: 403 });
    }

    const { id } = await params;

    const { data: existing } = await db
      .from('products')
      .select('*')
      .eq('id', id)
      .single();
    if (!existing) {
      return NextResponse.json({ error: 'Produk tidak ditemukan' }, { status: 404 });
    }

    await db
      .from('products')
      .update({ is_active: false })
      .eq('id', id);

    createEvent(db, 'product_deleted', { productId: id, productName: toCamelCase(existing).name });
    createLog(db, { type: 'activity', userId: authUserId, action: 'product_deactivated', entity: 'product', entityId: id });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete product error:', error);
    return NextResponse.json(
      { error: error?.message || 'Terjadi kesalahan server' },
      { status: 500 }
    );
  }
}

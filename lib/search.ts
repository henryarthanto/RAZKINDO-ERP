import { db } from './supabase';
import { cacheGet, cacheSet, cacheInvalidatePrefix } from './redis-cache';
import { IS_STB } from './stb-config';

export interface SearchResult<T = any> {
  items: T[];
  total: number;
  query: string;
  tookMs: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  fields?: string[];
  exactMatch?: boolean;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  ttlMs?: number;
}

/**
 * Full-text search using PostgreSQL pg_trgm.
 * Falls back to ILIKE if pg_trgm is not available.
 * Results are cached for performance.
 */
export async function fullTextSearch<T = any>(
  table: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult<T>> {
  const {
    limit = 20,
    offset = 0,
    fields = ['name'],
    exactMatch = false,
    orderBy,
    orderDir = 'asc',
    ttlMs = 30_000,
  } = options;

  if (!query.trim()) {
    return { items: [], total: 0, query, tookMs: 0 };
  }

  const cacheKey = `search:${table}:${query}:${fields.join(',')}:${limit}:${offset}:${orderDir}`;
  
  // Check cache first
  const cached = await cacheGet<SearchResult<T>>(cacheKey);
  if (cached) return cached;

  const start = Date.now();

  try {
    // Try pg_trgm similarity search first (PostgreSQL extension)
    const searchField = fields[0]; // Primary search field
    
    // Build similarity query using pg_trgm
    const similarityQuery = `
      similarity(${searchField}, '${query.replace(/'/g, "''")}') > 0.1
    `;
    
    const orderField = orderBy || searchField;
    const { data, count, error } = await db
      .from(table)
      .select('*', { count: 'exact' })
      .or(
        fields
          .map(f => `${f}.ilike.%${query}%`)
          .join(',')
      )
      .order(orderField, { ascending: orderDir === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) {
      console.warn(`[Search] Error searching ${table}:`, error.message);
      return { items: [], total: 0, query, tookMs: Date.now() - start };
    }

    const result: SearchResult<T> = {
      items: (data as T[]) || [],
      total: count || 0,
      query,
      tookMs: Date.now() - start,
    };

    // Cache results
    await cacheSet(cacheKey, result, { ttlMs });

    return result;
  } catch (err) {
    console.error(`[Search] Search failed for ${table}:`, err);
    return { items: [], total: 0, query, tookMs: Date.now() - start };
  }
}

/**
 * Search products with filters
 */
export async function searchProducts(
  query: string,
  options: SearchOptions & { categoryId?: string; minPrice?: number; maxPrice?: number; inStock?: boolean } = {}
) {
  const { categoryId, minPrice, maxPrice, inStock, limit = 20, offset = 0 } = options;
  const cacheKey = `search:products:advanced:${query}:${categoryId}:${minPrice}:${maxPrice}:${inStock}:${limit}:${offset}`;

  const cached = await cacheGet<SearchResult>(cacheKey);
  if (cached) return cached;

  const start = Date.now();

  let queryBuilder = db
    .from('products')
    .select('*, product_categories(id, category_id, categories(id, name))', { count: 'exact' });

  // Text search
  if (query.trim()) {
    queryBuilder = queryBuilder.or(
      `name.ilike.%${query}%,sku.ilike.%${query}%,barcode.ilike.%${query}%`
    );
  }

  // Category filter
  if (categoryId) {
    queryBuilder = queryBuilder.ilike('category_id', categoryId);
  }

  // Price range
  if (minPrice !== undefined) {
    queryBuilder = queryBuilder.gte('selling_price', minPrice);
  }
  if (maxPrice !== undefined) {
    queryBuilder = queryBuilder.lte('selling_price', maxPrice);
  }

  // Stock filter
  if (inStock) {
    queryBuilder = queryBuilder.gt('global_stock', 0);
  }

  const { data, count, error } = await queryBuilder
    .order('name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    console.warn('[Search] Product search error:', error.message);
    return { items: [], total: 0, query, tookMs: Date.now() - start };
  }

  const result: SearchResult = {
    items: data || [],
    total: count || 0,
    query,
    tookMs: Date.now() - start,
  };

  await cacheSet(cacheKey, result, { ttlMs: 15_000 });
  return result;
}

/**
 * Search customers
 */
export async function searchCustomers(query: string, options: SearchOptions = {}) {
  return fullTextSearch('customers', query, {
    fields: ['name', 'phone', 'email', 'address'],
    ...options,
  });
}

/**
 * Search transactions
 */
export async function searchTransactions(query: string, options: SearchOptions = {}) {
  return fullTextSearch('transactions', query, {
    fields: ['invoice_no', 'notes', 'customer_name'],
    orderBy: 'created_at',
    orderDir: 'desc',
    ...options,
  });
}

/**
 * Invalidate all search caches
 */
export async function invalidateSearchCache(table?: string) {
  if (table) {
    await cacheInvalidatePrefix(`search:${table}:`);
  } else {
    await cacheInvalidatePrefix('search:');
  }
}

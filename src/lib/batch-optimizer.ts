// =====================================================================
// BATCH OPTIMIZER — Optimasi query batch untuk menghilangkan N+1 queries
//
// Sistem ini menyediakan:
//   1. MultiGet pattern — ambil banyak entitas sekaligus (produk, pelanggan, user)
//   2. Deduplikasi request in-flight — jika produk sama di-query berkali-kali
//      dalam satu request, hanya fetch sekali
//   3. Chunked batch insert — memecah insert besar menjadi potongan aman
//   4. Statement caching — cache hasil untuk pola query yang berulang
//   5. Batch stock operations — operasi stok multi-produk dalam satu panggilan
//
// ZERO external dependencies — pure TypeScript + Supabase REST API.
// =====================================================================

// =====================================================================
// TIPE DASAR
// =====================================================================

/**
 * Opsi konfigurasi untuk BatchOptimizer.
 */
export interface BatchOptimizerConfig {
  /** J maksimum baris per chunk saat insert batch (Supabase limit: ~500) */
  chunkSize: number;
  /** Waktu hidup cache (ms) untuk statement cache */
  cacheTtlMs: number;
  /** Jumlah maksimum entri di statement cache */
  maxCacheSize: number;
  /** Aktifkan log verbose */
  verbose: boolean;
}

/** Konfigurasi default */
const DEFAULT_CONFIG: Required<BatchOptimizerConfig> = {
  chunkSize: 450,
  cacheTtlMs: 30_000,
  maxCacheSize: 500,
  verbose: false,
};

/**
 * Representasi entitas produk yang sudah dinormalisasi.
 */
export interface BatchProduct {
  id: string;
  name: string;
  sku?: string;
  price: number;
  avgHpp: number;
  stock: number;
  unit?: string;
  category?: string;
  trackStock: boolean;
  [key: string]: unknown;
}

/**
 * Representasi entitas pelanggan yang sudah dinormalisasi.
 */
export interface BatchCustomer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  unitId?: string;
  unitName?: string;
  [key: string]: unknown;
}

/**
 * Representasi entitas user (karyawan) yang sudah dinormalisasi.
 */
export interface BatchUser {
  id: string;
  name: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

/**
 * Hasil dari operasi batch.
 */
export interface BatchResult<T> {
  /** Map dari ID ke entitas yang berhasil diambil */
  data: Map<string, T>;
  /** ID yang diminta tapi tidak ditemukan */
  missingIds: string[];
  /** Jumlah entitas yang diambil dari cache */
  cacheHits: number;
  /** Jumlah entitas yang diambil dari database */
  dbFetches: number;
  /** Waktu total operasi (ms) */
  durationMs: number;
}

/**
 * Entri cache dengan metadata TTL.
 */
interface CacheEntry<T> {
  value: Map<string, T>;
  createdAt: number;
  accessCount: number;
}

// =====================================================================
// BATCH OPTIMIZER — Kelas utama
// =====================================================================

/**
 * Optimizer untuk query batch yang menghilangkan N+1 problem.
 * Menggunakan deduplikasi in-flight dan statement caching.
 *
 * Contoh penggunaan:
 * ```ts
 * import { batchOptimizer } from '@/lib/batch-optimizer';
 *
 * // Ambil banyak produk sekaligus — deduplikasi otomatis
 * const { data: products } = await batchOptimizer.batchGetProducts([
 *   'prod-1', 'prod-2', 'prod-3'
 * ]);
 *
 * // Ambil produk dengan deduplikasi in-flight
 * // Jika 5 komponen meminta produk yang sama secara bersamaan,
 * // hanya 1 query yang dikirim ke database
 * const product = await batchOptimizer.deduplicatedFetch(
 *   'product:prod-1',
 *   () => db.from('products').select('*').eq('id', 'prod-1').single()
 * );
 *
 * // Insert batch dengan chunking otomatis
 * const results = await batchOptimizer.chunkedInsert('transaction_items', items);
 * ```
 */
export class BatchOptimizer {
  private readonly config: Required<BatchOptimizerConfig>;

  /**
   * Peta deduplikasi in-flight.
   * Key: identifier unik (misal "product:abc123")
   * Value: Promise yang sedang berjalan
   * Jika request yang sama datang saat Promise masih aktif, kembalikan Promise yang sama.
   */
  private readonly inflightRequests = new Map<string, Promise<unknown>>();

  /**
   * Statement cache.
   * Key: identifier (misal "products:prod-1,prod-2,prod-3")
   * Value: Map dari ID ke entitas + metadata TTL
   */
  private readonly statementCache = new Map<string, CacheEntry<unknown>>();

  /** Counter untuk statistik */
  private stats = {
    deduplicationHits: 0,
    cacheHits: 0,
    dbFetches: 0,
    chunkedInserts: 0,
  };

  constructor(config?: Partial<BatchOptimizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // =================================================================
  // MULTI-GET: Produk
  // =================================================================

  /**
   * Ambil banyak produk sekaligus.
   * Menggabungkan cache + deduplikasi in-flight + fetch database.
   *
   * @param ids - Array ID produk yang akan diambil
   * @returns BatchResult dengan Map<id, BatchProduct>
   *
   * Contoh:
   * ```ts
   * const { data, missingIds } = await batchOptimizer.batchGetProducts(['id1', 'id2']);
   * for (const [id, product] of data) {
   *   console.log(product.name, product.price);
   * }
   * ```
   */
  async batchGetProducts(
    ids: string[]
  ): Promise<BatchResult<BatchProduct>> {
    return this.batchFetch<BatchProduct>(
      'products',
      ids,
      (uniqueIds) => this.fetchFromDb<BatchProduct>('products', uniqueIds)
    );
  }

  // =================================================================
  // MULTI-GET: Pelanggan
  // =================================================================

  /**
   * Ambil banyak pelanggan sekaligus.
   *
   * @param ids - Array ID pelanggan yang akan diambil
   * @returns BatchResult dengan Map<id, BatchCustomer>
   */
  async batchGetCustomers(
    ids: string[]
  ): Promise<BatchResult<BatchCustomer>> {
    return this.batchFetch<BatchCustomer>(
      'customers',
      ids,
      (uniqueIds) => this.fetchFromDb<BatchCustomer>('customers', uniqueIds)
    );
  }

  // =================================================================
  // MULTI-GET: User (Karyawan)
  // =================================================================

  /**
   * Ambil banyak user/karyawan sekaligus.
   *
   * @param ids - Array ID user yang akan diambil
   * @returns BatchResult dengan Map<id, BatchUser>
   */
  async batchGetUsers(ids: string[]): Promise<BatchResult<BatchUser>> {
    return this.batchFetch<BatchUser>(
      'users',
      ids,
      (uniqueIds) => this.fetchFromDb<BatchUser>('users', uniqueIds)
    );
  }

  // =================================================================
  // DEDUPLICATED FETCH — Deduplikasi in-flight
  // =================================================================

  /**
   * Fetch dengan deduplikasi in-flight.
   * Jika fetcher yang sama (berdasarkan key) sedang berjalan,
   * kembalikan Promise yang sama alih-alih membuat request baru.
   *
   * Berguna ketika beberapa komponen/request membutuhkan data yang sama
   * secara bersamaan — hanya 1 query yang dikirim ke database.
   *
   * @param key - Kunci unik untuk deduplikasi (misal "product:abc123")
   * @param fetcher - Fungsi async untuk mengambil data
   * @returns Hasil dari fetcher
   *
   * Contoh:
   * ```ts
   * // 3 komponen memanggil ini bersamaan → hanya 1 DB query
   * const product = await batchOptimizer.deduplicatedFetch(
   *   'product:abc123',
   *   () => db.from('products').select('*').eq('id', 'abc123').single()
   * );
   * ```
   */
  async deduplicatedFetch<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    // Cek apakah request yang sama sedang berjalan
    const inflight = this.inflightRequests.get(key);
    if (inflight) {
      this.stats.deduplicationHits++;
      this.log(`[BatchOptimizer] Dedup hit: "${key}"`);
      return inflight as Promise<T>;
    }

    // Mulai request baru
    const promise = fetcher()
      .then((result) => {
        // Bersihkan setelah selesai (sukses)
        this.inflightRequests.delete(key);
        return result;
      })
      .catch((error) => {
        // Bersihkan setelah selesai (gagal) — biarkan request baru mencoba
        this.inflightRequests.delete(key);
        throw error;
      });

    this.inflightRequests.set(key, promise);
    this.stats.dbFetches++;

    return promise;
  }

  /**
   * Fetch banyak entitas dengan deduplikasi in-flight per item.
   * Setiap ID di-fetch secara individual, tapi jika ID sama diminta
   * secara bersamaan, hanya 1 query yang dikirim.
   *
   * Berguna ketika daftar ID berasal dari sumber yang berbeda dalam
   * satu request lifecycle.
   *
   * @param table - Nama tabel (untuk cache key prefix)
   * @param ids - Array ID yang akan diambil
   * @param singleFetcher - Fungsi untuk mengambil satu entitas
   * @returns Map dari ID ke entitas
   */
  async deduplicatedMultiFetch<T>(
    table: string,
    ids: string[],
    singleFetcher: (id: string) => Promise<T>
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const uniqueIds = [...new Set(ids)];

    const promises = uniqueIds.map(async (id) => {
      const key = `${table}:${id}`;
      try {
        const value = await this.deduplicatedFetch(key, () =>
          singleFetcher(id)
        );
        result.set(id, value);
      } catch (error) {
        this.log(
          `[BatchOptimizer] Gagal mengambil ${table}:${id}: ${error instanceof Error ? error.message : error}`
        );
      }
    });

    await Promise.all(promises);
    return result;
  }

  // =================================================================
  // CHUNKED INSERT — Insert batch dengan potongan
  // =================================================================

  /**
   * Insert batch dengan chunking otomatis.
   * Memecah array besar menjadi potongan-potongan kecil yang aman
   * untuk Supabase REST API (batas ~500 baris per insert).
   *
   * @param table - Nama tabel target
   * @param rows - Array data yang akan diinsert
   * @param chunkSize - Ukuran potongan (default dari config)
   * @returns Array hasil dari setiap insert (dikumpulkan)
   *
   * Contoh:
   * ```ts
   * const items = saleItems.map(item => ({
   *   transaction_id: txId,
   *   product_id: item.productId,
   *   qty: item.qty,
   *   price: item.price,
   * }));
   * await batchOptimizer.chunkedInsert('transaction_items', items);
   * ```
   */
  async chunkedInsert<T = unknown>(
    table: string,
    rows: Record<string, unknown>[],
    chunkSize?: number
  ): Promise<T[]> {
    if (rows.length === 0) return [];

    const size = chunkSize ?? this.config.chunkSize;
    const chunks = this.chunkArray(rows, size);
    const allResults: T[] = [];

    this.log(
      `[BatchOptimizer] Insert batch ke "${table}": ${rows.length} baris dalam ${chunks.length} chunk(s)`
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        // Dynamic import untuk menghindari circular dependency
        const { db } = await import('@/lib/supabase');
        const { data, error } = await db
          .from(table)
          .insert(chunk)
          .select();

        if (error) {
          throw new Error(
            `Gagal insert chunk ${i + 1}/${chunks.length} ke "${table}": ${error.message}`
          );
        }

        if (data && data.length > 0) {
          allResults.push(...(data as T[]));
        }

        this.stats.chunkedInserts++;
      } catch (error) {
        console.error(
          `[BatchOptimizer] Error insert chunk ${i + 1}/${chunks.length}:`,
          error
        );
        throw error;
      }
    }

    return allResults;
  }

  // =================================================================
  // CHUNKED UPDATE — Update batch dengan potongan
  // =================================================================

  /**
   * Update batch dengan chunking otomatis.
   * Setiap baris harus memiliki kolom 'id' sebagai kunci utama.
   *
   * @param table - Nama tabel target
   * @param rows - Array data yang akan diupdate (harus punya field 'id')
   * @param chunkSize - Ukuran potongan (default dari config)
   *
   * Contoh:
   * ```ts
   * const updates = products.map(p => ({
   *   id: p.id,
   *   stock: p.newStock,
   * }));
   * await batchOptimizer.chunkedUpdate('products', updates);
   * ```
   */
  async chunkedUpdate(
    table: string,
    rows: Array<Record<string, unknown> & { id: string }>,
    chunkSize?: number
  ): Promise<void> {
    if (rows.length === 0) return;

    const size = chunkSize ?? this.config.chunkSize;
    const chunks = this.chunkArray(rows, size);

    this.log(
      `[BatchOptimizer] Update batch di "${table}": ${rows.length} baris dalam ${chunks.length} chunk(s)`
    );

    const { db } = await import('@/lib/supabase');

    for (const chunk of chunks) {
      // Supabase tidak mendukung bulk update — lakukan per baris tapi secara paralel
      await Promise.all(
        chunk.map(async (row) => {
          const { id, ...updateData } = row;
          const { error } = await db
            .from(table)
            .update(updateData)
            .eq('id', id);

          if (error) {
            throw new Error(
              `Gagal update ${table}:${id}: ${error.message}`
            );
          }
        })
      );
    }

    this.stats.chunkedInserts++;
  }

  // =================================================================
  // STATEMENT CACHE
  // =================================================================

  /**
   * Ambil data dari statement cache jika tersedia.
   *
   * @param key - Kunci cache
   * @returns Data dari cache atau undefined jika tidak ada/expired
   */
  getFromCache<T>(key: string): Map<string, T> | undefined {
    const entry = this.statementCache.get(key);
    if (!entry) return undefined;

    // Cek TTL
    const age = Date.now() - entry.createdAt;
    if (age > this.config.cacheTtlMs) {
      this.statementCache.delete(key);
      return undefined;
    }

    entry.accessCount++;
    this.stats.cacheHits++;

    return entry.value as Map<string, T>;
  }

  /**
   * Simpan data ke statement cache.
   *
   * @param key - Kunci cache
   * @param data - Data yang akan disimpan
   */
  setCache<T>(key: string, data: Map<string, T>): void {
    // Evict cache jika penuh
    if (this.statementCache.size >= this.config.maxCacheSize) {
      this.evictCache();
    }

    this.statementCache.set(key, {
      value: data as Map<string, unknown>,
      createdAt: Date.now(),
      accessCount: 0,
    });
  }

  /**
   * Invalidate cache berdasarkan prefix kunci.
   * Berguna setelah operasi write (insert/update/delete).
   *
   * @param prefix - Prefix kunci yang akan diinvalidasi
   * @returns Jumlah entri cache yang diinvalidasi
   *
   * Contoh:
   * ```ts
   * // Setelah update produk, invalidate semua cache produk
   * batchOptimizer.invalidateCache('products');
   * ```
   */
  invalidateCache(prefix: string): number {
    let count = 0;

    for (const key of this.statementCache.keys()) {
      if (key.startsWith(prefix)) {
        this.statementCache.delete(key);
        count++;
      }
    }

    this.log(
      `[BatchOptimizer] Cache invalidated: ${count} entri dengan prefix "${prefix}"`
    );

    return count;
  }

  /**
   * Bersihkan seluruh cache.
   */
  clearCache(): void {
    const size = this.statementCache.size;
    this.statementCache.clear();
    this.log(`[BatchOptimizer] Cache dibersihkan: ${size} entri dihapus`);
  }

  // =================================================================
  // BATCH STOCK OPERATIONS
  // =================================================================

  /**
   * Ambil stok banyak produk sekaligus.
   * Mengembalikan Map dari productId ke stok saat ini.
   *
   * @param productIds - Array ID produk
   * @returns Map<productId, stock>
   */
  async batchGetStock(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();

    const cacheKey = `stock:${[...new Set(productIds)].sort().join(',')}`;
    const cached = this.getFromCache<number>(cacheKey);
    if (cached) return cached;

    const { db } = await import('@/lib/supabase');
    const uniqueIds = [...new Set(productIds)];

    const { data, error } = await db
      .from('products')
      .select('id, stock')
      .in('id', uniqueIds);

    if (error) {
      throw new Error(`Gagal mengambil stok batch: ${error.message}`);
    }

    const stockMap = new Map<string, number>();
    if (data) {
      for (const row of data) {
        stockMap.set(row.id, row.stock ?? 0);
      }
    }

    // Set cache untuk request berikutnya
    this.setCache(cacheKey, stockMap);

    return stockMap;
  }

  // =================================================================
  // STATISTIK
  // =================================================================

  /**
   * Dapatkan statistik optimizer.
   */
  getStats(): {
    deduplicationHits: number;
    cacheHits: number;
    dbFetches: number;
    chunkedInserts: number;
    inflightCount: number;
    cacheSize: number;
    cacheHitRate: number;
  } {
    const totalFetches =
      this.stats.deduplicationHits + this.stats.dbFetches;
    const cacheHitRate =
      totalFetches > 0
        ? (this.stats.deduplicationHits + this.stats.cacheHits) / totalFetches
        : 0;

    return {
      deduplicationHits: this.stats.deduplicationHits,
      cacheHits: this.stats.cacheHits,
      dbFetches: this.stats.dbFetches,
      chunkedInserts: this.stats.chunkedInserts,
      inflightCount: this.inflightRequests.size,
      cacheSize: this.statementCache.size,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
    };
  }

  /**
   * Reset semua statistik ke nol.
   */
  resetStats(): void {
    this.stats = {
      deduplicationHits: 0,
      cacheHits: 0,
      dbFetches: 0,
      chunkedInserts: 0,
    };
  }

  // =================================================================
  // INTERNAL
  // =================================================================

  /**
   * Core batch fetch dengan cache + deduplikasi.
   */
  private async batchFetch<T>(
    table: string,
    ids: string[],
    dbFetcher: (uniqueIds: string[]) => Promise<Map<string, T>>
  ): Promise<BatchResult<T>> {
    const startTime = Date.now();

    if (ids.length === 0) {
      return {
        data: new Map(),
        missingIds: [],
        cacheHits: 0,
        dbFetches: 0,
        durationMs: 0,
      };
    }

    // Deduplikasi input IDs
    const requestedIds = [...new Set(ids)];
    const cacheKey = `${table}:${requestedIds.sort().join(',')}`;

    let cacheHits = 0;
    let dbFetches = 0;

    // 1. Cek cache statement
    const cached = this.getFromCache<T>(cacheKey);
    if (cached) {
      cacheHits = requestedIds.length;

      // Hitung missing IDs
      const missingIds = requestedIds.filter((id) => !cached.has(id));

      return {
        data: new Map(cached),
        missingIds,
        cacheHits,
        dbFetches: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Fetch dari database dengan deduplikasi in-flight
    let dataMap: Map<string, T>;

    const inflightKey = `batch:${cacheKey}`;
    const inflight = this.inflightRequests.get(inflightKey);

    if (inflight) {
      this.stats.deduplicationHits++;
      dataMap = (await inflight) as Map<string, T>;
    } else {
      const fetchPromise = dbFetcher(requestedIds);
      this.inflightRequests.set(inflightKey, fetchPromise);

      try {
        dataMap = await fetchPromise;
      } finally {
        this.inflightRequests.delete(inflightKey);
      }

      dbFetches = 1;
      this.stats.dbFetches++;

      // 3. Simpan ke cache
      this.setCache(cacheKey, dataMap);
    }

    // 4. Hitung missing IDs
    const missingIds = requestedIds.filter((id) => !dataMap.has(id));

    return {
      data: dataMap,
      missingIds,
      cacheHits,
      dbFetches,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Fetch entitas dari database Supabase.
   */
  private async fetchFromDb<T>(
    table: string,
    ids: string[]
  ): Promise<Map<string, T>> {
    if (ids.length === 0) return new Map();

    const { db } = await import('@/lib/supabase');

    // Supabase mendukung maks ~500 filter .in() — chunk jika perlu
    const chunks = this.chunkArray(ids, 400);
    const result = new Map<string, T>();

    for (const chunk of chunks) {
      const { data, error } = await db
        .from(table)
        .select('*')
        .in('id', chunk);

      if (error) {
        throw new Error(
          `Gagal fetch batch dari "${table}": ${error.message}`
        );
      }

      if (data) {
        for (const row of data) {
          result.set(row.id, row as unknown as T);
        }
      }
    }

    return result;
  }

  /**
   * Pecah array menjadi potongan-potongan kecil.
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Evict cache entries menggunakan strategi LRU (Least Recently Used).
   * Menghapus 25% entri yang paling jarang diakses.
   */
  private evictCache(): void {
    if (this.statementCache.size === 0) return;

    // Hitung jumlah yang akan dihapus (25% dari max)
    const evictCount = Math.ceil(this.config.maxCacheSize * 0.25);

    // Sort berdasarkan accessCount (ascending) dan hapus yang paling sedikit diakses
    const entries = Array.from(this.statementCache.entries())
      .sort((a, b) => a[1].accessCount - b[1].accessCount);

    for (let i = 0; i < evictCount && i < entries.length; i++) {
      this.statementCache.delete(entries[i][0]);
    }

    this.log(
      `[BatchOptimizer] Cache evicted: ${evictCount} entri (LRU strategy)`
    );
  }

  /**
   * Log kondisional.
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}

// =====================================================================
// SINGLETON EXPORT
// =====================================================================

/**
 * Instance singleton BatchOptimizer.
 * Gunakan ini di semua API route untuk optimasi query batch.
 *
 * Contoh:
 * ```ts
 * import { batchOptimizer } from '@/lib/batch-optimizer';
 *
 * // Dalam API route handler
 * const productIds = transactionItems.map(i => i.productId);
 * const { data: products } = await batchOptimizer.batchGetProducts(productIds);
 *
 * // Setelah write, invalidate cache
 * await batchOptimizer.invalidateCache('products');
 * ```
 */
export const batchOptimizer = new BatchOptimizer();

// =====================================================================
// CONVENIENCE: BatchRequestScope
// =====================================================================

/**
 * Scope untuk satu request HTTP.
 * Mengumpulkan semua batch request dalam satu scope,
 * sehingga deduplikasi bekerja lintas fungsi dalam request yang sama.
 *
 * Contoh:
 * ```ts
 * export async function GET(request: Request) {
 *   const scope = new BatchRequestScope();
 *
 *   // Di beberapa tempat dalam handler ini,
 *   // product yang sama hanya di-fetch sekali
 *   const p1 = await scope.getProducts(['id-1', 'id-2']);
 *   const p2 = await scope.getProducts(['id-2', 'id-3']); // id-2 dari cache
 *
 *   // Bersihkan setelah request selesai
 *   scope.dispose();
 * }
 * ```
 */
export class BatchRequestScope {
  private readonly optimizer: BatchOptimizer;
  private readonly productIdCache = new Map<string, BatchProduct>();
  private readonly customerIdCache = new Map<string, BatchCustomer>();
  private readonly userIdCache = new Map<string, BatchUser>();
  private disposed = false;

  constructor(optimizer?: BatchOptimizer) {
    this.optimizer = optimizer ?? batchOptimizer;
  }

  /**
   * Ambil produk — dari cache scope jika ada, atau batch fetch dari DB.
   */
  async getProducts(ids: string[]): Promise<Map<string, BatchProduct>> {
    this.assertNotDisposed();

    const result = new Map<string, BatchProduct>();
    const missingIds: string[] = [];

    for (const id of ids) {
      const cached = this.productIdCache.get(id);
      if (cached) {
        result.set(id, cached);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const { data } = await this.optimizer.batchGetProducts(missingIds);

      for (const [id, product] of data) {
        this.productIdCache.set(id, product);
        result.set(id, product);
      }
    }

    return result;
  }

  /**
   * Ambil satu produk — dari cache scope jika ada.
   */
  async getProduct(id: string): Promise<BatchProduct | undefined> {
    const map = await this.getProducts([id]);
    return map.get(id);
  }

  /**
   * Ambil pelanggan — dari cache scope jika ada, atau batch fetch dari DB.
   */
  async getCustomers(ids: string[]): Promise<Map<string, BatchCustomer>> {
    this.assertNotDisposed();

    const result = new Map<string, BatchCustomer>();
    const missingIds: string[] = [];

    for (const id of ids) {
      const cached = this.customerIdCache.get(id);
      if (cached) {
        result.set(id, cached);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const { data } = await this.optimizer.batchGetCustomers(missingIds);

      for (const [id, customer] of data) {
        this.customerIdCache.set(id, customer);
        result.set(id, customer);
      }
    }

    return result;
  }

  /**
   * Ambil satu pelanggan — dari cache scope jika ada.
   */
  async getCustomer(id: string): Promise<BatchCustomer | undefined> {
    const map = await this.getCustomers([id]);
    return map.get(id);
  }

  /**
   * Ambil user/karyawan — dari cache scope jika ada, atau batch fetch dari DB.
   */
  async getUsers(ids: string[]): Promise<Map<string, BatchUser>> {
    this.assertNotDisposed();

    const result = new Map<string, BatchUser>();
    const missingIds: string[] = [];

    for (const id of ids) {
      const cached = this.userIdCache.get(id);
      if (cached) {
        result.set(id, cached);
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const { data } = await this.optimizer.batchGetUsers(missingIds);

      for (const [id, user] of data) {
        this.userIdCache.set(id, user);
        result.set(id, user);
      }
    }

    return result;
  }

  /**
   * Ambil satu user — dari cache scope jika ada.
   */
  async getUser(id: string): Promise<BatchUser | undefined> {
    const map = await this.getUsers([id]);
    return map.get(id);
  }

  /**
   * Invalidate cache produk tertentu dalam scope ini.
   */
  invalidateProduct(id: string): void {
    this.productIdCache.delete(id);
  }

  /**
   * Invalidate cache pelanggan tertentu dalam scope ini.
   */
  invalidateCustomer(id: string): void {
    this.customerIdCache.delete(id);
  }

  /**
   * Bersihkan semua cache dalam scope.
   */
  dispose(): void {
    this.disposed = true;
    this.productIdCache.clear();
    this.customerIdCache.clear();
    this.userIdCache.clear();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('BatchRequestScope sudah di-dispose');
    }
  }
}

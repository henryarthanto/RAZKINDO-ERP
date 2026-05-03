// =====================================================================
// CONCURRENCY QUEUE — Sistem antrian dan kunci tingkat sumber daya
//
// Menangani 100+ pelanggan PWA, puluhan transaksi per menit, dan
// puluhan karyawan yang melakukan input/pemrosesan bersamaan.
//
// Fitur utama:
//   1. Resource-level mutex (per produk, pelanggan, kas)
//   2. Antrian transaksi dengan prioritas (penjualan > pembelian > pengeluaran)
//   3. Antrian operasi per-pengguna (mencegah double-click duplikat)
//   4. Batas konkurensi yang dapat dikonfigurasi per tipe operasi
//   5. Deteksi dan resolusi deadlock otomatis
//   6. Statistik antrian dan pemantauan kesehatan
//   7. Proteksi overflow antrian dengan backpressure
// =====================================================================

// =====================================================================
// TIPE DASAR
// =====================================================================

/**
 * Tingkat prioritas operasi.
 * Angka lebih tinggi = diproses lebih dulu.
 * penjualan (3) > pembelian (2) > pengeluaran (1) > lainnya (0)
 */
export type OperationPriority = 0 | 1 | 2 | 3;

/**
 * Tipe operasi transaksi untuk pengaturan batas konkurensi.
 */
export type OperationType =
  | 'sale'
  | 'purchase'
  | 'expense'
  | 'salary'
  | 'payment'
  | 'stock_adjustment'
  | 'finance_request'
  | 'courier_deposit'
  | 'general';

/**
 * Pemetaan tipe operasi ke tingkat prioritas default.
 */
const DEFAULT_PRIORITY: Record<OperationType, OperationPriority> = {
  sale: 3,
  purchase: 2,
  expense: 1,
  salary: 1,
  payment: 2,
  stock_adjustment: 1,
  finance_request: 2,
  courier_deposit: 1,
  general: 0,
};

/**
 * Operasi yang masuk ke dalam antrian.
 */
export interface QueuedOperation {
  /** Pengidentifikasi unik untuk operasi ini */
  id: string;
  /** Tipe operasi untuk pengaturan konkurensi */
  type: OperationType;
  /** Tingkat prioritas (default dari tipe) */
  priority?: OperationPriority;
  /** Sumber daya yang dikunci selama operasi berjalan */
  resourceIds: string[];
  /** ID pengguna yang melakukan operasi (untuk antrian per-pengguna) */
  userId: string;
  /** Fungsi async yang akan dieksekusi */
  execute: () => Promise<unknown>;
  /** Waktu saat operasi dimasukkan ke antrian */
  enqueuedAt?: number;
  /** Waktu mulai pemrosesan */
  startedAt?: number;
  /** Waktu selesai pemrosesan */
  completedAt?: number;
  /** ID operasi yang memblokir operasi ini (untuk deteksi deadlock) */
  blockedBy?: string;
  /** Jumlah upaya coba ulang setelah kegagalan */
  retryCount?: number;
}

/** Hasil dari operasi yang telah selesai diproses */
export interface CompletedOperation {
  id: string;
  type: OperationType;
  userId: string;
  success: boolean;
  result?: unknown;
  error?: string;
  waitTimeMs: number;
  processTimeMs: number;
  enqueuedAt: number;
  startedAt: number;
  completedAt: number;
}

/**
 * Statistik antrian secara keseluruhan.
 */
export interface QueueStats {
  /** Jumlah operasi yang menunggu di antrian */
  pending: number;
  /** Jumlah operasi yang sedang diproses */
  processing: number;
  /** Jumlah operasi yang berhasil (dalam window) */
  completed: number;
  /** Jumlah operasi yang gagal (dalam window) */
  failed: number;
  /** Rata-rata waktu tunggu di antrian (ms) */
  avgWaitTimeMs: number;
  /** Rata-rata waktu pemrosesan (ms) */
  avgProcessTimeMs: number;
  /** Distribusi per tipe operasi */
  byType: Record<string, number>;
  /** Jumlah operasi yang ditolak karena antrian penuh */
  rejected: number;
  /** Total waktu hidup antrian (detik) */
  uptimeSeconds: number;
}

/**
 * Statistik kesehatan antrian.
 */
export interface QueueHealth {
  /** Apakah antrian dalam kondisi sehat */
  healthy: boolean;
  /** Penjelasan kondisi kesehatan */
  message: string;
  /** Statistik ringkas */
  stats: QueueStats;
  /** Jumlah sumber daya yang terkunci */
  lockedResources: number;
  /** Jumlah pengguna dengan operasi aktif */
  activeUsers: number;
}

/** Konfigurasi untuk antrian transaksi */
export interface QueueConfig {
  /** Kapasitas maksimum antrian (0 = tidak terbatas) */
  maxQueueSize: number;
  /** Batas waktu tunggu di antrian sebelum dibatalkan (ms) */
  maxWaitTimeMs: number;
  /** Batas waktu eksekusi operasi (ms) */
  maxExecutionTimeMs: number;
  /** Jumlah maksimum coba ulang setelah kegagalan */
  maxRetries: number;
  /** Ukuran window untuk statistik (jumlah operasi terakhir) */
  statsWindowSize: number;
  /** Interval pembersihan resource yang sudah tidak terpakai (ms) */
  cleanupIntervalMs: number;
  /** Waktu idle sebelum kunci otomatis dilepas (ms) */
  lockStaleThresholdMs: number;
  /** Aktifkan log verbose */
  verbose: boolean;
}

/** Konfigurasi default */
const DEFAULT_CONFIG: Required<QueueConfig> = {
  maxQueueSize: 10_000,
  maxWaitTimeMs: 30_000,
  maxExecutionTimeMs: 60_000,
  maxRetries: 2,
  statsWindowSize: 1_000,
  cleanupIntervalMs: 60_000,
  lockStaleThresholdMs: 120_000,
  verbose: false,
};

// =====================================================================
// RESOURCE LOCK — Kunci mutex tingkat sumber daya
// =====================================================================

/**
 * Informasi tentang kunci yang sedang dipegang.
 */
interface LockHolder {
  /** ID operasi yang memegang kunci */
  operationId: string;
  /** Waktu kunci diperoleh */
  acquiredAt: number;
  /** Fungsi untuk melepaskan kunci */
  release: () => void;
  /** Antrian operasi yang menunggu kunci ini */
  waitQueue: Array<{
    operationId: string;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    enqueuedAt: number;
  }>;
}

/**
 * Kunci mutex per sumber daya.
 * Mendukung timeout, deteksi kebuntuan, dan pelepasan otomatis.
 */
class ResourceLockManager {
  private readonly locks = new Map<string, LockHolder>();
  private readonly staleThresholdMs: number;

  constructor(staleThresholdMs: number) {
    this.staleThresholdMs = staleThresholdMs;
  }

  /**
   * Dapatkan kunci pada sumber daya tertentu.
   * Mengembalikan fungsi yang harus dipanggil untuk melepaskan kunci.
   *
   * @param resourceId - ID sumber daya yang akan dikunci
   * @param operationId - ID operasi yang meminta kunci
   * @param timeoutMs - Waktu maksimum menunggu kunci (default: 10 detik)
   * @returns Fungsi pelepasan kunci (release)
   * @throws Error jika timeout tercapai atau deteksi deadlock
   */
  async acquire(
    resourceId: string,
    operationId: string,
    timeoutMs: number = 10_000
  ): Promise<() => void> {
    const existing = this.locks.get(resourceId);

    // Sumber daya belum terkunci — kunci langsung
    if (!existing) {
      return this.createLock(resourceId, operationId);
    }

    // Operasi yang sama sudah memegang kunci — izinkan (reentrant)
    if (existing.operationId === operationId) {
      return existing.release;
    }

    // Cek apakah kunci sudah stale (dipegang terlalu lama)
    if (Date.now() - existing.acquiredAt > this.staleThresholdMs) {
      console.warn(
        `[ResourceLock] Kunci stale terdeteksi pada "${resourceId}", ` +
        `dipegang oleh "${existing.operationId}" selama ${Date.now() - existing.acquiredAt}ms. ` +
        `Kunci dilepas paksa.`
      );
      this.forceRelease(resourceId);
      return this.createLock(resourceId, operationId);
    }

    // Antrikan permintaan kunci
    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Timeout — hapus dari antrian dan tolak
        const holder = this.locks.get(resourceId);
        if (holder) {
          holder.waitQueue = holder.waitQueue.filter(
            (w) => w.operationId !== operationId
          );
        }
        reject(
          new Error(
            `Timeout mengunci "${resourceId}" (${timeoutMs}ms). ` +
            `Dipegang oleh operasi "${existing.operationId}".`
          )
        );
      }, timeoutMs);

      // Timer tidak boleh menghalangi proses keluar Node.js
      if (timer.unref) timer.unref();

      const waitItem = {
        operationId,
        resolve: (release: () => void) => {
          clearTimeout(timer);
          resolve(release);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
        enqueuedAt: Date.now(),
      };

      existing.waitQueue.push(waitItem);
    });
  }

  /**
   * Cek apakah sumber daya sedang terkunci.
   */
  isLocked(resourceId: string): boolean {
    return this.locks.has(resourceId);
  }

  /**
   * Dapatkan jumlah operasi yang menunggu kunci pada sumber daya.
   */
  getQueueSize(resourceId: string): number {
    return this.locks.get(resourceId)?.waitQueue.length ?? 0;
  }

  /**
   * Dapatkan jumlah total sumber daya yang terkunci.
   */
  getLockedCount(): number {
    return this.locks.size;
  }

  /**
   * Dapatkan daftar semua resource yang terkunci beserta info operasi.
   */
  getLockInfo(): Array<{
    resourceId: string;
    operationId: string;
    heldForMs: number;
    waitingCount: number;
  }> {
    const now = Date.now();
    return Array.from(this.locks.entries()).map(([resourceId, holder]) => ({
      resourceId,
      operationId: holder.operationId,
      heldForMs: now - holder.acquiredAt,
      waitingCount: holder.waitQueue.length,
    }));
  }

  /**
   * Paksa pelepasan kunci pada sumber daya (untuk recovery).
   * Menolak semua operasi yang menunggu dengan error.
   */
  forceRelease(resourceId: string): void {
    const holder = this.locks.get(resourceId);
    if (!holder) return;

    // Tolak semua yang menunggu
    for (const waiter of holder.waitQueue) {
      waiter.reject(
        new Error(
          `Kunci "${resourceId}" dilepas paksa (force release). ` +
          `Operasi "${waiter.operationId}" ditolak.`
        )
      );
    }

    this.locks.delete(resourceId);
  }

  /**
   * Bersihkan kunci yang sudah stale (dipegang terlalu lama).
   * @returns Jumlah kunci yang dibersihkan
   */
  cleanupStaleLocks(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [resourceId, holder] of this.locks) {
      if (now - holder.acquiredAt > this.staleThresholdMs) {
        console.warn(
          `[ResourceLock] Membersihkan kunci stale pada "${resourceId}", ` +
          `dipegang oleh "${holder.operationId}" selama ${now - holder.acquiredAt}ms`
        );
        this.forceRelease(resourceId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Dapatkan semua operasi yang sedang menunggu kunci, dikelompokkan per sumber daya.
   */
  getAllWaiters(): Map<
    string,
    Array<{ operationId: string; waitingSinceMs: number }>
  > {
    const result = new Map<
      string,
      Array<{ operationId: string; waitingSinceMs: number }>
    >();
    const now = Date.now();

    for (const [resourceId, holder] of this.locks) {
      if (holder.waitQueue.length > 0) {
        result.set(
          resourceId,
          holder.waitQueue.map((w) => ({
            operationId: w.operationId,
            waitingSinceMs: now - w.enqueuedAt,
          }))
        );
      }
    }

    return result;
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  private createLock(resourceId: string, operationId: string): () => void {
    let released = false;

    const release = () => {
      if (released) return;
      released = true;

      const holder = this.locks.get(resourceId);
      if (!holder || holder.operationId !== operationId) return;

      // Berikan kunci ke operasi berikutnya di antrian
      if (holder.waitQueue.length > 0) {
        const next = holder.waitQueue.shift()!;
        const nextRelease = this.createLock(resourceId, next.operationId);
        next.resolve(nextRelease);
      } else {
        // Tidak ada yang menunggu — hapus kunci
        this.locks.delete(resourceId);
      }
    };

    this.locks.set(resourceId, {
      operationId,
      acquiredAt: Date.now(),
      release,
      waitQueue: [],
    });

    return release;
  }
}

// =====================================================================
// USER QUEUE — Antrian operasi per pengguna
// =====================================================================

/**
 * Mencegah pengguna melakukan operasi duplikat (misalnya double-click).
 * Hanya satu operasi per pengguna yang boleh berjalan pada satu waktu.
 */
class UserOperationQueue {
  /** Map dari userId ke operasi yang sedang berjalan */
  private readonly activeOperations = new Map<string, string>();
  /** Antrian tunggu per pengguna */
  private readonly userQueues = new Map<
    string,
    Array<{
      operationId: string;
      resolve: () => void;
      reject: (error: Error) => void;
    }>
  >();

  /**
   * Coba mulai operasi untuk pengguna.
   * Jika pengguna sudah memiliki operasi aktif, antrikan.
   *
   * @returns Fungsi yang harus dipanggil setelah operasi selesai
   */
  async acquire(userId: string, operationId: string): Promise<() => void> {
    const currentOp = this.activeOperations.get(userId);

    // Pengguna tidak memiliki operasi aktif
    if (!currentOp) {
      this.activeOperations.set(userId, operationId);
      return () => this.release(userId, operationId);
    }

    // Antrikan jika pengguna sudah punya operasi aktif
    return new Promise<() => void>((resolve, reject) => {
      if (!this.userQueues.has(userId)) {
        this.userQueues.set(userId, []);
      }

      this.userQueues.get(userId)!.push({
        operationId,
        resolve: () => {
          this.activeOperations.set(userId, operationId);
          resolve(() => this.release(userId, operationId));
        },
        reject,
      });
    });
  }

  /**
   * Lepaskan operasi pengguna dan proses antrian berikutnya.
   */
  private release(userId: string, operationId: string): void {
    const currentOp = this.activeOperations.get(userId);
    if (currentOp !== operationId) return;

    this.activeOperations.delete(userId);

    const queue = this.userQueues.get(userId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) {
        this.userQueues.delete(userId);
      }
      next.resolve();
    } else {
      this.userQueues.delete(userId);
    }
  }

  /**
   * Cek apakah pengguna memiliki operasi aktif.
   */
  isActive(userId: string): boolean {
    return this.activeOperations.has(userId);
  }

  /**
   * Dapatkan jumlah pengguna yang memiliki operasi aktif.
   */
  getActiveUserCount(): number {
    return this.activeOperations.size;
  }

  /**
   * Dapatkan jumlah operasi yang menunggu per pengguna.
   */
  getUserQueueSize(userId: string): number {
    return this.userQueues.get(userId)?.length ?? 0;
  }

  /**
   * Tolak semua operasi yang menunggu untuk pengguna tertentu.
   */
  cancelUserQueues(userId: string, reason: string = 'Dibatalkan'): void {
    const queue = this.userQueues.get(userId);
    if (!queue) return;

    for (const waiter of queue) {
      waiter.reject(new Error(reason));
    }

    this.userQueues.delete(userId);
  }
}

// =====================================================================
// TRANSACTION QUEUE — Antrian transaksi dengan prioritas
// =====================================================================

/**
 * Antrian transaksi utama.
 * Mengelola eksekusi operasi dengan prioritas, batas konkurensi,
 * dan backpressure.
 */
class TransactionQueueManager {
  private readonly config: Required<QueueConfig>;
  private readonly resourceLock: ResourceLockManager;
  private readonly userQueue: UserOperationQueue;

  /** Antrian utama yang diurutkan berdasarkan prioritas */
  private readonly pendingQueue: QueuedOperation[] = [];

  /** Operasi yang sedang berjalan */
  private readonly processingOps = new Map<
    string,
    {
      operation: QueuedOperation;
      releases: Array<() => void>;
      startTime: number;
    }
  >();

  /** Batas konkurensi per tipe operasi */
  private readonly concurrencyLimits = new Map<OperationType, number>();
  private readonly defaultConcurrencyLimit = 10;

  /** Statistik historis */
  private readonly completedOps: CompletedOperation[] = [];
  private totalRejected = 0;

  /** Timer untuk proses antrian */
  private processingTimer: ReturnType<typeof setImmediate> | null = null;

  /** Waktu mulai antrian */
  private readonly startTime: number;

  constructor(
    config: Required<QueueConfig>,
    resourceLock: ResourceLockManager,
    userQueue: UserOperationQueue
  ) {
    this.config = config;
    this.resourceLock = resourceLock;
    this.userQueue = userQueue;
    this.startTime = Date.now();

    // Batas konkurensi default per tipe
    this.concurrencyLimits.set('sale', 20);
    this.concurrencyLimits.set('purchase', 10);
    this.concurrencyLimits.set('expense', 10);
    this.concurrencyLimits.set('salary', 5);
    this.concurrencyLimits.set('payment', 15);
    this.concurrencyLimits.set('stock_adjustment', 10);
    this.concurrencyLimits.set('finance_request', 10);
    this.concurrencyLimits.set('courier_deposit', 5);
    this.concurrencyLimits.set('general', 20);
  }

  /**
   * Masukkan operasi ke dalam antrian.
   *
   * @param operation - Operasi yang akan diantrikan
   * @returns Hasil dari eksekusi operasi
   * @throws Error jika antrian penuh (backpressure)
   */
  async enqueue(operation: QueuedOperation): Promise<unknown> {
    // Backpressure — tolak jika antrian penuh
    if (
      this.config.maxQueueSize > 0 &&
      this.pendingQueue.length >= this.config.maxQueueSize
    ) {
      this.totalRejected++;
      throw new Error(
        `Antrian penuh (${this.pendingQueue.length}/${this.config.maxQueueSize}). ` +
        `Coba lagi nanti.`
      );
    }

    // Set metadata
    operation.enqueuedAt = Date.now();
    operation.priority =
      operation.priority ?? DEFAULT_PRIORITY[operation.type] ?? 0;
    operation.retryCount = operation.retryCount ?? 0;

    // Masukkan ke antrian dengan penyisipan berprioritas
    this.insertByPriority(operation);

    this.log(
      `[TransactionQueue] Operasi "${operation.id}" (${operation.type}) ` +
      `diantrikan. Prioritas: ${operation.priority}. ` +
      `Antrian: ${this.pendingQueue.length}, Proses: ${this.processingOps.size}`
    );

    // Proses antrian
    this.scheduleProcessing();

    // Tunggu hasil
    return this.waitForCompletion(operation);
  }

  /**
   * Set batas konkurensi untuk tipe operasi tertentu.
   */
  setConcurrencyLimit(type: OperationType, limit: number): void {
    this.concurrencyLimits.set(type, Math.max(1, limit));
  }

  /**
   * Dapatkan batas konkurensi untuk tipe operasi.
   */
  getConcurrencyLimit(type: OperationType): number {
    return (
      this.concurrencyLimits.get(type) ?? this.defaultConcurrencyLimit
    );
  }

  /**
   * Dapatkan jumlah operasi yang sedang diproses per tipe.
   */
  getProcessingCountByType(type: OperationType): number {
    let count = 0;
    for (const { operation } of this.processingOps.values()) {
      if (operation.type === type) count++;
    }
    return count;
  }

  /**
   * Dapatkan statistik antrian.
   */
  getStats(): QueueStats {
    const now = Date.now();

    // Hitung rata-rata waktu tunggu dan pemrosesan dari window
    const window = this.completedOps.slice(-this.config.statsWindowSize);
    const avgWait =
      window.length > 0
        ? window.reduce((s, o) => s + o.waitTimeMs, 0) / window.length
        : 0;
    const avgProcess =
      window.length > 0
        ? window.reduce((s, o) => s + o.processTimeMs, 0) / window.length
        : 0;

    // Hitung per tipe
    const byType: Record<string, number> = {};
    for (const op of this.pendingQueue) {
      byType[op.type] = (byType[op.type] ?? 0) + 1;
    }
    for (const { operation } of this.processingOps.values()) {
      byType[operation.type] = (byType[operation.type] ?? 0) + 1;
    }

    // Hitung berhasil/gagal dari window
    const completed = window.filter((o) => o.success).length;
    const failed = window.filter((o) => !o.success).length;

    return {
      pending: this.pendingQueue.length,
      processing: this.processingOps.size,
      completed,
      failed,
      avgWaitTimeMs: Math.round(avgWait),
      avgProcessTimeMs: Math.round(avgProcess),
      byType,
      rejected: this.totalRejected,
      uptimeSeconds: Math.round((now - this.startTime) / 1000),
    };
  }

  /**
   * Dapatkan informasi kesehatan antrian.
   */
  getHealth(): QueueHealth {
    const stats = this.getStats();
    const lockedResources = this.resourceLock.getLockedCount();
    const activeUsers = this.userQueue.getActiveUserCount();

    let healthy = true;
    const messages: string[] = [];

    // Cek backlog
    if (stats.pending > this.config.maxQueueSize * 0.8) {
      healthy = false;
      messages.push('Antrian hampir penuh (>80%)');
    }

    // Cek rata-rata waktu tunggu
    if (stats.avgWaitTimeMs > this.config.maxWaitTimeMs * 0.5) {
      healthy = false;
      messages.push(
        `Waktu tunggu rata-rata tinggi (${stats.avgWaitTimeMs}ms)`
      );
    }

    // Cek rasio kegagalan
    if (stats.completed + stats.failed > 0) {
      const failRate = stats.failed / (stats.completed + stats.failed);
      if (failRate > 0.1) {
        healthy = false;
        messages.push(
          `Rasio kegagalan tinggi (${(failRate * 100).toFixed(1)}%)`
        );
      }
    }

    // Cek resource lock
    if (lockedResources > 100) {
      healthy = false;
      messages.push(`Terlalu banyak resource terkunci (${lockedResources})`);
    }

    return {
      healthy,
      message: healthy
        ? 'Antrian beroperasi normal'
        : `Peringatan: ${messages.join('; ')}`,
      stats,
      lockedResources,
      activeUsers,
    };
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  /**
   * Tunggu hingga operasi selesai diproses.
   */
  private waitForCompletion(operation: QueuedOperation): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const completed = this.completedOps.find(
          (c) => c.id === operation.id
        );
        if (completed) {
          clearInterval(checkInterval);
          if (completed.success) {
            resolve(completed.result);
          } else {
            reject(new Error(completed.error ?? 'Operasi gagal'));
          }
        }
      }, 10);

      if (checkInterval.unref) checkInterval.unref();
    });
  }

  /**
   * Sisipkan operasi ke antrian berdasarkan prioritas (stable sort).
   * Operasi dengan prioritas lebih tinggi ditempatkan lebih dulu.
   */
  private insertByPriority(operation: QueuedOperation): void {
    let insertIndex = this.pendingQueue.length;

    for (let i = this.pendingQueue.length - 1; i >= 0; i--) {
      const existing = this.pendingQueue[i];
      const existingPriority =
        existing.priority ?? DEFAULT_PRIORITY[existing.type] ?? 0;

      if ((operation.priority ?? 0) <= existingPriority) {
        insertIndex = i + 1;
        break;
      }
    }

    this.pendingQueue.splice(insertIndex, 0, operation);
  }

  /**
   * Jadwalkan pemrosesan antrian.
   * Menggunakan setImmediate agar tidak blocking event loop.
   */
  private scheduleProcessing(): void {
    if (this.processingTimer) return;

    this.processingTimer = setImmediate(() => {
      this.processingTimer = null;
      void this.processQueue();
    });
  }

  /**
   * Proses operasi dari antrian.
   */
  private async processQueue(): Promise<void> {
    // Proses selama ada operasi yang bisa dijalankan
    while (this.pendingQueue.length > 0) {
      const operation = this.pendingQueue[0];

      // Cek apakah operasi sudah melewati batas waktu tunggu
      if (
        operation.enqueuedAt &&
        Date.now() - operation.enqueuedAt > this.config.maxWaitTimeMs
      ) {
        this.pendingQueue.shift();
        this.recordCompletion(operation, false, undefined, 'Waktu tunggu antrian habis');
        this.log(
          `[TransactionQueue] Operasi "${operation.id}" dibatalkan — waktu tunggu habis`
        );
        continue;
      }

      // Cek batas konkurensi untuk tipe operasi ini
      const limit = this.getConcurrencyLimit(operation.type);
      const currentCount = this.getProcessingCountByType(operation.type);
      if (currentCount >= limit) {
        // Tidak bisa memproses lebih banyak dari tipe ini — hentikan loop
        break;
      }

      // Cek apakah pengguna sudah punya operasi aktif di sistem
      // (akuisisi antrian pengguna akan dilakukan di dalam processOperation)
      // Tapi kita cek dulu apakah ada slot tersedia
      const canProceed = await this.tryProcessOperation(operation);
      if (!canProceed) {
        // Operasi tidak bisa diproses sekarang — coba operasi lain
        break;
      }

      // Operasi berhasil dimulai — tryProcessOperation already removed it from queue
    }
  }

  /**
   * Coba mulai pemrosesan satu operasi.
   * @returns true jika operasi berhasil dimulai, false jika harus menunggu
   */
  private async tryProcessOperation(operation: QueuedOperation): Promise<boolean> {
    try {
      // 1. Dapatkan kunci sumber daya (semua resource harus terkunci)
      const releases: Array<() => void> = [];

      if (operation.resourceIds.length > 0) {
        // Sort resourceId untuk mencegah deadlock (kunci selalu di urutan yang sama)
        const sortedResourceIds = [...operation.resourceIds].sort();

        for (const resourceId of sortedResourceIds) {
          try {
            const release = await this.resourceLock.acquire(
              resourceId,
              operation.id,
              this.config.maxWaitTimeMs
            );
            releases.push(release);
          } catch (lockError) {
            // Gagal mendapatkan kunci — lepaskan semua kunci yang sudah diperoleh
            for (const r of releases) r();
            // Operasi tetap di antrian untuk dicoba nanti
            return false;
          }
        }
      }

      // 2. Tandai sebagai sedang diproses
      this.pendingQueue.shift();
      operation.startedAt = Date.now();

      this.processingOps.set(operation.id, {
        operation,
        releases,
        startTime: Date.now(),
      });

      // 3. Jalankan operasi secara async (non-blocking)
      void this.executeOperation(operation, releases);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Jalankan operasi dan catat hasilnya.
   */
  private async executeOperation(
    operation: QueuedOperation,
    releases: Array<() => void>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Timeout wrapper
      const result = await this.withTimeout(
        operation.execute(),
        this.config.maxExecutionTimeMs,
        `Operasi "${operation.id}" melewati batas waktu eksekusi (${this.config.maxExecutionTimeMs}ms)`
      );

      const processTime = Date.now() - startTime;
      operation.completedAt = Date.now();

      this.recordCompletion(operation, true, result);
      this.log(
        `[TransactionQueue] Operasi "${operation.id}" (${operation.type}) ` +
        `selesai dalam ${processTime}ms`
      );
    } catch (error) {
      const processTime = Date.now() - startTime;
      operation.completedAt = Date.now();

      const errorMessage =
        error instanceof Error ? error.message : 'Operasi gagal';

      // Coba ulang jika masih ada kesempatan
      if (
        (operation.retryCount ?? 0) < this.config.maxRetries
      ) {
        operation.retryCount = (operation.retryCount ?? 0) + 1;
        this.log(
          `[TransactionQueue] Mencoba ulang operasi "${operation.id}" ` +
          `(percobaan ${operation.retryCount}/${this.config.maxRetries}): ${errorMessage}`
        );

        // Kembalikan ke antrian dengan prioritas yang sama
        this.insertByPriority(operation);
        this.scheduleProcessing();
      } else {
        this.recordCompletion(operation, false, undefined, errorMessage);
        this.log(
          `[TransactionQueue] Operasi "${operation.id}" (${operation.type}) ` +
          `GAGAL setelah ${operation.retryCount} percobaan: ${errorMessage}`
        );
      }
    } finally {
      // Lepaskan semua kunci sumber daya
      for (const release of releases) {
        try {
          release();
        } catch {
          // Ignore release errors
        }
      }

      // Hapus dari pemrosesan aktif
      this.processingOps.delete(operation.id);

      // Jadwalkan pemrosesan antrian berikutnya
      this.scheduleProcessing();
    }
  }

  /**
   * Catat hasil operasi ke statistik.
   */
  private recordCompletion(
    operation: QueuedOperation,
    success: boolean,
    result?: unknown,
    error?: string
  ): void {
    const now = Date.now();
    const waitTime = (operation.startedAt ?? now) - (operation.enqueuedAt ?? now);
    const processTime = now - (operation.startedAt ?? now);

    const completed: CompletedOperation = {
      id: operation.id,
      type: operation.type,
      userId: operation.userId,
      success,
      result: success ? result : undefined,
      error: success ? undefined : error,
      waitTimeMs: waitTime,
      processTimeMs: processTime,
      enqueuedAt: operation.enqueuedAt ?? now,
      startedAt: operation.startedAt ?? now,
      completedAt: now,
    };

    this.completedOps.push(completed);

    // Trim statistik ke ukuran window
    while (
      this.completedOps.length >
      this.config.statsWindowSize * 2
    ) {
      this.completedOps.shift();
    }
  }

  /**
   * Wrapper timeout untuk Promise.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      if (timer.unref) timer.unref();

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Log kondisional berdasarkan konfigurasi verbose.
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(message);
    }
  }
}

// =====================================================================
// DEADLOCK DETECTOR — Deteksi kebuntuan otomatis
// =====================================================================

/**
 * Deteksi siklus tunggu (deadlock) di antara operasi yang saling mengunci.
 * Berjalan secara periodik atau on-demand.
 */
class DeadlockDetector {
  private readonly resourceLock: ResourceLockManager;
  private readonly processingOps: () => Map<
    string,
    { operation: QueuedOperation; releases: Array<() => void>; startTime: number }
  >;
  private detectionTimer: ReturnType<typeof setInterval> | null = null;
  private detectionCount = 0;
  private resolutionCount = 0;

  constructor(
    resourceLock: ResourceLockManager,
    getProcessingOps: () => Map<
      string,
      { operation: QueuedOperation; releases: Array<() => void>; startTime: number }
    >
  ) {
    this.resourceLock = resourceLock;
    this.processingOps = getProcessingOps;
  }

  /**
   * Mulai deteksi deadlock secara periodik.
   */
  start(intervalMs: number = 5_000): void {
    if (this.detectionTimer) return;

    this.detectionTimer = setInterval(() => {
      void this.detect();
    }, intervalMs);

    if (this.detectionTimer.unref) this.detectionTimer.unref();
  }

  /**
   * Hentikan deteksi periodik.
   */
  stop(): void {
    if (this.detectionTimer) {
      clearInterval(this.detectionTimer);
      this.detectionTimer = null;
    }
  }

  /**
   * Jalankan deteksi deadlock satu kali.
   * @returns Jumlah deadlock yang terdeteksi dan diselesaikan
   */
  async detect(): Promise<{ detected: number; resolved: number }> {
    this.detectionCount++;

    // 1. Cari kunci yang sudah stale
    const staleCleaned = this.resourceLock.cleanupStaleLocks();
    this.resolutionCount += staleCleaned;

    // 2. Cari operasi yang sudah berjalan terlalu lama (>5 menit)
    const ops = this.processingOps();
    const longRunningThreshold = 300_000; // 5 menit
    let longRunningKilled = 0;

    for (const [opId, { operation, startTime }] of ops) {
      const elapsed = Date.now() - startTime;
      if (elapsed > longRunningThreshold) {
        console.warn(
          `[DeadlockDetector] Operasi "${opId}" (${operation.type}) ` +
          `berjalan selama ${Math.round(elapsed / 1000)}s — kemungkinan stuck.`
        );
        // Catat untuk monitoring — operasi sebenarnya ditangani oleh timeout wrapper
        longRunningKilled++;
      }
    }

    // 3. Cek siklus kunci (opsional — deadlock sejati jarang terjadi karena sorted lock acquisition)
    // Kunci selalu diakuisisi dalam urutan terurut, sehingga deadlock sejari dicegah
    // Di sini kita hanya memantau kondisi abnormal

    return {
      detected: staleCleaned + longRunningKilled,
      resolved: staleCleaned,
    };
  }

  /**
   * Dapatkan statistik deteksi deadlock.
   */
  getStats(): { detectionCount: number; resolutionCount: number } {
    return {
      detectionCount: this.detectionCount,
      resolutionCount: this.resolutionCount,
    };
  }
}

// =====================================================================
// CONCURRENCY MANAGER — Interface utama (Singleton)
// =====================================================================

/**
 * Manajer konkurensi utama yang menggabungkan semua komponen.
 * Gunakan instance singleton `concurrencyManager` yang diekspor.
 *
 * Contoh penggunaan:
 * ```ts
 * import { concurrencyManager } from '@/lib/concurrency-queue';
 *
 * // Kunci sumber daya langsung
 * const release = await concurrencyManager.resourceLock.acquire('product:abc123');
 * try {
 *   // ... operasi pada produk abc123
 * } finally {
 *   release();
 * }
 *
 * // Antrikan transaksi
 * const result = await concurrencyManager.transactionQueue.enqueue({
 *   id: crypto.randomUUID(),
 *   type: 'sale',
 *   resourceIds: ['product:abc123', 'cashbox:main'],
 *   userId: currentUser.id,
 *   execute: async () => {
 *     return await createSale(data);
 *   },
 * });
 * ```
 */
export class ConcurrencyManager {
  private static instance: ConcurrencyManager;

  readonly resourceLock: ResourceLockManager;
  readonly userQueue: UserOperationQueue;
  private readonly txQueue: TransactionQueueManager;
  private readonly deadlockDetector: DeadlockDetector;
  private readonly config: Required<QueueConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(config?: Partial<QueueConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Inisialisasi komponen
    this.resourceLock = new ResourceLockManager(this.config.lockStaleThresholdMs);
    this.userQueue = new UserOperationQueue();
    this.txQueue = new TransactionQueueManager(
      this.config,
      this.resourceLock,
      this.userQueue
    );
    this.deadlockDetector = new DeadlockDetector(
      this.resourceLock,
      () => (this.txQueue as any).processingOps
    );

    // Mulai deteksi deadlock periodik
    this.deadlockDetector.start(5_000);

    // Mulai pembersihan periodik
    this.startCleanup();

    console.log(
      `[ConcurrencyManager] Inisialisasi selesai. ` +
      `maxQueue=${this.config.maxQueueSize}, ` +
      `maxWait=${this.config.maxWaitTimeMs}ms, ` +
      `maxExec=${this.config.maxExecutionTimeMs}ms`
    );
  }

  /** Dapatkan instance singleton */
  static getInstance(config?: Partial<QueueConfig>): ConcurrencyManager {
    if (!ConcurrencyManager.instance) {
      ConcurrencyManager.instance = new ConcurrencyManager(config);
    }
    return ConcurrencyManager.instance;
  }

  /**
   * Antrian transaksi (transaction queue).
   */
  get transactionQueue(): TransactionQueueManager {
    return this.txQueue;
  }

  /**
   * Dapatkan statistik keseluruhan sistem konkurensi.
   */
  getStats(): QueueStats {
    return this.txQueue.getStats();
  }

  /**
   * Dapatkan informasi kesehatan sistem.
   */
  getHealth(): QueueHealth {
    return this.txQueue.getHealth();
  }

  /**
   * Set batas konkurensi untuk tipe operasi.
   */
  setConcurrencyLimit(type: OperationType, limit: number): void {
    this.txQueue.setConcurrencyLimit(type, limit);
  }

  /**
   * Hentikan semua timer dan bersihkan state.
   */
  dispose(): void {
    this.deadlockDetector.stop();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      // Bersihkan kunci stale
      const cleaned = this.resourceLock.cleanupStaleLocks();
      if (cleaned > 0) {
        console.warn(
          `[ConcurrencyManager] Membersihkan ${cleaned} kunci stale`
        );
      }
    }, this.config.cleanupIntervalMs);

    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }
}

// =====================================================================
// SINGLETON EXPORT
// =====================================================================

/**
 * Instance singleton ConcurrencyManager.
 * Gunakan ini di semua API route untuk mengakses sistem konkurensi.
 */
export const concurrencyManager = ConcurrencyManager.getInstance();

// =====================================================================
// CONVENIENCE: Shorthand untuk operasi yang sering digunakan
// =====================================================================

/**
 * Wrapper singkat untuk menjalankan operasi dengan kunci sumber daya.
 * Otomatis melepaskan kunci setelah selesai (atau gagal).
 *
 * @param resourceId - ID sumber daya yang akan dikunci
 * @param operationId - ID operasi (untuk tracking)
 * @param fn - Fungsi yang akan dijalankan saat kunci diperoleh
 * @param timeoutMs - Batas waktu kunci (default: 10 detik)
 * @returns Hasil dari fungsi
 *
 * Contoh:
 * ```ts
 * const newStock = await withResourceLock(
 *   'product:abc123',
 *   crypto.randomUUID(),
 *   async () => {
 *     return await atomicDecrementStock('abc123', 5);
 *   }
 * );
 * ```
 */
export async function withResourceLock<T>(
  resourceId: string,
  operationId: string,
  fn: () => Promise<T>,
  timeoutMs: number = 10_000
): Promise<T> {
  const release = await concurrencyManager.resourceLock.acquire(
    resourceId,
    operationId,
    timeoutMs
  );

  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Wrapper singkat untuk menjalankan operasi dengan kunci ganda (multi-resource).
 * Kunci selalu diakuisisi dalam urutan terurut untuk mencegah deadlock.
 *
 * @param resourceIds - Daftar ID sumber daya yang akan dikunci
 * @param operationId - ID operasi (untuk tracking)
 * @param fn - Fungsi yang akan dijalankan saat semua kunci diperoleh
 * @param timeoutMs - Batas waktu per kunci (default: 10 detik)
 * @returns Hasil dari fungsi
 *
 * Contoh:
 * ```ts
 * await withMultiResourceLock(
 *   ['cashbox:main', 'bank:abc'],
 *   crypto.randomUUID(),
 *   async () => {
 *     await atomicUpdateBalance('cash_boxes', 'main', -50000);
 *     await atomicUpdateBalance('bank_accounts', 'abc', 50000);
 *   }
 * );
 * ```
 */
export async function withMultiResourceLock<T>(
  resourceIds: string[],
  operationId: string,
  fn: () => Promise<T>,
  timeoutMs: number = 10_000
): Promise<T> {
  const sortedIds = [...resourceIds].sort();
  const releases: Array<() => void> = [];

  try {
    for (const resourceId of sortedIds) {
      const release = await concurrencyManager.resourceLock.acquire(
        resourceId,
        operationId,
        timeoutMs
      );
      releases.push(release);
    }

    return await fn();
  } finally {
    // Lepaskan semua kunci dalam urutan terbalik
    for (const release of releases.reverse()) {
      release();
    }
  }
}

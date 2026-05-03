// =====================================================================
// PERFORMANCE MONITOR — Pemantauan kinerja real-time
//
// Melacak dan mengekspor metrik kinerja:
//   1. Timer — ukur durasi operasi (DB query, API response, dll)
//   2. Histogram — distribusi nilai (waktu respons, ukuran payload)
//   3. Gauge — nilai terkini (koneksi aktif, memori, antrian)
//   4. Counter — penghitung kumulatif (request total, error total)
//   5. Alert — peringatan otomatis saat degradasi terdeteksi
//   6. Export — metrik terstruktur untuk endpoint kesehatan
//
// ZERO external dependencies — pure TypeScript.
// JSDoc dalam Bahasa Indonesia.
// =====================================================================

// =====================================================================
// TIPE DASAR
// =====================================================================

/**
 * Representasi single measurement dalam histogram.
 */
interface HistogramBucket {
  /** Batas bawah bucket (inklusif) */
  min: number;
  /** Batas atas bucket (eksklusif) */
  max: number;
  /** Jumlah measurement dalam bucket ini */
  count: number;
}

/**
 * Hasil snapshot dari histogram.
 */
export interface HistogramSnapshot {
  /** Jumlah total measurement */
  count: number;
  /** Nilai minimum */
  min: number;
  /** Nilai maksimum */
  max: number;
  /** Rata-rata (mean) */
  mean: number;
  /** Median (p50) */
  p50: number;
  /** Persentil ke-90 */
  p90: number;
  /** Persentil ke-95 */
  p95: number;
  /** Persentil ke-99 */
  p99: number;
  /** Standar deviasi */
  stdDev: number;
  /** Distribusi bucket */
  buckets: HistogramBucket[];
}

/**
 * Hasil snapshot dari gauge.
 */
export interface GaugeSnapshot {
  /** Nama gauge */
  name: string;
  /** Nilai terkini */
  value: number;
  /** Nilai minimum sejak lastReset */
  min: number;
  /** Nilai maksimum sejak lastReset */
  max: number;
  /** Rata-rata sejak lastReset */
  avg: number;
  /** Waktu terakhir diupdate */
  lastUpdatedAt: number;
  /** Jumlah update sejak lastReset */
  updateCount: number;
}

/**
 * Hasil snapshot dari counter.
 */
export interface CounterSnapshot {
  /** Nama counter */
  name: string;
  /** Nilai saat ini */
  value: number;
  /** Rate per detik (dihitung dari interval) */
  ratePerSec: number;
}

/**
 * Konfigurasi untuk alert/peringatan.
 */
export interface AlertConfig {
  /** Nama metrik yang dipantau */
  metricName: string;
  /** Tipe alert: threshold, trend, spike */
  type: 'threshold' | 'trend' | 'spike';
  /** Operator perbandingan untuk threshold */
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  /** Nilai ambang batas untuk threshold */
  threshold: number;
  /** Durasi window untuk trend (ms) */
  windowMs?: number;
  /** Persentase perubahan untuk spike (0-1) */
  spikePercent?: number;
  /** Callback ketika alert dipicu */
  onTrigger: (alert: AlertEvent) => void;
  /** Cooldown antar trigger (ms) */
  cooldownMs: number;
}

/**
 * Event alert yang dipicu.
 */
export interface AlertEvent {
  /** Nama metrik */
  metricName: string;
  /** Tipe alert */
  type: 'threshold' | 'trend' | 'spike';
  /** Pesan deskriptif */
  message: string;
  /** Nilai yang memicu alert */
  value: number;
  /** Waktu alert dipicu */
  timestamp: number;
  /** Severity */
  severity: 'warning' | 'critical';
}

/**
 * Snapshot metrik keseluruhan sistem.
 */
export interface PerformanceMetrics {
  /** Waktu snapshot (Unix timestamp ms) */
  timestamp: number;
  /** Uptime sistem (ms) */
  uptimeMs: number;
  /** Daftar histogram */
  histograms: Record<string, HistogramSnapshot | null>;
  /** Daftar gauge */
  gauges: Record<string, GaugeSnapshot | null>;
  /** Daftar counter */
  counters: Record<string, CounterSnapshot | null>;
  /** Daftar alert aktif */
  activeAlerts: AlertEvent[];
  /** Ringkasan kesehatan */
  summary: PerformanceSummary;
}

/**
 * Ringkasan kinerja.
 */
export interface PerformanceSummary {
  /** Apakah sistem dalam kondisi sehat */
  healthy: boolean;
  /** Jumlah masalah aktif */
  issues: number;
  /** Pesan ringkas */
  message: string;
  /** Waktu respons rata-rata API (ms) */
  avgApiResponseMs: number;
  /** DB query rata-rata (ms) */
  avgDbQueryMs: number;
  /** Request per detik (estimasi) */
  requestsPerSec: number;
  /** Error rate (0-1) */
  errorRate: number;
}

/**
 * Konfigurasi PerformanceMonitor.
 */
export interface PerformanceMonitorConfig {
  /** Waktu hidup default timer sebelum dianggap leaked (ms) */
  timerDefaultTimeoutMs: number;
  /** Jumlah maksimum measurement per histogram */
  maxHistogramSamples: number;
  /** Interval pembersihan timer yang bocor (ms) */
  leakDetectionIntervalMs: number;
  /** Jumlah maksimum timer aktif sebelum peringatan */
  maxActiveTimers: number;
  /** Aktifkan log verbose */
  verbose: boolean;
}

/** Konfigurasi default */
const DEFAULT_CONFIG: Required<PerformanceMonitorConfig> = {
  timerDefaultTimeoutMs: 30_000,
  maxHistogramSamples: 10_000,
  leakDetectionIntervalMs: 60_000,
  maxActiveTimers: 500,
  verbose: false,
};

// =====================================================================
// TIMER — Pengukur durasi operasi
// =====================================================================

/**
 * Timer yang mengukur durasi antara start dan stop.
 * Mendukung auto-stop jika melewati batas waktu.
 *
 * Contoh:
 * ```ts
 * const timer = perfMonitor.timer('db.query.products');
 * try {
 *   await db.from('products').select('*');
 * } finally {
 *   timer.stop(); // Otomatis mencatat ke histogram
 * }
 * ```
 */
class Timer {
  private readonly name: string;
  private readonly monitor: PerformanceMonitor;
  private readonly startTime: number;
  private stopped = false;
  private readonly timeoutMs: number;

  constructor(name: string, monitor: PerformanceMonitor, timeoutMs: number) {
    this.name = name;
    this.monitor = monitor;
    this.startTime = Date.now();
    this.timeoutMs = timeoutMs;
  }

  /**
   * Hentikan timer dan catat durasi ke histogram.
   * @returns Durasi dalam milidetik
   */
  stop(): number {
    if (this.stopped) return 0;
    this.stopped = true;

    const duration = Date.now() - this.startTime;
    this.monitor.recordTimer(this.name, duration);
    this.monitor.removeActiveTimer(this);

    return duration;
  }

  /**
   * Cek apakah timer sudah berhenti.
   */
  isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Dapatkan durasi saat ini (tanpa menghentikan timer).
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Dapatkan nama timer.
   */
  getName(): string {
    return this.name;
  }

  /**
   * Dapatkan batas waktu timer.
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }
}

// =====================================================================
// HISTOGRAM — Distribusi nilai
// =====================================================================

/**
 * Histogram untuk melacak distribusi nilai (waktu, ukuran, dll).
 * Menggunakan streaming percentile calculation untuk efisiensi memori.
 */
class Histogram {
  readonly name: string;
  private readonly maxSamples: number;
  private values: number[] = [];
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;

  // Bucket boundaries default (ms): 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000
  private readonly bucketBoundaries = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  constructor(name: string, maxSamples: number = 10_000) {
    this.name = name;
    this.maxSamples = maxSamples;
  }

  /**
   * Catat sebuah nilai ke histogram.
   */
  record(value: number): void {
    this.values.push(value);
    this.sum += value;
    if (value < this.min) this.min = value;
    if (value > this.max) this.max = value;

    // Trim jika melebihi maxSamples (buang yang paling lama)
    if (this.values.length > this.maxSamples) {
      const removed = this.values.shift()!;
      this.sum -= removed;
    }
  }

  /**
   * Ambil snapshot statistik histogram saat ini.
   */
  snapshot(): HistogramSnapshot {
    if (this.values.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        stdDev: 0,
        buckets: this.computeBuckets(),
      };
    }

    const sorted = [...this.values].sort((a, b) => a - b);
    const count = sorted.length;
    const mean = this.sum / count;

    // Percentile helper
    const percentile = (p: number) => {
      const idx = Math.ceil((p / 100) * count) - 1;
      return sorted[Math.max(0, Math.min(idx, count - 1))];
    };

    // Standard deviation
    const variance =
      this.values.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    return {
      count,
      min: this.min === Infinity ? 0 : this.min,
      max: this.max === -Infinity ? 0 : this.max,
      mean: Math.round(mean * 100) / 100,
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      stdDev: Math.round(stdDev * 100) / 100,
      buckets: this.computeBuckets(),
    };
  }

  /**
   * Reset histogram ke keadaan awal.
   */
  reset(): void {
    this.values = [];
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  /**
   * Jumlah sampel saat ini.
   */
  get count(): number {
    return this.values.length;
  }

  /**
   * Hitung distribusi bucket.
   */
  private computeBuckets(): HistogramBucket[] {
    const buckets: HistogramBucket[] = [];
    const boundaries = this.bucketBoundaries;

    for (let i = 0; i < boundaries.length; i++) {
      const min = i === 0 ? 0 : boundaries[i - 1];
      const max = boundaries[i];
      const count = this.values.filter((v) => v >= min && v < max).length;
      buckets.push({ min, max, count });
    }

    // Bucket terakhir (overflow)
    const lastBoundary = boundaries[boundaries.length - 1];
    const overflowCount = this.values.filter((v) => v >= lastBoundary).length;
    buckets.push({ min: lastBoundary, max: Infinity, count: overflowCount });

    return buckets;
  }
}

// =====================================================================
// GAUGE — Nilai terkini
// =====================================================================

/**
 * Gauge untuk melacak nilai terkini yang berubah-ubah.
 * Contoh: jumlah koneksi aktif, memori penggunaan, ukuran antrian.
 */
class Gauge {
  readonly name: string;
  private _value = 0;
  private _min = Infinity;
  private _max = -Infinity;
  private _sum = 0;
  private _updateCount = 0;
  private _lastUpdatedAt = 0;
  private _resetAt = Date.now();

  constructor(name: string, initialValue: number = 0) {
    this.name = name;
    this._value = initialValue;
    this._min = initialValue;
    this._max = initialValue;
    this._lastUpdatedAt = Date.now();
  }

  /**
   * Set nilai gauge.
   */
  set(value: number): void {
    this._value = value;
    this.trackUpdate(value);
  }

  /**
   * Tambah nilai gauge.
   */
  increment(delta: number = 1): void {
    this._value += delta;
    this.trackUpdate(this._value);
  }

  /**
   * Kurangi nilai gauge.
   */
  decrement(delta: number = 1): void {
    this._value -= delta;
    this.trackUpdate(this._value);
  }

  /**
   * Ambil snapshot gauge.
   */
  snapshot(): GaugeSnapshot {
    return {
      name: this.name,
      value: this._value,
      min: this._min === Infinity ? this._value : this._min,
      max: this._max === -Infinity ? this._value : this._max,
      avg:
        this._updateCount > 0
          ? Math.round((this._sum / this._updateCount) * 100) / 100
          : this._value,
      lastUpdatedAt: this._lastUpdatedAt,
      updateCount: this._updateCount,
    };
  }

  /**
   * Ambil nilai terkini.
   */
  get value(): number {
    return this._value;
  }

  /**
   * Reset statistik (nilai tetap, min/max/avg di-reset).
   */
  reset(): void {
    this._min = this._value;
    this._max = this._value;
    this._sum = 0;
    this._updateCount = 0;
    this._resetAt = Date.now();
  }

  private trackUpdate(value: number): void {
    this._lastUpdatedAt = Date.now();
    this._updateCount++;
    this._sum += value;
    if (value < this._min) this._min = value;
    if (value > this._max) this._max = value;
  }
}

// =====================================================================
// COUNTER — Penghitung kumulatif
// =====================================================================

/**
 * Counter untuk menghitung kejadian kumulatif.
 * Contoh: total request, total error, total transaksi.
 */
class Counter {
  readonly name: string;
  private _value = 0;
  private _lastValue = 0;
  private _lastRateCheck = Date.now();
  private _ratePerSec = 0;

  constructor(name: string, initialValue: number = 0) {
    this.name = name;
    this._value = initialValue;
  }

  /**
   * Tambah counter.
   */
  increment(delta: number = 1): void {
    this._value += delta;
  }

  /**
   * Set nilai counter.
   */
  set(value: number): void {
    this._value = value;
  }

  /**
   * Ambil snapshot counter.
   */
  snapshot(): CounterSnapshot {
    this.updateRate();
    return {
      name: this.name,
      value: this._value,
      ratePerSec: Math.round(this._ratePerSec * 100) / 100,
    };
  }

  /**
   * Ambil nilai saat ini.
   */
  get value(): number {
    return this._value;
  }

  /**
   * Reset counter ke nol.
   */
  reset(): void {
    this._value = 0;
    this._lastValue = 0;
    this._ratePerSec = 0;
    this._lastRateCheck = Date.now();
  }

  /**
   * Update rate per detik.
   */
  private updateRate(): void {
    const now = Date.now();
    const elapsed = (now - this._lastRateCheck) / 1000;

    if (elapsed >= 1) {
      const delta = this._value - this._lastValue;
      this._ratePerSec = delta / elapsed;
      this._lastValue = this._value;
      this._lastRateCheck = now;
    }
  }
}

// =====================================================================
// ALERT MANAGER — Sistem peringatan
// =====================================================================

/**
 * Mengelola alert/peringatan berdasarkan metrik kinerja.
 */
class AlertManager {
  private readonly alerts = new Map<string, AlertConfig>();
  private readonly activeAlerts: AlertEvent[] = [];
  private readonly lastTriggerTimes = new Map<string, number>();
  private readonly counterHistory = new Map<string, Array<{ value: number; timestamp: number }>>();

  /**
   * Daftarkan konfigurasi alert.
   */
  register(config: AlertConfig): void {
    this.alerts.set(config.metricName, config);
  }

  /**
   * Evaluasi alert untuk metrik tertentu.
   */
  evaluate(
    metricName: string,
    value: number,
    getAllGauges?: () => Map<string, Gauge>,
    getAllCounters?: () => Map<string, Counter>
  ): void {
    const config = this.alerts.get(metricName);
    if (!config) return;

    const now = Date.now();

    // Cek cooldown
    const lastTrigger = this.lastTriggerTimes.get(metricName) ?? 0;
    if (now - lastTrigger < config.cooldownMs) return;

    let triggered = false;
    let message = '';
    let severity: 'warning' | 'critical' = 'warning';

    switch (config.type) {
      case 'threshold': {
        const opResult = this.compare(value, config.operator, config.threshold);
        if (opResult) {
          triggered = true;
          message =
            `${metricName}: ${value} ${config.operator} ${config.threshold}`;
          severity = this.determineSeverity(value, config.threshold, config.operator);
        }
        break;
      }

      case 'spike': {
        const spikePercent = config.spikePercent ?? 0.5;
        const history = this.counterHistory.get(metricName);

        if (history && history.length >= 2) {
          const prevValue = history[history.length - 2]?.value ?? 0;
          if (prevValue > 0) {
            const change = Math.abs(value - prevValue) / prevValue;
            if (change >= spikePercent) {
              triggered = true;
              message =
                `${metricName}: lonjakan ${(change * 100).toFixed(0)}% ` +
                `(${prevValue} → ${value})`;
              severity = change >= spikePercent * 2 ? 'critical' : 'warning';
            }
          }
        }
        break;
      }

      case 'trend': {
        const windowMs = config.windowMs ?? 300_000; // 5 menit default
        const history = this.counterHistory.get(metricName);
        if (history && history.length >= 2) {
          const windowStart = now - windowMs;
          const windowValues = history.filter(
            (h) => h.timestamp >= windowStart
          );

          if (windowValues.length >= 3) {
            // Hitung tren sederhana (linear regression slope)
            const n = windowValues.length;
            const xMean = (n - 1) / 2;
            const yMean = windowValues.reduce((s, v) => s + v.value, 0) / n;
            let numerator = 0;
            let denominator = 0;
            for (let i = 0; i < n; i++) {
              numerator += (i - xMean) * (windowValues[i].value - yMean);
              denominator += (i - xMean) ** 2;
            }
            const slope = denominator !== 0 ? numerator / denominator : 0;

            // Cek apakah tren naik/turun melewati threshold
            if (slope > 0 && config.operator === 'gt' && value > config.threshold) {
              triggered = true;
              message =
                `${metricName}: tren naik (slope=${slope.toFixed(2)}), nilai=${value}`;
              severity = 'warning';
            } else if (slope < 0 && config.operator === 'lt' && value < config.threshold) {
              triggered = true;
              message =
                `${metricName}: tren turun (slope=${slope.toFixed(2)}), nilai=${value}`;
              severity = 'critical';
            }
          }
        }
        break;
      }
    }

    if (triggered) {
      const event: AlertEvent = {
        metricName,
        type: config.type,
        message,
        value,
        timestamp: now,
        severity,
      };

      this.activeAlerts.push(event);
      this.lastTriggerTimes.set(metricName, now);

      // Batasi active alerts (simpan maks 100)
      while (this.activeAlerts.length > 100) {
        this.activeAlerts.shift();
      }

      // Trigger callback
      try {
        config.onTrigger(event);
      } catch (error) {
        console.error(
          `[AlertManager] Error di callback alert "${metricName}":`,
          error
        );
      }

      console.warn(`[PerformanceMonitor] ⚠ ALERT: ${message} [${severity}]`);
    }

    // Catat history untuk spike/trend detection
    if (!this.counterHistory.has(metricName)) {
      this.counterHistory.set(metricName, []);
    }

    const history = this.counterHistory.get(metricName)!;
    history.push({ value, timestamp: now });

    // Trim history (simpan 1000 entri terakhir)
    while (history.length > 1000) {
      history.shift();
    }
  }

  /**
   * Ambil semua alert yang aktif.
   */
  getActiveAlerts(): AlertEvent[] {
    return [...this.activeAlerts];
  }

  /**
   * Bersihkan semua alert aktif.
   */
  clearAlerts(): void {
    this.activeAlerts.length = 0;
  }

  /**
   * Dapatkan daftar semua konfigurasi alert yang terdaftar.
   */
  getRegisteredAlerts(): Array<{ metricName: string; type: string }> {
    return Array.from(this.alerts.values()).map((a) => ({
      metricName: a.metricName,
      type: a.type,
    }));
  }

  // -------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------

  private compare(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private determineSeverity(
    value: number,
    threshold: number,
    operator: string
  ): 'warning' | 'critical' {
    const ratio = operator === 'gt' || operator === 'gte'
      ? value / threshold
      : threshold / value;

    // 2x dari threshold = critical
    return ratio >= 2 ? 'critical' : 'warning';
  }
}

// =====================================================================
// PERFORMANCE MONITOR — Kelas utama (Singleton)
// =====================================================================

/**
 * Monitor kinerja real-time untuk sistem ERP.
 * Mengumpulkan metrik dari semua komponen (DB, API, antrian, memori).
 *
 * Contoh penggunaan:
 * ```ts
 * import { perfMonitor } from '@/lib/performance-monitor';
 *
 * // Timer untuk DB query
 * const timer = perfMonitor.timer('db.query.products');
 * await db.from('products').select('*');
 * timer.stop();
 *
 * // Counter untuk request
 * perfMonitor.incrementCounter('api.requests');
 *
 * // Gauge untuk koneksi aktif
 * perfMonitor.setGauge('ws.connections', activeConnections);
 *
 * // Ambil semua metrik untuk endpoint kesehatan
 * const metrics = perfMonitor.getMetrics();
 * ```
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;

  private readonly config: Required<PerformanceMonitorConfig>;
  private readonly histograms = new Map<string, Histogram>();
  private readonly gauges = new Map<string, Gauge>();
  private readonly counters = new Map<string, Counter>();
  private readonly alertManager: AlertManager;
  private readonly activeTimers = new Set<Timer>();
  private readonly startTime: number;

  private leakDetectionTimer: ReturnType<typeof setInterval> | null = null;
  private verbose: boolean;

  private constructor(config?: Partial<PerformanceMonitorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.alertManager = new AlertManager();
    this.startTime = Date.now();
    this.verbose = this.config.verbose;

    // Mulai deteksi timer bocor
    this.startLeakDetection();

    // Daftarkan alert default
    this.registerDefaultAlerts();

    console.log('[PerformanceMonitor] Inisialisasi selesai');
  }

  /** Dapatkan instance singleton */
  static getInstance(
    config?: Partial<PerformanceMonitorConfig>
  ): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(config);
    }
    return PerformanceMonitor.instance;
  }

  // =================================================================
  // TIMER
  // =================================================================

  /**
   * Buat timer baru untuk mengukur durasi operasi.
   * Timer otomatis dicatat ke histogram saat stop() dipanggil.
   *
   * @param name - Nama timer (akan dicatat ke histogram dengan nama yang sama)
   * @param timeoutMs - Batas waktu sebelum timer dianggap bocor (default dari config)
   * @returns Objek Timer dengan metode stop() dan elapsed()
   *
   * Contoh:
   * ```ts
   * const timer = perfMonitor.timer('api.handler.transactions');
   * // ... lakukan operasi ...
   * const durationMs = timer.stop();
   * ```
   */
  timer(name: string, timeoutMs?: number): Timer {
    const t = new Timer(
      name,
      this,
      timeoutMs ?? this.config.timerDefaultTimeoutMs
    );

    this.activeTimers.add(t);

    // Peringatan jika terlalu banyak timer aktif
    if (this.activeTimers.size > this.config.maxActiveTimers) {
      console.warn(
        `[PerformanceMonitor] Terlalu banyak timer aktif: ${this.activeTimers.size}/${this.config.maxActiveTimers}`
      );
    }

    return t;
  }

  /**
   * Buat timer dan otomatis jalankan fungsi di dalamnya.
   * Durasi dicatat ke histogram secara otomatis.
   *
   * @param name - Nama timer/histogram
   * @param fn - Fungsi async yang akan dijalankan
   * @returns Hasil dari fungsi
   *
   * Contoh:
   * ```ts
   * const products = await perfMonitor.time('db.query.products', async () => {
   *   return await db.from('products').select('*');
   * });
   * ```
   */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const timer = this.timer(name);
    try {
      return await fn();
    } finally {
      timer.stop();
    }
  }

  /**
   * Catat durasi manual ke histogram (tanpa membuat Timer).
   *
   * @param name - Nama histogram
   * @param durationMs - Durasi dalam milidetik
   */
  recordTimer(name: string, durationMs: number): void {
    this.getOrCreateHistogram(name).record(durationMs);

    // Evaluasi alert
    this.alertManager.evaluate(name, durationMs);
  }

  /**
   * Dapatkan jumlah timer aktif.
   */
  getActiveTimerCount(): number {
    return this.activeTimers.size;
  }

  /**
   * Hapus timer dari set aktif (dipanggil oleh Timer.stop()).
   */
  removeActiveTimer(timer: Timer): void {
    this.activeTimers.delete(timer);
  }

  // =================================================================
  // HISTOGRAM
  // =================================================================

  /**
   * Catat nilai ke histogram.
   *
   * @param name - Nama histogram
   * @param value - Nilai yang akan dicatat
   *
   * Contoh:
   * ```ts
   * perfMonitor.histogram('response.size', responseBody.length);
   * ```
   */
  histogram(name: string, value: number): void {
    this.getOrCreateHistogram(name).record(value);
    this.alertManager.evaluate(name, value);
  }

  /**
   * Ambil snapshot histogram.
   */
  getHistogram(name: string): HistogramSnapshot | null {
    const h = this.histograms.get(name);
    return h ? h.snapshot() : null;
  }

  /**
   * Daftar nama semua histogram yang terdaftar.
   */
  getHistogramNames(): string[] {
    return Array.from(this.histograms.keys());
  }

  // =================================================================
  // GAUGE
  // =================================================================

  /**
   * Set nilai gauge.
   *
   * @param name - Nama gauge
   * @param value - Nilai baru
   *
   * Contoh:
   * ```ts
   * perfMonitor.setGauge('ws.connections', socketCount);
   * ```
   */
  setGauge(name: string, value: number): void {
    this.getOrCreateGauge(name).set(value);
    this.alertManager.evaluate(name, value);
  }

  /**
   * Tambah nilai gauge.
   *
   * @param name - Nama gauge
   * @param delta - Nilai penambahan (default: 1)
   */
  incrementGauge(name: string, delta: number = 1): void {
    this.getOrCreateGauge(name).increment(delta);
    const g = this.gauges.get(name)!;
    this.alertManager.evaluate(name, g.value);
  }

  /**
   * Kurangi nilai gauge.
   *
   * @param name - Nama gauge
   * @param delta - Nilai pengurangan (default: 1)
   */
  decrementGauge(name: string, delta: number = 1): void {
    this.getOrCreateGauge(name).decrement(delta);
    const g = this.gauges.get(name)!;
    this.alertManager.evaluate(name, g.value);
  }

  /**
   * Ambil snapshot gauge.
   */
  getGauge(name: string): GaugeSnapshot | null {
    const g = this.gauges.get(name);
    return g ? g.snapshot() : null;
  }

  /**
   * Daftar nama semua gauge yang terdaftar.
   */
  getGaugeNames(): string[] {
    return Array.from(this.gauges.keys());
  }

  // =================================================================
  // COUNTER
  // =================================================================

  /**
   * Tambah counter.
   *
   * @param name - Nama counter
   * @param delta - Nilai penambahan (default: 1)
   *
   * Contoh:
   * ```ts
   * perfMonitor.incrementCounter('api.requests');
   * perfMonitor.incrementCounter('api.errors'); // Default +1
   * perfMonitor.incrementCounter('transactions.total', 1);
   * ```
   */
  incrementCounter(name: string, delta: number = 1): void {
    this.getOrCreateCounter(name).increment(delta);
    const c = this.counters.get(name)!;
    this.alertManager.evaluate(name, c.value);
  }

  /**
   * Set nilai counter.
   *
   * @param name - Nama counter
   * @param value - Nilai baru
   */
  setCounter(name: string, value: number): void {
    this.getOrCreateCounter(name).set(value);
    this.alertManager.evaluate(name, value);
  }

  /**
   * Ambil snapshot counter.
   */
  getCounter(name: string): CounterSnapshot | null {
    const c = this.counters.get(name);
    return c ? c.snapshot() : null;
  }

  /**
   * Daftar nama semua counter yang terdaftar.
   */
  getCounterNames(): string[] {
    return Array.from(this.counters.keys());
  }

  // =================================================================
  // ALERTS
  // =================================================================

  /**
   * Daftarkan konfigurasi alert kustom.
   *
   * @param config - Konfigurasi alert
   *
   * Contoh:
   * ```ts
   * perfMonitor.registerAlert({
   *   metricName: 'db.query.products',
   *   type: 'threshold',
   *   operator: 'gt',
   *   threshold: 5000, // 5 detik
   *   cooldownMs: 60_000,
   *   onTrigger: (alert) => {
   *     console.error('DB query lambat!', alert);
   *   },
   * });
   * ```
   */
  registerAlert(config: AlertConfig): void {
    this.alertManager.register(config);
  }

  /**
   * Ambil semua alert yang aktif.
   */
  getActiveAlerts(): AlertEvent[] {
    return this.alertManager?.getActiveAlerts?.() || [];
  }

  /**
   * Bersihkan semua alert aktif.
   */
  clearAlerts(): void {
    this.alertManager.clearAlerts();
  }

  // =================================================================
  // METRICS EXPORT
  // =================================================================

  /**
   * Ekspor semua metrik dalam format terstruktur.
   * Cocok untuk endpoint kesehatan (/api/health).
   *
   * @returns PerformanceMetrics dengan semua snapshot
   */
  getMetrics(): PerformanceMetrics {
    // Histograms
    const histograms: Record<string, HistogramSnapshot | null> = {};
    for (const [name, h] of this.histograms) {
      histograms[name] = h.snapshot();
    }

    // Gauges
    const gauges: Record<string, GaugeSnapshot | null> = {};
    for (const [name, g] of this.gauges) {
      gauges[name] = g.snapshot();
    }

    // Counters
    const counters: Record<string, CounterSnapshot | null> = {};
    for (const [name, c] of this.counters) {
      counters[name] = c.snapshot();
    }

    // Alerts — defensive: alertManager may be undefined during partial init
    const activeAlerts = this.alertManager?.getActiveAlerts?.() || [];

    // Summary
    const summary = this.computeSummary();

    return {
      timestamp: Date.now(),
      uptimeMs: Date.now() - this.startTime,
      histograms,
      gauges,
      counters,
      activeAlerts,
      summary,
    };
  }

  /**
   * Ekspor metrik dalam format teks (untuk logging).
   */
  getMetricsText(): string {
    const metrics = this.getMetrics();
    const lines: string[] = [];

    lines.push('=== Performance Metrics ===');
    lines.push(`Uptime: ${Math.round(metrics.uptimeMs / 1000)}s`);
    lines.push(`Health: ${metrics.summary.healthy ? '✓ OK' : '✗ DEGRADED'}`);
    lines.push(`Active Alerts: ${metrics.activeAlerts.length}`);
    lines.push('');

    // Counters
    if (Object.keys(metrics.counters).length > 0) {
      lines.push('--- Counters ---');
      for (const [name, snapshot] of Object.entries(metrics.counters)) {
        if (snapshot) {
          lines.push(
            `  ${name}: ${snapshot.value} (${snapshot.ratePerSec}/s)`
          );
        }
      }
      lines.push('');
    }

    // Gauges
    if (Object.keys(metrics.gauges).length > 0) {
      lines.push('--- Gauges ---');
      for (const [name, snapshot] of Object.entries(metrics.gauges)) {
        if (snapshot) {
          lines.push(
            `  ${name}: ${snapshot.value} (min=${snapshot.min}, max=${snapshot.max})`
          );
        }
      }
      lines.push('');
    }

    // Histograms (ringkas)
    if (Object.keys(metrics.histograms).length > 0) {
      lines.push('--- Histograms (last) ---');
      for (const [name, snapshot] of Object.entries(metrics.histograms)) {
        if (snapshot && snapshot.count > 0) {
          lines.push(
            `  ${name}: n=${snapshot.count}, ` +
            `avg=${snapshot.mean}ms, p50=${snapshot.p50}ms, p95=${snapshot.p95}ms, p99=${snapshot.p99}ms`
          );
        }
      }
      lines.push('');
    }

    // Active alerts
    if (metrics.activeAlerts.length > 0) {
      lines.push('--- Active Alerts ---');
      for (const alert of metrics.activeAlerts.slice(-10)) {
        lines.push(
          `  [${alert.severity.toUpperCase()}] ${alert.message}`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Set mode verbose untuk logging.
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Reset semua metrik ke keadaan awal.
   */
  reset(): void {
    for (const h of this.histograms.values()) h.reset();
    for (const g of this.gauges.values()) g.reset();
    for (const c of this.counters.values()) c.reset();
    this.alertManager.clearAlerts();
  }

  /**
   * Hentikan semua timer dan bersihkan.
   */
  dispose(): void {
    if (this.leakDetectionTimer) {
      clearInterval(this.leakDetectionTimer);
      this.leakDetectionTimer = null;
    }
    this.activeTimers.clear();
  }

  // =================================================================
  // INTERNAL
  // =================================================================

  private getOrCreateHistogram(name: string): Histogram {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, this.config.maxHistogramSamples);
      this.histograms.set(name, h);
    }
    return h;
  }

  private getOrCreateGauge(name: string): Gauge {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name);
      this.gauges.set(name, g);
    }
    return g;
  }

  private getOrCreateCounter(name: string): Counter {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name);
      this.counters.set(name, c);
    }
    return c;
  }

  /**
   * Mulai deteksi timer yang bocor (tidak pernah stop()).
   */
  private startLeakDetection(): void {
    this.leakDetectionTimer = setInterval(() => {
      const now = Date.now();
      const leaked: Timer[] = [];

      for (const timer of this.activeTimers) {
        if (timer.isStopped()) {
          // Timer sudah berhenti tapi belum dihapus (shouldn't happen)
          leaked.push(timer);
          continue;
        }

        const elapsed = timer.elapsed();
        if (elapsed > timer.getTimeoutMs()) {
          leaked.push(timer);
          console.warn(
            `[PerformanceMonitor] ⚠ Timer bocor terdeteksi: "${timer.getName()}" ` +
            `telah berjalan ${elapsed}ms (batas: ${timer.getTimeoutMs()}ms)`
          );
        }
      }

      // Bersihkan timer yang bocor
      for (const timer of leaked) {
        this.activeTimers.delete(timer);
      }
    }, this.config.leakDetectionIntervalMs);

    if (this.leakDetectionTimer.unref) this.leakDetectionTimer.unref();
  }

  /**
   * Daftarkan alert default untuk metrik kritis.
   */
  private registerDefaultAlerts(): void {
    // DB query lambat
    this.alertManager.register({
      metricName: 'db.query',
      type: 'threshold',
      operator: 'gt',
      threshold: 5000,
      cooldownMs: 30_000,
      onTrigger: () => {},
    });

    // API response lambat
    this.alertManager.register({
      metricName: 'api.response',
      type: 'threshold',
      operator: 'gt',
      threshold: 10000,
      cooldownMs: 30_000,
      onTrigger: () => {},
    });

    // Error rate tinggi
    this.alertManager.register({
      metricName: 'api.errors',
      type: 'spike',
      operator: 'gt',
      threshold: 10,
      spikePercent: 0.5,
      cooldownMs: 60_000,
      onTrigger: () => {},
    });
  }

  /**
   * Hitung ringkasan kinerja.
   */
  private computeSummary(): PerformanceSummary {
    const apiResponse = this.histograms.get('api.response')?.snapshot();
    const dbQuery = this.histograms.get('db.query')?.snapshot();

    const requestCounter = this.counters.get('api.requests');
    const errorCounter = this.counters.get('api.errors');

    const requestsPerSec = requestCounter?.snapshot().ratePerSec ?? 0;
    const errorRate =
      requestCounter && errorCounter
        ? errorCounter.value /
          Math.max(requestCounter.value, 1)
        : 0;

    // Tentukan kesehatan
    let healthy = true;
    const issues: string[] = [];

    if (apiResponse && apiResponse.p95 > 10000) {
      healthy = false;
      issues.push('API p95 > 10s');
    }

    if (dbQuery && dbQuery.p95 > 5000) {
      healthy = false;
      issues.push('DB query p95 > 5s');
    }

    if (errorRate > 0.05) {
      healthy = false;
      issues.push(`Error rate ${(errorRate * 100).toFixed(1)}%`);
    }

    if (this.activeTimers.size > this.config.maxActiveTimers) {
      healthy = false;
      issues.push('Potensi timer leak');
    }

    const activeAlertCount = this.alertManager?.getActiveAlerts?.()?.length ?? 0;
    if (activeAlertCount > 5) {
      healthy = false;
      issues.push(`${activeAlertCount} alert aktif`);
    }

    return {
      healthy,
      issues: issues.length,
      message:
        healthy
          ? 'Semua metrik dalam batas normal'
          : `Masalah: ${issues.join(', ')}`,
      avgApiResponseMs: apiResponse?.mean ?? 0,
      avgDbQueryMs: dbQuery?.mean ?? 0,
      requestsPerSec,
      errorRate,
    };
  }
}

// =====================================================================
// SINGLETON EXPORT
// =====================================================================

/**
 * Instance singleton PerformanceMonitor.
 * Gunakan ini di semua API route untuk pencatatan metrik kinerja.
 *
 * Contoh:
 * ```ts
 * import { perfMonitor } from '@/lib/performance-monitor';
 *
 * // Di API route handler
 * export async function GET(request: Request) {
 *   perfMonitor.incrementCounter('api.requests');
 *   const timer = perfMonitor.timer('api.handler.products');
 *
 *   try {
 *     const dbTimer = perfMonitor.timer('db.query.products');
 *     const { data } = await db.from('products').select('*');
 *     dbTimer.stop();
 *
 *     perfMonitor.setGauge('products.loaded', data?.length ?? 0);
 *
 *     return NextResponse.json({ products: data });
 *   } catch (error) {
 *     perfMonitor.incrementCounter('api.errors');
 *     throw error;
 *   } finally {
 *     timer.stop();
 *   }
 * }
 * ```
 */
export const perfMonitor = PerformanceMonitor.getInstance();

// =====================================================================
// CONVENIENCE: Middleware helper
// =====================================================================

/**
 * Wrapper untuk API route handler yang mencatat metrik secara otomatis.
 *
 * Metrik yang dicatat:
 * - api.requests (counter)
 * - api.errors (counter, jika gagal)
 * - api.response (histogram, waktu respons total)
 *
 * Contoh:
 * ```ts
 * const handler = withPerformanceTracking('products', async (req: Request) => {
 *   return NextResponse.json({ ok: true });
 * });
 * export { handler as GET };
 * ```
 */
export function withPerformanceTracking<T extends (...args: any[]) => Promise<Response>>(
  routeName: string,
  handler: T
): T {
  return (async (...args: Parameters<T>): Promise<Response> => {
    const timerName = `api.response.${routeName}`;
    const timer = perfMonitor.timer(timerName);

    perfMonitor.incrementCounter('api.requests');

    try {
      const response = await handler(...args);

      // Catat status code gauge
      perfMonitor.incrementGauge(`api.status.${response.status}`);

      return response;
    } catch (error) {
      perfMonitor.incrementCounter('api.errors');
      perfMonitor.incrementGauge('api.status.500');
      throw error;
    } finally {
      timer.stop();
    }
  }) as T;
}

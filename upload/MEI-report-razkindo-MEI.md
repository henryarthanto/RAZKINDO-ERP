# 🔍 Bug Report & Improvement Plan — Razkindo ERP
> Arsip: `arsipapril29jam22_56.tar` · Stack: Next.js 16 + Supabase + Prisma + BullMQ + TypeScript

---

## 📊 Ringkasan Eksekutif

| Kategori | Jumlah | Tingkat Keparahan |
|---|---|---|
| Git Merge Conflict Aktif | **8 file, 17 blok** | 🔴 KRITIS — Build gagal total |
| Konfigurasi Rusak | 4 file | 🔴 KRITIS |
| Bug Logika / Keamanan | 7 item | 🟠 TINGGI |
| Code Quality / Hygiene | 6 item | 🟡 SEDANG |
| Improvement Arsitektur | 5 item | 🟢 RENDAH |

---

## 🔴 KATEGORI 1 — GIT MERGE CONFLICT AKTIF (Build Breaker)

> **Dampak:** Project **tidak bisa di-build sama sekali** selama konflik ini ada. Semua file di bawah mengandung marker `<<<<<<< HEAD`, `=======`, dan `>>>>>>> d56c15e` yang harus diselesaikan secara manual.

---

### BUG-01 · `package.json` — 7 Blok Konflik, Dependencies Hilang

**File:** `package.json`  
**Keparahan:** 🔴 KRITIS

**Deskripsi:**
`package.json` memiliki 7 blok konflik yang menyebabkan file JSON tidak valid. Akibatnya `bun install` atau `npm install` langsung gagal.

**Konflik yang ditemukan:**

**Blok 1 — Script `dev`:**
```json
// HEAD (benar — gunakan ini)
"dev": "next dev -p 3000 --turbopack",
// vs branch lama
"dev": "next dev -p 3000 2>&1 | tee dev.log",
```

**Blok 2 — Scripts test:**
```json
// HEAD (benar — gunakan ini, ada vitest)
"db:reset": "prisma migrate reset",
"test": "vitest run",
"test:watch": "vitest"
// vs branch lama (tanpa test)
"db:reset": "prisma migrate reset"
```

**Blok 3–5 — Dependencies hilang di branch lama:**
Branch lama kehilangan paket-paket kritis berikut:
- `@sentry/nextjs` — error tracking
- `@supabase/supabase-js` — **database client utama**
- `@types/bcryptjs`, `bcryptjs` — auth password hashing
- `bullmq` — background job queue
- `ioredis` — Redis client
- `jsdom`, `jspdf`, `jspdf-autotable` — PDF generation
- `pg` — PostgreSQL client langsung
- `pino`, `pino-pretty` — structured logging
- `socket.io`, `socket.io-client` — WebSocket
- `vitest`, `@vitejs/plugin-react` — test runner
- `xlsx` — Excel export

**Blok 6 — `react-day-picker` versi beda:**
```json
// HEAD
"react-day-picker": "^9.14.0",
// branch lama
"react-day-picker": "^9.8.0",
```

**Blok 7 — `z-ai-web-dev-sdk` tidak relevan:**
Branch lama memiliki `"z-ai-web-dev-sdk": "^0.0.17"` yang merupakan dependency dari scaffold Z.ai, **bukan** bagian dari ERP ini.

**Solusi:**
```json
// Gunakan versi HEAD secara penuh. Pastikan semua blok konflik dihapus.
// Tambahkan kembali semua dependency HEAD yang hilang.
// Hapus "z-ai-web-dev-sdk" dari branch lama.
```

---

### BUG-02 · `next.config.ts` — 2 Blok Konflik, Konfigurasi Produksi Hilang

**File:** `next.config.ts`  
**Keparahan:** 🔴 KRITIS

**Deskripsi:**
Branch lama hanya memiliki config barebone (`output: standalone`), sementara HEAD memiliki:
- STB mode support (`STB_MODE` env var)
- `serverExternalPackages` — penting agar `pg`, `prisma`, `bcryptjs`, dll. tidak di-bundle webpack
- HTTP security headers (XSS protection, nosniff, referrer policy)
- Favicon rewrite ke `/api/pwa/icon`
- Conditional Sentry integration
- `allowedDevOrigins` untuk development

**Risiko jika branch lama digunakan:**
- Prisma/pg bisa gagal di production karena di-bundle webpack
- Tidak ada security headers
- Favicon rusak

**Solusi:** Gunakan HEAD secara penuh untuk `next.config.ts`. Hapus seluruh blok `=======` ke bawah.

---

### BUG-03 · `src/app/layout.tsx` — 3 Blok Konflik, Toaster & Metadata Salah

**File:** `src/app/layout.tsx`  
**Keparahan:** 🔴 KRITIS

**Konflik:**

**Blok 1 — Import Toaster:**
```tsx
// HEAD (benar)
import { Toaster } from 'sonner';
import { ErrorBoundary } from '@/components/error-boundary';
// vs branch lama (salah — menggunakan shadcn toaster lama)
import { Toaster } from '@/components/ui/toaster';
```
Seluruh notifikasi di aplikasi menggunakan `sonner`. Menggunakan `@/components/ui/toaster` akan menyebabkan semua toast tidak tampil.

**Blok 2 — Metadata:**
Branch lama masih berisi metadata scaffold Z.ai ("Z.ai Code Scaffold"), bukan ERP Razkindo. Ini akan muncul di tab browser, SEO, dan PWA.

**Blok 3 — Struktur HTML:**
HEAD membungkus `{children}` dengan `<ErrorBoundary>` untuk menangkap React errors. Branch lama tidak memiliki ini, sehingga unhandled error bisa crash seluruh app.

**Solusi:** Gunakan HEAD secara penuh.

---

### BUG-04 · `src/lib/db.ts` — 1 Blok Konflik, Import Database Salah

**File:** `src/lib/db.ts`  
**Keparahan:** 🔴 KRITIS

**Deskripsi:**
HEAD menggunakan re-export dari `./supabase` (wrapper Supabase-compatible), sementara branch lama langsung membuat `PrismaClient` baru dengan `log: ['query']`.

```ts
// HEAD (benar — re-export Supabase wrapper)
export { db, supabaseAdmin, prisma } from './supabase';

// branch lama (SALAH — direct Prisma, bypass semua Supabase logic)
export const db = new PrismaClient({ log: ['query'] })
```

Jika branch lama digunakan, semua `db.from(...)` call akan gagal karena `PrismaClient` tidak memiliki method `.from()`.

**Solusi:** Gunakan HEAD.

---

### BUG-05 · `src/app/page.tsx` — 1 Blok Konflik, Entire App Missing

**File:** `src/app/page.tsx`  
**Keparahan:** 🔴 KRITIS

Branch lama berisi scaffold kosong Z.ai. HEAD berisi seluruh aplikasi ERP (`MainApp`, `LoginPage`, semua modul). Gunakan HEAD.

---

### BUG-06 · `src/app/api/route.ts` — 1 Blok Konflik, Error Handling Hilang

**File:** `src/app/api/route.ts`  
**Keparahan:** 🟠 TINGGI

```ts
// HEAD (benar — ada try/catch)
export async function GET() {
  try {
    return NextResponse.json({ message: "Hello, world!" });
  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

// branch lama (tidak ada error handling)
export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}
```

---

### BUG-07 · `tsconfig.json` — 1 Blok Konflik, Folder Salah Dicompile

**File:** `tsconfig.json`  
**Keparahan:** 🟠 TINGGI

```json
// HEAD (benar — exclude folder non-app)
"exclude": ["node_modules", "skills", "upload", "mini-services", "seed-data.js"]

// branch lama (tidak exclude skills, dll)
"exclude": ["node_modules"]
```

Tanpa exclude yang benar, TypeScript akan mencoba mengcompile folder `skills/` (berisi 100+ file Python, SKILL.md) yang akan menyebabkan build error atau drastis memperlambat compilation.

---

### BUG-08 · `eslint.config.mjs` — 1 Blok Konflik, ESLint Tidak Konsisten

**File:** `eslint.config.mjs`  
**Keparahan:** 🟡 SEDANG

```js
// HEAD (benar)
ignores: ["node_modules/**", ".next/**", "...", "upload/**", "seed-data.js", "mini-services/**"]

// branch lama (kurang lengkap)
ignores: ["node_modules/**", ".next/**", "...", "skills"]
```

---

## 🟠 KATEGORI 2 — BUG LOGIKA & KEAMANAN

---

### BUG-09 · `src/lib/finance-engine.ts` — Silent Fallback pada Operasi Finansial Kritis

**File:** `src/lib/finance-engine.ts` (baris 298–340)  
**Keparahan:** 🟠 TINGGI

**Deskripsi:**
`doubleEntry()` memiliki fallback ke operasi sekuensial jika RPC `atomic_double_entry` gagal. Ini **berbahaya** karena:
1. Operasi sekuensial **tidak atomic** — jika step 2 gagal setelah step 1 sukses, ada ketidakseimbangan ledger
2. Compensating rollback bisa juga gagal, dengan log `CRITICAL: Compensating rollback failed — manual intervention required!` namun tidak ada alerting otomatis

```ts
// Baris 300
console.error('[FinanceEngine] atomic_double_entry RPC failed, using sequential fallback:', error?.message);
// Sequential fallback dieksekusi tanpa DB-level atomicity
```

**Solusi:**
```ts
// Opsi 1: Hapus fallback, biarkan error propagate ke caller
// Opsi 2: Jika fallback dipertahankan, tambahkan alerting ke Sentry/webhook
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.captureException(error, { extra: { context: 'doubleEntry_rpc_fallback' } });
}
```

---

### BUG-10 · `src/lib/supabase-client.ts` — Placeholder URL Digunakan Saat Env Missing

**File:** `src/lib/supabase-client.ts` (baris 29–34)  
**Keparahan:** 🟠 TINGGI

```ts
// Fallback ke placeholder
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  ...
);
```

Jika env vars tidak tersedia, client tetap dibuat dengan URL placeholder. Ini bisa menyebabkan panggilan API client-side gagal secara diam-diam tanpa error yang jelas. Lebih baik `throw` error eksplisit atau return `null` saat production.

**Solusi:**
```ts
if (!supabaseUrl || !supabaseAnonKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[Supabase Client] Missing required env vars in production');
  }
}
```

---

### BUG-11 · `src/lib/token.ts` — User Cache Tidak Thread-Safe di Multi-Worker

**File:** `src/lib/token.ts` (baris 15–17)  
**Keparahan:** 🟡 SEDANG

```ts
const _userCache = new Map<string, { active: boolean; expiresAt: number }>();
const USER_CACHE_TTL = 60_000; // 60 seconds
```

Cache ini adalah in-memory Map per-process. Di production dengan multiple worker threads atau multiple instances (scaling horizontal), cache tidak dishare antar worker. Akibatnya:
- User yang di-deactivate bisa tetap aktif selama 60 detik di worker lain
- Cache invalidation `invalidateUserAuthCache()` hanya berdampak pada 1 worker

**Solusi:** Gunakan Redis sebagai shared cache (infrastruktur Redis sudah ada via `ioredis`):
```ts
// Ganti Map dengan redis.get/set/del
```

---

### BUG-12 · `next.config.ts` — `ignoreBuildErrors: true` di TypeScript

**File:** `next.config.ts` (baris 16)  
**Keparahan:** 🟠 TINGGI

```ts
typescript: {
  ignoreBuildErrors: true,  // ← BERBAHAYA
},
```

Setting ini membuat build **tidak pernah gagal meski ada TypeScript error serius**. Ini oke untuk fase development cepat, tapi untuk production sebaiknya dihapus atau diset ke `false` agar type error tertangkap saat build.

**Solusi:** Hapus atau set ke `false` setelah semua type error diselesaikan.

---

### BUG-13 · `tsconfig.json` — `noImplicitAny: false` Bertentangan dengan `strict: true`

**File:** `tsconfig.json` (baris 11, 13)  
**Keparahan:** 🟡 SEDANG

```json
"strict": true,       // mengaktifkan noImplicitAny
"noImplicitAny": false // tapi langsung dioverride ke false
```

`strict: true` mencakup `noImplicitAny`, namun kemudian di-override ke `false`. Ini redundant dan bisa menyembunyikan bug tipe `any` yang tidak disengaja.

**Solusi:** Pilih salah satu:
```json
// Opsi A — Full strict
"strict": true
// (hapus baris noImplicitAny)

// Opsi B — Konsisten
"strict": false,
"noImplicitAny": false
```

---

### BUG-14 · `src/lib/db-transaction.ts` — Compensating Transaction Tidak Truly Atomic

**File:** `src/lib/db-transaction.ts`  
**Keparahan:** 🟡 SEDANG

Pola `runInTransaction()` menggunakan compensating rollback (saga pattern) bukan DB transaction sebenarnya. Jika rollback dari step N gagal, state database bisa inconsistent tanpa ada mekanisme recovery otomatis.

**Solusi:**
- Tambahkan logging ke tabel `audit_log` sebelum rollback
- Tambahkan dead-letter queue di BullMQ untuk failed rollbacks
- Pertimbangkan menggunakan PostgreSQL transaction langsung via `prisma.$transaction()`

---

### BUG-15 · `src/app/api/auth/login/route.ts` — Rate Limit In-Memory Tidak Persist

**File:** `src/app/api/auth/login/route.ts` (baris 19)  
**Keparahan:** 🟡 SEDANG

```ts
const _loginAttempts = new Map<string, RateLimitEntry>();
```

Rate limit tracker disimpan in-memory. Saat server restart, semua counter reset — brute force attack yang terjadi sebelum restart tidak terdeteksi. Di multi-instance deployment, setiap instance memiliki counter sendiri (attacker bisa bypass dengan rotasi IP ke instance berbeda).

**Solusi:** Pindahkan ke Redis:
```ts
// redis.incr(`login_attempts:${email}`)
// redis.expire(`login_attempts:${email}`, WINDOW_MS / 1000)
```

---

## 🟡 KATEGORI 3 — CODE QUALITY & HYGIENE

---

### BUG-16 · `console.error`/`console.warn` Digunakan Langsung (Bukan Logger Terpusat)

**File:** `src/lib/finance-engine.ts`, `src/lib/smart-hpp.ts`, `src/lib/api-wrapper.ts`, dan lainnya  
**Keparahan:** 🟡 SEDANG

Proyek sudah memiliki `src/lib/logger.ts` (pino-based) namun masih banyak file yang menggunakan `console.error`/`console.warn` langsung. Log dari `console.*` tidak terstruktur, tidak ada correlation ID, dan tidak bisa difilter di production log aggregator.

**Solusi:** Ganti semua `console.error` di `src/lib/` dengan `logError()` dari `./logger`:
```ts
import { logError, logWarn } from './logger';
// Ganti: console.error('[FinanceEngine] ...', data)
// Dengan: logError('[FinanceEngine] ...', { data })
```

---

### BUG-17 · `src/lib/supabase.ts` — PrismaClient Diinstansiasi Tanpa `DATABASE_URL`

**File:** `src/lib/supabase.ts` (baris 25)  
**Keparahan:** 🟡 SEDANG

```ts
export const prisma = globalForPrisma.prisma || new PrismaClient();
```

`PrismaClient` dibuat tanpa cek apakah `DATABASE_URL` tersedia. Jika env var ini tidak diset (misalnya di edge runtime atau build time), Prisma akan throw error yang tidak jelas.

**Solusi:**
```ts
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_POOLER_URL;
if (!dbUrl && process.env.NODE_ENV !== 'test') {
  throw new Error('DATABASE_URL or SUPABASE_POOLER_URL must be set');
}
```

---

### BUG-18 · `require-auth.ts` — Return Type `user: any`

**File:** `src/lib/require-auth.ts` (baris 32)  
**Keparahan:** 🟡 SEDANG

```ts
async function requireSuperAdminInternal(request: NextRequest): Promise<{
  userId: string;
  user: any;  // ← tidak type-safe
} | null>
```

Return type `user: any` menonaktifkan type checking untuk seluruh objek user setelah pemanggilan. Akses ke properti yang salah (misal `user.isAdmin` padahal seharusnya `user.role === 'super_admin'`) tidak akan terdeteksi.

**Solusi:** Definisikan interface:
```ts
interface AuthUser {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
  status: string;
}
```

---

### BUG-19 · `eslint.config.mjs` — Terlalu Banyak Rules Dimatikan

**File:** `eslint.config.mjs`  
**Keparahan:** 🟡 SEDANG

Rule-rule penting yang dimatikan:
```js
"@typescript-eslint/no-explicit-any": "off",   // ← membolehkan any
"react-hooks/exhaustive-deps": "off",            // ← bug umum di React
"no-unused-vars": "off",                         // ← variable tidak terpakai
"no-unreachable": "off",                         // ← dead code
"no-console": "off",                             // ← console di production
```

Ini menyebabbkan banyak potensi bug tidak terdeteksi oleh linter.

**Solusi (bertahap):**
```js
"@typescript-eslint/no-explicit-any": "warn",  // mulai dari warn dulu
"react-hooks/exhaustive-deps": "warn",
"no-unused-vars": "warn",
```

---

### BUG-20 · `.env` Terkandung dalam Arsip (Security Risk)

**File:** `.env`  
**Keparahan:** 🟠 TINGGI

File `.env` (bukan hanya `.env.example`) ikut terbundel dalam file `.tar` arsip ini. File ini berisi nilai aktual dari environment variables termasuk kemungkinan:
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `AUTH_SECRET`
- `REDIS_URL`

**Solusi segera:**
1. Pastikan `.env` ada di `.gitignore` (sudah ada)
2. Rotasi semua secret/key yang ada di file `.env` tersebut
3. Audit siapa yang menerima arsip ini

---

## 🟢 KATEGORI 4 — IMPROVEMENT ARSITEKTUR

---

### IMP-01 · Tambahkan Health Check yang Lebih Lengkap

**File:** `src/app/api/health/route.ts` sudah ada, tapi bisa diperluas  
**Prioritas:** 🟢 RENDAH

Tambahkan cek aktual:
```ts
// Cek koneksi DB
const dbOk = await db.from('users').select('count').limit(1);
// Cek Redis
const redisOk = await redis.ping();
// Return status per komponen
return NextResponse.json({ db: dbOk ? 'ok' : 'error', redis: redisOk ? 'ok' : 'error' });
```

---

### IMP-02 · Migrasi Rate Limiter ke Redis

Lihat BUG-15. Rate limiter in-memory tidak cocok untuk production multi-instance.

---

### IMP-03 · Migrasi User Cache ke Redis

Lihat BUG-11. User cache in-memory bermasalah di multi-worker deployment.

---

### IMP-04 · Aktifkan TypeScript Strict Mode Penuh

Setelah semua konflik diselesaikan:
1. Set `ignoreBuildErrors: false` di `next.config.ts`
2. Set `noImplicitAny: true` (hapus override)
3. Aktifkan `@typescript-eslint/no-explicit-any: warn`

---

### IMP-05 · Tambahkan Automated Testing untuk Finance Engine

`src/lib/finance-engine.ts` adalah komponen paling kritis namun **tidak ada unit test**. `vitest.config.ts` dan `src/lib/validators.test.ts` sudah ada — tinggal menambahkan:
```
src/lib/finance-engine.test.ts
src/lib/atomic-ops.test.ts
src/lib/db-transaction.test.ts
```

---

## 📋 Urutan Perbaikan (Priority Order)

### Fase 1 — Segera (Build Breaker) ⏱️ ~2 jam

```
1. Resolve konflik package.json          → gunakan HEAD penuh
2. Resolve konflik next.config.ts        → gunakan HEAD penuh
3. Resolve konflik src/app/layout.tsx    → gunakan HEAD penuh
4. Resolve konflik src/lib/db.ts         → gunakan HEAD penuh
5. Resolve konflik src/app/page.tsx      → gunakan HEAD penuh
6. Resolve konflik src/app/api/route.ts  → gunakan HEAD penuh
7. Resolve konflik tsconfig.json         → gunakan HEAD penuh
8. Resolve konflik eslint.config.mjs     → gunakan HEAD penuh
```

**Cara cepat resolve semua konflik (pilih HEAD):**
```bash
# Untuk setiap file yang konflik, accept HEAD:
git checkout --ours package.json
git checkout --ours next.config.ts
git checkout --ours src/app/layout.tsx
git checkout --ours src/lib/db.ts
git checkout --ours src/app/page.tsx
git checkout --ours src/app/api/route.ts
git checkout --ours tsconfig.json
git checkout --ours eslint.config.mjs

# Tambahkan ke index
git add package.json next.config.ts src/app/layout.tsx src/lib/db.ts src/app/page.tsx src/app/api/route.ts tsconfig.json eslint.config.mjs

# Install ulang dependencies
bun install

# Test build
bun run build
```

---

### Fase 2 — Keamanan ⏱️ ~4 jam

```
9.  Rotasi semua secret di .env (DATABASE_URL, AUTH_SECRET, SERVICE_ROLE_KEY)
10. Pindahkan rate limiter login ke Redis
11. Pindahkan user auth cache ke Redis
12. Tambahkan Sentry alerting untuk finance engine critical fallback
13. Set ignoreBuildErrors: false dan fix semua type error
```

---

### Fase 3 — Code Quality ⏱️ ~1 hari

```
14. Ganti console.error/warn dengan logError/logWarn dari logger.ts
15. Definisikan type yang proper untuk require-auth.ts user object
16. Aktifkan eslint rules secara bertahap (warn dulu, baru error)
17. Tambahkan DATABASE_URL check di supabase.ts
```

---

### Fase 4 — Improvement ⏱️ ~2 hari

```
18. Tambahkan unit tests untuk finance-engine.ts
19. Pertimbangkan prisma.$transaction() untuk doubleEntry
20. Extended health check endpoint
```

---

## 📁 Daftar File yang Harus Dimodifikasi

| File | Aksi | Prioritas |
|---|---|---|
| `package.json` | Resolve konflik → HEAD | 🔴 KRITIS |
| `next.config.ts` | Resolve konflik → HEAD | 🔴 KRITIS |
| `src/app/layout.tsx` | Resolve konflik → HEAD | 🔴 KRITIS |
| `src/lib/db.ts` | Resolve konflik → HEAD | 🔴 KRITIS |
| `src/app/page.tsx` | Resolve konflik → HEAD | 🔴 KRITIS |
| `src/app/api/route.ts` | Resolve konflik → HEAD | 🔴 KRITIS |
| `tsconfig.json` | Resolve konflik → HEAD | 🔴 KRITIS |
| `eslint.config.mjs` | Resolve konflik → HEAD | 🟠 TINGGI |
| `.env` | Rotasi semua secrets | 🟠 TINGGI |
| `next.config.ts` | Set `ignoreBuildErrors: false` | 🟠 TINGGI |
| `tsconfig.json` | Fix `noImplicitAny` override | 🟡 SEDANG |
| `src/lib/finance-engine.ts` | Tambah Sentry alert pada fallback | 🟠 TINGGI |
| `src/lib/supabase-client.ts` | Throw pada production jika env missing | 🟠 TINGGI |
| `src/lib/token.ts` | Migrasi cache ke Redis | 🟡 SEDANG |
| `src/app/api/auth/login/route.ts` | Migrasi rate limiter ke Redis | 🟡 SEDANG |
| `src/lib/require-auth.ts` | Tambah proper return type | 🟡 SEDANG |
| `src/lib/supabase.ts` | Cek DATABASE_URL sebelum PrismaClient | 🟡 SEDANG |
| `src/lib/*.ts` (banyak) | Ganti console.* dengan logger | 🟡 SEDANG |
| `eslint.config.mjs` | Aktifkan rules secara bertahap | 🟡 SEDANG |

---

*Laporan ini dibuat berdasarkan analisis statis arsip `arsipapril29jam22_56.tar` pada 3 Mei 2026.*

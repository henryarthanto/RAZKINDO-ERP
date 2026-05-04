# Panduan Instalasi Razkindo ERP di STB (Casa OS)

## Persyaratan

- **STB** dengan Casa OS terinstall (Raspberry Pi 4/5, Orange Pi, dll)
- **RAM** minimal 2GB (rekomendasi 4GB)
- **Storage** minimal 16GB SD Card
- **Koneksi internet** (database pakai Supabase cloud)

---

## Langkah 1: Siapkan File di STB

Login ke STB via SSH atau buka terminal di Casa OS:

```bash
# Buat folder project
mkdir -p ~/razkindo-erp
cd ~/razkindo-erp

# Download file yang dibutuhkan
curl -O https://raw.githubusercontent.com/henryarthanto/razkindo-erp/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/henryarthanto/razkindo-erp/main/.env.example
```

## Langkah 2: Konfigurasi Environment

```bash
# Copy template ke .env
cp .env.example .env

# Edit .env dengan nano
nano .env
```

**Isi yang wajib diubah:**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://dkknaeiynrbmxhrysnge.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<isi dari Supabase Dashboard>
SUPABASE_SERVICE_ROLE_KEY=<isi dari Supabase Dashboard>

# Database
DATABASE_URL=<isi dari Supabase Dashboard>
DIRECT_URL=<isi dari Supabase Dashboard>
SUPABASE_DB_URL=<isi dari Supabase Dashboard>
SUPABASE_POOLER_URL=<isi dari Supabase Dashboard>

# Auth - BUAT BARU (generate di terminal STB)
AUTH_SECRET=<jalankan: openssl rand -hex 32>

# Moota (opsional)
MOOTA_API_URL=https://app.moota.co/api/v2
MOOTA_PERSONAL_TOKEN=<isi token Moota>
```

> **Generate AUTH_SECRET:**
> ```bash
> openssl rand -hex 32
> ```
> Copy hasilnya ke AUTH_SECRET di .env

## Langkah 3: Install via Casa OS

### Opsi A: Lewat Web UI Casa OS

1. Buka **Casa OS** di browser (`http://IP-STB`)
2. Klik **App Store** > **Custom Install**
3. Pilih **docker-compose.yml** yang sudah didownload
4. Atau paste isi file `docker-compose.yml`
5. Klik **Install**

### Opsi B: Lewat Terminal SSH

```bash
cd ~/razkindo-erp

# Login ke GHCR
echo "ghp_TOKEN_ANDA" | docker login ghcr.io -u henryarthanto --password-stdin

# Pull & jalankan
docker compose pull
docker compose up -d

# Cek status
docker compose ps
docker compose logs -f
```

## Langkah 4: Verifikasi

Buka browser:
```
http://IP-STB:3000
```

Jika muncul halaman login Razkindo ERP = berhasil!

### Cek Health

```bash
curl http://localhost:3000/api/health
```

Harus return: `{"status":"ok"}`

---

## Perintah Umum

```bash
# Lihat log real-time
docker compose logs -f

# Restart
docker compose restart

# Update ke versi terbaru
docker compose pull
docker compose up -d

# Stop
docker compose down

# Stop + hapus data (HATI-HATI)
docker compose down -v
```

---

## Akses dari Jaringan Lokal

Setelah berhasil, akses dari komputer/laptop di jaringan yang sama:
```
http://IP-STB:3000
```

Untuk akses dari luar jaringan (internet), gunakan:
- **Cloudflare Tunnel** (gratis, direkomendasikan)
- **Port forwarding** di router
- **Tailscale** (VPN)

---

## Troubleshooting

### Container tidak mau start
```bash
docker compose logs
# Periksa error di .env (missing key, dll)
```

### Database connection error
- Pastikan Supabase project masih aktif
- Cek DATABASE_URL benar (password, host, port)
- Pastikan STB punya koneksi internet

### Out of memory
```bash
# Cek RAM usage
free -h

# Kurangi memory limit di docker-compose.yml
# Ubah limits.memory dari 1536M ke 1024M
```

### Image tidak ditemukan di GHCR
```bash
# Pastikan sudah login ke GHCR
echo "ghp_TOKEN" | docker login ghcr.io -u henryarthanto --password-stdin

# Cek image tersedia
docker pull ghcr.io/henryarthanto/razkindo-erp:latest
```

---

## Auto-Update (Opsional)

Tambahkan cron job untuk auto-update mingguan:

```bash
# Buka crontab
crontab -e

# Tambahkan baris ini (update setiap Minggu jam 3 pagi)
0 3 * * 0 cd ~/razkindo-erp && docker compose pull && docker compose up -d >> /var/log/erp-update.log 2>&1
```

---

## Arsitektur

```
STB (Casa OS)
└── Docker Container
    ├── Next.js App (port 3000)
    ├── Caddy (port 81)
    └── Prisma Client
         │
         ▼ (internet)
    Supabase Cloud (PostgreSQL)
```

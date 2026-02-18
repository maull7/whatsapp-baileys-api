# WhatsApp Baileys API

Backend WhatsApp memakai [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys). Fitur: kirim teks, gambar, dokumen, audio, video; QR bisa diakses via URL.

## Otorisasi: API Key per pelanggan (multi-tenant)

- Semua endpoint di bawah **`/api`** wajib **API Key**.
- Satu **API key** = satu pelanggan (tenant) = **satu koneksi WhatsApp** (satu QR, satu nomor).
- Key disimpan di **database PostgreSQL**. Tambah key baru: **`npm run add-key -- <tenant_id>`** (contoh: `npm run add-key -- pelanggan_a`).
- Request wajib header: **`X-API-Key: <key>`** atau **`Authorization: Bearer <key>`**.
- Contoh: `curl -H "X-API-Key: sk_xxx..." http://localhost:3000/api/status`
- Whitelist & kuota harian dipisah per tenant.

## Setup Database (PostgreSQL)

1. Buat database PostgreSQL: `CREATE DATABASE whatsapp_backend;`
2. Set environment variables (atau edit `config/index.js`):
   ```bash
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=whatsapp_backend
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```
3. Migrasi data dari file (jika ada):
   ```bash
   npm run migrate-keys-to-db       # Migrasi API keys
   npm run migrate-whitelist-to-db  # Migrasi whitelist
   npm run migrate-auth-to-db      # Migrasi auth_info folder -> database
   ```
4. Server akan auto-init table saat start.

## Struktur Database

- **api_keys**: API key per tenant (tenant_id unique)
- **whitelist**: Nomor whitelist per tenant
- **daily_limits**: Counter harian per tenant per nomor (reset tiap hari otomatis)

## Auth state (login WhatsApp) — disimpan di database

**Auth state** (kredensial + key session setelah scan QR) disimpan di **PostgreSQL**, bukan folder `auth_info`.

- **Tabel:** `auth_creds` (satu baris per tenant) dan `auth_keys` (banyak baris per tenant untuk pre-key, session, dll). Lihat `docs/DATABASE.md`.
- **Fungsi:** Setelah scan QR sekali, kredensial disimpan di DB. Saat server restart atau reconnect, **tidak perlu scan QR lagi**.
- **Backup:** Cukup backup database; tidak perlu backup folder `auth_info`.
- **Migrasi dari folder lama:** Kalau sebelumnya pakai `auth_info/`, jalankan `npm run migrate-auth-to-db` untuk pindahkan ke database (tanpa perlu scan QR ulang).

## Menjalankan

```bash
npm install
npm start
```

Server default: `http://localhost:3000`

## Cara user ambil QR untuk masuk WhatsApp

Satu pelanggan = satu API key = satu nomor WhatsApp. Untuk masuk (link device), pelanggan harus scan QR sekali.

### Langkah untuk pelanggan

1. **Dapat API key** dari admin (admin jalankan `npm run add-key -- nama_pelanggan`, lalu berikan key ke pelanggan).
2. **Buka halaman QR di browser** (ganti `API_KEY` dan host/domain jika bukan localhost):
   ```
   https://domain-kamu.com/api/qr/page?api_key=API_KEY
   ```
   Contoh:
   ```
   https://api.example.com/api/qr/page?api_key=sk_abc123...
   ```
   Atau lokal: `http://localhost:3000/api/qr/page?api_key=sk_abc123...`
3. **Scan QR** dengan HP: buka WhatsApp → Pengaturan → Linked devices → Link a device → scan QR yang muncul di halaman.
4. **Selesai.** Setelah berhasil, halaman bisa ditutup. Koneksi tersimpan di database; next time tidak perlu scan lagi (kecuali logout atau ganti HP).

### Opsi lain (tanpa halaman HTML)

- **Cek status dulu:** `GET /api/status` dengan header `X-API-Key: API_KEY`. Respons berisi `qrImageUrl` (untuk ambil gambar QR) dan `connected` (true/false).
- **Ambil gambar QR saja:** `GET /api/qr/image` dengan header `X-API-Key: API_KEY` atau `?api_key=API_KEY`. Mengembalikan gambar PNG; bisa ditampilkan di aplikasi sendiri.

### Ringkas

| Yang dibutuhkan pelanggan | Keterangan |
|---------------------------|------------|
| API key | Dari admin (satu key per nomor WA) |
| URL halaman QR | `BASE_URL/api/qr/page?api_key=API_KEY` |
| WhatsApp di HP | Untuk scan QR (Linked devices) |

## QR & Status (teknis)

- **GET** `/api/status` — Cek koneksi; respons berisi `qrImageUrl` dan `connected`.
- **GET** `/api/qr/page?api_key=...` — Halaman HTML + QR yang auto-refresh.
- **GET** `/api/qr/image` — Gambar QR (PNG); wajib bawa API key (header atau query).
- Setelah `connected: true`, semua endpoint kirim pesan bisa dipakai.

## Dokumentasi API (Postman)

- **Import:** Postman → Import → File → pilih `docs/openapi.yaml`.
- Semua endpoint didokumentasikan di OpenAPI 3.0.

## Environment (opsional)

| Variabel   | Default           | Keterangan                    |
|-----------|-------------------|--------------------------------|
| `PORT`    | 3000              | Port server                    |
| `AUTH_PATH` | auth_info       | Folder penyimpanan login WhatsApp |
| `BASE_URL` | http://localhost:3000 | URL dasar (untuk qrUrl) |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | whatsapp_backend | Nama database |
| `DB_USER` | postgres | User database |
| `DB_PASSWORD` | postgres | Password database |

## Endpoint Ringkas

| Method | Endpoint            | Keterangan                    |
|--------|---------------------|-------------------------------|
| GET    | /api/status         | Status + URL QR               |
| GET    | /api/qr             | Data QR (JSON)                |
| GET    | /api/qr/image       | Gambar QR (PNG)               |
| GET    | /api/qr/page        | Halaman QR + auto-refresh     |
| GET    | /api/contacts       | Kontak tersimpan di HP        |
| GET    | /api/chats          | Daftar chat                   |
| GET    | /api/groups         | Daftar grup                   |
| GET    | /api/whitelist      | Daftar nomor whitelist        |
| POST   | /api/whitelist      | Tambah nomor (body: number)   |
| DELETE | /api/whitelist      | Hapus nomor (body/query: number) |
| GET    | /api/quota/:number  | Kuota harian ke nomor         |
| POST   | /api/logout         | Logout                        |
| POST   | /api/reconnect      | Reconnect                     |
| POST   | /api/send-message   | Teks (body: number, message)  |
| POST   | /api/send-image     | Gambar — form-data            |
| POST   | /api/send-document  | Dokumen — form-data           |
| POST   | /api/send-audio     | Audio — form-data             |
| POST   | /api/send-video     | Video — form-data             |

## Batas & Delay (anti-block)

- **Nomor di kontak HP (GET /api/contacts)**: kirim langsung, max **5** chat/hari ke nomor yang sama.
- **Nomor tidak di kontak HP**: delay **2 detik** lalu kirim, max **3** chat/hari.
- Tidak lagi pakai whitelist file; sistem cek otomatis dari kontak tersimpan di HP.
- Cek kuota: `GET /api/quota/:number` (lihat `isInContacts: true/false` dan `remaining`).
- Panduan: [docs/ANTI_BLOCK.md](docs/ANTI_BLOCK.md).

## Scalable & Production Ready

- **Database:** API keys di PostgreSQL, bisa scale horizontal.
- **Multi-tenant:** Satu instance bisa handle banyak pelanggan (tiap pelanggan = satu key = satu WhatsApp).
- **Kontak & Groups:** Endpoint `/api/contacts` ambil kontak tersimpan di HP, `/api/groups` ambil daftar grup.
- **Error handling:** Semua endpoint ada try-catch, error dicatat di console.
- **Connection recovery:** Auto-reconnect saat disconnect (kecuali logout).

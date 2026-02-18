# Database Schema

**Catatan:** Data **login WhatsApp** (session setelah scan QR) **disimpan di database** (tabel `auth_creds` dan `auth_keys`). Folder `auth_info/` tidak dipakai lagi.

## Tables

### 1. api_keys
API keys untuk multi-tenant authentication.

```sql
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  api_key VARCHAR(255) UNIQUE NOT NULL,
  tenant_id VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_api_keys_key ON api_keys(api_key);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
```

**Relasi**: Satu tenant = satu API key = satu koneksi WhatsApp.

### 2. whitelist
Nomor whitelist per tenant (opsional, untuk override limit/delay).

```sql
CREATE TABLE whitelist (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, phone_number)
);

CREATE INDEX idx_whitelist_tenant ON whitelist(tenant_id);
CREATE INDEX idx_whitelist_phone ON whitelist(tenant_id, phone_number);
```

**Relasi**: Satu tenant bisa punya banyak nomor di whitelist.

### 3. daily_limits
Counter harian per tenant per nomor tujuan.

```sql
CREATE TABLE daily_limits (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, phone_number, date)
);

CREATE INDEX idx_daily_limits_lookup ON daily_limits(tenant_id, phone_number, date);
```

**Relasi**: Satu tenant + satu nomor + satu hari = satu record counter.

**Auto-reset**: Counter otomatis reset tiap hari (date berbeda = record baru).

### 4. auth_creds
Kredensial WhatsApp per tenant (gantikan folder `auth_info/`).

```sql
CREATE TABLE auth_creds (
  tenant_id VARCHAR(100) PRIMARY KEY,
  data TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Relasi**: Satu tenant = satu baris. Kolom `data` = JSON string (creds) dengan Buffer di-serialize pakai BufferJSON.

### 5. auth_keys
Key-key signal (pre-key, session, app-state-sync-key, dll) per tenant.

```sql
CREATE TABLE auth_keys (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(100) NOT NULL,
  key VARCHAR(255) NOT NULL,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, key)
);

CREATE INDEX idx_auth_keys_tenant ON auth_keys(tenant_id);
```

**Relasi**: Satu tenant punya banyak key. Kolom `key` = mis. `pre-key-1`, `session-628xxx@s.whatsapp.net`, `value` = JSON string.

## Migration Scripts

### Migrasi dari file JSON ke database

```bash
# Migrasi API keys dari data/api_keys.json
npm run migrate-keys-to-db

# Migrasi whitelist dari data/whitelist_*.json
npm run migrate-whitelist-to-db
```

## Query Examples

### Cek API key
```sql
SELECT tenant_id FROM api_keys WHERE api_key = 'sk_xxx...';
```

### Whitelist per tenant
```sql
SELECT phone_number FROM whitelist WHERE tenant_id = 'pelanggan_a';
```

### Daily limit hari ini
```sql
SELECT count FROM daily_limits 
WHERE tenant_id = 'pelanggan_a' 
  AND phone_number = '628123456789' 
  AND date = CURRENT_DATE;
```

### Cleanup old daily_limits (opsional, jalankan via cron)
```sql
DELETE FROM daily_limits WHERE date < CURRENT_DATE - INTERVAL '7 days';
```

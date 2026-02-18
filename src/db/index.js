require('dotenv').config();
const mysql = require("mysql2/promise");

/**
 * Wrapper DB utama sekarang menggunakan MySQL, tapi tetap mempertahankan API
 * yang sama dengan implementasi Postgres sebelumnya:
 *  - query(text, params) -> { rows, rowCount }
 *  - initDb() -> membuat tabel-tabel utama jika belum ada
 *
 * Catatan: query-query lama masih menggunakan placeholder gaya Postgres ($1, $2, ...)
 * sehingga di sini kita konversi ke '?' sebelum dikirim ke mysql2.
 */

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DB || "whatsapp_baileys_blast",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

function mapPlaceholders(text) {
  // Ganti $1, $2, ... menjadi ? agar kompatibel dengan mysql2
  return String(text || "").replace(/\$\d+/g, "?");
}

async function query(text, params) {
  const start = Date.now();
  const sql = mapPlaceholders(text);
  try {
    const [rows] = await pool.query(sql, params || []);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn("Slow query (MySQL):", { sql, duration, rows: rows.length });
    }
    // Samakan bentuk dengan hasil pg: rows + rowCount
    return { rows, rowCount: rows.length };
  } catch (error) {
    console.error("Database query error (MySQL):", { sql, error: error.message });
    throw error;
  }
}

async function getClient() {
  // Untuk kompatibilitas, kita expose pool langsung.
  return pool;
}

async function initDb() {
  try {
    // Tabel api_keys: tenant_id unik, satu key per tenant
    await query(
      `
      CREATE TABLE IF NOT EXISTS api_keys (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        api_key VARCHAR(255) NOT NULL UNIQUE,
        tenant_id VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `
    );

    // Tabel whitelist: nomor whitelist per tenant
    await query(
      `
      CREATE TABLE IF NOT EXISTS whitelist (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_whitelist (tenant_id, phone_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `
    );

    // Tabel daily_limits: counter harian per tenant per nomor
    await query(
      `
      CREATE TABLE IF NOT EXISTS daily_limits (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        date DATE NOT NULL,
        count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_daily_limits (tenant_id, phone_number, date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `
    );

    // Tabel auth_creds: kredensial WhatsApp per tenant (gantikan auth_info folder)
    await query(
      `
      CREATE TABLE IF NOT EXISTS auth_creds (
        tenant_id VARCHAR(100) PRIMARY KEY,
        data TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `
    );

    // Tabel auth_keys: key-key signal (pre-key, session, dll) per tenant
    await query(
      `
      CREATE TABLE IF NOT EXISTS auth_keys (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(100) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_auth_keys (tenant_id, \`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `
    );

    // Index tambahan mirip Postgres, abaikan error jika sudah ada
    const indexStatements = [
      "CREATE INDEX idx_auth_keys_tenant ON auth_keys(tenant_id)",
      "CREATE INDEX idx_api_keys_key ON api_keys(api_key)",
      "CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id)",
      "CREATE INDEX idx_whitelist_tenant ON whitelist(tenant_id)",
      "CREATE INDEX idx_whitelist_phone ON whitelist(tenant_id, phone_number)",
      "CREATE INDEX idx_daily_limits_lookup ON daily_limits(tenant_id, phone_number, date)",
    ];
    for (const sql of indexStatements) {
      try {
        await pool.query(sql);
      } catch (err) {
        // 1061 = ER_DUP_KEYNAME (index sudah ada) -> aman diabaikan
        if (err && err.errno !== 1061) {
          console.error("Gagal buat index MySQL:", sql, "-", err.message);
        }
      }
    }

    console.log("MySQL core tables initialized");
  } catch (error) {
    console.error("Database init error (MySQL):", error.message);
    throw error;
  }
}

module.exports = {
  query,
  getClient,
  initDb,
  pool,
};

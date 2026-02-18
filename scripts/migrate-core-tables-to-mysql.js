/**
 * Migrasi tabel utama dari Postgres ke MySQL:
 *  - api_keys
 *  - whitelist
 *  - daily_limits
 *  - auth_creds
 *  - auth_keys
 *
 * Usage:
 *   node scripts/migrate-core-tables-to-mysql.js
 *   npm run migrate-core-to-mysql
 *
 * Koneksi:
 *   - Postgres: pakai src/db (env DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
 *   - MySQL:    pakai src/db/mysql (env MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASSWORD)
 */

const pgDb = require("../src/db");
const { pool: mysqlPool } = require("../src/db/mysql");

async function ensureMysqlCoreTables() {
  // api_keys
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      api_key VARCHAR(255) NOT NULL UNIQUE,
      tenant_id VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // whitelist
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS whitelist (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      phone_number VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_whitelist (tenant_id, phone_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // daily_limits
  await mysqlPool.query(`
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
  `);

  // auth_creds
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS auth_creds (
      tenant_id VARCHAR(100) PRIMARY KEY,
      data TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // auth_keys
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS auth_keys (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      \`key\` VARCHAR(255) NOT NULL,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_auth_keys (tenant_id, \`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // Index tambahan (mirip Postgres)
  // Catatan: MySQL versi lama tidak mendukung "IF NOT EXISTS" pada CREATE INDEX,
  // jadi kita bungkus dalam try/catch dan abaikan error duplicate index.
  const indexStatements = [
    "CREATE INDEX idx_api_keys_key ON api_keys(api_key)",
    "CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id)",
    "CREATE INDEX idx_whitelist_tenant ON whitelist(tenant_id)",
    "CREATE INDEX idx_whitelist_phone ON whitelist(tenant_id, phone_number)",
    "CREATE INDEX idx_daily_limits_lookup ON daily_limits(tenant_id, phone_number, date)",
  ];

  for (const sql of indexStatements) {
    try {
      await mysqlPool.query(sql);
    } catch (err) {
      // 1061 = ER_DUP_KEYNAME (index sudah ada) -> aman untuk diabaikan
      if (err && err.errno !== 1061) {
        console.error("Gagal buat index MySQL:", sql, "-", err.message);
      }
    }
  }
}

async function migrateApiKeys() {
  console.log("Migrasi api_keys...");
  const res = await pgDb.query("SELECT api_key, tenant_id, created_at, updated_at FROM api_keys");
  for (const row of res.rows) {
    await mysqlPool.query(
      `
      INSERT INTO api_keys (api_key, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        tenant_id = VALUES(tenant_id),
        created_at = VALUES(created_at),
        updated_at = VALUES(updated_at)
      `,
      [row.api_key, row.tenant_id, row.created_at || null, row.updated_at || null]
    );
  }
  console.log(`  Selesai api_keys: ${res.rows.length} row.`);
}

async function migrateWhitelist() {
  console.log("Migrasi whitelist...");
  const res = await pgDb.query("SELECT tenant_id, phone_number, created_at FROM whitelist");
  for (const row of res.rows) {
    await mysqlPool.query(
      `
      INSERT INTO whitelist (tenant_id, phone_number, created_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        created_at = LEAST(VALUES(created_at), created_at)
      `,
      [row.tenant_id, row.phone_number, row.created_at || null]
    );
  }
  console.log(`  Selesai whitelist: ${res.rows.length} row.`);
}

async function migrateDailyLimits() {
  console.log("Migrasi daily_limits...");
  const res = await pgDb.query("SELECT tenant_id, phone_number, date, count, created_at, updated_at FROM daily_limits");
  for (const row of res.rows) {
    await mysqlPool.query(
      `
      INSERT INTO daily_limits (tenant_id, phone_number, date, count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        count = VALUES(count),
        updated_at = VALUES(updated_at)
      `,
      [
        row.tenant_id,
        row.phone_number,
        row.date,
        row.count || 0,
        row.created_at || null,
        row.updated_at || null,
      ]
    );
  }
  console.log(`  Selesai daily_limits: ${res.rows.length} row.`);
}

async function migrateAuthCreds() {
  console.log("Migrasi auth_creds...");
  const res = await pgDb.query("SELECT tenant_id, data, updated_at FROM auth_creds");
  for (const row of res.rows) {
    await mysqlPool.query(
      `
      INSERT INTO auth_creds (tenant_id, data, updated_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        data = VALUES(data),
        updated_at = VALUES(updated_at)
      `,
      [row.tenant_id, row.data, row.updated_at || null]
    );
  }
  console.log(`  Selesai auth_creds: ${res.rows.length} row.`);
}

async function migrateAuthKeys() {
  console.log("Migrasi auth_keys...");
  // Kolom "key" adalah reserved word di MySQL, gunakan alias k untuk aman.
  const res = await pgDb.query("SELECT tenant_id, `key` AS k, value, updated_at FROM auth_keys");
  for (const row of res.rows) {
    await mysqlPool.query(
      `
      INSERT INTO auth_keys (tenant_id, \`key\`, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        value = VALUES(value),
        updated_at = VALUES(updated_at)
      `,
      [row.tenant_id, row.k, row.value, row.updated_at || null]
    );
  }
  console.log(`  Selesai auth_keys: ${res.rows.length} row.`);
}

async function main() {
  try {
    console.log("=== Migrasi core tables Postgres -> MySQL ===");
    await ensureMysqlCoreTables();
    await migrateApiKeys();
    await migrateWhitelist();
    await migrateDailyLimits();
    await migrateAuthCreds();
    await migrateAuthKeys();
    console.log("=== Selesai migrasi ke MySQL. ===");
    process.exit(0);
  } catch (err) {
    console.error("Migrasi MySQL error:", err.message);
    process.exit(1);
  }
}

main();


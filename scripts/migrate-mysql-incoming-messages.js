/**
 * Migrasi / buat tabel MySQL untuk menyimpan pesan masuk (incoming_messages).
 * Usage:
 *   node scripts/migrate-mysql-incoming-messages.js
 *   npm run migrate-mysql-incoming
 *
 * Menggunakan konfigurasi koneksi dari environment:
 *   MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASSWORD
 */

const { ensureTable } = require("../src/db/mysql");

async function main() {
  try {
    await ensureTable();
    console.log("MySQL: tabel incoming_messages sudah dibuat / sudah ada.");
    process.exit(0);
  } catch (err) {
    console.error("MySQL migration error:", err.message);
    process.exit(1);
  }
}

main();


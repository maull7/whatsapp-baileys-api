Require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  authPath: process.env.AUTH_PATH || "auth_info",
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  // Anti-block: delay (ms) sebelum kirim ke nomor yang TIDAK di kontak HP
  delayNotInContactsMs: Number(process.env.DELAY_NOT_IN_CONTACTS_MS) || 2000,
  // Batas harian: ada di kontak HP = 5, tidak ada = 3
  limitInContactsPerDay: Number(process.env.LIMIT_IN_CONTACTS_PER_DAY) || 5,
  limitNotInContactsPerDay: Number(process.env.LIMIT_NOT_IN_CONTACTS_PER_DAY) || 3,
  // Database PostgreSQL
  dbHost: process.env.MYSQL_HOST || "localhost",
  dbPort: Number(process.env.MYSQL_PORT) || 3306,
  dbName: process.env.MYSQL_DB || "whatsapp_baileys_blast",
  dbUser: process.env.MYSQL_USER || "root",
  dbPassword: process.env.MYSQL_PASSWORD || "",
};

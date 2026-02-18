const mysql = require("mysql2/promise");

// Pool MySQL terpisah hanya untuk simpan log pesan masuk (tidak ganggu Postgres utama)
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

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS incoming_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      tenant_id VARCHAR(100) NOT NULL,
      from_number VARCHAR(50) NOT NULL,
      sender_jid VARCHAR(255) NOT NULL,
      chat_jid VARCHAR(255) NOT NULL,
      push_name VARCHAR(255) NULL,
      type VARCHAR(50) NULL,
      text TEXT NULL,
      ts_ms BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(sql);
  tableReady = true;
}

/**
 * Simpan pesan masuk ke MySQL.
 * @param {Object} msg
 * @param {string} msg.tenantId
 * @param {string} msg.from
 * @param {string} msg.senderJid
 * @param {string} msg.chatJid
 * @param {string} msg.pushName
 * @param {string} msg.type
 * @param {string|null} msg.text
 * @param {number} msg.timestamp - epoch ms
 */
async function insertIncomingMessage(msg) {
  try {
    await ensureTable();
    const sql = `
      INSERT INTO incoming_messages
        (tenant_id, from_number, sender_jid, chat_jid, push_name, type, text, ts_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      msg.tenantId || "default",
      msg.from || "",
      msg.senderJid || "",
      msg.chatJid || "",
      msg.pushName || null,
      msg.type || null,
      msg.text || null,
      Number.isFinite(msg.timestamp) ? Math.floor(msg.timestamp) : null,
    ];
    await pool.query(sql, params);
  } catch (err) {
    console.error("MySQL insertIncomingMessage error:", err.message);
  }
}

module.exports = {
  pool,
  insertIncomingMessage,
  ensureTable,
};


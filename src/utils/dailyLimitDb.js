const db = require("../db");

function getLimits() {
  try {
    const config = require("../../config");
    return {
      inContacts: config.limitInContactsPerDay || 5,
      notInContacts: config.limitNotInContactsPerDay || 3,
    };
  } catch {
    return { inContacts: 5, notInContacts: 3 };
  }
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeJid(jid) {
  if (!jid) return "";
  return String(jid).replace(/@.*$/, "").replace(/\D/g, "");
}

function normalizeTenantId(id) {
  return String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
}

async function getLimitForJid(jid, tenantId = "default") {
  const { inContacts, notInContacts } = getLimits();
  const { isInContacts } = require("../services/whatsapp");
  try {
    const inContactsHP = await isInContacts(jid, tenantId);
    return inContactsHP ? inContacts : notInContacts;
  } catch {
    return notInContacts;
  }
}

/** Cek limit tanpa increment (hanya validasi). */
async function checkLimit(jid, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeJid(jid);
  const today = getTodayKey();
  const limit = await getLimitForJid(jid, tenantId);

  try {
    const result = await db.query(
      "SELECT count FROM daily_limits WHERE tenant_id = $1 AND phone_number = $2 AND date = $3",
      [tid, num, today]
    );

    const currentCount = result.rows.length > 0 ? result.rows[0].count : 0;

    if (currentCount >= limit) {
      return { ok: false, limit, used: currentCount };
    }

    return { ok: true, limit, used: currentCount };
  } catch (error) {
    console.error("checkLimit error:", error.message);
    return { ok: false, limit, used: limit };
  }
}

/** Increment counter setelah pesan berhasil terkirim. */
async function incrementCounter(jid, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeJid(jid);
  const today = getTodayKey();

  try {
    // Buat record jika belum ada (MySQL upsert)
    await db.query(
      `INSERT INTO daily_limits (tenant_id, phone_number, date, count)
       VALUES ($1, $2, $3, 0)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [tid, num, today]
    );

    // Increment
    const result = await db.query(
      "UPDATE daily_limits SET count = count + 1, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND phone_number = $2 AND date = $3 RETURNING count",
      [tid, num, today]
    );

    return result.rows[0]?.count || 1;
  } catch (error) {
    console.error("incrementCounter error:", error.message);
    return 0;
  }
}

/** Cek dan increment counter harian dari database (deprecated, pakai checkLimit + incrementCounter). */
async function checkAndIncrement(jid, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeJid(jid);
  const today = getTodayKey();
  const limit = await getLimitForJid(jid, tenantId);

  try {
    // Cek atau buat record hari ini (MySQL upsert)
    // Pastikan record ada
    await db.query(
      `INSERT INTO daily_limits (tenant_id, phone_number, date, count)
       VALUES ($1, $2, $3, 0)
       ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
      [tid, num, today]
    );

    // Ambil nilai count setelah create/upsert
    const selectRes = await db.query(
      "SELECT count FROM daily_limits WHERE tenant_id = $1 AND phone_number = $2 AND date = $3",
      [tid, num, today]
    );

    const currentCount = selectRes.rows.length > 0 ? selectRes.rows[0].count : 0;

    if (currentCount >= limit) {
      return { ok: false, limit, used: currentCount };
    }

    // Increment
    await db.query(
      "UPDATE daily_limits SET count = count + 1, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND phone_number = $2 AND date = $3",
      [tid, num, today]
    );

    return { ok: true, limit, used: currentCount + 1 };
  } catch (error) {
    console.error("checkAndIncrement error:", error.message);
    return { ok: false, limit, used: limit };
  }
}

/** Get remaining quota dari database. */
async function getRemaining(jid, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeJid(jid);
  const today = getTodayKey();
  const limit = await getLimitForJid(jid, tenantId);

  try {
    const result = await db.query(
      "SELECT count FROM daily_limits WHERE tenant_id = $1 AND phone_number = $2 AND date = $3",
      [tid, num, today]
    );

    const used = result.rows.length > 0 ? result.rows[0].count : 0;
    const remaining = Math.max(0, limit - used);
    return { limit, used, remaining };
  } catch (error) {
    console.error("getRemaining error:", error.message);
    return { limit, used: 0, remaining: limit };
  }
}

module.exports = {
  checkLimit,
  incrementCounter,
  checkAndIncrement,
  getRemaining,
  getLimitForJid,
  getTodayKey,
  normalizeJid,
};

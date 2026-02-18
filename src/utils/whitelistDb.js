const db = require("../db");

function normalizeTenantId(id) {
  return String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
}

function normalizeNumber(number) {
  if (!number) return "";
  return String(number).replace(/\D/g, "").replace(/@.*$/, "");
}

/** Load whitelist untuk tenant dari database. */
async function loadWhitelist(tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  try {
    const result = await db.query("SELECT phone_number FROM whitelist WHERE tenant_id = $1 ORDER BY phone_number", [tid]);
    return result.rows.map((r) => r.phone_number);
  } catch (error) {
    console.error("loadWhitelist error:", error.message);
    return [];
  }
}

/** Cek apakah nomor ada di whitelist. */
async function isInWhitelist(jid, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeNumber(jid);
  if (!num) return false;
  try {
    const result = await db.query("SELECT 1 FROM whitelist WHERE tenant_id = $1 AND phone_number = $2", [tid, num]);
    return result.rows.length > 0;
  } catch (error) {
    console.error("isInWhitelist error:", error.message);
    return false;
  }
}

/** Tambah nomor ke whitelist. */
async function addToWhitelist(number, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeNumber(number);
  if (!num) return false;
  try {
    await db.query(
      "INSERT INTO whitelist (tenant_id, phone_number) VALUES ($1, $2) ON CONFLICT (tenant_id, phone_number) DO NOTHING",
      [tid, num]
    );
    return true;
  } catch (error) {
    console.error("addToWhitelist error:", error.message);
    return false;
  }
}

/** Hapus nomor dari whitelist. */
async function removeFromWhitelist(number, tenantId = "default") {
  const tid = normalizeTenantId(tenantId);
  const num = normalizeNumber(number);
  if (!num) return false;
  try {
    await db.query("DELETE FROM whitelist WHERE tenant_id = $1 AND phone_number = $2", [tid, num]);
    return true;
  } catch (error) {
    console.error("removeFromWhitelist error:", error.message);
    return false;
  }
}

module.exports = {
  loadWhitelist,
  isInWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  normalizeNumber,
};

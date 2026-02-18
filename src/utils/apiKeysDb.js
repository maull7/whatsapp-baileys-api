const crypto = require("crypto");
const db = require("../db");

function normalizeTenantId(id) {
  return String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
}

/** Return tenantId jika key valid, null jika tidak. */
async function getTenantIdByKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  const key = apiKey.trim();
  try {
    const result = await db.query("SELECT tenant_id FROM api_keys WHERE api_key = $1", [key]);
    if (result.rows.length === 0) return null;
    return normalizeTenantId(result.rows[0].tenant_id);
  } catch (error) {
    console.error("getTenantIdByKey error:", error.message);
    return null;
  }
}

/** Generate API key baru untuk tenant. Return { apiKey, tenantId }. */
async function addKey(tenantId) {
  const tid = normalizeTenantId(tenantId);
  try {
    // Cek apakah tenant sudah punya key
    const existing = await db.query("SELECT api_key FROM api_keys WHERE tenant_id = $1", [tid]);
    if (existing.rows.length > 0) {
      return { apiKey: existing.rows[0].api_key, tenantId: tid };
    }
    // Generate key baru
    const apiKey = "sk_" + crypto.randomBytes(24).toString("base64url");
    await db.query("INSERT INTO api_keys (api_key, tenant_id) VALUES ($1, $2)", [apiKey, tid]);
    return { apiKey, tenantId: tid };
  } catch (error) {
    console.error("addKey error:", error.message);
    throw error;
  }
}

/** Hapus key untuk tenant. */
async function removeKey(tenantId) {
  const tid = normalizeTenantId(tenantId);
  try {
    const result = await db.query("DELETE FROM api_keys WHERE tenant_id = $1", [tid]);
    return result.rowCount > 0;
  } catch (error) {
    console.error("removeKey error:", error.message);
    return false;
  }
}

/** Daftar tenant yang punya key. */
async function listTenants() {
  try {
    const result = await db.query("SELECT tenant_id FROM api_keys ORDER BY tenant_id");
    return result.rows.map((r) => r.tenant_id);
  } catch (error) {
    console.error("listTenants error:", error.message);
    return [];
  }
}

/** Load all keys (untuk migrasi). Return { api_key: tenant_id, ... } */
async function loadAllKeys() {
  try {
    const result = await db.query("SELECT api_key, tenant_id FROM api_keys");
    const keys = {};
    for (const row of result.rows) {
      keys[row.api_key] = row.tenant_id;
    }
    return keys;
  } catch (error) {
    console.error("loadAllKeys error:", error.message);
    return {};
  }
}

module.exports = {
  getTenantIdByKey,
  addKey,
  removeKey,
  listTenants,
  loadAllKeys,
  normalizeTenantId,
};

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data");
const KEYS_PATH = path.join(DATA_DIR, "api_keys.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** Format: { "sk_xxx": "tenant_id", ... } */
function loadKeys() {
  ensureDataDir();
  if (!fs.existsSync(KEYS_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(KEYS_PATH, "utf8");
    const obj = JSON.parse(raw);
    return typeof obj === "object" && obj !== null ? obj : {};
  } catch {
    return {};
  }
}

function saveKeys(keys) {
  ensureDataDir();
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), "utf8");
}

function normalizeTenantId(id) {
  return String(id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
}

/** Return tenantId jika key valid, null jika tidak. */
function getTenantIdByKey(apiKey) {
  if (!apiKey || typeof apiKey !== "string") return null;
  const key = apiKey.trim();
  const keys = loadKeys();
  const tenantId = keys[key];
  return tenantId ? normalizeTenantId(tenantId) : null;
}

/** Generate API key baru untuk tenant. Return { apiKey, tenantId }. */
function addKey(tenantId) {
  const tid = normalizeTenantId(tenantId);
  const keys = loadKeys();
  const existing = Object.entries(keys).find(([, t]) => normalizeTenantId(t) === tid);
  if (existing) {
    return { apiKey: existing[0], tenantId: tid };
  }
  const apiKey = "sk_" + crypto.randomBytes(24).toString("base64url");
  keys[apiKey] = tid;
  saveKeys(keys);
  return { apiKey, tenantId: tid };
}

/** Hapus key untuk tenant (hapus satu key yang punya tenant ini). */
function removeKey(tenantId) {
  const tid = normalizeTenantId(tenantId);
  const keys = loadKeys();
  let removed = false;
  for (const [key, t] of Object.entries(keys)) {
    if (normalizeTenantId(t) === tid) {
      delete keys[key];
      removed = true;
      break;
    }
  }
  if (removed) saveKeys(keys);
  return removed;
}

/** Daftar tenant yang punya key (tanpa menampilkan key). */
function listTenants() {
  const keys = loadKeys();
  const set = new Set();
  for (const t of Object.values(keys)) {
    set.add(normalizeTenantId(t));
  }
  return Array.from(set).sort();
}

module.exports = {
  loadKeys,
  getTenantIdByKey,
  addKey,
  removeKey,
  listTenants,
  KEYS_PATH,
};

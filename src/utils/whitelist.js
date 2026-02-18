const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getWhitelistPath(tenantId = "default") {
  const safe = String(tenantId).replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "default";
  return path.join(DATA_DIR, `whitelist_${safe}.json`);
}

function loadWhitelist(tenantId = "default") {
  ensureDataDir();
  const p = getWhitelistPath(tenantId);
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function saveWhitelist(tenantId, arr) {
  ensureDataDir();
  fs.writeFileSync(getWhitelistPath(tenantId), JSON.stringify(arr, null, 2), "utf8");
}

function normalizeNumber(jid) {
  if (!jid) return "";
  return String(jid).replace(/\D/g, "").replace(/@.*$/, "");
}

function isInWhitelist(jid, tenantId = "default") {
  const list = loadWhitelist(tenantId);
  const num = normalizeNumber(jid);
  return list.some((n) => normalizeNumber(n) === num);
}

function addToWhitelist(number, tenantId = "default") {
  const list = loadWhitelist(tenantId);
  const num = normalizeNumber(number);
  if (!num) return false;
  if (list.some((n) => normalizeNumber(n) === num)) return true;
  list.push(num);
  saveWhitelist(tenantId, list);
  return true;
}

function removeFromWhitelist(number, tenantId = "default") {
  const num = normalizeNumber(number);
  const list = loadWhitelist(tenantId).filter((n) => normalizeNumber(n) !== num);
  saveWhitelist(tenantId, list);
  return true;
}

module.exports = {
  loadWhitelist,
  saveWhitelist,
  isInWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  normalizeNumber,
};

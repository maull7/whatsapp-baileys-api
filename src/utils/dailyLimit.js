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

const dailyCount = Object.create(null);

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeJid(jid) {
  if (!jid) return "";
  return String(jid).replace(/@.*$/, "").replace(/\D/g, "");
}

function countKey(tenantId, jid) {
  const tid = String(tenantId || "default").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "default";
  return tid + ":" + normalizeJid(jid);
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

async function checkAndIncrement(jid, tenantId = "default") {
  const key = countKey(tenantId, jid);
  const today = getTodayKey();
  const limit = await getLimitForJid(jid, tenantId);

  if (!dailyCount[key] || dailyCount[key].date !== today) {
    dailyCount[key] = { date: today, count: 0 };
  }

  if (dailyCount[key].count >= limit) {
    return { ok: false, limit, used: dailyCount[key].count };
  }
  dailyCount[key].count += 1;
  return { ok: true, limit, used: dailyCount[key].count };
}

async function getRemaining(jid, tenantId = "default") {
  const key = countKey(tenantId, jid);
  const today = getTodayKey();
  const limit = await getLimitForJid(jid, tenantId);
  if (!dailyCount[key] || dailyCount[key].date !== today) {
    return { limit, used: 0, remaining: limit };
  }
  const remaining = Math.max(0, limit - dailyCount[key].count);
  return { limit, used: dailyCount[key].count, remaining };
}

module.exports = {
  checkAndIncrement,
  getRemaining,
  getLimitForJid,
  getTodayKey,
  normalizeJid,
};

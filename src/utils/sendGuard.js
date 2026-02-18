const { checkLimit } = require("./dailyLimitDb");
const { isInContacts } = require("../services/whatsapp");

function getDelayMs() {
  try {
    const config = require("../../config");
    return config.delayNotInContactsMs || 2000;
  } catch {
    return 2000;
  }
}

/** Cek limit & apply delay sebelum kirim. Tidak increment counter. */
async function beforeSend(jid, tenantId = "default") {
  const result = await checkLimit(jid, tenantId);
  if (!result.ok) {
    return {
      ok: false,
      message: `Batas harian ke nomor ini tercapai (${result.used}/${result.limit}). Coba lagi besok.`,
    };
  }
  const inContactsHP = await isInContacts(jid, tenantId);
  if (!inContactsHP) {
    await new Promise((r) => setTimeout(r, getDelayMs()));
  }
  return { ok: true };
}

module.exports = { beforeSend };

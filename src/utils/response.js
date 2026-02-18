function success(res, data = null, message = "OK") {
  return res.status(200).json({ status: true, message, data });
}

function error(res, message = "Error", code = 400) {
  return res.status(code).json({ status: false, message });
}

function toJid(number) {
  const clean = number.replace(/\D/g, "");
  const jid = clean.endsWith("@s.whatsapp.net") ? clean : clean + "@s.whatsapp.net";
  return jid;
}

module.exports = { success, error, toJid };

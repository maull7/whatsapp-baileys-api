const express = require("express");
const multer = require("multer");
const QRCode = require("qrcode");
const {
  getSocket,
  getQR,
  getConnectionStatus,
  ensureConnection,
  logout: doLogout,
  reconnect: doReconnect,
  getChatsList,
  getGroupsList,
  getContactsList,
  getN8nInbox,
  getN8nDebug,
} = require("../services/whatsapp");
const { success, error, toJid } = require("../utils/response");
const { beforeSend } = require("../utils/sendGuard");
const { incrementCounter } = require("../utils/dailyLimitDb");
const whitelist = require("../utils/whitelistDb");
const { getRemaining } = require("../utils/dailyLimitDb");
const config = require("../../config");

const router = express.Router();
const maxFileSize = 50 * 1024 * 1024; // 50MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize } });

const uploadImage = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize } }).fields([{ name: "file", maxCount: 1 }, { name: "image", maxCount: 1 }]);
const uploadDocument = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize } }).fields([{ name: "file", maxCount: 1 }, { name: "document", maxCount: 1 }]);
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize } }).fields([{ name: "file", maxCount: 1 }, { name: "audio", maxCount: 1 }]);
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileSize } }).fields([{ name: "file", maxCount: 1 }, { name: "video", maxCount: 1 }]);

function getFirstFile(req) {
  if (!req.files) return req.file?.buffer;
  const keys = ["file", "image", "document", "audio", "video"];
  for (const k of keys) {
    const arr = req.files[k];
    if (Array.isArray(arr) && arr[0]?.buffer) return arr[0].buffer;
  }
  return null;
}

function isSocketReady(sock, status) {
  if (!sock) return false;
  if (status === "open") return true;
  try {
    if (sock.ws && (sock.ws.isOpen === true || sock.ws.socket?.readyState === 1)) return true;
  } catch (_) {}
  return false;
}

async function requireSocket(req, res, next) {
  const tid = req.tenantId;
  await ensureConnection(tid);
  let sock = getSocket(tid);
  let status = getConnectionStatus(tid);
  if (sock && !isSocketReady(sock, status)) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      sock = getSocket(tid);
      status = getConnectionStatus(tid);
      if (isSocketReady(sock, status)) break;
    }
  }
  sock = getSocket(tid);
  status = getConnectionStatus(tid);
  if (!isSocketReady(sock, status)) {
    return res.status(503).json({
      status: false,
      message: "WhatsApp belum terhubung. Pastikan pakai API key yang sama dengan saat scan QR.",
      debug: {
        tenantId: tid,
        connectionStatus: status,
        hasSocket: !!sock,
        wsReady: sock ? !!(sock.ws && (sock.ws.isOpen || sock.ws.socket?.readyState === 1)) : false,
      },
    });
  }
  req.sock = sock;
  next();
}

// --- Status & QR (per tenant / API Key) ---

router.get("/status", async (req, res) => {
  const tid = req.tenantId;
  await ensureConnection(tid);
  const sock = getSocket(tid);
  const status = getConnectionStatus(tid);
  const connected = isSocketReady(sock, status);
  const qr = getQR(tid);
  const data = {
    tenantId: tid,
    connected,
    status: connected ? "open" : status,
    qrUrl: qr ? `${config.baseUrl}/api/qr` : null,
    qrImageUrl: qr ? `${config.baseUrl}/api/qr/image` : null,
  };
  return success(res, data, "Status koneksi WhatsApp");
});

router.get("/qr", async (req, res) => {
  const tid = req.tenantId;
  await ensureConnection(tid);
  const qr = getQR(tid);
  if (!qr) {
    return error(res, "QR belum tersedia. Tunggu 2–3 detik lalu refresh, atau GET /api/status dulu.", 404);
  }
  return success(res, { qr, qrUrl: `${config.baseUrl}/api/qr/image` }, "Data QR");
});

router.get("/qr/image", async (req, res) => {
  const tid = req.tenantId;
  await ensureConnection(tid);
  let qr = getQR(tid);
  if (!qr) {
    const deadline = Date.now() + 6000;
    while (!qr && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      qr = getQR(tid);
    }
  }
  if (!qr) {
    res.status(404).set("Content-Type", "text/plain; charset=utf-8");
    return res.send("QR belum tersedia. Tunggu 2–3 detik lalu refresh.");
  }
  try {
    const qrString = typeof qr === "string" ? qr : String(qr);
    const url = await QRCode.toDataURL(qrString, {
      type: "image/png",
      margin: 4,
      width: 400,
      errorCorrectionLevel: "L",
      color: { dark: "#000000", light: "#ffffff" },
    });
    const base64 = url.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    res.send(buf);
  } catch (e) {
    console.error("QR image error:", e);
    res.status(500).send("Gagal generate gambar QR");
  }
});

router.get("/qr/page", async (req, res) => {
  const tid = req.tenantId;
  const qs = req.apiKeyForQuery ? "&api_key=" + encodeURIComponent(req.apiKeyForQuery) : "";
  const imgUrl = config.baseUrl + "/api/qr/image?t=" + Date.now() + qs;
  const apiKeyEnc = req.apiKeyForQuery ? encodeURIComponent(req.apiKeyForQuery) : "";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Scan QR - ${tid}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui,sans-serif; max-width: 420px; margin: 20px auto; padding: 16px; text-align: center; }
    h1 { font-size: 1.25rem; }
    img { max-width: 100%; height: auto; border: 2px solid #ddd; border-radius: 8px; }
    p { color: #666; font-size: 0.9rem; }
    .time { font-size: 0.85rem; margin-top: 12px; }
  </style>
</head>
<body data-qr-base="${config.baseUrl}/api/qr/image" data-api-key="${apiKeyEnc}">
  <h1>Scan QR WhatsApp (${tid})</h1>
  <p>Buka WhatsApp di HP → Linked devices → Link a device → scan gambar di bawah.</p>
  <p><img id="qrimg" src="${imgUrl}" alt="QR Code" width="400"></p>
  <p class="time">QR di-refresh tiap 25 detik. QR berlaku ~60 detik — scan segera. Buka di komputer, arahkan kamera HP ke layar.</p>
  <script>
    function refreshQR() {
      var base = document.body.dataset.qrBase;
      var key = document.body.dataset.apiKey;
      var q = key ? "&api_key=" + key : "";
      document.getElementById("qrimg").src = base + "?t=" + Date.now() + q;
    }
    setInterval(refreshQR, 25000);
  </script>
</body>
</html>`;
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(html);
});

// --- Chats, Groups & Contacts ---

router.get("/contacts", requireSocket, async (req, res) => {
  try {
    const list = await getContactsList(req.tenantId);
    return success(res, { contacts: list, total: list.length }, "Daftar kontak tersimpan");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal ambil kontak", 500);
  }
});

router.get("/chats", requireSocket, (req, res) => {
  try {
    const list = getChatsList(req.tenantId);
    return success(res, { chats: list, total: list.length }, "Daftar chat");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal ambil daftar chat", 500);
  }
});

router.get("/groups", requireSocket, async (req, res) => {
  try {
    const list = await getGroupsList(req.tenantId);
    return success(res, { groups: list, total: list.length }, "Daftar grup");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal ambil daftar grup", 500);
  }
});

// --- Whitelist (per tenant) ---

router.get("/whitelist", async (req, res) => {
  try {
    const list = await whitelist.loadWhitelist(req.tenantId);
    return success(res, { numbers: list }, "Daftar nomor whitelist");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal ambil whitelist", 500);
  }
});

router.post("/whitelist", async (req, res) => {
  try {
    const number = req.body?.number;
    if (!number) return error(res, "number wajib", 400);
    await whitelist.addToWhitelist(number, req.tenantId);
    const list = await whitelist.loadWhitelist(req.tenantId);
    return success(res, { numbers: list }, "Nomor ditambah ke whitelist");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal tambah whitelist", 500);
  }
});

router.delete("/whitelist", async (req, res) => {
  try {
    const number = req.body?.number || req.query?.number;
    if (!number) return error(res, "number wajib (body atau query)", 400);
    await whitelist.removeFromWhitelist(number, req.tenantId);
    const list = await whitelist.loadWhitelist(req.tenantId);
    return success(res, { numbers: list }, "Nomor dihapus dari whitelist");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal hapus whitelist", 500);
  }
});

router.get("/quota/:number", requireSocket, async (req, res) => {
  try {
    const jid = toJid(req.params.number);
    const { isInContacts } = require("../services/whatsapp");
    const inContactsHP = await isInContacts(jid, req.tenantId);
    const info = await getRemaining(jid, req.tenantId);
    return success(res, {
      limit: info.limit,
      used: info.used,
      remaining: info.remaining,
      isInContacts: inContactsHP,
    }, "Kuota harian");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal cek kuota", 500);
  }
});

// --- N8N Inbox (hanya chat dari 083819752295) ---

router.get("/n8n/inbox", requireSocket, async (req, res) => {
  try {
    const consume = String(req.query?.consume || "").toLowerCase();
    const shouldConsume = consume === "1" || consume === "true" || consume === "yes";
    const limit = req.query?.limit;
    const from = req.query?.from; // optional: nomor pengirim tertentu (08xxx / 628xxx)
    const items = getN8nInbox(req.tenantId, { consume: shouldConsume, limit, from });
    const debug = String(req.query?.debug || "").toLowerCase();
    const wantDebug = debug === "1" || debug === "true" || debug === "yes";

    return success(
      res,
      {
        tenantId: req.tenantId,
        sourceNumber: from || null,
        total: items.length,
        consumed: shouldConsume,
        messages: items,
        debug: wantDebug ? getN8nDebug(req.tenantId) : undefined,
      },
      "N8N inbox"
    );
  } catch (err) {
    console.error(err);
    return error(res, "Gagal ambil N8N inbox", 500);
  }
});

// --- Logout & Reconnect ---

router.post("/logout", async (req, res) => {
  try {
    const result = await doLogout(req.tenantId);

    if (!result.ok) return error(res, result.message, 400);

    return success(res, null, "Logout berhasil");
  } catch (err) {
    console.error(err);
    return error(res, "Gagal logout", 500);
  }
});

router.post("/reconnect", async (req, res) => {
  try {
    const result = doReconnect(req.tenantId);
    return success(res, null, result.message);
  } catch (err) {
    console.error(err);
    return error(res, "Gagal reconnect", 500);
  }
});

// --- Kirim pesan ---

router.post("/send-message", requireSocket, async (req, res) => {
  try {
    const { number, message } = req.body;
    if (!number || message == null) return error(res, "number dan message wajib", 400);
    const jid = toJid(number);
    const guard = await beforeSend(jid, req.tenantId);
    if (!guard.ok) return error(res, guard.message, 429);
    
    await req.sock.sendMessage(jid, { text: String(message) });
    
    // Increment counter SETELAH berhasil kirim
    await incrementCounter(jid, req.tenantId);
    
    return success(res, null, "Pesan terkirim");
  } catch (err) {
    console.error(err);
    return error(res, err.message || "Gagal kirim pesan", 500);
  }
});

router.post("/send-image", requireSocket, uploadImage, async (req, res) => {
  try {
    const number = req.body?.number;
    const caption = req.body?.caption || "";
    const imagePayload = getFirstFile(req);
    if (!number) return error(res, "number wajib", 400);
    if (!imagePayload) return error(res, "Gunakan form-data: number, dan file/image (file upload), caption opsional", 400);
    const jid = toJid(number);
    const guard = await beforeSend(jid, req.tenantId);
    if (!guard.ok) return error(res, guard.message, 429);
    
    await req.sock.sendMessage(jid, { image: imagePayload, caption: caption || undefined });
    
    // Increment counter SETELAH berhasil kirim
    await incrementCounter(jid, req.tenantId);
    
    return success(res, null, "Gambar terkirim");
  } catch (err) {
    console.error(err);
    return error(res, err.message || "Gagal kirim gambar", 500);
  }
});

router.post("/send-document", requireSocket, uploadDocument, async (req, res) => {
  try {
    const number = req.body?.number;
    const caption = req.body?.caption || "";
    const documentPayload = getFirstFile(req);
    const fileName = req.body?.fileName || req.files?.file?.[0]?.originalname || req.files?.document?.[0]?.originalname || "document";
    const mimetype = req.files?.file?.[0]?.mimetype || req.files?.document?.[0]?.mimetype || "application/octet-stream";
    if (!number) return error(res, "number wajib", 400);
    if (!documentPayload) return error(res, "Gunakan form-data: number, dan file/document (file upload)", 400);
    const jid = toJid(number);
    const guard = await beforeSend(jid, req.tenantId);
    if (!guard.ok) return error(res, guard.message, 429);
    
    await req.sock.sendMessage(jid, { document: documentPayload, mimetype, fileName, caption: caption || undefined });
    
    // Increment counter SETELAH berhasil kirim
    await incrementCounter(jid, req.tenantId);
    
    return success(res, null, "Dokumen terkirim");
  } catch (err) {
    console.error(err);
    return error(res, err.message || "Gagal kirim dokumen", 500);
  }
});

router.post("/send-audio", requireSocket, uploadAudio, async (req, res) => {
  try {
    const number = req.body?.number;
    const ptt = req.body?.ptt === true || req.body?.ptt === "true";
    const audioPayload = getFirstFile(req);
    const mime = req.files?.file?.[0]?.mimetype || req.files?.audio?.[0]?.mimetype || "audio/mpeg";
    if (!number) return error(res, "number wajib", 400);
    if (!audioPayload) return error(res, "Gunakan form-data: number, dan file/audio (file upload)", 400);
    const jid = toJid(number);
    const guard = await beforeSend(jid, req.tenantId);
    if (!guard.ok) return error(res, guard.message, 429);
    
    await req.sock.sendMessage(jid, { audio: audioPayload, ptt, mimetype: mime });
    
    // Increment counter SETELAH berhasil kirim
    await incrementCounter(jid, req.tenantId);
    
    return success(res, null, "Audio terkirim");
  } catch (err) {
    console.error(err);
    return error(res, err.message || "Gagal kirim audio", 500);
  }
});

router.post("/send-video", requireSocket, uploadVideo, async (req, res) => {
  try {
    const number = req.body?.number;
    const caption = req.body?.caption || "";
    const ptv = req.body?.ptv === true || req.body?.ptv === "true";
    const videoPayload = getFirstFile(req);
    const mime = req.files?.file?.[0]?.mimetype || req.files?.video?.[0]?.mimetype || "video/mp4";
    if (!number) return error(res, "number wajib", 400);
    if (!videoPayload) return error(res, "Gunakan form-data: number, dan file/video (file upload)", 400);
    const jid = toJid(number);
    const guard = await beforeSend(jid, req.tenantId);
    if (!guard.ok) return error(res, guard.message, 429);
    
    await req.sock.sendMessage(jid, { video: videoPayload, caption: caption || undefined, ptv, mimetype: mime });
    
    // Increment counter SETELAH berhasil kirim
    await incrementCounter(jid, req.tenantId);
    
    return success(res, null, "Video terkirim");
  } catch (err) {
    console.error(err);
    return error(res, err.message || "Gagal kirim video", 500);
  }
});

module.exports = router;

const { default: makeWASocket, DisconnectReason } = require("@whiskeysockets/baileys");
const P = require("pino");
const http = require("http");
const { insertIncomingMessage } = require("../db/mysql");
const { useDatabaseAuthState, clearAuthState } = require("../utils/authStateDb");

const config = require("../../config");

const sessions = new Map();

// Buffer maksimum pesan yang disimpan untuk endpoint N8N (per tenant)
const N8N_MAX_INBOX = 200;

// Nomor target untuk trigger webhook otomatis ke N8N (format bebas: 08 / 62 / +62)
const N8N_TARGET_NUMBER = "6281284123425";
// URL webhook N8N yang akan menerima POST ketika ada pesan baru dari nomor di atas
const N8N_WEBHOOK_URL = "http://localhost:5678/webhook-test/883e39a3-e4b4-42ae-ad9e-578621446dc3";

function normalizeTenantId(id) {
  const s = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").trim().toLowerCase();
  return s || "default";
}

function normalizePhone(input) {
  const s = String(input || "");

  // Bentuk umum Baileys: "628xxx:device@s.whatsapp.net"
  // Kita ambil user part sebelum @ lalu buang suffix device setelah ":"
  const userPart = s.includes("@") ? s.split("@")[0] : s;
  const withoutDevice = userPart.includes(":") ? userPart.split(":")[0] : userPart;

  const digits = String(withoutDevice || "").replace(/\D/g, "");
  if (!digits) return "";

  // Indonesia: 08xx -> 62 + 8xx
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  // Jika user kasih 8xxxxxxxxx tanpa 0/62
  if (digits.startsWith("8")) return "62" + digits;
  return digits;
}

function extractMessageText(message = {}) {
  if (message.conversation) return String(message.conversation);
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text);
  if (message.imageMessage?.caption) return String(message.imageMessage.caption);
  if (message.videoMessage?.caption) return String(message.videoMessage.caption);
  if (message.documentMessage?.caption) return String(message.documentMessage.caption);
  if (message.buttonsResponseMessage?.selectedDisplayText) return String(message.buttonsResponseMessage.selectedDisplayText);
  if (message.listResponseMessage?.title) return String(message.listResponseMessage.title);
  if (message.templateButtonReplyMessage?.selectedDisplayText) return String(message.templateButtonReplyMessage.selectedDisplayText);
  return null;
}

function postToN8nWebhook(payload) {
  if (!N8N_WEBHOOK_URL) return;
  try {
    const url = new URL(N8N_WEBHOOK_URL);
    const data = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(options, (res) => {
      // buang response body, kita tidak butuh
      res.on("data", () => {});
    });
    req.on("error", (err) => {
      console.error("N8N webhook error:", err.message);
    });
    req.write(data);
    req.end();
  } catch (e) {
    console.error("N8N webhook build error:", e.message);
  }
}

function getState(tenantId) {
  const tid = normalizeTenantId(tenantId);
  if (!sessions.has(tid)) {
    sessions.set(tid, {
      sock: null,
      currentQR: null,
      connectionStatus: "disconnected",
      chatsMap: new Map(),
      groupsMap: new Map(),
      // Semua pesan masuk (setelah dinormalisasi) disimpan di sini untuk di-pull oleh N8N
      n8nInbox: [],
      n8nDebug: [], // ring buffer semua pesan masuk (metadata) untuk debug
      n8nStats: { upserts: 0, messages: 0, lastUpsertAt: null },
      connectPromise: null,
    });
  }
  return sessions.get(tid);
}

async function startWhatsApp(tenantId) {
  const state = getState(tenantId);
  const { state: authState, saveCreds } = await useDatabaseAuthState(tenantId);
  const n8nTargetFrom = normalizePhone(N8N_TARGET_NUMBER);

  state.sock = makeWASocket({
    logger: P({ level: "silent" }),
    auth: authState,
    printQRInTerminal: false,
  });

  state.sock.ev.on("creds.update", saveCreds);

  state.sock.ev.on("chats.upsert", (chats) => {
    for (const c of chats || []) {
      if (!c) continue;
      const jid = c.id || c.jid;
      if (jid) {
        state.chatsMap.set(jid, {
          jid,
          name: c.name || (c.conversationTimestamp ? "Chat" : jid),
          isGroup: jid.endsWith("@g.us"),
        });
      }
    }
  });

  state.sock.ev.on("messaging-history.set", (data) => {
    for (const c of data.chats || []) {
      if (!c) continue;
      const jid = c.id || c.jid;
      if (jid) state.chatsMap.set(jid, { jid, name: c.name || jid, isGroup: jid.endsWith("@g.us") });
    }
    for (const g of data.messages || []) {
      if (!g || !g.key) continue;
      const jid = g.key.remoteJid;
      if (jid && jid.endsWith("@g.us") && !state.groupsMap.has(jid)) {
        state.groupsMap.set(jid, { id: jid, subject: jid });
      }
    }
  });

  state.sock.ev.on("groups.upsert", (groups) => {
    for (const g of groups || []) {
      if (!g) continue;
      const jid = g.id || g.jid;
      if (jid) {
        state.groupsMap.set(jid, {
          id: jid,
          jid,
          subject: g.subject || g.name || jid,
          participants: g.participants || [],
          size: g.participants?.length || 0,
        });
        state.chatsMap.set(jid, { jid, name: g.subject || g.name || jid, isGroup: true });
      }
    }
  });

  // Tangkap pesan masuk dari nomor tertentu (untuk n8n automation)
  state.sock.ev.on("messages.upsert", async ({ messages }) => {
    try {
      state.n8nStats.upserts += 1;
      state.n8nStats.lastUpsertAt = Date.now();
      for (const msg of messages || []) {
        if (!msg?.key) continue;
        state.n8nStats.messages += 1;
        if (msg.key.fromMe) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@broadcast")) continue;

        // Untuk grup, participant adalah pengirim aslinya. Untuk chat pribadi, remoteJid adalah pengirim.
        const senderJid = msg.key.participant || remoteJid;
        const senderPhone = normalizePhone(senderJid);

        // Simpan metadata untuk debug (tanpa konten/binary)
        state.n8nDebug.push({
          ts: Date.now(),
          remoteJid,
          senderJid,
          senderPhone,
          fromMe: !!msg.key.fromMe,
          msgType: msg.message ? Object.keys(msg.message)[0] : "unknown",
        });
        if (state.n8nDebug.length > 50) state.n8nDebug.splice(0, state.n8nDebug.length - 50);

        if (!senderPhone) continue;

        const msgType = msg.message ? Object.keys(msg.message)[0] : "unknown";
        const text = msg.message ? extractMessageText(msg.message) : null;
        const tsMs = msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now();

        const item = {
          id: msg.key.id || null,
          from: senderPhone,          // nomor pengirim (normalized)
          senderJid,
          chatJid: remoteJid,         // JID chat (bisa grup, user, atau @lid)
          pushName: msg.pushName || null,
          type: msgType || "unknown",
          text,
          timestamp: tsMs,
        };

        state.n8nInbox.push(item);

        if (state.n8nInbox.length > N8N_MAX_INBOX) {
          state.n8nInbox.splice(0, state.n8nInbox.length - N8N_MAX_INBOX);
        }

        // Jika pesan berasal dari nomor target, kirim ke webhook N8N
        if (n8nTargetFrom && senderPhone === n8nTargetFrom) {
          postToN8nWebhook({
            tenantId,
            from: item.from,
            senderJid: item.senderJid,
            chatJid: item.chatJid,
            pushName: item.pushName,
            type: item.type,
            text: item.text,
            timestamp: item.timestamp,
          });
        }

        // Simpan semua pesan masuk ke MySQL (hanya INSERT, tidak pakai Postgres)
        if (insertIncomingMessage) {
          insertIncomingMessage({
            tenantId,
            from: item.from,
            senderJid: item.senderJid,
            chatJid: item.chatJid,
            pushName: item.pushName,
            type: item.type,
            text: item.text,
            timestamp: item.timestamp,
          }).catch((err) => {
            console.error("MySQL save incoming message error:", err.message);
          });
        }
      }
    } catch (e) {
      console.error("messages.upsert handler error:", e.message);
    }
  });

  state.sock.ev.on("connection.update", (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      state.currentQR = qr;
      state.connectionStatus = "connecting";
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      const isLogout = reason === DisconnectReason.loggedOut;
      state.currentQR = null;
      state.connectionStatus = "close";
      state.sock = null;
      state.connectionStatus = "disconnected";
      if (!isLogout) {
        setTimeout(() => startWhatsApp(tenantId).catch(console.error), 2000);
      }
    } else if (connection === "open") {
      state.currentQR = null;
      state.connectionStatus = "open";
    }
  });

  return state.sock;
}

function ensureConnection(tenantId) {
  const state = getState(tenantId);
  if (state.sock !== null || state.connectionStatus === "connecting" || state.connectionStatus === "open") {
    return Promise.resolve();
  }
  if (state.connectPromise) return state.connectPromise;
  state.connectPromise = startWhatsApp(tenantId);
  state.connectPromise.finally(() => { state.connectPromise = null; });
  return state.connectPromise;
}

function getSocket(tenantId) {
  return getState(tenantId).sock;
}

function getQR(tenantId) {
  return getState(tenantId).currentQR;
}

function getConnectionStatus(tenantId) {
  return getState(tenantId).connectionStatus;
}

async function logout(tenantId) {
  const state = getState(tenantId);
  if (!state.sock) return { ok: false, message: "Tidak ada koneksi aktif" };
  try {
    await state.sock.logout();
  } catch (e) {}

  // Hapus auth state di DB supaya QR baru bisa muncul lagi
  await clearAuthState(tenantId);

  state.sock = null;
  state.currentQR = null;
  state.connectionStatus = "disconnected";

  // Jangan auto-reconnect terus-menerus; biarkan user trigger lewat /status atau /qr
  // Kalau tetap ingin auto-start, bisa diaktifkan lagi nanti.
  // startWhatsApp(tenantId).catch(console.error);

  return { ok: true };
}

function getN8nInbox(tenantId, { consume = false, limit = 50, from } = {}) {
  const state = getState(tenantId);
  const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Number(limit))) : 50;

  let filtered = state.n8nInbox;

  // Jika user minta filter nomor tertentu (?from=628xxxx atau 08xxx)
  if (from) {
    const target = normalizePhone(from);
    if (target) {
      filtered = filtered.filter((m) => m.from === target);
    }
  }

  const items = filtered.slice(-lim);

  if (consume && items.length > 0) {
    const ids = new Set(items.map((m) => m.id).filter(Boolean));
    if (ids.size > 0) {
      state.n8nInbox = state.n8nInbox.filter((m) => !m.id || !ids.has(m.id));
    } else {
      const lastTs = items[items.length - 1].timestamp;
      state.n8nInbox = state.n8nInbox.filter((m) => m.timestamp > lastTs);
    }
  }

  return items;
}

function getN8nDebug(tenantId) {
  const state = getState(tenantId);
  return { stats: state.n8nStats, last: state.n8nDebug.slice(-50) };
}

function reconnect(tenantId) {
  const state = getState(tenantId);
  if (!state.sock) {
    startWhatsApp(tenantId);
    return { ok: true, message: "Memulai koneksi" };
  }
  try {
    state.sock.end(undefined);
  } catch (e) {}
  state.sock = null;
  state.connectionStatus = "disconnected";
  startWhatsApp(tenantId);
  return { ok: true, message: "Reconnect dimulai" };
}

function getChatsList(tenantId) {
  const state = getState(tenantId);
  const list = [];
  for (const [, v] of state.chatsMap) {
    if (!v) continue;
    list.push({ jid: v.jid, name: v.name || v.jid, isGroup: !!v.isGroup });
  }
  return list.sort((a, b) => (a.jid > b.jid ? 1 : -1));
}

async function getGroupsList(tenantId) {
  const state = getState(tenantId);
  if (state.sock && (state.connectionStatus === "open" || state.sock.ws?.isOpen)) {
    try {
      const all = await state.sock.groupFetchAllParticipating();
      for (const [jid, meta] of Object.entries(all || {})) {
        if (!jid) continue;
        const m = meta || {};
        state.groupsMap.set(jid, {
          id: jid,
          jid,
          subject: m.subject || m.name || jid,
          participants: m.participants || [],
          size: (m.participants && m.participants.length) || 0,
        });
      }
    } catch (e) {
      console.error("groupFetchAllParticipating error:", e.message);
    }
  }
  const list = [];
  for (const [, v] of state.groupsMap) {
    if (!v) continue;
    list.push({
      jid: v.jid || v.id,
      subject: v.subject || v.jid,
      size: v.size || (v.participants && v.participants.length) || 0,
    });
  }
  return list.sort((a, b) => (a.jid > b.jid ? 1 : -1));
}

async function getContactsList(tenantId) {
  const state = getState(tenantId);
  if (!state.sock || (!state.sock.ws?.isOpen && state.connectionStatus !== "open")) {
    return [];
  }
  try {
    const contacts = await state.sock.store?.contacts || {};
    const list = [];
    for (const [jid, contact] of Object.entries(contacts)) {
      if (!jid || jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;
      list.push({
        jid,
        name: contact.name || contact.notify || contact.verifiedName || jid.split("@")[0],
        notify: contact.notify || null,
        verifiedName: contact.verifiedName || null,
      });
    }
    return list.sort((a, b) => (a.name || a.jid).localeCompare(b.name || b.jid));
  } catch (e) {
    console.error("getContactsList error:", e.message);
    return [];
  }
}

/** Cek apakah JID ada di kontak tersimpan HP (bukan whitelist file). */
async function isInContacts(jid, tenantId) {
  const state = getState(tenantId);
  if (!state.sock || (!state.sock.ws?.isOpen && state.connectionStatus !== "open")) {
    return false;
  }
  try {
    const normalizedJid = jid.replace(/\D/g, "");
    const contacts = await state.sock.store?.contacts || {};
    for (const contactJid of Object.keys(contacts)) {
      const normalized = contactJid.replace(/\D/g, "");
      if (normalized === normalizedJid) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = {
  normalizeTenantId,
  ensureConnection,
  getSocket,
  getQR,
  getConnectionStatus,
  logout,
  getN8nInbox,
  getN8nDebug,
  reconnect,
  getChatsList,
  getGroupsList,
  getContactsList,
  isInContacts,
};

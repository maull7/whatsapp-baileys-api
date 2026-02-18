/**
 * Dari body API: url, base64, atau buffer (dari multer).
 * Mengembalikan format yang bisa dipakai Baileys: Buffer | { url: string }
 */
function toWAMedia(payload) {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (typeof payload === "string") {
    if (payload.startsWith("http://") || payload.startsWith("https://")) {
      return { url: payload };
    }
    if (payload.startsWith("data:")) {
      const base64 = payload.replace(/^data:[^;]+;base64,/, "");
      return Buffer.from(base64, "base64");
    }
    return Buffer.from(payload, "base64");
  }
  if (payload.url) return { url: payload.url };
  return null;
}

module.exports = { toWAMedia };

const { getTenantIdByKey } = require("../utils/apiKeysDb");
const { error } = require("../utils/response");

/**
 * Middleware API Key.
 * Baca header X-API-Key atau Authorization: Bearer <key>.
 * Jika valid, set req.tenantId. Jika tidak, 401.
 */
async function apiKeyAuth(req, res, next) {
  let key = (req.headers["x-api-key"] || "").trim();
  if (!key && req.headers.authorization) {
    const auth = (req.headers.authorization || "").trim();
    if (auth.startsWith("Bearer ")) {
      key = auth.slice(7).trim();
    }
  }
  if (!key) key = (req.query.api_key || "").trim();
  const tenantId = await getTenantIdByKey(key);
  if (!tenantId) {
    return error(res, "API key tidak valid atau tidak ada. Gunakan header X-API-Key, Authorization: Bearer <key>, atau ?api_key=<key> di URL (untuk buka QR di browser).", 401);
  }
  req.tenantId = tenantId;
  if (req.query.api_key) req.apiKeyForQuery = req.query.api_key;
  next();
}

module.exports = apiKeyAuth;

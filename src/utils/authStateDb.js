/**
 * Auth state Baileys disimpan di PostgreSQL (gantikan useMultiFileAuthState).
 * Format sama dengan useMultiFileAuthState: state.creds, state.keys.get/set, saveCreds.
 */
const db = require("../db");

function fixKeyName(file) {
  return file ? String(file).replace(/\//g, "__").replace(/:/g, "-") : "";
}

/**
 * @param {string} tenantId - tenant id (normalized)
 * @returns {Promise<{ state: { creds, keys }, saveCreds }>}
 */
async function useDatabaseAuthState(tenantId) {
  const tid = String(tenantId).replace(/[^a-z0-9_-]/g, "") || "default";

  const { initAuthCreds, BufferJSON } = require("@whiskeysockets/baileys");
  let proto;
  try {
    proto = require("@whiskeysockets/baileys").proto;
  } catch (_) {}

  // Load creds dari DB
  let creds = null;
  try {
    const row = await db.query("SELECT data FROM auth_creds WHERE tenant_id = $1", [tid]);
    if (row.rows.length > 0 && row.rows[0].data) {
      creds = JSON.parse(row.rows[0].data, BufferJSON.reviver);
    }
  } catch (e) {
    console.error("authStateDb load creds error:", e.message);
  }
  if (!creds) {
    creds = initAuthCreds();
  }

  const writeData = async (data, file) => {
    const key = fixKeyName(file);
    const value = JSON.stringify(data, BufferJSON.replacer);
    try {
      // MySQL upsert
      await db.query(
        `INSERT INTO auth_keys (tenant_id, \`key\`, value, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = CURRENT_TIMESTAMP`,
        [tid, key, value]
      );
    } catch (e) {
      console.error("authStateDb writeData error:", e.message);
    }
  };

  const readData = async (file) => {
    const key = fixKeyName(file);
    try {
      const row = await db.query("SELECT value FROM auth_keys WHERE tenant_id = $1 AND `key` = $2", [tid, key]);
      if (row.rows.length > 0 && row.rows[0].value) {
        return JSON.parse(row.rows[0].value, BufferJSON.reviver);
      }
    } catch (e) {
      console.error("authStateDb readData error:", e.message);
    }
    return null;
  };

  const removeData = async (file) => {
    const key = fixKeyName(file);
    try {
      await db.query("DELETE FROM auth_keys WHERE tenant_id = $1 AND `key` = $2", [tid, key]);
    } catch (e) {
      console.error("authStateDb removeData error:", e.message);
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === "app-state-sync-key" && value && proto && proto.Message && proto.Message.AppStateSyncKeyData) {
                try {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                } catch (_) {}
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}`;
              if (value) {
                await writeData(value, file);
              } else {
                await removeData(file);
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      try {
        const value = JSON.stringify(creds, BufferJSON.replacer);
        // MySQL upsert
        await db.query(
          `INSERT INTO auth_creds (tenant_id, data, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = CURRENT_TIMESTAMP`,
          [tid, value]
        );
      } catch (e) {
        console.error("authStateDb saveCreds error:", e.message);
      }
    },
  };
}

/**
 * Hapus semua auth state untuk satu tenant:
 *  - auth_creds
 *  - auth_keys
 * Dipakai saat logout supaya QR baru bisa muncul lagi.
 */
async function clearAuthState(tenantId) {
  const tid = String(tenantId).replace(/[^a-z0-9_-]/g, "") || "default";
  try {
    await db.query("DELETE FROM auth_keys WHERE tenant_id = $1", [tid]);
    await db.query("DELETE FROM auth_creds WHERE tenant_id = $1", [tid]);
  } catch (e) {
    console.error("clearAuthState error:", e.message);
  }
}

module.exports = { useDatabaseAuthState, clearAuthState };

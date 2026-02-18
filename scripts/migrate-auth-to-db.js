/**
 * Migrasi auth dari folder auth_info/ ke database.
 * Usage: node scripts/migrate-auth-to-db.js
 * Setelah jalan, satu tenant yang punya auth_info/<tenant_id>/ akan punya data di auth_creds & auth_keys.
 */
const fs = require("fs");
const path = require("path");
const db = require("../src/db");

const authBase = process.env.AUTH_PATH || path.join(__dirname, "../auth_info");

function fixKeyName(file) {
  return file ? String(file).replace(/\//g, "__").replace(/:/g, "-") : "";
}

async function migrate() {
  try {
    await db.initDb();

    if (!fs.existsSync(authBase) || !fs.statSync(authBase).isDirectory()) {
      console.log("Folder auth_info tidak ada atau bukan direktori. Skip.");
      process.exit(0);
    }

    const tenants = fs.readdirSync(authBase).filter((name) => {
      const full = path.join(authBase, name);
      return fs.statSync(full).isDirectory() && !name.startsWith(".");
    });

    if (tenants.length === 0) {
      console.log("Tidak ada subfolder tenant di auth_info. Skip.");
      process.exit(0);
    }

    console.log("Migrasi auth_info -> database:");
    for (const tenantId of tenants) {
      const folder = path.join(authBase, tenantId);
      const files = fs.readdirSync(folder).filter((f) => f.endsWith(".json"));

      // creds.json -> auth_creds
      const credsFile = path.join(folder, "creds.json");
      if (fs.existsSync(credsFile)) {
        try {
          const data = fs.readFileSync(credsFile, "utf8");
          await db.query(
            `INSERT INTO auth_creds (tenant_id, data, updated_at)
             VALUES ($1, $2, CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id) DO UPDATE SET data = $2, updated_at = CURRENT_TIMESTAMP`,
            [tenantId, data]
          );
          console.log("  " + tenantId + " -> creds OK");
        } catch (e) {
          console.error("  " + tenantId + " -> creds error:", e.message);
        }
      }

      // *.json (selain creds) -> auth_keys
      for (const f of files) {
        if (f === "creds.json") continue;
        const key = f.replace(/\.json$/, "");
        const keyFixed = fixKeyName(key);
        try {
          const data = fs.readFileSync(path.join(folder, f), "utf8");
          await db.query(
            `INSERT INTO auth_keys (tenant_id, key, value, updated_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_at = CURRENT_TIMESTAMP`,
            [tenantId, keyFixed, data]
          );
        } catch (e) {
          console.error("  " + tenantId + " key " + key + " error:", e.message);
        }
      }
      console.log("  " + tenantId + " -> " + (files.length - (fs.existsSync(credsFile) ? 1 : 0)) + " keys");
    }

    console.log("");
    console.log("Selesai. Restart server; auth akan diambil dari database. Opsi: rename auth_info jadi auth_info.bak.");
    process.exit(0);
  } catch (error) {
    console.error("Migrasi error:", error.message);
    process.exit(1);
  }
}

migrate();

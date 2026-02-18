/**
 * Migrasi api_keys.json ke database PostgreSQL.
 * Usage: node scripts/migrate-keys-to-db.js
 */
const fs = require("fs");
const path = require("path");
const db = require("../src/db");
const { addKey } = require("../src/utils/apiKeysDb");

const keysPath = path.join(__dirname, "../data/api_keys.json");

async function migrate() {
  try {
    // Init DB
    await db.initDb();

    if (!fs.existsSync(keysPath)) {
      console.log("data/api_keys.json tidak ada. Skip migrasi.");
      process.exit(0);
    }

    let keys = {};
    try {
      keys = JSON.parse(fs.readFileSync(keysPath, "utf8"));
    } catch {
      console.log("data/api_keys.json invalid. Skip migrasi.");
      process.exit(1);
    }

    if (typeof keys !== "object" || keys === null) {
      console.log("data/api_keys.json kosong. Skip migrasi.");
      process.exit(0);
    }

    const entries = Object.entries(keys).filter(([k, v]) => k && v);
    if (entries.length === 0) {
      console.log("Tidak ada key di data/api_keys.json. Skip migrasi.");
      process.exit(0);
    }

    console.log("Migrasi api_keys ke database:");
    for (const [apiKey, tenantId] of entries) {
      try {
        const tid = String(tenantId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
        // Cek apakah sudah ada
        const existing = await db.query("SELECT api_key FROM api_keys WHERE api_key = $1 OR tenant_id = $2", [apiKey, tid]);
        if (existing.rows.length > 0) {
          console.log("  " + apiKey + " -> " + tid + " (sudah ada, skip)");
          continue;
        }
        await db.query("INSERT INTO api_keys (api_key, tenant_id) VALUES ($1, $2)", [apiKey, tid]);
        console.log("  " + apiKey + " -> " + tid + " (OK)");
      } catch (error) {
        console.error("  Error migrasi " + apiKey + ":", error.message);
      }
    }
    console.log("");
    console.log("Selesai. Opsi: hapus atau rename data/api_keys.json setelah yakin.");
    process.exit(0);
  } catch (error) {
    console.error("Migrasi error:", error.message);
    process.exit(1);
  }
}

migrate();

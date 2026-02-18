/**
 * Migrasi whitelist dari file JSON ke database.
 * Usage: node scripts/migrate-whitelist-to-db.js
 */
const fs = require("fs");
const path = require("path");
const db = require("../src/db");

const dataDir = path.join(__dirname, "../data");

async function migrate() {
  try {
    await db.initDb();

    if (!fs.existsSync(dataDir)) {
      console.log("Folder data/ tidak ada. Skip migrasi.");
      process.exit(0);
    }

    const files = fs.readdirSync(dataDir).filter((f) => f.startsWith("whitelist_") && f.endsWith(".json"));
    if (files.length === 0) {
      console.log("Tidak ada file whitelist_*.json. Skip migrasi.");
      process.exit(0);
    }

    console.log("Migrasi whitelist ke database:");
    for (const file of files) {
      const match = file.match(/^whitelist_(.+)\.json$/);
      if (!match) continue;
      const tenantId = match[1];
      const filePath = path.join(dataDir, file);

      try {
        const raw = fs.readFileSync(filePath, "utf8");
        const numbers = JSON.parse(raw);
        if (!Array.isArray(numbers)) continue;

        for (const num of numbers) {
          if (!num) continue;
          const normalized = String(num).replace(/\D/g, "");
          if (!normalized) continue;

          try {
            await db.query(
              "INSERT INTO whitelist (tenant_id, phone_number) VALUES ($1, $2) ON CONFLICT (tenant_id, phone_number) DO NOTHING",
              [tenantId, normalized]
            );
            console.log("  " + tenantId + " -> " + normalized);
          } catch (e) {
            console.error("  Error insert " + normalized + ":", e.message);
          }
        }
      } catch (e) {
        console.error("  Error baca file " + file + ":", e.message);
      }
    }

    console.log("");
    console.log("Selesai. Opsi: hapus atau rename file whitelist_*.json setelah yakin.");
    process.exit(0);
  } catch (error) {
    console.error("Migrasi error:", error.message);
    process.exit(1);
  }
}

migrate();

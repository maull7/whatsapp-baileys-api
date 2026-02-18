/**
 * Tambah API key untuk tenant (pelanggan).
 * Usage: node scripts/add-api-key.js <tenant_id>
 *        npm run add-key -- pelanggan_a
 */
require('dotenv').config();
const db = require("../src/db");
const { addKey, listTenants } = require("../src/utils/apiKeysDb");

async function main() {
  try {
    await db.initDb();
    const tenantId = process.argv[2];
    if (!tenantId) {
      console.log("Usage: node scripts/add-api-key.js <tenant_id>");
      console.log("       npm run add-key -- pelanggan_a");
      console.log("");
      const tenants = await listTenants();
      console.log("Tenant yang ada:", tenants.join(", ") || "(belum ada)");
      process.exit(1);
    }

    const { apiKey, tenantId: tid } = await addKey(tenantId);
    console.log("Tenant:", tid);
    console.log("API Key:", apiKey);
    console.log("");
    console.log("Simpan key ini; tidak ditampilkan lagi. Contoh request:");
    console.log("  curl -H \"X-API-Key: " + apiKey + "\" " + (process.env.BASE_URL || "http://localhost:3000") + "/api/status");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();

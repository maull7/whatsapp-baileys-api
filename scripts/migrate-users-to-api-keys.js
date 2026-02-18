/**
 * Satu kali: baca data/users.json, buat API key untuk tiap username, simpan ke data/api_keys.json.
 * Usage: node scripts/migrate-users-to-api-keys.js
 */
const fs = require("fs");
const path = require("path");
const { addKey, loadKeys } = require("../src/utils/apiKeys");

const usersPath = path.join(__dirname, "../data/users.json");
if (!fs.existsSync(usersPath)) {
  console.log("data/users.json tidak ada. Skip migrasi.");
  process.exit(0);
}

let users = {};
try {
  users = JSON.parse(fs.readFileSync(usersPath, "utf8"));
} catch {
  console.log("data/users.json invalid. Skip migrasi.");
  process.exit(1);
}

if (typeof users !== "object" || users === null) {
  console.log("data/users.json kosong. Skip migrasi.");
  process.exit(0);
}

const usernames = Object.keys(users).filter((k) => k && typeof users[k] === "string");
if (usernames.length === 0) {
  console.log("Tidak ada user di data/users.json. Skip migrasi.");
  process.exit(0);
}

const existing = loadKeys();
const tenantsWithKey = new Set(Object.values(existing).map((t) => String(t).trim().toLowerCase()));

console.log("Migrasi user -> API key:");
for (const username of usernames) {
  const tid = String(username).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "default";
  if (tenantsWithKey.has(tid)) {
    console.log("  " + username + " -> sudah punya key, skip");
    continue;
  }
  const { apiKey } = addKey(tid);
  console.log("  " + username + " -> " + apiKey);
  tenantsWithKey.add(tid);
}
console.log("");
console.log("Selesai. Simpan key di atas; request pakai header X-API-Key atau Authorization: Bearer <key>.");
console.log("Opsi: hapus atau rename data/users.json setelah yakin.");

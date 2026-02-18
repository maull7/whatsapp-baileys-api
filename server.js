const express = require("express");
const path = require("path");
const config = require("./config");
const db = require("./src/db");
const apiKeyAuth = require("./src/middleware/apiKeyAuth");
const routes = require("./src/routes");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/docs", express.static(path.join(__dirname, "docs")));

// Semua /api butuh API Key (X-API-Key atau Authorization: Bearer <key>)
app.use("/api", apiKeyAuth, routes);

app.get("/", (req, res) => {
  res.json({
    name: "WhatsApp Baileys API",
    docs: `${config.baseUrl}/docs/openapi.yaml`,
    info: "Multi-tenant: tiap pelanggan punya API key (database). Satu key = satu tenant = satu WhatsApp. Request /api wajib header: X-API-Key atau Authorization: Bearer <key>. Tambah key: npm run add-key -- <tenant_id>",
    endpoints: {
      status: "GET /api/status",
      qr: "GET /api/qr",
      qrImage: "GET /api/qr/image",
      qrPage: "GET /api/qr/page",
      contacts: "GET /api/contacts",
      chats: "GET /api/chats",
      groups: "GET /api/groups",
      whitelist: "GET/POST/DELETE /api/whitelist",
      quota: "GET /api/quota/:number",
      logout: "POST /api/logout",
      reconnect: "POST /api/reconnect",
      sendMessage: "POST /api/send-message",
      sendImage: "POST /api/send-image",
      sendDocument: "POST /api/send-document",
      sendAudio: "POST /api/send-audio",
      sendVideo: "POST /api/send-video",
    },
  });
});

// Init DB lalu start server
db.initDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Server: ${config.baseUrl}`);
      console.log(`QR: ${config.baseUrl}/api/qr/page`);
    });
  })
  .catch((error) => {
    console.error("Failed to init database:", error.message);
    process.exit(1);
  });

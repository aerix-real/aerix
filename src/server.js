const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

require("dotenv").config();

const engineRunner = require("./services/engine-runner.service");
const marketDataService = require("./services/market-data.service");
const authMiddleware = require("./middlewares/auth.middleware");
const { requirePremium } = require("./middlewares/plan.middleware");

const billingController = require("./controllers/billing.controller");

// 🔥 SOCKET
const { Server } = require("socket.io");
const { initializeSocket } = require("./websocket/socket");

const app = express();
const server = http.createServer(app);

// =========================
// 🔥 SOCKET.IO INIT
// =========================

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

initializeSocket(io);

// =========================
// 💳 STRIPE WEBHOOK
// =========================

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  billingController.handleWebhook
);

// =========================
// GLOBAL MIDDLEWARES
// =========================

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// STATIC FRONTEND
// =========================

app.use(express.static(path.join(__dirname, "../public")));

// =========================
// AUTH ROUTES
// =========================

try {
  const authRoutes = require("./routes/auth.routes");
  app.use("/api/auth", authRoutes);
} catch (error) {
  console.log("⚠️ Rotas de auth não encontradas:", error.message);
}

// =========================
// BILLING ROUTES
// =========================

app.post(
  "/api/billing/create-checkout",
  authMiddleware,
  billingController.createCheckout
);

app.get(
  "/api/billing/status",
  authMiddleware,
  billingController.status
);

app.get(
  "/api/premium/status",
  authMiddleware,
  billingController.status
);

// =========================
// DASHBOARD
// =========================

app.get("/api/dashboard", authMiddleware, requirePremium, (req, res) => {
  try {
    return res.json({
      ok: true,
      data: engineRunner.getState()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar dashboard"
    });
  }
});

// =========================
// ENGINE CONTROL
// =========================

app.get("/api/engine", authMiddleware, requirePremium, (req, res) => {
  return res.json({
    ok: true,
    data: engineRunner.getState()
  });
});

app.post("/api/engine/start", authMiddleware, requirePremium, (req, res) => {
  engineRunner.start();
  return res.json({ ok: true });
});

app.post("/api/engine/stop", authMiddleware, requirePremium, (req, res) => {
  engineRunner.stop();
  return res.json({ ok: true });
});

// =========================
// MARKET STATUS
// =========================

app.get("/api/market/status", authMiddleware, async (req, res) => {
  try {
    const data = await marketDataService.getMarketStatus();

    return res.json({
      ok: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao obter status do mercado"
    });
  }
});

// =========================
// HEALTH
// =========================

app.get("/api/health", (req, res) => {
  return res.json({
    ok: true,
    service: "AERIX",
    status: "online",
    timestamp: new Date().toISOString()
  });
});

// =========================
// FRONTEND
// =========================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// =========================
// START SERVER (🔥 CORRETO)
// =========================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 AERIX rodando em http://localhost:${PORT}`);

  if (String(process.env.AUTO_START_ENGINE).toLowerCase() === "true") {
    engineRunner.start();
  }
});
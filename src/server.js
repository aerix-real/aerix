const express = require("express");
const cors = require("cors");
const path = require("path");

require("dotenv").config();

const engineRunner = require("./services/engine-runner.service");
const marketDataService = require("./services/market-data.service");
const authMiddleware = require("./middlewares/auth.middleware");
const { requirePremium } = require("./middlewares/plan.middleware");

const billingController = require("./controllers/billing.controller");

const app = express();

// =========================
// 💳 STRIPE WEBHOOK
// =========================
// IMPORTANTE: precisa vir ANTES do express.json()
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

// Compatibilidade com o app.js atual
app.get(
  "/api/premium/status",
  authMiddleware,
  billingController.status
);

// =========================
// DASHBOARD PREMIUM
// =========================

app.get("/api/dashboard", authMiddleware, requirePremium, (req, res) => {
  try {
    const state = engineRunner.getState();

    return res.json({
      ok: true,
      data: state
    });
  } catch (error) {
    console.error("Erro ao carregar dashboard:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar dashboard"
    });
  }
});

// =========================
// ENGINE CONTROL PREMIUM
// =========================

app.get("/api/engine", authMiddleware, requirePremium, (req, res) => {
  try {
    return res.json({
      ok: true,
      data: engineRunner.getState()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao obter estado da engine."
    });
  }
});

app.post("/api/engine/start", authMiddleware, requirePremium, (req, res) => {
  try {
    engineRunner.start();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao iniciar engine."
    });
  }
});

app.post("/api/engine/stop", authMiddleware, requirePremium, (req, res) => {
  try {
    engineRunner.stop();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao parar engine."
    });
  }
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
    console.error("Erro ao obter status do mercado:", error.message);

    return res.status(500).json({
      ok: false,
      message: "Erro ao obter status do mercado"
    });
  }
});

// =========================
// HEALTHCHECK
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
// FRONTEND FALLBACK
// =========================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// =========================
// START SERVER
// =========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 AERIX rodando em http://localhost:${PORT}`);

  if (String(process.env.AUTO_START_ENGINE).toLowerCase() === "true") {
    engineRunner.start();
  }
});
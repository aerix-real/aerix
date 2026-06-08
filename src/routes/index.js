const express = require("express");

const createBillingRoutes = require("../modules/billing/billing.routes");
const createDashboardRoutes = require("../modules/dashboard/dashboard.routes");
const createEngineRoutes = require("../modules/engine/engine.routes");
const createMarketRoutes = require("../modules/market/market.routes");
const createSignalsRoutes = require("../modules/signals/signals.routes");
const createStatsRoutes = require("../modules/stats/stats.routes");
const createSystemRoutes = require("../modules/system/system.routes");

module.exports = (deps) => {
  const router = express.Router();

  try {
    const authRoutes = require("../routes/auth.routes");
    router.use("/auth", authRoutes);
  } catch (error) {
    console.log("⚠️ Rotas de auth não encontradas:", error.message);
  }

  router.use("/billing", createBillingRoutes(deps));
  router.get("/premium/status", deps.authMiddleware, deps.billingController.status);
  router.use("/dashboard", createDashboardRoutes(deps));
  router.use("/engine", createEngineRoutes(deps));
  router.use("/market", createMarketRoutes(deps));
  router.use("/signals", createSignalsRoutes(deps));
  router.use("/stats", createStatsRoutes(deps));
  router.use("/", createSystemRoutes());

  return router;
};

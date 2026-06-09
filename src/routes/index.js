const express = require("express");

const authRoutes = require("./auth.routes");
const premiumRoutes = require("./premium.routes");
const runtimeRoutes = require("./runtime.routes");
const userRoutes = require("./user.routes");

const createBillingRoutes = require("../modules/billing/billing.routes");
const createDashboardRoutes = require("../modules/dashboard/dashboard.routes");
const createEngineRoutes = require("../modules/engine/engine.routes");
const createMarketRoutes = require("../modules/market/market.routes");
const createSignalsRoutes = require("../modules/signals/signals.routes");
const createStatsRoutes = require("../modules/stats/stats.routes");
const createSystemRoutes = require("../modules/system/system.routes");

module.exports = (deps) => {
  const router = express.Router();

  router.use("/auth", authRoutes);
  router.use("/users", userRoutes);
  router.use("/billing", createBillingRoutes(deps));
  router.use("/dashboard", createDashboardRoutes(deps));
  router.use("/engine", createEngineRoutes(deps));
  router.use("/runtime", runtimeRoutes);
  router.use("/premium", premiumRoutes);
  router.use("/market", createMarketRoutes(deps));
  router.use("/signals", createSignalsRoutes(deps));
  router.use("/stats", createStatsRoutes(deps));
  router.use("/", createSystemRoutes());

  return router;
};

const express = require("express");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const engineRoutes = require("./engine.routes");
const runtimeRoutes = require("./runtime.routes");
const dashboardRoutes = require("./dashboard.routes");
const premiumRoutes = require("./premium.routes");
const billingRoutes = require("./billing.routes");
const filterAnalyticsRoutes = require("./filter-analytics.routes");
const filterAnalyticsController = require("../controllers/filter-analytics.controller");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/engine", engineRoutes);
router.use("/runtime", runtimeRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/premium", premiumRoutes);
router.use("/billing", billingRoutes);
router.use("/filter-analytics", filterAnalyticsRoutes);
router.get("/filter-efficiency", filterAnalyticsController.getFilterEfficiency);

router.get("/health", (req, res) => {
  return res.status(200).json({
    ok: true,
    service: "AERIX API",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
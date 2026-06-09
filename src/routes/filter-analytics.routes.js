const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const filterAnalyticsController = require("../controllers/filter-analytics.controller");

const router = express.Router();

router.get("/", authMiddleware, filterAnalyticsController.getFilterAnalytics);

module.exports = router;

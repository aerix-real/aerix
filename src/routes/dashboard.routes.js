const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const dashboardController = require("../controllers/dashboard.controller");

const router = express.Router();

router.get("/", authMiddleware, dashboardController.getDashboard);
router.get("/history", authMiddleware, dashboardController.getHistory);

module.exports = router;
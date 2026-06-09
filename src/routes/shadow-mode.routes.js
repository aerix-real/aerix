const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const shadowModeController = require("../controllers/shadow-mode.controller");

const router = express.Router();

router.get("/", authMiddleware, shadowModeController.getShadowMode);

module.exports = router;

const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const engineController = require("../controllers/engine.controller");

const router = express.Router();

router.get("/analyze/:symbol", authMiddleware, engineController.analyzeSymbol);
router.get("/analyze", authMiddleware, engineController.analyzePreferredSymbols);

module.exports = router;
const express = require("express");
const billingController = require("../controllers/billing.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = express.Router();

// -------------------------
// 🔥 STRIPE WEBHOOK
// -------------------------
// ⚠️ IMPORTANTE:
// - precisa ser express.raw
// - NÃO usar express.json aqui
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  billingController.handleWebhook // ✅ corrigido (antes estava webhook)
);

// -------------------------
// 💳 CREATE CHECKOUT
// -------------------------
router.post(
  "/create-checkout",
  authMiddleware,
  billingController.createCheckout
);

// -------------------------
// 📊 BILLING STATUS
// -------------------------
router.get(
  "/status",
  authMiddleware,
  billingController.status
);

module.exports = router;
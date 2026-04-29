const express = require("express");
const billingController = require("../controllers/billing.controller");
const authMiddleware = require("../middlewares/auth.middleware");

const router = express.Router();

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  billingController.webhook
);

router.post(
  "/create-checkout",
  authMiddleware,
  billingController.createCheckout
);

router.get(
  "/status",
  authMiddleware,
  billingController.status
);

module.exports = router;
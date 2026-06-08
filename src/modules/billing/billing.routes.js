const express = require("express");

module.exports = ({ authMiddleware, billingController }) => {
  const router = express.Router();

  router.post("/webhook", express.raw({ type: "application/json" }), billingController.handleWebhook);
  router.post("/create-checkout", authMiddleware, billingController.createCheckout);
  router.get("/status", authMiddleware, billingController.status);

  return router;
};

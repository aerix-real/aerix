const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const billingController = require("../controllers/billing.controller");

const router = express.Router();

router.post("/checkout", authMiddleware, billingController.createCheckout);
router.post("/portal", authMiddleware, billingController.createPortal);
router.get("/status", authMiddleware, billingController.getBillingStatus);

module.exports = router;
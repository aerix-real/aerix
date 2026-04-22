const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");

const router = express.Router();

router.get("/dashboard", authMiddleware, async (req, res) => {
  const user = req.user || {};
  const role = String(user.role || "").toLowerCase();

  const premium =
    role === "admin" ||
    String(user.plan || "").toLowerCase() === "premium";

  if (!premium) {
    return res.status(403).json({
      ok: false,
      message: "Acesso premium não liberado para esta conta."
    });
  }

  return res.status(200).json({
    ok: true,
    data: {
      premium: true,
      features: {
        advancedRanking: true,
        premiumSignals: true,
        premiumIntelligence: true
      }
    }
  });
});

module.exports = router;
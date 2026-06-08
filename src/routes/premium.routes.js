const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const userRepository = require("../repositories/user.repository");
const {
  PLAN_FEATURES,
  normalizePlan,
  resolveUserPlan,
  requirePlan,
  requireFeature
} = require("../middlewares/plan.middleware");

const router = express.Router();

router.get("/plans", authMiddleware, async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      currentPlan: resolveUserPlan(req.user),
      plans: Object.entries(PLAN_FEATURES).map(([plan, features]) => ({
        plan,
        features
      }))
    }
  });
});

router.get("/status", authMiddleware, async (req, res) => {
  const currentPlan = resolveUserPlan(req.user);

  return res.status(200).json({
    ok: true,
    data: {
      premium: ["PREMIUM", "ENTERPRISE"].includes(currentPlan),
      plan: currentPlan,
      features: PLAN_FEATURES[currentPlan] || []
    }
  });
});

router.get("/dashboard", authMiddleware, requirePlan("PREMIUM"), async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      premium: true,
      plan: req.userPlan,
      features: {
        advancedRanking: true,
        premiumSignals: true,
        premiumIntelligence: true,
        adaptiveAI: true
      }
    }
  });
});

router.post("/upgrade", authMiddleware, async (req, res) => {
  try {
    const requestedPlan = normalizePlan(req.body?.plan || "PREMIUM");
    const updatedUser = await userRepository.updatePlan(req.user.id, requestedPlan);

    return res.status(200).json({
      ok: true,
      message: "Upgrade realizado com sucesso.",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao realizar upgrade." });
  }
});

router.post("/downgrade", authMiddleware, async (req, res) => {
  try {
    const updatedUser = await userRepository.updatePlan(req.user.id, "FREE");

    return res.status(200).json({
      ok: true,
      message: "Plano alterado para FREE.",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao alterar plano." });
  }
});

router.get("/features", authMiddleware, async (req, res) => {
  const plan = resolveUserPlan(req.user);

  return res.status(200).json({
    ok: true,
    data: {
      plan,
      premium: ["PREMIUM", "ENTERPRISE"].includes(plan),
      features: PLAN_FEATURES[plan] || []
    }
  });
});

router.get("/signals", authMiddleware, requireFeature("premium_signals"), async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      message: "Acesso liberado para sinais premium.",
      plan: req.userPlan
    }
  });
});

module.exports = router;

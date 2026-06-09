const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const userRepository = require("../repositories/user.repository");
const {
  PLAN_FEATURES,
  normalizePlan,
  resolveUserPlan,
  FULL_ACCESS_FEATURES
} = require("../middlewares/plan.middleware");

const router = express.Router();

router.get("/plans", authMiddleware, async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      currentPlan: resolveUserPlan(req.user),
      fullAccess: true,
      message: "Acesso completo liberado.",
      plans: Object.entries(PLAN_FEATURES).map(([plan, features]) => ({
        plan,
        fullAccess: true,
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
      premium: true,
      fullAccess: true,
      access: "complete",
      message: "Acesso completo liberado.",
      plan: currentPlan,
      features: FULL_ACCESS_FEATURES
    }
  });
});

router.get("/dashboard", authMiddleware, async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      premium: true,
      fullAccess: true,
      access: "complete",
      message: "Acesso completo liberado.",
      plan: resolveUserPlan(req.user),
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
      message: "Status de acesso atualizado com sucesso.",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao atualizar status de acesso." });
  }
});

router.post("/downgrade", authMiddleware, async (req, res) => {
  try {
    const updatedUser = await userRepository.updatePlan(req.user.id, "FREE");

    return res.status(200).json({
      ok: true,
      message: "Status de acesso atualizado com sucesso.",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao atualizar status de acesso." });
  }
});

router.get("/features", authMiddleware, async (req, res) => {
  const plan = resolveUserPlan(req.user);

  return res.status(200).json({
    ok: true,
    data: {
      plan,
      premium: true,
      fullAccess: true,
      access: "complete",
      message: "Acesso completo liberado.",
      features: FULL_ACCESS_FEATURES
    }
  });
});

router.get("/signals", authMiddleware, async (req, res) => {
  return res.status(200).json({
    ok: true,
    data: {
      message: "Acesso completo liberado para sinais.",
      fullAccess: true,
      plan: resolveUserPlan(req.user)
    }
  });
});

module.exports = router;

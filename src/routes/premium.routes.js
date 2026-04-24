const express = require("express");
const authMiddleware = require("../middlewares/auth.middleware");
const userRepository = require("../repositories/user.repository");

const router = express.Router();

/**
 * 🔒 Verifica se usuário é premium
 */
function isPremiumUser(user) {
  if (!user) return false;

  return (
    user.role === "admin" ||
    String(user.plan || "").toLowerCase() === "premium"
  );
}

/**
 * 📊 STATUS DO PLANO
 */
router.get("/status", authMiddleware, async (req, res) => {
  try {
    const premium = isPremiumUser(req.user);

    return res.status(200).json({
      ok: true,
      data: {
        premium,
        plan: req.user.plan || "free"
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao verificar status premium."
    });
  }
});

/**
 * 🔐 ROTA PROTEGIDA PREMIUM
 */
router.get("/dashboard", authMiddleware, async (req, res) => {
  try {
    if (!isPremiumUser(req.user)) {
      return res.status(403).json({
        ok: false,
        message: "Plano premium necessário."
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
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao acessar recursos premium."
    });
  }
});

/**
 * 🚀 UPGRADE DE PLANO
 */
router.post("/upgrade", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const updatedUser = await userRepository.updatePlan(userId, "premium");

    return res.status(200).json({
      ok: true,
      message: "🔥 Upgrade realizado com sucesso!",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao realizar upgrade."
    });
  }
});

/**
 * 🔻 DOWNGRADE DE PLANO
 */
router.post("/downgrade", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const updatedUser = await userRepository.updatePlan(userId, "free");

    return res.status(200).json({
      ok: true,
      message: "Plano alterado para FREE.",
      data: {
        plan: updatedUser.plan
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao alterar plano."
    });
  }
});

/**
 * 🎯 FEATURES DISPONÍVEIS (IMPORTANTE PRO FRONT)
 */
router.get("/features", authMiddleware, async (req, res) => {
  try {
    const premium = isPremiumUser(req.user);

    return res.status(200).json({
      ok: true,
      data: {
        plan: req.user.plan || "free",
        premium,
        features: {
          advancedRanking: premium,
          premiumSignals: premium,
          premiumIntelligence: premium,
          adaptiveAI: premium
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao carregar features."
    });
  }
});

module.exports = router;
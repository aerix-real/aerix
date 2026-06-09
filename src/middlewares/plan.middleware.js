const PLAN_HIERARCHY = {
  FREE: 0,
  PRO: 1,
  PREMIUM: 2,
  ENTERPRISE: 3
};

const PLAN_FEATURES = {
  FREE: ["basic_signals", "basic_dashboard"],
  PRO: ["basic_signals", "basic_dashboard", "faster_signals", "ai_assistant"],
  PREMIUM: [
    "basic_signals",
    "basic_dashboard",
    "faster_signals",
    "ai_assistant",
    "premium_signals",
    "advanced_ranking",
    "premium_intelligence",
    "adaptive_ai"
  ],
  ENTERPRISE: [
    "basic_signals",
    "basic_dashboard",
    "faster_signals",
    "ai_assistant",
    "premium_signals",
    "advanced_ranking",
    "premium_intelligence",
    "adaptive_ai",
    "api_access",
    "team_workspace"
  ]
};

function normalizePlan(plan) {
  const normalized = String(plan || "FREE").toUpperCase();
  return PLAN_HIERARCHY[normalized] !== undefined ? normalized : "FREE";
}

function resolveUserPlan(user = {}) {
  if (String(user.role || "").toLowerCase() === "admin") {
    return "ENTERPRISE";
  }

  return normalizePlan(user.plan);
}

function hasPlanAccess(userPlan, requiredPlan) {
  return PLAN_HIERARCHY[userPlan] >= PLAN_HIERARCHY[requiredPlan];
}

function requirePlan(minimumPlan = "PREMIUM") {
  const requiredPlan = normalizePlan(minimumPlan);

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Usuário não autenticado." });
    }

    const userPlan = resolveUserPlan(req.user);

    if (!hasPlanAccess(userPlan, requiredPlan)) {
      return res.status(403).json({
        ok: false,
        message: `Plano ${requiredPlan} necessário para acessar este recurso.`,
        data: {
          currentPlan: userPlan,
          requiredPlan
        }
      });
    }

    req.userPlan = userPlan;
    return next();
  };
}

const requirePremium = requirePlan("PREMIUM");

function requireFeature(featureKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Usuário não autenticado." });
    }

    const userPlan = resolveUserPlan(req.user);
    const enabledFeatures = PLAN_FEATURES[userPlan] || [];

    if (!enabledFeatures.includes(featureKey)) {
      return res.status(403).json({
        ok: false,
        message: `Feature '${featureKey}' indisponível no seu plano.`,
        data: {
          currentPlan: userPlan,
          requiredFeature: featureKey
        }
      });
    }

    req.userPlan = userPlan;
    req.enabledFeatures = enabledFeatures;

    return next();
  };
}

module.exports = {
  PLAN_HIERARCHY,
  PLAN_FEATURES,
  normalizePlan,
  resolveUserPlan,
  requirePlan,
  requirePremium,
  requireFeature
};

const PLAN_HIERARCHY = {
  FREE: 0,
  PRO: 1,
  PREMIUM: 2,
  ENTERPRISE: 3
};

const FULL_ACCESS_FEATURES = [
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
];

const PLAN_FEATURES = {
  FREE: FULL_ACCESS_FEATURES,
  PRO: FULL_ACCESS_FEATURES,
  PREMIUM: FULL_ACCESS_FEATURES,
  ENTERPRISE: FULL_ACCESS_FEATURES
};

function normalizePlan(plan) {
  const normalized = String(plan || "FREE").toUpperCase();
  return PLAN_HIERARCHY[normalized] !== undefined ? normalized : "FREE";
}

function resolveUserPlan(user = {}) {
  return normalizePlan(user.plan);
}

function hasPlanAccess() {
  return true;
}

function attachFullAccess(req) {
  req.userPlan = resolveUserPlan(req.user);
  req.enabledFeatures = FULL_ACCESS_FEATURES;
}

function requirePlan() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Usuário não autenticado." });
    }

    attachFullAccess(req);
    return next();
  };
}

const requirePremium = requirePlan("PREMIUM");

function requireFeature() {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: "Usuário não autenticado." });
    }

    attachFullAccess(req);
    return next();
  };
}

module.exports = {
  PLAN_HIERARCHY,
  PLAN_FEATURES,
  FULL_ACCESS_FEATURES,
  normalizePlan,
  resolveUserPlan,
  hasPlanAccess,
  requirePlan,
  requirePremium,
  requireFeature
};

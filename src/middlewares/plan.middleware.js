function isPremiumUser(user = {}) {
  const plan = String(user.plan || "").toLowerCase();
  const role = String(user.role || "").toLowerCase();

  return plan === "premium" || role === "admin";
}

function requirePremium(req, res, next) {
  if (isPremiumUser(req.user)) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    message: "Plano premium necessário para acessar este recurso."
  });
}

module.exports = {
  isPremiumUser,
  requirePremium
};
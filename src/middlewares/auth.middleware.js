const authService = require("../services/auth.service");

async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({
        ok: false,
        message: "Token de acesso não informado."
      });
    }

    const payload = await authService.verifyAccessToken(token);

    // 🔥 MELHORIA: incluir plan
    req.user = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      plan: payload.plan || "free"
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: error.message || "Token inválido ou expirado."
    });
  }
}

// 🔥 NOVO: middleware de role
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({
        ok: false,
        message: "Acesso negado."
      });
    }
    next();
  };
}

// 🔥 NOVO: middleware de plano
function requirePlan(plan) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        ok: false,
        message: "Não autenticado."
      });
    }

    if (req.user.plan !== plan && req.user.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Plano insuficiente."
      });
    }

    next();
  };
}

module.exports = authMiddleware;
module.exports.requireRole = requireRole;
module.exports.requirePlan = requirePlan;
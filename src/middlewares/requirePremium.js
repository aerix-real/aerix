function requirePremium(req, res, next) {
  try {
    const user = req.user;

    if (!user || String(user.plan).toLowerCase() !== "premium") {
      return res.status(403).json({
        ok: false,
        message: "Recurso disponível apenas no plano premium"
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro ao validar acesso premium."
    });
  }
}

module.exports = requirePremium;
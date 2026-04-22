function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return res.status(401).json({
        ok: false,
        message: "Usuário não autenticado."
      });
    }

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        ok: false,
        message: "Você não tem permissão para acessar este recurso."
      });
    }

    return next();
  };
}

module.exports = roleMiddleware;
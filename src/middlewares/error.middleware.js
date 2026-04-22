const { error } = require("../utils/logger");

function errorMiddleware(err, req, res, next) {
  error("Erro não tratado:", err);

  return res.status(500).json({
    success: false,
    error: "Erro interno do servidor."
  });
}

module.exports = errorMiddleware;
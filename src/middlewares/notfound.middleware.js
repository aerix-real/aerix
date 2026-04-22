function notFoundMiddleware(req, res, next) {
  return res.status(404).json({
    success: false,
    error: "Rota não encontrada."
  });
}

module.exports = notFoundMiddleware;
const engineService = require("../services/engine.service");

async function analyzeSymbol(req, res) {
  try {
    const { symbol } = req.params;

    const result = await engineService.analyzeSymbolForUser(req.user.id, symbol);

    return res.status(200).json({
      ok: true,
      data: result
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao analisar ativo."
    });
  }
}

async function analyzePreferredSymbols(req, res) {
  try {
    const result = await engineService.analyzePreferredSymbols(req.user.id);

    return res.status(200).json({
      ok: true,
      data: result
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao analisar lista de ativos."
    });
  }
}

module.exports = {
  analyzeSymbol,
  analyzePreferredSymbols
};
const shadowModeService = require("../services/shadow-mode.service");

async function getShadowMode(req, res) {
  try {
    const data = await shadowModeService.getShadowModeMetrics({
      limit: req.query.limit,
      rankingLimit: req.query.rankingLimit
    });

    return res.status(200).json({
      ok: true,
      data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao carregar shadow mode."
    });
  }
}

module.exports = {
  getShadowMode
};

const filterAnalyticsService = require("../services/filter-analytics.service");

async function getFilterAnalytics(req, res) {
  try {
    const data = await filterAnalyticsService.getFilterAnalytics({
      limit: req.query.limit,
      rankingLimit: req.query.rankingLimit
    });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao carregar análise de bloqueios."
    });
  }
}

module.exports = {
  getFilterAnalytics
};

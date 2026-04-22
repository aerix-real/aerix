const dashboardService = require("../services/dashboard.service");
const historyService = require("../services/history.service");

async function getDashboard(req, res) {
  try {
    const data = await dashboardService.getUserDashboard(req.user.id);

    return res.status(200).json({
      ok: true,
      data
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao carregar dashboard."
    });
  }
}

async function getHistory(req, res) {
  try {
    const limit = Number(req.query.limit || 20);

    return res.status(200).json({
      ok: true,
      data: {
        items: historyService.getLatest(limit),
        stats: historyService.getStats()
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: error.message || "Erro ao carregar histórico."
    });
  }
}

module.exports = {
  getDashboard,
  getHistory
};
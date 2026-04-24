const engineRunnerService = require("../services/engine-runner.service");
const analyticsService = require("../services/analytics.service");

async function getDashboard(req, res) {
  try {
    const engineState = engineRunnerService.getState();
    const analytics = await analyticsService.getGlobalAnalytics();

    const bestOpportunity = engineState.bestOpportunity || null;
    const ranking = Array.isArray(engineState.latestResults)
      ? engineState.latestResults.slice(0, 8).map((item) => ({
          symbol: item.symbol,
          asset: item.symbol,
          signal: item.signal,
          direction: item.signal,
          confidence: Number(item.confidence || 0),
          finalScore: Number(item.finalScore || item.confidence || 0),
          score: Number(item.finalScore || item.confidence || 0),
          entryQuality: item.entryQuality || "weak",
          strategyName: item.strategyName || null,
          adaptiveAdjustments: item.adaptiveAdjustments || {}
        }))
      : [];

    return res.status(200).json({
      ok: true,
      data: {
        signalCenter: {
          bestOpportunity
        },
        ranking,
        history: analytics.recentHistory,
        analytics: {
          historyStats: {
            total: analytics.summary.totalSignals,
            wins: analytics.summary.wins,
            losses: analytics.summary.losses,
            winRate: analytics.summary.winRate,
            avgConfidence: analytics.summary.avgConfidence,
            avgFinalScore: analytics.summary.avgFinalScore,
            callCount: analytics.summary.callCount,
            putCount: analytics.summary.putCount
          },
          symbolPerformance: analytics.symbolPerformance,
          hourPerformance: analytics.hourPerformance,
          directionalPerformance: analytics.directionalPerformance,
          adaptiveInsights: analytics.adaptiveInsights
        },
        connection: {
          engineRunning: engineState.isRunning,
          isProcessing: engineState.isProcessing,
          lastCycleAt: engineState.lastCycleAt,
          lastStatus: engineState.lastStatus
        },
        runtime: {
          intervalMs: engineState.intervalMs,
          trackedSymbols: engineState.trackedSymbols,
          rateLimit: engineState.rateLimit
        },
        timestamp: new Date().toISOString()
      }
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
    const analytics = await analyticsService.getGlobalAnalytics();

    return res.status(200).json({
      ok: true,
      data: {
        history: analytics.recentHistory,
        summary: analytics.summary,
        symbolPerformance: analytics.symbolPerformance,
        hourPerformance: analytics.hourPerformance,
        directionalPerformance: analytics.directionalPerformance,
        adaptiveInsights: analytics.adaptiveInsights
      }
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao carregar histórico."
    });
  }
}

module.exports = {
  getDashboard,
  getHistory
};
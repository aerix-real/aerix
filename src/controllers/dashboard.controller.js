const engineRunnerService = require("../services/engine-runner.service");
const analyticsService = require("../services/analytics.service");
const filterAnalyticsService = require("../services/filter-analytics.service");
const { filterConfirmedOperationalSignals } = require("../utils/signal-history-filter");

async function getDashboard(req, res) {
  try {
    const engineState = engineRunnerService.getState();
    const [analytics, filterAnalytics, performanceDashboard] = await Promise.all([
      analyticsService.getGlobalAnalytics(),
      filterAnalyticsService.getFilterAnalytics({ limit: 12, rankingLimit: 8 }),
      analyticsService.getPerformanceDashboard()
    ]);

    const bestOpportunity = engineState.bestOpportunity || null;
    const confirmedLatestResults = filterConfirmedOperationalSignals(engineState.latestResults || []);
    const ranking = Array.isArray(confirmedLatestResults)
      ? confirmedLatestResults.slice(0, 8).map((item) => ({
          symbol: item.symbol,
          asset: item.symbol,
          signal: item.signal,
          direction: item.signal,
          confidence: Number(item.confidence || 0),
          finalScore: Number(item.finalScore || item.confidence || 0),
          score: Number(item.finalScore || item.confidence || 0),
          entryQuality: item.entryQuality || "weak",
          strategyName: item.strategyName || null,
          adaptiveAdjustments: item.adaptiveAdjustments || {},
          executionAllowed: item.executionAllowed === true || item.execution_allowed === true,
          minimumScore: Number(item.minimumScore || item.minimum_score || 0),
          adjustedScore: Number(item.adjustedScore || item.adjusted_score || item.finalScore || 0)
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
        blockedAnalyses: filterAnalytics.recentBlocks || [],
        analytics: {
          historyStats: {
            total: analytics.summary.totalSignals,
            wins: analytics.summary.wins,
            losses: analytics.summary.losses,
            draws: analytics.summary.draws,
            winRate: analytics.summary.winRate,
            avgConfidence: analytics.summary.avgConfidence,
            avgFinalScore: analytics.summary.avgFinalScore,
            callCount: analytics.summary.callCount,
            putCount: analytics.summary.putCount
          },
          symbolPerformance: analytics.symbolPerformance,
          hourPerformance: analytics.hourPerformance,
          directionalPerformance: analytics.directionalPerformance,
          outcomeAnalytics: analytics.outcomeAnalytics,
          adaptiveInsights: analytics.adaptiveInsights,
          performanceDashboard,
          filters: {
            analyzedSignals: filterAnalytics.analyzedSignals,
            blockedSignals: filterAnalytics.blockedSignals,
            confirmedSignals: filterAnalytics.confirmedSignals,
            approvalRate: filterAnalytics.approvalRate,
            blockedRate: filterAnalytics.blockedRate,
            watchlistRate: filterAnalytics.watchlistRate,
            highConfidenceRate: filterAnalytics.highConfidenceRate,
            mediumConfidenceRate: filterAnalytics.mediumConfidenceRate,
            penalizedSignals: filterAnalytics.penalizedSignals,
            topBlockingFilters: filterAnalytics.topBlockingFilters
          }
        },
        operationalMonitor: engineState.operationalMonitor || null,
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

async function getPerformance(req, res) {
  try {
    const performanceDashboard = await analyticsService.getPerformanceDashboard();

    return res.status(200).json({
      ok: true,
      data: performanceDashboard
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "Erro ao carregar dashboard de performance."
    });
  }
}

async function getHistory(req, res) {
  try {
    const [analytics, filterAnalytics] = await Promise.all([
      analyticsService.getGlobalAnalytics(),
      filterAnalyticsService.getFilterAnalytics({ limit: 20, rankingLimit: 8 })
    ]);

    return res.status(200).json({
      ok: true,
      data: {
        history: analytics.recentHistory,
        blockedAnalyses: filterAnalytics.recentBlocks || [],
        summary: {
          ...analytics.summary,
          analyzedSignals: filterAnalytics.analyzedSignals,
          blockedSignals: filterAnalytics.blockedSignals,
          confirmedSignals: filterAnalytics.confirmedSignals,
          approvalRate: filterAnalytics.approvalRate,
          blockedRate: filterAnalytics.blockedRate,
          watchlistRate: filterAnalytics.watchlistRate,
          highConfidenceRate: filterAnalytics.highConfidenceRate,
          mediumConfidenceRate: filterAnalytics.mediumConfidenceRate,
          penalizedSignals: filterAnalytics.penalizedSignals,
          topBlockingFilters: filterAnalytics.topBlockingFilters
        },
        symbolPerformance: analytics.symbolPerformance,
        hourPerformance: analytics.hourPerformance,
        directionalPerformance: analytics.directionalPerformance,
        outcomeAnalytics: analytics.outcomeAnalytics,
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
  getPerformance,
  getHistory
};
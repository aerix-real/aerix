const signalRepository = require("../repositories/signal.repository");

function toWinRate(wins, losses) {
  const total = Number(wins || 0) + Number(losses || 0);
  if (!total) return 0;
  return Number(((Number(wins || 0) / total) * 100).toFixed(2));
}

function mapOutcomeAnalytics(rows = []) {
  const buckets = {
    global: null,
    byAsset: [],
    byStrategy: [],
    byRegime: []
  };

  for (const row of rows) {
    const item = {
      scopeKey: row.scope_key,
      symbol: row.symbol,
      strategyName: row.strategy_name,
      marketRegime: row.market_regime,
      total: Number(row.total || 0),
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      draws: Number(row.draws || 0),
      winrate: Number(row.winrate || 0),
      lossrate: Number(row.lossrate || 0),
      drawrate: Number(row.drawrate || 0),
      updatedAt: row.updated_at
    };

    if (row.scope_type === "global") buckets.global = item;
    if (row.scope_type === "asset") buckets.byAsset.push(item);
    if (row.scope_type === "strategy") buckets.byStrategy.push(item);
    if (row.scope_type === "regime") buckets.byRegime.push(item);
  }

  return buckets;
}

function buildAdaptiveInsights(symbols = [], hours = []) {
  const bestSymbol = [...symbols]
    .map((item) => ({
      ...item,
      winRate: toWinRate(item.wins, item.losses)
    }))
    .sort((a, b) => b.winRate - a.winRate || Number(b.avg_final_score || 0) - Number(a.avg_final_score || 0))[0] || null;

  const worstSymbol = [...symbols]
    .map((item) => ({
      ...item,
      winRate: toWinRate(item.wins, item.losses)
    }))
    .sort((a, b) => a.winRate - b.winRate || Number(a.avg_final_score || 0) - Number(b.avg_final_score || 0))[0] || null;

  const bestHour = [...hours]
    .map((item) => ({
      ...item,
      winRate: toWinRate(item.wins, item.losses)
    }))
    .sort((a, b) => b.winRate - a.winRate || Number(b.avg_final_score || 0) - Number(a.avg_final_score || 0))[0] || null;

  const worstHour = [...hours]
    .map((item) => ({
      ...item,
      winRate: toWinRate(item.wins, item.losses)
    }))
    .sort((a, b) => a.winRate - b.winRate || Number(a.avg_final_score || 0) - Number(b.avg_final_score || 0))[0] || null;

  return {
    bestSymbol,
    worstSymbol,
    bestHour,
    worstHour
  };
}

async function getPerformanceDashboard() {
  return signalRepository.getOperationalOverview();
}

async function getStrategyPerformanceComparison() {
  return signalRepository.getStrategyPerformanceComparison();
}

async function getGlobalAnalytics() {
  const [stats, topSymbols, hourlyPerformance, directionalPerformance, recentHistory, outcomeRows, strategyPerformanceComparison] =
    await Promise.all([
      signalRepository.getStats(),
      signalRepository.getTopSymbols(8),
      signalRepository.getHourlyPerformance(24),
      signalRepository.getDirectionalPerformance(),
      signalRepository.getLatestConfirmed(20),
      signalRepository.getOutcomeAnalytics(),
      signalRepository.getStrategyPerformanceComparison()
    ]);

  const resolvedBuckets = Object.values(stats?.bySignal || {});
  const wins = resolvedBuckets.reduce((sum, item) => sum + Number(item.wins || 0), 0);
  const losses = resolvedBuckets.reduce((sum, item) => sum + Number(item.losses || 0), 0);
  const draws = resolvedBuckets.reduce((sum, item) => sum + Number(item.draws || 0), 0);
  const totalResolved = wins + losses + draws;
  const totalSignals = recentHistory.length;
  const callCount = Number(stats?.bySignal?.CALL?.total || 0);
  const putCount = Number(stats?.bySignal?.PUT?.total || 0);
  const avgConfidence = recentHistory.length
    ? recentHistory.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / recentHistory.length
    : 0;
  const avgFinalScore = recentHistory.length
    ? recentHistory.reduce((sum, item) => sum + Number(item.final_score || item.finalScore || 0), 0) / recentHistory.length
    : 0;

  const summary = {
    totalSignals,
    wins,
    losses,
    draws,
    totalResolved,
    winRate: toWinRate(wins, losses),
    avgConfidence: Number(avgConfidence.toFixed(2)),
    avgFinalScore: Number(avgFinalScore.toFixed(2)),
    callCount,
    putCount
  };

  const symbols = topSymbols.map((item) => ({
    symbol: item.symbol,
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    draws: Number(item.draws || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgConfidence: Number(item.avg_confidence || 0),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const hours = hourlyPerformance.map((item) => ({
    hour: Number(item.hour),
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    draws: Number(item.draws || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const directions = directionalPerformance.map((item) => ({
    signal: item.signal,
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    draws: Number(item.draws || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const adaptiveInsights = buildAdaptiveInsights(symbols, hours);
  const outcomeAnalytics = mapOutcomeAnalytics(outcomeRows);

  return {
    summary,
    outcomeAnalytics,
    strategyPerformanceComparison,
    symbolPerformance: symbols,
    hourPerformance: hours,
    directionalPerformance: directions,
    adaptiveInsights,
    recentHistory
  };
}

module.exports = {
  getGlobalAnalytics,
  getPerformanceDashboard,
  getStrategyPerformanceComparison
};

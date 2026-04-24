const signalRepository = require("../repositories/signal.repository");

function toWinRate(wins, losses) {
  const total = Number(wins || 0) + Number(losses || 0);
  if (!total) return 0;
  return Number(((Number(wins || 0) / total) * 100).toFixed(2));
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

async function getGlobalAnalytics() {
  const [stats, topSymbols, hourlyPerformance, directionalPerformance, recentHistory] =
    await Promise.all([
      signalRepository.getStats(),
      signalRepository.getTopSymbols(8),
      signalRepository.getHourlyPerformance(24),
      signalRepository.getDirectionalPerformance(),
      signalRepository.getLatest(20)
    ]);

  const wins = Number(stats?.wins || 0);
  const losses = Number(stats?.losses || 0);
  const totalResolved = wins + losses;

  const summary = {
    totalSignals: Number(stats?.total || 0),
    wins,
    losses,
    totalResolved,
    winRate: toWinRate(wins, losses),
    avgConfidence: Number(stats?.avg_confidence || 0),
    avgFinalScore: Number(stats?.avg_final_score || 0),
    callCount: Number(stats?.call_count || 0),
    putCount: Number(stats?.put_count || 0)
  };

  const symbols = topSymbols.map((item) => ({
    symbol: item.symbol,
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgConfidence: Number(item.avg_confidence || 0),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const hours = hourlyPerformance.map((item) => ({
    hour: Number(item.hour),
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const directions = directionalPerformance.map((item) => ({
    signal: item.signal,
    total: Number(item.total || 0),
    wins: Number(item.wins || 0),
    losses: Number(item.losses || 0),
    winRate: toWinRate(item.wins, item.losses),
    avgFinalScore: Number(item.avg_final_score || 0)
  }));

  const adaptiveInsights = buildAdaptiveInsights(symbols, hours);

  return {
    summary,
    symbolPerformance: symbols,
    hourPerformance: hours,
    directionalPerformance: directions,
    adaptiveInsights,
    recentHistory
  };
}

module.exports = {
  getGlobalAnalytics
};
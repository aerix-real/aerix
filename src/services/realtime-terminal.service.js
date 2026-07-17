const signalRepository = require("../repositories/signal.repository");
const analyticsService = require("./analytics.service");
const engineRunner = require("./engine-runner.service");

async function buildSnapshot({ lightweight = false } = {}) {
  const engine = engineRunner.getState();
  const statuses = {
    engineOnline: engine.isRunning,
    feedOnline: Boolean(engine.lastCycleAt),
    aiOnline: true,
    lastCycleAt: engine.lastCycleAt,
    lastMarketDataAt: engine.lastCycleAt
  };
  if (lightweight) return { statuses };

  const [recentHistory, analytics] = await Promise.all([
    signalRepository.getLatest(20),
    analyticsService.getGlobalAnalytics()
  ]);
  const pending = recentHistory.find((item) => item.result === "pending") || null;
  const latestResult = recentHistory.find((item) => ["win", "loss", "draw"].includes(item.result)) || null;
  return {
    statuses,
    activeSignal: engine.bestOpportunity || pending,
    activeOperation: pending ? {
      operationId: pending.id,
      signalId: pending.id,
      symbol: pending.symbol,
      displayName: pending.meta?.display_name || pending.symbol,
      direction: pending.signal || pending.direction,
      strategy: pending.strategy_name,
      entryPrice: pending.entry_price,
      entryAt: pending.created_at,
      expiresAt: pending.expires_at,
      status: new Date(pending.expires_at).getTime() <= Date.now() ? "AWAITING_RESULT" : "OPEN"
    } : null,
    latestResult,
    recentHistory,
    kpis: analytics.summary
  };
}

module.exports = { buildSnapshot };

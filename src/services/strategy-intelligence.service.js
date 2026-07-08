const signalRepository = require("../repositories/signal.repository");
const { registerAudit } = require("./audit.service");

const MAX_HISTORICAL_ADJUSTMENT = 5;
const NEUTRAL_WEIGHT = 0.5;
const MIN_SAMPLE_FOR_ADJUSTMENT = 3;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function normalizeHour(value = null, createdAt = null) {
  const hour = Number(value);
  if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;

  if (createdAt) {
    const date = new Date(createdAt);
    if (!Number.isNaN(date.getTime())) return date.getHours();
  }

  return new Date().getHours();
}

function normalizeMarketRegime(value = null) {
  const regime = String(value || "NORMAL").trim().toUpperCase();
  return regime || "NORMAL";
}

function normalizeStrategyName(value = null) {
  const strategyName = String(value || "unknown").trim();
  return strategyName || "unknown";
}

function normalizeSymbol(value = null) {
  const symbol = String(value || "UNKNOWN").trim().toUpperCase();
  return symbol || "UNKNOWN";
}

function calculateAdjustment(weight = 0, signals = 0) {
  if (Number(signals || 0) < MIN_SAMPLE_FOR_ADJUSTMENT) return 0;

  const normalizedWeight = clamp(weight, 0, 1);
  return Number(clamp((normalizedWeight - NEUTRAL_WEIGHT) * 10, -MAX_HISTORICAL_ADJUSTMENT, MAX_HISTORICAL_ADJUSTMENT).toFixed(2));
}

function buildContext(item = {}) {
  return {
    strategyName: normalizeStrategyName(item.strategyName || item.strategy_name || item.strategy),
    symbol: normalizeSymbol(item.symbol || item.asset),
    hour: normalizeHour(item.hour, item.createdAt || item.created_at),
    marketRegime: normalizeMarketRegime(item.marketRegime || item.market_regime)
  };
}

class StrategyIntelligenceService {
  async evaluate(baseScore, item = {}) {
    const context = buildContext(item);
    const statistics = await signalRepository.getStrategyStatistics(context);
    const historicalStrategyWeight = statistics ? Number(statistics.win_rate || 0) : 0;
    const historicalAdjustment = calculateAdjustment(
      historicalStrategyWeight,
      statistics?.signals || 0
    );
    const adjustedScore = Number(clamp(Number(baseScore || 0) + historicalAdjustment, 0, 100).toFixed(2));

    const audit = {
      source: "strategy_intelligence",
      ...context,
      baseScore: Number(baseScore || 0),
      adjustedScore,
      historicalStrategyWeight,
      historicalAdjustment,
      maxAdjustment: MAX_HISTORICAL_ADJUSTMENT,
      minimumSample: MIN_SAMPLE_FOR_ADJUSTMENT,
      statistics: statistics || null
    };

    console.log(JSON.stringify({
      scope: "strategy_intelligence",
      event: "strategy_intelligence",
      timestamp: new Date().toISOString(),
      ...audit
    }));

    registerAudit(
      "strategy_intelligence",
      "Strategy Intelligence Engine aplicou peso histórico por estratégia.",
      audit,
      item.userId || item.user_id || null
    ).catch(() => null);

    return {
      finalScore: adjustedScore,
      historicalStrategyWeight,
      historicalAdjustment,
      audit,
      statistics: statistics || null
    };
  }

  async learnFromOutcome(signal = {}, result = null) {
    const context = buildContext(signal);
    const outcome = String(result || signal.result || "").toLowerCase();

    if (!["win", "loss", "draw"].includes(outcome)) return null;

    const saved = await signalRepository.upsertStrategyStatistics({
      ...context,
      result: outcome,
      score: signal.adjusted_score || signal.adjustedScore || signal.final_score || signal.finalScore || signal.confidence || 0,
      confidence: signal.confidence || 0,
      duration: signal.entry_in_seconds || signal.entryInSeconds || 0
    });

    console.log(JSON.stringify({
      scope: "strategy_intelligence",
      event: "strategy_statistics_updated",
      timestamp: new Date().toISOString(),
      ...context,
      result: outcome,
      statistics: saved
    }));

    return saved;
  }
}

module.exports = new StrategyIntelligenceService();

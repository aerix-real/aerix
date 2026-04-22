const userPreferencesRepository = require("../repositories/user-preferences.repository");
const { getTradingMode } = require("../config/trading-modes");
const { getMarketSnapshot } = require("./market-data.service");
const { explainSignal } = require("./signal-ai.service");
const { analyzeIndicators } = require("./indicator-engine.service");
const { runStrategies } = require("../strategy/strategy-runner.service");

const DEFAULT_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"];

function mapTradingModeToStrategyMode(tradingMode) {
  const map = {
    conservative: "conservative",
    balanced: "balanced",
    aggressive: "aggressive"
  };

  return map[tradingMode] || "balanced";
}

function summarizeTimeframe(tfIndicators = {}) {
  return {
    valid: tfIndicators.valid || false,
    reason: tfIndicators.reason || null,
    price: tfIndicators.price ?? null,
    trend: tfIndicators.trend || {},
    adx: tfIndicators.adx || {},
    atr: tfIndicators.atr || {},
    macd: tfIndicators.macd || {},
    rsi: tfIndicators.rsi || {},
    stochastic: tfIndicators.stochastic || {},
    bollinger: tfIndicators.bollinger || {},
    structure: tfIndicators.structure || {}
  };
}

async function getUserModeConfig(userId) {
  const preferences = await userPreferencesRepository.findByUserId(userId);

  if (!preferences) {
    const modeConfig = getTradingMode("balanced");

    return {
      preferences: {
        trading_mode: "balanced",
        preferred_symbols: DEFAULT_SYMBOLS,
        ai_explanations_enabled: true
      },
      modeConfig
    };
  }

  const preferredSymbols =
    Array.isArray(preferences.preferred_symbols) && preferences.preferred_symbols.length
      ? preferences.preferred_symbols
      : DEFAULT_SYMBOLS;

  return {
    preferences: {
      ...preferences,
      preferred_symbols: preferredSymbols
    },
    modeConfig: getTradingMode(preferences.trading_mode)
  };
}

function buildSignalModeLabel(strategyMode) {
  if (strategyMode === "conservative") return "CONSERVADOR";
  if (strategyMode === "aggressive") return "AGRESSIVO";
  return "EQUILIBRADO";
}

function getLastCandle(snapshot, timeframe) {
  const candles = snapshot?.timeframes?.[timeframe]?.candles;
  if (!Array.isArray(candles) || !candles.length) return null;
  return candles[candles.length - 1];
}

function buildLegacySignalShape(symbol, strategyResult, snapshot, strategyMode) {
  const lastM5Candle = getLastCandle(snapshot, "m5");

  const now = new Date();
  const entryTime = now.toLocaleTimeString("pt-BR", { hour12: false });

  const expiryMinutes = 1;
  const expiry = new Date(now.getTime() + expiryMinutes * 60 * 1000);
  const expiryTime = expiry.toLocaleTimeString("pt-BR", { hour12: false });

  return {
    asset: symbol,
    symbol,
    mode: buildSignalModeLabel(strategyMode),
    time: entryTime,
    entry: entryTime,
    entryTime,
    expiry: expiryTime,
    expiration: expiryTime,
    direction: strategyResult.signal,
    signal: strategyResult.signal,
    confidence: strategyResult.confidence,
    score: Math.round(Number(strategyResult.confidence || 0)),
    finalScore: Number(strategyResult.finalScore || strategyResult.confidence || 0),
    trendDirection: snapshot?.timeframes?.h1?.direction || "neutral",
    trendStrength: Number(snapshot?.timeframes?.h1?.strengthPercent || 0),
    volatility: Number(snapshot?.timeframes?.m5?.volatilityPercent || 0),
    explanation: strategyResult.explanation || "",
    price: lastM5Candle?.close ?? null,
    strategyName: strategyResult.strategyName || null,
    entryQuality: strategyResult.entryQuality || "weak",
    timestamp: snapshot?.timestamp || new Date().toISOString()
  };
}

function buildSignalCenter(symbol, strategyResult, snapshot) {
  return {
    bestOpportunity: {
      symbol,
      asset: symbol,
      signal: strategyResult.signal,
      confidence: strategyResult.confidence,
      finalScore: Number(strategyResult.finalScore || strategyResult.confidence || 0),
      entryQuality: strategyResult.entryQuality,
      strategyName: strategyResult.strategyName,
      reasons: strategyResult.reasons,
      blocks: strategyResult.blocks,
      explanation: strategyResult.explanation,
      strategies: strategyResult.strategies,
      mtf: strategyResult.mtf,
      market: {
        h1: snapshot.timeframes.h1,
        m15: snapshot.timeframes.m15,
        m5: snapshot.timeframes.m5
      },
      timestamp: snapshot.timestamp
    }
  };
}

function buildMarketContext(snapshot, indicators = {}) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};

  const h1Indicators = indicators.h1 || {};
  const m15Indicators = indicators.m15 || {};
  const m5Indicators = indicators.m5 || {};

  const h1TrendDirection =
    h1.direction ||
    h1Indicators.trend?.direction ||
    h1Indicators.structure?.direction ||
    "neutral";

  const m15TrendDirection =
    m15.direction ||
    m15Indicators.trend?.direction ||
    m15Indicators.structure?.direction ||
    "neutral";

  const m5TrendDirection =
    m5.direction ||
    m5Indicators.trend?.direction ||
    m5Indicators.structure?.direction ||
    "neutral";

  const h1Strength = Number(h1.strengthPercent || h1Indicators.trend?.strength || 0);
  const m15Strength = Number(m15.strengthPercent || m15Indicators.trend?.strength || 0);
  const m5Strength = Number(m5.strengthPercent || m5Indicators.trend?.strength || 0);
  const m5Volatility = Number(m5.volatilityPercent || m5Indicators.atr?.percent || 0);
  const adxValue = Number(
    h1Indicators.adx?.value ||
      m15Indicators.adx?.value ||
      m5Indicators.adx?.value ||
      0
  );

  const directionAlignment =
    h1TrendDirection !== "neutral" &&
    h1TrendDirection === m15TrendDirection &&
    m15TrendDirection === m5TrendDirection;

  return {
    h1TrendDirection,
    m15TrendDirection,
    m5TrendDirection,
    h1Strength,
    m15Strength,
    m5Strength,
    m5Volatility,
    adxValue,
    isStrongTrend: h1Strength >= 60 || m15Strength >= 60 || adxValue >= 25,
    isWeakTrend: h1Strength < 35 && m15Strength < 35 && adxValue > 0 && adxValue < 18,
    isLowVolatility: m5Volatility > 0 && m5Volatility < 0.12,
    isHighVolatility: m5Volatility >= 0.6,
    directionAlignment
  };
}

function calculateFinalScore(strategyResult, marketContext, strategyMode) {
  let score = Number(strategyResult?.confidence || 0);

  if ((strategyResult?.signal || "WAIT") === "WAIT") {
    score -= 20;
  }

  const entryQuality = String(strategyResult?.entryQuality || "").toLowerCase();
  if (entryQuality === "excellent") score += 10;
  else if (entryQuality === "strong") score += 7;
  else if (entryQuality === "good") score += 4;
  else if (entryQuality === "weak") score -= 8;

  if (marketContext.directionAlignment) score += 8;
  if (marketContext.isStrongTrend) score += 6;
  if (marketContext.isWeakTrend) score -= 10;
  if (marketContext.isLowVolatility) score -= 10;
  if (marketContext.isHighVolatility) score -= 4;

  const blocksCount = Array.isArray(strategyResult?.blocks)
    ? strategyResult.blocks.length
    : 0;
  const reasonsCount = Array.isArray(strategyResult?.reasons)
    ? strategyResult.reasons.length
    : 0;

  score += Math.min(reasonsCount, 5) * 1.5;
  score -= Math.min(blocksCount, 5) * 3;

  if (strategyMode === "conservative") {
    if (!marketContext.directionAlignment) score -= 10;
    if (marketContext.isWeakTrend) score -= 6;
    if (marketContext.isLowVolatility) score -= 6;
  }

  if (strategyMode === "aggressive") {
    if (marketContext.directionAlignment) score += 3;
    if (marketContext.isHighVolatility) score += 2;
  }

  return Math.max(0, Math.min(100, Number(score.toFixed(2))));
}

function normalizeStrategyResult(strategyResult = {}, marketContext = {}, strategyMode = "balanced") {
  const safeResult = {
    signal: strategyResult.signal || "WAIT",
    confidence: Number(strategyResult.confidence || 0),
    entryQuality: strategyResult.entryQuality || "weak",
    strategyName: strategyResult.strategyName || null,
    reasons: Array.isArray(strategyResult.reasons) ? strategyResult.reasons : [],
    blocks: Array.isArray(strategyResult.blocks) ? strategyResult.blocks : [],
    explanation: strategyResult.explanation || "",
    strategies: Array.isArray(strategyResult.strategies) ? strategyResult.strategies : [],
    mtf: strategyResult.mtf || {}
  };

  const finalScore = calculateFinalScore(safeResult, marketContext, strategyMode);

  return {
    ...safeResult,
    finalScore
  };
}

async function analyzeSymbolForUser(userId, symbol, providedSnapshot = null) {
  const { preferences, modeConfig } = await getUserModeConfig(userId);
  const snapshot = providedSnapshot || (await getMarketSnapshot(symbol));
  const strategyMode = mapTradingModeToStrategyMode(preferences.trading_mode);

  const h1Indicators = analyzeIndicators(snapshot.timeframes.h1.candles, strategyMode);
  const m15Indicators = analyzeIndicators(snapshot.timeframes.m15.candles, strategyMode);
  const m5Indicators = analyzeIndicators(snapshot.timeframes.m5.candles, strategyMode);

  const rawStrategyResult = runStrategies({
    snapshot,
    mode: strategyMode
  });

  const marketContext = buildMarketContext(snapshot, {
    h1: h1Indicators,
    m15: m15Indicators,
    m5: m5Indicators
  });

  const strategyResult = normalizeStrategyResult(
    rawStrategyResult,
    marketContext,
    strategyMode
  );

  const explanation =
    preferences.ai_explanations_enabled !== false
      ? explainSignal({
          symbol,
          signal: strategyResult.signal,
          confidence: strategyResult.confidence,
          reasons: strategyResult.reasons,
          modeConfig
        })
      : strategyResult.explanation;

  const finalResult = {
    ...strategyResult,
    explanation
  };

  const legacySignal = buildLegacySignalShape(
    symbol,
    finalResult,
    snapshot,
    strategyMode
  );

  return {
    symbol,
    signal: finalResult.signal,
    confidence: finalResult.confidence,
    finalScore: finalResult.finalScore,
    entryQuality: finalResult.entryQuality,
    strategyName: finalResult.strategyName,
    reasons: finalResult.reasons,
    blocks: finalResult.blocks,
    explanation: finalResult.explanation,
    strategies: finalResult.strategies,
    mtf: finalResult.mtf,
    mode: modeConfig,
    strategyMode,
    currentSignal: legacySignal,
    signalCenter: buildSignalCenter(symbol, finalResult, snapshot),
    timeframes: {
      h1: summarizeTimeframe(h1Indicators),
      m15: summarizeTimeframe(m15Indicators),
      m5: summarizeTimeframe(m5Indicators)
    },
    market: {
      h1: snapshot.timeframes.h1,
      m15: snapshot.timeframes.m15,
      m5: snapshot.timeframes.m5
    },
    marketContext,
    timestamp: snapshot.timestamp
  };
}

function buildHistoryStats(results = []) {
  const actionable = results.filter(
    (item) => item && item.signal && item.signal !== "WAIT"
  );

  const total = actionable.length;
  const avgConfidence = total
    ? actionable.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / total
    : 0;

  const avgFinalScore = total
    ? actionable.reduce((sum, item) => sum + Number(item.finalScore || item.confidence || 0), 0) / total
    : 0;

  const callCount = actionable.filter((item) => item.signal === "CALL").length;
  const putCount = actionable.filter((item) => item.signal === "PUT").length;

  return {
    total,
    avgConfidence: Number(avgConfidence.toFixed(2)),
    avgFinalScore: Number(avgFinalScore.toFixed(2)),
    callCount,
    putCount
  };
}

function buildRanking(results = []) {
  return results.map((item) => ({
    symbol: item.symbol,
    asset: item.symbol,
    confidence: item.confidence,
    finalScore: Number(item.finalScore || item.confidence || 0),
    score: Number(item.finalScore || item.confidence || 0),
    signal: item.signal,
    direction: item.signal,
    entryQuality: item.entryQuality,
    strategyName: item.strategyName
  }));
}

function buildHistory(results = []) {
  return results.map((item) => ({
    symbol: item.symbol,
    asset: item.symbol,
    signal: item.signal,
    direction: item.signal,
    confidence: item.confidence,
    finalScore: Number(item.finalScore || item.confidence || 0),
    score: Number(item.finalScore || item.confidence || 0),
    result: "pending",
    mode: item.strategyMode || "balanced",
    strategyName: item.strategyName || null,
    timestamp: item.timestamp
  }));
}

async function analyzePreferredSymbols(userId) {
  const { preferences } = await getUserModeConfig(userId);
  const symbols = preferences.preferred_symbols?.length
    ? preferences.preferred_symbols
    : DEFAULT_SYMBOLS;

  const results = [];

  for (const symbol of symbols) {
    try {
      const analysis = await analyzeSymbolForUser(userId, symbol);
      results.push(analysis);
    } catch (error) {
      results.push({
        symbol,
        signal: "WAIT",
        confidence: 0,
        finalScore: 0,
        entryQuality: "weak",
        strategyName: null,
        reasons: [],
        blocks: [error.message || "Erro ao analisar ativo."],
        explanation: error.message || "Erro ao analisar ativo.",
        strategies: [],
        mtf: {},
        marketContext: {},
        timestamp: new Date().toISOString()
      });
    }
  }

  const ordered = results.sort(
    (a, b) =>
      Number(b.finalScore || b.confidence || 0) -
      Number(a.finalScore || a.confidence || 0)
  );

  const bestOpportunity = ordered[0] || null;

  return {
    bestOpportunity,
    results: ordered,
    ranking: buildRanking(ordered),
    history: buildHistory(ordered),
    analytics: {
      historyStats: buildHistoryStats(ordered)
    },
    connection: {
      engineRunning: true,
      lastCycleAt: new Date().toISOString()
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  analyzeSymbolForUser,
  analyzePreferredSymbols,
  getUserModeConfig
};
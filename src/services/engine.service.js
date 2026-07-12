const userPreferencesRepository = require("../repositories/user-preferences.repository");
const { getTradingMode } = require("../config/trading-modes");
const { getMarketSnapshot } = require("./market-data.service");
const { explainSignal } = require("./signal-ai.service");
const { analyzeIndicators } = require("./indicator-engine.service");
const { runStrategies } = require("../strategy/strategy-runner.service");
const adaptiveService = require("./adaptive.service");
const predictiveAiService = require("./predictive-ai.service");
const filterAnalyticsService = require("./filter-analytics.service");
const engineDebugService = require("./engine-debug.service");
const signalRepository = require("../repositories/signal.repository");
const blockerAnalytics = require("./blocker-analytics.service");
const {
  decorateCryptoResult,
  findHezilexAsset,
  isHezilexCryptoMode,
  logCryptoAudit,
  selectCryptoAssetsForCycle
} = require("./market-mode.service");

const DEFAULT_SYMBOLS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD"];
const ANALYSIS_CACHE_TTL_MS = Math.max(60 * 1000, Number(process.env.ANALYSIS_CACHE_TTL_MS || 5 * 60 * 1000));
const MAX_CONCURRENT_ANALYSES = Math.max(1, Number(process.env.MAX_CONCURRENT_ANALYSES || 1));
const analysisCache = new Map();
const inFlightAnalyses = new Map();
let activeAnalyses = 0;

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
    structure: tfIndicators.structure || {},
    marketContext: tfIndicators.marketContext || {}
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
    expiryAt: expiry.toISOString(),
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
    marketRegime: strategyResult.marketRegime || "NORMAL",
    market_regime: strategyResult.marketRegime || "NORMAL",
    dynamicMinScore: strategyResult.dynamicMinScore || strategyResult.dynamicThresholds?.minimumScore || null,
    dynamicThresholds: strategyResult.dynamicThresholds || null,
    thresholdHistory: strategyResult.thresholdHistory || null,
    thresholdChanges: strategyResult.thresholdChanges || [],
    thresholdPerformance: strategyResult.thresholdPerformance || null,
    entryQuality: strategyResult.entryQuality || "weak",
    adaptiveAdjustment: Number(strategyResult.adaptiveAdjustment || 0),
    adaptive_adjustment: Number(strategyResult.adaptiveAdjustment || 0),
    adaptiveReasons: strategyResult.adaptiveReasons || [],
    adaptiveAdjustments: strategyResult.adaptiveAdjustments || {},
    learningProfile: strategyResult.learningProfile || null,
    antiLoss: strategyResult.antiLoss || {},
    preCheck: strategyResult.preCheck || {},
    predictiveAi: strategyResult.predictiveAi || null,
    marketStructure: strategyResult.marketStructure || strategyResult.metrics?.marketStructure || null,
    preSignalScore: strategyResult.preSignalScore || 0,
    blocked: strategyResult.blocked || false,
    blockReason: strategyResult.blockReason || null,
    opportunityClass: strategyResult.opportunityClass || strategyResult.status || null,
    risk: strategyResult.risk || null,
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
      marketRegime: strategyResult.marketRegime || "NORMAL",
      dynamicMinScore: strategyResult.dynamicMinScore || strategyResult.dynamicThresholds?.minimumScore || null,
      dynamicThresholds: strategyResult.dynamicThresholds || null,
      thresholdHistory: strategyResult.thresholdHistory || null,
      thresholdChanges: strategyResult.thresholdChanges || [],
      thresholdPerformance: strategyResult.thresholdPerformance || null,
      reasons: strategyResult.reasons,
      blocks: strategyResult.blocks,
      status: strategyResult.opportunityClass || strategyResult.status || null,
      risk: strategyResult.risk || null,
      userSummary: strategyResult.userSummary || null,
      explanation: strategyResult.explanation,
      strategies: strategyResult.strategies,
      mtf: strategyResult.mtf,
      adaptiveAdjustment: Number(strategyResult.adaptiveAdjustment || 0),
      adaptiveReasons: strategyResult.adaptiveReasons || [],
      adaptiveAdjustments: strategyResult.adaptiveAdjustments || {},
      learningProfile: strategyResult.learningProfile || null,
      antiLoss: strategyResult.antiLoss || {},
      preCheck: strategyResult.preCheck || {},
      predictiveAi: strategyResult.predictiveAi || null,
      marketStructure: strategyResult.marketStructure || strategyResult.metrics?.marketStructure || null,
      preSignalScore: strategyResult.preSignalScore || 0,
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
    activationReason: strategyResult.activationReason || null,
    strategies: Array.isArray(strategyResult.strategies) ? strategyResult.strategies : [],
    strategyEligibilityReport: strategyResult.strategyEligibilityReport || null,
    metrics: strategyResult.metrics || {},
    mtf: strategyResult.mtf || {},
    operationalTuning: strategyResult.operationalTuning || {},
    marketRegime: strategyResult.marketRegime || "NORMAL",
    dynamicMinScore: strategyResult.dynamicMinScore || null,
    marketStructure: strategyResult.marketStructure || strategyResult.metrics?.marketStructure || null
  };

  const finalScore = calculateFinalScore(safeResult, marketContext, strategyMode);

  return {
    ...safeResult,
    finalScore
  };
}

function buildPreCheckMetrics(predictiveDecision = {}) {
  return {
    blocked: Boolean(predictiveDecision.blocked),
    decision: predictiveDecision.decision || null,
    preScore: Number(predictiveDecision.preScore || 0),
    minimum: Number(predictiveDecision.minimum || 0),
    scoreAdjustment: Number(predictiveDecision.scoreAdjustment || 0),
    probableDirection: predictiveDecision.probableDirection || "WAIT",
    hour: predictiveDecision.hour ?? null,
    reasons: Array.isArray(predictiveDecision.reasons)
      ? predictiveDecision.reasons
      : [],
    risks: Array.isArray(predictiveDecision.risks)
      ? predictiveDecision.risks
      : [],
    criticalRisks: Array.isArray(predictiveDecision.criticalRisks)
      ? predictiveDecision.criticalRisks
      : [],
    severeRisks: Array.isArray(predictiveDecision.severeRisks)
      ? predictiveDecision.severeRisks
      : [],
    moderateRisks: Array.isArray(predictiveDecision.moderateRisks)
      ? predictiveDecision.moderateRisks
      : [],
    predictiveBlockScore: Number(predictiveDecision.predictiveBlockScore || predictiveDecision.preScore || 0),
    finalPredictiveScore: Number(predictiveDecision.finalPredictiveScore || predictiveDecision.preScore || 0),
    predictiveThreshold: Number(predictiveDecision.predictiveThreshold || predictiveDecision.minimum || 0),
    volatilityContribution: Number(predictiveDecision.volatilityContribution || 0),
    historicalContribution: Number(predictiveDecision.historicalContribution || 0),
    directionContribution: Number(predictiveDecision.directionContribution || 0),
    regimeContribution: Number(predictiveDecision.regimeContribution || 0),
    veryLowVolatilityBlock: Boolean(predictiveDecision.veryLowVolatilityBlock),
    lowVolatilityWarning: Boolean(predictiveDecision.lowVolatilityWarning),
    criticalRiskFlags: Array.isArray(predictiveDecision.criticalRiskFlags)
      ? predictiveDecision.criticalRiskFlags
      : [],
    shouldBlock: Boolean(predictiveDecision.shouldBlock),
    blockCondition: predictiveDecision.blockCondition || "NONE",
    blockReason: predictiveDecision.blockReason || null,
    scoreVsThresholdDecision: predictiveDecision.scoreVsThresholdDecision || null,
    explanation: predictiveDecision.explanation || null
  };
}

function hasCriticalLossPattern(preCheckMetrics = {}, antiLoss = {}) {
  const criticalText = [
    ...(preCheckMetrics.criticalRisks || []),
    antiLoss.reason || ""
  ]
    .join(" ")
    .toLowerCase();

  return (
    Boolean(antiLoss.blocked) ||
    criticalText.includes("padrão crítico") ||
    criticalText.includes("padrao critico") ||
    criticalText.includes("padrão severo") ||
    criticalText.includes("risco extremo")
  );
}

function getDynamicThresholdTolerance(mode) {
  if (mode === "aggressive") return 14;
  if (mode === "balanced") return 8;
  return 0;
}

function classifyOpportunity(result = {}, mode = "balanced") {
  if (result.blocked) return "BLOCKED";

  const signal = String(result.signal || result.direction || "WAIT").toUpperCase();
  const score = Number(result.finalScore || result.confidence || 0);

  if (!["CALL", "PUT"].includes(signal)) return "WATCHLIST";
  if (result.marketRegime === "FALLBACK_SIGNAL" || result.market_regime === "FALLBACK_SIGNAL") {
    return "FALLBACK_SIGNAL";
  }

  const highThreshold = mode === "conservative" ? 88 : mode === "aggressive" ? 78 : 82;
  const mediumThreshold = mode === "conservative" ? 80 : mode === "aggressive" ? 62 : 68;

  if (score >= highThreshold) return "HIGH_CONFIDENCE";
  if (score >= mediumThreshold) return "MEDIUM_CONFIDENCE";

  return "WATCHLIST";
}

function classifyRisk(result = {}) {
  if (result.blocked) return "CRITICAL";

  const score = Number(result.finalScore || result.confidence || 0);
  const penalties = Array.isArray(result.filterPenalties) ? result.filterPenalties.length : 0;

  if (score >= 82 && penalties === 0) return "LOW";
  if (score >= 68) return penalties >= 2 ? "MODERATE" : "CONTROLLED";

  return "ELEVATED";
}

function uniqueMessages(messages = []) {
  return [...new Set(messages.filter(Boolean))];
}

async function executeSymbolAnalysis(userId, symbol, providedSnapshot = null) {
  const { preferences, modeConfig } = await getUserModeConfig(userId);
  const marketAsset = isHezilexCryptoMode() ? findHezilexAsset(symbol) : null;
  const providerSymbol = marketAsset?.providerSymbol || symbol;
  const displaySymbol = marketAsset?.displayName || symbol;
  const snapshot = providedSnapshot || (await getMarketSnapshot(providerSymbol));
  if (marketAsset) {
    snapshot.symbol = displaySymbol;
    snapshot.providerSymbol = providerSymbol;
    snapshot.displayName = displaySymbol;
    snapshot.marketMode = "HEZILEX_CRYPTO";
  }
  const strategyMode = mapTradingModeToStrategyMode(preferences.trading_mode);

  const h1Indicators = analyzeIndicators(snapshot.timeframes.h1.candles, strategyMode);
  const m15Indicators = analyzeIndicators(snapshot.timeframes.m15.candles, strategyMode);
  const m5Indicators = analyzeIndicators(snapshot.timeframes.m5.candles, strategyMode);

  const predictiveDecision = await predictiveAiService.evaluatePreSignal({
    symbol: displaySymbol,
    providerSymbol,
    snapshot,
    mode: strategyMode
  });
  const preCheckMetrics = buildPreCheckMetrics(predictiveDecision);

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

  marketContext.marketRegime = strategyResult.marketRegime || "NORMAL";
  marketContext.dynamicMinScore = strategyResult.dynamicMinScore || null;
  marketContext.marketStructure = strategyResult.marketStructure || strategyResult.metrics?.marketStructure || null;

  const adaptiveContext = {
    symbol: displaySymbol,
    providerSymbol,
    signal: strategyResult.signal,
    strategyName: strategyResult.strategyName || "unknown",
    marketRegime: strategyResult.marketRegime || marketContext.marketRegime || "NORMAL",
    mode: strategyMode
  };

  const scoreBeforeAdaptiveAdjustment = Number(strategyResult.finalScore || 0) + Number(preCheckMetrics.scoreAdjustment || 0);
  const adaptive = await adaptiveService.applyAdaptiveScore(
    scoreBeforeAdaptiveAdjustment,
    adaptiveContext
  );
  const scoreAfterAdaptiveAdjustment = Number(adaptive.finalScore || 0);
  const hardBlock = await adaptiveService.shouldHardBlock(adaptiveContext);
  const dynamicThresholds = adaptive.dynamicThresholds || null;
  const dynamicMinimumScore = Number(dynamicThresholds?.minimumScore || strategyResult.dynamicMinScore || 0);
  const dynamicThresholdGap = dynamicMinimumScore - Number(adaptive.finalScore || 0);
  const dynamicThresholdBlocked = Boolean(
    dynamicMinimumScore && dynamicThresholdGap > getDynamicThresholdTolerance(strategyMode)
  );
  const dynamicThresholdPenalty = Boolean(
    dynamicMinimumScore && dynamicThresholdGap > 0 && !dynamicThresholdBlocked
  );

  const antiLoss = {
    blocked: Boolean(hardBlock?.blocked),
    reason: hardBlock?.reason || null,
    forcedWait: false
  };

  const criticalLossDetected = hasCriticalLossPattern(preCheckMetrics, antiLoss);
  const preCheckBlocked = Boolean(preCheckMetrics.blocked);
  const forceWait = preCheckBlocked || criticalLossDetected || dynamicThresholdBlocked;

  const finalSignal = forceWait ? "WAIT" : strategyResult.signal;
  const finalBlocks = uniqueMessages([
    ...strategyResult.blocks,
    ...(preCheckBlocked ? preCheckMetrics.severeRisks : []),
    ...(antiLoss.blocked ? [antiLoss.reason] : []),
    ...(criticalLossDetected ? ["Anti-loss forçou WAIT por padrão severo de perda."] : []),
    ...(dynamicThresholdBlocked
      ? [`Score abaixo do mínimo aprendido (${Number(adaptive.finalScore || 0).toFixed(1)} < ${dynamicMinimumScore}).`]
      : [])
  ]);

  const filterPenalties = [
    ...((preCheckMetrics.moderateRisks || []).map((reason) => ({
      filterName: "predictive_ai_penalty",
      filterLabel: "Predictive AI Penalty",
      reason,
      score: preCheckMetrics.preScore,
      finalScore: adaptive.finalScore,
      signal: strategyResult.signal,
      strategyName: strategyResult.strategyName || "predictive_ai_gate"
    }))),
    ...(!preCheckBlocked && (preCheckMetrics.severeRisks || []).map((reason) => ({
      filterName: "predictive_ai_penalty",
      filterLabel: "Predictive AI Penalty",
      reason,
      score: preCheckMetrics.preScore,
      finalScore: adaptive.finalScore,
      signal: strategyResult.signal,
      strategyName: strategyResult.strategyName || "predictive_ai_gate"
    }))),
    ...(dynamicThresholdPenalty
      ? [{
          filterName: "dynamic_threshold_penalty",
          filterLabel: "Dynamic Threshold Penalty",
          reason: `Score levemente abaixo do mínimo aprendido (${Number(adaptive.finalScore || 0).toFixed(1)} < ${dynamicMinimumScore}); convertido em penalidade.`,
          score: strategyResult.confidence,
          finalScore: adaptive.finalScore,
          signal: strategyResult.signal,
          strategyName: strategyResult.strategyName
        }]
      : []),
    ...((strategyResult.operationalTuning?.penaltyReasons || []).map((reason) => ({
      filterName: "market_quality_penalty",
      filterLabel: "Market Quality Penalty",
      reason,
      score: strategyResult.confidence,
      finalScore: adaptive.finalScore,
      signal: strategyResult.signal,
      strategyName: strategyResult.strategyName
    })))
  ];

  const filterBlocks = [
    ...(preCheckBlocked
      ? [{
          filterName: "predictive_ai_block",
          reason: preCheckMetrics.explanation || preCheckMetrics.risks[0] || "IA preditiva bloqueou antes do sinal.",
          score: preCheckMetrics.preScore,
          finalScore: preCheckMetrics.preScore,
          signal: strategyResult.signal,
          strategyName: strategyResult.strategyName || "predictive_ai_gate"
        }]
      : []),
    ...(antiLoss.blocked || criticalLossDetected
      ? [{
          filterName: "adaptive_block",
          reason: antiLoss.reason || "Anti-loss forçou WAIT por padrão crítico de perda.",
          score: strategyResult.confidence,
          finalScore: adaptive.finalScore,
          signal: strategyResult.signal,
          strategyName: strategyResult.strategyName
        }]
      : []),
    ...(dynamicThresholdBlocked
      ? [{
          filterName: "dynamic_threshold_block",
          reason: `Score abaixo do mínimo aprendido (${Number(adaptive.finalScore || 0).toFixed(1)} < ${dynamicMinimumScore}).`,
          score: strategyResult.confidence,
          finalScore: adaptive.finalScore,
          signal: strategyResult.signal,
          strategyName: strategyResult.strategyName
        }]
      : [])
  ];

  antiLoss.forcedWait = forceWait && criticalLossDetected;

  const explanation =
    preferences.ai_explanations_enabled !== false
      ? explainSignal({
          symbol: displaySymbol,
          signal: finalSignal,
          confidence: strategyResult.confidence,
          reasons: uniqueMessages([
            ...strategyResult.reasons,
            ...preCheckMetrics.reasons,
            ...(forceWait ? finalBlocks : [])
          ]),
          modeConfig
        })
      : strategyResult.explanation;

  const finalResult = {
    ...strategyResult,
    signal: finalSignal,
    direction: finalSignal,
    finalScore: forceWait && preCheckBlocked
      ? Math.min(Number(adaptive.finalScore || 0), preCheckMetrics.preScore)
      : adaptive.finalScore,
    blocks: finalBlocks,
    filterBlocks,
    filterPenalties,
    blocked: forceWait,
    blockReason: forceWait ? finalBlocks.join(" ") : null,
    adaptiveAdjustment: Number(adaptive.adaptiveAdjustment || 0),
    adaptive_adjustment: Number(adaptive.adaptiveAdjustment || 0),
    historicalStrategyWeight: Number(adaptive.historicalStrategyWeight || 0),
    historical_strategy_weight: Number(adaptive.historicalStrategyWeight || 0),
    historicalAdjustment: Number(adaptive.historicalAdjustment || 0),
    historical_adjustment: Number(adaptive.historicalAdjustment || 0),
    strategyIntelligence: adaptive.strategyIntelligence || null,
    scoreBeforeAdaptiveAdjustment,
    scoreAfterAdaptiveAdjustment,
    scoreUsedForApproval: forceWait && preCheckBlocked
      ? Math.min(Number(adaptive.finalScore || 0), preCheckMetrics.preScore)
      : Number(adaptive.finalScore || 0),
    executionAllowedReason: forceWait
      ? finalBlocks.join(" ")
      : "Entrada aprovada pelos critérios operacionais.",
    adaptiveReasons: adaptive.adaptiveReasons || [],
    dynamicThresholds,
    thresholdHistory: dynamicThresholds?.thresholdHistory || null,
    thresholdChanges: dynamicThresholds?.thresholdChanges || [],
    thresholdPerformance: dynamicThresholds?.thresholdPerformance || null,
    adaptiveAdjustments: {
      adjustment: adaptive.adaptiveAdjustment,
      reasons: adaptive.adaptiveReasons,
      audit: adaptive.adaptiveAdjustmentAudit,
      profile: adaptive.learningProfile
    },
    learningProfile: adaptive.learningProfile,
    antiLoss,
    preCheck: preCheckMetrics,
    predictiveAi: predictiveDecision,
    marketStructure: strategyResult.marketStructure || strategyResult.metrics?.marketStructure || null,
    preSignalScore: preCheckMetrics.preScore,
    preSignalMinimum: preCheckMetrics.minimum,
    preSignalScoreAdjustment: preCheckMetrics.scoreAdjustment,
    dynamicThresholdPenalty,
    explanation: forceWait
      ? `${explanation} ${preCheckMetrics.explanation || ""} ${antiLoss.reason || ""}`.trim()
      : explanation
  };

  finalResult.blockerAnalytics = blockerAnalytics.recordFinalGates(finalResult);
  finalResult.opportunityClass = classifyOpportunity(finalResult, strategyMode);
  finalResult.status = finalResult.opportunityClass;
  finalResult.risk = classifyRisk(finalResult);
  finalResult.userSummary = finalResult.blocked
    ? "Operação rejeitada por risco crítico."
    : finalResult.opportunityClass === "HIGH_CONFIDENCE"
      ? "Entrada forte com confluência institucional."
      : finalResult.opportunityClass === "MEDIUM_CONFIDENCE"
        ? "Entrada válida com risco controlado."
        : "Oportunidade monitorada; aguardar melhora de score/timing.";

  const legacySignal = buildLegacySignalShape(
    displaySymbol,
    finalResult,
    snapshot,
    strategyMode
  );

  if (finalResult.blocked || finalResult.filterPenalties?.length) {
    try {
      await filterAnalyticsService.recordSignalFilters({
        ...finalResult,
        symbol: displaySymbol,
        asset: displaySymbol,
        providerSymbol,
        userId,
        mode: strategyMode,
        timestamp: snapshot?.timestamp || new Date().toISOString()
      }, "engine_api");
    } catch (error) {
      console.error("Erro ao registrar analytics de filtros:", error.message || error);
    }
  }

  engineDebugService.recordFinalDecision({
    ...finalResult,
    symbol: displaySymbol,
    asset: displaySymbol,
    providerSymbol,
    mode: strategyMode,
    marketContext,
    timestamp: snapshot?.timestamp || new Date().toISOString()
  }, {
    source: "engine_api",
    stage: "analyze_symbol"
  });

  const analysisResult = {
    symbol: displaySymbol,
    asset: displaySymbol,
    displayName: displaySymbol,
    providerSymbol,
    marketMode: marketAsset ? "HEZILEX_CRYPTO" : "FOREX",
    signal: finalResult.signal,
    confidence: finalResult.confidence,
    finalScore: finalResult.finalScore,
    entryQuality: finalResult.entryQuality,
    strategyName: finalResult.strategyName,
    marketRegime: finalResult.marketRegime || "NORMAL",
    market_regime: finalResult.marketRegime || "NORMAL",
    dynamicMinScore: finalResult.dynamicMinScore || finalResult.dynamicThresholds?.minimumScore || null,
    dynamicThresholds: finalResult.dynamicThresholds || null,
    thresholdHistory: finalResult.thresholdHistory || null,
    thresholdChanges: finalResult.thresholdChanges || [],
    thresholdPerformance: finalResult.thresholdPerformance || null,
    reasons: finalResult.reasons,
    blocks: finalResult.blocks,
    explanation: finalResult.explanation,
    activationReason: finalResult.activationReason || null,
    strategies: finalResult.strategies,
    mtf: finalResult.mtf,
    marketStructure: finalResult.marketStructure || finalResult.metrics?.marketStructure || null,
    adaptiveAdjustment: finalResult.adaptiveAdjustment,
    adaptive_adjustment: finalResult.adaptiveAdjustment,
    historicalStrategyWeight: finalResult.historicalStrategyWeight,
    historical_strategy_weight: finalResult.historicalStrategyWeight,
    historicalAdjustment: finalResult.historicalAdjustment,
    historical_adjustment: finalResult.historicalAdjustment,
    strategyIntelligence: finalResult.strategyIntelligence,
    scoreBeforeAdaptiveAdjustment: finalResult.scoreBeforeAdaptiveAdjustment,
    scoreAfterAdaptiveAdjustment: finalResult.scoreAfterAdaptiveAdjustment,
    scoreUsedForApproval: finalResult.scoreUsedForApproval,
    executionAllowedReason: finalResult.executionAllowedReason,
    adaptiveReasons: finalResult.adaptiveReasons,
    adaptiveAdjustments: finalResult.adaptiveAdjustments,
    learningProfile: finalResult.learningProfile,
    antiLoss: finalResult.antiLoss,
    preCheck: finalResult.preCheck,
    predictiveAi: finalResult.predictiveAi,
    preSignalScore: finalResult.preSignalScore,
    preSignalMinimum: finalResult.preSignalMinimum,
    blocked: finalResult.blocked,
    blockReason: finalResult.blockReason,
    opportunityClass: finalResult.opportunityClass,
    status: finalResult.status,
    risk: finalResult.risk,
    userSummary: finalResult.userSummary,
    filterBlocks: finalResult.filterBlocks,
    filterPenalties: finalResult.filterPenalties,
    metrics: finalResult.metrics || {},
    finalResult: {
      signal: finalResult.signal,
      finalScore: finalResult.finalScore,
      blocks: finalResult.blocks,
      marketRegime: finalResult.marketRegime || "NORMAL",
      activationReason: finalResult.activationReason || null,
      dynamicMinScore: finalResult.dynamicMinScore || finalResult.dynamicThresholds?.minimumScore || null,
      dynamicThresholds: finalResult.dynamicThresholds || null,
      thresholdHistory: finalResult.thresholdHistory || null,
      thresholdChanges: finalResult.thresholdChanges || [],
      thresholdPerformance: finalResult.thresholdPerformance || null,
      adaptiveAdjustment: finalResult.adaptiveAdjustment,
      historicalStrategyWeight: finalResult.historicalStrategyWeight,
      historicalAdjustment: finalResult.historicalAdjustment,
      strategyIntelligence: finalResult.strategyIntelligence,
      scoreBeforeAdaptiveAdjustment: finalResult.scoreBeforeAdaptiveAdjustment,
      scoreAfterAdaptiveAdjustment: finalResult.scoreAfterAdaptiveAdjustment,
      scoreUsedForApproval: finalResult.scoreUsedForApproval,
      executionAllowedReason: finalResult.executionAllowedReason,
      adaptiveReasons: finalResult.adaptiveReasons,
      adaptiveAdjustments: finalResult.adaptiveAdjustments,
      learningProfile: finalResult.learningProfile,
      antiLoss: finalResult.antiLoss,
      preCheck: finalResult.preCheck,
      predictiveAi: finalResult.predictiveAi,
      marketStructure: finalResult.marketStructure || finalResult.metrics?.marketStructure || null,
      preSignalScore: finalResult.preSignalScore,
      preSignalMinimum: finalResult.preSignalMinimum,
      opportunityClass: finalResult.opportunityClass,
      status: finalResult.status,
      risk: finalResult.risk,
      userSummary: finalResult.userSummary,
      filterBlocks: finalResult.filterBlocks,
      filterPenalties: finalResult.filterPenalties,
      metrics: finalResult.metrics || {}
    },
    mode: modeConfig,
    strategyMode,
    currentSignal: legacySignal,
    signalCenter: buildSignalCenter(displaySymbol, finalResult, snapshot),
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

  if (marketAsset) {
    logCryptoAudit("symbol_analysis_completed", {
      displayName: displaySymbol,
      providerSymbol,
      provider: process.env.CRYPTO_PROVIDER || "twelvedata",
      selectedForCycle: true,
      timeframe: "5min,15min,1h",
      candleCount: snapshot?.dataQuality?.candles || null,
      spread: null,
      volume: null,
      volatility: snapshot?.timeframes?.m5?.volatilityPercent || null
    });
    return decorateCryptoResult(analysisResult, marketAsset);
  }

  return analysisResult;
}


function getAnalysisCacheKey(userId, symbol) {
  return `${userId || "anonymous"}:${String(symbol || "").trim().toUpperCase()}`;
}

function getCachedAnalysis(cacheKey) {
  const entry = analysisCache.get(cacheKey);

  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    analysisCache.delete(cacheKey);
    return null;
  }

  return {
    ...entry.value,
    cachedAnalysis: true,
    economicMode: {
      reused: true,
      reason: "recently_analyzed",
      analyzedAt: entry.analyzedAt,
      cacheTtlMs: ANALYSIS_CACHE_TTL_MS,
      maxConcurrentAnalyses: MAX_CONCURRENT_ANALYSES
    },
    timestamp: new Date().toISOString()
  };
}

function setCachedAnalysis(cacheKey, value) {
  analysisCache.set(cacheKey, {
    value,
    analyzedAt: new Date().toISOString(),
    expiresAt: Date.now() + ANALYSIS_CACHE_TTL_MS
  });
}

async function runWithAnalysisLimit(factory) {
  while (activeAnalyses >= MAX_CONCURRENT_ANALYSES) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  activeAnalyses += 1;

  try {
    return await factory();
  } finally {
    activeAnalyses = Math.max(0, activeAnalyses - 1);
  }
}

async function analyzeSymbolForUser(userId, symbol, providedSnapshot = null) {
  const cacheKey = getAnalysisCacheKey(userId, symbol);
  const cached = !providedSnapshot ? getCachedAnalysis(cacheKey) : null;

  if (cached) return cached;

  const inFlight = inFlightAnalyses.get(cacheKey);
  if (inFlight && !providedSnapshot) return inFlight;

  const request = runWithAnalysisLimit(async () => {
    const analysis = await executeSymbolAnalysis(userId, symbol, providedSnapshot);

    if (!providedSnapshot) {
      setCachedAnalysis(cacheKey, analysis);
    }

    return analysis;
  }).finally(() => {
    inFlightAnalyses.delete(cacheKey);
  });

  if (!providedSnapshot) {
    inFlightAnalyses.set(cacheKey, request);
  }

  return request;
}

function buildHistoryStats(results = []) {
  const actionable = results.filter(
    (item) => item && ["CALL", "PUT"].includes(String(item.signal || item.direction || "").toUpperCase())
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
  const analyzed = results.length;
  const blocked = results.filter((item) => item?.opportunityClass === "BLOCKED" || item?.blocked).length;
  const watchlist = results.filter((item) => item?.opportunityClass === "WATCHLIST").length;
  const highConfidence = results.filter((item) => item?.opportunityClass === "HIGH_CONFIDENCE").length;
  const mediumConfidence = results.filter((item) => item?.opportunityClass === "MEDIUM_CONFIDENCE").length;

  return {
    total,
    analyzed,
    approvalRate: analyzed ? Number(((total / analyzed) * 100).toFixed(2)) : 0,
    blockedRate: analyzed ? Number(((blocked / analyzed) * 100).toFixed(2)) : 0,
    watchlistRate: analyzed ? Number(((watchlist / analyzed) * 100).toFixed(2)) : 0,
    highConfidenceRate: analyzed ? Number(((highConfidence / analyzed) * 100).toFixed(2)) : 0,
    mediumConfidenceRate: analyzed ? Number(((mediumConfidence / analyzed) * 100).toFixed(2)) : 0,
    avgConfidence: Number(avgConfidence.toFixed(2)),
    avgFinalScore: Number(avgFinalScore.toFixed(2)),
    callCount,
    putCount
  };
}

function buildRanking(results = []) {
  return results.map((item) => ({
    symbol: item.displayName || item.symbol,
    asset: item.displayName || item.symbol,
    displayName: item.displayName || item.symbol,
    providerSymbol: item.providerSymbol || null,
    marketMode: item.marketMode || "FOREX",
    confidence: item.confidence,
    finalScore: Number(item.finalScore || item.confidence || 0),
    score: Number(item.finalScore || item.confidence || 0),
    signal: item.signal,
    direction: item.signal,
    entryQuality: item.entryQuality,
    strategyName: item.strategyName,
    marketRegime: item.marketRegime || "NORMAL",
    dynamicMinScore: item.dynamicMinScore || item.dynamicThresholds?.minimumScore || null,
    dynamicThresholds: item.dynamicThresholds || null,
    thresholdHistory: item.thresholdHistory || null,
    thresholdChanges: item.thresholdChanges || [],
    thresholdPerformance: item.thresholdPerformance || null,
    adaptiveAdjustment: Number(item.adaptiveAdjustment || 0),
    adaptiveReasons: item.adaptiveReasons || [],
    adaptiveAdjustments: item.adaptiveAdjustments || {},
    learningProfile: item.learningProfile || null,
    antiLoss: item.antiLoss || {},
    preCheck: item.preCheck || {},
    preSignalScore: item.preSignalScore || 0,
    blocked: item.blocked || false,
    blockReason: item.blockReason || null,
    opportunityClass: item.opportunityClass || item.status || null,
    status: item.status || item.opportunityClass || null,
    risk: item.risk || null,
    userSummary: item.userSummary || null
  }));
}

function buildHistory(results = []) {
  return results.map((item) => ({
    symbol: item.displayName || item.symbol,
    asset: item.displayName || item.symbol,
    displayName: item.displayName || item.symbol,
    providerSymbol: item.providerSymbol || null,
    marketMode: item.marketMode || "FOREX",
    meta: item.historyMeta || null,
    signal: item.signal,
    direction: item.signal,
    confidence: item.confidence,
    finalScore: Number(item.finalScore || item.confidence || 0),
    score: Number(item.finalScore || item.confidence || 0),
    result: "pending",
    mode: item.strategyMode || "balanced",
    strategyName: item.strategyName || null,
    marketRegime: item.marketRegime || "NORMAL",
    dynamicMinScore: item.dynamicMinScore || item.dynamicThresholds?.minimumScore || null,
    dynamicThresholds: item.dynamicThresholds || null,
    thresholdHistory: item.thresholdHistory || null,
    thresholdChanges: item.thresholdChanges || [],
    thresholdPerformance: item.thresholdPerformance || null,
    adaptiveAdjustment: Number(item.adaptiveAdjustment || 0),
    adaptiveReasons: item.adaptiveReasons || [],
    adaptiveAdjustments: item.adaptiveAdjustments || {},
    learningProfile: item.learningProfile || null,
    antiLoss: item.antiLoss || {},
    preCheck: item.preCheck || {},
    preSignalScore: item.preSignalScore || 0,
    blocked: item.blocked || false,
    blockReason: item.blockReason || null,
    opportunityClass: item.opportunityClass || item.status || null,
    status: item.status || item.opportunityClass || null,
    risk: item.risk || null,
    userSummary: item.userSummary || null,
    timestamp: item.timestamp
  }));
}

async function analyzePreferredSymbols(userId) {
  const { preferences } = await getUserModeConfig(userId);
  const symbols = isHezilexCryptoMode()
    ? selectCryptoAssetsForCycle({ strategyMode: mapTradingModeToStrategyMode(preferences.trading_mode) }).map((asset) => asset.displayName)
    : (preferences.preferred_symbols?.length ? preferences.preferred_symbols : DEFAULT_SYMBOLS);

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
        marketRegime: "ERROR",
        dynamicMinScore: null,
        dynamicThresholds: null,
        thresholdHistory: null,
        thresholdChanges: [],
        thresholdPerformance: null,
        adaptiveAdjustment: 0,
        adaptiveReasons: [],
        adaptiveAdjustments: {},
        learningProfile: null,
        antiLoss: {},
        preCheck: {},
        preSignalScore: 0,
        blocked: true,
        blockReason: error.message || "Erro ao analisar ativo.",
        timestamp: new Date().toISOString()
      });

      engineDebugService.recordFinalDecision({
        symbol,
        signal: "WAIT",
        confidence: 0,
        finalScore: 0,
        blocked: true,
        blockReason: error.message || "Erro ao analisar ativo.",
        marketRegime: "ERROR"
      }, {
        source: "engine_api",
        stage: "analyze_preferred_error",
        filterName: "engine_error",
        blockReason: error.message || "Erro ao analisar ativo."
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

async function getOperationalOverview() {
  return signalRepository.getOperationalOverview();
}

module.exports = {
  analyzeSymbolForUser,
  analyzePreferredSymbols,
  getOperationalOverview,
  getUserModeConfig,
  getDebugSummary: engineDebugService.getDebugSummary
};

const {
  createEnabledStrategies,
  getStrategyModeWeights
} = require("./index");
const { getLastATR } = require("../indicators/atr.indicator");
const blockerAnalytics = require("../services/blocker-analytics.service");
const { analyzeCandlestickPatterns, emitCandlestickPatternAudit } = require("../services/candlestick-pattern.service");
const MarketStructureService = require("../services/market-structure.service");

function normalizeMode(mode = "balanced") {
  const normalized = String(mode || "balanced").toLowerCase();

  if (["conservador", "conservative"].includes(normalized)) return "conservative";
  if (["agressivo", "aggressive"].includes(normalized)) return "aggressive";

  return "balanced";
}

function getModeRules(mode = "balanced") {
  const normalized = normalizeMode(mode);

  const rules = {
    conservative: {
      minScore: 78,
      targetApprovalRate: "10-20%",
      penalties: {
        weakTrend: 8,
        lowVolatility: 10,
        weakAlignment: 9,
        highVolatility: 6,
        fallbackData: 18,
        regime: 0
      },
      blockers: {
        lowVolatility: 0.12,
        veryLowVolatility: 0.05,
        veryWeakTrend: 0.08,
        weakAlignment: 2,
        insufficientCandles: 60,
        fallbackData: true
      },
      weights: getStrategyModeWeights("conservative")
    },
    balanced: {
      minScore: 68,
      targetApprovalRate: "20-35%",
      penalties: {
        weakTrend: 7,
        lowVolatility: 7,
        weakAlignment: 6,
        highVolatility: 4,
        fallbackData: 12,
        regime: 0
      },
      blockers: {
        lowVolatility: 0.06,
        veryLowVolatility: 0.025,
        veryWeakTrend: 0.045,
        weakAlignment: 1,
        insufficientCandles: 45,
        fallbackData: true
      },
      weights: getStrategyModeWeights("balanced")
    },
    aggressive: {
      minScore: 61,
      targetApprovalRate: "35-55%",
      penalties: {
        weakTrend: 5,
        lowVolatility: 5,
        weakAlignment: 4,
        highVolatility: 3,
        fallbackData: 9,
        regime: 0
      },
      blockers: {
        lowVolatility: 0.04,
        veryLowVolatility: 0.02,
        veryWeakTrend: 0.03,
        weakAlignment: 0,
        insufficientCandles: 30,
        fallbackData: true
      },
      weights: getStrategyModeWeights("aggressive")
    }
  };

  return rules[normalized];
}

function roundMetric(value, decimals = 6) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return null;

  return Number(numeric.toFixed(decimals));
}

const INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_SCORE = 75;
const INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_ALIGNMENT = 2;
const INSTITUTIONAL_VOLATILITY_OVERRIDE_SCORE_PENALTY = 5;

function isInstitutionalVolatilityOverrideEligible({ mode = "balanced", score = 0, alignment = 0 } = {}) {
  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === "conservative") return false;

  return (
    Number(score || 0) >= INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_SCORE &&
    Number(alignment || 0) >= INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_ALIGNMENT
  );
}

function buildInstitutionalVolatilityOverrideAudit({
  snapshot,
  score = 0,
  volatility = 0,
  overrideApplied = false,
  finalDecision = "not_applicable"
} = {}) {
  return {
    symbol: snapshot?.symbol || snapshot?.asset || null,
    score: roundMetric(score, 2),
    volatility: roundMetric(volatility),
    overrideApplied: Boolean(overrideApplied),
    finalDecision
  };
}

function getLastClose(candles = []) {
  if (!Array.isArray(candles) || candles.length === 0) return null;

  const lastCandle = candles[candles.length - 1] || {};
  const close = Number(lastCandle.close);

  return Number.isFinite(close) && close > 0 ? close : null;
}

function buildVolatilityAudit({ snapshot, mtf, mode = "balanced", marketRegime = null, candidate = {} } = {}) {
  const normalizedMode = normalizeMode(mode);
  const rules = getModeRules(normalizedMode);
  const m5 = snapshot?.timeframes?.m5 || {};
  const candles = Array.isArray(m5.candles) ? m5.candles : [];
  const atr = getLastATR(candles, 14);
  const lastClose = getLastClose(candles);
  const atrPercent = atr !== null && lastClose
    ? (Number(atr) / lastClose) * 100
    : null;
  const calculatedVolatility = Number(m5.volatilityPercent || 0);
  const lowVolatilityRegimeThreshold = 0.1;
  const lowVolatilityValidationThreshold = 0.12;
  const veryLowVolatilityThreshold = Number(rules.blockers.veryLowVolatility);
  const lowVolatilityReleaseThreshold = getLowVolatilityReleaseThreshold(normalizedMode);
  const lowVolatilityCandidateScore = getCandidateScore(candidate);
  const isLowVolatility = calculatedVolatility > 0 && calculatedVolatility < lowVolatilityValidationThreshold;
  const isVeryLowVolatility = calculatedVolatility > 0 && calculatedVolatility < veryLowVolatilityThreshold;
  const isLowVolatilityScoreReleaseEligible = Boolean(
    lowVolatilityReleaseThreshold !== null &&
    lowVolatilityCandidateScore > lowVolatilityReleaseThreshold
  );
  const institutionalVolatilityOverrideEligible = isInstitutionalVolatilityOverrideEligible({
    mode: normalizedMode,
    score: lowVolatilityCandidateScore,
    alignment: Number(mtf?.alignment || 0)
  });
  const institutionalVolatilityOverrideApplied = Boolean(
    isVeryLowVolatility &&
    !isLowVolatilityScoreReleaseEligible &&
    institutionalVolatilityOverrideEligible
  );
  const shouldHardBlockVeryLowVolatility = Boolean(
    isVeryLowVolatility &&
    !isLowVolatilityScoreReleaseEligible &&
    !institutionalVolatilityOverrideApplied
  );
  const institutionalVolatilityOverride = buildInstitutionalVolatilityOverrideAudit({
    snapshot,
    score: lowVolatilityCandidateScore,
    volatility: calculatedVolatility,
    overrideApplied: institutionalVolatilityOverrideApplied,
    finalDecision: shouldHardBlockVeryLowVolatility
      ? "hard_block"
      : institutionalVolatilityOverrideApplied
        ? "override_penalty_final_validation"
        : "standard_validation"
  });

  return {
    atr: roundMetric(atr),
    atrPercent: roundMetric(atrPercent),
    calculatedVolatility: roundMetric(calculatedVolatility),
    thresholds: {
      regimeLowVolatility: lowVolatilityRegimeThreshold,
      validationLowVolatility: lowVolatilityValidationThreshold,
      validationVeryLowVolatility: veryLowVolatilityThreshold,
      scoreRelease: lowVolatilityReleaseThreshold
    },
    institutionalVolatilityOverride,
    regime: {
      final: marketRegime,
      classifiedAsLowVolatility: calculatedVolatility > 0 && calculatedVolatility < lowVolatilityRegimeThreshold,
      reason: calculatedVolatility > 0 && calculatedVolatility < lowVolatilityRegimeThreshold
        ? `volatility ${roundMetric(calculatedVolatility)} < regimeLowVolatility ${lowVolatilityRegimeThreshold}`
        : `volatility ${roundMetric(calculatedVolatility)} >= regimeLowVolatility ${lowVolatilityRegimeThreshold} ou sem volatilidade positiva`,
      mtfAlignment: Number(mtf?.alignment || 0),
      mtfAligned: Boolean(mtf?.isAligned)
    },
    validation: {
      isLowVolatility,
      isLowVolatilityWhy: isLowVolatility
        ? `volatility ${roundMetric(calculatedVolatility)} > 0 e < validationLowVolatility ${lowVolatilityValidationThreshold}`
        : `volatility ${roundMetric(calculatedVolatility)} não está entre 0 e ${lowVolatilityValidationThreshold}`,
      isVeryLowVolatility,
      isVeryLowVolatilityWhy: isVeryLowVolatility
        ? `volatility ${roundMetric(calculatedVolatility)} > 0 e < validationVeryLowVolatility ${veryLowVolatilityThreshold} (${normalizedMode})`
        : `volatility ${roundMetric(calculatedVolatility)} não está entre 0 e ${veryLowVolatilityThreshold} (${normalizedMode})`,
      scoreReleaseEligible: isLowVolatilityScoreReleaseEligible,
      scoreReleaseWhy: lowVolatilityReleaseThreshold === null
        ? `modo ${normalizedMode} não possui liberação por score`
        : `candidateScore ${roundMetric(lowVolatilityCandidateScore, 2)} ${isLowVolatilityScoreReleaseEligible ? ">" : "<="} scoreRelease ${lowVolatilityReleaseThreshold}`,
      institutionalVolatilityOverrideEligible,
      institutionalVolatilityOverrideWhy: institutionalVolatilityOverrideEligible
        ? `candidateScore ${roundMetric(lowVolatilityCandidateScore, 2)} >= ${INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_SCORE} e alignment ${Number(mtf?.alignment || 0)} >= ${INSTITUTIONAL_VOLATILITY_OVERRIDE_MIN_ALIGNMENT}`
        : `modo ${normalizedMode}, candidateScore ${roundMetric(lowVolatilityCandidateScore, 2)} e alignment ${Number(mtf?.alignment || 0)} não atendem override institucional`,
      shouldHardBlockVeryLowVolatility,
      shouldHardBlockVeryLowVolatilityWhy: shouldHardBlockVeryLowVolatility
        ? "isVeryLowVolatility=true sem scoreReleaseEligible e sem institutionalVolatilityOverrideEligible"
        : "não combina isVeryLowVolatility=true com bloqueio institucional obrigatório"
    }
  };
}

function emitVolatilityAuditLog(payload) {
  console.log(JSON.stringify({
    scope: "aerix_volatility_regime_audit",
    event: "volatility_regime_evaluation",
    timestamp: new Date().toISOString(),
    ...payload
  }));
}

function buildMtfContext(snapshot) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};

  const trends = [h1.direction, m15.direction, m5.direction];

  const upCount = trends.filter((t) => t === "up").length;
  const downCount = trends.filter((t) => t === "down").length;

  let dominantDirection = "neutral";
  if (upCount > downCount) dominantDirection = "up";
  if (downCount > upCount) dominantDirection = "down";

  return {
    h1: {
      trend: h1.direction || "neutral",
      aligned: dominantDirection !== "neutral" && h1.direction === dominantDirection
    },
    m15: {
      trend: m15.direction || "neutral",
      aligned: dominantDirection !== "neutral" && m15.direction === dominantDirection
    },
    m5: {
      trend: m5.direction || "neutral",
      aligned: dominantDirection !== "neutral" && m5.direction === dominantDirection
    },
    dominantDirection,
    alignment: Math.max(upCount, downCount),
    isAligned: upCount === 3 || downCount === 3
  };
}

function classifyMarketRegime(snapshot, mtf = buildMtfContext(snapshot)) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};

  const volatility = Number(m5.volatilityPercent || 0);
  const h1Strength = Number(h1.strengthPercent || 0);
  const m15Strength = Number(m15.strengthPercent || 0);
  const m5Strength = Number(m5.strengthPercent || 0);
  const avgStrength = (h1Strength + m15Strength + m5Strength) / 3;
  const dataQuality = snapshot?.dataQuality || {};

  if (snapshot?.isFallback || dataQuality.isFallback) return "FALLBACK_DATA";
  if (volatility > 0 && volatility < 0.1) return "LOW_VOLATILITY";
  if (volatility >= 0.6) return "HIGH_VOLATILITY";
  if (mtf.isAligned && (h1Strength >= 0.35 || m15Strength >= 0.24)) return "TRENDING";
  if (mtf.alignment >= 2 && volatility >= 0.36 && avgStrength >= 0.22) return "BREAKOUT";
  if (mtf.alignment === 2 && h1.direction && m5.direction && h1.direction !== m5.direction) return "REVERSAL";
  if (mtf.alignment < 2 || avgStrength < 0.14) return "RANGING";

  return "TRENDING";
}

function getRegimeThresholdOffset(marketRegime, mode = "balanced") {
  const normalizedMode = normalizeMode(mode);
  const offsets = {
    conservative: {
      TRENDING: -2,
      RANGING: 5,
      BREAKOUT: 2,
      REVERSAL: 7,
      HIGH_VOLATILITY: 6,
      LOW_VOLATILITY: 6,
      FALLBACK_DATA: 12,
      FALLBACK_SIGNAL: 12
    },
    balanced: {
      TRENDING: -3,
      RANGING: 2,
      BREAKOUT: -1,
      REVERSAL: 3,
      HIGH_VOLATILITY: 3,
      LOW_VOLATILITY: 4,
      FALLBACK_DATA: 12,
      FALLBACK_SIGNAL: 12
    },
    aggressive: {
      TRENDING: -5,
      RANGING: 0,
      BREAKOUT: -4,
      REVERSAL: -1,
      HIGH_VOLATILITY: 1,
      LOW_VOLATILITY: 2,
      FALLBACK_DATA: 12,
      FALLBACK_SIGNAL: 12
    }
  };

  return offsets[normalizedMode][marketRegime] ?? 0;
}

function getDynamicMinScore(modeRules, marketRegime, mode = "balanced") {
  const dynamicMinScore = Number(modeRules?.minScore || 68) + getRegimeThresholdOffset(marketRegime, mode);

  return Math.max(52, Math.min(92, Number(dynamicMinScore.toFixed(2))));
}

function getDynamicScoreTolerance(mode = "balanced") {
  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === "aggressive") return 16;
  if (normalizedMode === "balanced") return 10;

  return 0;
}

function getLowVolatilityReleaseThreshold(mode = "balanced") {
  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === "balanced") return 90;
  if (normalizedMode === "aggressive") return 80;

  return null;
}

function getCandidateScore(candidate = {}) {
  const score = Number(candidate?.weightedScore ?? candidate?.score ?? candidate?.rawScore ?? 0);

  return Number.isFinite(score) ? score : 0;
}

function applyWeight(result, weight = 1) {
  const raw = Number(result?.score || 0);
  const weighted = Math.min(100, Number((raw * weight).toFixed(2)));

  return {
    ...result,
    rawScore: raw,
    weightedScore: weighted
  };
}

function unique(items = [], limit = 10) {
  return [...new Set(items.filter(Boolean))].slice(0, limit);
}

function buildEntryQuality(confidence) {
  if (confidence >= 92) return "institutional";
  if (confidence >= 85) return "strong";
  if (confidence >= 75) return "good";
  if (confidence >= 65) return "moderate";
  return "weak";
}


function getExpectedDirectionForTrend(mtf = {}) {
  if (mtf.dominantDirection === "up") return "CALL";
  if (mtf.dominantDirection === "down") return "PUT";
  return null;
}

function getFallbackSignalEligibility({ best, mtf, mode = "balanced" }) {
  const normalizedMode = normalizeMode(mode);
  const expectedDirection = getExpectedDirectionForTrend(mtf);
  const directionConsistent = Boolean(
    expectedDirection && best?.direction === expectedDirection
  );
  const allowedMode = normalizedMode === "balanced" || normalizedMode === "aggressive";

  return {
    allowedMode,
    trendAlignment: Number(mtf?.alignment || 0),
    strategyScore: Number(best?.rawScore || best?.score || 0),
    expectedDirection,
    directionConsistent,
    eligible: Boolean(
      allowedMode &&
      Number(mtf?.alignment || 0) >= 3 &&
      Number(best?.rawScore || best?.score || 0) >= 90 &&
      directionConsistent
    )
  };
}

function safeEvaluateStrategy(strategy, payload) {
  try {
    const result = strategy.evaluate(payload);

    return {
      name: result?.name || "unknown_strategy",
      valid: Boolean(result?.valid),
      direction: result?.direction || null,
      score: Number(result?.score || 0),
      context: result?.context || {},
      explanation: result?.explanation || "",
      eligibilityAudit: result?.eligibilityAudit || null,
      activationReason: result?.eligibilityAudit?.activationReason || null
    };
  } catch (error) {
    return {
      name: strategy?.name || "unknown_strategy",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: error?.message || "Erro ao executar estratégia.",
      eligibilityAudit: null,
      activationReason: null
    };
  }
}

function validateMarketConditions(snapshot, mtf, mode = "balanced", candidate = {}) {
  const normalizedMode = normalizeMode(mode);
  const rules = getModeRules(normalizedMode);
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};
  const volatility = Number(m5.volatilityPercent || 0);
  const h1Strength = Number(h1.strengthPercent || 0);
  const m15Strength = Number(m15.strengthPercent || 0);
  const avgTrendStrength = (h1Strength + m15Strength) / 2;
  const dataQuality = snapshot?.dataQuality || {};
  const provider = dataQuality.provider || snapshot?.provider || null;
  const providerStatus = dataQuality.providerStatus || null;
  const apiResponse = dataQuality.apiResponse || null;
  const fallbackReason = dataQuality.fallbackReason || null;
  const fallbackSource = dataQuality.fallbackSource || null;
  const marketDataSource = dataQuality.marketDataSource || dataQuality.source || snapshot?.source || null;

  const volatilityAudit = buildVolatilityAudit({
    snapshot,
    mtf,
    mode: normalizedMode,
    marketRegime: classifyMarketRegime(snapshot, mtf),
    candidate
  });
  const isLowVolatility = volatilityAudit.validation.isLowVolatility;
  const isVeryLowVolatility = volatilityAudit.validation.isVeryLowVolatility;
  const isWeakTrend = avgTrendStrength > 0 && avgTrendStrength < 0.14;
  const isVeryWeakTrend = avgTrendStrength > 0 && avgTrendStrength < rules.blockers.veryWeakTrend;
  const isWeakAlignment = mtf.alignment < 2;
  const isSevereWeakAlignment = mtf.alignment <= rules.blockers.weakAlignment;
  const isHighVolatility = volatility >= 0.6;
  const lowVolatilityReleaseThreshold = getLowVolatilityReleaseThreshold(normalizedMode);
  const lowVolatilityCandidateScore = getCandidateScore(candidate);
  const isLowVolatilityScoreReleaseEligible = Boolean(
    lowVolatilityReleaseThreshold !== null &&
    lowVolatilityCandidateScore > lowVolatilityReleaseThreshold
  );
  const institutionalVolatilityOverrideEligible = isInstitutionalVolatilityOverrideEligible({
    mode: normalizedMode,
    score: lowVolatilityCandidateScore,
    alignment: mtf.alignment
  });
  const institutionalVolatilityOverrideApplied = Boolean(
    isVeryLowVolatility &&
    !isLowVolatilityScoreReleaseEligible &&
    institutionalVolatilityOverrideEligible
  );
  const shouldHardBlockVeryLowVolatility = Boolean(
    isVeryLowVolatility &&
    !isLowVolatilityScoreReleaseEligible &&
    !institutionalVolatilityOverrideApplied
  );
  const isFallbackData = Boolean(snapshot?.isFallback || dataQuality.isFallback);
  const minimumCandles = rules.blockers.insufficientCandles;
  const hasInsufficientCandles = ["m5", "m15", "h1"].some((timeframe) => {
    const candles = snapshot?.timeframes?.[timeframe]?.candles || [];
    return candles.length < minimumCandles;
  });

  const conservativeModerateBlocks = normalizedMode === "conservative"
    ? [
        isLowVolatility && !isVeryLowVolatility ? "Modo conservador bloqueou baixa volatilidade moderada." : null,
        isWeakTrend && !isVeryWeakTrend ? "Modo conservador bloqueou trend strength fraco." : null,
        isWeakAlignment && !isSevereWeakAlignment ? "Modo conservador bloqueou alinhamento intermediário." : null,
        isHighVolatility ? "Modo conservador bloqueou volatilidade elevada." : null
      ]
    : [];

  const blocks = [
    isFallbackData && normalizedMode === "conservative" ? "Fonte de dados em fallback; modo conservador mantém bloqueio operacional." : null,
    hasInsufficientCandles ? "Histórico insuficiente de candles para validação institucional." : null,
    shouldHardBlockVeryLowVolatility ? "Baixa liquidez severa / volatilidade extremamente baixa." : null,
    isVeryWeakTrend ? "Tendência muito fraca para entrada institucional." : null,
    isSevereWeakAlignment ? "Inconsistência grave entre timeframes." : null,
    ...conservativeModerateBlocks
  ].filter(Boolean);

  const penalties = [
    isLowVolatility && !isVeryLowVolatility && normalizedMode !== "conservative"
      ? { reason: "Baixa volatilidade convertida em penalidade de score.", value: rules.penalties.lowVolatility }
      : null,
    isVeryLowVolatility && isLowVolatilityScoreReleaseEligible
      ? { reason: `Baixa volatilidade severa liberada por score ${lowVolatilityCandidateScore} acima do corte ${lowVolatilityReleaseThreshold}; penalidade mantida.`, value: rules.penalties.lowVolatility }
      : null,
    institutionalVolatilityOverrideApplied
      ? { reason: `Override institucional de volatilidade extrema aplicado: score ${roundMetric(lowVolatilityCandidateScore, 2)} e alinhamento ${mtf.alignment}/3; penalidade fixa mantida.`, value: INSTITUTIONAL_VOLATILITY_OVERRIDE_SCORE_PENALTY }
      : null,
    isWeakTrend && !isVeryWeakTrend && normalizedMode !== "conservative"
      ? { reason: "Trend strength fraco convertido em penalidade de score.", value: rules.penalties.weakTrend }
      : null,
    isWeakAlignment && !isSevereWeakAlignment && normalizedMode !== "conservative"
      ? { reason: "Alinhamento moderado entre timeframes convertido em penalidade.", value: rules.penalties.weakAlignment }
      : null,
    isHighVolatility && normalizedMode !== "conservative"
      ? { reason: "Alta volatilidade aplicada como ajuste conservador de score.", value: rules.penalties.highVolatility }
      : null,
    isFallbackData && normalizedMode !== "conservative"
      ? { reason: "Fonte de dados em fallback convertida em penalidade operacional.", value: rules.penalties.fallbackData }
      : null
  ].filter(Boolean);

  const institutionalVolatilityOverride = buildInstitutionalVolatilityOverrideAudit({
    snapshot,
    score: lowVolatilityCandidateScore,
    volatility,
    overrideApplied: institutionalVolatilityOverrideApplied,
    finalDecision: shouldHardBlockVeryLowVolatility
      ? "hard_block"
      : institutionalVolatilityOverrideApplied
        ? "override_penalty_final_validation"
        : "standard_validation"
  });

  volatilityAudit.institutionalVolatilityOverride = institutionalVolatilityOverride;

  return {
    isLowVolatility,
    isVeryLowVolatility,
    shouldHardBlockVeryLowVolatility,
    volatilityAudit,
    lowVolatilityRelease: {
      threshold: lowVolatilityReleaseThreshold,
      candidateScore: lowVolatilityCandidateScore,
      eligible: isLowVolatilityScoreReleaseEligible,
      applied: Boolean(isVeryLowVolatility && isLowVolatilityScoreReleaseEligible)
    },
    institutionalVolatilityOverride: {
      ...institutionalVolatilityOverride,
      scorePenalty: institutionalVolatilityOverrideApplied ? INSTITUTIONAL_VOLATILITY_OVERRIDE_SCORE_PENALTY : 0
    },
    isWeakTrend,
    isVeryWeakTrend,
    isWeakAlignment,
    isSevereWeakAlignment,
    isHighVolatility,
    isFallbackData,
    provider,
    providerStatus,
    apiResponse,
    fallbackReason,
    fallbackSource,
    marketDataSource,
    hasInsufficientCandles,
    penaltyScore: penalties.reduce((total, penalty) => total + penalty.value, 0),
    penaltyReasons: penalties.map((penalty) => penalty.reason),
    blocks,
    shouldBlock: blocks.length > 0
  };
}


function buildStrategyAuditSnapshot({ snapshot, mtf, marketRegime, dynamicMinScore, evaluated, validStrategies, best, marketValidation, marketStructure, confidence, result, absenceReason, mode }) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};
  const strategyDiagnostics = evaluated.map((item) => ({
    name: item.name,
    valid: item.valid,
    direction: item.direction ?? null,
    rawScore: item.rawScore,
    weightedScore: item.weightedScore,
    explanation: item.explanation || null,
    eligibilityAudit: item.eligibilityAudit || null,
    activationReason: item.activationReason || item.eligibilityAudit?.activationReason || null
  }));

  return {
    scope: "aerix_direction_audit",
    event: "strategy_direction_generation",
    timestamp: new Date().toISOString(),
    mode: normalizeMode(mode),
    trendDirection: {
      h1: h1.direction || "neutral",
      m15: m15.direction || "neutral",
      m5: m5.direction || "neutral",
      dominant: mtf.dominantDirection
    },
    trendStrength: {
      h1: Number(h1.strengthPercent || 0),
      m15: Number(m15.strengthPercent || 0),
      m5: Number(m5.strengthPercent || 0),
      alignment: mtf.alignment,
      isAligned: mtf.isAligned
    },
    momentum: {
      bestStrategy: best?.name || null,
      bestStrategyDirection: best?.direction ?? null,
      sameDirectionConfirmations: best
        ? validStrategies.filter((item) => item.direction === best.direction).length
        : 0
    },
    volatility: Number(m5.volatilityPercent || 0),
    volatilityAudit: marketValidation?.volatilityAudit || null,
    marketStructure: marketStructure || result?.marketStructure || null,
    marketRegime,
    provider: snapshot?.dataQuality?.provider || null,
    providerStatus: snapshot?.dataQuality?.providerStatus || null,
    apiResponse: snapshot?.dataQuality?.apiResponse || null,
    fallbackReason: snapshot?.dataQuality?.fallbackReason || null,
    fallbackSource: snapshot?.dataQuality?.fallbackSource || null,
    marketDataSource: snapshot?.dataQuality?.marketDataSource || snapshot?.dataQuality?.source || snapshot?.source || null,
    fallbackConditions: snapshot?.dataQuality?.fallbackConditions || null,
    timeframeAudits: snapshot?.dataQuality?.timeframeAudits || null,
    finalScore: Number(result?.finalScore ?? result?.confidence ?? confidence ?? 0),
    confidence: Number(result?.confidence ?? confidence ?? 0),
    calculatedDirection: result?.signal ?? null,
    directionAbsenceReason: absenceReason || null,
    dynamicMinScore,
    marketValidation,
    strategyDiagnostics
  };
}

function emitDirectionAuditLog(payload) {
  console.log(JSON.stringify(payload));
}

function buildStrategyEligibilityReport(evaluated = []) {
  const reportByStrategy = evaluated.map((item) => {
    const audit = item.eligibilityAudit || {};
    const activated = Boolean(item.valid && item.direction);
    const blocked = !activated;

    return {
      strategyName: item.name,
      activationRate: activated ? 100 : 0,
      blockRate: blocked ? 100 : 0,
      activated,
      blocked,
      direction: item.direction || null,
      criteriaPassed: Number(audit.criteriaPassed || 0),
      criteriaFailed: Number(audit.criteriaFailed || 0),
      blockedBy: activated ? null : audit.blockedBy || item.explanation || null,
      activationReason: activated ? audit.activationReason || `Estratégia ${item.name} aprovada para ${item.direction}` : null,
      partialScore: Number(audit.score ?? item.rawScore ?? item.score ?? 0),
      rawScore: Number(item.rawScore || item.score || 0),
      weightedScore: Number(item.weightedScore || 0)
    };
  });

  const closestToSignal = [...reportByStrategy]
    .filter((item) => !item.activated)
    .sort((left, right) => {
      if (right.partialScore !== left.partialScore) {
        return right.partialScore - left.partialScore;
      }

      return left.criteriaFailed - right.criteriaFailed;
    })[0] || null;

  return {
    strategyCount: reportByStrategy.length,
    activeStrategies: reportByStrategy.filter((item) => item.activated).length,
    blockedStrategies: reportByStrategy.filter((item) => item.blocked).length,
    byStrategy: reportByStrategy,
    closestToSignal
  };
}

function buildStrategyEligibilityAuditLog({ snapshot, mode, mtf, marketRegime, dynamicMinScore, evaluated, validStrategies, best }) {
  const report = buildStrategyEligibilityReport(evaluated);

  return {
    scope: "aerix_strategy_eligibility_audit",
    event: "strategyEligibilityAudit",
    timestamp: new Date().toISOString(),
    mode: normalizeMode(mode),
    symbol: snapshot?.symbol || snapshot?.asset || null,
    marketRegime,
    dynamicMinScore,
    bestStrategy: best?.name || null,
    bestDirection: best?.direction || null,
    bestScore: best ? getCandidateScore(best) : 0,
    validStrategyCount: validStrategies.length,
    trendDirection: {
      h1: mtf?.h1?.direction || mtf?.h1?.trend || "neutral",
      m15: mtf?.m15?.direction || mtf?.m15?.trend || "neutral",
      m5: mtf?.m5?.direction || mtf?.m5?.trend || "neutral",
      dominant: mtf?.dominantDirection || null,
      alignment: Number(mtf?.alignment || 0)
    },
    strategies: evaluated.map((item) => ({
      name: item.name,
      valid: item.valid,
      direction: item.direction || null,
      score: Number(item.rawScore ?? item.score ?? 0),
      weightedScore: Number(item.weightedScore || 0),
      explanation: item.explanation || null,
      activationReason: item.activationReason || item.eligibilityAudit?.activationReason || null,
      audit: item.eligibilityAudit || null
    })),
    report
  };
}

function emitStrategyEligibilityAuditLog(payload) {
  console.log(JSON.stringify(payload));
}

function getModePartialScoreMinimum(mode = "balanced") {
  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === "conservative") return 100;
  if (normalizedMode === "aggressive") return 60;

  return 65;
}

function isBalancedPartialScoreReleased({ mode, partialScore }) {
  return normalizeMode(mode) === "balanced" && partialScore >= 65 && partialScore < 70;
}

function buildBalancedCandidateReleaseDiagnostic({ item, best, systemOutcome }) {
  const partialScore = Number(item?.eligibilityAudit?.score ?? item?.rawScore ?? item?.score ?? 0);
  const weightedScore = Number(item?.weightedScore ?? 0);
  const auditContext = item?.eligibilityAudit?.context || {};
  const mode = normalizeMode(auditContext.mode);
  const blocker = item?.eligibilityAudit?.blockedBy || item?.explanation || null;
  const minPartialScore = Number(auditContext.minPartialScore ?? getModePartialScoreMinimum(mode));
  const calibratedBalancedThreshold = minPartialScore === 65;
  const partialScoreWindowReleased = Boolean(
    calibratedBalancedThreshold &&
    isBalancedPartialScoreReleased({ mode, partialScore }) &&
    blocker !== "partialScoreBelowModeMinimum"
  );
  const approvedCandidate = Boolean(item?.valid && item?.direction);
  const selectedCandidate = Boolean(approvedCandidate && best?.name === item.name);
  const candidateBeforeRelease = {
    strategy: item?.name || null,
    direction: item?.direction || null,
    valid: Boolean(item?.valid),
    partialScore,
    weightedScore,
    mode,
    minPartialScore,
    blocker,
    selectedCandidate,
    calibratedBalancedThreshold,
    partialScoreWindowReleased
  };

  let releaseReason = null;
  let discardReason = null;

  if (approvedCandidate) {
    releaseReason = selectedCandidate
      ? "approved_best_candidate"
      : "approved_valid_candidate";
  } else if (partialScoreWindowReleased) {
    releaseReason = "balanced_partial_score_release";
  } else if (!calibratedBalancedThreshold) {
    discardReason = `balanced_threshold_not_calibrated:${minPartialScore}`;
  } else if (blocker === "partialScoreBelowModeMinimum") {
    discardReason = "partial_score_below_mode_minimum";
  } else if (partialScore < 65) {
    discardReason = "partial_score_below_balanced_release_floor";
  } else if (partialScore >= 70 && !approvedCandidate) {
    discardReason = blocker || "candidate_rejected_after_reaching_activation_score";
  } else if (!item?.direction) {
    discardReason = blocker || "candidate_without_direction";
  } else {
    discardReason = blocker || "candidate_not_released";
  }

  const finalOutcome = releaseReason
    ? selectedCandidate
      ? systemOutcome
      : approvedCandidate
        ? "released_not_selected"
        : blocker || "strategy_rejected_after_partial_release"
    : null;

  const candidateAfterRelease = releaseReason
    ? {
        strategy: item.name,
        direction: item.direction || null,
        partialScore,
        weightedScore,
        finalOutcome,
        releaseReason
      }
    : null;

  return {
    candidateBeforeRelease,
    candidateAfterRelease,
    releaseReason,
    discardReason
  };
}

function buildBalancedCandidateOutcome({ item, best, systemOutcome }) {
  const diagnostic = buildBalancedCandidateReleaseDiagnostic({ item, best, systemOutcome });

  if (!diagnostic.candidateAfterRelease) return null;

  return {
    ...diagnostic.candidateAfterRelease,
    candidateBeforeRelease: diagnostic.candidateBeforeRelease,
    candidateAfterRelease: diagnostic.candidateAfterRelease,
    releaseReason: diagnostic.releaseReason,
    discardReason: diagnostic.discardReason
  };
}

function buildBalancedCandidatesReleasedMetric({ mode, evaluated, best, systemOutcome }) {
  if (normalizeMode(mode) !== "balanced") {
    return {
      count: 0,
      candidates: [],
      releaseDiagnostics: []
    };
  }

  const releaseDiagnostics = (Array.isArray(evaluated) ? evaluated : [])
    .map((item) => buildBalancedCandidateReleaseDiagnostic({ item, best, systemOutcome }));
  const candidates = releaseDiagnostics
    .map((diagnostic) => diagnostic.candidateAfterRelease
      ? {
          ...diagnostic.candidateAfterRelease,
          candidateBeforeRelease: diagnostic.candidateBeforeRelease,
          candidateAfterRelease: diagnostic.candidateAfterRelease,
          releaseReason: diagnostic.releaseReason,
          discardReason: diagnostic.discardReason
        }
      : null)
    .filter(Boolean);

  return {
    count: candidates.length,
    candidates,
    releaseDiagnostics
  };
}

function buildSignalNearActivationAuditLog({ snapshot, mode, evaluated, report }) {
  const normalizedMode = normalizeMode(mode);
  const minimumPartialScore = getModePartialScoreMinimum(normalizedMode);
  const candidates = (report?.byStrategy || [])
    .filter((item) => item.blocked)
    .map((item) => ({
      strategy: item.strategyName,
      partialScore: Number(item.partialScore || 0),
      blocker: item.blockedBy || "unknown",
      distanceToActivation: Number(Math.max(0, minimumPartialScore - Number(item.partialScore || 0)).toFixed(2))
    }))
    .sort((left, right) => {
      if (left.distanceToActivation !== right.distanceToActivation) {
        return left.distanceToActivation - right.distanceToActivation;
      }

      return right.partialScore - left.partialScore;
    });
  const nearest = candidates[0] || null;

  return {
    scope: "aerix_signal_near_activation_audit",
    event: "signalNearActivation",
    timestamp: new Date().toISOString(),
    mode: normalizedMode,
    symbol: snapshot?.symbol || snapshot?.asset || null,
    strategy: nearest?.strategy || null,
    partialScore: nearest?.partialScore || 0,
    blocker: nearest?.blocker || null,
    distanceToActivation: nearest?.distanceToActivation ?? null,
    minimumPartialScore,
    candidates,
    diagnostics: evaluated.map((item) => ({
      strategy: item.name,
      valid: item.valid,
      partialScore: Number(item.eligibilityAudit?.score ?? item.rawScore ?? item.score ?? 0),
      blocker: item.valid ? null : item.eligibilityAudit?.blockedBy || item.explanation || null,
      activationReason: item.valid ? item.eligibilityAudit?.activationReason || null : null
    }))
  };
}

function emitSignalNearActivationAuditLog(payload) {
  console.log(JSON.stringify(payload));
}

function emitBalancedCandidatesReleasedMetric(payload) {
  console.log(JSON.stringify(payload));
}

function runStrategies({ snapshot, mode = "balanced" }) {
  const rules = getModeRules(mode);
  const mtf = buildMtfContext(snapshot);
  const marketRegime = classifyMarketRegime(snapshot, mtf);
  const dynamicMinScore = getDynamicMinScore(rules, marketRegime, mode);

  const payload = {
    m5: snapshot?.timeframes?.m5?.candles || [],
    m15: snapshot?.timeframes?.m15?.candles || [],
    h1: snapshot?.timeframes?.h1?.candles || [],
    mtf,
    mode: normalizeMode(mode)
  };

  const strategies = createEnabledStrategies();

  const evaluated = strategies.map((strategy) => {
    const result = safeEvaluateStrategy(strategy, payload);
    const weight = rules.weights[result.name] || 1;
    return applyWeight(result, weight);
  });

  const validStrategies = evaluated
    .filter((item) => item.valid && item.direction)
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const best = validStrategies[0] || null;

  const strategyEligibilityAuditLog = buildStrategyEligibilityAuditLog({
    snapshot,
    mode,
    mtf,
    marketRegime,
    dynamicMinScore,
    evaluated,
    validStrategies,
    best
  });

  emitStrategyEligibilityAuditLog(strategyEligibilityAuditLog);
  emitSignalNearActivationAuditLog(buildSignalNearActivationAuditLog({
    snapshot,
    mode,
    evaluated,
    report: strategyEligibilityAuditLog.report
  }));

  const marketValidation = validateMarketConditions(snapshot, mtf, mode, best);
  const marketStructure = MarketStructureService.analyze(snapshot, best || { signal: "WAIT" });
  console.log(JSON.stringify(marketStructure.audit));
  const blockerAnalyticsContext = {
    symbol: snapshot?.symbol || snapshot?.asset || null,
    mode: normalizeMode(mode),
    marketRegime,
    alignment: Number(mtf?.alignment || 0),
    volatility: Number(snapshot?.timeframes?.m5?.volatilityPercent || 0)
  };


  const fallbackSignal = marketValidation.isFallbackData
    ? getFallbackSignalEligibility({ best, mtf, mode })
    : null;
  const fallbackGraceBlocked = Boolean(
    marketValidation.isFallbackData &&
    !marketValidation.shouldBlock &&
    !fallbackSignal?.eligible
  );
  const effectiveMarketRegime = fallbackSignal?.eligible ? "FALLBACK_SIGNAL" : marketRegime;
  const effectiveDynamicMinScore = effectiveMarketRegime === marketRegime
    ? dynamicMinScore
    : getDynamicMinScore(rules, effectiveMarketRegime, mode);

  const createBalancedCandidatesReleasedMetric = (finalOutcome) => ({
    scope: "aerix_balanced_candidates_released",
    event: "balancedCandidatesReleased",
    timestamp: new Date().toISOString(),
    mode: normalizeMode(mode),
    symbol: snapshot?.symbol || snapshot?.asset || null,
    ...buildBalancedCandidatesReleasedMetric({
      mode,
      evaluated,
      best,
      systemOutcome: finalOutcome
    })
  });

  emitVolatilityAuditLog({
    mode: normalizeMode(mode),
    symbol: snapshot?.symbol || snapshot?.asset || null,
    marketRegime,
    finalRegime: effectiveMarketRegime,
    bestStrategy: best?.name || null,
    bestDirection: best?.direction || null,
    bestScore: best ? getCandidateScore(best) : 0,
    institutionalVolatilityOverride: marketValidation.institutionalVolatilityOverride,
    audit: {
      ...marketValidation.volatilityAudit,
      regime: {
        ...marketValidation.volatilityAudit.regime,
        final: effectiveMarketRegime
      }
    }
  });

  if (!best || marketValidation.shouldBlock || fallbackGraceBlocked) {
    const absenceReason = !best
      ? "Nenhuma estratégia válida retornou direção CALL/PUT."
      : fallbackGraceBlocked
        ? `Fallback sem elegibilidade operacional: alinhamento ${fallbackSignal.trendAlignment}/3, score ${fallbackSignal.strategyScore}, direção esperada ${fallbackSignal.expectedDirection || "indefinida"}.`
        : `Market validation bloqueou direção: ${marketValidation.blocks.join(" | ")}`;
    const result = {
      signal: "WAIT",
      confidence: 0,
      entryQuality: "weak",
      strategyName: null,
      explanation: "Mercado sem qualidade suficiente para entrada.",
      reasons: marketValidation.penaltyReasons,
      blocks: fallbackGraceBlocked
        ? ["Fallback permitido apenas com alinhamento >= 3, score estratégico >= 90 e direção consistente."]
        : marketValidation.blocks.length
          ? marketValidation.blocks
          : ["Nenhuma estratégia válida encontrada."],
      strategies: evaluated,
      strategyEligibilityReport: buildStrategyEligibilityReport(evaluated),
      mtf,
      marketRegime: effectiveMarketRegime,
      dynamicMinScore: effectiveDynamicMinScore,
      marketStructure,
      operationalTuning: {
        mode: normalizeMode(mode),
        targetApprovalRate: rules.targetApprovalRate,
        penaltyScore: marketValidation.penaltyScore,
        penaltyReasons: marketValidation.penaltyReasons,
        marketStructureAdjustment: marketStructure.marketStructureAdjustment,
        hardBlocks: fallbackGraceBlocked
          ? ["Fallback sem confluência mínima para FALLBACK_SIGNAL."]
          : marketValidation.blocks,
        fallbackSignal
      },
      metrics: {
        marketStructure,
        balancedCandidatesReleased: buildBalancedCandidatesReleasedMetric({
          mode,
          evaluated,
          best,
          systemOutcome: "blocked_before_signal"
        })
      }
    };

    emitBalancedCandidatesReleasedMetric(createBalancedCandidatesReleasedMetric("blocked_before_signal"));

    emitDirectionAuditLog(buildStrategyAuditSnapshot({
      snapshot,
      mtf,
      marketRegime: effectiveMarketRegime,
      dynamicMinScore: effectiveDynamicMinScore,
      evaluated,
      validStrategies,
      best,
      marketValidation,
      marketStructure,
      confidence: 0,
      result,
      absenceReason,
      mode
    }));

    result.blockerAnalytics = blockerAnalytics.recordCycle({
      candidates: evaluated,
      context: { ...blockerAnalyticsContext, marketRegime: effectiveMarketRegime },
      finalSignal: result
    });

    return result;
  }

  const sameDirection = validStrategies.filter(
    (item) => item.direction === best.direction
  );

  let confidence = best.weightedScore;

  if (mtf.isAligned) confidence += 6;
  confidence += Math.min(10, (sameDirection.length - 1) * 3);
  confidence -= marketValidation.penaltyScore;
  confidence += marketStructure.marketStructureAdjustment;

  const fallbackConfidenceCap = fallbackSignal?.eligible
    ? (normalizeMode(mode) === "aggressive" ? 94 : 92)
    : 99;
  confidence = Math.min(fallbackConfidenceCap, Math.max(0, Number(confidence.toFixed(2))));
  const candlestickAnalysis = analyzeCandlestickPatterns({
    candles: snapshot?.timeframes?.m5?.candles || [],
    context: {
      symbol: snapshot?.symbol || snapshot?.asset || null,
      marketRegime: effectiveMarketRegime,
      mtf,
      trendContext: mtf,
      volatility: Number(snapshot?.timeframes?.m5?.volatilityPercent || 0),
      lowVolatility: marketValidation.isLowVolatility,
      supportResistanceContext: best.context?.supportResistance || best.context?.supportResistanceContext || null,
      liquidityContext: best.context?.liquidity || best.context?.liquidityContext || null,
      structureContext: best.context?.structure || best.context?.structureContext || null,
      retracementDetected: best.context?.retracementDetected,
      structurePreserved: best.context?.structurePreserved,
      momentumReturning: best.context?.momentumReturning,
      firstRetestDetected: best.context?.firstRetestDetected,
      afterLiquiditySweep: best.context?.afterLiquiditySweep || best.context?.sweepDetected
    },
    strategy: { name: best.name, direction: best.direction, rawScore: confidence },
    mode: normalizeMode(mode),
    timeframe: "m5"
  });
  emitCandlestickPatternAudit({ ...candlestickAnalysis.audit, finalDecision: candlestickAnalysis.conflicts.hardBlock ? "hard_block" : "strategy_score_adjusted" });
  blockerAnalytics.recordCandlestickEvents(candlestickAnalysis.blockerAnalytics);
  confidence = Math.min(fallbackConfidenceCap, Math.max(0, Number((confidence + candlestickAnalysis.candlestickAdjustment).toFixed(2))));
  const dynamicScoreGap = effectiveDynamicMinScore - confidence;
  const dynamicScoreTolerance = getDynamicScoreTolerance(mode);
  const isCriticalDynamicGap = dynamicScoreGap > dynamicScoreTolerance;

  if (isCriticalDynamicGap) {
    const absenceReason = `Score ${confidence} ficou ${Number(dynamicScoreGap.toFixed(2))} pontos abaixo do mínimo dinâmico ${effectiveDynamicMinScore}, excedendo tolerância ${dynamicScoreTolerance}.`;
    const result = {
      signal: "WAIT",
      confidence,
      entryQuality: buildEntryQuality(confidence),
      strategyName: best.name,
      explanation: "Score criticamente insuficiente para liberar sinal.",
      reasons: unique([
        ...marketValidation.penaltyReasons,
        `Regime de mercado: ${effectiveMarketRegime}`,
        `Score mínimo dinâmico: ${effectiveDynamicMinScore}`
      ]),
      blocks: [`Score ${confidence} abaixo do mínimo dinâmico crítico ${effectiveDynamicMinScore}.`],
      strategies: evaluated,
      strategyEligibilityReport: buildStrategyEligibilityReport(evaluated),
      mtf,
      marketRegime: effectiveMarketRegime,
      dynamicMinScore: effectiveDynamicMinScore,
      marketStructure,
      operationalTuning: {
        mode: normalizeMode(mode),
        targetApprovalRate: rules.targetApprovalRate,
        penaltyScore: marketValidation.penaltyScore,
        penaltyReasons: marketValidation.penaltyReasons,
        hardBlocks: []
      },
      metrics: {
        marketStructure,
        balancedCandidatesReleased: buildBalancedCandidatesReleasedMetric({
          mode,
          evaluated,
          best,
          systemOutcome: "blocked_by_dynamic_score"
        })
      }
    };

    emitBalancedCandidatesReleasedMetric(createBalancedCandidatesReleasedMetric("blocked_by_dynamic_score"));

    emitDirectionAuditLog(buildStrategyAuditSnapshot({
      snapshot,
      mtf,
      marketRegime: effectiveMarketRegime,
      dynamicMinScore: effectiveDynamicMinScore,
      evaluated,
      validStrategies,
      best,
      marketValidation,
      marketStructure,
      confidence,
      result,
      absenceReason,
      mode
    }));

    result.blockerAnalytics = blockerAnalytics.recordCycle({
      candidates: evaluated,
      context: { ...blockerAnalyticsContext, marketRegime: effectiveMarketRegime },
      finalSignal: result
    });

    return result;
  }

  const dynamicPenaltyReasons = dynamicScoreGap > 0
    ? [`Score ${confidence} abaixo do mínimo dinâmico ${effectiveDynamicMinScore}; convertido em WATCHLIST/penalidade no modo ${normalizeMode(mode)}.`]
    : [];

  const result = {
    signal: best.direction,
    confidence,
    entryQuality: buildEntryQuality(confidence),
    strategyName: best.name,
    explanation: `Estratégia: ${best.name} | Score: ${confidence}`,
    activationReason: best.activationReason || best.eligibilityAudit?.activationReason || `Estratégia ${best.name} aprovada para ${best.direction} com score ${confidence}.`,
    reasons: unique([
      `MTF alinhado: ${mtf.alignment}/3`,
      `Direção dominante: ${mtf.dominantDirection}`,
      `Regime de mercado: ${effectiveMarketRegime}`,
      `Score mínimo dinâmico: ${effectiveDynamicMinScore}`,
      `Confirmação: ${sameDirection.length} estratégias`,
      ...marketValidation.penaltyReasons,
      ...(fallbackSignal?.eligible ? ["Classificação FALLBACK_SIGNAL liberada por confluência forte."] : []),
      ...(candlestickAnalysis.detectedPatterns.length ? [`Confirmação de candles: ${candlestickAnalysis.dominantPatternDirection} (${candlestickAnalysis.candlestickConfirmationScore})`] : []),
      `Estrutura: ${marketStructure.summary} (${marketStructure.marketStructureScore})`,
      ...dynamicPenaltyReasons
    ]),
    blocks: [],
    strategies: evaluated,
    strategyEligibilityReport: buildStrategyEligibilityReport(evaluated),
    mtf,
    marketRegime: effectiveMarketRegime,
    dynamicMinScore: effectiveDynamicMinScore,
    marketStructure,
    operationalTuning: {
      mode: normalizeMode(mode),
      targetApprovalRate: rules.targetApprovalRate,
      penaltyScore: marketValidation.penaltyScore + (dynamicScoreGap > 0 ? Number(dynamicScoreGap.toFixed(2)) : 0),
      penaltyReasons: [...marketValidation.penaltyReasons, ...dynamicPenaltyReasons],
      marketStructureAdjustment: marketStructure.marketStructureAdjustment,
      hardBlocks: [],
      fallbackSignal,
      candlestick: {
        rawStrategyScore: candlestickAnalysis.rawStrategyScore,
        candlestickConfirmationScore: candlestickAnalysis.candlestickConfirmationScore,
        candlestickAdjustment: candlestickAnalysis.candlestickAdjustment,
        scoreAfterCandlestickAdjustment: candlestickAnalysis.scoreAfterCandlestickAdjustment,
        dominantPatternDirection: candlestickAnalysis.dominantPatternDirection,
        conflicts: candlestickAnalysis.conflicts
      }
    },
    metrics: {
      balancedCandidatesReleased: buildBalancedCandidatesReleasedMetric({
        mode,
        evaluated,
        best,
        systemOutcome: "released_to_signal"
      }),
      candlestickPatternIntelligence: candlestickAnalysis,
      marketStructure
    }
  };

  emitBalancedCandidatesReleasedMetric(createBalancedCandidatesReleasedMetric("released_to_signal"));

  emitDirectionAuditLog(buildStrategyAuditSnapshot({
    snapshot,
    mtf,
    marketRegime: effectiveMarketRegime,
    dynamicMinScore: effectiveDynamicMinScore,
    evaluated,
    validStrategies,
    best,
    marketValidation,
    marketStructure,
    confidence,
    result,
    absenceReason: null,
    mode
  }));

  result.blockerAnalytics = blockerAnalytics.recordCycle({
    candidates: evaluated,
    context: { ...blockerAnalyticsContext, marketRegime: effectiveMarketRegime },
    finalSignal: result
  });

  return result;
}

module.exports = {
  runStrategies,
  buildMtfContext,
  classifyMarketRegime,
  validateMarketConditions,
  getLowVolatilityReleaseThreshold,
  buildVolatilityAudit,
  buildBalancedCandidatesReleasedMetric
};

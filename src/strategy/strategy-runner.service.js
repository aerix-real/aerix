const {
  createBreakoutStrategy,
  createMomentumStrategy,
  createPullbackStrategy,
  createReversalStrategy,
  createTrendContinuationStrategy
} = require("./index");

function normalizeMode(mode = "balanced") {
  if (mode === "conservative") return "conservative";
  if (mode === "aggressive") return "aggressive";
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
        regime: 0
      },
      blockers: {
        lowVolatility: 0.12,
        veryLowVolatility: 0.12,
        veryWeakTrend: 0.08,
        weakAlignment: 1,
        insufficientCandles: 60,
        fallbackData: true
      },
      weights: {
        trend_continuation: 1.18,
        pullback: 1.12,
        breakout: 0.92,
        momentum: 0.88,
        reversal: 0.72
      }
    },
    balanced: {
      minScore: 68,
      targetApprovalRate: "20-35%",
      penalties: {
        weakTrend: 7,
        lowVolatility: 7,
        weakAlignment: 6,
        highVolatility: 4,
        regime: 0
      },
      blockers: {
        lowVolatility: 0.06,
        veryLowVolatility: 0.05,
        veryWeakTrend: 0.045,
        weakAlignment: 1,
        insufficientCandles: 45,
        fallbackData: true
      },
      weights: {
        trend_continuation: 1.05,
        pullback: 1.02,
        breakout: 1.03,
        momentum: 1.03,
        reversal: 0.94
      }
    },
    aggressive: {
      minScore: 61,
      targetApprovalRate: "35-55%",
      penalties: {
        weakTrend: 5,
        lowVolatility: 5,
        weakAlignment: 4,
        highVolatility: 3,
        regime: 0
      },
      blockers: {
        lowVolatility: 0.04,
        veryLowVolatility: 0.035,
        veryWeakTrend: 0.03,
        weakAlignment: 0,
        insufficientCandles: 30,
        fallbackData: true
      },
      weights: {
        trend_continuation: 0.98,
        pullback: 0.99,
        breakout: 1.12,
        momentum: 1.14,
        reversal: 1.06
      }
    }
  };

  return rules[normalized];
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
      FALLBACK_DATA: 12
    },
    balanced: {
      TRENDING: -3,
      RANGING: 2,
      BREAKOUT: -1,
      REVERSAL: 3,
      HIGH_VOLATILITY: 3,
      LOW_VOLATILITY: 4,
      FALLBACK_DATA: 12
    },
    aggressive: {
      TRENDING: -5,
      RANGING: 0,
      BREAKOUT: -4,
      REVERSAL: -1,
      HIGH_VOLATILITY: 1,
      LOW_VOLATILITY: 2,
      FALLBACK_DATA: 12
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

function safeEvaluateStrategy(strategy, payload) {
  try {
    const result = strategy.evaluate(payload);

    return {
      name: result?.name || "unknown_strategy",
      valid: Boolean(result?.valid),
      direction: result?.direction || null,
      score: Number(result?.score || 0),
      context: result?.context || {},
      explanation: result?.explanation || ""
    };
  } catch (error) {
    return {
      name: strategy?.name || "unknown_strategy",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: error?.message || "Erro ao executar estratégia."
    };
  }
}

function validateMarketConditions(snapshot, mtf, mode = "balanced") {
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

  const isLowVolatility = volatility > 0 && volatility < 0.12;
  const isVeryLowVolatility = volatility > 0 && volatility < rules.blockers.veryLowVolatility;
  const isWeakTrend = avgTrendStrength > 0 && avgTrendStrength < 0.14;
  const isVeryWeakTrend = avgTrendStrength > 0 && avgTrendStrength < rules.blockers.veryWeakTrend;
  const isWeakAlignment = mtf.alignment < 2;
  const isSevereWeakAlignment = mtf.alignment <= rules.blockers.weakAlignment;
  const isHighVolatility = volatility >= 0.6;
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
    isFallbackData ? "Fonte de dados em fallback; entrada operacional bloqueada." : null,
    hasInsufficientCandles ? "Histórico insuficiente de candles para validação institucional." : null,
    isVeryLowVolatility ? "Baixa liquidez severa / volatilidade extremamente baixa." : null,
    isVeryWeakTrend ? "Tendência muito fraca para entrada institucional." : null,
    isSevereWeakAlignment ? "Inconsistência grave entre timeframes." : null,
    ...conservativeModerateBlocks
  ].filter(Boolean);

  const penalties = [
    isLowVolatility && !isVeryLowVolatility && normalizedMode !== "conservative"
      ? { reason: "Baixa volatilidade convertida em penalidade de score.", value: rules.penalties.lowVolatility }
      : null,
    isWeakTrend && !isVeryWeakTrend && normalizedMode !== "conservative"
      ? { reason: "Trend strength fraco convertido em penalidade de score.", value: rules.penalties.weakTrend }
      : null,
    isWeakAlignment && !isSevereWeakAlignment && normalizedMode !== "conservative"
      ? { reason: "Alinhamento moderado entre timeframes convertido em penalidade.", value: rules.penalties.weakAlignment }
      : null,
    isHighVolatility && normalizedMode !== "conservative"
      ? { reason: "Alta volatilidade aplicada como ajuste conservador de score.", value: rules.penalties.highVolatility }
      : null
  ].filter(Boolean);

  return {
    isLowVolatility,
    isVeryLowVolatility,
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


function buildStrategyAuditSnapshot({ snapshot, mtf, marketRegime, dynamicMinScore, evaluated, validStrategies, best, marketValidation, confidence, result, absenceReason, mode }) {
  const h1 = snapshot?.timeframes?.h1 || {};
  const m15 = snapshot?.timeframes?.m15 || {};
  const m5 = snapshot?.timeframes?.m5 || {};
  const strategyDiagnostics = evaluated.map((item) => ({
    name: item.name,
    valid: item.valid,
    direction: item.direction ?? null,
    rawScore: item.rawScore,
    weightedScore: item.weightedScore,
    explanation: item.explanation || null
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

function runStrategies({ snapshot, mode = "balanced" }) {
  const rules = getModeRules(mode);
  const mtf = buildMtfContext(snapshot);
  const marketRegime = classifyMarketRegime(snapshot, mtf);
  const dynamicMinScore = getDynamicMinScore(rules, marketRegime, mode);

  const payload = {
    m5: snapshot?.timeframes?.m5?.candles || [],
    m15: snapshot?.timeframes?.m15?.candles || [],
    h1: snapshot?.timeframes?.h1?.candles || [],
    mtf
  };

  const strategies = [
    createTrendContinuationStrategy(),
    createPullbackStrategy(),
    createBreakoutStrategy(),
    createMomentumStrategy(),
    createReversalStrategy()
  ];

  const evaluated = strategies.map((strategy) => {
    const result = safeEvaluateStrategy(strategy, payload);
    const weight = rules.weights[result.name] || 1;
    return applyWeight(result, weight);
  });

  const validStrategies = evaluated
    .filter((item) => item.valid && item.direction)
    .sort((a, b) => b.weightedScore - a.weightedScore);

  const best = validStrategies[0] || null;
  const marketValidation = validateMarketConditions(snapshot, mtf, mode);

  if (!best || marketValidation.shouldBlock) {
    const absenceReason = !best
      ? "Nenhuma estratégia válida retornou direção CALL/PUT."
      : `Market validation bloqueou direção: ${marketValidation.blocks.join(" | ")}`;
    const result = {
      signal: "WAIT",
      confidence: 0,
      entryQuality: "weak",
      strategyName: null,
      explanation: "Mercado sem qualidade suficiente para entrada.",
      reasons: marketValidation.penaltyReasons,
      blocks: marketValidation.blocks.length
        ? marketValidation.blocks
        : ["Nenhuma estratégia válida encontrada."],
      strategies: evaluated,
      mtf,
      marketRegime,
      dynamicMinScore,
      operationalTuning: {
        mode: normalizeMode(mode),
        targetApprovalRate: rules.targetApprovalRate,
        penaltyScore: marketValidation.penaltyScore,
        penaltyReasons: marketValidation.penaltyReasons,
        hardBlocks: marketValidation.blocks
      }
    };

    emitDirectionAuditLog(buildStrategyAuditSnapshot({
      snapshot,
      mtf,
      marketRegime,
      dynamicMinScore,
      evaluated,
      validStrategies,
      best,
      marketValidation,
      confidence: 0,
      result,
      absenceReason,
      mode
    }));

    return result;
  }

  const sameDirection = validStrategies.filter(
    (item) => item.direction === best.direction
  );

  let confidence = best.weightedScore;

  if (mtf.isAligned) confidence += 6;
  confidence += Math.min(10, (sameDirection.length - 1) * 3);
  confidence -= marketValidation.penaltyScore;

  confidence = Math.min(99, Math.max(0, Number(confidence.toFixed(2))));
  const dynamicScoreGap = dynamicMinScore - confidence;
  const dynamicScoreTolerance = getDynamicScoreTolerance(mode);
  const isCriticalDynamicGap = dynamicScoreGap > dynamicScoreTolerance;

  if (isCriticalDynamicGap) {
    const absenceReason = `Score ${confidence} ficou ${Number(dynamicScoreGap.toFixed(2))} pontos abaixo do mínimo dinâmico ${dynamicMinScore}, excedendo tolerância ${dynamicScoreTolerance}.`;
    const result = {
      signal: "WAIT",
      confidence,
      entryQuality: buildEntryQuality(confidence),
      strategyName: best.name,
      explanation: "Score criticamente insuficiente para liberar sinal.",
      reasons: unique([
        ...marketValidation.penaltyReasons,
        `Regime de mercado: ${marketRegime}`,
        `Score mínimo dinâmico: ${dynamicMinScore}`
      ]),
      blocks: [`Score ${confidence} abaixo do mínimo dinâmico crítico ${dynamicMinScore}.`],
      strategies: evaluated,
      mtf,
      marketRegime,
      dynamicMinScore,
      operationalTuning: {
        mode: normalizeMode(mode),
        targetApprovalRate: rules.targetApprovalRate,
        penaltyScore: marketValidation.penaltyScore,
        penaltyReasons: marketValidation.penaltyReasons,
        hardBlocks: []
      }
    };

    emitDirectionAuditLog(buildStrategyAuditSnapshot({
      snapshot,
      mtf,
      marketRegime,
      dynamicMinScore,
      evaluated,
      validStrategies,
      best,
      marketValidation,
      confidence,
      result,
      absenceReason,
      mode
    }));

    return result;
  }

  const dynamicPenaltyReasons = dynamicScoreGap > 0
    ? [`Score ${confidence} abaixo do mínimo dinâmico ${dynamicMinScore}; convertido em WATCHLIST/penalidade no modo ${normalizeMode(mode)}.`]
    : [];

  const result = {
    signal: best.direction,
    confidence,
    entryQuality: buildEntryQuality(confidence),
    strategyName: best.name,
    explanation: `Estratégia: ${best.name} | Score: ${confidence}`,
    reasons: unique([
      `MTF alinhado: ${mtf.alignment}/3`,
      `Direção dominante: ${mtf.dominantDirection}`,
      `Regime de mercado: ${marketRegime}`,
      `Score mínimo dinâmico: ${dynamicMinScore}`,
      `Confirmação: ${sameDirection.length} estratégias`,
      ...marketValidation.penaltyReasons,
      ...dynamicPenaltyReasons
    ]),
    blocks: [],
    strategies: evaluated,
    mtf,
    marketRegime,
    dynamicMinScore,
    operationalTuning: {
      mode: normalizeMode(mode),
      targetApprovalRate: rules.targetApprovalRate,
      penaltyScore: marketValidation.penaltyScore + (dynamicScoreGap > 0 ? Number(dynamicScoreGap.toFixed(2)) : 0),
      penaltyReasons: [...marketValidation.penaltyReasons, ...dynamicPenaltyReasons],
      hardBlocks: []
    }
  };

  emitDirectionAuditLog(buildStrategyAuditSnapshot({
    snapshot,
    mtf,
    marketRegime,
    dynamicMinScore,
    evaluated,
    validStrategies,
    best,
    marketValidation,
    confidence,
    result,
    absenceReason: null,
    mode
  }));

  return result;
}

module.exports = {
  runStrategies,
  buildMtfContext,
  classifyMarketRegime
};

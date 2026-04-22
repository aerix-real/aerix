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
      weights: {
        trend_continuation: 1.18,
        pullback: 1.12,
        breakout: 0.92,
        momentum: 0.88,
        reversal: 0.72
      }
    },
    balanced: {
      minScore: 72,
      weights: {
        trend_continuation: 1.05,
        pullback: 1.02,
        breakout: 1.0,
        momentum: 1.0,
        reversal: 0.9
      }
    },
    aggressive: {
      minScore: 66,
      weights: {
        trend_continuation: 0.95,
        pullback: 0.96,
        breakout: 1.08,
        momentum: 1.1,
        reversal: 1.02
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
    h1: { trend: h1.direction || "neutral" },
    m15: { trend: m15.direction || "neutral" },
    m5: { trend: m5.direction || "neutral" },
    dominantDirection,
    alignment: Math.max(upCount, downCount),
    isAligned: upCount === 3 || downCount === 3
  };
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

// 🔥 NOVO: filtro institucional
function validateMarketConditions(snapshot, mtf) {
  const m5 = snapshot?.timeframes?.m5 || {};
  const volatility = Number(m5.volatilityPercent || 0);

  const isLowVolatility = volatility < 0.12;
  const isWeakAlignment = mtf.alignment < 2;

  return {
    isLowVolatility,
    isWeakAlignment,
    shouldBlock: isLowVolatility || isWeakAlignment
  };
}

function runStrategies({ snapshot, mode = "balanced" }) {
  const rules = getModeRules(mode);
  const mtf = buildMtfContext(snapshot);

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

  const marketValidation = validateMarketConditions(snapshot, mtf);

  // 🔥 BLOQUEIO INTELIGENTE
  if (
    !best ||
    best.weightedScore < rules.minScore ||
    marketValidation.shouldBlock
  ) {
    return {
      signal: "WAIT",
      confidence: 0,
      entryQuality: "weak",
      strategyName: null,
      explanation: "Mercado sem qualidade suficiente para entrada.",
      reasons: [],
      blocks: [
        marketValidation.isLowVolatility
          ? "Baixa volatilidade detectada."
          : null,
        marketValidation.isWeakAlignment
          ? "Falta de alinhamento entre timeframes."
          : null
      ].filter(Boolean),
      strategies: evaluated,
      mtf
    };
  }

  const sameDirection = validStrategies.filter(
    (item) => item.direction === best.direction
  );

  let confidence = best.weightedScore;

  // 🔥 bônus mais inteligente
  if (mtf.isAligned) confidence += 6;
  confidence += Math.min(10, (sameDirection.length - 1) * 3);

  confidence = Math.min(99, Number(confidence.toFixed(2)));

  return {
    signal: best.direction,
    confidence,
    entryQuality: buildEntryQuality(confidence),
    strategyName: best.name,
    explanation: `Estratégia: ${best.name} | Score: ${confidence}`,
    reasons: unique([
      `MTF alinhado: ${mtf.alignment}/3`,
      `Direção dominante: ${mtf.dominantDirection}`,
      `Confirmação: ${sameDirection.length} estratégias`
    ]),
    blocks: [],
    strategies: evaluated,
    mtf
  };
}

module.exports = {
  runStrategies
};
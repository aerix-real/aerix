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
      minScore: 76,
      weights: { trend_continuation: 1.2, pullback: 1.1, breakout: 0.94, momentum: 0.9, reversal: 0.72 }
    },
    balanced: {
      minScore: 70,
      weights: { trend_continuation: 1.05, pullback: 1.02, breakout: 1.0, momentum: 1.03, reversal: 0.92 }
    },
    aggressive: {
      minScore: 64,
      weights: { trend_continuation: 0.95, pullback: 0.96, breakout: 1.08, momentum: 1.14, reversal: 1.05 }
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
    h1: { trend: h1.direction || "neutral", strength: Number(h1.strengthPercent || 0) },
    m15: { trend: m15.direction || "neutral", strength: Number(m15.strengthPercent || 0) },
    m5: { trend: m5.direction || "neutral", strength: Number(m5.strengthPercent || 0) },
    dominantDirection,
    alignment: Math.max(upCount, downCount),
    isAligned: upCount === 3 || downCount === 3
  };
}

function classifyMarketRegime(snapshot, mtf) {
  const m5Vol = Number(snapshot?.timeframes?.m5?.volatilityPercent || 0);
  const avgStrength = (mtf.h1.strength + mtf.m15.strength + mtf.m5.strength) / 3;
  const strong = avgStrength >= 55 && mtf.alignment >= 2;
  const lateral = mtf.alignment <= 1 || avgStrength < 35;
  if (lateral) return m5Vol >= 0.5 ? "LATERAL_VOLATIL" : "LATERAL";
  if (strong) return m5Vol >= 0.55 ? "TENDENCIA_FORTE_VOLATIL" : "TENDENCIA_FORTE";
  return "TRANSICAO";
}

function applyWeight(result, weight = 1) {
  const raw = Number(result?.score || 0);
  const weighted = Math.min(100, Number((raw * weight).toFixed(2)));
  return { ...result, rawScore: raw, weightedScore: weighted };
}
const unique = (items = [], limit = 10) => [...new Set(items.filter(Boolean))].slice(0, limit);
function buildEntryQuality(confidence) { if (confidence >= 92) return "institutional"; if (confidence >= 85) return "strong"; if (confidence >= 74) return "good"; if (confidence >= 64) return "moderate"; return "weak"; }

function safeEvaluateStrategy(strategy, payload) {
  try {
    const result = strategy.evaluate(payload);
    return { name: result?.name || "unknown_strategy", valid: Boolean(result?.valid), direction: result?.direction || null, score: Number(result?.score || 0), context: result?.context || {}, explanation: result?.explanation || "" };
  } catch (error) {
    return { name: strategy?.name || "unknown_strategy", valid: false, direction: null, score: 0, context: {}, explanation: error?.message || "Erro ao executar estratégia." };
  }
}

function buildDynamicThreshold(baseMinScore, regime, mtf) {
  let threshold = baseMinScore;
  if (regime.startsWith("TENDENCIA_FORTE")) threshold -= 5;
  if (regime === "TRANSICAO") threshold -= 2;
  if (regime.startsWith("LATERAL")) threshold += 4;
  if (mtf.isAligned) threshold -= 2;
  return Math.max(58, Math.min(86, threshold));
}

function runStrategies({ snapshot, mode = "balanced" }) {
  const rules = getModeRules(mode);
  const mtf = buildMtfContext(snapshot);
  const regime = classifyMarketRegime(snapshot, mtf);
  const payload = { m5: snapshot?.timeframes?.m5?.candles || [], m15: snapshot?.timeframes?.m15?.candles || [], h1: snapshot?.timeframes?.h1?.candles || [], mtf, regime };
  const strategies = [createTrendContinuationStrategy(), createPullbackStrategy(), createBreakoutStrategy(), createMomentumStrategy(), createReversalStrategy()];

  const evaluated = strategies.map((strategy) => {
    const result = safeEvaluateStrategy(strategy, payload);
    const weight = rules.weights[result.name] || 1;
    return applyWeight(result, weight);
  });
  const validStrategies = evaluated.filter((item) => item.valid && item.direction).sort((a, b) => b.weightedScore - a.weightedScore);
  const best = validStrategies[0] || null;
  const dynamicMinScore = buildDynamicThreshold(rules.minScore, regime, mtf);

  if (!best || best.weightedScore < dynamicMinScore) {
    return { signal: "WAIT", confidence: 0, entryQuality: "weak", strategyName: null, explanation: "Mercado sem qualidade suficiente para entrada.", reasons: [], blocks: [best ? `Score ${best.weightedScore} abaixo do threshold dinâmico ${dynamicMinScore}.` : "Sem estratégia válida no ciclo."], strategies: evaluated, mtf, marketRegime: regime, dynamicMinScore };
  }

  const sameDirection = validStrategies.filter((item) => item.direction === best.direction);
  let confidence = best.weightedScore;
  if (mtf.isAligned) confidence += 6;
  if (regime.startsWith("TENDENCIA_FORTE")) confidence += 4;
  if (regime.startsWith("LATERAL")) confidence -= 5;
  confidence += Math.min(12, (sameDirection.length - 1) * 3);
  confidence = Math.min(99, Number(confidence.toFixed(2)));

  return {
    signal: best.direction,
    confidence,
    entryQuality: buildEntryQuality(confidence),
    strategyName: best.name,
    explanation: `Estratégia: ${best.name} | Score: ${confidence}`,
    reasons: unique([`Regime: ${regime}`, `MTF alinhado: ${mtf.alignment}/3`, `Direção dominante: ${mtf.dominantDirection}`, `Confirmação: ${sameDirection.length} estratégias`]),
    blocks: [],
    strategies: evaluated,
    mtf,
    marketRegime: regime,
    dynamicMinScore
  };
}

module.exports = { runStrategies };
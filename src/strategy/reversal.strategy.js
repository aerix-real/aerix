const {
  getPriceZone
} = require("../indicators/support-resistance.indicator");
const {
  getLastRSIFromCandles,
  getRSIZone
} = require("../indicators/rsi.indicator");
const {
  getLastStochastic,
  getStochasticState
} = require("../indicators/stochastic.indicator");
const {
  getLastBollinger,
  getBollingerState
} = require("../indicators/bollinger.indicator");
const {
  getLastATR,
  classifyATR
} = require("../indicators/atr.indicator");
const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

function createReversalStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 35 || m15.length < 35 || h1.length < 25) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const lastM15 = m15[m15.length - 1];

    const priceZone = getPriceZone(m15, 40, 0.00045);

    const rsiM5 = getLastRSIFromCandles(m5, 14);
    const rsiM15 = getLastRSIFromCandles(m15, 14);

    const stochastic = getLastStochastic(m5, 14, 3, 3);
    const stochasticState = getStochasticState(stochastic.k, stochastic.d);

    const bollinger = getLastBollinger(m5, 20, 2, "close");
    const bollingerState = getBollingerState(
      lastM5.close,
      bollinger.upper,
      bollinger.middle,
      bollinger.lower
    );

    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    if (
      !Number.isFinite(rsiM5) ||
      !Number.isFinite(rsiM15) ||
      !Number.isFinite(stochastic.k) ||
      !Number.isFinite(stochastic.d)
    ) {
      return invalidResult("indicator_unavailable");
    }

    const directionAudit = buildDirectionAudit({
      mtf,
      priceZone,
      rsiM5,
      rsiM15,
      stochasticState,
      bollingerState,
      lastM5,
      lastM15
    });
    const direction = directionAudit.direction;

    if (!direction) {
      return invalidResult("no_reversal_setup", directionAudit.audit);
    }

    const score = calculateScore({
      direction,
      mtf,
      priceZone,
      rsiM5,
      rsiM15,
      stochasticState,
      bollingerState,
      atrLevel,
      lastM5,
      lastM15
    });

    const valid = score >= 70;

    return {
      name: "reversal",
      valid,
      direction,
      score,
      context: {
        zone: priceZone.zone,
        nearestSupport: priceZone.nearestSupport,
        nearestResistance: priceZone.nearestResistance,
        rsiM5,
        rsiM15,
        stochasticK: stochastic.k,
        stochasticD: stochastic.d,
        stochasticState,
        bollingerState,
        atr,
        atrLevel,
        dominantDirection: mtf.dominantDirection
      },
      explanation: buildExplanation({
        direction,
        score,
        priceZone,
        rsiM5,
        rsiM15,
        stochasticState,
        bollingerState,
        atrLevel,
        mtf
      }),
      eligibilityAudit: {
        ...directionAudit.audit,
        valid,
        direction,
        score,
        blockedBy: valid ? directionAudit.audit.blockedBy : "strategyScoreBelowThreshold"
      }
    };
  }

  function buildDirectionAudit(input) {
    const {
      mtf,
      priceZone,
      rsiM5,
      rsiM15,
      stochasticState,
      bollingerState,
      lastM5,
      lastM15
    } = input;

    const bullishCriteria = [
      createCriterion("reversalPatternFound", priceZone.zone === "near_support", { zone: priceZone.zone }),
      createCriterion("rsiM5Oversold", rsiM5 <= 35 || getRSIZone(rsiM5) === "oversold", { rsiM5 }),
      createCriterion("rsiM15AllowsReversal", rsiM15 <= 45, { rsiM15 }),
      createCriterion("stochasticReversalConfirmed", stochasticState === "oversold" || stochasticState === "bullish", { stochasticState }),
      createCriterion("bollingerReversalZone", bollingerState === "below_lower" || bollingerState === "lower_half", { bollingerState }),
      createCriterion("m5CandleReversalConfirmed", lastM5.close >= lastM5.open, { close: lastM5.close, open: lastM5.open }),
      createCriterion("m15CandleReversalConfirmed", lastM15.close >= lastM15.open, { close: lastM15.close, open: lastM15.open }),
      createCriterion("counterTrendNotBlocked", mtf.m5.trend !== "down", { m5Trend: mtf.m5.trend })
    ];

    const bearishCriteria = [
      createCriterion("reversalPatternFound", priceZone.zone === "near_resistance", { zone: priceZone.zone }),
      createCriterion("rsiM5Overbought", rsiM5 >= 65 || getRSIZone(rsiM5) === "overbought", { rsiM5 }),
      createCriterion("rsiM15AllowsReversal", rsiM15 >= 55, { rsiM15 }),
      createCriterion("stochasticReversalConfirmed", stochasticState === "overbought" || stochasticState === "bearish", { stochasticState }),
      createCriterion("bollingerReversalZone", bollingerState === "above_upper" || bollingerState === "upper_half", { bollingerState }),
      createCriterion("m5CandleReversalConfirmed", lastM5.close <= lastM5.open, { close: lastM5.close, open: lastM5.open }),
      createCriterion("m15CandleReversalConfirmed", lastM15.close <= lastM15.open, { close: lastM15.close, open: lastM15.open }),
      createCriterion("counterTrendNotBlocked", mtf.m5.trend !== "up", { m5Trend: mtf.m5.trend })
    ];

    const bullishReversal = bullishCriteria.every((criterion) => criterion.passed);
    const bearishReversal = bearishCriteria.every((criterion) => criterion.passed);
    const direction = bullishReversal ? "CALL" : bearishReversal ? "PUT" : null;
    const criteria = direction === "CALL" ? bullishCriteria : direction === "PUT" ? bearishCriteria : [];

    return {
      direction,
      audit: buildEligibilityAudit({
        strategyName: "reversal",
        direction,
        valid: Boolean(direction),
        criteria,
        candidates: [
          { direction: "CALL", criteria: bullishCriteria, blockedBy: "reversalPatternFound" },
          { direction: "PUT", criteria: bearishCriteria, blockedBy: "reversalPatternFound" }
        ],
        blockedBy: direction ? null : "reversalPatternNotFound",
        context: { zone: priceZone.zone, rsiM5, rsiM15, stochasticState, bollingerState, dominantDirection: mtf.dominantDirection }
      })
    };
  }

  function resolveDirection(input) {
    return buildDirectionAudit(input).direction;
  }

  function calculateScore(input) {
    const {
      direction,
      mtf,
      priceZone,
      rsiM5,
      rsiM15,
      stochasticState,
      bollingerState,
      atrLevel,
      lastM5,
      lastM15
    } = input;

    let score = 50;

    if (priceZone.zone === "near_support" || priceZone.zone === "near_resistance") {
      score += 14;
    }

    if (atrLevel === "medium") score += 5;
    if (atrLevel === "high") score += 3;

    if (direction === "CALL") {
      if (rsiM5 <= 32) score += 8;
      if (rsiM15 <= 42) score += 6;
      if (stochasticState === "oversold") score += 7;
      if (stochasticState === "bullish") score += 4;
      if (bollingerState === "below_lower") score += 7;
      if (lastM5.close > lastM5.open) score += 4;
      if (lastM15.close > lastM15.open) score += 3;
    }

    if (direction === "PUT") {
      if (rsiM5 >= 68) score += 8;
      if (rsiM15 >= 58) score += 6;
      if (stochasticState === "overbought") score += 7;
      if (stochasticState === "bearish") score += 4;
      if (bollingerState === "above_upper") score += 7;
      if (lastM5.close < lastM5.open) score += 4;
      if (lastM15.close < lastM15.open) score += 3;
    }

    if (mtf.alignment <= 1) {
      score += 4;
    }

    if (score > 100) score = 100;

    return Number(score.toFixed(2));
  }

  function buildExplanation({
    direction,
    score,
    priceZone,
    rsiM5,
    rsiM15,
    stochasticState,
    bollingerState,
    atrLevel,
    mtf
  }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `reversão para ${side}`,
      `score ${score}`,
      `zona ${priceZone.zone}`,
      `RSI M5 ${rsiM5}`,
      `RSI M15 ${rsiM15}`,
      `Stochastic ${stochasticState}`,
      `Bollinger ${bollingerState}`,
      `ATR ${atrLevel}`,
      `direção dominante ${mtf.dominantDirection}`
    ].join(" | ");
  }

  function invalidResult(reason, eligibilityAudit = null) {
    return {
      name: "reversal",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: reason,
      eligibilityAudit: eligibilityAudit || invalidEligibilityAudit("reversal", reason)
    };
  }

  return {
    evaluate
  };
}

module.exports = {
  createReversalStrategy
};
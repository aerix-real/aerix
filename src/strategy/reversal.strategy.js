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

    const direction = resolveDirection({
      mtf,
      priceZone,
      rsiM5,
      rsiM15,
      stochasticState,
      bollingerState,
      lastM5,
      lastM15
    });

    if (!direction) {
      return invalidResult("no_reversal_setup");
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
      })
    };
  }

  function resolveDirection(input) {
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

    const bullishReversal =
      priceZone.zone === "near_support" &&
      (rsiM5 <= 35 || getRSIZone(rsiM5) === "oversold") &&
      rsiM15 <= 45 &&
      (stochasticState === "oversold" || stochasticState === "bullish") &&
      (bollingerState === "below_lower" || bollingerState === "lower_half") &&
      lastM5.close >= lastM5.open &&
      lastM15.close >= lastM15.open &&
      mtf.m5.trend !== "down";

    if (bullishReversal) {
      return "CALL";
    }

    const bearishReversal =
      priceZone.zone === "near_resistance" &&
      (rsiM5 >= 65 || getRSIZone(rsiM5) === "overbought") &&
      rsiM15 >= 55 &&
      (stochasticState === "overbought" || stochasticState === "bearish") &&
      (bollingerState === "above_upper" || bollingerState === "upper_half") &&
      lastM5.close <= lastM5.open &&
      lastM15.close <= lastM15.open &&
      mtf.m5.trend !== "up";

    if (bearishReversal) {
      return "PUT";
    }

    return null;
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

  function invalidResult(reason) {
    return {
      name: "reversal",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: reason
    };
  }

  return {
    evaluate
  };
}

module.exports = {
  createReversalStrategy
};
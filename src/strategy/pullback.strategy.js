const { getLastEMAFromCandles } = require("../indicators/ema.indicator");
const { getLastRSIFromCandles, getRSIZone } = require("../indicators/rsi.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");

function createPullbackStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 30 || m15.length < 30 || h1.length < 30) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const lastM15 = m15[m15.length - 1];
    const lastH1 = h1[h1.length - 1];

    const ema9M5 = getLastEMAFromCandles(m5, 9);
    const ema21M5 = getLastEMAFromCandles(m5, 21);

    const ema9M15 = getLastEMAFromCandles(m15, 9);
    const ema21M15 = getLastEMAFromCandles(m15, 21);

    const ema9H1 = getLastEMAFromCandles(h1, 9);
    const ema21H1 = getLastEMAFromCandles(h1, 21);

    const rsiM5 = getLastRSIFromCandles(m5, 14);
    const rsiM15 = getLastRSIFromCandles(m15, 14);

    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    const adxData = getLastADX(m15, 14);
    const adxState = getADXState(adxData.adx, adxData.plusDI, adxData.minusDI);

    if (
      !isFiniteNumber(ema9M5) || !isFiniteNumber(ema21M5) ||
      !isFiniteNumber(ema9M15) || !isFiniteNumber(ema21M15) ||
      !isFiniteNumber(ema9H1) || !isFiniteNumber(ema21H1) ||
      !isFiniteNumber(rsiM5) || !isFiniteNumber(rsiM15)
    ) {
      return invalidResult("indicator_unavailable");
    }

    const direction = resolveDirection({
      mtf,
      lastM5,
      lastM15,
      lastH1,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      rsiM5,
      rsiM15
    });

    if (!direction) {
      return invalidResult("no_pullback_setup");
    }

    const score = calculateScore({
      direction,
      mtf,
      lastM5,
      ema9M5,
      ema21M5,
      rsiM5,
      rsiM15,
      atrLevel,
      adxData,
      adxState
    });

    const valid = score >= 70;

    return {
      name: "pullback",
      valid,
      direction,
      score,
      context: {
        atr,
        atrLevel,
        adx: adxData.adx,
        adxState,
        rsiM5,
        rsiM15,
        alignment: mtf.alignment
      },
      explanation: buildExplanation({
        direction,
        score,
        atrLevel,
        adxState,
        rsiM5,
        rsiM15,
        mtf
      })
    };
  }

  function resolveDirection(input) {
    const {
      mtf,
      lastM5,
      lastM15,
      lastH1,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      rsiM5,
      rsiM15
    } = input;

    const bullishContext =
      mtf.h1.trend === "up" &&
      mtf.m15.trend === "up" &&
      ema9H1 > ema21H1 &&
      ema9M15 > ema21M15 &&
      lastH1.close > ema9H1 &&
      lastM15.close >= ema21M15;

    const bullishPullback =
      lastM5.close <= ema9M5 ||
      lastM5.low <= ema21M5 ||
      rsiM5 <= 48 ||
      rsiM15 <= 55;

    const bullishRecovery =
      lastM5.close >= ema21M5 &&
      ema9M5 >= ema21M5;

    if (bullishContext && bullishPullback && bullishRecovery) {
      return "CALL";
    }

    const bearishContext =
      mtf.h1.trend === "down" &&
      mtf.m15.trend === "down" &&
      ema9H1 < ema21H1 &&
      ema9M15 < ema21M15 &&
      lastH1.close < ema9H1 &&
      lastM15.close <= ema21M15;

    const bearishPullback =
      lastM5.close >= ema9M5 ||
      lastM5.high >= ema21M5 ||
      rsiM5 >= 52 ||
      rsiM15 >= 45;

    const bearishRecovery =
      lastM5.close <= ema21M5 &&
      ema9M5 <= ema21M5;

    if (bearishContext && bearishPullback && bearishRecovery) {
      return "PUT";
    }

    return null;
  }

  function calculateScore(input) {
    const {
      direction,
      mtf,
      lastM5,
      ema9M5,
      ema21M5,
      rsiM5,
      rsiM15,
      atrLevel,
      adxData,
      adxState
    } = input;

    let score = 52;

    if (mtf.alignment === 3) score += 14;
    if (mtf.alignment === 2) score += 8;

    if (adxData.adx >= 20) score += 8;
    if (adxData.adx >= 30) score += 5;

    if (adxState === "bullish_trend" || adxState === "bearish_trend") score += 4;
    if (adxState === "strong_bullish_trend" || adxState === "strong_bearish_trend") score += 7;

    if (atrLevel === "medium") score += 5;
    if (atrLevel === "high") score += 7;

    const distanceToEma = Math.abs(lastM5.close - ema9M5);
    if (distanceToEma <= 0.00045) score += 5;
    if (Math.abs(ema9M5 - ema21M5) > 0.00012) score += 4;

    if (direction === "CALL") {
      if (rsiM5 >= 42 && rsiM5 <= 58) score += 5;
      if (rsiM15 >= 48 && rsiM15 <= 62) score += 4;
    }

    if (direction === "PUT") {
      if (rsiM5 >= 42 && rsiM5 <= 58) score += 5;
      if (rsiM15 >= 38 && rsiM15 <= 52) score += 4;
    }

    if (score > 100) score = 100;

    return Number(score.toFixed(2));
  }

  function buildExplanation({ direction, score, atrLevel, adxState, rsiM5, rsiM15, mtf }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `pullback em tendência de ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `alinhamento ${mtf.alignment}/3`,
      `RSI M5 ${rsiM5}`,
      `RSI M15 ${rsiM15}`,
      `ATR ${atrLevel}`,
      `ADX ${adxState}`
    ].join(" | ");
  }

  function invalidResult(reason) {
    return {
      name: "pullback",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: reason
    };
  }

  function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
  }

  return {
    evaluate
  };
}

module.exports = {
  createPullbackStrategy
};
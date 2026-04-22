const { getLastEMAFromCandles } = require("../indicators/ema.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");

function createTrendContinuationStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    const lastM5 = m5[m5.length - 1];
    const lastM15 = m15[m15.length - 1];
    const lastH1 = h1[h1.length - 1];

    if (!lastM5 || !lastM15 || !lastH1) {
      return invalidResult("missing_last_candle");
    }

    const ema9M5 = getLastEMAFromCandles(m5, 9);
    const ema21M5 = getLastEMAFromCandles(m5, 21);

    const ema9M15 = getLastEMAFromCandles(m15, 9);
    const ema21M15 = getLastEMAFromCandles(m15, 21);

    const ema9H1 = getLastEMAFromCandles(h1, 9);
    const ema21H1 = getLastEMAFromCandles(h1, 21);

    if (
      !isFiniteNumber(ema9M5) || !isFiniteNumber(ema21M5) ||
      !isFiniteNumber(ema9M15) || !isFiniteNumber(ema21M15) ||
      !isFiniteNumber(ema9H1) || !isFiniteNumber(ema21H1)
    ) {
      return invalidResult("ema_unavailable");
    }

    const adxData = getLastADX(m15, 14);
    const adxState = getADXState(adxData.adx, adxData.plusDI, adxData.minusDI);
    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    const direction = resolveDirection({
      lastM5,
      lastM15,
      lastH1,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      mtf
    });

    if (!direction) {
      return invalidResult("no_direction");
    }

    const score = calculateScore({
      direction,
      mtf,
      adxData,
      adxState,
      atrLevel,
      lastM5,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1
    });

    const valid = score >= 70;

    return {
      name: "trend_continuation",
      valid,
      direction,
      score,
      context: {
        adx: adxData.adx,
        adxState,
        atr,
        atrLevel,
        alignment: mtf.alignment,
        dominantDirection: mtf.dominantDirection
      },
      explanation: buildExplanation({
        direction,
        score,
        adxState,
        atrLevel,
        mtf
      })
    };
  }

  function resolveDirection(input) {
    const {
      lastM5,
      lastM15,
      lastH1,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      mtf
    } = input;

    const bullish =
      mtf.h1.trend === "up" &&
      mtf.m15.trend === "up" &&
      mtf.dominantDirection === "up" &&
      ema9H1 > ema21H1 &&
      ema9M15 > ema21M15 &&
      ema9M5 > ema21M5 &&
      lastH1.close > ema9H1 &&
      lastM15.close > ema9M15 &&
      lastM5.close > ema9M5;

    if (bullish) {
      return "CALL";
    }

    const bearish =
      mtf.h1.trend === "down" &&
      mtf.m15.trend === "down" &&
      mtf.dominantDirection === "down" &&
      ema9H1 < ema21H1 &&
      ema9M15 < ema21M15 &&
      ema9M5 < ema21M5 &&
      lastH1.close < ema9H1 &&
      lastM15.close < ema9M15 &&
      lastM5.close < ema9M5;

    if (bearish) {
      return "PUT";
    }

    return null;
  }

  function calculateScore(input) {
    const {
      direction,
      mtf,
      adxData,
      adxState,
      atrLevel,
      lastM5,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1
    } = input;

    let score = 50;

    if (mtf.alignment === 3) score += 18;
    if (mtf.alignment === 2) score += 10;

    if (adxData.adx >= 25) score += 10;
    if (adxData.adx >= 35) score += 6;

    if (adxState === "strong_bullish_trend" || adxState === "strong_bearish_trend") {
      score += 6;
    }

    if (atrLevel === "medium") score += 5;
    if (atrLevel === "high") score += 8;

    const compressionM5 = Math.abs(ema9M5 - ema21M5);
    const compressionM15 = Math.abs(ema9M15 - ema21M15);
    const compressionH1 = Math.abs(ema9H1 - ema21H1);

    if (compressionM5 > 0.00015) score += 3;
    if (compressionM15 > 0.00025) score += 4;
    if (compressionH1 > 0.0004) score += 5;

    if (direction === "CALL" && lastM5.close > ema9M5) score += 4;
    if (direction === "PUT" && lastM5.close < ema9M5) score += 4;

    if (score > 100) score = 100;

    return Number(score.toFixed(2));
  }

  function buildExplanation({ direction, score, adxState, atrLevel, mtf }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `continuação de tendência em ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `M5 ${mtf.m5.trend}`,
      `alinhamento ${mtf.alignment}/3`,
      `ADX ${adxState}`,
      `ATR ${atrLevel}`
    ].join(" | ");
  }

  function invalidResult(reason) {
    return {
      name: "trend_continuation",
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
  createTrendContinuationStrategy
};
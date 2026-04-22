const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const {
  getLastBollinger,
  getBollingerState
} = require("../indicators/bollinger.indicator");
const {
  getNearestSupportResistance
} = require("../indicators/support-resistance.indicator");
const { getLastMACD, getMACDState } = require("../indicators/macd.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");

function createBreakoutStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 40 || m15.length < 40 || h1.length < 30) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const lastM15 = m15[m15.length - 1];

    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    const bollinger = getLastBollinger(m5, 20, 2, "close");
    const bollingerState = getBollingerState(
      lastM5.close,
      bollinger.upper,
      bollinger.middle,
      bollinger.lower
    );

    const sr = getNearestSupportResistance(m15, 40, 0.00045);

    const macd = getLastMACD(m15, 12, 26, 9, "close");
    const macdState = getMACDState(macd.macd, macd.signal, macd.histogram);

    const adxData = getLastADX(m15, 14);
    const adxState = getADXState(adxData.adx, adxData.plusDI, adxData.minusDI);

    const direction = resolveDirection({
      mtf,
      lastM5,
      lastM15,
      sr,
      macdState,
      adxState,
      bollingerState
    });

    if (!direction) {
      return invalidResult("no_breakout_setup");
    }

    const score = calculateScore({
      direction,
      mtf,
      atrLevel,
      macd,
      macdState,
      adxData,
      adxState,
      bollingerState,
      lastM5,
      lastM15,
      sr
    });

    const valid = score >= 72;

    return {
      name: "breakout",
      valid,
      direction,
      score,
      context: {
        atr,
        atrLevel,
        macd,
        macdState,
        adx: adxData.adx,
        adxState,
        bollingerState,
        nearestSupport: sr.nearestSupport,
        nearestResistance: sr.nearestResistance,
        alignment: mtf.alignment
      },
      explanation: buildExplanation({
        direction,
        score,
        atrLevel,
        macdState,
        adxState,
        bollingerState,
        mtf
      })
    };
  }

  function resolveDirection(input) {
    const { mtf, lastM5, lastM15, sr, macdState, adxState, bollingerState } = input;

    const breakoutUp =
      mtf.dominantDirection === "up" &&
      mtf.alignment >= 2 &&
      sr.nearestResistance !== null &&
      lastM15.close > sr.nearestResistance &&
      lastM5.close > lastM15.open &&
      (macdState === "bullish" || bollingerState === "above_upper") &&
      (
        adxState === "bullish_trend" ||
        adxState === "strong_bullish_trend" ||
        adxState === "developing_trend"
      );

    if (breakoutUp) {
      return "CALL";
    }

    const breakoutDown =
      mtf.dominantDirection === "down" &&
      mtf.alignment >= 2 &&
      sr.nearestSupport !== null &&
      lastM15.close < sr.nearestSupport &&
      lastM5.close < lastM15.open &&
      (macdState === "bearish" || bollingerState === "below_lower") &&
      (
        adxState === "bearish_trend" ||
        adxState === "strong_bearish_trend" ||
        adxState === "developing_trend"
      );

    if (breakoutDown) {
      return "PUT";
    }

    return null;
  }

  function calculateScore(input) {
    const {
      direction,
      mtf,
      atrLevel,
      macd,
      macdState,
      adxData,
      adxState,
      bollingerState,
      lastM5,
      lastM15,
      sr
    } = input;

    let score = 54;

    if (mtf.alignment === 3) score += 14;
    if (mtf.alignment === 2) score += 8;

    if (atrLevel === "medium") score += 6;
    if (atrLevel === "high") score += 10;

    if (adxData.adx >= 22) score += 8;
    if (adxData.adx >= 30) score += 5;

    if (adxState === "strong_bullish_trend" || adxState === "strong_bearish_trend") {
      score += 6;
    }

    if (macdState === "bullish" || macdState === "bearish") {
      score += 6;
    }

    if (Math.abs(macd.histogram || 0) > 0.00005) {
      score += 4;
    }

    if (bollingerState === "above_upper" || bollingerState === "below_lower") {
      score += 5;
    }

    if (direction === "CALL" && sr.nearestResistance !== null) {
      const breakoutDistance = lastM15.close - sr.nearestResistance;
      if (breakoutDistance > 0.00015) score += 4;
    }

    if (direction === "PUT" && sr.nearestSupport !== null) {
      const breakoutDistance = sr.nearestSupport - lastM15.close;
      if (breakoutDistance > 0.00015) score += 4;
    }

    if (direction === "CALL" && lastM5.close > lastM15.close) score += 3;
    if (direction === "PUT" && lastM5.close < lastM15.close) score += 3;

    if (score > 100) score = 100;

    return Number(score.toFixed(2));
  }

  function buildExplanation({
    direction,
    score,
    atrLevel,
    macdState,
    adxState,
    bollingerState,
    mtf
  }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `breakout em ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `alinhamento ${mtf.alignment}/3`,
      `MACD ${macdState}`,
      `ADX ${adxState}`,
      `Bollinger ${bollingerState}`,
      `ATR ${atrLevel}`
    ].join(" | ");
  }

  function invalidResult(reason) {
    return {
      name: "breakout",
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
  createBreakoutStrategy
};
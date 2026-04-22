const { getLastMACD, getMACDState } = require("../indicators/macd.indicator");
const { getLastRSIFromCandles } = require("../indicators/rsi.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { getLastEMAFromCandles } = require("../indicators/ema.indicator");

function createMomentumStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 35 || m15.length < 35 || h1.length < 25) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const lastM15 = m15[m15.length - 1];
    const prevM5 = m5[m5.length - 2];
    const prevM15 = m15[m15.length - 2];

    if (!lastM5 || !lastM15 || !prevM5 || !prevM15) {
      return invalidResult("missing_last_candles");
    }

    const macdM5 = getLastMACD(m5, 12, 26, 9, "close");
    const macdM15 = getLastMACD(m15, 12, 26, 9, "close");
    const macdStateM5 = getMACDState(macdM5.macd, macdM5.signal, macdM5.histogram);
    const macdStateM15 = getMACDState(macdM15.macd, macdM15.signal, macdM15.histogram);

    const rsiM5 = getLastRSIFromCandles(m5, 14);
    const rsiM15 = getLastRSIFromCandles(m15, 14);

    const adxData = getLastADX(m15, 14);
    const adxState = getADXState(adxData.adx, adxData.plusDI, adxData.minusDI);

    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    const ema9M5 = getLastEMAFromCandles(m5, 9);
    const ema21M5 = getLastEMAFromCandles(m5, 21);

    if (
      !isFiniteNumber(macdM5.macd) ||
      !isFiniteNumber(macdM5.signal) ||
      !isFiniteNumber(macdM5.histogram) ||
      !isFiniteNumber(macdM15.macd) ||
      !isFiniteNumber(macdM15.signal) ||
      !isFiniteNumber(macdM15.histogram) ||
      !isFiniteNumber(rsiM5) ||
      !isFiniteNumber(rsiM15) ||
      !isFiniteNumber(adxData.adx) ||
      !isFiniteNumber(ema9M5) ||
      !isFiniteNumber(ema21M5)
    ) {
      return invalidResult("indicator_unavailable");
    }

    const direction = resolveDirection({
      mtf,
      macdStateM5,
      macdStateM15,
      macdM5,
      macdM15,
      rsiM5,
      rsiM15,
      adxState,
      lastM5,
      lastM15,
      prevM5,
      prevM15,
      ema9M5,
      ema21M5
    });

    if (!direction) {
      return invalidResult("no_momentum_setup");
    }

    const score = calculateScore({
      direction,
      mtf,
      macdStateM5,
      macdStateM15,
      macdM5,
      macdM15,
      rsiM5,
      rsiM15,
      adxData,
      adxState,
      atrLevel,
      lastM5,
      lastM15,
      prevM5,
      prevM15,
      ema9M5,
      ema21M5
    });

    const valid = score >= 72;

    return {
      name: "momentum",
      valid,
      direction,
      score,
      context: {
        macdM5,
        macdM15,
        macdStateM5,
        macdStateM15,
        rsiM5,
        rsiM15,
        adx: adxData.adx,
        adxState,
        atr,
        atrLevel,
        alignment: mtf.alignment
      },
      explanation: buildExplanation({
        direction,
        score,
        macdStateM5,
        macdStateM15,
        rsiM5,
        rsiM15,
        adxState,
        atrLevel,
        mtf
      })
    };
  }

  function resolveDirection(input) {
    const {
      mtf,
      macdStateM5,
      macdStateM15,
      macdM5,
      macdM15,
      rsiM5,
      rsiM15,
      adxState,
      lastM5,
      lastM15,
      prevM5,
      prevM15,
      ema9M5,
      ema21M5
    } = input;

    const bullish =
      mtf.dominantDirection === "up" &&
      mtf.alignment >= 2 &&
      (macdStateM5 === "bullish" || macdStateM15 === "bullish") &&
      macdM5.histogram > 0 &&
      macdM15.histogram >= 0 &&
      rsiM5 >= 55 &&
      rsiM15 >= 52 &&
      lastM5.close > prevM5.close &&
      lastM15.close >= prevM15.close &&
      lastM5.close > ema9M5 &&
      ema9M5 >= ema21M5 &&
      (
        adxState === "bullish_trend" ||
        adxState === "strong_bullish_trend" ||
        adxState === "developing_trend"
      );

    if (bullish) {
      return "CALL";
    }

    const bearish =
      mtf.dominantDirection === "down" &&
      mtf.alignment >= 2 &&
      (macdStateM5 === "bearish" || macdStateM15 === "bearish") &&
      macdM5.histogram < 0 &&
      macdM15.histogram <= 0 &&
      rsiM5 <= 45 &&
      rsiM15 <= 48 &&
      lastM5.close < prevM5.close &&
      lastM15.close <= prevM15.close &&
      lastM5.close < ema9M5 &&
      ema9M5 <= ema21M5 &&
      (
        adxState === "bearish_trend" ||
        adxState === "strong_bearish_trend" ||
        adxState === "developing_trend"
      );

    if (bearish) {
      return "PUT";
    }

    return null;
  }

  function calculateScore(input) {
    const {
      direction,
      mtf,
      macdStateM5,
      macdStateM15,
      macdM5,
      macdM15,
      rsiM5,
      rsiM15,
      adxData,
      adxState,
      atrLevel,
      lastM5,
      prevM5,
      ema9M5,
      ema21M5
    } = input;

    let score = 52;

    if (mtf.alignment === 3) score += 14;
    if (mtf.alignment === 2) score += 8;

    if (macdStateM5 === "bullish" || macdStateM5 === "bearish") score += 7;
    if (macdStateM15 === "bullish" || macdStateM15 === "bearish") score += 6;

    if (Math.abs(macdM5.histogram || 0) > 0.00005) score += 5;
    if (Math.abs(macdM15.histogram || 0) > 0.00005) score += 4;

    if (adxData.adx >= 20) score += 7;
    if (adxData.adx >= 30) score += 5;

    if (
      adxState === "strong_bullish_trend" ||
      adxState === "strong_bearish_trend"
    ) {
      score += 5;
    }

    if (atrLevel === "medium") score += 5;
    if (atrLevel === "high") score += 7;

    const impulse = Math.abs(lastM5.close - prevM5.close);
    if (impulse > 0.0002) score += 4;
    if (impulse > 0.00035) score += 3;

    if (direction === "CALL") {
      if (rsiM5 >= 58) score += 4;
      if (rsiM15 >= 55) score += 3;
    }

    if (direction === "PUT") {
      if (rsiM5 <= 42) score += 4;
      if (rsiM15 <= 45) score += 3;
    }

    if (Math.abs(ema9M5 - ema21M5) > 0.00012) {
      score += 4;
    }

    if (score > 100) score = 100;

    return Number(score.toFixed(2));
  }

  function buildExplanation({
    direction,
    score,
    macdStateM5,
    macdStateM15,
    rsiM5,
    rsiM15,
    adxState,
    atrLevel,
    mtf
  }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `momentum em ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `alinhamento ${mtf.alignment}/3`,
      `MACD M5 ${macdStateM5}`,
      `MACD M15 ${macdStateM15}`,
      `RSI M5 ${rsiM5}`,
      `RSI M15 ${rsiM15}`,
      `ADX ${adxState}`,
      `ATR ${atrLevel}`
    ].join(" | ");
  }

  function invalidResult(reason) {
    return {
      name: "momentum",
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
  createMomentumStrategy
};
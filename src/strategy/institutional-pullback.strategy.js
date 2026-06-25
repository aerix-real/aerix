const { getLastEMAFromCandles } = require("../indicators/ema.indicator");
const { getLastRSIFromCandles } = require("../indicators/rsi.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

const STRATEGY_NAME = "institutional_pullback";

function createInstitutionalPullbackStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 35 || m15.length < 35 || h1.length < 30) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const previousM5 = m5[m5.length - 2];
    const lastM15 = m15[m15.length - 1];
    const previousM15 = m15[m15.length - 2];
    const lastH1 = h1[h1.length - 1];

    const ema9M5 = getLastEMAFromCandles(m5, 9);
    const ema21M5 = getLastEMAFromCandles(m5, 21);
    const ema9M15 = getLastEMAFromCandles(m15, 9);
    const ema21M15 = getLastEMAFromCandles(m15, 21);
    const ema9H1 = getLastEMAFromCandles(h1, 9);
    const ema21H1 = getLastEMAFromCandles(h1, 21);
    const rsiM5 = getLastRSIFromCandles(m5, 14);
    const rsiM15 = getLastRSIFromCandles(m15, 14);
    const adxData = getLastADX(m15, 14);
    const adxState = getADXState(adxData.adx, adxData.plusDI, adxData.minusDI);
    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    if (
      !isFiniteNumber(ema9M5) || !isFiniteNumber(ema21M5) ||
      !isFiniteNumber(ema9M15) || !isFiniteNumber(ema21M15) ||
      !isFiniteNumber(ema9H1) || !isFiniteNumber(ema21H1) ||
      !isFiniteNumber(rsiM5) || !isFiniteNumber(rsiM15)
    ) {
      return invalidResult("indicator_unavailable");
    }

    const directionAudit = buildDirectionAudit({
      m5,
      m15,
      mtf,
      lastM5,
      previousM5,
      lastM15,
      previousM15,
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
    const direction = directionAudit.direction;

    if (!direction) {
      return invalidResult("no_institutional_pullback_setup", directionAudit.audit);
    }

    const score = calculateScore({
      direction,
      mtf,
      rsiM5,
      rsiM15,
      adxData,
      adxState,
      atrLevel,
      lastM5,
      ema9M5,
      ema21M5
    });
    const valid = score >= 72;

    return {
      name: STRATEGY_NAME,
      valid,
      direction,
      score,
      context: {
        adx: adxData.adx,
        adxState,
        atr,
        atrLevel,
        rsiM5,
        rsiM15,
        alignment: mtf.alignment,
        dominantDirection: mtf.dominantDirection
      },
      explanation: buildExplanation({ direction, score, mtf, rsiM5, rsiM15, atrLevel, adxState }),
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
    const bullishCriteria = buildCriteria(input, "CALL");
    const bearishCriteria = buildCriteria(input, "PUT");
    const bullish = bullishCriteria.every((criterion) => criterion.passed);
    const bearish = bearishCriteria.every((criterion) => criterion.passed);
    const direction = bullish ? "CALL" : bearish ? "PUT" : null;
    const criteria = direction === "CALL" ? bullishCriteria : direction === "PUT" ? bearishCriteria : [];

    return {
      direction,
      audit: buildEligibilityAudit({
        strategyName: STRATEGY_NAME,
        valid: Boolean(direction),
        direction,
        criteria,
        candidates: [
          { direction: "CALL", criteria: bullishCriteria, blockedBy: "trendContextAligned" },
          { direction: "PUT", criteria: bearishCriteria, blockedBy: "trendContextAligned" }
        ],
        blockedBy: direction ? null : "trendContextAligned",
        context: {
          alignment: input.mtf.alignment,
          dominantDirection: input.mtf.dominantDirection,
          rsiM5: input.rsiM5,
          rsiM15: input.rsiM15
        }
      })
    };
  }

  function buildCriteria(input, direction) {
    const bullish = direction === "CALL";
    const expectedTrend = bullish ? "up" : "down";
    const mainStructure = getStructure(input.m15, bullish ? "low" : "high", 12);
    const correctionStructure = getStructure(input.m5, bullish ? "low" : "high", 8);
    const trendContextAligned = Boolean(
      input.mtf.h1?.trend === expectedTrend &&
      input.mtf.m15?.trend === expectedTrend &&
      (input.mtf.dominantDirection === expectedTrend || input.mtf.alignment >= 2) &&
      (bullish ? input.ema9H1 >= input.ema21H1 && input.ema9M15 >= input.ema21M15 : input.ema9H1 <= input.ema21H1 && input.ema9M15 <= input.ema21M15)
    );
    const retracementDetected = bullish
      ? input.lastM5.low <= input.ema21M5 || input.lastM15.low <= input.ema21M15 || input.rsiM5 <= 52 || input.rsiM15 <= 55
      : input.lastM5.high >= input.ema21M5 || input.lastM15.high >= input.ema21M15 || input.rsiM5 >= 48 || input.rsiM15 >= 45;
    const hasStructureReference = mainStructure !== null && correctionStructure !== null;
    const structurePreserved = hasStructureReference && (bullish
      ? input.lastM15.low >= mainStructure && input.lastM5.low >= correctionStructure
      : input.lastM15.high <= mainStructure && input.lastM5.high <= correctionStructure);
    const rsiHealthy = bullish
      ? input.rsiM5 >= 35 && input.rsiM5 <= 64 && input.rsiM15 >= 40 && input.rsiM15 <= 66
      : input.rsiM5 >= 36 && input.rsiM5 <= 65 && input.rsiM15 >= 34 && input.rsiM15 <= 60;
    const recoveryCandleConfirmed = bullish
      ? isBullishRecovery(input.lastM5, input.previousM5) || isBullishRecovery(input.lastM15, input.previousM15)
      : isBearishRecovery(input.lastM5, input.previousM5) || isBearishRecovery(input.lastM15, input.previousM15);
    const momentumReturning = bullish
      ? input.lastM5.close > input.ema9M5 && input.lastM5.close > input.previousM5.close && input.ema9M5 >= input.ema21M5
      : input.lastM5.close < input.ema9M5 && input.lastM5.close < input.previousM5.close && input.ema9M5 <= input.ema21M5;

    return [
      createCriterion("trendContextAligned", trendContextAligned, { h1Trend: input.mtf.h1?.trend, m15Trend: input.mtf.m15?.trend, dominantDirection: input.mtf.dominantDirection }),
      createCriterion("retracementDetected", retracementDetected, { rsiM5: input.rsiM5, rsiM15: input.rsiM15, ema21M5: input.ema21M5, ema21M15: input.ema21M15 }),
      createCriterion("structurePreserved", structurePreserved, { mainStructure, correctionStructure, lastM5Low: input.lastM5.low, lastM5High: input.lastM5.high, lastM15Low: input.lastM15.low, lastM15High: input.lastM15.high }),
      createCriterion("rsiHealthy", rsiHealthy, { rsiM5: input.rsiM5, rsiM15: input.rsiM15 }),
      createCriterion("recoveryCandleConfirmed", recoveryCandleConfirmed, { lastM5: candleBody(input.lastM5), previousM5: candleBody(input.previousM5) }),
      createCriterion("momentumReturning", momentumReturning, { close: input.lastM5.close, previousClose: input.previousM5.close, ema9M5: input.ema9M5, ema21M5: input.ema21M5 })
    ];
  }

  function calculateScore({ direction, mtf, rsiM5, rsiM15, adxData, adxState, atrLevel, lastM5, ema9M5, ema21M5 }) {
    let score = 56;
    if (mtf.alignment >= 3) score += 12;
    if (mtf.alignment === 2) score += 7;
    if (Number(adxData.adx || 0) >= 18) score += 5;
    if (Number(adxData.adx || 0) >= 25) score += 5;
    if (["bullish_trend", "bearish_trend", "strong_bullish_trend", "strong_bearish_trend"].includes(adxState)) score += 5;
    if (atrLevel === "medium") score += 4;
    if (atrLevel === "high") score += 5;
    if (Math.abs(Number(lastM5.close) - Number(ema9M5)) <= Math.abs(Number(ema9M5) - Number(ema21M5)) * 1.8) score += 4;
    if (direction === "CALL" && rsiM5 >= 42 && rsiM5 <= 58 && rsiM15 >= 44 && rsiM15 <= 60) score += 5;
    if (direction === "PUT" && rsiM5 >= 42 && rsiM5 <= 58 && rsiM15 >= 40 && rsiM15 <= 56) score += 5;
    return Number(Math.min(100, score).toFixed(2));
  }

  function buildExplanation({ direction, score, mtf, rsiM5, rsiM15, atrLevel, adxState }) {
    const side = direction === "CALL" ? "alta" : "baixa";
    return [
      `pullback institucional em tendência de ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `RSI M5 ${rsiM5}`,
      `RSI M15 ${rsiM15}`,
      `ATR ${atrLevel}`,
      `ADX ${adxState}`
    ].join(" | ");
  }

  function invalidResult(reason, eligibilityAudit = null) {
    return {
      name: STRATEGY_NAME,
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: reason,
      eligibilityAudit: eligibilityAudit || invalidEligibilityAudit(STRATEGY_NAME, reason)
    };
  }

  return { evaluate };
}

function getStructure(candles = [], field = "low", lookback = 10) {
  const values = candles.slice(-(lookback + 1), -1).map((candle) => Number(candle?.[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return field === "low" ? Math.min(...values) : Math.max(...values);
}

function candleBody(candle = {}) {
  return Number(candle.close) - Number(candle.open);
}

function candleRange(candle = {}) {
  return Math.max(0, Number(candle.high) - Number(candle.low));
}

function isBullishRecovery(candle = {}, previous = {}) {
  const range = candleRange(candle);
  if (!range) return false;
  const lowerWick = Math.min(Number(candle.open), Number(candle.close)) - Number(candle.low);
  return Number(candle.close) > Number(candle.open) && (Number(candle.close) > Number(previous.close) || lowerWick / range >= 0.35);
}

function isBearishRecovery(candle = {}, previous = {}) {
  const range = candleRange(candle);
  if (!range) return false;
  const upperWick = Number(candle.high) - Math.max(Number(candle.open), Number(candle.close));
  return Number(candle.close) < Number(candle.open) && (Number(candle.close) < Number(previous.close) || upperWick / range >= 0.35);
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

module.exports = {
  createInstitutionalPullbackStrategy
};

const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { getLastMACD, getMACDState } = require("../indicators/macd.indicator");
const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

const STRATEGY_NAME = "liquidity_sweep_false_breakout";
const MIN_M5_CANDLES = 50;
const MIN_HIGHER_TIMEFRAME_CANDLES = 20;
const LOOKBACK_MIN = 20;
const LOOKBACK_MAX = 50;
const VALID_SCORE_THRESHOLD = 72;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getRange(candles = [], lookback = LOOKBACK_MAX) {
  const usableLookback = Math.max(LOOKBACK_MIN, Math.min(LOOKBACK_MAX, lookback));
  const completed = candles.slice(Math.max(0, candles.length - usableLookback - 1), -1);

  if (completed.length < LOOKBACK_MIN) {
    return null;
  }

  const highs = completed.map((candle) => toNumber(candle.high)).filter((value) => value !== null);
  const lows = completed.map((candle) => toNumber(candle.low)).filter((value) => value !== null);

  if (highs.length < LOOKBACK_MIN || lows.length < LOOKBACK_MIN) {
    return null;
  }

  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
    candles: completed.length
  };
}

function candleBody(candle = {}) {
  const open = toNumber(candle.open);
  const close = toNumber(candle.close);
  if (open === null || close === null) return 0;
  return Math.abs(close - open);
}

function lowerWick(candle = {}) {
  const open = toNumber(candle.open);
  const close = toNumber(candle.close);
  const low = toNumber(candle.low);
  if (open === null || close === null || low === null) return 0;
  return Math.max(0, Math.min(open, close) - low);
}

function upperWick(candle = {}) {
  const open = toNumber(candle.open);
  const close = toNumber(candle.close);
  const high = toNumber(candle.high);
  if (open === null || close === null || high === null) return 0;
  return Math.max(0, high - Math.max(open, close));
}

function getRecentSweepCandle(candles = [], level, direction) {
  const recent = candles.slice(-4);

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candle = recent[index] || {};
    const low = toNumber(candle.low);
    const high = toNumber(candle.high);

    if (direction === "CALL" && low !== null && low < level) return candle;
    if (direction === "PUT" && high !== null && high > level) return candle;
  }

  return null;
}

function hasMomentumLoss(candles = [], direction) {
  const recent = candles.slice(-4);
  if (recent.length < 4) return false;

  const previous = recent.slice(0, 3).map(candleBody);
  const last = candleBody(recent[3]);
  const avgPrevious = previous.reduce((total, value) => total + value, 0) / previous.length;
  const lastCandle = recent[3] || {};
  const open = toNumber(lastCandle.open);
  const close = toNumber(lastCandle.close);

  if (avgPrevious <= 0 || open === null || close === null) return false;

  if (last <= avgPrevious * 0.85) return true;
  if (direction === "CALL" && close >= open) return true;
  if (direction === "PUT" && close <= open) return true;

  return false;
}

function higherTimeframesDoNotConfirmContinuation(mtf = {}, direction) {
  if (direction === "CALL") {
    return !(mtf?.h1?.trend === "down" && mtf?.m15?.trend === "down");
  }

  if (direction === "PUT") {
    return !(mtf?.h1?.trend === "up" && mtf?.m15?.trend === "up");
  }

  return false;
}

function buildDirectionAudit({ m5, mtf, range, atr, macdState }) {
  const last = m5[m5.length - 1] || {};
  const close = toNumber(last.close);
  const open = toNumber(last.open);
  const support = range?.support;
  const resistance = range?.resistance;
  const volatilityFloor = atr !== null && atr > 0;
  const minSweepDistance = atr !== null && atr > 0 ? atr * 0.08 : 0;
  const callSweepCandle = support !== undefined ? getRecentSweepCandle(m5, support, "CALL") : null;
  const putSweepCandle = resistance !== undefined ? getRecentSweepCandle(m5, resistance, "PUT") : null;
  const callSweepDistance = callSweepCandle ? support - Number(callSweepCandle.low) : 0;
  const putSweepDistance = putSweepCandle ? Number(putSweepCandle.high) - resistance : 0;
  const callLowerWick = lowerWick(callSweepCandle || last);
  const putUpperWick = upperWick(putSweepCandle || last);
  const lastBody = Math.max(candleBody(last), atr ? atr * 0.03 : 0);

  const callCriteria = [
    createCriterion("liquidityLevelDetected", Number.isFinite(support), { support, lookbackCandles: range?.candles || 0 }),
    createCriterion("sweepDetected", Boolean(callSweepCandle && callSweepDistance >= minSweepDistance), { sweepDistance: callSweepDistance, minSweepDistance }),
    createCriterion("closeBackInsideRange", Number.isFinite(close) && Number.isFinite(support) && close > support, { close, support }),
    createCriterion("rejectionWickConfirmed", callLowerWick >= lastBody * 0.7 || (Number.isFinite(open) && close > open), { lowerWick: callLowerWick, body: lastBody }),
    createCriterion("continuationFailureConfirmed", higherTimeframesDoNotConfirmContinuation(mtf, "CALL") && macdState !== "bearish", { h1Trend: mtf?.h1?.trend, m15Trend: mtf?.m15?.trend, macdState }),
    createCriterion("sellerMomentumLosingStrength", hasMomentumLoss(m5, "CALL"), { recentCandles: 4 }),
    createCriterion("volatilityNotExtremelyLow", volatilityFloor, { atr })
  ];

  const putCriteria = [
    createCriterion("liquidityLevelDetected", Number.isFinite(resistance), { resistance, lookbackCandles: range?.candles || 0 }),
    createCriterion("sweepDetected", Boolean(putSweepCandle && putSweepDistance >= minSweepDistance), { sweepDistance: putSweepDistance, minSweepDistance }),
    createCriterion("closeBackInsideRange", Number.isFinite(close) && Number.isFinite(resistance) && close < resistance, { close, resistance }),
    createCriterion("rejectionWickConfirmed", putUpperWick >= lastBody * 0.7 || (Number.isFinite(open) && close < open), { upperWick: putUpperWick, body: lastBody }),
    createCriterion("continuationFailureConfirmed", higherTimeframesDoNotConfirmContinuation(mtf, "PUT") && macdState !== "bullish", { h1Trend: mtf?.h1?.trend, m15Trend: mtf?.m15?.trend, macdState }),
    createCriterion("buyerMomentumLosingStrength", hasMomentumLoss(m5, "PUT"), { recentCandles: 4 }),
    createCriterion("volatilityNotExtremelyLow", volatilityFloor, { atr })
  ];

  const callValid = callCriteria.every((criterion) => criterion.passed);
  const putValid = putCriteria.every((criterion) => criterion.passed);
  const direction = callValid ? "CALL" : putValid ? "PUT" : null;
  const criteria = direction === "CALL" ? callCriteria : direction === "PUT" ? putCriteria : [];

  return {
    direction,
    audit: buildEligibilityAudit({
      strategyName: STRATEGY_NAME,
      direction,
      valid: Boolean(direction),
      criteria,
      candidates: [
        { direction: "CALL", criteria: callCriteria, blockedBy: "sweepDetected" },
        { direction: "PUT", criteria: putCriteria, blockedBy: "sweepDetected" }
      ],
      blockedBy: direction ? null : "liquiditySweepFalseBreakoutNotConfirmed",
      context: { support, resistance, atr, macdState, h1Trend: mtf?.h1?.trend, m15Trend: mtf?.m15?.trend }
    })
  };
}

function calculateScore({ direction, audit, atrLevel, mtf }) {
  let score = 54;

  score += Number(audit.criteriaPassed || 0) * 5;
  if (atrLevel === "medium") score += 5;
  if (atrLevel === "high") score += 3;
  if (mtf?.alignment <= 1) score += 4;
  if (direction === "CALL" && mtf?.dominantDirection !== "down") score += 4;
  if (direction === "PUT" && mtf?.dominantDirection !== "up") score += 4;

  return Math.min(100, Number(score.toFixed(2)));
}

function buildExplanation({ direction, score, range, atrLevel, macdState, mtf }) {
  return [
    "liquidity sweep / false breakout",
    `direção ${direction}`,
    `score ${score}`,
    `suporte ${range.support}`,
    `resistência ${range.resistance}`,
    `ATR ${atrLevel}`,
    `MACD ${macdState}`,
    `H1 ${mtf.h1.trend}`,
    `M15 ${mtf.m15.trend}`
  ].join(" | ");
}

function createLiquiditySweepFalseBreakoutStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < MIN_M5_CANDLES || m15.length < MIN_HIGHER_TIMEFRAME_CANDLES || h1.length < MIN_HIGHER_TIMEFRAME_CANDLES) {
      return invalidResult("insufficient_data");
    }

    const range = getRange(m5, LOOKBACK_MAX);
    if (!range) return invalidResult("range_unavailable");

    const atr = getLastATR(m5, 14);
    const atrLevel = classifyATR(atr);
    const macd = getLastMACD(m5, 12, 26, 9, "close");
    const macdState = getMACDState(macd.macd, macd.signal, macd.histogram);
    const directionAudit = buildDirectionAudit({ m5, mtf, range, atr, macdState });
    const direction = directionAudit.direction;

    if (!direction) return invalidResult("no_liquidity_sweep_false_breakout_setup", directionAudit.audit);

    const score = calculateScore({ direction, audit: directionAudit.audit, atrLevel, mtf });
    const valid = score >= VALID_SCORE_THRESHOLD;

    return {
      name: STRATEGY_NAME,
      valid,
      direction,
      score,
      context: {
        support: range.support,
        resistance: range.resistance,
        lookbackCandles: range.candles,
        atr,
        atrLevel,
        macd,
        macdState,
        alignment: mtf.alignment,
        dominantDirection: mtf.dominantDirection
      },
      explanation: buildExplanation({ direction, score, range, atrLevel, macdState, mtf }),
      eligibilityAudit: {
        ...directionAudit.audit,
        valid,
        direction,
        score,
        blockedBy: valid ? directionAudit.audit.blockedBy : "strategyScoreBelowThreshold"
      }
    };
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

module.exports = {
  createLiquiditySweepFalseBreakoutStrategy
};

const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

const STRATEGY_NAME = "liquidity_sweep_false_breakout";
const MIN_M5_CANDLES = 20;
const MAX_M5_LOOKBACK = 50;
const DEFAULT_M5_LOOKBACK = 40;
const MIN_LOCAL_VOLATILITY_RATIO = 0.00015;
const MIN_SWEEP_DEPTH_RATIO = 0.00003;
const MIN_REJECTION_WICK_RATIO = 0.32;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getCandleRange(candle = {}) {
  return Math.abs(toNumber(candle.high) - toNumber(candle.low));
}

function getBody(candle = {}) {
  return Math.abs(toNumber(candle.close) - toNumber(candle.open));
}

function getLowerWick(candle = {}) {
  return Math.max(0, Math.min(toNumber(candle.open), toNumber(candle.close)) - toNumber(candle.low));
}

function getUpperWick(candle = {}) {
  return Math.max(0, toNumber(candle.high) - Math.max(toNumber(candle.open), toNumber(candle.close)));
}

function round(value, decimals = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number(numeric.toFixed(decimals));
}

function getRecentStructure(candles = [], lookback = DEFAULT_M5_LOOKBACK) {
  const boundedLookback = Math.max(MIN_M5_CANDLES, Math.min(MAX_M5_LOOKBACK, Number(lookback || DEFAULT_M5_LOOKBACK)));
  const completedRange = candles.slice(Math.max(0, candles.length - boundedLookback - 1), -1);
  const ranges = completedRange.map(getCandleRange).filter((range) => range > 0);
  const closes = completedRange.map((candle) => toNumber(candle.close)).filter((close) => close > 0);
  const support = completedRange.reduce((min, candle) => Math.min(min, toNumber(candle.low, min)), Number.POSITIVE_INFINITY);
  const resistance = completedRange.reduce((max, candle) => Math.max(max, toNumber(candle.high, max)), Number.NEGATIVE_INFINITY);
  const averageRange = ranges.length
    ? ranges.reduce((total, range) => total + range, 0) / ranges.length
    : 0;
  const averageClose = closes.length
    ? closes.reduce((total, close) => total + close, 0) / closes.length
    : 0;

  return {
    lookback: completedRange.length,
    support: Number.isFinite(support) ? support : null,
    resistance: Number.isFinite(resistance) ? resistance : null,
    averageRange,
    averageClose,
    localVolatilityRatio: averageClose > 0 ? averageRange / averageClose : 0
  };
}

function getDirectionalBody(candle = {}, direction) {
  const open = toNumber(candle.open);
  const close = toNumber(candle.close);

  if (direction === "bearish") return Math.max(0, open - close);
  if (direction === "bullish") return Math.max(0, close - open);
  return 0;
}

function isSellerMomentumWeakening(m5 = []) {
  const recent = m5.slice(-4);
  const bearishBodies = recent.map((candle) => getDirectionalBody(candle, "bearish"));
  const last = bearishBodies[bearishBodies.length - 1] || 0;
  const previousMax = Math.max(...bearishBodies.slice(0, -1), 0);
  const lastCandle = recent[recent.length - 1] || {};

  return last <= previousMax * 0.75 || toNumber(lastCandle.close) >= toNumber(lastCandle.open);
}

function isBuyerMomentumWeakening(m5 = []) {
  const recent = m5.slice(-4);
  const bullishBodies = recent.map((candle) => getDirectionalBody(candle, "bullish"));
  const last = bullishBodies[bullishBodies.length - 1] || 0;
  const previousMax = Math.max(...bullishBodies.slice(0, -1), 0);
  const lastCandle = recent[recent.length - 1] || {};

  return last <= previousMax * 0.75 || toNumber(lastCandle.close) <= toNumber(lastCandle.open);
}

function isContinuationFailureConfirmed(mtf = {}, direction) {
  const h1Trend = mtf?.h1?.trend || mtf?.h1?.direction || "neutral";
  const m15Trend = mtf?.m15?.trend || mtf?.m15?.direction || "neutral";

  if (direction === "CALL") {
    return !(h1Trend === "down" && m15Trend === "down" && Number(mtf.alignment || 0) >= 2);
  }

  if (direction === "PUT") {
    return !(h1Trend === "up" && m15Trend === "up" && Number(mtf.alignment || 0) >= 2);
  }

  return false;
}

function buildCandidateCriteria({ direction, m5, mtf, lastM5, previousM5, structure }) {
  const range = getCandleRange(lastM5);
  const body = getBody(lastM5);
  const lowerWick = getLowerWick(lastM5);
  const upperWick = getUpperWick(lastM5);
  const support = structure.support;
  const resistance = structure.resistance;
  const close = toNumber(lastM5.close);
  const low = toNumber(lastM5.low);
  const high = toNumber(lastM5.high);
  const open = toNumber(lastM5.open);
  const previousClose = toNumber(previousM5.close);
  const minimumSweepDepth = Math.max(structure.averageClose * MIN_SWEEP_DEPTH_RATIO, structure.averageRange * 0.08);
  const hasTradableLocalVolatility = structure.localVolatilityRatio >= MIN_LOCAL_VOLATILITY_RATIO;

  if (direction === "CALL") {
    const sweepDepth = support !== null ? support - low : 0;
    const liquidityLevelDetected = support !== null && structure.lookback >= MIN_M5_CANDLES;
    const sweepDetected = liquidityLevelDetected && sweepDepth >= minimumSweepDepth;
    const closeBackInsideRange = liquidityLevelDetected && close > support && (resistance === null || close <= resistance);
    const rejectionWickConfirmed = range > 0 && lowerWick / range >= MIN_REJECTION_WICK_RATIO && lowerWick >= body * 0.65;
    const continuationFailureConfirmed = isContinuationFailureConfirmed(mtf, "CALL");
    const sellerMomentumLost = isSellerMomentumWeakening(m5);

    return [
      createCriterion("liquidityLevelDetected", liquidityLevelDetected, { support, lookback: structure.lookback }),
      createCriterion("sweepDetected", sweepDetected, { low, support, sweepDepth: round(sweepDepth), minimumSweepDepth: round(minimumSweepDepth) }),
      createCriterion("closeBackInsideRange", closeBackInsideRange, { close, support, resistance }),
      createCriterion("rejectionWickConfirmed", rejectionWickConfirmed, { lowerWick: round(lowerWick), body: round(body), range: round(range) }),
      createCriterion("continuationFailureConfirmed", continuationFailureConfirmed, { h1: mtf?.h1?.trend, m15: mtf?.m15?.trend, alignment: mtf?.alignment }),
      createCriterion("sellerMomentumLost", sellerMomentumLost, { open, close, previousClose }),
      createCriterion("tradableLocalVolatility", hasTradableLocalVolatility, { localVolatilityRatio: round(structure.localVolatilityRatio), minimum: MIN_LOCAL_VOLATILITY_RATIO })
    ];
  }

  const sweepDepth = resistance !== null ? high - resistance : 0;
  const liquidityLevelDetected = resistance !== null && structure.lookback >= MIN_M5_CANDLES;
  const sweepDetected = liquidityLevelDetected && sweepDepth >= minimumSweepDepth;
  const closeBackInsideRange = liquidityLevelDetected && close < resistance && (support === null || close >= support);
  const rejectionWickConfirmed = range > 0 && upperWick / range >= MIN_REJECTION_WICK_RATIO && upperWick >= body * 0.65;
  const continuationFailureConfirmed = isContinuationFailureConfirmed(mtf, "PUT");
  const buyerMomentumLost = isBuyerMomentumWeakening(m5);

  return [
    createCriterion("liquidityLevelDetected", liquidityLevelDetected, { resistance, lookback: structure.lookback }),
    createCriterion("sweepDetected", sweepDetected, { high, resistance, sweepDepth: round(sweepDepth), minimumSweepDepth: round(minimumSweepDepth) }),
    createCriterion("closeBackInsideRange", closeBackInsideRange, { close, support, resistance }),
    createCriterion("rejectionWickConfirmed", rejectionWickConfirmed, { upperWick: round(upperWick), body: round(body), range: round(range) }),
    createCriterion("continuationFailureConfirmed", continuationFailureConfirmed, { h1: mtf?.h1?.trend, m15: mtf?.m15?.trend, alignment: mtf?.alignment }),
    createCriterion("buyerMomentumLost", buyerMomentumLost, { open, close, previousClose }),
    createCriterion("tradableLocalVolatility", hasTradableLocalVolatility, { localVolatilityRatio: round(structure.localVolatilityRatio), minimum: MIN_LOCAL_VOLATILITY_RATIO })
  ];
}

function calculateScore({ criteria, direction, lastM5, structure }) {
  const passed = criteria.filter((criterion) => criterion.passed).length;
  let score = 46 + passed * 7;
  const range = getCandleRange(lastM5);
  const wick = direction === "CALL" ? getLowerWick(lastM5) : getUpperWick(lastM5);
  const level = direction === "CALL" ? structure.support : structure.resistance;
  const sweepDepth = direction === "CALL" ? level - toNumber(lastM5.low) : toNumber(lastM5.high) - level;

  if (range > 0 && wick / range >= 0.45) score += 5;
  if (sweepDepth >= structure.averageRange * 0.18) score += 4;
  if (structure.localVolatilityRatio >= MIN_LOCAL_VOLATILITY_RATIO * 2) score += 3;

  return Math.min(100, Number(score.toFixed(2)));
}

function buildExplanation({ direction, score, structure }) {
  const side = direction === "CALL" ? "CALL após varredura de suporte" : "PUT após varredura de resistência";

  return [
    `liquidity sweep / false breakout ${side}`,
    `score ${score}`,
    `lookback M5 ${structure.lookback}`,
    `volatilidade local ${round(structure.localVolatilityRatio)}`
  ].join(" | ");
}

function createLiquiditySweepFalseBreakoutStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < MIN_M5_CANDLES + 1 || m15.length < 10 || h1.length < 10) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1] || {};
    const previousM5 = m5[m5.length - 2] || {};
    const structure = getRecentStructure(m5);
    const bullishCriteria = buildCandidateCriteria({ direction: "CALL", m5, mtf, lastM5, previousM5, structure });
    const bearishCriteria = buildCandidateCriteria({ direction: "PUT", m5, mtf, lastM5, previousM5, structure });
    const bullishPassed = bullishCriteria.filter((criterion) => criterion.passed).length;
    const bearishPassed = bearishCriteria.filter((criterion) => criterion.passed).length;
    const direction = bullishCriteria.every((criterion) => criterion.passed)
      ? "CALL"
      : bearishCriteria.every((criterion) => criterion.passed)
        ? "PUT"
        : null;
    const closestDirection = bullishPassed >= bearishPassed ? "CALL" : "PUT";
    const activeCriteria = direction === "CALL" ? bullishCriteria : direction === "PUT" ? bearishCriteria : (closestDirection === "CALL" ? bullishCriteria : bearishCriteria);
    const score = direction ? calculateScore({ criteria: activeCriteria, direction, lastM5, structure }) : Math.round((Math.max(bullishPassed, bearishPassed) / activeCriteria.length) * 100);
    const valid = Boolean(direction && score >= 72);
    const audit = buildEligibilityAudit({
      strategyName: STRATEGY_NAME,
      direction,
      valid,
      criteria: activeCriteria,
      candidates: [
        { direction: "CALL", criteria: bullishCriteria, blockedBy: "liquiditySweepCallNotConfirmed" },
        { direction: "PUT", criteria: bearishCriteria, blockedBy: "liquiditySweepPutNotConfirmed" }
      ],
      score,
      blockedBy: direction && !valid ? "strategyScoreBelowThreshold" : "liquiditySweepFalseBreakoutNotConfirmed",
      context: {
        support: structure.support,
        resistance: structure.resistance,
        lookback: structure.lookback,
        localVolatilityRatio: round(structure.localVolatilityRatio),
        closestDirection
      }
    });

    if (!valid) {
      return {
        name: STRATEGY_NAME,
        valid: false,
        direction: direction || null,
        score,
        context: audit.context,
        explanation: audit.blockedBy || "liquidity sweep / false breakout não confirmado",
        eligibilityAudit: audit,
        activationReason: null
      };
    }

    return {
      name: STRATEGY_NAME,
      valid,
      direction,
      score,
      context: audit.context,
      explanation: buildExplanation({ direction, score, structure }),
      eligibilityAudit: audit,
      activationReason: audit.activationReason
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
      eligibilityAudit: eligibilityAudit || invalidEligibilityAudit(STRATEGY_NAME, reason),
      activationReason: null
    };
  }

  return { evaluate };
}

module.exports = {
  createLiquiditySweepFalseBreakoutStrategy
};

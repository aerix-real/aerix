const { getLastEMAFromCandles } = require("../indicators/ema.indicator");
const { getLastADX, getADXState } = require("../indicators/adx.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

function createTrendContinuationStrategy() {
  function evaluate({ m5, m15, h1, mtf, mode = "balanced" }) {
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

    const directionAudit = buildDirectionAudit({
      lastM5,
      lastM15,
      lastH1,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      mtf,
      mode
    });
    const direction = directionAudit.direction;

    if (!direction) {
      return invalidResult("no_direction", directionAudit.audit);
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

    const modeRules = getOperationalModeRules(mode);
    const partialScore = Number(directionAudit.audit?.score || 0);
    const valid = Boolean(
      direction &&
      partialScore >= modeRules.minPartialScore &&
      score >= modeRules.minStrategyScore
    );

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
      }),
      eligibilityAudit: {
        ...directionAudit.audit,
        valid,
        direction,
        strategyScore: score,
        blockedBy: valid
          ? null
          : directionAudit.audit.blockedBy || "strategyScoreBelowThreshold"
      }
    };
  }

  function normalizeMode(mode = "balanced") {
    const normalized = String(mode || "balanced").toLowerCase();

    if (["conservador", "conservative"].includes(normalized)) return "conservative";
    if (["agressivo", "aggressive"].includes(normalized)) return "aggressive";

    return "balanced";
  }

  function getOperationalModeRules(mode = "balanced") {
    const rules = {
      conservative: {
        minAlignment: 3,
        minPartialScore: 100,
        minStrategyScore: 100,
        requireM5M15Aligned: true,
        requireAllCriteria: true
      },
      balanced: {
        minAlignment: 2,
        minPartialScore: 65,
        minStrategyScore: 70,
        requireM5M15Aligned: true,
        requireAllCriteria: false
      },
      aggressive: {
        minAlignment: 2,
        minPartialScore: 60,
        minStrategyScore: 60,
        requireM5M15Aligned: false,
        requireAllCriteria: false
      }
    };

    return rules[normalizeMode(mode)];
  }

  function trendToDirection(trend) {
    if (trend === "up") return "CALL";
    if (trend === "down") return "PUT";
    return null;
  }

  function getCandidatePartialScore(criteria = []) {
    const safeCriteria = Array.isArray(criteria) ? criteria : [];
    if (!safeCriteria.length) return 0;

    const passed = safeCriteria.filter((criterion) => criterion.passed).length;
    return Number(((passed / safeCriteria.length) * 100).toFixed(2));
  }

  function isM5M15AlignedForDirection(mtf = {}, direction = null) {
    const expectedTrend = direction === "CALL" ? "up" : direction === "PUT" ? "down" : null;

    return Boolean(
      expectedTrend &&
      mtf.m5?.trend === expectedTrend &&
      mtf.m15?.trend === expectedTrend
    );
  }

  function getOperationalBlocker({ criteria, mtf, direction, rules }) {
    const partialScore = getCandidatePartialScore(criteria);

    if (Number(mtf?.alignment || 0) < rules.minAlignment) return "timeframeAlignmentBelowModeMinimum";
    if (rules.requireM5M15Aligned && !isM5M15AlignedForDirection(mtf, direction)) return "m5M15AlignmentRequired";
    if (rules.requireAllCriteria && criteria.some((criterion) => !criterion.passed)) return "trendAlignment";
    if (partialScore < rules.minPartialScore) return "partialScoreBelowModeMinimum";

    return null;
  }

  function buildDirectionAudit(input) {
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
      mtf,
      mode = "balanced"
    } = input;

    const bullishCriteria = [
      createCriterion("h1TrendUp", mtf.h1.trend === "up", { actual: mtf.h1.trend }),
      createCriterion("m15TrendUp", mtf.m15.trend === "up", { actual: mtf.m15.trend }),
      createCriterion("trendAligned", mtf.dominantDirection === "up", { dominantDirection: mtf.dominantDirection }),
      createCriterion("emaH1Bullish", ema9H1 > ema21H1, { ema9H1, ema21H1 }),
      createCriterion("emaM15Bullish", ema9M15 > ema21M15, { ema9M15, ema21M15 }),
      createCriterion("emaM5Bullish", ema9M5 > ema21M5, { ema9M5, ema21M5 }),
      createCriterion("priceAboveH1Ema", lastH1.close > ema9H1, { close: lastH1.close, ema9H1 }),
      createCriterion("priceAboveM15Ema", lastM15.close > ema9M15, { close: lastM15.close, ema9M15 }),
      createCriterion("priceAboveM5Ema", lastM5.close > ema9M5, { close: lastM5.close, ema9M5 })
    ];

    const bearishCriteria = [
      createCriterion("h1TrendDown", mtf.h1.trend === "down", { actual: mtf.h1.trend }),
      createCriterion("m15TrendDown", mtf.m15.trend === "down", { actual: mtf.m15.trend }),
      createCriterion("trendAligned", mtf.dominantDirection === "down", { dominantDirection: mtf.dominantDirection }),
      createCriterion("emaH1Bearish", ema9H1 < ema21H1, { ema9H1, ema21H1 }),
      createCriterion("emaM15Bearish", ema9M15 < ema21M15, { ema9M15, ema21M15 }),
      createCriterion("emaM5Bearish", ema9M5 < ema21M5, { ema9M5, ema21M5 }),
      createCriterion("priceBelowH1Ema", lastH1.close < ema9H1, { close: lastH1.close, ema9H1 }),
      createCriterion("priceBelowM15Ema", lastM15.close < ema9M15, { close: lastM15.close, ema9M15 }),
      createCriterion("priceBelowM5Ema", lastM5.close < ema9M5, { close: lastM5.close, ema9M5 })
    ];

    const rules = getOperationalModeRules(mode);
    const candidates = [
      { direction: "CALL", criteria: bullishCriteria },
      { direction: "PUT", criteria: bearishCriteria }
    ].map((candidate) => ({
      ...candidate,
      partialScore: getCandidatePartialScore(candidate.criteria),
      blockedBy: getOperationalBlocker({
        criteria: candidate.criteria,
        mtf,
        direction: candidate.direction,
        rules
      })
    }));

    const preferredDirection = trendToDirection(mtf.dominantDirection);
    const eligibleCandidates = candidates
      .filter((candidate) => !candidate.blockedBy)
      .sort((left, right) => {
        if (left.direction === preferredDirection && right.direction !== preferredDirection) return -1;
        if (right.direction === preferredDirection && left.direction !== preferredDirection) return 1;
        return right.partialScore - left.partialScore;
      });
    const selectedCandidate = eligibleCandidates[0] || null;
    const closestCandidate = [...candidates].sort((left, right) => {
      if (right.partialScore !== left.partialScore) return right.partialScore - left.partialScore;
      if (left.direction === preferredDirection && right.direction !== preferredDirection) return -1;
      if (right.direction === preferredDirection && left.direction !== preferredDirection) return 1;
      return 0;
    })[0] || null;
    const direction = selectedCandidate?.direction || null;
    const criteria = selectedCandidate?.criteria || closestCandidate?.criteria || [];
    const audit = buildEligibilityAudit({
      strategyName: "trend_continuation",
      direction,
      valid: Boolean(direction),
      criteria,
      candidates,
      blockedBy: selectedCandidate?.blockedBy || closestCandidate?.blockedBy || null,
      context: {
        alignment: mtf.alignment,
        dominantDirection: mtf.dominantDirection,
        mode: normalizeMode(mode),
        minAlignment: rules.minAlignment,
        minPartialScore: rules.minPartialScore,
        minStrategyScore: rules.minStrategyScore,
        requireM5M15Aligned: rules.requireM5M15Aligned
      }
    });

    return {
      direction,
      audit: {
        ...audit,
        blockedBy: direction ? audit.blockedBy : closestCandidate?.blockedBy || audit.blockedBy
      }
    };
  }

  function resolveDirection(input) {
    return buildDirectionAudit(input).direction;
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

  function invalidResult(reason, eligibilityAudit = null) {
    return {
      name: "trend_continuation",
      valid: false,
      direction: null,
      score: 0,
      context: {},
      explanation: reason,
      eligibilityAudit: eligibilityAudit || invalidEligibilityAudit("trend_continuation", reason)
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
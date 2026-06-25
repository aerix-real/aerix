const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");
const { getNearestSupportResistance } = require("../indicators/support-resistance.indicator");

const STRATEGY_NAME = "liquidity_sweep_false_breakout";

function getCandleRange(candle = {}) {
  return Math.abs(Number(candle.high || 0) - Number(candle.low || 0));
}

function createLiquiditySweepFalseBreakoutStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 30 || m15.length < 30 || h1.length < 20) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1] || {};
    const previousM5 = m5[m5.length - 2] || {};
    const sr = getNearestSupportResistance(m15, 40, 0.00045);
    const directionAudit = buildDirectionAudit({ mtf, lastM5, previousM5, sr });
    const direction = directionAudit.direction;

    if (!direction) {
      return invalidResult("no_liquidity_sweep_false_breakout_setup", directionAudit.audit);
    }

    const score = calculateScore({ direction, mtf, lastM5, previousM5, sr });
    const valid = score >= 72;

    return {
      name: STRATEGY_NAME,
      valid,
      direction,
      score,
      context: {
        nearestSupport: sr.nearestSupport,
        nearestResistance: sr.nearestResistance,
        alignment: mtf.alignment
      },
      explanation: buildExplanation({ direction, score, mtf }),
      eligibilityAudit: {
        ...directionAudit.audit,
        valid,
        direction,
        score,
        blockedBy: valid ? directionAudit.audit.blockedBy : "strategyScoreBelowThreshold"
      }
    };
  }

  function buildDirectionAudit({ mtf, lastM5, previousM5, sr }) {
    const bullishCriteria = [
      createCriterion("supportAvailable", sr.nearestSupport !== null, { nearestSupport: sr.nearestSupport }),
      createCriterion("liquiditySweepBelowSupport", sr.nearestSupport !== null && Number(lastM5.low) < Number(sr.nearestSupport), { low: lastM5.low, nearestSupport: sr.nearestSupport }),
      createCriterion("falseBreakoutRecovery", sr.nearestSupport !== null && Number(lastM5.close) > Number(sr.nearestSupport), { close: lastM5.close, nearestSupport: sr.nearestSupport }),
      createCriterion("bullishRejectionCandle", Number(lastM5.close) > Number(lastM5.open), { open: lastM5.open, close: lastM5.close }),
      createCriterion("priorCandleContext", Number(previousM5.close) <= Number(sr.nearestSupport || previousM5.close), { previousClose: previousM5.close, nearestSupport: sr.nearestSupport }),
      createCriterion("trendNotStronglyOpposed", mtf.dominantDirection !== "down" || mtf.alignment < 3, { dominantDirection: mtf.dominantDirection, alignment: mtf.alignment })
    ];

    const bearishCriteria = [
      createCriterion("resistanceAvailable", sr.nearestResistance !== null, { nearestResistance: sr.nearestResistance }),
      createCriterion("liquiditySweepAboveResistance", sr.nearestResistance !== null && Number(lastM5.high) > Number(sr.nearestResistance), { high: lastM5.high, nearestResistance: sr.nearestResistance }),
      createCriterion("falseBreakoutRejection", sr.nearestResistance !== null && Number(lastM5.close) < Number(sr.nearestResistance), { close: lastM5.close, nearestResistance: sr.nearestResistance }),
      createCriterion("bearishRejectionCandle", Number(lastM5.close) < Number(lastM5.open), { open: lastM5.open, close: lastM5.close }),
      createCriterion("priorCandleContext", Number(previousM5.close) >= Number(sr.nearestResistance || previousM5.close), { previousClose: previousM5.close, nearestResistance: sr.nearestResistance }),
      createCriterion("trendNotStronglyOpposed", mtf.dominantDirection !== "up" || mtf.alignment < 3, { dominantDirection: mtf.dominantDirection, alignment: mtf.alignment })
    ];

    const bullishSetup = bullishCriteria.every((criterion) => criterion.passed);
    const bearishSetup = bearishCriteria.every((criterion) => criterion.passed);
    const direction = bullishSetup ? "CALL" : bearishSetup ? "PUT" : null;
    const criteria = direction === "CALL" ? bullishCriteria : direction === "PUT" ? bearishCriteria : [];

    return {
      direction,
      audit: buildEligibilityAudit({
        strategyName: STRATEGY_NAME,
        direction,
        valid: Boolean(direction),
        criteria,
        candidates: [
          { direction: "CALL", criteria: bullishCriteria, blockedBy: "falseBreakoutRecovery" },
          { direction: "PUT", criteria: bearishCriteria, blockedBy: "falseBreakoutRejection" }
        ],
        blockedBy: direction ? null : "liquiditySweepFalseBreakoutNotConfirmed",
        context: { alignment: mtf.alignment, dominantDirection: mtf.dominantDirection }
      })
    };
  }

  function calculateScore({ direction, mtf, lastM5, previousM5, sr }) {
    let score = 58;
    const range = getCandleRange(lastM5);
    const previousRange = getCandleRange(previousM5);

    if (mtf.alignment <= 1) score += 8;
    if (mtf.alignment === 2) score += 5;
    if (range > previousRange) score += 6;

    if (direction === "CALL" && sr.nearestSupport !== null) {
      const recovery = Number(lastM5.close) - Number(sr.nearestSupport);
      const sweepDepth = Number(sr.nearestSupport) - Number(lastM5.low);
      if (recovery > 0) score += 6;
      if (sweepDepth > 0) score += 7;
    }

    if (direction === "PUT" && sr.nearestResistance !== null) {
      const rejection = Number(sr.nearestResistance) - Number(lastM5.close);
      const sweepDepth = Number(lastM5.high) - Number(sr.nearestResistance);
      if (rejection > 0) score += 6;
      if (sweepDepth > 0) score += 7;
    }

    if (score > 100) score = 100;
    return Number(score.toFixed(2));
  }

  function buildExplanation({ direction, score, mtf }) {
    const side = direction === "CALL" ? "alta" : "baixa";

    return [
      `liquidity sweep / false breakout em ${side}`,
      `score ${score}`,
      `H1 ${mtf.h1.trend}`,
      `M15 ${mtf.m15.trend}`,
      `alinhamento ${mtf.alignment}/3`
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

module.exports = {
  createLiquiditySweepFalseBreakoutStrategy
};

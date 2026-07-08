const { getLastEMAFromCandles } = require("../indicators/ema.indicator");
const { getLastATR, classifyATR } = require("../indicators/atr.indicator");
const { buildEligibilityAudit, createCriterion, invalidEligibilityAudit } = require("./eligibility-audit");

const STRATEGY_NAME = "institutional_first_retest";
const MIN_SCORE = 74;

function createInstitutionalFirstRetestStrategy() {
  function evaluate({ m5, m15, h1, mtf }) {
    if (!Array.isArray(m5) || !Array.isArray(m15) || !Array.isArray(h1) || !mtf) {
      return invalidResult("invalid_input");
    }

    if (m5.length < 45 || m15.length < 35 || h1.length < 30) {
      return invalidResult("insufficient_data");
    }

    const lastM5 = m5[m5.length - 1];
    const previousM5 = m5[m5.length - 2];
    const ema9M5 = getLastEMAFromCandles(m5, 9);
    const ema21M5 = getLastEMAFromCandles(m5, 21);
    const ema9M15 = getLastEMAFromCandles(m15, 9);
    const ema21M15 = getLastEMAFromCandles(m15, 21);
    const ema9H1 = getLastEMAFromCandles(h1, 9);
    const ema21H1 = getLastEMAFromCandles(h1, 21);
    const atr = getLastATR(m15, 14);
    const atrLevel = classifyATR(atr);

    if (!isFiniteNumber(ema9M5) || !isFiniteNumber(ema21M5) || !isFiniteNumber(ema9M15) || !isFiniteNumber(ema21M15) || !isFiniteNumber(ema9H1) || !isFiniteNumber(ema21H1)) {
      return invalidResult("indicator_unavailable");
    }

    const directionAudit = buildDirectionAudit({
      m5,
      m15,
      mtf,
      lastM5,
      previousM5,
      ema9M5,
      ema21M5,
      ema9M15,
      ema21M15,
      ema9H1,
      ema21H1,
      atr
    });
    const direction = directionAudit.direction;

    if (!direction) {
      return invalidResult("no_institutional_first_retest_setup", directionAudit.audit);
    }

    const setup = directionAudit.setup;
    const score = calculateScore({ direction, mtf, atrLevel, setup, lastM5, ema9M5, ema21M5 });
    const valid = score >= MIN_SCORE;

    return {
      name: STRATEGY_NAME,
      valid,
      direction,
      score,
      context: {
        atr,
        atrLevel,
        breakoutLevel: setup.breakoutLevel,
        breakoutIndex: setup.breakoutIndex,
        firstRetestCount: setup.firstRetestCount,
        maxAfastamento: setup.maxAfastamento,
        alignment: mtf.alignment,
        dominantDirection: mtf.dominantDirection
      },
      explanation: buildExplanation({ direction, score, mtf, atrLevel, setup }),
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
    const bullishSetup = analyzeRetest(input, "CALL");
    const bearishSetup = analyzeRetest(input, "PUT");
    const bullishCriteria = buildCriteria(input, "CALL", bullishSetup);
    const bearishCriteria = buildCriteria(input, "PUT", bearishSetup);
    const bullish = bullishCriteria.every((criterion) => criterion.passed);
    const bearish = bearishCriteria.every((criterion) => criterion.passed);
    const direction = bullish ? "CALL" : bearish ? "PUT" : null;
    const criteria = direction === "CALL" ? bullishCriteria : direction === "PUT" ? bearishCriteria : [];
    const setup = direction === "CALL" ? bullishSetup : direction === "PUT" ? bearishSetup : (bullishSetup.score >= bearishSetup.score ? bullishSetup : bearishSetup);

    return {
      direction,
      setup,
      audit: buildEligibilityAudit({
        strategyName: STRATEGY_NAME,
        valid: Boolean(direction),
        direction,
        criteria,
        candidates: [
          { direction: "CALL", criteria: bullishCriteria, blockedBy: bullishSetup.blockedBy },
          { direction: "PUT", criteria: bearishCriteria, blockedBy: bearishSetup.blockedBy }
        ],
        blockedBy: direction ? null : setup.blockedBy,
        context: {
          firstRetestCount: setup.firstRetestCount,
          breakoutLevel: setup.breakoutLevel,
          breakoutIndex: setup.breakoutIndex,
          maxAfastamento: setup.maxAfastamento,
          alignment: input.mtf.alignment,
          dominantDirection: input.mtf.dominantDirection
        }
      })
    };
  }

  function buildCriteria(input, direction, setup) {
    const bullish = direction === "CALL";
    const expectedTrend = bullish ? "up" : "down";
    const trendAligned = Boolean(
      input.mtf.dominantDirection === expectedTrend &&
      input.mtf.alignment >= 2 &&
      (bullish
        ? input.ema9H1 >= input.ema21H1 && input.ema9M15 >= input.ema21M15 && input.ema9M5 >= input.ema21M5
        : input.ema9H1 <= input.ema21H1 && input.ema9M15 <= input.ema21M15 && input.ema9M5 <= input.ema21M5)
    );

    return [
      createCriterion("breakoutConfirmed", setup.breakoutConfirmed, setup),
      createCriterion("minimumDisplacement", setup.minimumDisplacement, { maxAfastamento: setup.maxAfastamento, requiredAfastamento: setup.requiredAfastamento }),
      createCriterion("firstRetestDetected", setup.firstRetestDetected && setup.firstRetestCount === 1, { firstRetestCount: setup.firstRetestCount }),
      createCriterion("structureHolding", setup.structureHolding, { breakoutLevel: setup.breakoutLevel, lastLow: input.lastM5.low, lastHigh: input.lastM5.high }),
      createCriterion("confirmationCandle", bullish ? isBullishConfirmation(input.lastM5, input.previousM5) : isBearishConfirmation(input.lastM5, input.previousM5), { close: input.lastM5.close, open: input.lastM5.open, previousClose: input.previousM5.close }),
      createCriterion("trendAligned", trendAligned, { dominantDirection: input.mtf.dominantDirection, alignment: input.mtf.alignment })
    ];
  }

  return { evaluate };
}

function analyzeRetest(input, direction) {
  const bullish = direction === "CALL";
  const candles = input.m5;
  const atr = Number(input.atr);
  const tolerance = Math.max(atr * 0.18, averageRange(candles.slice(-20)) * 0.25);
  const requiredAfastamento = Math.max(atr * 0.35, averageRange(candles.slice(-20)) * 0.8);
  let breakoutIndex = -1;
  let breakoutLevel = null;

  for (let index = candles.length - 7; index >= Math.max(20, candles.length - 28); index -= 1) {
    const prior = candles.slice(index - 14, index);
    const level = bullish ? highest(prior, "high") : lowest(prior, "low");
    const candle = candles[index];
    const confirmed = bullish
      ? Number(candle.close) > level + tolerance && Number(candle.high) > level + tolerance
      : Number(candle.close) < level - tolerance && Number(candle.low) < level - tolerance;
    if (confirmed) {
      breakoutIndex = index;
      breakoutLevel = level;
      break;
    }
  }

  const afterBreakout = breakoutIndex >= 0 ? candles.slice(breakoutIndex + 1) : [];
  const maxAfastamento = breakoutLevel === null ? 0 : bullish
    ? Math.max(...afterBreakout.map((candle) => Number(candle.high) - breakoutLevel), 0)
    : Math.max(...afterBreakout.map((candle) => breakoutLevel - Number(candle.low)), 0);
  const firstRetestCount = breakoutLevel === null ? 0 : afterBreakout.filter((candle) => bullish
    ? Number(candle.low) <= breakoutLevel + tolerance
    : Number(candle.high) >= breakoutLevel - tolerance
  ).length;
  const last = candles[candles.length - 1];
  const structureHolding = breakoutLevel !== null && (bullish
    ? Number(last.close) >= breakoutLevel && Number(last.low) >= breakoutLevel - tolerance
    : Number(last.close) <= breakoutLevel && Number(last.high) <= breakoutLevel + tolerance);
  const breakoutConfirmed = breakoutIndex >= 0;
  const minimumDisplacement = maxAfastamento >= requiredAfastamento;
  const firstRetestDetected = firstRetestCount === 1;

  return {
    breakoutConfirmed,
    minimumDisplacement,
    firstRetestDetected,
    structureHolding,
    firstRetestCount,
    breakoutIndex,
    breakoutLevel,
    maxAfastamento: Number(maxAfastamento.toFixed(6)),
    requiredAfastamento: Number(requiredAfastamento.toFixed(6)),
    score: [breakoutConfirmed, minimumDisplacement, firstRetestDetected, structureHolding].filter(Boolean).length * 25,
    blockedBy: firstRetestCount > 1 ? "firstRetestCountExceeded" : "breakoutConfirmed"
  };
}

function calculateScore({ direction, mtf, atrLevel, setup, lastM5, ema9M5, ema21M5 }) {
  let score = 58;
  if (mtf.alignment >= 3) score += 10;
  if (mtf.alignment === 2) score += 6;
  if (setup.firstRetestCount === 1) score += 10;
  if (setup.maxAfastamento >= setup.requiredAfastamento * 1.5) score += 5;
  if (["medium", "high"].includes(atrLevel)) score += 4;
  if (direction === "CALL" && Number(lastM5.close) > Number(ema9M5) && Number(ema9M5) >= Number(ema21M5)) score += 5;
  if (direction === "PUT" && Number(lastM5.close) < Number(ema9M5) && Number(ema9M5) <= Number(ema21M5)) score += 5;
  return Number(Math.min(100, score).toFixed(2));
}

function buildExplanation({ direction, score, mtf, atrLevel, setup }) {
  return [
    `institutional first retest ${direction}`,
    `score ${score}`,
    `firstRetestCount ${setup.firstRetestCount}`,
    `breakoutLevel ${setup.breakoutLevel}`,
    `alignment ${mtf.alignment}`,
    `ATR ${atrLevel}`
  ].join(" | ");
}

function isBullishConfirmation(candle = {}, previous = {}) {
  return Number(candle.close) > Number(candle.open) && Number(candle.close) > Number(previous.close);
}

function isBearishConfirmation(candle = {}, previous = {}) {
  return Number(candle.close) < Number(candle.open) && Number(candle.close) < Number(previous.close);
}

function highest(candles = [], field) {
  return Math.max(...candles.map((candle) => Number(candle?.[field])).filter(Number.isFinite));
}

function lowest(candles = [], field) {
  return Math.min(...candles.map((candle) => Number(candle?.[field])).filter(Number.isFinite));
}

function averageRange(candles = []) {
  const ranges = candles.map((candle) => Number(candle.high) - Number(candle.low)).filter(Number.isFinite);
  if (!ranges.length) return 0;
  return ranges.reduce((total, value) => total + value, 0) / ranges.length;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
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

module.exports = {
  createInstitutionalFirstRetestStrategy
};

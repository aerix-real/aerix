const assert = require("assert");
const { buildPreSignalOpportunity, getNextCandleOpen } = require("../src/strategy/strategy-runner.service");

function snapshot(overrides = {}) {
  const candle = { time: "2026-07-12T14:20:00.000Z", close: 100, closed: true };
  return {
    symbol: "EUR/USD",
    timestamp: "2026-07-12T14:23:42.000Z",
    dataQuality: { isFallback: false },
    timeframes: {
      m5: { candles: Array(60).fill(candle), volatilityPercent: 0.2, direction: "up" },
      m15: { candles: Array(60).fill(candle), direction: "up" },
      h1: { candles: Array(60).fill(candle), direction: "up" }
    },
    ...overrides
  };
}

function strategy(name, direction, score, failed = ["aguardando candle de recuperação"]) {
  return {
    name,
    valid: false,
    direction,
    score,
    rawScore: score,
    weightedScore: score,
    explanation: `${name} próximo da confirmação`,
    eligibilityAudit: {
      direction,
      score,
      criteriaPassed: 3,
      criteria: [
        { label: "tendência alinhada", passed: true },
        ...failed.map((label) => ({ label, passed: false }))
      ],
      blockedBy: failed[0]
    }
  };
}

const mtf = { alignment: 2, dominantDirection: "up", isAligned: false };
const okValidation = { shouldBlock: false, hasInsufficientCandles: false };

{
  const opportunity = buildPreSignalOpportunity({
    snapshot: snapshot(),
    mode: "balanced",
    evaluated: [strategy("institutional_pullback", "CALL", 72)],
    mtf,
    marketRegime: "TRENDING",
    marketValidation: okValidation
  });
  assert.equal(opportunity.signalState, "POSSIBILITY");
  assert.equal(opportunity.executionAllowed, false);
  assert.equal(opportunity.preSignal, true);
  assert.equal(opportunity.direction, "CALL");
  assert.equal(opportunity.suggestedEntryAt, "2026-07-12T14:25:00.000Z");
  assert.equal(opportunity.pendingConfirmations.length, 1);
}

{
  const conflict = buildPreSignalOpportunity({
    snapshot: snapshot(),
    mode: "aggressive",
    evaluated: [strategy("momentum", "CALL", 70), strategy("liquidity_sweep_false_breakout", "PUT", 70)],
    mtf,
    marketRegime: "REVERSAL",
    marketValidation: okValidation
  });
  assert.equal(conflict.signalState, "WAIT");
  assert.equal(conflict.directionConflict, true);
}

{
  const blocked = buildPreSignalOpportunity({
    snapshot: snapshot(),
    mode: "aggressive",
    evaluated: [strategy("breakout", "CALL", 80)],
    mtf,
    marketRegime: "BREAKOUT",
    marketValidation: { shouldBlock: true, hasInsufficientCandles: false }
  });
  assert.equal(blocked.signalState, "WAIT");
  assert.equal(blocked.preSignal, false);
}

{
  const openCandle = buildPreSignalOpportunity({
    snapshot: snapshot({ timeframes: { ...snapshot().timeframes, m5: { ...snapshot().timeframes.m5, candles: Array(60).fill({ closed: false, close: 100 }) } } }),
    mode: "aggressive",
    evaluated: [strategy("breakout", "CALL", 80)],
    mtf,
    marketRegime: "BREAKOUT",
    marketValidation: okValidation
  });
  assert.equal(openCandle.signalState, "WAIT");
}

assert.equal(getNextCandleOpen(new Date("2026-07-12T14:23:42.000Z"), 5).toISOString(), "2026-07-12T14:25:00.000Z");
console.log("pre-signal opportunity tests passed");

const { createInstitutionalPullbackStrategy } = require("../src/strategy/institutional-pullback.strategy");
const { getStrategyRegistry, createEnabledStrategies } = require("../src/strategy");

function candle(open, high, low, close) {
  return { open, high, low, close };
}

function buildSeries({ start, step, count, pullbackDirection = "bullish" }) {
  const candles = [];
  let price = start;
  for (let index = 0; index < count; index += 1) {
    const wave = index % 4 === 3 ? -step * 2.6 : step;
    const open = price;
    const close = price + wave;
    const high = Math.max(open, close) + Math.abs(step) * 0.8;
    const low = Math.min(open, close) - Math.abs(step) * 0.8;
    candles.push(candle(open, high, low, close));
    price = close;
  }

  if (pullbackDirection === "bullish") {
    candles[candles.length - 2] = candle(price + 0.6, price + 0.8, price - 0.4, price - 0.2);
    candles[candles.length - 1] = candle(price - 0.3, price + 1.4, price - 0.1, price + 1.1);
  } else {
    candles[candles.length - 2] = candle(price - 0.6, price + 0.4, price - 0.8, price + 0.2);
    candles[candles.length - 1] = candle(price + 0.3, price + 0.1, price - 1.4, price - 1.1);
  }

  return candles;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const strategy = createInstitutionalPullbackStrategy();
const registryEntry = getStrategyRegistry().find((entry) => entry.strategyName === "institutional_pullback");
const enabledNames = createEnabledStrategies().map((enabledStrategy) => enabledStrategy.evaluate({}).name);

assert(registryEntry, "institutional_pullback must be registered");
assert(registryEntry.enabled === true, "institutional_pullback must be enabled as first-class strategy");
assert(registryEntry.priority > 10, "institutional_pullback must not replace trend_continuation priority");
assert(enabledNames.includes("institutional_pullback"), "institutional_pullback must be created by enabled registry");

const bullishPayload = {
  m5: buildSeries({ start: 100, step: 0.22, count: 60, pullbackDirection: "bullish" }),
  m15: buildSeries({ start: 100, step: 0.35, count: 60, pullbackDirection: "bullish" }),
  h1: buildSeries({ start: 100, step: 0.5, count: 60, pullbackDirection: "bullish" }),
  mtf: {
    alignment: 3,
    dominantDirection: "up",
    h1: { trend: "up" },
    m15: { trend: "up" }
  }
};

const bullishResult = strategy.evaluate(bullishPayload);
assert(bullishResult.name === "institutional_pullback", "strategy name mismatch");
assert(bullishResult.valid === true, `expected bullish institutional pullback to be valid: ${JSON.stringify(bullishResult.eligibilityAudit)}`);
assert(bullishResult.direction === "CALL", "expected CALL direction");

const audit = bullishResult.eligibilityAudit;
for (const field of ["strategyName", "valid", "direction", "conditions", "criteriaPassed", "criteriaFailed", "blockedBy", "score", "closestDirection", "activationReason"]) {
  assert(Object.prototype.hasOwnProperty.call(audit, field), `missing audit field ${field}`);
}

for (const condition of ["trendContextAligned", "retracementDetected", "structurePreserved", "rsiHealthy", "recoveryCandleConfirmed", "momentumReturning"]) {
  assert(audit.conditions[condition] === true, `expected condition ${condition} to pass`);
}

const bearishPayload = {
  m5: buildSeries({ start: 140, step: -0.22, count: 60, pullbackDirection: "bearish" }),
  m15: buildSeries({ start: 140, step: -0.35, count: 60, pullbackDirection: "bearish" }),
  h1: buildSeries({ start: 140, step: -0.5, count: 60, pullbackDirection: "bearish" }),
  mtf: {
    alignment: 3,
    dominantDirection: "down",
    h1: { trend: "down" },
    m15: { trend: "down" }
  }
};

const bearishResult = strategy.evaluate(bearishPayload);
assert(bearishResult.valid === true, `expected bearish institutional pullback to be valid: ${JSON.stringify(bearishResult.eligibilityAudit)}`);
assert(bearishResult.direction === "PUT", "expected PUT direction");

console.log("Institutional Pullback strategy validation passed");

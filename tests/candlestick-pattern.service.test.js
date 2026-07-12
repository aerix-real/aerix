const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCandlestickPatterns } = require("../src/services/candlestick-pattern.service");

const c = (open, high, low, close, extra = {}) => ({ open, high, low, close, closed: true, ...extra });
const bullishContext = { atSupport: true, trendContext: { h1: { trend: "up" }, m15: { trend: "up" } }, marketRegime: "TRENDING" };
const bearishContext = { atResistance: true, trendContext: { h1: { trend: "down" }, m15: { trend: "down" } }, marketRegime: "TRENDING" };

function names(result) { return result.detectedPatterns.map((p) => p.name); }

test("detects valid hammer at support and rejects open candle confirmation", () => {
  const result = analyzeCandlestickPatterns({ candles: [c(10, 10.2, 8, 10.1)], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } });
  assert.ok(names(result).includes("hammer"));
  assert.ok(result.candlestickAdjustment > 0);
  assert.ok(result.candlestickAdjustment <= 6);

  const open = analyzeCandlestickPatterns({ candles: [c(10, 10.2, 8, 10.1, { closed: false })], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } });
  assert.equal(open.detectedPatterns.length, 0);
  assert.ok(open.blockerAnalytics.includes("candleNotClosed"));
});

test("detects shooting star at resistance", () => {
  const result = analyzeCandlestickPatterns({ candles: [c(10, 12.5, 9.9, 10.1)], context: bearishContext, strategy: { direction: "PUT", rawScore: 70 } });
  assert.ok(names(result).includes("shootingStar"));
  assert.ok(result.candlestickAdjustment > 0);
});

test("detects bullish and bearish engulfing", () => {
  const bullish = analyzeCandlestickPatterns({ candles: [c(10, 10.2, 8.8, 9), c(8.9, 10.8, 8.7, 10.5)], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } });
  assert.ok(names(bullish).includes("bullishEngulfing"));
  const bearish = analyzeCandlestickPatterns({ candles: [c(9, 10.5, 8.8, 10), c(10.2, 10.3, 8.6, 8.9)], context: bearishContext, strategy: { direction: "PUT", rawScore: 70 } });
  assert.ok(names(bearish).includes("bearishEngulfing"));
});

test("detects morning/evening star, soldiers/crows, and methods", () => {
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(10,10.1,8.8,9), c(8.9,9.2,8.7,9.05), c(9.1,10.4,9,10.2)], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } })).includes("morningStar"));
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(9,10.2,8.9,10), c(10.1,10.3,9.9,10.05), c(10,10.1,8.9,9.1)], context: bearishContext, strategy: { direction: "PUT", rawScore: 70 } })).includes("eveningStar"));
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(1,2,0.9,1.9), c(1.8,2.5,1.7,2.4), c(2.3,3,2.2,2.9)], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } })).includes("threeWhiteSoldiers"));
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(3,3.1,2,2.1), c(2.2,2.3,1.5,1.6), c(1.7,1.8,1,1.1)], context: bearishContext, strategy: { direction: "PUT", rawScore: 70 } })).includes("threeBlackCrows"));
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(10,12,9.8,11.8), c(11.7,11.8,11.1,11.2), c(11.2,11.3,10.9,11), c(11,11.1,10.8,10.9), c(10.95,12.4,10.9,12.2)], context: bullishContext, strategy: { direction: "CALL", rawScore: 70 } })).includes("risingThreeMethods"));
  assert.ok(names(analyzeCandlestickPatterns({ candles: [c(12,12.1,10,10.2), c(10.3,10.9,10.2,10.8), c(10.8,11,10.6,10.95), c(10.9,11.1,10.8,11), c(11,11.1,9.7,9.8)], context: bearishContext, strategy: { direction: "PUT", rawScore: 70 } })).includes("fallingThreeMethods"));
});

test("keeps doji neutral and reports conflicts without isolated signal generation", () => {
  const doji = analyzeCandlestickPatterns({ candles: [c(10, 11, 9, 10.02)], context: {}, strategy: {} });
  assert.ok(names(doji).includes("doji"));
  assert.equal(doji.candlestickAdjustment, 0);

  const conflict = analyzeCandlestickPatterns({ candles: [c(10, 12.5, 9.9, 10.1), c(8.9, 11, 8.7, 10.8)], context: { ...bullishContext, atResistance: true }, strategy: { direction: "CALL", rawScore: 70 } });
  assert.equal(conflict.conflicts.patternConflict, true);
});

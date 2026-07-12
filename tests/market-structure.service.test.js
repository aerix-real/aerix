const assert = require("assert");
const {
  analyzeMarketStructure,
  analyzeMultiTimeframeStructure,
  applyMarketStructureScore
} = require("../src/services/market-structure.service");

function c(index, open, high, low, close, extra = {}) {
  return { timestamp: `t${index}`, open, high, low, close, closed: true, ...extra };
}

function series(points) {
  return points.map((p, index) => c(index, p[0], p[1], p[2], p[3], p[4] || {}));
}

const bullish = series([
  [10, 11, 9, 10], [10, 12, 9.5, 11], [11, 15, 10, 14], [14, 13, 12, 12], [12, 12.5, 10.5, 11],
  [11, 16, 12, 15], [15, 14, 12.5, 13], [13, 13.5, 11.5, 12], [12, 18, 13, 17], [17, 16, 14, 15],
  [15, 15.5, 12.5, 14], [14, 20, 13.8, 19], [19, 18, 15, 16], [16, 17, 14.5, 16.5]
]);

const bearish = series([
  [20, 21, 19, 20], [20, 22, 18, 21], [21, 20, 16, 17], [17, 18, 15, 16], [16, 19, 16, 18],
  [18, 20, 15.5, 19], [19, 18, 13, 14], [14, 16, 12, 13], [13, 17, 13, 16], [16, 18, 12.5, 17],
  [17, 16, 10, 11], [11, 14, 9, 10], [10, 13, 9.5, 12], [12, 12, 8, 9]
]);

const range = series([
  [10, 12, 9, 11], [11, 14, 10, 13], [13, 13, 10, 11], [11, 12, 8, 9], [9, 13.9, 8.5, 13],
  [13, 13, 9, 10], [10, 11, 8.1, 9], [9, 14.05, 8.5, 13], [13, 12, 9, 10], [10, 11, 8.05, 9],
  [9, 13.95, 8.5, 13], [13, 12, 9, 10], [10, 11, 8.1, 9]
]);

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test("bullish trend detects HH/HL and no isolated swing signal", () => {
  const result = analyzeMarketStructure({ candles: bullish, timeframe: "m5", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  assert.strictEqual(result.structuralTrend, "BULLISH");
  assert.ok(result.swingHighs.some((p) => p.classification === "HH"));
  assert.ok(result.swingLows.some((p) => p.classification === "HL"));
  assert.ok(!Object.prototype.hasOwnProperty.call(result, "signal"));
});

test("bearish trend detects LL/LH", () => {
  const result = analyzeMarketStructure({ candles: bearish, timeframe: "m15", symbol: "GBP/USD", mode: "balanced", atr: 1 });
  assert.strictEqual(result.structuralTrend, "BEARISH");
  assert.ok(result.swingHighs.some((p) => p.classification === "LH"));
  assert.ok(result.swingLows.some((p) => p.classification === "LL"));
});

test("range detects equal highs and lows", () => {
  const result = analyzeMarketStructure({ candles: range, timeframe: "h1", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  assert.strictEqual(result.structuralTrend, "RANGE");
  assert.ok(result.liquidityLevels.length >= 1);
});

test("BOS bullish confirmed by close and bearish confirmed by close", () => {
  const bullBos = analyzeMarketStructure({ candles: [...bullish, c(14, 16.5, 21, 16, 20.5)], timeframe: "m5", symbol: "ETHEREUM", mode: "balanced", atr: 1 });
  assert.strictEqual(bullBos.bos.detected, true);
  assert.strictEqual(bullBos.bos.direction, "BULLISH");
  const bearBos = analyzeMarketStructure({ candles: [...bearish, c(14, 7.5, 8, 5, 5.5)], timeframe: "m5", symbol: "USD/JPY", mode: "balanced", atr: 1 });
  assert.strictEqual(bearBos.bos.detected, true);
  assert.strictEqual(bearBos.bos.direction, "BEARISH");
});

test("wick-only false BOS becomes sweep context instead of BOS", () => {
  const result = analyzeMarketStructure({ candles: [...range, c(13, 10, 15, 9, 13.5)], timeframe: "m5", symbol: "XRP", mode: "balanced", atr: 1 });
  assert.strictEqual(Boolean(result.bos.detected), false);
  assert.ok(result.liquiditySweeps.some((sweep) => sweep.direction === "PUT"));
});

test("MSS bullish and bearish are detected", () => {
  const mssBear = analyzeMarketStructure({ candles: [...bullish, c(14, 16.5, 17, 12, 12)], timeframe: "m5", symbol: "BITCOIN", mode: "balanced", atr: 1 });
  assert.strictEqual(mssBear.mss.detected, true);
  assert.strictEqual(mssBear.mss.probableNewTrend, "BEARISH");
  const mssBull = analyzeMarketStructure({ candles: [...bearish, c(14, 7.5, 19.5, 7, 19.2)], timeframe: "m5", symbol: "DOGE", mode: "balanced", atr: 1 });
  assert.strictEqual(mssBull.mss.detected, true);
  assert.strictEqual(mssBull.mss.probableNewTrend, "BULLISH");
});

test("liquidity sweep bottom is described for CALL", () => {
  const result = analyzeMarketStructure({ candles: [...range, c(13, 10, 11, 7.4, 8.6)], timeframe: "m5", symbol: "CARDANO", mode: "balanced", atr: 1 });
  assert.ok(result.liquiditySweeps.some((sweep) => sweep.direction === "CALL"));
});

test("first retest only true once and second retest invalidates first flag", () => {
  const base = [...bullish, c(14, 16.5, 21, 16, 20.5), c(15, 20.5, 22, 20.4, 21), c(16, 21, 21.2, 19.9, 20.2)];
  const first = analyzeMarketStructure({ candles: base, timeframe: "m5", symbol: "BNB", mode: "balanced", atr: 1 });
  assert.strictEqual(first.firstRetest.isFirstRetest, true);
  const second = analyzeMarketStructure({ candles: [...base, c(17, 20.2, 22, 19.95, 21)], timeframe: "m5", symbol: "BNB", mode: "balanced", atr: 1 });
  assert.strictEqual(second.firstRetest.isFirstRetest, false);
  assert.strictEqual(second.firstRetest.retestCount, 2);
});

test("structure preserved and invalidated states", () => {
  const preserved = analyzeMarketStructure({ candles: bullish, timeframe: "m5", symbol: "SOLANA", mode: "balanced", atr: 1 });
  assert.strictEqual(preserved.structurePreserved.CALL, true);
  const invalidated = analyzeMarketStructure({ candles: [...bullish, c(14, 16, 17, 12, 12)], timeframe: "m5", symbol: "AVAX", mode: "balanced", atr: 1 });
  assert.strictEqual(invalidated.structurePreserved.CALL, false);
});

test("open candle cannot confirm BOS and insufficient candles hard block", () => {
  const open = analyzeMarketStructure({ candles: [...bullish, c(14, 16.5, 22, 16, 21, { closed: false })], timeframe: "m5", symbol: "SUI", mode: "balanced", atr: 1 });
  assert.ok(open.hardBlocks.includes("candleNotClosed"));
  assert.strictEqual(Boolean(open.bos.detected), false);
  const insufficient = analyzeMarketStructure({ candles: bullish.slice(0, 3), timeframe: "m5", symbol: "LINK", mode: "balanced", atr: 1 });
  assert.ok(insufficient.hardBlocks.includes("insufficientSwingPoints"));
});

test("microtopos ignored by ATR", () => {
  const tiny = series(Array.from({ length: 20 }, (_, i) => [10, 10 + (i % 2) * 0.05, 9.95 - (i % 2) * 0.05, 10]));
  const result = analyzeMarketStructure({ candles: tiny, timeframe: "m5", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  assert.ok(result.swingHighs.length <= 1);
  assert.ok(result.swingLows.length <= 1);
});

test("multi-timeframe alignment and conflict plus score limits", () => {
  const h1 = analyzeMarketStructure({ candles: bullish, timeframe: "h1", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  const m15 = analyzeMarketStructure({ candles: bullish, timeframe: "m15", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  const m5 = analyzeMarketStructure({ candles: bullish, timeframe: "m5", symbol: "EUR/USD", mode: "balanced", atr: 1 });
  const aligned = analyzeMultiTimeframeStructure({ h1, m15, m5 });
  assert.strictEqual(aligned.structuralAlignment, "3/3");
  const conflict = analyzeMultiTimeframeStructure({ h1, m15: analyzeMarketStructure({ candles: bearish, timeframe: "m15", symbol: "EUR/USD", mode: "balanced", atr: 1 }), m5 });
  assert.strictEqual(conflict.conflict, true);
  const adjusted = applyMarketStructureScore({ rawStrategyScore: 80, strategyDirection: "CALL", marketStructure: h1, mode: "balanced" });
  assert.ok(Math.abs(adjusted.marketStructureAdjustment) <= 8);
});

console.log("market structure fixtures covered: bullish, bearish, range, BOS, false BOS, MSS, sweeps, retests, preservation, open candle, insufficient data, micro swings, MTF, Forex and Hezilex crypto symbols.");

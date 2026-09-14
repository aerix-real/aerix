const test = require("node:test");
const assert = require("node:assert/strict");
const {
  detectCandlestickPatterns,
  summarizePatterns
} = require("../src/analysis/candlestick-patterns");

function candle(open, high, low, close) {
  return { open, high, low, close, volume: 1 };
}

function names(patterns) {
  return patterns.map((pattern) => pattern.pattern);
}

test("detects a bullish hammer after a short downtrend", () => {
  const candles = [
    candle(105, 106, 103, 104),
    candle(104, 105, 101, 102),
    candle(102, 103, 99, 100),
    candle(100, 101, 97, 98),
    candle(98.8, 99.2, 94, 98)
  ];

  const patterns = detectCandlestickPatterns(candles);

  assert.ok(names(patterns).includes("Hammer"));
  assert.equal(patterns.find((p) => p.pattern === "Hammer").direction, "CALL");
});

test("detects bullish engulfing", () => {
  const candles = [
    candle(105, 106, 104, 105.5),
    candle(105.5, 106, 103, 104),
    candle(104, 105, 102, 103),
    candle(103, 104, 101, 102),
    candle(102.5, 104.5, 101.5, 104.2)
  ];

  const patterns = detectCandlestickPatterns(candles);

  assert.ok(names(patterns).includes("Bullish Engulfing"));
});

test("detects doji and neutral summary", () => {
  const candles = [
    candle(100, 101, 99, 100.5),
    candle(100.5, 101, 99.5, 100),
    candle(100, 101, 99, 100.2),
    candle(100.2, 101, 99.5, 100.1),
    candle(100.1, 102, 98, 100.1)
  ];

  const patterns = detectCandlestickPatterns(candles);
  const summary = summarizePatterns(patterns);

  assert.ok(names(patterns).includes("Doji"));
  assert.equal(summary.direction, "WAIT");
});

test("detects morning star", () => {
  const candles = [
    candle(105, 106, 102, 103),
    candle(103, 104, 100, 101),
    candle(101, 102, 100.5, 101),
    candle(101, 101.5, 100.8, 101.1),
    candle(101.2, 105.5, 101, 105)
  ];

  const patterns = detectCandlestickPatterns(candles);

  assert.ok(names(patterns).includes("Morning Star"));
  assert.equal(patterns.find((p) => p.pattern === "Morning Star").direction, "CALL");
});

test("ignores malformed OHLC candles", () => {
  const candles = [
    candle(105, 106, 103, 104),
    { open: 104, high: 105, low: null, close: 102 },
    candle(102, 103, 99, 100),
    candle(100, 101, 97, 98),
    candle(98, 99, 94, 97.5)
  ];

  const patterns = detectCandlestickPatterns(candles);

  assert.ok(Array.isArray(patterns));
  assert.ok(!patterns.some((pattern) => pattern.index === 1));
});

const {
  calculateEMA
} = require("./ema.indicator");

function calculateMACD(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(values) || values.length < slowPeriod + signalPeriod) {
    return {
      macdLine: [],
      signalLine: [],
      histogram: []
    };
  }

  const fastEMA = calculateEMA(values, fastPeriod);
  const slowEMA = calculateEMA(values, slowPeriod);

  const offset = slowPeriod - fastPeriod;
  const alignedFast = fastEMA.slice(offset);

  const macdLine = [];

  for (let i = 0; i < slowEMA.length && i < alignedFast.length; i++) {
    macdLine.push(Number((alignedFast[i] - slowEMA[i]).toFixed(6)));
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);

  const histogram = [];
  const macdOffset = macdLine.length - signalLine.length;
  const alignedMacd = macdLine.slice(macdOffset);

  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(Number((alignedMacd[i] - signalLine[i]).toFixed(6)));
  }

  return {
    macdLine,
    signalLine,
    histogram
  };
}

function calculateMACDFromCandles(
  candles,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
  source = "close"
) {
  if (!Array.isArray(candles)) {
    return {
      macdLine: [],
      signalLine: [],
      histogram: []
    };
  }

  const values = candles
    .map((candle) => Number(candle?.[source]))
    .filter((value) => Number.isFinite(value));

  return calculateMACD(values, fastPeriod, slowPeriod, signalPeriod);
}

function getLastMACD(
  candles,
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
  source = "close"
) {
  const result = calculateMACDFromCandles(
    candles,
    fastPeriod,
    slowPeriod,
    signalPeriod,
    source
  );

  const macdLine = result.macdLine;
  const signalLine = result.signalLine;
  const histogram = result.histogram;

  return {
    macd: macdLine.length ? macdLine[macdLine.length - 1] : null,
    signal: signalLine.length ? signalLine[signalLine.length - 1] : null,
    histogram: histogram.length ? histogram[histogram.length - 1] : null
  };
}

function getMACDState(lastMacd, lastSignal, lastHistogram) {
  if (
    !Number.isFinite(lastMacd) ||
    !Number.isFinite(lastSignal) ||
    !Number.isFinite(lastHistogram)
  ) {
    return "neutral";
  }

  if (lastMacd > lastSignal && lastHistogram > 0) {
    return "bullish";
  }

  if (lastMacd < lastSignal && lastHistogram < 0) {
    return "bearish";
  }

  return "neutral";
}

module.exports = {
  calculateMACD,
  calculateMACDFromCandles,
  getLastMACD,
  getMACDState
};
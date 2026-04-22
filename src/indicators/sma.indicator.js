function calculateSMA(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return [];
  }

  const sma = [];

  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const avg = average(window);
    sma.push(Number(avg.toFixed(6)));
  }

  return sma;
}

function calculateSMAFromCandles(candles, period, source = "close") {
  if (!Array.isArray(candles)) {
    return [];
  }

  const values = candles
    .map((candle) => Number(candle?.[source]))
    .filter((value) => Number.isFinite(value));

  return calculateSMA(values, period);
}

function getLastSMA(values, period) {
  const sma = calculateSMA(values, period);
  return sma.length ? sma[sma.length - 1] : null;
}

function getLastSMAFromCandles(candles, period, source = "close") {
  const sma = calculateSMAFromCandles(candles, period, source);
  return sma.length ? sma[sma.length - 1] : null;
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

module.exports = {
  calculateSMA,
  calculateSMAFromCandles,
  getLastSMA,
  getLastSMAFromCandles
};
function calculateEMA(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  const ema = [];

  const firstSlice = values.slice(0, period);
  const firstAverage = average(firstSlice);

  ema.push(Number(firstAverage.toFixed(6)));

  for (let i = period; i < values.length; i++) {
    const previousEma = ema[ema.length - 1];
    const currentValue = Number(values[i]);

    const currentEma =
      (currentValue - previousEma) * multiplier + previousEma;

    ema.push(Number(currentEma.toFixed(6)));
  }

  return ema;
}

function calculateEMAFromCandles(candles, period, source = "close") {
  if (!Array.isArray(candles)) {
    return [];
  }

  const values = candles
    .map((candle) => Number(candle?.[source]))
    .filter((value) => Number.isFinite(value));

  return calculateEMA(values, period);
}

function getLastEMA(values, period) {
  const ema = calculateEMA(values, period);
  return ema.length ? ema[ema.length - 1] : null;
}

function getLastEMAFromCandles(candles, period, source = "close") {
  const ema = calculateEMAFromCandles(candles, period, source);
  return ema.length ? ema[ema.length - 1] : null;
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

module.exports = {
  calculateEMA,
  calculateEMAFromCandles,
  getLastEMA,
  getLastEMAFromCandles
};
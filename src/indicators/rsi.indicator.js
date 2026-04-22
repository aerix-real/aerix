function calculateRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) {
    return [];
  }

  const gains = [];
  const losses = [];

  for (let i = 1; i < values.length; i++) {
    const diff = Number(values[i]) - Number(values[i - 1]);

    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = average(gains.slice(0, period));
  let avgLoss = average(losses.slice(0, period));

  const rsi = [];

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const value = 100 - 100 / (1 + rs);

    rsi.push(Number(value.toFixed(2)));
  }

  return rsi;
}

function calculateRSIFromCandles(candles, period = 14, source = "close") {
  if (!Array.isArray(candles)) {
    return [];
  }

  const values = candles
    .map((candle) => Number(candle?.[source]))
    .filter((value) => Number.isFinite(value));

  return calculateRSI(values, period);
}

function getLastRSI(values, period = 14) {
  const rsi = calculateRSI(values, period);
  return rsi.length ? rsi[rsi.length - 1] : null;
}

function getLastRSIFromCandles(candles, period = 14, source = "close") {
  const rsi = calculateRSIFromCandles(candles, period, source);
  return rsi.length ? rsi[rsi.length - 1] : null;
}

function getRSIZone(value) {
  if (!Number.isFinite(value)) return "neutral";

  if (value >= 70) return "overbought";
  if (value <= 30) return "oversold";

  if (value >= 55) return "bullish";
  if (value <= 45) return "bearish";

  return "neutral";
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

module.exports = {
  calculateRSI,
  calculateRSIFromCandles,
  getLastRSI,
  getLastRSIFromCandles,
  getRSIZone
};
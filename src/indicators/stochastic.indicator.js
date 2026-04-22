function calculateStochastic(candles, period = 14, smoothK = 3, smoothD = 3) {
  if (!Array.isArray(candles) || candles.length < period + smoothK) {
    return {
      k: [],
      d: []
    };
  }

  const rawK = [];

  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1);

    const highestHigh = Math.max(...window.map((c) => Number(c.high)));
    const lowestLow = Math.min(...window.map((c) => Number(c.low)));
    const close = Number(candles[i].close);

    let value = 50;

    if (highestHigh !== lowestLow) {
      value = ((close - lowestLow) / (highestHigh - lowestLow)) * 100;
    }

    rawK.push(Number(value.toFixed(2)));
  }

  const k = movingAverage(rawK, smoothK).map((value) =>
    Number(value.toFixed(2))
  );

  const d = movingAverage(k, smoothD).map((value) =>
    Number(value.toFixed(2))
  );

  return {
    k,
    d
  };
}

function getLastStochastic(candles, period = 14, smoothK = 3, smoothD = 3) {
  const result = calculateStochastic(candles, period, smoothK, smoothD);

  return {
    k: result.k.length ? result.k[result.k.length - 1] : null,
    d: result.d.length ? result.d[result.d.length - 1] : null
  };
}

function getStochasticState(k, d) {
  if (!Number.isFinite(k) || !Number.isFinite(d)) {
    return "neutral";
  }

  if (k >= 80 && d >= 80) return "overbought";
  if (k <= 20 && d <= 20) return "oversold";

  if (k > d && k >= 50) return "bullish";
  if (k < d && k <= 50) return "bearish";

  return "neutral";
}

function movingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) {
    return [];
  }

  const result = [];

  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const avg =
      window.reduce((sum, value) => sum + Number(value), 0) / window.length;

    result.push(avg);
  }

  return result;
}

module.exports = {
  calculateStochastic,
  getLastStochastic,
  getStochasticState
};
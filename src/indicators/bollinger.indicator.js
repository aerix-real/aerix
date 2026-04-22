function calculateBollingerBands(values, period = 20, stdDevMultiplier = 2) {
  if (!Array.isArray(values) || values.length < period) {
    return {
      upper: [],
      middle: [],
      lower: []
    };
  }

  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const mean = average(window);
    const deviation = standardDeviation(window, mean);

    middle.push(Number(mean.toFixed(6)));
    upper.push(Number((mean + deviation * stdDevMultiplier).toFixed(6)));
    lower.push(Number((mean - deviation * stdDevMultiplier).toFixed(6)));
  }

  return {
    upper,
    middle,
    lower
  };
}

function calculateBollingerBandsFromCandles(
  candles,
  period = 20,
  stdDevMultiplier = 2,
  source = "close"
) {
  if (!Array.isArray(candles)) {
    return {
      upper: [],
      middle: [],
      lower: []
    };
  }

  const values = candles
    .map((candle) => Number(candle?.[source]))
    .filter((value) => Number.isFinite(value));

  return calculateBollingerBands(values, period, stdDevMultiplier);
}

function getLastBollinger(candles, period = 20, stdDevMultiplier = 2, source = "close") {
  const bands = calculateBollingerBandsFromCandles(
    candles,
    period,
    stdDevMultiplier,
    source
  );

  return {
    upper: bands.upper.length ? bands.upper[bands.upper.length - 1] : null,
    middle: bands.middle.length ? bands.middle[bands.middle.length - 1] : null,
    lower: bands.lower.length ? bands.lower[bands.lower.length - 1] : null
  };
}

function getBollingerState(price, upper, middle, lower) {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(upper) ||
    !Number.isFinite(middle) ||
    !Number.isFinite(lower)
  ) {
    return "neutral";
  }

  if (price > upper) return "above_upper";
  if (price < lower) return "below_lower";
  if (price > middle) return "upper_half";
  if (price < middle) return "lower_half";
  return "neutral";
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

function standardDeviation(values, mean) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => {
      const diff = Number(value) - mean;
      return sum + diff * diff;
    }, 0) / values.length;

  return Math.sqrt(variance);
}

module.exports = {
  calculateBollingerBands,
  calculateBollingerBandsFromCandles,
  getLastBollinger,
  getBollingerState
};
function calculateATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) {
    return [];
  }

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const highLow = Number(current.high) - Number(current.low);
    const highPrevClose = Math.abs(Number(current.high) - Number(previous.close));
    const lowPrevClose = Math.abs(Number(current.low) - Number(previous.close));

    const tr = Math.max(highLow, highPrevClose, lowPrevClose);
    trueRanges.push(tr);
  }

  const atrValues = [];
  let currentATR = average(trueRanges.slice(0, period));
  atrValues.push(Number(currentATR.toFixed(6)));

  for (let i = period; i < trueRanges.length; i++) {
    currentATR = ((currentATR * (period - 1)) + trueRanges[i]) / period;
    atrValues.push(Number(currentATR.toFixed(6)));
  }

  return atrValues;
}

function getLastATR(candles, period = 14) {
  const atr = calculateATR(candles, period);
  return atr.length ? atr[atr.length - 1] : null;
}

function classifyATR(value) {
  if (!Number.isFinite(value)) return "unknown";

  if (value < 0.0004) return "low";
  if (value < 0.0010) return "medium";
  return "high";
}

function average(values) {
  if (!Array.isArray(values) || !values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
}

module.exports = {
  calculateATR,
  getLastATR,
  classifyATR
};